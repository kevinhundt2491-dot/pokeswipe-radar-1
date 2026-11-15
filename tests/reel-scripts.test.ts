import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { SCENARIOS, LENGTHS, WORD_LIMITS, countWords, checkScript, fitScript, scriptFor, buildCaption, hashtagsFor, pokemonTag, captionFile, CTA_LINE, BASE_TAGS } from "../client/reel-scripts.js";

test("Live-Reels: alle 10 Szenarien mit je 4 Sätzen für 15 s und 30 s", () => {
  assert.equal(SCENARIOS.length, 10);
  assert.equal(new Set(SCENARIOS.map((s: any) => s.key)).size, 10);
  for (const s of SCENARIOS) for (const len of LENGTHS) assert.equal(s.vo[len].length, 4, `${s.key} ${len}`);
});

test("Live-Reels: Voiceover hält das Wortlimit ein (32–36 bei 15 s, 65–72 bei 30 s)", () => {
  assert.deepEqual(WORD_LIMITS[15], [32, 36]);
  assert.deepEqual(WORD_LIMITS[30], [65, 72]);
  for (const s of SCENARIOS) {
    for (const len of LENGTHS) {
      const chk = checkScript(scriptFor(s, len), len);
      assert.ok(chk.ok, `${s.key} (${len} s) hat ${chk.words} Wörter`);
    }
  }
});

test("Live-Reels: Wortzählung und Kürzen auf das Limit", () => {
  assert.equal(countWords("Hallo, Welt – 238/191 ist da!"), 5);
  const long = ["Hook bleibt.", Array.from({ length: 60 }, (_, i) => `wort${i}`).join(" ") + ".", "Mitte zwei hier.", "CTA bleibt immer erhalten."];
  const fitted = fitScript(long, 30);
  assert.ok(countWords(fitted) <= 72);
  assert.equal(fitted[0], "Hook bleibt.");
  assert.equal(fitted[3], "CTA bleibt immer erhalten.");
});

test("Live-Reels: Caption mit Hook, Mehrwert, CTA und 5–8 Hashtags", () => {
  for (const s of SCENARIOS) {
    const cap = buildCaption(s, { card: "Glurak-ex (199/165)", pct: "31 %", price: "89,00 €", total: "1.234,00 €", count: "12", value: "Bester Pull: 42,00 €" });
    const lines = cap.caption.split("\n");
    assert.equal(lines[0], cap.hook);
    assert.ok(cap.body.length >= 2 && cap.body.length <= 3);
    assert.ok(cap.caption.includes(CTA_LINE));
    assert.ok(cap.hashtags.length >= 5 && cap.hashtags.length <= 8, `${s.key}: ${cap.hashtags.length}`);
    for (const t of BASE_TAGS) assert.ok(cap.hashtags.includes(t));
    assert.equal(new Set(cap.hashtags.map((t: string) => t.toLowerCase())).size, cap.hashtags.length);
    assert.ok(cap.title.length <= 100 && cap.title.includes("PokeSwipe Radar"));
    const txt = captionFile(s, cap, { voiceover: "x" });
    assert.ok(txt.includes(cap.caption) && txt.includes(cap.title));
  }
  // ohne Fakten: trotzdem vollständig
  const cap = buildCaption(SCENARIOS[0], {});
  assert.ok(cap.hook && cap.hashtags.length >= 5);
});

test("Live-Reels: Pokémon-Hashtag aus dem Kartentitel", () => {
  assert.equal(pokemonTag("Pikachu-ex (238/191)"), "#Pikachu");
  assert.equal(pokemonTag("Glurak ex 199/165"), "#Glurak");
  assert.equal(pokemonTag(""), "");
  assert.ok(hashtagsFor(SCENARIOS[0], { card: "Mew ex" }).includes("#Mew"));
});

test("Voiceover-Server: gleiche Wortzählung und Obergrenze 72 Wörter", async () => {
  const { countWords: serverCount, NARRATION_MAX_WORDS } = await import("../server/voiceover.ts");
  assert.equal(NARRATION_MAX_WORDS, 72);
  for (const s of SCENARIOS) for (const len of LENGTHS) assert.equal(serverCount(scriptFor(s, len)), countWords(scriptFor(s, len)));
});
