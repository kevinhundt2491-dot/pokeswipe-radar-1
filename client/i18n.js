// i18n – englische Oberfläche per DOM-Übersetzung.
//
// Die App-Texte stehen verstreut in index.html, public/js/*.js und client/*.js. Statt jede Stelle
// umzuschreiben, übersetzt dieser Layer bei englischer Oberfläche alle Textknoten und die Attribute
// placeholder/title/aria-label/alt (+ value bei Buttons) – auch später gerenderte Inhalte (MutationObserver).
// Deutsch ist Standard und kostet nichts: Wörterbuch und Observer werden nur für Englisch geladen.
//
// API:  lang() → "de" | "en",  t("Deutsch {n}", { n }) → übersetzter/gefüllter Text,
//       localePath("/karte/…") → "/en/karte/…" bei Englisch,  setLang("en"),  i18nReady (Promise),
//       langSwitchHtml() → DE/EN-Umschalter (data-ps-lang, per addEventListener verdrahtet).
// Nutzerinhalte schützen: data-i18n-skip oder translate="no" am Container.
import { detectLang, createTranslator, fill, squash, localePathFor, LANG_KEY, SITE_ORIGIN } from "./i18n-core.js";

const hasDom = typeof document !== "undefined";
const safeStore = {
  get() { try { return localStorage.getItem(LANG_KEY) || ""; } catch { return ""; } },
  set(v) { try { localStorage.setItem(LANG_KEY, v); } catch {} },
};

const detected = detectLang({
  search: hasDom ? location.search : "",
  stored: hasDom ? safeStore.get() : "",
  language: typeof navigator !== "undefined" ? navigator.language : "",
  languages: typeof navigator !== "undefined" ? navigator.languages : [],
});
if (detected.fromUrl) safeStore.set(detected.lang);
const current = detected.lang;
if (hasDom) {
  window.psLang = current;
  document.documentElement.lang = current;
}

/** Aktuelle Oberflächensprache. */
export const lang = () => current;
/** Locale für Zahlen/Preise. */
export const numberLocale = () => (current === "en" ? "en-IE" : "de-DE");
/** Pfad für öffentliche Seiten in der aktiven Sprache (/karte/x → /en/karte/x). */
export const localePath = (path) => localePathFor(path, current);

let translator = null;
let rawMap = new Map(); // Wörterbuch-Schlüssel (inkl. Muster) → Englisch, für t() mit vars

/** Deutschen Text übersetzen (bei Deutsch nur Platzhalter füllen). */
export function t(german, vars) {
  const de = String(german ?? "");
  if (current !== "en" || !translator) return vars ? fill(de, vars) : de;
  const raw = rawMap.get(squash(de));
  if (raw !== undefined) return vars ? fill(raw, vars) : raw;
  const filled = vars ? fill(de, vars) : de;
  return translator.translate(filled) ?? filled;
}
const tr = (s) => (typeof s === "string" && translator ? translator.translate(s) ?? s : s);

/** Sprache wechseln: speichern und neu laden (Server-Antworten und Formatierungen kommen dann passend). */
export function setLang(l) {
  if (l !== "de" && l !== "en") return;
  safeStore.set(l);
  if (l === current) return;
  const u = new URL(location.href);
  u.searchParams.delete("lang");
  location.replace(u.toString());
}

/** DE/EN-Umschalter als HTML (ohne Inline-JS – Klicks fängt ein Listener auf document ab). */
export function langSwitchHtml(extraClass = "") {
  // Hervorhebung der aktiven Sprache per CSS (html[lang] – siehe index.html), dadurch auch statisch nutzbar
  const b = (l, label, title) => `<button type="button" data-ps-lang="${l}" aria-pressed="${current === l}" title="${title}" class="px-2 py-1 rounded-lg font-black text-slate-300 hover:text-white">${label}</button>`;
  return `<div class="ps-lang-switch inline-flex items-center gap-0.5 bg-slate-900 border border-slate-600 rounded-xl p-0.5 text-[11px] ${extraClass}" role="group" aria-label="Sprache / Language" data-i18n-skip translate="no">${b("de", "DE", "Deutsch")}${b("en", "EN", "English")}</div>`;
}

