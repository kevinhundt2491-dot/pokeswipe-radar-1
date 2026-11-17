// PokeSwipe & Radar – Scanner-Stufe 3 (KI-Vision) und Katalog-Abgleich: reine Logik ohne Datenbank/Netzwerk.
//
// Die KI (Gemini Vision, Rückfall Claude) liest vom zugeschnittenen Kartenfoto einen „Fingerabdruck“:
// Name, Sammlernummer (z. B. 142/191, TG15/TG30, SVP 085), KP, Typ, Seltenheit, Illustrator, Set-Kürzel, Sprache
// und Variante (Normal, Reverse Holo, Holo …). Hier wird die Antwort bereinigt und gegen Katalogkandidaten
// fehlertolerant gewichtet – ein unscharfer Buchstabe (Holo-Glanz) oder ein fehlendes „-ex“ kostet keinen Treffer mehr.

export const VISION_FINISHES = ["normal", "reverse_holo", "holo"] as const;
export type VisionFinish = (typeof VISION_FINISHES)[number];

/** Seltenheits-Klassen, die Sammler unterscheiden (Varianten-Auswahl im Scanner). */
export const RARITY_CLASSES = [
  "common", "uncommon", "rare", "holo_rare", "double_rare", "ultra_rare", "full_art", "illustration_rare",
  "special_illustration_rare", "hyper_rare", "ace_spec", "promo", "other",
] as const;
export type RarityClass = (typeof RARITY_CLASSES)[number];

export const RARITY_CLASS_LABEL: Record<RarityClass, string> = {
  common: "Häufig", uncommon: "Nicht so häufig", rare: "Selten", holo_rare: "Holo Rare", double_rare: "Double Rare",
  ultra_rare: "Ultra Rare", full_art: "Full Art", illustration_rare: "Illustration Rare",
  special_illustration_rare: "Special Illustration Rare", hyper_rare: "Hyper Rare (Gold)", ace_spec: "ACE SPEC", promo: "Promo", other: "",
};

export type VisionCard = {
  isPokemonCard: boolean;
  name: string;
  nameEn: string;
  number: string; // Rohtext, z. B. "142/191", "TG15/TG30", "SVP 085"
  local: string; // normierte Nummer vor dem Schrägstrich, z. B. "142", "TG15", "85"
  total: string; // Zahl/Text nach dem Schrägstrich, z. B. "191", "TG30"
  setCode: string;
  setName: string;
  language: "de" | "en" | "ja" | "other";
  hp: number | null;
  type: string;
  rarity: string;
  rarityClass: RarityClass;
  illustrator: string;
  finish: VisionFinish;
  confidence: number;
};

/** Anweisung an das Vision-Modell (Antwort als reines JSON). */
export const VISION_PROMPT = `Du siehst ein Foto einer Pokémon-Sammelkarte (zugeschnitten auf die Karte; Spiegelungen, Sleeves oder Toploader möglich).
Lies die Karte so genau wie möglich und antworte NUR mit einem JSON-Objekt ohne Erklärung:
{"isPokemonCard": true|false,
 "name": "Kartenname exakt wie aufgedruckt inkl. Zusatz wie ex, V, VMAX, VSTAR, GX, Mega (ohne KP)",
 "nameEn": "englischer Kartenname, falls die Karte deutsch oder japanisch ist, sonst gleich name",
 "number": "Sammlernummer unten links/rechts exakt wie aufgedruckt, z. B. 142/191, TG15/TG30, GG05/GG70, SVP 085, SWSH123",
 "setCode": "Set-Kürzel neben der Nummer, z. B. SSP, PRE, MEW, PAF (leer, wenn nicht lesbar)",
 "setName": "Set-Name, falls sicher bekannt (z. B. Stürmische Funken, Prismatische Entwicklungen, Mega-Entwicklung, 151)",
 "language": "de|en|ja|other",
 "hp": Zahl der KP/HP oder null,
 "type": "Energietyp, z. B. Feuer/Fire",
 "rarity": "Seltenheitssymbol oder -name",
 "rarityClass": "common|uncommon|rare|holo_rare|double_rare|ultra_rare|full_art|illustration_rare|special_illustration_rare|hyper_rare|ace_spec|promo|other",
 "illustrator": "Name hinter Illus.",
 "finish": "normal|reverse_holo|holo (reverse_holo = glitzernder Rahmen/Hintergrund bei normalem Bild, holo = glitzerndes Bild)",
 "confidence": Zahl 0..1}
Unbekannte Werte als leerer String bzw. null. Rate die Sammlernummer nicht, wenn sie nicht lesbar ist.`;

