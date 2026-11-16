// Phase 7: Händler-Bestands-Import – reine Logik (ohne Datenbank, in tests/seller-import.test.ts geprüft)
// Formate: Cardmarket-Bestandsexport („Stock“-CSV), TCGplayer-Inventar-Export und freie CSV mit Spaltennamen.
// Ergebnis je Zeile: normalisierte Angaben für die Katalog-Zuordnung (Name, Nummer, Set, Sprache, Variante,
// Zustand, Menge, Preis, SKU) oder eine Fehlermeldung.
import { createHash } from "node:crypto";

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 50_000;

export type ImportFormat = "cardmarket" | "tcgplayer" | "generic";
export type ImportRow = {
  rowNo: number;
  name: string;
  number: string; // lokale Nummer ohne führende Nullen, z. B. "4" oder "tg12"
  total: number | null; // Setgröße hinter dem Schrägstrich
  setName: string;
  setCode: string;
  lang: "de" | "en" | "ja";
  variant: "normal" | "reverse_holo" | "holo" | "first_edition" | "shadowless" | "promo";
  condition: "mint" | "nm" | "ex" | "gd" | "lp" | "pl" | "po";
  quantity: number;
  priceCents: number | null;
  sku: string;
};
export type ParsedImport = { format: ImportFormat; rows: ImportRow[]; errors: { rowNo: number; message: string; raw: Record<string, string> }[]; total: number };

/** CSV in Zeilen/Zellen (Anführungszeichen, ; , oder Tab als Trenner – wie client/csv.js). */
export function parseCsvTable(text: string): string[][] {
  const src = String(text || "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];
  const out: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) out.push(row.map((c) => c.trim()));
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) out.push(row.map((c) => c.trim()));
  return out;
}

const ALIASES: Record<string, string[]> = {
  sku: ["idarticle", "sku", "artikelnummer", "article id", "external id", "tcgplayer id", "id"],
  name: ["name", "english name", "product name", "karte", "kartenname", "card", "card name", "produkt", "title", "local name"],
  localName: ["local name", "lokaler name"],
  number: ["number", "nummer", "nr", "nr.", "card number", "collector number", "kartennummer", "localid", "no", "no."],
  setName: ["exp. name", "expansion", "set", "set name", "edition", "erweiterung", "expansion name", "serie"],
  setCode: ["exp.", "set code", "setcode", "kürzel", "code"],
  lang: ["language", "sprache", "lang"],
  condition: ["condition", "zustand", "cond"],
  variant: ["variant", "variante", "printing", "finish", "foil?", "isfoil", "foil", "is reverse holo", "reverse holo"],
  firstEd: ["first edition?", "1st edition", "first edition"],
  quantity: ["amount", "quantity", "anzahl", "menge", "qty", "add to quantity", "total quantity", "stock"],
  price: ["price", "preis", "tcg marketplace price", "verkaufspreis", "sell price", "listing price"],
};

