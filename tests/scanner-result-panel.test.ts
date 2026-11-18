// Live-Scanner-Ergebnisfeld: Auto-Close nach Aktionsklick, Standard „Near Mint“, Zustands-Umschalter, Varianten-
// Umschalter, Cooldown gegen Doppel-Scans, Zoom-Fähigkeitsprüfung (iOS Safari), Blendungs-Check, Hash-Priorität.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCAN_CONDS, SCAN_COND_LABEL, DEFAULT_CONDITION, RESULT_ACTIONS, newHitView, mainPrice, conditionOptions, conditionChipLabel,
  toggleConditionMenu, selectCondition, selectFinish, finishPrice, conditionPrice, createActionRunner, createCooldown, zoomPlan,
  glareCheck, hashDecision, SAME_CARD_COOLDOWN_MS, GLARE_SKIP,
} from "../client/scanner/scan-ui-logic.js";
import { SCORE_STRONG, SCORE_ACCEPT, MARGIN_MIN } from "../server/scan-logic.ts";

const card = { key: "card:sv03.5-199", name: "Glurak-ex", price: 100, reversePrice: 140 };

/** Kleiner Nachbau des Ergebnisfelds: gleicher Ablauf wie im Scanner (öffnen → Aktion → Auto-Close → Toast). */
function panelHarness() {
  const log: string[] = [];
  const panel = { open: false, current: null as any, toasts: [] as string[], cameraActive: true, suppress: [] as string[] };
  const showHit = (info: any) => { panel.current = { info, ...newHitView() }; panel.open = true; };
  const run = createActionRunner({
    close: () => { log.push("close"); panel.suppress = [panel.current?.info.key]; panel.current = null; panel.open = false; },
    resume: () => { log.push("resume"); panel.cameraActive = true; },
    notify: (t: string) => { log.push("toast"); panel.toasts.push(t); },
    onError: () => log.push("error"),
  });
  return { panel, log, showHit, run };
}

test("Neuer Scan: Zustand ist immer Near Mint, nur der NM-Preis wird gezeigt, Dropdown zu", () => {
  const v = newHitView();
  assert.equal(v.condition, "NM");
  assert.equal(DEFAULT_CONDITION, "NM");
  assert.equal(v.condMenu, false);
  assert.equal(v.finish, "normal");
  assert.equal(mainPrice(card, v), 100);
  assert.equal(conditionChipLabel(v), "Zustand: Near Mint ▾");
  // Auch wenn beim vorigen Treffer „Played“ gewählt war, startet der nächste Scan wieder mit NM
  const h = panelHarness();
  h.showHit(card);
  Object.assign(h.panel.current, selectCondition(h.panel.current, "PL"));
  assert.equal(h.panel.current.condition, "PL");
  h.showHit({ ...card, key: "card:sv08-238", price: 20 });
  assert.equal(h.panel.current.condition, "NM");
  assert.equal(mainPrice(h.panel.current.info, h.panel.current), 20);
});

test("Zustands-Umschalter: Dropdown mit allen Zuständen + Vergleichspreisen, Auswahl übernimmt Preis und schließt", () => {
  assert.deepEqual(SCAN_CONDS, ["NM", "EX", "GD", "LP", "PL", "PO"]);
  assert.equal(SCAN_COND_LABEL.PL, "Bespielt / Played");
  let v = newHitView();
  v = toggleConditionMenu(v);
  assert.equal(v.condMenu, true);
  assert.equal(conditionChipLabel(v), "Zustand: Near Mint ▴");
  const opts = conditionOptions(card, v);
  assert.deepEqual(opts.map((o) => o.code), SCAN_CONDS);
  assert.deepEqual(opts.map((o) => o.price), [100, 85, 70, 60, 45, 30]);
  assert.deepEqual(opts.filter((o) => o.active).map((o) => o.code), ["NM"]);
  v = selectCondition(v, "LP");
  assert.equal(v.condition, "LP");
  assert.equal(v.condMenu, false, "Untermenü schließt nach der Auswahl");
  assert.equal(mainPrice(card, v), 60);
  assert.equal(conditionChipLabel(v), "Zustand: Light Played ▾");
  // Ungültiger Code: Zustand bleibt, Menü schließt
  const w = selectCondition(toggleConditionMenu(v), "XX");
  assert.equal(w.condition, "LP");
  assert.equal(w.condMenu, false);
});

