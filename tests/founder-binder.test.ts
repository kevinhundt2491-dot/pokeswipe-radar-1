// App-Icon & PWA-Manifest, Einladungs-Link-Tracking, Gründer-Sammler-Belohnung (5 Uploads ODER 1 Anmeldung),
// Set-Ordner inkl. Swipe-Navigation und der Live-Abgleich fehlender Binder-Karten mit Marktplatz-Angeboten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  founderStatus, founderQualifies, monotonic, boostAllowance, alertAllowance, isUploadPath, inviteShareText, INVITE_CALL,
  FOUNDER_UPLOAD_GOAL, FOUNDER_SIGNUP_GOAL, FOUNDER_FREE_BOOSTS, FOUNDER_EXTRA_ALERTS, FOUNDER_BADGE,
} from "../server/founder-logic.ts";
import {
  setIdOfCard, localIdOfCard, compareLocalId, collectorNumber, groupBinderBySet, buildBinderCards, bestOffersByCard,
  marketBadgeLabel, paginate, clampPage, swipeDirection, binderSummary, BINDER_PAGE_SIZE,
} from "../server/binder-logic.ts";
import { referralLink } from "../server/referral-logic.ts";
import { BADGES } from "../server/logic.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url));
const pngSize = (buf: Buffer) => {
  assert.equal(buf.subarray(1, 4).toString("ascii"), "PNG", "keine PNG-Datei");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

// ---------------------------------------------------------------------------
// PWA-Manifest & App-Icon
// ---------------------------------------------------------------------------
test("PWA-Manifest: App-Name „PokeSwipe Radar“, Standalone, 192/512 + maskable Icons, die es wirklich gibt", () => {
  const m = JSON.parse(read("public/manifest.json").toString("utf8"));
  assert.equal(m.name, "PokeSwipe Radar");
  assert.equal(m.short_name, "PokeSwipe Radar");
  assert.equal(m.display, "standalone");
  assert.ok(m.start_url.startsWith("/"));
  const icon = (sizes: string, purpose: string) => m.icons.find((i: any) => i.sizes === sizes && i.purpose === purpose && i.type === "image/png");
  for (const [sizes, purpose] of [["192x192", "any"], ["512x512", "any"], ["192x192", "maskable"], ["512x512", "maskable"]]) {
    const i = icon(sizes, purpose);
    assert.ok(i, `Icon ${sizes} ${purpose} fehlt`);
    const { w, h } = pngSize(read(`public${i.src}`));
    assert.equal(`${w}x${h}`, sizes, `${i.src} hat die falsche Größe`);
  }
  assert.ok(m.icons.some((i: any) => i.type === "image/svg+xml" && existsSync(new URL(`../public${i.src}`, import.meta.url))), "SVG-Icon fehlt");
});

test("App-Icon: Apple-Touch-Icon 180×180, Favicon & SVG sind in index.html eingebunden", () => {
  assert.deepEqual(pngSize(read("public/icons/apple-touch-icon.png")), { w: 180, h: 180 });
  assert.deepEqual(pngSize(read("public/icons/favicon-32.png")), { w: 32, h: 32 });
  const svg = read("public/icon.svg").toString("utf8");
  assert.match(svg, /<svg[^>]+viewBox="0 0 512 512"/);
  assert.match(svg, /<title>PokeSwipe Radar<\/title>/);
  const html = read("public/index.html").toString("utf8");
  assert.match(html, /<link rel="manifest" href="\/manifest\.json"/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml"/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="PokeSwipe Radar"/);
  assert.ok(existsSync(new URL("../public/favicon.ico", import.meta.url)));
});

// ---------------------------------------------------------------------------
// Einladungs-Link & Gründer-Sammler-Belohnung
// ---------------------------------------------------------------------------
test("Einladungs-Link: persönlicher ?ref=CODE-Link und packender Teilen-Text mit Link", () => {
  const link = referralLink("https://pokeswipe-radar.de/", "AB12CD34");
  assert.equal(link, "https://pokeswipe-radar.de/?ref=AB12CD34");
  const text = inviteShareText(link, "@AshK");
  assert.ok(text.includes(link));
  assert.ok(text.startsWith("🔥 AshK lädt dich ein"));
  assert.match(INVITE_CALL, /Lade 5 Karten hoch oder hol einen Sammler-Kumpel rein/);
});

test("Belohnung: ab 5 hochgeladenen Karten ODER 1 geworbenen Anmeldung freigeschaltet – vorher nicht", () => {
  assert.equal(FOUNDER_UPLOAD_GOAL, 5);
  assert.equal(FOUNDER_SIGNUP_GOAL, 1);
  assert.equal(founderQualifies(4, 0), false);
  assert.equal(founderQualifies(5, 0), true);
  assert.equal(founderQualifies(0, 1), true);
  assert.equal(founderQualifies(-3, Number.NaN), false);

  const s4 = founderStatus({ uploads: 4, signups: 0 });
  assert.equal(s4.unlocked, false);
  assert.equal(s4.uploadsMissing, 1);
  assert.equal(s4.pct, 80);
  assert.match(s4.headline, /Noch 1 Karte hochladen ODER 1 Sammler-Kumpel einladen/);

  const viaUploads = founderStatus({ uploads: 5, signups: 0 });
  assert.equal(viaUploads.unlocked, true);
  assert.equal(viaUploads.unlockedVia, "uploads");
  assert.equal(viaUploads.pct, 100);

  const viaSignup = founderStatus({ uploads: 0, signups: 1 });
  assert.equal(viaSignup.unlocked, true);
  assert.equal(viaSignup.unlockedVia, "signup");

  // Einmal freigeschaltet bleibt freigeschaltet, auch wenn Karten wieder gelöscht wurden
  assert.equal(founderStatus({ uploads: 0, signups: 0, founderAt: new Date() }).unlocked, true);
  assert.equal(monotonic(5, 2), 5);
  assert.equal(monotonic(2, 7), 7);
});

test("Belohnung: Gratis-Boosts & erweiterte Preis-Alarme nur für Gründer-Sammler, Badge im Katalog", () => {
  assert.equal(boostAllowance(0, false), 0);
  assert.equal(boostAllowance(0, true), FOUNDER_FREE_BOOSTS);
  assert.equal(boostAllowance(3, true), 3 + FOUNDER_FREE_BOOSTS);
  assert.equal(alertAllowance(5, false), 5);
  assert.equal(alertAllowance(5, true), 5 + FOUNDER_EXTRA_ALERTS);
  const badge = BADGES.find((b) => b.id === FOUNDER_BADGE);
  assert.ok(badge);
  assert.equal(badge!.label, "Gründer-Sammler");
});

test("Upload-Tracking: Binder-Einträge, Importe und Inserate zählen – Lesen, Löschen & Fremdpfade nicht", () => {
  for (const p of ["/api/portfolio", "/api/portfolio/import", "/api/portfolio/import-rows", "/api/listings"]) assert.equal(isUploadPath("POST", p), true, p);
  assert.equal(isUploadPath("PUT", "/api/portfolio/by-card/sv03.5-199"), true);
  assert.equal(isUploadPath("GET", "/api/portfolio"), false);
  assert.equal(isUploadPath("DELETE", "/api/portfolio/12"), false);
  assert.equal(isUploadPath("POST", "/api/listings/12/status"), false);
  assert.equal(isUploadPath("POST", "/api/wishlist"), false);
});

// ---------------------------------------------------------------------------
// Set-Ordner
// ---------------------------------------------------------------------------
test("Set-Ordner: Karten-IDs → Set & Nummer, Ordner-Sortierung wie im echten Binder", () => {
  assert.equal(setIdOfCard("sv03.5-199"), "sv03.5");
  assert.equal(localIdOfCard("sv03.5-199"), "199");
  assert.equal(setIdOfCard("swsh12.5-GG01"), "swsh12.5");
  assert.equal(setIdOfCard(""), "");
  const ids = ["10", "GG02", "2", "TG01", "166", "1", "GG10"];
  assert.deepEqual([...ids].sort(compareLocalId), ["1", "2", "10", "166", "GG02", "GG10", "TG01"]);
  assert.equal(collectorNumber("38", 165), "038/165");
  assert.equal(collectorNumber("GG01", 159), "GG01");
});

test("Set-Ordner: Gruppierung mit Fortschritt „x / y Karten“, Duplikate zählen einmal, Wert in €", () => {
  const folders = groupBinderBySet([
    { cardId: "sv03.5-199", quantity: 2, value: 240, image: "a.png" },
    { cardId: "sv03.5-6", quantity: 1, value: 1.5 },
    { cardId: "sv03.5-199", quantity: 1, value: 120 },
    { cardId: "sv08-238", quantity: 1, value: 90 },
    { cardId: null, quantity: 1, value: 3 },
  ], {
    "sv03.5": { id: "sv03.5", name: "151", total: 207, releaseDate: "2023-09-22", logo: "https://x/logo.webp" },
    sv08: { id: "sv08", name: "Stürmische Funken", total: 252, releaseDate: "2024-11-08" },
  });
  assert.equal(folders.length, 2);
  assert.equal(folders[0].name, "Stürmische Funken"); // neuestes Set zuerst
  const s151 = folders.find((f) => f.setId === "sv03.5")!;
  assert.equal(s151.owned, 2);
  assert.equal(s151.total, 207);
  assert.equal(s151.progressLabel, "2 / 207 Karten");
  assert.equal(s151.value, 361.5);
  assert.equal(s151.quantity, 4);
  assert.equal(s151.logo, "https://x/logo.webp");
  assert.equal(s151.pct, 1);
});

// ---------------------------------------------------------------------------
// Binder-Ansicht: 3×3-Seiten, Swipe, eigene & fehlende Karten, Marktplatz-Abgleich
// ---------------------------------------------------------------------------
const catalog = Array.from({ length: 20 }, (_, i) => ({ id: `sv03.5-${i + 1}`, name: `Karte ${i + 1}`, image: `https://img/${i + 1}`, localId: String(i + 1), price: i + 1 }));

test("Binder: 3×3-Raster pro Seite, Seitenwechsel bleibt im Ordner", () => {
  assert.equal(BINDER_PAGE_SIZE, 9);
  const pages = paginate(catalog);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((p) => p.length), [9, 9, 2]);
  assert.deepEqual(paginate([]), [[]]);
  assert.equal(clampPage(5, 3), 2);
  assert.equal(clampPage(-1, 3), 0);
});

test("Binder: Swipe-Geste – waagerecht wischen blättert, senkrechtes Scrollen nicht", () => {
  assert.equal(swipeDirection(-80, 5), 1); // nach links gewischt → nächste Seite
  assert.equal(swipeDirection(90, -10), -1); // nach rechts → vorherige Seite
  assert.equal(swipeDirection(-20, 0), 0); // zu kurz
  assert.equal(swipeDirection(-70, 90), 0); // eher Scrollen
});

test("Binder: eigene Karten mit Zustand & „Im Verkauf“-Badge, fehlende Karten mit Live-Marktplatz-Angebot", () => {
  const viewerId = "me";
  const cards = buildBinderCards({
    catalog, viewerId, official: 165,
    owned: [
      { cardId: "sv03.5-1", quantity: 1, condition: "NM", portfolioItemId: 11, value: 1 },
      { cardId: "sv03.5-2", quantity: 2, condition: "EX", portfolioItemId: 12, value: 3.4 },
    ],
    myListings: [{ id: 501, cardId: "sv03.5-2", price: 12.5, userId: viewerId }],
    marketListings: [
      { id: 601, cardId: "sv03.5-3", price: 14, userId: "anna", seller: "@anna" },
      { id: 602, cardId: "sv03.5-3", price: 12.5, userId: "ben", seller: "@ben" },
      { id: 603, cardId: "sv03.5-4", price: 0, userId: "cem", seller: "@cem" },
      { id: 604, cardId: "sv03.5-1", price: 2, userId: "dora" }, // besitze ich schon → kein Badge
      { id: 605, cardId: "sv03.5-5", price: 9, userId: viewerId }, // eigenes Inserat zählt nicht als Angebot
    ],
  });
  const by = (id: string) => cards.find((c) => c.cardId === id)!;
  // Jede Karte: Bild, Sammlernummer, Name, Preis
  for (const c of cards) { assert.ok(c.image); assert.ok(c.number); assert.ok(c.name); assert.ok(c.priceLabel); }
  assert.equal(by("sv03.5-1").number, "001/165");
  assert.equal(by("sv03.5-1").owned, true);
  assert.equal(by("sv03.5-1").condition, "NM");
  assert.equal(by("sv03.5-1").market, null);
  assert.equal(by("sv03.5-1").portfolioItemId, 11);
  assert.equal(by("sv03.5-2").myListing?.id, 501);
  assert.match(by("sv03.5-2").myListing!.label, /^Im Verkauf: 12,50\s€$/);
  // Fehlende Karte, die jemand anbietet: günstigstes Angebot, direkt verlinkt
  const missing = by("sv03.5-3");
  assert.equal(missing.owned, false);
  assert.equal(missing.market?.listingId, 602);
  assert.match(missing.market!.label, /^Auf Marktplatz: 12,50\s€$/);
  assert.equal(missing.market?.offers, 2);
  assert.equal(by("sv03.5-4").market?.label, "Tausch möglich");
  assert.equal(by("sv03.5-5").market, null);
  assert.equal(by("sv03.5-6").market, null); // nicht inseriert → Wunschliste/Preis-Radar
  const sum = binderSummary(cards, 207);
  assert.equal(sum.owned, 2);
  assert.equal(sum.missing, 205);
  assert.equal(sum.onMarket, 2);
  assert.equal(sum.forSale, 1);
  assert.equal(sum.progressLabel, "2 / 207 Karten");
  assert.equal(sum.value, 4.4);
});

test("Marktplatz-Abgleich: Verkauf schlägt Tausch, neues günstigeres Angebot ersetzt das alte (Live-Aktualisierung)", () => {
  const first = bestOffersByCard([{ id: 1, cardId: "sv08-1", price: 0, userId: "a" }], "me");
  assert.equal(first.get("sv08-1")?.trade, true);
  const later = bestOffersByCard([
    { id: 1, cardId: "sv08-1", price: 0, userId: "a" },
    { id: 2, cardId: "sv08-1", price: 20, userId: "b" },
    { id: 3, cardId: "sv08-1", price: 8.99, userId: "c" },
  ], "me");
  assert.equal(later.get("sv08-1")?.listingId, 3);
  assert.equal(later.get("sv08-1")?.trade, false);
  assert.equal(marketBadgeLabel(0, true), "Tausch möglich");
  assert.match(marketBadgeLabel(8.99, false), /^Auf Marktplatz: 8,99\s€$/);
  // Eigene Karten, die (noch) nicht im Katalog stehen, erscheinen trotzdem im Ordner
  const extra = buildBinderCards({ catalog: [], owned: [{ cardId: "sv08-999", name: "Promo", image: "p.png" }], myListings: [], marketListings: [], viewerId: "me" });
  assert.equal(extra.length, 1);
  assert.equal(extra[0].owned, true);
});

test("Binder & Gründer-Endpunkte sind registriert, /api/listings kann einzelne Angebote laden", () => {
  const app = read("server/app.ts").toString("utf8");
  assert.match(app, /registerBinder\(app/);
  assert.match(app, /registerFounder\(app/);
  assert.match(app, /isUploadPath\(c\.req\.method, c\.req\.path\)/);
  assert.match(app, /seller_founder/);
  assert.match(app, /c\.req\.query\("ids"\)/);
  const binder = read("server/binder.ts").toString("utf8");
  for (const r of ['"/api/binder/folders"', '"/api/binder/sets"', '"/api/binder/set/:setId"']) assert.ok(binder.includes(r), r);
  const migration = read("netlify/database/migrations/20261118114312_add_founder_rewards/migration.sql").toString("utf8");
  for (const col of ["card_uploads", "referral_signups", "founder_at"]) assert.ok(migration.includes(`"${col}"`), col);
});
