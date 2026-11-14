// PokeSwipe & Radar – Wachstum & Bindung im Browser:
// Wunschliste mit Tausch-Matches, Teilen-Bilder, Grading-Rechner mit KI-Zustandscheck, Serien-Scan,
// CSV-Import, Kalender, Abzeichen & Bestenliste, tägliche Serie, Shop-Statistik, Konto & Datenschutz, Offline-Hinweis.
import {
  $, esc, eur, pct, toast, FALLBACK_IMG, cdn, state, api, handleError, requireLogin, modal, closeModalEl, input, btn,
} from "./core.js";
import { csvToRows } from "./csv.js";
import { gradingEstimate } from "../server/logic.ts";

const PS = () => window.PS;
const card = (inner, border = "border-slate-800") => `<div class="bg-slate-950 rounded-2xl p-3 border ${border} text-xs space-y-2">${inner}</div>`;
const pill = (text, cls = "bg-yellow-400 text-slate-950") => `<span class="text-[10px] font-black uppercase ${cls} px-2.5 py-0.5 rounded-full">${text}</span>`;
const jsArg = (v) => esc(JSON.stringify(String(v ?? "")));

// ===========================================================================
// 1. Wunschliste mit Tausch-Abgleich
// ===========================================================================
let wish = null;

export function wishlistPanelHtml() {
  return `<div id="ps-wishlist" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-rose-400/40">
    <div>
      ${pill("❤️ Wunschliste & Tausch-Matches", "bg-rose-400 text-slate-950")}
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Sag uns, was dir fehlt – wir finden es</h2>
      <p class="text-xs text-slate-300">Sobald jemand eine Karte von deiner Wunschliste inseriert, bekommst du sofort eine Push-Nachricht. Dazu zeigen wir dir Sammler, die genau das suchen, was du besitzt.</p>
    </div>
    <div class="flex gap-2 text-xs"><input id="ps-wish-q" placeholder="🔎 Karte suchen und auf die Wunschliste setzen …" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" />
      <button id="ps-wish-go" class="bg-rose-400 text-slate-950 font-black px-4 rounded-xl">Suchen</button></div>
    <div id="ps-wish-results" class="grid grid-cols-3 sm:grid-cols-6 gap-2"></div>
    <div id="ps-wish-body" class="space-y-4"></div>
  </div>`;
}

async function searchWish() {
  const q = $("ps-wish-q")?.value.trim();
  const box = $("ps-wish-results");
  if (!q || !box) return;
  box.innerHTML = `<p class="col-span-full text-yellow-400 text-xs text-center">⏳ Suche …</p>`;
  try {
    const data = await (await fetch(`https://api.tcgdex.net/v2/de/cards?name=${encodeURIComponent(q)}`)).json();
    const list = (Array.isArray(data) ? data : []).filter((c) => c.image).slice(0, 18);
    box.innerHTML = list.length ? list.map((c) => `<button onclick="PS.openCard('${esc(c.id)}')" class="bg-slate-900 border border-slate-800 hover:border-rose-400 rounded-xl p-1.5 text-center">
        <img src="${esc(cdn(c.image + "/low.webp", 160))}" loading="lazy" class="h-24 mx-auto object-contain" />
        <p class="text-[10px] font-bold text-white truncate">${esc(c.name)} <span class="text-slate-500">${esc(c.localId || "")}</span></p></button>`).join("")
      : `<p class="col-span-full text-slate-400 text-xs text-center">Nichts gefunden.</p>`;
  } catch { box.innerHTML = `<p class="col-span-full text-rose-400 text-xs text-center">Kartendatenbank gerade nicht erreichbar.</p>`; }
}

export async function loadWishlist() {
  const box = $("ps-wish-body");
  if (!box) return;
  if (!state.user) {
    box.innerHTML = card(`<p class="text-slate-300">Melde dich an, um eine Wunschliste anzulegen und Tausch-Partner zu finden.</p>${btn("Kostenlos anmelden", "PS.openAccount()", "w-full bg-rose-400 text-slate-950")}`);
    return;
  }
  try {
    wish = await api("/api/wishlist");
    renderWishlist();
  } catch (e) { if (e.status !== 401) box.innerHTML = `<p class="text-rose-400 text-xs">Wunschliste konnte nicht geladen werden.</p>`; }
}

function renderWishlist() {
  const box = $("ps-wish-body");
  if (!box || !wish) return;
  const { items, offers, partners, limit } = wish;
  box.innerHTML = `
    ${partners.length ? `<div class="space-y-2"><p class="font-black text-white text-sm">🔁 Passende Tausch-Partner</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${partners.map((p) => card(`
        <div class="flex justify-between items-center gap-2"><button onclick="PS.openUser('${esc(p.user_id)}')" class="font-black text-white hover:text-yellow-300">${esc(p.display_name)}</button>
          ${p.perfect ? pill("⭐ Perfektes Match", "bg-emerald-400 text-slate-950") : ""}</div>
        ${p.city ? `<p class="text-slate-500">📍 ${esc(p.city)}</p>` : ""}
        <p class="text-slate-300">Sucht von dir: <strong class="text-white">${p.they_want.slice(0, 4).map(esc).join(", ")}</strong></p>
        ${p.they_offer.length ? `<p class="text-slate-300">Bietet dir an: <strong class="text-emerald-300">${p.they_offer.slice(0, 4).map(esc).join(", ")}</strong></p>` : ""}
        ${p.listing_id ? btn("🤝 Tausch anfragen", `PS.wishRequest(${Number(p.listing_id)})`, "w-full bg-emerald-500 text-slate-950") : `<p class="text-[10px] text-slate-500">Schreib ihn über ein Inserat im Tausch-Hub an oder inseriere die gesuchte Karte – er bekommt dann eine Nachricht.</p>`}
      `, p.perfect ? "border-emerald-400/60" : "border-slate-800")).join("")}</div></div>` : ""}
    ${offers.length ? `<div class="space-y-2"><p class="font-black text-white text-sm">🔥 Jetzt im Angebot (${offers.length})</p>
      <div class="space-y-1.5">${offers.map((o) => `<div class="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs">
        <div class="flex items-center gap-2 min-w-0"><img src="${esc(cdn(o.image || FALLBACK_IMG, 80))}" class="w-8 h-11 object-contain rounded shrink-0" />
          <div class="min-w-0"><p class="font-bold text-white truncate">${esc(o.card_name)}</p><p class="text-slate-400">${eur(o.price)} • ${esc(o.city)} • ${esc(o.seller)}${o.verified ? " ✔" : ""}</p></div></div>
        ${btn("Anfragen", `PS.wishRequest(${Number(o.id)})`, "bg-emerald-500 text-slate-950 shrink-0")}</div>`).join("")}</div></div>` : ""}
    <div class="space-y-2"><div class="flex justify-between items-center"><p class="font-black text-white text-sm">❤️ Deine Wunschliste</p><span class="text-xs text-slate-400">${items.length}/${limit}</span></div>
      ${items.length ? `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${items.map((i) => {
        const hits = offers.filter((o) => o.card_id === i.cardId).length;
        return `<div class="bg-slate-900 border ${hits ? "border-emerald-400/60" : "border-slate-800"} rounded-xl p-2 text-xs space-y-1 relative">
          <button onclick="PS.removeWish(${i.id})" class="absolute top-1 right-2 text-slate-500 hover:text-rose-400" aria-label="Entfernen">✕</button>
          <img src="${esc(cdn(i.image || FALLBACK_IMG, 160))}" onclick="PS.openCard('${esc(i.cardId)}')" class="h-24 mx-auto object-contain cursor-pointer" loading="lazy" />
          <p class="font-bold text-white truncate">${esc(i.name)}</p>
          <p class="text-slate-400">Markt ${i.price ? eur(i.price) : "–"}${i.maxPrice ? ` • max. ${eur(i.maxPrice)}` : ""}</p>
          ${hits ? `<p class="text-emerald-300 font-black">${hits} Angebot${hits > 1 ? "e" : ""}</p>` : ""}</div>`;
      }).join("")}</div>`
        : `<p class="text-xs text-slate-500">Noch leer. Suche oben eine Karte und tippe in der Kartenansicht auf „❤️ Wunschliste“.</p>`}
      <p class="text-[10px] text-slate-500">Hinweis: Andere Sammler sehen in ihren Tausch-Vorschlägen nur deinen Sammlernamen und welche Karten du suchst.</p>
    </div>`;
}

