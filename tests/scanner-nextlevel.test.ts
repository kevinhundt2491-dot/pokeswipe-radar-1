// Next-Level-Scanner: 100 % rahmenlos, Präsenz-Gate + ≥ 82 % / Nummer + physische Karten-Sperre, Live-Preisschild, Auto-Binder,
// Binder- & Tisch-Sweep (99–100 % Konfidenz + Nummern-ROI), Tages-Zähler – und der Set-Binder ohne „Fehlt“/Grau mit Lücken-Radar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SWEEP, createSweepGate, confidencePercent, strictOk, quadCenter, tagCode, tagLines, bumpDaily, dailyLabel, dayKey, viewTotal, euro,
  filedLabel, oneTapPrice, thumbDrift, anchorThumb,
} from "../client/scanner/sweep-logic.js";
import { pocketLabel, gapRadar, buildBinderCards, DEAL_BELOW } from "../server/binder-logic.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const A = ["card:sv08-238", "print:en:sv08-238"], B = ["card:sv08-001"], C = ["card:sv03.5-199"];
const quadAt = (cx: number, cy: number, w = 0.3): [number, number][] => [[cx - w / 2, cy - w * 0.7], [cx + w / 2, cy - w * 0.7], [cx + w / 2, cy + w * 0.7], [cx - w / 2, cy + w * 0.7]];
const det = (keys: string[], match = 0.9, extra: Record<string, unknown> = {}) => ({ keys, match, margin: 12, quad: quadAt(0.5, 0.5), ...extra });

/** Anker-Miniatur (16 × 24) für die Karten-Sperre: Grundmuster + Rauschen bzw. ein geänderter Flächenanteil */
const thumbOf = (changedShare = 0, noise = 0, seed = 1) => {
  const w = 16, h = 24, d = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let v = 60 + ((i * 37 + seed) % 120);
    if (noise) v += ((i * 13) % 7) - 3 > 0 ? noise : -noise;
    if (i < Math.round(changedShare * d.length)) v += 90;
    d[i] = v; sum += v;
  }
  return { w, h, d, mean: sum / d.length };
};

test("Physische Karten-Sperre: ein Treffer je Karte, kein Namens-Wechsel bei ruhigem Handy, frei nach Wegziehen ≥ 200 ms bzw. > 40 % Zentrumsänderung", () => {
  assert.equal(SWEEP.MIN_MATCH, 0.82);
  assert.equal(SWEEP.MARGIN_PCT, 0.1);
  assert.equal(SWEEP.FREEZE_DRIFT, 0.4);
  assert.equal(SWEEP.FREEZE_RELEASE_MS, 200);
  assert.equal(SWEEP.HIT_PAUSE_MS, 0);
  const gate = createSweepGate();
  let t = 1000;
  const push = (dets: any[], extra: Record<string, unknown> = {}) => gate.push({ dets, card: true, motion: 0.02, center: 0.02, thumb: thumbOf(), ...extra }, (t += 40));
  push([det(A, 0.9, { margin: 20 })]);
  assert.deepEqual(push([det(A, 0.9, { margin: 20 })]).hits, [A], "Treffer nach 2 Bildern");
  // Handy ruhig über derselben Karte – Erkennung rattert durch 5 falsche Namen → 0 weitere Treffer
  for (const k of ["card:sv1-1", "card:sv2-2", "card:sv3-3", "card:sv4-4", "card:sv5-5"]) for (let i = 0; i < 20; i++) {
    const r = push([det([k], 0.95, { margin: 30 })], { thumb: thumbOf(0.1, 6) });
    assert.equal(r.hits.length, 0, `kein Geister-Name ${k}`);
    assert.equal(r.frozen, true);
  }
  // > 40 % Zentrumsänderung, aber nur 120 ms → noch gesperrt
  push([det(B, 0.95, { margin: 30 })], { thumb: thumbOf(0.5) }); push([det(B, 0.95, { margin: 30 })], { thumb: thumbOf(0.5) });
  assert.equal(gate.frozen, true, "< 200 ms Veränderung gibt nicht frei");
  // Karte gegen die nächste ausgetauscht (≥ 200 ms deutlich anders) → frei, nächste Karte zählt nach 2 Bildern
  for (let i = 0; i < 4; i++) push([det(B, 0.95, { margin: 30 })], { thumb: thumbOf(0.5) });
  assert.equal(gate.frozen, false, "ausgetauscht → frei");
  assert.deepEqual(push([det(B, 0.95, { margin: 30 })], { thumb: thumbOf(0.5) }).hits, [B], "nächste Karte (2. ruhiges Bild)");
  // Rechteck verschwindet ≥ 200 ms (Karte weg) → frei; dieselbe Karte als Duplikat zählt danach wieder
  for (let i = 0; i < 7; i++) push([], { card: false, thumb: thumbOf(0.3) });
  assert.equal(gate.frozen, false);
  push([det(B, 0.95, { margin: 30 })], { thumb: thumbOf() });
  assert.deepEqual(push([det(B, 0.95, { margin: 30 })], { thumb: thumbOf() }).hits, [B], "Duplikat vom Stapel");
});

