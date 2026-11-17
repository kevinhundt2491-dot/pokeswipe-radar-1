// PokeSwipe & Radar – „Verkaufen“ von überall: Sammlung, Kartendetails und Swipe-Radar öffnen dasselbe
// Schnell-Inserieren wie der Scanner (fairer Preis schon eingetragen, Etikett, Swipe-Vorschau, 1-Tap mit Countdown).
// Dadurch sind es von jeder Karte aus höchstens zwei Tipps bis zum fertigen Inserat.
import { state, api, toast, requireLogin } from "./core.js";

const PORTFOLIO_COND = { M: "mint", NM: "nm", EX: "ex", GD: "gd", LP: "lp", PL: "pl", PO: "po" };

/** Portfolio-Eintrag → Treffer-Format des Schnell-Inserierens (mit Verknüpfung zum Sammlungs-Eintrag). */
export function infoFromPortfolio(i) {
  if (!i) return null;
  const print = i.printId && i.lang && i.lang !== "de";
  const id = print ? i.printId : i.cardId;
  if (!id) return null;
  return {
    key: `${print ? "print" : "card"}:${id}`, kind: print ? "print" : "card", id, lang: i.lang || "de",
    name: i.name, number: "", setName: i.setName || "", image: i.image || "",
    price: Number(i.unitValue) || null,
    condition: PORTFOLIO_COND[String(i.condition || "").toUpperCase()] || "",
    variant: i.variant || "normal", portfolioItemId: Number(i.id) || null, source: "portfolio",
  };
}

/** Karte aus dem Swipe-Stapel (Katalogkarte) → Treffer-Format. */
export function infoFromDeck(item) {
  if (!item || item.kind === "listing") return null;
  const print = item.lang !== "de" && item.printId;
  const id = print ? item.printId : item.cardId || (item.lang === "de" ? item.id : null);
  if (!id) return null;
  return {
    key: `${print ? "print" : "card"}:${id}`, kind: print ? "print" : "card", id, lang: item.lang || "de",
    name: String(item.title || "").replace(/\s*\([^)]*\)\s*$/, ""), number: "", setName: item.setTag || "",
    image: item.img || "", price: Number(item.cm) || null, variant: item.variant || "normal", source: "catalog",
  };
}

/** Offene Inserate des Nutzers (für „✅ Inseriert“-Hinweise in der Sammlung). */
export async function loadMyListings() {
  if (!state.user) { state.myListings = []; return []; }
  try {
    const { listings } = await api("/api/listings?mine=1");
    state.myListings = (listings || []).filter((l) => l.status === "active");
  } catch { state.myListings = state.myListings || []; }
  window.dispatchEvent(new CustomEvent("ps:my-listings"));
  return state.myListings;
}

/** Aktives eigenes Inserat zu einem Portfolio-Eintrag (direkt verknüpft oder gleiche Karte/Variante). */
export function activeListingFor(i) {
  const list = state.myListings || [];
  return list.find((l) => Number(l.portfolio_item_id) === Number(i.id))
    || list.find((l) => !l.portfolio_item_id && (i.printId && i.lang !== "de" ? l.print_id === i.printId : l.card_id && l.card_id === i.cardId) && (l.variant || "normal") === (i.variant || "normal"))
    || null;
}

function open(infos, instant) {
  if (!requireLogin()) return;
  const list = infos.filter(Boolean);
  if (!list.length) { toast("Nicht möglich", "Für diese Karte fehlt die Katalog-Verknüpfung – bitte über die Kartensuche inserieren."); return; }
  window.PS?.liveScanQuickList?.(list, { instant: Boolean(instant) });
}

export const sellApi = {
  loadMyListings,
  /** Ein Portfolio-Eintrag: mode "instant" = 1-Tap mit Countdown */
  sellPortfolioItem: (id, mode = "") => {
    const i = state.portfolio?.items?.find((x) => Number(x.id) === Number(id));
    open([infoFromPortfolio(i)], mode === "instant");
  },
  /** Mehrere Portfolio-Einträge auf einmal (Auswahl in der Sammlung) */
  sellPortfolioItems: (ids, mode = "") => {
    const set = new Set((ids || []).map(Number));
    const items = (state.portfolio?.items || []).filter((x) => set.has(Number(x.id)));
    open(items.map(infoFromPortfolio), mode === "instant");
  },
  /** Kartendetails: deutsche Katalogkarte */
  sellCatalogCard: (cardId, name, price, image, setName, mode = "") => open([{
    key: `card:${cardId}`, kind: "card", id: cardId, lang: "de", name, number: "", setName: setName || "", image: image || "",
    price: Number(price) || null, source: "catalog",
  }], mode === "instant"),
  /** Englischer/japanischer Druck (Detailansicht im Swipe-Radar) */
  sellPrint: (printId, lang, name, price, image, setName, mode = "") => open([{
    key: `print:${printId}`, kind: "print", id: printId, lang: lang || "en", name, number: "", setName: setName || "", image: image || "",
    price: Number(price) || null, source: "catalog",
  }], mode === "instant"),
  /** Swipe-Radar: „Hab ich – verkaufen“ für die aktuelle Katalogkarte */
  sellSwipeCard: (mode = "") => open([infoFromDeck(window.currentSwipeItem?.())], mode === "instant"),
};
