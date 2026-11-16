// PokeSwipe & Radar – Wachstum & Bindung im Browser:
// Wunschliste mit Tausch-Matches, Teilen-Bilder, Grading-Rechner mit KI-Zustandscheck, Serien-Scan,
// CSV-Import, Kalender, Abzeichen & Bestenliste, tägliche Serie, Shop-Statistik, Konto & Datenschutz, Offline-Hinweis.
import {
  $, esc, jsArg, safeUrl, eur, pct, toast, FALLBACK_IMG, cdn, state, api, handleError, requireLogin, modal, closeModalEl, input, btn,
} from "./core.js";
import { csvToRows } from "./csv.js";
import { lazyLiveScanApi } from "./lazy.js";
import { searchCatalog, searchThumb, searchMeta, isAbort } from "./search.js";
import { gradingEstimate } from "../server/logic.ts";

const PS = () => window.PS;
const card = (inner, border = "border-slate-800") => `<div class="bg-slate-950 rounded-2xl p-3 border ${border} text-xs space-y-2">${inner}</div>`;
const pill = (text, cls = "bg-yellow-400 text-slate-950") => `<span class="text-[10px] font-black uppercase ${cls} px-2.5 py-0.5 rounded-full">${text}</span>`;

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
    // Wunschliste führt deutsche Karten-IDs (englische Drucke teilen sich das Cardmarket-Produkt → cardId)
    const { items } = await searchCatalog(q, { lang: "de,en", limit: 18, channel: "wish" });
    const seen = new Set();
    const list = items.filter((c) => c.image && c.cardId && !seen.has(c.cardId) && seen.add(c.cardId));
    box.innerHTML = list.length ? list.map((c) => `<button onclick="PS.openCard(${jsArg(c.cardId)})" class="bg-slate-900 border border-slate-800 hover:border-rose-400 rounded-xl p-1.5 text-center">
        <img src="${esc(searchThumb(c, 160))}" loading="lazy" class="h-24 mx-auto object-contain" />
        <p class="text-[10px] font-bold text-white truncate">${esc(c.name)}</p><p class="text-[9px] text-slate-500 truncate">${esc(searchMeta(c))}</p></button>`).join("")
      : `<p class="col-span-full text-slate-400 text-xs text-center">Nichts gefunden.</p>`;
  } catch (e) {
    if (isAbort(e)) return;
    box.innerHTML = `<p class="col-span-full text-rose-400 text-xs text-center">${esc(e?.status === 429 ? e.message : "Kartensuche gerade nicht erreichbar.")}</p>`;
  }
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
        <div class="flex justify-between items-center gap-2"><button onclick="PS.openUser(${jsArg(p.user_id)})" class="font-black text-white hover:text-yellow-300">${esc(p.display_name)}</button>
          ${p.perfect ? pill("⭐ Perfektes Match", "bg-emerald-400 text-slate-950") : ""}</div>
        ${p.city ? `<p class="text-slate-500">📍 ${esc(p.city)}</p>` : ""}
        <p class="text-slate-300">Sucht von dir: <strong class="text-white">${(p.they_want || []).slice(0, 4).map(esc).join(", ")}</strong></p>
        ${p.they_offer?.length ? `<p class="text-slate-300">Bietet dir an: <strong class="text-emerald-300">${p.they_offer.slice(0, 4).map(esc).join(", ")}</strong></p>` : ""}
        ${p.listing_id ? btn("🤝 Tausch anfragen", `PS.wishRequest(${Number(p.listing_id)})`, "w-full bg-emerald-500 text-slate-950") : `<p class="text-[10px] text-slate-500">Schreib ihn über ein Inserat im Tausch-Hub an oder inseriere die gesuchte Karte – er bekommt dann eine Nachricht.</p>`}
      `, p.perfect ? "border-emerald-400/60" : "border-slate-800")).join("")}</div></div>` : ""}
    ${offers.length ? `<div class="space-y-2"><p class="font-black text-white text-sm">🔥 Jetzt im Angebot (${offers.length})</p>
      <div class="space-y-1.5">${offers.map((o) => `<div class="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs">
        <div class="flex items-center gap-2 min-w-0"><img src="${esc(cdn(o.image || FALLBACK_IMG, 80))}" class="w-8 h-11 object-contain rounded shrink-0" />
          <div class="min-w-0"><p class="font-bold text-white truncate">${esc(o.card_name)}</p><p class="text-slate-400">${eur(o.price)} • ${esc(o.city)} • ${esc(o.seller)}${o.verified ? " ✔" : ""}</p></div></div>
        ${btn("Anfragen", `PS.wishRequest(${Number(o.id)})`, "bg-emerald-500 text-slate-950 shrink-0")}</div>`).join("")}</div></div>` : ""}
    <div class="space-y-2"><div class="flex justify-between items-center"><p class="font-black text-white text-sm">❤️ Deine Wunschliste</p><span class="text-xs text-slate-400">${items.length}/${Number(limit) || 0}</span></div>
      ${items.length ? `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${items.map((i) => {
        const hits = offers.filter((o) => o.card_id === i.cardId).length;
        return `<div class="bg-slate-900 border ${hits ? "border-emerald-400/60" : "border-slate-800"} rounded-xl p-2 text-xs space-y-1 relative">
          <button onclick="PS.removeWish(${Number(i.id)})" class="absolute top-1 right-2 text-slate-500 hover:text-rose-400" aria-label="Entfernen">✕</button>
          <img src="${esc(cdn(i.image || FALLBACK_IMG, 160))}" onclick="PS.openCard(${jsArg(i.cardId)})" class="h-24 mx-auto object-contain cursor-pointer" loading="lazy" />
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
  // Phase 8: Preise nach Zustand + letzte Verkäufe auf PokeSwipe (lädt nach, sobald der Bereich im DOM ist)
  setTimeout(() => loadConditionPrices(c.id), 0);
  return `<div id="ps-cond-box" data-card="${esc(String(c.id))}" class="bg-slate-950 rounded-2xl p-3 border border-emerald-400/30 text-xs mb-3"><p class="text-slate-400">⏳ Lade Preise nach Zustand …</p></div>
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
    <div class="bg-slate-950 rounded-2xl p-3 border border-rose-400/40 space-y-2">
      <p class="font-black text-rose-300">❤️ Wunschliste</p>
      ${input("ps-wish-max", `type="number" step="0.01" min="0" placeholder="Höchstpreis € (optional)"`)}
      ${btn("Auf die Wunschliste", `PS.addWish(${jsArg(c.id)})`, "w-full bg-rose-400 text-slate-950")}
    </div>
    <div class="bg-slate-950 rounded-2xl p-3 border border-cyan-400/40 space-y-2">
      <p class="font-black text-cyan-300">📣 Teilen & prüfen</p>
      <div class="grid grid-cols-2 gap-1.5">
        ${btn("🔗 Link", `PS.shareCardPage(${jsArg(c.id)}, ${jsArg(c.name)})`, "bg-slate-800 text-white")}
        ${btn("📸 Bild", `PS.shareCardImage(${jsArg(c.id)})`, "bg-slate-800 text-white")}
      </div>
      ${btn("🏆 Lohnt sich Grading?", `PS.gradingFor(${Number(price) || 0})`, "w-full bg-yellow-400 text-slate-950")}
    </div></div>`;
}

