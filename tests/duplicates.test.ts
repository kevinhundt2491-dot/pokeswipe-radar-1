// Scan-Workflow & doppelte Karten: automatisches Einsortieren in den Set-Ordner, Mengen-Zähler („2x“, „3x“),
// Umschalter „Doppelte im Gesamtwert mitzählen“, 1-Klick „Alle Doppelten inserieren“ (1 Exemplar bleibt im Binder)
// sowie Suche & Filter-Chips in der Kartenauswahl unter „Marktplatz → Meine Inserate“.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mergeKey, findMergeTarget, bumpQuantity, quantityBadge, cardValue, setValue, folderValue, binderTotal, readCountDupes,
  ownedCards, duplicatePlan, dupeConfirmText, dupeListingPayloads, chunk, listingCondition, filterPickList, groupPickBySet,
  matchesQuery, PICK_FILTERS, COUNT_DUPES_KEY, LISTING_BATCH,
} from "../server/duplicates-logic.ts";
import { groupBinderBySet, buildBinderCards, binderSummary } from "../server/binder-logic.ts";
import { shouldAutoFile, createAutoFiler, AUTO_FILE_ACTIONS, RESULT_ACTIONS } from "../client/scanner/scan-ui-logic.js";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// 1. Automatisches Einsortieren nach dem Scan
// ---------------------------------------------------------------------------
test("Auto-Einsortieren: sicherer Treffer wird beim Weiter-Scannen gespeichert – unsicher, Gast, Video-Bühne oder schon gespeichert nicht", () => {
  const hit = { info: { key: "card:sv03.5-199" } };
  assert.equal(shouldAutoFile(hit, { loggedIn: true }), true);
  assert.equal(shouldAutoFile({ ...hit, unsure: true }, { loggedIn: true }), false);
  assert.equal(shouldAutoFile({ ...hit, filed: true }, { loggedIn: true }), false);
  assert.equal(shouldAutoFile({ ...hit, loading: Symbol("x") }, { loggedIn: true }), false);
  assert.equal(shouldAutoFile(hit, { loggedIn: false }), false);
  assert.equal(shouldAutoFile(hit, { loggedIn: true, stage: true }), false);
  assert.equal(shouldAutoFile(null, { loggedIn: true }), false);
  // „Als Inserat einstellen“ speichert die Karte zusätzlich im Set-Ordner, Wunschliste/Details nicht
  assert.deepEqual(AUTO_FILE_ACTIONS, ["binder", "sell", "instant"]);
  assert.equal(RESULT_ACTIONS.sell.label, "🏷️ Als Inserat einstellen");
});

test("Auto-Einsortieren: jeder Treffer genau einmal (Doppelklick, Speichern nach Auto-Einsortieren), Fehler darf wiederholt werden", async () => {
  const saved: string[] = [];
  let fail = true;
  const file = createAutoFiler(async (x: any) => { if (fail) { fail = false; throw new Error("offline"); } saved.push(x.key); return { id: 1, quantity: 1 }; });
  const hit: any = { info: {} };
  await assert.rejects(file(hit, { key: "a" }));
  assert.equal(hit.filed, false, "nach Fehler erneut möglich");
  const [r1, r2] = await Promise.all([file(hit, { key: "a" }), file(hit, { key: "a" })]);
  assert.deepEqual(r1, { id: 1, quantity: 1 });
  assert.equal(r2, null);
  assert.equal(await file(hit, { key: "a" }), null);
  assert.deepEqual(saved, ["a"]);
  // Zweiter Scan derselben Karte = neuer Treffer → wird gespeichert (Server zählt hoch)
  await file({ info: {} }, { key: "a" });
  assert.deepEqual(saved, ["a", "a"]);
});

