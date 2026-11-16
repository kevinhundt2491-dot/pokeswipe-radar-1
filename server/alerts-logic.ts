// Phase 8: Fehler-Alarm – reine Regeln (ohne Datenbank), in tests/alerts.test.ts geprüft.
//
// Der Wächter (netlify/functions/ops-watchdog.mts, alle 10 Minuten) wertet aus:
//  • Fehler-Spitzen je Bereich im Fehlerprotokoll (letzte 15 Minuten)
//  • zahlungskritische Bereiche (Stripe-Webhook, Abo, Marktplatz, Warenkorb, Etiketten): schon ein Fehler löst aus
//  • Browser-Fehler der App (Bereich "client") ab einer Häufung
//  • Jobs, die überfällig sind (letzter Lauf älter als das Dreifache ihres Takts) oder deren letzter Lauf fehlschlug
//  • Stripe-Webhook: letzter Zustellfehler neuer als die letzte erfolgreiche Zustellung
// Jeder Alarm hat einen Schlüssel und eine Ruhezeit, damit Admins nicht mit Wiederholungen überflutet werden.

export const WATCH_WINDOW_MIN = 15;

/** Bereiche, in denen schon ein einzelner Fehler sofort gemeldet wird (Geld oder Pflichten betroffen). */
export const CRITICAL_SCOPES = /^(stripe-webhook|billing|market|cart|comps|dac7|shipping|cancellation|legal)/;

/** Schwellen: so viele Fehler im Fenster lösen einen Alarm aus */
export const SPIKE_THRESHOLDS: Array<{ re: RegExp; min: number }> = [
  { re: CRITICAL_SCOPES, min: 1 },
  { re: /^client$/, min: 25 },
  { re: /.*/, min: 10 },
];

/** Bereiche, die nie als Spitze zählen (eigene Alarm-Vermerke, Logging selbst; Job-Fehler meldet runJob nach 3 Fehlläufen) */
const IGNORED_SCOPES = /^(alert:|log$|job:)/;

export function thresholdFor(scope: string) {
  return (SPIKE_THRESHOLDS.find((t) => t.re.test(scope)) ?? { min: 10 }).min;
}

export type ScopeCount = { scope: string; count: number; lastMessage: string };
export type Alert = { key: string; title: string; text: string; cooldownMs: number; severity: "critical" | "warning" };

const HOUR = 3600_000;

export function spikeAlerts(counts: ScopeCount[]): Alert[] {
  const out: Alert[] = [];
  for (const c of counts) {
    if (IGNORED_SCOPES.test(c.scope)) continue;
    const min = thresholdFor(c.scope);
    if (c.count < min) continue;
    const critical = CRITICAL_SCOPES.test(c.scope);
    out.push({
      key: `spike:${c.scope}`,
      title: critical ? `🚨 Fehler im Bereich ${c.scope}` : `⚠️ Fehlerhäufung: ${c.scope}`,
      text: `${c.count} Fehler in den letzten ${WATCH_WINDOW_MIN} Minuten. Zuletzt: ${c.lastMessage}`.slice(0, 400),
      cooldownMs: critical ? HOUR : 3 * HOUR,
      severity: critical ? "critical" : "warning",
    });
  }
  return out;
}

/** Takt der geplanten Jobs in Minuten (wie in netlify/functions/*.mts) */
export const JOB_INTERVAL_MIN: Record<string, number> = {
  "restock-radar": 2, "catalog-import": 10, "catalog-intl-import": 10, "scan-hash-index": 10, "flip-radar-sync": 10,
  "price-tracker": 60, "update-sealed-prices": 180, "growth-jobs": 60, "market-escrow": 15, "ops-watchdog": 10,
};

export type JobState = { name: string; lastRunAt: Date | string | null; lastStatus: string | null };

