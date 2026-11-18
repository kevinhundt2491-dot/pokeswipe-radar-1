// E2E: Dauerhafte Anmeldung (kein Rauswurf nach Browser-Neustart), Name/Avatar aus dem Profil-Cache,
// Sofort-Erlebnis ohne Login-Wand, freundliche Anmelde-Einladung beim Schreiben im Chat, Marktplatz-Raster mit Filter-Chips.
import { test, expect } from "@playwright/test";
import { mockApi, fakeLogin, appReady, collectErrors, ME } from "./helpers.ts";

test("Kein Rauswurf: Sitzungs-Cookie nach Browser-Neustart weg – Anmeldung bleibt und Cookie wird dauerhaft neu gesetzt", async ({ page, baseURL }) => {
  const errors = collectErrors(page);
  await fakeLogin(page, baseURL!, { cookie: false });
  await mockApi(page, {}, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await expect(page.locator("body")).toHaveClass(/ps-logged-in/);
  await expect(page.locator("#authBtnText")).toHaveText(ME.displayName);
  // Gespeicherte Sitzung wurde nicht verworfen …
  expect(await page.evaluate(() => Boolean(localStorage.getItem("gotrue.user")))).toBe(true);
  // … und nf_jwt ist jetzt ein dauerhaftes Cookie (mit Ablaufdatum statt Sitzungs-Cookie)
  const cookie = (await page.context().cookies()).find((c) => c.name === "nf_jwt");
  expect(cookie).toBeTruthy();
  expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 30 * 86400);
  expect(errors()).toEqual([]);
});

