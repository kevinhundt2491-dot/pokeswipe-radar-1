// Make.com-Anbindung der Auto-Reels – reine Logik ohne Netlify-Abhängigkeiten (testbar).
// Reihenfolge für Webhook-URL und Token: Admin-Zentrale (Netlify Blobs) → Umgebungsvariable → (nur URL) Alt-Wert im Code.

/** Zielplattformen, die Make.com im Router auswerten kann (Feld "platforms"). */
export const MAKE_PLATFORMS = ["instagram", "tiktok", "youtube", "facebook"] as const;
export type MakePlatform = (typeof MAKE_PLATFORMS)[number];
export const PLATFORM_LABELS: Record<MakePlatform, string> = {
  instagram: "Instagram Reels", tiktok: "TikTok", youtube: "YouTube Shorts", facebook: "Facebook Reels",
};

/** Früher fest eingebaute Webhook-Adresse – nur noch Rückfall, damit bestehende Szenarien weiterlaufen. */
export const LEGACY_MAKE_WEBHOOK = "https://hook.eu1.make.com/pb4ym0nehyg8xdj8l6sobvyr0jwldhkt";

export type StoredMakeConfig = { url?: string | null; token?: string | null; platforms?: string[] | null; updatedAt?: string; updatedBy?: string };
export type Source = "admin" | "env" | "legacy" | null;

/** Nur https-Adressen; gibt die normalisierte URL zurück oder null. */
export function cleanHookUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 500) return null;
  try { const u = new URL(s); return u.protocol === "https:" ? u.href : null; } catch { return null; }
}

/** true für Make.com-Webhook-Hosts (z. B. hook.eu1.make.com). Nur diese erlaubt die Content-Security-Policy (connect-src https://*.make.com). */
export function isMakeHost(url: string | null): boolean {
  if (!url) return false;
  try { return /\.make\.com$/i.test(new URL(url).hostname); } catch { return false; }
}

export function cleanToken(raw: unknown): string | null {
  const s = String(raw ?? "").trim().slice(0, 200);
  return s && /^[\x21-\x7e]+$/.test(s) ? s : null;
}

export function cleanPlatforms(raw: unknown): MakePlatform[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,;]+/);
  const set = new Set(list.map((p) => String(p).trim().toLowerCase()));
  return MAKE_PLATFORMS.filter((p) => set.has(p));
}

/** Wirksame Konfiguration aus gespeichertem Admin-Wert und Umgebungsvariablen. */
export function resolveMakeConfig(stored: StoredMakeConfig | null, env: Record<string, string | undefined>) {
  const adminUrl = cleanHookUrl(stored?.url);
  const envUrl = cleanHookUrl(env.MAKE_WEBHOOK_URL);
  const envUrlInvalid = Boolean(String(env.MAKE_WEBHOOK_URL ?? "").trim()) && !envUrl;
  // Ein in der Admin-Zentrale bewusst geleertes Feld ("" gespeichert) schaltet den Versand ab.
  const adminCleared = stored != null && stored.url === "";
  const url = adminUrl ?? (adminCleared ? null : envUrl ?? LEGACY_MAKE_WEBHOOK);
  const urlSource: Source = adminUrl ? "admin" : adminCleared ? null : envUrl ? "env" : "legacy";
  const adminToken = cleanToken(stored?.token);
  const envToken = cleanToken(env.MAKE_WEBHOOK_TOKEN);
  const token = adminToken ?? envToken;
  const tokenSource: Source = adminToken ? "admin" : envToken ? "env" : null;
  const fromStore = stored?.platforms ? cleanPlatforms(stored.platforms) : null;
  const fromEnv = env.MAKE_PLATFORMS ? cleanPlatforms(env.MAKE_PLATFORMS) : null;
  const platforms = fromStore?.length ? fromStore : fromEnv?.length ? fromEnv : [...MAKE_PLATFORMS];
  const warnings: string[] = [];
  if (envUrlInvalid) warnings.push("MAKE_WEBHOOK_URL ist gesetzt, aber keine gültige https-Adresse – wird ignoriert.");
  if (urlSource === "legacy") warnings.push("Es wird noch die alte, im öffentlichen Code hinterlegte Webhook-URL benutzt. Bitte eigene URL in der Admin-Zentrale oder als MAKE_WEBHOOK_URL setzen.");
  if (url && !isMakeHost(url)) warnings.push("Die Webhook-URL zeigt nicht auf *.make.com – der Browser blockiert solche Ziele (Content-Security-Policy). Bitte die Adresse aus dem Make-Webhook-Modul verwenden.");
  if (url && !token) warnings.push("Kein Sicherheits-Token hinterlegt: Jeder, der die Webhook-URL kennt, könnte dem Szenario Daten schicken.");
  return { url, urlSource, token, tokenSource, platforms, warnings, updatedAt: stored?.updatedAt ?? null };
}

export type DeliveryReport = {
  at: string; ok: boolean; test: boolean; episode: number | null; uploadId: string | null;
  status: number | null; sizeMb: number | null; message: string;
};

/** Rückmeldung aus dem Browser säubern (nie URLs/Token speichern). */
export function cleanReport(b: Record<string, any>, now = new Date()): DeliveryReport {
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    at: now.toISOString(),
    ok: b.ok === true,
    test: b.test === true,
    episode: num(b.episode) != null ? Math.max(0, Math.min(99, Math.trunc(num(b.episode)!))) : null,
    uploadId: b.uploadId ? String(b.uploadId).replace(/[^\w.-]/g, "").slice(0, 60) : null,
    status: num(b.status) != null ? Math.trunc(num(b.status)!) : null,
    sizeMb: num(b.sizeMb) != null ? Math.round(num(b.sizeMb)! * 10) / 10 : null,
    message: String(b.message ?? "").replace(/https?:\/\/\S+/g, "[URL]").slice(0, 240),
  };
}