async function addWish(cardId) {
  if (!requireLogin()) return;
  try {
    const r = await api("/api/wishlist", { method: "POST", body: { cardId, maxPrice: $("ps-wish-max")?.value || null } });
    toast("❤️ Auf der Wunschliste", r.offers ? `${r.offers} Angebot${r.offers > 1 ? "e" : ""} gibt es schon – ab ${eur(r.minPrice)}.` : "Wir melden uns, sobald jemand die Karte anbietet.");
    closeModalEl("ps-card");
    loadWishlist();
  } catch (e) { handleError(e); }
}
async function removeWish(id) {
  try { await api(`/api/wishlist/${id}`, { method: "DELETE" }); loadWishlist(); } catch (e) { handleError(e); }
}
function wishRequest(listingId) {
  const o = wish?.offers.find((x) => x.id === listingId);
  if (o && !state.listings.find((x) => x.id === listingId)) state.listings.push(o);
  PS().requestTrade(listingId);
}

// Zusatz-Bereich in der Kartenansicht (Wunschliste, Teilen, Grading)
export function cardExtrasHtml(c) {
  const price = c.price || 0;
  return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
    <div class="bg-slate-950 rounded-2xl p-3 border border-rose-400/40 space-y-2">
      <p class="font-black text-rose-300">❤️ Wunschliste</p>
      ${input("ps-wish-max", `type="number" step="0.01" min="0" placeholder="Höchstpreis € (optional)"`)}
      ${btn("Auf die Wunschliste", `PS.addWish('${esc(c.id)}')`, "w-full bg-rose-400 text-slate-950")}
    </div>
    <div class="bg-slate-950 rounded-2xl p-3 border border-cyan-400/40 space-y-2">
      <p class="font-black text-cyan-300">📣 Teilen & prüfen</p>
      <div class="grid grid-cols-2 gap-1.5">
        ${btn("🔗 Link", `PS.shareCardPage('${esc(c.id)}', ${jsArg(c.name)})`, "bg-slate-800 text-white")}
        ${btn("📸 Bild", `PS.shareCardImage('${esc(c.id)}')`, "bg-slate-800 text-white")}
      </div>
      ${btn("🏆 Lohnt sich Grading?", `PS.gradingFor(${Number(price) || 0})`, "w-full bg-yellow-400 text-slate-950")}
    </div></div>`;
}

function shareCardPage(id, name) {
  const slug = String(name).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const ref = state.me?.referral?.code ? `?ref=${state.me.referral.code}` : "";
  PS().shareLink(`${location.origin}/karte/${encodeURIComponent(id)}/${slug}${ref}`, `${name} – Preis & Angebote`);
}

// ===========================================================================
// 2. Teilbare Bilder (Portfolio & Pull) – im Browser per Canvas erzeugt
// ===========================================================================
function loadImg(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function baseCanvas() {
  const cv = document.createElement("canvas");
  cv.width = 1080; cv.height = 1350;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 1080, 1350);
  g.addColorStop(0, "#0b1022"); g.addColorStop(0.55, "#111a33"); g.addColorStop(1, "#2a0f2f");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1350);
  const glow = (x, y, r, c) => { const rg = ctx.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c); rg.addColorStop(1, "transparent"); ctx.fillStyle = rg; ctx.fillRect(0, 0, 1080, 1350); };
  glow(160, 180, 520, "rgba(255,203,5,.22)"); glow(950, 1200, 560, "rgba(239,68,68,.18)");
  ctx.strokeStyle = "rgba(255,203,5,.08)"; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(900, 220, 150, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(750, 220); ctx.lineTo(1050, 220); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = "900 44px system-ui, sans-serif"; ctx.fillText("PokeSwipe", 70, 110);
  ctx.fillStyle = "#ffcb05"; ctx.fillText("& Radar", 70 + ctx.measureText("PokeSwipe ").width, 110);
  return { cv, ctx };
}

function footer(ctx) {
  ctx.fillStyle = "rgba(255,255,255,.08)"; roundRect(ctx, 60, 1180, 960, 110, 28); ctx.fill();
  ctx.fillStyle = "#ffcb05"; ctx.font = "900 40px system-ui, sans-serif";
  ctx.fillText("pokeswipe-radar.de", 100, 1248);
  const code = state.me?.referral?.code;
  if (code) { ctx.fillStyle = "#cbd5e1"; ctx.font = "700 30px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillText(`Code ${code}: 1. Monat gratis`, 980, 1246); ctx.textAlign = "left"; }
}

async function showShare(cv, title, text) {
  let blob = null;
  try { blob = await new Promise((r) => cv.toBlob(r, "image/png")); } catch { blob = null; }
  if (!blob) return toast("Bild nicht möglich", "Dieses Bild konnte nicht erzeugt werden. Bitte später erneut versuchen.");
  const url = URL.createObjectURL(blob);
  const file = new File([blob], "pokeswipe.png", { type: "image/png" });
  const canShare = navigator.canShare?.({ files: [file] });
  modal("ps-share", `<h3 class="text-base font-black text-white">📸 ${esc(title)}</h3>
    <img src="${url}" class="w-full rounded-2xl border border-slate-700" alt="Vorschau" />
    <div class="grid grid-cols-2 gap-2">
      ${canShare ? `<button id="ps-share-go" class="bg-yellow-400 text-slate-950 font-black py-2.5 rounded-xl text-xs">Teilen</button>` : ""}
      <a href="${url}" download="pokeswipe.png" class="${canShare ? "" : "col-span-2"} text-center bg-slate-800 text-white font-black py-2.5 rounded-xl text-xs">⬇️ Speichern</a>
    </div><p class="text-[11px] text-slate-400">Perfekt für Instagram-Story, TikTok, WhatsApp-Status oder Discord.</p>`, { onClose: () => URL.revokeObjectURL(url) });
  $("ps-share-go")?.addEventListener("click", () => navigator.share({ files: [file], title, text }).catch(() => {}));
}

async function sharePortfolioImage() {
  const p = state.portfolio;
  if (!p?.items?.length) return toast("Portfolio leer", "Füge zuerst Karten hinzu.");
  const { cv, ctx } = baseCanvas();
  ctx.fillStyle = "#94a3b8"; ctx.font = "800 34px system-ui, sans-serif"; ctx.fillText("MEINE SAMMLUNG", 70, 230);
  ctx.fillStyle = "#34d399"; ctx.font = "900 120px system-ui, sans-serif"; ctx.fillText(eur(p.total), 64, 360);
  const hist = (p.history || []).map((x) => Number(x.value)).filter((x) => x > 0);
  let sub = `${p.items.reduce((a, i) => a + i.quantity, 0)} Karten`;
  if (hist.length >= 2) {
    const base = hist[Math.max(0, hist.length - 8)], change = ((hist[hist.length - 1] - base) / base) * 100;
    sub += ` • ${pct(change)} in 7 Tagen`;
  } else if (p.gainPct !== null) sub += ` • ${pct(p.gainPct)} Rendite`;
  ctx.fillStyle = "#e2e8f0"; ctx.font = "700 40px system-ui, sans-serif"; ctx.fillText(sub, 70, 430);
  const top = [...p.items].sort((a, b) => b.value - a.value).slice(0, 3);
  const imgs = await Promise.all(top.map((i) => loadImg(cdn(i.image || FALLBACK_IMG, 400))));
  top.forEach((it, k) => {
    const x = 70 + k * 320, y = 500, w = 290, h = 405;
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate((k - 1) * 0.06); ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = "rgba(255,255,255,.06)"; roundRect(ctx, -6, -6, w + 12, h + 12, 22); ctx.fill();
    if (imgs[k]) ctx.drawImage(imgs[k], 0, 0, w, h);
    ctx.restore();
    ctx.fillStyle = "#fff"; ctx.font = "800 28px system-ui, sans-serif";
    ctx.fillText(it.name.length > 18 ? it.name.slice(0, 17) + "…" : it.name, x, 975);
    ctx.fillStyle = "#34d399"; ctx.font = "900 34px system-ui, sans-serif"; ctx.fillText(eur(it.unitValue || it.value), x, 1020);
  });
  ctx.fillStyle = "#cbd5e1"; ctx.font = "600 30px system-ui, sans-serif"; ctx.fillText("Live-Wert mit echten Cardmarket-Preisen", 70, 1110);
  footer(ctx);
  showShare(cv, "Mein Portfolio", `Meine Pokémon-Sammlung ist ${eur(p.total)} wert – getrackt mit PokeSwipe & Radar`);
}

async function shareCardImage(cardId) {
  try {
    const { card: c } = await api(`/api/cards/${encodeURIComponent(cardId)}`);
    const { cv, ctx } = baseCanvas();
    ctx.fillStyle = "#ffcb05"; ctx.font = "900 64px system-ui, sans-serif"; ctx.fillText("MEIN PULL! ✨", 70, 230);
    const img = await loadImg(cdn(c.image || FALLBACK_IMG, 600));
    if (img) {
      ctx.save(); ctx.shadowColor = "rgba(255,203,5,.55)"; ctx.shadowBlur = 60;
      ctx.drawImage(img, 290, 280, 500, 698); ctx.restore();
    }
    ctx.fillStyle = "#fff"; ctx.font = "900 54px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(c.name.length > 26 ? c.name.slice(0, 25) + "…" : c.name, 540, 1050);
    ctx.fillStyle = "#94a3b8"; ctx.font = "700 30px system-ui, sans-serif"; ctx.fillText(c.setName || "", 540, 1095);
    ctx.fillStyle = "#34d399"; ctx.font = "900 60px system-ui, sans-serif"; ctx.fillText(c.price ? eur(c.price) : "", 540, 1160);
    ctx.textAlign = "left";
    footer(ctx);
    showShare(cv, "Mein Pull", `${c.name}${c.price ? ` – aktuell ${eur(c.price)}` : ""}`);
  } catch (e) { handleError(e); }
}

// ===========================================================================
// 3. Grading-Rechner + KI-Zustandscheck
// ===========================================================================
export function gradingCalcHtml() {
  const f = (id, label, val, attrs = "") => `<label class="block"><span class="text-slate-400 font-bold text-[10px] uppercase">${label}</span>${input(id, `type="number" step="0.01" min="0" value="${val}" ${attrs}`)}</label>`;
  return `<div id="ps-gradecalc" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-3 border-2 border-emerald-500/40">
    <div>${pill("🧮 Grading-Rechner", "bg-emerald-400 text-slate-950")}
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Lohnt sich PSA, CGC & Co.?</h2>
      <p class="text-xs text-slate-300">Trag Rohpreis und die Preise für gegradete Karten ein (z. B. von eBay „verkaufte Artikel“). Die KI schätzt auf Wunsch den Zustand deiner Karte.</p></div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
      ${f("gc-raw", "Rohpreis (€)", "")}${f("gc-10", "Preis PSA 10 (€)", "")}${f("gc-9", "Preis PSA 9 (€)", "")}${f("gc-fee", "Grading-Gebühr (€)", "25")}
      ${f("gc-ship", "Versand & Versicherung (€)", "12")}${f("gc-p10", "Chance auf 10 (%)", "30", 'step="1" max="100"')}${f("gc-p9", "Chance auf 9 (%)", "45", 'step="1" max="100"')}
      <label class="block cursor-pointer self-end"><input id="gc-photo" type="file" accept="image/*" capture="environment" class="hidden" />
        <span class="block text-center bg-cyan-400 text-slate-950 font-black py-2.5 rounded-xl">📷 KI-Zustand prüfen</span></label>
    </div>
    <div id="gc-ai" class="text-xs"></div>
    <div id="gc-out"></div>
  </div>`;
}

function calcGrading() {
  const n = (id) => Number(String($(id)?.value || "").replace(",", ".")) || 0;
  const out = $("gc-out");
  if (!out) return;
  const raw = n("gc-raw"), psa10 = n("gc-10"), psa9 = n("gc-9");
  if (!raw || !psa10) { out.innerHTML = `<p class="text-xs text-slate-500">Rohpreis und PSA-10-Preis eintragen, dann rechnen wir sofort.</p>`; return; }
  const r = gradingEstimate({ raw, psa10, psa9: psa9 || raw, p10: n("gc-p10"), p9: n("gc-p9"), fee: n("gc-fee"), shipping: n("gc-ship") });
  out.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
    ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Erwarteter Wert</p><p class="text-lg font-black text-white">${eur(r.expected)}</p>`)}
    ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Kosten</p><p class="text-lg font-black text-white">${eur(r.cost)}</p>`)}
    ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Erwarteter Gewinn</p><p class="text-lg font-black ${r.worth ? "text-emerald-400" : "text-rose-400"}">${r.profit >= 0 ? "+" : ""}${eur(r.profit)}</p>`, r.worth ? "border-emerald-500/50" : "border-rose-500/50")}
    ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Lohnt ab</p><p class="text-lg font-black text-yellow-300">${r.breakEven10 === null ? "–" : `${Math.ceil(r.breakEven10)} % PSA 10`}</p>`)}
  </div>
  <p class="text-xs mt-2 ${r.worth ? "text-emerald-300" : "text-rose-300"} font-bold">${r.worth ? "✅ Grading lohnt sich voraussichtlich – wähle unten einen Anbieter." : "❌ Eher nicht lohnenswert – die Kosten fressen den Aufschlag. Raw verkaufen oder behalten."}</p>`;
}

