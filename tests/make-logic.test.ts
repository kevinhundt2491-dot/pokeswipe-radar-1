import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMakeConfig, cleanHookUrl, cleanPlatforms, cleanReport, isMakeHost, LEGACY_MAKE_WEBHOOK, MAKE_PLATFORMS } from "../server/make-logic.ts";

test("Make: Admin-Zentrale vor Umgebungsvariable vor Alt-Wert", () => {
  const env = { MAKE_WEBHOOK_URL: "https://hook.eu1.make.com/env", MAKE_WEBHOOK_TOKEN: "envtok" };
  const a = resolveMakeConfig({ url: "https://hook.eu2.make.com/admin", token: "admintok" }, env);
  assert.equal(a.url, "https://hook.eu2.make.com/admin"); assert.equal(a.urlSource, "admin"); assert.equal(a.token, "admintok");
  const e = resolveMakeConfig(null, env);
  assert.equal(e.urlSource, "env"); assert.equal(e.tokenSource, "env");
  const l = resolveMakeConfig(null, {});
  assert.equal(l.url, LEGACY_MAKE_WEBHOOK); assert.equal(l.urlSource, "legacy");
  assert.ok(l.warnings.some((w) => w.includes("alte")));
  assert.ok(l.warnings.some((w) => w.includes("Token")));
});

test("Make: bewusst geleerte URL schaltet Versand ab, Reset (null) fällt zurück", () => {
  const off = resolveMakeConfig({ url: "" }, { MAKE_WEBHOOK_URL: "https://hook.eu1.make.com/x" });
  assert.equal(off.url, null); assert.equal(off.urlSource, null);
  const reset = resolveMakeConfig({ url: null }, { MAKE_WEBHOOK_URL: "https://hook.eu1.make.com/x" });
  assert.equal(reset.urlSource, "env");
});

test("Make: URL-, Host- und Plattform-Prüfung", () => {
  assert.equal(cleanHookUrl("http://hook.eu1.make.com/x"), null);
  assert.equal(cleanHookUrl("kein link"), null);
  assert.ok(isMakeHost("https://hook.eu1.make.com/abc"));
  assert.equal(isMakeHost("https://evil.example.com/make.com"), false);
  assert.deepEqual(cleanPlatforms("TikTok, instagram;foo"), ["instagram", "tiktok"]);
  assert.deepEqual(resolveMakeConfig(null, {}).platforms, [...MAKE_PLATFORMS]);
  assert.deepEqual(resolveMakeConfig({ platforms: ["youtube"] }, { MAKE_PLATFORMS: "tiktok" }).platforms, ["youtube"]);
  assert.ok(resolveMakeConfig(null, { MAKE_WEBHOOK_URL: "ftp://x" }).warnings.some((w) => w.includes("MAKE_WEBHOOK_URL")));
});

test("Make: Zustellungsprotokoll speichert keine URLs", () => {
  const r = cleanReport({ ok: false, episode: "3", status: 410, message: "Fehler bei https://hook.eu1.make.com/geheim", uploadId: "ep3-<x>" });
  assert.equal(r.episode, 3); assert.equal(r.status, 410); assert.equal(r.uploadId, "ep3-x");
  assert.ok(!r.message.includes("hook.eu1")); assert.equal(r.ok, false);
});
