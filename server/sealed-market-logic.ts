// 📦 Sealed & OVP Kaufen/Verkaufen – reine Regeln (ohne DB/DOM), genutzt von POST /api/listings und im Browser
// (Reiter „📦 Sealed & OVP“ im Marktplatz, Schnell-Filter im Schwarzen Brett und auf der Startseite).
// Sealed-Inserate sind Pokémon-Artikel (listing_type „item“) mit Sealed-Kategorie oder Zustand „Neu & OVP“ –
// dazu zählen auch ältere Inserate aus dem Sealed-Tracker (sealed_product_id). Zusatzangaben liegen in listings.item_meta.

export const SEALED_KINDS: { id: string; label: string; icon: string }[] = [
  { id: "display", label: "Booster Displays (36er / 18er)", icon: "📦" },
  { id: "etb", label: "Top-Trainer-Boxen (ETB / TTB)", icon: "🎁" },
  { id: "tin", label: "Tins & Kollektionen", icon: "🥫" },
  { id: "blister", label: "Einzelne Booster & Blister", icon: "🃏" },
  { id: "vintage", label: "Vintage / Rare Sealed", icon: "🔒" },
];
export const SEALED_LANGS: { id: string; label: string }[] = [
  { id: "de", label: "🇩🇪 Deutsch" }, { id: "en", label: "🇬🇧 Englisch" }, { id: "ja", label: "🇯🇵 Japanisch" },
];
export const SEALED_DELIVERY: { id: string; label: string }[] = [
  { id: "both", label: "📍 Safe-Trade Abholung oder 📦 Versicherter DHL-Versand" },
  { id: "pickup", label: "📍 Nur Safe-Trade Abholung" },
  { id: "ship", label: "📦 Nur versicherter DHL-Versand" },
];

const SEALED_CATS = new Set(["display", "etb", "tin", "blister", "vintage", "booster"]);
const str = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export type SealedMeta = { sealed: true; set: string; factorySealed: boolean; mintBox: boolean; delivery: "both" | "pickup" | "ship"; vintage: boolean };

/** Zusatzangaben aus dem Formular „📦 Sealed-Produkt verkaufen“ bereinigen (null = kein Sealed-Inserat). */
export function normalizeSealedMeta(m: unknown, category = ""): SealedMeta | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  if (o.sealed !== true && o.sealed !== "1" && o.sealed !== 1) return null;
  const delivery = ["both", "pickup", "ship"].includes(String(o.delivery)) ? (String(o.delivery) as SealedMeta["delivery"]) : "both";
  return {
    sealed: true, set: str(o.set, 80), factorySealed: o.factorySealed === true, mintBox: o.mintBox === true, delivery,
    vintage: o.vintage === true || category === "vintage",
  };
}

const metaOf = (l: any): Record<string, any> => (l?.item_meta && typeof l.item_meta === "object" ? l.item_meta : {});

/** Ist das Inserat ein Sealed-/OVP-Produkt? */
export function isSealedListing(l: any): boolean {
  if (!l) return false;
  if (Number(l.sealed_product_id) > 0) return true;
  if (String(l.listing_type) !== "item") return false;
  return metaOf(l).sealed === true || SEALED_CATS.has(String(l.item_category)) || String(l.item_condition) === "sealed";
}

/** Sealed-Kategorie eines Inserats (display | etb | tin | blister | vintage) – ältere Inserate über den Titel. */
export function sealedKindOf(l: any): string {
  const cat = String(l?.item_category || "");
  if (cat === "vintage" || metaOf(l).vintage === true) return "vintage";
  if (["display", "etb", "tin", "blister"].includes(cat)) return cat;
  const t = String(l?.card_name || "").toLowerCase();
  if (/display|36er|18er|booster-?box/.test(t)) return "display";
  if (/\b(etb|ttb)\b|top.?trainer|elite.?trainer/.test(t)) return "etb";
  if (/\btin\b|kollektion|collection|premium|box\b/.test(t)) return "tin";
  if (/booster|blister|sleeved|bundle/.test(t)) return "blister";
  return cat === "booster" ? "display" : "blister";
}

