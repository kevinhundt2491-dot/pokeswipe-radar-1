// Phase 6: echtes Swipe-Trading im Browser
// • Match-Vorschlag (nach gegenseitigem Interesse) mit Marktwert-Vergleich und Wertausgleich
// • Strukturierte Tauschanfrage: Karten aus der eigenen Sammlung auswählen statt Freitext
// • Tausch-Schritte: Versand mit Sendungsnummer je Seite, Erhalt je Seite, Abschluss
import { $, esc, jsArg, safeUrl, eur, toast, cdn, state, api, handleError, requireLogin, modal, closeModalEl, btn, FALLBACK_IMG } from "./core.js";

const VARIANT_LABEL = { normal: "Normal", reverse_holo: "Reverse Holo", holo: "Holo", first_edition: "1st Edition", shadowless: "Shadowless", promo: "Promo" };
const cents = (c) => eur((Number(c) || 0) / 100);
const draft = { partnerId: "", listingId: 0, matchId: 0, want: [], give: new Map(), partnerName: "", binderPartner: "" };

function thumb(item, w = 80) {
  return `<img src="${esc(item.image ? cdn(item.image, w) : FALLBACK_IMG)}" onerror="this.src='${FALLBACK_IMG}'" class="w-9 h-12 object-contain rounded shrink-0" loading="lazy" />`;
}
const itemLine = (i) => `<div class="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl p-2">${thumb(i)}
  <div class="min-w-0 flex-1"><p class="font-bold text-white truncate">${Number(i.quantity) > 1 ? `${Number(i.quantity)}× ` : ""}${esc(i.name)}</p>
  <p class="text-[10px] text-slate-400">${esc(i.variantLabel || VARIANT_LABEL[i.variant] || "Normal")} • ${esc(i.condition || "NM")}${i.lang && i.lang !== "de" ? ` • ${esc(String(i.lang).toUpperCase())}` : ""}</p></div>
  <span class="font-black text-emerald-300 shrink-0">${cents(i.valueCents)}</span></div>`;

function balanceHtml(giveCents, wantCents, cashCents, payer) {
  const mine = giveCents + (payer === "from" ? cashCents : 0);
  const theirs = wantCents + (payer === "to" ? cashCents : 0);
  const diff = mine - theirs;
  const larger = Math.max(mine, theirs);
  const ratio = larger ? Math.abs(diff) / larger : 0;
  const verdict = ratio <= 0.15 ? ["⚖️ Fairer Tausch", "text-emerald-300"] : diff > 0 ? ["⬆️ Du gibst mehr", "text-amber-300"] : ["⬇️ Partner gibt mehr", "text-amber-300"];
  return `<div class="bg-slate-950 border border-slate-800 rounded-2xl p-3 grid grid-cols-3 gap-2 text-center text-xs">
    <div><p class="text-slate-400">Du gibst</p><p class="font-black text-white">${cents(mine)}</p></div>
    <div><p class="text-slate-400">Du bekommst</p><p class="font-black text-white">${cents(theirs)}</p></div>
    <div><p class="text-slate-400">Bilanz</p><p class="font-black ${verdict[1]}">${verdict[0]}</p></div></div>`;
}

