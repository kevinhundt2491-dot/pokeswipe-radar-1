// „Die ersten 50 Sammler“ (server/first50-logic.ts), 0 %-Provision im Gründer-Paket und virtueller Marktplatz-Binder
// (client/market-binder-logic.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST50_LIMIT, FIRST50_DAYS, FIRST50_UNLIMITED, first50Active, first50Left, first50Headline, first50Pct, withFirst50 } from "../server/first50-logic.ts";
import { feeFor, MARKET_MIN_FEE_CENTS } from "../server/market-logic.ts";
import { PLANS } from "../server/plans.ts";
import {
  pocketsPerPage, binderIndex, missingInBinder, setOptions, filterBySet, pagesOf, clampIndex, pageOfIndex, pocketPrice, setIdOf,
} from "../client/market-binder-logic.js";

test("Gründer-Aktion: 50 Plätze, 60 Tage, freie Plätze nie negativ", () => {
  assert.equal(FIRST50_LIMIT, 50);
  assert.equal(FIRST50_DAYS, 60);
  assert.equal(first50Left(0), 50);
  assert.equal(first50Left(12), 38);
  assert.equal(first50Left(50), 0);
  assert.equal(first50Left(80), 0);
  assert.equal(first50Left("x"), 50);
  assert.equal(first50Headline(12), "Noch 38 von 50 Gründer-Plätzen frei – jetzt kostenlos Konto sichern!");
  assert.match(first50Headline(50), /Alle 50 Gründer-Plätze sind vergeben/);
  assert.equal(first50Pct(25), 50);
});

test("Gründer-Paket: aktiv nur bis first50Until, dann unbegrenzte Scans/Alarme und 0 % Provision", () => {
  const now = Date.now();
  assert.equal(first50Active({ first50Until: new Date(now + 86400_000) }), true);
  assert.equal(first50Active({ first50Until: new Date(now - 1000) }), false);
  assert.equal(first50Active(null), false);
  assert.equal(withFirst50(3, true), FIRST50_UNLIMITED);
  assert.equal(withFirst50(3, false), 3);
  const normal = feeFor("pro", 10_000, 500);
  assert.ok(normal.feeCents >= MARKET_MIN_FEE_CENTS);
  const free = feeFor("pro", 10_000, 500, true);
  assert.deepEqual(free, { bps: 0, feeCents: 0, totalCents: 10_500, payoutCents: 10_500 });
});

test("Launch-Limits: mindestens 300 Karten kostenlos im Binder", () => {
  assert.ok(PLANS.free.portfolio >= 300);
  assert.ok(PLANS.premium.portfolio > PLANS.free.portfolio);
});

test("Marktplatz-Binder: 3×3 am Desktop, 2×2 auf dem Handy, Seiten & Index", () => {
  assert.equal(pocketsPerPage(true), 9);
  assert.equal(pocketsPerPage(false), 4);
  const list = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(pagesOf(list, 9).map((p) => p.length), [9, 1]);
  assert.deepEqual(pagesOf(list, 4).map((p) => p.length), [4, 4, 2]);
  assert.deepEqual(pagesOf([], 9), [[]]);
  assert.equal(clampIndex(12, 3), 2);
  assert.equal(clampIndex(-1, 3), 0);
  assert.equal(pageOfIndex(9, 9), 1);
  assert.equal(pageOfIndex(5, 4), 1);
});

test("Marktplatz-Binder: „⚡ Fehlt in deinem Binder!“ nur für gesammelte Sets und fehlende Karten", () => {
  const idx = binderIndex([{ cardId: "sv03.5-4" }, { card_id: "sv08-1" }]);
  assert.equal(missingInBinder({ card_id: "sv03.5-6" }, idx), true);
  assert.equal(missingInBinder({ card_id: "sv03.5-4" }, idx), false);
  assert.equal(missingInBinder({ card_id: "swsh1-1" }, idx), false);
  assert.equal(missingInBinder({ card_id: "" }, idx), false);
  assert.equal(setIdOf("SV03.5-199"), "sv03.5");
});

test("Marktplatz-Binder: Set-Filter, Preis oder Tausch", () => {
  const ls = [{ id: 1, card_id: "sv08-1" }, { id: 2, card_id: "sv08-2" }, { id: 3, card_id: "sv03.5-1" }, { id: 4, card_id: "" }];
  assert.deepEqual(setOptions(ls).map((s) => [s.id, s.n]), [["sv08", 2], ["sv03.5", 1]]);
  assert.deepEqual(filterBySet(ls, "sv08").map((l) => l.id), [1, 2]);
  assert.equal(filterBySet(ls, "").length, 4);
  const eur = (n: number) => `${n.toFixed(2)} €`;
  assert.equal(pocketPrice({ price: 12.5 }, eur), "12.50 €");
  assert.equal(pocketPrice({ price: 0 }, eur), "🔄 Tausch");
});
