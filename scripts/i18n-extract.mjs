#!/usr/bin/env node
// i18n-Extraktor: findet deutsche UI-Texte, die noch nicht im englischen Wörterbuch stehen.
//
//   node scripts/i18n-extract.mjs                 # fehlende Texte, gruppiert nach Datei (Datei:Zeile "Text")
//   node scripts/i18n-extract.mjs client/cart.js  # nur bestimmte Dateien prüfen (mehrere möglich)
//   node scripts/i18n-extract.mjs --stub          # fehlende Texte als ["…", ""],-Zeilen zum Einfügen ins Wörterbuch
//   node scripts/i18n-extract.mjs --json          # fehlende Texte als JSON (de, file, line, pattern)
//   node scripts/i18n-extract.mjs --all           # alle gefundenen Kandidaten (auch bereits übersetzte)
//   node scripts/i18n-extract.mjs --stats         # nur Zählung
//
// Quellen: public/index.html, public/js/*.js (ohne kuendigen*.js – deutsche Rechtsseite), client/**/*.js
// (ohne i18n*.js und die Admin-Reel-Werkzeuge, deren Bühnen bewusst Deutsch bleiben, siehe SKIP_FILES).
//
// Aus JS werden String- und Template-Literale gelesen; `${…}` wird zu einem Platzhalter {name}.
// Enthält ein Literal HTML, werden Textknoten sowie placeholder/title/aria-label/alt (und value bei
// Buttons) einzeln geprüft – genau so, wie der DOM-Übersetzer (client/i18n.js) sie später sieht.
// Neue Übersetzungen kommen in client/i18n-en-*.js als ["Deutsch", "English"]; Texte mit Platzhaltern
// sind Muster (["Noch {n} Swipes heute", "{n} swipes left today"]). Absichtlich unveränderte Texte
// (Marken, bereits Englisch, deutsche Karten-/Setnamen aus Beispieldaten) kommen in KEEP der jeweiligen Datei.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const only = args.filter((a) => !a.startsWith("--"));

export const SKIP_FILES = [
  /\/i18n[^/]*\.js$/,
  /client\/(reel-[^/]+|auto-reels|live-stage|dom-capture)\.js$/, // Admin-Reels: deutsche Videos
  /client\/scanner\/scan-worker\.js$/,
  /public\/js\/kuendigen[^/]*\.js$/,
];

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

function sourceFiles() {
  if (only.length) return only.map((f) => join(ROOT, f));
  const files = [join(ROOT, "public/index.html"), ...walk(join(ROOT, "public/js")), ...walk(join(ROOT, "client"))];
  return files.filter((f) => !SKIP_FILES.some((re) => re.test(f.replace(/\\/g, "/"))));
}

