// Reine Logik (ohne Datenbank) für doppelte Karten im Set-Binder und das schnelle Inserieren:
//   • Scan → Sammlung: gleiche Karte (Karte/Druck + Variante + Zustand) wird hochgezählt statt doppelt angelegt
//   • Gesamtwert-Umschalter „Doppelte im Gesamtwert mitzählen“ (An = alle Exemplare, Aus = jede Karte 1×)
//   • „Alle Doppelten inserieren“: je Karte 1 Exemplar behalten, bereits inserierte Doppelte nicht erneut einstellen
//   • Kartenauswahl beim Inserieren: Suche (Name, Sammlernummer, Set) + Filter-Chips „Alle“ | „Nur Doppelte“ | „Nach Set“
// Wird von Server (server/app.ts) und Browser (client/scanner/live-scanner.js, client/binder.js, client/dupes.js) genutzt;
// geprüft in tests/duplicates.test.ts.

/** Gespeicherte Nutzer-Einstellung für den Gesamtwert-Umschalter (Standard: An). */
export const COUNT_DUPES_KEY = "ps_binder_count_dupes";
/** Höchstens so viele Inserate pro POST /api/listings (Server-Grenze). */
export const LISTING_BATCH = 20;

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Gespeicherten Umschalter-Wert lesen: alles außer „0“/„off“/„false“ bedeutet An. */
export function readCountDupes(raw: string | null | undefined): boolean {
  return !/^(0|off|false|no)$/i.test(String(raw ?? "").trim());
}

// ---------------------------------------------------------------------------
// Scan → Sammlung: Duplikate hochzählen
// ---------------------------------------------------------------------------
export type MergeItem = { id?: number; cardId?: string | null; printId?: string | null; variant?: string | null; condition?: string | null; quantity?: number };

/** Schlüssel, unter dem zwei Sammlungs-Einträge dasselbe Exemplar sind (Karte bzw. Druck + Variante + Zustand). */
export function mergeKey(i: MergeItem): string {
  const card = i.printId ? `print:${i.printId}` : i.cardId ? `card:${i.cardId}` : "";
  if (!card) return "";
  return `${card}|${String(i.variant || "normal").toLowerCase()}|${String(i.condition || "NM").toUpperCase()}`;
}

/** Vorhandenen Eintrag für eine neu gescannte Karte finden (→ Anzahl erhöhen statt neuen Slot anlegen). */
export function findMergeTarget<T extends MergeItem>(existing: T[], incoming: MergeItem): T | null {
  const k = mergeKey(incoming);
  if (!k) return null;
  return (existing || []).find((e) => mergeKey(e) === k) ?? null;
}

/** Neue Anzahl nach einem weiteren Scan (gedeckelt wie im Server: 1–999). */
export const bumpQuantity = (current: unknown, add: unknown = 1) =>
  Math.min(999, Math.max(1, Math.floor(Number(current) || 1)) + Math.max(1, Math.floor(Number(add) || 1)));

/** Mengen-Badge auf der Karte im Set-Ordner („2x“, „3x“; einzelne Karten ohne Badge). */
export const quantityBadge = (qty: unknown) => (Math.floor(Number(qty) || 0) > 1 ? `${Math.floor(Number(qty))}x` : "");

// ---------------------------------------------------------------------------
// Gesamtwert mit/ohne Duplikate
// ---------------------------------------------------------------------------
/** Wert einer Karte im Binder: An = Wert aller Exemplare, Aus = nur ein Exemplar (Durchschnittswert je Stück). */
export function cardValue(ownedValue: unknown, quantity: unknown, countDuplicates: boolean): number {
  const v = num(ownedValue), q = Math.max(1, Math.floor(Number(quantity) || 1));
  return round2(countDuplicates ? v : v / q);
}

