// Scanner-Upgrade: Nummern-Parser (TG/GG/SVP), fehlertolerante Namen, KI-Antwort, Kandidaten-Gewichtung,
// Spiegelungs-Unterdrückung, Schärfe und Stabilitäts-Erkennung.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCollectorNumber, normLocal, normalizeName, splitName, nameSimilarity, parseVisionResponse, rankCandidates, scoreCandidate,
  rarityClassOf, searchTerms, finishToVariant, type CatalogCandidate,
} from "../server/scan-vision-logic.ts";
import { suppressGlare, focusScore, sharpen, quadMotion, scaleQuad, STABLE_MOTION, glareRatio, type Gray } from "../server/scan-logic.ts";

test("Sammlernummern: normal, Trainer-Galerie, Galarian Gallery, Promos", () => {
  assert.deepEqual(parseCollectorNumber("142/191"), { local: "142", total: "191", setHint: "" });
  assert.deepEqual(parseCollectorNumber("185 / 165"), { local: "185", total: "165", setHint: "" });
  assert.deepEqual(parseCollectorNumber("TG15/TG30"), { local: "TG15", total: "TG30", setHint: "" });
  assert.deepEqual(parseCollectorNumber("GG05/GG70"), { local: "GG5", total: "GG70", setHint: "" });
  assert.equal(parseCollectorNumber("SVP 085")?.local, "85");
  assert.equal(parseCollectorNumber("SVP 085")?.setHint, "svp");
  assert.equal(parseCollectorNumber("SWSH123")?.local, "SWSH123");
  assert.equal(parseCollectorNumber("O25/198")?.local, "25");
  assert.equal(parseCollectorNumber(""), null);
  assert.equal(normLocal("085"), "85");
  assert.equal(normLocal("TG05"), "TG5");
});

test("Namen: Umlaute, Zusätze (ex/V/VMAX/VSTAR/GX), Mega, Tippfehler durch Holo-Glanz", () => {
  assert.equal(normalizeName("Glurak-ex"), "glurak ex");
  assert.equal(normalizeName("Flügelzahn"), "fluegelzahn");
  assert.deepEqual(splitName("Glurak ex"), { base: "glurak", suffix: "ex", mega: false });
  assert.deepEqual(splitName("Mega-Gengar-ex"), { base: "gengar", suffix: "ex", mega: true });
  assert.equal(splitName("Pikachu VMAX").suffix, "vmax");
  assert.equal(splitName("Arceus VSTAR").suffix, "vstar");
  assert.ok(nameSimilarity("Glurak ex", "Glurak-ex") > 0.99);
  assert.ok(nameSimilarity("Gluruk ex", "Glurak ex") > 0.8, "ein unscharfer Buchstabe");
  assert.ok(nameSimilarity("Glurak", "Glurak ex") < nameSimilarity("Glurak ex", "Glurak ex"));
  assert.ok(nameSimilarity("Pikachu V", "Pikachu VMAX") < 0.8);
  assert.ok(nameSimilarity("Bisasam", "Glurak") < 0.4);
  assert.deepEqual(searchTerms(parseVisionResponse('{"isPokemonCard":true,"name":"Glurak-ex","nameEn":"Charizard ex"}')!), ["glurak-ex", "glurak", "charizard ex", "charizard"]);
});

test("KI-Antwort wird robust gelesen und bereinigt", () => {
  const d = parseVisionResponse('Hier: {"isPokemonCard": true, "name": "Pikachu ex KP 200", "number": "TG05/TG30", "language": "de", "hp": "200", "rarityClass": "special_illustration_rare", "finish": "reverse_holo", "confidence": 3}')!;
  assert.equal(d.name, "Pikachu ex");
  assert.equal(d.local, "TG5");
  assert.equal(d.hp, 200);
  assert.equal(d.language, "de");
  assert.equal(d.rarityClass, "special_illustration_rare");
  assert.equal(d.confidence, 1);
  assert.equal(finishToVariant(d.finish), "reverse_holo");
  assert.equal(parseVisionResponse("kein json"), null);
  const x = parseVisionResponse('{"name":"x","finish":"glitter","language":"fr"}')!;
  assert.equal(x.finish, "normal");
  assert.equal(x.language, "other");
  assert.equal(x.isPokemonCard, false);
  assert.equal(rarityClassOf("Illustration rare"), "illustration_rare");
  assert.equal(rarityClassOf("Special illustration rare"), "special_illustration_rare");
  assert.equal(rarityClassOf("Double rare"), "double_rare");
});

