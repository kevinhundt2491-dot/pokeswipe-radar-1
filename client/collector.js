// Master-Set-Tracker mit Stückzahlen, „Set vervollständigen“-Modus, Cardmarket-Wants-Liste
// und Duplikat-Radar mit Verkaufs-Automatik (P2P-Inserat, Cardmarket-Assistent, CSV-Export).
import { $, esc, eur, toast, FALLBACK_IMG, cdn, state, api, handleError, requireLogin, modal, closeModalEl, btn } from "./core.js";
import { setStats, wantsText, groupDuplicates, surplusBadge, sellText, cardmarketCsv, ebayQuery, cmName } from "./collector-logic.js";

const PS = () => window.PS;
const CM_BASE = "https://www.cardmarket.com/de/Pokemon";
const track = (url) => (window.withCardmarketTracking ? window.withCardmarketTracking(url) : url);
const cmSearch = (name) => track(`${CM_BASE}/Products/Search?searchString=${encodeURIComponent(cmName(name).slice(0, 120))}`);
const ebayBuy = (q, src) => (window.buildEbayUrl ? window.buildEbayUrl(q, "bin", src) : "#");
const attr = (v) => esc(JSON.stringify(String(v ?? "")));

/** Offizielle Sets als Schnellauswahl (TCGdex-IDs). */
export const QUICK_SETS = [
  ["sv08", "Stürmische Funken"], ["sv03.5", "151"], ["sv08.5", "Prismatische Entwicklungen"],
  ["swsh12.5", "Zenit der Könige"], ["sv03", "Obsidianflammen"], ["me01", "Mega-Entwicklung"],
];
export const quickSetsHtml = () => `<div class="flex gap-1.5 overflow-x-auto pb-1 text-[11px]" aria-label="Beliebte Sets">${QUICK_SETS.map(([id, n]) =>
  `<button onclick="PS.openSet('${id}')" class="shrink-0 bg-slate-900 border border-emerald-500/40 hover:border-emerald-300 text-emerald-200 font-bold rounded-full px-3 py-1.5">${esc(n)}</button>`).join("")}</div>`;

// ---------------------------------------------------------------------------
// Zwischenablage
// ---------------------------------------------------------------------------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}
const openTab = (url) => { try { window.open(url, "_blank", "noopener"); } catch {} };

// ===========================================================================
// 1. Master-Set-Tracker
// ===========================================================================
let currentSet = null;
let setFilter = "all";
let completeMode = false;
const saveTimers = new Map();

export function showSet(data) { currentSet = data; renderSetDetail(); }
export function setSetFilter(k) { setFilter = k; completeMode = false; renderSetDetail(); }
export function getCurrentSet() { return currentSet; }

function qtyControl(c) {
  return `<div class="flex items-center justify-center gap-1 mt-1">
      <button onclick="PS.qtyStep('${esc(c.id)}',-1)" class="w-8 h-8 rounded-lg bg-slate-800 text-white font-black text-sm active:scale-95 disabled:opacity-30" ${c.qty ? "" : "disabled"} aria-label="Eine weniger">−</button>
      <span class="min-w-[2rem] text-center text-xs font-black ${c.qty ? "text-emerald-300" : "text-slate-500"}">${c.qty}x</span>
      <button onclick="PS.qtyStep('${esc(c.id)}',1)" class="w-8 h-8 rounded-lg bg-emerald-500 text-slate-950 font-black text-sm active:scale-95" aria-label="Eine mehr">+</button>
    </div>`;
}

