// Reine Logik für das Restock- & Vorbestell-Radar (ohne Datenbank, gut testbar).

export const SHOPS: Record<string, { label: string; hosts: string[] }> = {
  amazon: { label: "Amazon", hosts: ["amazon.de"] },
  pokemoncenter: { label: "Pokémon Center", hosts: ["pokemoncenter.com"] },
  smyths: { label: "Smyths Toys", hosts: ["smythstoys.com"] },
  mueller: { label: "Müller", hosts: ["mueller.de"] },
  mediamarkt: { label: "MediaMarkt", hosts: ["mediamarkt.de"] },
  saturn: { label: "Saturn", hosts: ["saturn.de"] },
  otto: { label: "Otto", hosts: ["otto.de"] },
  galeria: { label: "Galeria", hosts: ["galeria.de"] },
  thalia: { label: "Thalia", hosts: ["thalia.de"] },
  spielemax: { label: "Spiele Max", hosts: ["spiele-max.de"] },
  cardmarket: { label: "Cardmarket", hosts: ["cardmarket.com"] },
  games_island: { label: "Games-Island", hosts: ["games-island.eu"] },
  fantasywelt: { label: "Fantasywelt", hosts: ["fantasywelt.de"] },
  other: { label: "Laden / Sonstiges", hosts: [] },
};

/** Ordnet eine Produkt-URL einem bekannten Shop zu (nur https, nur bekannte Domains). */
export function shopForUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const host = u.hostname.toLowerCase();
  for (const [key, s] of Object.entries(SHOPS)) {
    if (s.hosts.some((h) => host === h || host.endsWith("." + h))) return key;
  }
  return null;
}

export type Availability = "in_stock" | "preorder" | "out_of_stock" | "unknown";

/**
 * Liest Verfügbarkeit und Preis aus einer Produktseite. Bevorzugt strukturierte Daten
 * (schema.org JSON-LD / Microdata), die fast alle großen Shops für Google ausliefern.
 */
