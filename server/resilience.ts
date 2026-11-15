// PokeSwipe & Radar – Ausfallsicherheit für externe Quellen und geplante Jobs:
//  • resilientFetch: Timeout, Wiederholungen mit Backoff + Jitter (Netzwerkfehler, 429, 5xx, Retry-After), Gesamtfrist
//  • Circuit Breaker je Quelle (Tabelle job_circuits) mit kurzem In-Memory-Cache – keine DB-Abfrage pro Anfrage
//  • runJob: hartes Zeitbudget, Laufprotokoll (job_runs) und Admin-Alarm nach drei Fehlläufen in Folge
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { db, jobCircuits, jobRuns } from "../db/index.ts";
import { log, logError, flushLogs } from "./log.ts";
import {
  retryDelay, isRetryableStatus, isSourceFailure, canRetry, circuitPhase, circuitOnFailure, circuitOnSuccess,
  successNeedsWrite, createDeadline, jobStatus, shouldAlert, emptyCircuit,
  type CircuitState, type BreakerOpts, type Deadline, type JobStatus,
} from "./resilience-logic.ts";

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (ms <= 0) return resolve();
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
});

// ---------------------------------------------------------------------------
// Job-Kontext (AsyncLocalStorage): Frist & Abbruchsignal erreichen jeden resilientFetch im Job automatisch
// ---------------------------------------------------------------------------
export type JobContext = Deadline & {
  name: string;
  signal: AbortSignal;
  /** Lauf als Teilergebnis markieren (z. B. Schleife wegen Zeitbudget beendet) */
  markPartial: (reason: string) => void;
  /** Lauf als übersprungen markieren (z. B. Dienst nicht eingerichtet) */
  skip: (reason: string) => void;
  notes: string[];
};
const jobStore = new AsyncLocalStorage<JobContext>();

/** Kontext des laufenden Jobs (undefined außerhalb von runJob, z. B. bei normalen API-Anfragen). */
export const currentJob = () => jobStore.getStore();

/** Markiert den laufenden Job als Teilergebnis (wirkungslos außerhalb eines Jobs). */
export function markPartial(reason: string) {
  currentJob()?.markPartial(reason);
}

// ---------------------------------------------------------------------------
// Circuit Breaker (DB + In-Memory-Cache)
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 15_000;
/** Probeversuch im Half-Open-Zustand: so lange gilt die Quelle für andere Instanzen weiter als gesperrt */
const TRIAL_MS = 30_000;
const circuits = new Map<string, CircuitState>();
let circuitsLoadedAt = 0;
let loading: Promise<void> | null = null;
const trials = new Set<string>();

export class CircuitOpenError extends Error {
  source: string;
  until: number | null;
  constructor(source: string, until: number | null) {
    super(`Quelle ${source} vorübergehend gesperrt (Circuit offen)`);
    this.name = "CircuitOpenError";
    this.source = source;
    this.until = until;
  }
}

const toState = (r: any): CircuitState => ({
  failures: Number(r.failures) || 0,
  openUntil: r.openUntil ? new Date(r.openUntil).getTime() : null,
  lastError: String(r.lastError || ""),
  lastSuccessAt: r.lastSuccessAt ? new Date(r.lastSuccessAt).getTime() : null,
});

/** Lädt alle Circuits auf einmal (kleine Tabelle) – höchstens alle 15 s pro Instanz. */
async function loadCircuits(force = false) {
  if (!force && Date.now() - circuitsLoadedAt < CACHE_TTL_MS) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const list = await db.select().from(jobCircuits);
      circuits.clear();
      for (const r of list) circuits.set(r.name, toState(r));
    } catch (e) {
      log.warn("circuit", "Circuit-Zustände nicht geladen", { err: e });
    } finally {
      circuitsLoadedAt = Date.now();
      loading = null;
    }
  })();
  return loading;
}

export async function circuitState(name: string): Promise<CircuitState> {
  await loadCircuits();
  return circuits.get(name) ?? emptyCircuit();
}

/**
 * Darf eine Anfrage an die Quelle gehen? Wirft CircuitOpenError, wenn gesperrt. Im Half-Open-Zustand
 * gewinnt genau eine Instanz den Probeversuch (atomares Verschieben von open_until in der DB).
 */
