// PokeSwipe & Radar – Betrieb: Übersicht der geplanten Jobs (letzte Läufe), Circuit-Breaker-Zustände der
// externen Quellen und die letzten Einträge des Fehlerprotokolls – nur für Admins.
import { desc, sql } from "drizzle-orm";
import { db, errorLog } from "../db/index.ts";
import { listCircuits } from "./resilience.ts";
import { rows } from "./util.ts";

/** Alle geplanten Jobs (Namen wie in runJob verwendet) – auch ohne bisherigen Lauf in der Übersicht. */
export const SCHEDULED_JOBS = [
  "restock-radar", "catalog-import", "catalog-intl-import", "scan-hash-index", "flip-radar-sync",
  "price-tracker", "update-sealed-prices", "growth-jobs", "market-escrow", "ops-watchdog", "billing-reconcile",
] as const;

export async function jobsOverview() {
  // Je Job die letzten 10 Läufe plus Kennzahlen der letzten 24 h
  const recent = rows(await db.execute(sql`
    SELECT job, started_at, duration_ms, status, detail FROM (
      SELECT r.*, row_number() OVER (PARTITION BY job ORDER BY started_at DESC) AS rn FROM job_runs r
      WHERE started_at > now() - interval '30 days'
    ) x WHERE rn <= 10 ORDER BY job, started_at DESC`));
  const stats = rows(await db.execute(sql`
    SELECT job, count(*)::int AS runs,
      count(*) FILTER (WHERE status = 'error')::int AS errors,
      count(*) FILTER (WHERE status = 'partial')::int AS partial,
      round(avg(duration_ms))::int AS avg_ms, max(duration_ms)::int AS max_ms
    FROM job_runs WHERE started_at > now() - interval '24 hours' GROUP BY job`));
  const names = [...new Set([...SCHEDULED_JOBS, ...recent.map((r: any) => String(r.job))])];
  const jobs = names.map((name) => {
    const runs = recent.filter((r: any) => r.job === name).map((r: any) => ({
      startedAt: r.started_at, durationMs: Number(r.duration_ms), status: String(r.status), detail: String(r.detail || ""),
    }));
    const s: any = stats.find((x: any) => x.job === name) || {};
    return {
      name,
      lastStatus: runs[0]?.status ?? null,
      lastRunAt: runs[0]?.startedAt ?? null,
      last24h: { runs: Number(s.runs || 0), errors: Number(s.errors || 0), partial: Number(s.partial || 0), avgMs: Number(s.avg_ms || 0), maxMs: Number(s.max_ms || 0) },
      runs,
    };
  });
  const circuits = (await listCircuits()).sort((a, b) => (a.phase === b.phase ? a.name.localeCompare(b.name) : a.phase === "closed" ? 1 : -1));
  const errors = await db.select().from(errorLog).orderBy(desc(errorLog.createdAt)).limit(50);
  return { jobs, circuits, errors, generatedAt: new Date().toISOString() };
}

export function registerOps(app: any, { auth, adminOnly }: { auth: any; adminOnly: any }) {
  app.get("/api/admin/jobs", auth, adminOnly, async (c: any) => {
    c.header("Cache-Control", "private, no-store");
    return c.json(await jobsOverview());
  });
}