async function checkCondition(file) {
  if (!file || !requireLogin()) return;
  const box = $("gc-ai");
  box.innerHTML = `<p class="text-yellow-400 font-bold">🔍 KI prüft Zentrierung, Ecken, Kanten und Oberfläche …</p>`;
  try {
    const image = await resizeImage(file, 1400);
    const r = await api("/api/scan/condition", { method: "POST", body: { image } });
    PS().refreshMe();
    if (!r.ok) { box.innerHTML = card(esc(r.message)); return; }
    const s = (label, v) => `<div class="bg-slate-900 rounded-xl p-2 text-center"><p class="text-[10px] text-slate-400 uppercase font-bold">${label}</p><p class="font-black text-white">${v ?? "–"}</p></div>`;
    box.innerHTML = card(`<div class="flex justify-between items-center"><p class="font-black text-cyan-300">🤖 KI-Einschätzung</p>
        <p class="font-black text-yellow-300">PSA ${r.gradeLow ?? "?"}${r.gradeHigh && r.gradeHigh !== r.gradeLow ? `–${r.gradeHigh}` : ""}</p></div>
      <div class="grid grid-cols-5 gap-1.5">${s("L/R", esc(r.centeringLR))}${s("O/U", esc(r.centeringTB))}${s("Ecken", r.corners)}${s("Kanten", r.edges)}${s("Oberfl.", r.surface)}</div>
      ${r.issues.length ? `<ul class="list-disc pl-4 text-slate-300">${r.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      <p class="text-[10px] text-slate-500">Nur eine Schätzung anhand eines Fotos${r.photoQuality === "schlecht" ? " (Fotoqualität schlecht – Ergebnis unsicher)" : ""}. Kratzer und Rückseite prüfst du am besten mit Lupe und Licht.</p>`, "border-cyan-400/50");
    const hi = r.gradeHigh || 0;
    $("gc-p10").value = hi >= 10 ? 40 : hi >= 9 ? 15 : 3;
    $("gc-p9").value = hi >= 10 ? 45 : hi >= 9 ? 50 : hi >= 8 ? 25 : 10;
    calcGrading();
  } catch (e) { box.innerHTML = ""; handleError(e); }
}

function gradingFor(price) {
  closeModalEl("ps-card");
  PS().showSub("portfolio", "grading");
  setTimeout(() => {
    if ($("gc-raw") && price) $("gc-raw").value = Number(price).toFixed(2);
    if ($("gc-10") && price && !$("gc-10").value) $("gc-10").value = (price * 3).toFixed(2);
    if ($("gc-9") && price && !$("gc-9").value) $("gc-9").value = (price * 1.4).toFixed(2);
    calcGrading();
    $("ps-gradecalc")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

// ===========================================================================
// 4. Serien-Scan: mehrere Karten nacheinander direkt ins Portfolio
// ===========================================================================
function resizeImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild nicht lesbar")); };
    img.src = url;
  });
}

export function bulkScanHtml() {
  return `<label class="block cursor-pointer" id="ps-bulk-label">
      <input id="ps-bulk-input" type="file" accept="image/*" multiple class="hidden" />
      <div class="bg-slate-900 border-2 border-dashed border-cyan-400/60 text-cyan-200 font-black text-xs text-center py-3 rounded-2xl">📚 Serien-Scan: mehrere Fotos auswählen – eindeutige Treffer landen direkt im Portfolio</div>
    </label><div id="ps-bulk-result" class="space-y-1.5"></div>`;
}

async function bulkScan(files) {
  if (!files?.length || !requireLogin()) return;
  const list = [...files].slice(0, 30);
  const box = $("ps-bulk-result");
  box.innerHTML = list.map((f, i) => `<div id="ps-bulk-${i}" class="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs"><span class="text-slate-400">⏳ ${esc(f.name.slice(0, 30))}</span></div>`).join("");
  let added = 0;
  for (let i = 0; i < list.length; i++) {
    const row = $(`ps-bulk-${i}`);
    try {
      const image = await resizeImage(list[i]);
      const r = await api("/api/scan", { method: "POST", body: { image } });
      if (!r.found) { row.innerHTML = `<span class="text-rose-300">✕ Nicht erkannt${r.detected?.name ? `: ${esc(r.detected.name)}` : ""}</span>`; continue; }
      const sure = r.candidates.length === 1 || (r.detected.number && r.detected.total && r.candidates.length <= 2);
      if (sure) {
        const c = r.candidates[0];
        await api("/api/portfolio", { method: "POST", body: { cardId: c.id } });
        added++;
        row.innerHTML = `<img src="${esc(cdn(c.image, 60))}" class="w-7 h-10 object-contain" /><span class="text-emerald-300 font-bold">✅ ${esc(c.name)} (${esc(c.id)}) hinzugefügt</span>`;
      } else {
        row.innerHTML = `<span class="text-yellow-300 font-bold shrink-0">❓ ${esc(r.detected.name)}:</span><div class="flex gap-1 overflow-x-auto">${r.candidates.slice(0, 6).map((c) =>
          `<button onclick="PS.bulkPick(this, '${esc(c.id)}')" class="shrink-0 bg-slate-900 border border-slate-700 hover:border-cyan-400 rounded-lg p-1" title="${esc(c.id)}"><img src="${esc(cdn(c.image, 60))}" class="w-8 h-11 object-contain" /></button>`).join("")}</div>`;
      }
    } catch (e) {
      row.innerHTML = `<span class="text-rose-300">✕ ${esc(e.message)}</span>`;
      if (e.status === 402 || e.status === 401) { handleError(e); break; }
    }
  }
  PS().refreshMe(); PS().loadPortfolio();
  toast("📚 Serien-Scan fertig", `${added} Karte${added === 1 ? "" : "n"} automatisch hinzugefügt.`);
}

async function bulkPick(el, cardId) {
  try {
    await api("/api/portfolio", { method: "POST", body: { cardId } });
    el.closest("div[id^=ps-bulk-]").innerHTML = `<span class="text-emerald-300 font-bold">✅ ${esc(cardId)} hinzugefügt</span>`;
    PS().loadPortfolio();
  } catch (e) { handleError(e); }
}

// ===========================================================================
// 5. Import aus CSV (Cardmarket, Excel, andere Apps)
// ===========================================================================
export function importButtonHtml() {
  return `<div id="ps-import-bar" class="flex flex-wrap gap-2 justify-end text-xs">
    <button onclick="PS.openImport()" class="bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-1.5 rounded-xl border border-slate-600">📥 Sammlung importieren</button>
    <button onclick="PS.sharePortfolioImage()" class="bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-xl">📸 Portfolio teilen</button>
  </div>`;
}

let importRows = [];
function openImport() {
  if (!requireLogin()) return;
  importRows = [];
  modal("ps-import", `<h3 class="text-base font-black text-white">📥 Sammlung importieren</h3>
    <p class="text-xs text-slate-300">CSV-Datei aus Cardmarket, Excel, Google Sheets oder einer anderen Sammler-App hochladen – oder eine Liste einfügen (eine Karte pro Zeile, z. B. „Glurak ex 199/165“). Erkannte Spalten: Name, Set, Nummer, Anzahl, Einkaufspreis.</p>
    <label class="block cursor-pointer"><input id="ps-imp-file" type="file" accept=".csv,.txt,text/csv,text/plain" class="hidden" />
      <span class="block text-center bg-slate-800 text-white font-black py-2.5 rounded-xl text-xs">📄 CSV-Datei wählen</span></label>
    <textarea id="ps-imp-text" rows="5" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs" placeholder="Name;Set;Nummer;Anzahl;Einkaufspreis&#10;Glurak ex;151;199;1;89,90"></textarea>
    <div id="ps-imp-preview" class="text-xs text-slate-400"></div>
    <button id="ps-imp-go" class="w-full bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs" disabled>Importieren</button>`);
  const preview = () => {
    importRows = csvToRows($("ps-imp-text").value);
    $("ps-imp-preview").innerHTML = importRows.length
      ? `<p class="text-emerald-300 font-bold">${importRows.length} Karten erkannt</p><p>${importRows.slice(0, 5).map((r) => esc(`${r.quantity}× ${r.name}${r.number ? " " + r.number : ""}${r.set ? " (" + r.set + ")" : ""}`)).join("<br>")}${importRows.length > 5 ? "<br>…" : ""}</p>`
      : "";
    $("ps-imp-go").disabled = !importRows.length;
  };
  $("ps-imp-text").addEventListener("input", preview);
  $("ps-imp-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 2_000_000) return toast("Datei zu groß", "Maximal 2 MB.");
    $("ps-imp-text").value = await f.text();
    preview();
  });
  $("ps-imp-go").onclick = runImport;
}

async function runImport() {
  const btnEl = $("ps-imp-go");
  btnEl.disabled = true;
  let queue = importRows.slice(0, 2000), imported = 0, matched = 0, overLimit = 0, rounds = 0;
  const unmatched = [];
  while (queue.length && rounds++ < 120) {
    const chunk = queue.slice(0, 40);
    btnEl.textContent = `⏳ ${imported} von ${importRows.length} importiert …`;
    try {
      const r = await api("/api/portfolio/import-rows", { method: "POST", body: { rows: chunk } });
      imported += r.imported; matched += r.matched; unmatched.push(...r.unmatched);
      if (r.overLimit) { overLimit = queue.length - r.imported - r.retry.length; break; }
      queue = r.retry.concat(queue.slice(chunk.length));
      if (!r.imported && r.retry.length) await new Promise((res) => setTimeout(res, 1500));
    } catch (e) { handleError(e); break; }
  }
  PS().loadPortfolio();
  $("ps-imp-preview").innerHTML = `<p class="text-emerald-300 font-bold">✅ ${imported} Karten importiert, ${matched} davon mit Live-Preis.</p>
    ${unmatched.length ? `<p class="text-amber-300">Ohne Live-Preis (bitte Wert selbst eintragen): ${unmatched.slice(0, 15).map(esc).join(", ")}${unmatched.length > 15 ? " …" : ""}</p>` : ""}
    ${overLimit ? `<p class="text-rose-300">${overLimit} Karten passen nicht mehr in deinen Tarif. <button onclick="PS.openPro()" class="underline font-bold">Mehr Platz</button></p>` : ""}`;
  btnEl.textContent = "Fertig";
}

// ===========================================================================
// 6. Kalender: Releases & Events
// ===========================================================================
export function calendarPanelHtml() {
  return `<div id="ps-calendar" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-purple-400/40">
    <div>${pill("📅 Release-Kalender & Events", "bg-purple-400 text-slate-950")}
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Nichts mehr verpassen</h2>
      <p class="text-xs text-slate-300">Neue Sets, Vorverkäufe, Tauschbörsen, Turniere und Sammlertreffen in deiner Nähe. Tippe auf 🔔 und wir erinnern dich per Push.</p></div>
    <div id="ps-cal-list" class="space-y-2"></div>
    <details class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs"><summary class="font-black text-white cursor-pointer">➕ Event eintragen (Tauschbörse, Turnier, Treffen)</summary>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        ${input("ps-cal-title", 'maxlength="120" placeholder="Titel, z. B. Pokémon-Tauschbörse Köln"')}
        ${input("ps-cal-day", 'type="date"')}
        ${input("ps-cal-city", 'maxlength="60" placeholder="Stadt / Ort"')}
        ${input("ps-cal-url", 'maxlength="300" placeholder="Link https:// (optional)"')}
        <textarea id="ps-cal-desc" maxlength="500" rows="2" class="sm:col-span-2 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" placeholder="Beschreibung (Uhrzeit, Eintritt, …)"></textarea>
        <select id="ps-cal-kind" class="hidden bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-white"><option value="event">Event</option><option value="release">Set-Release (Team)</option></select>
        ${btn("Eintragen", "PS.addEvent()", "sm:col-span-2 bg-purple-500 text-white")}
      </div></details>
  </div>`;
}

export async function loadCalendar() {
  const box = $("ps-cal-list");
  if (!box) return;
  if (state.me?.isAdmin) $("ps-cal-kind")?.classList.remove("hidden");
  try {
    const { events } = await api("/api/calendar");
    if (!events.length) { box.innerHTML = `<p class="text-xs text-slate-500">Noch keine Termine. Trag das erste Event in deiner Stadt ein!</p>`; return; }
    let month = "";
    box.innerHTML = events.map((e) => {
      const d = new Date(`${e.day}T12:00:00`);
      const m = d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
      const head = m !== month ? `<p class="text-[11px] uppercase font-black text-slate-400 pt-2">${esc((month = m))}</p>` : "";
      return `${head}<div class="flex gap-3 bg-slate-950 border ${e.kind === "release" ? "border-yellow-400/50" : "border-slate-800"} rounded-2xl p-3 text-xs">
        <div class="shrink-0 w-12 text-center rounded-xl ${e.kind === "release" ? "bg-yellow-400 text-slate-950" : "bg-purple-500 text-white"} py-1">
          <p class="text-lg font-black leading-tight">${d.getDate()}</p><p class="text-[10px] font-bold uppercase">${d.toLocaleDateString("de-DE", { weekday: "short" })}</p></div>
        <div class="flex-1 min-w-0 space-y-0.5">
          <p class="font-black text-white">${e.kind === "release" ? "📦 " : "📅 "}${esc(e.title)}</p>
          <p class="text-slate-400">${e.city ? `📍 ${esc(e.city)} • ` : ""}${e.interested} interessiert${e.author && e.kind === "event" ? ` • von ${esc(e.author)}` : ""}</p>
          ${e.description ? `<p class="text-slate-300">${esc(e.description)}</p>` : ""}
          <div class="flex flex-wrap gap-1.5 pt-1">
            <button onclick="PS.toggleRemind(${e.id})" class="${e.reminded ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-white"} font-bold px-2.5 py-1 rounded-lg">${e.reminded ? "🔔 Erinnerung an" : "🔔 Erinnern"}</button>
            ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener nofollow" class="bg-slate-800 text-white font-bold px-2.5 py-1 rounded-lg">Mehr ↗</a>` : ""}
            ${e.mine || state.me?.isAdmin ? `<button onclick="PS.removeEvent(${e.id})" class="text-slate-400 hover:text-rose-400 px-1.5">Löschen</button>` : `<button onclick="PS.report('event', '${e.id}')" class="text-slate-500 hover:text-rose-400 px-1.5">Melden</button>`}
          </div></div></div>`;
    }).join("");
  } catch { box.innerHTML = `<p class="text-rose-400 text-xs">Kalender gerade nicht erreichbar.</p>`; }
}

async function addEvent() {
  if (!requireLogin()) return;
  try {
    await api("/api/calendar", { method: "POST", body: {
      title: $("ps-cal-title").value, day: $("ps-cal-day").value, city: $("ps-cal-city").value,
      url: $("ps-cal-url").value, description: $("ps-cal-desc").value, kind: $("ps-cal-kind").value,
    } });
    ["ps-cal-title", "ps-cal-day", "ps-cal-city", "ps-cal-url", "ps-cal-desc"].forEach((id) => { $(id).value = ""; });
    toast("📅 Eingetragen", "Du wirst automatisch erinnert.");
    loadCalendar();
  } catch (e) { handleError(e); }
}
async function toggleRemind(id) {
  if (!requireLogin()) return;
  try {
    const r = await api(`/api/calendar/${id}/remind`, { method: "POST", body: {} });
    if (r.reminded) toast("🔔 Erinnerung aktiv", "Du bekommst am Vortag eine Push-Nachricht. Push im Konto aktivieren nicht vergessen.");
    loadCalendar();
  } catch (e) { handleError(e); }
}
async function removeEvent(id) {
  if (!confirm("Termin löschen?")) return;
  try { await api(`/api/calendar/${id}`, { method: "DELETE" }); loadCalendar(); } catch (e) { handleError(e); }
}

// ===========================================================================
// 7. Abzeichen, Serie & Bestenliste
// ===========================================================================
let boardType = "value";

export function ranksPanelHtml() {
  return `<div id="ps-ranks" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-amber-400/40">
    <div>${pill("🏅 Abzeichen & Bestenliste", "bg-amber-400 text-slate-950")}
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Sammle Abzeichen, halte deine Serie</h2>
      <p class="text-xs text-slate-300">Schau jeden Tag vorbei, um deine Serie zu verlängern. Abzeichen gibt es für Sammlung, Tausche, Serien und mehr.</p></div>
    <div id="ps-badges"></div>
    <div class="space-y-2">
      <div class="flex gap-1.5 text-xs">${[["value", "💰 Sammlungswert"], ["trades", "🤝 Tausche"], ["streak", "🔥 Serie"]].map(([k, l]) =>
        `<button data-board="${k}" onclick="PS.board('${k}')" class="px-3 py-1.5 rounded-xl font-black">${l}</button>`).join("")}</div>
      <div id="ps-board" class="space-y-1"></div>
    </div>
  </div>`;
}

export async function loadRanks() {
  const box = $("ps-badges");
  if (!box) return;
  if (!state.user) {
    box.innerHTML = card(`<p class="text-slate-300">Melde dich an, um Abzeichen zu sammeln und in der Bestenliste zu erscheinen.</p>${btn("Kostenlos anmelden", "PS.openAccount()", "w-full bg-amber-400 text-slate-950")}`);
  } else {
    try {
      const b = await api("/api/badges");
      const earned = b.badges.filter((x) => x.earned).length;
      box.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
          ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Aktuelle Serie</p><p class="text-xl font-black text-orange-400">🔥 ${b.streak} ${b.streak === 1 ? "Tag" : "Tage"}</p>`)}
          ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Rekord</p><p class="text-xl font-black text-white">${b.bestStreak}</p>`)}
          ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Abzeichen</p><p class="text-xl font-black text-amber-300">${earned}/${b.badges.length}</p>`)}
          ${card(`<label class="flex items-center gap-2 font-bold text-slate-200"><input type="checkbox" ${b.leaderboardOptIn ? "checked" : ""} onchange="PS.setPref('leaderboardOptIn', this.checked)" /> In Bestenliste zeigen</label>
            <label class="flex items-center gap-2 font-bold text-slate-200"><input type="checkbox" ${b.weeklyReport ? "checked" : ""} onchange="PS.setPref('weeklyReport', this.checked)" /> Wochen-Report</label>`)}
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">${b.badges.map((x) => `<div class="rounded-2xl p-2 text-center border ${x.earned ? "bg-amber-400/10 border-amber-400/60" : "bg-slate-950 border-slate-800 opacity-50 grayscale"}" title="${esc(x.description)}">
          <p class="text-2xl">${x.icon}</p><p class="text-[11px] font-black text-white">${esc(x.label)}</p><p class="text-[10px] text-slate-400 leading-tight">${esc(x.description)}</p></div>`).join("")}</div>`;
    } catch {}
  }
  board(boardType);
}

