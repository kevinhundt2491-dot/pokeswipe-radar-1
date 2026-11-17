// Turbo-Scanner ohne KI: Sammlernummern aus OCR-Text, unscharfer Namensabgleich und die Entscheidung aus Text +
// Bild-Fingerabdruck (scan-text-logic.ts), dazu die gedrehten Ersatz-Zuschnitte für schief gehaltene Karten.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTextIndex, decideText, parseCollectorNumbers, nameCandidates, normName, splitLocalId, similarity, levenshtein, matchNames,
} from "../server/scan-text-logic.ts";
import { rotateQuad, scaleQuad, detectCard, sobel, type Gray } from "../server/scan-logic.ts";

const DE = [
  "card:sv03.5-199\tGlurak-ex\t199\t165\tMEW",
  "card:sv03.5-006\tGlurak-ex\t006\t165\tMEW",
  "card:sv03.5-205\tMew-ex\t205\t165\tMEW",
  "card:sv04-264\tGegenkescher\t264\t182\tPAR",
  "card:sv02-269\tNemila\t269\t193\tPAL",
  "card:swsh9tg-TG12\tKommandutan\tTG12\t30\tBRS:TG",
  "card:swsh10tg-TG12\tHoothoot\tTG12\t30\tASR:TG",
  "card:base1-4\tGlurak\t4\t102\tBS",
  "card:base4-4\tGlurak\t4\t102\tBS2",
].join("\n");
const EN = [
  "print:en:sv03.5-199\tCharizard ex\t199\t165\tMEW",
  "print:en:sv03.5-205\tMew ex\t205\t165\tMEW",
  "print:en:sv04-264\tCounter Catcher\t264\t182\tPAR",
  "print:en:sv02-269\tIono\t269\t193\tPAL",
  "print:en:svp-085\tPikachu with Grey Felt Hat\t085\t225\tSVP",
].join("\n");
const JA = ["print:ja:SV2a-205\tミュウex\t205\t165\tSV2a"].join("\n");
const idx = buildTextIndex([{ lang: "de", t: DE }, { lang: "en", t: EN }, { lang: "ja", t: JA }]);

test("Sammlernummern: normal, OCR-Verwechslungen, Unter-Sets, Promos, ohne Schrägstrich", () => {
  const r = parseCollectorNumbers("MEW DE 199/I65 ★\n045 / 198\nTG12/TG30\nSVP EN 085\nSWSH123");
  const t = r.map((x) => `${x.prefix}${x.num}/${x.total}${x.promo ? "p" : ""}${x.loose ? "l" : ""}`);
  assert.ok(t.includes("199/165"), t.join());
  assert.ok(t.includes("45/198"));
  assert.ok(t.includes("TG12/30"));
  assert.ok(t.includes("SVP85/0p"));
  assert.ok(t.includes("SWSH123/0p"));
  assert.deepEqual(parseCollectorNumbers("Mew 205 165 GAME FREAK").map((x) => [x.num, x.total, x.loose]), [[205, 165, true]]);
  // Unplausible Gesamtzahlen (Schadenswerte, „2/3“) werden ignoriert
  assert.equal(parseCollectorNumbers("2/3 KP 60").length, 0);
});

test("Lokale Nummern und Namens-Normalisierung", () => {
  assert.deepEqual(splitLocalId("006"), { prefix: "", num: 6 });
  assert.deepEqual(splitLocalId("TG12"), { prefix: "TG", num: 12 });
  assert.deepEqual(splitLocalId("SWSH123"), { prefix: "SWSH", num: 123 });
  assert.equal(splitLocalId("SV-P").num, -1);
  assert.equal(normName("Pokémon Glurak-ex"), "pokemonglurakex");
  assert.equal(normName("Weißes Pulver"), "weissespulver");
  assert.ok(nameCandidates("BASIS Glurak-ex KP 330\nPhase 2").includes("glurakex"));
  assert.ok(nameCandidates("Counter Ca tcher Item").includes("countercatcher"), "über OCR-Lücken hinweg zusammensetzen");
});

test("Unscharfer Abgleich: Levenshtein mit Abbruch, Ähnlichkeit, Namenssuche", () => {
  assert.equal(levenshtein("glurak", "glvrak"), 1);
  assert.equal(levenshtein("abcdef", "uvwxyz", 2), 3, "bricht ab, sobald das Maximum überschritten ist");
  assert.ok(similarity("lono", "iono") >= 0.72);
  assert.equal(similarity("pikachu", "glurak"), 0);
  assert.equal(matchNames(idx, ["glvrakex"])[0].norm, "glurakex");
});

