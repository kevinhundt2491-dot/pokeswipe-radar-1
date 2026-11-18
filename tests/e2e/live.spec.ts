// Live-Smoke-Test gegen eine echte Seite (nur lesend, keine Anmeldung, keine Käufe):
//   E2E_BASE_URL=https://pokeswipe-radar.de npm run test:e2e:live
// Zeitgesteuert in GitHub Actions: Vorlage docs/github-workflow-e2e.yml (in GitHub unter .github/workflows/ anlegen).
import { test, expect } from "@playwright/test";

test("API ist erreichbar", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBe(true);
  expect(await r.json()).toMatchObject({ ok: true });
});

test("App lädt ohne JavaScript-Fehler", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).PS), null, { timeout: 20_000 });
  // Start-Dashboard mit Live-Scanner als Hero-Aktion (Navigation: Header am Desktop, Tab-Leiste am Handy)
  await expect(page.locator("#view-home")).toBeVisible();
  await expect(page.locator("#ps-profile-btn")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Rechtsseiten und Kündigungsbutton sind erreichbar", async ({ page }) => {
  for (const path of ["/impressum", "/datenschutz", "/agb", "/widerruf"]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBeLessThan(400);
    await expect(page.locator("body")).not.toBeEmpty();
  }
  await page.goto("/kuendigen");
  await expect(page.getByRole("button", { name: /kündigen/i }).first()).toBeVisible();
});

test("SEO-Seiten liefern HTML mit Titel", async ({ page }) => {
  for (const path of ["/sets", "/pokemon", "/trends", "/sitemap.xml"]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBeLessThan(400);
  }
  await page.goto("/sets");
  await expect(page).toHaveTitle(/.+/);
});
