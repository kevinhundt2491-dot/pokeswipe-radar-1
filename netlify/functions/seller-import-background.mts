// Phase 7: Händler-Bestands-Import im Hintergrund (bis 15 Minuten, setzt sehr große Dateien selbst fort).
// Gestartet von POST /api/seller/import mit einem einmaligen Token (nur dessen Hash steht in seller_imports).
import type { Config } from "@netlify/functions";
import { processImport } from "../../server/seller-import.ts";
import { flushLogs } from "../../server/log.ts";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let data: any = null;
  try { data = await req.json(); } catch { return; }
  const importId = Number(data?.importId);
  const token = typeof data?.token === "string" ? data.token : "";
  if (!Number.isInteger(importId) || importId <= 0 || !/^[0-9a-f]{48}$/.test(token)) return;
  await processImport(importId, token, process.env.URL || new URL(req.url).origin);
  await flushLogs();
};

export const config: Config = { background: true };
