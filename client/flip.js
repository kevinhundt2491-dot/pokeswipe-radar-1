// PokeSwipe & Radar – Phase 2 im Browser: Live Flip-Radar (echte eBay-Einzelangebote), Verkaufspreise & PSA-Werte
// mit 30/90-Tage-Charts und Grading-ROI-Rechner sowie die Admin-Ansicht für eBay-Sync und Sealed-Preise.
import { $, esc, jsArg, safeUrl, eur, toast, cdn, FALLBACK_IMG, state, api, handleError, requireLogin, modal, closeModalEl, input, btn, areaChart } from "./core.js";
import { gradingRoi, GRADE_LABEL, SEALED_SOURCE_LABEL } from "../server/flip-logic.ts";

const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const REF_LABEL = { cardmarket: "Cardmarket-Trend", tcgplayer: "TCGplayer-Markt", sold: "Median echter Verkäufe", sealed: "Sealed-Referenzpreis" };
const COMP_SOURCE = { "ebay-sold": "eBay-Verkauf", "ebay-auction": "Auktionsende (letztes Gebot)", community: "Tausch-Hub" };
const FILTER_KEY = "ps_flip_filters";

const flip = {
  filters: { cat: "all", grade: "all", option: "all", lang: "all", minPct: 20, sort: "discount", ...readFilters() },
  data: null, loading: false, timer: null, comps: null, chartGrade: "raw", chartDays: 90,
};

function readFilters() {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") || {}; } catch { return {}; }
}
const pctTxt = (n) => `${Math.round(Number(n) || 0)} %`;
const timeLeft = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (!(ms > 0)) return "beendet";
  const h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000);
  return h >= 24 ? `${Math.floor(h / 24)} T ${h % 24} h` : h ? `${h} h ${m} min` : `${m} min`;
};
const ago = (iso) => {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return min < 1 ? "gerade eben" : min < 60 ? `vor ${min} min` : min < 1440 ? `vor ${Math.round(min / 60)} h` : `vor ${Math.round(min / 1440)} T`;
};
const keyOf = (kind, id) => `${kind}:${id}`;

