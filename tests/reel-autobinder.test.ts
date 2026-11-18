// Master-Vorlage „Reel: Neuer automatischer Binder & Bulk-Marktplatz-Power“ (key "autobinder"):
// exakt 29 s · 1080×1920 · 60 FPS · 10–12 Mbit/s · ElevenLabs-Voiceover (Briefing-Skript) · Mikro-SFX · mittige Untertitel,
// fester Regie-Zeitplan 0–6 / 6–14 / 14–22 / 22–29 s, Demo-Ordner mit 12 Doppelten, Längen-Anpassung der Sprecherin.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { MASTER_TEMPLATES, ALL_TEMPLATES, PRO_TEMPLATES, SHOWCASE_TEMPLATES, templateByKey, proScript, proCaption, checkTemplateScript, showcaseScenes, showcaseMarks, showcaseSpec, showcaseCues, templateCues, autobinderCues, captionChunks, frameGrid, bitrateFor, estimateMb, secondsFor, scenesFor, isShowcase, isMaster, AUTOBINDER_PLAN, AUTOBINDER_TIMELINE, AUTOBINDER_BADGES, AUTOBINDER_MAX_STRETCH, SHOWCASE_SCENES, SHOWCASE_MBIT_RANGE, TAP_LEAD, PRO_LEAD, END_FADE, DOMAIN, SAFE_MB } from "../client/reel-pro.js";
// @ts-ignore – Client-Modul ohne Typen
import { CHOREO } from "../client/reel-scenarios.js";
// @ts-ignore – Client-Modul ohne Typen
import { fitVoice, compressPauses, wsola, silentRuns, timeMap } from "../client/voice-fit.js";
// @ts-ignore – Client-Modul ohne Typen
import { audibleEnd } from "../client/reel-pro.js";
// @ts-ignore – Client-Modul ohne Typen
import { RESULT_ACTIONS } from "../client/scanner/scan-ui-logic.js";
import { PRO_TEMPLATE_KEYS, PRO_TEMPLATE_LABELS, MASTER_TEMPLATE_KEYS, VIDEO_TEMPLATE_KEYS, DEFAULT_VIDEO, cleanVideoConfig, rotationAt } from "../server/reel-video-logic.ts";
import { narrationMaxWords, AUTOBINDER_MAX_WORDS, SHOWCASE_MAX_WORDS, NARRATION_MAX_WORDS, speakable, countWords } from "../server/voiceover.ts";
import { autobinderBinderFill, AUTOBINDER_DEMO, binderCardAt, buildBinderCards, paginate, binderSummary } from "../server/binder-logic.ts";
import { duplicatePlan, dupeConfirmText, quantityBadge } from "../server/duplicates-logic.ts";

const BRIEF = "Karten sammeln und verkaufen war noch nie so einfach: Sobald du deine Karte scannst, landet sie automatisch in deinem digitalen Set-Binder! Und willst du sie zu Geld machen? Ein Klick genügt, und sie steht auf dem Marktplatz. Im Ordner behältst du den vollen Überblick: Doppelte werden extra gezählt und du entscheidest, ob sie in die Gesamtsumme einfließen. Das Beste: Mit nur einem Klick inserierst du alle deine Doppelten auf einmal, während immer eine für deine Sammlung gesichert bleibt! Fehlende Karten werden grau angezeigt – und sobald jemand sie anbietet, kannst du sie direkt aus der Lücke kaufen. Ohne Download kostenlos im Browser: pokeswipe-radar.de!";

const tpl = templateByKey("autobinder");

test("Master-Vorlage: direkt auswählbar, exakt 29 s, 9:16 1080×1920, 60 FPS, 10–12 Mbit/s, 4 Szenen mit eigener Choreografie", () => {
  assert.ok(tpl && isShowcase(tpl) && isMaster(tpl));
  assert.equal(tpl.label, "Reel: Neuer automatischer Binder & Bulk-Marktplatz-Power");
  assert.deepEqual(MASTER_TEMPLATES.map((t: any) => t.key), ["autobinder"]);
  assert.ok(ALL_TEMPLATES.includes(tpl));
  // bestehende Listen bleiben unverändert
  assert.ok(!PRO_TEMPLATES.includes(tpl) && !SHOWCASE_TEMPLATES.includes(tpl));
  assert.deepEqual(SHOWCASE_TEMPLATES.map((t: any) => t.key), ["showcase"]);
  assert.equal(tpl.exact, 29); assert.deepEqual(secondsFor(tpl), [29, 29]);
  assert.equal(tpl.fps, 60);
  assert.ok(tpl.mbit >= SHOWCASE_MBIT_RANGE[0] && tpl.mbit <= SHOWCASE_MBIT_RANGE[1]);
  assert.deepEqual(scenesFor(tpl), SHOWCASE_SCENES);
  assert.ok(CHOREO[tpl.choreo] && CHOREO[tpl.choreo].beats.length === 4 && tpl.choreo !== "showcase");
  assert.equal(tpl.tab, "scan");
  const { frames, duration } = frameGrid(tpl.exact, tpl.fps);
  assert.equal(frames, 1740); assert.equal(duration, 29);
  assert.ok(showcaseSpec(tpl, { duration: 29, fps: 60, mbit: tpl.mbit }).ok);
  assert.equal(bitrateFor(29, tpl.mbit), tpl.mbit);
  assert.ok(estimateMb(29, tpl.mbit) < 45 && estimateMb(29, tpl.mbit) < SAFE_MB);
});

