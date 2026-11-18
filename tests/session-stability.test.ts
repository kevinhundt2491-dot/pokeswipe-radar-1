// Stabile Dauer-Anmeldung (kein ungewollter Rauswurf) & Tab-/Ansichts-Stabilität – reine Logik + Quelltext-Garantien.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SESSION_MAX_AGE, SESSION_COOKIE, cookieLine, sessionCookieLines, clearSessionCookieLines, classifyRefresh,
  validRefreshToken, validAccessToken,
} from "../server/session-logic.ts";
import { identityUnavailableStatus } from "../server/auth.ts";
import {
  isDefinitiveAuthFailure, classifyUnauthorized, shouldSyncSession, tokenFingerprint, withUrlParams, tabFromUrl,
  SESSION_SYNC_EVERY_MS,
// @ts-ignore – Client-Modul ohne Typen
} from "../client/session-logic.js";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "HS256" })}.${b64({ sub: "u1", exp: 9_999_999_999 })}.sig`;

// ---------------------------------------------------------------------------
// Server: Cookies
// ---------------------------------------------------------------------------
test("Sitzungs-Cookie: HttpOnly; Secure; SameSite=Lax; Max-Age=15552000 (180 Tage), nur für /api/session", () => {
  assert.equal(SESSION_MAX_AGE, 180 * 86400);
  const lines = sessionCookieLines({ accessToken: JWT, refreshToken: "refresh-abc_123" });
  const rt = lines.find((l) => l.startsWith(`${SESSION_COOKIE}=`))!;
  assert.ok(rt);
  for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=15552000", "Path=/api/session"]) assert.ok(rt.includes(part), part);
  // Zugangs-Cookie für @netlify/identity: lang gültig, aber lesbar (sonst verwirft die Bibliothek die Sitzung)
  const jwt = lines.find((l) => l.startsWith("nf_jwt="))!;
  assert.ok(jwt.includes("Max-Age=15552000") && jwt.includes("Secure") && !jwt.includes("HttpOnly"));
  assert.ok(lines.some((l) => l.startsWith("ps_auth=1")));
});

test("Sitzungs-Cookie: ungültige Tokens werden nie gespeichert", () => {
  assert.deepEqual(sessionCookieLines({ accessToken: "kein-jwt", refreshToken: "a b;c" }), []);
  assert.equal(validRefreshToken("x".repeat(600)), false);
  assert.equal(validRefreshToken("short"), false);
  assert.equal(validAccessToken(JWT), true);
});

test("Abmelden löscht alle Sitzungs-Cookies (Max-Age=0), auch das HttpOnly-Cookie auf seinem Pfad", () => {
  const lines = clearSessionCookieLines();
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => l.includes("Max-Age=0")));
  assert.ok(lines.some((l) => l.startsWith(`${SESSION_COOKIE}=;`) && l.includes("Path=/api/session") && l.includes("HttpOnly")));
});

test("cookieLine: Secure lässt sich nur für http://localhost abschalten", () => {
  assert.ok(!cookieLine("a", "b", { secure: false }).includes("Secure"));
  assert.ok(cookieLine("a", "b").includes("Secure"));
});

test("Refresh beim Server: nur 400/401/403 beenden die Sitzung – Netz, Timeout, 5xx und 429 nie", () => {
  assert.equal(classifyRefresh(200), "ok");
  for (const s of [400, 401, 403]) assert.equal(classifyRefresh(s), "invalid");
  for (const s of [null, 500, 502, 503, 504, 429]) assert.equal(classifyRefresh(s as any), "unavailable");
});

test("Token-Prüfung: Identity-Kaltstart/Störung zählt als „nicht erreichbar“ (503), nicht als abgemeldet (401)", () => {
  for (const s of [500, 502, 503, 504, 429, 408]) assert.equal(identityUnavailableStatus(s), true);
  for (const s of [200, 401, 403, 404]) assert.equal(identityUnavailableStatus(s), false);
  const app = src("server/app.ts");
  assert.match(app, /if \(!user && unavailable\)[\s\S]{0,200}503/);
  assert.match(src("server/auth.ts"), /catch \{[\s\S]{0,160}unavailable: true/);
});

// ---------------------------------------------------------------------------
// Browser: kein Rauswurf
// ---------------------------------------------------------------------------
test("Refresh-Fehler: nur eindeutige Ablehnung meldet ab", () => {
  assert.equal(isDefinitiveAuthFailure({ status: 400 }), true);
  assert.equal(isDefinitiveAuthFailure({ status: 401 }), true);
  assert.equal(isDefinitiveAuthFailure({ status: 502 }), false);
  assert.equal(isDefinitiveAuthFailure(new TypeError("Failed to fetch")), false);
  assert.equal(isDefinitiveAuthFailure(new Error("Token refresh timeout")), false);
});

test("401 einer API-Antwort: Wiederholen, vorübergehend oder wirklich abgemeldet", () => {
  assert.equal(classifyUnauthorized({ hadToken: false }), "unauthorized");
  assert.equal(classifyUnauthorized({ hadToken: true, refreshOutcome: "ok" }), "retry");
  assert.equal(classifyUnauthorized({ hadToken: true, refreshOutcome: "transient", sessionStillStored: true }), "transient");
  assert.equal(classifyUnauthorized({ hadToken: true, refreshOutcome: "invalid", sessionStillStored: false }), "unauthorized");
  assert.equal(classifyUnauthorized({ hadToken: true, retried: true, refreshOutcome: "ok" }), "unauthorized");
});

test("Gleitender Ablauf: Server-Cookie bei neuem Refresh-Token sofort, sonst spätestens alle 12 h verlängern", () => {
  const now = 1_800_000_000_000;
  const h = tokenFingerprint("rt-1");
  assert.notEqual(h, tokenFingerprint("rt-2"));
  assert.equal(shouldSyncSession({ last: null, fingerprint: h, now }), true);
  assert.equal(shouldSyncSession({ last: { at: now - 1000, h }, fingerprint: h, now }), false);
  assert.equal(shouldSyncSession({ last: { at: now - SESSION_SYNC_EVERY_MS, h }, fingerprint: h, now }), true);
  assert.equal(shouldSyncSession({ last: { at: now, h }, fingerprint: tokenFingerprint("rt-2"), now }), true);
  assert.equal(shouldSyncSession({ last: { at: now, h }, fingerprint: h, now, force: true }), true);
  assert.equal(shouldSyncSession({ fingerprint: "" }), false);
});

test("Quelltext: gotrue-Refresh ist abgesichert, Abmelden nur über den Button", () => {
  const session = src("client/session.js");
  assert.match(session, /proto\._refreshToken = function/);
  assert.match(session, /if \(isDefinitiveAuthFailure\(error\)\) \{[\s\S]{0,120}this\.clearSession\(\)/);
  const main = src("client/main.js");
  const bootGetUser = main.lastIndexOf("state.user = await getUser();");
  assert.ok(main.indexOf("hardenTokenRefresh();") > main.indexOf("async function boot()") && main.indexOf("hardenTokenRefresh();") < bootGetUser);
  assert.ok(main.indexOf("await restoreServerSession()") < bootGetUser);
  // endServerSession (Cookie löschen) gibt es nur im Abmelden-Ablauf
  assert.equal((main.match(/endServerSession\(\)/g) || []).length, 1);
  assert.match(main, /async function doLogout\(\) \{[\s\S]{0,200}await endServerSession\(\)/);
});

test("Service Worker: Anmeldung/Sitzung nie aus dem Cache, API online immer frisch", () => {
  const sw = src("public/sw.js");
  assert.match(sw, /NEVER_CACHE = .*api\\\/session/);
  assert.match(sw, /NEVER_CACHE\.test\(url\.pathname\)\) return;/);
  assert.match(sw, /cache: "no-store"/);
  assert.doesNotMatch(sw, /localStorage|document\.cookie/);
});

// ---------------------------------------------------------------------------
// Tabs & Ansichten
// ---------------------------------------------------------------------------
test("URL: Reiter/Unterbereich setzen, andere Parameter bleiben, Start = saubere Adresse", () => {
  assert.equal(withUrlParams("https://x.de/?ref=ABC123", { tab: "map" }), "/?ref=ABC123&tab=map");
  assert.equal(withUrlParams("https://x.de/?tab=map&sub=market", { tab: "home", sub: null }), "/");
  assert.equal(withUrlParams("https://x.de/?tab=profile", { tab: "admin", section: "creators" }), "/?tab=admin&section=creators");
  assert.equal(withUrlParams("https://x.de/?tab=admin&section=creators", { section: null, tab: "profile" }), "/?tab=profile");
  assert.equal(tabFromUrl("https://x.de/?tab=admin&section=creators"), "admin");
  assert.equal(tabFromUrl("https://x.de/?tab=<script>"), "");
});

test("Quelltext: Hintergrund-Aktualisierungen lassen Reiter, Admin-Bereich und Bildlauf in Ruhe", () => {
  const nav = src("client/app-nav.js");
  assert.match(nav, /openState\.has\(k\)\) d\.open = openState\.get\(k\)/); // aufgeklappte Admin-Zentrale bleibt offen
  assert.match(nav, /syncUrl\(params, \{ push: true/);
  const legacy = src("public/js/legacy-app.js");
  assert.match(legacy, /if \(changed\) window\.scrollTo\(\{ top: 0/);
  assert.match(legacy, /e\.type !== "pointercancel" && Math\.abs\(dx\) > 90/);
  const core = src("client/core.js");
  assert.match(core, /if \(view\) restoreModalView\(el, view\)/);
  assert.match(core, /"ps-creators": \{ open: \{ tab: "admin", section: "creators" \}/);
});
