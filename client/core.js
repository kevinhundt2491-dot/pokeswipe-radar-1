// Gemeinsame Helfer für alle Client-Module
import { classifyUnauthorized, withUrlParams } from "./session-logic.js";
const $ = (id) => document.getElementById(id);
const esc = (s) => (window.sanitizeHTML ? window.sanitizeHTML(s) : String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
/** Wert als sicheres JS-String-Argument in einem onclick="…"-Attribut (JSON + HTML-Escaping inkl. &). */
const jsArg = (v) => esc(JSON.stringify(String(v ?? "")));
// Preise/Prozente: Deutsch "12,50 €" / "+3,4 %", Englisch (window.psLang aus client/i18n.js, en-IE) "€12.50" / "+3.4%"
const eur = (n) => {
  const en = globalThis.psLang === "en";
  const v = (Number(n) || 0).toLocaleString(en ? "en-IE" : "de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return en ? `€${v}` : `${v}\u00A0€`;
};
const pct = (n) => (globalThis.psLang === "en"
  ? `${n > 0 ? "+" : ""}${Number(n).toFixed(1)}%`
  : `${n > 0 ? "+" : ""}${Number(n).toFixed(1).replace(".", ",")} %`);
/**
 * In-App-Banner (+ Ton) ohne zusätzliche Browser-Benachrichtigung – echte Push-Nachrichten
 * kommen vom Server, so gibt es keine Doppelungen.
 */
const toast = (title, body = "", link = "") => {
  const box = document.getElementById("live-push-toast");
  if (!box) return alert(`${title}\n${body}`);
  try { if (typeof pushSettings === "undefined" || pushSettings.sound !== false) window.playPokePingSound?.(); } catch {}
  document.getElementById("toast-title").textContent = title;
  document.getElementById("toast-body").textContent = body;
  const linkEl = document.getElementById("toast-link");
  if (linkEl) {
    if (link && /^https:\/\//.test(link)) { linkEl.href = link; linkEl.classList.remove("hidden"); }
    else linkEl.classList.add("hidden");
  }
  box.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => box.classList.add("hidden"), 6500);
};
const ebay = (q) => (window.buildEbayUrl ? window.buildEbayUrl(q, "bin") : "#");
/** Offizielle Cardmarket-Kartensuche – Fallback, falls das Tracking-Skript (Partner-ID) noch nicht geladen ist. */
const cmFallback = (q) => (q ? `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(String(q).slice(0, 120))}` : "https://www.cardmarket.com/de/Pokemon");
const cm = (q) => (window.buildCardmarketUrl ? window.buildCardmarketUrl(q) : cmFallback(q));
const FALLBACK_IMG = "/card-fallback.svg";
/** Kartenbild über das Netlify Image CDN: passend verkleinert und als WebP/AVIF ausgeliefert. */
const CDN_HOSTS = ["assets.tcgdex.net", "images.pokemontcg.io", "raw.githubusercontent.com"];
/**
 * Sichere Link-Ziele für href/location: nur https: (optional http:) oder Pfade auf der eigenen Seite.
 * Alles andere (javascript:, data:, vbscript:, …) ergibt "" – Aufrufer zeigen dann keinen Link an.
 */
const safeUrl = (u, { http = false } = {}) => {
  const s = String(u ?? "").trim();
  if (!s) return "";
  try {
    const p = new URL(s, location.origin);
    if (p.protocol === "https:" || (http && p.protocol === "http:")) return s;
    // relative Pfade ("/api/images/…") auch im lokalen http-Entwicklungsmodus
    if (p.origin === location.origin && /^\/(?![\/\\])/.test(s)) return s;
  } catch {}
  return "";
};
/** Sichere Bildquelle: https:, eigene Pfade oder eingebettete Rasterbilder (data:image/jpeg|png|webp|gif). */
const safeImg = (u) => {
  const s = String(u ?? "").trim();
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(s)) return s;
  return safeUrl(s);
};
const cdn = (url, w = 240) => {
  const s = safeImg(url);
  if (!s) return FALLBACK_IMG;
  if (location.hostname === "localhost" && location.port !== "8889") return s;
  if (s.startsWith("/api/images/")) return `/.netlify/images?url=${encodeURIComponent(s)}&w=${w}`;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && CDN_HOSTS.includes(u.hostname) ? `/.netlify/images?url=${encodeURIComponent(s)}&w=${w}` : s;
  } catch { return s; }
};

