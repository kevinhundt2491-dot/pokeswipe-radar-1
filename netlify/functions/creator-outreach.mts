// Creator-Outreach-Warteschlange alle 5 Minuten abarbeiten: höchstens eine freigegebene, fällige Mail pro Lauf
// (Tageslimit 15, Mindestabstand zwischen Mails – siehe server/creator-logic.ts). Ohne RESEND_API_KEY/MAIL_FROM passiert nichts.
import type { Config } from "@netlify/functions";
import { processOutreachQueue } from "../../server/creator.ts";
import { mailConfigured } from "../../server/legal.ts";
import { runJob } from "../../server/resilience.ts";

export default async () => {
  const run = await runJob("creator-outreach", 20_000, async (job) => {
    if (!mailConfigured()) { job.skip("E-Mail-Versand nicht eingerichtet"); return null; }
    return processOutreachQueue();
  });
  return Response.json({ status: run.status, ...(run.result || {}), ...(run.error ? { error: run.error } : {}) });
};

export const config: Config = { schedule: "*/5 * * * *" };
