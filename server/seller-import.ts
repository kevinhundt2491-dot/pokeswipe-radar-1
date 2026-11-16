// Phase 7: Händler-Bestands-Import (Säule B) – CSV-Upload im Cardmarket-/TCGplayer-/freien Format
//
//  POST /api/seller/import            Datei (Text, max. 5 MB / 50.000 Zeilen) + Optionen → Blobs, Verarbeitung im Hintergrund
//  GET  /api/seller/imports           letzte Importe
//  GET  /api/seller/import/:id        Fortschritt
//  GET  /api/seller/import/:id/rows   Prüf-Queue (unsichere Zuordnung) und Fehlerzeilen
//  POST /api/seller/import/:id/resolve  Zeile einer Karte zuordnen oder überspringen
//  POST /api/seller/import/:id/retry  hängengebliebenen Import neu anstoßen
//
// Verarbeitung (processImport): Netlify Background Function seller-import-background (bis 15 Min., setzt sich bei
// sehr großen Dateien selbst fort). Je Zeile: Katalog-Zuordnung (Set-Kürzel/Setname + Nummer, sonst Name + Set),
// Preis aus Datei oder Marktpreis × Faktor, Upsert per (Verkäufer, SKU) → erneuter Import aktualisiert Preise und Mengen.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { db, profiles, listings, sellerImports, sellerImportRows } from "../db/index.ts";
import type { AuthUser } from "./auth.ts";
import { effectivePlan, listingLimit, PLANS } from "./plans.ts";
import { trustFor } from "./community.ts";
import { checkEscrowLimit } from "./community-logic.ts";
import { dac7SellerBlock } from "./dac7.ts";
import { MARKET_MIN_PRICE_CENTS, MARKET_MAX_PRICE_CENTS } from "./market-logic.ts";
import { parseImport, importPrice, cleanImportOptions, IMPORT_MAX_BYTES, type ImportRow } from "./seller-import-logic.ts";
import { str, int, rows, rateLimit, trustedOrigin } from "./util.ts";
import { log } from "./log.ts";

type Hlp = { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> };
type Profile = typeof profiles.$inferSelect;
type Opts = ReturnType<typeof cleanImportOptions>;

const store = () => getStore({ name: "seller-imports", consistency: "strong" });
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const RUN_BUDGET_MS = 13 * 60_000;
const COND_KEYS: Record<ImportRow["condition"], string> = { mint: "mint", nm: "nm", ex: "ex", gd: "gd", lp: "lp", pl: "pl", po: "po" };

/** Startet die Background Function (gibt sofort 202 zurück). */
async function trigger(importId: number, token: string, base: string) {
  const res = await fetch(`${base.replace(/\/$/, "")}/.netlify/functions/seller-import-background`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId, token }), signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && res.status !== 202) throw new Error(`Hintergrund-Import nicht gestartet (HTTP ${res.status})`);
}

// ---------------------------------------------------------------------------
// Katalog-Zuordnung
// ---------------------------------------------------------------------------
type Match = { cardId: string | null; printId: string | null; name: string; image: string; marketEur: number | null; setName: string; number: string };

function priceFor(r: any, variant: string): number | null {
  if (r.kind === "de") {
    const v = variant === "reverse_holo" ? (r.reverse_trend ?? r.trend) : r.trend;
    return v != null ? Number(v) : null;
  }
  const vp = r.variant_prices?.[variant]?.price;
  return vp != null && vp !== "" ? Number(vp) : r.price_eur != null ? Number(r.price_eur) : null;
}
const toMatch = (r: any, variant: string): Match => ({
  cardId: r.card_id ? String(r.card_id) : null, printId: r.print_id ? String(r.print_id) : null, name: String(r.name), image: String(r.image || ""),
  marketEur: priceFor(r, variant), setName: String(r.set_name || ""), number: String(r.number || r.local_id || ""),
});

