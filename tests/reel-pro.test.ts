import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { PRO_TEMPLATES, proScript, checkProScript, sceneTimes, choreoMarks, bitrateFor, shrinkBitrate, estimateMb, speedFor, secondsFor, captionChunks, proCaption, templateByKey, SAFE_MB, MB, DOMAIN } from "../client/reel-pro.js";
import { cleanVideoConfig, rotationAt, PRO_TEMPLATE_KEYS, DEFAULT_VIDEO } from "../server/reel-video-logic.ts";

test("Pro-Videos: alle Vorlagen, je 5 Sätze, Wortlimit für 20–30 s, Server-Grenze 72 Wörter", () => {
  assert.deepEqual(PRO_TEMPLATES.map((t: any) => t.key), [...PRO_TEMPLATE_KEYS]);
  for (const t of PRO_TEMPLATES.filter((x: any) => x.format !== "hook4")) for (const v of [0, 1]) {
    const s = proScript(t, v);
    assert.equal(s.say.length, 5); assert.equal(s.show.length, 5);
    const chk = checkProScript(s.say);
    assert.ok(chk.ok && chk.words <= 72, `${t.key}/${v}: ${chk.words} Wörter`);
    assert.ok(s.say.join(" ").length <= 900);
    assert.ok(s.show[4].includes(DOMAIN));
    assert.ok(t.badges.length === 4 && t.trust.length === 4 && t.stats.length === 3);
  }
});

test("Pro-Videos: Szenen 1–5 lückenlos, Cover 1,6–2,4 s, Endscreen ≥ 2,2 s", () => {
  const marks = [[0.35, 2], [2.1, 8.8], [9, 16.5], [16.8, 22.6], [23, 25.4]].map(([start, end]) => ({ start, end }));
  const sc = sceneTimes(marks, 26.3);
  assert.deepEqual(sc.map((s: any) => s.key), ["cover", "focus", "benefit", "trust", "cta"]);
  assert.equal(sc[0].start, 0); assert.ok(sc[1].start >= 1.6 && sc[1].start <= 2.4);
  for (let i = 1; i < 5; i++) assert.equal(sc[i].start, sc[i - 1].end);
  assert.ok(sc[4].end - sc[4].start >= 2.2); assert.equal(sc[4].end, 26.3);
  const cm = choreoMarks(sc);
  assert.equal(cm.length, 4); assert.equal(cm[0].start, sc[1].start); assert.equal(cm[3].start, sc[3].start);
});

test("Pro-Videos: Bitrate hält 95 MB sicher ein und wird bei Übergröße reduziert", () => {
  for (const sec of [20, 26, 30, 36]) {
    const m = bitrateFor(sec, 16);
    assert.ok(m <= 16 && estimateMb(sec, m) < SAFE_MB, `${sec}s → ${m} Mbit/s`);
  }
  assert.equal(bitrateFor(30, 15), 15); // bei 30 s bleibt die volle Qualität
  assert.equal(bitrateFor(30, 18), 18); // 18 Mbit/s (Standard) passt bei 30 s unter 95 MB
  assert.equal(bitrateFor(30, 20), 20); // 20 Mbit/s (Maximum) ebenfalls
  assert.ok(estimateMb(30, 18) < 75 && estimateMb(30, 20) < SAFE_MB);
  const smaller = shrinkBitrate(15, 110 * MB);
  assert.ok(smaller < 15 * (95 / 110));
});

test("Pro-Videos: Tempo bringt die Länge in 20–30 s", () => {
  assert.equal(speedFor(25, 1.04), 1.04);
  assert.ok(speedFor(31, 1.04) > 1.04 && speedFor(31, 1.04) <= 1.12);
  assert.ok(speedFor(17, 1.04) < 1.04 && speedFor(17, 1.04) >= 0.9);
});

test("Pro-Videos: Untertitel in kurzen Häppchen, zeitlich innerhalb der Sätze", () => {
  const s = proScript(PRO_TEMPLATES[0], 0);
  const marks = s.show.map((_: any, i: number) => ({ start: i * 5, end: i * 5 + 4.5 }));
  const ch = captionChunks(s.show, marks);
  assert.ok(ch.length > 10);
  for (const c of ch) {
    assert.ok(c.words.length >= 1 && c.words.length <= 4);
    assert.ok(c.start <= c.end && c.end <= 25);
  }
  assert.equal(ch.flatMap((c: any) => c.words.map((w: any) => w.w)).join(" "), s.show.join(" "));
});

test("Pro-Videos: Beschreibungstext mit Hook, CTA zu pokeswipe-radar.de und Hashtags", () => {
  for (const t of PRO_TEMPLATES.filter((x: any) => x.format !== "hook4")) {
    const c = proCaption(t, 1, { card: "Glurak ex" });
    assert.ok(c.caption.startsWith(proScript(t, 1).cover));
    assert.ok(c.caption.includes("pokeswipe-radar.de"));
    assert.ok(c.caption.includes("Glurak ex"));
    assert.ok(c.hashtags.length >= 6 && c.hashtags.length <= 10);
    assert.ok(c.hashtags.includes("#PokemonTCG"));
    assert.ok(c.title.length <= 100);
  }
});

