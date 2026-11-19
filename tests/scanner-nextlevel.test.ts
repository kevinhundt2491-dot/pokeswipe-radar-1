// Next-Level-Scanner: 100 % rahmenlos, Multi-Card-Fix (Karte #2, #3 … ohne Wartezeit), Live-Preisschild, 2,5-s-Auto-Binder,
// Binder- & Tisch-Sweep (99–100 % Konfidenz + Nummern-ROI), Tages-Zähler – und der Set-Binder ohne „Fehlt“/Grau mit Lücken-Radar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SWEEP, createSweepGate, confidencePercent, strictOk, quadCenter, tagCode, tagLines, bumpDaily, dailyLabel, dayKey, viewTotal, euro,
} from "../client/scanner/sweep-logic.js";
import { pocketLabel, gapRadar, buildBinderCards, DEAL_BELOW } from "../server/binder-logic.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const A = ["card:sv08-238", "print:en:sv08-238"], B = ["card:sv08-001"], C = ["card:sv03.5-199"];
const quadAt = (cx: number, cy: number, w = 0.3): [number, number][] => [[cx - w / 2, cy - w * 0.7], [cx + w / 2, cy - w * 0.7], [cx + w / 2, cy + w * 0.7], [cx - w / 2, cy + w * 0.7]];
const det = (keys: string[], match = 0.9, extra: Record<string, unknown> = {}) => ({ keys, match, margin: 12, quad: quadAt(0.5, 0.5), ...extra });

test("Multi-Card-Fix: nach Karte #1 wird Karte #2, #3, #4 sofort erkannt (0 ms Wartezeit) – gesperrt ist nur das Exemplar im Bild, ohne Zeit-Cooldown", () => {
  assert.equal(SWEEP.NEW_CARD_MS, 0);
  assert.equal((SWEEP as any).COOLDOWN_MS, undefined, "kein starrer Zeit-Cooldown mehr");
  const gate = createSweepGate();
  let t = 1000;
  const push = (dets: any[], motion = 0.02) => gate.push({ dets, found: true, motion }, t);
  assert.equal(push([det(A)]).hits.length, 1, "Karte #1 im ersten Bild");
  // Karte #1 bleibt liegen, Karte #2 kommt dazu → sofort, keine globale Wartezeit
  t += 40;
  const r2 = push([det(A), det(B, 0.9, { quad: quadAt(0.2, 0.3) })]);
  assert.deepEqual(r2.hits, [B], "Karte #2 ohne Wartezeit");
  assert.deepEqual(r2.locked, [A], "Karte #1 weiter gesperrt (liegt noch im Bild)");
  t += 40; assert.deepEqual(push([det(C)]).hits, [C], "Karte #3");
  const D = ["card:me01-010"];
  t += 40; assert.deepEqual(push([det(D)]).hits, [D], "Karte #4");
  // Dieselbe Karte bleibt im Bild → kein zweiter Treffer, egal wie lange
  for (let i = 0; i < 100; i++) { t += 40; assert.equal(push([det(D)]).hits.length, 0); }
  // Dieselbe Karte an deutlich anderer Stelle = zweites Exemplar → zählt eigenständig
  t += 40;
  assert.equal(push([det(D), det(D, 0.9, { quad: quadAt(0.85, 0.2, 0.2) })]).hits.length, 1, "zweites Exemplar daneben");
});

