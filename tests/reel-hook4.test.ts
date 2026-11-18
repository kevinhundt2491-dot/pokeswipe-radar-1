import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { PRO_TEMPLATES, templateByKey, proScript, checkProScript, sceneTimes, scenesFor, choreoMarks, segmentReport, speedFor, secondsFor, bitrateFor, estimateMb, frameGrid, captionChunks, proCaption, isHook4, HOOK4_SCENES, HOOK4_SEGMENTS, SPAM_TAGS, SPEED_CAP, PRO_LEAD, END_FADE, DOMAIN } from "../client/reel-pro.js";
// @ts-ignore – Client-Modul ohne Typen
import { CHOREO } from "../client/reel-scenarios.js";
import { PRO_TEMPLATE_KEYS, PRO_TEMPLATE_LABELS, HOOK_PRESET_KEYS, cleanVideoConfig } from "../server/reel-video-logic.ts";
import { SPEED_MAX, speakable, NARRATION_MAX_WORDS } from "../server/voiceover.ts";

const HOOKS = ["fomo", "flea", "chase"];

test("Hook-Presets: 3 Vorlagen, 4 Sätze, 15–17 s, 8 Mbit/s, eigene Choreografie", () => {
  const list = PRO_TEMPLATES.filter(isHook4);
  assert.deepEqual(list.map((t: any) => t.key), HOOKS);
  assert.deepEqual([...HOOK_PRESET_KEYS], HOOKS);
  for (const t of list) {
    assert.ok((PRO_TEMPLATE_KEYS as readonly string[]).includes(t.key) && PRO_TEMPLATE_LABELS[t.key]);
    assert.deepEqual(secondsFor(t), [15, 17]);
    assert.equal(t.mbit, 8); assert.equal(t.cbr, true);
    assert.deepEqual(scenesFor(t), HOOK4_SCENES);
    assert.ok(CHOREO[t.choreo] && CHOREO[t.choreo].beats.length === 4, `${t.key}: Choreografie ${t.choreo}`);
    const s = proScript(t, 0);
    assert.equal(s.say.length, 4); assert.equal(s.show.length, 4);
    const chk = checkProScript(s.say);
    assert.ok(chk.ok && chk.words <= NARRATION_MAX_WORDS, `${t.key}: ${chk.words} Wörter`);
    assert.ok(s.show[3].includes(DOMAIN), `${t.key}: Domain im letzten Untertitel`);
    assert.ok(/\?/.test(s.say[3]), `${t.key}: endet mit einer Frage`);
    assert.ok(t.question.endsWith("👇"));
    // kein „Like & Abo“-Betteln
    assert.ok(!/(like|abo|abonnier|folg)/i.test([...s.say, t.question].join(" ").replace(/likest/i, "")), `${t.key}: kein Like/Abo`);
    // Sprecher-Text ist nach der Server-Aufbereitung sprechbar (keine Domain-Buchstabiererei)
    assert.ok(!speakable(s.say.join(" ")).includes("pokeswipe-radar.de"));
  }
});

test("Hook-Presets: exakte Texte aus dem Briefing (Banner, Euro-Zahlen, Fragen)", () => {
  const f = templateByKey("fomo"), fl = templateByKey("flea"), c = templateByKey("chase");
  assert.equal(proScript(f).cover, "HÖR AUF ZU VIEL ZU ZAHLEN 🛑");
  assert.deepEqual([f.hookBadge.label, f.hookBadge.from, f.hookBadge.tag, f.hookBadge.to], ["Marktwert", "65 €", "Deal", "29 €"]);
  assert.ok(proScript(f).say[0].startsWith("Hör auf, Pokémon-Karten zum vollen Preis zu kaufen"));
  assert.equal(f.question, "Welche Karte soll ich als Nächstes checken? 👇");
  assert.equal(proScript(fl).cover, "FLOHMARKT-FALLE VERMEIDEN ⚠️");
  assert.deepEqual([fl.hookBadge.from, fl.hookBadge.to], ["45 €", "14 €"]);
  assert.equal(fl.usp.badge.includes("Kein Download nötig"), true);
  assert.equal(fl.question, "Dein bester Flohmarkt-Fund? 👇");
  assert.equal(proScript(c).cover, "SO SUCHT MAN HEUTE CHASE-KARTEN 🔥");
  assert.equal(c.question, "Welche Karte fehlt dir im Binder? 👇");
  // Umlaute bleiben unverändert erhalten (kein toUpperCase() auf ß o. Ä.)
  assert.ok(/Ä|Ö|Ü/.test(proScript(f).cover) && /ä|ö|ü|ß/.test(proScript(f).say.join(" ")));
});

