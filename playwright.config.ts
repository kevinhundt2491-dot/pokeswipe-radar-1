// End-to-End-Tests (Playwright) – zwei Modi:
//
//  1. Lokal / CI (Standard): ein kleiner Static-Server (tests/e2e/server.mjs) liefert public/ samt gebündelter
//     App aus; die API (/api/*) und Netlify Identity werden im Test simuliert. Prüft die echte Oberfläche ohne
//     Datenbank, Stripe oder DHL.   →  npm run build && npm run test:e2e
//
//  2. Live-Smoke-Test gegen eine echte Seite (Produktion oder Deploy Preview), nur lesend:
//     E2E_BASE_URL=https://pokeswipe-radar.de npm run test:e2e:live
//
// Browser einmalig installieren: npx playwright install chromium
import { defineConfig, devices } from "@playwright/test";

const live = Boolean(process.env.E2E_BASE_URL);
const PORT = Number(process.env.E2E_PORT || 4173);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: live ? /live\.spec\.ts$/ : /^(?!.*live\.spec\.ts$).*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: {
    baseURL: live ? process.env.E2E_BASE_URL : `http://127.0.0.1:${PORT}`,
    locale: "de-DE",
    // Der Service Worker der App holt API-Daten sonst an der Test-Simulation (page.route) vorbei
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: live ? undefined : {
    command: `node tests/e2e/server.mjs`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
  },
});
