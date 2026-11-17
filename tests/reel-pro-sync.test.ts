import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { sceneTimes, captionChunks, audibleEnd, frameGrid, speedFor, PRO_LEAD, END_FADE } from "../client/reel-pro.js";
import { wordsFromAlignment } from "../server/voiceover.ts";

test("Pro-Sync: keine Szene beginnt, bevor der vorige Satz zu Ende gesprochen ist", () => {
  // Hook endet erst bei 3,1 s, CTA-Satz ist 3 s lang – früher wurde hier abgeschnitten
  const marks = [[0.35, 3.1], [3.2, 9.8], [10.1, 16.4], [16.5, 22.9], [23.0, 26.0]].map(([start, end]) => ({ start, end }));
  const D = 26.0 + END_FADE;
  const sc = sceneTimes(marks, D);
  for (let i = 1; i < 5; i++) {
    assert.ok(sc[i].start >= marks[i - 1].end - 1e-9, `Szene ${i} startet vor Satzende`);
    assert.ok(sc[i].start <= marks[i].start, `Szene ${i} startet nach Satzbeginn`);
    assert.equal(sc[i].start, sc[i - 1].end);
  }
  assert.equal(sc[4].end, D);
});

test("Pro-Sync: Videolänge liegt exakt auf dem Frame-Raster", () => {
  for (const fps of [30, 60]) {
    const { frames, duration } = frameGrid(PRO_LEAD + 24.517 + END_FADE, fps);
    assert.equal(frames, Math.ceil((PRO_LEAD + 24.517 + END_FADE) * fps));
    assert.equal(duration, frames / fps);
    assert.ok(duration >= PRO_LEAD + 24.517 + END_FADE);
    assert.equal(Math.round(duration * 48000) % (48000 / fps), 0); // Ton endet auf derselben Sample-Grenze
  }
  assert.equal(speedFor(25, 1), 1);
});

test("Pro-Sync: exakte Sprechdauer aus den PCM-Samples", () => {
  const sr = 48000, ch = new Float32Array(sr * 3);
  for (let i = 0; i < sr * 2.25; i++) ch[i] = Math.sin(i / 10) * 0.5; // 2,25 s Stimme, danach Stille
  const end = audibleEnd([ch], sr);
  assert.ok(end > 2.25 && end < 2.3, `gemessen ${end}`);
});

test("Pro-Sync: Untertitel nutzen die echten Wort-Zeitstempel", () => {
  const marks = [{ start: 1, end: 3 }];
  const words = [[{ start: 1, end: 1.4 }, { start: 1.5, end: 2.6 }, { start: 2.7, end: 3 }]];
  const c = captionChunks(["Das ist neu!"], marks, words);
  const flat = c.flatMap((x: any) => x.words);
  assert.deepEqual(flat.map((w: any) => [w.start, w.end]), [[1, 1.4], [1.5, 2.6], [2.7, 3]]);
  // ungleiche Wortanzahl → Rückfall auf Verteilung nach Zeichenlänge
  const f = captionChunks(["Über 55.000 Karten"], marks, [[{ start: 1, end: 3 }]]);
  assert.equal(f.flatMap((x: any) => x.words).length, 3);
});

test("Pro-Sync: Wort-Zeitstempel aus dem ElevenLabs-Alignment", () => {
  const lines = ["Hallo du.", "Neu hier"];
  const text = lines.join(" ");
  const chars = [...text];
  const al = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.08) };
  const w = wordsFromAlignment(lines, al)!;
  assert.equal(w.length, 2); assert.equal(w[0].length, 2); assert.equal(w[1].length, 2);
  assert.equal(w[0][0].start, 0); assert.equal(w[0][1].end, 0.88);
  assert.equal(w[1][0].start, 1.0);
  assert.equal(wordsFromAlignment(lines, { characters: ["x"] }), null);
});
