import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PAGE_STRINGS, placeholders, pt, euroL, fmtPct, fmtDate, toEnPath, toDePath, langFromPath, localPath, withAppLang,
  hreflangTags, alternatesFor, pokemonEnSlug, displayName, kindHeading, KIND_LABELS, SOURCE_NOTES, PRICE_CHECK_LABELS,
  CONDITIONS_EN, typeLabel, OG_LOCALE, PATH_MAP,
} from "../server/page-i18n.ts";
import { CONDITIONS } from "../server/market-logic.ts";
import { euro, euroIn } from "../server/util.ts";

test("Seitentexte: jeder Schlüssel in beiden Sprachen, gleiche Platzhalter, kein leerer Text", () => {
  const de = PAGE_STRINGS.de, en = PAGE_STRINGS.en;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort());
  for (const k of Object.keys(de) as (keyof typeof de)[]) {
    assert.deepEqual([...new Set(placeholders(en[k]))].sort(), [...new Set(placeholders(de[k]))].sort(), `Platzhalter weichen ab: ${k}`);
    assert.ok(de[k].length > 0 && en[k].length > 0, `leerer Text: ${k}`);
  }
});

test("Seitentexte: Englisch enthält keine typischen deutschen Wörter", () => {
  for (const [k, v] of Object.entries(PAGE_STRINGS.en)) {
    if (k === "shell.switch") continue; // „Deutsch“ ist der Sprachwechsel-Link
    assert.ok(!/\b(Karten?|Preise?|Angebote|nicht|und|für|aktuell)\b/.test(v), `${k}: ${v}`);
  }
});

test("pt ersetzt Platzhalter und lässt unbekannte stehen", () => {
  assert.equal(pt("de", "card.hp", { n: 120 }), "120 KP");
  assert.equal(pt("en", "card.hp", { n: 120 }), "120 HP");
  assert.equal(pt("en", "card.hp"), "{n} HP");
  assert.equal(pt("de", "shell.openApp"), "App öffnen");
  assert.equal(pt("en", "shell.openApp"), "Open app");
});

test("Wertelisten: gleiche Schlüssel in beiden Sprachen", () => {
  for (const m of [KIND_LABELS, SOURCE_NOTES, PRICE_CHECK_LABELS]) assert.deepEqual(Object.keys(m.en).sort(), Object.keys(m.de).sort());
  assert.deepEqual(Object.keys(CONDITIONS_EN).sort(), Object.keys(CONDITIONS).sort());
  assert.equal(kindHeading("de", "etb"), "Elite-Trainer-Boxs"); // deutsche Ausgabe unverändert
  assert.equal(kindHeading("en", "display"), "Booster Boxes");
  assert.equal(kindHeading("en", "etb"), "Elite Trainer Boxes");
  assert.equal(typeLabel("en", "Feuer"), "Fire");
  assert.equal(typeLabel("de", "Feuer"), "Feuer");
  assert.deepEqual(OG_LOCALE, { de: "de_DE", en: "en_GB" });
});

test("Formate: Deutsch unverändert, Englisch en-IE", () => {
  for (const n of [0, 1.5, 12.345, 1234.5]) assert.equal(euroL("de", n), euro(n));
  assert.equal(euroIn(12.5), "12,50 €");
  assert.equal(euroL("en", 12.5), "€12.50");
  assert.equal(euroL("en", 1234.5), "€1,234.50");
  assert.equal(fmtPct("de", 1.25, 1, true), "+1,3 %");
  assert.equal(fmtPct("de", -4.04, 1, true), "-4,0 %");
  assert.equal(fmtPct("en", 1.25, 1, true), "+1.3%");
  assert.equal(fmtPct("en", 12, 0), "12%");
  assert.equal(fmtDate("en", "2026-11-16T12:00:00Z", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }), "16 November 2026");
  assert.equal(fmtDate("de", "2026-11-16T12:00:00Z", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }), "16. November 2026");
});

test("Pfade: deutsch ↔ englisch", () => {
  const pairs: [string, string][] = [
    ["/karte/sv03.5-199/glurak-ex", "/en/card/sv03.5-199/glurak-ex"], ["/karte/sv03.5-199", "/en/card/sv03.5-199"],
    ["/sets", "/en/sets"], ["/set/sv08/stuermische-funken", "/en/set/sv08/stuermische-funken"],
    ["/pokemon", "/en/pokemon"], ["/pokemon/glurak", "/en/pokemon/glurak"], ["/sealed", "/en/sealed"], ["/sealed/x-display", "/en/sealed/x-display"],
    ["/trends", "/en/trends"], ["/shop/kartenkoenig", "/en/shop/kartenkoenig"], ["/shop/kartenkoenig?lang=ja", "/en/shop/kartenkoenig?lang=ja"],
  ];
  for (const [de, en] of pairs) {
    assert.equal(toEnPath(de), en);
    assert.equal(toDePath(en), de);
    assert.equal(langFromPath(en), "en");
    assert.equal(langFromPath(de), "de");
  }
  // segmentgenau: /settings ist nicht /set…, /karten nicht /karte
  assert.equal(toEnPath("/settings"), null);
  assert.equal(toEnPath("/karten/x"), null);
  assert.equal(toEnPath("/rechtliches"), null);
  assert.equal(toDePath("/en/impressum"), null);
  assert.equal(toDePath("/karte/x"), null);
  assert.equal(langFromPath("/en"), "en");
  assert.equal(langFromPath("/en/"), "en");
  assert.equal(langFromPath("/entdecken"), "de");
  assert.equal(new Set(PATH_MAP.map(([de]) => de)).size, PATH_MAP.length);
});