// ---------------------------------------------------------------------------
// Match-Vorschlag
// ---------------------------------------------------------------------------
function openMatchProposal(p) {
  if (!p?.match) return;
  draft.matchId = p.match.id; draft.partnerId = p.partner.id; draft.partnerName = p.partner.name;
  draft.listingId = p.want.find((w) => w.listingId)?.listingId || 0;
  draft.want = p.want;
  draft.give = new Map(p.give.filter((g) => g.portfolioItemId).map((g) => [g.portfolioItemId, 1]));
  const cash = p.suggestedCash || { cashCents: 0, payer: "" };
  modal("ps-match", `
    <div class="text-center space-y-1">
      <p class="text-3xl">🔥</p>
      <h3 class="text-lg font-black text-white">It's a Match mit ${esc(p.partner.name)}!</h3>
      <p class="text-xs text-slate-300">${p.match.reason === "like" ? "Ihr habt gegenseitig Karten gewischt." : "Du hast eine Karte gewischt, die auf der Wunschliste deines Partners steht – und umgekehrt."}${p.partner.city ? ` 📍 ${esc(p.partner.city)}` : ""}</p>
    </div>
    ${p.stale ? `<p class="text-xs text-amber-300">Eine der Karten ist inzwischen nicht mehr verfügbar. Wähle unten selbst aus, was du anbietest.</p>` : ""}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
      <div class="space-y-1.5"><p class="font-black text-emerald-300">Du bekommst</p>${p.want.map(itemLine).join("") || `<p class="text-slate-500">–</p>`}</div>
      <div class="space-y-1.5"><p class="font-black text-cyan-300">Du gibst</p>${p.give.map(itemLine).join("") || `<p class="text-slate-500">Noch keine Karte – bitte auswählen.</p>`}</div>
    </div>
    ${balanceHtml(p.balance.fromValue, p.balance.toValue, cash.cashCents, cash.payer)}
    ${cash.cashCents ? `<p class="text-xs text-slate-300 text-center">Vorschlag Wertausgleich: <strong class="text-white">${cents(cash.cashCents)}</strong> ${cash.payer === "from" ? "von dir" : `von ${esc(p.partner.name)}`}</p>` : ""}
    <div class="grid grid-cols-2 gap-2">
      ${btn("✏️ Anpassen", `PS.openTradeComposer(${jsArg(p.partner.id)}, ${Number(draft.listingId)}, ${Number(p.match.id)})`, "bg-slate-800 text-white")}
      ${btn("🤝 Vorschlag senden", `PS.sendMatchProposal(${Number(cash.cashCents)}, ${jsArg(cash.payer)})`, "bg-emerald-500 text-slate-950")}
    </div>
    ${btn("Nicht interessiert", `PS.dismissMatch(${Number(p.match.id)})`, "w-full bg-transparent text-slate-400")}`);
}

async function sendMatchProposal(cashCents, payer) {
  try {
    const give = [...draft.give].map(([portfolioItemId, quantity]) => ({ portfolioItemId, quantity }));
    const want = draft.want.map((w) => (w.listingId ? { listingId: w.listingId } : { portfolioItemId: w.portfolioItemId }));
    if (!give.length && !(cashCents > 0 && payer === "from")) return openTradeComposer(draft.partnerId, draft.listingId, draft.matchId);
    const t = await api("/api/trades", { method: "POST", body: { matchId: draft.matchId, want, give, cashCents, cashPayer: payer || "" } });
    closeModalEl("ps-match");
    toast("📨 Tauschvorschlag gesendet", `${draft.partnerName} bekommt eine Mitteilung.`);
    window.PS?.openTrades?.(t.id);
  } catch (e) { handleError(e); }
}

async function dismissMatch(id) {
  try { await api(`/api/matches/${Number(id)}/dismiss`, { method: "POST", body: {} }); closeModalEl("ps-match"); loadMatchesInto(); }
  catch (e) { handleError(e); }
}

async function openMatchById(id) {
  try { openMatchProposal(await api(`/api/matches/${Number(id)}/proposal`)); } catch (e) { handleError(e); }
}

async function openMatches() {
  if (!requireLogin()) return;
  modal("ps-matches", `<h3 class="text-base font-black text-white">🔥 Meine Matches</h3><div id="ps-matches-list" class="space-y-1.5 text-xs"><p class="text-yellow-400 text-center py-4">⏳ Lade …</p></div>`);
  loadMatchesInto();
}

async function loadMatchesInto() {
  const box = $("ps-matches-list");
  if (!box) return;
  try {
    const { matches } = await api("/api/matches");
    box.innerHTML = matches.length ? matches.map((m) => `<button onclick="PS.openMatchById(${Number(m.id)})" class="w-full text-left flex items-center gap-2 bg-slate-900 border ${m.status === "open" ? "border-rose-400/60" : "border-slate-800"} rounded-xl p-2">
        ${thumb(m.want)}<div class="min-w-0 flex-1"><p class="font-black text-white truncate">${esc(m.partner.name)} ${m.status === "proposed" ? `<span class="text-cyan-300 font-normal">• Vorschlag gesendet</span>` : ""}</p>
        <p class="text-slate-400 truncate">Du bekommst ${esc(m.want.name || "–")} • du gibst ${esc(m.give.name || "–")}</p></div>${thumb(m.give)}</button>`).join("")
      : `<p class="text-slate-400 text-center py-4">Noch keine Matches. Wische Tausch-Inserate nach rechts – sobald jemand auch etwas von dir möchte, gibt es ein Match.</p>`;
  } catch (e) { box.innerHTML = `<p class="text-rose-300 text-center py-4">${esc(e.message)}</p>`; }
}

// ---------------------------------------------------------------------------
// Strukturierte Tauschanfrage (Karten aus der eigenen Sammlung + optionaler Wertausgleich)
// ---------------------------------------------------------------------------
async function ensurePortfolio() {
  if (state.portfolio?.items) return state.portfolio.items;
  await window.PS?.loadPortfolio?.();
  return state.portfolio?.items || [];
}