test("Kandidaten: Nummer + Gesamtzahl schlagen gleichnamige Karten, Name fehlertolerant", () => {
  const det = parseVisionResponse('{"isPokemonCard":true,"name":"Glurak ex","number":"199/165","language":"de","hp":330,"illustrator":"Mitsuhiro Arita"}')!;
  const list: CatalogCandidate[] = [
    { key: "card:sv03.5-006", lang: "de", name: "Glurak-ex", localId: "006", total: 165, setCode: "MEW", setName: "151", hp: 330 },
    { key: "card:sv03.5-199", lang: "de", name: "Glurak-ex", localId: "199", total: 165, setCode: "MEW", setName: "151", hp: 330, illustrator: "Mitsuhiro Arita" },
    { key: "card:sv03-125", lang: "de", name: "Glurak-ex", localId: "125", total: 197, setCode: "OBF", setName: "Obsidianflammen", hp: 330 },
    { key: "card:sv03.5-004", lang: "de", name: "Glumanda", localId: "004", total: 165, setCode: "MEW", setName: "151" },
  ];
  const r = rankCandidates(det, list, 3);
  assert.equal(r[0].key, "card:sv03.5-199");
  assert.equal(r.length, 3);
  assert.ok(r[0].score - r[1].score > 0.3);
  // Tippfehler im Namen, Nummer stimmt → bleibt vorne
  const typo = parseVisionResponse('{"isPokemonCard":true,"name":"Gluruk ex","number":"199/165"}')!;
  assert.equal(rankCandidates(typo, list, 1)[0].key, "card:sv03.5-199");
  assert.ok(scoreCandidate(typo, list[3]) < scoreCandidate(typo, list[1]));
});

function flat(w: number, h: number, v: number): Gray { return { w, h, d: new Float32Array(w * h).fill(v) }; }

test("Spiegelungs-Unterdrückung ersetzt Glanzflecken durch die Umgebung", () => {
  const g = flat(40, 40, 100);
  for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) g.d[y * 40 + x] = 255;
  assert.ok(glareRatio(g) > 0);
  const out = suppressGlare(g);
  assert.equal(glareRatio(out), 0);
  assert.ok(Math.abs(out.d[12 * 40 + 12] - 100) < 1);
  assert.equal(suppressGlare(flat(10, 10, 50)).d[0], 50);
});

test("Schärfemaß, Nachschärfen und Stabilität", () => {
  const sharp = flat(40, 40, 0), soft = flat(40, 40, 0);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { sharp.d[y * 40 + x] = (x >> 2) % 2 ? 255 : 0; soft.d[y * 40 + x] = 128 + 20 * Math.sin(x / 6); }
  assert.ok(focusScore(sharp) > focusScore(soft) * 5);
  assert.ok(focusScore(sharpen(soft, 1.5)) >= focusScore(soft));
  const q: [number, number][] = [[0, 0], [100, 0], [100, 140], [0, 140]];
  assert.equal(quadMotion(q, q), 0);
  assert.ok(quadMotion(q, q.map(([x, y]) => [x + 1, y] as [number, number])) < STABLE_MOTION);
  assert.ok(quadMotion(q, q.map(([x, y]) => [x + 10, y] as [number, number])) > STABLE_MOTION);
  assert.equal(quadMotion(null, q), 1);
  assert.deepEqual(scaleQuad(q, 0.5)[0], [25, 35]);
});
