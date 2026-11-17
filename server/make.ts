// Make.com-Einstellungen für die Auto-Reels (Admin-Zentrale).
// GET  /api/admin/make          → wirksame Konfiguration + letzte Zustellungen (nur Admins)
// PUT  /api/admin/make          → Webhook-URL, Sicherheits-Token und Zielplattformen speichern
// POST /api/admin/make/report   → Browser meldet Erfolg/Fehler eines Uploads an Make (für das Protokoll)
// Der Upload selbst läuft direkt aus dem Browser zu Make (Reels sind oft > 6 MB, also zu groß für eine Function).
import { getStore } from "@netlify/blobs";
import { log } from "./log.ts";
import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { rows } from "./util.ts";
import {
  MAKE_PLATFORMS, PLATFORM_LABELS, resolveMakeConfig, cleanHookUrl, cleanToken, cleanPlatforms, cleanReport, isMakeHost,
  type StoredMakeConfig, type DeliveryReport,
} from "./make-logic.ts";
import { cleanVideoConfig, rotationAt, DEFAULT_VIDEO, PRO_TEMPLATE_KEYS, PRO_TEMPLATE_LABELS, type VideoConfig } from "./reel-video-logic.ts";

const store = () => getStore({ name: "app-config", consistency: "strong" });
const CONFIG_KEY = "make-config";
const LOG_KEY = "make-deliveries";
const MAX_LOG = 25;
const VIDEO_KEY = "reel-video-config";

/** Video-Einstellungen der Pro-Reels (Vorlagen, FPS, Bitrate, Größenlimit, Stimme, Rotation). */
export async function videoConfig(): Promise<VideoConfig> {
  try { return cleanVideoConfig((await store().get(VIDEO_KEY, { type: "json" })) ?? {}, DEFAULT_VIDEO); } catch { return { ...DEFAULT_VIDEO }; }
}

async function stored(): Promise<StoredMakeConfig | null> {
  try { return (await store().get(CONFIG_KEY, { type: "json" })) as StoredMakeConfig | null; } catch { return null; }
}
async function deliveries(): Promise<DeliveryReport[]> {
  try { const v = await store().get(LOG_KEY, { type: "json" }); return Array.isArray(v) ? (v as DeliveryReport[]) : []; } catch { return []; }
}

/** Preisverlauf fürs Startbild: echter Verlauf, sonst 30-Tage-Schnitt → 7-Tage-Schnitt → aktueller Trend. */
export function coverHistory(r: any): number[] {
  const h = Array.isArray(r.history) ? r.history.map(Number).filter((v: number) => v > 0) : [];
  if (h.length >= 3) return h;
  const pts = [Number(r.avg30), Number(r.avg7), Number(r.price)].filter((v) => v > 0);
  return pts.length >= 2 ? pts : h;
}

/** Wirksame Make-Konfiguration (auch für den Auto-Reels-Generator). */
export async function makeConfig() {
  return resolveMakeConfig(await stored(), process.env);
}