async function openTradeComposer(partnerId, listingId, matchId = 0) {
  if (!requireLogin()) return;
  closeModalEl("ps-match");
  const listing = (state.listings || []).find((l) => l.id === Number(listingId));
  draft.partnerId = partnerId || listing?.user_id || draft.partnerId;
  draft.listingId = Number(listingId) || 0;
  draft.matchId = Number(matchId) || 0;
  draft.binderPartner = "";
  if (listing) {
    api(`/api/listings/${listing.id}/view`, { method: "POST", body: {} }).catch(() => {});
    draft.partnerName = listing.seller;
    draft.want = [{ listingId: listing.id, name: listing.card_name, image: listing.image, variant: listing.variant, condition: listing.condition || "NM", valueCents: Math.round((Number(listing.market_price) || Number(listing.price) || 0) * 100), quantity: 1 }];
  }
  if (!draft.give) draft.give = new Map();
  modal("ps-trade-req", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade deine Sammlung …</p>`, { wide: true });
  const items = await ensurePortfolio();
  renderComposer(items);
}

function composerTotals(items) {
  const wantCents = draft.want.reduce((s, w) => s + (Number(w.valueCents) || 0) * (Number(w.quantity) || 1), 0);
  const giveCents = items.filter((i) => draft.give.has(i.id)).reduce((s, i) => s + Math.round((Number(i.unitValue) || 0) * 100) * (draft.give.get(i.id) || 1), 0);
  const cashCents = Math.max(0, Math.round((Number(($("ps-tr-cash")?.value || "").replace(",", ".")) || 0) * 100));
  const payer = $("ps-tr-payer")?.value || "from";
  return { wantCents, giveCents, cashCents, payer };
}

function refreshBalance() {
  const t = composerTotals(state.portfolio?.items || []);
  const box = $("ps-tr-balance");
  if (box) box.innerHTML = balanceHtml(t.giveCents, t.wantCents, t.cashCents, t.payer);
}

function renderComposer(items) {
  const { wantCents, giveCents, cashCents, payer } = composerTotals(items);
  const msgKeep = $("ps-tr-msg")?.value || "";
  modal("ps-trade-req", `
    <h3 class="text-base font-black text-white">🤝 Tausch vorschlagen${draft.partnerName ? ` an ${esc(draft.partnerName)}` : ""}</h3>
    <div class="space-y-1.5 text-xs"><p class="font-black text-emerald-300">Du möchtest</p>${draft.want.map(itemLine).join("")}</div>
    <div class="space-y-1.5 text-xs">
      <p class="font-black text-cyan-300">Du bietest aus deiner Sammlung (max. 10)</p>
      <div class="max-h-60 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">${items.length ? items.map((i) => {
        const on = draft.give.has(i.id);
        return `<button type="button" onclick="PS.toggleTradeGive(${Number(i.id)})" class="text-left flex items-center gap-2 rounded-xl p-2 border ${on ? "border-yellow-400 bg-yellow-400/10" : "border-slate-800 bg-slate-900"}">
          ${thumb(i)}<div class="min-w-0 flex-1"><p class="font-bold text-white truncate">${esc(i.name)}</p>
          <p class="text-[10px] text-slate-400">${esc(i.variantLabel || "Normal")} • ${esc(i.condition || "NM")} • ${Number(i.quantity)}×</p></div>
          <span class="text-[11px] font-black ${on ? "text-yellow-300" : "text-slate-300"}">${on ? "✓ " : ""}${eur(Number(i.unitValue) || 0)}</span></button>`;
      }).join("") : `<p class="text-slate-400 col-span-full">Deine Sammlung ist leer – du kannst einen Wertausgleich anbieten.</p>`}</div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <label class="space-y-1"><span class="text-slate-300 font-bold">Wertausgleich (€)</span>
        <input id="ps-tr-cash" inputmode="decimal" value="${cashCents ? (cashCents / 100).toFixed(2).replace(".", ",") : ""}" oninput="PS.tradeComposerRefresh()" placeholder="0,00" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" /></label>
      <label class="space-y-1"><span class="text-slate-300 font-bold">Zahlt</span>
        <select id="ps-tr-payer" onchange="PS.tradeComposerRefresh()" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white">
          <option value="from" ${payer === "from" ? "selected" : ""}>ich</option><option value="to" ${payer === "to" ? "selected" : ""}>mein Partner</option></select></label>
    </div>
    <div id="ps-tr-balance">${balanceHtml(giveCents, wantCents, cashCents, payer)}</div>
    <textarea id="ps-tr-msg" maxlength="1000" rows="2" placeholder="Nachricht (optional)" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">${esc(msgKeep)}</textarea>
    ${btn("Tauschanfrage senden", "PS.sendTradeRequest()", "w-full bg-emerald-500 text-slate-950")}
    <p class="text-[10px] text-slate-500">Werte: Cardmarket-Trend je Variante und Zustand. Beide versenden mit Sendungsnummer und bestätigen den Erhalt – erst dann wechseln die Karten in eurer Sammlung.</p>`, { wide: true });
}

function toggleTradeGive(id) {
  if (draft.give.has(id)) draft.give.delete(id);
  else if (draft.give.size < 10) draft.give.set(id, 1);
  else toast("Tausch", "Höchstens 10 Karten pro Seite.");
  renderComposer(state.portfolio?.items || []);
}

async function sendTradeRequest() {
  const cashEur = Number(($("ps-tr-cash")?.value || "").replace(",", ".")) || 0;
  if (cashEur < 0 || cashEur > 5000) return toast("Wertausgleich", "Bitte einen Betrag zwischen 0 und 5.000 € angeben.");
  const cashCents = Math.round(cashEur * 100);
  const body = {
    listingId: draft.listingId || undefined, matchId: draft.matchId || undefined,
    partnerId: !draft.listingId && !draft.matchId && draft.binderPartner ? draft.binderPartner : undefined,
    want: draft.want.map((w) => (w.listingId ? { listingId: w.listingId } : { portfolioItemId: w.portfolioItemId })),
    give: [...draft.give].map(([portfolioItemId, quantity]) => ({ portfolioItemId, quantity })),
    cashCents, cashPayer: cashCents ? ($("ps-tr-payer")?.value || "from") : "",
    message: $("ps-tr-msg")?.value || "",
  };
  try {
    const t = await api("/api/trades", { method: "POST", body });
    closeModalEl("ps-trade-req");
    draft.give = new Map();
    toast("📨 Anfrage gesendet", "Du bekommst eine Mitteilung, sobald geantwortet wird.");
    window.PS?.openTrades?.(t.id);
  } catch (e) {
    if (e.data?.tradeId) { closeModalEl("ps-trade-req"); window.PS?.openTrades?.(e.data.tradeId); return; }
    handleError(e);
  }
}

/** Live-Online-Radar: Tauschangebot direkt aus der Binder-Vorschau eines Sammlers (Karte vorausgefüllt). */
async function openBinderTrade(partnerId, partnerName, item) {
  if (!requireLogin()) return;
  if (!partnerId || !item) return;
  closeModalEl("ps-collector");
  draft.partnerId = partnerId;
  draft.partnerName = partnerName || "";
  draft.matchId = 0;
  draft.listingId = Number(item.listingId) || 0;
  draft.binderPartner = draft.listingId ? "" : partnerId;
  draft.want = [{
    listingId: draft.listingId || undefined, portfolioItemId: draft.listingId ? undefined : Number(item.portfolioItemId) || undefined,
    name: item.name, image: item.image, variant: item.variant, condition: item.condition || "NM", lang: item.lang,
    valueCents: Math.round((Number(item.market) || Number(item.price) || 0) * 100), quantity: 1,
  }];
  draft.give = new Map();
  modal("ps-trade-req", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade deine Sammlung …</p>`, { wide: true });
  const items = await ensurePortfolio();
  renderComposer(items);
}

