// Auto-Finder für öffentliche Creator-Geschäfts-E-Mails (Admin-Button „🔍 E-Mails für alle Creator automatisch finden“).
// POST /.netlify/functions/auto-find-creator-emails  { since?: ISO-Zeit des Gesamtlaufs, webSearch?: boolean }
// Jede Anfrage prüft ein paar Creator ohne E-Mail (Impressum/Linktree/Beacons/Website + Web-Suche, MX-geprüft) und meldet,
// wie viele noch offen sind – der Button ruft so lange erneut auf, bis alle durch sind.
import { Hono } from "hono";
import { authenticate, isAdmin } from "../../server/auth.ts";
import { runAutoFindBatch } from "../../server/creator-email-finder.ts";
import { rateLimit } from "../../server/util.ts";
import { flushLogs } from "../../server/log.ts";

const app = new Hono();

app.post("*", async (c) => {
  // CSRF-Schutz wie bei der API: nur JSON mit Bearer-Token
  if (!/application\/json/i.test(c.req.header("content-type") || "")) return c.json({ error: "Bitte als JSON senden." }, 415);
  const { user, unavailable } = await authenticate(c);
  if (!user && unavailable) return c.json({ error: "Anmeldedienst kurz nicht erreichbar – bitte gleich erneut versuchen.", retry: true }, 503);
  if (!user) return c.json({ error: "Bitte melde dich an." }, 401);
  if (!isAdmin(user)) return c.json({ error: "Nur für Admins." }, 403);
  if (!(await rateLimit(`auto-find-emails:${user.id}`, 40, 60_000))) return c.json({ error: "Bitte kurz warten." }, 429);
  let b: any = {};
  try { b = await c.req.json(); } catch {}
  const t = Date.parse(String(b?.since || ""));
  // Gesamtlauf höchstens 2 Stunden „zurück“ – so wird jeder Creator pro Lauf genau einmal geprüft
  const since = Number.isFinite(t) && t <= Date.now() && Date.now() - t < 2 * 3_600_000 ? new Date(t) : new Date();
  const r = await runAutoFindBatch({ since, budgetMs: 20_000, parallel: 3, webSearch: b?.webSearch !== false });
  await flushLogs().catch(() => {});
  c.header("Cache-Control", "no-store");
  return c.json({ ...r, since: since.toISOString() });
});

app.all("*", (c) => c.json({ error: "Method not allowed" }, 405));

export default (req: Request) => app.fetch(req);