const COND_SOURCE = { sales: "aus Verkäufen", blend: "Verkäufe + Referenz", reference: "Referenz", asks: "günstigstes Angebot", none: "" };
async function loadConditionPrices(cardId, variant = "") {
  const box = document.getElementById("ps-cond-box");
  if (!box || box.dataset.card !== String(cardId)) return;
  try {
    const d = await api(`/api/cards/${encodeURIComponent(cardId)}/conditions${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`);
    if (!document.getElementById("ps-cond-box") || box.dataset.card !== String(cardId)) return;
    const money = (v) => (v ? eur(v) : "–");
    box.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2 mb-2"><p class="font-black text-emerald-300">📊 Preise nach Zustand</p>
      ${d.variants.length > 1 ? `<select onchange="PS.conditionVariant(${jsArg(cardId)}, this.value)" class="bg-slate-900 border border-slate-700 rounded-lg text-[11px] text-white px-2 py-1" aria-label="Variante">${d.variants.map((v) => `<option value="${esc(v)}" ${v === d.variant ? "selected" : ""}>${esc(VARIANT_NAMES[v] || v)}</option>`).join("")}</select>` : ""}</div>
      <div class="overflow-x-auto"><table class="w-full text-[11px]"><thead><tr class="text-slate-400 text-left"><th class="py-1 pr-2">Zustand</th><th class="pr-2">Wert</th><th class="pr-2">Verkauft (90 T.)</th><th>Ab</th></tr></thead>
      <tbody>${d.conditions.map((r) => `<tr class="border-t border-slate-800"><td class="py-1 pr-2 font-black text-white">${esc(r.short)}</td>
        <td class="pr-2"><b class="text-white">${money(r.value)}</b> <span class="text-slate-500">${esc(COND_SOURCE[r.valueSource] || "")}</span></td>
        <td class="pr-2 text-slate-300">${r.soldCount90 ? `${money(r.soldMedian90)} (${Number(r.soldCount90)}×)` : "–"}</td>
        <td class="text-slate-300">${r.askCount ? `${money(r.askLow)} (${Number(r.askCount)})` : "–"}</td></tr>`).join("")}</tbody></table></div>
      ${d.recentSales.length ? `<p class="font-black text-white mt-2">✅ Zuletzt auf PokeSwipe verkauft</p><div class="space-y-0.5">${d.recentSales.slice(0, 5).map((x) => `<p class="flex justify-between text-slate-300"><span><b class="text-white">${eur(x.price)}</b> ${esc([x.condition.toUpperCase(), x.variant !== "normal" ? x.variantLabel : "", x.lang.toUpperCase()].filter(Boolean).join(" · "))}</span><span class="text-slate-500">${new Date(x.soldAt).toLocaleDateString(globalThis.psLang === "en" ? "en-GB" : "de-DE")}</span></p>`).join("")}</div>` : ""}
      <p class="text-[10px] text-slate-500 mt-1">Verkäufe und Angebote auf PokeSwipe inkl. anteiligem Versand. Referenz = Cardmarket-Trend (NM) × üblicher Zustandsabschlag.</p>`;
  } catch {
    box.innerHTML = `<p class="text-slate-500">Preise nach Zustand sind gerade nicht verfügbar.</p>`;
  }
}
const VARIANT_NAMES = { normal: "Normal", reverse_holo: "Reverse Holo", holo: "Holo", first_edition: "1st Edition", shadowless: "Shadowless", promo: "Promo" };

function shareCardPage(id, name) {
  const slug = String(name).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "karte";
  // Verfolgter Kurzlink: jeder neue Besucher bringt +1 KI-Scan, Anmeldungen zählen fürs Empfehlungsprogramm
  PS().shareTarget(`/karte/${encodeURIComponent(id)}/${slug}`, "card", `${name} – Preis & Angebote`, `Schau mal, was ${name} gerade wert ist 👀`);
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
    </div>${state.me?.referral?.code ? `<button onclick="PS.shareInvite()" class="w-full bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs">🎁 Einladungslink dazu teilen (Gratismonat für dich)</button>` : ""}
    <p class="text-[11px] text-slate-400">Perfekt für Instagram-Story, TikTok, WhatsApp-Status oder Discord.</p>`, { onClose: () => URL.revokeObjectURL(url) });
  $("ps-share-go")?.addEventListener("click", () => navigator.share({ files: [file], title, text: state.me?.referral?.link ? `${text || title} 🎁 1 Monat gratis: ${state.me.referral.link}` : text }).catch(() => {}));
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
        <p class="font-black text-yellow-300">PSA ${esc(r.gradeLow ?? "?")}${r.gradeHigh && r.gradeHigh !== r.gradeLow ? `–${esc(r.gradeHigh)}` : ""}</p></div>
      <div class="grid grid-cols-5 gap-1.5">${s("L/R", esc(r.centeringLR))}${s("O/U", esc(r.centeringTB))}${s("Ecken", esc(r.corners ?? "–"))}${s("Kanten", esc(r.edges ?? "–"))}${s("Oberfl.", esc(r.surface ?? "–"))}</div>
      ${r.issues?.length ? `<ul class="list-disc pl-4 text-slate-300">${r.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      <p class="text-[10px] text-slate-500">Nur eine Schätzung anhand eines Fotos${r.photoQuality === "schlecht" ? " (Fotoqualität schlecht – Ergebnis unsicher)" : ""}. Kratzer und Rückseite prüfst du am besten mit Lupe und Licht.</p>`, "border-cyan-400/50");
    const hi = Number(r.gradeHigh) || 0;
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
  return `<label class="ps-pro-only block cursor-pointer" id="ps-bulk-label">
      <input id="ps-bulk-input" type="file" accept="image/*" multiple class="hidden" />
      <div class="bg-slate-900 border-2 border-dashed border-cyan-400/60 text-cyan-200 font-black text-xs text-center py-3 rounded-2xl">📚 Serien-Scan: mehrere Fotos auswählen – eindeutige Treffer landen direkt im Portfolio</div>
    </label><div id="ps-bulk-result" class="ps-pro-only space-y-1.5"></div>`;
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
      // Hybrid-Scanner: zuerst auf dem Gerät erkennen (0 €, kein Scan-Limit) – die KI nur bei unsicheren Fotos
      let local = null;
      try { local = await lazyLiveScanApi.liveScanRecognize(image); } catch { local = null; }
      if (local?.accepted && local.info) {
        const it = local.info;
        await api("/api/portfolio", { method: "POST", body: it.kind === "print" ? { printId: it.id } : { cardId: it.id } });
        lazyLiveScanApi.liveScanLearn(it.key, local.probe, "confirm").catch?.(() => {});
        added++;
        row.innerHTML = `<img src="${esc(cdn(it.image, 60))}" class="w-7 h-10 object-contain" /><span class="text-emerald-300 font-bold">✅ ${esc(it.name)} ${esc(it.number || "")} hinzugefügt <span class="text-slate-500 font-normal">· auf dem Gerät erkannt</span></span>`;
        continue;
      }
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
          `<button onclick="PS.bulkPick(this, ${jsArg(c.id)})" class="shrink-0 bg-slate-900 border border-slate-700 hover:border-cyan-400 rounded-lg p-1" title="${esc(c.id)}"><img src="${esc(cdn(c.image, 60))}" class="w-8 h-11 object-contain" /></button>`).join("")}</div>`;
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
const SWITCH_MIN = 20;

/** Anleitungen für den Export aus anderen Sammler-Apps (Stand der jeweiligen App kann abweichen). */
const EXPORT_HELP = `<details class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs">
  <summary class="font-black text-white cursor-pointer">❓ So exportierst du deine Sammlung aus einer anderen App</summary>
  <ul class="mt-2 space-y-1.5 text-slate-300 list-disc pl-4">
    <li><b>Collectr:</b> Portfolio öffnen → Menü (⋯) bzw. Einstellungen → „Export“ / „Export to CSV“. Die Datei hier hochladen.</li>
    <li><b>Dex, PokéCardex & andere Apps:</b> In den Einstellungen oder in der Sammlung nach „Export“, „CSV“ oder „Backup“ suchen.</li>
    <li><b>Cardmarket:</b> Bestand bzw. Sammlung als CSV herunterladen.</li>
    <li><b>Kein Export möglich?</b> Kartenliste aus Notizen oder Excel einfügen (eine Karte pro Zeile, z. B. „Glurak ex 199/165“) oder den Serien-Scan nutzen.</li>
  </ul>
  <p class="text-[10px] text-slate-500 mt-2">Menüpunkte können sich je nach App-Version unterscheiden. Erkannt werden deutsche und englische Spalten (z. B. „Product Name“, „Card Number“, „Quantity“, „Average Cost Paid“).</p>