test("Varianten-Umschalter (Normal / Reverse / Holo) zieht den passenden Preis", () => {
  let v = newHitView();
  v = selectFinish(v, "reverse_holo");
  assert.equal(mainPrice(card, v), 140);
  assert.equal(conditionPrice(card, "reverse_holo", "EX"), 119);
  v = selectFinish(v, "holo");
  assert.equal(finishPrice(card, "holo"), 100, "ohne eigenen Holo-Preis gilt der Basispreis");
  assert.equal(finishPrice({ ...card, holoPrice: 180 }, "holo"), 180);
  assert.equal(selectFinish(v, "glitter").finish, "holo", "unbekannte Variante ändert nichts");
  assert.equal(newHitView({ finish: "reverse_holo" }).finish, "reverse_holo");
  assert.equal(mainPrice({ key: "x", price: null }, newHitView()), 0);
});

test("Auto-Close: Aktionsklick schließt das Ergebnisfeld sofort, Kamera bleibt aktiv, danach kurzer Toast", async () => {
  for (const name of ["binder", "sell", "instant", "wish"]) {
    const h = panelHarness();
    h.showHit(card);
    let releaseAction: () => void = () => {};
    let ranWhileClosed = false;
    const p = h.run(name, () => new Promise<void>((r) => { ranWhileClosed = !h.panel.open; releaseAction = r; }));
    // Noch bevor die Aktion fertig ist: Feld zu, Kamera aktiv, Karte bis zum Herausnehmen ignoriert
    assert.equal(h.panel.open, false, `${name}: sofort geschlossen`);
    assert.equal(h.panel.current, null);
    assert.equal(h.panel.cameraActive, true);
    assert.deepEqual(h.panel.suppress, [card.key]);
    assert.equal(ranWhileClosed, true);
    assert.deepEqual(h.panel.toasts, [], "Toast erst nach erfolgreicher Aktion");
    releaseAction();
    await p;
    assert.deepEqual(h.log, ["close", "resume", "toast"]);
    assert.deepEqual(h.panel.toasts, [RESULT_ACTIONS[name].toast]);
  }
  assert.equal(RESULT_ACTIONS.binder.toast, "💼 Zum Binder hinzugefügt");
});

test("Auto-Close: eigener Toast-Text, kein Toast bei false oder Fehler – das Feld ist trotzdem zu", async () => {
  const h = panelHarness();
  h.showHit(card);
  await h.run("binder", async () => "💼 Zum Binder hinzugefügt · Glurak-ex (NM)");
  assert.deepEqual(h.panel.toasts, ["💼 Zum Binder hinzugefügt · Glurak-ex (NM)"]);

  const h2 = panelHarness();
  h2.showHit(card);
  assert.equal(await h2.run("details", () => false), false);
  assert.equal(h2.panel.open, false);
  assert.deepEqual(h2.panel.toasts, []);

  const h3 = panelHarness();
  h3.showHit(card);
  assert.equal(await h3.run("wish", async () => { throw new Error("offline"); }), false);
  assert.equal(h3.panel.open, false);
  assert.deepEqual(h3.log, ["close", "resume", "error"]);
});

test("Cooldown: dieselbe Karte ~0,9 s lang kein zweites Mal, andere Karten sofort", () => {
  assert.ok(SAME_CARD_COOLDOWN_MS >= 800 && SAME_CARD_COOLDOWN_MS <= 1000);
  const cd = createCooldown();
  const t = 10_000;
  cd.mark(["card:a", "print:en:a"], t);
  assert.equal(cd.blocked(["card:a"], t + 100), true);
  assert.equal(cd.blocked(["print:en:a"], t + 500), true, "Sprachvariante derselben Karte");
  assert.equal(cd.blocked(["card:b"], t + 100), false);
  assert.equal(cd.blocked(["card:a"], t + SAME_CARD_COOLDOWN_MS + 1), false);
  cd.mark("card:c", t);
  cd.reset();
  assert.equal(cd.blocked("card:c", t), false);
});

test("Zoom 1,4×: sauberer Fähigkeits-Check, iOS Safari ohne Zoom → Standard-Zoom ohne Fehler", () => {
  assert.deepEqual(zoomPlan(undefined), { apply: false, zoom: 1, reason: "unsupported" });
  assert.deepEqual(zoomPlan({}), { apply: false, zoom: 1, reason: "unsupported" }, "iOS Safari < 17: kein zoom in getCapabilities");
  assert.equal(zoomPlan({ zoom: { min: 1, max: 1 } }).apply, false);
  assert.equal(zoomPlan({ zoom: { min: 2, max: 8 } }).apply, false);
  assert.equal(zoomPlan({ zoom: { min: 1, max: "x" } }).apply, false);
  assert.deepEqual(zoomPlan({ zoom: { min: 1, max: 10, step: 0.1 } }), { apply: true, zoom: 1.4, reason: "ok" });
  assert.deepEqual(zoomPlan({ zoom: { min: 0.5, max: 6, step: 0.25 } }).zoom, 1.5, "auf die Schrittweite gerundet (iOS 17 Ultraweitwinkel)");
  assert.equal(zoomPlan({ zoom: { min: 1, max: 4 } }).zoom, 1.4);
});