// ---------------------------------------------------------------------------
// Heuristik: ist das ein sichtbarer (deutscher) UI-Text?
// ---------------------------------------------------------------------------
const STOP = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "Authorization", "Bearer", "Bearer {token}", "Accept", "Content-Type",
  "Error", "TypeError", "AbortError", "Date", "Object", "Array", "Promise", "Escape", "Enter", "Tab", "ArrowLeft",
  "ArrowRight", "ArrowUp", "ArrowDown", "Backspace", "Shift", "Control", "Meta", "Infinity", "NaN", "JSON", "UTF-8",
  "true", "false", "null", "undefined", "Europe/Berlin", "PokeSwipe & Radar", "PokeSwipe", "Pokémon TCG",
]);
const CODEY = /=>|\bfunction\s*\(|\bconst |\blet |\breturn\b|===|!==|&&|\|\||\bdocument\.|\bwindow\.|\bPS\.|\(\)\s*[;{]|^\s*[.#][\w-]+\s*[{,]|^[\w-]+\s*:\s*[^ ]+;|;\s*[\w-]+\s*:/;
const CLASS_TOKEN = /^[!a-z0-9_\-:/.[\]%#()=@&>~+*,'"]+$/;

export function isUiText(raw) {
  const s = squash(raw);
  if (s.length < 2 || STOP.has(s)) return false;
  const literal = s.replace(/\{[a-zA-Z_]\w*\}/g, "");
  if (!/\p{L}{2,}/u.test(literal)) return false;
  if (/^(https?:|\/[\w-]|\.\/|#[\w-]|data:|mailto:|tel:|blob:|javascript:)/i.test(s)) return false;
  if (/^[\w.-]+@[\w.-]+$/.test(s)) return false;
  if (CODEY.test(s)) return false;
  if (/^[\w$.]+\(.*\)$/.test(s)) return false; // Funktionsaufruf
  if (/^\{[a-zA-Z_]\w*\}[\w./-]*$/.test(s)) return false;
  const tokens = s.split(" ");
  if (tokens.length === 1) {
    if (/^[A-ZÄÖÜ][\p{L}'’-]*[\p{L}]$/u.test(s) && !/^[A-Z][a-z]+[A-Z]/.test(s)) return true; // "Speichern", nicht "camelCase"
    if (/^[A-ZÄÖÜ]{3,}$/u.test(s)) return true; // "NEU", "PRO"
    if (/[äöüßÄÖÜ]/.test(s) && !/[_$]/.test(s)) return true;
    if (/^\p{L}+[.:!?…]$/u.test(s)) return true;
    return false;
  }
  // Tailwind-Klassen, CSS-Selektoren, Schlüssel-Listen
  const classy = tokens.filter((t) => !/^\{[a-zA-Z_]\w*\}$/.test(t));
  if (classy.every((t) => CLASS_TOKEN.test(t)) && classy.some((t) => /[-:/_.[\]]/.test(t))) return false;
  if (tokens.every((t) => /^[a-z][a-zA-Z0-9]*$/.test(t)) && tokens.some((t) => /[A-Z]/.test(t))) return false; // camelCase-Listen
  return true;
}

export const squash = (s) => String(s).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// HTML in Text-Segmente zerlegen
// ---------------------------------------------------------------------------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rarr: "→", larr: "←", uarr: "↑", darr: "↓", hellip: "…", ndash: "–", mdash: "—", middot: "·", bull: "•", euro: "€", copy: "©", times: "×", shy: "" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENT[e.toLowerCase()] ?? m;
});
export const looksHtml = (s) => /<\/?[a-zA-Z][\w-]*(\s|>|\/>|$)/.test(s);
const ATTRS = ["placeholder", "title", "aria-label", "alt"];

/** Liefert [{ text, offset }] für Textknoten und übersetzbare Attribute. */
export function htmlSegments(html) {
  const out = [];
  const cleaned = html
    .replace(/<!--[\s\S]*?-->|<![^>]*>/g, (m) => " ".repeat(m.length))
    .replace(/<(script|style|textarea)\b[\s\S]*?<\/\1>/gi, (m) => " ".repeat(m.length));
  const tagRe = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0, m;
  const pushText = (from, to) => {
    const t = cleaned.slice(from, to);
    if (t.trim()) out.push({ text: decode(t), offset: from });
  };
  while ((m = tagRe.exec(cleaned))) {
    pushText(last, m.index);
    last = tagRe.lastIndex;
    const tag = m[1].toLowerCase(), attrs = m[2] || "";
    if (/\bdata-i18n-skip\b|\btranslate=["']no["']/.test(attrs)) continue;
    for (const a of ATTRS) {
      const am = attrs.match(new RegExp(`(?:^|\\s)${a}\\s*=\\s*("([^"]*)"|'([^']*)')`));
      if (am) out.push({ text: decode(am[2] ?? am[3] ?? ""), offset: m.index });
    }
    if (tag === "input" && /\btype=["']?(button|submit)/i.test(attrs)) {
      const vm = attrs.match(/(?:^|\s)value\s*=\s*("([^"]*)"|'([^']*)')/);
      if (vm) out.push({ text: decode(vm[2] ?? vm[3] ?? ""), offset: m.index });
    }
  }
  pushText(last, cleaned.length);
  return out;
}

// ---------------------------------------------------------------------------
// JS-Literale lesen (Kommentare, Regex-Literale und verschachtelte Templates beachten)
// ---------------------------------------------------------------------------
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "else", "do", "yield", "await", "instanceof"]);
const FN_NAMES = new Set(["esc", "eur", "pct", "String", "Number", "Math", "round", "floor", "ceil", "max", "min", "abs", "encodeURIComponent", "jsArg", "cdn", "safeUrl", "safeImg", "t", "toFixed", "toLocaleString", "length", "join", "map", "filter", "slice", "trim", "toUpperCase", "toLowerCase", "fmt", "escAttr", "sanitizeHTML", "Date", "JSON", "stringify", "parse", "replace", "localePath", "fmtDate", "fmtNum", "num", "s", "e"]);

function phName(expr) {
  const head = expr.split(/\?(?!\.)/)[0];
  const ids = [...head.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]).filter((x) => !FN_NAMES.has(x) && !/^\$/.test(x));
  const n = (ids[ids.length - 1] || "x").replace(/[^\w]/g, "");
  return /^[a-zA-Z_]/.test(n) ? n : "x";
}

function unescapeJs(s) {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, e) => {
    if (e[0] === "u" && e[1] === "{") return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === "u" && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === "x" && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: "\n", t: "\t", r: "", "\n": "", b: "", f: "", v: "", 0: "" }[e] ?? e;
  });
}

/** Ruft onLiteral(text, offset) für jedes String-/Template-Literal auf (Templates mit {platzhaltern}). */
export function scanJs(src, onLiteral) {
  let i = 0;
  const n = src.length;
  function scan(stopAtBrace) {
    let regexOk = true, depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === "'" || c === '"') {
        const start = i; i++;
        let raw = "";
        while (i < n && src[i] !== c && src[i] !== "\n") { if (src[i] === "\\") { raw += src[i] + src[i + 1]; i += 2; } else raw += src[i++]; }
        i++;
        onLiteral(unescapeJs(raw), start, false);
        regexOk = false; continue;
      }
      if (c === "`") { const start = i; i++; const { text, hasExpr } = template(); onLiteral(text, start, hasExpr); regexOk = false; continue; }
      if (c === "/" && regexOk) {
        // Regex-Literal bis zum schließenden / (Klassen [...] beachten); bei Zeilenumbruch war es doch eine Division
        let j = i + 1, inClass = false, ok = false;
        while (j < n && src[j] !== "\n") {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) { ok = true; break; }
          j++;
        }
        if (ok) { i = j + 1; while (/[a-z]/i.test(src[i] || "")) i++; regexOk = false; continue; }
      }
      if (c === "{") { depth++; i++; regexOk = true; continue; }
      if (c === "}") {
        if (stopAtBrace && depth === 0) { i++; return; }
        depth--; i++; regexOk = true; continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
        regexOk = REGEX_AFTER_WORD.has(src.slice(i, j)); i = j; continue;
      }
      if (/[0-9]/.test(c)) { while (i < n && /[\w.]/.test(src[i])) i++; regexOk = false; continue; }
      if (c === ")" || c === "]") { regexOk = false; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      regexOk = true; i++;
    }
  }
  function template() {
    let text = "", raw = "", hasExpr = false;
    const used = new Map();
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") { raw += src[i] + src[i + 1]; i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") {
        text += unescapeJs(raw); raw = "";
        i += 2; const s = i; scan(true);
        let name = phName(src.slice(s, i - 1));
        const k = (used.get(name) || 0) + 1; used.set(name, k);
        if (k > 1) name += k;
        text += `{${name}}`; hasExpr = true; continue;
      }
      raw += src[i++];
    }
    i++;
    return { text: text + unescapeJs(raw), hasExpr };
  }
  scan(false);
}

