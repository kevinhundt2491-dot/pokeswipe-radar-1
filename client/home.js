// PokeSwipe & Radar – Start-Dashboard (view-home): kompakt, ohne endloses Scrollen.
//   1. Live-Karten-Scanner (Hero-Aktion, statisch in index.html)
//   2. Marktplatz & Tausch-Radar – Vorschau aktueller Karten-Highlights
//   3. Live-Chat – letzte Nachrichten + Eingabe (Schreiben lädt freundlich zur 1-Klick-Anmeldung ein)
//   4. Mein Binder – Wert, Anzahl, kleine Kartenleiste
// Neue Besucher sehen alles sofort, ohne Registrierungswand. Ganz oben: persönliche Gründer-Begrüßung (aufklappbar),
// Live-Fortschritt der Gründer-Aktion „Die ersten 50 Sammler“ und – für Gäste – der kurze Gast-Modus-Hinweis.
import { $, esc, eur, cdn, state, api, toast, FALLBACK_IMG } from "./core.js";
import { marketHighlights, conditionShort, setCodeOf } from "./market-filter-logic.js";
import { FIRST50_LIMIT, FIRST50_DAYS, first50Left, first50Headline, first50Pct } from "../server/first50-logic.ts";

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
// Gründer-Begrüßung (Kevin) + „🔥 Gründer-Aktion für die ersten 50 Sammler“
// ---------------------------------------------------------------------------
// Beim ersten Besuch aufgeklappt; „Verstanden“ klappt sie dauerhaft zu – sie bleibt oben als aufklappbare Zeile.
const HELLO_KEY = "ps_founder_hello_done";
const FIRST50_SEEN = "ps_first50_congrats";
const f50 = { stats: null, at: 0, timer: 0 };

const FOUNDER_TEXT = "Ich bin Kevin – selbst leidenschaftlicher Pokémon-Sammler. Genau wie du hatte ich keine Lust mehr auf ewiges Preise-Nachschlagen, unübersichtliche Listen und teure Verkaufsgebühren, nur um ein Set vollzubekommen oder Karten fair zu tauschen. Deshalb habe ich PokeSwipe Radar gebaut: Karte kurz vor die Kamera halten, sofort den echten Marktwert sehen, automatisch im digitalen Sammelordner abheften und fehlende Karten direkt über die Lücken im Binder kaufen oder mit anderen Sammlern tauschen. Die App ist brandneu und wird jeden Tag weiter ausgebaut – schau dich ganz in Ruhe um, teste den Scanner und blättere durch die Ordner!";

function helloHtml() {
  const open = !lsGet(HELLO_KEY);
  return `<details id="ps-founder-hello" class="ps-card ps-founder-hello p-3 sm:p-4" ${open ? "open" : ""}>
    <summary class="flex items-center justify-between gap-2">
      <h2 class="text-sm sm:text-base font-black text-white">👋 Hey Sammler – willkommen bei PokeSwipe Radar!</h2>
      <span class="ps-hello-chev text-slate-400 text-xs shrink-0" aria-hidden="true">▾</span>
    </summary>
    <div class="mt-2 space-y-2.5">
      <p class="text-xs sm:text-[13px] leading-relaxed text-slate-200">${esc(FOUNDER_TEXT)}</p>
      <p class="text-[11px] text-slate-400">– Kevin, Gründer von PokeSwipe Radar</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" onclick="PS.openScanner()" class="bg-yellow-400 text-slate-950 font-black text-xs px-3 py-1.5 rounded-xl">📷 Scanner testen</button>
        <button type="button" onclick="PS.homeBinderOpen()" class="bg-slate-800 text-white font-bold text-xs px-3 py-1.5 rounded-xl">📒 Ordner durchblättern</button>
        <button type="button" onclick="PS.homeHelloDone()" class="text-slate-300 font-bold text-xs px-2 py-1.5">Verstanden ✓</button>
      </div>
    </div>
  </details>`;
}

