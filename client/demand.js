// Marktplatz füllen: „🔥 Gesucht aus deiner Sammlung“ – Karten, die andere Sammler auf der Wunschliste haben,
// mit einem Tipp inserieren (Schnell-Inserieren mit vorausgefülltem Preis). Dazu die „Meistgesucht“-Liste für den
// Leer-Zustand des Marktplatzes, damit Besucher sofort sehen, womit sie den Marktplatz füllen können.
import { $, esc, jsArg, eur, toast, state, api, handleError, requireLogin, modal, closeModalEl, btn, cdn, FALLBACK_IMG } from "./core.js";

const dm = { items: [], wanted: null, at: 0 };
const COND = { M: "mint", NM: "nm", EX: "ex", GD: "gd", LP: "lp", PL: "pl", PO: "po" };
const img = (u) => esc(u ? cdn(u, 120) : FALLBACK_IMG);

/** Nachfrage-Eintrag → Treffer-Format des Schnell-Inserierens (mit Verknüpfung zum Sammlungs-Eintrag). */
export function demandToQuickList(d) {
  const print = d.printId && d.lang && d.lang !== "de";
  const id = print ? d.printId : d.cardId;
  if (!id) return null;
  return {
    key: `${print ? "print" : "card"}:${id}`, kind: print ? "print" : "card", id, lang: d.lang || "de",
    name: d.name, number: "", setName: d.setName || "", image: d.image || "",
    price: Number(d.suggestedPrice) || Number(d.market) || null,
    condition: COND[String(d.condition || "").toUpperCase()] || "",
    variant: d.variant || "normal", portfolioItemId: Number(d.portfolioItemId) || null, source: "portfolio",
  };
}

function listQuick(list) {
  const infos = list.map(demandToQuickList).filter(Boolean);
  if (!infos.length) return toast("Nicht möglich", "Für diese Karten fehlt die Katalog-Verknüpfung.");
  closeModalEl("ps-demand");
  if (window.PS?.liveScanQuickList) window.PS.liveScanQuickList(infos, { instant: false });
  else toast("Gleich bereit", "Das Schnell-Inserieren lädt noch – bitte noch einmal tippen.");
}

function row(d, i) {
  const price = d.suggestedPrice ? eur(d.suggestedPrice) : "–";
  const max = d.maxPrice ? ` • Wunschpreis bis ${eur(d.maxPrice)}` : "";
  return `<div class="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-2xl p-2">
    <img src="${img(d.image)}" alt="" loading="lazy" class="w-11 h-16 object-contain rounded-lg bg-slate-900">
    <div class="flex-1 min-w-0">
      <p class="text-sm font-black text-white truncate">${esc(d.name)}</p>
      <p class="text-[11px] text-slate-400 truncate">${esc(d.setName)}${d.quantity > 1 ? ` • ${d.quantity}× in deiner Sammlung` : ""}</p>
      <p class="text-[11px] text-amber-200">🔥 ${d.wishers}× gesucht${max}</p>
    </div>
    <div class="text-right space-y-1">
      <p class="text-xs font-black text-emerald-300">${price}</p>
      <button type="button" onclick="PS.listDemandItem(${i})" class="bg-yellow-400 text-slate-950 font-black text-[11px] px-2.5 py-1.5 rounded-xl">🏷️ Inserieren</button>
    </div>
  </div>`;
}

