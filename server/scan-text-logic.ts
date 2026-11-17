// PokeSwipe & Radar – Text-Erkennung für den Live-Scanner (ohne KI, komplett auf dem Gerät).
//
// Die Texterkennung (TextDetector bzw. Tesseract.js im Browser) liefert rohen Text aus zwei Streifen der Karte:
// oben den Kartennamen, unten die Sammlernummer („264/182“, „TG12/TG30“, „SVP 085“, „SWSH123“). Dieses Modul
//   • liest daraus Sammlernummern (mit typischen OCR-Verwechslungen O→0, I/l→1, S→5, B→8),
//   • findet den Kartennamen unscharf (Levenshtein) im Katalog,
//   • und entscheidet zusammen mit den Bild-Fingerabdrücken (pHash/dHash), welche Karte vor der Kamera liegt.
// Reine Funktionen – läuft im Web Worker des Scanners und in den Tests.

export type TextRow = {
  key: string; // card:<id> | print:<lang>:<id>
  lang: string;
  name: string;
  norm: string; // normalisierter Name (nur a–z0–9)
  prefix: string; // Buchstaben vor der Nummer (TG, GG, SWSH …), sonst ""
  num: number; // Nummer ohne Präfix, -1 wenn nicht numerisch
  total: number; // offizielle Kartenanzahl des Sets (0 = unbekannt)
  set: string; // normalisiertes Set-Kürzel / Set-ID
  ident: string; // Karte unabhängig von der Sprache (Set-ID + Nummer), verbindet DE- und EN-Druck
};

export type TextIndex = {
  rows: TextRow[];
  byNumber: Map<string, number[]>; // "<prefix>|<num>" → Zeilen
  byName: Map<string, number[]>; // normalisierter Name → Zeilen
  names: string[]; // eindeutige normalisierte Namen (für die unscharfe Suche)
  byKey: Map<string, number>; // Schlüssel (card:…/print:…) → Zeile – verbindet Bild-Treffer mit Name/Nummer
  byIdent: Map<string, number[]>; // Karte (sprachunabhängig) → Zeilen
};

/** loose = ohne „/“ gelesen („205 165“) – zählt nur zusammen mit passendem Namen oder Bild-Treffer */
export type NumberRead = { num: number; total: number; prefix: string; promo: boolean; text: string; loose?: boolean };