async function candidates(row: ImportRow): Promise<any[]> {
  const code = row.setCode, setName = row.setName.toLowerCase(), name = row.name.toLowerCase();
  if (row.lang === "de") {
    const where = row.number
      ? sql`ltrim(c.local_id, '0') = ${row.number} AND (${code} = '' OR upper(s.abbreviation) = ${code} OR upper(c.set_id) = ${code})
          AND (${setName} = '' OR lower(c.set_name) = ${setName} OR lower(s.name) = ${setName} OR ${code} <> '')
          AND (${row.total}::int IS NULL OR s.card_count_official = ${row.total}::int OR ${code} <> '' OR ${setName} <> '')`
      : sql`lower(c.name) = ${name} AND (${setName} = '' OR lower(c.set_name) = ${setName} OR lower(s.name) = ${setName}) AND (${code} = '' OR upper(s.abbreviation) = ${code})`;
    const list = rows(await db.execute(sql`SELECT 'de' AS kind, c.id AS card_id, NULL::text AS print_id, c.name, c.image, c.set_name, c.local_id,
        CASE WHEN s.card_count_official > 0 THEN ltrim(c.local_id, '0') || '/' || s.card_count_official ELSE c.local_id END AS number,
        c.trend::float AS trend, c.reverse_trend::float AS reverse_trend, NULL::jsonb AS variant_prices, NULL::float AS price_eur
      FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id WHERE ${where} LIMIT 6`));
    if (list.length || row.number) return list;
  }
  // EN/JA-Drucke – auch für deutsche Zeilen aus dem Cardmarket-Export (englische Produkt- und Setnamen) → base_card_id
  const lang = row.lang === "de" ? "en" : row.lang;
  const where = row.number
    ? sql`ltrim(p.local_id, '0') = ${row.number} AND (${code} = '' OR upper(p.set_code) = ${code} OR upper(ps.code) = ${code})
        AND (${setName} = '' OR lower(p.set_name) = ${setName} OR ${code} <> '')`
    : sql`lower(p.name) = ${name} AND (${setName} = '' OR lower(p.set_name) = ${setName}) AND (${code} = '' OR upper(p.set_code) = ${code} OR upper(ps.code) = ${code})`;
  const list = rows(await db.execute(sql`SELECT ${row.lang === "de" ? "de-via-en" : "print"} AS kind, p.base_card_id AS card_id, p.id AS print_id, p.name, p.image, p.set_name, p.local_id, p.number,
      c.trend::float AS trend, c.reverse_trend::float AS reverse_trend, p.variant_prices, p.price_eur::float AS price_eur, c.name AS de_name, c.image AS de_image
    FROM card_prints p LEFT JOIN print_sets ps ON ps.lang = p.lang AND ps.id = p.set_id LEFT JOIN cards c ON c.id = p.base_card_id
    WHERE p.lang = ${lang} AND ${where} LIMIT 6`));
  if (row.lang === "de") {
    // Deutsche Karte: nur Treffer mit deutscher Entsprechung, Preis/Name/Bild der deutschen Karte
    return list.filter((r: any) => r.card_id).map((r: any) => ({ ...r, kind: "de", print_id: null, name: r.de_name || r.name, image: r.de_image || r.image }));
  }
  return list;
}

/** Ähnliche Karten für die Prüf-Queue (Trigram-Suche über den Namen). */
async function fuzzy(row: ImportRow): Promise<Match[]> {
  const name = row.name.toLowerCase().replace(/[%_\\]/g, "");
  if (name.length < 3) return [];
  const list = row.lang === "de"
    ? rows(await db.execute(sql`SELECT 'de' AS kind, c.id AS card_id, NULL::text AS print_id, c.name, c.image, c.set_name, c.local_id, c.local_id AS number, c.trend::float AS trend, c.reverse_trend::float AS reverse_trend
        FROM cards c WHERE ${name} <% lower(c.name) ${row.number ? sql`AND ltrim(c.local_id, '0') = ${row.number}` : sql``} ORDER BY word_similarity(${name}, lower(c.name)) DESC LIMIT 5`))
    : rows(await db.execute(sql`SELECT 'print' AS kind, p.base_card_id AS card_id, p.id AS print_id, p.name, p.image, p.set_name, p.local_id, p.number, p.variant_prices, p.price_eur::float AS price_eur
        FROM card_prints p WHERE p.lang = ${row.lang} AND ${name} <% lower(p.name) ${row.number ? sql`AND ltrim(p.local_id, '0') = ${row.number}` : sql``} ORDER BY word_similarity(${name}, lower(p.name)) DESC LIMIT 5`));
  return list.map((r: any) => toMatch(r, row.variant));
}

