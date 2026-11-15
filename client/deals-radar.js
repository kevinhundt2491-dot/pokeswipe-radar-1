// PokeSwipe & Radar – Phase 5 im Browser: geteilte Community-Deals im Flip-Radar und Sammler-Radar über die eigene API.
// Beides nur mit Konto (bestätigte E-Mail); Melden, Blockieren und Admin-Moderation laufen über die gemeinsame Community-Moderation.
// Ersetzt die früheren Browser-Funktionen submitCommunityDeal() (nur lokal sichtbar) und registerMyRadarPin() (anonym in Firebase).
import { $, esc, jsArg, safeUrl, eur, toast, cdn, FALLBACK_IMG, state, api, handleError, requireLogin, btn } from "./core.js";

const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const live = { deals: [], cat: "all", dealTimer: null, radarTimer: null, pins: [] };

const ago = (d) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (m < 60) return `vor ${m} Min.`;
  if (m < 1440) return `vor ${Math.round(m / 60)} Std.`;
  return `vor ${Math.round(m / 1440)} T.`;
};

// ---------------------------------------------------------------------------
// Community-Deals
// ---------------------------------------------------------------------------
function ensureDealUi() {
  const title = $("rep-title");
  if (!title || $("ps-cdeals")) return;
  const box = title.closest(".poke-glass");
  if (!box) return;
  const extra = document.createElement("div");
  extra.className = "space-y-2";
  extra.innerHTML = `
    <div class="flex gap-2">
      <input id="rep-url" type="url" maxlength="400" placeholder="Link zum Angebot (https://…, optional)" class="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
      <select id="rep-cat" class="bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white"><option value="singles">🃏 Karte</option><option value="sealed">📦 Sealed</option></select>
      <select id="rep-lang" class="bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white"><option value="de">🇩🇪</option><option value="en">🇬🇧</option><option value="ja">🇯🇵</option></select>
    </div>
    <p class="text-[10px] text-slate-400">Für alle sichtbar, 72 Std. aktiv. Tipp: Kartennummer angeben (z. B. „Glurak ex 199/165“) – dann rechnen wir den Rabatt zum Marktwert aus. Nur mit Konto, Spam- & Link-Filter aktiv.</p>
    <div id="ps-cdeals" class="space-y-2 max-h-80 overflow-y-auto"></div>`;
  box.appendChild(extra);
}