// ---------------------------------------------------------------------------
// DOM-Übersetzer (nur Englisch)
// ---------------------------------------------------------------------------
const SKIP_SEL = "script,style,textarea,code,noscript,[contenteditable]:not([contenteditable=false]),[data-i18n-skip],[translate=no],.notranslate";
const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const BUTTON_INPUT = /^(button|submit|reset)$/i;
const textDone = new WeakMap(); // Textknoten → { src, out }
const attrDone = new WeakMap(); // Element → Map(attr → { src, out })

function doText(node) {
  const cur = node.data;
  const rec = textDone.get(node);
  if (rec && cur === rec.out) return;
  const out = translator.translate(cur);
  if (out != null && out !== cur) {
    const p = node.parentNode;
    // <option> ohne value-Attribut: Wert = Text → Original als value festhalten, sonst ändert sich select.value
    if (p && p.nodeName === "OPTION" && !p.hasAttribute("value")) p.setAttribute("value", p.textContent);
    textDone.set(node, { src: cur, out });
    node.data = out;
  } else textDone.set(node, { src: cur, out: cur });
}

function doAttr(el, name) {
  const cur = el.getAttribute(name);
  if (cur == null || !cur.trim()) return;
  let m = attrDone.get(el);
  const rec = m && m.get(name);
  if (rec && cur === rec.out) return;
  if (!m) attrDone.set(el, (m = new Map()));
  const out = translator.translate(cur);
  if (out != null && out !== cur) { m.set(name, { src: cur, out }); el.setAttribute(name, out); }
  else m.set(name, { src: cur, out: cur });
}

function doHref(el) {
  const h = el.getAttribute("href");
  // nur eigene Links: relative Pfade, gleiche Origin oder pokeswipe-radar.de
  if (!h || !((h[0] === "/" && h[1] !== "/") || h.startsWith(`${location.origin}/`) || SITE_ORIGIN.test(h))) return;
  const out = localePath(h);
  if (out !== h) el.setAttribute("href", out);
}

function doElement(el) {
  for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
  if (el.nodeName === "INPUT" && BUTTON_INPUT.test(el.type) && el.hasAttribute("value")) doAttr(el, "value");
  else if (el.nodeName === "A") doHref(el);
}

const skipped = (el) => !!(el && el.closest && el.closest(SKIP_SEL));

function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) { if (!skipped(root.parentElement)) doText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    if (skipped(root)) return;
    doElement(root);
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP_SEL) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else doElement(n);
  }
}

function onMutations(records) {
  const roots = new Set();
  for (const r of records) {
    if (r.type === "childList") r.addedNodes.forEach((n) => roots.add(n));
    else if (r.type === "characterData") { if (!skipped(r.target.parentElement)) doText(r.target); }
    else if (r.type === "attributes" && r.target.isConnected && !skipped(r.target)) {
      if (r.attributeName === "href") { if (r.target.nodeName === "A") doHref(r.target); }
      else if (r.attributeName !== "value" || (r.target.nodeName === "INPUT" && BUTTON_INPUT.test(r.target.type))) doAttr(r.target, r.attributeName);
    }
  }
  // Nur verbundene Wurzeln, und keine, die in einer anderen Wurzel stecken (wird ohnehin mitgelaufen)
  for (const n of roots) {
    if (!n.isConnected) continue;
    let p = n.parentNode, inner = false;
    while (p) { if (roots.has(p)) { inner = true; break; } p = p.parentNode; }
    if (!inner) walk(n);
  }
}

function translateTitle() {
  const out = translator.translate(document.title);
  if (out && out !== document.title) document.title = out;
}

