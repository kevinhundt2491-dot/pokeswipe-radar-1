// PokeSwipe & Radar – 🎯 Lücken-Radar (Noch gesucht): eigener Bereich im Album für alle Karten, die im gewählten Set noch fehlen.
//   • Set-Auswahl aus den eigenen Set-Ordnern (Gäste: Test-Binder auf dem Gerät)
//   • „🛒 Sofort im Marktplatz verfügbar“ (günstigstes Angebot zuerst, Direkt-Kauf) und „🎯 Alle gesuchten Karten“
//   • Bulk-Suchauftrag: alle Lücken des Sets auf die Wunschliste (In-App & Push, sobald jemand sie einstellt)
// Der eigentliche Set-Binder bleibt dadurch ein edler Sammelordner ohne Lücken-Listen; Logik: server/binder-logic.ts (gapRadar, pocketLabel).
import { $, esc, eur, cdn, state, api, toast, handleError, requireLogin, FALLBACK_IMG } from "./core.js";
import { buildBinderCards, gapRadar, setIdOfCard, pocketLabel } from "../server/binder-logic.ts";
import { homeFolders } from "./binder.js";

/** Beispiel-Set ohne eigene Ordner (Karmesin & Purpur 151) */
const EXAMPLE_SET = "sv03.5";
const gr = { setId: "", folders: [], data: null, cards: [], radar: null, loading: "", view: "available", busy: false };

function guestOwned(setId) {
  try {
    const v = JSON.parse(localStorage.getItem("pokeswipe_portfolio_clean") || "[]");
    return (Array.isArray(v) ? v : []).map((i) => ({
      cardId: i.cardId || i.card_id || (/^[\w.]+-[\w]+$/.test(String(i.id || "")) ? String(i.id) : null),
      quantity: Number(i.quantity) || 1, value: Number(i.value) || 0, image: i.image || i.img || "", name: i.name || "", condition: i.condition || "",
    })).filter((i) => i.cardId && setIdOfCard(i.cardId) === setId);
  } catch { return []; }
}

const visible = () => { const el = $("ps-gap-radar"); return Boolean(el && el.offsetParent !== null); };

function rowHtml(c, live) {
  const tag = pocketLabel(c);
  const m = c.market;
  const id = esc(JSON.stringify(c.cardId));
  return `<div class="ps-gap-row ${live ? "ps-gap-live" : ""}" data-gap-card="${esc(c.cardId)}">
    <span class="ps-gap-art"><img src="${esc(cdn(c.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" alt="" loading="lazy" /></span>
    <div class="min-w-0 flex-1">
      <p class="text-[12px] font-black text-white truncate"><span class="text-cyan-200 font-mono">${esc(c.number || c.localId)}</span> ${esc(c.name)}</p>
      <p class="text-[10px] text-slate-400 truncate">Cardmarket <strong class="text-emerald-300">${esc(c.priceLabel)}</strong>${m ? ` · ${m.trade ? "Tauschangebot" : `Angebot <strong class="text-white">${eur(m.price)}</strong>`}${m.condition ? ` · ${esc(m.condition)}` : ""}${m.seller ? ` · ${esc(m.seller)}` : ""}${m.offers > 1 ? ` · ${Number(m.offers)} Angebote` : ""}` : " · noch kein Angebot"}</p>
      ${tag ? `<span class="inline-block mt-1 text-[9px] font-black px-1.5 py-0.5 rounded ${tag.kind === "deal" ? "bg-orange-400 text-orange-950" : tag.kind === "market" ? "bg-emerald-400 text-emerald-950" : tag.kind === "trade" ? "bg-sky-300 text-sky-950" : "bg-slate-800 text-slate-300"}">${esc(tag.text)}</span>` : ""}
    </div>
    ${m?.listingId ? `<button type="button" class="ps-gap-buy" onclick="PS.openListing(${Number(m.listingId)})" aria-label="${esc(`${c.name} ${m.trade ? "zum Tausch anfragen" : "jetzt kaufen"}`)}">${m.trade ? "🔁 Anfragen" : "🛒 Kaufen"}</button>`
      : `<button type="button" class="ps-gap-wish" onclick="PS.gapRadarWish(${id})" aria-label="${esc(`Suchauftrag für ${c.name}`)}">🔔 Suchauftrag</button>`}
  </div>`;
}