const state = {
  user: null, me: null, settings: null, listings: [], portfolio: null, alerts: null,
  trades: [], notifications: [], unread: 0, lastNotifId: Number(localStorage.getItem("ps_last_notif") || 0),
  openTrade: null, chatTimer: null, lastMsgId: 0, recovery: false, invite: null,
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
function bearer() {
  try {
    const raw = JSON.parse(localStorage.getItem("gotrue.user") || "null");
    return raw?.token?.access_token || "";
  } catch { return ""; }
}

async function api(path, { method = "GET", body, _retry = false } = {}) {
  // Schreibende Anfragen immer als JSON senden – der Server lehnt sonst ab (CSRF-Schutz, auch für DELETE ohne Inhalt)
  if (method !== "GET" && method !== "HEAD" && body === undefined) body = {};
  const headers = { Accept: "application/json", "Accept-Language": globalThis.psLang === "en" ? "en" : "de" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Dauerhaft angemeldet: abgelaufenes Zugangs-Token vor dem Aufruf erneuern (client/session.js)
  try { await hooks.freshToken({ force: false }); } catch {}
  const token = bearer();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch {}
  let status = res.status;
  // 401 trotz gespeicherter Sitzung: Token erneuern und einmal wiederholen, statt den Nutzer abzumelden.
  // Scheitert die Erneuerung nur am Netz/Server (Funkloch, Kaltstart), bleibt man angemeldet: Fehler wie 503 behandeln.
  if (status === 401 && token) {
    let renewed = false;
    if (!_retry) { try { renewed = await hooks.freshToken({ force: true }); } catch {} }
    const verdict = classifyUnauthorized({
      hadToken: true, retried: _retry, refreshOutcome: renewed ? "ok" : hooks.refreshOutcome(), sessionStillStored: Boolean(bearer()),
    });
    if (verdict === "retry" && bearer()) return api(path, { method, body, _retry: true });
    if (verdict === "transient") {
      status = 503;
      data = { ...data, error: "Verbindung kurz unterbrochen – du bleibst angemeldet. Bitte gleich erneut versuchen.", retry: true };
    }
  }
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${status}`);
    err.status = status; err.upgrade = data.upgrade; err.data = data;
    // Vorübergehend (Netz, Kaltstart, Identity kurz weg) – niemals ein Grund für eine Abmeldung
    err.transient = status === 503 || status === 502 || status === 504 || Boolean(data.retry);
    throw err;
  }
  return data;
}

const hooks = { openAccount: () => {}, openPro: () => {}, freshToken: async () => false, refreshOutcome: () => "none" };

function handleError(e) {
  if (e.status === 401) { hooks.openAccount(); return; }
  if (e.upgrade) { toast("🔒 Limit erreicht", e.message); hooks.openPro(); return; }
  toast("⚠️ Hinweis", e.message);
}

const requireLogin = () => {
  if (state.user) return true;
  hooks.openAccount("Bitte melde dich an – kostenlos in 20 Sekunden.");
  return false;
};

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Adresse (Tab/Unterbereich) ohne Neuladen aktualisieren – der gewählte Bereich bleibt beim Neuladen stehen
// ---------------------------------------------------------------------------
function syncUrl(params, { push = false, state: st } = {}) {
  try {
    const next = withUrlParams(location.href, params);
    if (!next || next === location.pathname + location.search + location.hash) return;
    history[push ? "pushState" : "replaceState"](st !== undefined ? st : history.state, "", next);
  } catch {}
}

// Fenster, deren Zustand in der Adresse steht (?tab=admin, ?tab=admin&section=creators) – öffnen/schließen spiegelt die URL
const URL_MODALS = {
  "ps-admin": { open: { tab: "admin" }, close: () => ({ tab: "profile", section: null }) },
  "ps-creators": { open: { tab: "admin", section: "creators" }, close: () => ({ section: null, tab: $("ps-admin") && !$("ps-admin").classList.contains("hidden") ? "admin" : "profile" }) },
};

// Letzte Nutzer-Aktion: Neu-Zeichnen direkt nach einem Tipp/Klick ist gewollt (z. B. nächster Schritt) → dann nichts festhalten
let lastInteract = 0;
try {
  for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, () => { lastInteract = Date.now(); }, { capture: true, passive: true });
} catch {}

/** Bildlauf & Eingabe eines bereits offenen Fensters merken (Hintergrund-Aktualisierung darf nichts springen lassen). */
function captureModalView(el) {
  const scrollers = [el, ...el.querySelectorAll(".overflow-y-auto, .overflow-auto, [data-keep-scroll]")];
  const scroll = scrollers.map((n) => n.scrollTop);
  const a = document.activeElement;
  const focus = a && el.contains(a) && a.id && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)
    ? { id: a.id, value: a.value, start: a.selectionStart, end: a.selectionEnd } : null;
  return { scroll, focus };
}
function restoreModalView(el, view) {
  const scrollers = [el, ...el.querySelectorAll(".overflow-y-auto, .overflow-auto, [data-keep-scroll]")];
  scrollers.forEach((n, i) => { if (view.scroll[i]) n.scrollTop = view.scroll[i]; });
  if (view.focus) {
    const f = document.getElementById(view.focus.id);
    if (f && el.contains(f)) {
      if (f.value !== view.focus.value && typeof view.focus.value === "string") f.value = view.focus.value;
      try { f.focus({ preventScroll: true }); if (view.focus.start != null) f.setSelectionRange(view.focus.start, view.focus.end); } catch {}
    }
  }
}

function modal(id, html, { wide = false, onClose } = {}) {
  let el = $(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.className = "fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto";
    el.addEventListener("click", (e) => { if (e.target === el) closeModalEl(id); });
    document.body.appendChild(el);
  }
  // Schon offen (z. B. Live-Aktualisierung der Online-Liste)? Bildlauf und gerade getippte Eingabe beibehalten
  const wasOpen = !el.classList.contains("hidden") && el.childElementCount > 0;
  const background = Date.now() - lastInteract > 1500;
  const view = wasOpen ? captureModalView(el) : null;
  if (view && !background) { view.scroll = []; view.focus = null; } // gewollter Wechsel direkt nach Tipp/Klick: normal neu zeichnen
  el._onClose = onClose;
  el.innerHTML = `<div class="poke-glass ${wide ? "max-w-3xl" : "max-w-md"} w-full rounded-3xl p-5 sm:p-6 space-y-4 border-2 border-yellow-400/60 my-6 relative">
    <button data-close class="absolute top-3 right-4 text-slate-400 hover:text-white font-bold text-lg" aria-label="Schließen">✕</button>${html}</div>`;
  el.querySelector("[data-close]").onclick = () => closeModalEl(id);
  el.classList.remove("hidden");
  if (view) restoreModalView(el, view);
  if (!wasOpen && URL_MODALS[id]) syncUrl(URL_MODALS[id].open);
  return el;
}
function closeModalEl(id) {
  const el = $(id);
  if (!el) return;
  const wasOpen = !el.classList.contains("hidden");
  el.classList.add("hidden");
  if (wasOpen && URL_MODALS[id]) syncUrl(URL_MODALS[id].close());
  if (el._onClose) el._onClose();
}

const input = (id, attrs = "") => `<input id="${id}" ${attrs} class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-yellow-400 outline-none" />`;
const btn = (label, onclick, cls = "bg-yellow-400 text-slate-950") => `<button onclick="${onclick}" class="${cls} font-black py-2.5 px-3 rounded-xl text-xs">${label}</button>`;

function sparkline(values, w = 120, h = 32, color = "#34d399") {
  const v = values.map(Number).filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 2) return `<svg width="${w}" height="${h}"><text x="0" y="${h / 2 + 4}" fill="#64748b" font-size="10">Verlauf folgt</text></svg>`;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 3 - ((x - min) / span) * (h - 6)).toFixed(1)}`).join(" ");
  const c = v[v.length - 1] >= v[0] ? color : "#fb7185";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" points="${pts}"/></svg>`;
}

