// Varianten-Ebene (Phase 6): eine Karte existiert als Normal, Reverse Holo, Holo, 1st Edition, Shadowless oder Promo.
// Reine Logik ohne Datenbank – genutzt von Portfolio, Inseraten, Wunschliste, CSV-Import, Tausch und Kartenseiten.
//
// Preisquellen je Variante:
// • Cardmarket über TCGdex liefert je Produkt zwei Preisreihen: die normale (trend/avg/low …) und die
//   „*-holo“-Reihe. Hat eine Karte eine normale UND eine Reverse-Ausführung, ist „*-holo“ der Reverse-Holo-Preis.
//   Gibt es nur eine Holo-Ausführung, steht deren Preis in der Basisreihe (bzw. „*-holo“ als Ersatz).
// • TCGplayer (über TCGdex, USD → EUR) liefert für englische Drucke getrennte Varianten
//   (normal, holofoil, reverseHolofoil, 1stEditionHolofoil, 1stEditionNormal, unlimitedHolofoil …).
// • Zustand: Cardmarket-Trend entspricht dem Preis gut erhaltener Karten (Near Mint). Für schlechtere Zustände
//   wird ein marktüblicher Referenzabschlag angewendet und als „Referenz“ gekennzeichnet.

export const VARIANTS = ["normal", "reverse_holo", "holo", "first_edition", "shadowless", "promo"] as const;
export type Variant = (typeof VARIANTS)[number];

export const VARIANT_LABELS: Record<Variant, string> = {
  normal: "Normal",
  reverse_holo: "Reverse Holo",
  holo: "Holo",
  first_edition: "1st Edition",
  shadowless: "Shadowless",
  promo: "Promo",
};

/** Zustände wie bei Cardmarket (plus PSA-Kurzformen aus älteren Einträgen). */
export const CONDITION_CODES = ["M", "NM", "EX", "GD", "LP", "PL", "PO", "PSA10", "PSA9"] as const;
export type ConditionCode = (typeof CONDITION_CODES)[number];

/**
 * Referenz-Faktor je Zustand relativ zum Near-Mint-Trend.
 * Grundlage: übliche Preisabstände bei Cardmarket-Einzelkarten (Excellent ≈ 80–90 %, Good ≈ 65–75 %,
 * Light Played ≈ 55–65 %, Played ≈ 40–50 %, Poor ≈ 25–35 % des NM-Preises). Gradierte Karten (PSA)
 * werden im Graded-Portfolio mit echten Verkaufswerten geführt – hier gilt der Rohkartenwert.
 */
export const CONDITION_FACTORS: Record<ConditionCode, number> = {
  M: 1, NM: 1, EX: 0.85, GD: 0.7, LP: 0.6, PL: 0.45, PO: 0.3, PSA10: 1, PSA9: 1,
};

const VARIANT_ALIASES: Array<[RegExp, Variant]> = [
  [/^(rh|rev|reverse([ _-]?holo(foil)?)?|reverseholofoil|reverse_holo)$/, "reverse_holo"],
  [/^(1st|1(st)?[ _-]?ed(ition)?|first[ _-]?edition|firstedition|1stedition(holofoil|normal)?|erstauflage|1\.?[ _-]?auflage)$/, "first_edition"],
  [/^(shadowless|ohne[ _-]?schatten)$/, "shadowless"],
  [/^(promo|promos|black[ _-]?star)$/, "promo"],
  [/^(holo|holofoil|holo[ _-]?rare|unlimitedholofoil|wholo)$/, "holo"],
  [/^(normal|non[ _-]?holo|nonholo|unlimited|standard|regular)$/, "normal"],
];

/** Wandelt Eingaben (API, CSV, Altdaten) in eine gültige Variante; unbekannt → fallback. */
export function normalizeVariant(input: unknown, fallback: Variant = "normal"): Variant {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if ((VARIANTS as readonly string[]).includes(raw)) return raw as Variant;
  const compact = raw.replace(/\s+/g, " ");
  for (const [re, v] of VARIANT_ALIASES) if (re.test(compact)) return v;
  return fallback;
}