function tileHtml(c) {
  const dup = c.qty >= 2;
  return `<div class="relative rounded-xl border ${dup ? "border-amber-400 bg-amber-500/10" : c.qty ? "border-emerald-400 bg-emerald-500/10" : "border-slate-800 bg-slate-900"} p-1.5 text-center min-w-0">
      <button onclick="PS.toggleOwned('${esc(c.id)}')" class="block w-full" aria-label="${c.qty ? "Als fehlend markieren" : "Als vorhanden markieren"}">
        <img src="${esc(cdn(c.image || FALLBACK_IMG, 180))}" loading="lazy" onerror="this.src='${FALLBACK_IMG}'" class="h-24 mx-auto object-contain ${c.qty ? "" : "opacity-40 grayscale"}" alt="" />
        <p class="text-[10px] font-bold text-white truncate">${esc(c.localId)} ${esc(c.name)}</p>
        <p class="text-[10px] ${c.qty ? "text-emerald-400" : "text-slate-400"} font-bold">${c.price ? eur(c.price) : "–"}</p>
      </button>
      ${qtyControl(c)}
      ${dup ? `<button onclick="PS.sellSurplus('${esc(c.id)}')" class="mt-1 w-full bg-amber-400 text-slate-950 text-[9px] leading-tight font-black rounded-md px-1 py-1" aria-label="Überschuss verkaufen">+${c.qty - 1}x Überschuss<br>${c.price ? `${eur(c.price * (c.qty - 1))} · ` : ""}verkaufen</button>` : ""}
      ${c.qty ? `<span class="absolute top-1 left-1 bg-emerald-400 text-slate-950 text-[9px] font-black rounded px-1">✓${c.qty > 1 ? c.qty : ""}</span>` : ""}
      <button onclick="PS.openCard('${esc(c.id)}')" class="absolute top-1 right-1 bg-slate-950/80 text-white text-[10px] rounded px-1.5 py-0.5" aria-label="Details">ℹ</button>
    </div>`;
}

function missingRowHtml(c, s) {
  return `<div class="bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs space-y-1.5">
      <div class="flex items-center gap-2">
        <img src="${esc(cdn(c.image || FALLBACK_IMG, 80))}" loading="lazy" onerror="this.src='${FALLBACK_IMG}'" class="w-9 h-12 object-contain rounded shrink-0" alt="" />
        <div class="min-w-0 flex-1">
          <p class="font-bold text-white truncate">${esc(c.name)}</p>
          <p class="text-[10px] text-slate-400">${esc(s.abbr || s.name)} ${esc(c.localId)} • <span class="text-yellow-300 font-black">${c.price ? eur(c.price) : "Preis folgt"}</span></p>
        </div>
        <button onclick="PS.qtyStep('${esc(c.id)}',1)" class="shrink-0 h-9 px-2.5 rounded-lg bg-emerald-500 text-slate-950 font-black text-[11px]" aria-label="Habe ich jetzt">✓ Habe ich</button>
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <a href="${esc(cmSearch(c.en || c.name))}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-bold px-2 py-2 rounded-lg text-[11px] text-center">Auf Cardmarket holen</a>
        <a href="${esc(ebayBuy(ebayQuery(c, s), "masterset"))}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2 py-2 rounded-lg text-[11px] text-center">🛒 eBay-Bestpreis*</a>
      </div>
    </div>`;
}

