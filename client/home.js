// PokeSwipe & Radar – Start-Dashboard (view-home): kompakt, ohne endloses Scrollen.
//   1. Live-Karten-Scanner (Hero-Aktion, statisch in index.html)
//   2. Marktplatz & Tausch-Radar – Vorschau aktueller Karten-Highlights
//   3. Live-Chat – letzte Nachrichten + Eingabe (Schreiben lädt freundlich zur 1-Klick-Anmeldung ein)
//   4. Mein Binder – Wert, Anzahl, kleine Kartenleiste
// Neue Besucher sehen alles sofort, ohne Registrierungswand; eine kleine Willkommens-Karte erklärt den Gast-Modus.
import { $, esc, eur, cdn, state, FALLBACK_IMG } from "./core.js";
import { marketHighlights, conditionShort, setCodeOf } from "./market-filter-logic.js";

const WELCOME_KEY = "ps_home_welcome_done";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const ago = (d) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "jetzt";
  if (s < 3600) return `${Math.round(s / 60)} Min.`;
  if (s < 86400) return `${Math.round(s / 3600)} Std.`;
  return new Date(d).toLocaleDateString("de-DE");
};

// ---------------------------------------------------------------------------
// Willkommen (nur für Gäste beim ersten Besuch, nicht blockierend)
// ---------------------------------------------------------------------------
function renderWelcome() {
  const box = $("ps-home-welcome");
  if (!box) return;
  if (state.user || lsGet(WELCOME_KEY)) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="ps-card ps-welcome p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
    <p class="text-slate-200 min-w-0"><strong class="text-white">Willkommen! 👋</strong> Scanne, stöbere und lies den Chat sofort – ganz ohne Anmeldung. Dein Binder bleibt auf diesem Gerät und zieht beim Login mit ins Konto um.</p>
    <span class="flex gap-1.5 shrink-0">
      <button type="button" onclick="PS.renderLogin('', 'signup')" class="bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-xl">In 1 Klick sichern</button>
      <button type="button" onclick="PS.homeWelcomeDone()" class="text-slate-300 font-bold px-2" aria-label="Hinweis ausblenden">✕</button>
    </span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Marktplatz-Vorschau
// ---------------------------------------------------------------------------
function miniTile(l) {
  const cond = conditionShort(l.condition);
  const code = setCodeOf(l);
  return `<button type="button" onclick="PS.openListing(${Number(l.id)})" class="ps-mini-tile text-left" aria-label="${esc(l.card_name)} ansehen">
    <span class="ps-mini-art"><img src="${esc(cdn(l.image || FALLBACK_IMG, 220))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" class="${String(l.image || "").startsWith("/api/images/") ? "object-cover" : "object-contain"}" />
      ${cond ? `<span class="ps-badge ps-badge-cond absolute top-1 left-1">${esc(cond)}</span>` : ""}</span>
    <span class="block text-[11px] font-black text-white truncate mt-1">${esc(l.card_name)}</span>
    <span class="flex items-baseline justify-between gap-1"><span class="text-xs font-black text-emerald-300">${Number(l.price) > 0 ? eur(l.price) : "Tausch"}</span>${code ? `<span class="text-[9px] text-slate-500 truncate">${esc(code)}</span>` : ""}</span>
  </button>`;
}

function renderMarketPreview() {
  const box = $("home-market-grid");
  if (!box) return;
  const items = marketHighlights(state.listings, 4);
  if (!items.length) {
    box.innerHTML = `<div class="col-span-full ps-empty text-xs text-slate-300 text-center py-5 space-y-2">
      <p>Noch keine Angebote geladen – sei der Erste und inseriere eine Karte.</p>
      <button type="button" onclick="PS.openScanner()" class="bg-emerald-500 text-slate-950 font-black px-3 py-1.5 rounded-xl">📷 Scannen &amp; inserieren</button></div>`;
    return;
  }
  box.innerHTML = items.map(miniTile).join("");
}

// ---------------------------------------------------------------------------
// Live-Chat-Modul
// ---------------------------------------------------------------------------
function renderChat(list) {
  const box = $("home-chat-list");
  if (!box) return;
  const msgs = (Array.isArray(list) ? list : window.PS?.chatMessages?.() || []).slice(-4);
  const input = $("home-chat-input");
  if (input) input.placeholder = state.user ? "Nachricht an alle Sammler …" : "Mitschreiben? Kurz anmelden (1 Klick)";
  if (!msgs.length) { box.innerHTML = `<p class="text-slate-500 py-4 text-center">Noch ruhig hier – schreib die erste Nachricht! 💬</p>`; return; }
  box.innerHTML = msgs.map((m) => `<p class="ps-chat-line"><strong class="text-yellow-300">${esc(m.author?.name || "Sammler")}</strong>${m.author?.founder ? ` <span class="ps-founder-chip" title="Verifizierter Gründer-Sammler">🏅</span>` : ""}
    <span class="text-slate-200" data-i18n-skip>${esc(m.body)}</span><span class="text-[9px] text-slate-500 ml-1">${esc(ago(m.createdAt))}</span></p>`).join("");
}

// ---------------------------------------------------------------------------
// Binder
// ---------------------------------------------------------------------------
function binderItems() {
  if (state.user && state.portfolio?.items) return state.portfolio.items;
  try { const v = JSON.parse(lsGet("pokeswipe_portfolio_clean") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

function renderBinder() {
  const items = binderItems();
  const count = items.reduce((n, i) => n + (Number(i.quantity) || 1), 0);
  const cnt = $("home-binder-count");
  if (cnt) cnt.textContent = String(count);
  const strip = $("home-binder-strip");
  if (!strip) return;
  const imgs = items.map((i) => i.image || i.img || "").filter(Boolean).slice(0, 6);
  strip.innerHTML = imgs.length
    ? imgs.map((src) => `<img src="${esc(cdn(src, 120))}" onerror="this.remove()" loading="lazy" alt="" class="h-14 w-10 object-contain rounded-md bg-slate-950/60" />`).join("")
    : `<span class="text-[11px] text-slate-400 self-center">Noch leer – scanne deine erste Karte, sie landet sofort hier.</span>`;
  const total = state.user && state.portfolio ? Number(state.portfolio.total) : NaN;
  if (Number.isFinite(total) && $("statPortfolioVal")) $("statPortfolioVal").textContent = eur(total);
}

export function renderHome() {
  renderWelcome();
  renderMarketPreview();
  renderChat();
  renderBinder();
}

export function initHome() {
  renderHome();
  window.addEventListener("ps:listings", () => renderMarketPreview());
  window.addEventListener("ps:chat", (e) => renderChat(e.detail));
  window.addEventListener("ps:plan", () => { renderWelcome(); renderChat(); renderBinder(); });
  window.addEventListener("ps:portfolio", () => renderBinder());
  window.addEventListener("ps:tab", (e) => { if (e.detail === "home") renderHome(); });
}

export const homeApi = {
  homeWelcomeDone: () => { lsSet(WELCOME_KEY, "1"); renderWelcome(); },
  renderHome,
};