function dealHtml(d) {
  const link = safeUrl(d.url);
  const known = d.marketPrice && d.discountPct !== null;
  return `<div class="bg-slate-950 border ${known && d.discountPct >= 20 ? "border-emerald-500/60" : "border-slate-800"} rounded-xl p-2.5 text-xs flex gap-2">
    ${d.image ? `<img src="${esc(cdn(d.image, 120))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" class="w-10 h-14 object-contain rounded shrink-0" alt="" />` : ""}
    <div class="min-w-0 flex-1 space-y-0.5">
      <p class="font-bold text-white truncate">${esc(FLAG[d.lang] || "")} ${esc(d.title)}</p>
      <p><span class="text-emerald-400 font-black">${eur(d.price)}</span>${known ? ` <span class="text-slate-400">statt <del>${eur(d.marketPrice)}</del></span> <span class="font-black ${d.discountPct >= 0 ? "text-emerald-300" : "text-rose-300"}">${d.discountPct >= 0 ? "−" : "+"}${Math.abs(d.discountPct)} %</span>` : ` <span class="text-slate-500">Marktwert unbekannt</span>`}${d.shop ? ` • ${esc(d.shop)}` : ""}</p>
      <p class="text-[10px] text-slate-500">${esc(d.author.level?.icon || "")} ${esc(d.author.name)}${d.author.verified ? " ✔" : ""} • ${ago(d.createdAt)}${d.pending ? ` • <span class="text-amber-300">wird geprüft</span>` : ""}</p>
      <div class="flex flex-wrap gap-1 pt-1">
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener nofollow ugc" class="bg-blue-600 text-white font-bold px-2 py-1 rounded-lg">Zum Angebot ↗</a>` : ""}
        ${d.mine ? `<button onclick="PS.deleteCommunityDeal(${Number(d.id)})" class="bg-rose-500/20 text-rose-300 font-bold px-2 py-1 rounded-lg">🗑️</button>`
          : `<button onclick="PS.voteCommunityDeal(${Number(d.id)}, 1)" class="${d.myVote === 1 ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-emerald-300"} font-bold px-2 py-1 rounded-lg">👍 Noch da ${d.up}</button>
             <button onclick="PS.voteCommunityDeal(${Number(d.id)}, -1)" class="${d.myVote === -1 ? "bg-rose-500 text-white" : "bg-slate-800 text-rose-300"} font-bold px-2 py-1 rounded-lg">👎 Weg ${d.down}</button>
             <button onclick="PS.report('deal', ${jsArg(String(d.id))})" class="bg-slate-800 text-slate-400 px-2 py-1 rounded-lg" title="Melden">🚩</button>
             <button onclick="PS.blockUser && PS.blockUser(${jsArg(d.author.id)})" class="bg-slate-800 text-slate-400 px-2 py-1 rounded-lg" title="Blockieren">⛔</button>`}
      </div>
    </div>
  </div>`;
}

function renderDeals() {
  const box = $("ps-cdeals");
  if (!box) return;
  const list = live.cat === "all" ? live.deals : live.deals.filter((d) => d.category === live.cat);
  box.innerHTML = list.length ? `<p class="text-[10px] font-black uppercase text-emerald-300">📣 Live-Community-Deals (${list.length})</p>${list.map(dealHtml).join("")}`
    : `<p class="text-[11px] text-slate-500">Noch keine Community-Deals – melde das erste Schnäppchen!</p>`;
}

async function loadDeals() {
  if (document.hidden) return;
  try {
    const r = await api("/api/flip/community-deals");
    live.deals = r.deals || [];
    renderDeals();
  } catch {}
}

async function submitDeal() {
  if (!requireLogin()) return;
  const title = ($("rep-title")?.value || "").trim();
  const price = String($("rep-price")?.value || "").replace(",", ".");
  if (title.length < 4 || !(Number(price) > 0)) return toast("🚨 Deal melden", "Bitte Karte/Produkt und Preis angeben.");
  try {
    const r = await api("/api/flip/community-deals", { method: "POST", body: { title, price, url: ($("rep-url")?.value || "").trim(), category: $("rep-cat")?.value || "singles", lang: $("rep-lang")?.value || "de" } });
    ["rep-title", "rep-price", "rep-url"].forEach((id) => { if ($(id)) $(id).value = ""; });
    toast(r.pending ? "⏳ Wird geprüft" : "🚨 Deal geteilt!", r.notice || (r.marketPrice ? `Marktwert ${eur(r.marketPrice)} – jetzt für alle sichtbar.` : "Jetzt für alle sichtbar."));
    loadDeals();
  } catch (e) { handleError(e); }
}

async function voteDeal(id, vote) {
  if (!requireLogin()) return;
  try {
    const r = await api(`/api/flip/community-deals/${Number(id)}/vote`, { method: "POST", body: { vote } });
    const d = live.deals.find((x) => x.id === Number(id));
    if (d) { d.up = r.up; d.down = r.down; d.myVote = r.myVote; }
    renderDeals();
  } catch (e) { handleError(e); }
}

async function deleteDeal(id) {
  if (!confirm("Deal löschen?")) return;
  try { await api(`/api/flip/community-deals/${Number(id)}`, { method: "DELETE" }); loadDeals(); } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Sammler-Radar
// ---------------------------------------------------------------------------
async function loadPins() {
  if (document.hidden) return;
  try {
    const r = await api("/api/radar");
    live.pins = r.pins || [];
    window.psSetRadarUsers?.(live.pins);
  } catch {}
}

function renderPins() {
  const box = $("radar-user-list");
  if (!box) return;
  if (!live.pins.length) {
    box.innerHTML = `<p class="text-xs text-slate-500 col-span-2">Noch keine Sammler-Pins eingetragen. Setze jetzt den ersten Pin (Konto nötig)!</p>`;
    return;
  }
  box.innerHTML = live.pins.map((u) => `
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-3 flex justify-between items-center gap-2 text-xs">
      <div class="min-w-0">
        <p class="font-bold text-white truncate">${esc(u.level?.icon || "")} ${esc(u.name)}${u.verified ? ` <span class="text-cyan-300">✔</span>` : ""} <span class="text-yellow-400">(${esc(u.city)})</span></p>
        <p class="text-slate-400 mt-0.5 truncate">🃏 ${esc(u.cards)}</p>
        <p class="text-[10px] text-slate-500">${ago(u.timestamp)} • Standort auf ~1 km gerundet${u.pending ? ` • <span class="text-amber-300">wird geprüft</span>` : ""}</p>
      </div>
      <div class="flex gap-1 shrink-0">
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(u.city)}" target="_blank" rel="noopener" class="bg-blue-600/20 text-blue-300 border border-blue-500/30 font-bold px-2 py-1.5 rounded-lg">🗺️</a>
        ${u.mine ? `<button onclick="PS.deleteRadarPin()" class="bg-rose-500/20 text-rose-300 font-bold px-2 py-1.5 rounded-lg" title="Pin entfernen">🗑️</button>`
          : `<button onclick="PS.openUser && PS.openUser(${jsArg(u.userId)})" class="bg-slate-800 text-white px-2 py-1.5 rounded-lg" title="Profil & Bewertungen">👤</button>
             <button onclick="PS.report('radar', ${jsArg(u.userId)})" class="bg-slate-800 text-slate-400 px-2 py-1.5 rounded-lg" title="Melden">🚩</button>
             <button onclick="PS.blockUser && PS.blockUser(${jsArg(u.userId)})" class="bg-slate-800 text-slate-400 px-2 py-1.5 rounded-lg" title="Blockieren">⛔</button>`}
      </div>
    </div>`).join("");
}

async function savePin(lat, lng, name, city, cards) {
  try {
    const r = await api("/api/radar", { method: "PUT", body: { name, city, cards, lat, lng } });
    toast(r.pending ? "⏳ Pin wird geprüft" : "📍 Radar-Pin gesetzt!", r.notice || `${city} ist jetzt (auf ~1 km gerundet) auf der Sammler-Karte sichtbar.`);
    loadPins();
  } catch (e) { handleError(e); }
}

function registerPin() {
  if (!requireLogin()) return;
  const name = ($("radar-my-name")?.value || "").trim().slice(0, 35) || state.me?.displayName || "";
  const city = ($("radar-my-city")?.value || "").trim().slice(0, 60);
  const cards = ($("radar-my-cards")?.value || "").trim().slice(0, 120);
  if (city.length < 2 || cards.length < 2) return toast("📍 Sammler-Radar", "Bitte Ort und Karten angeben.");
  const geocode = async () => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de,at,ch&q=${encodeURIComponent(city)}`, { headers: { "Accept-Language": "de" }, signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
      if (!res.ok) throw new Error("Geocoding");
      const hit = (await res.json())[0];
      if (hit) return savePin(Number(hit.lat), Number(hit.lon), name, city, cards);
    } catch {}
    toast("📍 Ort nicht gefunden", "Bitte Stadt oder PLZ genauer angeben oder GPS erlauben.");
  };
  // Die genaue Position verlässt das Gerät nur zur Rundung: der Server speichert ausschließlich die ~1-km-Rasterzelle
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition((pos) => savePin(pos.coords.latitude, pos.coords.longitude, name, city, cards), geocode, { timeout: 8000 });
  else geocode();
}

