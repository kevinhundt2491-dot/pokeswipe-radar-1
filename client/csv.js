// CSV-Import: liest Exporte aus Cardmarket, Excel, Google Sheets oder anderen Sammler-Apps.
const ALIASES = {
  name: ["name", "karte", "kartenname", "card", "card name", "cardname", "product", "produkt", "product name", "pokemon", "pokémon"],
  number: ["number", "nummer", "nr", "nr.", "card number", "collector number", "kartennummer", "localid", "no", "no."],
  set: ["set", "expansion", "edition", "serie", "set name", "setname", "erweiterung"],
  quantity: ["quantity", "count", "anzahl", "menge", "qty", "amount", "stück", "stk"],
  purchasePrice: ["purchase price", "einkaufspreis", "kaufpreis", "ek", "paid", "price paid", "preis", "price", "einkauf"],
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

/** Wandelt CSV in Portfolio-Zeilen um: { name, number, set, quantity, purchasePrice }. */
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
      return { name: (m ? m[1] : raw).trim(), number: m ? m[2] : "", set: "", quantity: 1, purchasePrice: null };
    }
    const get = (k) => (col[k] !== undefined ? cells[col[k]] ?? "" : "");
    const qty = parseInt(get("quantity"), 10);
    return {
      name: get("name"),
      number: get("number").replace(/^#/, ""),
      set: get("set"),
      quantity: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 999) : 1,
      purchasePrice: toNumber(get("purchasePrice")),
    };
  }).filter((r) => r.name && r.name.length <= 120);
}