test("Master-Vorlage: Voiceover ist exakt das Briefing-Skript – Untertitel mit Domain, Sprecherin ohne Buchstabieren, Server-Limit 110 Wörter", () => {
  const s = proScript(tpl, 0);
  assert.equal(s.show.join(" "), BRIEF);
  assert.ok(s.show[s.show.length - 1].includes(DOMAIN));
  assert.ok(!speakable(s.say.join(" ")).includes(DOMAIN));
  const chk = checkTemplateScript(tpl, s.say);
  assert.ok(chk.ok, JSON.stringify(chk));
  assert.ok(chk.words > SHOWCASE_MAX_WORDS && chk.words <= AUTOBINDER_MAX_WORDS);
  assert.equal(tpl.voiceFormat, "autobinder");
  assert.equal(narrationMaxWords("autobinder"), AUTOBINDER_MAX_WORDS);
  assert.equal(narrationMaxWords("showcase"), SHOWCASE_MAX_WORDS);
  assert.equal(narrationMaxWords(undefined), NARRATION_MAX_WORDS);
  assert.ok(countWords(s.say.map(speakable)) <= narrationMaxWords(tpl.voiceFormat));
  // Server-Grenzen: ≤ 12 Sätze, je Satz ≤ 320 Zeichen, gesamt ≤ 900 Zeichen
  assert.ok(s.say.length <= 12 && s.say.every((l: string) => speakable(l).length <= 320));
  assert.ok(s.say.map(speakable).join(" ").length <= 900);
  // ElevenLabs-Höchsttempo als Start + tonhöhenneutrale Feinanpassung für exakt 29 s
  assert.equal(tpl.startSpeed, 1.2); assert.equal(tpl.maxSpeed, 1.2);
  assert.equal(tpl.fitVoice.maxStretch, AUTOBINDER_MAX_STRETCH);
});

test("Master-Vorlage: Regie-Zeitplan 0–6 / 6–14 / 14–22 / 22–29 s, Live-Aktionen liegen in ihrer Szene", () => {
  const sc = showcaseScenes(29, tpl.plan);
  assert.deepEqual(sc.map((x: any) => [x.key, x.start, x.end]), [["scan", 0, 6], ["binder", 6, 14], ["market", 14, 22], ["finale", 22, 29]]);
  assert.deepEqual([...AUTOBINDER_PLAN], [0, 6, 14, 22, 29]);
  assert.deepEqual(showcaseMarks(sc).map((m: any) => m.start), [0, 6, 14, 22]);
  const T = AUTOBINDER_TIMELINE;
  const inScene = (t: number, a: number, b: number) => t >= a && t < b;
  for (const k of ["scanStart", "filed", "sellTap", "navCollection"]) assert.ok(inScene(T[k] + TAP_LEAD, 0, 6), k);
  for (const k of ["binderOpen", "flip1", "flipBack", "toggleOff", "toggleOn", "dupeSpot"]) assert.ok(inScene(T[k], 6, 14), k);
  for (const k of ["mineOpen", "bulkTap", "confirmTap", "binderBack", "reveal", "listedSpot"]) assert.ok(inScene(T[k], 14, 22), k);
  for (const k of ["chatTab", "homeTap", "lockup"]) assert.ok(inScene(T[k], 22, 29), k);
  // Inserier-Animation ist fertig, bevor der Schwenk zurück in den Ordner beginnt
  assert.ok(T.confirmTap + TAP_LEAD + 0.25 + T.listMs / 1000 < T.binderBack);
  const order = Object.entries(T).filter(([k]) => !/Ms$/.test(k)).map(([, v]) => v as number);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
  // Beat-Start (Szenenstart − 0,15 s) wird nie unterschritten
  assert.ok(T.binderOpen >= 6 - 0.15 && T.mineOpen >= 14 - 0.15 && T.chatTab >= 22 - 0.15);
  assert.ok(PRO_LEAD + END_FADE < 2);
});