async function deletePin() {
  if (!confirm("Deinen Radar-Pin entfernen?")) return;
  try { await api("/api/radar", { method: "DELETE" }); toast("📍 Pin entfernt", ""); loadPins(); } catch (e) { handleError(e); }
}

async function blockUser(userId) {
  if (!requireLogin()) return;
  if (!confirm("Diese Person blockieren? Ihr seht gegenseitig keine Beiträge, Deals, Pins und Anfragen mehr.")) return;
  try {
    await api("/api/community/blocks", { method: "POST", body: { userId } });
    toast("⛔ Blockiert", "Du siehst die Inhalte dieser Person nicht mehr.");
    loadDeals(); loadPins();
  } catch (e) { handleError(e); }
}

export const dealsRadarApi = {
  submitCommunityDealLive: submitDeal, voteCommunityDeal: voteDeal, deleteCommunityDeal: deleteDeal,
  registerRadarPinLive: registerPin, deleteRadarPin: deletePin, reloadRadar: loadPins,
};

export function initDealsRadar() {
  // Frühere Browser-Funktionen ersetzen (Buttons in index.html rufen diese Namen auf)
  window.submitCommunityDeal = submitDeal;
  window.registerMyRadarPin = registerPin;
  window.renderRadarUsers = renderPins;
  if (window.PS && !window.PS.blockUser) window.PS.blockUser = blockUser;
  ensureDealUi();
  const startDeals = () => {
    ensureDealUi(); loadDeals();
    clearInterval(live.dealTimer);
    live.dealTimer = setInterval(() => { if (!$("view-flip")?.classList.contains("hidden")) loadDeals(); }, 30_000);
  };
  const startRadar = () => {
    loadPins();
    clearInterval(live.radarTimer);
    live.radarTimer = setInterval(() => { if (!$("view-map")?.classList.contains("hidden")) loadPins(); }, 60_000);
  };
  if (!$("view-flip")?.classList.contains("hidden")) startDeals();
  if (!$("view-map")?.classList.contains("hidden")) startRadar();
  window.addEventListener("ps:tab", (e) => {
    if (e.detail === "flip") startDeals();
    if (e.detail === "map" || e.detail === "community") startRadar();
  });
  setTimeout(() => { if (!live.deals.length) loadDeals(); if (!live.pins.length) loadPins(); }, 5000);
}
