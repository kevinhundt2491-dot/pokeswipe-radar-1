// E2E: Warenkorb mit Optimierer, Checkout-Bestätigung, DHL-Etikett in der Versand-Ansicht (API simuliert)
import { test, expect } from "@playwright/test";
import { mockApi, fakeLogin, appReady, collectErrors, emptyCart } from "./helpers.ts";

const line = (o: Record<string, unknown>) => ({
  cartItemId: 1, listingId: 11, title: "Glurak ex", image: "", variant: "normal", variantLabel: "Normal", condition: "nm", conditionLabel: "Near Mint",
  lang: "de", cardId: "sv03.5-199", unitCents: 1000, priceCentsAtAdd: 1000, quantity: 1, available: 3, shippingCents: 400, ...o,
});
const cartWith = (lines: any[][]) => ({
  ...emptyCart(),
  groups: lines.map((ls, i) => ({ sellerId: `s${i}`, sellerName: `Händler ${i + 1}`, sellerType: i ? "business" : "private", itemsCents: ls.reduce((s, l) => s + l.unitCents * l.quantity, 0), shippingCents: 400, totalCents: ls.reduce((s, l) => s + l.unitCents * l.quantity, 0) + 400, itemCount: ls.length, lines: ls })),
  itemsCents: 2000, shippingCents: 800, totalCents: 2800, count: 2,
});

test.beforeEach(async ({ page, baseURL }) => { await fakeLogin(page, baseURL!); });

test("Warenkorb: Optimierer schlägt günstigere Zusammenstellung vor und übernimmt sie", async ({ page }) => {
  const errors = collectErrors(page);
  const before = cartWith([[line({})], [line({ cartItemId: 2, listingId: 12, title: "Pikachu", cardId: "sv01-1" })]]);
  const after = cartWith([[line({}), line({ cartItemId: 3, listingId: 13, title: "Pikachu", cardId: "sv01-1", unitCents: 1050 })]]);
  after.groups[0].shippingCents = 400; after.totalCents = 2450; after.shippingCents = 400;
  let applied: any = null;
  await mockApi(page, {
    "GET /api/cart": () => (applied ? after : before),
    "POST /api/cart/optimize": () => ({
      possible: true, currentCents: 2800, optimizedCents: 2450, savingsCents: 350, currentShippingCents: 800, optimizedShippingCents: 400, sellersBefore: 2, sellersAfter: 1,
      changes: [{ cartItemId: 2, title: "Pikachu", quantity: 1, from: { listingId: 12, seller: "Händler 2", unitCents: 1000, condition: "nm", conditionLabel: "Near Mint" },
        to: [{ listingId: 13, seller: "Händler 1", quantity: 1, unitCents: 1050, shippingCents: 400, condition: "nm", conditionLabel: "Near Mint" }] }],
    }),
    "POST /api/cart/optimize/apply": (route) => { applied = route.request().postDataJSON(); return { ok: true, savingsCents: 350, cart: after }; },
  }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => (window as any).PS.openCart());
  await expect(page.getByText("Händler 2")).toBeVisible();
  await page.getByRole("button", { name: "Prüfen" }).click();
  await expect(page.getByText(/Spare/)).toBeVisible();
  await page.getByRole("button", { name: /Vorschlag übernehmen/ }).click();
  await expect.poll(() => applied).not.toBeNull();
  expect(applied.expectedTotalCents).toBe(2450);
  await expect(page.getByText("Händler 2")).toHaveCount(0);
  expect(errors()).toEqual([]);
});

test("Warenkorb: Checkout verlangt die Bestätigung der Kaufbedingungen", async ({ page }) => {
  let checkout = 0;
  await mockApi(page, {
    "GET /api/cart": () => cartWith([[line({})]]),
    "POST /api/checkout/connect/session": () => { checkout++; return { url: "/?checkout=e2e" }; },
  }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => (window as any).PS.openCart());
  const order = page.getByRole("button", { name: /Zahlungspflichtig bestellen/ });
  await order.click();
  await expect(page.getByText("Bitte bestätige die Kaufbedingungen.")).toBeVisible();
  expect(checkout).toBe(0);
  await page.locator("#ps-cart-terms").check();
  // Sofort erneut tippen: die globale 3-s-Doppelklick-Sperre greift – mit sichtbarem Hinweis statt stillem Verschlucken
  await order.click();
  await expect(page.getByText("Kurz warten").first()).toBeVisible();
  expect(checkout).toBe(0);
  await page.waitForTimeout(3100);
  await order.click();
  await expect.poll(() => checkout).toBe(1);
});

test("Versand: DHL-Etikett erstellen füllt Sendungsnummer und DHL vor", async ({ page }) => {
  let created: any = null;
  await mockApi(page, {
    "GET /api/shipping/meta": () => ({ enabled: true, products: [{ code: "V62KP", label: "DHL Kleinpaket (national)", maxG: 1000, international: false }], printFormats: ["A4"] }),
    "GET /api/seller/shipping-account": () => ({ enabled: true, account: { configured: true, sandbox: true, defaultWeightG: 300, defaultProduct: "V62KP", verifiedAt: new Date().toISOString() } }),
    "GET /api/orders/:id/labels": () => ({ labels: created ? [{ id: 5, status: "created", productLabel: "DHL Kleinpaket (national)", shipmentNo: "00340434161094000001", weightG: 300, pdfUrl: "/api/orders/42/label/5/pdf" }] : [] }),
    "POST /api/orders/:id/label": (route) => { created = route.request().postDataJSON(); return { ok: true, carrier: "dhl", trackingNumber: "00340434161094000001", sandbox: true, label: { id: 5, pdfUrl: "/api/orders/42/label/5/pdf" } }; },
    "GET /api/orders/:id/label/:labelId/pdf": async (route) => { await route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4" }); },
  }, { loggedIn: true });
  await page.goto("/");
  await appReady(page);
  await page.evaluate(() => (window as any).PS.shipOrder(42));
  await expect(page.getByText(/DHL-Etikett/).first()).toBeVisible();
  await page.getByRole("button", { name: /Etikett erstellen/ }).click();
  await expect.poll(() => created).not.toBeNull();
  expect(created.weightG).toBe(300);
  await expect(page.locator("#ps-ship-nr")).toHaveValue("00340434161094000001");
  await expect(page.locator("#ps-ship-carrier")).toHaveValue("dhl");
});