async function board(type) {
  boardType = type;
  document.querySelectorAll("[data-board]").forEach((b) => {
    b.className = `px-3 py-1.5 rounded-xl font-black ${b.dataset.board === type ? "bg-amber-400 text-slate-950" : "bg-slate-900 text-slate-300 border border-slate-700"}`;
  });
  const box = $("ps-board");
  if (!box) return;
  try {
    const { entries } = await api(`/api/leaderboard?type=${type}`);
    const me = state.me?.displayName;
    box.innerHTML = entries.length ? entries.map((e, i) => `<div class="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ${e.display_name === me ? "bg-amber-400/20 border border-amber-400/60" : "bg-slate-950 border border-slate-800"}">
        <span class="flex items-center gap-2 min-w-0"><span class="w-6 text-center font-black ${i < 3 ? "text-amber-300" : "text-slate-500"}">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
          <span class="font-bold text-white truncate">${esc(e.display_name)}</span>${e.city ? `<span class="text-slate-500 truncate">${esc(e.city)}</span>` : ""}</span>
        <strong class="text-white shrink-0">${type === "value" ? eur(e.score) : type === "trades" ? `${e.score} Tausche` : `${e.score} Tage`}</strong></div>`).join("")
      : `<p class="text-xs text-slate-500">Noch niemand dabei – setz oben den Haken „In Bestenliste zeigen“ und sei die Nummer 1.</p>`;
  } catch {}
}

