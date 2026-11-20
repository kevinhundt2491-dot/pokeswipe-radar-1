import { normalizeSealedMeta } from "./sealed-market-logic.ts";
// Pokémon-Artikel im Marktplatz („📦 Pokémon-Artikel“ neben „🃏 Einzelkarten“).
// Reine Regeln (ohne DB) – genutzt von POST /api/listings und im Browser (Formular, Filter, Anzeige).
// Bestehende Inserate haben listing_type = 'card' (Spalten-Standard) und bleiben unverändert.

export const LISTING_TYPES = ["card", "item"] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const ITEM_CATEGORIES: { id: string; label: string; icon: string }[] = [
  { id: "booster", label: "Booster & Displays", icon: "🎁" },
  { id: "etb", label: "ETBs & Kollektionen", icon: "📦" },
  { id: "zubehoer", label: "Ordner & Zubehör (Sleeves/Toploader)", icon: "📒" },
  { id: "pluesch", label: "Plüsch & Figuren", icon: "🧸" },
  { id: "lots", label: "Sammlungen / Lots", icon: "🗃️" },
  { id: "sonstiges", label: "Sonstiges", icon: "✨" },
];

/** Zusätzliche Kategorien aus dem Formular „📦 Sealed-Produkt verkaufen“ (Reiter „📦 Sealed & OVP“). */
export const SEALED_ITEM_CATEGORIES: { id: string; label: string; icon: string }[] = [
  { id: "display", label: "Booster Displays (36er / 18er)", icon: "📦" },
  { id: "tin", label: "Tins & Kollektionen", icon: "🥫" },
  { id: "blister", label: "Einzelne Booster & Blister", icon: "🃏" },
  { id: "vintage", label: "Vintage / Rare Sealed", icon: "🔒" },
];
const ALL_CATEGORIES = [...ITEM_CATEGORIES, ...SEALED_ITEM_CATEGORIES];

export const ITEM_CONDITIONS: { id: string; label: string; short: string }[] = [
  { id: "sealed", label: "Neu & OVP (Sealed)", short: "OVP" },
  { id: "like_new", label: "Wie neu", short: "Wie neu" },
  { id: "used", label: "Gebraucht", short: "Gebraucht" },
];

/** Höchstens so viele Fotos pro Artikel (1 Titelbild + 3 weitere). */
export const ITEM_MAX_PHOTOS = 4;

export const listingTypeOf = (l: { listing_type?: unknown; listingType?: unknown } | null | undefined): ListingType =>
  String(l?.listing_type ?? l?.listingType ?? "card") === "item" ? "item" : "card";

export const itemCategoryLabel = (id: unknown) => ALL_CATEGORIES.find((c) => c.id === String(id))?.label || "";
export const itemCategoryIcon = (id: unknown) => ALL_CATEGORIES.find((c) => c.id === String(id))?.icon || "📦";
export const itemConditionLabel = (id: unknown) => ITEM_CONDITIONS.find((c) => c.id === String(id))?.label || "";
export const itemConditionShort = (id: unknown) => ITEM_CONDITIONS.find((c) => c.id === String(id))?.short || "";

/**
 * Normalisiert die Artikel-Felder eines Inserats aus dem Formular.
 * Liefert `null` für Karten-Inserate (alles bleibt wie bisher) oder die bereinigten Artikel-Felder.
 */
export function normalizeItemFields(it: Record<string, any>): null | {
  listingType: "item"; itemCategory: string; itemCondition: string; description: string; condition: string; itemMeta: Record<string, unknown>;
} {
  if (String(it?.listingType ?? it?.listing_type ?? "") !== "item") return null;
  const cat = ALL_CATEGORIES.some((c) => c.id === String(it.itemCategory)) ? String(it.itemCategory) : "sonstiges";
  const cond = ITEM_CONDITIONS.some((c) => c.id === String(it.itemCondition)) ? String(it.itemCondition) : "used";
  const description = String(it.description ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 1000);
  // Bestehende Zustands-Spalte: OVP-Artikel zeigen überall das vorhandene „Sealed“-Badge
  // 📦 Sealed & OVP: Set, Factory Sealed, Mint Box, Übergabe (sonst leeres Objekt – bisherige Artikel bleiben unverändert)
  const itemMeta = normalizeSealedMeta(it.itemMeta, cat) || {};
  return { listingType: "item", itemCategory: cat, itemCondition: cond, description, condition: cond === "sealed" ? "sealed" : "", itemMeta };
}

/** Filter für die Marktplatz-Umschaltung „Alle | 🃏 Einzelkarten | 📦 Pokémon-Artikel“ (+ optionale Unterkategorie). */
export function filterByType<T extends Record<string, any>>(list: T[], type: string, category = ""): T[] {
  if (type !== "card" && type !== "item") return list;
  return list.filter((l) => listingTypeOf(l) === type && (type !== "item" || !category || String(l.item_category) === category));
}
