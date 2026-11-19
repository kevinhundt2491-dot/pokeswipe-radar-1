import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { SHOWCASE_TEMPLATES, ALL_TEMPLATES, PRO_TEMPLATES, templateByKey, proScript, proCaption, showcaseScript, checkTemplateScript, checkProScript, showcaseScenes, showcaseMarks, showcaseCues, showcaseSpec, showcaseCaption, scenesFor, secondsFor, frameGrid, bitrateFor, estimateMb, captionChunks, isShowcase, isHook4, SHOWCASE_SCENES, SHOWCASE_PLAN, SHOWCASE_TIMELINE, SHOWCASE_PRO_AT, SHOWCASE_MBIT_RANGE, TAP_LEAD, PRO_LEAD, END_FADE, DOMAIN, SAFE_MB } from "../client/reel-pro.js";
// @ts-ignore – Client-Modul ohne Typen
import { CHOREO } from "../client/reel-scenarios.js";
import { PRO_TEMPLATE_KEYS, PRO_TEMPLATE_LABELS, SHOWCASE_TEMPLATE_KEYS, VIDEO_TEMPLATE_KEYS, cleanVideoConfig, rotationAt, DEFAULT_VIDEO } from "../server/reel-video-logic.ts";
import { NARRATION_MAX_WORDS, SHOWCASE_MAX_WORDS, narrationMaxWords, speakable, countWords } from "../server/voiceover.ts";
import { showcaseBinderFill, binderCardAt, buildBinderCards, paginate, SHOWCASE_GAPS, BINDER_PAGE_SIZE } from "../server/binder-logic.ts";

const BRIEF = "So sieht moderner Kartenhandel heute aus: Karte vor die Handykamera halten – der Live-Scanner erkennt sie sofort mit aktuellem Preis und sortiert sie direkt in deinen digitalen Set-Ordner. Beim Durchblättern siehst du sofort, welche Karten dir noch fehlen – und sobald ein anderer Sammler sie anbietet, leuchtet der Preis direkt auf der Lücke auf. Ein Tipp zum Kaufen, Tauschen oder eigenen Verkaufen. Und mit dem Pro-Abo sicherst du dir zusätzlich sofortige Preis-Alarme und Top-Boosts. Jetzt kostenlos testen auf pokeswipe-radar.de.";

const tpl = templateByKey("showcase");

test("Showcase: Vorlage „Pro-Showcase: Volle App- & Pro-Abo-Power“ – 29 s, 60 FPS, 10–12 Mbit/s, 4 Szenen", () => {
  assert.ok(tpl && isShowcase(tpl) && !isHook4(tpl));
  assert.equal(tpl.label, "Pro-Showcase: Volle App- & Pro-Abo-Power");
  assert.deepEqual(SHOWCASE_TEMPLATES.map((t: any) => t.key), ["showcase"]);
  // Showcase-Familie: Pro-Showcase + Master-Vorlage „autobinder“ (tests/reel-autobinder.test.ts)
  assert.deepEqual(ALL_TEMPLATES.map((t: any) => t.key), [...PRO_TEMPLATES.map((t: any) => t.key), "showcase", "autobinder", "shortscan", "shortbinder", "shortmarket", "shortitems"]);
  // bestehende Vorlagen-Liste bleibt unverändert
  assert.ok(!PRO_TEMPLATES.includes(tpl));
  assert.equal(tpl.exact, 29); assert.deepEqual(secondsFor(tpl), [29, 29]);
  assert.equal(tpl.fps, 60);
  assert.ok(tpl.mbit >= SHOWCASE_MBIT_RANGE[0] && tpl.mbit <= SHOWCASE_MBIT_RANGE[1]);
  assert.deepEqual(scenesFor(tpl), SHOWCASE_SCENES);
  assert.ok(CHOREO[tpl.choreo] && CHOREO[tpl.choreo].beats.length === 4);
  assert.equal(tpl.tab, "scan");
});

test("Showcase: Voiceover ist exakt das Briefing-Skript (Untertitel mit Domain, Sprecherin ohne Buchstabieren)", () => {
  const s = proScript(tpl, 0);
  assert.deepEqual(s, showcaseScript(tpl, 0));
  assert.equal(s.show.join(" "), BRIEF);
  assert.equal(s.say.length, 5);
  assert.ok(s.show[4].includes(DOMAIN));
  assert.ok(!speakable(s.say.join(" ")).includes(DOMAIN));
  const chk = checkTemplateScript(tpl, s.say);
  assert.ok(chk.ok, JSON.stringify(chk));
  assert.ok(chk.words > NARRATION_MAX_WORDS && chk.words <= SHOWCASE_MAX_WORDS);
  assert.equal(narrationMaxWords("showcase"), SHOWCASE_MAX_WORDS);
  assert.equal(narrationMaxWords(undefined), NARRATION_MAX_WORDS);
  assert.ok(countWords(s.say) <= narrationMaxWords(tpl.format));
  // Standard-Prüfung der übrigen Vorlagen bleibt bei 52–72 Wörtern
  assert.equal(checkProScript(s.say).ok, false);
  assert.ok(s.say.join(" ").length <= 900);
});