async function setPref(key, value) {
  try { await api("/api/me/preferences", { method: "POST", body: { [key]: value } }); toast("✅ Gespeichert", ""); board(boardType); } catch (e) { handleError(e); }
}

async function dailyCheckin() {
  if (!state.user) return;
  try {
    const r = await api("/api/daily/checkin", { method: "POST", body: {} });
    if (r.firstToday && r.streak > 1) toast(`🔥 ${r.streak} Tage in Folge!`, r.streak >= r.bestStreak ? "Neuer Rekord – weiter so!" : `Dein Rekord: ${r.bestStreak} Tage.`);
    if (r.newBadges?.length) setTimeout(() => toast("🏅 Neues Abzeichen!", "Sieh es dir unter Community → Abzeichen an."), 2500);
  } catch {}
}

// ===========================================================================
// 8. Shop-Statistik für Pro-Trader
// ===========================================================================
async function openShopStats() {
  modal("ps-shop-stats", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Statistik …</p>`, { wide: true });
  try {
    const s = await api("/api/shop/stats");
    const max = Math.max(1, ...s.days.map((d) => d.views + d.listing_views));
    const bars = s.days.map((d, i) => {
      const hgt = ((d.views + d.listing_views) / max) * 100;
      return `<rect x="${i * 10 + 1}" y="${100 - hgt}" width="8" height="${hgt}" rx="2" fill="#22d3ee"><title>${d.day}: ${d.views} Shop-Aufrufe, ${d.listing_views} Inserat-Aufrufe, ${d.requests} Anfragen</title></rect>`
        + (d.requests ? `<circle cx="${i * 10 + 5}" cy="${Math.max(4, 100 - hgt - 5)}" r="3" fill="#facc15"/>` : "");
    }).join("");
    const t = s.totals;
    modal("ps-shop-stats", `<h3 class="text-base font-black text-white">📊 Shop-Statistik (30 Tage)</h3>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Shop-Aufrufe</p><p class="text-lg font-black text-cyan-300">${t.views}</p>`)}
        ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Inserat-Aufrufe</p><p class="text-lg font-black text-white">${t.listingViews}</p>`)}
        ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Anfragen</p><p class="text-lg font-black text-yellow-300">${t.requests}</p>`)}
        ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Abgeschlossen</p><p class="text-lg font-black text-emerald-400">${t.completed}</p>`)}
      </div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800"><svg viewBox="0 0 300 100" preserveAspectRatio="none" class="w-full h-32">${bars}</svg>
        <p class="text-[10px] text-slate-500 flex justify-between"><span>${esc(s.days[0]?.day || "")}</span><span>🟦 Aufrufe • 🟡 Tage mit Anfragen</span><span>heute</span></p></div>
      <p class="text-sm font-black text-white">🔥 Gefragteste Inserate</p>
      <div class="space-y-1 text-xs">${s.top.length ? s.top.map((l) => `<div class="flex justify-between gap-2 bg-slate-900 rounded-xl px-3 py-2"><span class="truncate text-white">${esc(l.card_name)} <span class="text-slate-500">${eur(l.price)}${l.status !== "active" ? ` • ${esc(l.status)}` : ""}</span></span>
        <strong class="text-yellow-300 shrink-0">${l.requests} Anfragen${l.completed ? ` • ${l.completed} ✓` : ""}</strong></div>`).join("") : `<p class="text-slate-500">Noch keine Inserate.</p>`}</div>
      <p class="text-[11px] text-slate-400">Tipp: Teile deinen Shop-Link auf Instagram & Discord und nutze deine Gratis-Boosts für die gefragtesten Karten.</p>`, { wide: true });
  } catch (e) { closeModalEl("ps-shop-stats"); handleError(e); }
}

// ===========================================================================
// 9. Konto: Einstellungen, Daten-Export, Konto löschen
// ===========================================================================
export function accountExtrasHtml() {
  return `<details class="bg-slate-950 rounded-2xl p-3.5 border border-slate-800 text-xs">
    <summary class="font-black text-white cursor-pointer">🔒 Datenschutz & Konto</summary>
    <div class="space-y-2 mt-3">
      <p class="text-slate-400">Deine Daten gehören dir. Du kannst sie jederzeit herunterladen oder dein Konto komplett löschen.</p>
      <div class="grid grid-cols-2 gap-2">
        ${btn("⬇️ Meine Daten (JSON)", "PS.exportData()", "bg-slate-800 text-white")}
        ${btn("📜 Datenschutz", "PS.openLegal()", "bg-slate-800 text-white")}
      </div>
      ${btn("🗑️ Konto löschen", "PS.deleteAccount()", "w-full bg-rose-500/20 text-rose-300 border border-rose-500/40")}
    </div></details>`;
}

async function exportData() {
  try {
    const res = await fetch("/api/me/export", { headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem("gotrue.user") || "{}")?.token?.access_token || ""}` }, credentials: "same-origin" });
    if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error || "Export fehlgeschlagen"), { status: res.status });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: "pokeswipe-meine-daten.json" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { handleError(e); }
}