function render() {
  const root = $("ps-gap-radar");
  if (!root) return;
  const body = root.querySelector("[data-gap-body]"), count = root.querySelector("[data-gap-count]");
  if (!body) return;
  const sel = gr.folders.length
    ? `<select onchange="PS.gapRadarSet(this.value)" class="ps-hb-select" aria-label="Set wählen">${gr.folders.slice(0, 60).map((f) => `<option value="${esc(f.setId)}" ${f.setId === gr.setId ? "selected" : ""}>${esc(f.name)} · ${esc(f.progressLabel)}</option>`).join("")}</select>`
    : `<span class="text-[11px] text-slate-400">Beispiel-Set – scanne deine erste Karte, dann erscheinen hier deine eigenen Sets.</span>`;
  if (!gr.data) {
    body.innerHTML = `<div class="flex items-center justify-between gap-2">${sel}</div><div class="ps-skeleton rounded-2xl !min-h-[140px]"></div>`;
    return;
  }
  const r = gr.radar;
  const s = gr.data.set || {};
  if (count) count.textContent = r.count ? `${r.count} noch gesucht` : "Set komplett";
  const list = gr.view === "available" ? r.available : r.all;
  const seg = (k, label) => `<button type="button" role="tab" aria-selected="${gr.view === k}" onclick="PS.gapRadarView('${k}')" class="ps-subchip shrink-0">${label}</button>`;
  body.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">${s.logo ? `<img src="${esc(cdn(s.logo, 160))}" alt="" class="h-8 max-w-[80px] object-contain" onerror="this.remove()" />` : ""}${sel}</div>
      <button type="button" onclick="PS.openSetBinder(${esc(JSON.stringify(gr.setId))})" class="text-[11px] font-black px-3 py-1.5 rounded-xl bg-slate-800 text-white shrink-0">📒 Ordner öffnen</button>
    </div>
    ${r.count ? `<div class="grid grid-cols-3 gap-2 text-center text-xs">
      <div class="ps-stat"><span class="text-[10px] uppercase font-bold text-slate-400">Noch gesucht</span><strong class="text-base text-white">${r.count}</strong></div>
      <div class="ps-stat"><span class="text-[10px] uppercase font-bold text-slate-400">Sofort verfügbar</span><strong class="text-base text-emerald-300">${r.available.length}</strong></div>
      <div class="ps-stat"><span class="text-[10px] uppercase font-bold text-slate-400">Restwert (CM)</span><strong class="text-base text-yellow-300">${eur(r.cost)}</strong></div>
    </div>
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar py-1" role="tablist" aria-label="Gesuchte Karten filtern">
      ${seg("available", `🛒 Sofort im Marktplatz verfügbar (${r.available.length})`)}${seg("all", `🎯 Alle gesuchten Karten (${r.count})`)}
    </div>
    <div class="space-y-1.5 max-h-[34rem] overflow-y-auto overscroll-contain pr-0.5" data-gap-list>
      ${list.length ? list.map((c) => rowHtml(c, Boolean(c.market))).join("")
        : `<p class="ps-empty text-xs text-slate-300 text-center py-5">Gerade bietet niemand eine deiner gesuchten Karten an. Mit dem Bulk-Suchauftrag melden wir uns, sobald eine eingestellt wird.</p>`}
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" onclick="PS.gapRadarWishAll()" data-gap-wish-all class="flex-1 bg-yellow-400 text-slate-950 font-black py-2.5 px-3 rounded-xl text-xs" ${gr.busy ? "disabled" : ""}>🔔 Bulk-Suchauftrag: alle ${r.count} gesuchten Karten</button>
      ${r.available.length ? `<button type="button" onclick="PS.gapRadarView('available')" class="bg-emerald-500 text-slate-950 font-black py-2.5 px-3 rounded-xl text-xs">🛒 ${r.available.filter((c) => !c.market.trade).length} direkt kaufbar${r.buyNow ? ` · ${eur(r.buyNow)}` : ""}</button>` : ""}
    </div>` : `<p class="text-center text-emerald-300 font-black py-6">🏆 Set komplett – keine Lücke mehr in ${esc(s.name || gr.setId)}!</p>`}`;
}

async function load(setId) {
  gr.loading = setId;
  gr.setId = setId; gr.data = null; render();
  try {
    const data = await api(`/api/binder/set/${encodeURIComponent(setId)}`);
    if (gr.loading !== setId) return;
    const owned = state.user ? data.owned || [] : guestOwned(setId);
    gr.data = data;
    gr.cards = buildBinderCards({ catalog: data.catalog || [], owned, myListings: data.myListings || [], marketListings: data.marketListings || [], viewerId: state.user?.id || "", official: Number(data.set?.official) || 0 });
    gr.radar = gapRadar(gr.cards);
    if (gr.view === "available" && !gr.radar.available.length && gr.radar.count) gr.view = "all";
    render();
  } catch (e) {
    if (gr.loading !== setId) return;
    const body = $("ps-gap-radar")?.querySelector("[data-gap-body]");
    if (body) body.innerHTML = `<p class="text-xs text-slate-400 py-3">Der Lücken-Radar lädt gerade nicht – versuche es gleich noch einmal.</p>`;
    if (e?.status !== 401) handleError(e);
  }
}

/** Bereich (neu) aufbauen – mit Set oder dem zuletzt gewählten/ersten eigenen Set. */
async function show(setId = "", force = false) {
  const root = $("ps-gap-radar");
  if (!root) return;
  try { gr.folders = (await homeFolders(force)) || []; } catch { gr.folders = gr.folders || []; }
  const want = /^[\w.\-]{1,40}$/.test(String(setId || "")) ? String(setId) : "";
  const keep = gr.folders.some((f) => f.setId === gr.setId) ? gr.setId : "";
  const target = want || keep || gr.folders[0]?.setId || EXAMPLE_SET;
  if (!force && gr.data && target === gr.setId) { render(); return; }
  await load(target);
}

async function wish(cardId) {
  if (!requireLogin()) return;
  try {
    const r = await api("/api/wishlist", { method: "POST", body: { cardId } });
    toast("⭐ Suchauftrag aktiv", r?.offers ? `Es gibt schon ${Number(r.offers)} Angebot(e) ab ${eur(r.minPrice)}.` : "Wir benachrichtigen dich (In-App & Push), sobald jemand diese Karte einstellt.");
  } catch (e) { handleError(e); }
}

/** Bulk-Suchauftrag: alle Lücken des Sets auf die Wunschliste (nacheinander, höchstens 80 je Durchgang). */
async function wishAll() {
  if (!requireLogin() || !gr.radar?.count || gr.busy) return;
  gr.busy = true; render();
  let n = 0;
  try {
    for (const c of gr.radar.all.slice(0, 80)) {
      try { await api("/api/wishlist", { method: "POST", body: { cardId: c.cardId } }); n++; } catch (e) { if (e?.status === 401 || e?.status === 403) throw e; }
    }
    toast("🔔 Bulk-Suchauftrag aktiv", `${n} gesuchte Karte${n === 1 ? "" : "n"} auf der Wunschliste – wir melden uns, sobald eine davon auf dem Marktplatz auftaucht.`);
  } catch (e) { handleError(e); } finally { gr.busy = false; render(); }
}

export function initGapRadar() {
  const onPortfolio = () => { if (visible()) show("", true).catch(() => {}); else gr.data = null; };
  window.addEventListener("ps:portfolio", onPortfolio);
  window.addEventListener("ps:plan", onPortfolio);
  window.addEventListener("ps:listings", () => { if (visible()) show("", true).catch(() => {}); });
  window.addEventListener("ps:sub", (e) => { if (e.detail?.view === "portfolio" && e.detail?.key === "gaps") show().catch(() => {}); });
}

export const gapRadarApi = {
  gapRadarShow: () => show().catch(() => {}),
  gapRadarSet: (id) => { if (/^[\w.\-]{1,40}$/.test(String(id || ""))) load(String(id)).catch(() => {}); },
  gapRadarView: (k) => { gr.view = k === "all" ? "all" : "available"; render(); },
  gapRadarWish: wish,
  gapRadarWishAll: wishAll,
  /** Aus Binder/Startseite: Album öffnen → Unterreiter „🎯 Lücken-Radar“ → Set laden */
  openGapRadar: (setId) => {
    try { if ($("view-portfolio")?.classList.contains("hidden")) window.switchTab?.("portfolio"); } catch {}
    window.PS?.showSub?.("portfolio", "gaps", { silent: true });
    show(setId, false).catch(() => {});
  },
};