/** Name normalisieren: Akzente weg (Pokémon → pokemon), ß → ss, nur Buchstaben/Ziffern, klein. */
export function normName(s: string): string {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

/** Lokale Kartennummer zerlegen: "199" → {"",199}, "TG12" → {"TG",12}, "SWSH123" → {"SWSH",123}, "SV-P" → {"",-1}. */
export function splitLocalId(localId: string): { prefix: string; num: number } {
  const m = String(localId || "").trim().match(/^([A-Za-z]{0,5})0*(\d{1,4})[a-z]?$/);
  if (!m) return { prefix: "", num: -1 };
  return { prefix: m[1].toUpperCase(), num: Number(m[2]) };
}

const numKey = (prefix: string, num: number) => `${prefix}|${num}`;

/**
 * Text-Index aus der Server-Antwort aufbauen. Zeilenformat (Tab-getrennt): key, name, localId, total, setCode.
 */
export function buildTextIndex(parts: { lang: string; t: string }[]): TextIndex {
  const rows: TextRow[] = [];
  for (const p of parts) {
    for (const line of String(p.t || "").split("\n")) {
      if (!line) continue;
      const [key, name = "", local = "", total = "0", code = ""] = line.split("\t");
      if (!key) continue;
      const { prefix, num } = splitLocalId(local);
      const id = key.replace(/^(card|print):/, "").replace(/^(en|ja|de):/, "");
      rows.push({ key, lang: p.lang, name, norm: normName(name), prefix, num, total: Number(total) || 0, set: normName(code), ident: `${p.lang === "ja" ? "ja:" : ""}${id}` });
    }
  }
  const byNumber = new Map<string, number[]>(), byName = new Map<string, number[]>();
  const byKey = new Map<string, number>(), byIdent = new Map<string, number[]>();
  rows.forEach((r, i) => {
    byKey.set(r.key, i);
    (byIdent.get(r.ident) || byIdent.set(r.ident, []).get(r.ident)!).push(i);
    if (r.num >= 0) { const k = numKey(r.prefix, r.num); (byNumber.get(k) || byNumber.set(k, []).get(k)!).push(i); }
    if (r.norm.length >= 3) (byName.get(r.norm) || byName.set(r.norm, []).get(r.norm)!).push(i);
  });
  return { rows, byNumber, byName, names: [...byName.keys()], byKey, byIdent };
}

// ---------------------------------------------------------------------------
// Sammlernummern lesen
// ---------------------------------------------------------------------------
/** Typische OCR-Verwechslungen in Zahlen-Tokens korrigieren (nur in Tokens, die schon eine Ziffer enthalten). */
function fixDigits(tok: string): string {
  return tok.replace(/[OoQD]/g, "0").replace(/[Il|!\]\[]/g, "1").replace(/[S$]/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/G(?=\d)/g, "6");
}

const PROMO_PREFIXES = ["SVP", "SWSH", "SM", "XY", "BW", "DP", "HGSS", "SVE", "MEP", "PR"];
const SUB_PREFIXES = ["TG", "GG", "RC", "SV", "H"];

/**
 * Alle Sammlernummern im Text finden: „264/182“, „045 / 198“, „TG12/TG30“, „GG05/GG70“, „SVP 085“, „SVP EN 085“,
 * „SWSH123“. Liefert die Treffer in der Reihenfolge ihrer Plausibilität (mit Gesamtzahl zuerst).
 */
export function parseCollectorNumbers(text: string): NumberRead[] {
  const out: NumberRead[] = [];
  const seen = new Set<string>();
  const push = (r: NumberRead) => { const k = `${r.prefix}|${r.num}|${r.total}`; if (!seen.has(k) && r.num > 0 && r.num < 1000) { seen.add(k); out.push(r); } };
  const raw = String(text || "").replace(/[⁄∕⁄]/g, "/");
  // 1) Präfix-Nummern mit Gesamtzahl (TG12/TG30, GG05/GG70)
  for (const m of raw.toUpperCase().matchAll(/\b(TG|GG|RC|SV|H)\s?([0-9OIlSB]{1,3})\s*\/\s*(?:TG|GG|RC|SV|H)?\s?([0-9OIlSB]{1,3})\b/g)) {
    const num = Number(fixDigits(m[2])), total = Number(fixDigits(m[3]));
    if (Number.isFinite(num) && Number.isFinite(total)) push({ num, total, prefix: m[1], promo: false, text: `${m[1]}${m[2]}/${m[1]}${m[3]}` });
  }
  // 2) Normale Nummern „123/456“ – Zahlen-Tokens vorher korrigieren
  const fixed = raw.replace(/[0-9OoIlSB|!$Z]{1,4}\s*[/\\]\s*[0-9OoIlSB|!$Z]{1,4}/g, (s) => fixDigits(s).replace(/\\/g, "/"));
  for (const m of fixed.matchAll(/(?:^|[^0-9])(\d{1,3})\s*\/\s*(\d{2,3})(?![0-9])/g)) {
    const num = Number(m[1]), total = Number(m[2]);
    // Plausibel: Sets haben mindestens 10 Karten; Secret Rares liegen höchstens ~70 % über der Gesamtzahl
    if (total >= 10 && num <= Math.max(total * 1.8, total + 120)) push({ num, total, prefix: "", promo: false, text: `${m[1]}/${m[2]}` });
  }
  // 2b) Schrägstrich nicht erkannt („205 165“, kursive Nummern): nur als „lose“ Lesung
  for (const m of fixed.matchAll(/(?:^|[^0-9])(\d{2,3})\s+(\d{2,3})(?![0-9])/g)) {
    const num = Number(m[1]), total = Number(m[2]);
    if (total >= 10 && num <= Math.max(total * 1.8, total + 120)) push({ num, total, prefix: "", promo: false, text: `${m[1]}/${m[2]}`, loose: true });
  }
  // 3) Promos ohne Gesamtzahl: „SVP 085“, „SVP EN 085“, „SWSH123“, „SM 210“
  for (const m of raw.toUpperCase().matchAll(/\b(SVP|SWSH|SM|XY|BW|DP|HGSS|SVE|MEP|PR)\s*[-–]?\s*(?:EN|DE|JP)?\s*([0-9OIlSB]{2,3})\b/g)) {
    const num = Number(fixDigits(m[2]));
    if (Number.isFinite(num)) push({ num, total: 0, prefix: m[1], promo: true, text: `${m[1]} ${m[2]}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kartennamen lesen (unscharf)
// ---------------------------------------------------------------------------
/** Wörter auf Karten, die nie zum Namen gehören (Phase, KP/HP, Kartentyp). */
const STOP = new Set(["basis", "basic", "phase", "stage", "stufe", "kp", "hp", "trainer", "item", "artikel", "unterstutzer", "supporter", "stadion", "stadium", "energie", "energy", "pokemon", "entwickelt", "evolves", "from", "aus", "tool", "ace", "spec", "illus", "weakness", "schwache", "resistance", "resistenz", "retreat", "ruckzug"]);

/** Kandidaten für den Kartennamen: einzelne Wörter und Wortpaare/-tripel je Zeile (ohne Stoppwörter und Zahlen). */
export function nameCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const line of String(text || "").split(/\n+/)) {
    const words = line.split(/[\s,.;:()[\]{}"“”„]+/).map((w) => w.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ'’\-]+$/g, ""))
      .filter((w) => w && /[A-Za-zÀ-ÿ]{2,}/.test(w) && !STOP.has(normName(w)));
    for (let i = 0; i < words.length; i++) {
      for (let n = 1; n <= 3 && i + n <= words.length; n++) {
        const c = normName(words.slice(i, i + n).join(""));
        if (c.length >= 3 && c.length <= 28) out.add(c);
      }
    }
  }
  return [...out].slice(0, 120);
}

/** Levenshtein-Abstand mit Abbruch, sobald `max` überschritten ist (liefert dann max + 1). */
export function levenshtein(a: string, b: string, max = 99): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1), cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Ähnlichkeit 0…1 (1 = gleich). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const L = Math.max(a.length, b.length);
  const max = Math.ceil(L * 0.45);
  const d = levenshtein(a, b, max);
  return d > max ? 0 : 1 - d / L;
}

/** Ab dieser Ähnlichkeit gilt ein gelesener Name als Treffer. */
export const NAME_MIN = 0.72;
/** Ab hier reicht der Name allein für einen sicheren Treffer (wenn der Bild-Fingerabdruck mitspielt). */
export const NAME_STRONG = 0.86;

/** Beste Katalognamen für die gelesenen Kandidaten (unscharf, schnell: Längenfilter + abbrechender Levenshtein). */
export function matchNames(idx: TextIndex, cands: string[], limit = 5): { norm: string; sim: number }[] {
  const best = new Map<string, number>();
  const put = (n: string, v: number) => { if (v >= NAME_MIN && v > (best.get(n) || 0)) best.set(n, v); };
  for (const c of cands) {
    if (idx.byName.has(c)) put(c, 1);
    if (c.length < 3) continue;
    for (const n of idx.names) {
      // Nur die Endung fehlt („mew“ → „mewex“) bzw. langer Name beginnt mit dem gelesenen („pikachu“ → „pikachuwith…“)
      if (n.length > c.length && n.startsWith(c)) {
        if (SUFFIX_RE.test(n.slice(c.length))) { put(n, 0.92); continue; }
        if (c.length >= 5) { put(n, 0.8); continue; }
      }
      if (c.length < 4) continue;
      if (Math.abs(n.length - c.length) > Math.max(2, c.length * 0.35)) continue;
      if (n.charCodeAt(0) !== c.charCodeAt(0) && n.charCodeAt(1) !== c.charCodeAt(1)) continue; // grober Vorfilter
      put(n, similarity(c, n));
    }
  }
  return [...best.entries()].map(([norm, sim]) => ({ norm, sim }))
    // längere Namen bevorzugen („glurakex“ vor „glurak“), wenn gleich ähnlich
    .sort((a, b) => b.sim - a.sim || b.norm.length - a.norm.length).slice(0, limit);
}

/** Namens-Endungen, die die OCR oft nicht liest (ex-Logo, V, VMAX …) */
const SUFFIX_RE = /^(ex|v|gx|vmax|vstar|vunion|break|lvx|star)$/;

// ---------------------------------------------------------------------------
// Entscheidung
// ---------------------------------------------------------------------------
export type HashCand = { key: string; score: number };
export type TextDecision = {
  accepted: boolean;
  /** strong = sofort übernehmen; medium = nach zweitem gleichen Bild übernehmen; weak = nur als Vorschlag */
  strength: "strong" | "medium" | "weak" | "none";
  via: string;
  ident: string | null;
  keys: string[]; // Sprachvarianten der erkannten Karte
  candidates: string[]; // Vorschläge, falls unsicher
  number: string | null;
  name: string | null;
  nameSim: number;
};

/** Hash-Abstand, bis zu dem ein Bild-Fingerabdruck einen Text-Treffer bestätigt (wie SCORE_WITH_NUMBER). */
export const HASH_CONFIRM = 54;

function rowsForNumber(idx: TextIndex, n: NumberRead): number[] {
  if (!n.promo) {
    const list = idx.byNumber.get(numKey(n.prefix, n.num)) || [];
    // Unter-Sets (TG12/TG30, GG05/GG70): die zweite Zahl zählt nur das Unter-Set, nicht das ganze Set
    if (n.prefix) { const ex = list.filter((i) => idx.rows[i].total === n.total); return ex.length ? ex : list; }
    const exact = list.filter((i) => idx.rows[i].total === n.total);
    if (exact.length) return exact;
    // Gesamtzahl unbekannt (0) im Katalog: nur dann zulassen
    return list.filter((i) => idx.rows[i].total <= 0);
  }
  // Promo: Präfix als Nummern-Präfix (SWSH123) oder im Set-Kürzel (svp, swshp, smp …)
  const p = n.prefix.toLowerCase();
  const withPrefix = idx.byNumber.get(numKey(n.prefix, n.num)) || [];
  const plain = (idx.byNumber.get(numKey("", n.num)) || []).filter((i) => {
    const s = idx.rows[i].set;
    return s === p || s.startsWith(p) || (p === "svp" && /^(svp|prsv|svpromo)/.test(s));
  });
  return [...withPrefix, ...plain];
}

/** Gruppen gleicher Karten (Sprachvarianten) – Reihenfolge: bestes Hash-Ergebnis, dann Sprachwahl. */
function groupByIdent(idx: TextIndex, list: number[]) {
  const g = new Map<string, number[]>();
  for (const i of list) { const id = idx.rows[i].ident; (g.get(id) || g.set(id, []).get(id)!).push(i); }
  return g;
}

/**
 * Text (Name + Nummer) und Bild-Fingerabdruck zusammen bewerten.
 *  • Nummer + Name passen zur selben Karte → strong
 *  • Nummer eindeutig (genau eine Karte, ggf. in mehreren Sprachen) → strong mit Hash-Bestätigung, sonst medium
 *  • mehrere Karten mit der Nummer → Hash oder Name entscheidet
 *  • nur Name → strong, wenn ein Bild-Treffer denselben Namen trägt, sonst Vorschläge (weak)
 */
export function decideText(idx: TextIndex, text: string, hash: HashCand[] = [], langs: string[] = ["de", "en", "ja"]): TextDecision {
  const none: TextDecision = { accepted: false, strength: "none", via: "", ident: null, keys: [], candidates: [], number: null, name: null, nameSim: 0 };
  if (!idx.rows.length || !text) return none;
  const numbers = parseCollectorNumbers(text);
  const names = matchNames(idx, nameCandidates(text));
  const topName = names[0] || null;
  const hashScore = new Map<string, number>();
  for (const h of hash) if (!hashScore.has(h.key) || hashScore.get(h.key)! > h.score) hashScore.set(h.key, h.score);
  const langRank = (l: string) => { const i = langs.indexOf(l); return i < 0 ? 9 : i; };
  const order = (list: number[]) => [...list].sort((a, b) => {
    const ra = idx.rows[a], rb = idx.rows[b];
    return (hashScore.get(ra.key) ?? 999) - (hashScore.get(rb.key) ?? 999) || langRank(ra.lang) - langRank(rb.lang);
  }).map((i) => idx.rows[i].key);
  const nameSimOf = (i: number) => {
    let s = 0;
    const rn = idx.rows[i].norm;
    for (const n of names) {
      let v = n.norm === rn ? n.sim : similarity(n.norm, rn) * n.sim;
      // Langer Kartenname beginnt mit dem gelesenen Namen („Pikachu“ → „Pikachu with Grey Felt Hat“)
      if (v < 0.8 && n.norm.length >= 4 && rn.startsWith(n.norm)) v = Math.max(v, 0.8 * n.sim);
      // Nur die Endung fehlt („Mew“ → „Mew ex“, „Arceus“ → „Arceus VSTAR“) – das ex-Logo liest die OCR oft nicht
      if (v < 0.9 && n.norm.length >= 3 && rn.startsWith(n.norm) && SUFFIX_RE.test(rn.slice(n.norm.length))) v = Math.max(v, 0.9 * n.sim);
      if (v > s) s = v;
    }
    return s;
  };
  const hashOk = (list: number[]) => list.some((i) => (hashScore.get(idx.rows[i].key) ?? 999) <= HASH_CONFIRM);
  const result = (strength: TextDecision["strength"], via: string, ident: string | null, list: number[], cands: number[], num: NumberRead | null, sim: number): TextDecision => ({
    accepted: strength === "strong" || strength === "medium", strength, via, ident, keys: order(list), candidates: order(cands).slice(0, 6),
    number: num?.text ?? null, name: topName ? idx.rows[idx.byName.get(topName.norm)![0]].name : null, nameSim: sim,
  });

  let weak: TextDecision | null = null;
  for (const n of numbers) {
    const hits = rowsForNumber(idx, n);
    if (!hits.length) continue;
    const groups = [...groupByIdent(idx, hits).entries()];
    // Name passt zu genau einer Karte mit dieser Nummer
    const scored = groups.map(([id, list]) => ({ id, list, sim: Math.max(...list.map(nameSimOf)), hash: hashOk(list) }));
    scored.sort((a, b) => b.sim - a.sim || Number(b.hash) - Number(a.hash));
    const top = scored[0];
    if (top.sim >= NAME_MIN && (scored.length === 1 || scored[1].sim < top.sim - 0.08)) return result("strong", "number+name", top.id, top.list, [], n, top.sim);
    const byHash = scored.filter((x) => x.hash);
    if (n.loose) {
      // Lose Lesung: nur mit eindeutigem Bild-Treffer
      if (byHash.length === 1) return result("strong", "number+hash", byHash[0].id, byHash[0].list, [], n, byHash[0].sim);
      continue;
    }
    if (groups.length === 1) {
      // Nummer eindeutig – ein klar widersprechender Name (gut gelesen, ganz anders) bremst auf „Vorschlag“
      if (topName && topName.sim >= NAME_STRONG && top.sim < 0.4) return result("weak", "number-conflict", null, [], top.list, n, top.sim);
      return result(top.hash ? "strong" : "medium", top.hash ? "number+hash" : "number", top.id, top.list, [], n, top.sim);
    }
    if (byHash.length === 1) return result("strong", "number+hash", byHash[0].id, byHash[0].list, [], n, byHash[0].sim);
    // Mehrdeutig: als Vorschläge merken – vielleicht entscheiden gleich Name + Bild
    weak ||= result("weak", "number-ambiguous", null, [], scored.flatMap((x) => x.list), n, top.sim);
  }

  // Bild-Treffer, deren Name zum gelesenen Namen passt („Mew“ ↔ Bild „Mew ex“, „lono“ ↔ „Iono“)
  if (names.length && hash.length) {
    let best: { i: number; score: number; sim: number } | null = null;
    for (const h of hash) {
      if (h.score > HASH_CONFIRM) continue;
      const i = idx.byKey.get(h.key);
      if (i === undefined) continue;
      const sim = nameSimOf(i);
      if (sim >= NAME_MIN && (!best || h.score < best.score)) best = { i, score: h.score, sim };
    }
    if (best) {
      const id = idx.rows[best.i].ident;
      return result(best.sim >= NAME_STRONG || best.score <= 30 ? "strong" : "medium", "name+hash", id, idx.byIdent.get(id) || [best.i], [], null, best.sim);
    }
  }
  if (weak) return weak;

  if (topName) {
    const list = idx.byName.get(topName.norm) || [];
    const confirmed = list.filter((i) => (hashScore.get(idx.rows[i].key) ?? 999) <= HASH_CONFIRM);
    if (confirmed.length && topName.sim >= NAME_MIN) {
      const groups = groupByIdent(idx, confirmed);
      // Bild-Treffer mit gleichem Namen: der mit dem kleinsten Hash-Abstand gewinnt
      const bestKey = order(confirmed)[0];
      const id = idx.rows[confirmed.find((i) => idx.rows[i].key === bestKey)!].ident;
      const all = list.filter((i) => idx.rows[i].ident === id);
      return result(topName.sim >= NAME_STRONG || groups.size === 1 ? "strong" : "medium", "name+hash", id, all, [], null, topName.sim);
    }
    // Nur Name: Vorschläge (z. B. alle Drucke dieses Pokémon), Bild-ähnlichste zuerst
    return result("weak", "name", null, [], list.slice(0, 60), null, topName.sim);
  }
  return none;
}
