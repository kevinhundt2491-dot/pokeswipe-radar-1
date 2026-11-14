import type { Config } from "@netlify/functions";
import { runGrowthJobs } from "../../server/growth.ts";

// Stündlich: Kalender-Erinnerungen (Releases & Events) und montags der Wochen-Report.
export default async () => {
  const result = await runGrowthJobs({ deadlineMs: 22_000 });
  console.log("Wachstums-Jobs", result);
};

export const config: Config = {
  schedule: "15 * * * *",
};