/** Überfällige Jobs: letzter Lauf älter als 3× Takt (mind. 30 Minuten Puffer). Ohne jeden Lauf: kein Alarm (neu). */
export function staleJobAlerts(jobs: JobState[], now = Date.now()): Alert[] {
  const out: Alert[] = [];
  for (const j of jobs) {
    const interval = JOB_INTERVAL_MIN[j.name];
    if (!interval || !j.lastRunAt || j.name === "ops-watchdog") continue;
    const ageMin = (now - new Date(j.lastRunAt).getTime()) / 60_000;
    const limit = Math.max(30, interval * 3);
    if (ageMin > limit) {
      out.push({
        key: `stale:${j.name}`, title: `⏱️ Job ${j.name} läuft nicht mehr`,
        text: `Letzter Lauf vor ${Math.round(ageMin)} Minuten (Takt: alle ${interval} Minuten). Bitte Netlify-Funktionsprotokolle prüfen.`,
        cooldownMs: 6 * HOUR, severity: interval <= 15 ? "critical" : "warning",
      });
    }
  }
  return out;
}

export type WebhookState = { lastEventAt: string | null; lastErrorAt: string | null; lastError: string | null };

/** Stripe-Webhook: Fehler neuer als die letzte erfolgreiche Zustellung (innerhalb der letzten 24 h). */
export function webhookAlert(s: WebhookState | null, now = Date.now()): Alert | null {
  if (!s?.lastErrorAt) return null;
  const errAt = new Date(s.lastErrorAt).getTime();
  if (now - errAt > 24 * HOUR) return null;
  if (s.lastEventAt && new Date(s.lastEventAt).getTime() > errAt) return null;
  return {
    key: "webhook:stripe", title: "🚨 Stripe-Webhook schlägt fehl",
    text: `Letzter Fehler ${new Date(errAt).toISOString().slice(0, 16).replace("T", " ")} UTC: ${s.lastError || "unbekannt"}. Stripe wiederholt die Zustellung; bitte Admin-Zentrale → Integrationen prüfen.`.slice(0, 400),
    cooldownMs: 2 * HOUR, severity: "critical",
  };
}

/** Darf ein Alarm mit diesem Schlüssel jetzt (wieder) gesendet werden? */
export const alertDue = (lastSentAt: Date | string | null | undefined, cooldownMs: number, now = Date.now()) =>
  !lastSentAt || now - new Date(lastSentAt).getTime() >= cooldownMs;

// ---------------------------------------------------------------------------
// Browser-Fehlerberichte der App
// ---------------------------------------------------------------------------
export type ClientErrorInput = { message?: unknown; stack?: unknown; url?: unknown; line?: unknown; col?: unknown; kind?: unknown; release?: unknown };

/** Bekanntes Rauschen (Browser-Erweiterungen, abgebrochene Ladevorgänge, ResizeObserver) – nicht speichern */
const CLIENT_NOISE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|safari-extension:|Non-Error promise rejection captured|AbortError|The user aborted a request|Load failed$|NetworkError when attempting to fetch|Failed to fetch$/i;

export function cleanClientError(b: ClientErrorInput): { message: string; stack: string; url: string; line: number; col: number; kind: string; release: string } | null {
  const message = String(b.message ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500);
  if (!message || CLIENT_NOISE.test(message)) return null;
  const stack = String(b.stack ?? "").slice(0, 2000);
  if (/chrome-extension:|moz-extension:|safari-extension:/.test(stack)) return null;
  let url = String(b.url ?? "").slice(0, 300);
  // Keine Query-Parameter speichern (können Tokens/E-Mails enthalten)
  try { const u = new URL(url); url = `${u.origin}${u.pathname}`; } catch { url = url.split("?")[0]; }
  const kind = ["error", "unhandledrejection", "api"].includes(String(b.kind)) ? String(b.kind) : "error";
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(10_000_000, Math.round(Number(v)))) : 0);
  return { message, stack, url, line: num(b.line), col: num(b.col), kind, release: String(b.release ?? "").slice(0, 40) };
}
