// E2E: Stage-Demos des Pro-Showcase-Reels (nur in der Live-Stage ?reel=1 im iframe aktiv):
// Scanner mit Schutzhülle + 1,4×-Zoom, „Binder“ ohne Login/Schreibzugriff, gefüllter Set-Ordner mit Lücken-Badge
// „Auf Marktplatz: 29,90 €“ und Sprung zum Marktplatz. Außerhalb der Stage sind die Demo-Funktionen nicht erreichbar.
import { test, expect, type Frame } from "@playwright/test";
import { mockApi, appReady, collectErrors } from "./helpers.ts";

const catalog = Array.from({ length: 30 }, (_, i) => ({
  id: `sv03.5-${String(i + 1).padStart(3, "0")}`, name: `Karte ${i + 1}`, localId: String(i + 1), price: 2 + i,
  image: `https://assets.tcgdex.net/de/sv/sv03.5/${String(i + 1).padStart(3, "0")}`,
}));
const scanItem = {
  key: "card:sv03.5-006", id: "sv03.5-006", kind: "card", name: "Glurak ex", number: "006/165", setName: "151", setCode: "MEW",
  image: "https://assets.tcgdex.net/de/sv/sv03.5/006", price: 24.5, lang: "de",
};

async function stageFrame(page: import("@playwright/test").Page): Promise<Frame> {
  await page.route("**/reel-host.html", (route) => route.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><body style="margin:0"><iframe id="stage" src="/?reel=1&tab=scan" width="414" height="736" style="border:0"></iframe></body></html>`,
  }));
  await page.goto("/reel-host.html");
  const frame = page.frameLocator("#stage");
  await expect(frame.locator("#view-scan")).toBeAttached({ timeout: 15_000 });
  const f = page.frames().find((x) => x.url().includes("reel=1"))!;
  await f.waitForFunction(() => (window as any).PS?.liveScanDemoPrepare && (window as any).PS?.binderDemoPrepare, null, { timeout: 15_000 });
  return f;
}

test("Showcase-Stage: Scanner mit Schutzhülle & 1,4×-Zoom, „Binder“ legt ohne Login ab, Set-Ordner gefüllt mit Lücken-Badge 29,90 €", async ({ page }) => {
  const errors = collectErrors(page);
  const calls = await mockApi(page, {
    "GET /api/scan/lookup": () => ({ items: [scanItem] }),
    "GET /api/binder/set/:id": () => ({ set: { id: "sv03.5", name: "151", total: 165, official: 165 }, catalog, owned: [], myListings: [], marketListings: [], viewerId: "" }),
  });
  const f = await stageFrame(page);
  // 1) Blitz-Scanner
  await f.evaluate(() => (window as any).PS.showSub?.("scan", "live"));
  await f.waitForSelector("#ps-ls-stage", { state: "attached" });
  const info = await f.evaluate(() => (window as any).PS.liveScanDemoPrepare({ keys: ["card:sv03.5-006"], sleeve: true, zoom: 1.4 }));
  expect(info?.name).toBe("Glurak ex");
  await expect(f.locator("#ps-ls-demo-sleeve")).toBeAttached();
  await expect(f.locator("#ps-ls-demo-zoom")).toHaveText(/1,4× Zoom/);
  await f.evaluate(() => (window as any).PS.liveScanDemoScan(250));
  await expect(f.locator("[data-hud-price]")).toContainText("24,50");
  await expect(f.locator("[data-hud-cond]")).toContainText(/Near Mint|NM/);
  await f.locator('#ps-ls-hud [data-act="binder"]').click();
  await expect(f.locator("#ps-ls-hud")).toBeHidden();
  expect(calls.filter((c) => c.startsWith("POST ") && /portfolio/.test(c))).toEqual([]);
  // 2) Gefüllter Set-Ordner mit Live-Lücken-Radar
  const prep = await f.evaluate(() => (window as any).PS.binderDemoPrepare("sv03.5", { price: 29.9 }));
  expect(prep?.hero).toBe("Karte 14");
  expect(await f.evaluate(() => (window as any).PS.binderDemoOpen())).toBe(true);
  const view = f.locator("#ps-binder-view");
  await expect(view).toBeVisible();
  await expect(view.locator('[data-page="0"] .ps-bslot.owned')).toHaveCount(7);
  await expect(view.locator('[data-binder-card="sv03.5-001"]')).toContainText("NM");
  await expect(view.locator('[data-page="0"] .ps-bslot.missing')).toHaveCount(2);
  await f.evaluate(() => (window as any).PS.binderNext());
  await expect(view.locator("[data-binder-page]")).toContainText("Seite 2");
  const hero = view.locator('[data-binder-card="sv03.5-014"]');
  await expect(hero).toHaveClass(/missing/);
  await expect(hero).not.toContainText("Auf Marktplatz");
  await f.evaluate(() => (window as any).PS.binderDemoReveal());
  await expect(hero).toContainText(/Auf Marktplatz: 29,90\s€/);
  await expect(view.locator("[data-binder-page]")).toContainText("Seite 2");
  // 3) Tipp auf die Lücke → Marktplatz
  await hero.click();
  await expect(view).toBeHidden();
  await expect(f.locator("#view-map")).toBeVisible();
  // Bühne: Kartenflächen für den Holo-Reflex (LiveStage.cardRects) sind messbar
  expect(errors()).toEqual([]);
});

test("Showcase-Stage: Demo-Funktionen existieren außerhalb der Live-Stage nicht", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?reel=1");
  await appReady(page);
  const api = await page.evaluate(async () => {
    const PS = (window as any).PS;
    // Der Scanner-Demo-Aufruf ist nur ein Lazy-Platzhalter – außerhalb der Stage liefert er nichts und baut keine Bühne auf
    let scan: unknown = "missing";
    try { scan = PS.liveScanDemoPrepare ? (await PS.liveScanDemoPrepare({ sleeve: true, zoom: 1.4 })) ?? null : null; } catch { scan = null; }
    return { scan, demoLayer: !!document.getElementById("ps-ls-demo"), binder: typeof PS.binderDemoOpen, reveal: typeof PS.binderDemoReveal, prepare: typeof PS.binderDemoPrepare };
  });
  expect(api).toEqual({ scan: null, demoLayer: false, binder: "undefined", reveal: "undefined", prepare: "undefined" });
});