test("Blendungs-Check vor der Texterkennung: Hinweis bei starkem Glanz, Lesung auslassen bei Überbelichtung", () => {
  const img = (w: number, h: number, hotShare: number) => {
    const d = new Uint8ClampedArray(w * h * 4);
    const hot = Math.round(w * h * hotShare);
    for (let i = 0; i < w * h; i++) { const v = i < hot ? 255 : 90; d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    return d;
  };
  assert.deepEqual(glareCheck(img(10, 10, 0), 10, 10, { stride: 1 }), { ratio: 0, high: false, skip: false });
  const mid = glareCheck(img(10, 10, 0.12), 10, 10, { stride: 1 });
  assert.equal(mid.high, true);
  assert.equal(mid.skip, false);
  const over = glareCheck(img(10, 10, 0.5), 10, 10, { stride: 1 });
  assert.ok(over.ratio > GLARE_SKIP && over.skip);
  assert.deepEqual(glareCheck(null, 0, 0), { ratio: 0, high: false, skip: false });
});

test("Bild-Fingerabdruck zuerst: eindeutiges Artwork reicht auch ohne lesbare Sammlernummer", () => {
  assert.equal(hashDecision({ accepted: false, score: 10 }), "none");
  assert.equal(hashDecision({ accepted: true, byNumber: true, score: 50 }), "hit");
  assert.equal(hashDecision({ accepted: true, score: SCORE_STRONG, margin: MARGIN_MIN }), "hit");
  // Fett-kursive Nummer nicht lesbar, Artwork aber klar vorn → sofort, ohne auf ein zweites Bild zu warten
  assert.equal(hashDecision({ accepted: true, score: SCORE_ACCEPT - 2, margin: MARGIN_MIN * 2 }), "hit");
  // Knapper Vorsprung oder Glanz → zweites übereinstimmendes Bild abwarten
  assert.equal(hashDecision({ accepted: true, score: SCORE_ACCEPT - 2, margin: MARGIN_MIN }), "wait");
  assert.equal(hashDecision({ accepted: true, score: SCORE_ACCEPT - 2, margin: 40, glareHigh: true }), "wait");
  assert.equal(hashDecision({ accepted: true, score: SCORE_ACCEPT - 2, margin: MARGIN_MIN }, 2), "hit");
});

test("Scanner-Oberfläche: Ergebnisfeld-Aktionen laufen über Auto-Close, Zustand als Unter-Button, Feedback + Zoom-Check", () => {
  const src = readFileSync(new URL("../client/scanner/live-scanner.js", import.meta.url), "utf8");
  const hud = src.slice(src.indexOf("function renderHud("), src.indexOf("/** Zustand/Variante des aktuellen Treffers"));
  assert.match(hud, /PS\.liveScanAct\('\$\{name\}'/);
  for (const name of ["binder", "sell", "instant", "wish"]) assert.ok(hud.includes(`act("${name}"`), `Haupt-Aktion ${name}`);
  assert.ok(!/PS\.liveScanAdd\(|PS\.liveScanSell\(/.test(hud), "keine Aktion ohne Auto-Close im Ergebnisfeld");
  assert.match(hud, /PS\.liveScanCondMenu\(\)/);
  assert.match(hud, /condMenu \?/, "Zustandsliste nur im aufgeklappten Dropdown");
  assert.match(hud, /PS\.liveScanFinish\(/);
  assert.match(src, /navigator\.vibrate\(40\)/);
  assert.match(src, /zoomPlan\(caps, CAMERA_ZOOM\)/);
  assert.match(src, /glareOf\(video, rect\)/);
  assert.match(src, /hashDecision\(m, sc\.streak\)/);
  const lazy = readFileSync(new URL("../client/lazy.js", import.meta.url), "utf8");
  for (const k of ["liveScanAct", "liveScanCondMenu", "liveScanMore", "liveScanSound"]) assert.ok(lazy.includes(`"${k}"`), `${k} ist in PS registriert`);
});
