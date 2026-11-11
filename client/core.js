// Gemeinsame Helfer für alle Client-Module
const $ = (id) => document.getElementById(id);
const esc = (s) => (window.sanitizeHTML ? window.sanitizeHTML(s) : String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
const eur = (n) => `${Number(n || 0).toFixed(2).replace(".", ",")} €`;
const pct = (n) => `${n > 0 ? "+" : ""}${Number(n).toFixed(1).replace(".", ",")} %`;
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
const cm = (q) => (window.buildCardmarketUrl ? window.buildCardmarketUrl(q) : "#");
const FALLBACK_IMG = "https://images.pokemontcg.io/sv8/238_hires.png";

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

async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = bearer();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.status = res.status; err.upgrade = data.upgrade; err.data = data;
    throw err;
  }
  return data;
}

const hooks = { openAccount: () => {}, openPro: () => {} };

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
function modal(id, html, { wide = false, onClose } = {}) {
  let el = $(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.className = "fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto";
    el.addEventListener("click", (e) => { if (e.target === el) closeModalEl(id); });
    document.body.appendChild(el);
  }
  el._onClose = onClose;
  el.innerHTML = `<div class="poke-glass ${wide ? "max-w-3xl" : "max-w-md"} w-full rounded-3xl p-5 sm:p-6 space-y-4 border-2 border-yellow-400/60 my-6 relative">
    <button data-close class="absolute top-3 right-4 text-slate-400 hover:text-white font-bold text-lg" aria-label="Schließen">✕</button>${html}</div>`;
  el.querySelector("[data-close]").onclick = () => closeModalEl(id);
  el.classList.remove("hidden");
  return el;
}
function closeModalEl(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add("hidden");
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
  $, esc, eur, pct, toast, ebay, cm, FALLBACK_IMG, state, bearer, api, handleError, requireLogin,
  modal, closeModalEl, input, btn, sparkline, areaChart, hooks,
};
