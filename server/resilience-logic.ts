// PokeSwipe & Radar – reine (testbare) Logik für Wiederholungen, Circuit Breaker und Zeitbudgets der Jobs.
// Keine Datenbank, kein Netzwerk: alles hier bekommt die aktuelle Zeit und den Zufall von außen.

// ---------------------------------------------------------------------------
// Wiederholungen (Backoff)
// ---------------------------------------------------------------------------
export type BackoffOpts = { baseMs?: number; capMs?: number };

/**
 * Wartezeit vor Versuch Nr. attempt+1 (attempt beginnt bei 1): exponentiell wachsend mit „Equal Jitter“ –
 * die Hälfte fest, die andere Hälfte zufällig, damit viele Instanzen nicht im Gleichtakt erneut anfragen.
 */
export function backoffDelay(attempt: number, { baseMs = 300, capMs = 4000 }: BackoffOpts = {}, rand: () => number = Math.random) {
  const n = Math.max(1, Math.floor(attempt));
  const exp = Math.min(capMs, baseMs * 2 ** (n - 1));
  const r = Math.min(1, Math.max(0, rand()));
  return Math.round(exp / 2 + r * (exp / 2));
}

/** Retry-After-Header (Sekunden oder HTTP-Datum) in Millisekunden; null bei fehlendem/ungültigem Wert. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/** Wartezeit vor dem nächsten Versuch: Retry-After hat Vorrang, ist aber gedeckelt. */
export function retryDelay(attempt: number, retryAfter: string | null | undefined, opts: BackoffOpts & { retryAfterCapMs?: number } = {}, rand: () => number = Math.random, now = Date.now()) {
  const ra = parseRetryAfter(retryAfter, now);
  if (ra !== null) return Math.min(ra, opts.retryAfterCapMs ?? 10_000);
  return backoffDelay(attempt, opts, rand);
}

/** Lohnt sich ein erneuter Versuch bei diesem HTTP-Status? (Rate-Limit und Serverfehler) */
export const isRetryableStatus = (status: number) => status === 429 || status === 408 || (status >= 500 && status !== 501 && status <= 599);

/** Zählt dieser Status als Ausfall der Quelle (für den Circuit Breaker)? 4xx wie 404 sind normale Antworten. */
export const isSourceFailure = (status: number) => status === 429 || status >= 500;

/**
 * Darf ein weiterer Versuch starten? Nur wenn noch Versuche übrig sind und nach der Wartezeit
 * genug Zeit bis zur Gesamtfrist bleibt (mindestens minAttemptMs für den Versuch selbst).
 */
