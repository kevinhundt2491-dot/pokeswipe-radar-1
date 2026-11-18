// E2E: App-Icon & PWA-Manifest, „Teilen & Freunde einladen“ (Einladungs-Link, Fortschritt, Freischaltung, 1-Tap-Teilen,
// Link kopieren), visuelles Set-Portfolio (Set-Ordner, 3×3-Binder mit Swipe & Pfeilen) und Live-Verknüpfung fehlender
// Binder-Karten mit aktiven Marktplatz-Angeboten.
import { test, expect, type Page } from "@playwright/test";
import { mockApi, fakeLogin, appReady, collectErrors, ME } from "./helpers.ts";

const LINK = "https://pokeswipe-radar.de/?ref=AB12CD34";
const founder = (over: Record<string, unknown> = {}) => ({
  unlocked: false, uploads: 3, uploadGoal: 5, uploadPct: 60, uploadsMissing: 2, signups: 0, signupGoal: 1, signupPct: 0, signupsMissing: 1, pct: 60,
  headline: "Noch 2 Karten hochladen ODER 1 Sammler-Kumpel einladen – dann sind deine Gratis-Boosts freigeschaltet.", unlockedVia: "", ...over,
});
const me = (f = founder()) => ({
  ...ME, usage: {}, planInfo: { label: "Free" }, referral: { code: "AB12CD34", link: LINK, confirmed: 0, pending: 0, next: null, badges: [] }, founder: f,
});

async function openCollection(page: Page) {
  await page.evaluate(() => (window as any).PS.collectionTab("binder"));
  await expect(page.locator("#ps-binder-folders")).toBeVisible();
}

// ---------------------------------------------------------------------------
// PWA & App-Icon
// ---------------------------------------------------------------------------
test("PWA: Manifest mit App-Name „PokeSwipe Radar“ und echten 192/512/maskable-Icons, Apple-Touch-Icon & Favicon", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await appReady(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await page.request.get(href!)).json();
  expect(manifest.name).toBe("PokeSwipe Radar");
  expect(manifest.display).toBe("standalone");
  const sizes = manifest.icons.filter((i: any) => i.type === "image/png").map((i: any) => `${i.sizes}:${i.purpose}`);
  for (const s of ["192x192:any", "512x512:any", "192x192:maskable", "512x512:maskable"]) expect(sizes).toContain(s);
  for (const icon of manifest.icons) {
    const res = await page.request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/image\//);
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("sizes", "180x180");
  const apple = await page.request.get((await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"))!);
  expect(apple.status()).toBe(200);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "PokeSwipe Radar");
  expect((await page.request.get("/icon.svg")).status()).toBe(200);
});

// ---------------------------------------------------------------------------
// Einladen & Belohnung
// ---------------------------------------------------------------------------
test("Einladen: Startseite zeigt Aufruf, Fortschritt (3 / 5 Karten ODER 0 / 1 Sammler), persönlichen Link, Kopieren mit Bestätigung & 1-Tap-Teilen", async ({ page, baseURL, context }) => {
  const errors = collectErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.addInitScript(() => {
    (window as any).__shared = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: async (d: any) => { (window as any).__shared.push(d); } });
  });
  await fakeLogin(page, baseURL!);
  await mockApi(page, { "GET /api/me": () => me() }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  const box = page.locator("#home-invite");
  await expect(box).toContainText("Gemeinsam wird der Marktplatz voll");
  await expect(box).toContainText("Lade 5 Karten hoch oder hol einen Sammler-Kumpel rein");
  await expect(box.locator("[data-founder-uploads]")).toHaveText("3 / 5");
  await expect(box.locator("[data-founder-signups]")).toHaveText("0 / 1");
  await expect(box.locator("[data-invite-link]")).toHaveValue(LINK);
  await box.locator("[data-copy-invite]").click();
  await expect(box.locator("[data-copy-invite]")).toHaveText("✓ Kopiert!");
  await box.locator("[data-share-native]").click();
  await expect.poll(() => page.evaluate(() => (window as any).__shared.length)).toBe(1);
  const shared = await page.evaluate(() => (window as any).__shared[0]);
  expect(shared.url).toBe(LINK);
  expect(shared.text).toMatch(/PokeSwipe Radar/);
  // WhatsApp-Link enthält den persönlichen Link
  const wa = await box.getByRole("link", { name: /WhatsApp/ }).getAttribute("href");
  expect(decodeURIComponent(wa!)).toContain(LINK);
  // Auch im Profilmenü
  await page.evaluate(() => (window as any).switchTab("profile"));
  await expect(page.locator("#ps-founder-card")).toContainText("Gemeinsam wird der Marktplatz voll");
  expect(errors()).toEqual([]);
});