async function acquire(name: string) {
  const s = await circuitState(name);
  const phase = circuitPhase(s);
  if (phase === "closed") return;
  if (phase === "open" || trials.has(name)) throw new CircuitOpenError(name, s.openUntil);
  // half-open: Probeversuch beanspruchen
  try {
    const claimed = rowsOf(await db.execute(sql`
      UPDATE job_circuits SET open_until = now() + make_interval(secs => ${TRIAL_MS / 1000}), updated_at = now()
      WHERE name = ${name} AND open_until IS NOT NULL AND open_until <= now()
      RETURNING name`));
    if (!claimed.length) {
      await loadCircuits(true);
      const again = circuits.get(name) ?? emptyCircuit();
      if (circuitPhase(again) !== "closed") throw new CircuitOpenError(name, again.openUntil);
      return;
    }
  } catch (e) {
    if (e instanceof CircuitOpenError) throw e;
    // DB nicht erreichbar: lokal entscheiden (nur ein Probeversuch je Instanz)
  }
  circuits.set(name, { ...s, openUntil: Date.now() + TRIAL_MS });
  trials.add(name);
}

async function recordSuccess(name: string) {
  trials.delete(name);
  const s = circuits.get(name) ?? emptyCircuit();
  if (!successNeedsWrite(s)) return;
  circuits.set(name, circuitOnSuccess(s));
  try {
    await db.insert(jobCircuits).values({ name, failures: 0, openUntil: null, lastSuccessAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({ target: jobCircuits.name, set: { failures: 0, openUntil: null, lastSuccessAt: new Date(), updatedAt: new Date() } });
  } catch (e) {
    log.warn("circuit", "Circuit-Erfolg nicht gespeichert", { name, err: e });
  }
}

async function recordFailure(name: string, error: string, opts: BreakerOpts) {
  trials.delete(name);
  const local = circuits.get(name) ?? emptyCircuit();
  let failures = local.failures + 1;
  try {
    // Fehlerzähler atomar hochzählen (mehrere Instanzen gleichzeitig), danach Sperre aus der reinen Logik berechnen
    const [row] = rowsOf(await db.execute(sql`
      INSERT INTO job_circuits (name, failures, last_error, updated_at) VALUES (${name}, 1, ${error.slice(0, 300)}, now())
      ON CONFLICT (name) DO UPDATE SET failures = job_circuits.failures + 1, last_error = EXCLUDED.last_error, updated_at = now()
      RETURNING failures`));
    if (row?.failures != null) failures = Number(row.failures);
  } catch (e) {
    log.warn("circuit", "Circuit-Fehler nicht gespeichert", { name, err: e });
  }
  const next = circuitOnFailure({ ...local, failures: failures - 1 }, error, Date.now(), opts);
  circuits.set(name, next);
  if (next.openUntil !== null) {
    log.warn("circuit", "Circuit geöffnet", { name, failures: next.failures, openForMs: next.openUntil - Date.now(), error });
    try {
      await db.execute(sql`UPDATE job_circuits SET open_until = ${new Date(next.openUntil)}, updated_at = now() WHERE name = ${name}`);
    } catch (e) {
      log.warn("circuit", "Circuit-Sperre nicht gespeichert", { name, err: e });
    }
  }
}

/** Alle Circuits für die Admin-Zentrale (direkt aus der DB). */
export async function listCircuits() {
  const list = await db.select().from(jobCircuits);
  return list.map((r) => ({ ...r, phase: circuitPhase(toState(r)) }));
}

// ---------------------------------------------------------------------------
// resilientFetch
// ---------------------------------------------------------------------------
export type ResilientOpts = BreakerOpts & {
  /** Timeout je Versuch (ms) */
  timeoutMs?: number;
  /** maximale Anzahl Versuche (inkl. erstem) */
  attempts?: number;
  /** Gesamtfrist für alle Versuche (ms ab Start, Standard timeoutMs + 4 s); zusätzlich gilt die Frist des laufenden Jobs */
  totalMs?: number;
  baseMs?: number;
  capMs?: number;
  /** Circuit Breaker verwenden (Standard: ja) */
  breaker?: boolean;
};

/**
 * fetch mit Timeout, Wiederholungen (Netzwerkfehler, 408/429/5xx; Retry-After wird beachtet), Gesamtfrist und
 * Circuit Breaker je Quelle. Liefert die letzte Antwort (auch 4xx/5xx – Statusprüfung bleibt beim Aufrufer);
 * wirft bei Netzwerkfehlern nach dem letzten Versuch und CircuitOpenError bei gesperrter Quelle.
 */
export async function resilientFetch(source: string, url: string, init: RequestInit = {}, opts: ResilientOpts = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const attempts = Math.max(1, opts.attempts ?? 3);
  const breakerOpts: BreakerOpts = { threshold: opts.threshold, baseCooldownMs: opts.baseCooldownMs, maxCooldownMs: opts.maxCooldownMs };
  for (const k of Object.keys(breakerOpts) as (keyof BreakerOpts)[]) if (breakerOpts[k] === undefined) delete breakerOpts[k];
  const useBreaker = opts.breaker !== false;
  const job = currentJob();
  const started = Date.now();
  // Standard-Gesamtfrist: ein voller Versuch plus Luft für schnelle Wiederholungen (z. B. nach 503/Verbindungsabbruch)
  const deadlineAt = Math.min(started + (opts.totalMs ?? timeoutMs + 4000), job ? job.at : Infinity);

  if (useBreaker) {
    try {
      await acquire(source);
    } catch (e) {
      if (e instanceof CircuitOpenError) job?.markPartial(`Circuit offen: ${source}`);
      throw e;
    }
  }

  let lastErr: unknown = null;
  for (let attempt = 1; ; attempt++) {
    const left = deadlineAt - Date.now();
    if (left <= 0) {
      lastErr = lastErr ?? new Error(`Frist für ${source} abgelaufen`);
      break;
    }
    const signals = [AbortSignal.timeout(Math.min(timeoutMs, left))];
    if (init.signal) signals.push(init.signal);
    if (job) signals.push(job.signal);
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
      if (isRetryableStatus(res.status)) {
        const delay = retryDelay(attempt, res.headers.get("retry-after"), { baseMs: opts.baseMs, capMs: opts.capMs });
        if (canRetry(attempt, attempts, delay, deadlineAt)) {
          try { await res.body?.cancel(); } catch {}
          await sleep(delay, job?.signal);
          continue;
        }
      }
      if (useBreaker) {
        if (isSourceFailure(res.status)) await recordFailure(source, `HTTP ${res.status}`, breakerOpts);
        else await recordSuccess(source);
      }
      return res;
    } catch (e: any) {
      lastErr = e;
      // Abbruch durch Aufrufer oder Jobende: nicht wiederholen, Quelle nicht als ausgefallen werten
      if (init.signal?.aborted || job?.signal.aborted) {
        trials.delete(source);
        throw e;
      }
      const delay = retryDelay(attempt, null, { baseMs: opts.baseMs, capMs: opts.capMs });
      if (canRetry(attempt, attempts, delay, deadlineAt)) {
        await sleep(delay, job?.signal);
        continue;
      }
      break;
    }
  }
  const msg = String((lastErr as any)?.name === "TimeoutError" ? "Timeout" : (lastErr as any)?.message || lastErr).slice(0, 300);
  if (useBreaker) await recordFailure(source, msg, breakerOpts);
  throw lastErr instanceof Error ? lastErr : new Error(msg);
}

// ---------------------------------------------------------------------------
// runJob
// ---------------------------------------------------------------------------
const ALERT_COOLDOWN_MS = 6 * 3600_000;

export type JobResult<T> = { status: JobStatus; durationMs: number; result?: T; error?: string; notes: string[] };

function detailText(status: JobStatus, result: unknown, error: string | undefined, notes: string[]) {
  const parts: string[] = [];
  if (error) parts.push(error);
  if (notes.length) parts.push([...new Set(notes)].join("; "));
  if (result !== undefined && status !== "error") {
    try { parts.push(JSON.stringify(result)); } catch {}
  }
  return parts.join(" | ").slice(0, 2000);
}

function adminEmails() {
  return [...new Set(String(process.env.ADMIN_EMAILS || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** Nach drei Fehlläufen in Folge: Admins benachrichtigen (höchstens alle 6 h je Job, gemerkt in error_log). */
async function maybeAlert(name: string, error: string) {
  const recent = rowsOf(await db.execute(sql`SELECT status FROM job_runs WHERE job = ${name} ORDER BY started_at DESC LIMIT 3`)).map((r) => String(r.status));
  const [last] = rowsOf(await db.execute(sql`SELECT max(created_at) AS at FROM error_log WHERE scope = ${`alert:${name}`}`));
  const lastAlertAt = last?.at ? new Date(last.at).getTime() : null;
  if (!shouldAlert(recent, lastAlertAt, Date.now(), { cooldownMs: ALERT_COOLDOWN_MS })) return false;
  const emails = adminEmails();
  // Erst den Alarm vermerken (verhindert Doppel-Alarme paralleler Instanzen weitgehend), dann benachrichtigen
  await db.execute(sql`INSERT INTO error_log (scope, message, context) VALUES (${`alert:${name}`}, ${`Job ${name}: 3 Fehlläufe in Folge`}, ${JSON.stringify({ error, admins: emails.length })}::jsonb)`);
  if (!emails.length) {
    log.warn("job", "Job-Alarm ohne Empfänger (ADMIN_EMAILS leer)", { job: name });
    return false;
  }
  const admins = rowsOf(await db.execute(sql`SELECT user_id FROM profiles WHERE lower(email) IN (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})`));
  const { notify } = await import("./prices.ts");
  for (const a of admins) {
    await notify(String(a.user_id), `⚠️ Job ${name} fällt aus`, `Die letzten 3 Läufe sind fehlgeschlagen: ${error}`.slice(0, 400), "/?tab=admin").catch((e) => logError("job", e, { job: name, alert: true }));
  }
  log.warn("job", "Admins über Job-Ausfall benachrichtigt", { job: name, admins: admins.length });
  return true;
}

/**
 * Führt einen geplanten Job mit hartem Zeitbudget aus. fn bekommt den Job-Kontext (Frist, Abbruchsignal,
 * markPartial/skip); jeder resilientFetch darin hält automatisch die Frist ein. Ergebnis landet in job_runs.
 * Wirft nie – Fehler werden protokolliert und als Status "error" gespeichert.
 */
export async function runJob<T>(name: string, budgetMs: number, fn: (job: JobContext) => Promise<T>): Promise<JobResult<T>> {
  const started = Date.now();
  const controller = new AbortController();
  const deadline = createDeadline(budgetMs);
  const notes: string[] = [];
  let partial = false, skipped = false;
  const job: JobContext = {
    ...deadline,
    name,
    signal: controller.signal,
    notes,
    markPartial: (reason) => { partial = true; if (notes.length < 20) notes.push(reason); },
    skip: (reason) => { skipped = true; if (notes.length < 20) notes.push(reason); },
  };

  let result: T | undefined;
  let error: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hardStop = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(new Error("Zeitbudget überschritten"));
        reject(new Error(`Zeitbudget von ${budgetMs} ms überschritten`));
      }, budgetMs);
    });
    result = await Promise.race([jobStore.run(job, () => fn(job)), hardStop]);
  } catch (e: any) {
    error = String(e?.message || e).slice(0, 500);
    logError(`job:${name}`, e, { durationMs: Date.now() - started });
  } finally {
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort(new Error("Job beendet"));
  }

  const status = jobStatus({ error, partial, skipped, result });
  const durationMs = Date.now() - started;
  const detail = detailText(status, result, error, notes);
  log[status === "error" ? "warn" : "info"]("job", `${name}: ${status}`, { job: name, status, durationMs, detail: detail.slice(0, 500) });
  try {
    await db.insert(jobRuns).values({ job: name, startedAt: new Date(started), durationMs, status, detail });
    if (status === "error") await maybeAlert(name, error || "unbekannter Fehler");
  } catch (e) {
    log.warn("job", "Job-Lauf nicht protokolliert", { job: name, err: e });
  }
  await flushLogs();
  return { status, durationMs, result, error, notes };
}