// ---------------------------------------------------------------------------
// Inserat anlegen/aktualisieren
// ---------------------------------------------------------------------------
type SellerCtx = { profile: Profile; opts: Opts; importId: number; room: number; buyNowLimitCents: number; buyNowBlocked: boolean };

async function upsertListing(ctx: SellerCtx, row: ImportRow, m: Match): Promise<{ status: "created" | "updated" | "error"; listingId?: number; message?: string }> {
  const priceCents = importPrice(row, m.marketEur, ctx.opts.price);
  if (priceCents === null || priceCents < 10) return { status: "error", message: "Kein Preis in der Datei und kein Marktpreis für diese Karte." };
  if (priceCents > 10_000_000) return { status: "error", message: "Preis über 100.000 €." };
  const buyNow = ctx.opts.buyNow && ctx.profile.stripeAccountReady && !ctx.buyNowBlocked
    && priceCents >= MARKET_MIN_PRICE_CENTS && priceCents <= Math.min(MARKET_MAX_PRICE_CENTS, ctx.buyNowLimitCents);
  const status = row.quantity > 0 ? "active" : "removed";
  const [existing] = await db.select({ id: listings.id, status: listings.status }).from(listings)
    .where(and(eq(listings.userId, ctx.profile.userId), eq(listings.externalSku, row.sku))).limit(1);
  // Neue aktive Inserate zählen gegen das Inserate-Limit (Updates nicht)
  const addsActive = status === "active" && (!existing || existing.status !== "active");
  if (addsActive && ctx.room <= 0) return { status: "error", message: "Inserate-Limit erreicht – bitte Tarif upgraden oder ein höheres Händler-Limit anfragen." };
  const values = {
    cardId: m.cardId, printId: m.printId, cardName: m.name.slice(0, 120), image: m.image, price: (priceCents / 100).toFixed(2), buyNow,
    shippingCents: buyNow ? ctx.opts.shippingCents : 0, condition: COND_KEYS[row.condition], lang: row.lang, variant: row.variant,
    quantity: row.quantity, status, source: "csv", importId: ctx.importId, updatedAt: new Date(),
  };
  if (existing) {
    await db.update(listings).set(values).where(eq(listings.id, existing.id));
    if (addsActive) ctx.room--;
    return { status: "updated", listingId: existing.id };
  }
  const [created] = await db.insert(listings).values({
    ...values, userId: ctx.profile.userId, externalSku: row.sku, want: buyNow ? "Sofort-Kauf" : "Tausch / Gebot",
    city: ctx.opts.city || ctx.profile.city || "Deutschland",
  }).onConflictDoNothing().returning({ id: listings.id });
  if (!created) return { status: "updated" };
  if (addsActive) ctx.room--;
  return { status: "created", listingId: created.id };
}

