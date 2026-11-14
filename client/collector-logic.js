// Reine Sammler-Logik ohne DOM – genutzt vom Set-Tracker/Duplikat-Radar und in tests/ geprüft.

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Fortschritt eines Sets aus Kartenliste mit { qty, price }. */
export function setStats(cards) {
  const list = Array.isArray(cards) ? cards : [];
  let owned = 0, ownedValue = 0, missingCost = 0, missingUnpriced = 0, surplus = 0, surplusValue = 0;
  const missing = [];
  for (const c of list) {
    const qty = Math.max(0, Number(c.qty) || 0);
    const price = Math.max(0, Number(c.price) || 0);
    if (qty > 0) {
      owned++;
      ownedValue += price * qty;
      if (qty > 1) { surplus += qty - 1; surplusValue += price * (qty - 1); }
    } else {
      missing.push(c);
      if (price) missingCost += price; else missingUnpriced++;
    }
  }
  const total = list.length;
  return {
    total, owned, missingCount: missing.length, missing,
    percent: total ? Math.floor((owned / total) * 100) : 0,
    ownedValue: round2(ownedValue), missingCost: round2(missingCost), missingUnpriced,
    surplus, surplusValue: round2(surplusValue),
  };
}

/** Name im Cardmarket-Stil („Pikachu ex“ statt „Pikachu-ex“). */
export const cmName = (name) => String(name || "").replace(/-(ex|EX|GX|V|VMAX|VSTAR)\b/g, " $1").replace(/\s+/g, " ").trim();

/** Eine Zeile für die Cardmarket-Wants-Liste, z. B. „1x Pikachu ex (SSP 238)“. */
export function wantsLine(card, set = {}, qty = 1) {
  const name = cmName(card.en || card.enName || card.name);
  const code = String(set.abbr || card.abbr || "").trim();
  const ref = [code || String(set.enName || card.enSetName || "").trim(), String(card.localId || "").trim()].filter(Boolean).join(" ");
  return `${Math.max(1, qty)}x ${name}${ref ? ` (${ref})` : ""}`;
}

export function wantsText(missing, set = {}) {
  return (missing || []).map((c) => wantsLine(c, set, 1)).join("\n");
}

/** Gruppiert Portfolio-Einträge nach Karte und liefert alle mit Anzahl >= 2 (Überschuss = Anzahl − 1). */
export function groupDuplicates(items) {
  const map = new Map();
  for (const i of items || []) {
    if (!i?.cardId) continue;
    const g = map.get(i.cardId) || { cardId: i.cardId, name: i.name, image: i.image, setName: i.setName || "", qty: 0, unit: 0 };
    g.qty += Math.max(0, Number(i.quantity) || 0);
    g.unit = Math.max(g.unit, Number(i.unitValue) || 0);
    map.set(i.cardId, g);
  }
  return [...map.values()].filter((g) => g.qty >= 2)
    .map((g) => ({ ...g, surplus: g.qty - 1, surplusValue: round2(g.unit * (g.qty - 1)) }))
    .sort((a, b) => b.surplusValue - a.surplusValue);
}

export const surplusBadge = (d, eur) => `${d.surplus}x Überschuss – Verkaufswert: ${eur(d.surplusValue)}`;

/** Text für den Cardmarket-Verkaufs-Assistenten (Zwischenablage). */
export function sellText(d, eur) {
  const ref = [d.abbr, d.localId].filter(Boolean).join(" ");
  return [
    `${cmName(d.enName || d.name)}${ref ? ` (${ref})` : ""}`,
    `Anzahl: ${d.surplus}`,
    `Zustand: Near Mint (NM)`,
    `Sprache: Deutsch`,
    `Empfohlener Preis (Cardmarket-Trend): ${d.unit ? eur(d.unit) : "bitte prüfen"}`,
  ].join("\n");
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV aller Überschuss-Karten für den Cardmarket-Bestands-Import (Semikolon, UTF-8).
 * Spalten wie im Cardmarket-Bestandsexport: idProduct ist der eindeutige Produkt-Schlüssel.
 */
export function cardmarketCsv(dups, { language = "German", condition = "NM" } = {}) {
  const head = ["idProduct", "Count", "English Name", "Local Name", "Exp.", "Exp. Name", "Collector Number", "Language", "Condition", "Reverse Holo?", "Signed?", "First Edition?", "Price", "Comment"];
  const lines = (dups || []).filter((d) => d.surplus > 0).map((d) => [
    d.idProduct ?? "", d.surplus, cmName(d.enName || d.name), d.name, d.abbr || "", d.enSetName || d.setName || "", d.localId || "",
    language, condition, "", "", "", d.unit ? Number(d.unit).toFixed(2) : "", "via PokeSwipe Radar",
  ].map(csvCell).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
}

/** eBay-Suchbegriff für eine Set-Karte, z. B. „Pikachu ex 238/191“. */
export function ebayQuery(card, set = {}) {
  const name = cmName(card.name);
  const num = String(card.localId || "");
  return /^\d+$/.test(num) && set.official ? `${name} ${num}/${set.official}` : `${name} ${num}`.trim();
}