test("Profil-Cache: Name steht nach dem Neuladen sofort da und wird nicht erneut abgefragt", async ({ page, baseURL }) => {
  await fakeLogin(page, baseURL!);
  const puts: any[] = [];
  await mockApi(page, { "PUT /api/me": (route) => { puts.push(route.request().postDataJSON()); return { ok: true }; } }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await expect(page.locator("#authBtnText")).toHaveText(ME.displayName);
  const cache = await page.evaluate(() => JSON.parse(localStorage.getItem("ps_profile_v1") || "null"));
  expect(cache).toMatchObject({ userId: ME.id, displayName: ME.displayName });
  expect(cache.plan).toBeUndefined(); // Tarif/Rechte nie aus dem Cache
  // Eigener Name im Konto → es wird nie ein anderer Name gespeichert
  expect(puts.some((b) => "displayName" in b)).toBe(false);
  await page.reload();
  await appReady(page);
  await expect(page.locator("#authBtnText")).toHaveText(ME.displayName);
  await expect(page.locator("#ps-account")).toHaveCount(0);
});

test("Platzhalter-Name im Konto: Gast-Name dieses Geräts wird einmalig dauerhaft übernommen", async ({ page, baseURL }) => {
  await fakeLogin(page, baseURL!);
  await page.addInitScript(() => localStorage.setItem("pokeswipe_user", "@PokeFan"));
  const puts: any[] = [];
  await mockApi(page, {
    "GET /api/me": () => ({ ...ME, displayName: puts.length ? "@PokeFan" : "@Sammlerk3x9", usage: {}, planInfo: { label: "Free" } }),
    "PUT /api/me": (route) => { puts.push(route.request().postDataJSON()); return { ok: true }; },
  }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await expect.poll(() => puts.find((b) => b.displayName)?.displayName).toBe("@PokeFan");
  await expect(page.locator("#authBtnText")).toHaveText("@PokeFan");
});

test("Sofort-Erlebnis: Gäste sehen Scanner, Marktplatz, Live-Chat und Binder ohne Login-Wand", async ({ page }) => {
  const errors = collectErrors(page);
  await mockApi(page, {
    "GET /api/listings": () => ({ listings: [
      { id: 7, card_id: "sv03.5-199", card_name: "Glurak ex", price: 150, want: "Verkauf", city: "Köln", condition: "nm", user_id: "x", seller: "@Ash", buy_now: false, market_price: 160, priceCheck: "fair" },
    ] }),
    "GET /api/community/chat": () => ({ messages: [{ id: 1, body: "Wer tauscht Glurak?", createdAt: new Date().toISOString(), author: { id: "a", name: "@Misty" } }], removed: [] }),
  });
  await page.goto("/");
  await appReady(page);
  await page.waitForTimeout(1500); // früher öffnete hier automatisch ein Einführungs-Dialog
  await expect(page.locator("#ps-account:visible, #ps-onboarding:visible, #ps-quickstart-modal:visible")).toHaveCount(0);
  await expect(page.locator("#view-home")).toBeVisible();
  await expect(page.locator("#home-scan").getByRole("button", { name: /Karte scannen/ })).toBeVisible();
  await expect(page.locator("#home-market-grid")).toContainText("Glurak ex");
  await expect(page.locator("#home-chat-list")).toContainText("Wer tauscht Glurak?");
  await expect(page.locator("#home-binder")).toBeVisible();
  // Schreiben im Chat lädt freundlich zur 1-Klick-Anmeldung ein (mit Gast-Option)
  await page.locator("#home-chat-input").fill("Hallo!");
  await page.locator("#home-chat").getByRole("button", { name: "Senden" }).click();
  await expect(page.locator("#ps-login-view")).toBeVisible();
  await expect(page.getByRole("button", { name: /als Gast weiter/ })).toBeVisible();
  await page.getByRole("button", { name: /als Gast weiter/ }).click();
  await expect(page.locator("#ps-login-view")).toBeHidden();
  await expect(page.locator("#home-chat-input")).toHaveValue("Hallo!");
  expect(errors()).toEqual([]);
});

test("Marktplatz: Karten-Raster ist sofort sichtbar, Kachel zeigt Set-Kürzel, Zustand und Preis; Filter-Chips filtern", async ({ page }) => {
  await mockApi(page, {
    "GET /api/listings": () => ({ listings: [
      { id: 7, card_id: "sv03.5-199", card_name: "Glurak ex", price: 150, want: "Verkauf", city: "Köln", condition: "nm", user_id: "x", seller: "@Ash", buy_now: false, market_price: 160 },
      { id: 8, card_id: "sv08-238", card_name: "Pikachu ex", price: 40, want: "Tausch gegen Mew", city: "Berlin", condition: "ex", user_id: "y", seller: "@Brock", buy_now: false },
    ] }),
  });
  await page.addInitScript(() => localStorage.setItem("ps_market_view", "list")); // klassische Listenansicht
  await page.goto("/?tab=map");
  await appReady(page);
  await page.locator('#ps-msw-switch [data-browse="search"]').click(); // 🔍 Direktsuche zeigt das klassische Raster
  const grid = page.locator("#market-list");
  await expect(grid.locator(".ps-tile")).toHaveCount(2);
  const tile = grid.locator('[data-listing="7"]');
  await expect(tile).toContainText("Glurak ex");
  await expect(tile).toContainText("SV03.5 · 199");
  await expect(tile).toContainText("NM");
  await expect(tile.getByRole("button", { name: /Anfragen/ })).toBeVisible();
  await page.locator('#ps-market-chips [data-chip="trade"]').click();
  await expect(grid.locator(".ps-tile")).toHaveCount(1);
  await expect(grid).toContainText("Pikachu ex");
  await page.locator('#ps-market-chips [data-chip="price_asc"]').click();
  await expect(grid.locator(".ps-tile").first()).toContainText("Pikachu ex");
  // Detail-Ansicht behält alle bisherigen Aktionen
  await grid.locator('[data-listing="7"] .ps-tile-more').click();
  await expect(page.locator("#ps-listing")).toContainText("Glurak ex");
});

test("Marktplatz-Binder: Angebote in Ordnerseiten, Tasche zeigt Zustand & Preis/Tausch, Einzelkarte mit Swipe-Navigation", async ({ page }) => {
  await mockApi(page, {
    "GET /api/listings": () => ({ listings: Array.from({ length: 11 }, (_, i) => ({
      id: 100 + i, card_id: `sv03.5-${i + 1}`, card_name: `Karte ${i + 1}`, price: i === 1 ? 0 : 5 + i, want: i === 1 ? "Tausch" : "Verkauf", city: "Köln", condition: "nm", user_id: "x", seller: "@Ash", buy_now: i === 0,
    })) }),
  });
  await page.goto("/?tab=map");
  await appReady(page);
  await page.locator('#ps-msw-switch [data-browse="search"]').click();
  const binder = page.locator("#ps-market-binder");
  await expect(binder).toBeVisible();
  await expect(page.locator("#market-list")).toBeHidden();
  const first = binder.locator('[data-mb-pageidx="0"] [data-mb-card]');
  await expect(first).toHaveCount(await page.evaluate(() => (matchMedia("(min-width: 640px)").matches ? 9 : 4)));
  await expect(binder.locator('[data-mb-card="100"]')).toContainText("NM");
  await expect(binder.locator('[data-mb-card="101"]')).toContainText("Tausch");
  await binder.locator('[data-mb-card="100"]').click();
  const focus = page.locator("#ps-mb-card");
  await expect(focus).toContainText("Karte 1");
  await expect(focus).toContainText("Jetzt kaufen");
  await expect(focus).toContainText("1:1 Tausch vorschlagen");
  await expect(focus).toContainText("Verkäufer schreiben");
  await expect(focus).toContainText("Cardmarket-Preis prüfen");
  await focus.getByRole("button", { name: "Nächste Karte" }).click();
  await expect(focus).toContainText("Karte 2");
  await page.keyboard.press("Escape");
  // Umschalter zur klassischen Listenansicht
  await page.getByRole("button", { name: "☰ Liste" }).click();
  await expect(page.locator("#market-list .ps-tile")).toHaveCount(11);
});

test("Marktplatz öffnet im Live-Swipe: Karte mit Rang-Badge & „Jetzt kaufen“, Switch zu Händler-Ordnern und Direktsuche", async ({ page }) => {
  await mockApi(page, {
    "GET /api/listings": () => ({ listings: [
      { id: 7, card_id: "sv03.5-199", card_name: "Glurak ex", price: 150, want: "Verkauf", city: "Köln", condition: "nm", user_id: "x", seller: "@Ash", buy_now: false, verified: true, seller_shop: true },
      { id: 8, card_id: "sv08-238", card_name: "Pikachu ex", price: 40, want: "Tausch gegen Mew", city: "Berlin", condition: "ex", user_id: "y", seller: "@Brock", buy_now: false },
    ] }),
  });
  await page.goto("/?tab=map");
  await appReady(page);
  const card = page.locator("#ps-msw .ps-msw-card");
  await expect(card).toBeVisible();
  await expect(page.locator("#market-list")).toBeHidden();
  await expect(card.locator(".ps-msw-buy")).toContainText("Jetzt kaufen");
  await expect(card).toContainText("Weiter swipen");
  await expect(card).toContainText("Tauschen");
  await expect(card.locator(".ps-msw-rank").first()).toBeVisible();
  const first = await card.getAttribute("data-msw-card");
  await card.getByRole("button", { name: /Weiter swipen/ }).click();
  await expect(page.locator("#ps-msw .ps-msw-card")).not.toHaveAttribute("data-msw-card", String(first));
  await page.locator('#ps-msw-switch [data-browse="folder"]').click();
  await expect(page.locator("#ps-msw-folder")).toContainText("Ordner 1 von 2");
  await expect(page.locator("#ps-msw-folder")).toContainText("@Ash"); // Händler zuerst
  await page.getByRole("button", { name: "Nächster Ordner" }).click();
  await expect(page.locator("#ps-msw-folder")).toContainText("@Brock");
  await page.locator('#ps-msw-switch [data-browse="search"]').click();
  await expect(page.locator("#market-search")).toBeVisible();
});

test("In-App-Browser (TikTok): Hinweis zum Öffnen im Standard-Browser, E-Mail-Login und Gast bleiben möglich", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_33.7.0 BytedanceWebview",
    viewport: { width: 390, height: 844 }, locale: "de-DE", serviceWorkers: "block",
  });
  const page = await context.newPage();
  await mockApi(page);
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => (window as any).PS.renderLogin());
  await expect(page.locator("#ps-inapp-hint")).toContainText("TikTok");
  await expect(page.locator("#ps-inapp-hint").getByRole("link", { name: /Im Browser öffnen/ })).toBeVisible();
  await expect(page.locator("#ps-email")).toBeVisible();
  await expect(page.getByRole("button", { name: /als Gast weiter/ })).toBeVisible();
  await context.close();
});
