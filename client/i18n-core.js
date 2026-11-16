// i18n – reine Logik ohne DOM (in Node testbar, siehe tests/i18n-client.test.ts).
// Sprache erkennen, Wörterbuch kompilieren (exakte Einträge + Muster mit {platzhaltern}),
// Emoji-/Pfeil-Präfixe abtrennen und wieder anhängen.

export const LANGS = ["de", "en"];
export const LANG_KEY = "ps_lang";
/** Regionen, in denen auch ein englischer Browser die deutsche Oberfläche bekommt. */
const DACH_REGIONS = new Set(["DE", "AT", "CH", "LI", "LU"]);

const norm = (l) => String(l || "").trim().toLowerCase();

/**
 * Sprache bestimmen.
 * 1. `?lang=en|de` in der URL (gewinnt, Aufrufer speichert ihn),
 * 2. gespeicherter Wert (localStorage `ps_lang`),
 * 3. Browser: `navigator.language` beginnt mit "en" UND keine deutschsprachige Locale
 *    (kein `de-*` in navigator.languages, keine Region DE/AT/CH/LI/LU wie bei "en-DE"),
 * 4. sonst Deutsch.
 * @returns {{ lang: "de"|"en", fromUrl: boolean }}
 */
export function detectLang({ search = "", stored = "", language = "", languages = [] } = {}) {
  let q = "";
  try { q = norm(new URLSearchParams(search).get("lang")); } catch {}
  if (LANGS.includes(q)) return { lang: q, fromUrl: true };
  const s = norm(stored);
  if (LANGS.includes(s)) return { lang: s, fromUrl: false };
  const primary = norm(language);
  if (primary.startsWith("en")) {
    const all = [primary, ...(Array.isArray(languages) ? languages : [])].map(norm);
    const germanLocale = all.some((l) => l === "de" || l.startsWith("de-") || DACH_REGIONS.has(l.split("-")[1]?.toUpperCase()));
    if (!germanLocale) return { lang: "en", fromUrl: false };
  }
  return { lang: "de", fromUrl: false };
}

