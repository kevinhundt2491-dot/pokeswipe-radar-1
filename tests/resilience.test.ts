import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backoffDelay, parseRetryAfter, retryDelay, isRetryableStatus, isSourceFailure, canRetry,
  circuitPhase, cooldownMs, circuitOnFailure, circuitOnSuccess, successNeedsWrite, emptyCircuit,
  createDeadline, jobStatus, shouldAlert, shopCircuit,
} from "../server/resilience-logic.ts";

test("Backoff: wächst exponentiell, Jitter bleibt zwischen halber und voller Stufe, Deckel greift", () => {
  const opts = { baseMs: 300, capMs: 4000 };
  assert.equal(backoffDelay(1, opts, () => 0), 150);
  assert.equal(backoffDelay(1, opts, () => 1), 300);
  assert.equal(backoffDelay(2, opts, () => 1), 600);
  assert.equal(backoffDelay(3, opts, () => 0.5), 900);
  assert.equal(backoffDelay(10, opts, () => 1), 4000);
  assert.equal(backoffDelay(10, opts, () => 0), 2000);
  for (let i = 0; i < 50; i++) {
    const d = backoffDelay(2, opts);
    assert.ok(d >= 300 && d <= 600);
  }
});

test("Retry-After: Sekunden, HTTP-Datum, ungültig – und gedeckelt", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  assert.equal(parseRetryAfter("3", now), 3000);
  assert.equal(parseRetryAfter("Sun, 15 Nov 2026 12:00:05 GMT", now), 5000);
  assert.equal(parseRetryAfter("Sun, 15 Nov 2026 11:00:00 GMT", now), 0);
  assert.equal(parseRetryAfter("bald", now), null);
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(retryDelay(1, "2", {}, () => 0, now), 2000);
  assert.equal(retryDelay(1, "120", { retryAfterCapMs: 5000 }, () => 0, now), 5000);
  assert.equal(retryDelay(1, null, { baseMs: 400 }, () => 1, now), 400);
});

test("Status: 429/5xx werden wiederholt und zählen als Ausfall, 404 nicht", () => {
  for (const s of [429, 500, 502, 503, 504]) { assert.equal(isRetryableStatus(s), true); assert.equal(isSourceFailure(s), true); }
  for (const s of [200, 301, 400, 401, 403, 404]) { assert.equal(isRetryableStatus(s), false); assert.equal(isSourceFailure(s), false); }
  assert.equal(isRetryableStatus(501), false);
});

test("Wiederholung nur mit Restversuchen und genug Zeit bis zur Gesamtfrist", () => {
  const now = 1_000_000;
  assert.equal(canRetry(1, 3, 500, now + 5000, now), true);
  assert.equal(canRetry(3, 3, 500, now + 5000, now), false);
  assert.equal(canRetry(1, 3, 4500, now + 5000, now), false);
  assert.equal(canRetry(1, 3, 3000, now + 5000, now, 2000), true);
});

test("Circuit Breaker: öffnet nach Schwelle, Sperre wächst exponentiell bis ~1 h, Half-Open, Erfolg schließt", () => {
  const opts = { threshold: 3, baseCooldownMs: 60_000, maxCooldownMs: 3600_000 };
  let s = emptyCircuit();
  let now = 0;
  assert.equal(circuitPhase(s, now), "closed");
  s = circuitOnFailure(s, "HTTP 503", now, opts);
  s = circuitOnFailure(s, "HTTP 503", now, opts);
  assert.equal(circuitPhase(s, now), "closed");
  s = circuitOnFailure(s, "Timeout", now, opts);
  assert.equal(s.failures, 3);
  assert.equal(s.openUntil, 60_000);
  assert.equal(s.lastError, "Timeout");
  assert.equal(circuitPhase(s, 30_000), "open");
  assert.equal(circuitPhase(s, 60_000), "half-open");
  // Probeversuch scheitert → doppelte Sperre
  now = 60_000;
  s = circuitOnFailure(s, "Timeout", now, opts);
  assert.equal(s.openUntil, now + 120_000);
  assert.equal(cooldownMs(2, opts), 0);
  assert.equal(cooldownMs(5, opts), 240_000);
  assert.equal(cooldownMs(50, opts), 3600_000);
  // Erfolg schließt vollständig
  s = circuitOnSuccess(s, 200_000);
  assert.deepEqual({ f: s.failures, o: s.openUntil, l: s.lastSuccessAt }, { f: 0, o: null, l: 200_000 });
  assert.equal(circuitPhase(s, 200_000), "closed");
});

test("Circuit: Erfolge werden nur bei Änderung oder selten gespeichert", () => {
  const now = 10 * 60_000;
  assert.equal(successNeedsWrite(emptyCircuit(), now), true);
  assert.equal(successNeedsWrite({ ...emptyCircuit(), lastSuccessAt: now - 1000 }, now), false);
  assert.equal(successNeedsWrite({ ...emptyCircuit(), lastSuccessAt: now - 6 * 60_000 }, now), true);
  assert.equal(successNeedsWrite({ ...emptyCircuit(), failures: 1, lastSuccessAt: now }, now), true);
});

test("Circuit je Shop-Host: ein Shop sperrt nicht die anderen", () => {
  assert.equal(shopCircuit("https://www.amazon.de/dp/B0X"), "shop:amazon.de");
  assert.equal(shopCircuit("https://smythstoys.com/de/p/1"), "shop:smythstoys.com");
  assert.notEqual(shopCircuit("https://www.otto.de/p/1"), shopCircuit("https://www.amazon.de/p/1"));
  assert.equal(shopCircuit("kein link"), "shop:unbekannt");
});

test("Zeitbudget: Restzeit und Grenze vor Ablauf", () => {
  let t = 1000;
  const d = createDeadline(20_000, () => t);
  assert.equal(d.at, 21_000);
  assert.equal(d.remaining(), 20_000);
  assert.equal(d.near(5000), false);
  t = 16_500;
  assert.equal(d.near(5000), true);
  t = 30_000;
  assert.equal(d.remaining(), 0);
  assert.equal(d.near(), true);
});

test("Job-Status aus Fehler, Teilergebnis und Rückgabewert", () => {
  assert.equal(jobStatus({ result: { done: 3 } }), "ok");
  assert.equal(jobStatus({ error: new Error("x"), partial: true }), "error");
  assert.equal(jobStatus({ partial: true, result: {} }), "partial");
  assert.equal(jobStatus({ result: { errors: 2 } }), "partial");
  assert.equal(jobStatus({ result: { errors: 0 } }), "ok");
  assert.equal(jobStatus({ result: { errors: ["x"] } }), "partial");
  assert.equal(jobStatus({ result: { errors: [] } }), "ok");
  assert.equal(jobStatus({ skipped: true }), "skipped");
  assert.equal(jobStatus({ result: { skipped: true } }), "skipped");
});

test("Admin-Alarm erst nach 3 Fehlläufen in Folge und höchstens alle 6 h", () => {
  const now = 100 * 3600_000;
  assert.equal(shouldAlert(["error", "error", "error"], null, now), true);
  assert.equal(shouldAlert(["error", "error"], null, now), false);
  assert.equal(shouldAlert(["error", "ok", "error"], null, now), false);
  assert.equal(shouldAlert(["error", "error", "error", "ok"], null, now), true);
  assert.equal(shouldAlert(["error", "error", "error"], now - 2 * 3600_000, now), false);
  assert.equal(shouldAlert(["error", "error", "error"], now - 7 * 3600_000, now), true);
});