const clean = (v: unknown, max = 80) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Sammlernummer zerlegen. Beispiele: "142/191" → 142 / 191, "TG15/TG30" → TG15 / TG30, "GG05/GG70" → GG5 / GG70,
 * "SVP 085" / "SV-P 085" → Promo 85 (setHint svp), "085/SV-P" (japanische Promo) → 85, "SWSH123" → SWSH123 (swshp).
 */
export function parseCollectorNumber(raw: unknown): { local: string; total: string; setHint: string } | null {
  let s = clean(raw, 30).toUpperCase().replace(/[Oo](?=\d)|(?<=\d)[O]/g, "0").replace(/\s*\/\s*/g, "/");
  if (!s) return null;
  // Promos: "SVP 085", "SV-P085", "SVP EN 085"
  let m = s.match(/^(SV-?P|SVP|SWSH|SM|XY|BW|MEP|MEGA-?P|MP)\s*(?:EN|DE)?\s*-?\s*(\d{1,3})$/);
  if (m) {
    const pre = m[1].replace("-", "");
    const hint = pre === "SVP" ? "svp" : pre === "SWSH" ? "swshp" : pre === "SM" ? "smp" : pre === "XY" ? "xyp" : pre === "BW" ? "bwp" : "mep";
    return { local: pre === "SVP" || pre.startsWith("ME") || pre === "MP" ? normLocal(m[2]) : normLocal(pre + m[2]), total: "", setHint: hint };
  }
  m = s.match(/^(\d{1,3})\/(SV-?P|S-?P|SM-?P)$/);
  if (m) return { local: normLocal(m[1]), total: "", setHint: "promo" };
  // Trainer-Galerie, Galarian Gallery, Shiny Vault: "TG15/TG30", "GG05/GG70", "SV107/SV122", "RC5/RC32"
  m = s.match(/^([A-Z]{1,3})(\d{1,3})\/([A-Z]{1,3})?(\d{1,3})$/);
  if (m) return { local: normLocal(m[1] + m[2]), total: `${m[3] || ""}${Number(m[4])}`, setHint: "" };
  m = s.match(/(\d{1,3})\/(\d{2,3})/);
  if (m) return { local: normLocal(m[1]), total: String(Number(m[2])), setHint: "" };
  m = s.match(/^([A-Z]{0,4})(\d{1,3})$/);
  if (m) return { local: normLocal(m[1] + m[2]), total: "", setHint: "" };
  return null;
}

/** Lokale Kartennummer vergleichbar machen: Großbuchstaben, ohne Leerzeichen, führende Nullen der Ziffern weg ("TG05" → "TG5", "085" → "85"). */
export function normLocal(v: unknown): string {
  const s = String(v ?? "").toUpperCase().replace(/\s+/g, "");
  const m = s.match(/^([A-Z-]*)0*(\d+)([A-Z]*)$/);
  return m ? `${m[1].replace(/-/g, "")}${m[2]}${m[3]}` : s;
}

/** Namenszusätze, die Pokémon-Karten unterscheiden. */
const SUFFIXES = ["vmax", "vstar", "v-union", "ex", "gx", "v", "break", "lv.x", "prime", "star", "δ"] as const;