test("Auto-Einsortieren im Scanner: Weiter/✕, nächster Treffer und Aktionen speichern mit merge; „Alle zur Sammlung“ überspringt Einsortierte", () => {
  const s = src("client/scanner/live-scanner.js");
  assert.match(s, /body\.merge = true;/);
  assert.match(s, /liveScanNext: \(\) => \{ autoFileCurrent\(\); nextCard\(\); \}/);
  const present = s.slice(s.indexOf("function presentHit("), s.indexOf("async function showHit("));
  assert.ok(present.indexOf("autoFileCurrent()") < present.indexOf("sc.current = {"), "vorheriger Treffer wird vor dem Ersetzen einsortiert");
  const show = s.slice(s.indexOf("async function showHit("), s.indexOf("const priceTxt"));
  assert.ok(show.indexOf("autoFileCurrent()") > -1 && show.indexOf("autoFileCurrent()") < show.indexOf("sc.current = {"));
  const actions = s.slice(s.indexOf("const HIT_ACTIONS = {"), s.indexOf("function actOnHit("));
  assert.match(actions, /async binder\(x\) \{\s+const item = await fileHit\(x\);/);
  assert.match(actions, /sell\(x, mode = ""\) \{[\s\S]*?fileHit\(x\)[\s\S]*?openQuickList\(/, "Inserat + Set-Ordner");
  assert.ok(!/wish\(x\)[^}]*fileHit/.test(actions), "Wunschliste sortiert nicht ein");
  assert.match(s, /filter\(\(i\) => !i\.filed\)/);
  assert.match(s, /data-hud-autofile/);
});

// ---------------------------------------------------------------------------
// 2. Duplikate hochzählen
// ---------------------------------------------------------------------------
test("Duplikate: gleiche Karte + Variante + Zustand wird hochgezählt statt zweiten Slot anzulegen", () => {
  const existing = [
    { id: 1, cardId: "sv03.5-199", printId: null, variant: "normal", condition: "NM", quantity: 1 },
    { id: 2, cardId: "sv03.5-199", printId: null, variant: "reverse_holo", condition: "NM", quantity: 1 },
    { id: 3, cardId: "sv08-238", printId: "en:sv08-238", variant: "normal", condition: "NM", quantity: 2 },
  ];
  assert.equal(findMergeTarget(existing, { cardId: "sv03.5-199", variant: "normal", condition: "NM" })?.id, 1);
  assert.equal(findMergeTarget(existing, { cardId: "sv03.5-199", variant: "reverse_holo", condition: "nm" })?.id, 2);
  assert.equal(findMergeTarget(existing, { cardId: "sv03.5-199", variant: "normal", condition: "EX" }), null, "anderer Zustand = eigener Eintrag");
  assert.equal(findMergeTarget(existing, { printId: "en:sv08-238", cardId: "sv08-238", variant: "normal", condition: "NM" })?.id, 3);
  assert.equal(findMergeTarget(existing, { cardId: "sv08-238", variant: "normal", condition: "NM" }), null, "deutsche Karte ≠ englischer Druck");
  assert.equal(mergeKey({}), "");
  assert.equal(bumpQuantity(1), 2);
  assert.equal(bumpQuantity(2, 1), 3);
  assert.equal(bumpQuantity(999), 999);
  assert.equal(quantityBadge(1), "");
  assert.equal(quantityBadge(2), "2x");
  assert.equal(quantityBadge(3), "3x");
});

test("Duplikate im Set-Ordner: eine Karte, ein Slot, Mengen-Badge „3x“ oben auf der Karte", () => {
  const cards = buildBinderCards({
    catalog: [{ id: "sv08-1", name: "A", localId: "1", price: 5 }, { id: "sv08-2", name: "B", localId: "2", price: 2 }],
    owned: [{ cardId: "sv08-1", quantity: 2, value: 10 }, { cardId: "sv08-1", quantity: 1, condition: "EX", value: 5 }],
    myListings: [], marketListings: [], viewerId: "me",
  });
  assert.equal(cards.length, 2);
  assert.equal(cards[0].quantity, 3);
  assert.equal(quantityBadge(cards[0].quantity), "3x");
  const b = src("client/binder.js");
  assert.match(b, /ps-bslot-qty" data-qty="\$\{Number\(c\.quantity\)\}"[^>]*>\$\{quantityBadge\(c\.quantity\)\}/);
  const server = src("server/app.ts");
  assert.match(server, /if \(b\.merge === true\) \{\s+const merged = await mergeIntoPortfolio\(user\.id, b\);/);
  assert.match(server, /bumpQuantity\(target\.quantity/);
});

// ---------------------------------------------------------------------------
// 2b. Umschalter „Doppelte im Gesamtwert mitzählen“
// ---------------------------------------------------------------------------
test("Gesamtwert-Umschalter: An = 3x 5,00 € = 15,00 €, Aus = jede Karte 1×; Standard An", () => {
  assert.equal(cardValue(15, 3, true), 15);
  assert.equal(cardValue(15, 3, false), 5);
  assert.equal(readCountDupes(null), true);
  assert.equal(readCountDupes("1"), true);
  assert.equal(readCountDupes("0"), false);
  assert.equal(COUNT_DUPES_KEY, "ps_binder_count_dupes");

  const cards = buildBinderCards({
    catalog: [{ id: "sv08-1", name: "A", localId: "1", price: 5 }, { id: "sv08-2", name: "B", localId: "2", price: 2 }, { id: "sv08-3", name: "C", localId: "3", price: 9 }],
    owned: [{ cardId: "sv08-1", quantity: 3, value: 15 }, { cardId: "sv08-2", quantity: 1, value: 2 }],
    myListings: [], marketListings: [], viewerId: "me",
  });
  assert.equal(setValue(cards, true), 17);
  assert.equal(setValue(cards, false), 7);
  const on = binderSummary(cards, 3), off = binderSummary(cards, 3, false);
  assert.equal(on.value, 17);
  assert.equal(off.value, 7);
  assert.equal(on.duplicates, 2);
  assert.equal(on.copies, 4);
  assert.equal(off.owned, 2, "Fortschritt bleibt gleich");

  const folders = groupBinderBySet([
    { cardId: "sv08-1", quantity: 3, value: 15 }, { cardId: "sv08-2", quantity: 1, value: 2 },
    { cardId: "sv03.5-199", quantity: 2, value: 200 }, { cardId: "sv03.5-199", quantity: 1, value: 100 },
  ], {});
  const sv08 = folders.find((f) => f.setId === "sv08")!, s151 = folders.find((f) => f.setId === "sv03.5")!;
  assert.equal(sv08.value, 17);
  assert.equal(sv08.uniqueValue, 7);
  assert.equal(s151.uniqueValue, 100);
  assert.equal(folderValue(sv08, true), 17);
  assert.equal(folderValue(sv08, false), 7);
  assert.equal(folderValue({ value: 12 }, false), 12, "ältere Antwort ohne uniqueValue");
  assert.equal(binderTotal(folders, true), 317);
  assert.equal(binderTotal(folders, false), 107);
});

test("Gesamtwert-Umschalter: genau ein schlichter Schalter oben in „Meine Set-Ordner“ mit Gesamtwert", () => {
  const html = src("public/index.html");
  const box = html.slice(html.indexOf('id="ps-binder-folders"'), html.indexOf("data-folders "));
  assert.equal((box.match(/data-count-dupes/g) || []).length, 1);
  assert.match(box, /role="switch"[^>]*aria-checked="true"[^>]*onclick="PS\.binderCountDupes\(\)"/);
  assert.match(box, />Doppelte im Gesamtwert mitzählen</);
  assert.match(box, /data-binder-total/);
  assert.match(src("client/binder.js"), /binderCountDupes: \(on\) =>/);
});

// ---------------------------------------------------------------------------
// 3. „Alle Doppelten inserieren“
// ---------------------------------------------------------------------------
const portfolio = [
  { id: 1, cardId: "sv03.5-199", name: "Glurak-ex", image: "g.png", setName: "151", quantity: 3, unitValue: 120, condition: "NM", variant: "normal" },
  { id: 2, cardId: "sv03.5-6", name: "Glurak", image: "c.png", setName: "151", quantity: 1, unitValue: 4, condition: "NM" },
  { id: 3, cardId: "sv08-238", name: "Pikachu-ex", image: "p.png", setName: "Stürmische Funken", quantity: 2, unitValue: 50, condition: "EX" },
  { id: 4, cardId: "sv08-238", name: "Pikachu-ex", image: "p.png", setName: "Stürmische Funken", quantity: 1, unitValue: 42.5, condition: "LP" },
  { id: 5, cardId: "sv08-10", name: "Ohne Preis", image: "", setName: "Stürmische Funken", quantity: 2, unitValue: 0, condition: "NM" },
  { id: 6, printId: "ja:SV2a-201", cardId: null, lang: "ja", name: "Glurak ex (JP)", image: "j.png", setName: "Pokémon Card 151", quantity: 2, unitValue: 30, condition: "" },
];

test("Alle Doppelten inserieren: je Karte bleibt 1 Exemplar im Binder, Rest mit Zustand & Cardmarket-Preis", () => {
  const plan = duplicatePlan(portfolio);
  const by = (k: string) => plan.cards.find((c) => c.key === k)!;
  assert.equal(by("card:sv03.5-199").toList, 2, "3 Exemplare → 2 inserieren, 1 behalten");
  assert.equal(by("card:sv08-238").quantity, 3);
  assert.equal(by("card:sv08-238").toList, 2);
  assert.equal(by("card:sv08-238").condition, "EX", "Zustand vom Eintrag mit den meisten Exemplaren");
  assert.equal(by("print:ja:SV2a-201").toList, 1);
  assert.ok(!plan.cards.some((c) => c.key === "card:sv03.5-6"), "Einzelkarte wird nicht inseriert");
  assert.equal(plan.copies, 5);
  assert.equal(plan.noPrice, 1, "ohne Vergleichspreis nicht automatisch");
  assert.equal(plan.value, 2 * 120 + 2 * 50 + 30);
  assert.match(dupeConfirmText(plan), /^5 doppelte Karten jetzt zum Cardmarket-Preis inserieren\?/);
  assert.match(dupeConfirmText({ ...plan, copies: 1 }), /^1 doppelte Karte jetzt/);

  const payloads = dupeListingPayloads(plan);
  assert.equal(payloads.length, 5);
  const glurak = payloads.filter((p) => p.cardId === "sv03.5-199");
  assert.equal(glurak.length, 2);
  assert.deepEqual(glurak[0], { cardId: "sv03.5-199", card: "Glurak-ex", price: 120, condition: "nm", variant: "normal", lang: "de", img: "g.png", portfolioItemId: 1, want: "Verkauf", source: "dupes" });
  assert.equal(payloads.find((p) => p.cardId === "sv08-238")?.condition, "ex");
  const jp = payloads.find((p) => p.printId === "ja:SV2a-201")!;
  assert.equal(jp.condition, "nm", "Standard: Near Mint");
  assert.equal(jp.lang, "ja");
  assert.equal(listingCondition("PL"), "pl");
  assert.equal(listingCondition(undefined), "nm");
});

test("Alle Doppelten inserieren: bereits inserierte Doppelte werden erkannt – erneuter Klick erzeugt keine doppelten Inserate", () => {
  const first = duplicatePlan(portfolio);
  // Ergebnis des ersten Klicks: Inserate wie vom Server angelegt
  const created = dupeListingPayloads(first).map((p, i) => ({ id: 100 + i, card_id: (p.cardId as string) || null, print_id: (p.printId as string) || null, status: "active" }));
  const again = duplicatePlan(portfolio, created);
  assert.equal(again.copies, 0);
  assert.equal(again.alreadyListed, 5);
  // Ein Inserat verkauft/entfernt → nur dieses Exemplar fehlt wieder
  const partial = duplicatePlan(portfolio, created.slice(1).concat([{ ...created[0], status: "sold" }]));
  assert.equal(partial.copies, 1);
  // Einzelkarte, die schon inseriert ist, bleibt unberührt
  const single = ownedCards(portfolio, [{ card_id: "sv03.5-6", status: "active" }]).find((c) => c.key === "card:sv03.5-6")!;
  assert.equal(single.listed, 1);
  assert.equal(single.toList, 0);
  // Server-Grenze: höchstens 20 Inserate je Anfrage
  assert.equal(LISTING_BATCH, 20);
  assert.deepEqual(chunk(Array.from({ length: 45 }, (_, i) => i)).map((c) => c.length), [20, 20, 5]);
});

test("Alle Doppelten inserieren: klarer Button in „Meine Inserate“ und kompakt im Set-Ordner, mit Bestätigung", () => {
  const nav = src("client/app-nav.js");
  const mine = nav.slice(nav.indexOf("function mySalesHtml("), nav.indexOf("function placeBatchBox("));
  assert.match(mine, /\$\{listPickerHtml\(\)\}/);
  const lp = src("client/list-picker.js");
  assert.match(lp, /onclick="PS\.listAllDupes\(\)"[^>]*>🏷️ Alle Doppelten inserieren</);
  assert.match(lp, /await loadMyListings\(\);\s+const plan = duplicatePlan/);
  assert.match(lp, /window\.confirm\(dupeConfirmText\(plan\)\)/);
  assert.match(lp, /chunk\(dupeListingPayloads\(plan\)\)/);
  assert.match(src("client/binder.js"), /onclick="PS\.listAllDupes\(\)" data-binder-list-dupes/);
});

// ---------------------------------------------------------------------------
// 4. Suche & Filter in der Kartenauswahl
// ---------------------------------------------------------------------------
test("Kartenauswahl: Suche nach Name, Sammlernummer oder Set; Chips Alle | Nur Doppelte | Nach Set", () => {
  const cards = ownedCards(portfolio);
  assert.deepEqual(PICK_FILTERS.map(([, l]) => l), ["Alle", "Nur Doppelte", "Nach Set"]);
  const names = (q: string, f: any = "all") => filterPickList(cards, q, f).map((c) => c.name);
  assert.deepEqual(names(""), ["Glurak", "Glurak ex (JP)", "Glurak-ex", "Ohne Preis", "Pikachu-ex"]);
  assert.deepEqual(names("pika"), ["Pikachu-ex"]);
  assert.deepEqual(names("199"), ["Glurak-ex"]);
  assert.deepEqual(names("#199/165"), ["Glurak-ex"]);
  assert.deepEqual(names("006"), ["Glurak"], "führende Nullen");
  assert.deepEqual(names("Stürmische"), ["Ohne Preis", "Pikachu-ex"]);
  assert.deepEqual(names("sturmische"), ["Ohne Preis", "Pikachu-ex"], "ohne Umlaut");
  assert.deepEqual(names("sv03.5"), ["Glurak", "Glurak-ex"]);
  assert.deepEqual(names("glurak 151"), ["Glurak", "Glurak ex (JP)", "Glurak-ex"]);
  assert.deepEqual(names("", "dupes"), ["Glurak ex (JP)", "Glurak-ex", "Ohne Preis", "Pikachu-ex"]);
  assert.deepEqual(names("glurak", "dupes"), ["Glurak ex (JP)", "Glurak-ex"]);
  const bySet = groupPickBySet(filterPickList(cards, "", "set"));
  assert.deepEqual(bySet.map((g) => g.setName), ["151", "Pokémon Card 151", "Stürmische Funken"]);
  assert.deepEqual(bySet[0].cards.map((c) => c.number), ["6", "199"]);
  assert.equal(matchesQuery({ name: "Pikachu", number: "25", setName: "", setId: "" }, "2"), false, "Nummer exakt, nicht Teilstring");
});

test("Kartenauswahl: schlichte Suchleiste + 3 Chips, keine Popups; Tippen zeichnet nur die Liste neu", () => {
  const lp = src("client/list-picker.js");
  const html = lp.slice(lp.indexOf("export function listPickerHtml("), lp.indexOf("export function renderListPicker("));
  assert.match(html, /type="search"[^>]*oninput="PS\.pickSearch\(this\.value\)"/);
  assert.match(html, /placeholder="🔍 Karte suchen: Name, Nummer oder Set"/);
  assert.match(html, /PICK_FILTERS\.map/);
  assert.ok(!/<select|<details|modal\(/.test(html), "keine verschachtelten Menüs");
  const render = lp.slice(lp.indexOf("export function renderListPicker("), lp.indexOf("/** 1-Klick"));
  assert.ok(!/ps-pick-search/.test(render), "Suchfeld behält beim Tippen den Fokus");
});