function deleteAccount() {
  modal("ps-delete", `<h3 class="text-base font-black text-rose-300">🗑️ Konto endgültig löschen</h3>
    <p class="text-xs text-slate-300">Dein laufendes Abo wird sofort beendet. Portfolio, Wunschliste, Alarme, Inserate, Tausche, Nachrichten, Bewertungen und dein Login werden unwiderruflich gelöscht.</p>
    <p class="text-xs text-slate-400">Tipp: Lade vorher deine Daten herunter.</p>
    <label class="text-xs text-slate-300 font-bold">Zur Bestätigung <strong class="text-white">LÖSCHEN</strong> eingeben</label>
    ${input("ps-del-confirm", 'autocomplete="off"')}
    ${btn("Konto jetzt löschen", "PS.confirmDelete()", "w-full bg-rose-600 text-white")}`);
}

async function confirmDelete() {
  try {
    const r = await api("/api/account/delete", { method: "POST", body: { confirm: $("ps-del-confirm").value.trim().toUpperCase() } });
    closeModalEl("ps-delete"); closeModalEl("ps-account");
    toast("Konto gelöscht", r.message || "Schade, dass du gehst. Alle Daten wurden entfernt.");
    try { await caches.delete("ps-api"); } catch {}
    setTimeout(() => { PS().logout(); }, 800);
  } catch (e) { handleError(e); }
}