export function registerMake(app: any, { auth, adminOnly, body }: any) {
  app.get("/api/admin/make", auth, adminOnly, async (c: any) => {
    c.header("Cache-Control", "no-store");
    const cfg = await makeConfig();
    const log = await deliveries();
    return c.json({
      ...cfg,
      isMakeHost: isMakeHost(cfg.url),
      env: {
        url: Boolean(cleanHookUrl(process.env.MAKE_WEBHOOK_URL)),
        token: Boolean(cleanToken(process.env.MAKE_WEBHOOK_TOKEN)),
        platforms: Boolean(String(process.env.MAKE_PLATFORMS || "").trim()),
      },
      allPlatforms: MAKE_PLATFORMS.map((id) => ({ id, label: PLATFORM_LABELS[id] })),
      lastSuccess: log.find((d) => d.ok) ?? null,
      lastError: log.find((d) => !d.ok) ?? null,
      deliveries: log.slice(0, 10),
      video: await videoConfig(),
      allTemplates: PRO_TEMPLATE_KEYS.map((id) => ({ id, label: PRO_TEMPLATE_LABELS[id] })),
    });
  });

  // Video-Einstellungen speichern (Vorlagen, FPS, Bitrate, Größenlimit, Stimme, Rotation zurücksetzen)
  app.put("/api/admin/make/video", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const prev = await videoConfig();
    const next = cleanVideoConfig({ ...b, rotation: b.resetRotation === true ? 0 : prev.rotation, updatedAt: new Date().toISOString() }, prev);
    try { await store().setJSON(VIDEO_KEY, next); }
    catch (e) { log.error("make", "Video-Einstellungen nicht gespeichert", { err: e }); return c.json({ error: "Speichern fehlgeschlagen – bitte erneut versuchen." }, 502); }
    return c.json({ ok: true, video: next, next: rotationAt(next) });
  });

  // Echte Kartenmotive für die Startbilder: zufällige wertvolle Karten mit Bild, Cardmarket-Trend,
  // 30-Tage-Schnitt, Preisverlauf (bis 30 Tage) und – falls vorhanden – TCGplayer-Marktpreis in USD.
  app.get("/api/admin/reel-cover-cards", auth, adminOnly, async (c: any) => {
    const n = Math.min(24, Math.max(1, Number(c.req.query("n")) || 8));
    const exclude = String(c.req.query("exclude") || "").split(",").map((x) => x.trim()).filter((x) => /^[\w.-]{1,40}$/.test(x)).slice(0, 60);
    try {
      const list = rows(await db.execute(sql`
        SELECT k.id, k.name, k.set_name, k.image, k.rarity, k.price, k.avg30, k.avg7,
          (SELECT p.tcg_market_usd::float FROM card_prints p WHERE p.base_card_id = k.id AND p.tcg_market_usd IS NOT NULL ORDER BY p.tcg_market_usd DESC LIMIT 1) AS usd,
          (SELECT json_agg(h.trend ORDER BY h.day) FROM (SELECT day, trend::float AS trend FROM price_history WHERE card_id = k.id AND trend IS NOT NULL ORDER BY day DESC LIMIT 30) h) AS history
        FROM (
          SELECT id, name, set_name, image, rarity, COALESCE(trend, avg)::float AS price, avg30::float AS avg30, avg7::float AS avg7
          FROM cards
          WHERE image <> '' AND COALESCE(trend, avg) BETWEEN 8 AND 3000
            ${exclude.length ? sql`AND id NOT IN (${sql.join(exclude.map((x) => sql`${x}`), sql`, `)})` : sql``}
          ORDER BY COALESCE(trend, avg) DESC LIMIT 600
        ) k
        ORDER BY random() LIMIT ${n}`));
      c.header("Cache-Control", "no-store");
      return c.json({
        cards: list.map((r: any) => ({
          id: String(r.id), name: String(r.name), setName: String(r.set_name || ""), image: String(r.image), rarity: r.rarity ? String(r.rarity) : "",
          price: Number(r.price) || null, avg30: Number(r.avg30) || null, usd: Number(r.usd) || null,
          history: coverHistory(r),
        })),
      });
    } catch (e) {
      log.warn("make", "Kartenmotive für Startbilder nicht lesbar", { err: e });
      return c.json({ cards: [] });
    }
  });

  // Nächste Vorlage der Rotation holen und den Zähler weiterschalten (gilt für alle Browser gleich)
  app.post("/api/admin/make/video/next", auth, adminOnly, async (c: any) => {
    const cfg = await videoConfig();
    const pick = rotationAt(cfg);
    try { await store().setJSON(VIDEO_KEY, { ...cfg, rotation: cfg.rotation + 1 }); } catch { /* Rotation optional */ }
    return c.json(pick);
  });

  app.put("/api/admin/make", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const prev = (await stored()) ?? {};
    const next: StoredMakeConfig = { ...prev, updatedAt: new Date().toISOString(), updatedBy: String(c.get("user")?.email || "").slice(0, 120) };
    if ("url" in b) {
      const raw = String(b.url ?? "").trim();
      if (b.reset === true) next.url = null; // zurück zu MAKE_WEBHOOK_URL
      else if (!raw) next.url = ""; // bewusst leer = kein Versand, Reels werden heruntergeladen
      else {
        const url = cleanHookUrl(raw);
        if (!url) return c.json({ error: "Ungültige Webhook-URL – nur https:// erlaubt (z. B. https://hook.eu1.make.com/…)." }, 400);
        if (!isMakeHost(url)) return c.json({ error: "Nur Make.com-Webhooks (https://hook.<region>.make.com/…) sind erlaubt – andere Ziele blockiert der Browser." }, 400);
        next.url = url;
      }
    }
    if ("token" in b) {
      const raw = String(b.token ?? "").trim();
      if (raw && !cleanToken(raw)) return c.json({ error: "Der Token darf nur sichtbare Zeichen ohne Leerzeichen enthalten (max. 200)." }, 400);
      next.token = raw || null;
    }
    if ("platforms" in b) {
      const p = cleanPlatforms(b.platforms);
      if (!p.length) return c.json({ error: "Bitte mindestens eine Plattform auswählen." }, 400);
      next.platforms = p;
    }
    try { await store().setJSON(CONFIG_KEY, next); }
    catch (e) { log.error("make", "Make-Einstellungen nicht gespeichert", { err: e }); return c.json({ error: "Speichern fehlgeschlagen – bitte erneut versuchen." }, 502); }
    return c.json({ ok: true, ...(await makeConfig()) });
  });

  app.post("/api/admin/make/report", auth, adminOnly, async (c: any) => {
    const r = cleanReport(await body(c));
    try {
      const list = [r, ...(await deliveries())].slice(0, MAX_LOG);
      await store().setJSON(LOG_KEY, list);
    } catch { /* Protokoll ist optional */ }
    if (!r.ok && !r.test) log.warn("make", "Reel-Upload an Make.com fehlgeschlagen", { episode: r.episode, status: r.status, message: r.message });
    return c.json({ ok: true });
  });
}