// ---------------------------------------------------------------------------
// Deal-Feed
// ---------------------------------------------------------------------------
function panelHtml() {
  const sel = (id, opts, val, label) => `<label class="flex flex-col gap-0.5 text-[10px] font-bold text-slate-400">${label}
    <select id="${id}" onchange="PS.flipFilter()" class="bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-white">
      ${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
  const f = flip.filters;
  return `<div id="ps-flip-live" class="poke-glass rounded-3xl p-4 space-y-3">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 class="text-sm font-black text-white">📡 Live-Angebote unter Marktwert</h3>
        <p id="ps-flip-status" class="text-[11px] text-slate-400">Lade Angebote …</p>
      </div>
      <div class="flex gap-1.5">
        <button onclick="PS.flipReload()" class="bg-slate-800 text-white font-bold text-xs px-3 py-1.5 rounded-xl" aria-label="Neu laden">🔄</button>
      </div>
    </div>
    <div id="ps-flip-mode"></div>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      ${sel("ps-ff-cat", [["all", "Alles"], ["singles", "🃏 Einzelkarten"], ["sealed", "📦 Sealed"]], f.cat, "Kategorie")}
      ${sel("ps-ff-sort", [["discount", "Größter Rabatt"], ["savings", "Größte Ersparnis €"], ["ending", "Endet bald"], ["newest", "Neueste"]], f.sort, "Sortierung")}
      <div class="ps-pro-only contents">
        ${sel("ps-ff-grade", [["all", "Alle"], ["raw", "Raw (ungegradet)"], ["graded", "Graded (Slabs)"], ["psa10", "Nur PSA 10"]], f.grade, "Zustand")}
        ${sel("ps-ff-option", [["all", "Alle"], ["bin", "Sofort-Kaufen"], ["auction", "Auktionen (< 24 h)"]], f.option, "Angebotsart")}
        ${sel("ps-ff-lang", [["all", "Alle"], ["de", "🇩🇪 Deutsch"], ["en", "🇬🇧 Englisch"], ["ja", "🇯🇵 Japanisch"]], f.lang, "Sprache")}
        ${sel("ps-ff-min", [[20, "ab 20 %"], [25, "ab 25 % (Sniper)"], [30, "ab 30 %"], [40, "ab 40 %"]], f.minPct, "Mindest-Rabatt")}
      </div>
    </div>
    <div id="ps-flip-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
    <p class="text-[10px] text-slate-500">Rabatt = Gesamtpreis inkl. Versand gegenüber dem Referenzpreis (Cardmarket-Trend, TCGplayer oder Median echter Verkäufe derselben Note). Slabs werden nur mit genug Verkaufsdaten bewertet. *Partner-Link (eBay Partner Network) – für dich ohne Mehrkosten.</p>
    <div id="ps-flip-admin"></div>
  </div>
  <h3 class="text-xs font-black uppercase text-slate-400 px-1">📣 Community-Meldungen</h3>`;
}

function modeBanner(d) {
  if (d.mode === "live" && d.deals.length) return "";
  if (d.mode === "live") return `<div class="bg-slate-900 border border-slate-700 rounded-2xl p-3 text-xs text-slate-300">🟢 eBay ist verbunden. Für diese Filter gibt es gerade keine Angebote unter Marktwert. Unten stehen ersatzweise Cardmarket-Tiefstpreise. Der Radar prüft alle 10 Minuten neue Karten.</div>`;
  return `<div class="bg-amber-500/10 border border-amber-400/40 rounded-2xl p-3 text-xs text-amber-100 space-y-1">
    <p class="font-black text-amber-300">🟡 Demo-Modus: eBay-Anbindung noch nicht aktiv</p>
    <p>Die Karten unten sind <strong>echte Cardmarket-Daten</strong>: Der günstigste Angebotspreis liegt deutlich unter dem Trend. Konkrete eBay-Einzelangebote, Auktionen und Verkaufspreise erscheinen hier automatisch, sobald die eBay-Schnittstelle eingerichtet ist. Bis dahin führen die Knöpfe zur passenden eBay-Suche.</p>
  </div>`;
}

function dealCard(d, paid) {
  const img = d.image || d.targetImage;
  const pct = d.discountPct;
  const sniper = pct >= (flip.data?.sniperMinPct ?? 25);
  const badges = [
    d.gradeKey && d.gradeKey !== "raw" ? `<span class="bg-purple-500/20 text-purple-200 px-2 py-0.5 rounded-full">${esc(d.grade || GRADE_LABEL[d.gradeKey] || "")}</span>` : d.category === "singles" ? `<span class="bg-slate-800 text-slate-200 px-2 py-0.5 rounded-full">Raw${d.rawCondition ? ` · ${esc(d.rawCondition.toUpperCase())}` : ""}</span>` : `<span class="bg-slate-800 text-slate-200 px-2 py-0.5 rounded-full">📦 Sealed</span>`,
    d.lang ? `<span class="bg-slate-800 px-2 py-0.5 rounded-full">${FLAG[d.lang] || ""}</span>` : "",
    d.buyingOption === "AUCTION" ? `<span class="bg-amber-400/20 text-amber-200 px-2 py-0.5 rounded-full">⏱ Auktion · ${esc(timeLeft(d.endAt))}${d.bidCount ? ` · ${Number(d.bidCount)} Gebote` : ""}</span>` : d.source === "ebay" ? `<span class="bg-emerald-500/15 text-emerald-200 px-2 py-0.5 rounded-full">Sofort-Kaufen</span>` : "",
    d.source === "cardmarket-low" ? `<span class="bg-indigo-500/20 text-indigo-200 px-2 py-0.5 rounded-full">Cardmarket „ab“</span>` : "",
    d.source === "community-listing" ? `<span class="bg-cyan-500/20 text-cyan-200 px-2 py-0.5 rounded-full">Tausch-Hub</span>` : "",
  ].filter(Boolean).join("");
  const compsBtn = d.kind && d.targetId ? `<button onclick="PS.openComps(${jsArg(d.kind)}, ${jsArg(d.targetId)})" class="bg-slate-800 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl">📈 Verkaufspreise</button>` : "";
  if (d.locked) {
    return `<div class="poke-glass rounded-2xl p-4 relative overflow-hidden border-2 border-yellow-400/70 min-h-[150px]">
      <div class="sniper-blur space-y-2"><p class="text-xs font-black text-white">Pokémon-Karte (Pro-Deal)</p><p class="text-lg font-black text-emerald-400">?? €</p></div>
      <div class="absolute inset-0 bg-slate-950/80 backdrop-blur-[3px] flex flex-col items-center justify-center p-4 text-center">
        <p class="text-xs font-black text-yellow-400 uppercase">🔒 Sniper-Deal −${pctTxt(pct)} unter Marktwert</p>
        <p class="text-[11px] text-slate-200 mt-1">Angebote ab ${Number(flip.data?.sniperMinPct ?? 25)} % unter Marktwert siehst du mit Premium oder Pro.</p>
        <button onclick="openModal('pro-modal')" class="mt-2 bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black text-xs px-4 py-2 rounded-xl">👑 Jetzt aufdecken</button>
      </div></div>`;
  }
  const link = safeUrl(d.itemUrl);
  const main = d.source === "community-listing"
    ? `<button onclick="PS.requestTrade(${Number(d.listingId)})" class="bg-emerald-500 text-slate-950 text-xs font-black px-3 py-1.5 rounded-xl">🤝 Anfragen</button>`
    : link ? `<a href="${esc(link)}" target="_blank" rel="noopener sponsored" class="bg-emerald-500 text-slate-950 text-xs font-black px-3 py-1.5 rounded-xl">${d.source === "ebay" ? "🛒 Zum Angebot*" : "🔎 eBay-Suche*"}</a>` : "";
  const cmLink = d.source === "cardmarket-low" && window.buildCardmarketUrl ? `<a href="${esc(window.buildCardmarketUrl(d.targetName))}" target="_blank" rel="noopener" class="bg-indigo-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl">Cardmarket</a>` : "";
  const saving = d.refPrice && d.total ? d.refPrice - d.total : 0;
  return `<div class="poke-glass rounded-2xl p-3 flex gap-3 ${sniper ? "border-2 border-yellow-400/60" : ""}">
    <img src="${esc(cdn(img || FALLBACK_IMG, 160))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" class="w-20 h-28 object-contain rounded-lg bg-slate-950 shrink-0" />
    <div class="min-w-0 flex-1 flex flex-col gap-1.5">
      <div class="flex flex-wrap gap-1 text-[10px] font-bold">
        <span class="${sniper ? "bg-yellow-400 text-slate-950" : "bg-emerald-500/20 text-emerald-300"} px-2 py-0.5 rounded-full font-black">${sniper ? "👑 " : "🔥 "}−${pctTxt(pct)}</span>${badges}
      </div>
      <p class="text-xs font-bold text-white leading-snug line-clamp-2" title="${esc(d.title)}">${esc(d.title || d.targetName)}</p>
      <div class="flex items-end justify-between gap-2">
        <div>
          <p class="text-lg font-black text-emerald-400 leading-none">${eur(d.total)}</p>
          <p class="text-[10px] text-slate-400">${d.shipping != null && d.source === "ebay" ? `inkl. ${eur(d.shipping)} Versand • ` : ""}<del>${eur(d.refPrice)}</del> ${esc(REF_LABEL[d.refSource] || "Marktwert")}</p>
          <p class="text-[10px] text-emerald-300 ps-pro-only">Ersparnis ${eur(saving)}</p>
        </div>
      </div>
      ${d.suspicious ? `<p class="text-[10px] text-amber-300">⚠️ Ungewöhnlich günstig oder Verkäufer mit wenig Bewertungen – Fotos, Rückgabe und Echtheit prüfen.</p>` : ""}
      ${d.seller ? `<p class="text-[10px] text-slate-500 ps-pro-only">Verkäufer: ${esc(d.seller)}${d.sellerFeedbackPct != null ? ` (${String(d.sellerFeedbackPct).replace(".", ",")} % positiv${d.sellerFeedbackScore != null ? `, ${Number(d.sellerFeedbackScore)}` : ""})` : ""}${d.country ? ` • ${esc(d.country)}` : ""}</p>` : ""}
      <div class="flex flex-wrap gap-1.5 pt-1">${main}${cmLink}${compsBtn}</div>
    </div></div>`;
}

function renderDeals() {
  const d = flip.data;
  const grid = $("ps-flip-grid");
  if (!grid || !d) return;
  const status = $("ps-flip-status");
  if (status) status.textContent = d.mode === "live"
    ? `🟢 Live über die eBay-API • ${d.meta.offers} aktive Angebote geprüft, ${d.meta.deals} Deals${d.meta.lastSync ? ` • Stand ${ago(d.meta.lastSync)}` : ""}`
    : "🟡 Demo-Modus • echte Cardmarket-Daten, eBay folgt";
  $("ps-flip-mode").innerHTML = modeBanner(d);
  const list = d.deals.length ? d.deals : d.fallback;
  grid.innerHTML = list.length ? list.map((x) => dealCard(x, d.paid)).join("")
    : `<div class="md:col-span-2 xl:col-span-3 bg-slate-950 rounded-2xl p-6 text-center text-xs text-slate-400">Gerade nichts unter Marktwert mit diesen Filtern. Probiere einen kleineren Mindest-Rabatt oder „Alles“.</div>`;
  renderAdmin();
}

async function loadDeals({ quiet = false } = {}) {
  if (flip.loading) return;
  flip.loading = true;
  const f = flip.filters;
  const q = new URLSearchParams({ cat: f.cat, grade: f.grade, option: f.option, lang: f.lang, minPct: String(f.minPct), sort: f.sort, limit: "45" });
  try {
    flip.data = await api(`/api/flip/deals?${q}`);
    renderDeals();
  } catch (e) {
    if (!quiet) { const s = $("ps-flip-status"); if (s) s.textContent = "⚠️ Angebote konnten nicht geladen werden – bitte gleich erneut versuchen."; }
  } finally { flip.loading = false; }
}

function flipFilter() {
  const v = (id) => $(id)?.value;
  flip.filters = {
    cat: v("ps-ff-cat") || "all", sort: v("ps-ff-sort") || "discount", grade: v("ps-ff-grade") || "all",
    option: v("ps-ff-option") || "all", lang: v("ps-ff-lang") || "all", minPct: Number(v("ps-ff-min")) || 20,
  };
  localStorage.setItem(FILTER_KEY, JSON.stringify(flip.filters));
  loadDeals();
}

/** Die bisherigen Kategorie-Knöpfe im Kopf des Flip-Radars steuern jetzt auch den Live-Feed. */
function wrapLegacyFilter() {
  const legacy = window.filterFlipDeals;
  if (typeof legacy !== "function" || legacy.__psLive) return;
  const wrapped = function (cat = "all") {
    try { legacy(cat); } catch {}
    // Alte Liste zeigt nur noch Community-Meldungen (die Cardmarket-Liste steckt jetzt im Live-Feed)
    const old = $("flip-list");
    if (old) {
      let shown = 0;
      [...old.children].forEach((el) => { const keep = /Community-Meldung/.test(el.textContent || ""); el.classList.toggle("hidden", !keep); if (keep) shown++; });
      old.previousElementSibling?.classList?.toggle("hidden", !shown);
    }
    if (["all", "singles", "sealed"].includes(cat) && cat !== flip.filters.cat && $("ps-ff-cat")) {
      $("ps-ff-cat").value = cat;
      flipFilter();
    }
  };
  wrapped.__psLive = true;
  window.filterFlipDeals = wrapped;
}

function mountPanel() {
  const list = $("flip-list");
  if (!list || $("ps-flip-live")) return;
  const holder = document.createElement("div");
  holder.innerHTML = panelHtml();
  [...holder.children].forEach((el) => list.parentNode.insertBefore(el, list));
  wrapLegacyFilter();
  try { window.filterFlipDeals("all"); } catch {}
  loadDeals();
}

// ---------------------------------------------------------------------------
// Verkaufspreise, PSA-Werte & Grading-ROI
// ---------------------------------------------------------------------------
function gradeTable(c) {
  const rowsHtml = c.grades.filter((g) => g.sample90 || g.askCount || ["raw", "psa9", "psa10"].includes(g.key)).map((g) => `
    <tr class="border-t border-slate-800">
      <td class="py-1.5 pr-2 font-bold text-white whitespace-nowrap">${esc(g.label)}</td>
      <td class="py-1.5 pr-2 text-right font-black ${g.median30 ? "text-emerald-400" : "text-slate-500"}">${g.median30 ? eur(g.median30) : "–"}</td>
      <td class="py-1.5 pr-2 text-right text-slate-200">${g.median90 ? `${eur(g.median90)} <span class="text-slate-500">(${g.sample90})</span>` : "–"}</td>
      <td class="py-1.5 pr-2 text-right text-slate-400 ps-pro-only">${g.low90 ? `${eur(g.low90)}–${eur(g.high90)}` : "–"}</td>
      <td class="py-1.5 text-right text-slate-300">${g.askLow ? `${eur(g.askLow)} <span class="text-slate-500">(${g.askCount})</span>` : "–"}</td>
    </tr>`).join("");
  return `<div class="overflow-x-auto"><table class="w-full text-[11px]">
    <thead><tr class="text-slate-400 text-left"><th class="py-1 pr-2">Zustand</th><th class="py-1 pr-2 text-right">Median 30 T</th><th class="py-1 pr-2 text-right">Median 90 T (n)</th><th class="py-1 pr-2 text-right ps-pro-only">Spanne 90 T</th><th class="py-1 text-right">Günstigstes Angebot</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>`;
}

function chartHtml(c) {
  const days = flip.chartDays;
  const since = Date.now() - days * 86400_000;
  const g = flip.chartGrade;
  const pts = (g === "market" ? c.marketHistory.map((p) => ({ day: p.day, value: p.value })) : (c.series[g] || []).map((p) => ({ day: p.day, value: p.median })))
    .filter((p) => p.value > 0 && new Date(p.day).getTime() >= since);
  const options = [["market", c.target.kind === "sealed" ? "Referenzpreis" : "Marktpreis"], ...Object.keys(c.series).map((k) => [k, GRADE_LABEL[k] || k])];
  const values = pts.map((p) => p.value);
  const med = values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
  return `<div class="bg-slate-950 rounded-2xl p-3 border border-slate-800 space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap gap-1">${options.map(([k, l]) => `<button onclick="PS.compsChart(${jsArg(k)})" class="text-[10px] font-black px-2 py-1 rounded-lg ${k === g ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-300"}">${esc(l)}</button>`).join("")}</div>
      <div class="flex gap-1">${[30, 90].map((d) => `<button onclick="PS.compsDays(${d})" class="text-[10px] font-black px-2 py-1 rounded-lg ${d === days ? "bg-slate-200 text-slate-950" : "bg-slate-800 text-slate-300"}">${d} T</button>`).join("")}</div>
    </div>
    ${pts.length >= 2 ? areaChart(pts) : `<div class="h-28 flex items-center justify-center text-xs text-slate-400 text-center px-6">${g === "market" ? "Der Preisverlauf baut sich mit jedem Abgleich auf." : "Für diesen Zeitraum gibt es noch zu wenige Verkäufe dieser Note."}</div>`}
    ${med ? `<p class="text-[10px] text-slate-400">Median im Zeitraum: <strong class="text-white">${eur(med)}</strong> • ${pts.length} ${g === "market" ? "Tage" : "Verkaufstage"}</p>` : ""}
  </div>`;
}

function roiHtml(c) {
  const g = (k) => c.grades.find((x) => x.key === k) || {};
  const raw = g("raw").median30 || g("raw").median90 || c.target.market || g("raw").askLow || 0;
  const v10 = g("psa10").median90 || g("psa10").askLow || 0;
  const v9 = g("psa9").median90 || g("psa9").askLow || 0;
  const presets = c.gradingPresets || [];
  return `<div class="bg-slate-950 rounded-2xl p-3 border border-yellow-400/40 space-y-2 text-xs">
    <p class="font-black text-yellow-300">🏆 Grading-ROI-Rechner</p>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <label class="text-[10px] text-slate-400 font-bold">Rohkarte €${input("ps-roi-raw", `type="number" step="0.01" min="0" value="${raw ? Number(raw).toFixed(2) : ""}" oninput="PS.compsRoi()"`)}</label>
      <label class="text-[10px] text-slate-400 font-bold">Grading-Service
        <select id="ps-roi-preset" onchange="PS.compsPreset()" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-white">
          ${presets.map((p) => `<option value="${Number(p.fee)}">${esc(p.label)} (~${Number(p.fee)} €)</option>`).join("")}<option value="custom">Eigene Gebühr</option></select></label>
      <label class="text-[10px] text-slate-400 font-bold">Gebühr €${input("ps-roi-fee", `type="number" step="1" min="0" value="${presets[0] ? Number(presets[0].fee) : 25}" oninput="PS.compsRoi()"`)}</label>
      <label class="text-[10px] text-slate-400 font-bold">Versand + Vers. €${input("ps-roi-ship", `type="number" step="1" min="0" value="15" oninput="PS.compsRoi()"`)}</label>
      <label class="text-[10px] text-slate-400 font-bold">PSA-10-Wert €${input("ps-roi-v10", `type="number" step="0.01" min="0" value="${v10 ? Number(v10).toFixed(2) : ""}" oninput="PS.compsRoi()"`)}</label>
      <label class="text-[10px] text-slate-400 font-bold">PSA-9-Wert €${input("ps-roi-v9", `type="number" step="0.01" min="0" value="${v9 ? Number(v9).toFixed(2) : ""}" placeholder="≈ 45 % von PSA 10" oninput="PS.compsRoi()"`)}</label>
      <label class="text-[10px] text-slate-400 font-bold">Chance PSA 10: <span id="ps-roi-p10v">40 %</span><input id="ps-roi-p10" type="range" min="0" max="100" value="40" oninput="PS.compsRoi()" class="w-full accent-yellow-400" /></label>
      <label class="text-[10px] text-slate-400 font-bold">Chance PSA 9: <span id="ps-roi-p9v">40 %</span><input id="ps-roi-p9" type="range" min="0" max="100" value="40" oninput="PS.compsRoi()" class="w-full accent-yellow-400" /></label>
    </div>
    <label class="flex items-center gap-2 text-[11px] text-slate-300"><input id="ps-roi-biz" type="checkbox" onchange="PS.compsRoi()" class="accent-yellow-400" /> Gewerblich verkaufen (ca. 11 % eBay-Gebühren; privat in Deutschland gebührenfrei)</label>
    <div id="ps-roi-out" class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center"></div>
    <p class="text-[10px] text-slate-500">Werte aus echten Verkäufen derselben Note, sonst aus dem günstigsten aktiven Angebot. Gebühren sind Richtwerte, bitte vor dem Einschicken beim Anbieter prüfen. Rest-Wahrscheinlichkeit ≈ PSA 8 bzw. Rohwert.</p>
  </div>`;
}

function compsRoi() {
  const n = (id) => Number(String($(id)?.value || "").replace(",", ".")) || 0;
  let p10 = n("ps-roi-p10") / 100, p9 = n("ps-roi-p9") / 100;
  if (p10 + p9 > 1) { p9 = Math.max(0, 1 - p10); if ($("ps-roi-p9")) $("ps-roi-p9").value = String(Math.round(p9 * 100)); }
  if ($("ps-roi-p10v")) $("ps-roi-p10v").textContent = `${Math.round(p10 * 100)} %`;
  if ($("ps-roi-p9v")) $("ps-roi-p9v").textContent = `${Math.round(p9 * 100)} %`;
  const psa8 = flip.comps?.grades?.find((g) => g.key === "psa8")?.median90 || null;
  const r = gradingRoi({ raw: n("ps-roi-raw"), fee: n("ps-roi-fee"), shipping: n("ps-roi-ship"), psa10: n("ps-roi-v10"), psa9: n("ps-roi-v9") || null, psa8, p10, p9, sellFeePct: $("ps-roi-biz")?.checked ? 11 : 0 });
  const out = $("ps-roi-out");
  if (!out) return;
  if (!n("ps-roi-v10")) { out.innerHTML = `<p class="col-span-full text-[11px] text-slate-400">Trage einen PSA-10-Wert ein, um den Ertrag zu berechnen.</p>`; return; }
  const tile = (label, value, cls = "text-white") => `<div class="bg-slate-900 rounded-xl p-2"><p class="text-[10px] text-slate-400 font-bold uppercase">${label}</p><p class="text-sm font-black ${cls}">${value}</p></div>`;
  out.innerHTML = [
    tile("Einsatz", eur(r.cost)),
    tile("Erwarteter Erlös", eur(r.expected)),
    tile("Erwarteter Gewinn", `${r.profit >= 0 ? "+" : "−"}${eur(Math.abs(r.profit))}${r.roiPct != null ? ` (${r.roiPct > 0 ? "+" : ""}${String(r.roiPct).replace(".", ",")} %)` : ""}`, r.worth ? "text-emerald-400" : "text-rose-400"),
    tile("Lohnt ab PSA-10-Quote", r.breakEvenP10 == null ? "nicht erreichbar" : `${String(r.breakEvenP10).replace(".", ",")} %`, r.breakEvenP10 != null && r.breakEvenP10 <= 40 ? "text-emerald-400" : "text-amber-300"),
  ].join("") + `<p class="col-span-full text-[11px] ${r.worth ? "text-emerald-300" : "text-rose-300"} font-bold">${r.worth ? "✅ Grading lohnt sich voraussichtlich." : "❌ Grading lohnt sich bei diesen Werten eher nicht."} Bei PSA 10: ${r.profitIf10 >= 0 ? "+" : "−"}${eur(Math.abs(r.profitIf10))}.</p>`;
}

function soldList(c) {
  if (!c.sold.length) {
    return `<div class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs text-slate-400 space-y-1">
      <p>${c.mode === "live" ? "Noch keine erfassten Verkäufe. Der Radar übernimmt beendete Auktionen mit Geboten automatisch als Verkaufsdaten." : "Verkaufsdaten erscheinen automatisch, sobald die eBay-Anbindung aktiv ist."}</p>
      <a href="${esc(safeUrl(c.soldSearchUrl))}" target="_blank" rel="noopener sponsored" class="inline-block text-sky-300 underline font-bold">Verkaufte Angebote bei eBay ansehen*</a></div>`;
  }
  return `<div class="space-y-1">${c.sold.map((s) => `
    <div class="flex items-center justify-between gap-2 bg-slate-900 rounded-xl px-3 py-1.5 text-[11px]">
      <div class="min-w-0"><p class="text-white truncate" title="${esc(s.title)}">${esc(s.title || c.target.name)}</p>
        <p class="text-slate-500">${new Date(s.soldAt).toLocaleDateString("de-DE")} • ${esc(s.grade || "Raw")} ${s.lang ? FLAG[s.lang] || "" : ""} • ${esc(COMP_SOURCE[s.source] || s.source)}</p></div>
      <div class="flex items-center gap-2 shrink-0"><strong class="text-emerald-400">${eur(s.price)}</strong>${safeUrl(s.url) ? `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener sponsored" class="text-sky-300" aria-label="Angebot ansehen">↗</a>` : ""}</div>
    </div>`).join("")}</div>`;
}

function offersList(c) {
  if (!c.offers.length) return `<p class="text-[11px] text-slate-400">${c.mode === "live" ? "Gerade keine passenden eBay-Angebote gefunden." : "Live-Angebote folgen mit der eBay-Anbindung."} <a href="${esc(safeUrl(c.searchUrl))}" target="_blank" rel="noopener sponsored" class="text-sky-300 underline font-bold">Bei eBay suchen*</a></p>`;
  return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${c.offers.slice(0, 12).map((o) => o.locked
    ? `<div class="bg-slate-900 rounded-xl px-3 py-2 text-[11px] text-yellow-300 font-bold">🔒 Sniper-Angebot −${pctTxt(o.discountPct)} <button onclick="openModal('pro-modal')" class="underline">mit Premium aufdecken</button></div>`
    : `<a href="${esc(safeUrl(o.itemUrl))}" target="_blank" rel="noopener sponsored" class="flex items-center justify-between gap-2 bg-slate-900 hover:bg-slate-800 rounded-xl px-3 py-2 text-[11px]">
        <span class="min-w-0"><span class="block text-white truncate">${esc(o.title)}</span>
          <span class="text-slate-500">${esc(o.grade || "Raw")} • ${o.buyingOption === "AUCTION" ? `Auktion, noch ${esc(timeLeft(o.endAt))}` : "Sofort-Kaufen"}${o.discountPct != null && o.isDeal ? ` • <span class="text-emerald-300 font-bold">−${pctTxt(o.discountPct)}</span>` : ""}</span></span>
        <strong class="text-emerald-400 shrink-0">${eur(o.total)}*</strong></a>`).join("")}</div>`;
}

function renderComps() {
  const c = flip.comps;
  if (!c) return;
  const t = c.target;
  const sealed = c.sealed;
  modal("ps-comps", `
    <div class="flex gap-3 items-start">
      <img src="${esc(cdn(t.image || FALLBACK_IMG, 200))}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="w-20 h-28 object-contain rounded-lg bg-slate-950 shrink-0" />
      <div class="min-w-0 space-y-0.5 text-xs">
        <p class="text-[10px] font-black uppercase text-purple-300">📈 Verkaufspreise & Grading</p>
        <h3 class="text-base font-black text-white">${esc(t.name)} ${t.number ? `<span class="text-slate-400">${esc(t.number)}</span>` : ""} ${FLAG[t.lang] || ""}</h3>
        <p class="text-slate-300">${t.market ? `${t.kind === "sealed" ? "Referenzpreis" : REF_LABEL[t.marketSource] || "Marktpreis"}: <strong class="text-emerald-400">${eur(t.market)}</strong>` : "Noch kein Marktpreis"}</p>
        ${sealed ? `<p class="text-[11px] text-slate-400">${sealed.locked ? "🔒 Admin-Preis (manueller Override)" : sealed.autoSource ? `🤖 Automatisch aus ${esc(sealed.autoSourceLabel || sealed.autoSource)} (${Number(sealed.autoSample) || 0} Werte)` : "Automatischer Preis folgt"}${sealed.autoPriceAt ? ` • ${esc(ago(sealed.autoPriceAt))}` : ""}${sealed.boosterCount && t.market ? ` • ${eur(t.market / sealed.boosterCount)} pro Booster` : ""}</p>` : ""}
        <p class="text-[10px] text-slate-500">${c.mode === "live" ? `🟢 eBay live${c.insights ? " inkl. Verkaufsdaten-API" : ""}${t.lastSyncedAt ? ` • geprüft ${esc(ago(t.lastSyncedAt))}` : " • noch nicht abgeglichen"}` : "🟡 Demo-Modus: eBay-Anbindung noch nicht aktiv"}</p>
      </div>
    </div>
    ${c.mode === "live" && t.kind !== "sealed" ? `<button onclick="PS.compsRefresh()" id="ps-comps-refresh" class="w-full bg-slate-800 text-white font-bold py-2 rounded-xl text-xs">🔄 Jetzt bei eBay abgleichen</button>` : ""}
    ${t.kind !== "sealed" ? gradeTable(c) : ""}
    ${chartHtml(c)}
    ${t.kind !== "sealed" ? `<details class="ps-pro-details" ${document.body.classList.contains("ps-pro") ? "open" : ""}><summary class="cursor-pointer text-xs font-black text-yellow-300 py-1">🏆 Lohnt sich Grading? (ROI-Rechner)</summary>${roiHtml(c)}</details>` : ""}
    <div class="space-y-1.5"><p class="text-xs font-black text-white">🛒 Aktuelle Angebote</p>${offersList(c)}</div>
    <div class="space-y-1.5"><p class="text-xs font-black text-white">🧾 Zuletzt verkauft</p>${soldList(c)}</div>
    <p class="text-[10px] text-slate-500">Verkaufsdaten: eBay (echte Verkäufe, wenn freigeschaltet, sonst beendete Auktionen mit Geboten). Ausreißer wie Konvolute oder Fälschungen werden herausgefiltert. *Partner-Link</p>`, { wide: true });
  if (t.kind !== "sealed") compsRoi();
}

async function openComps(kind, id) {
  if (!["card", "print", "sealed"].includes(kind) || !id) return;
  modal("ps-comps", `<p class="text-yellow-400 text-xs font-bold text-center py-6">⏳ Lade Verkaufspreise …</p>`, { wide: true });
  try {
    flip.comps = await api(`/api/flip/comps/${encodeURIComponent(keyOf(kind, id))}`);
    flip.chartGrade = Object.keys(flip.comps.series).includes("raw") ? "raw" : "market";
    renderComps();
  } catch (e) { closeModalEl("ps-comps"); handleError(e); }
}

async function compsRefresh() {
  const c = flip.comps;
  if (!c || !requireLogin()) return;
  const b = $("ps-comps-refresh");
  if (b) { b.disabled = true; b.textContent = "⏳ Frage eBay ab …"; }
  try {
    const r = await api(`/api/flip/refresh/${encodeURIComponent(keyOf(c.target.kind, c.target.id))}`, { method: "POST" });
    toast("🔄 Abgeglichen", r.fresh ? "Die Karte wurde gerade erst geprüft – die Daten sind aktuell." : `${r.stored ?? 0} passende Angebote, davon ${r.deals ?? 0} Deals.`);
    await openComps(c.target.kind, c.target.id);
  } catch (e) { handleError(e); if (b) { b.disabled = false; b.textContent = "🔄 Jetzt bei eBay abgleichen"; } }
}

/** Kurzübersicht für die Kartenansicht (Raw/PSA 10 + bestes Angebot) mit Knopf zur vollen Ansicht. */
async function compsSummary(slotId, kind, id) {
  const slot = $(slotId);
  if (!slot) return;
  slot.innerHTML = `<button onclick="PS.openComps(${jsArg(kind)}, ${jsArg(id)})" class="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black py-2.5 rounded-xl text-xs">📈 Verkaufspreise, PSA-Werte & Live-Angebote</button>`;
  try {
    const c = await api(`/api/flip/comps/${encodeURIComponent(keyOf(kind, id))}`);
    if (!$(slotId)) return;
    const g = (k) => c.grades.find((x) => x.key === k) || {};
    const best = c.offers.find((o) => !o.locked);
    const tile = (label, v, sub) => `<div class="bg-slate-950 rounded-xl p-2 text-center"><p class="text-[10px] text-slate-400 font-bold uppercase">${label}</p><p class="text-sm font-black text-white">${v}</p><p class="text-[9px] text-slate-500">${sub}</p></div>`;
    const raw = g("raw"), p10 = g("psa10"), p9 = g("psa9");
    const tiles = [
      tile("Raw verkauft", raw.median90 ? eur(raw.median90) : "–", raw.sample90 ? `Median, ${raw.sample90} Verkäufe` : "noch keine Daten"),
      tile("PSA 9", p9.median90 ? eur(p9.median90) : p9.askLow ? `ab ${eur(p9.askLow)}` : "–", p9.median90 ? `${p9.sample90} Verkäufe` : p9.askLow ? "Angebot" : ""),
      tile("PSA 10", p10.median90 ? eur(p10.median90) : p10.askLow ? `ab ${eur(p10.askLow)}` : "–", p10.median90 ? `${p10.sample90} Verkäufe` : p10.askLow ? "Angebot" : ""),
      tile("Bestes Angebot", best ? eur(best.total) : "–", best ? `${best.grade || "Raw"}${best.isDeal ? ` • −${pctTxt(best.discountPct)}` : ""}` : c.mode === "live" ? "keins gefunden" : "eBay folgt"),
    ];
    slot.innerHTML = `<div class="space-y-2"><div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${tiles.join("")}</div>${slot.innerHTML}</div>`;
  } catch {}
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
const admin = { data: null, open: false };

function renderAdmin() {
  const box = $("ps-flip-admin");
  if (!box) return;
  if (!state.me?.isAdmin) { box.innerHTML = ""; return; }
  const d = admin.data;
  box.innerHTML = `<details ${admin.open ? "open" : ""} ontoggle="PS.flipAdminToggle(this.open)" class="bg-slate-950 border border-slate-700 rounded-2xl p-3 text-xs">
    <summary class="cursor-pointer font-black text-white">🛠️ Admin: eBay-Sync & Sealed-Preise</summary>
    ${!d ? `<p class="text-slate-400 py-2">Lade Status …</p>` : `
    <div class="space-y-2 pt-2">
      <p class="${d.configured ? "text-emerald-300" : "text-amber-300"} font-bold">${d.configured ? `🟢 eBay-API verbunden${d.insights ? " • Verkaufsdaten-API (Marketplace Insights) freigeschaltet" : " • Verkaufsdaten-API nicht freigeschaltet: beendete Auktionen dienen als Verkaufsdaten"}` : "🟡 EBAY_CLIENT_ID / EBAY_CLIENT_SECRET fehlen – Demo-Modus"}</p>
      ${d.deletionWebhook ? `<p class="${d.deletionWebhook.tokenSet ? "text-emerald-300" : "text-amber-300"} font-bold">${d.deletionWebhook.tokenSet ? "🟢 Kontolöschungs-Webhook bereit" : "🟡 Kontolöschungs-Webhook: EBAY_VERIFICATION_TOKEN fehlt oder ist ungültig (32–80 Zeichen: A–Z, a–z, 0–9, _ und -)"} • <span class="font-mono text-[10px] text-slate-300 break-all">${esc(d.deletionWebhook.endpoint)}</span></p>` : ""}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        ${[["Ziele (24 h)", `${d.counts.targets24}/${d.counts.targets}`], ["Aktive Angebote", d.counts.offers], ["Deals", d.counts.deals], ["Verkäufe", `${d.counts.comps} (${d.counts.comps_sold} API)`]].map(([l, v]) => `<div class="bg-slate-900 rounded-xl p-2"><p class="text-[10px] text-slate-400 uppercase font-bold">${l}</p><p class="font-black text-white">${esc(String(v))}</p></div>`).join("")}
      </div>
      <div class="flex flex-wrap gap-2">${btn("▶️ Flip-Sync jetzt", "PS.flipAdminRun('flip')", "bg-yellow-400 text-slate-950")}${btn("📦 Sealed-Preise jetzt", "PS.flipAdminRun('sealed')", "bg-slate-800 text-white")}</div>
      <div class="max-h-40 overflow-y-auto space-y-1">${d.runs.map((r) => `<p class="text-[10px] ${r.error ? "text-amber-300" : "text-slate-400"}">${new Date(r.startedAt).toLocaleString("de-DE")} • ${esc(r.job)} • ${esc(r.mode)} • ${r.queries} Abfragen • ${r.offers} Angebote • ${r.deals} Deals • ${r.comps} Verkäufe${r.updated ? ` • ${r.updated} Preise` : ""}${r.error ? ` • ${esc(r.error)}` : ""}</p>`).join("") || `<p class="text-slate-500">Noch keine Läufe.</p>`}</div>
      <p class="font-black text-white pt-1">📦 Sealed-Preise (${d.counts.sealed_auto}/${d.counts.sealed} automatisch, ${d.counts.sealed_locked} gesperrt)</p>
      <div class="max-h-72 overflow-y-auto space-y-1">${d.sealed.map((p) => `
        <div class="flex flex-wrap items-center gap-2 bg-slate-900 rounded-xl px-2 py-1.5">
          <span class="flex-1 min-w-[140px] text-white">${esc(p.name)}</span>
          <span class="text-slate-300">${p.ref_price ? eur(p.ref_price) : "–"}</span>
          <span class="text-[10px] text-slate-500">${p.auto_price ? `auto ${eur(p.auto_price)} (${esc(SEALED_SOURCE_LABEL[p.auto_price_source] || p.auto_price_source || "")}, n=${Number(p.auto_sample) || 0})` : "auto –"}</span>
          <input id="ps-sq-${Number(p.id)}" value="${esc(p.ebay_query || "")}" placeholder="eBay-Suchbegriff (optional)" maxlength="90" class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-white w-40" />
          <button onclick="PS.flipAdminLock(${Number(p.id)}, ${p.price_locked ? "false" : "true"})" class="text-[10px] font-black px-2 py-1 rounded-lg ${p.price_locked ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-200"}">${p.price_locked ? "🔒 Override – freigeben" : "🤖 Auto – sperren"}</button>
          <button onclick="PS.flipAdminQuery(${Number(p.id)})" class="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800 text-slate-200">💾</button>
        </div>`).join("")}</div>
      <p class="text-[10px] text-slate-500">Preise aus dem CSV-Import oder dem Admin-Formular gelten als manueller Override und werden gesperrt. „Freigeben“ übernimmt sofort den automatisch berechneten Preis.</p>
    </div>`}
  </details>`;
}

async function loadAdmin() {
  if (!state.me?.isAdmin) return;
  try { admin.data = await api("/api/admin/flip"); renderAdmin(); } catch (e) { handleError(e); }
}

const flipAdminApi = {
  flipAdminToggle: (open) => { admin.open = open; if (open && !admin.data) loadAdmin(); },
  flipAdminRun: async (job) => {
    toast("⏳ Läuft …", job === "sealed" ? "Sealed-Preise werden aktualisiert (bis zu 20 Sekunden)." : "Flip-Radar fragt eBay ab (bis zu 20 Sekunden).");
    try {
      const r = await api(job === "sealed" ? "/api/admin/sealed-prices/run" : "/api/admin/flip/run", { method: "POST" });
      admin.data = r.status; renderAdmin();
      toast("✅ Fertig", `${r.result.mode === "demo" ? "Demo-Modus. " : ""}${r.result.queries ?? 0} Abfragen, ${r.result.offers ?? 0} Angebote${r.result.deals != null ? `, ${r.result.deals} Deals` : ""}${r.result.updated != null ? `, ${r.result.updated} Preise` : ""}.`);
      loadDeals({ quiet: true });
    } catch (e) { handleError(e); }
  },
  flipAdminLock: async (id, locked) => {
    try { await api(`/api/admin/sealed/${Number(id)}/lock`, { method: "POST", body: { locked } }); loadAdmin(); } catch (e) { handleError(e); }
  },
  flipAdminQuery: async (id) => {
    try { await api(`/api/admin/sealed/${Number(id)}/lock`, { method: "POST", body: { ebayQuery: $(`ps-sq-${Number(id)}`)?.value || "" } }); toast("💾 Gespeichert", "Der Suchbegriff gilt ab dem nächsten Preis-Lauf."); } catch (e) { handleError(e); }
  },
};

// ---------------------------------------------------------------------------
// Öffentliche API & Start
// ---------------------------------------------------------------------------
export const flipApi = {
  flipFilter, flipReload: () => loadDeals(), openComps, compsRoi, compsRefresh, compsSummary,
  compsChart: (g) => { flip.chartGrade = g; renderComps(); },
  compsDays: (d) => { flip.chartDays = d === 30 ? 30 : 90; renderComps(); },
  compsPreset: () => {
    const v = $("ps-roi-preset")?.value;
    if (v && v !== "custom" && $("ps-roi-fee")) $("ps-roi-fee").value = v;
    compsRoi();
  },
  ...flipAdminApi,
};

/** Nach Login/Abo-Wechsel neu laden (Sniper-Deals freischalten, Admin-Bereich). */
export function syncFlip() {
  if (!$("ps-flip-live")) return;
  loadDeals({ quiet: true });
  if (admin.open) loadAdmin();
}

export function initFlip() {
  mountPanel();
  // Alle 5 Minuten neu laden, solange der Flip-Radar sichtbar ist
  clearInterval(flip.timer);
  flip.timer = setInterval(() => {
    if (!document.hidden && !$("view-flip")?.classList.contains("hidden")) loadDeals({ quiet: true });
  }, 5 * 60_000);
}