test("Pfade: interne Links und App-Deeplinks in der Seitensprache", () => {
  assert.equal(localPath("de", "/sets"), "/sets");
  assert.equal(localPath("en", "/sets"), "/en/sets");
  assert.equal(localPath("en", "/"), "/?lang=en");
  assert.equal(localPath("en", "/?tab=portfolio"), "/?tab=portfolio&lang=en");
  assert.equal(localPath("en", "/rechtliches#agb"), "/rechtliches#agb"); // ohne Gegenstück bleibt deutsch
  assert.equal(withAppLang("de", "/?card=a"), "/?card=a");
  assert.equal(withAppLang("en", "/?card=a&wish=1"), "/?card=a&wish=1&lang=en");
  assert.equal(withAppLang("en", "/"), "/?lang=en");
  assert.equal(withAppLang("en", "/?lang=en"), "/?lang=en");
});

test("hreflang: de, en und x-default (Deutsch), absolut und escaped", () => {
  const alt = alternatesFor("/karte/sv03.5-199/glurak-ex", "/karte/sv03.5-199/charizard-ex");
  assert.deepEqual(alt, { de: "/karte/sv03.5-199/glurak-ex", en: "/en/card/sv03.5-199/charizard-ex" });
  assert.deepEqual(alternatesFor("/sets"), { de: "/sets", en: "/en/sets" });
  const tags = hreflangTags("https://pokeswipe-radar.de", alt);
  assert.ok(tags.includes('<link rel="alternate" hreflang="de" href="https://pokeswipe-radar.de/karte/sv03.5-199/glurak-ex">'));
  assert.ok(tags.includes('<link rel="alternate" hreflang="en" href="https://pokeswipe-radar.de/en/card/sv03.5-199/charizard-ex">'));
  assert.ok(tags.includes('<link rel="alternate" hreflang="x-default" href="https://pokeswipe-radar.de/karte/sv03.5-199/glurak-ex">'));
  assert.equal((tags.match(/rel="alternate"/g) || []).length, 3);
  const esc = hreflangTags("https://x", alternatesFor("/shop/a?lang=de"), (s) => s.replace(/&/g, "&amp;"));
  assert.ok(esc.includes('hreflang="en" href="https://x/en/shop/a?lang=de"'));
});

test("Pokémon-Slugs und Anzeigenamen auf Englisch", () => {
  assert.equal(pokemonEnSlug("Charizard", "glurak"), "charizard");
  assert.equal(pokemonEnSlug("Mr. Mime", "pantimos"), "mr-mime");
  assert.equal(pokemonEnSlug("Farfetch’d", "porenta"), "farfetch-d");
  assert.equal(pokemonEnSlug("Nidoran♀", "nidoran-w"), "nidoran-w"); // nicht eindeutig → deutscher Slug
  assert.equal(pokemonEnSlug("Flabébé", "flabebe"), "flabebe");
  assert.equal(pokemonEnSlug("", "glurak"), "glurak");
  assert.equal(pokemonEnSlug("-", "glurak"), "glurak");
  assert.equal(displayName("en", "Glurak", "Charizard"), "Charizard");
  assert.equal(displayName("en", "Glurak", "-"), "Glurak");
  assert.equal(displayName("de", "Glurak", "Charizard"), "Glurak");
});

test("Routing: /en und /en/* am Ende beider Pfadlisten, Routen registriert", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const toml = /\[server\][\s\S]*?path\s*=\s*\[([\s\S]*?)\]/.exec(read("../netlify.toml"))?.[1] || "";
  const entry = /path:\s*\[([\s\S]*?)\]/.exec(read("../netlify/server/index.ts"))?.[1] || "";
  for (const list of [toml, entry]) {
    const paths = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(paths.slice(-2), ["/en", "/en/*"]);
  }
  const src = ["growth", "catalog", "seo", "shops"].map((f) => read(`../server/${f}.ts`)).join("\n");
  for (const r of ["/en/card/:id/:slug?", "/en/sets", "/en/set/:id/:slug?", "/en/pokemon", "/en/pokemon/:slug", "/en/sealed", "/en/sealed/:slug", "/en/trends", "/en/shop/:slug", "/en", "/en/", "/sitemaps/en-pages.xml", "/sitemaps/en-sets.xml", "/sitemaps/en-pokemon.xml", "/sitemaps/en-sealed.xml"]) {
    assert.ok(src.includes(`app.get("${r}"`), `Route ${r} fehlt`);
  }
});