test("Pro-Videos: Einstellungen werden begrenzt, Rotation wechselt Vorlage und Hook", () => {
  const c = cleanVideoConfig({ fps: 120, mbit: 40, maxMb: 300, tone: "x", templates: ["radar", "foo", "market"] });
  assert.equal(c.fps, 30); assert.equal(c.mbit, 20); assert.equal(c.maxMb, 95); assert.equal(c.tone, "energetic");
  assert.deepEqual(c.templates, ["radar", "market"]);
  assert.deepEqual(cleanVideoConfig({ templates: [] }).templates, [...PRO_TEMPLATE_KEYS]);
  assert.deepEqual(rotationAt(c, 0), { template: "radar", variant: 0, index: 0 });
  assert.deepEqual(rotationAt(c, 3), { template: "market", variant: 1, index: 3 });
  assert.equal(DEFAULT_VIDEO.maxMb, 95);
});

// @ts-ignore – Client-Modul ohne Typen
import { lookFor, LOOK_COLORS, cardImageUrl, pickCoverCard } from "../client/reel-pro.js";
import { coverHistory } from "../server/make.ts";

test("Startbilder: jede Vorlage hat Themen-Badge und eigene Schlagzeile je Variante", () => {
  const covers = new Set();
  const std = PRO_TEMPLATES.filter((x: any) => x.format !== "hook4");
  for (const t of std) for (const v of [0, 1]) {
    const s = proScript(t, v);
    assert.ok(s.badge && s.badge === s.badge.toUpperCase(), `${t.key}/${v} Badge`);
    assert.ok(s.cover.length >= 20 && s.cover.length <= 60, `${t.key}/${v}: ${s.cover}`);
    covers.add(s.cover);
  }
  assert.equal(covers.size, std.length * 2);
});

test("Startbilder: aufeinanderfolgende Videos unterscheiden sich in Farbe UND Layout", () => {
  for (let i = 0; i < 60; i++) {
    const a = lookFor(i), b = lookFor(i + 1), c = lookFor(i + 2);
    assert.notEqual(a.accent, b.accent); assert.notEqual(a.layout, b.layout);
    assert.equal(new Set([a.accent, b.accent, c.accent]).size, 3);
    assert.equal(new Set([a.layout, b.layout, c.layout]).size, 3);
  }
  assert.equal(LOOK_COLORS.length, 6);
});

test("Startbilder: Kartenmotiv wechselt, Bild-URL und Preisverlauf sind brauchbar", () => {
  assert.equal(cardImageUrl("https://assets.tcgdex.net/de/sv/sv03.5/199"), "https://assets.tcgdex.net/de/sv/sv03.5/199/high.webp");
  assert.equal(cardImageUrl("https://assets.tcgdex.net/de/sm/sm9/169/high.webp"), "https://assets.tcgdex.net/de/sm/sm9/169/high.webp");
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(pickCoverCard(cards, ["a", "b"]).id, "c");
  assert.equal(pickCoverCard(cards, ["a", "b", "c"]).id, "a");
  assert.equal(pickCoverCard([], []), null);
  assert.deepEqual(coverHistory({ history: [5], avg30: 10, avg7: 12, price: 11 }), [10, 12, 11]);
  assert.deepEqual(coverHistory({ history: [1, 2, 3], avg30: 10 }), [1, 2, 3]);
});

test("Pro-Video „Scannen & Verkaufen“: 15–20 s, 8 Mbit/s, Promo-Link START30 und eigener Endscreen", () => {
  const t = templateByKey("scansell");
  assert.ok(t);
  assert.deepEqual(secondsFor(t), [15, 20]);
  assert.deepEqual(secondsFor(templateByKey("overview")), [20, 30]);
  assert.equal(t.mbit, 8);
  const s = proScript(t, 0);
  assert.equal(s.cover, "Pokémon-Karten verkaufen in 10 Sekunden?! 🤯⚡");
  assert.ok(s.say[0].startsWith("Pokémon-Karten verkaufen war noch nie so schnell"));
  assert.ok(/Gratis-Wochen/.test(s.say[4]) && s.show[4].includes(DOMAIN));
  const c = proCaption(t, 0, { card: "Glurak ex" });
  assert.ok(c.caption.includes("https://pokeswipe-radar.de/?promo=START30"));
  assert.ok(/Freunde einladen/.test(c.caption));
  assert.ok(c.hashtags.includes("#PokemonVerkaufen"));
  // Tempo für die kurze Vorlage: 22 s Sprechzeit → schneller (höchstens 1,12), 15–20 s bleibt unverändert
  assert.ok(speedFor(22, 1.04, [15, 20]) > 1.04 && speedFor(22, 1.04, [15, 20]) <= 1.12);
  assert.equal(speedFor(17, 1.04, [15, 20]), 1.04);
});

test("Pro-Video „Scannen & direkt inserieren“: echte Scan-Choreografie, 20–30 s, Fokus auf Tempo & Einfachheit", () => {
  const t = templateByKey("quicklist");
  assert.ok(t);
  assert.equal(t.choreo, "scansell");
  assert.equal(t.tab, "scan");
  assert.deepEqual(secondsFor(t), [20, 30]);
  for (const v of [0, 1]) {
    const s = proScript(t, v);
    assert.ok(checkProScript(s.say).ok);
    assert.ok(/Abtippen|Sekunden/.test(s.say.join(" ")));
    assert.ok(s.show[4].includes(DOMAIN));
  }
  const c = proCaption(t, 0, { card: "Glurak ex" });
  assert.ok(c.caption.includes("pokeswipe-radar.de"));
  assert.ok(c.hashtags.includes("#PokemonVerkaufen"));
});