/** Set-Wert aus Binder-Karten (nur eigene Karten). */
export function setValue(cards: Array<{ owned?: boolean; ownedValue?: number; quantity?: number }>, countDuplicates: boolean): number {
  return round2((cards || []).reduce((s, c) => s + (c?.owned ? cardValue(c.ownedValue, c.quantity, countDuplicates) : 0), 0));
}

/** Wert eines Set-Ordners: `uniqueValue` (jede Karte 1×) fehlt bei älteren Antworten → dann der volle Wert. */
export function folderValue(f: { value?: number; uniqueValue?: number }, countDuplicates: boolean): number {
  if (countDuplicates || f?.uniqueValue === undefined || f?.uniqueValue === null) return round2(num(f?.value));
  return round2(num(f.uniqueValue));
}

/** Gesamt-Binderwert über alle Set-Ordner. */
export function binderTotal(folders: Array<{ value?: number; uniqueValue?: number }>, countDuplicates: boolean): number {
  return round2((folders || []).reduce((s, f) => s + folderValue(f, countDuplicates), 0));
}

// ---------------------------------------------------------------------------
// Eigene Karten für die Inserat-Auswahl (eine Zeile je Karte, Duplikate zusammengezählt)
// ---------------------------------------------------------------------------
export type PortfolioRow = {
  id: number; cardId?: string | null; printId?: string | null; lang?: string | null; name?: string; image?: string; setName?: string | null;
  quantity?: number; unitValue?: number | null; value?: number | null; condition?: string | null; variant?: string | null;
};
export type MyListingRow = { id?: number; card_id?: string | null; print_id?: string | null; portfolio_item_id?: number | null; status?: string; variant?: string | null };

export type OwnedCard = {
  key: string; cardId: string | null; printId: string | null; lang: string; name: string; image: string;
  setId: string; setName: string; number: string; quantity: number; unitValue: number; condition: string; variant: string;
  /** Sammlungs-Eintrag mit den meisten Exemplaren (Verknüpfung fürs Inserat). */
  portfolioItemId: number;
  /** Aktive eigene Inserate dieser Karte. */
  listed: number;
  /** Überzählige Exemplare (Anzahl − 1 behaltenes). */
  spare: number;
  /** Davon noch nicht inseriert → „Alle Doppelten inserieren“ stellt genau so viele ein. */
  toList: number;
};

const setIdOf = (id: string) => { const i = id.lastIndexOf("-"); return i > 0 ? id.slice(0, i) : ""; };
const localIdOf = (id: string) => { const i = id.lastIndexOf("-"); return i > 0 ? id.slice(i + 1) : ""; };
/** Druck-IDs wie „ja:SV2a-201“ → „SV2a-201“ */
const bareId = (id: string) => id.replace(/^[a-z]{2}:/i, "");

/** Sammlungs-Zeile → Schlüssel der Karte (fremdsprachige Drucke eigenständig, sonst die deutsche Katalogkarte). */
export function cardKeyOf(i: { cardId?: string | null; printId?: string | null; lang?: string | null }): string {
  if (i.printId && i.lang && i.lang !== "de") return `print:${i.printId}`;
  if (i.cardId) return `card:${i.cardId}`;
  if (i.printId) return `print:${i.printId}`;
  return "";
}

/** Aktive eigene Inserate je Karte zählen (verknüpft über Karte bzw. Druck). */
export function listedByCard(listings: MyListingRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of listings || []) {
    if (!l || (l.status && l.status !== "active")) continue;
    // Fremdsprachige Drucke zählen beim Druck, sonst bei der deutschen Katalogkarte
    const k = l.print_id ? `print:${l.print_id}` : l.card_id ? `card:${l.card_id}` : "";
    if (k) out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
}

