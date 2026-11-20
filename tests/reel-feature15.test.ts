import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { FEATURE15_TEMPLATES, PRO_TEMPLATES, templateByKey, proScript, checkTemplateScript, scenesFor, HOOK4_SCENES, DOMAIN, isHook4, proCaption } from "../client/reel-pro.js";
// @ts-ignore – Client-Modul ohne Typen
import { CHOREO } from "../client/reel-scenarios.js";
import { DEFAULT_VOICE_ID, voiceIdFrom, toneSettings, speakable, NARRATION_MAX_WORDS } from "../server/voiceover.ts";

test("Stimme: eigene geklonte Voice-ID als Standard, eingetragene IDs werden geprüft", () => {
  assert.equal(DEFAULT_VOICE_ID, "VFyVvYhn7M2ZEZy63rUf");
  assert.equal(voiceIdFrom(undefined), DEFAULT_VOICE_ID);
  assert.equal(voiceIdFrom(""), DEFAULT_VOICE_ID);
  assert.equal(voiceIdFrom("abc/../x"), DEFAULT_VOICE_ID);
  assert.equal(voiceIdFrom(" XrExE9yKIg1WjnnlVkGX "), "XrExE9yKIg1WjnnlVkGX");
});

test("Stimme: Einstellungen für maximale Natürlichkeit", () => {
  for (const tone of ["calm", "energetic", undefined]) {
    const s = toneSettings(tone);
    assert.equal(s.stability, 0.45); assert.equal(s.similarity_boost, 0.8); assert.equal(s.style, 0.25); assert.equal(s.use_speaker_boost, true);
  }
});

test("Feature-Vorlagen: 4 Skripte à ca. 15 s, Hook-Format, eigene Choreografie, nicht in der Rotation", () => {
  assert.deepEqual(FEATURE15_TEMPLATES.map((t: any) => t.key), ["f15binder", "f15gaps", "f15dupes", "f15all"]);
  for (const t of FEATURE15_TEMPLATES) {
    assert.equal(templateByKey(t.key), t);
    assert.ok(!PRO_TEMPLATES.includes(t));
    assert.ok(isHook4(t)); assert.deepEqual(scenesFor(t), HOOK4_SCENES);
    assert.ok(CHOREO[t.choreo] && CHOREO[t.choreo].beats.length === 4, `${t.key}: Choreografie`);
    const s = proScript(t, 0);
    assert.equal(s.say.length, 4);
    const chk = checkTemplateScript(t, s.say);
    assert.ok(chk.ok && chk.words <= NARRATION_MAX_WORDS, `${t.key}: ${chk.words} Wörter`);
    assert.ok(s.show[3].includes(DOMAIN));
    assert.ok(!speakable(s.say.join(" ")).includes("pokeswipe-radar.de"));
    assert.ok(proCaption(t, 0).caption.includes(DOMAIN));
  }
});

test("Feature-Vorlagen: Untertitel entsprechen exakt dem Briefing", () => {
  const show = (k: string) => proScript(templateByKey(k), 0).show.join(" ");
  assert.equal(show("f15binder"), "Keinen Überblick mehr, welche Pokémon-Karten dir im Set noch fehlen? Auf PokeSwipe Radar scannst du deine Karte ein und sie sortiert sich automatisch inklusive Live-Preis in deinen digitalen Set-Binder ein – mit realistischer Blättern-Funktion wie im echten Sammelalbum! Jetzt kostenlos testen auf pokeswipe-radar.de!");
  assert.equal(show("f15gaps"), "Im neuen digitalen Set-Binder auf PokeSwipe Radar siehst du auf einen Blick jede fehlende Karte als grauen Platzhalter. Ein Tipp auf die Lücke genügt – und du kannst die Karte direkt mit einem Klick auf unserem Marktplatz, bei eBay oder auf Cardmarket kaufen! Alles von einer Seite aus auf pokeswipe-radar.de!");
  assert.equal(show("f15dupes"), "Doppelte Pokémon-Karten verstauben nur in der Box? Auf PokeSwipe Radar stellst du Doppelte direkt aus dem digitalen Set-Binder mit einem Klick online – zum aktuellen Cardmarket-Preis oder direkt 5 bis 10 Prozent günstiger für den Blitzverkauf! Jetzt ausprobieren auf pokeswipe-radar.de!");
  assert.equal(show("f15all"), "Karten scannen, Set-Fortschritt checken, fehlende Hits mit einem Klick kaufen und doppelte Karten sofort zu Geld machen: Hol dir jetzt den digitalen Set-Binder und das Live-Sammler-Radar kostenlos im Browser auf pokeswipe-radar.de!");
});
