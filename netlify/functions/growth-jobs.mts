import type { Config } from "@netlify/functions";
import { runGrowthJobs } from "../../server/growth.ts";
import { runSubmissionReminders } from "../../server/drops.ts";

// Stündlich: Kalender-Erinnerungen (Releases & Events), überfällige Grading-Einsendungen und montags der Wochen-Report.
export default async () => {
  const result = await runGrowthJobs({ deadlineMs: 22_000 });
  const submissionReminders = await runSubmissionReminders().catch((e) => { console.warn("Einsendungs-Erinnerungen", e); return 0; });
  console.log("Wachstums-Jobs", { ...result, submissionReminders });
};

export const config: Config = {
  schedule: "15 * * * *",
};