test("Sweep-Modus: dieselbe Karte an deutlich anderer Position = zweites Exemplar; strikt nur ≥ 99 % Konfidenz, 3 Bilder, Nummer darf nicht widersprechen", () => {
  const gate = createSweepGate({ mode: "sweep" });
  assert.equal(gate.mode, "sweep");
  let t = 0;
  const push = (dets: any[]) => gate.push({ dets, found: true, motion: 0.02 }, (t += 40));
  const strong = (keys: string[], cx: number, extra: Record<string, unknown> = {}) => det(keys, 0.95, { margin: 14, quad: quadAt(cx, 0.5), ...extra });
  push([strong(A, 0.2)]); push([strong(A, 0.2)]);
  assert.equal(push([strong(A, 0.2)]).hits.length, 1, "3 Bilder → Treffer");
  // Gleiche Karte links liegt weiter → gesperrt; gleiche Karte rechts (anderes Exemplar auf der Ordnerseite) zählt eigenständig
  push([strong(A, 0.2), strong(A, 0.8)]); push([strong(A, 0.2), strong(A, 0.8)]);
  const r = push([strong(A, 0.2), strong(A, 0.8)]);
  assert.equal(r.hits.length, 1, "zweites Exemplar rechts");
  assert.equal(r.locked.length, 1);
  // Zu schwach für den strikten Modus (90 % reicht im Turbo, nicht im Sweep)
  const weak = createSweepGate({ mode: "sweep" });
  for (let i = 0; i < 5; i++) assert.equal(weak.push({ dets: [det(B, 0.9)], found: true, motion: 0 }, i * 40).hits.length, 0);
  // Nummer gelesen und falsch → nie ein Treffer, egal wie gut der Hash passt
  const bad = createSweepGate({ mode: "sweep" });
  for (let i = 0; i < 5; i++) assert.equal(bad.push({ dets: [det(B, 0.99, { margin: 20, numOk: false })], found: true, motion: 0 }, i * 40).hits.length, 0);
  // Weitergetragene Erkennung (carried) hält die Sperre, zählt aber nicht für den Konsens
  const car = createSweepGate({ mode: "sweep" });
  for (let i = 0; i < 5; i++) assert.equal(car.push({ dets: [det(C, 0.96, { margin: 14, carried: true })], found: true, motion: 0 }, i * 40).hits.length, 0);
  // Modus umschalten → Turbo-Schwellen gelten wieder
  gate.setMode("turbo");
  assert.equal(gate.mode, "turbo");
  assert.equal(gate.push({ dets: [det(C, 0.9)], found: true, motion: 0 }, 9000).hits.length, 1, "Turbo: erstes klares Bild");
});

test("Konfidenz-Skala: 99 % = klarer Treffer mit Abstand, 100 % = Nummer bestätigt, falsche Nummer ≤ 60 %, knapper Abstand ≤ 85 %", () => {
  assert.equal(confidencePercent({ match: 0.9, margin: 12 }), 90);
  assert.equal(confidencePercent({ match: 0.93, margin: 10 }), 99);
  assert.equal(confidencePercent({ match: 0.97, margin: 12 }), 100);
  assert.equal(confidencePercent({ match: 0.9, margin: 12, numOk: true }), 100);
  assert.equal(confidencePercent({ match: 0.99, margin: 20, numOk: false }), 60);
  assert.equal(confidencePercent({ match: 0.95, margin: 3 }), 85);
  assert.equal(strictOk({ match: 0.93, margin: 10 }), true);
  assert.equal(strictOk({ match: 0.92, margin: 10 }), false);
  assert.equal(strictOk({ match: 0.99, margin: 20, numOk: false }), false);
  assert.deepEqual(quadCenter([[0, 0], [1, 0], [1, 1], [0, 1]]), [0.5, 0.5]);
  assert.equal(quadCenter(null), null);
});

test("Live-Preisschild: Set-Kürzel + Nummer, Status-Badges, Tages-Zähler und Gesamtwert im Bild", () => {
  assert.equal(tagCode({ setCode: "DRI", number: "45/182" }), "DRI 045/182");
  assert.equal(tagCode({ setCode: "", number: "" }, "card:sv08-238"), "SV08");
  assert.equal(tagCode({ number: "TG12" }, "print:en:swsh12.5-TG12"), "SWSH12.5 TG12");
  const a = tagLines({ price: 14.9, filed: true, ownedBefore: false });
  assert.equal(a.status, "✅ Im Set-Binder");
  assert.equal(a.flag, "🔥 Hit > 10 €");
  assert.equal(a.hot, true);
  const b = tagLines({ price: 2.5, filed: false, saving: true, ownedBefore: false });
  assert.equal(b.status, "📒 Sortiere in den Set-Binder …");
  assert.equal(b.flag, "⚡ Fehlt dir noch!");
  assert.equal(tagLines({ price: 2.5, filed: true, ownedBefore: true, qty: 2 }).flag, "×2 · Doppelte");
  assert.equal(tagLines({ price: 2.5, filed: true, ownedBefore: true, qty: 1 }).flag, "");
  // Tages-Zähler: neuer Tag startet bei 0, Wert kommt nach, wenn der Preis geladen ist
  const now = new Date(2026, 10, 19, 12, 0, 0).getTime();
  assert.equal(dayKey(now), "2026-11-19");
  let d = bumpDaily(null, { count: 1, value: 14.9 }, now);
  d = bumpDaily(d, { count: 1, value: 0 }, now);
  d = bumpDaily(d, { count: 0, value: 2.5 }, now);
  assert.deepEqual(d, { day: "2026-11-19", count: 2, value: 17.4 });
  assert.equal(dailyLabel(d, now), `Heute gescannt: 2 Karten · Gesamtwert: ${euro(17.4)}`);
  assert.equal(euro(17.4).replace(/\u00a0/g, " "), "17,40 €");
  assert.equal(dailyLabel(d, now + 86_400_000), `Heute gescannt: 0 Karten · Gesamtwert: ${euro(0)}`, "nächster Tag → frisch");
  assert.equal(bumpDaily(d, { count: 1 }, now + 86_400_000).count, 1);
  assert.equal(dailyLabel({ day: "2026-11-19", count: 1, value: 5 }, now), `Heute gescannt: 1 Karte · Gesamtwert: ${euro(5)}`);
  // Gesamtwert aller Karten im Bild (Sweep): jede Erkennung einmal, zwei Exemplare an verschiedenen Stellen zählen doppelt
  const price = (k: string) => (k === "card:a-1" ? 10 : k === "card:b-2" ? 2.5 : 0);
  const v = viewTotal([det(["card:a-1"], 0.95, { quad: quadAt(0.2, 0.5) }), det(["card:a-1"], 0.95, { quad: quadAt(0.8, 0.5) }), det(["card:b-2"], 0.95), det(["card:c-3"], 0.95, { quad: quadAt(0.5, 0.2) }), det(["card:x-9"], 0.5)], price);
  assert.deepEqual(v, { count: 4, value: 22.5, priced: 3 });
});