test("Master-Vorlage: Text-Overlays exakt aus dem Briefing, ohne Pro-Abo-Einblendung, Untertitel mittig", () => {
  assert.deepEqual(tpl.overlays, {
    scan: "Karten scannen: Automatisch im Set-Binder & sofort im Marktplatz!",
    binder: "Dein digitaler Ordner zählt doppelte Karten automatisch mit!",
    market: "Alle Doppelten mit 1 Klick inserieren – Lücken direkt aus dem Ordner kaufen!",
    finale: "Kostenlos direkt im Browser – Kein Download nötig: pokeswipe-radar.de",
  });
  assert.equal(tpl.finaleHeadline.text, tpl.overlays.finale);
  assert.equal(tpl.proAt, null);
  // Untertitel in der Bildmitte (Sicherheitsbereich y 230–1500) und unterhalb des Smartphone-Bildschirms (Szenen 1–3)
  assert.ok(tpl.captionY > 1100 && tpl.captionY < 1450);
  for (const [, k] of tpl.camera) assert.ok(k.cy + 462 * k.s < tpl.captionY - 50 || k.s < 0.7, "Untertitel verdecken die App nicht");
  assert.ok(tpl.lockupAt > 22 && tpl.lockupAt < 27);
  // Kamera-Keyframes aufsteigend, auf 29 s normiert
  for (let i = 1; i < tpl.camera.length; i++) assert.ok(tpl.camera[i][0] > tpl.camera[i - 1][0]);
  assert.equal(tpl.camera[tpl.camera.length - 1][0], 29);
  assert.deepEqual(AUTOBINDER_BADGES, { gap: 4.5, listed: 12.9 });
});

test("Master-Vorlage: Mikro-Sounddesign – Scanner-Beep, Blättern, Schalter- und Inserier-Ticks, Erfolgs-Plings auf den Aktionen", () => {
  const sc = showcaseScenes(29, tpl.plan);
  const cues = templateCues(tpl, sc);
  assert.deepEqual(cues, autobinderCues(sc));
  // Pro-Showcase behält seine eigene Tonspur
  assert.deepEqual(templateCues(templateByKey("showcase"), showcaseScenes(29)), showcaseCues(showcaseScenes(29)));
  const T = AUTOBINDER_TIMELINE;
  const of = (type: string) => cues.filter(([, k]: any) => k === type).map(([t]: any) => t);
  assert.equal(of("beep").length, 1);
  assert.ok(Math.abs(of("beep")[0] - (T.scanStart + T.scanMs / 1000)) < 1e-6, "Beep, wenn der Scan fertig ist");
  assert.ok(of("drop").some((t: number) => Math.abs(t - T.filed) < 1e-6), "Ablage-Sound beim Einsortieren");
  assert.equal(of("page").length, 2);
  for (const t of of("page")) assert.ok(t > 6 && t < 14);
  assert.ok(of("pling").length === 3, "Inserat, Bulk-Inserate fertig, Lücken-Badge");
  assert.ok(of("pling").some((t: number) => Math.abs(t - T.reveal) < 1e-6), "Pling beim Lücken-Badge");
  assert.ok(of("tick").filter((t: number) => t > 14 && t < 22).length >= 6, "Ticks während des Inserierens");
  assert.ok(of("tap").length >= 8);
  assert.equal(of("chime").length, 1);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i][0] >= cues[i - 1][0]);
  for (const [t] of cues) assert.ok(t >= 0 && t <= 29);
});

test("Master-Vorlage: Untertitel wortweise in kurzen Häppchen, innerhalb der Sprechzeit", () => {
  const s = proScript(tpl, 0);
  const marks = [[0.35, 6.3], [6.4, 9.6], [9.7, 15.0], [15.1, 20.6], [20.7, 25.3], [25.4, 28.1]].map(([start, end]) => ({ start, end }));
  const ch = captionChunks(s.show, marks);
  for (const c of ch) { assert.ok(c.words.length >= 1 && c.words.length <= 4); assert.ok(c.end <= 29); }
  assert.equal(ch.flatMap((c: any) => c.words.map((w: any) => w.w)).join(" "), BRIEF);
});