async function sellerContext(importId: number, sellerId: string, opts: Opts): Promise<SellerCtx | null> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, sellerId)).limit(1);
  if (!profile || profile.banned) return null;
  const plan = effectivePlan(profile);
  const [n] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM listings WHERE user_id = ${sellerId} AND status = 'active'`));
  const trust = (await trustFor([sellerId])).get(sellerId)?.score ?? 0;
  const lim = checkEscrowLimit("sell", trust, Boolean(profile.flaggedAt), 0);
  const blocked = Boolean(profile.flaggedAt) || Boolean(await dac7SellerBlock(sellerId));
  return { profile, opts, importId, room: listingLimit(plan, profile.listingLimitOverride) - Number(n?.n || 0), buyNowLimitCents: lim.limitCents, buyNowBlocked: blocked };
}

// ---------------------------------------------------------------------------
// Verarbeitung (aufgerufen von netlify/functions/seller-import-background.mts)
// ---------------------------------------------------------------------------
export async function processImport(importId: number, token: string, base: string) {
  const [imp] = await db.select().from(sellerImports).where(eq(sellerImports.id, importId)).limit(1);
  if (!imp) return { ok: false, reason: "missing" };
  const a = Buffer.from(imp.tokenHash), b = Buffer.from(hashToken(String(token || "")));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "token" };
  if (imp.status === "done" || imp.status === "failed") return { ok: true, alreadyDone: true };
  const started = Date.now();
  await db.update(sellerImports).set({ status: "running", startedAt: imp.startedAt ?? new Date() }).where(eq(sellerImports.id, importId));
  try {
    const text = await store().get(imp.blobKey, { type: "text" });
    if (!text) throw new Error("Importdatei nicht gefunden.");
    const opts = cleanImportOptions((imp.options || {}) as any);
    const parsed = parseImport(text, opts.defaultLang);
    const ctx = await sellerContext(importId, imp.sellerId, opts);
    if (!ctx) throw new Error("Verkäuferkonto nicht verfügbar.");
    let { processedRows: done, createdRows: created, updatedRows: updated, reviewRows: review, errorRows: errors } = imp;
    // Fehlerzeilen der Datei einmalig beim ersten Lauf speichern
    if (done === 0 && parsed.errors.length) {
      for (let i = 0; i < parsed.errors.length; i += 200) {
        await db.insert(sellerImportRows).values(parsed.errors.slice(i, i + 200).map((e) => ({ importId, rowNo: e.rowNo, raw: e.raw, status: "error", message: e.message })));
      }
      errors += parsed.errors.length;
    }
    await db.update(sellerImports).set({ format: parsed.format, totalRows: parsed.total }).where(eq(sellerImports.id, importId));
    const cache = new Map<string, any[]>();
    for (let i = done; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const key = [row.lang, row.name.toLowerCase(), row.number, row.total, row.setCode, row.setName.toLowerCase()].join("|");
      let list = cache.get(key);
      if (!list) { list = await candidates(row); if (cache.size < 5000) cache.set(key, list); }
      if (list.length === 1) {
        const r = await upsertListing(ctx, row, toMatch(list[0], row.variant));
        if (r.status === "created") created++; else if (r.status === "updated") updated++;
        else { errors++; await db.insert(sellerImportRows).values({ importId, rowNo: row.rowNo, raw: row as any, status: "error", message: r.message || "" }); }
      } else {
        const cands = list.length ? list.map((x) => toMatch(x, row.variant)) : await fuzzy(row);
        review++;
        await db.insert(sellerImportRows).values({ importId, rowNo: row.rowNo, raw: row as any, status: "review", candidates: cands.slice(0, 5) as any,
          message: list.length ? "Mehrere passende Karten – bitte auswählen." : "Keine eindeutige Karte gefunden – bitte auswählen oder überspringen." });
      }
      done = i + 1;
      if (done % 100 === 0) await db.update(sellerImports).set({ processedRows: done, createdRows: created, updatedRows: updated, reviewRows: review, errorRows: errors }).where(eq(sellerImports.id, importId));
      // Sehr große Dateien: Fortschritt speichern und in einem neuen Hintergrund-Lauf fortsetzen
      if (Date.now() - started > RUN_BUDGET_MS && done < parsed.rows.length) {
        await db.update(sellerImports).set({ processedRows: done, createdRows: created, updatedRows: updated, reviewRows: review, errorRows: errors }).where(eq(sellerImports.id, importId));
        await trigger(importId, token, base);
        return { ok: true, continued: true, done };
      }
    }
    let removed = 0;
    if (opts.removeMissing) {
      // Sync-Modus: CSV-Inserate, die in dieser Datei nicht mehr vorkommen, sind ausverkauft → entfernen
      const r = rows(await db.execute(sql`UPDATE listings SET status = 'removed', updated_at = now()
        WHERE user_id = ${imp.sellerId} AND source = 'csv' AND status = 'active' AND (import_id IS NULL OR import_id <> ${importId}) AND reserved = 0 RETURNING id`));
      removed = r.length;
    }
    await db.update(sellerImports).set({
      status: "done", processedRows: done, createdRows: created, updatedRows: updated, reviewRows: review, errorRows: errors, finishedAt: new Date(),
      message: `${created} neu, ${updated} aktualisiert, ${review} zu prüfen, ${errors} Fehler${removed ? `, ${removed} nicht mehr im Bestand entfernt` : ""}.`,
    }).where(eq(sellerImports.id, importId));
    await store().delete(imp.blobKey).catch(() => {});
    return { ok: true, created, updated, review, errors, removed };
  } catch (e: any) {
    log.error("seller-import", "Import fehlgeschlagen", { importId, err: e });
    await db.update(sellerImports).set({ status: "failed", finishedAt: new Date(), message: String(e?.message || e).slice(0, 300) }).where(eq(sellerImports.id, importId));
    return { ok: false, reason: "error" };
  }
}

const importView = (i: typeof sellerImports.$inferSelect) => ({
  id: i.id, filename: i.filename, format: i.format, status: i.status, totalRows: i.totalRows, processedRows: i.processedRows,
  createdRows: i.createdRows, updatedRows: i.updatedRows, reviewRows: i.reviewRows, errorRows: i.errorRows, message: i.message,
  createdAt: i.createdAt, finishedAt: i.finishedAt, options: i.options,
});

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerSellerImport(app: any, hlp: Hlp) {
  const { auth, body } = hlp;

  app.post("/api/seller/import", auth, async (c: any) => {
    const user: AuthUser = c.get("user"), p: Profile = c.get("profile"), plan = c.get("plan");
    if (!PLANS[plan as keyof typeof PLANS]?.shop && !p.listingLimitOverride) return c.json({ error: "Der Bestands-Import ist für Pro Trader und freigeschaltete Händler verfügbar.", upgrade: true }, 402);
    if (!(await rateLimit(`seller-import:${user.id}`, 6, 3600_000))) return c.json({ error: "Höchstens 6 Importe pro Stunde." }, 429);
    const b = await body(c);
    const csv = typeof b.csv === "string" ? b.csv : "";
    if (!csv.trim()) return c.json({ error: "Bitte eine CSV-Datei auswählen." }, 400);
    if (Buffer.byteLength(csv, "utf8") > IMPORT_MAX_BYTES) return c.json({ error: "Die Datei ist größer als 5 MB – bitte aufteilen." }, 413);
    const [running] = rows(await db.execute(sql`SELECT id FROM seller_imports WHERE seller_id = ${user.id} AND status IN ('queued','running') AND created_at > now() - interval '1 hour' LIMIT 1`));
    if (running) return c.json({ error: "Es läuft bereits ein Import – bitte warte, bis er fertig ist.", importId: Number(running.id) }, 409);
    const opts = cleanImportOptions(b.options || {});
    // Schnelle Vorprüfung, damit offensichtlich falsche Dateien sofort eine Meldung bekommen
    const pre = parseImport(csv, opts.defaultLang);
    if (!pre.rows.length) return c.json({ error: pre.errors[0]?.message ? `Keine gültige Zeile gefunden (z. B. Zeile ${pre.errors[0].rowNo}: ${pre.errors[0].message})` : "Keine Kopfzeile mit Kartenname gefunden. Unterstützt: Cardmarket-Bestandsexport, TCGplayer-Export oder CSV mit Spalten wie Name, Nummer, Set, Zustand, Sprache, Menge, Preis." }, 400);
    const token = randomBytes(24).toString("hex");
    const blobKey = `${user.id}/${Date.now()}-${randomBytes(4).toString("hex")}.csv`;
    await store().set(blobKey, csv);
    const [imp] = await db.insert(sellerImports).values({
      sellerId: user.id, filename: str(b.filename, 120), format: pre.format, blobKey, tokenHash: hashToken(token), options: opts as any, totalRows: pre.total,
    }).returning();
    const base = process.env.URL || trustedOrigin(c) || new URL(c.req.url).origin;
    try { await trigger(imp.id, token, base); }
    catch (e) {
      log.error("seller-import", "Hintergrund-Import nicht gestartet", { importId: imp.id, err: e });
      await db.update(sellerImports).set({ status: "failed", message: "Verarbeitung konnte nicht gestartet werden – bitte erneut versuchen." }).where(eq(sellerImports.id, imp.id));
      return c.json({ error: "Verarbeitung konnte nicht gestartet werden – bitte erneut versuchen." }, 502);
    }
    return c.json({ ...importView(imp), preview: { format: pre.format, rows: pre.rows.length, errors: pre.errors.length } }, 202);
  });

  app.get("/api/seller/imports", auth, async (c: any) => {
    const list = await db.select().from(sellerImports).where(eq(sellerImports.sellerId, c.get("user").id)).orderBy(desc(sellerImports.createdAt)).limit(20);
    return c.json({ imports: list.map(importView) });
  });

  const own = async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const [imp] = id ? await db.select().from(sellerImports).where(and(eq(sellerImports.id, id), eq(sellerImports.sellerId, c.get("user").id))).limit(1) : [];
    return imp || null;
  };

  app.get("/api/seller/import/:id", auth, async (c: any) => {
    const imp = await own(c);
    return imp ? c.json(importView(imp)) : c.json({ error: "Nicht gefunden" }, 404);
  });

  app.get("/api/seller/import/:id/rows", auth, async (c: any) => {
    const imp = await own(c);
    if (!imp) return c.json({ error: "Nicht gefunden" }, 404);
    const status = c.req.query("status") === "error" ? "error" : "review";
    const list = await db.select().from(sellerImportRows).where(and(eq(sellerImportRows.importId, imp.id), eq(sellerImportRows.status, status)))
      .orderBy(sellerImportRows.rowNo).limit(int(c.req.query("limit"), 1, 200, 50)).offset(int(c.req.query("offset"), 0, 100_000, 0));
    return c.json({ rows: list.map((r) => ({ id: r.id, rowNo: r.rowNo, raw: r.raw, candidates: r.candidates || [], message: r.message, status: r.status })) });
  });

  app.post("/api/seller/import/:id/resolve", auth, async (c: any) => {
    const imp = await own(c);
    if (!imp) return c.json({ error: "Nicht gefunden" }, 404);
    const b = await body(c);
    const rowId = int(b.rowId, 1, 2 ** 31 - 1, 0);
    const [r] = await db.select().from(sellerImportRows).where(and(eq(sellerImportRows.id, rowId), eq(sellerImportRows.importId, imp.id), eq(sellerImportRows.status, "review"))).limit(1);
    if (!r) return c.json({ error: "Zeile nicht gefunden oder schon erledigt." }, 404);
    if (b.skip === true) {
      await db.update(sellerImportRows).set({ status: "skipped" }).where(eq(sellerImportRows.id, r.id));
      await db.update(sellerImports).set({ reviewRows: sql`greatest(${sellerImports.reviewRows} - 1, 0)` }).where(eq(sellerImports.id, imp.id));
      return c.json({ ok: true, status: "skipped" });
    }
    const pick = int(b.candidate, 0, 4, -1);
    const cands = (r.candidates || []) as Match[];
    if (pick < 0 || !cands[pick]) return c.json({ error: "Bitte eine der vorgeschlagenen Karten wählen." }, 400);
    const ctx = await sellerContext(imp.id, imp.sellerId, cleanImportOptions((imp.options || {}) as any));
    if (!ctx) return c.json({ error: "Verkäuferkonto nicht verfügbar." }, 403);
    const res = await upsertListing(ctx, r.raw as unknown as ImportRow, cands[pick]);
    if (res.status === "error") return c.json({ error: res.message }, 409);
    await db.update(sellerImportRows).set({ status: "resolved", listingId: res.listingId ?? null }).where(eq(sellerImportRows.id, r.id));
    await db.update(sellerImports).set({
      reviewRows: sql`greatest(${sellerImports.reviewRows} - 1, 0)`,
      ...(res.status === "created" ? { createdRows: sql`${sellerImports.createdRows} + 1` } : { updatedRows: sql`${sellerImports.updatedRows} + 1` }),
    }).where(eq(sellerImports.id, imp.id));
    return c.json({ ok: true, status: res.status, listingId: res.listingId });
  });

  app.post("/api/seller/import/:id/retry", auth, async (c: any) => {
    const imp = await own(c);
    if (!imp) return c.json({ error: "Nicht gefunden" }, 404);
    // Nur hängengebliebene Läufe (> 20 Min. ohne Abschluss) oder fehlgeschlagene Starts mit noch vorhandener Datei
    const stale = imp.status === "running" && imp.startedAt && Date.now() - new Date(imp.startedAt).getTime() > 20 * 60_000;
    if (!(imp.status === "queued" || stale || (imp.status === "failed" && imp.processedRows === 0))) return c.json({ error: "Dieser Import kann nicht neu gestartet werden." }, 409);
    const exists = await store().get(imp.blobKey, { type: "text" }).catch(() => null);
    if (!exists) return c.json({ error: "Die Datei ist nicht mehr vorhanden – bitte neu hochladen." }, 410);
    const token = randomBytes(24).toString("hex");
    await db.update(sellerImports).set({ tokenHash: hashToken(token), status: "queued", message: "" }).where(eq(sellerImports.id, imp.id));
    try { await trigger(imp.id, token, process.env.URL || trustedOrigin(c) || new URL(c.req.url).origin); }
    catch { return c.json({ error: "Verarbeitung konnte nicht gestartet werden." }, 502); }
    return c.json({ ok: true });
  });
}
