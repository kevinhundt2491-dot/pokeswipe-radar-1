// Phase 7: Direktkauf (Warenkorb über mehrere Verkäufer, Widerruf, Händlerangaben) und Händler-Bestands-Import
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupCart, blockingProblems, shippingForSeller, sellerOrderTitle, withdrawalOpen, withdrawalDeadline, validateBusinessProfile, type CartLine } from "../server/cart-logic.ts";
import { nextStatus } from "../server/market-logic.ts";
import { parseImport, parsePriceCents, splitNumber, importPrice, cleanImportOptions, normalizeCondition } from "../server/seller-import-logic.ts";

const line = (o: Partial<CartLine>): CartLine => ({
  cartItemId: 1, listingId: 1, sellerId: "a", sellerName: "A", sellerType: "private", sellerPlan: "free", title: "Glurak", image: "",
  variant: "normal", condition: "nm", lang: "de", cardId: "base1-4", unitCents: 1000, priceCentsAtAdd: 1000, shippingCents: 160,
  quantity: 1, available: 1, buyable: true, ...o,
});

test("Warenkorb: Gruppierung je Verkäufer, eine Versandpauschale je Verkäufer, Provision je Tarif", () => {
  const g = groupCart([
    line({ cartItemId: 1, listingId: 1, sellerId: "a", unitCents: 1000, quantity: 2, available: 5 }),
    line({ cartItemId: 2, listingId: 2, sellerId: "a", unitCents: 500, shippingCents: 450 }),
    line({ cartItemId: 3, listingId: 3, sellerId: "b", sellerName: "B", sellerType: "business", sellerPlan: "pro", unitCents: 20000, shippingCents: 0 }),
  ]);
  assert.equal(g.groups.length, 2);
  assert.equal(g.groups[0].sellerId, "b"); // höchster Warenwert zuerst
  const a = g.groups.find((x) => x.sellerId === "a")!;
  assert.equal(a.itemsCents, 2500);
  assert.equal(a.shippingCents, 450); // teuerste Versandart, nicht Summe
  assert.equal(a.feeCents, Math.round(2500 * 0.065));
  assert.equal(a.payoutCents, 2500 + 450 - a.feeCents);
  assert.equal(g.groups[0].feeCents, 600); // Pro: 3 %
  assert.equal(g.totalCents, 2500 + 450 + 20000);
  assert.equal(shippingForSeller([]), 0);
});

test("Warenkorb: nicht verfügbare, zu viele oder nicht kaufbare Positionen blockieren, Preisänderung nur Hinweis", () => {
  const g = groupCart([
    line({ cartItemId: 1, listingId: 1, available: 0 }),
    line({ cartItemId: 2, listingId: 2, quantity: 3, available: 2 }),
    line({ cartItemId: 3, listingId: 3, buyable: false }),
    line({ cartItemId: 4, listingId: 4, unitCents: 1200, priceCentsAtAdd: 1000 }),
  ]);
  assert.deepEqual(g.problems.map((p) => p.problem), ["unavailable", "quantity", "not_buyable", "price_changed"]);
  assert.equal(blockingProblems(g.problems).length, 3);
  assert.equal(g.groups.length, 1);
  assert.equal(g.itemsCents, 1200);
});

test("Teilbestellung: verständlicher Titel", () => {
  assert.equal(sellerOrderTitle([{ title: "Glurak", quantity: 1 }]), "Glurak");
  assert.equal(sellerOrderTitle([{ title: "Glurak", quantity: 3 }]), "3 Artikel: Glurak (3×)");
  assert.equal(sellerOrderTitle([{ title: "Glurak", quantity: 1 }, { title: "Pikachu", quantity: 2 }]), "3 Artikel: Glurak + 1 weitere");
});

test("Widerruf: nur gewerbliche Händler, nur nach Versand und innerhalb der Frist; Bestätigung verkürzt nie", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const until = withdrawalDeadline("shipped", now, 14);
  assert.equal(Math.round((until.getTime() - now.getTime()) / 86400_000), 28);
  assert.equal(withdrawalOpen({ sellerType: "business", status: "shipped", withdrawalUntil: until }, now), true);
  assert.equal(withdrawalOpen({ sellerType: "private", status: "shipped", withdrawalUntil: until }, now), false);
  assert.equal(withdrawalOpen({ sellerType: "business", status: "paid", withdrawalUntil: until }, now), false);
  assert.equal(withdrawalOpen({ sellerType: "business", status: "shipped", withdrawalUntil: until, frozen: true }, now), false);
  assert.equal(withdrawalOpen({ sellerType: "business", status: "released", withdrawalUntil: new Date(now.getTime() - 1000) }, now), false);
  const recv = withdrawalDeadline("received", new Date(now.getTime() + 2 * 86400_000), 14, until);
  assert.equal(recv.getTime(), until.getTime());
  const late = withdrawalDeadline("received", new Date(now.getTime() + 20 * 86400_000), 14, until);
  assert.ok(late.getTime() > until.getTime());
});

