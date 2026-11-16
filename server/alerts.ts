// Phase 8: Fehler-Alarm – Benachrichtigung der Admins (Mitteilung + Push, E-Mail über Resend, optional Webhook für
// Slack/Discord/Teams) und der Wächter-Lauf. Regeln in alerts-logic.ts.
//
// Empfänger: alle Profile, deren E-Mail in ADMIN_EMAILS steht. E-Mail geht an diese Adressen, sobald RESEND_API_KEY
// und MAIL_FROM gesetzt sind. ALERT_WEBHOOK_URL (optional, https) bekommt { text } als JSON – passt für Slack- und
// Discord-Webhooks („content“ wird zusätzlich mitgesendet).
import { sql } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { db } from "../db/index.ts";
import { rows, rateLimit, clientIp } from "./util.ts";
import { log, logError } from "./log.ts";
import {
  spikeAlerts, staleJobAlerts, webhookAlert, alertDue, cleanClientError, WATCH_WINDOW_MIN, type Alert, type ClientErrorInput,
} from "./alerts-logic.ts";

export function adminEmails() {
  return [...new Set(String(process.env.ADMIN_EMAILS || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

const BRAND = "PokeSwipe & Radar";
const SITE = () => (process.env.URL || "https://pokeswipe-radar.de").replace(/\/$/, "");

async function lastAlertAt(key: string): Promise<Date | null> {
  const [r] = rows(await db.execute(sql`SELECT max(created_at) AS at FROM error_log WHERE scope = ${`alert:${key}`.slice(0, 80)}`));
  return r?.at ? new Date(r.at) : null;
}

/**
 * Benachrichtigt alle Admins über alle Kanäle. Ruhezeit je Schlüssel (gemerkt im Fehlerprotokoll als „alert:<key>“).
 * force = ohne Ruhezeit (z. B. Testalarm). Wirft nie.
 */
export async function alertAdmins(a: Pick<Alert, "key" | "title" | "text"> & { cooldownMs?: number; link?: string; severity?: Alert["severity"] }, force = false) {
  try {
    const cooldown = a.cooldownMs ?? 3600_000;
    if (!force && !alertDue(await lastAlertAt(a.key), cooldown)) return { sent: false, reason: "cooldown" as const };
    const emails = adminEmails();
    // Erst vermerken (verhindert Doppel-Alarme paralleler Instanzen weitgehend), dann senden
    await db.execute(sql`INSERT INTO error_log (scope, message, context) VALUES (${`alert:${a.key}`.slice(0, 80)}, ${a.title.slice(0, 1000)}, ${JSON.stringify({ text: a.text, severity: a.severity || "warning", admins: emails.length })}::jsonb)`);
    const channels: string[] = [];
    if (emails.length) {
      const admins = rows(await db.execute(sql`SELECT user_id FROM profiles WHERE lower(email) IN (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})`));
      const { notify } = await import("./prices.ts");
      for (const ad of admins) await notify(String(ad.user_id), a.title.slice(0, 120), a.text.slice(0, 400), a.link || "/?tab=admin").catch((e) => logError("alert", e, { key: a.key }));
      if (admins.length) channels.push("push");
      const { sendMail, mailConfigured } = await import("./legal.ts");
      if (mailConfigured()) {
        let mailed = 0;
        for (const to of emails) {
          if (await sendMail(to, `[${BRAND}] ${a.title}`, `${a.title}\n\n${a.text}\n\nAdmin-Zentrale: ${SITE()}/?tab=admin\n\nDiese Nachricht kommt vom automatischen Betriebs-Wächter. Wiederholungen werden für ${Math.round(cooldown / 60_000)} Minuten unterdrückt.`)) mailed++;
        }
        if (mailed) channels.push("email");
      }
    }
    const hook = String(process.env.ALERT_WEBHOOK_URL || "").trim();
    if (/^https:\/\//.test(hook)) {
      const text = `${a.title}\n${a.text}`.slice(0, 1800);
      const r = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(6000) }).catch(() => null);
      if (r?.ok) channels.push("webhook");
    }
    if (!channels.length) log.warn("alert", "Alarm ohne zugestellten Kanal (ADMIN_EMAILS / RESEND_API_KEY / ALERT_WEBHOOK_URL prüfen)", { key: a.key });
    else log.warn("alert", a.title, { key: a.key, channels });
    return { sent: channels.length > 0, channels };
  } catch (e) {
    log.warn("alert", "Alarm konnte nicht gesendet werden", { key: a.key, err: e });
    return { sent: false, reason: "error" as const };
  }
}

/** Wächter-Lauf (alle 10 Minuten). Gibt die ausgelösten Alarme zurück. */
export async function runWatchdog() {
  const fired: string[] = [];
  const candidates: Alert[] = [];

  // 1. Fehler-Spitzen je Bereich
  const counts = rows(await db.execute(sql`
    SELECT scope, count(*)::int AS count, (array_agg(message ORDER BY created_at DESC))[1] AS last_message
    FROM error_log WHERE created_at > now() - make_interval(mins => ${WATCH_WINDOW_MIN}::int) AND scope NOT LIKE 'alert:%'
    GROUP BY scope`)).map((r: any) => ({ scope: String(r.scope), count: Number(r.count), lastMessage: String(r.last_message || "").slice(0, 200) }));
  candidates.push(...spikeAlerts(counts));

  // 2. Überfällige Jobs
  const jobs = rows(await db.execute(sql`SELECT DISTINCT ON (job) job, started_at, status FROM job_runs WHERE started_at > now() - interval '7 days' ORDER BY job, started_at DESC`))
    .map((r: any) => ({ name: String(r.job), lastRunAt: r.started_at, lastStatus: String(r.status) }));
  candidates.push(...staleJobAlerts(jobs));

  // 3. Stripe-Webhook
  try {
    const status = await getStore({ name: "app-config", consistency: "strong" }).get("stripe-webhook-status", { type: "json" }) as any;
    const w = webhookAlert(status);
    if (w) candidates.push(w);
  } catch (e) { log.warn("watchdog", "Webhook-Status nicht lesbar", { err: e }); }

  for (const a of candidates) {
    const r = await alertAdmins(a);
    if (r.sent) fired.push(a.key);
  }
  return { checkedScopes: counts.length, checkedJobs: jobs.length, candidates: candidates.length, fired };
}

export function registerAlerts(app: any, { auth, adminOnly, body }: { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> }) {
  // Browser-Fehler der App (ohne Login, stark gedrosselt). Landet im Fehlerprotokoll (Bereich "client").
  app.post("/api/client-errors", async (c: any) => {
    if (!(await rateLimit(`cerr:${clientIp(c)}`, 10, 60_000))) return c.body(null, 204);
    const e = cleanClientError(await body(c));
    if (!e) return c.body(null, 204);
    log.error("client", e.message, { kind: e.kind, url: e.url, line: e.line, col: e.col, release: e.release, stack: e.stack, ua: String(c.req.header("user-agent") || "").slice(0, 160) });
    return c.body(null, 204);
  });

  // Admin: Testalarm über alle Kanäle (ohne Ruhezeit)
  app.post("/api/admin/alerts/test", auth, adminOnly, async (c: any) => {
    const r = await alertAdmins({ key: "test", title: "✅ Testalarm", text: "Wenn du das liest, kommen Betriebs-Alarme bei dir an.", severity: "warning" }, true);
    return c.json({ ...r, emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM), webhookConfigured: /^https:\/\//.test(String(process.env.ALERT_WEBHOOK_URL || "")), admins: adminEmails().length });
  });

  // Admin: letzte Alarme
  app.get("/api/admin/alerts", auth, adminOnly, async (c: any) => {
    c.header("Cache-Control", "private, no-store");
    const list = rows(await db.execute(sql`SELECT id, scope, message, context, created_at FROM error_log WHERE scope LIKE 'alert:%' AND context ? 'text' ORDER BY created_at DESC LIMIT 50`));
    return c.json({
      alerts: list.map((r: any) => ({ id: Number(r.id), key: String(r.scope).slice(6), title: String(r.message), text: r.context?.text || "", severity: r.context?.severity || "warning", at: r.created_at })),
      channels: { push: adminEmails().length > 0, email: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM), webhook: /^https:\/\//.test(String(process.env.ALERT_WEBHOOK_URL || "")) },
    });
  });
}