test("Showcase: fester Regie-Zeitplan 0–6 / 6–15 / 15–23 / 23–29 s, frame-genau 1740 Frames bei 60 FPS", () => {
  const { frames, duration } = frameGrid(tpl.exact, tpl.fps);
  assert.equal(frames, 1740); assert.equal(duration, 29);
  const sc = showcaseScenes(duration);
  assert.deepEqual(sc.map((x: any) => [x.key, x.start, x.end]), [["scan", 0, 6], ["binder", 6, 15], ["market", 15, 23], ["finale", 23, 29]]);
  assert.deepEqual(showcaseMarks(sc).map((m: any) => m.start), [0, 6, 15, 23]);
  assert.deepEqual([...SHOWCASE_PLAN], [0, 6, 15, 23, 29]);
  assert.ok(SHOWCASE_PRO_AT > 15 && SHOWCASE_PRO_AT < 23);
  // Sprecherin passt mit Vorlauf und Ausblenden in 29 s
  assert.ok(PRO_LEAD + END_FADE < 2);
});

test("Showcase: Live-Aktionen liegen in ihrer Szene (Scanner → Binder → Marktplatz/Chat → Start)", () => {
  const T = SHOWCASE_TIMELINE;
  const inScene = (t: number, a: number, b: number) => t >= a && t < b;
  for (const k of ["scanStart", "condTap", "condPick", "binderTap", "navCollection"]) assert.ok(inScene(T[k] + TAP_LEAD, 0, 6), k);
  for (const k of ["binderOpen", "flip1", "flip2", "flipBack", "badgeOn", "missingTap"]) assert.ok(inScene(T[k], 6, 15), k);
  for (const k of ["marketPan", "buyTap", "priceGlow", "swipeTab", "chatTab", "homeTap"]) assert.ok(inScene(T[k], 15, 23), k);
  // aufsteigend und Beat-Start (Szenenstart − 0,15 s) wird nie unterschritten
  const order = Object.entries(T).filter(([k]) => k !== "scanMs").map(([, v]) => v as number);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
  assert.ok(T.binderOpen >= 6 - 0.15 && T.marketPan >= 15 - 0.15);
});

test("Showcase: Mikro-Sounddesign – Scanner-Beep, Blättern, Erfolgs-Pling, Taps exakt auf den Aktionen", () => {
  const sc = showcaseScenes(29);
  const cues = showcaseCues(sc);
  const T = SHOWCASE_TIMELINE;
  const of = (type: string) => cues.filter(([, k]: any) => k === type).map(([t]: any) => t);
  assert.equal(of("beep").length, 1);
  assert.ok(Math.abs(of("beep")[0] - (T.scanStart + T.scanMs / 1000)) < 1e-6, "Beep, wenn der Scan fertig ist");
  assert.equal(of("page").length, 3);
  for (const t of of("page")) assert.ok(t > 6 && t < 15);
  assert.equal(of("pling").length, 2);
  assert.ok(of("pling").some((t: number) => Math.abs(t - T.badgeOn) < 1e-6), "Pling beim Aufleuchten des Lücken-Badges");
  assert.ok(of("pling").some((t: number) => Math.abs(t - T.priceGlow) < 1e-6), "Pling beim Marktplatz-Preis");
  assert.ok(of("tap").length >= 8);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i][0] >= cues[i - 1][0]);
  for (const [t] of cues) assert.ok(t >= 0 && t <= 29);
});

test("Showcase: Text-Overlays aus dem Briefing, Pro-Abo-Vorteile und Abschluss", () => {
  assert.deepEqual(tpl.overlays, {
    scan: "Dein kompletter Karten-Manager im Browser",
    binder: "Fehlende Karten im Ordner? Sofort finden, tauschen oder kaufen",
    market: "Mit Pro-Abo: Sofortige Preis-Alarme & Top-Boosts für deine Karten",
    finale: "pokeswipe-radar.de – Kostenlos starten, kein Download",
  });
  assert.deepEqual(tpl.pro.map((p: any) => p[1]), ["Sofortige Preis-Radar-Alarme", "Top-Boosts für deine Inserate", "Unbegrenzte Sammlungs-Analysen"]);
  assert.equal(tpl.finale.domain, DOMAIN);
  assert.equal(tpl.finale.sub, "Kostenlos starten, kein Download");
  assert.equal(tpl.marketBadge, 29.9);
});

