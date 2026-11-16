// i18n (client/i18n-core.js + Wörterbuch client/i18n-en*.js): reine Logik ohne DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { detectLang, createTranslator, compilePattern, splitDecor, fill, placeholders, validateDictionary, localePathFor, squash } from "../client/i18n-core.js";
// @ts-ignore – Client-Modul ohne Typen
import dict, { KEEP } from "../client/i18n-en.js";

test("Sprache: URL-Parameter gewinnt vor gespeichertem Wert und Browser", () => {
  assert.deepEqual(detectLang({ search: "?lang=en", stored: "de", language: "de-DE" }), { lang: "en", fromUrl: true });
  assert.deepEqual(detectLang({ search: "?tab=flip&lang=DE", stored: "en", language: "en-US" }), { lang: "de", fromUrl: true });
  // ungültiger Parameter wird ignoriert
  assert.deepEqual(detectLang({ search: "?lang=fr", stored: "en" }), { lang: "en", fromUrl: false });
});

test("Sprache: gespeicherter Wert vor Browser, sonst Deutsch", () => {
  assert.equal(detectLang({ stored: "de", language: "en-US", languages: ["en-US"] }).lang, "de");
  assert.equal(detectLang({ stored: "en", language: "de-DE" }).lang, "en");
  assert.equal(detectLang({}).lang, "de");
  assert.equal(detectLang({ language: "fr-FR", languages: ["fr-FR"] }).lang, "de");
});

test("Sprache: englischer Browser nur ohne deutschsprachige Locale", () => {
  assert.equal(detectLang({ language: "en-US", languages: ["en-US", "en"] }).lang, "en");
  assert.equal(detectLang({ language: "en-GB", languages: ["en-GB"] }).lang, "en");
  assert.equal(detectLang({ language: "en-US", languages: ["en-US", "de-DE"] }).lang, "de");
  assert.equal(detectLang({ language: "en", languages: ["en", "de"] }).lang, "de");
  assert.equal(detectLang({ language: "en-DE", languages: ["en-DE"] }).lang, "de");
  assert.equal(detectLang({ language: "en-AT" }).lang, "de");
  assert.equal(detectLang({ language: "en-CH" }).lang, "de");
});

test("Muster: {platzhalter} werden zu Gruppen, Werte landen in der Übersetzung", () => {
  const p = compilePattern("Noch {n} Swipes heute");
  assert.deepEqual(p.names, ["n"]);
  assert.ok(p.re.test("Noch 5 Swipes heute"));
  assert.ok(!p.re.test("Noch 5 Swipes"));
  const tr = createTranslator([
    ["Noch {n} Swipes heute", "{n} swipes left today"],
    ["{name} hat dir {price} geboten", "{name} offered you {price}"],
    ["Zustand: {c}", "Condition: {c}"],
    ["Neuwertig", "Like new"],
  ]);
  assert.equal(tr.translate("Noch 12 Swipes heute"), "12 swipes left today");
  assert.equal(tr.translate("Max Muster hat dir 12,50 € geboten"), "Max Muster offered you 12,50 €");
  // erfasste Werte, die selbst feste UI-Texte sind, werden mitübersetzt
  assert.equal(tr.translate("Zustand: Neuwertig"), "Condition: Like new");
  assert.equal(tr.translate("Etwas ganz anderes"), null);
});

test("Exakte Treffer: Whitespace bleibt erhalten, Zeilenumbrüche im HTML egal", () => {
  const tr = createTranslator([["Karte scannen", "Scan card"], ["Mein Konto", "My account"]]);
  assert.equal(tr.translate("  Karte scannen\n"), "  Scan card\n");
  assert.equal(tr.translate("Karte\n      scannen"), "Scan card");
  assert.equal(tr.translate("Mein Konto:"), "My account:");
  assert.equal(tr.translate("Mein Konto …"), "My account …");
  assert.equal(tr.translate("12,50 €"), null); // ohne Buchstaben nichts zu tun
});

