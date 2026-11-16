// E2E: App startet ohne JavaScript-Fehler, Navigation, Sprachumschaltung DE/EN, Fehlerberichte an den Server
import { test, expect } from "@playwright/test";
import { mockApi, collectErrors, appReady, fakeLogin } from "./helpers.ts";

test("Startseite lädt ohne JavaScript-Fehler und zeigt die Hauptbereiche", async ({ page }) => {
  const errors = collectErrors(page);
  await mockApi(page);
  await page.goto("/");
  await appReady(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  // Desktop: Tab-Leiste (#tab-*), Mobil: untere Navigation (#mob-*) – je Bereich muss eine Schaltfläche sichtbar sein
  for (const name of ["swipe", "scan", "portfolio"]) await expect(page.locator(`[onclick="switchTab('${name}')"]:visible`).first()).toBeVisible();
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
  await tab("swipe").click({ force: true });
  await expect(page.locator("#view-swipe")).toBeVisible();
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