/** Sammlung → eine Zeile je Karte mit Gesamtanzahl, Stückwert, Zustand und „noch zu inserieren“. */
export function ownedCards(items: PortfolioRow[], myListings: MyListingRow[] = []): OwnedCard[] {
  const listed = listedByCard(myListings);
  const by = new Map<string, OwnedCard & { best: number }>();
  for (const i of items || []) {
    const key = cardKeyOf(i);
    if (!key) continue;
    const qty = Math.max(1, Math.floor(Number(i.quantity) || 1));
    const unit = num(i.unitValue) || (num(i.value) ? num(i.value) / qty : 0);
    const id = key.startsWith("print:") ? bareId(String(i.printId)) : String(i.cardId);
    const cur = by.get(key) ?? {
      key, cardId: i.cardId || null, printId: i.printId || null, lang: String(i.lang || "de"), name: String(i.name || ""), image: String(i.image || ""),
      setId: setIdOf(id), setName: String(i.setName || ""), number: localIdOf(id), quantity: 0, unitValue: 0,
      condition: String(i.condition || "NM").toUpperCase(), variant: String(i.variant || "normal"), portfolioItemId: Number(i.id) || 0,
      listed: 0, spare: 0, toList: 0, best: 0,
    };
    // Preis & Zustand vom Eintrag mit den meisten Exemplaren (dort liegen die Doppelten)
    if (qty > cur.best) {
      cur.best = qty; cur.portfolioItemId = Number(i.id) || cur.portfolioItemId; cur.condition = String(i.condition || "NM").toUpperCase();
      cur.variant = String(i.variant || "normal"); if (unit) cur.unitValue = round2(unit);
    }
    if (!cur.unitValue && unit) cur.unitValue = round2(unit);
    if (!cur.image && i.image) cur.image = String(i.image);
    if (!cur.setName && i.setName) cur.setName = String(i.setName);
    cur.quantity += qty;
    by.set(key, cur);
  }
  return [...by.values()].map(({ best: _best, ...c }) => {
    const l = listed.get(c.key) || 0;
    const spare = Math.max(0, c.quantity - 1);
    return { ...c, listed: l, spare, toList: Math.max(0, spare - l) };
  });
}

// ---------------------------------------------------------------------------
// „Alle Doppelten inserieren“
// ---------------------------------------------------------------------------
const LISTING_COND: Record<string, string> = { M: "mint", NM: "nm", EX: "ex", GD: "gd", LP: "lp", PL: "pl", PO: "po", PSA10: "graded", PSA9: "graded" };
/** Sammlungs-Zustand → Marktplatz-Zustand (Standard: Near Mint). */
export const listingCondition = (c: unknown) => LISTING_COND[String(c || "").toUpperCase()] || "nm";

export type DupePlan = {
  cards: OwnedCard[];
  /** Anzahl Inserate, die jetzt eingestellt werden. */
  copies: number;
  value: number;
  /** Doppelte, die bereits inseriert sind (werden übersprungen). */
  alreadyListed: number;
  /** Doppelte ohne Vergleichspreis (können nicht automatisch inseriert werden). */
  noPrice: number;
};

/** Welche doppelten Exemplare jetzt inseriert werden (immer 1 Exemplar je Karte bleibt im Set-Ordner). */
export function duplicatePlan(items: PortfolioRow[], myListings: MyListingRow[] = []): DupePlan {
  const all = ownedCards(items, myListings).filter((c) => c.spare > 0);
  const cards = all.filter((c) => c.toList > 0 && c.unitValue > 0);
  const copies = cards.reduce((s, c) => s + c.toList, 0);
  return {
    cards, copies,
    value: round2(cards.reduce((s, c) => s + c.toList * c.unitValue, 0)),
    alreadyListed: all.reduce((s, c) => s + Math.min(c.spare, c.listed), 0),
    noPrice: all.filter((c) => c.toList > 0 && !(c.unitValue > 0)).reduce((s, c) => s + c.toList, 0),
  };
}

/** Bestätigungsfrage vor dem Massen-Inserat. */
export function dupeConfirmText(plan: DupePlan): string {
  const n = plan.copies;
  return `${n} doppelte Karte${n === 1 ? "" : "n"} jetzt zum Cardmarket-Preis inserieren? (Gesamt ca. ${new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(plan.value)} – je 1 Exemplar bleibt in deinem Set-Ordner.)`;
}

