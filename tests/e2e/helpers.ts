// Gemeinsame Helfer der E2E-Tests: API-Simulation, Fake-Login (Netlify Identity), Sammeln von JS-Fehlern.
import type { Page, Route } from "@playwright/test";

export type ApiHandler = (route: Route, url: URL) => unknown | Promise<unknown>;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export const ME = {
  id: "e2e-user", email: "e2e@example.com", displayName: "E2E Tester", city: "Köln", plan: "free", isAdmin: false,
  portfolio: 0, alerts: 0, listings: 0, unread: 0, openTrades: 0, hasBilling: false, sellerReady: false,
};

/** Simuliert die API: Standardantworten für die beim Start geladenen Endpunkte, eigene Handler haben Vorrang. */
export async function mockApi(page: Page, handlers: Record<string, ApiHandler> = {}, { loggedIn = false } = {}) {
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname}`;
    calls.push(key);
    for (const [pattern, h] of Object.entries(handlers)) {
      const [m, p] = pattern.split(" ");
      if (m === route.request().method() && new RegExp(`^${p.replace(/:[a-z]+/gi, "[^/]+")}$`).test(url.pathname)) {
        const r = await h(route, url);
        if (r !== undefined) return json(route, r);
        return;
      }
    }
    if (url.pathname === "/api/me") return loggedIn ? json(route, ME) : json(route, { error: "Bitte melde dich an." }, 401);
    if (url.pathname === "/api/client-errors") return route.fulfill({ status: 204 });
    if (url.pathname === "/api/public-config") return json(route, { firebaseApiKey: null, cardmarketPartnerId: null });
    if (url.pathname === "/api/cart") return json(route, emptyCart());
    if (url.pathname === "/api/market/meta") return json(route, { conditions: { nm: "Near Mint", ex: "Excellent", lp: "Light Played" }, carriers: { dhl: "DHL", other: "Andere" }, feeBps: { free: 650 }, autoReleaseDays: 14, shipWindowDays: 7, payWindowHours: 48, countries: ["DE"], enabled: true });
    if (route.request().method() === "GET") return json(route, {});
    return json(route, { ok: true });
  });
  // Externe Dienste (Firebase, TCGdex, Bilder) im Test nicht wirklich aufrufen
  await page.route(/^https:\/\/(?!127\.0\.0\.1)/, (route) => {
    const t = route.request().resourceType();
    if (t === "image") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" });
    if (/api\.tcgdex\.net/.test(route.request().url())) return json(route, []);
    return route.abort();
  });
  return calls;
}

export function emptyCart() {
  return { groups: [], unavailable: [], problems: [], itemsCents: 0, shippingCents: 0, totalCents: 0, count: 0, withdrawalDays: 14 };
}

/** Fake-Login: Netlify-Identity-Sitzung im localStorage + nf_jwt-Cookie, damit getUser() einen Nutzer liefert. */
export async function fakeLogin(page: Page, baseURL: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: ME.id, email: ME.email, exp, app_metadata: {}, user_metadata: { full_name: ME.displayName } })}.sig`;
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([{ name: "nf_jwt", value: jwt, domain: host, path: "/" }]);
  await page.addInitScript(([token, email, id, exp]) => {
    localStorage.setItem("gotrue.user", JSON.stringify({
      url: `${location.origin}/.netlify/identity`, id, aud: "", role: "", email, confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "email" }, user_metadata: { full_name: "E2E Tester" },
      token: { access_token: token, token_type: "bearer", expires_in: 3600, refresh_token: "e2e", expires_at: Number(exp) * 1000 },
    }));
  }, [jwt, ME.email, ME.id, String(exp)]);
  await page.route("**/.netlify/identity/**", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/settings")) return json(route, { external: {}, disable_signup: false, autoconfirm: false });
    if (u.pathname.endsWith("/user")) return json(route, { id: ME.id, email: ME.email, confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: { full_name: ME.displayName } });
    return json(route, {});
  });
}

/** Sammelt unerwartete JavaScript-Fehler der Seite (ignoriert bekannte Netzwerkabbrüche im Test). */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return () => errors.filter((m) => !/Failed to fetch|NetworkError|Load failed|ERR_FAILED|net::/i.test(m));
}

/** Wartet, bis das App-Bundle geladen ist (window.PS vorhanden). */
export async function appReady(page: Page) {
  await page.waitForFunction(() => Boolean((window as any).PS && (window as any).PS.openCart), null, { timeout: 15_000 });
}