test("Entscheidung: Nummer + Name → sicherer Treffer mit allen Sprachvarianten", () => {
  const d = decideText(idx, "Glvrak ex KP330\n199/I65");
  assert.equal(d.strength, "strong");
  assert.equal(d.via, "number+name");
  assert.deepEqual(d.keys, ["card:sv03.5-199", "print:en:sv03.5-199"]);
  // Sprachwahl bestimmt die Reihenfolge
  assert.equal(decideText(idx, "Charizard ex 199/165", [], ["en", "de"]).keys[0], "print:en:sv03.5-199");
});

test("Entscheidung: nur Nummer → mittel (Lock-on nötig), mit Bild-Treffer → sicher", () => {
  assert.equal(decideText(idx, "264/182").strength, "medium");
  const d = decideText(idx, "264/182", [{ key: "print:en:sv04-264", score: 20 }]);
  assert.equal(d.strength, "strong");
  assert.equal(d.via, "number+hash");
});

test("Entscheidung: mehrdeutige Nummer → Bild entscheidet, sonst nur Vorschläge", () => {
  const amb = decideText(idx, "4/102");
  assert.equal(amb.accepted, false);
  assert.equal(amb.candidates.length, 2);
  const d = decideText(idx, "4/102", [{ key: "card:base4-4", score: 30 }]);
  assert.equal(d.accepted, true);
  assert.deepEqual(d.keys, ["card:base4-4"]);
  // TG12 gibt es in mehreren Trainer-Galerien → Name entscheidet
  assert.deepEqual(decideText(idx, "Hoothoot TG12/TG30").keys, ["card:swsh10tg-TG12"]);
});

test("Entscheidung: Name + Bild-Treffer (auch ohne Nummer, Endung „ex“ fehlt, OCR-Fehler im Namen)", () => {
  const d = decideText(idx, "BASIC Mew HP 180", [{ key: "print:en:sv03.5-205", score: 16 }, { key: "card:sv03.5-199", score: 60 }]);
  assert.equal(d.strength, "strong");
  assert.equal(d.via, "name+hash");
  assert.ok(d.keys.includes("print:en:sv03.5-205"));
  assert.equal(decideText(idx, "Supporter lono", [{ key: "print:en:sv02-269", score: 22 }]).keys[0], "print:en:sv02-269");
  // Lose Nummer (ohne „/“) zählt nur mit Bild-Treffer
  assert.equal(decideText(idx, "xx 205 165").accepted, false);
  assert.equal(decideText(idx, "xx 205 165", [{ key: "print:en:sv03.5-205", score: 30 }]).accepted, true);
});

test("Entscheidung: Promo mit langem Namen, widersprüchlicher Name, Leertext", () => {
  const d = decideText(idx, "Pikachu SVP EN 085");
  assert.equal(d.strength, "strong");
  assert.deepEqual(d.keys, ["print:en:svp-085"]);
  // Nummer eindeutig, aber gut gelesener, ganz anderer Name → nur Vorschlag
  assert.equal(decideText(idx, "Counter Catcher 199/165").accepted, false);
  assert.equal(decideText(idx, "").strength, "none");
  assert.equal(decideText(buildTextIndex([]), "199/165").strength, "none");
});

test("Gedrehte Ersatz-Zuschnitte und Kantensuche mit vorberechnetem Gradienten", () => {
  const q: [number, number][] = [[0, 0], [10, 0], [10, 20], [0, 20]];
  const r = rotateQuad(q, 90);
  assert.ok(Math.abs(r[0][0] - 15) < 1e-9 && Math.abs(r[0][1] - 5) < 1e-9, JSON.stringify(r[0]));
  assert.deepEqual(rotateQuad(q, 0), q);
  assert.deepEqual(scaleQuad(q, 1), q);
  // detectCard liefert mit und ohne übergebenen Gradienten dasselbe
  const w = 120, h = 160, d = new Float32Array(w * h).fill(30);
  for (let y = 20; y < 140; y++) for (let x = 20; x < 106; x++) d[y * w + x] = 220;
  const g: Gray = { w, h, d };
  const guide = { x0: 20, y0: 20, x1: 106, y1: 140 };
  assert.deepEqual(detectCard(g, guide, sobel(g)), detectCard(g, guide));
});