</details>`;

const bonusBanner = () => (state.me?.switchBonusAvailable
  ? `<div class="bg-gradient-to-r from-yellow-400/20 to-emerald-400/20 border border-yellow-400/60 rounded-2xl p-3 text-xs text-white">
      🎁 <b>Wechsel-Bonus:</b> Importiere mindestens ${SWITCH_MIN} Karten aus deiner bisherigen App und du bekommst <b>30 Tage Premium gratis</b> – mit Platz für 500 Karten. Wird automatisch eingelöst.</div>`
  : "");

function openImport() {
  if (!requireLogin()) return;
  importRows = [];
  modal("ps-import", `<h3 class="text-base font-black text-white">📥 Sammlung importieren</h3>
    <p class="text-xs text-slate-300">Umzug in 2 Minuten: CSV-Datei aus Collectr, Dex, Cardmarket, Excel oder Google Sheets hochladen – oder eine Liste einfügen (eine Karte pro Zeile, z. B. „Glurak ex 199/165“). Erkannte Spalten: Name, Set, Nummer, Anzahl, Einkaufspreis.</p>
    ${bonusBanner()}
    ${EXPORT_HELP}
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

/** Löst den Wechsel-Bonus ein, sobald genug Karten erkannt wurden. Liefert true, wenn er gerade aktiviert wurde. */
async function claimSwitchBonus() {
  if (!state.me?.switchBonusAvailable) return false;
  try {
    await api("/api/switch-bonus", { method: "POST", body: {} });
    await PS().refreshMe?.();
    toast("🎁 Wechsel-Bonus aktiv!", "30 Tage Premium gratis – Platz für 500 Karten, Restock-Alarme ohne Wartezeit und mehr.");
    return true;
  } catch (e) {
    if (e.data?.used && state.me) state.me.switchBonusAvailable = false;
    return false;
  }
}