export function canRetry(attempt: number, maxAttempts: number, delayMs: number, deadlineAt: number, now = Date.now(), minAttemptMs = 1000) {
  return attempt < maxAttempts && now + delayMs + minAttemptMs <= deadlineAt;
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------
export type CircuitState = {
  failures: number;
  /** Zeitpunkt (ms), bis zu dem die Quelle gesperrt ist; null = geschlossen */
  openUntil: number | null;
  lastError: string;
  lastSuccessAt: number | null;
};
export type BreakerOpts = { threshold?: number; baseCooldownMs?: number; maxCooldownMs?: number };
export type CircuitPhase = "closed" | "open" | "half-open";

export const BREAKER_DEFAULTS: Required<BreakerOpts> = { threshold: 5, baseCooldownMs: 60_000, maxCooldownMs: 3600_000 };
export const emptyCircuit = (): CircuitState => ({ failures: 0, openUntil: null, lastError: "", lastSuccessAt: null });

/** closed = normal, open = gesperrt (sofortiger Fehler), half-open = Sperre abgelaufen, ein Probeversuch darf laufen. */
export function circuitPhase(s: CircuitState, now = Date.now()): CircuitPhase {
  if (s.openUntil !== null && now < s.openUntil) return "open";
  if (s.openUntil !== null) return "half-open";
  return "closed";
}

/** Sperrdauer nach failures Fehlern in Folge: ab der Schwelle exponentiell wachsend, gedeckelt (~1 h). */
export function cooldownMs(failures: number, opts: BreakerOpts = {}) {
  const { threshold, baseCooldownMs, maxCooldownMs } = { ...BREAKER_DEFAULTS, ...opts };
  if (failures < threshold) return 0;
  return Math.min(maxCooldownMs, baseCooldownMs * 2 ** Math.min(30, failures - threshold));
}

/** Neuer Zustand nach einem Fehler: zählt hoch und sperrt ab der Schwelle (ein gescheiterter Probeversuch verlängert die Sperre). */
export function circuitOnFailure(s: CircuitState, error: string, now = Date.now(), opts: BreakerOpts = {}): CircuitState {
  const failures = s.failures + 1;
  const cd = cooldownMs(failures, opts);
  return { ...s, failures, lastError: String(error || "").slice(0, 300), openUntil: cd > 0 ? now + cd : null };
}

/** Erfolg schließt den Circuit vollständig. */
export function circuitOnSuccess(s: CircuitState, now = Date.now()): CircuitState {
  return { ...s, failures: 0, openUntil: null, lastSuccessAt: now };
}

/** Muss ein Erfolg in die Datenbank? Nur wenn sich etwas ändert oder der letzte Eintrag älter als refreshMs ist. */
export function successNeedsWrite(s: CircuitState, now = Date.now(), refreshMs = 5 * 60_000) {
  return s.failures > 0 || s.openUntil !== null || s.lastSuccessAt === null || now - s.lastSuccessAt > refreshMs;
}

// ---------------------------------------------------------------------------
// Zeitbudget & Job-Status
// ---------------------------------------------------------------------------
export type Deadline = {
  /** Zeitpunkt (ms), an dem das Budget endet */
  at: number;
  /** verbleibende Millisekunden (nie negativ) */
  remaining: () => number;
  /** true, wenn weniger als marginMs übrig sind – Schleifen nehmen dann keine neuen Einträge mehr an */
  near: (marginMs?: number) => boolean;
};

export function createDeadline(budgetMs: number, now: () => number = Date.now): Deadline {
  const at = now() + Math.max(0, budgetMs);
  return {
    at,
    remaining: () => Math.max(0, at - now()),
    near: (marginMs = 0) => now() >= at - marginMs,
  };
}

export type JobStatus = "ok" | "partial" | "error" | "skipped";

/** Status eines Laufs aus Fehler, Teilergebnis-Markierung und Rückgabewert (errors > 0 / partial / skipped). */
export function jobStatus({ error, partial, skipped, result }: { error?: unknown; partial?: boolean; skipped?: boolean; result?: any }): JobStatus {
  if (error) return "error";
  if (skipped || result?.skipped === true) return "skipped";
  if (partial || result?.partial === true) return "partial";
  const errs = result && typeof result === "object" ? result.errors : undefined;
  if ((typeof errs === "number" && errs > 0) || (Array.isArray(errs) && errs.length > 0)) return "partial";
  return "ok";
}

/**
 * Admin-Alarm fällig? Wenn die letzten needed Läufe (neueste zuerst) alle fehlgeschlagen sind
 * und der letzte Alarm für diesen Job länger als cooldownMs zurückliegt.
 */
export function shouldAlert(recent: JobStatus[] | string[], lastAlertAt: number | null, now = Date.now(), { needed = 3, cooldownMs = 6 * 3600_000 } = {}) {
  if (recent.length < needed) return false;
  if (!recent.slice(0, needed).every((s) => s === "error")) return false;
  return lastAlertAt === null || now - lastAlertAt >= cooldownMs;
}

/** Circuit-Name für eine Shop-Seite: je Host getrennt, damit ein ausgefallener Shop nicht alle sperrt. */
export function shopCircuit(url: string) {
  try {
    return `shop:${new URL(url).hostname.toLowerCase().replace(/^www\./, "")}`;
  } catch {
    return "shop:unbekannt";
  }
}