export const sealedKindLabel = (id: string) => SEALED_KINDS.find((k) => k.id === id)?.label || "Sealed";
export const sealedKindIcon = (id: string) => SEALED_KINDS.find((k) => k.id === id)?.icon || "📦";

/** Übergabe: pickup | ship | both (aus item_meta, sonst aus dem Text „Verkauf · Nur Versand“ / „Nur Abholung“). */
export function sealedDeliveryOf(l: any): "both" | "pickup" | "ship" {
  const d = String(metaOf(l).delivery || "");
  if (d === "pickup" || d === "ship" || d === "both") return d;
  const w = String(l?.want || "").toLowerCase();
  if (/nur abholung/.test(w)) return "pickup";
  if (/nur versand/.test(w)) return "ship";
  return "both";
}

/** Händler = Verkäuferkonto als Gewerbe oder eigener Händler-Shop. */
export const isDealer = (l: any) => Boolean(l?.seller_dealer || l?.seller_shop);

export type SealedFilter = { kind?: string; set?: string; min?: number | string; max?: number | string; seller?: "all" | "private" | "dealer" | string; delivery?: "" | "pickup" | "ship" | string; q?: string };

export function filterSealed<T extends Record<string, any>>(list: T[], f: SealedFilter = {}): T[] {
  const min = Number(f.min), max = Number(f.max);
  const q = String(f.q || "").trim().toLowerCase();
  const set = String(f.set || "").trim().toLowerCase();
  return (Array.isArray(list) ? list : []).filter((l) => {
    if (!isSealedListing(l)) return false;
    if (f.kind && f.kind !== "all" && sealedKindOf(l) !== f.kind) return false;
    if (set && !`${metaOf(l).set || ""} ${l.card_name || ""}`.toLowerCase().includes(set)) return false;
    const p = Number(l.price) || 0;
    if (Number.isFinite(min) && String(f.min ?? "") !== "" && p < min) return false;
    if (Number.isFinite(max) && String(f.max ?? "") !== "" && max > 0 && p > max) return false;
    if (f.seller === "private" && isDealer(l)) return false;
    if (f.seller === "dealer" && !isDealer(l)) return false;
    const d = sealedDeliveryOf(l);
    if (f.delivery === "pickup" && d === "ship") return false;
    if (f.delivery === "ship" && d === "pickup") return false;
    if (q && !`${l.card_name || ""} ${l.description || ""} ${l.city || ""} ${metaOf(l).set || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Set-Auswahl im Sealed-Reiter: Sets aus den Inseraten (item_meta.set), häufigste zuerst. */
export function sealedSets(list: any[]): string[] {
  const n = new Map<string, number>();
  for (const l of list || []) { const s = str(metaOf(l).set, 80); if (s && isSealedListing(l)) n.set(s, (n.get(s) || 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(([s]) => s);
}

/** Richtpreis-Orientierung: passendstes Katalog-Produkt (gleiche Art, Name enthält Set-Wörter) mit Preis. */
export function sealedRefPrice(products: any[], kind: string, set: string): { name: string; price: number; id: number } | null {
  const words = str(set, 80).toLowerCase().split(/[\s\-–:]+/).filter((w) => w.length > 2);
  if (!words.length) return null;
  const kindOk = (k: string) => kind === "display" ? k === "display" : kind === "etb" ? k === "etb" || k === "ttb" : kind === "tin" ? ["tin", "collection", "bundle"].includes(k) : kind === "blister" ? ["booster", "bundle"].includes(k) : true;
  let best: any = null, bestScore = 0;
  for (const p of products || []) {
    const price = Number(p.price ?? p.ref_price);
    if (!(price > 0)) continue;
    const hay = `${p.name || ""} ${p.set_name || ""}`.toLowerCase();
    const hit = words.filter((w) => hay.includes(w)).length;
    const score = hit / words.length + (kindOk(String(p.kind)) ? 0.5 : 0);
    if (hit && score > bestScore) { best = p; bestScore = score; }
  }
  return best ? { name: String(best.name), price: Number(best.price ?? best.ref_price), id: Number(best.id) } : null;
}