test("Master-Vorlage: Make.com-Beschreibung mit Hook, CTA, 6–10 Hashtags; Admin-Zentrale & Rotation", () => {
  for (const v of [0, 1]) {
    const c = proCaption(tpl, v, { card: "Glurak ex" });
    assert.ok(c.caption.startsWith(proScript(tpl, v).cover));
    assert.ok(c.caption.includes("pokeswipe-radar.de") && c.caption.includes("Glurak ex"));
    assert.ok(c.hashtags.length >= 6 && c.hashtags.length <= 10 && c.hashtags.includes("#PokemonTCG"));
    assert.ok(c.title.length <= 100);
    assert.ok(proScript(tpl, v).cover.length >= 20 && proScript(tpl, v).cover.length <= 60);
  }
  assert.deepEqual([...MASTER_TEMPLATE_KEYS], ["autobinder"]);
  assert.ok((VIDEO_TEMPLATE_KEYS as readonly string[]).includes("autobinder"));
  assert.ok(PRO_TEMPLATE_LABELS.autobinder.includes("29 s") && PRO_TEMPLATE_LABELS.autobinder.startsWith(tpl.label));
  assert.deepEqual(DEFAULT_VIDEO.templates, [...PRO_TEMPLATE_KEYS]);
  const cfg = cleanVideoConfig({ templates: ["autobinder", "radar"] });
  assert.deepEqual(cfg.templates, ["radar", "autobinder"]);
  assert.equal(templateByKey(rotationAt(cfg, 1).template), tpl);
});

// ---------------------------------------------------------------------------
// Demo-Ordner (Stage): 3×3-Seiten aus dem echten Set-Katalog
// ---------------------------------------------------------------------------
const catalog = Array.from({ length: 40 }, (_, i) => ({ id: `sv03.5-${String(i + 1).padStart(3, "0")}`, name: `Karte ${i + 1}`, image: "", localId: String(i + 1), price: 2 + i }));

test("Demo-Ordner: gescannte Karte „2x“, graue Lücke „Auf Marktplatz: 4,50 €“, eigenes Inserat „Im Verkauf: 12,90 €“ – alles auf Seite 1", () => {
  const scanned = binderCardAt(catalog, AUTOBINDER_DEMO.scanned)!, gap = binderCardAt(catalog, AUTOBINDER_DEMO.gap)!, listed = binderCardAt(catalog, AUTOBINDER_DEMO.listed)!;
  assert.deepEqual([scanned.id, gap.id, listed.id], ["sv03.5-006", "sv03.5-003", "sv03.5-009"]); // 151: Glurak ex, Bisaflor ex, Turtok ex
  const owned = [...autobinderBinderFill(catalog), { cardId: scanned.id, quantity: 1, condition: "NM", value: scanned.price! }];
  const cards = buildBinderCards({
    catalog, owned, viewerId: "",
    myListings: [{ id: -11, cardId: scanned.id, price: 7, userId: "" }, { id: -12, cardId: listed.id, price: AUTOBINDER_BADGES.listed, userId: "" }],
    marketListings: [{ id: -1, cardId: gap.id, price: AUTOBINDER_BADGES.gap, userId: "reel-demo-seller" }],
  });
  const page1 = paginate(cards)[0];
  const at = (id: string) => page1.find((c) => c.cardId === id)!;
  assert.equal(at(scanned.id).owned, true); assert.equal(quantityBadge(at(scanned.id).quantity), "2x");
  assert.equal(at(gap.id).owned, false);
  assert.match(String(at(gap.id).market?.label), /^Auf Marktplatz: 4,50\s€$/u);
  assert.match(String(at(listed.id).myListing?.label), /^Im Verkauf: 12,90\s€$/u);
  assert.ok(page1.filter((c) => c.owned).length >= 7);
  // Gesamtwert-Umschalter: mit Doppelten höher als ohne
  const on = binderSummary(cards, 165, true), off = binderSummary(cards, 165, false);
  assert.ok(on.value > off.value && on.duplicates === 13);
});