async function openDemand() {
  if (!requireLogin()) return;
  modal("ps-demand", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Suche Nachfrage für deine Sammlung …</p>`);
  try {
    const r = await api("/api/market/demand");
    dm.items = r.items || []; dm.at = Date.now();
    const total = dm.items.reduce((s, d) => s + (Number(d.suggestedPrice) || 0), 0);
    modal("ps-demand", `
      <h3 class="text-base font-black text-white">🔥 Gesucht aus deiner Sammlung</h3>
      ${dm.items.length ? `
        <p class="text-xs text-slate-300">${dm.items.length === 1 ? "1 Karte" : `${dm.items.length} Karten`} aus deiner Sammlung ${dm.items.length === 1 ? "steht" : "stehen"} bei anderen Sammlern auf der Wunschliste.
          Sobald du inserierst, werden die Suchenden sofort benachrichtigt.${total ? ` Zusammen etwa <b class="text-emerald-300">${eur(total)}</b>.` : ""}</p>
        <div class="space-y-2 max-h-[55dvh] overflow-y-auto">${dm.items.map(row).join("")}</div>
        <div class="grid grid-cols-1 gap-2">${btn(`🏷️ Alle ${dm.items.length > 20 ? "20 wichtigsten " : ""}inserieren`, "PS.listAllDemand()", "w-full bg-yellow-400 text-slate-950")}</div>
        <p class="text-[10px] text-slate-500">Vor dem Veröffentlichen kannst du Preis, Zustand und Käuferschutz noch anpassen.</p>`
      : `<p class="text-xs text-slate-300">Gerade sucht niemand eine Karte, die du noch nicht anbietest${r.alreadyListed ? ` – ${r.alreadyListed} gesuchte ${r.alreadyListed === 1 ? "Karte ist" : "Karten sind"} schon inseriert 👍` : ""}.
          Wir melden uns, sobald jemand eine deiner Karten auf die Wunschliste setzt.</p>
        <div class="grid grid-cols-2 gap-2">${btn("📷 Karte scannen", "PS.closeDemand(); PS.openScanner()", "bg-slate-800 text-white")}${btn("🏪 Bestand importieren", "PS.closeDemand(); PS.openSellerHub()", "bg-slate-800 text-white")}</div>`}
    `);
  } catch (e) { closeModalEl("ps-demand"); handleError(e); }
}

/** Öffentliche „Meistgesucht“-Liste (ohne Angebot) für den Leer-Zustand – einmal pro Sitzung geladen. */
async function loadWanted() {
  if (dm.wanted) return dm.wanted;
  try { dm.wanted = (await api("/api/market/wanted")).items || []; } catch { dm.wanted = []; }
  return dm.wanted;
}

/** Leer-Zustand des Marktplatzes: Verkaufen statt Sackgasse. */
export function emptyMarketHtml(filtered) {
  setTimeout(fillWanted, 0);
  return `<div class="poke-glass rounded-2xl p-5 text-center space-y-3">
    <p class="text-sm font-black text-white">${filtered ? "Noch keine passenden Inserate" : "🚀 Sei unter den ersten Verkäufern"}</p>
    <p class="text-xs text-slate-300">${filtered ? "Setze die Karte auf deine Wunschliste – du wirst benachrichtigt, sobald jemand sie anbietet." : "Der Marktplatz ist ganz neu. Wer jetzt inseriert, wird von allen Suchenden zuerst gefunden."}</p>
    <div class="grid grid-cols-2 gap-2">
      ${btn("🔥 Was suchen andere?", "PS.openDemand()", "bg-yellow-400 text-slate-950")}
      ${btn("📷 Scannen & verkaufen", "PS.openScanner()", "bg-slate-800 text-white")}
    </div>
    <div id="ps-wanted-box" class="text-left"></div>
  </div>`;
}

async function fillWanted() {
  const box = $("ps-wanted-box");
  if (!box) return;
  const list = await loadWanted();
  if (!list.length || !$("ps-wanted-box")) return;
  $("ps-wanted-box").innerHTML = `<p class="text-[11px] font-black text-amber-200 mb-1.5">🔥 Meistgesucht – noch ohne Angebot</p>
    <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${list.slice(0, 8).map((w) => `
      <button type="button" onclick="PS.sellCatalogCard(${jsArg(w.cardId)}, ${jsArg(w.name)}, ${Number(w.market) || 0}, ${jsArg(w.image)}, ${jsArg(w.setName)})"
        class="bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-xl p-1.5 text-center" title="Hast du sie? Jetzt inserieren">
        <img src="${img(w.image)}" alt="" loading="lazy" class="w-full h-20 object-contain">
        <span class="block text-[10px] text-white truncate">${esc(w.name)}</span>
        <span class="block text-[10px] text-amber-200">${w.wishers}× gesucht</span>
      </button>`).join("")}</div>
    <p class="text-[10px] text-slate-500 mt-1">Tippe auf eine Karte, die du besitzt, um sie zu inserieren.</p>`;
}

/** Kachel im Bereich „Meine Verkäufe“: Anzahl gesuchter Karten (wird nachgeladen). */
export function demandTileHtml() {
  if (!state.user) return "";
  setTimeout(async () => {
    try {
      // Höchstens einmal pro Minute neu laden (der Bereich wird bei jedem Moduswechsel neu gezeichnet)
      if (!dm.at || Date.now() - dm.at > 60_000) { dm.items = (await api("/api/market/demand")).items || []; dm.at = Date.now(); }
      const el = $("ps-demand-tile-sub");
      if (el) el.textContent = dm.items.length ? `${dm.items.length} ${dm.items.length === 1 ? "Karte wird" : "Karten werden"} gesucht – jetzt inserieren` : "Niemand sucht gerade deine Karten";
    } catch {}
  }, 0);
  return `<button type="button" onclick="PS.openDemand()" class="w-full text-left bg-gradient-to-r from-amber-500/20 to-yellow-400/10 border border-amber-400/50 hover:border-yellow-400 rounded-2xl p-3 min-h-[64px]">
    <span class="block text-sm font-black text-amber-100">🔥 Gesucht aus deiner Sammlung</span>
    <span id="ps-demand-tile-sub" class="block text-[11px] text-slate-300">Prüfe, welche deiner Karten andere suchen …</span></button>`;
}

/** Link aus der Benachrichtigung („/?tab=map&sell=wanted“) */
export function routeDemand() {
  const q = new URLSearchParams(location.search);
  if (q.get("sell") !== "wanted") return;
  history.replaceState(null, "", location.pathname);
  if (state.user) openDemand();
}

export const demandApi = {
  openDemand,
  closeDemand: () => closeModalEl("ps-demand"),
  listDemandItem: (i) => { const d = dm.items[Number(i)]; if (d) listQuick([d]); },
  listAllDemand: () => listQuick(dm.items.slice(0, 20)),
};