function first50Html() {
  const mine = state.me?.first50;
  if (mine?.rank) {
    const until = mine.until ? new Date(mine.until).toLocaleDateString("de-DE") : "";
    return `<div class="ps-first50 ps-first50-won p-3 sm:p-4 space-y-1" data-first50-won>
      <p class="text-sm font-black text-white">🎉 Glückwunsch – du hast Gründer-Platz #${Number(mine.rank)} von ${FIRST50_LIMIT}!</p>
      <p class="text-xs text-slate-200">Dein exklusives <span class="ps-founder-chip">🏅 Gründer-Sammler</span>-Badge ist dauerhaft aktiv${mine.active && until ? ` – und PokeSwipe Pro (0 % Gebühren, unbegrenzte Scans &amp; Preisalarme) läuft gratis bis <strong class="text-emerald-300">${esc(until)}</strong>` : ""}. Danke, dass du von Anfang an dabei bist!</p>
    </div>`;
  }
  const st = f50.stats;
  const known = st && Number.isFinite(Number(st.taken)) && st.taken !== null;
  const left = known ? first50Left(st.taken) : null;
  const pct = known ? first50Pct(st.taken) : 0;
  if (known && left === 0) {
    return `<div class="ps-first50 p-3 text-xs text-slate-200">🏆 ${esc(first50Headline(st.taken))} Konto & Scanner bleiben natürlich kostenlos.</div>`;
  }
  return `<div class="ps-first50 p-3 sm:p-4 space-y-2" data-first50>
    <p class="text-[11px] font-black uppercase tracking-wide text-orange-300">🔥 Gründer-Aktion für die ersten ${FIRST50_LIMIT} Sammler</p>
    <p class="text-xs sm:text-[13px] text-white font-bold leading-snug">🏆 GRÜNDER-BONUS: Die ersten ${FIRST50_LIMIT} Sammler erhalten dauerhaft das exklusive „Gründer-Sammler“-Badge + ${FIRST50_DAYS} Tage PokeSwipe Pro (0 % Gebühren, unbegrenzte Scans &amp; Preisalarme) komplett kostenlos!</p>
    <div class="ps-first50-bar" role="progressbar" aria-label="Vergebene Gründer-Plätze" aria-valuemin="0" aria-valuemax="${FIRST50_LIMIT}" aria-valuenow="${known ? FIRST50_LIMIT - left : 0}"><span style="width:${pct}%"></span></div>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs font-black text-amber-200" data-first50-left>${known ? esc(first50Headline(st.taken)) : "Gründer-Plätze werden gezählt …"}</p>
      ${state.user ? "" : `<button type="button" onclick="PS.renderLogin('', 'signup')" class="bg-gradient-to-r from-orange-400 to-yellow-400 text-slate-950 font-black text-xs px-3.5 py-2 rounded-xl">Jetzt kostenlosen Gründer-Platz sichern</button>`}
    </div>
  </div>`;
}

/** Live-Zähler: echte vergebene Plätze aus der Datenbank (alle 45 s, nur solange die Startseite sichtbar ist). */
async function loadFirst50(force = false) {
  if (!force && Date.now() - f50.at < 15_000) return;
  f50.at = Date.now();
  try { f50.stats = await api("/api/first50"); } catch { return; }
  const box = $("ps-home-first50");
  if (box) box.innerHTML = first50Html();
}

function congratsOnce() {
  const r = state.me?.first50?.rank;
  if (!r || lsGet(FIRST50_SEEN) === String(r)) return;
  lsSet(FIRST50_SEEN, String(r));
  toast(`🏆 Gründer-Platz #${Number(r)} gesichert!`, `Gründer-Sammler-Badge + ${FIRST50_DAYS} Tage Pro gratis sind auf deinem Konto aktiv.`);
}

function renderWelcome() {
  const box = $("ps-home-welcome");
  if (!box) return;
  const helloOpen = $("ps-founder-hello")?.open;
  box.innerHTML = `${helloHtml()}<div id="ps-home-first50">${first50Html()}</div><div id="ps-home-guest-hint"></div>`;
  const d = $("ps-founder-hello");
  if (d) {
    if (helloOpen !== undefined) d.open = helloOpen;
    // Zuklappen = einmalig weggeklickt; die Begrüßung bleibt oben als aufklappbare Zeile
    d.addEventListener("toggle", () => { if (!d.open && !lsGet(HELLO_KEY)) { lsSet(HELLO_KEY, "1"); renderGuestHint(); } });
  }
  renderGuestHint();
  congratsOnce();
}

// Gast-Modus-Hinweis (nur für Gäste, nicht blockierend; erscheint, wenn die Begrüßung zugeklappt ist)
function renderGuestHint() {
  const box = $("ps-home-guest-hint");
  if (!box) return;
  if (state.user || lsGet(WELCOME_KEY) || !lsGet(HELLO_KEY)) { box.innerHTML = ""; return; }
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
  loadFirst50(true);
  f50.timer = setInterval(() => { if (!document.hidden && !$("view-home")?.classList.contains("hidden")) loadFirst50(true); }, 45_000);
  window.addEventListener("ps:listings", () => renderMarketPreview());
  window.addEventListener("ps:chat", (e) => renderChat(e.detail));
  window.addEventListener("ps:plan", () => { renderWelcome(); renderChat(); renderBinder(); loadFirst50(true); });
  window.addEventListener("ps:portfolio", () => renderBinder());
  window.addEventListener("ps:tab", (e) => { if (e.detail === "home") { renderHome(); loadFirst50(); } });
}

export const homeApi = {
  homeWelcomeDone: () => { lsSet(WELCOME_KEY, "1"); renderGuestHint(); },
  homeHelloDone: () => { lsSet(HELLO_KEY, "1"); const d = $("ps-founder-hello"); if (d) d.open = false; renderGuestHint(); },
  renderHome,
};
