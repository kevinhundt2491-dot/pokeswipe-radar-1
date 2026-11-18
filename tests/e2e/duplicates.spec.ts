// E2E: Scan-Workflow & doppelte Karten
//   • Scan → Karte wird sofort automatisch im Set-Ordner gespeichert, Ergebnis schließt sich selbst (außer „Inserieren“), Server zählt Duplikate hoch
//   • Set-Ordner: Mengen-Badge „3x“ und Umschalter „Doppelte im Gesamtwert mitzählen“ (live, gemerkt)
//   • Marktplatz → Inserieren: „Alle Doppelten inserieren“ (1 Exemplar bleibt, keine doppelten Inserate) + Suche & Filter-Chips
import { test, expect, type Page } from "@playwright/test";
import { mockApi, fakeLogin, appReady, collectErrors, ME } from "./helpers.ts";

const me = () => ({ ...ME, usage: {}, planInfo: { label: "Free" }, referral: { code: "AB12CD34", link: "https://pokeswipe-radar.de/?ref=AB12CD34", confirmed: 0, pending: 0, next: null, badges: [] } });

// ---------------------------------------------------------------------------
// 1. Automatisches Einsortieren nach dem Scan
// ---------------------------------------------------------------------------
const HIT = { key: "card:sv08-1", kind: "card", id: "sv08-1", name: "Karte Eins", number: "001/191", setName: "Stürmische Funken", setCode: "SSP", price: 5, lang: "de", image: "" };

/** Foto hochladen (ohne Kamera) und per KI-Tiefenscan erkennen lassen → Ergebnis-Kästchen erscheint. */
async function scanOnce(page: Page) {
  await page.evaluate(async () => {
    const cv = document.createElement("canvas");
    cv.width = 320; cv.height = 440;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#e8c547"; ctx.fillRect(0, 0, 320, 440); ctx.fillStyle = "#222"; ctx.fillRect(30, 40, 260, 180);
    const blob: Blob = await new Promise((r) => cv.toBlob((b) => r(b!), "image/jpeg", 0.9));
    await (window as any).PS.liveScanUpload(new File([blob], "karte.jpg", { type: "image/jpeg" }));
    await (window as any).PS.liveScanPhoto();
  });
  const hud = page.locator('#ps-ls-hud [data-hud="result"]');
  await expect(hud).toBeVisible();
  return hud;
}

test("Scan: jede erkannte Karte landet automatisch im Set-Ordner – auch bei „Als Inserat einstellen“; erneuter Scan zählt hoch", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await fakeLogin(page, baseURL!);
  const posts: any[] = [];
  let qty = 0;
  await mockApi(page, {
    "GET /api/me": () => me(),
    "POST /api/scan/vision": () => ({ found: true, clear: true, items: [HIT], detected: { name: HIT.name, number: "001" } }),
    "POST /api/portfolio": (route) => { posts.push(route.request().postDataJSON()); qty++; return { id: 11, cardId: "sv08-1", quantity: qty, merged: qty > 1 }; },
  }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => (window as any).PS.openScanner());
  await expect(page.locator("#ps-ls-hud")).toBeAttached();

  // 1. Scan → Karte wird SOFORT gespeichert (kein Pflicht-Klick); ✕/Weiter scannen speichert nicht doppelt
  let hud = await scanOnce(page);
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ cardId: "sv08-1", merge: true, condition: "NM", variant: "normal" });
  await expect(hud.locator("[data-hud-autofile]")).toHaveText(/Gespeichert · im Set-Ordner einsortiert/);
  await expect(hud.locator('[data-act="sell"]')).toHaveText("🏷️ Als Inserat einstellen");
  await expect(hud.locator("[data-hud-next]")).toContainText("Weiter scannen");
  await hud.getByRole("button", { name: "Schließen und nächste Karte scannen" }).click();
  await expect(page.locator("#ps-ls-hud")).toBeHidden();
  await page.waitForTimeout(300);
  expect(posts.length).toBe(1);

  // 2. Dieselbe Karte erneut scannen und als Inserat einstellen → bleibt im Set-Ordner (Anzahl 2x) UND Schnell-Inserat öffnet
  hud = await scanOnce(page);
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ cardId: "sv08-1", merge: true });
  await hud.locator('[data-act="sell"]').click();
  await expect(page.locator("#ps-quicklist")).toBeVisible();
  await expect(page.locator("#ps-quicklist")).toContainText("Karte Eins");
  await page.waitForTimeout(300);
  expect(posts.length).toBe(2);

  // 3. Ohne Klick: Ergebnis schließt sich nach kurzem Moment selbst, Kamera ist bereit für die nächste Karte
  await page.evaluate(() => document.getElementById("ps-quicklist")?.remove());
  hud = await scanOnce(page);
  await expect.poll(() => posts.length).toBe(3);
  await expect(page.locator("#ps-ls-hud")).toBeHidden({ timeout: 8000 });
  expect(posts.length).toBe(3);
});