test("Scanner-Quelltext: kein Zielrahmen, Modus-Umschalter, Session-Dock mit +1, Auto-Binder im Hintergrund, Worker-Gegendruck per try/finally", () => {
  const ls = src("client/scanner/live-scanner.js");
  assert.ok(!/id="ps-ls-guide"|id="ps-ls-quad"|id="ps-ls-mask"|ps-ls-corner|ps-ls-laser/.test(ls), "kein Zielrahmen, keine Maske, kein grünes Kanten-Polygon");
  assert.ok(!/stroke="#34d399"/.test(ls), "kein grüner SVG-Rahmen");
  assert.ok(!/Karte in den Rahmen halten/.test(ls), "Hinweise ohne „Rahmen“");
  const ui = src("client/scanner/sweep-scanner.js");
  assert.ok(!/AUTO_NEXT_MS|ps-sw-auto|animation-duration/.test(ui), "keine ablaufende Aktionsleiste mehr – das Dock bleibt stehen");
  assert.match(ui, /🏷️ Inserieren/); assert.match(ui, /⚡ Schnell-Inserieren/);
  assert.match(ui, /strategy: "quick"/, "Schnell-Inserieren = Deal-Preis unter Cardmarket");
  assert.match(ui, /⚡ Stapel \/ Einzelkarte/); assert.match(ui, /📒 Ordner-Seite/); assert.ok(!/✨ Auto/.test(ui), "keine Modus-Automatik mehr");
  assert.match(ui, /if \(sw\.prefs\.autoFile\) autoFile\(r\.uid, key\)/, "jeder Treffer wird sofort ohne Klick gespeichert (abschaltbar)");
  assert.match(ui, /dailyLabel\(sw\.daily\)/);
  assert.match(ui, /navigator\.vibrate\(35\)/); assert.match(ui, /createOscillator/);
  assert.match(ui, /function drawTag/, "Preisschild-Etikett direkt auf der Karte");
  // Die Kamera-Schleife wartet nie auf das Speichern: autoFile ist eine nicht erwartete Hintergrund-Aufgabe
  assert.ok(!/await autoFile\(/.test(ui));
  const engine = src("client/scanner/sweep-engine.js");
  assert.match(engine, /st\.busy = true;\s*try \{ post\([^;]*frame\(msg\)\); \}[^]*finally \{ st\.busy = false; \}/, "Worker-Flag garantiert per try/finally zurückgesetzt");
  assert.match(engine, /const cands = \[\.\.\.fresh, \.\.\.tracked\]/, "neue Karten werden vor den verfolgten ausgewertet");
  assert.match(engine, /function verifyNumber/, "Nummern-ROI-Verifikation");
  assert.match(engine, /binder: \{ maxEval: SWEEP\.MAX_CARDS/, "Ordner-Modus prüft bis zu 9 Fächer je Bild");
  const worker = src("client/scanner/scan-worker.js");
  assert.match(worker, /getGlyphs: \(\) => glyphs/);
});

test("Set-Binder: leere Taschen mit Marktplatz-Etikett (🛒 Ab / ⚡ Deal / 🔔 Radar aktiv), Lücken-Radar sortiert nach Verfügbarkeit", () => {
  const catalog = [
    { id: "sv08-1", name: "A", localId: "1", price: 10 }, { id: "sv08-2", name: "B", localId: "2", price: 7 },
    { id: "sv08-3", name: "C", localId: "3", price: 1 }, { id: "sv08-4", name: "D", localId: "4", price: 30 },
  ];
  const cards = buildBinderCards({
    catalog, owned: [{ cardId: "sv08-1", quantity: 1 }], viewerId: "me", official: 191,
    myListings: [],
    marketListings: [
      { id: 11, cardId: "sv08-2", price: 6.5, userId: "x" }, { id: 12, cardId: "sv08-2", price: 7.9, userId: "y" },
      { id: 13, cardId: "sv08-4", price: 5.5, userId: "z" }, { id: 14, cardId: "sv08-3", price: 0, userId: "q" },
    ],
  });
  const by = Object.fromEntries(cards.map((c) => [c.cardId, c]));
  assert.equal(pocketLabel(by["sv08-1"]), null, "eigene Karte: kein Etikett");
  assert.deepEqual(pocketLabel(by["sv08-2"]), { kind: "market", text: `🛒 Ab ${euro(6.5)}`, listingId: 11 }, "6,50 € bei 7 € Cardmarket: normales Angebot");
  assert.deepEqual(pocketLabel(by["sv08-4"]), { kind: "deal", text: `⚡ Deal ${euro(5.5)}`, listingId: 13 }, `≥ ${DEAL_BELOW * 100} % unter Cardmarket`);
  assert.deepEqual(pocketLabel(by["sv08-3"]), { kind: "trade", text: "🔁 Tausch möglich", listingId: 14 });
  assert.deepEqual(pocketLabel({ owned: false, market: null, price: 3 }), { kind: "radar", text: "🔔 Radar aktiv", listingId: 0 });
  const r = gapRadar(cards);
  assert.equal(r.count, 3);
  assert.deepEqual(r.available.map((c) => c.cardId), ["sv08-4", "sv08-2", "sv08-3"], "günstigstes Kaufangebot zuerst, Tausch zuletzt");
  assert.deepEqual(r.all.map((c) => c.cardId), ["sv08-4", "sv08-2", "sv08-3"], "teuerste Lücke zuerst");
  assert.equal(r.cost, 38);
  assert.equal(r.buyNow, 12);
  // Oberfläche: kein „fehlt“-Text, kein Grau, Etikett + geprägte Nummer, eigener Bereich „🎯 Lücken-Radar“
  for (const f of ["client/binder.js", "client/home-binder.js"]) {
    const s = src(f);
    assert.ok(!/>fehlt<|ps-bslot-missing|" – fehlt"/.test(s), `${f}: kein „fehlt“`);
    assert.ok(!/grayscale/.test(s), `${f}: kein grayscale`);
    assert.match(s, /ps-pocket-tag/); assert.match(s, /ps-bslot-emboss/);
  }
  assert.ok(!/grayscale/.test(src("client/collector.js")));
  const b = src("client/binder.js");
  assert.match(b, /🎯 Lücken-Radar/); assert.match(b, /binderPocketTap/); assert.match(b, /PS\.openGapRadar/);
  assert.ok(!/Fehlend \(/.test(b), "kein „Fehlend“-Filter mehr im Ordner");
  const g = src("client/gap-radar.js");
  assert.match(g, /Sofort im Marktplatz verfügbar/); assert.match(g, /Alle gesuchten Karten/); assert.match(g, /gapRadarWishAll/); assert.match(g, /PS\.openListing/);
  assert.ok(src("public/index.html").includes('id="ps-gap-radar"'));
  assert.match(src("client/features.js"), /key: "gaps", label: "🎯 Lücken-Radar"/);
  assert.match(src("client/app-nav.js"), /\["gaps", "🎯 Lücken-Radar"/);
  assert.match(src("client/main.js"), /\.\.\.gapRadarApi/); assert.match(src("client/main.js"), /initGapRadar\(\)/);
  const css = src("public/theme.css");
  assert.ok(!/ps-bslot[^\n]*grayscale|ps-binder-sheet-missing[^\n]*grayscale/.test(css));
});