test("Demo-Ordner: „Alle Doppelten inserieren“ stellt genau 12 Karten ein – je 1 Exemplar bleibt, die schon inserierte Scan-Karte zählt nicht", () => {
  const scanned = binderCardAt(catalog, AUTOBINDER_DEMO.scanned)!;
  const owned = [...autobinderBinderFill(catalog), { cardId: scanned.id, quantity: 1, condition: "NM", value: scanned.price! }];
  const items = owned.map((o, i) => ({ id: 900001 + i, cardId: o.cardId, name: o.name, quantity: o.quantity, unitValue: (o.value || 0) / (o.quantity || 1), condition: o.condition }));
  const plan = duplicatePlan(items, [{ id: -11, card_id: scanned.id, status: "active" }]);
  assert.equal(plan.copies, 12);
  assert.equal(plan.alreadyListed, 1);
  assert.match(dupeConfirmText(plan), /^12 doppelte Karten jetzt zum Cardmarket-Preis inserieren\? \(.*je 1 Exemplar bleibt in deinem Set-Ordner\.\)$/u);
  assert.equal(autobinderBinderFill([]).length, 0);
  // echte App-Texte im Scanner-Panel
  assert.equal(RESULT_ACTIONS.sell.label, "🏷️ Als Inserat einstellen");
});

// ---------------------------------------------------------------------------
// Sprecherin exakt auf 29 s: Pausen kürzen + tonhöhenneutrale WSOLA-Raffung
// ---------------------------------------------------------------------------
const SR = 16000;
/** Test-Stimme: Ton-Silben (220 Hz) mit Pausen dazwischen. */
function voice(parts: Array<[number, number]>) {
  const total = parts.reduce((s, [a, b]) => s + a + b, 0);
  const ch = new Float32Array(Math.round(total * SR));
  let t = 0;
  for (const [on, off] of parts) {
    for (let i = Math.round(t * SR); i < Math.round((t + on) * SR); i++) ch[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / SR);
    t += on + off;
  }
  return ch;
}
/** Grundfrequenz per Nulldurchgängen. */
const pitch = (ch: Float32Array, a: number, b: number) => {
  let z = 0;
  for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) if (ch[i - 1] < 0 && ch[i] >= 0) z++;
  return z / (b - a);
};

test("Voice-Fit: Pausen werden nur so weit wie nötig gekürzt, Zeitstempel wandern mit", () => {
  const ch = voice([[1, 0.6], [1, 0.6], [1, 0.05]]);
  const runs = silentRuns([ch], SR);
  assert.equal(runs.length, 2);
  const r = compressPauses([ch], SR, 0.3);
  assert.ok(Math.abs(r.saved - 0.3) < 0.03, `gespart ${r.saved}`);
  const map = timeMap(r.points);
  assert.ok(Math.abs(map(1.6 + 0.5) - (1.6 + 0.5 - 0.15)) < 0.03, "Wort nach 1. Pause rückt um die Hälfte nach vorn");
  assert.ok(Math.abs(map(3.2 + 0.5) - (3.2 + 0.5 - 0.3)) < 0.03);
  // Maximal bis auf 0,14 s je Pause
  const max = compressPauses([ch], SR, 5);
  assert.ok(Math.abs(max.saved - 2 * (0.6 - 0.14)) < 0.03);
});

test("Voice-Fit: WSOLA rafft um den Faktor, Tonhöhe bleibt gleich", () => {
  const ch = voice([[2, 0]]);
  const [out] = wsola([ch], SR, 1.1);
  assert.ok(Math.abs(out.length - ch.length / 1.1) < 2);
  const f0 = pitch(ch, 0.2, 1.6), f1 = pitch(out, 0.2, 1.6);
  assert.ok(Math.abs(f0 - 220) < 3 && Math.abs(f1 - 220) < 6, `Tonhöhe ${f0} → ${f1}`);
});

test("Voice-Fit: 30,4 s Sprechzeit → exakt in 27,77 s (erst Pausen, dann höchstens 10 % Raffung)", () => {
  const parts: Array<[number, number]> = Array.from({ length: 12 }, () => [2.2, 0.35]);
  const ch = voice(parts);
  const speech = audibleEnd([ch], SR);
  const target = 29 - PRO_LEAD - END_FADE - 0.08;
  const r = fitVoice([ch], SR, speech, target, { maxStretch: AUTOBINDER_MAX_STRETCH });
  assert.ok(r.changed && r.saved > 1 && r.factor > 1 && r.factor <= AUTOBINDER_MAX_STRETCH);
  const after = audibleEnd(r.channels, SR);
  assert.ok(after <= target + 0.06, `${speech.toFixed(2)} s → ${after.toFixed(2)} s (Ziel ${target.toFixed(2)})`);
  assert.ok(Math.abs(r.map(speech) - after) < 0.08, "Zeit-Abbildung trifft das letzte Wort");
  // nichts zu tun → unverändert
  const same = fitVoice([ch], SR, 20, 27);
  assert.equal(same.changed, false); assert.equal(same.map(12.3), 12.3);
});
