// Dauerhafte Sitzung, Profil-Speicherung (Name, Avatar, Einstellungen), In-App-Browser-Erkennung,
// Gast-Daten-Übernahme und Marktplatz-Filter – reine Logik ohne DOM/Datenbank.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoredSession, needsRefresh, hasCookie, authCookieStrings, sessionBootAction, toSeconds, decodeJwt,
  detectInAppBrowser, oauthStrategy, externalBrowserUrl, cleanDisplayName, isGeneratedName, nameToSync, displayNameFor,
  initialOf, profileCacheFrom, readProfileCache, guestMigrationPlan, SESSION_COOKIE_DAYS,
// @ts-ignore – Client-Modul ohne Typen
} from "../client/session-logic.js";
import {
  filterListings, marketHighlights, setCodeOf, conditionShort, isTrade, isSale, isNearMint, MARKET_CHIP_KEYS,
// @ts-ignore – Client-Modul ohne Typen
} from "../client/market-filter-logic.js";
import { sanitizeAvatarUrl, sanitizePrefs, mergePrefs } from "../server/profile-prefs-logic.ts";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: object) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.sig`;
const NOW = 1_800_000_000;
const stored = (over: Record<string, unknown> = {}) => JSON.stringify({
  id: "u1", email: "ash@example.com", user_metadata: { full_name: "Ash K", avatar_url: "https://lh3.googleusercontent.com/a/x" },
  token: { access_token: jwt({ sub: "u1", exp: NOW + 3600 }), refresh_token: "r-123", expires_at: (NOW + 3600) * 1000 },
  ...over,
});

// ---------------------------------------------------------------------------
// Sitzung
// ---------------------------------------------------------------------------
test("Sitzung: gespeicherte GoTrue-Anmeldung wird gelesen (Token, Refresh-Token, Ablauf in Sekunden, Name, Avatar)", () => {
  const s = parseStoredSession(stored());
  assert.equal(s.id, "u1");
  assert.equal(s.email, "ash@example.com");
  assert.equal(s.refreshToken, "r-123");
  assert.equal(s.expiresAt, NOW + 3600); // Millisekunden → Sekunden
  assert.equal(s.name, "Ash K");
  assert.match(s.avatar, /googleusercontent/);
  assert.equal(parseStoredSession("kein json"), null);
  assert.equal(parseStoredSession(null), null);
  assert.equal(parseStoredSession(JSON.stringify({ id: "x", token: {} })), null);
  // Ablauf fehlt im Speicher → aus dem JWT (exp)
  const noExp = parseStoredSession(stored({ token: { access_token: jwt({ sub: "u1", exp: NOW + 10 }), refresh_token: "r" } }));
  assert.equal(noExp.expiresAt, NOW + 10);
  assert.equal(decodeJwt("a.b")?.sub, undefined);
  assert.equal(toSeconds(1_800_000_000_123), 1_800_000_000);
  assert.equal(toSeconds("x"), 0);
});

test("Sitzung: fehlendes Cookie nach Browser-Neustart wird wiederhergestellt statt abzumelden", () => {
  const s = parseStoredSession(stored());
  // Browser geschlossen → Sitzungs-Cookie nf_jwt weg, localStorage noch da
  assert.equal(sessionBootAction(s, "ps_lang=de"), "restore-cookie");
  assert.equal(sessionBootAction(s, "foo=1; nf_jwt=abc; bar=2"), "none");
  assert.equal(sessionBootAction(s, "nf_jwt="), "restore-cookie"); // leerer Wert zählt nicht
  assert.equal(sessionBootAction(null, ""), "none"); // Gast
  assert.equal(hasCookie("a=1; nf_jwt_old=2", "nf_jwt"), false);
});

test("Sitzung: Anmelde-Cookies sind dauerhaft (max-age), nicht nur bis zum Schließen des Browsers", () => {
  const [a, r] = authCookieStrings({ accessToken: "tok.en.x", refreshToken: "ref" }, { secure: true });
  assert.match(a, /^nf_jwt=tok\.en\.x; path=\/; max-age=(\d+); samesite=lax; secure$/);
  assert.equal(Number(/max-age=(\d+)/.exec(a)![1]), SESSION_COOKIE_DAYS * 86400);
  assert.ok(SESSION_COOKIE_DAYS >= 90);
  assert.match(r, /^nf_refresh=ref; /);
  assert.doesNotMatch(authCookieStrings({ accessToken: "t" }, { secure: false })[0], /secure/);
  assert.deepEqual(authCookieStrings({}), []);
});

test("Sitzung: Token wird kurz vor Ablauf bzw. nach langer Pause erneuert", () => {
  assert.equal(needsRefresh(NOW + 3600, NOW), false);
  assert.equal(needsRefresh(NOW + 30, NOW), true); // < 60 s
  assert.equal(needsRefresh(NOW - 7 * 86400, NOW), true); // eine Woche nicht da
  assert.equal(needsRefresh((NOW + 30) * 1000, NOW), true); // Millisekunden
  assert.equal(needsRefresh(0, NOW), false);
});

// ---------------------------------------------------------------------------
// In-App-Browser (TikTok, Instagram, Facebook)
// ---------------------------------------------------------------------------
const UA = {
  tiktokIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_33.7.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/de",
  tiktokAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 trill_340204 BytedanceWebview/d8a21c6",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_4; de_DE)",
  facebook: "Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/455.0.0.44.88;]",
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  chrome: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

test("In-App-Browser: TikTok, Instagram und Facebook werden erkannt, normale Browser nicht", () => {
  assert.deepEqual(detectInAppBrowser(UA.tiktokIos), { inApp: true, app: "tiktok", os: "ios" });
  assert.deepEqual(detectInAppBrowser(UA.tiktokAndroid), { inApp: true, app: "tiktok", os: "android" });
  assert.deepEqual(detectInAppBrowser(UA.instagram), { inApp: true, app: "instagram", os: "ios" });
  assert.deepEqual(detectInAppBrowser(UA.facebook), { inApp: true, app: "facebook", os: "android" });
  for (const ua of [UA.safari, UA.chrome, UA.desktop, ""]) assert.equal(detectInAppBrowser(ua).inApp, false, ua);
});

test("In-App-Browser: Google-Login führt in den Standard-Browser, Facebook in Meta-Apps per Weiterleitung, sonst normal", () => {
  const tiktok = detectInAppBrowser(UA.tiktokIos), insta = detectInAppBrowser(UA.instagram), normal = detectInAppBrowser(UA.safari);
  assert.equal(oauthStrategy("google", tiktok), "external");
  assert.equal(oauthStrategy("google", insta), "external");
  assert.equal(oauthStrategy("facebook", insta), "redirect");
  assert.equal(oauthStrategy("facebook", tiktok), "external");
  assert.equal(oauthStrategy("google", normal), "redirect"); // Weiterleitung statt Pop-up – kann nicht blockiert werden
  assert.equal(oauthStrategy("facebook", normal), "redirect");
});

test("In-App-Browser: Link zum Öffnen im Standard-Browser (Android-Intent, iOS-Safari, sonst https)", () => {
  const href = "https://pokeswipe-radar.de/?tab=map&ref=abc";
  const android = externalBrowserUrl(href, "android");
  assert.match(android, /^intent:\/\/pokeswipe-radar\.de\/\?tab=map&ref=abc#Intent;scheme=https;/);
  assert.ok(android.includes(`S.browser_fallback_url=${encodeURIComponent(href)}`));
  assert.equal(externalBrowserUrl(href, "ios"), "x-safari-https://pokeswipe-radar.de/?tab=map&ref=abc");
  assert.equal(externalBrowserUrl(href, "other"), href);
  assert.equal(externalBrowserUrl("javascript:alert(1)", "android"), "");
  assert.equal(externalBrowserUrl("kaputt", "ios"), "");
});

// ---------------------------------------------------------------------------
// Name & Profil
// ---------------------------------------------------------------------------
test("Name: einmal gewählt bleibt er – nur Platzhalter werden durch Gast- bzw. Google/Facebook-Namen ersetzt", () => {
  assert.equal(cleanDisplayName("  Glurak King!! "), "@GlurakKing");
  assert.equal(cleanDisplayName("@@Ash"), "@Ash");
  assert.equal(cleanDisplayName(""), "");
  assert.equal(cleanDisplayName("x".repeat(40)).length, 24);
  assert.ok(isGeneratedName("@Sammlerlz3k9q"));
  assert.ok(isGeneratedName(""));
  assert.ok(!isGeneratedName("@AshKetchum"));
  // eigener Name im Konto → nie überschreiben, nie neu abfragen
  assert.equal(nameToSync({ serverName: "@AshKetchum", guestName: "@Anders", providerName: "Ash K" }), "");
  // Platzhalter im Konto → Gast-Name dieses Geräts gewinnt vor dem Google-Namen
  assert.equal(nameToSync({ serverName: "@Sammlerabc", guestName: "@PokeFan", providerName: "Ash K" }), "@PokeFan");
  assert.equal(nameToSync({ serverName: "@Sammlerabc", guestName: "", providerName: "Ash Ketchum" }), "@AshKetchum");
  assert.equal(nameToSync({ serverName: "@Sammlerabc", guestName: "Sammler", providerName: "" }), "");
  assert.equal(nameToSync({ serverName: "@Sammlerabc", guestName: "ab" }), ""); // zu kurz
});

test("Name: sofort sichtbar aus Profil-Cache, auch bevor /api/me antwortet", () => {
  assert.equal(displayNameFor({ me: { displayName: "@Server" }, cache: { displayName: "@Cache" } }), "@Server");
  assert.equal(displayNameFor({ me: null, cache: { displayName: "@Cache" } }), "@Cache");
  assert.equal(displayNameFor({ guestName: "@Gast" }), "@Gast");
  assert.equal(displayNameFor({ email: "misty@example.com" }), "misty");
  assert.equal(displayNameFor({}), "Sammler");
  assert.equal(initialOf("@ash"), "A");
  assert.equal(initialOf(""), "?");
});

test("Profil-Cache: Name, Avatar, Stadt & Einstellungen – ohne Tarif/Rechte und nur für den eigenen Nutzer", () => {
  const me = { displayName: "@Ash", avatarUrl: "https://lh3.googleusercontent.com/a/x", city: "Köln", prefs: { uiMode: "pro" }, plan: "pro", isAdmin: true };
  const c = profileCacheFrom(me, "u1", 123);
  assert.deepEqual(c, { userId: "u1", displayName: "@Ash", avatarUrl: me.avatarUrl, city: "Köln", prefs: { uiMode: "pro" }, savedAt: 123 });
  assert.equal("plan" in c, false);
  assert.equal("isAdmin" in c, false);
  assert.deepEqual(readProfileCache(JSON.stringify(c), "u1"), c);
  assert.equal(readProfileCache(JSON.stringify(c), "u2"), null); // anderes Konto auf demselben Gerät
  assert.equal(readProfileCache("{kaputt", "u1"), null);
  assert.equal(profileCacheFrom(null, "u1"), null);
  assert.deepEqual(profileCacheFrom({ displayName: "@A", prefs: [1] }, "u1", 1)?.prefs, {});
});

test("Server: Avatar nur von bekannten Profilbild-Diensten (https) oder eigenen Bildern", () => {
  assert.equal(sanitizeAvatarUrl("https://lh3.googleusercontent.com/a/ACg8oc=s96-c"), "https://lh3.googleusercontent.com/a/ACg8oc=s96-c");
  assert.ok(sanitizeAvatarUrl("https://platform-lookaside.fbsbx.com/platform/profilepic/?asid=1"));
  assert.ok(sanitizeAvatarUrl("https://scontent-fra5-1.xx.fbcdn.net/v/t1.jpg"));
  assert.equal(sanitizeAvatarUrl("/api/images/avatars/u1.webp"), "/api/images/avatars/u1.webp");
  for (const bad of ["http://lh3.googleusercontent.com/a", "https://evil.example/a.png", "javascript:alert(1)", "https://user:pw@lh3.googleusercontent.com/a", "/api/images/../secret", "", null]) {
    assert.equal(sanitizeAvatarUrl(bad), "", String(bad));
  }
});

test("Server: Einstellungen werden geprüft und zusammengeführt (unbekannte Schlüssel/Werte fallen weg)", () => {
  assert.deepEqual(sanitizePrefs({ lang: "en", uiMode: "pro", marketFilter: "nm", communityPanel: "wall", avatarEmoji: "⚡", homeTips: false, evil: "<script>", lang2: "x" }),
    { lang: "en", uiMode: "pro", marketFilter: "nm", communityPanel: "wall", avatarEmoji: "⚡", homeTips: false });
  assert.deepEqual(sanitizePrefs({ lang: "fr", uiMode: 1, marketMode: "hack", avatarEmoji: "<b>" }), {});
  assert.deepEqual(sanitizePrefs({ avatarEmoji: "" }), { avatarEmoji: "" }); // Emoji entfernen → Profilbild/Initiale
  assert.deepEqual(sanitizePrefs(null), {});
  assert.deepEqual(sanitizePrefs([1, 2]), {});
  assert.deepEqual(mergePrefs({ lang: "de", uiMode: "simple", junk: 1 }, { uiMode: "pro" }), { lang: "de", uiMode: "pro" });
});

// ---------------------------------------------------------------------------
// Gast-Daten → Konto
// ---------------------------------------------------------------------------
test("Gast-Daten: Karten aus dem Gast-Binder werden genau einmal übernommen – auch später hinzugefügte", () => {
  const pf = [{ name: "Glurak ex", value: 150 }, { name: "Glurak ex", value: 150 }, { name: "Pikachu", value: 5 }, { foo: 1 }];
  const first = guestMigrationPlan({ portfolio: pf });
  assert.equal(first.portfolio.length, 3); // beide Glurak (Duplikate zählen einzeln), Eintrag ohne Namen fällt weg
  assert.equal(first.total, 3);
  // Nach der Übernahme: nichts mehr offen
  assert.equal(guestMigrationPlan({ portfolio: pf, done: first.portfolioKeys }).portfolio.length, 0);
  // Später als Gast eine weitere Karte gespeichert → nur diese wird nachgezogen
  const later = guestMigrationPlan({ portfolio: [...pf, { name: "Mew ex" }], done: first.portfolioKeys });
  assert.deepEqual(later.portfolio.map((i: any) => i.name), ["Mew ex"]);
  assert.equal(guestMigrationPlan({ portfolio: "kaputt" as any }).total, 0);
  assert.equal(guestMigrationPlan({ portfolio: JSON.stringify([{ name: "A" }]) as any }).total, 1);
});

// ---------------------------------------------------------------------------
// Marktplatz
// ---------------------------------------------------------------------------
const L = [
  { id: 1, card_name: "Glurak ex", card_id: "sv03.5-199", price: 150, want: "Tausch gegen Mew", condition: "nm", city: "Köln", buy_now: false },
  { id: 2, card_name: "Pikachu ex", card_id: "sv08-238", price: 40, want: "Verkauf", condition: "ex", city: "Berlin", buy_now: true, priceCheck: "deal", image: "x" },
  { id: 3, card_name: "Mew", card_id: "", price: 0, want: "Nur Tausch", condition: "lp", city: "München", buy_now: false },
  { id: 4, card_name: "Evoli", card_id: "sv08pt5-161", price: 12, want: "VB", condition: "mint", city: "Köln", buy_now: false, boosted: true },
];
const ids = (l: any[]) => l.map((x) => x.id);

test("Marktplatz: Filter-Chips Alle, Tausch, Verkauf, Near Mint, Preis aufsteigend", () => {
  assert.deepEqual(MARKET_CHIP_KEYS, ["all", "trade", "sale", "nm", "price_asc"]);
  assert.deepEqual(ids(filterListings(L, { chip: "all" })), [2, 1, 3, 4]); // Sofort-Kauf zuerst, sonst Server-Reihenfolge
  assert.deepEqual(ids(filterListings(L, { chip: "all", buyFirst: false })), [1, 2, 3, 4]);
  assert.deepEqual(ids(filterListings(L, { chip: "trade" })), [1, 3]);
  // „Tausch gegen …“ mit Wertangabe ist ein Tauschangebot, kein Verkauf
  assert.deepEqual(ids(filterListings(L, { chip: "sale" })), [2, 4]);
  assert.deepEqual(ids(filterListings(L, { chip: "nm" })), [1, 4]);
  assert.deepEqual(ids(filterListings(L, { chip: "price_asc" })), [3, 4, 2, 1]);
  assert.ok(isTrade(L[0]) && !isTrade(L[1]) && isSale(L[1]) && !isSale(L[2]) && isNearMint(L[3]));
});

test("Marktplatz: Suche nach Name, Stadt und Set-Kürzel; keine Karte verschwindet ohne Filter", () => {
  assert.deepEqual(ids(filterListings(L, { q: "köln" })), [1, 4]);
  assert.deepEqual(ids(filterListings(L, { q: "SV08 · 238" })), [2]);
  assert.deepEqual(ids(filterListings(L, { q: "  glurak " })), [1]);
  assert.equal(filterListings(L, {}).length, L.length);
  assert.deepEqual(filterListings(null as any, {}), []);
});

test("Marktplatz: Kachel-Angaben (Set-Kürzel, Zustand) und Start-Highlights", () => {
  assert.equal(setCodeOf(L[0]), "SV03.5 · 199");
  assert.equal(setCodeOf(L[2]), "");
  assert.equal(conditionShort("nm"), "NM");
  assert.equal(conditionShort("mint"), "MT");
  assert.equal(conditionShort(""), "");
  assert.deepEqual(ids(marketHighlights(L, 2)), [2, 4]); // Deal + Boost zuerst
  assert.deepEqual(marketHighlights([], 4), []);
});