test("Emoji-Präfix/-Suffix wird abgetrennt und wieder angehängt", () => {
  assert.deepEqual(splitDecor("🔥 Top-Deal"), { lead: "🔥 ", core: "Top-Deal", trail: "" });
  assert.deepEqual(splitDecor("Jetzt prüfen →"), { lead: "", core: "Jetzt prüfen", trail: " →" });
  assert.deepEqual(splitDecor("🇩🇪 Deutsch"), { lead: "🇩🇪 ", core: "Deutsch", trail: "" });
  const tr = createTranslator([["Top-Deal", "Top deal"], ["Jetzt prüfen", "Check now"], ["Noch {n} Swipes", "{n} swipes left"]]);
  assert.equal(tr.translate("🔥 Top-Deal"), "🔥 Top deal");
  assert.equal(tr.translate("⚠️ Top-Deal"), "⚠️ Top deal");
  assert.equal(tr.translate("👨‍👩‍👧 Top-Deal ✨"), "👨‍👩‍👧 Top deal ✨");
  assert.equal(tr.translate(" Jetzt prüfen → "), " Check now → ");
  assert.equal(tr.translate("⚡ Noch 3 Swipes"), "⚡ 3 swipes left");
});

test("fill() und placeholders()", () => {
  assert.equal(fill("{n} swipes, {x} left", { n: 3 }), "3 swipes, {x} left");
  assert.deepEqual(placeholders("Noch {n} von {total}"), ["n", "total"]);
});

test("localePath: öffentliche Seiten bekommen bei Englisch /en", () => {
  assert.equal(localePathFor("/karte/sv8-238/pikachu-ex", "en"), "/en/karte/sv8-238/pikachu-ex");
  assert.equal(localePathFor("/set/sv8/stuermische-funken", "en"), "/en/set/sv8/stuermische-funken");
  assert.equal(localePathFor("/sets", "en"), "/en/sets");
  assert.equal(localePathFor("/pokemon/glurak", "en"), "/en/pokemon/glurak");
  assert.equal(localePathFor("/shop/kartenkoenig", "en"), "/en/shop/kartenkoenig");
  assert.equal(localePathFor("https://pokeswipe-radar.de/trends", "en"), "https://pokeswipe-radar.de/en/trends");
  assert.equal(localePathFor("/en/karte/x", "en"), "/en/karte/x");
  assert.equal(localePathFor("/kuendigen", "en"), "/kuendigen");
  assert.equal(localePathFor("/settings", "en"), "/settings");
  assert.equal(localePathFor("/karte/x", "de"), "/karte/x");
});

test("Wörterbuch: keine doppelten Schlüssel, keine leeren Werte, Platzhalter vollständig", () => {
  assert.ok(Array.isArray(dict) && dict.length > 500, `Wörterbuch zu klein: ${dict.length}`);
  assert.deepEqual(validateDictionary(dict), []);
  for (const [de, en] of dict) {
    for (const p of placeholders(de)) assert.ok(en.includes(`{${p}}`), `{${p}} fehlt in "${en}" (für "${de}")`);
  }
});

test("Wörterbuch: KEEP überschneidet sich nicht mit Übersetzungen", () => {
  const keys = new Set(dict.map(([de]: [string, string]) => squash(de)));
  const both = (KEEP as string[]).filter((k) => keys.has(squash(k)));
  assert.deepEqual(both, []);
});

test("Wörterbuch: zentrale Texte und Rechtslinks", () => {
  const tr = createTranslator(dict);
  assert.equal(tr.translate("Impressum"), "Imprint");
  assert.match(tr.translate("AGB") || "", /German/);
  assert.match(tr.translate("Datenschutz") || "", /German/);
  assert.ok(tr.translate("Speichern"));
  assert.ok(tr.translate("Abmelden"));
});