/** Inserate für POST /api/listings – ein Inserat je überzähligem Exemplar, mit Bild, Zustand und Vergleichspreis. */
export function dupeListingPayloads(plan: DupePlan) {
  const out: Array<Record<string, unknown>> = [];
  for (const c of plan.cards) {
    const ref = c.key.startsWith("print:") ? { printId: c.printId } : { cardId: c.cardId };
    for (let k = 0; k < c.toList; k++) {
      out.push({
        ...ref, card: c.name, price: c.unitValue, condition: listingCondition(c.condition), variant: c.variant || "normal",
        lang: c.lang || "de", img: c.image, portfolioItemId: c.portfolioItemId || undefined, want: "Verkauf", source: "dupes",
      });
    }
  }
  return out;
}

/** In Blöcke à 20 teilen (Server-Grenze je Anfrage). */
export function chunk<T>(list: T[], size = LISTING_BATCH): T[][] {
  const s = Math.max(1, Math.floor(size) || LISTING_BATCH);
  const out: T[][] = [];
  for (let i = 0; i < (list || []).length; i += s) out.push(list.slice(i, i + s));
  return out;
}

// ---------------------------------------------------------------------------
// Kartenauswahl beim Inserieren: Suche + Filter-Chips
// ---------------------------------------------------------------------------
export type PickFilter = "all" | "dupes" | "set";
export const PICK_FILTERS: Array<[PickFilter, string]> = [["all", "Alle"], ["dupes", "Nur Doppelte"], ["set", "Nach Set"]];

const fold = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Trifft die Suche (Name, Sammlernummer wie „199“/„199/165“/„#199“, Set-Name oder Set-Kürzel)? */
export function matchesQuery(c: Pick<OwnedCard, "name" | "number" | "setName" | "setId">, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  const number = fold(c.number).replace(/^0+(?=\d)/, "");
  const hay = `${fold(c.name)} ${fold(c.setName)} ${fold(c.setId)} ${fold(c.number)}`;
  return q.split(/\s+/).every((t) => {
    const n = t.replace(/^#/, "").split("/")[0].replace(/^0+(?=\d)/, "");
    // Reine Zahl: exakte Sammlernummer oder ganzes Wort im Namen/Set („151“) – kein Teilstring („2“ ≠ „25“)
    if (/^\d+$/.test(n)) return number === n || new RegExp(`(^|[^\\p{L}\\p{N}])${n}($|[^\\p{L}\\p{N}])`, "u").test(`${fold(c.name)} ${fold(c.setName)}`);
    return hay.includes(t);
  });
}

/** Suche + Filter anwenden; „Nach Set“ sortiert nach Set und Nummer, sonst Name. */
export function filterPickList(cards: OwnedCard[], query = "", filter: PickFilter = "all"): OwnedCard[] {
  const list = (cards || []).filter((c) => (filter !== "dupes" || c.quantity > 1) && matchesQuery(c, query));
  if (filter === "set") {
    return list.sort((a, b) => (a.setName || a.setId).localeCompare(b.setName || b.setId, "de")
      || (Number(a.number) || 0) - (Number(b.number) || 0) || a.number.localeCompare(b.number, "de"));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, "de") || a.number.localeCompare(b.number, "de"));
}

/** Für „Nach Set“: Gruppen mit Überschrift (Reihenfolge bleibt erhalten). */
export function groupPickBySet(cards: OwnedCard[]): Array<{ setId: string; setName: string; cards: OwnedCard[] }> {
  const out: Array<{ setId: string; setName: string; cards: OwnedCard[] }> = [];
  for (const c of cards || []) {
    const id = c.setId || c.setName || "?";
    let g = out.find((x) => x.setId === id);
    if (!g) { g = { setId: id, setName: c.setName || c.setId || "Ohne Set", cards: [] }; out.push(g); }
    g.cards.push(c);
  }
  return out;
}
