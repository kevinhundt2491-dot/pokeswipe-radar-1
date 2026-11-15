// CSV-Import: liest Exporte aus Cardmarket, Excel, Google Sheets oder anderen Sammler-Apps.
const ALIASES = {
  name: ["name", "karte", "kartenname", "card", "card name", "cardname", "product", "produkt", "product name", "pokemon", "pokémon", "card title", "item name"],
  number: ["number", "nummer", "nr", "nr.", "card number", "collector number", "kartennummer", "localid", "no", "no.", "card #", "card no", "number in set"],
  set: ["set", "expansion", "edition", "serie", "set name", "setname", "erweiterung", "expansion name", "group", "series"],
  quantity: ["quantity", "count", "anzahl", "menge", "qty", "amount", "stück", "stk", "quantity owned", "owned", "total quantity"],
  variant: ["variant", "variante", "version", "finish", "printing", "foil", "edition type", "ausführung", "reverse holo", "is reverse holo"],
  condition: ["condition", "zustand", "cond", "card condition", "grade condition"],
  lang: ["language", "sprache", "lang"],
  purchasePrice: ["purchase price", "einkaufspreis", "kaufpreis", "ek", "paid", "price paid", "preis", "price", "einkauf", "average cost paid", "avg cost paid", "average cost", "cost", "cost basis", "purchase cost", "buy price"],
};

/** Zerlegt CSV-Text in Zeilen und Zellen (mit Anführungszeichen, ; , oder Tab als Trenner). */
export function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const count = (ch) => firstLine.split(ch).length - 1;
  const delim = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];
  const out = [];
  let row = [], cell = "", quoted = false;
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

const toNumber = (v) => {
  const s = String(v ?? "").replace(/[€\s]/g, "");
  if (!s) return null;
  const n = parseFloat(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const VARIANT_WORDS = [
  [/reverse|rev\.?\s*holo|\brh\b/i, "reverse_holo"], [/1st|first edition|erstauflage|1\.\s*auflage/i, "first_edition"],
  [/shadowless/i, "shadowless"], [/promo/i, "promo"], [/holo|foil/i, "holo"],
];
/** Variante aus einer Zelle („Reverse Holofoil“, „1st Edition“, „Foil“, „yes“ bei „Is Reverse Holo“) oder dem Kartennamen. */
export function detectVariant(cell, header = "", name = "") {
  const v = String(cell || "").trim();
  if (/reverse/i.test(header) && /^(1|yes|ja|true|x)$/i.test(v)) return "reverse_holo";
  for (const [re, key] of VARIANT_WORDS) if (re.test(v)) return key;
  if (/^(normal|non[- ]?holo|unlimited|standard|regular|no|nein|0|false)?$/i.test(v)) {
    // Varianten-Hinweis im Namen, z. B. „Glurak (Reverse Holo)“
    for (const [re, key] of VARIANT_WORDS.slice(0, 4)) if (re.test(name)) return key;
    return "normal";
  }
  return "normal";
}
const CONDITION_WORDS = { m: "M", mt: "M", mint: "M", nm: "NM", "near mint": "NM", "nm-m": "NM", ex: "EX", excellent: "EX", gd: "GD", good: "GD",
  lp: "LP", "light played": "LP", "lightly played": "LP", pl: "PL", played: "PL", mp: "PL", "moderately played": "PL", hp: "PO", "heavily played": "PO", po: "PO", poor: "PO", damaged: "PO", dmg: "PO" };
export const detectCondition = (cell) => CONDITION_WORDS[String(cell || "").trim().toLowerCase()] || "NM";
const LANG_WORDS = { de: "de", german: "de", deutsch: "de", en: "en", english: "en", englisch: "en", ja: "ja", jp: "ja", japanese: "ja", japanisch: "ja" };

/** Wandelt CSV in Portfolio-Zeilen um: { name, number, set, quantity, purchasePrice, variant, condition, lang }. */
export function csvToRows(text) {
  const table = parseCsv(text);
  if (!table.length) return [];
  const header = table[0].map((h) => h.toLowerCase().replace(/["']/g, "").trim());
  const col = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const hasHeader = col.name !== undefined;
  const body = hasHeader ? table.slice(1) : table;
  return body.map((cells) => {
    if (!hasHeader) {
      // Einfache Liste: "Glurak ex 199/165" oder "Pikachu;25"
      const raw = cells.join(" ").trim();
      const m = /^(.*?)[\s#]+(\d{1,3}[a-z]?(?:\/\d{1,3})?)$/i.exec(raw);
      const name = (m ? m[1] : raw).trim();
      return { name, number: m ? m[2] : "", set: "", quantity: 1, purchasePrice: null, variant: detectVariant("", "", name), condition: "NM", lang: "de" };
    }
    const get = (k) => (col[k] !== undefined ? cells[col[k]] ?? "" : "");
    const qty = parseInt(get("quantity"), 10);
    return {
      name: get("name"),
      number: get("number").replace(/^#/, ""),
      set: get("set"),
      quantity: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 999) : 1,
      purchasePrice: toNumber(get("purchasePrice")),
      variant: detectVariant(get("variant"), col.variant !== undefined ? header[col.variant] : "", get("name")),
      condition: detectCondition(get("condition")),
      lang: LANG_WORDS[String(get("lang")).trim().toLowerCase()] || "de",
    };
  }).filter((r) => r.name && r.name.length <= 120);
}