function areaChart(points, w = 640, h = 160) {
  const v = points.map((p) => Number(p.value)).filter(Number.isFinite);
  if (v.length < 2) {
    return `<div class="h-36 flex items-center justify-center text-xs text-slate-400 text-center px-6">📈 Der Wertverlauf baut sich automatisch auf – der Tracker speichert jeden Tag den Wert deiner Sammlung.</div>`;
  }
  const min = Math.min(...v) * 0.97, max = Math.max(...v) * 1.03, span = max - min || 1;
  const xy = v.map((x, i) => [(i / (v.length - 1)) * w, h - ((x - min) / span) * h]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = v[v.length - 1] >= v[0];
  const col = up ? "#34d399" : "#fb7185";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="w-full h-36">
    <defs><linearGradient id="pfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <polygon fill="url(#pfg)" points="0,${h} ${line} ${w},${h}"/>
    <polyline fill="none" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke" points="${line}"/>
  </svg>
  <div class="flex justify-between text-[10px] text-slate-500"><span>${esc(points[0].day)}</span><span>${esc(points[points.length - 1].day)}</span></div>`;
}


export {
  $, esc, jsArg, safeUrl, safeImg, eur, pct, toast, ebay, cm, FALLBACK_IMG, cdn, state, bearer, api, handleError, requireLogin,
  modal, closeModalEl, input, btn, sparkline, areaChart, hooks, syncUrl,
};
