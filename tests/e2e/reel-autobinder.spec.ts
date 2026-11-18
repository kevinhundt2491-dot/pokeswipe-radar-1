// E2E: Stage-Demos der Master-Vorlage „Reel: Neuer automatischer Binder & Bulk-Marktplatz-Power“
// (nur in der Live-Stage ?reel=1 im iframe aktiv, ohne Schreibzugriff):
//   1. Live-Scanner: Karte in Schutzhülle → „📒 Im Set-Ordner einsortiert“ → „🏷️ Als Inserat einstellen“ → Bestätigung
//   2. Sammlung → Mein Binder: „2x“ auf der gescannten Karte, Umschalter „Doppelte im Gesamtwert mitzählen“ ändert den Wert
//   3. Marktplatz → Meine Inserate: „Alle Doppelten inserieren (12)“ → In-App-Bestätigung → alle Doppelten inseriert
//   4. Zurück im Ordner: graue Lücke „Auf Marktplatz: 4,50 €“, eigenes Inserat „Im Verkauf: 12,90 €“
import { test, expect, type Frame } from "@playwright/test";
import { mockApi, appReady, collectErrors } from "./helpers.ts";

const catalog = Array.from({ length: 30 }, (_, i) => ({
  id: `sv03.5-${String(i + 1).padStart(3, "0")}`, name: ["Bisasam", "Bisaknosp", "Bisaflor ex", "Glumanda", "Glutexo", "Glurak ex", "Schiggy", "Schillok", "Turtok ex"][i] || `Karte ${i + 1}`,
  localId: String(i + 1), price: 2 + i, image: `https://assets.tcgdex.net/de/sv/sv03.5/${String(i + 1).padStart(3, "0")}`,
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
  await expect(page.frameLocator("#stage").locator("#view-scan")).toBeAttached({ timeout: 15_000 });
  const f = page.frames().find((x) => x.url().includes("reel=1"))!;
  await f.waitForFunction(() => (window as any).PS?.liveScanDemoPrepare && (window as any).PS?.binderDemoPrepare && (window as any).PS?.listPickerDemoStart, null, { timeout: 15_000 });
  return f;
}

test("Master-Stage: Scan → automatisch im Set-Ordner → Als Inserat einstellen; Binder „2x“ + Gesamtwert-Schalter; Alle Doppelten inserieren; Lücken-Badges", async ({ page }) => {
  const errors = collectErrors(page);
  const calls = await mockApi(page, {
    "GET /api/scan/lookup": () => ({ items: [scanItem] }),
    "GET /api/listings": () => ({ listings: [] }),
    "GET /api/binder/set/:id": () => ({ set: { id: "sv03.5", name: "151", total: 165, official: 165 }, catalog, owned: [], myListings: [], marketListings: [], viewerId: "" }),
  });
  const f = await stageFrame(page);
  const PS = (fn: string, ...args: unknown[]) => f.evaluate(({ n, a }) => (window as any).PS[n](...a), { n: fn, a: args });

  // 1) Live-Scan & automatische Ablage
  await f.evaluate(() => (window as any).PS.showSub?.("scan", "live"));
  await f.waitForSelector("#ps-ls-stage", { state: "attached" });
  const info = await f.evaluate(() => (window as any).PS.liveScanDemoPrepare({ keys: ["card:sv03.5-006"], sleeve: true, zoom: 1.4, autoFile: true, listDemo: true }));
  expect(info?.name).toBe("Glurak ex");
  expect(await f.evaluate(() => (window as any).PS.binderDemoPrepare("sv03.5", { mode: "autobinder", price: 4.5, listedPrice: 12.9 }))).toMatchObject({ hero: "Bisaflor ex", scanned: "Glurak ex", listed: "Turtok ex" });
  await expect(f.locator("#ps-ls-demo-sleeve")).toBeAttached();
  await f.evaluate(() => (window as any).PS.liveScanDemoScan(250));
  await expect(f.locator("[data-hud-name]")).toContainText("Glurak ex");
  await expect(f.locator("[data-hud-price]")).toContainText("24,50");
  await expect(f.locator("#ps-ls-hud")).toContainText("NM");
  await expect(f.locator("[data-hud-autofile]")).toContainText("Wird automatisch in den Set-Ordner einsortiert");
  await f.evaluate(() => (window as any).PS.liveScanDemoFile());
  await expect(f.locator("[data-hud-autofile]")).toContainText("📒 Im Set-Ordner einsortiert");
  await f.locator('#ps-ls-hud [data-act="sell"]').click();
  await expect(f.locator("#ps-ls-hud")).toBeHidden();
  await expect(f.locator("#ps-ls-toast")).toContainText("Inserat vorbereitet · bleibt auch im Set-Ordner");
  await expect(f.locator("#quick-list, #ps-quick-list").first()).toHaveCount(0);

  // 2) Set-Binder: gescannte Karte „2x“ + bereits inseriert, Umschalter rechnet live
  expect(await PS("binderDemoOpen")).toBe(true);
  const view = f.locator("#ps-binder-view");
  await expect(view).toBeVisible();
  const glurak = view.locator('[data-binder-card="sv03.5-006"]');
  await expect(glurak.locator("[data-qty]")).toHaveText("2x");
  await expect(glurak).toContainText(/Im Verkauf: 24,50\s€/);
  await expect(view.locator('[data-binder-card="sv03.5-003"]')).toHaveClass(/missing/);
  await expect(view.locator('[data-page="0"] .ps-bslot.owned')).toHaveCount(7);
  const value = view.locator("[data-binder-value]");
  const before = await value.textContent();
  await view.locator("[data-count-dupes]").click();
  await expect(value).not.toHaveText(before!);
  await view.locator("[data-count-dupes]").click();
  await expect(value).toHaveText(before!);

  // 3) Meine Inserate: Alle Doppelten inserieren (12) mit In-App-Bestätigung, ohne echte Inserate
  await PS("closeSetBinder");
  expect(await f.evaluate(() => (window as any).PS.listPickerDemoStart({ ms: 300 }))).toMatchObject({ copies: 12 });
  await PS("marketTab", "mine");
  const picker = f.locator("#ps-list-picker");
  await expect(picker).toBeVisible();
  const bulk = picker.locator("[data-list-dupes]");
  await expect(bulk).toHaveText("🏷️ Alle Doppelten inserieren (12)");
  await bulk.click();
  const confirm = f.locator("#ps-dupes-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm.locator("[data-dupes-text]")).toContainText(/^12 doppelte Karten jetzt zum Cardmarket-Preis inserieren\?.*je 1 Exemplar bleibt in deinem Set-Ordner/);
  await confirm.locator("[data-dupes-confirm]").click();
  await expect(confirm).toBeHidden();
  await expect(f.locator("#toast-title")).toContainText("Doppelte inseriert");
  await expect(bulk).toHaveText("🏷️ Alle Doppelten inserieren");
  await expect(picker.locator("[data-dupes-note]")).toContainText("Doppelten sind schon inseriert");
  expect(calls.filter((c) => c.startsWith("POST ") && /listings|portfolio/.test(c))).toEqual([]);

  // 4) Zurück im Ordner: Lücke mit Angebot + eigenes Inserat
  expect(await PS("binderDemoOpen")).toBe(true);
  await f.evaluate(() => (window as any).PS.binderDemoReveal());
  await expect(view.locator('[data-binder-card="sv03.5-003"]')).toContainText(/Auf Marktplatz: 4,50\s€/);
  await expect(view.locator('[data-binder-card="sv03.5-009"]')).toContainText(/Im Verkauf: 12,90\s€/);
  expect(errors()).toEqual([]);
});

test("Master-Stage: Demo-Funktionen existieren außerhalb der Live-Stage nicht", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?reel=1");
  await appReady(page);
  const api = await page.evaluate(async () => {
    const PS = (window as any).PS;
    let filed: unknown = "missing";
    try { filed = PS.liveScanDemoFile ? (await PS.liveScanDemoFile()) ?? null : null; } catch { filed = null; }
    return { filed, picker: typeof PS.listPickerDemoStart, slot: typeof PS.binderDemoSlot, inv: typeof PS.binderDemoInventory, confirm: !!document.getElementById("ps-dupes-confirm") };
  });
  expect(api).toEqual({ filed: null, picker: "undefined", slot: "undefined", inv: "undefined", confirm: false });
});