test("Showcase: Untertitel wortweise, in kurzen Häppchen, innerhalb der Sprechzeit", () => {
  const s = proScript(tpl, 0);
  const marks = [[0.35, 9.6], [9.8, 18.9], [19.1, 21.2], [21.4, 25.2], [25.4, 27.6]].map(([start, end]) => ({ start, end }));
  const ch = captionChunks(s.show, marks);
  for (const c of ch) { assert.ok(c.words.length >= 1 && c.words.length <= 4); assert.ok(c.end <= 29); }
  assert.equal(ch.flatMap((c: any) => c.words.map((w: any) => w.w)).join(" "), BRIEF);
});

test("Showcase: Datei bleibt bei 11 Mbit/s klein (Make.com ≤ 95 MB), Spezifikation wird geprüft", () => {
  assert.equal(bitrateFor(29, tpl.mbit), tpl.mbit);
  assert.ok(estimateMb(29, tpl.mbit) < 45 && estimateMb(29, tpl.mbit) < SAFE_MB);
  assert.ok(showcaseSpec(tpl, { duration: 29, fps: 60, mbit: 11 }).ok);
  const bad = showcaseSpec(tpl, { duration: 30.2, fps: 30, mbit: 18 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.checks, { duration: false, fps: false, bitrate: false, size: true });
});

test("Showcase: Beschreibung für Make.com mit Hook, CTA zu pokeswipe-radar.de und 6–10 Hashtags", () => {
  for (const v of [0, 1]) {
    const c = proCaption(tpl, v, { card: "Glurak ex" });
    assert.deepEqual(c, showcaseCaption(tpl, v, { card: "Glurak ex" }));
    assert.ok(c.caption.startsWith(proScript(tpl, v).cover));
    assert.ok(c.caption.includes("pokeswipe-radar.de") && c.caption.includes("Glurak ex"));
    assert.ok(c.hashtags.length >= 6 && c.hashtags.length <= 10 && c.hashtags.includes("#PokemonTCG"));
    assert.ok(c.title.length <= 100);
    assert.ok(proScript(tpl, v).cover.length >= 20 && proScript(tpl, v).cover.length <= 60);
  }
});

test("Showcase: Admin-Zentrale kann die Vorlage in die Rotation aufnehmen, Standard bleibt unverändert", () => {
  assert.deepEqual([...SHOWCASE_TEMPLATE_KEYS], ["showcase"]);
  assert.deepEqual([...VIDEO_TEMPLATE_KEYS], [...PRO_TEMPLATE_KEYS, "showcase", "autobinder", "shortscan", "shortbinder", "shortmarket", "shortitems"]);
  assert.ok(PRO_TEMPLATE_LABELS.showcase.includes("29 s"));
  assert.deepEqual(DEFAULT_VIDEO.templates, [...PRO_TEMPLATE_KEYS]);
  const c = cleanVideoConfig({ templates: ["radar", "showcase", "x"] });
  assert.deepEqual(c.templates, ["radar", "showcase"]);
  assert.equal(rotationAt(c, 1).template, "showcase");
  assert.ok(templateByKey(rotationAt(c, 1).template));
});

test("Showcase: Demo-Ordner aus echtem Set-Katalog – gefüllte Seiten, Lücke in der Mitte von Seite 2 mit 29,90 €", () => {
  const catalog = Array.from({ length: 40 }, (_, i) => ({ id: `sv03.5-${String(i + 1).padStart(3, "0")}`, name: `Karte ${i + 1}`, image: "", localId: String(i + 1), price: 2 + i }));
  const owned = showcaseBinderFill(catalog);
  assert.equal(owned.length, 3 * BINDER_PAGE_SIZE - SHOWCASE_GAPS.length);
  assert.ok(owned.every((o) => o.condition === "NM" || o.condition === "EX"));
  const hero = binderCardAt(catalog, SHOWCASE_GAPS[3]);
  assert.equal(hero?.id, "sv03.5-014"); // Index 13 = Mitte der 2. Ordnerseite
  const cards = buildBinderCards({ catalog, owned, myListings: [], marketListings: [{ id: -1, cardId: hero!.id, price: 29.9, userId: "reel-demo-seller" }], viewerId: "admin" });
  const pages = paginate(cards);
  const slot = pages[1][4];
  assert.equal(slot.cardId, hero!.id);
  assert.equal(slot.owned, false);
  assert.match(String(slot.market?.label), /^Auf Marktplatz: 29,90\s€$/u);
  assert.ok(pages[0].filter((c) => c.owned).length >= 7);
  assert.ok(pages[0].some((c) => !c.owned), "Lücken bleiben sichtbar");
  assert.equal(showcaseBinderFill([]).length, 0);
});