test("Statusübergänge: Widerruf und Rücknahme", () => {
  assert.equal(nextStatus("buyer", "withdraw", "shipped"), "withdrawn");
  assert.equal(nextStatus("buyer", "withdraw", "released"), "withdrawn");
  assert.equal(nextStatus("buyer", "withdraw", "paid"), null);
  assert.equal(nextStatus("seller", "accept_return", "withdrawn"), "refunded");
  assert.equal(nextStatus("buyer", "accept_return", "withdrawn"), null);
  assert.equal(nextStatus("admin", "release", "withdrawn"), "released");
});

test("Händlerangaben: Pflichtfelder für gewerbliche Verkäufer, privat ohne Angaben", () => {
  assert.equal(validateBusinessProfile({ sellerType: "business", businessName: "Karten GmbH" }).ok, false);
  const ok = validateBusinessProfile({ sellerType: "business", businessName: "Karten GmbH", businessAddress: "Hauptstr. 1, 50667 Köln", businessEmail: "Shop@Example.de", businessVatId: "de 123456789" });
  assert.ok(ok.ok && ok.value.businessEmail === "shop@example.de" && ok.value.businessVatId === "DE123456789");
  assert.equal(validateBusinessProfile({ sellerType: "business", businessName: "X GmbH", businessAddress: "Hauptstr. 1, 50667 Köln", businessEmail: "a@b.de", businessVatId: "123" }).ok, false);
  const priv = validateBusinessProfile({ sellerType: "private", businessName: "Egal" });
  assert.ok(priv.ok && priv.value.businessName === "");
});

test("Import: Preise, Nummern, Zustände", () => {
  assert.equal(parsePriceCents("12,50"), 1250);
  assert.equal(parsePriceCents("1.234,50 €"), 123450);
  assert.equal(parsePriceCents("1,234.50"), 123450);
  assert.equal(parsePriceCents("$3.99"), 399);
  assert.equal(parsePriceCents("abc"), null);
  assert.deepEqual(splitNumber("004/102"), { number: "4", total: 102 });
  assert.deepEqual(splitNumber("TG12/TG30"), { number: "tg12", total: 30 });
  assert.deepEqual(splitNumber("#199"), { number: "199", total: null });
  assert.equal(normalizeCondition("Lightly Played Reverse Holofoil"), "lp");
  assert.equal(normalizeCondition("MT"), "mint");
  assert.equal(normalizeCondition("kaputt"), null);
});

test("Import: Cardmarket-Bestandsexport", () => {
  const csv = `idArticle;idProduct;English Name;Local Name;Exp.;Exp. Name;Price;Language;Condition;Foil?;Signed?;Playset?;Altered?;Comments;Amount;onSale
123456;273950;Charizard ex;Glurak-ex;OBF;Obsidian Flames;45,90;German;NM;;;;;;2;1
123457;273951;Pikachu;Pikachu;OBF;Obsidian Flames;0,25;English;EX;X;;;;;10;1
123458;273952;Mew;Mew;OBF;Obsidian Flames;1,00;French;NM;;;;;;1;1`;
  const r = parseImport(csv);
  assert.equal(r.format, "cardmarket");
  assert.equal(r.rows.length, 2);
  assert.deepEqual([r.rows[0].sku, r.rows[0].lang, r.rows[0].priceCents, r.rows[0].quantity, r.rows[0].setCode, r.rows[0].condition], ["cm-123456", "de", 4590, 2, "OBF", "nm"]);
  assert.equal(r.rows[1].variant, "reverse_holo");
  assert.equal(r.errors.length, 1); // Französisch nicht unterstützt
  assert.match(r.errors[0].message, /Sprache/);
});

test("Import: freie CSV mit Nummer, stabile SKU ohne Artikelnummer", () => {
  const csv = `Name,Nummer,Set,Zustand,Sprache,Menge,Preis,Variante\nGlurak,4/102,Base Set,Near Mint,Englisch,1,"350,00",1st Edition\nGlurak,4/102,Base Set,Near Mint,Englisch,1,"350,00",1st Edition`;
  const r = parseImport(csv);
  assert.equal(r.format, "generic");
  assert.equal(r.rows[0].number, "4");
  assert.equal(r.rows[0].total, 102);
  assert.equal(r.rows[0].variant, "first_edition");
  assert.equal(r.rows[0].priceCents, 35000);
  assert.equal(r.rows[0].sku, r.rows[1].sku);
  assert.match(r.rows[0].sku, /^auto-/);
});

test("Import: Preisregel Marktpreis × Faktor mit Mindestpreis", () => {
  const o = cleanImportOptions({ priceMode: "trend", factor: "0,95", minPrice: "0,50" });
  assert.equal(importPrice({ priceCents: 999 }, 10, o.price), 950);
  assert.equal(importPrice({ priceCents: 999 }, 0.1, o.price), 50);
  assert.equal(importPrice({ priceCents: 999 }, null, o.price), 999); // ohne Marktpreis: Preis aus der Datei
  assert.equal(importPrice({ priceCents: null }, null, o.price), null);
  assert.equal(cleanImportOptions({ factor: "9" }).price.factor, 3);
});