/** Name für den Vergleich: klein, ohne Akzente/Satzzeichen, ß → ss; deutsche Umlaute bleiben eindeutig (ä → ae). */
export function normalizeName(name: unknown): string {
  return String(name ?? "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[’'`´.:!?,()[\]{}]/g, "").replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Name in Grundname, Zusatz (ex, V, VMAX …) und Mega-Präfix zerlegen. */
export function splitName(name: unknown): { base: string; suffix: string; mega: boolean } {
  let n = normalizeName(name).replace(/\b(kp|hp)\s*\d+\b/g, "").trim();
  let mega = false;
  if (/^(mega|m)\s+/.test(n)) { mega = true; n = n.replace(/^(mega|m)\s+/, ""); }
  let suffix = "";
  for (const s of SUFFIXES) {
    const re = new RegExp(`(?:^|\\s)${s.replace(/[.\\-]/g, (c) => `\\${c}`)}$`);
    if (re.test(n)) { suffix = s; n = n.replace(re, "").trim(); break; }
  }
  return { base: n, suffix, mega };
}

/** Levenshtein-Abstand (kurze Strings; O(n·m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Fehlertolerante Namensähnlichkeit 0…1: Grundname per Levenshtein (ein verschluckter Buchstabe ≈ 0,9),
 * Zusatz (ex/V/VMAX …) und Mega-Präfix als kleine Zu-/Abschläge.
 */
export function nameSimilarity(a: unknown, b: unknown): number {
  const x = splitName(a), y = splitName(b);
  if (!x.base || !y.base) return 0;
  const len = Math.max(x.base.length, y.base.length);
  let sim = 1 - levenshtein(x.base, y.base) / len;
  // Teilstring (z. B. „Glurak“ in „Glurak von Team Rocket“) zählt ordentlich
  if (sim < 0.8 && (x.base.includes(y.base) || y.base.includes(x.base))) sim = Math.max(sim, 0.8);
  if (x.suffix !== y.suffix) sim -= x.suffix && y.suffix ? 0.25 : 0.12;
  if (x.mega !== y.mega) sim -= 0.15;
  return Math.max(0, Math.min(1, sim));
}

const RARITY_HINTS: [RegExp, RarityClass][] = [
  [/special illustration|besondere illustration|sar\b/i, "special_illustration_rare"],
  [/illustration rare|illustrations?-?rar|\bir\b|\bar\b|art rare/i, "illustration_rare"],
  [/hyper|gold|secret|geheim|\bur\b/i, "hyper_rare"],
  [/ultra|full art|\bsr\b|\bfa\b/i, "ultra_rare"],
  [/double|doppel|\brr\b/i, "double_rare"],
  [/ace spec/i, "ace_spec"],
  [/promo/i, "promo"],
  [/holo/i, "holo_rare"],
  [/uncommon|nicht so häufig/i, "uncommon"],
  [/common|häufig/i, "common"],
  [/rare|selten/i, "rare"],
];
/** Katalog-Seltenheit (TCGdex, DE/EN/JA) → Seltenheits-Klasse. */
export function rarityClassOf(rarity: unknown): RarityClass {
  const r = String(rarity ?? "");
  if (!r) return "other";
  for (const [re, cls] of RARITY_HINTS) if (re.test(r)) return cls;
  return "other";
}
/** Full Art zählt im Katalog meist als Ultra Rare – für den Vergleich gleichsetzen. */
const rarityFamily = (c: RarityClass) => (c === "full_art" ? "ultra_rare" : c);

/** Antwort des Vision-Modells robust lesen und bereinigen (JSON irgendwo im Text, Felder begrenzt). */
export function parseVisionResponse(text: unknown): VisionCard | null {
  const t = String(text ?? "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let p: any;
  try { p = JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  const num = parseCollectorNumber(p.number);
  const lang = ["de", "en", "ja"].includes(String(p.language)) ? (String(p.language) as VisionCard["language"]) : "other";
  const hp = Number(p.hp);
  const finish = (VISION_FINISHES as readonly string[]).includes(String(p.finish)) ? (String(p.finish) as VisionFinish) : "normal";
  const rc = (RARITY_CLASSES as readonly string[]).includes(String(p.rarityClass)) ? (String(p.rarityClass) as RarityClass) : rarityClassOf(p.rarity);
  const conf = Number(p.confidence);
  const name = clean(p.name).replace(/\s+(KP|HP)\s*\d+$/i, "");
  return {
    isPokemonCard: p.isPokemonCard === true || p.isPokemonCard === "true",
    name,
    nameEn: clean(p.nameEn) || name,
    number: clean(p.number, 20),
    local: num?.local || "",
    total: num?.total || "",
    setCode: clean(p.setCode, 10).toUpperCase(),
    setName: clean(p.setName, 60),
    language: lang,
    hp: Number.isFinite(hp) && hp > 0 && hp < 1000 ? Math.round(hp) : null,
    type: clean(p.type, 20),
    rarity: clean(p.rarity, 40),
    rarityClass: rc,
    illustrator: clean(p.illustrator, 60),
    finish,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
  };
}

/** Katalogkandidat (deutsche Karte aus `cards` oder Druck aus `card_prints`). */
export type CatalogCandidate = {
  key: string; lang: string; name: string; localId: string; total: number | null; setCode: string; setName: string;
  hp?: number | null; rarity?: string | null; illustrator?: string | null; setId?: string;
};

/**
 * Kandidat gegen den KI-Fingerabdruck gewichten (0 … ~1,2). Nummer + Gesamtzahl sind der präziseste Teil,
 * der Name fehlertolerant, KP/Illustrator/Seltenheit/Set entscheiden zwischen Varianten.
 */
export function scoreCandidate(det: VisionCard, c: CatalogCandidate): number {
  let s = 0;
  const local = normLocal(c.localId);
  const sim = Math.max(nameSimilarity(det.name, c.name), nameSimilarity(det.nameEn, c.name));
  // Gleiche Nummer bei völlig anderem Namen (anderes Set) zählt nur halb
  if (det.local && local === det.local) s += sim > 0.4 || (!det.name && !det.nameEn) ? 0.42 : 0.2;
  else if (det.local && local && local.replace(/^[A-Z]+/, "") === det.local.replace(/^[A-Z]+/, "")) s += 0.12;
  else if (det.local) s -= 0.1;
  const tot = String(det.total || "").replace(/^[A-Z]+/, "");
  if (tot && c.total && Number(tot) === Number(c.total)) s += 0.14;
  s += 0.32 * sim;
  if (det.hp && c.hp) s += det.hp === Number(c.hp) ? 0.06 : -0.04;
  if (det.illustrator && c.illustrator) {
    const a = normalizeName(det.illustrator), b = normalizeName(c.illustrator);
    if (a && b && (a === b || 1 - levenshtein(a, b) / Math.max(a.length, b.length) > 0.75)) s += 0.05;
  }
  if (det.setCode && c.setCode && det.setCode.toUpperCase() === c.setCode.toUpperCase()) s += 0.08;
  else if (det.setName && c.setName && nameSimilarity(det.setName, c.setName) > 0.75) s += 0.06;
  if (det.rarityClass !== "other" && c.rarity && rarityFamily(rarityClassOf(c.rarity)) === rarityFamily(det.rarityClass)) s += 0.04;
  if (det.language !== "other" && det.language === c.lang) s += 0.09;
  return Math.round(s * 1000) / 1000;
}

/** Kandidaten sortieren und bis zu k beste liefern (gleiche Keys nur einmal). */
export function rankCandidates(det: VisionCard, list: CatalogCandidate[], k = 6): (CatalogCandidate & { score: number })[] {
  const seen = new Set<string>();
  return list
    .filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)))
    .map((c) => ({ ...c, score: scoreCandidate(det, c) }))
    .filter((c) => c.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Ab diesem Abstand zum Zweitplatzierten gilt der beste Kandidat als eindeutig. */
export const VISION_CLEAR_MARGIN = 0.12;
export const VISION_MIN_SCORE = 0.45;

/** Namen für die Datenbanksuche (Trigramm auf lower(name)): voller Name und Grundname ohne Zusatz/Mega, Umlaute bleiben. */
export function searchTerms(det: VisionCard): string[] {
  const out = new Set<string>();
  for (const n of [det.name, det.nameEn]) {
    const lower = String(n || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (lower.length < 2) continue;
    out.add(lower);
    const base = lower.replace(/[\s-]+(vmax|vstar|v-union|ex|gx|v|break)$/i, "").replace(/^(mega|m)[\s-]+/i, "").trim();
    if (base.length >= 2) out.add(base);
  }
  return [...out].slice(0, 4);
}

/** Kartenvariante aus der KI → Varianten-Schlüssel des Portfolios/Marktplatzes. */
export const finishToVariant = (f: VisionFinish) => (f === "reverse_holo" ? "reverse_holo" : f === "holo" ? "holo" : "normal");