async function runImport() {
  const btnEl = $("ps-imp-go");
  btnEl.disabled = true;
  let queue = importRows.slice(0, 2000), imported = 0, matched = 0, overLimit = 0, rounds = 0, bonus = false;
  const unmatched = [];
  while (queue.length && rounds++ < 120) {
    const chunk = queue.slice(0, 40);
    btnEl.textContent = `⏳ ${imported} von ${importRows.length} importiert …`;
    try {
      const r = await api("/api/portfolio/import-rows", { method: "POST", body: { rows: chunk } });
      imported += r.imported; matched += r.matched; unmatched.push(...r.unmatched);
      if (r.overLimit) {
        // Limit erreicht: Mit dem Wechsel-Bonus (Premium) geht der Import einfach weiter
        const todoCount = r.imported + r.retry.length;
        if (!bonus && matched >= SWITCH_MIN && (await claimSwitchBonus())) {
          bonus = true;
          queue = r.retry.concat(chunk.slice(todoCount), queue.slice(chunk.length));
          continue;
        }
        overLimit = queue.length - r.imported - r.retry.length;
        break;
      }
      queue = r.retry.concat(queue.slice(chunk.length));
      if (!r.imported && r.retry.length) await new Promise((res) => setTimeout(res, 1500));
    } catch (e) { handleError(e); break; }
  }
  if (!bonus && matched >= SWITCH_MIN) bonus = await claimSwitchBonus();
  PS().loadPortfolio();
  $("ps-imp-preview").innerHTML = `<p class="text-emerald-300 font-bold">✅ ${imported} Karten importiert, ${matched} davon mit Live-Preis.</p>
    ${bonus ? `<p class="text-yellow-300 font-bold">🎁 Wechsel-Bonus eingelöst: 30 Tage Premium gratis.</p>` : ""}
    ${!bonus && state.me?.switchBonusAvailable && matched < SWITCH_MIN ? `<p class="text-slate-300">Noch ${SWITCH_MIN - matched} Karten mit Live-Preis bis zum Wechsel-Bonus (30 Tage Premium).</p>` : ""}
    ${unmatched.length ? `<p class="text-amber-300">Ohne Live-Preis (bitte Wert selbst eintragen): ${unmatched.slice(0, 15).map(esc).join(", ")}${unmatched.length > 15 ? " …" : ""}</p>` : ""}
    ${overLimit ? `<p class="text-rose-300">${overLimit} Karten passen nicht mehr in deinen Tarif. <button onclick="PS.openPro()" class="underline font-bold">Mehr Platz</button></p>` : ""}
    ${imported ? `<button onclick="PS.sharePortfolioImage()" class="mt-2 w-full bg-yellow-400 text-slate-950 font-black py-2.5 rounded-xl text-xs">📸 Meine Sammlung teilen</button>` : ""}`;
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
          <p class="text-slate-400">${e.city ? `📍 ${esc(e.city)} • ` : ""}${Number(e.interested) || 0} interessiert${e.author && e.kind === "event" ? ` • von ${esc(e.author)}` : ""}</p>
          ${e.description ? `<p class="text-slate-300">${esc(e.description)}</p>` : ""}
          <div class="flex flex-wrap gap-1.5 pt-1">
            <button onclick="PS.toggleRemind(${Number(e.id)})" class="${e.reminded ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-white"} font-bold px-2.5 py-1 rounded-lg">${e.reminded ? "🔔 Erinnerung an" : "🔔 Erinnern"}</button>
            ${safeUrl(e.url) ? `<a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener nofollow ugc" class="bg-slate-800 text-white font-bold px-2.5 py-1 rounded-lg">Mehr ↗</a>` : ""}
            ${e.mine || state.me?.isAdmin ? `<button onclick="PS.removeEvent(${Number(e.id)})" class="text-slate-400 hover:text-rose-400 px-1.5">Löschen</button>` : `<button onclick="PS.report('event', '${Number(e.id)}')" class="text-slate-500 hover:text-rose-400 px-1.5">Melden</button>`}
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
          ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Aktuelle Serie</p><p class="text-xl font-black text-orange-400">🔥 ${Number(b.streak) || 0} ${Number(b.streak) === 1 ? "Tag" : "Tage"}</p>`)}
          ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Rekord</p><p class="text-xl font-black text-white">${Number(b.bestStreak) || 0}</p>`)}
          ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Abzeichen</p><p class="text-xl font-black text-amber-300">${earned}/${b.badges.length}</p>`)}
          ${card(`<label class="flex items-center gap-2 font-bold text-slate-200"><input type="checkbox" ${b.leaderboardOptIn ? "checked" : ""} onchange="PS.setPref('leaderboardOptIn', this.checked)" /> In Bestenliste zeigen</label>
            <label class="flex items-center gap-2 font-bold text-slate-200"><input type="checkbox" ${b.weeklyReport ? "checked" : ""} onchange="PS.setPref('weeklyReport', this.checked)" /> Wochen-Report</label>`)}
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">${b.badges.map((x) => `<div class="rounded-2xl p-2 text-center border ${x.earned ? "bg-amber-400/10 border-amber-400/60" : "bg-slate-950 border-slate-800 opacity-50 grayscale"}" title="${esc(x.description)}">
          <p class="text-2xl">${esc(x.icon)}</p><p class="text-[11px] font-black text-white">${esc(x.label)}</p><p class="text-[10px] text-slate-400 leading-tight">${esc(x.description)}</p></div>`).join("")}</div>`;
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
    const { entries } = await api(`/api/leaderboard?type=${encodeURIComponent(type)}`);
    const me = state.me?.displayName;
    box.innerHTML = entries.length ? entries.map((e, i) => `<div class="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ${e.display_name === me ? "bg-amber-400/20 border border-amber-400/60" : "bg-slate-950 border border-slate-800"}">
        <span class="flex items-center gap-2 min-w-0"><span class="w-6 text-center font-black ${i < 3 ? "text-amber-300" : "text-slate-500"}">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
          <span class="font-bold text-white truncate">${esc(e.display_name)}</span>${e.city ? `<span class="text-slate-500 truncate">${esc(e.city)}</span>` : ""}</span>
        <strong class="text-white shrink-0">${type === "value" ? eur(e.score) : type === "trades" ? `${Number(e.score) || 0} Tausche` : `${Number(e.score) || 0} Tage`}</strong></div>`).join("")
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
    const n = (v) => Number(v) || 0;
    const max = Math.max(1, ...s.days.map((d) => n(d.views) + n(d.listing_views)));
    const bars = s.days.map((d, i) => {
      const hgt = ((n(d.views) + n(d.listing_views)) / max) * 100;
      return `<rect x="${i * 10 + 1}" y="${100 - hgt}" width="8" height="${hgt}" rx="2" fill="#22d3ee"><title>${esc(d.day)}: ${n(d.views)} Shop-Aufrufe, ${n(d.listing_views)} Inserat-Aufrufe, ${n(d.requests)} Anfragen</title></rect>`
        + (d.requests ? `<circle cx="${i * 10 + 5}" cy="${Math.max(4, 100 - hgt - 5)}" r="3" fill="#facc15"/>` : "");
    }).join("");
    const t = s.totals;
    modal("ps-shop-stats", `<h3 class="text-base font-black text-white">📊 Shop-Statistik (30 Tage)</h3>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Shop-Aufrufe</p><p class="text-lg font-black text-cyan-300">${n(t.views)}</p>`)}
        ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Inserat-Aufrufe</p><p class="text-lg font-black text-white">${n(t.listingViews)}</p>`)}
        ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Anfragen</p><p class="text-lg font-black text-yellow-300">${n(t.requests)}</p>`)}
        ${card(`<p class="text-slate-400 font-bold uppercase text-[10px]">Abgeschlossen</p><p class="text-lg font-black text-emerald-400">${n(t.completed)}</p>`)}
      </div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800"><svg viewBox="0 0 300 100" preserveAspectRatio="none" class="w-full h-32">${bars}</svg>
        <p class="text-[10px] text-slate-500 flex justify-between"><span>${esc(s.days[0]?.day || "")}</span><span>🟦 Aufrufe • 🟡 Tage mit Anfragen</span><span>heute</span></p></div>
      <p class="text-sm font-black text-white">🔥 Gefragteste Inserate</p>
      <div class="space-y-1 text-xs">${s.top.length ? s.top.map((l) => `<div class="flex justify-between gap-2 bg-slate-900 rounded-xl px-3 py-2"><span class="truncate text-white">${esc(l.card_name)} <span class="text-slate-500">${eur(l.price)}${l.status !== "active" ? ` • ${esc(l.status)}` : ""}</span></span>
        <strong class="text-yellow-300 shrink-0">${n(l.requests)} Anfragen${l.completed ? ` • ${n(l.completed)} ✓` : ""}</strong></div>`).join("") : `<p class="text-slate-500">Noch keine Inserate.</p>`}</div>
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
    // Firebase-Online-Anzeige dieses Geräts entfernen (anonyme Firebase-UID), bevor das Konto gelöscht wird
    let firebaseUid = "", firebaseCleared = false;
    try {
      const fb = await window.psFirebaseForget?.();
      if (fb) { firebaseUid = fb.uid || ""; firebaseCleared = Boolean(fb.cleared); }
    } catch {}
    const r = await api("/api/account/delete", { method: "POST", body: { confirm: $("ps-del-confirm").value.trim().toUpperCase(), firebaseUid, firebaseCleared } });
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
// Feste Anbieterkennzeichnung (§ 5 DDG) – wird angezeigt, falls die API einmal nicht erreichbar ist
const IMPRESSUM_FALLBACK = "Kevin Hundt\nHähn 10\n51515 Kürten\nDeutschland\n\nKontakt:\nE-Mail: info@pokeswipe-radar.de\nTelefon: +49 174 2182874\n\nKleinunternehmer gemäß § 19 UStG – es wird keine Umsatzsteuer berechnet.\n\nVerantwortlich für den Inhalt nach § 18 Abs. 2 MStV: Kevin Hundt, Hähn 10, 51515 Kürten";
async function loadImpressum() {
  const box = $("ps-impressum");
  if (!box) return;
  try {
    const { impressum } = await api("/api/legal");
    box.textContent = impressum || IMPRESSUM_FALLBACK;
  } catch { box.textContent = IMPRESSUM_FALLBACK; }
}