// ---------------------------------------------------------------------------
// 2. Mengen-Badge & Gesamtwert-Umschalter
// ---------------------------------------------------------------------------
const catalog = Array.from({ length: 9 }, (_, i) => ({ id: `sv08-${i + 1}`, name: `Karte ${i + 1}`, image: "", localId: String(i + 1), price: i + 1 }));

async function binderSetup(page: Page, baseURL: string) {
  await fakeLogin(page, baseURL);
  await mockApi(page, {
    "GET /api/me": () => me(),
    "GET /api/binder/folders": () => ({ folders: [
      { setId: "sv08", name: "Stürmische Funken", logo: "", symbol: "", preview: "", serieName: "", releaseDate: "2024-11-08", owned: 2, total: 191, pct: 1, value: 17, uniqueValue: 7, quantity: 4, progressLabel: "2 / 191 Karten" },
      { setId: "sv03.5", name: "151", logo: "", symbol: "", preview: "", serieName: "", releaseDate: "2023-09-22", owned: 1, total: 207, pct: 0, value: 300, uniqueValue: 100, quantity: 3, progressLabel: "1 / 207 Karten" },
    ] }),
    "GET /api/binder/set/:id": (_route, url) => {
      const base = { setId: "sv08", viewerId: ME.id, marketListings: [], myListings: [] };
      if (url.searchParams.get("market") === "1") return base;
      return { ...base, set: { id: "sv08", name: "Stürmische Funken", total: 9, official: 191 }, catalog,
        owned: [{ cardId: "sv08-1", quantity: 3, condition: "NM", portfolioItemId: 11, value: 15 }, { cardId: "sv08-2", quantity: 1, condition: "NM", portfolioItemId: 12, value: 2 }] };
    },
  }, { loggedIn: true });
}

