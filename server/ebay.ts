// PokeSwipe & Radar – eBay-Anbindung (nur serverseitig; Schlüssel ausschließlich aus Umgebungsvariablen).
//   EBAY_CLIENT_ID / EBAY_CLIENT_SECRET: Production-Keyset einer eBay-Developer-App (OAuth2 Client Credentials).
//   Browse API (item_summary/search): aktive Sofort-Kaufen- und Auktionsangebote auf eBay.de inkl. Partner-Link.
//   Marketplace Insights API (item_sales/search): echte Verkäufe – nur, wenn eBay die App dafür freigeschaltet hat;
//   sonst merkt sich das Modul die Ablehnung und nutzt beendete Auktionen als Verkaufsdaten.
import { EPN_CAMPAIGN_ID } from "./flip-logic.ts";
import { resilientFetch } from "./resilience.ts";

const OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const INSIGHTS_URL = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const SCOPE_BASE = "https://api.ebay.com/oauth/api_scope";
const SCOPE_INSIGHTS = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
/** eBay-Kategorien: Einzelkarten (Sammelkartenspiele) bzw. versiegelte Produkte */
export const EBAY_CATEGORY_SINGLES = "183454";
export const EBAY_CATEGORY_SEALED = "183456";

/** Alternative Namen aus dem eBay-Developer-Portal: „App ID“ = Client-ID, „Cert ID“ = Client-Secret. */
const ALIASES: Record<string, string[]> = {
  EBAY_CLIENT_ID: ["EBAY_CLIENT_ID", "EBAY_APP_ID", "EBAY_APPID"],
  EBAY_CLIENT_SECRET: ["EBAY_CLIENT_SECRET", "EBAY_CERT_ID", "EBAY_CERTID"],
};
const env = (k: string) => {
  for (const name of ALIASES[k] || [k]) {
    const v = String(process.env[name] || "").trim();
    if (v) return v;
  }
  return "";
};
export const ebayConfigured = () => !!(env("EBAY_CLIENT_ID") && env("EBAY_CLIENT_SECRET"));

type Token = { value: string; expiresAt: number };
const tokens: Record<string, Token | undefined> = {};
let insightsDeniedUntil = 0;

async function token(scope: string): Promise<string | null> {
  if (!ebayConfigured()) return null;
  const cached = tokens[scope];
  if (cached && cached.expiresAt - 120_000 > Date.now()) return cached.value;
  const basic = Buffer.from(`${env("EBAY_CLIENT_ID")}:${env("EBAY_CLIENT_SECRET")}`).toString("base64");
  // Token-Abruf ist idempotent und darf daher wiederholt werden
  const res = await resilientFetch("ebay", OAUTH_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
  }, { timeoutMs: 8000, attempts: 2 });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    const err = new Error(`eBay OAuth ${res.status}${data?.error ? ` ${String(data.error).slice(0, 40)}` : ""}`);
    (err as any).status = res.status;
    (err as any).code = String(data?.error || "");
    throw err;
  }
  tokens[scope] = { value: String(data.access_token), expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 7200) * 1000 };
  return tokens[scope]!.value;
}

/** Anwendungs-Token (Client Credentials, Basis-Scope) – u. a. für den Abruf der Notification-Public-Keys. */
export async function applicationToken(): Promise<string | null> {
  return token(SCOPE_BASE);
}

const money = (m: any): number | null => {
  const v = Number(m?.value);
  return Number.isFinite(v) && v >= 0 ? v : null;
};

export type EbayOffer = {
  itemId: string; title: string; price: number; shipping: number | null; currency: string;
  buyingOption: "FIXED_PRICE" | "AUCTION"; bidCount: number; endAt: Date | null;
  itemWebUrl: string; affiliateUrl: string; image: string; seller: string;
  sellerFeedbackPct: number | null; sellerFeedbackScore: number | null; condition: string; country: string;
};