test("Einladungs-Link-Tracking: ?ref=CODE wird gemerkt und nach der Anmeldung im Konto gespeichert", async ({ page, baseURL }) => {
  await fakeLogin(page, baseURL!);
  const claims: any[] = [];
  await mockApi(page, {
    "GET /api/me": () => me(),
    "POST /api/referral/claim": (route) => { claims.push(route.request().postDataJSON()); return { ok: true, qualified: false }; },
  }, { loggedIn: true });
  await page.goto("/?ref=ZX98YW76");
  await appReady(page);
  await expect.poll(() => claims.length).toBeGreaterThan(0);
  expect(claims[0].code).toBe("ZX98YW76");
});

test("Belohnung: freigeschaltet → Gründer-Sammler-Hinweis auf der Startseite, Badge im Marktplatz & Chat", async ({ page, baseURL }) => {
  await fakeLogin(page, baseURL!);
  await mockApi(page, {
    "GET /api/me": () => me(founder({ unlocked: true, uploads: 5, pct: 100, unlockedVia: "uploads", headline: "🏅 Gründer-Sammler freigeschaltet – deine Gratis-Boosts & Sammler-Vorteile sind aktiv!" })),
    "GET /api/listings": () => ({ listings: [
      { id: 9, card_id: "sv08-238", card_name: "Pikachu ex", price: 40, want: "Verkauf", city: "Berlin", condition: "nm", user_id: "y", seller: "@Brock", seller_founder: true, portfolio_item_id: 3 },
    ] }),
    "GET /api/community/chat": () => ({ messages: [{ id: 1, body: "Hallo!", createdAt: new Date().toISOString(), author: { id: "a", name: "@Misty", founder: true } }], removed: [] }),
  }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await expect(page.locator("#home-invite")).toContainText("Gründer-Sammler · freigeschaltet");
  await expect(page.locator("#home-invite .ps-perk-on")).toHaveCount(3);
  await expect(page.locator("#home-chat-list .ps-founder-chip")).toHaveCount(1);
  await page.evaluate(() => { (window as any).PS.marketTab("all"); (window as any).PS.marketView("list"); });
  const tile = page.locator('#market-list [data-listing="9"]');
  await expect(tile.locator(".ps-founder-chip")).toBeVisible();
  await expect(tile).toContainText("NM");
  await expect(tile).toContainText("@Brock"); // verlinkt zurück auf das Sammlerprofil
  await expect(tile).toContainText("Binder");
});

test("Hinweis nach dem Speichern: neue Karte im Binder → dezenter Einladen-Hinweis", async ({ page, baseURL }) => {
  await fakeLogin(page, baseURL!);
  let items = [{ id: 1, cardId: "sv08-1", name: "A", image: "", quantity: 1, value: 1 }];
  await mockApi(page, {
    "GET /api/me": () => me(),
    "GET /api/portfolio": () => ({ items, total: 1, cost: 0, gain: 0, movers: [], history: [], limit: 100 }),
    "GET /api/founder": () => founder({ uploads: 4 }),
  }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => localStorage.removeItem("ps_invite_nudge_day"));
  await expect.poll(() => page.evaluate(() => (window as any).PS.loadPortfolio().then(() => 1))).toBe(1);
  items = [...items, { id: 2, cardId: "sv08-2", name: "B", image: "", quantity: 1, value: 1 }];
  await page.evaluate(() => (window as any).PS.loadPortfolio());
  await expect(page.locator("#ps-invite-nudge")).toBeVisible();
  await expect(page.locator("#ps-invite-nudge")).toContainText("4 von 5 Karten");
});

// ---------------------------------------------------------------------------
// Set-Ordner & Binder
// ---------------------------------------------------------------------------
const catalog = Array.from({ length: 20 }, (_, i) => ({ id: `sv08-${i + 1}`, name: `Karte ${i + 1}`, image: `https://assets.tcgdex.net/de/sv/sv08/${i + 1}/high.webp`, localId: String(i + 1), price: i + 1 }));
const marketListing = { id: 777, cardId: "sv08-3", price: 12.5, userId: "anna", condition: "NM", seller: "@Anna", sellerSlug: "anna", image: "", want: "", buyNow: false };

async function binderSetup(page: Page, baseURL: string, extra: Record<string, any> = {}) {
  await fakeLogin(page, baseURL);
  const wishes: any[] = [];
  const state = { market: [] as any[] };
  await mockApi(page, {
    "GET /api/me": () => me(),
    "GET /api/binder/folders": () => ({ folders: [
      { setId: "sv08", name: "Stürmische Funken", logo: "https://assets.tcgdex.net/de/sv/sv08/logo.webp", symbol: "", preview: "", serieName: "Karmesin & Purpur", releaseDate: "2024-11-08", owned: 38, total: 165, pct: 23, value: 123.45, quantity: 40, progressLabel: "38 / 165 Karten" },
    ] }),
    "GET /api/binder/set/:id": (_route, url) => {
      const base = { setId: "sv08", viewerId: ME.id, marketListings: state.market, myListings: [{ id: 501, cardId: "sv08-2", price: 4.5, userId: ME.id }] };
      if (url.searchParams.get("market") === "1") return base;
      return { ...base, set: { id: "sv08", name: "Stürmische Funken", total: 20, official: 191 }, catalog,
        owned: [{ cardId: "sv08-1", quantity: 1, condition: "NM", portfolioItemId: 11, value: 1 }, { cardId: "sv08-2", quantity: 1, condition: "EX", portfolioItemId: 12, value: 2 }] };
    },
    "GET /api/listings": (_route, url) => (url.searchParams.get("ids") === "777"
      ? { listings: [{ id: 777, card_id: "sv08-3", card_name: "Karte 3", price: 12.5, want: "Verkauf", city: "Köln", condition: "nm", user_id: "anna", seller: "@Anna" }] }
      : { listings: [] }),
    "POST /api/wishlist": (route) => { wishes.push(route.request().postDataJSON()); return { item: { id: 1 }, offers: 0, minPrice: null }; },
    ...extra,
  }, { loggedIn: true });
  return { wishes, state };
}

test("Set-Ordner: Logo, Name, Fortschritt „38 / 165 Karten“ und Wert; Binder blättert per Pfeil, Tastatur und Swipe (3×3)", async ({ page, baseURL }) => {
  const errors = collectErrors(page);
  await binderSetup(page, baseURL!);
  await page.goto("/");
  await appReady(page);
  await openCollection(page);
  const folder = page.locator('[data-set-folder="sv08"]');
  await expect(folder).toContainText("Stürmische Funken");
  await expect(folder).toContainText("38 / 165 Karten");
  await expect(folder.locator("[data-folder-value]")).toContainText("123,45");
  await expect(folder.locator("img")).toHaveCount(1);
  await folder.click();
  const view = page.locator("#ps-binder-view");
  await expect(view).toBeVisible();
  await expect(view.locator('[data-page="0"] .ps-bslot[data-binder-card]')).toHaveCount(9);
  await expect(view.locator("[data-binder-page]")).toHaveText("Seite 1 / 3");
  // Jede Karte mit Bild, Nummer, Name und Preis; eigene Karten vollfarbig mit Zustand, fehlende abgedunkelt
  const owned = view.locator('[data-binder-card="sv08-1"]');
  await expect(owned).toHaveClass(/owned/);
  await expect(owned).toContainText("NM");
  await expect(owned).toContainText("001/191");
  await expect(owned).toContainText("Karte 1");
  await expect(owned).toContainText("1,00");
  await expect(owned.locator("img")).toHaveAttribute("src", /sv08/);
  await expect(view.locator('[data-binder-card="sv08-2"] [data-my-listing="501"]')).toContainText("Im Verkauf: 4,50");
  await expect(view.locator('[data-binder-card="sv08-5"]')).toHaveClass(/missing/);
  // Pfeile
  await page.evaluate(() => (window as any).PS.binderNext());
  await expect(view.locator("[data-binder-page]")).toHaveText("Seite 2 / 3");
  // Tastatur
  await page.keyboard.press("ArrowRight");
  await expect(view.locator("[data-binder-page]")).toHaveText("Seite 3 / 3");
  await page.keyboard.press("ArrowRight"); // bleibt am Ordner-Ende
  await expect(view.locator("[data-binder-page]")).toHaveText("Seite 3 / 3");
  // Swipe nach rechts (Finger/Maus ziehen) → vorherige Seite
  const vp = view.locator("[data-binder-viewport]");
  const b = (await vp.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.55, b.y + 44, { steps: 6 });
  await page.mouse.move(b.x + b.width * 0.85, b.y + 46, { steps: 6 });
  await page.mouse.up();
  await expect(view.locator("[data-binder-page]")).toHaveText("Seite 2 / 3");
  await page.keyboard.press("Escape");
  await expect(view).toBeHidden();
  expect(errors()).toEqual([]);
});

test("Live-Abgleich: fehlende Karte bekommt „Auf Marktplatz: 12,50 €“, Tipp öffnet das Angebot; ohne Angebot → Wunschliste/Preis-Radar", async ({ page, baseURL }) => {
  const { wishes, state } = await binderSetup(page, baseURL!);
  await page.goto("/");
  await appReady(page);
  await openCollection(page);
  await page.locator('[data-set-folder="sv08"]').click();
  const view = page.locator("#ps-binder-view");
  const missing = view.locator('[data-binder-card="sv08-3"]');
  await expect(missing).toHaveClass(/missing/);
  await expect(missing.locator("[data-market-listing]")).toHaveCount(0);
  // Ein anderer Nutzer stellt die fehlende Karte ein → Live-Aktualisierung (ohne Neuladen)
  state.market = [marketListing];
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ps:listings")));
  await expect(missing.locator('[data-market-listing="777"]')).toContainText(/Auf Marktplatz: 12,50/);
  await expect(missing).toHaveClass(/market/);
  await expect(view).toContainText("1 fehlende auf dem Marktplatz");
  // Tipp → passendes Marktplatz-Angebot (wird gezielt nachgeladen)
  await missing.click();
  // Erst Preis + Direkt-Button im Karten-Fenster, dann direkt zum Angebot
  await expect(page.locator("#ps-binder-card")).toContainText("12,50");
  await page.locator("#ps-binder-card [data-binder-buy]").click();
  await expect(page.locator("#ps-listing")).toBeVisible();
  await expect(page.locator("#ps-listing")).toContainText("Karte 3");
  await expect(page.locator("#ps-listing").getByRole("button", { name: /Anfragen/ })).toBeVisible();
  await page.locator("#ps-listing [data-close]").click();
  // Fehlende Karte ohne Angebot → Wunschliste / Preis-Radar
  await view.locator('[data-binder-card="sv08-4"]').click();
  await expect(page.locator("#ps-binder-card [data-binder-market]")).toContainText("Zum Marktplatz gehen");
  await page.locator("#ps-binder-card [data-binder-wish]").click();
  await expect.poll(() => wishes.length).toBe(1);
  expect(wishes[0].cardId).toBe("sv08-4");
  // Filter „Auf Marktplatz“ zeigt nur die verfügbare fehlende Karte
  await page.evaluate(() => (window as any).PS.binderFilter("market"));
  await expect(view.locator(".ps-bslot[data-binder-card]")).toHaveCount(1);
});
