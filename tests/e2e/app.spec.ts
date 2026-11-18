// E2E: App startet ohne JavaScript-Fehler, Navigation, Sprachumschaltung DE/EN, Fehlerberichte an den Server
import { test, expect } from "@playwright/test";
import { mockApi, collectErrors, appReady, fakeLogin } from "./helpers.ts";

test("Startseite lädt ohne JavaScript-Fehler und zeigt die Hauptbereiche", async ({ page }) => {
  const errors = collectErrors(page);
  await mockApi(page);
  await page.goto("/");
  await appReady(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  // Desktop: Header-Navigation (#tab-*), Mobil: Tab-Leiste unten (#mob-*) – je Hauptreiter genau eine sichtbare Schaltfläche
  // 5 Hauptreiter: Start · Scanner · Marktplatz · Sammlung · Community; Profil & Einstellungen über den Avatar oben rechts
  for (const name of ["home", "scan", "map", "portfolio", "community"]) await expect(page.locator(`[onclick="switchTab('${name}')"]:visible`)).toHaveCount(1);
  await expect(page.locator("#ps-bottom-nav .mob-nav:visible, #ps-top-nav .tab-btn:visible")).toHaveCount(5);
  await expect(page.locator("#ps-profile-btn")).toBeVisible();
  await expect(page.getByRole("button", { name: /Karte scannen/ }).first()).toBeVisible();
  expect(errors()).toEqual([]);
});

test("Tabs wechseln die Ansicht", async ({ page, baseURL }) => {
  await fakeLogin(page, baseURL!);
  await mockApi(page, {}, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  // Desktop: Tab-Leiste; Mobil: untere Navigation – jeweils die sichtbare Schaltfläche nutzen
  const tab = (name: string) => page.locator(`[onclick="switchTab('${name}')"]:visible`).first();
  // Warten, bis das erste Swipe-Deck geladen ist (vorher verschiebt sich das Layout noch)
  await page.waitForLoadState("networkidle");
  // force: echter Mausklick an der Stelle, aber ohne Playwrights Vorab-Prüfung (die bei der fixierten Mobil-Navigation
  // während des Scrollens fälschlich eine Überdeckung meldet). Läge wirklich etwas darüber, ginge der Klick daneben
  // und die Ansicht würde nicht wechseln – der Test erkennt das weiterhin.
  await tab("scan").click({ force: true });
  await expect(page.locator("#view-scan")).toBeVisible();
  await tab("home").click({ force: true });
  await expect(page.locator("#view-home")).toBeVisible();
  // Profil- & Einstellungs-Menü über den Avatar oben rechts: Konto, Pro-Pass, Verkaufen und Rechtliches
  await page.locator("#ps-profile-btn").click({ force: true });
  await expect(page.locator("#view-profile")).toBeVisible();
  await expect(page.locator("#ps-profile-hub")).toContainText("Rechtliches");
  // Marktplatz: Unterreiter Alle Karten | Swipe-Tausch | Meine Inserate
  await tab("map").click({ force: true });
  const market = page.locator('#view-map [data-segment="market"]');
  await expect(market).toBeVisible();
  await expect(market.locator("[data-seg]")).toHaveText([/Alle Karten/, /Swipe-Tausch/, /Meine Inserate/]);
  await market.locator('[data-seg="swipe"]').click({ force: true });
  await expect(page.locator("#view-swipe")).toBeVisible();
  await expect(page.locator('#view-swipe [data-seg="swipe"]')).toHaveAttribute("aria-selected", "true");
  // Sammlung: Mein Binder | Wunschliste | Preis-Radar
  await tab("portfolio").click({ force: true });
  const coll = page.locator('#view-portfolio [data-segment="collection"]');
  await expect(coll.locator("[data-seg]")).toHaveText([/Mein Binder/, /Wunschliste/, /Preis-Radar/]);
  await coll.locator('[data-seg="radar"]').click({ force: true });
  await expect(page.locator("#view-flip")).toBeVisible();
  // Community: Live-Chat | Pull-Wall
  await tab("community").click({ force: true });
  const com = page.locator('#view-community [data-segment="community"]');
  await expect(com.locator("[data-seg]")).toHaveText([/Live-Chat/, /Pull-Wall/]);
  await expect(page.locator("#chat-messages")).toBeVisible();
  await com.locator('[data-seg="wall"]').click({ force: true });
  await expect(page.locator("#pullwall-feed")).toBeAttached();
  await expect(page.locator("#chat-messages")).toBeHidden();
});

test("Englische Oberfläche über ?lang=en, gemerkt und zurückschaltbar", async ({ page }) => {
  const errors = collectErrors(page);
  const calls = await mockApi(page);
  const langs: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) langs.push(r.headers()["accept-language"] || ""); });
  await page.goto("/?lang=en");
  await appReady(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: /Scan card/ }).first()).toBeVisible();
  await expect(page.getByText("Karte scannen", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ps_lang"))).toBe("en");
  // API-Anfragen der App tragen die Sprache
  expect(calls.length).toBeGreaterThan(0);
  expect(langs.some((l) => l.startsWith("en"))).toBe(true);
  // Ohne Parameter bleibt Englisch (gemerkt)
  await page.goto("/");
  await appReady(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // Zurück auf Deutsch über den Umschalter im Kopfbereich
  await page.locator('[data-ps-lang="de"]').first().click();
  await page.waitForLoadState("load");
  await appReady(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("button", { name: /Karte scannen/ }).first()).toBeVisible();
  expect(errors()).toEqual([]);
});

test("Browser-Fehler werden an /api/client-errors gemeldet (ohne Query-Parameter)", async ({ page }) => {
  const reports: any[] = [];
  await mockApi(page, {
    "POST /api/client-errors": async (route) => { reports.push(route.request().postDataJSON()); await route.fulfill({ status: 204 }); },
  });
  await page.goto("/?token=geheim");
  await appReady(page);
  await page.evaluate(() => setTimeout(() => { throw new Error("E2E absichtlicher Fehler"); }, 0));
  await expect.poll(() => reports.filter((r) => String(r.message).includes("E2E absichtlicher Fehler")).length).toBe(1);
  // Außer dem absichtlichen Fehler darf die App selbst keine Fehler melden
  expect(reports.map((r) => r.message)).toEqual([expect.stringContaining("E2E absichtlicher Fehler")]);
  for (const r of reports) expect(r.url).not.toContain("geheim");
});