test("Hook-Presets: Szenen folgen den Satz-Zeitstempeln – Testlauf mit 16,5 s Sprechzeit", () => {
  // simulierte ElevenLabs-Zeitstempel (Satzgrenzen nach Sprechpausen), Vorlauf 0,35 s
  const raw = [[0, 2.45], [2.6, 7.4], [7.55, 12.3], [12.45, 15.3]];
  const marks = raw.map(([a, b]) => ({ start: PRO_LEAD + a, end: PRO_LEAD + b }));
  const { frames, duration: D } = frameGrid(PRO_LEAD + 15.3 + END_FADE, 30);
  assert.equal(frames, Math.ceil((PRO_LEAD + 15.3 + END_FADE) * 30));
  const sc = sceneTimes(marks, D, HOOK4_SCENES);
  assert.deepEqual(sc.map((x: any) => x.key), HOOK4_SCENES);
  for (let i = 1; i < 4; i++) {
    assert.equal(sc[i].start, sc[i - 1].end);
    assert.ok(sc[i].start >= marks[i - 1].end - 1e-9 && sc[i].start <= marks[i].start);
  }
  const rep = segmentReport(sc);
  assert.ok(rep.ok, JSON.stringify(rep));
  assert.ok(rep.rows[0].end <= 3.5, "Hook in den ersten 3 s");
  assert.ok(rep.duration >= 15 && rep.duration <= 17.05);
  const cm = choreoMarks(sc);
  assert.equal(cm.length, 4); assert.equal(cm[0].start, 0); assert.equal(cm[1].start, sc[1].start); assert.equal(cm[3].start, sc[2].start);
  // Untertitel bleiben innerhalb ihrer Sätze
  const s = proScript(templateByKey("fomo"));
  const ch = captionChunks(s.show, marks);
  for (const c of ch) assert.ok(c.start >= marks[0].start - 1e-9 && c.end <= D);
});

test("Hook-Presets: ohne Sprecherin gilt exakt der Soll-Zeitplan 0–3 / 3–8 / 8–13 / 13–17 s", () => {
  const sc = sceneTimes([], 17, HOOK4_SCENES);
  assert.deepEqual(sc.map((x: any) => [x.start, x.end]), [[0, 3], [3, 8], [8, 13], [13, 17]]);
  assert.ok(segmentReport(sc, HOOK4_SEGMENTS, 0).ok);
  // zu lange Aufnahme wird als Abweichung gemeldet
  const long = sceneTimes([0, 4, 10, 17].map((a, i, arr) => ({ start: a, end: (arr[i + 1] ?? 22) - 0.2 })), 22.5, HOOK4_SCENES);
  assert.equal(segmentReport(long).ok, false);
});

test("Hook-Presets: 8 Mbit/s, 9:16 – Datei bleibt klein; Tempo bis 1,2 für 15–17 s", () => {
  for (const sec of [15, 17, 22]) {
    assert.equal(bitrateFor(sec, 8), 8);
    assert.ok(estimateMb(sec, 8) < 25, `${sec}s`);
  }
  assert.equal(SPEED_CAP, 1.2); assert.equal(SPEED_MAX, 1.2);
  assert.ok(speedFor(19, 1.2, [15, 17], 1.2) === 1.2);
  assert.ok(speedFor(12, 1.2, [15, 17], 1.2) < 1.2);
  assert.equal(speedFor(15, 1.2, [15, 17], 1.2), 1.2);
  // Standard-Vorlagen bleiben bei höchstens 1,12
  assert.ok(speedFor(40, 1.04) <= 1.12);
  assert.ok(cleanVideoConfig({ templates: HOOKS }).templates.length === 3);
});

test("Hook-Presets: Caption mit Kommentar-Frage, genau 3 Nischen-Hashtags, keine Spam-Tags", () => {
  for (const k of HOOKS) {
    const t = templateByKey(k);
    const c = proCaption(t, 0, { card: "Glurak ex" });
    assert.deepEqual(c.hashtags, ["#pokemontcgdeutsch", "#pokemonkarten", "#pokémonsammler"]);
    for (const spam of SPAM_TAGS) assert.ok(!c.caption.toLowerCase().includes(spam), `${k}: ${spam}`);
    assert.ok(!/#(fyp|viral|foryou)/i.test(c.caption));
    assert.ok(c.caption.startsWith(proScript(t).cover));
    assert.ok(c.caption.includes(c.question) && c.question.length > 10 && !c.question.includes("👇"));
    assert.ok(c.caption.includes(DOMAIN) && /kein App-Store-Download/i.test(c.caption));
    assert.ok(!/(lasst|lass) (ein|mal ein) like|like (&|und) abo|abonnier/i.test(c.caption));
    assert.ok(c.title.length <= 100);
  }
});