// ===========================================================================
// 10. Impressum & Datenschutz
// ===========================================================================
let origOpenModal = null;
function openLegal() {
  closeModalEl("ps-account");
  (origOpenModal || window.openModal)?.("legal-modal");
  loadImpressum();
}
async function loadImpressum() {
  const box = $("ps-impressum");
  if (!box) return;
  try {
    const { impressum } = await api("/api/legal");
    box.textContent = impressum || "Das Impressum wird gerade vom Betreiber eingerichtet.";
  } catch { box.textContent = "Impressum konnte nicht geladen werden – bitte später erneut öffnen."; }
}

export async function adminGrowthHtml() {
  let legal = { impressum: "" };
  try { legal = await api("/api/legal"); } catch {}
  return `<h4 class="text-sm font-black text-white">⚖️ Impressum (Pflichtangaben § 5 DDG)</h4>
    <p class="text-[11px] text-slate-400">Wird nur hier gespeichert (nicht im Code) und im Fenster „Impressum &amp; Datenschutz“ angezeigt. Tipp: Statt der Privatadresse kann eine ladungsfähige Geschäfts- oder Impressums-Service-Adresse eingetragen werden.</p>
    <textarea id="ps-ad-legal" rows="6" maxlength="4000" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs" placeholder="Vor- und Nachname / Firma&#10;Straße Hausnummer&#10;PLZ Ort&#10;E-Mail: info@pokeswipe-radar.de&#10;(ggf. USt-IdNr., Verantwortlich nach § 18 MStV)">${esc(legal.impressum)}</textarea>
    <div class="grid grid-cols-2 gap-2">
      ${btn("Impressum speichern", "PS.adminSaveLegal()", "bg-emerald-500 text-slate-950")}
      ${btn("📅 Erinnerungen & Wochen-Report jetzt", "PS.adminRunGrowth()", "bg-slate-800 text-white")}
    </div>
    <p class="text-[11px] text-slate-400">Set-Releases trägst du direkt im Kalender ein (Community → Kalender, Art „Set-Release“).</p>`;
}

