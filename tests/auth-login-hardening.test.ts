// Login-Reparatur: Vorschau-Domain-Erkennung, Hauptdomain-Link und verständliche deutsche Fehlermeldungen
// sowie der Main-Thread-Rückfall für die Ziffern-Vorlagen des Scanners (ohne OffscreenCanvas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPreviewHost, mainDomainUrl, authErrorMessage, MAIN_ORIGIN } from "../client/session-logic.js";
import { renderGlyphBitmaps, GLYPH_CHARS, GLYPH_FONTS } from "../client/scanner/glyph-render.js";

test("Vorschau-Adressen werden erkannt, die Hauptdomain nicht", () => {
  assert.equal(isPreviewHost("deploy-preview-77--pokeswipe-radar.netlify.app"), true);
  assert.equal(isPreviewHost("6afdfba080d1e403555d3c83--pokeswipe-radar.netlify.app"), true);
  assert.equal(isPreviewHost("main--pokeswipe-radar.netlify.app"), true);
  assert.equal(isPreviewHost("pokeswipe-radar.netlify.app"), true);
  assert.equal(isPreviewHost("pokeswipe-radar.de"), false);
  assert.equal(isPreviewHost("www.pokeswipe-radar.de"), false);
  assert.equal(isPreviewHost("evil-pokeswipe-radar.netlify.app"), false);
  assert.equal(isPreviewHost("localhost"), false);
  assert.equal(isPreviewHost(""), false);
});

test("Wechsel zur Hauptdomain behält Pfad und Parameter, verwirft den Hash (Tokens)", () => {
  assert.equal(mainDomainUrl("https://x--pokeswipe-radar.netlify.app/?tab=scan#access_token=abc"), `${MAIN_ORIGIN}/?tab=scan`);
  assert.equal(mainDomainUrl("kaputt"), `${MAIN_ORIGIN}/`);
  assert.ok(mainDomainUrl("https://a--pokeswipe-radar.netlify.app/x").startsWith("https://pokeswipe-radar.de/"));
});

test("Fehlermeldungen sind deutsch und passend", () => {
  assert.match(authErrorMessage({ status: 400, message: "invalid_grant: Invalid email or password" }, "login"), /E-Mail oder Passwort falsch/);
  assert.match(authErrorMessage({ status: 400, message: "Email not confirmed" }, "login"), /bestätige/);
  assert.match(authErrorMessage({ status: 422, message: "A user with this email address has already been registered" }, "signup"), /bereits registriert/);
  assert.match(authErrorMessage(new TypeError("Failed to fetch"), "login"), /Keine Verbindung/);
  assert.match(authErrorMessage({}, "login", { online: false }), /Keine Verbindung/);
  assert.match(authErrorMessage({ status: 429 }, "signup"), /Zu viele Versuche/);
  assert.match(authErrorMessage({ status: 503 }, "recover"), /gestört/);
  assert.match(authErrorMessage({ message: "Unsupported provider: Provider is not enabled" }, "oauth"), /nicht freigeschaltet/);
});

test("Ziffern-Vorlagen: ohne 2D-Kontext leer statt Fehler, mit Kontext je Schrift/Breite ein Satz", () => {
  assert.deepEqual(renderGlyphBitmaps(null), []);
  assert.deepEqual(renderGlyphBitmaps({ getContext: () => null }), []);
  // Minimaler Canvas-Ersatz: jedes Zeichen ergibt ein 10×20-Rechteck aus schwarzen Pixeln
  let ink = false;
  const ctx = {
    setTransform() {}, fillRect() { ink = false; }, fillText() { ink = true; },
    getImageData(_x: number, _y: number, w: number, h: number) {
      const data = new Uint8ClampedArray(w * h * 4).fill(255);
      if (ink) for (let y = 30; y < 50; y++) for (let x = 27; x < 37; x++) data[(y * w + x) * 4] = 0;
      return { data };
    },
  } as any;
  const out = renderGlyphBitmaps({ getContext: () => ctx } as any);
  assert.equal(out.length, GLYPH_FONTS.length * 2 * GLYPH_CHARS.length);
  assert.equal(out[0].w, 10);
  assert.equal(out[0].h, 20);
  assert.ok(out[0].bits instanceof Float32Array);
});
