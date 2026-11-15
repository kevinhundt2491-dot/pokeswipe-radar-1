import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { runGrowthJobs } from "../../server/growth.ts";
import { runSubmissionReminders } from "../../server/drops.ts";
import { runJob } from "../../server/resilience.ts";
import { logError } from "../../server/log.ts";

// Stündlich: Kalender-Erinnerungen (Releases & Events), überfällige Grading-Einsendungen, montags der Wochen-Report
// und das Aufräumen der Betriebsprotokolle (Fehlerprotokoll & Job-Läufe älter als 30 Tage).
export default async () => {
  await runJob("growth-jobs", 25_000, async (job) => {
    let growthError: unknown = null;
    const growth = await runGrowthJobs({ deadlineMs: Math.min(20_000, job.remaining() - 4000) })
      .catch((e) => { growthError = e; logError("growth-jobs", e, { step: "Wachstums-Jobs" }); return null; });
    const submissionReminders = await runSubmissionReminders().catch((e) => { logError("growth-jobs", e, { step: "Einsendungs-Erinnerungen" }); return 0; });
    const retention = { errorLog: 0, jobRuns: 0, rateLimits: 0 };
    try {
      const a: any = await db.execute(sql`DELETE FROM error_log WHERE created_at < now() - interval '30 days'`);
      const b: any = await db.execute(sql`DELETE FROM job_runs WHERE started_at < now() - interval '30 days'`);
      retention.errorLog = Number(a?.rowCount ?? 0);
      retention.jobRuns = Number(b?.rowCount ?? 0);
      // Verteiltes Rate-Limiting: abgelaufene Zähler entfernen
      const r: any = await db.execute(sql`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'`);
      retention.rateLimits = Number(r?.rowCount ?? 0);
    } catch (e) {
      logError("growth-jobs", e, { step: "Aufräumen" });
    }
    // Hauptschritt fehlgeschlagen → Lauf als Fehler protokollieren (Erinnerungen & Aufräumen sind trotzdem gelaufen)
    if (growthError) throw growthError;
    return { ...(growth || {}), submissionReminders, retention };
  });
};

export const config: Config = {
  schedule: "15 * * * *",
};