// ---------------------------------------------------------------------------
// Kandidaten sammeln
// ---------------------------------------------------------------------------
export function extract(file, src) {
  const out = [];
  const lineOf = (off) => src.slice(0, off).split("\n").length;
  const add = (text, off) => {
    const s = squash(text);
    if (isUiText(s)) out.push({ de: s, file, line: lineOf(off), pattern: /\{[a-zA-Z_]\w*\}/.test(s) });
  };
  if (file.endsWith(".html")) {
    for (const seg of htmlSegments(src)) add(seg.text, seg.offset);
    return out;
  }
  scanJs(src, (text, off) => {
    if (looksHtml(text)) for (const seg of htmlSegments(text)) add(seg.text, off);
    else if (/(?:^|\s)[\w-]+\s*=\s*["']/.test(text)) for (const seg of htmlSegments(`<x ${text}>`)) add(seg.text, off); // Attribut-Fragmente für input(id, 'placeholder="…"')
    else add(text, off);
  });
  return out;
}

async function main() {
  const { createTranslator } = await import("../client/i18n-core.js");
  const dict = await import("../client/i18n-en.js");
  const tr = createTranslator(dict.default);
  const keep = new Set((dict.KEEP || []).map(squash));
  const covered = (c) => {
    if (keep.has(c.de)) return true;
    const sample = c.de.replace(/\{[a-zA-Z_]\w*\}/g, "7");
    if (tr.translate(sample) != null) return true;
    return keep.has(sample);
  };
  const all = [];
  for (const f of sourceFiles()) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    all.push(...extract(rel, readFileSync(f, "utf8")));
  }
  const list = flags.has("--all") ? all : all.filter((c) => !covered(c));
  // pro Text nur einmal (erste Fundstelle)
  const seen = new Set();
  const uniq = list.filter((c) => (seen.has(c.de) ? false : (seen.add(c.de), true)));
  if (flags.has("--stats")) {
    const total = new Set(all.map((c) => c.de)).size;
    console.log(`Kandidaten: ${total}, fehlend: ${uniq.length}, Wörterbuch: ${tr.size} Einträge, KEEP: ${keep.size}`);
    return;
  }
  if (flags.has("--json")) { console.log(JSON.stringify(uniq, null, 1)); return; }
  if (flags.has("--stub")) {
    for (const c of uniq) console.log(`  [${JSON.stringify(c.de)}, ""], // ${c.file}:${c.line}`);
    return;
  }
  let cur = "";
  for (const c of uniq) {
    if (c.file !== cur) { cur = c.file; console.log(`\n# ${cur}`); }
    console.log(`${c.line}\t${JSON.stringify(c.de)}`);
  }
  console.error(`\n${uniq.length} fehlende Texte (Wörterbuch: ${tr.size} Einträge)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