export function renderSetDetail() {
  const s = currentSet, box = $("ps-set-detail");
  if (!s || !box) return;
  const st = setStats(s.cards);
  const list = s.cards.filter((c) => setFilter === "all" || (setFilter === "missing" ? !c.qty : setFilter === "dupes" ? c.qty >= 2 : c.qty > 0));
  const summary = st.missingCount
    ? `${st.percent} % komplett – es fehlen noch ${st.missingCount} ${st.missingCount === 1 ? "Karte" : "Karten"}, geschätzte Restkosten: ${eur(st.missingCost)}${st.missingUnpriced ? ` (+ ${st.missingUnpriced} ohne Preis)` : ""}`
    : "🏆 100 % komplett – Master-Set geschafft!";
  box.innerHTML = `<div class="bg-slate-950 rounded-2xl p-3 sm:p-4 border border-emerald-500/30 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-3 min-w-0">${s.logo ? `<img src="${esc(s.logo)}" class="h-10 max-w-[96px] object-contain" onerror="this.remove()" alt="" />` : ""}
        <div class="min-w-0"><h3 class="text-sm font-black text-white truncate">${esc(s.name)}${s.abbr ? ` <span class="text-slate-500">(${esc(s.abbr)})</span>` : ""}</h3><p class="text-[11px] text-slate-400">${st.owned} / ${st.total} Karten (${s.official} im Grundset)</p></div></div>
      ${s.tracked ? btn("✓ Wird verfolgt", `PS.untrackSet('${esc(s.id)}')`, "bg-slate-800 text-emerald-300") : btn("📌 Set verfolgen", `PS.trackSet('${esc(s.id)}')`, "bg-emerald-500 text-slate-950")}
    </div>
    <p id="ps-set-summary" class="text-xs font-black ${st.missingCount ? "text-yellow-300" : "text-emerald-300"}" aria-live="polite">${summary}</p>
    <div class="h-3 bg-slate-800 rounded-full overflow-hidden"><div class="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all" style="width:${st.percent}%"></div></div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-center">
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400 text-[10px] uppercase font-bold">Fortschritt</p><p class="text-base sm:text-lg font-black text-white whitespace-nowrap">${st.percent} %</p></div>
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400 text-[10px] uppercase font-bold">Wert deiner Karten</p><p class="text-base sm:text-lg font-black text-emerald-400 whitespace-nowrap">${eur(st.ownedValue)}</p></div>
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400 text-[10px] uppercase font-bold">Kosten bis komplett</p><p class="text-base sm:text-lg font-black text-yellow-300 whitespace-nowrap">${eur(st.missingCost)}</p></div>
      <button onclick="PS.setFilter('dupes')" class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400 text-[10px] uppercase font-bold">Überschuss (${st.surplus}x)</p><p class="text-base sm:text-lg font-black text-amber-300 whitespace-nowrap">${eur(st.surplusValue)}</p></button>
    </div>
    ${s.priced < s.total ? `<p class="text-[11px] text-amber-300">⏳ Preise für ${s.total - s.priced} Karten werden noch geladen – öffne das Set später erneut für den vollständigen Wert.</p>` : ""}
    <div class="flex flex-wrap gap-1.5 text-xs">
      <button onclick="PS.completeSet()" class="px-3 py-1.5 rounded-xl font-black ${completeMode ? "bg-yellow-400 text-slate-950" : "bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950"}">🎯 Set vervollständigen</button>
      ${[["all", "Alle"], ["missing", "Fehlend"], ["owned", "Vorhanden"], ["dupes", "Doppelt"]].map(([k, l]) =>
        `<button onclick="PS.setFilter('${k}')" class="px-3 py-1.5 rounded-xl font-bold ${!completeMode && setFilter === k ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-slate-300"}">${l}</button>`).join("")}
    </div>
    ${completeMode ? completeHtml(s, st) : `<p class="text-[10px] text-slate-500">Bild antippen = habe ich / fehlt • − / + = genaue Stückzahl</p>
    <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2 max-h-[34rem] overflow-y-auto overscroll-contain">${list.map(tileHtml).join("") || `<p class="col-span-full text-center text-slate-500 text-xs py-4">Keine Karten in dieser Ansicht.</p>`}</div>`}
    <p class="text-[10px] text-slate-500">*eBay-Links sind Partner-Links (ePN). Cardmarket-Links öffnen die Kartensuche auf Cardmarket.</p>
  </div>`;
}

function completeHtml(s, st) {
  if (!st.missingCount) return `<p class="text-center text-emerald-300 font-black py-6">🏆 Alle ${st.total} Karten vorhanden!</p>`;
  const missing = [...st.missing].sort((a, b) => (b.price || 0) - (a.price || 0));
  return `<div class="space-y-2">
      <div class="flex flex-col sm:flex-row gap-2">
        <button onclick="PS.copyWants()" class="flex-1 bg-indigo-600 text-white font-black py-2.5 px-3 rounded-xl text-xs">📋 Alle fehlenden Karten für Cardmarket Wants-Liste kopieren</button>
        <a href="${esc(ebayBuy(`${s.name} Pokemon Karten Sammlung`, "masterset-bundle"))}" target="_blank" rel="noopener sponsored" class="sm:w-auto bg-blue-600 text-white font-black py-2.5 px-3 rounded-xl text-xs text-center">🛒 Set-Lots auf eBay*</a>
      </div>
      <div class="space-y-1.5 max-h-[34rem] overflow-y-auto overscroll-contain pr-0.5">${missing.map((c) => missingRowHtml(c, s)).join("")}</div>
    </div>`;
}

export function completeSet() { completeMode = !completeMode; renderSetDetail(); }

/** Stückzahl lokal sofort ändern, dann gebündelt (0,6 s) speichern. */
function setQty(cardId, qty) {
  const c = currentSet?.cards.find((x) => x.id === cardId);
  if (!c) return;
  c.qty = Math.max(0, Math.min(999, qty));
  c.owned = c.qty > 0;
  renderSetDetail();
  clearTimeout(saveTimers.get(cardId));
  saveTimers.set(cardId, setTimeout(async () => {
    saveTimers.delete(cardId);
    try {
      await api(`/api/portfolio/by-card/${encodeURIComponent(cardId)}`, { method: "PUT", body: { quantity: c.qty } });
      if (!saveTimers.size) PS().loadPortfolio?.();
    } catch (e) {
      handleError(e);
      // Bei Fehler den echten Stand neu laden
      try { showSet(await api(`/api/sets/${encodeURIComponent(currentSet.id)}`)); } catch {}
    }
  }, 600));
}
export function qtyStep(cardId, d) {
  if (!requireLogin()) return;
  const c = currentSet?.cards.find((x) => x.id === cardId);
  if (c) setQty(cardId, (c.qty || 0) + d);
}
export function toggleOwned(cardId) {
  if (!requireLogin()) return;
  const c = currentSet?.cards.find((x) => x.id === cardId);
  if (c) setQty(cardId, c.qty ? 0 : 1);
}

export async function copyWants() {
  const s = currentSet;
  if (!s) return;
  const st = setStats(s.cards);
  if (!st.missingCount) return toast("🏆 Komplett", "Dir fehlt keine Karte aus diesem Set.");
  const text = wantsText(st.missing, s);
  const copying = copyText(text);
  openTab(track(`${CM_BASE}/Wants`));
  const ok = await copying;
  modal("ps-wants", `<h3 class="text-base font-black text-white">📋 Wants-Liste: ${esc(s.name)}</h3>
    <p class="text-xs ${ok ? "text-emerald-300" : "text-amber-300"} font-bold">${ok ? `✅ ${st.missingCount} Karten in die Zwischenablage kopiert.` : "Kopieren wurde vom Browser blockiert – markiere den Text unten und kopiere ihn."}</p>
    <ol class="text-[11px] text-slate-300 list-decimal pl-4 space-y-0.5">
      <li>Cardmarket hat sich in einem neuen Tab geöffnet (Wants).</li>
      <li>Neue Wants-Liste anlegen → „Karten hinzufügen“ → Text-Eingabe.</li>
      <li>Liste einfügen und bestätigen.</li>
    </ol>
    <textarea readonly rows="8" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-[11px] font-mono" onclick="this.select()">${esc(text)}</textarea>
    <div class="grid grid-cols-2 gap-2">
      ${btn("Erneut kopieren", "PS.copyWantsAgain()", "bg-slate-800 text-white")}
      <a href="${esc(track(`${CM_BASE}/Wants`))}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-black py-2.5 px-3 rounded-xl text-xs text-center">Cardmarket öffnen</a>
    </div>`);
}
export async function copyWantsAgain() {
  const s = currentSet;
  if (!s) return;
  const ok = await copyText(wantsText(setStats(s.cards).missing, s));
  toast(ok ? "📋 Kopiert" : "Kopieren nicht möglich", ok ? "Jetzt bei Cardmarket einfügen." : "Bitte den Text manuell markieren.");
}

// ===========================================================================
// 2. Duplikat-Radar im Portfolio
// ===========================================================================
let dupes = [];          // angereichert vom Server (Cardmarket-Daten)
let dupesLoadedFor = "";

export const dupesPanelHtml = () => `<div id="ps-dupes" class="hidden bg-slate-950/80 rounded-2xl p-3 space-y-3 border-2 border-amber-400/50">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <span class="text-[10px] font-black uppercase bg-amber-400 text-slate-950 px-2.5 py-0.5 rounded-full">♻️ Duplikat-Radar</span>
        <h3 class="text-sm font-black text-white mt-1">Doppelte Karten zu Geld machen</h3>
        <p id="ps-dupes-sum" class="text-xs text-slate-300"></p>
      </div>
      <button onclick="PS.sellAllDupes()" class="shrink-0 bg-gradient-to-r from-amber-400 to-yellow-400 text-slate-950 font-black py-2.5 px-3 rounded-xl text-xs">💸 Alle Duplikate verkaufen</button>
    </div>
    <div id="ps-dupes-list" class="space-y-2 max-h-96 overflow-y-auto overscroll-contain"></div>
  </div>`;

/** Wird nach jedem Laden des Portfolios aufgerufen. */
export async function refreshDupes() {
  const box = $("ps-dupes");
  if (!box) return;
  const local = state.user && state.portfolio ? groupDuplicates(state.portfolio.items) : [];
  if (!local.length) { dupes = []; box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const key = local.map((d) => `${d.cardId}:${d.qty}`).join(",");
  if (key !== dupesLoadedFor) {
    // Sofort mit lokalen Werten anzeigen, dann Cardmarket-Daten nachladen
    dupes = local.map((d) => ({ ...d, localId: d.cardId.split("-").pop(), enName: "", abbr: "", idProduct: null }));
    renderDupes();
    try {
      const res = await api("/api/collector/duplicates");
      dupes = res.duplicates;
      dupesLoadedFor = key;
    } catch {}
  }
  renderDupes();
}

function renderDupes() {
  const list = $("ps-dupes-list"), sum = $("ps-dupes-sum");
  if (!list) return;
  const total = dupes.reduce((s, d) => s + d.surplusValue, 0), count = dupes.reduce((s, d) => s + d.surplus, 0);
  if (sum) sum.textContent = `${count} überzählige Karten bei ${dupes.length} Motiven – Verkaufswert gesamt: ${eur(total)} (Cardmarket-Trend).`;
  list.innerHTML = dupes.map((d) => `
    <div class="flex items-center gap-2.5 bg-slate-900 border border-amber-400/40 rounded-xl p-2 text-xs">
      <img src="${esc(cdn(d.image || FALLBACK_IMG, 80))}" onerror="this.src='${FALLBACK_IMG}'" class="w-9 h-12 object-contain rounded shrink-0" alt="" />
      <div class="min-w-0 flex-1">
        <p class="font-bold text-white truncate">${d.qty}× ${esc(d.name)}</p>
        <p class="text-[10px] text-slate-400 truncate">${esc(d.setName || "")} ${esc(d.localId || "")}</p>
        <span class="inline-block mt-0.5 bg-amber-400 text-slate-950 text-[10px] font-black rounded-md px-1.5 py-0.5">${esc(surplusBadge(d, eur))}</span>
      </div>
      <button onclick="PS.sellSurplus('${esc(d.cardId)}')" class="shrink-0 bg-emerald-500 text-slate-950 font-black px-2.5 py-2 rounded-lg text-[11px] leading-tight">Überschuss<br>verkaufen</button>
    </div>`).join("");
}

/** Liefert Duplikat-Daten zu einer Karte (aus Radar oder aktuellem Set). */
function dupeFor(cardId) {
  const d = dupes.find((x) => x.cardId === cardId);
  if (d) return d;
  const c = currentSet?.cards.find((x) => x.id === cardId);
  if (!c || c.qty < 2) return null;
  return { cardId, name: c.name, enName: c.en || "", image: c.image, setName: currentSet.name, enSetName: currentSet.enName, abbr: currentSet.abbr,
    localId: c.localId, qty: c.qty, surplus: c.qty - 1, unit: c.price || 0, surplusValue: (c.price || 0) * (c.qty - 1), idProduct: null };
}

export function sellSurplus(cardId) {
  if (!requireLogin()) return;
  const d = dupeFor(cardId);
  if (!d) return toast("Kein Überschuss", "Diese Karte hast du nur einmal.");
  modal("ps-sell", `<h3 class="text-base font-black text-white">💸 Überschuss verkaufen</h3>
    <div class="flex items-center gap-3 bg-slate-950 rounded-2xl p-3 border border-amber-400/40">
      <img src="${esc(cdn(d.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" class="w-14 h-20 object-contain rounded" alt="" />
      <div class="min-w-0 text-xs"><p class="font-black text-white">${esc(d.name)}</p><p class="text-slate-400">${esc(d.setName || "")} ${esc(d.localId || "")} • ${d.qty}x vorhanden</p>
        <p class="mt-1 inline-block bg-amber-400 text-slate-950 font-black rounded px-1.5 py-0.5 text-[11px]">${esc(surplusBadge(d, eur))}</p></div>
    </div>
    <div class="space-y-2 text-xs">
      <button onclick="PS.dupePublish(${attr(d.cardId)})" class="w-full text-left bg-emerald-500 text-slate-950 rounded-2xl p-3 font-black">🚀 a) 1-Klick-Inserat im Tausch-Hub<br><span class="font-semibold text-[11px]">${d.surplus}x mit Bild, Set-Name und ${d.unit ? `${eur(d.unit)} pro Stück` : "Marktpreis"} einstellen</span></button>
      <button onclick="PS.dupeCardmarket(${attr(d.cardId)})" class="w-full text-left bg-indigo-600 text-white rounded-2xl p-3 font-black">🧭 b) Cardmarket-Verkaufs-Assistent<br><span class="font-semibold text-[11px]">Kopiert Preis ${d.unit ? eur(d.unit) : ""} + Zustand „Near Mint“ und öffnet die Karte auf Cardmarket</span></button>
      <button onclick="PS.dupeCsv(${attr(d.cardId)})" class="w-full text-left bg-slate-800 text-white rounded-2xl p-3 font-black">📄 c) CSV für Cardmarket-Bestands-Import<br><span class="font-semibold text-[11px] text-slate-300">Nur diese Karte – für alle Duplikate „Alle Duplikate verkaufen“ nutzen</span></button>
    </div>`);
}

async function publish(list) {
  const items = list.filter((d) => d.surplus > 0).map((d) => ({
    cardId: d.cardId,
    card: `${d.surplus}× ${d.name}${d.setName ? ` (${d.setName} ${d.localId || ""})`.replace(/ \)$/, ")") : ""}`.slice(0, 120),
    price: d.unit ? Number(d.unit).toFixed(2) : "",
    want: "Verkauf • Preis pro Stück • Near Mint",
    city: state.me?.city || "",
  })).filter((i) => i.price);
  if (!items.length) return toast("Kein Preis", "Für diese Karten gibt es noch keinen Marktpreis – bitte manuell inserieren.");
  let created = 0, skipped = 0;
  for (let i = 0; i < items.length; i += 20) {
    try {
      const r = await api("/api/listings", { method: "POST", body: { items: items.slice(i, i + 20) } });
      created += r.created || 0; skipped += r.skipped || 0;
    } catch (e) { handleError(e); break; }
  }
  if (created) {
    closeModalEl("ps-sell");
    toast("🚀 Inserate live", `${created} ${created === 1 ? "Karte ist" : "Karten sind"} jetzt im Tausch-Hub${skipped ? ` (${skipped} übersprungen – Inserat-Limit)` : ""}.`);
    PS().loadListings?.();
  }
}
export function dupePublish(cardId) { const d = dupeFor(cardId); if (d) publish([d]); }

export async function dupeCardmarket(cardId) {
  const d = dupeFor(cardId);
  if (!d) return;
  const copying = copyText(sellText(d, eur));
  openTab(cmSearch(d.enName || d.name));
  const ok = await copying;
  toast(ok ? "📋 Verkaufsdaten kopiert" : "Cardmarket geöffnet", ok
    ? `Preis ${d.unit ? eur(d.unit) : ""} + Zustand Near Mint sind in der Zwischenablage. Auf Cardmarket die Karte wählen → „Verkaufen“ → einfügen und bestätigen.`
    : `Empfohlen: ${d.unit ? eur(d.unit) : "Trendpreis"}, Zustand Near Mint, Anzahl ${d.surplus}.`);
}

function downloadCsv(list, filename) {
  const blob = new Blob([cardmarketCsv(list)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export async function dupeCsv(cardId) {
  await ensureDupeMeta();
  const d = dupeFor(cardId);
  if (d) { downloadCsv([d], `cardmarket-${cardId}.csv`); toast("📄 CSV erstellt", "Bei Cardmarket unter Bestand → CSV-Import hochladen."); }
}

async function ensureDupeMeta() {
  if (dupes.length && dupes.every((d) => d.abbr || d.idProduct)) return;
  try { dupes = (await api("/api/collector/duplicates")).duplicates; } catch {}
}

export async function sellAllDupes() {
  if (!requireLogin()) return;
  await ensureDupeMeta();
  if (!dupes.length) return toast("Keine Duplikate", "Sobald du eine Karte 2x oder öfter hast, erscheint sie hier.");
  const total = dupes.reduce((s, d) => s + d.surplusValue, 0), count = dupes.reduce((s, d) => s + d.surplus, 0);
  modal("ps-sell", `<h3 class="text-base font-black text-white">💸 Alle Duplikate verkaufen</h3>
    <p class="text-xs text-slate-300">${count} überzählige Karten • Verkaufswert ca. <strong class="text-amber-300">${eur(total)}</strong></p>
    <div class="space-y-2 text-xs">
      <button onclick="PS.dupePublishAll()" class="w-full text-left bg-emerald-500 text-slate-950 rounded-2xl p-3 font-black">🚀 a) Alle im Tausch-Hub inserieren<br><span class="font-semibold text-[11px]">Mit Bild, Set-Name und aktuellem Marktpreis (Inserat-Limit deines Tarifs gilt)</span></button>
      <button onclick="PS.dupeCardmarketAll()" class="w-full text-left bg-indigo-600 text-white rounded-2xl p-3 font-black">🧭 b) Verkaufsliste für Cardmarket kopieren<br><span class="font-semibold text-[11px]">Alle Karten mit Anzahl, Near Mint und Trendpreis – öffnet deinen Cardmarket-Bestand</span></button>
      <button onclick="PS.dupeCsvAll()" class="w-full text-left bg-slate-800 text-white rounded-2xl p-3 font-black">📄 c) Cardmarket CSV-Bulk-Export<br><span class="font-semibold text-[11px] text-slate-300">Fertige CSV aller Duplikate für den Bestands-Import</span></button>
    </div>`);
}
export function dupePublishAll() { publish(dupes); }
export async function dupeCardmarketAll() {
  const text = dupes.map((d) => sellText(d, eur).split("\n").join(" • ")).join("\n");
  const copying = copyText(text);
  openTab(track(`${CM_BASE}/Stock`));
  const ok = await copying;
  toast(ok ? "📋 Verkaufsliste kopiert" : "Cardmarket geöffnet", ok ? `${dupes.length} Karten mit Preis und Zustand in der Zwischenablage.` : "Tipp: Nutze den CSV-Export.");
}
export function dupeCsvAll() {
  downloadCsv(dupes, `pokeswipe-duplikate-cardmarket-${new Date().toISOString().slice(0, 10)}.csv`);
  toast("📄 CSV erstellt", "Bei Cardmarket unter Bestand → CSV-Import hochladen und die Spalten bestätigen.");
}

export const collectorApi = {
  qtyStep, toggleOwned, completeSet, copyWants, copyWantsAgain, setFilter: setSetFilter,
  sellSurplus, sellAllDupes, dupePublish, dupePublishAll, dupeCardmarket, dupeCardmarketAll, dupeCsv, dupeCsvAll,
};