const OP_FIELDS = [
  ["name", "Vor- und Nachname *", "Max Mustermann"], ["company", "Firma (optional)", "z. B. Mustermann Collectibles"],
  ["representative", "Vertreten durch (bei Firma)", ""], ["street", "Straße und Hausnummer *", "Musterstraße 1"],
  ["zip", "PLZ *", "12345"], ["city", "Ort *", "Musterstadt"], ["country", "Land", "Deutschland"],
  ["email", "E-Mail *", "info@pokeswipe-radar.de"], ["phone", "Telefon (empfohlen)", ""],
  ["vatId", "USt-IdNr. (falls vorhanden)", "DE…"], ["register", "Registereintrag (falls vorhanden)", "Amtsgericht …, HRB …"],
  ["responsible", "Verantwortlich nach § 18 MStV (falls abweichend)", ""],
];
const flag = (ok, yes, no) => `<span class="${ok ? "text-emerald-300" : "text-amber-300"}">${ok ? "✔ " + yes : "⚠️ " + no}</span>`;

export async function adminGrowthHtml() {
  let legal = { operator: {}, legacy: "", complete: false, mail: false }, integ = null, canc = { cancellations: [], review: 0 };
  try { legal = await api("/api/admin/legal"); } catch {}
  try { integ = await api("/api/admin/integrations"); } catch {}
  try { canc = await api("/api/admin/cancellations"); } catch {}
  let intl = null;
  try { intl = await api("/api/admin/catalog-intl"); } catch {}
  const o = legal.operator || {};
  const st = integ?.stripe || {}, af = integ?.affiliate || {}, cat = integ?.catalog;
  const when = (d) => (d ? new Date(d).toLocaleString("de-DE") : "noch nie");
  return `<h4 class="text-sm font-black text-white">🔌 Zahlungen & Partner – Status</h4>
    ${integ ? `<div class="bg-slate-950 border border-slate-800 rounded-2xl p-3 text-[11px] space-y-1">
      <p>${flag(st.key, `Stripe-Schlüssel gesetzt (${esc(st.key)})`, "STRIPE_SECRET_KEY fehlt – Bezahl-Buttons sind inaktiv")}</p>
      <p>${flag(st.webhook, `Stripe-Webhook aktiv (${st.webhook === "env" ? "Netlify-Variable" : "automatisch eingerichtet"}) • letztes Ereignis: ${esc(when(st.lastEventAt))}${st.lastEventType ? ` (${esc(st.lastEventType)})` : ""}`, "Stripe-Webhook fehlt – Kündigungen & Zahlungsausfälle greifen erst beim nächsten Abgleich")}</p>
      ${st.lastError ? `<p class="text-rose-300">Letzter Webhook-Fehler (${esc(when(st.lastErrorAt))}): ${esc(st.lastError)}</p>` : ""}
      <p>${flag(af.amazon === "ok", "Amazon-Partner-Tag aktiv", af.amazon === "format" ? "AMAZON_PARTNER_TAG hat ein ungewöhnliches Format (erwartet z. B. name-21)" : "AMAZON_PARTNER_TAG nicht gesetzt – Amazon-Klicks ohne Provision")}</p>
      <p>${flag(af.cardmarket === "ok", "Cardmarket-Partner-ID aktiv (Server & App)", af.cardmarket === "format" ? "CARDMARKET_PARTNER_ID enthält ungültige Zeichen" : "CARDMARKET_PARTNER_ID nicht gesetzt")}</p>
      <p>${flag(true, "eBay Partner Network aktiv (Campaign-ID im Code)", "")}</p>
      <p>${flag(af.grading?.length, `Grading-Partner-Links: ${esc((af.grading || []).join(", "))}`, "Keine Grading-Partner-Links (AFF_PSA_URL …)")}</p>
      <p>${flag(integ.mail, "E-Mail-Versand aktiv (Kündigungsbestätigung per E-Mail)", "E-Mail-Versand nicht eingerichtet (RESEND_API_KEY + MAIL_FROM) – Bestätigung nur auf der Seite, als Datei & im Konto")}</p>
      <p>${flag(integ.legal?.complete, "Impressum vollständig", "Impressum unvollständig – bitte unten ausfüllen")}</p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      ${btn(st.webhook ? "🔁 Stripe-Webhook prüfen/erneuern" : "⚡ Stripe-Webhook automatisch einrichten", "PS.adminWebhookSetup()", "bg-indigo-600 text-white")}
      <p class="text-[10px] text-slate-400 self-center">Legt den Webhook auf <code>${esc(st.webhookUrl || "")}</code> in deinem Stripe-Konto an und speichert das Signatur-Geheimnis sicher – kein Kopieren nötig.</p>
    </div>` : `<p class="text-xs text-slate-400">Status konnte nicht geladen werden.</p>`}

    <h4 class="text-sm font-black text-white">⚖️ Impressum (Pflichtangaben § 5 DDG)</h4>
    <p class="text-[11px] text-slate-400">Daraus entstehen automatisch Impressum, Anbieterangaben in AGB und Widerrufsbelehrung sowie das Muster-Widerrufsformular (<a href="/rechtliches" target="_blank" class="underline">/rechtliches</a>). Gespeichert in Netlify Blobs, nicht im Code. Tipp: Statt der Privatadresse kann eine ladungsfähige Geschäftsadresse eingetragen werden.</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">${OP_FIELDS.map(([k, label, ph]) => `<label class="block"><span class="text-slate-400 text-[10px] font-bold">${esc(label)}</span>
      <input id="ps-op-${k}" value="${esc(o[k] || "")}" placeholder="${esc(ph)}" maxlength="200" class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white" /></label>`).join("")}</div>
    <label class="flex gap-2 items-center text-xs text-slate-300"><input type="checkbox" id="ps-op-smallBusiness" ${o.smallBusiness ? "checked" : ""}> Kleinunternehmer (§ 19 UStG – keine Umsatzsteuer)</label>
    <details class="text-xs text-slate-400"><summary class="cursor-pointer">Alternativ: Impressum als Freitext (wird nur genutzt, solange die Felder oben unvollständig sind)</summary>
      <textarea id="ps-ad-legal" rows="5" maxlength="4000" class="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs">${esc(legal.legacy || "")}</textarea></details>
    ${btn("Impressum speichern", "PS.adminSaveLegal()", "w-full bg-emerald-500 text-slate-950")}

    <h4 class="text-sm font-black text-white">📄 Kündigungen (Kündigungsbutton) ${canc.review ? `<span class="text-rose-300">• ${Number(canc.review)} zu prüfen</span>` : ""}</h4>
    <div class="space-y-1.5 max-h-56 overflow-y-auto text-[11px]">${(canc.cancellations || []).slice(0, 50).map((k) => `<div class="bg-slate-900 rounded-xl p-2 border ${k.status === "review" ? "border-rose-500/50" : "border-slate-800"}">
      <p class="text-white font-bold">${esc(k.reference)} • ${esc(k.name)} • ${esc(k.email)} <span class="text-slate-400">${new Date(k.created_at || k.createdAt).toLocaleString("de-DE")}</span></p>
      <p class="text-slate-300">${esc(k.kind)} • Status: <b>${esc(k.status)}</b>${k.effective_at || k.effectiveAt ? ` • Ende ${new Date(k.effective_at || k.effectiveAt).toLocaleDateString("de-DE")}` : ""}${k.verified ? " • angemeldet" : ""}</p>
      ${k.reason ? `<p class="text-slate-400">${esc(k.reason)}</p>` : ""}
      ${k.status === "pending_confirmation" ? `<p class="text-amber-300">Ohne Anmeldung eingereicht – wartet auf Bestätigung über den Link an die Konto-E-Mail.</p>` : ""}
      ${(k.userId || k.user_id) && ["review", "pending_confirmation"].includes(k.status) ? btn("Bei Stripe anwenden", `PS.adminCancelApply(${Number(k.id)})`, "mt-1 mr-1 bg-rose-500/30 text-rose-100") : ""}
      ${k.status === "review" ? btn("Als erledigt markieren", `PS.adminCancelDone(${Number(k.id)})`, "mt-1 bg-emerald-500/30 text-emerald-200") : ""}</div>`).join("") || `<p class="text-slate-500">Noch keine Kündigungen.</p>`}</div>

    <h4 class="text-sm font-black text-white">📚 Deutscher Kartenkatalog (SEO)</h4>
    ${cat ? `<p class="text-[11px] text-slate-300">Sets: ${Number(cat.setsImported)}/${Number(cat.sets)} importiert • Karten im Katalog: ${Number(cat.catalogCards).toLocaleString("de-DE")} • mit Preis: ${Number(cat.cardsPriced).toLocaleString("de-DE")} • Sealed mit Preis: ${Number(cat.sealedPriced)}/${Number(cat.sealed)}</p>
      <p class="text-[11px] text-slate-300">Kartendetails (Pokédex, KP, Typ): ${Number(cat.cardsDetailed || 0).toLocaleString("de-DE")} • Pokémon-Seiten: ${Number(cat.species || 0)} (davon ${Number(cat.speciesEn || 0)} mit engl. Namen)</p>
      ${(cat.runs || []).length ? `<details class="text-[11px] text-slate-400"><summary class="cursor-pointer">Letzte Import-Läufe</summary>${cat.runs.map((r) => `<p>${new Date(r.startedAt).toLocaleString("de-DE")} • ${Number(r.setsImported)} Sets • ${Number(r.prices)} Preise • ${Number(r.species)} Arten${r.errors ? ` • <span class="text-rose-300">${Number(r.errors)} Fehler</span>` : ""}${r.finishedAt ? "" : " • läuft/abgebrochen"}${r.note ? ` • ${esc(r.note)}` : ""}</p>`).join("")}</details>` : ""}` : ""}
    <p class="text-[11px] text-slate-400">Läuft automatisch alle 10 Minuten (neue Sets zuerst). Öffentliche Seiten: <a href="/sets" target="_blank" class="underline">/sets</a>, <code>/set/&lt;id&gt;/&lt;name&gt;</code>, <code>/karte/…</code>, <a href="/pokemon" target="_blank" class="underline">/pokemon</a>, <a href="/sealed" target="_blank" class="underline">/sealed</a>, <a href="/trends" target="_blank" class="underline">/trends</a>; Sitemap-Index unter <a href="/sitemap.xml" target="_blank" class="underline">/sitemap.xml</a>.</p>
    <div class="flex gap-2 text-xs"><input id="ps-cat-set" placeholder="Set-ID (optional, z. B. sv08)" class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
      ${btn("Import jetzt ausführen", "PS.adminCatalogRun()", "bg-slate-800 text-white")}</div>

    <h4 class="text-sm font-black text-white">🌍 Englischer & japanischer Katalog</h4>
    ${intl ? `${(intl.langs || []).map((l) => `<p class="text-[11px] text-slate-300">${l.lang === "ja" ? "🇯🇵 Japanisch" : "🇬🇧 Englisch"}: Sets ${Number(l.sets_imported)}/${Number(l.sets)} • Karten ${Number(l.prints).toLocaleString("de-DE")} • geprüft ${Number(l.checked).toLocaleString("de-DE")} • mit Preis ${Number(l.priced).toLocaleString("de-DE")} (TCGplayer: ${Number(l.tcgplayer).toLocaleString("de-DE")})</p>`).join("") || `<p class="text-[11px] text-slate-400">Noch kein Import gelaufen.</p>`}
      <p class="text-[11px] text-slate-400">Wechselkurs: ${intl.fx?.USD ? `1 € = ${Number(intl.fx.USD).toLocaleString("de-DE")} $ / ${Number(intl.fx.JPY).toLocaleString("de-DE")} ¥` : "–"}${intl.fx?.day ? ` (EZB, ${new Date(intl.fx.day).toLocaleDateString("de-DE")})` : ""}${intl.fx?.estimated ? " • geschätzt, EZB-Kurs folgt" : ""}</p>` : `<p class="text-[11px] text-slate-400">Status nicht verfügbar.</p>`}
    <p class="text-[11px] text-slate-400">Läuft automatisch alle 10 Minuten (neue Sets zuerst, Karten mit Bild zuerst). Cardmarket (EUR) und TCGplayer (USD) werden getrennt gespeichert.</p>
    ${btn("EN/JA-Import jetzt ausführen", "PS.adminCatalogIntlRun()", "w-full bg-slate-800 text-white")}
    <details class="text-xs text-slate-300"><summary class="cursor-pointer font-bold">📦 Sealed-Preise per CSV importieren</summary>
      <p class="text-[11px] text-slate-400 mt-1">Erste Zeile = Spaltennamen (Semikolon oder Komma): <code>name;set;kind;ean;uvp;price;release;image;cardmarket</code>, optional <code>inhalt;boosters;beschreibung</code> (für „Preis pro Booster“ und die Produktseite <code>/sealed/…</code>). Art (<code>kind</code>): display, etb, ttb, bundle, booster, tin, collection, other. Abgleich über EAN, Namen oder Slug – vorhandene Produkte werden aktualisiert, Preise landen im Verlauf und lösen Alarme aus.</p>
      <textarea id="ps-sealed-csv" rows="5" class="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs" placeholder="name;set;kind;uvp;price&#10;Stürmische Funken Display (36 Booster);Stürmische Funken;display;161,64;139,90"></textarea>
      ${btn("CSV importieren", "PS.adminSealedImport()", "w-full bg-purple-600 text-white")}</details>

    <div class="grid grid-cols-1 gap-2">
      ${btn("📅 Erinnerungen & Wochen-Report jetzt", "PS.adminRunGrowth()", "bg-slate-800 text-white")}
    </div>
    <p class="text-[11px] text-slate-400">Set-Releases trägst du direkt im Kalender ein (Community → Kalender, Art „Set-Release“).</p>`;
}

async function adminSaveLegal() {
  const operator = Object.fromEntries(OP_FIELDS.map(([k]) => [k, $(`ps-op-${k}`)?.value || ""]));
  operator.smallBusiness = Boolean($("ps-op-smallBusiness")?.checked);
  try {
    const r = await api("/api/admin/legal", { method: "PUT", body: { operator, impressum: $("ps-ad-legal")?.value || "" } });
    toast(r.complete ? "✅ Impressum gespeichert" : "Gespeichert – noch unvollständig", r.complete ? "Impressum, AGB und Widerrufsbelehrung sind jetzt vollständig." : "Pflicht: Name/Firma, Straße, PLZ, Ort und E-Mail.");
  } catch (e) { handleError(e); }
}
async function adminWebhookSetup() {
  try {
    const r = await api("/api/admin/integrations/stripe-webhook", { method: "POST", body: {} });
    toast("✅ Stripe-Webhook aktiv", r.created ? "Neu eingerichtet – Kündigungen und Zahlungsausfälle greifen ab sofort." : "Webhook ist eingerichtet und auf dem neuesten Stand.");
    window.PS?.openAdmin?.();
  } catch (e) { handleError(e); }
}
async function adminCatalogRun() {
  const setId = ($("ps-cat-set")?.value || "").trim();
  toast("⏳ Katalog-Import läuft …", "Das dauert bis zu 20 Sekunden.");
  try {
    const r = await api("/api/admin/catalog/run", { method: "POST", body: setId ? { setId } : {} });
    const s = r.status || {};
    toast("✅ Import-Schritt fertig", `${setId ? `${r.cards || 0} Karten aus ${setId}` : `${(r.setsImported || []).length} Sets, ${r.prices || 0} Preise`} • Gesamt: ${s.setsImported}/${s.sets} Sets, ${s.catalogCards} Karten`);
  } catch (e) { handleError(e); }
}
async function adminCatalogIntlRun() {
  toast("⏳ EN/JA-Import läuft …", "Das dauert bis zu 20 Sekunden.");
  try {
    const r = await api("/api/admin/catalog-intl/run", { method: "POST", body: {} });
    toast("✅ Import-Schritt fertig", `${(r.setsImported || []).length} Sets, ${Number(r.prices) || 0} Preise${r.errors ? `, ${Number(r.errors)} Fehler` : ""}`);
  } catch (e) { handleError(e); }
}
async function adminSealedImport() {
  const csv = $("ps-sealed-csv")?.value || "";
  if (!csv.trim()) return toast("⚠️ Hinweis", "Bitte CSV einfügen.");
  try {
    const r = await api("/api/admin/catalog/sealed", { method: "POST", body: { csv } });
    toast("✅ Sealed importiert", `${r.created} neu, ${r.updated} aktualisiert, ${r.priced} Preise${r.skipped?.length ? `, ${r.skipped.length} übersprungen` : ""}`);
  } catch (e) { handleError(e); }
}
async function adminCancelApply(id) {
  if (!confirm("Kündigung jetzt bei Stripe anwenden? Nur nach Prüfung der Identität (z. B. Antwort von der Konto-E-Mail).")) return;
  try { const r = await api(`/api/admin/cancellations/${Number(id)}`, { method: "PATCH", body: { status: "applied", apply: true } }); toast("✅ Angewendet", `Status: ${r.status}`); window.PS?.openAdmin?.(); } catch (e) { handleError(e); }
}
async function adminCancelDone(id) {
  try { await api(`/api/admin/cancellations/${Number(id)}`, { method: "PATCH", body: { status: "applied" } }); toast("✅ Erledigt", ""); window.PS?.openAdmin?.(); } catch (e) { handleError(e); }
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
  conditionVariant: (id, v) => loadConditionPrices(id, v),
  openImport, addEvent, toggleRemind, removeEvent, board, setPref, openShopStats, exportData, deleteAccount,
  confirmDelete, openLegal, adminSaveLegal, adminRunGrowth, loadWishlist,
  adminWebhookSetup, adminCatalogRun, adminCatalogIntlRun, adminSealedImport, adminCancelDone, adminCancelApply,
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
    const links = document.createElement("p");
    links.className = "flex flex-wrap gap-2";
    links.innerHTML = `<a href="/rechtliches#datenschutz" class="bg-slate-800 rounded-lg px-2 py-1 font-bold text-white">Datenschutzerklärung</a>
      <a href="/rechtliches#agb" class="bg-slate-800 rounded-lg px-2 py-1 font-bold text-white">AGB</a>
      <a href="/rechtliches#widerruf" class="bg-slate-800 rounded-lg px-2 py-1 font-bold text-white">Widerrufsbelehrung</a>
      <a href="/rechtliches#formular" class="bg-slate-800 rounded-lg px-2 py-1 font-bold text-white">Muster-Widerrufsformular</a>
      <a href="/kuendigen" class="bg-rose-600 rounded-lg px-2 py-1 font-black text-white">Verträge hier kündigen</a>`;
    el.after(links);
    $("ps-impressum").textContent = IMPRESSUM_FALLBACK;
    origOpenModal = window.openModal;
    window.openModal = (id) => { origOpenModal?.(id); if (id === "legal-modal") loadImpressum(); };
  }
  registerOffline();
  storageNotice();
}

export function afterAuthGrowth() {
  dailyCheckin();
  loadWishlist();
  resumeSwitch();
}

export function routeGrowth() {
  const params = new URLSearchParams(location.search);
  const cardId = params.get("card");
  if (cardId && /^[a-zA-Z0-9.\-_]{2,40}$/.test(cardId)) PS().openCard(cardId);
  if (params.get("legal") === "1") openLegal();
  // Von einer Pokémon-Seite (/pokemon/…): Kartensuche mit Suchbegriff öffnen
  const q = (params.get("search") || "").trim().slice(0, 60);
  if (q) {
    setTimeout(() => {
      const inp = document.getElementById("tcgdex-search-inp");
      if (!inp) return;
      inp.value = q;
      window.searchTCGdexLive?.();
      inp.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
  }
  // Von einer öffentlichen Set-Seite (/set/…): Set-Fortschritt in der App öffnen
  const setId = params.get("set");
  if (setId && /^[a-zA-Z0-9.\-_]{1,40}$/.test(setId)) {
    try { window.switchTab?.("portfolio"); } catch {}
    setTimeout(() => PS().openSet?.(setId), 300);
  }
  // Umzug aus einer anderen App (Link von /umzug): Sammlung öffnen und Import starten – nach dem Login automatisch
  if (params.get("umzug") === "1") {
    localStorage.setItem("ps_umzug", "1");
    try { window.switchTab?.("portfolio"); } catch {}
    if (state.user) { localStorage.removeItem("ps_umzug"); openImport(); }
    else PS().openAccount?.("Kostenlos anmelden – danach importierst du deine Sammlung in 2 Minuten.");
  }
}

/** Nach dem Login: begonnenen Umzug fortsetzen. */
export function resumeSwitch() {
  if (localStorage.getItem("ps_umzug") !== "1" || !state.user) return;
  localStorage.removeItem("ps_umzug");
  try { window.switchTab?.("portfolio"); } catch {}
  setTimeout(openImport, 400);
}
