// PokeSwipe & Radar – strukturiertes Logging: eine JSON-Zeile pro Eintrag (stdout/stderr, in den Netlify-Logs durchsuchbar).
// Fehler landen zusätzlich (best effort, gedrosselt) in der Tabelle error_log und erscheinen in der Admin-Zentrale.
import { db, errorLog } from "../db/index.ts";

type Level = "info" | "warn" | "error";
type Ctx = Record<string, unknown> | Error | unknown;

const STACK_MAX = 2000;
const MSG_MAX = 1000;
/** Höchstens so viele DB-Einträge je Bereich und Minute und Instanz */
const PERSIST_PER_MINUTE = 30;

function serializeError(e: unknown) {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: String(e.message || "").slice(0, MSG_MAX),
      stack: e.stack ? String(e.stack).slice(0, STACK_MAX) : undefined,
      ...((e as any).status ? { status: (e as any).status } : {}),
      ...((e as any).code ? { code: String((e as any).code).slice(0, 80) } : {}),
    };
  }
  return { name: "NonError", message: String(e ?? "").slice(0, MSG_MAX) };
}

/** Kontext JSON-tauglich machen: Fehler zerlegen, lange Texte kürzen, Tiefe begrenzen. */
function clean(v: unknown, depth = 0): unknown {
  if (v instanceof Error) return serializeError(v);
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return v.length > MSG_MAX ? `${v.slice(0, MSG_MAX)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (depth >= 4) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
      if (typeof x === "function") continue;
      out[k] = clean(x, depth + 1);
    }
    return out;
  }
  return String(v);
}

/** Trennt ein mitgegebenes Fehlerobjekt (ctx.err / ctx.error / ctx selbst) vom übrigen Kontext. */
function split(ctx: Ctx): { err?: unknown; rest?: Record<string, unknown> } {
  if (ctx === undefined || ctx === null) return {};
  if (ctx instanceof Error) return { err: ctx };
  if (typeof ctx !== "object" || Array.isArray(ctx)) return { rest: { value: ctx } };
  const { err, error, ...rest } = ctx as Record<string, unknown>;
  const e = err ?? (error instanceof Error ? error : undefined);
  if (error !== undefined && !(error instanceof Error)) (rest as any).error = error;
  return { err: e, rest: Object.keys(rest).length ? rest : undefined };
}

const buckets = new Map<string, { start: number; count: number }>();
const pending = new Set<Promise<unknown>>();

function allowPersist(scope: string, now = Date.now()) {
  const b = buckets.get(scope);
  if (!b || now - b.start >= 60_000) {
    if (buckets.size > 500) buckets.clear();
    buckets.set(scope, { start: now, count: 1 });
    return true;
  }
  if (b.count >= PERSIST_PER_MINUTE) return false;
  b.count++;
  return true;
}

function persist(scope: string, message: string, context: unknown) {
  if (!allowPersist(scope)) return;
  try {
    const p: Promise<unknown> = Promise.resolve(db.insert(errorLog).values({ scope: scope.slice(0, 80), message: message.slice(0, MSG_MAX), context: context as any }))
      .catch((e) => {
        // niemals werfen – nur auf stderr vermerken (ohne erneuten DB-Versuch)
        process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: "warn", scope: "log", msg: "Fehlerprotokoll nicht gespeichert", err: serializeError(e) }) + "\n");
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  } catch {
    // DB nicht verfügbar (z. B. lokal ohne Datenbank) – nur Konsolen-Log
  }
}

function write(level: Level, scope: string, msg: string, ctx?: Ctx) {
  const { err, rest } = split(ctx);
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, scope, msg: String(msg).slice(0, MSG_MAX) };
  const cleanCtx = rest ? clean(rest) : undefined;
  if (cleanCtx !== undefined) entry.ctx = cleanCtx;
  if (err !== undefined) entry.err = serializeError(err);
  let line: string;
  try { line = JSON.stringify(entry); } catch { line = JSON.stringify({ ts: entry.ts, level, scope, msg: entry.msg }); }
  try {
    (level === "info" ? process.stdout : process.stderr).write(line + "\n");
  } catch {}
  if (level === "error") persist(scope, String(entry.msg), { ...(cleanCtx ? { ctx: cleanCtx } : {}), ...(entry.err ? { err: entry.err } : {}) });
}

export const log = {
  info: (scope: string, message: string, context?: Ctx) => write("info", scope, message, context),
  warn: (scope: string, message: string, context?: Ctx) => write("warn", scope, message, context),
  error: (scope: string, message: string, context?: Ctx) => write("error", scope, message, context),
};

/** Fehler mit Bereich protokollieren; die Meldung wird aus dem Fehler übernommen. */
export function logError(scope: string, err: unknown, ctx?: Record<string, unknown>) {
  const message = err instanceof Error ? err.message || err.name : String(err ?? "Unbekannter Fehler");
  write("error", scope, message, { ...(ctx || {}), err });
}

/** Führt fn aus und protokolliert Laufzeit (info) bzw. Fehler (error, danach weitergeworfen). */
export async function withTiming<T>(scope: string, fn: () => Promise<T> | T, ctx?: Record<string, unknown>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    write("info", scope, "fertig", { ...(ctx || {}), durationMs: Date.now() - started });
    return result;
  } catch (e) {
    write("error", scope, e instanceof Error ? e.message || e.name : String(e), { ...(ctx || {}), durationMs: Date.now() - started, err: e });
    throw e;
  }
}

/** Wartet (max. timeoutMs) auf noch laufende Speicherungen – am Ende geplanter Funktionen aufrufen. */
export async function flushLogs(timeoutMs = 2000) {
  if (!pending.size) return;
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, timeoutMs).unref?.())]);
}