/** Preis aus „12,50“, „12.50“, „1.234,50 €“, „1,234.50“, „$3.99“ → Cent (oder null). */
export function parsePriceCents(raw: unknown): number | null {
  let s = String(raw ?? "").replace(/[€$\s]|eur|usd/gi, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

const CONDITION_MAP: Record<string, ImportRow["condition"]> = {
  mt: "mint", m: "mint", mint: "mint", nm: "nm", "near mint": "nm", "nm-m": "nm", ex: "ex", excellent: "ex", "lightly played": "lp", lp: "lp",
  "light played": "lp", gd: "gd", good: "gd", "moderately played": "pl", mp: "pl", pl: "pl", played: "pl", "heavily played": "po", hp: "po",
  po: "po", poor: "po", damaged: "po", dmg: "po",
};
const LANG_MAP: Record<string, ImportRow["lang"]> = {
  de: "de", german: "de", deutsch: "de", en: "en", english: "en", englisch: "en", ja: "ja", jp: "ja", japanese: "ja", japanisch: "ja",
};
const yes = (v: string) => /^(1|x|yes|ja|true|y|foil)$/i.test(v.trim());

export function normalizeCondition(v: string): ImportRow["condition"] | null {
  const k = String(v || "").trim().toLowerCase();
  if (!k) return "nm";
  if (CONDITION_MAP[k]) return CONDITION_MAP[k];
  // TCGplayer: „Near Mint Holofoil“, „Lightly Played Reverse Holofoil“
  for (const [word, c] of Object.entries(CONDITION_MAP)) if (word.length > 3 && k.startsWith(word)) return c;
  return null;
}

export function normalizeVariant(v: string, header: string, extra: { firstEd?: string; condition?: string; name?: string } = {}): ImportRow["variant"] {
  if (extra.firstEd && yes(extra.firstEd)) return "first_edition";
  const all = `${v} ${extra.condition || ""}`;
  // Cardmarket „Foil?“ = Reverse Holo bei Pokémon (Holo-Seltenheiten sind dort nicht als Foil markiert)
  if (/foil\?|isfoil|is reverse holo|reverse holo/i.test(header) && yes(v)) return "reverse_holo";
  if (/reverse/i.test(all)) return "reverse_holo";
  if (/1st|first edition/i.test(all)) return "first_edition";
  if (/shadowless/i.test(all)) return "shadowless";
  if (/promo/i.test(v)) return "promo";
  if (/holo|foil/i.test(v) && !/non/i.test(v)) return "holo";
  if (extra.name && /\(reverse/i.test(extra.name)) return "reverse_holo";
  return "normal";
}

/** Nummer „004/102“, „#4“, „TG12/TG30“ → { number: "4" | "tg12", total }. */
export function splitNumber(raw: string): { number: string; total: number | null } {
  const s = String(raw || "").trim().replace(/^#/, "");
  const m = /^0*([a-z]{0,3}\d{1,4}[a-z]?)\s*(?:\/\s*[a-z]{0,3}0*(\d{1,4}))?$/i.exec(s);
  if (!m) return { number: "", total: null };
  return { number: m[1].toLowerCase().replace(/^([a-z]*)0+(\d)/, "$1$2"), total: m[2] ? Number(m[2]) : null };
}

export function detectFormat(header: string[]): ImportFormat {
  const h = header.map((x) => x.toLowerCase());
  if (h.includes("idarticle") || (h.includes("exp.") && h.includes("amount"))) return "cardmarket";
  if (h.includes("tcgplayer id") || h.includes("tcg marketplace price") || h.includes("add to quantity")) return "tcgplayer";
  return "generic";
}

/** Stabile SKU, falls die Datei keine Artikelnummer liefert (gleiche Karte + Zustand + Variante → gleiches Inserat). */
export function syntheticSku(r: Pick<ImportRow, "name" | "number" | "setName" | "setCode" | "lang" | "variant" | "condition">): string {
  const key = [r.name.toLowerCase(), r.number, r.setCode.toLowerCase(), r.setName.toLowerCase(), r.lang, r.variant, r.condition].join("|");
  return `auto-${createHash("sha1").update(key).digest("hex").slice(0, 20)}`;
}

/** Zerlegt eine Import-Datei vollständig (ohne Katalog-Zuordnung). */
export function parseImport(text: string, defaultLang: ImportRow["lang"] = "de"): ParsedImport {
  const table = parseCsvTable(text);
  if (table.length < 2) return { format: "generic", rows: [], errors: [], total: 0 };
  const header = table[0].map((h) => h.toLowerCase().replace(/["']/g, "").trim());
  const format = detectFormat(header);
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  // Cardmarket: „Name“ fehlt teils – dann „English Name“; „Local Name“ nur als Ersatz
  if (col.name === undefined && col.localName !== undefined) col.name = col.localName;
  const rows: ImportRow[] = [];
  const errors: ParsedImport["errors"] = [];
  const body = table.slice(1, IMPORT_MAX_ROWS + 1);
  body.forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (k: string) => (col[k] !== undefined ? String(cells[col[k]] ?? "").trim() : "");
    const raw: Record<string, string> = {};
    header.forEach((h, j) => { if (h && cells[j]) raw[h] = String(cells[j]).slice(0, 200); });
    const name = get("name").replace(/\s+/g, " ").slice(0, 120);
    if (!name) { errors.push({ rowNo, message: "Kartenname fehlt.", raw }); return; }
    const conditionRaw = get("condition");
    const condition = normalizeCondition(conditionRaw);
    if (!condition) { errors.push({ rowNo, message: `Unbekannter Zustand „${conditionRaw}“.`, raw }); return; }
    const langRaw = get("lang").toLowerCase();
    const lang = langRaw ? LANG_MAP[langRaw] : defaultLang;
    if (!lang) { errors.push({ rowNo, message: `Sprache „${get("lang")}“ wird nicht unterstützt (nur Deutsch, Englisch, Japanisch).`, raw }); return; }
    const qtyRaw = get("quantity");
    const quantity = qtyRaw === "" ? 1 : Number.parseInt(qtyRaw, 10);
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 10_000) { errors.push({ rowNo, message: `Ungültige Menge „${qtyRaw}“.`, raw }); return; }
    const priceRaw = get("price");
    const priceCents = priceRaw ? parsePriceCents(priceRaw) : null;
    if (priceRaw && priceCents === null) { errors.push({ rowNo, message: `Ungültiger Preis „${priceRaw}“.`, raw }); return; }
    const { number, total } = splitNumber(get("number"));
    const variant = normalizeVariant(get("variant"), col.variant !== undefined ? header[col.variant] : "", { firstEd: get("firstEd"), condition: format === "tcgplayer" ? conditionRaw : "", name });
    const base = { name, number, total, setName: get("setName").slice(0, 120), setCode: get("setCode").toUpperCase().slice(0, 20), lang, variant, condition };
    const sku = (get("sku").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60)) || syntheticSku(base);
    rows.push({ rowNo, ...base, quantity, priceCents, sku: format === "cardmarket" && get("sku") ? `cm-${sku}` : sku });
  });
  return { format, rows, errors, total: body.length };
}

export type PriceOptions = { mode: "file" | "trend"; factor: number; minCents: number };

/** Preis einer Zeile: aus der Datei oder Marktpreis × Faktor (mindestens minCents); null = kein Preis bestimmbar. */
export function importPrice(row: Pick<ImportRow, "priceCents">, marketEur: number | null, o: PriceOptions): number | null {
  if (o.mode === "trend" && marketEur && marketEur > 0) {
    return Math.max(o.minCents, Math.round(marketEur * 100 * o.factor));
  }
  return row.priceCents && row.priceCents > 0 ? row.priceCents : null;
}

export function cleanImportOptions(b: Record<string, any>): { buyNow: boolean; shippingCents: number; price: PriceOptions; city: string; removeMissing: boolean; defaultLang: ImportRow["lang"] } {
  const factor = Number(String(b.factor ?? "1").replace(",", "."));
  const minCents = Math.round(Number(String(b.minPrice ?? "0.1").replace(",", ".")) * 100);
  const ship = Math.round(Number(String(b.shipping ?? "0").replace(",", ".")) * 100);
  return {
    buyNow: b.buyNow === true,
    shippingCents: Number.isFinite(ship) ? Math.min(2500, Math.max(0, ship)) : 0,
    price: {
      mode: b.priceMode === "trend" ? "trend" : "file",
      factor: Number.isFinite(factor) ? Math.min(3, Math.max(0.3, factor)) : 1,
      minCents: Number.isFinite(minCents) ? Math.min(100_000, Math.max(10, minCents)) : 10,
    },
    city: String(b.city ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60),
    removeMissing: b.removeMissing === true,
    defaultLang: (["de", "en", "ja"].includes(b.defaultLang) ? b.defaultLang : "de") as ImportRow["lang"],
  };
}