function shapeSummary(it: any): EbayOffer | null {
  const options: string[] = Array.isArray(it?.buyingOptions) ? it.buyingOptions : [];
  const isAuction = options.includes("AUCTION") && !options.includes("FIXED_PRICE");
  const priceObj = isAuction ? (it.currentBidPrice ?? it.price) : it.price;
  const price = money(priceObj);
  const currency = String(priceObj?.currency || "");
  if (price === null || currency !== "EUR" || !it?.itemId || !it?.title || !it?.itemWebUrl) return null;
  const shipOpt = Array.isArray(it.shippingOptions) ? it.shippingOptions.find((s: any) => s?.shippingCost) : null;
  const shipping = shipOpt && String(shipOpt.shippingCost?.currency || "EUR") === "EUR" ? money(shipOpt.shippingCost) : null;
  const end = it.itemEndDate ? new Date(it.itemEndDate) : null;
  return {
    itemId: String(it.itemId).slice(0, 80),
    title: String(it.title).slice(0, 200),
    price, shipping, currency,
    buyingOption: isAuction ? "AUCTION" : "FIXED_PRICE",
    bidCount: Number(it.bidCount) || 0,
    endAt: end && !Number.isNaN(end.getTime()) ? end : null,
    itemWebUrl: String(it.itemWebUrl),
    affiliateUrl: String(it.itemAffiliateWebUrl || ""),
    image: String(it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || "").slice(0, 400),
    seller: String(it.seller?.username || "").slice(0, 60),
    sellerFeedbackPct: it.seller?.feedbackPercentage != null ? Number(it.seller.feedbackPercentage) : null,
    sellerFeedbackScore: it.seller?.feedbackScore != null ? Number(it.seller.feedbackScore) : null,
    condition: String(it.condition || "").slice(0, 60),
    country: String(it.itemLocation?.country || "").slice(0, 4),
  };
}

/** Aktive Angebote (Sofort-Kaufen + Auktionen) mit Lieferung nach Deutschland. */
export async function browseSearch(q: string, { category = EBAY_CATEGORY_SINGLES, limit = 100 } = {}): Promise<EbayOffer[]> {
  const t = await token(SCOPE_BASE);
  if (!t) return [];
  const params = new URLSearchParams({
    q: q.slice(0, 100),
    limit: String(Math.min(200, Math.max(1, limit))),
    filter: "buyingOptions:{FIXED_PRICE|AUCTION},deliveryCountry:DE,price:[1..],priceCurrency:EUR",
  });
  if (category) params.set("category_ids", category);
  const res = await resilientFetch("ebay", `${BROWSE_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${t}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE",
      // Partner-Kontext: eBay liefert damit itemAffiliateWebUrl mit unserer ePN-Kampagne
      "X-EBAY-C-ENDUSERCTX": `affiliateCampaignId=${EPN_CAMPAIGN_ID},affiliateReferenceId=pokeswipe-flip,contextualLocation=country%3DDE`,
      "Accept-Language": "de-DE",
      Accept: "application/json",
    },
  }, { timeoutMs: 9000, attempts: 2 });
  if (res.status === 401) tokens[SCOPE_BASE] = undefined;
  if (!res.ok) throw new Error(`eBay Browse ${res.status}`);
  const data: any = await res.json();
  return (Array.isArray(data?.itemSummaries) ? data.itemSummaries : []).map(shapeSummary).filter(Boolean) as EbayOffer[];
}

export type EbaySale = { itemId: string; title: string; price: number; soldAt: Date; url: string };

/** Echte Verkäufe der letzten 90 Tage – liefert null, wenn die App keinen Insights-Zugang hat. */
export async function insightsSearch(q: string, { category = EBAY_CATEGORY_SINGLES, limit = 50 } = {}): Promise<EbaySale[] | null> {
  if (!ebayConfigured() || Date.now() < insightsDeniedUntil) return null;
  let t: string | null;
  try {
    t = await token(SCOPE_INSIGHTS);
  } catch (e: any) {
    // invalid_scope / unauthorized_client: Zugang nicht freigeschaltet → 12 h nicht erneut versuchen
    insightsDeniedUntil = Date.now() + 12 * 3600_000;
    return null;
  }
  if (!t) return null;
  const params = new URLSearchParams({ q: q.slice(0, 100), limit: String(Math.min(200, Math.max(1, limit))) });
  if (category) params.set("category_ids", category);
  const res = await resilientFetch("ebay", `${INSIGHTS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${t}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE", Accept: "application/json" },
  }, { timeoutMs: 9000, attempts: 2 });
  if (res.status === 401 || res.status === 403) { insightsDeniedUntil = Date.now() + 12 * 3600_000; return null; }
  if (!res.ok) throw new Error(`eBay Insights ${res.status}`);
  const data: any = await res.json();
  const list = Array.isArray(data?.itemSales) ? data.itemSales : [];
  const out: EbaySale[] = [];
  for (const it of list) {
    const price = money(it?.lastSoldPrice);
    const soldAt = it?.lastSoldDate ? new Date(it.lastSoldDate) : null;
    if (price === null || String(it?.lastSoldPrice?.currency || "") !== "EUR" || !soldAt || Number.isNaN(soldAt.getTime()) || !it?.itemId) continue;
    const ship = Array.isArray(it.shippingOptions) ? money(it.shippingOptions[0]?.shippingCost) : null;
    out.push({ itemId: String(it.itemId).slice(0, 80), title: String(it.title || "").slice(0, 200), price: price + (ship ?? 0), soldAt, url: String(it.itemWebUrl || "").slice(0, 400) });
  }
  return out;
}

export const insightsAvailable = () => ebayConfigured() && Date.now() >= insightsDeniedUntil;