/** Startpunkt aus Tausch-Hub, Swipe-Details oder Kartenansicht. */
function requestTrade(listingId) {
  if (!requireLogin()) return;
  const l = (state.listings || []).find((x) => x.id === Number(listingId));
  if (!l) { toast("Inserat", "Das Angebot findest du im Tausch-Hub."); window.PS?.goMarket?.(); return; }
  draft.give = new Map();
  openTradeComposer(l.user_id, l.id, 0);
}

// ---------------------------------------------------------------------------
// Tausch-Detail: Positionen, Versand und Erhalt
// ---------------------------------------------------------------------------
const CARRIERS = { dhl: "DHL", dpd: "DPD", hermes: "Hermes", gls: "GLS", ups: "UPS", post: "Deutsche Post", other: "Andere" };

/** Zusätzlicher Block für die Tausch-Detailansicht in client/main.js (strukturierte Tausche). */
export function tradeDetailHtml(x) {
  if (!x?.structured) return "";
  const mineSide = x.role === "sender" ? "from" : "to";
  const otherSide = mineSide === "from" ? "to" : "from";
  const mineItems = x.items.filter((i) => i.side === mineSide), theirItems = x.items.filter((i) => i.side === otherSide);
  const myShipped = x[`${mineSide}_shipped_at`], theirShipped = x[`${otherSide}_shipped_at`];
  const iReceived = x[`${otherSide}_received_at`];
  const theirTrack = safeUrl(x[`${otherSide}TrackingUrl`]);
  const cashLine = Number(x.cash_cents) ? `<p class="text-xs text-slate-300">Wertausgleich: <strong class="text-white">${cents(x.cash_cents)}</strong> ${x.cash_payer === mineSide ? "zahlst du" : "zahlt dein Partner"} (bei Übergabe/Versand vereinbaren, nur mit Käuferschutz).</p>` : "";
  const giveValue = mineItems.reduce((s, i) => s + i.valueCents * i.quantity, 0), getValue = theirItems.reduce((s, i) => s + i.valueCents * i.quantity, 0);
  const cashMine = x.cash_payer === mineSide ? Number(x.cash_cents) : 0, cashTheirs = x.cash_payer === otherSide ? Number(x.cash_cents) : 0;
  return `<div class="space-y-2">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
      <div class="space-y-1.5"><p class="font-black text-cyan-300">Du gibst</p>${mineItems.map(itemLine).join("") || `<p class="text-slate-500">nur Wertausgleich</p>`}</div>
      <div class="space-y-1.5"><p class="font-black text-emerald-300">Du bekommst</p>${theirItems.map(itemLine).join("") || `<p class="text-slate-500">nur Wertausgleich</p>`}</div>
    </div>
    ${balanceHtml(giveValue + cashMine, getValue + cashTheirs, 0, "")}
    ${cashLine}
    ${["accepted", "shipping"].includes(x.status) ? `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2 text-xs">
      <p class="font-black text-white">📦 Versand</p>
      <p class="text-slate-300">Du: ${myShipped ? `✅ versendet (${esc(CARRIERS[x[`${mineSide}_carrier`]] || "")} ${esc(x[`${mineSide}_tracking`] || "")})` : "⏳ noch nicht versendet"}</p>
      <p class="text-slate-300">Partner: ${theirShipped ? `✅ versendet${theirTrack ? ` – <a href="${esc(theirTrack)}" target="_blank" rel="noopener" class="underline text-cyan-300">Sendung verfolgen</a>` : ""}` : "⏳ noch nicht versendet"}</p>
      ${myShipped ? "" : `<div class="grid grid-cols-3 gap-1.5">
        <select id="ps-tr-carrier" class="bg-slate-950 border border-slate-700 rounded-xl px-2 py-2 text-white">${Object.entries(CARRIERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <input id="ps-tr-track" maxlength="40" placeholder="Sendungsnummer" class="col-span-2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white" /></div>
        ${btn("📮 Versand eintragen", `PS.tradeShip(${Number(x.id)})`, "w-full bg-cyan-400 text-slate-950")}`}
      ${theirShipped && !iReceived ? btn("📬 Paket des Partners erhalten", `PS.tradeAction(${Number(x.id)}, 'received')`, "w-full bg-emerald-500 text-slate-950") : ""}
      ${iReceived ? `<p class="text-emerald-300">✓ Du hast den Erhalt bestätigt.</p>` : ""}
    </div>` : ""}
  </div>`;
}

async function tradeShip(id) {
  const carrier = $("ps-tr-carrier")?.value || "";
  const tracking = ($("ps-tr-track")?.value || "").trim();
  try {
    await api(`/api/trades/${Number(id)}/action`, { method: "POST", body: { action: "ship", carrier, tracking } });
    toast("📮 Versand eingetragen", "Dein Partner wurde benachrichtigt.");
    window.PS?.openTrades?.(Number(id));
  } catch (e) { handleError(e); }
}

export const tradingApi = {
  openMatchProposal, sendMatchProposal, dismissMatch, openMatchById, openMatches, openTradeComposer, toggleTradeGive,
  tradeComposerRefresh: refreshBalance, sendTradeRequest, requestTrade, tradeShip, openBinderTrade,
};

/** Deep-Link /?tab=trades&match=<id> aus der Push-Mitteilung */
export function routeTrading() {
  const id = Number(new URLSearchParams(location.search).get("match"));
  if (id > 0 && state.user) openMatchById(id);
}