function wrapDialogs() {
  const { alert, confirm, prompt } = window;
  // zeilenweise übersetzen (z. B. toast()-Fallback "Titel\nText")
  const trLines = (m) => (typeof m === "string" ? m.split("\n").map(tr).join("\n") : m);
  window.alert = (m) => alert.call(window, trLines(m));
  window.confirm = (m) => confirm.call(window, trLines(m));
  window.prompt = (m, d) => prompt.call(window, trLines(m), d);
  // Teilen-Bilder (Canvas) und Share-Texte entstehen außerhalb des DOM
  const C2D = window.CanvasRenderingContext2D?.prototype;
  if (C2D) {
    const fillText = C2D.fillText, strokeText = C2D.strokeText, measureText = C2D.measureText;
    C2D.fillText = function (s, ...a) { return fillText.call(this, tr(s), ...a); };
    C2D.strokeText = function (s, ...a) { return strokeText.call(this, tr(s), ...a); };
    C2D.measureText = function (s) { return measureText.call(this, tr(s)); };
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    const share = navigator.share.bind(navigator);
    navigator.share = (data) => share(data && typeof data === "object"
      ? { ...data, ...(data.title ? { title: trLines(data.title) } : {}), ...(data.text ? { text: trLines(data.text) } : {}) }
      : data);
  }
}

/**
 * Viele Module formatieren Datum/Zahlen fest mit "de-DE". Bei englischer Oberfläche wird genau
 * dieses Locale (und "de") auf en-GB (Datum, TT/MM/JJJJ) bzw. en-IE (Zahlen, Punkt als Dezimaltrenner) umgelenkt.
 */
function patchLocales() {
  const isDe = (l) => l === "de-DE" || l === "de";
  const wrap = (proto, name, to) => {
    const orig = proto[name];
    proto[name] = function (locales, opts) { return orig.call(this, isDe(locales) ? to : locales, opts); };
  };
  wrap(Date.prototype, "toLocaleDateString", "en-GB");
  wrap(Date.prototype, "toLocaleTimeString", "en-GB");
  wrap(Date.prototype, "toLocaleString", "en-GB");
  wrap(Number.prototype, "toLocaleString", "en-IE");
}

/** aria-pressed der statischen Umschalter (index.html) setzen. */
function syncSwitches() {
  document.querySelectorAll("[data-ps-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-ps-lang") === current)));
}

function reveal() { document.documentElement.classList.remove("ps-i18n-pending"); }

function start() {
  translateTitle();
  walk(document.body);
  new MutationObserver(onMutations).observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: [...ATTRS, "value", "href"],
  });
  // Toasts/Modals sitzen teils direkt an <body>; <title> ändert sich bei Seitenwechseln
  const titleEl = document.querySelector("title");
  if (titleEl) new MutationObserver(translateTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
  reveal();
}

/** Erfüllt, sobald das Wörterbuch geladen und die erste Übersetzung gelaufen ist (bei Deutsch sofort). */
export const i18nReady = !hasDom || current !== "en"
  ? Promise.resolve()
  : import("./i18n-en.js").then((mod) => {
    translator = createTranslator(mod.default);
    rawMap = new Map(mod.default.map(([de, en]) => [squash(de), en]));
    wrapDialogs();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }).catch((e) => { console.warn("[i18n] Wörterbuch nicht geladen", e); reveal(); });

// ---------------------------------------------------------------------------
// Verdrahtung: Umschalter, Accept-Language
// ---------------------------------------------------------------------------
if (hasDom) {
  if (current === "en") patchLocales();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncSwitches, { once: true });
  else syncSwitches();
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest ? e.target.closest("[data-ps-lang]") : null;
    if (!b) return;
    e.preventDefault();
    setLang(b.getAttribute("data-ps-lang"));
  });
  // Auch Legacy-Skripte nutzen fetch direkt – für eigene Anfragen die Sprache mitsenden
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = (input, init) => {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : null;
        if (url != null && new URL(url, location.href).origin === location.origin) {
          const headers = new Headers((init && init.headers) || {});
          if (!headers.has("Accept-Language")) headers.set("Accept-Language", current);
          init = { ...(init || {}), headers };
        }
      } catch {}
      return nativeFetch.call(window, input, init);
    };
  }
  window.psI18n = { lang, t, setLang, localePath, ready: i18nReady };
}