test("Farbverteilung & Wegziehen: widersprechende Grundfarbe sperrt reine Artwork-Treffer, verwackelte Bilder zählen nie", () => {
  const gate = createSweepGate();
  let t = 0;
  const push = (dets: any[], center = 0.02, motion = 0.02) => gate.push({ dets, card: true, motion, center }, (t += 40));
  for (let i = 0; i < 10; i++) assert.equal(push([det(C, 0.95, { margin: 30 })], 0.15, 0.1).hits.length, 0);
  push([det(C, 0.9, { margin: 30 })]);
  assert.deepEqual(push([det(C, 0.9, { margin: 30 })]).hits, [C], "2 ruhige Bilder lösen aus");
  const g3 = createSweepGate();
  g3.push({ dets: [det(B, 0.9, { margin: 30, colorReject: true })], card: true, motion: 0.01 }, 0);
  assert.equal(g3.push({ dets: [det(B, 0.9, { margin: 30, colorReject: true })], card: true, motion: 0.01 }, 40).hits.length, 0, "rote Karte ≠ grüne/blaue Referenz");
  assert.ok(!/Farbe passt nicht|Farbprüfung/.test(src("client/scanner/sweep-scanner.js")), "keine Farb-Meldung im Scanner");
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
  gate.push({ dets: [det(C, 0.9, { margin: 20 })], found: true, motion: 0 }, 9000);
  assert.equal(gate.push({ dets: [det(C, 0.9, { margin: 20 })], found: true, motion: 0 }, 9040).hits.length, 1, "Turbo: Treffer nach 2 ruhigen Bildern");
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
  const a = tagLines({ price: 14.9, filed: true, ownedBefore: false, setName: "Reisegefährten", ownedQty: 1 });
  assert.equal(a.status, "✅ Automatisch im Ordner: Reisegefährten (1×)");
  assert.equal(tagLines({ price: 1, filed: true, ownedBefore: true, ownedQty: 2 }).status, "✅ Im Ordner gespeichert · Jetzt 2× vorhanden");
  assert.equal(filedLabel({ setName: "Prismatische Entwicklungen", ownedQty: 1 }), "✅ Automatisch im Ordner: Prismatische Entwicklungen (1×)");
  assert.equal(filedLabel({ ownedQty: 3 }), "✅ Im Ordner gespeichert · Jetzt 3× vorhanden");
  assert.equal(a.flag, "🔥 Hit > 10 €");
  assert.equal(a.hot, true);
  const b = tagLines({ price: 2.5, filed: false, saving: true, ownedBefore: false });
  assert.equal(b.status, "📒 Sortiere automatisch in den Ordner …");
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

test("1-Klick-Inserieren: CM-Preis exakt, Schnell-Inserieren 0,50 € bis 5,00 € unter Cardmarket", () => {
  assert.equal(oneTapPrice(12.4, "cm"), 12.4);
  assert.equal(oneTapPrice(0, "cm"), null);
  assert.equal(oneTapPrice(null, "deal"), null);
  for (const cm of [0.6, 1, 2.35, 4.99, 9.9, 14.9, 37.5, 49.99, 120, 899]) {
    const p = oneTapPrice(cm, "deal")!;
    const off = Math.round((cm - p) * 100) / 100;
    assert.ok(off >= 0.5 && off <= 5.04, `${cm} → ${p} (−${off})`);
    assert.ok(p > 0 && Math.abs(Math.round(p * 20) - p * 20) < 1e-6, `5-ct-Raster ${p}`);
  }
  assert.equal(oneTapPrice(14.9, "deal"), 13.4);
  assert.equal(oneTapPrice(899, "deal"), 894);
  assert.ok(oneTapPrice(0.3, "deal")! >= 0.05, "sehr günstige Karte: nie 0 €");
});

test("Bildveränderung für die Karten-Sperre: Handzittern bleibt deutlich unter 18 %, weggezogene Karte darüber", () => {
  const w = 160, h = 240, base = new Float32Array(w * h), shake = new Float32Array(w * h), away = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const card = x > 30 && x < 130 && y > 40 && y < 200;
    const bg = 50 + 10 * Math.sin(x * 0.07) + 8 * Math.sin(y * 0.11);
    const art = 140 + 60 * Math.sin(x * 0.09) * Math.cos(y * 0.05);
    base[y * w + x] = card ? art : bg;
    const xs = x - 2, ys = y + 1, cs = xs > 30 && xs < 130 && ys > 40 && ys < 200;
    shake[y * w + x] = (cs ? 140 + 60 * Math.sin(xs * 0.09) * Math.cos(ys * 0.05) : bg) + 4;
    away[y * w + x] = bg;
  }
  const A0 = anchorThumb({ w, h, d: base }), S = anchorThumb({ w, h, d: shake }), G = anchorThumb({ w, h, d: away });
  assert.ok(thumbDrift(A0, S)! < 0.1, `Zittern ${thumbDrift(A0, S)}`);
  assert.ok(thumbDrift(A0, G)! >= SWEEP.LOCK_DRIFT, `weggezogen ${thumbDrift(A0, G)}`);
  assert.equal(thumbDrift(null, G), null);
});

test("Scanner-Quelltext: kein Zielrahmen, Modus-Umschalter, Session-Dock mit +1, Auto-Binder im Hintergrund, Worker-Gegendruck per try/finally", () => {
  const ls = src("client/scanner/live-scanner.js");
  assert.ok(!/id="ps-ls-guide"|id="ps-ls-quad"|id="ps-ls-mask"|ps-ls-corner|ps-ls-laser/.test(ls), "kein Zielrahmen, keine Maske, kein grünes Kanten-Polygon");
  assert.ok(!/stroke="#34d399"/.test(ls), "kein grüner SVG-Rahmen");
  assert.ok(!/Karte in den Rahmen halten/.test(ls), "Hinweise ohne „Rahmen“");
  const ui = src("client/scanner/sweep-scanner.js");
  assert.ok(!/AUTO_NEXT_MS|ps-sw-auto|animation-duration/.test(ui), "keine ablaufende Aktionsleiste mehr – das Dock bleibt stehen");
  assert.match(ui, /🏷️ Inserieren/); assert.match(ui, /⚡ Schnell-Inserieren/);
  assert.match(ui, /🏷️ 1-Klick Inserieren \(CM-Preis\)/); assert.match(ui, /⚡ Schnell-Inserieren \(Deal unter CM\)/);
  assert.match(ui, /✅ Live auf dem Marktplatz!/);
  assert.match(ui, /function sellButtons/, "Verkaufsbuttons stehen immer im Dock (auch eingeklappt)");
  assert.match(ui, /unfileExtra\(r\.uid, it\.key, it\.finish\)/, "Rückgängig nimmt den automatischen Ordner-Eintrag zurück");
  assert.match(src("server/app.ts"), /\/api\/portfolio\/:id\/undo-one/);
  assert.match(src("client/scanner/quick-list.js"), /export async function listNow/);
  assert.match(ui, /strategy: "quick"/, "Schnell-Inserieren = Deal-Preis unter Cardmarket");
  assert.match(ui, /⚡ Stapel \/ Einzelkarte/); assert.match(ui, /📒 Ordner-Seite/); assert.ok(!/✨ Auto/.test(ui), "keine Modus-Automatik mehr");
  assert.match(ui, /if \(sw\.prefs\.autoFile\) autoFile\(r\.uid, key\)/, "jeder Treffer wird sofort ohne Klick gespeichert (abschaltbar)");
  assert.match(ui, /dailyLabel\(sw\.daily\)/);
  assert.match(ui, /navigator\.vibrate\(35\)/); assert.match(ui, /createOscillator/);
  assert.match(ui, /function drawTag/, "Preisschild-Etikett direkt auf der Karte");
  // Die Kamera-Schleife wartet nie auf das Speichern: autoFile ist eine nicht erwartete Hintergrund-Aufgabe
  assert.ok(!/await autoFile\(/.test(ui));
  const engine = src("client/scanner/sweep-engine.js");
  assert.match(engine, /st\.busy = true;\s*try \{[^]*frame\(msg\);[^]*finally \{ st\.busy = false; \}/, "Worker-Flag garantiert per try/finally zurückgesetzt");
  assert.match(engine, /const pres = cardPresence\(small, grad\)/, "Präsenz-Gate vor jedem Abgleich");
  assert.match(engine, /if \(!pres\.ok \|\| !ready\)/, "ohne Karten-Rechteck kein Abgleich");
  assert.match(engine, /insetQuad\(outer, SWEEP\.CROP_INSET\)/, "3 % Rand ab nach der Begradigung");
  assert.match(engine, /function readCardNumber/, "Sammlernummer auf der begradigten Karte");
  assert.ok(!/cropQuads|Multi-Crop findet/.test(engine), "kein unentzerrter Mittel-Zuschnitt mehr");
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

test("100 % freies Kamerabild: im Kamerafenster nur Video (+ Start-Hinweis vor dem Kamerastart), alle Bedienfelder darunter", () => {
  const ui = src("client/scanner/sweep-scanner.js");
  const cam = /<div id="ps-sw-cam"[\s\S]*?<div id="ps-sw-bar"/.exec(ui)?.[0] || "";
  assert.ok(cam, "Kamerafenster vorhanden");
  assert.match(cam, /id="ps-sw-video"/);
  for (const id of ["ps-sw-sum", "ps-sw-status", "ps-sw-modes", "ps-sw-torch", "ps-sw-dock", "ps-sw-drawer", "ps-sw-overlay", "ps-sw-flash", "data-ls-upload", "ps-sw-list"]) {
    assert.ok(!cam.includes(id), `${id} liegt nicht im Kamerabild`);
  }
  const below = ui.slice(ui.indexOf('<div id="ps-sw-bar"'));
  for (const re of [/id="ps-sw-sum"/, /id="ps-sw-status"/, /data-ls-upload="1"/, /id="ps-sw-list"[^>]*PS\.sweep\('drawer'\)|PS\.sweep\('drawer'\)[^>]*id="ps-sw-list"|id="ps-sw-list" type="button" onclick="PS\.sweep\('drawer'\)"/, /id="ps-sw-dock"/, /id="ps-sw-drawer"/]) assert.match(below, re);
  assert.ok(!/id="ps-sw-overlay"|id="ps-sw-flash"/.test(ui), "kein Overlay-Canvas, kein Blitz über dem Bild");
  assert.match(ui, /`Match: \$\{Math\.round/);
  assert.match(ui, /`\$\{fps\} FPS`/);
  assert.match(ui, /1-Klick Inserieren \(CM-Preis\)/); assert.match(ui, /Schnell-Inserieren \(Deal unter CM\)/);
  assert.match(src("public/sw.js"), /const VERSION = "v17"/);
});