/** Strikte Prüfung für API-Eingaben: null, wenn die Angabe gesetzt, aber unbekannt ist. */
export function parseVariant(input: unknown): Variant | null {
  if (input === undefined || input === null || input === "") return "normal";
  const v = normalizeVariant(input, "normal");
  const raw = String(input).trim().toLowerCase();
  if (v === "normal" && !/^(normal|non[ _-]?holo|nonholo|unlimited|standard|regular)$/.test(raw)) return null;
  return v;
}

export function normalizeCondition(input: unknown): ConditionCode {
  const raw = String(input ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const map: Record<string, ConditionCode> = {
    MINT: "M", NEARMINT: "NM", "NM-M": "NM", EXCELLENT: "EX", GOOD: "GD", LIGHTPLAYED: "LP", PLAYED: "PL", POOR: "PO",
    "PSA 10": "PSA10", "PSA 9": "PSA9",
  };
  if ((CONDITION_CODES as readonly string[]).includes(raw)) return raw as ConditionCode;
  return map[raw] ?? "NM";
}

/** Welche Varianten laut TCGdex existieren (cards.variants: "normal,reverse,holo,firstEdition"). */
export function availableVariants(variantsField: string | null | undefined): Variant[] {
  const parts = String(variantsField ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const out = new Set<Variant>();
  for (const p of parts) {
    if (p === "normal") out.add("normal");
    else if (p === "reverse") out.add("reverse_holo");
    else if (p === "holo") out.add("holo");
    else if (p === "firstEdition") out.add("first_edition");
    else if (p === "wPromo") out.add("promo");
  }
  return VARIANTS.filter((v) => out.has(v));
}

export type CardmarketPricing = Record<string, unknown> | null | undefined;
const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

/**
 * Teilt die Cardmarket-Preise einer Karte in Basis- und Reverse-Holo-Reihe.
 * hasNormal/hasReverse stammen aus den TCGdex-Varianten; ohne Angabe wird aus den Daten geschlossen.
 */
export function splitCardmarketPricing(cm: CardmarketPricing, variants?: { normal?: boolean; reverse?: boolean; holo?: boolean }) {
  const p = (cm && typeof cm === "object" ? cm : {}) as Record<string, unknown>;
  const base = { trend: pos(p.trend), avg: pos(p.avg), low: pos(p.low), avg7: pos(p.avg7), avg30: pos(p.avg30) };
  const holo = { trend: pos(p["trend-holo"]), avg: pos(p["avg-holo"]), low: pos(p["low-holo"]), avg7: pos(p["avg7-holo"]), avg30: pos(p["avg30-holo"]) };
  const baseMissing = !base.trend && !base.avg && !base.low;
  const holoPresent = Boolean(holo.trend || holo.avg || holo.low);
  // Reine Holo-Karten (keine normale Ausführung): *-holo ist der eigentliche Kartenpreis, kein Reverse-Preis
  const holoOnly = variants ? Boolean(variants.holo && !variants.normal && !variants.reverse) : false;
  const isReverse = holoPresent && !baseMissing && !holoOnly && (variants ? variants.reverse !== false : true);
  const merged = {
    trend: base.trend ?? holo.trend, avg: base.avg ?? holo.avg, low: base.low ?? holo.low,
    avg7: base.avg7 ?? holo.avg7, avg30: base.avg30 ?? holo.avg30,
  };
  return {
    base: merged,
    reverse: isReverse ? holo : { trend: null, avg: null, low: null, avg7: null, avg30: null },
  };
}

/** TCGplayer-Varianten (USD) → Preise je Variante in EUR. */
export function tcgplayerVariantPrices(tp: unknown, usdPerEur: number | null | undefined) {
  const out: Partial<Record<Variant, { price: number; low: number | null }>> = {};
  if (!tp || typeof tp !== "object" || !usdPerEur || !(usdPerEur > 0)) return out;
  const conv = (usd: number | null) => (usd ? Math.round((usd / usdPerEur) * 100) / 100 : null);
  for (const [key, v] of Object.entries(tp as Record<string, any>)) {
    if (!v || typeof v !== "object" || key === "unit" || key === "updated") continue;
    const market = pos(v.marketPrice) ?? pos(v.midPrice);
    if (!market) continue;
    const k = key.toLowerCase();
    let variant: Variant;
    if (k.includes("1stedition") || k.includes("1st-edition") || k.includes("firstedition")) variant = "first_edition";
    else if (k.includes("reverse")) variant = "reverse_holo";
    else if (k.includes("holo")) variant = "holo";
    else variant = "normal";
    const price = conv(market)!;
    const prev = out[variant];
    if (!prev || price > prev.price) out[variant] = { price, low: conv(pos(v.lowPrice)) };
  }
  return out;
}

export type PriceRow = {
  trend?: string | number | null; avg?: string | number | null; low?: string | number | null;
  reverseTrend?: string | number | null; reverseAvg?: string | number | null; reverseLow?: string | number | null;
};
export type VariantPrices = Partial<Record<Variant, { price?: number | null; low?: number | null }>> | null | undefined;

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/**
 * Marktwert einer Variante (pro Stück, NM). exact = es gibt einen eigenen Preis für genau diese Variante.
 * Ohne eigenen Preis gilt der Basispreis (exact = false) – die Oberfläche zeigt dann „Basispreis“.
 */
export function variantPrice(card: PriceRow | null | undefined, variant: Variant, printPrices?: VariantPrices) {
  const base = card ? n(card.trend) || n(card.avg) || n(card.low) : 0;
  const fromPrint = printPrices?.[variant]?.price ? n(printPrices[variant]!.price) : 0;
  if (variant === "reverse_holo") {
    const rev = card ? n(card.reverseTrend) || n(card.reverseAvg) || n(card.reverseLow) : 0;
    if (rev) return { price: rev, exact: true, source: "cardmarket" as const };
    if (fromPrint) return { price: fromPrint, exact: true, source: "tcgplayer" as const };
    return { price: base, exact: false, source: base ? ("cardmarket" as const) : ("none" as const) };
  }
  if (variant === "first_edition" || variant === "shadowless" || variant === "holo") {
    if (fromPrint) return { price: fromPrint, exact: true, source: "tcgplayer" as const };
    return { price: base, exact: variant === "holo" && base > 0, source: base ? ("cardmarket" as const) : ("none" as const) };
  }
  return { price: base, exact: base > 0, source: base ? ("cardmarket" as const) : ("none" as const) };
}

/** Stückwert inkl. Zustand: Variante × Zustandsfaktor; ohne Marktpreis zählt der manuelle Wert. */
export function itemUnitValue(
  card: PriceRow | null | undefined,
  item: { variant?: string | null; condition?: string | null; manualValue?: string | number | null },
  printPrices?: VariantPrices,
) {
  const variant = normalizeVariant(item.variant);
  const condition = normalizeCondition(item.condition);
  const vp = variantPrice(card, variant, printPrices);
  const factor = CONDITION_FACTORS[condition];
  if (vp.price > 0) {
    return { unit: Math.round(vp.price * factor * 100) / 100, live: true, exactVariant: vp.exact, conditionFactor: factor, variant, condition };
  }
  return { unit: n(item.manualValue), live: false, exactVariant: false, conditionFactor: factor, variant, condition };
}

/** SQL-Ausdruck (Postgres) für denselben Stückwert – für Tages-Snapshots ohne Datenzeilen im Speicher. */
export const CONDITION_FACTOR_SQL = `CASE p.condition WHEN 'EX' THEN 0.85 WHEN 'GD' THEN 0.7 WHEN 'LP' THEN 0.6 WHEN 'PL' THEN 0.45 WHEN 'PO' THEN 0.3 ELSE 1 END`;

/**
 * Variantenpreise eines Drucks (für card_prints.variant_prices): TCGplayer-Varianten in EUR,
 * ergänzt um die Cardmarket-Reverse-Holo-Reihe, falls TCGplayer keine Reverse-Ausführung führt.
 */
export function printVariantPrices(pricing: any, usdPerEur: number | null | undefined) {
  const out: Partial<Record<Variant, { price: number; low: number | null }>> = tcgplayerVariantPrices(pricing?.tcgplayer, usdPerEur);
  const split = splitCardmarketPricing(pricing?.cardmarket);
  if (!out.reverse_holo && split.reverse.trend) out.reverse_holo = { price: split.reverse.trend, low: split.reverse.low };
  return Object.keys(out).length ? out : null;
}