export function parseAvailability(html: string): { status: Availability; price: number | null } {
  const page = html.slice(0, 1_500_000);
  let status: Availability = "unknown";
  const avail = [...page.matchAll(/schema\.org\/(InStock|PreOrder|PreSale|OutOfStock|SoldOut|Discontinued|BackOrder|LimitedAvailability|OnlineOnly)/gi)]
    .map((m) => m[1].toLowerCase());
  if (avail.length) {
    // Erstes Angebot der Seite zählt (Hauptprodukt), Zubehör-Empfehlungen stehen weiter unten
    const a = avail[0];
    status = a === "instock" || a === "limitedavailability" || a === "onlineonly" ? "in_stock"
      : a === "preorder" || a === "presale" ? "preorder"
      : "out_of_stock";
  } else if (/"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?InStock"/i.test(page)) {
    status = "in_stock";
  }
  let price: number | null = null;
  const pm = /"price"\s*:\s*"?(\d{1,5}(?:[.,]\d{1,2})?)"?/.exec(page)
    || /itemprop=["']price["'][^>]*content=["'](\d{1,5}(?:[.,]\d{1,2})?)["']/i.exec(page)
    || /property=["'](?:product|og):price:amount["'][^>]*content=["'](\d{1,5}(?:[.,]\d{1,2})?)["']/i.exec(page);
  if (pm) {
    const n = Number(pm[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n < 100_000) price = Math.round(n * 100) / 100;
  }
  return { status, price };
}

/** Lohnt sich das? Vergleich mit der unverbindlichen Preisempfehlung. */
export function uvpVerdict(price: number | null | undefined, uvp: number | null | undefined) {
  const p = Number(price), u = Number(uvp);
  if (!(p > 0) || !(u > 0)) return { level: "unknown" as const, label: "Preis prüfen", pct: null as number | null };
  const pct = Math.round(((p - u) / u) * 100);
  if (p <= u * 1.05) return { level: "fair" as const, label: pct < -2 ? `Unter UVP (${pct} %)` : "UVP-Preis", pct };
  if (p <= u * 1.25) return { level: "high" as const, label: `Leicht über UVP (+${pct} %)`, pct };
  return { level: "scalper" as const, label: `Scalper-Preis (+${pct} %)`, pct };
}

/** Hängt Partner-Kennungen an (Amazon PartnerNet, Cardmarket). Andere Shops bleiben unverändert. */
export function affiliateUrl(raw: string, tags: { amazon?: string; cardmarket?: string }) {
  let u: URL;
  try { u = new URL(raw); } catch { return raw; }
  const shop = shopForUrl(raw);
  if (shop === "amazon" && tags.amazon) u.searchParams.set("tag", tags.amazon);
  if (shop === "cardmarket") {
    u.searchParams.set("utm_source", "pokeswipe_radar");
    if (tags.cardmarket) u.searchParams.set("referrer", tags.cardmarket);
  }
  return u.toString();
}

export type RestockFilter = { shops: string; keywords: string; maxPrice: string | number | null; uvpOnly: boolean; preorders: boolean };

/** Passt ein Drop zu den (Pro-)Filtern eines Nutzers? */
export function matchesFilter(drop: { title: string; shop: string; kind: string; price: unknown; uvp: unknown }, f: RestockFilter, useFilters: boolean) {
  if (drop.kind === "preorder" && !f.preorders) return false;
  if (!useFilters) return true;
  const shops = f.shops.split(",").map((s) => s.trim()).filter(Boolean);
  if (shops.length && !shops.includes(drop.shop)) return false;
  const words = f.keywords.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (words.length && !words.some((w) => drop.title.toLowerCase().includes(w))) return false;
  const price = Number(drop.price);
  if (f.maxPrice != null && Number(f.maxPrice) > 0 && price > 0 && price > Number(f.maxPrice)) return false;
  if (f.uvpOnly && uvpVerdict(price, Number(drop.uvp)).level !== "fair") return false;
  return true;
}

/** Wann gilt ein Status-Wechsel als neuer Drop? */
export function isDropTransition(before: string, after: Availability) {
  if (after !== "in_stock" && after !== "preorder") return false;
  return before !== after && before !== "in_stock";
}

export const GRADE_COMPANIES = ["PSA", "CGC", "BGS", "TAG", "other"] as const;
export const SUBMISSION_STATUS = ["prep", "sent", "arrived", "grading", "shipped", "done"] as const;

// ===========================================================================
// Phase 9: Mehrstufige Produktseiten-Auswertung, Health-Monitor & Plausibilitätsprüfung
// ===========================================================================
export type ExtractLayer = "jsonld" | "meta" | "selector";
export type Extraction = { status: Availability; price: number | null; layer: ExtractLayer | null; confident: boolean };

const toPrice = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  let t = String(raw).trim().replace(/[^\d.,]/g, "");
  if (!t) return null;
  // 1.299,99 → 1299.99 · 1,299.99 → 1299.99 · 49,99 → 49.99
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n * 100) / 100 : null;
};

const availabilityOf = (raw: unknown): Availability => {
  const a = String(raw ?? "").toLowerCase().replace(/^https?:\/\/schema\.org\//, "");
  if (!a) return "unknown";
  if (/^(instock|limitedavailability|onlineonly|instoreonly)$/.test(a) || a === "in stock") return "in_stock";
  if (/^(preorder|presale)$/.test(a)) return "preorder";
  if (/^(outofstock|soldout|discontinued|backorder|out of stock)$/.test(a)) return "out_of_stock";
  return "unknown";
};

/** Stufe 1: schema.org JSON-LD (Product → offers). Robust gegen @graph, Arrays und AggregateOffer. */
export function extractJsonLd(html: string): { status: Availability; price: number | null } | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const products: any[] = [];
  const walk = (node: any, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (typeof node !== "object") return;
    const type = ([] as string[]).concat(node["@type"] || []).map((t) => String(t).toLowerCase());
    if (type.includes("product") || type.includes("productgroup")) products.push(node);
    if (node["@graph"]) walk(node["@graph"], depth + 1);
    if (node.mainEntity) walk(node.mainEntity, depth + 1);
  };
  for (const b of blocks) {
    try { walk(JSON.parse(b.trim().replace(/^<!--|-->$/g, ""))); } catch { /* ungültiges JSON-LD überspringen */ }
  }
  for (const p of products) {
    const offers = ([] as any[]).concat(p.offers || p.hasVariant?.[0]?.offers || []);
    for (const o of offers) {
      const inner = o?.["@type"] === "AggregateOffer" && o.offers ? ([] as any[]).concat(o.offers)[0] || o : o;
      const status = availabilityOf(inner?.availability ?? o?.availability);
      const price = toPrice(inner?.price ?? inner?.lowPrice ?? o?.lowPrice ?? o?.price ?? inner?.priceSpecification?.price);
      if (status !== "unknown" || price) return { status, price };
    }
  }
  return null;
}

/** Stufe 2: OpenGraph-/Meta-/Microdata-Tags (product:availability, og:price:amount, itemprop). */
export function extractMeta(html: string): { status: Availability; price: number | null } | null {
  const meta = (re: RegExp) => re.exec(html)?.[1] ?? null;
  const avail = meta(/<meta[^>]+(?:property|name)=["'](?:product|og):availability["'][^>]*content=["']([^"']+)["']/i)
    ?? meta(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:product|og):availability["']/i)
    ?? meta(/itemprop=["']availability["'][^>]*(?:content|href)=["']([^"']+)["']/i)
    ?? meta(/(?:content|href)=["']([^"']+)["'][^>]*itemprop=["']availability["']/i);
  const priceRaw = meta(/<meta[^>]+(?:property|name)=["'](?:product|og):price:amount["'][^>]*content=["']([^"']+)["']/i)
    ?? meta(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:product|og):price:amount["']/i)
    ?? meta(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)
    ?? meta(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
  const status = availabilityOf(avail);
  const price = toPrice(priceRaw);
  return status !== "unknown" || price ? { status, price } : null;
}

/**
 * Stufe 3: shop-spezifische Muster (Text der Verfügbarkeitsanzeige und Preis-Elemente).
 * Unsicherer als strukturierte Daten → ein Statuswechsel braucht hier eine zweite, gleiche Prüfung.
 */
export const SHOP_SELECTORS: Record<string, { inStock?: RegExp[]; outOfStock?: RegExp[]; preorder?: RegExp[]; price?: RegExp[] }> = {
  amazon: {
    inStock: [/id=["']availability["'][\s\S]{0,400}?(?:Auf Lager|Nur noch \d+ (?:Stück )?auf Lager|In stock)/i, /id=["']add-to-cart-button["']/i],
    outOfStock: [/id=["']availability["'][\s\S]{0,400}?(?:Derzeit nicht verfügbar|Currently unavailable|Nicht auf Lager)/i, /id=["']outOfStock["']/i],
    preorder: [/id=["']availability["'][\s\S]{0,400}?(?:Vorbestell|Pre-order|Erscheint am)/i, /id=["']buy-now-button["'][^>]*value=["'][^"']*vorbestell/i],
    price: [/class=["'][^"']*a-price-whole["'][^>]*>([\d.]+)<[\s\S]{0,80}?a-price-fraction["'][^>]*>(\d{2})</i, /id=["']priceblock_ourprice["'][^>]*>\s*([\d.,]+)/i],
  },
  smyths: {
    inStock: [/(?:In den Warenkorb|Zum Warenkorb hinzufügen)/i], outOfStock: [/(?:Online ausverkauft|Nicht verfügbar|Out of stock)/i],
    preorder: [/Vorbestellen/i], price: [/class=["'][^"']*price[^"']*["'][^>]*>\s*([\d.,]+)\s*€/i],
  },
  mueller: {
    inStock: [/(?:In den Warenkorb|online verfügbar)/i], outOfStock: [/(?:online nicht verfügbar|ausverkauft)/i],
    price: [/class=["'][^"']*product-price[^"']*["'][\s\S]{0,120}?([\d.,]+)\s*€/i],
  },
  mediamarkt: {
    inStock: [/(?:In den Warenkorb|Online verfügbar)/i], outOfStock: [/(?:Dieser Artikel ist (?:aktuell )?nicht verfügbar|Online nicht verfügbar)/i],
    preorder: [/Vorbestell/i],
  },
  saturn: {
    inStock: [/(?:In den Warenkorb|Online verfügbar)/i], outOfStock: [/(?:Dieser Artikel ist (?:aktuell )?nicht verfügbar|Online nicht verfügbar)/i],
    preorder: [/Vorbestell/i],
  },
  otto: { inStock: [/(?:In den Warenkorb|lieferbar)/i], outOfStock: [/(?:ausverkauft|nicht lieferbar)/i] },
  pokemoncenter: { inStock: [/Add to (?:Cart|Bag)/i], outOfStock: [/(?:Sold Out|Out of Stock)/i], preorder: [/Pre-?order/i] },
  games_island: { inStock: [/(?:In den Warenkorb|sofort lieferbar|auf Lager)/i], outOfStock: [/(?:ausverkauft|nicht lieferbar)/i], preorder: [/(?:Vorbestellung|Vorbestellen)/i] },
  fantasywelt: { inStock: [/(?:In den Warenkorb|Lagernd)/i], outOfStock: [/(?:ausverkauft|nicht verfügbar)/i], preorder: [/Vorbestell/i] },
};
const GENERIC_SELECTORS = {
  outOfStock: [/(?:ausverkauft|nicht (?:mehr )?verfügbar|out of stock|sold out)/i],
  preorder: [/(?:vorbestellen|pre-?order)/i],
  inStock: [/(?:in den warenkorb|add to cart)/i],
};

export function extractSelectors(html: string, shop: string): { status: Availability; price: number | null } | null {
  const sel = SHOP_SELECTORS[shop];
  const any = (list?: RegExp[]) => Boolean(list?.some((re) => re.test(html)));
  let status: Availability = "unknown";
  if (sel) {
    // Reihenfolge: ausverkauft > vorbestellbar > lieferbar (Warenkorb-Knöpfe gibt es oft auch für Zubehör)
    if (any(sel.outOfStock)) status = "out_of_stock";
    else if (any(sel.preorder)) status = "preorder";
    else if (any(sel.inStock)) status = "in_stock";
  } else {
    // Unbekannter Shop: nur eindeutige Negativ-/Vorbestell-Signale, nie „lieferbar“ aus Zubehör-Knöpfen raten
    if (any(GENERIC_SELECTORS.outOfStock)) status = "out_of_stock";
    else if (any(GENERIC_SELECTORS.preorder)) status = "preorder";
  }
  let price: number | null = null;
  for (const re of sel?.price || []) {
    const m = re.exec(html);
    if (m) { price = toPrice(m[2] ? `${m[1].replace(/\./g, "")},${m[2]}` : m[1]); if (price) break; }
  }
  return status !== "unknown" || price ? { status, price } : null;
}

/**
 * Gestaffelte Auswertung: 1. JSON-LD → 2. Meta-Tags → 3. Shop-Muster. Preis und Status können aus
 * verschiedenen Stufen stammen (z. B. Status aus JSON-LD, Preis aus Meta-Tags).
 */
export function extractProduct(html: string, shop: string): Extraction {
  const page = html.slice(0, 1_500_000);
  const layers: [ExtractLayer, { status: Availability; price: number | null } | null][] = [
    ["jsonld", extractJsonLd(page)], ["meta", extractMeta(page)], ["selector", extractSelectors(page, shop)],
  ];
  let status: Availability = "unknown", price: number | null = null, layer: ExtractLayer | null = null;
  for (const [name, r] of layers) {
    if (!r) continue;
    if (status === "unknown" && r.status !== "unknown") { status = r.status; layer = name; }
    if (!price && r.price) price = r.price;
  }
  // Rückfall: alte Regex-Erkennung (z. B. „schema.org/InStock“ in Microdata ohne Meta-Tag)
  if (status === "unknown") {
    const legacy = parseAvailability(page);
    if (legacy.status !== "unknown") { status = legacy.status; layer = "meta"; }
    if (!price && legacy.price) price = legacy.price;
  }
  return { status, price, layer: status === "unknown" && !price ? null : layer ?? "meta", confident: layer === "jsonld" || layer === "meta" };
}

/** Wechselnde, realistische Browser-Kennungen (je Versuch eine andere) – viele Shops sperren Bot-Kennungen pauschal. */
export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
];
export const userAgentFor = (seed: number, attempt = 0) => USER_AGENTS[Math.abs(seed + attempt) % USER_AGENTS.length];

/** Nach so vielen Fehlversuchen in Folge wird die Prüfung pausiert („Selektor-Update nötig“). */
export const PAUSE_AFTER_FAILURES = 3;

/** Backoff nach Sperre (403/429): 15 Min. × 2^(Sperren-1), höchstens 6 Std.; Retry-After des Shops hat Vorrang. */
export function blockBackoffMs(consecutiveBlocks: number, retryAfterMs?: number | null) {
  const base = Math.min(6 * 3600_000, 15 * 60_000 * 2 ** Math.max(0, consecutiveBlocks - 1));
  return retryAfterMs && retryAfterMs > 0 ? Math.min(6 * 3600_000, Math.max(retryAfterMs, 5 * 60_000)) : base;
}

export type WatchHealth = "ok" | "degraded" | "paused";
export type CheckOutcome =
  | { kind: "ok"; extraction: Extraction }
  | { kind: "unreadable" } // Seite geladen, aber weder Preis noch Status lesbar (Umbau / Captcha)
  | { kind: "blocked"; status: number; retryAfterMs?: number | null }
  | { kind: "error"; message: string };

/**
 * Health-Monitor: Ergebnis einer Prüfung → neuer Zustand des Links. Nach 3 Fehlschlägen in Folge pausiert die
 * Prüfung und das Admin-Panel zeigt „Selektor-Update nötig“ – statt falscher „Ausverkauft“-/„Lieferbar“-Alarme.
 */
export function nextHealth(failCount: number, outcome: CheckOutcome): { failCount: number; health: WatchHealth; reason: string } {
  if (outcome.kind === "ok") {
    const partial = outcome.extraction.status === "unknown";
    return partial
      ? { failCount: failCount + 1, ...fail(failCount + 1, "Preis lesbar, Status nicht – Muster prüfen") }
      : { failCount: 0, health: outcome.extraction.confident ? "ok" : "degraded", reason: outcome.extraction.confident ? "" : "Nur über Shop-Muster lesbar (keine strukturierten Daten)" };
  }
  const reason = outcome.kind === "unreadable" ? "Weder Preis noch Status lesbar – Seite umgebaut oder Captcha"
    : outcome.kind === "blocked" ? `Shop blockt Abrufe (HTTP ${outcome.status})` : `Abruf fehlgeschlagen: ${outcome.message.slice(0, 80)}`;
  return { failCount: failCount + 1, ...fail(failCount + 1, reason) };
  function fail(n: number, why: string) {
    return { health: (n >= PAUSE_AFTER_FAILURES ? "paused" : "degraded") as WatchHealth, reason: n >= PAUSE_AFTER_FAILURES ? `Prüfung pausiert – Selektor-Update nötig (${why})` : why };
  }
}

/**
 * Darf aus einer Prüfung ein Alarm entstehen? Strukturierte Daten (JSON-LD/Meta) sofort; reine Shop-Muster erst,
 * wenn die nächste Prüfung denselben Status bestätigt (pendingStatus).
 */
export function confirmTransition(before: string, extraction: Extraction, pendingStatus: string | null) {
  const after = extraction.status;
  if (!isDropTransition(before, after)) return { fire: false, pending: null as string | null };
  if (extraction.confident) return { fire: true, pending: null };
  return pendingStatus === after ? { fire: true, pending: null } : { fire: false, pending: after };
}

/**
 * Plausibilität einer Community-Restock-Meldung (vor dem Sofort-Alarm):
 * Link zum Shop des Produkts, Preis in realistischer Spanne zur UVP, Melder mit ausreichendem Vertrauen.
 */
export function reportPlausibility(i: {
  url: string; watchShop?: string | null; price: number | null; uvp: number | null; trustScore: number; admin: boolean; pageConfirms?: boolean | null;
}): { ok: boolean; instant: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const shop = i.url ? shopForUrl(i.url) : null;
  if (i.url && !shop) reasons.push("Shop-Link nicht unterstützt");
  if (i.watchShop && shop && shop !== i.watchShop && i.watchShop !== "other") reasons.push("Link gehört zu einem anderen Shop als das Produkt");
  if (i.price !== null && i.uvp && i.uvp > 0) {
    if (i.price < i.uvp * 0.4) reasons.push("Preis unrealistisch niedrig (Fake-Shop-Gefahr)");
    if (i.price > i.uvp * 4) reasons.push("Preis weit über UVP");
  }
  const ok = !reasons.length;
  // Sofort live: Admin, Seite bestätigt den Restock selbst, oder vertrauenswürdige Melder (ab Stufe „Vertrauenswürdig“)
  const instant = ok && (i.admin || i.pageConfirms === true || i.trustScore >= 60);
  return { ok, instant, reasons };
}