test("Set-Ordner: Doppelte als „3x“-Badge in einem Slot; Umschalter „Doppelte im Gesamtwert mitzählen“ rechnet live und bleibt gemerkt", async ({ page, baseURL }) => {
  const errors = collectErrors(page);
  await binderSetup(page, baseURL!);
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => (window as any).PS.collectionTab("binder"));
  const box = page.locator("#ps-binder-folders");
  const toggle = box.getByRole("switch", { name: "Doppelte im Gesamtwert mitzählen" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(box.locator("[data-binder-total]")).toHaveText(/317,00\s€/);
  await expect(box.locator('[data-set-folder="sv08"] [data-folder-value]')).toHaveText(/17,00\s€/);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(box.locator("[data-binder-total]")).toHaveText(/107,00\s€/);
  await expect(box.locator('[data-set-folder="sv08"] [data-folder-value]')).toHaveText(/7,00\s€/);
  await expect(box.locator('[data-set-folder="sv03.5"] [data-folder-value]')).toHaveText(/100,00\s€/);

  // Binder-Ansicht: ein Slot mit „3x“, Set-Wert folgt dem Umschalter
  await box.locator('[data-set-folder="sv08"]').click();
  const view = page.locator("#ps-binder-view");
  await expect(view.locator('[data-binder-card="sv08-1"] .ps-bslot-qty')).toHaveText("3x");
  await expect(view.locator('[data-binder-card="sv08-1"]')).toHaveCount(1);
  await expect(view.locator('[data-binder-card="sv08-2"] .ps-bslot-qty')).toHaveCount(0);
  await expect(view.locator("[data-binder-value]")).toHaveText(/7,00\s€/);
  await view.getByRole("switch", { name: "Doppelte im Gesamtwert mitzählen" }).click();
  await expect(view.locator("[data-binder-value]")).toHaveText(/17,00\s€/);
  await expect(view.locator("[data-binder-list-dupes]")).toHaveText(/Alle Doppelten inserieren/);
  await page.evaluate(() => (window as any).PS.closeSetBinder());
  await expect(box.locator("[data-binder-total]")).toHaveText(/317,00\s€/);

  // Gemerkt: nach dem Neuladen wieder Aus, wenn ausgeschaltet
  await toggle.click();
  await page.reload();
  await appReady(page);
  await page.evaluate(() => (window as any).PS.collectionTab("binder"));
  await expect(page.locator("#ps-binder-folders").getByRole("switch", { name: "Doppelte im Gesamtwert mitzählen" })).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#ps-binder-folders [data-binder-total]")).toHaveText(/107,00\s€/);
  expect(errors()).toEqual([]);
});

// ---------------------------------------------------------------------------
// 3. + 4. Inserieren: „Alle Doppelten inserieren“, Suche & Filter
// ---------------------------------------------------------------------------
const items = [
  { id: 1, cardId: "sv03.5-199", name: "Glurak-ex", image: "", setName: "151", quantity: 3, unitValue: 120, value: 360, condition: "NM", variant: "normal", lang: "de" },
  { id: 2, cardId: "sv03.5-6", name: "Glurak", image: "", setName: "151", quantity: 1, unitValue: 4, value: 4, condition: "NM", variant: "normal", lang: "de" },
  { id: 3, cardId: "sv08-238", name: "Pikachu-ex", image: "", setName: "Stürmische Funken", quantity: 2, unitValue: 50, value: 100, condition: "EX", variant: "normal", lang: "de" },
  { id: 4, cardId: "sv08-25", name: "Evoli", image: "", setName: "Stürmische Funken", quantity: 1, unitValue: 1, value: 1, condition: "NM", variant: "normal", lang: "de" },
];

async function mineSetup(page: Page, baseURL: string) {
  await fakeLogin(page, baseURL);
  const posted: any[] = [];
  let active: any[] = [];
  await mockApi(page, {
    "GET /api/me": () => me(),
    "GET /api/portfolio": () => ({ items, total: 465, cost: 0, gain: 0, movers: [], history: [], limit: 100 }),
    "GET /api/listings": (_route, url) => ({ listings: url.searchParams.get("mine") === "1" ? active : [] }),
    "POST /api/listings": (route) => {
      const list = route.request().postDataJSON().items;
      posted.push(...list);
      active = active.concat(list.map((l: any, i: number) => ({ id: 900 + active.length + i, card_id: l.cardId, print_id: l.printId || null, status: "active", user_id: ME.id, price: l.price, card_name: l.card })));
      return { created: list.length, skipped: 0, listings: [] };
    },
  }, { loggedIn: true });
  return { posted };
}

test("Inserieren: „Alle Doppelten inserieren“ fragt nach, inseriert nur Überzählige mit Zustand & Preis – zweiter Klick legt nichts doppelt an", async ({ page, baseURL }) => {
  const errors = collectErrors(page);
  const { posted } = await mineSetup(page, baseURL!);
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => (window as any).PS.marketTab("sell"));
  const picker = page.locator("#ps-list-picker");
  const btn = picker.getByRole("button", { name: /Alle Doppelten inserieren/ });
  await expect(btn).toHaveText("🏷️ Alle Doppelten inserieren (3)");
  await expect(picker.locator("[data-dupes-note]")).toContainText("je 1 Exemplar bleibt in deinem Set-Ordner");

  await btn.click();
  await expect.poll(() => posted.length).toBe(3);
  expect(dialogs[0]).toMatch(/^3 doppelte Karten jetzt zum Cardmarket-Preis inserieren\?/);
  expect(posted.filter((p) => p.cardId === "sv03.5-199")).toHaveLength(2);
  expect(posted.filter((p) => p.cardId === "sv08-238")).toHaveLength(1);
  expect(posted.some((p) => p.cardId === "sv03.5-6" || p.cardId === "sv08-25")).toBe(false);
  expect(posted.find((p) => p.cardId === "sv03.5-199")).toMatchObject({ price: 120, condition: "nm", card: "Glurak-ex", portfolioItemId: 1 });
  expect(posted.find((p) => p.cardId === "sv08-238")).toMatchObject({ price: 50, condition: "ex" });
  await expect(picker.locator("[data-dupes-note]")).toContainText("Alle 3 Doppelten sind schon inseriert");
  await expect(picker.locator('[data-pick-card="card:sv03.5-199"] [data-pick-listed]')).toHaveText("✓ Doppelte inseriert");

  // Zweiter Klick: keine neuen Inserate, keine Rückfrage
  await btn.click();
  await page.waitForTimeout(300);
  expect(posted.length).toBe(3);
  expect(dialogs.length).toBe(1);
  expect(errors()).toEqual([]);
});