async function adminSaveLegal() {
  try { await api("/api/admin/legal", { method: "PUT", body: { impressum: $("ps-ad-legal").value } }); toast("✅ Impressum gespeichert", ""); } catch (e) { handleError(e); }
}
async function adminRunGrowth() {
  try { const r = await api("/api/admin/run-growth", { method: "POST", body: {} }); toast("✅ Erledigt", `${r.reminders} Erinnerungen, ${r.reports} Wochen-Reports verschickt.`); } catch (e) { handleError(e); }
}

// ===========================================================================
// 11. Offline-Hinweis & Speicher-Hinweis
// ===========================================================================
function offlineBanner() {
  let el = $("ps-offline");
  if (!el) {
    el = document.createElement("div");
    el.id = "ps-offline";
    el.className = "hidden fixed top-0 inset-x-0 z-[70] bg-amber-400 text-slate-950 text-xs font-black text-center py-1.5";
    el.textContent = "📴 Offline – du siehst den zuletzt geladenen Stand. Änderungen sind wieder möglich, sobald du online bist.";
    document.body.appendChild(el);
  }
  el.classList.toggle("hidden", navigator.onLine);
}

function storageNotice() {
  if (localStorage.getItem("ps_notice_ok")) return;
  const el = document.createElement("div");
  el.className = "fixed bottom-24 sm:bottom-4 inset-x-3 sm:left-auto sm:right-4 sm:max-w-sm z-[45] poke-glass border border-yellow-400/50 rounded-2xl p-3 text-xs text-slate-200 space-y-2";
  el.innerHTML = `<p>🍪 Wir verwenden keine Werbe- oder Tracking-Cookies. Gespeichert werden nur technisch nötige Daten (Login, Einstellungen, Offline-Kopie). Details in der <button class="underline font-bold" data-legal>Datenschutzerklärung</button>.</p>
    <button class="w-full bg-yellow-400 text-slate-950 font-black py-2 rounded-xl" data-ok>Verstanden</button>`;
  el.querySelector("[data-ok]").onclick = () => { localStorage.setItem("ps_notice_ok", "1"); el.remove(); };
  el.querySelector("[data-legal]").onclick = () => openLegal();
  document.body.appendChild(el);
}

function registerOffline() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  window.addEventListener("online", offlineBanner);
  window.addEventListener("offline", offlineBanner);
  offlineBanner();
}

// ===========================================================================
// Start
// ===========================================================================
export const growthApi = {
  addWish, removeWish, wishRequest, shareCardPage, shareCardImage, sharePortfolioImage, gradingFor, bulkPick,
  openImport, addEvent, toggleRemind, removeEvent, board, setPref, openShopStats, exportData, deleteAccount,
  confirmDelete, openLegal, adminSaveLegal, adminRunGrowth, loadWishlist,
};

/** Fügt die Bereiche ein, bevor die Unter-Reiter gebaut werden. */
export function injectGrowthPanels() {
  const add = (view, html, where = "append") => {
    const section = $(`view-${view}`);
    if (!section) return null;
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const el = tmp.firstElementChild;
    section[where](el);
    return el;
  };
  if (!$("ps-wishlist")) add("portfolio", wishlistPanelHtml());
  if (!$("ps-calendar")) add("community", calendarPanelHtml());
  if (!$("ps-ranks")) add("community", ranksPanelHtml());
  const grading = $("ps-grading");
  if (grading && !$("ps-gradecalc")) {
    const tmp = document.createElement("div");
    tmp.innerHTML = gradingCalcHtml();
    grading.before(tmp.firstElementChild);
  }
  const dash = $("ps-pf-dash");
  if (dash && !$("ps-import-bar")) {
    const tmp = document.createElement("div");
    tmp.innerHTML = importButtonHtml();
    dash.after(tmp.firstElementChild);
  }
  const scanBtn = $("ps-scan-input")?.closest("label");
  if (scanBtn && !$("ps-bulk-input")) {
    const tmp = document.createElement("div");
    tmp.innerHTML = bulkScanHtml();
    scanBtn.after(...tmp.children);
  }
  $("ps-wish-go")?.addEventListener("click", searchWish);
  $("ps-wish-q")?.addEventListener("keydown", (e) => e.key === "Enter" && searchWish());
  $("ps-bulk-input")?.addEventListener("change", (e) => { bulkScan(e.target.files); e.target.value = ""; });
  $("gc-photo")?.addEventListener("change", (e) => { checkCondition(e.target.files[0]); e.target.value = ""; });
  ["gc-raw", "gc-10", "gc-9", "gc-fee", "gc-ship", "gc-p10", "gc-p9"].forEach((id) => $(id)?.addEventListener("input", calcGrading));
  calcGrading();

  // Impressum-Platzhalter im bestehenden Rechtliches-Fenster
  const legal = $("legal-modal");
  if (legal && !$("ps-impressum")) {
    const first = legal.querySelector("p");
    const el = document.createElement("p");
    el.innerHTML = `<strong>Impressum (Angaben gemäß § 5 DDG):</strong><br><span id="ps-impressum" class="whitespace-pre-line"></span>`;
    first?.after(el);
    $("ps-impressum").textContent = "Wird geladen …";
    origOpenModal = window.openModal;
    window.openModal = (id) => { origOpenModal?.(id); if (id === "legal-modal") loadImpressum(); };
  }
  registerOffline();
  storageNotice();
}

export function afterAuthGrowth() {
  dailyCheckin();
  loadWishlist();
}

export function routeGrowth() {
  const params = new URLSearchParams(location.search);
  const cardId = params.get("card");
  if (cardId && /^[a-zA-Z0-9.\-_]{2,40}$/.test(cardId)) PS().openCard(cardId);
  if (params.get("legal") === "1") openLegal();
}
