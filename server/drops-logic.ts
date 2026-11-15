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