test("Inserieren: Kartenauswahl mit Suchleiste (Name, Nummer, Set) und Chips „Alle“ | „Nur Doppelte“ | „Nach Set“", async ({ page, baseURL }) => {
  const errors = collectErrors(page);
  await mineSetup(page, baseURL!);
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => (window as any).PS.marketTab("sell"));
  const picker = page.locator("#ps-list-picker");
  const tiles = picker.locator("[data-pick-card]");
  await expect(tiles).toHaveCount(4);
  await expect(picker.getByRole("button", { name: /^(Alle|Nur Doppelte|Nach Set)$/ })).toHaveCount(3);

  const search = picker.getByRole("searchbox", { name: "Eigene Karten durchsuchen" });
  await search.fill("pika");
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toContainText("Pikachu-ex");
  await expect(search).toBeFocused();
  await search.fill("199");
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toContainText("Glurak-ex");
  await search.fill("Stürmische");
  await expect(tiles).toHaveCount(2);
  await search.fill("xyz");
  await expect(picker.locator("[data-pick-empty]")).toHaveText("Keine Karte passt zur Suche.");
  await search.fill("");

  await picker.getByRole("button", { name: "Nur Doppelte", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Nur Doppelte", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(tiles).toHaveCount(2);
  await expect(picker.locator('[data-pick-card="card:sv03.5-199"] [data-pick-qty]')).toHaveText("3x");

  await picker.getByRole("button", { name: "Nach Set", exact: true }).click();
  await expect(picker.locator("[data-pick-set]")).toHaveText([/^151 · 2$/, /^Stürmische Funken · 2$/]);
  await expect(tiles).toHaveCount(4);

  await picker.getByRole("button", { name: "Alle", exact: true }).click();
  await expect(tiles).toHaveCount(4);
  // Tipp auf eine Karte öffnet das Schnell-Inserieren mit der Karte
  await picker.locator('[data-pick-card="card:sv08-238"]').click();
  await expect(page.locator("#ps-quicklist")).toBeVisible();
  await expect(page.locator("#ps-quicklist")).toContainText("Pikachu-ex");
  expect(errors()).toEqual([]);
});