/** Öffentliche Seiten, für die es englische Versionen unter /en/… gibt. */
const LOCALIZED_PATH = /^\/(karte\/|set\/|sets(?:[/?#]|$)|pokemon|sealed|trends(?:[/?#]|$)|shop\/)/;
const ORIGIN = /^https?:\/\/[^/?#]+(?=\/)/;
/** Eigene Domain (für absolute Links in Texten/hrefs). */
export const SITE_ORIGIN = /^https:\/\/(?:www\.)?pokeswipe-radar\.de(?=[/?#]|$)/;

/** Pfad oder absolute URL (Aufrufer übergeben nur eigene Links) für die gewählte Sprache – Englisch bekommt das Präfix /en. */
export function localePathFor(path, lang) {
  const s = String(path ?? "");
  if (lang !== "en") return s;
  const m = s.match(ORIGIN);
  const origin = m ? m[0] : "";
  const rest = s.slice(origin.length);
  if (!rest.startsWith("/en/") && LOCALIZED_PATH.test(rest)) return `${origin}/en${rest}`;
  return s;
}

// ---------------------------------------------------------------------------
// Wörterbuch
// ---------------------------------------------------------------------------
const PH = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
export const placeholders = (s) => [...String(s).matchAll(PH)].map((m) => m[1]);
export const isPattern = (s) => /\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(String(s));
/** Whitespace vereinheitlichen (Textknoten aus HTML enthalten Zeilenumbrüche/Einrückung). */
export const squash = (s) => String(s).replace(/\s+/g, " ").trim();

/** Führende/abschließende Emoji, Flaggen, Pfeile und Aufzählungszeichen (werden abgetrennt und wieder angehängt). */
const DECO = "(?:[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}\\u{1F3FB}-\\u{1F3FF}\\uFE0F\\u200D\\u20E3←→↑↓↗↘⇄↔✓✔✕✗✖•·★☆▶◀►◄»«›‹⚡]|&rarr;)";
const LEAD = new RegExp(`^((?:${DECO}|\\s)*${DECO}\\s*)`, "u");
const TRAIL = new RegExp(`(\\s*${DECO}(?:${DECO}|\\s)*)$`, "u");
/** Abschließende Satzzeichen, die auch ohne eigenen Eintrag erhalten bleiben ("Name:" → "Name" + ":"). */
const PUNCT = /(\s*(?:[:!?.…]+|\.{3}))$/;
/** Text ohne Buchstaben (Zahlen, Preise, Emoji) muss nicht übersetzt werden. */
const HAS_LETTER = /\p{L}{2,}/u;

export function splitDecor(text) {
  let core = String(text), lead = "", trail = "";
  const a = core.match(LEAD);
  if (a) { lead = a[1]; core = core.slice(lead.length); }
  const b = core.match(TRAIL);
  if (b && b[1].length < core.length) { trail = b[1]; core = core.slice(0, core.length - trail.length); }
  return { lead, core, trail };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** "Noch {n} Swipes heute" → /^Noch (.+?) Swipes heute$/ mit Namen in Reihenfolge. */
export function compilePattern(de) {
  const names = [];
  let src = "", last = 0;
  const key = squash(de);
  for (const m of key.matchAll(PH)) {
    src += escapeRe(key.slice(last, m.index)).replace(/ /g, "\\s+");
    src += "(.+?)";
    names.push(m[1]);
    last = m.index + m[0].length;
  }
  src += escapeRe(key.slice(last)).replace(/ /g, "\\s+");
  const literal = key.replace(PH, "").replace(/\s+/g, "");
  // Bucket nach dem ersten literalen Zeichen, damit nicht jedes Muster gegen jeden Text läuft
  const head = key.match(/^[^{]/) ? key[0].toLowerCase() : "";
  // längstes festes Stück als schneller Vorfilter (includes statt Regex)
  const need = key.split(PH).filter((_, i) => i % 2 === 0).map((x) => x.trim()).sort((x, y) => y.length - x.length)[0] || "";
  return { re: new RegExp(`^${src}$`, "s"), names, head, weight: literal.length, need };
}

/** Platzhalter {name} im englischen Text mit Werten füllen (unbekannte bleiben stehen). */
export function fill(template, vars = {}) {
  return String(template).replace(PH, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

/**
 * Übersetzer aus einer Liste [deutsch, englisch][] bauen.
 * @returns {{ translate(text: string): string|null, size: number, exact: Map, patterns: any[] }}
 */
export function createTranslator(entries = []) {
  const exact = new Map();
  const buckets = new Map(); // head → patterns
  const loose = []; // Muster, die mit einem Platzhalter beginnen
  let size = 0;
  for (const [de, en] of entries) {
    if (typeof de !== "string" || typeof en !== "string" || !de.trim()) continue;
    size++;
    if (isPattern(de)) {
      const p = { ...compilePattern(de), en };
      const list = p.head ? (buckets.get(p.head) || buckets.set(p.head, []).get(p.head)) : loose;
      list.push(p);
    } else exact.set(squash(de), en);
  }
  const byWeight = (a, b) => b.weight - a.weight;
  for (const l of buckets.values()) l.sort(byWeight);
  loose.sort(byWeight);

  const cache = new Map();

  function matchPatterns(core, depth = 0) {
    const lists = [buckets.get(core[0]?.toLowerCase()) || [], loose];
    for (const list of lists) {
      for (const p of list) {
        if (p.need && !core.includes(p.need)) continue;
        const m = core.match(p.re);
        if (!m) continue;
        const vars = {};
        p.names.forEach((n, i) => {
          const v = m[i + 1];
          // Werte, die selbst UI-Texte sind ("Near Mint", "vor 5 min"), mitübersetzen (begrenzt verschachtelt)
          vars[n] = (depth < 2 ? translateInner(v, depth + 1) : null) ?? v;
        });
        return fill(p.en, vars);
      }
    }
    return null;
  }

  function lookup(core, depth = 0) {
    const k = squash(core);
    if (!k || !HAS_LETTER.test(k)) return null;
    const hit = exact.get(k);
    if (hit !== undefined) return hit;
    return matchPatterns(k, depth);
  }

  function exactOnly(core) {
    const k = squash(core);
    return k ? exact.get(k) ?? null : null;
  }

  function translateInner(s, depth) {
    const ws = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const body = ws[2];
    if (!body || !HAS_LETTER.test(body)) return null;
    let out = exactOnly(body);
    if (out == null) {
      const { lead, core, trail } = splitDecor(body);
      if ((lead || trail) && core.trim()) {
        // Emoji zuerst abtrennen, sonst schlucken Muster mit führendem {platzhalter} das Emoji
        const r = lookup(core, depth) ?? withPunct(core, depth);
        out = r != null ? `${lead}${r}${trail}` : matchPatterns(squash(body), depth);
      } else out = lookup(body, depth) ?? withPunct(body, depth);
    }
    return out == null ? null : `${ws[1]}${out}${ws[3]}`;
  }

  /** Übersetzung oder null; führender/abschließender Whitespace bleibt erhalten. */
  function translate(text) {
    const s = String(text ?? "");
    if (!s.trim()) return null;
    if (cache.has(s)) return cache.get(s);
    const res = translateInner(s, 0);
    if (cache.size > 5000) cache.clear();
    cache.set(s, res);
    return res;
  }

  function withPunct(core, depth = 0) {
    const m = core.match(PUNCT);
    if (!m || m[1].length >= core.length) return null;
    const r = lookup(core.slice(0, core.length - m[1].length), depth);
    return r == null ? null : r + m[1];
  }

  return { translate, size, exact, patterns: [...[...buckets.values()].flat(), ...loose] };
}

/** Prüft ein Wörterbuch: doppelte Schlüssel, leere Werte, fehlende Platzhalter. Gibt Fehlertexte zurück. */
export function validateDictionary(entries) {
  const errors = [];
  const seen = new Map();
  entries.forEach((e, i) => {
    if (!Array.isArray(e) || e.length !== 2) { errors.push(`#${i}: kein [de, en]-Paar`); return; }
    const [de, en] = e;
    if (typeof de !== "string" || !de.trim()) errors.push(`#${i}: leerer deutscher Schlüssel`);
    if (typeof en !== "string" || !en.trim()) errors.push(`#${i}: leerer englischer Wert für "${de}"`);
    const k = squash(de);
    if (seen.has(k)) errors.push(`#${i}: doppelter Schlüssel "${de}" (zuerst #${seen.get(k)})`);
    else seen.set(k, i);
    if (typeof en === "string") {
      for (const p of placeholders(de)) if (!en.includes(`{${p}}`)) errors.push(`#${i}: Platzhalter {${p}} fehlt in "${en}"`);
    }
  });
  return errors;
}
