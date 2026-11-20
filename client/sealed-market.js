// PokeSwipe Radar – Reiter „📦 Sealed & OVP“ im Marktplatz (Kaufen & Verkaufen von versiegelten Produkten).
//   • Kategorien: Alle Sealed · 📦 Booster Displays · 🎁 Top-Trainer-Boxen · 🥫 Tins & Kollektionen · 🃏 Booster & Blister · 🔒 Vintage
//   • Filter: Set, Preis von/bis, Anbieter (Alle | 👤 Privat | 🏪 Verifizierter Händler), Übergabe (📍 Safe-Trade Abholung | 📦 DHL-Versand)
//   • Formular „📦 Sealed-Produkt verkaufen“: Fotos, Produkttyp, Set, Sprache, OVP-Checkboxen, Preis mit Richtpreis aus dem
//     Sealed-Katalog + Cardmarket-Link, Standort & Versand – gespeichert als Pokémon-Artikel (POST /api/listings, item_meta).
// Daten: die bereits geladenen Marktplatz-Inserate (state.listings) – Kauf, Safe-Trade-Anfrage und Chat nutzen die bestehenden Abläufe.
import { $, esc, jsArg, eur, cdn, cm, state, api, toast, handleError, requireLogin, FALLBACK_IMG } from "./core.js";
import { compress } from "./item-listing.js";
import { ITEM_MAX_PHOTOS } from "../server/item-listing-logic.ts";
import {
  SEALED_KINDS, SEALED_LANGS, SEALED_DELIVERY, filterSealed, isSealedListing, sealedKindOf, sealedKindIcon, sealedKindLabel,
  sealedDeliveryOf, sealedSets, sealedRefPrice, isDealer,
} from "../server/sealed-market-logic.ts";

const sm = {
  kind: "all", set: "", min: "", max: "", seller: "all", delivery: "", q: "",
  form: false, photos: [], fKind: "display", busy: false, products: null, loadingProducts: false,
};
const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white";
const metaOf = (l) => (l?.item_meta && typeof l.item_meta === "object" ? l.item_meta : {});
const visible = () => Boolean($("ps-sealed-market"));

async function loadProducts() {
  if (sm.products || sm.loadingProducts) return;
  sm.loadingProducts = true;
  try { sm.products = (await api("/api/sealed")).products || []; } catch { sm.products = []; }
  sm.loadingProducts = false;
  if (visible()) { renderList(); updateRef(); }
}

/** Richtpreis eines Inserats aus dem Sealed-Katalog (Name/Set + Art). */
function refFor(l) {
  if (!sm.products?.length) return null;
  return sealedRefPrice(sm.products, sealedKindOf(l), metaOf(l).set || l.card_name);
}

// ---------------------------------------------------------------------------
// Filter & Liste
// ---------------------------------------------------------------------------
const pill = (on, label, call, cls = "") => `<button type="button" class="ps-chip ${cls}" aria-pressed="${on}" onclick="${call}">${label}</button>`;

function filtersHtml() {
  const all = state.listings || [];
  const sets = sealedSets(all);
  return `<div class="space-y-2">
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="toolbar" aria-label="Sealed-Kategorie">
      ${pill(sm.kind === "all", "Alle Sealed", "PS.sealedMarketKind('all')")}
      ${SEALED_KINDS.map((k) => pill(sm.kind === k.id, `${k.icon} ${esc(k.label)}`, `PS.sealedMarketKind(${jsArg(k.id)})`)).join("")}
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
      <label class="col-span-2 sm:col-span-1 block"><span class="text-slate-400 font-bold">Set</span>
        <input id="ps-sm-set" list="ps-sm-sets" value="${esc(sm.set)}" placeholder="z. B. Prismatische Entwicklungen" oninput="PS.sealedMarketFilter('set', this.value)" class="${inputCls} !py-2" />
        <datalist id="ps-sm-sets">${sets.slice(0, 40).map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist></label>
      <label class="block"><span class="text-slate-400 font-bold">Preis ab (€)</span><input type="number" min="0" inputmode="decimal" value="${esc(sm.min)}" oninput="PS.sealedMarketFilter('min', this.value)" class="${inputCls} !py-2" /></label>
      <label class="block"><span class="text-slate-400 font-bold">Preis bis (€)</span><input type="number" min="0" inputmode="decimal" value="${esc(sm.max)}" oninput="PS.sealedMarketFilter('max', this.value)" class="${inputCls} !py-2" /></label>
      <label class="col-span-2 sm:col-span-1 block"><span class="text-slate-400 font-bold">Suche</span><input type="search" value="${esc(sm.q)}" placeholder="Produkt, Ort …" oninput="PS.sealedMarketFilter('q', this.value)" class="${inputCls} !py-2" /></label>
    </div>
    <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span class="text-slate-400 font-bold mr-0.5">Anbieter:</span>
      ${pill(sm.seller === "all", "Alle", "PS.sealedMarketFilter('seller','all')")}${pill(sm.seller === "private", "👤 Privat", "PS.sealedMarketFilter('seller','private')")}${pill(sm.seller === "dealer", "🏪 Verifizierter Händler", "PS.sealedMarketFilter('seller','dealer')")}
      <span class="text-slate-400 font-bold ml-2 mr-0.5">Übergabe:</span>
      ${pill(sm.delivery === "pickup", "📍 Safe-Trade Abholung", "PS.sealedMarketFilter('delivery','pickup')")}${pill(sm.delivery === "ship", "📦 Versicherter DHL-Versand", "PS.sealedMarketFilter('delivery','ship')")}
    </div>
  </div>`;
}

function cardHtml(l) {
  const id = Number(l.id);
  const kind = sealedKindOf(l);
  const meta = metaOf(l);
  const own = state.user?.id && l.user_id === state.user.id;
  const ref = refFor(l);
  const price = Number(l.price) || 0;
  const diff = ref && price > 0 ? Math.round((1 - price / ref.price) * 100) : null;
  const deliv = sealedDeliveryOf(l);
  const photo = String(l.image || "").startsWith("/api/images/");
  const dealer = isDealer(l);
  const badges = [
    meta.factorySealed ? `<span class="ps-badge bg-emerald-500/20 text-emerald-200">✓ Factory Sealed</span>` : "",
    meta.mintBox ? `<span class="ps-badge bg-sky-500/20 text-sky-200">✓ Mint Box</span>` : "",
    l.lang && l.lang !== "de" ? `<span class="ps-badge bg-slate-800 text-slate-200">${esc(SEALED_LANGS.find((x) => x.id === l.lang)?.label || l.lang)}</span>` : "",
    l.buy_now ? `<span class="ps-badge bg-cyan-400 text-slate-950">🔒 Käuferschutz</span>` : "",
  ].join("");
  const buy = l.buy_now
    ? `<button type="button" onclick="PS.openBuy(${id})" class="bg-cyan-400 text-slate-950 font-black py-2 rounded-xl text-[11px]">🛒 Kaufen</button>`
    : `<button type="button" onclick="PS.requestTrade(${id})" class="bg-cyan-400/90 text-slate-950 font-black py-2 rounded-xl text-[11px]">🛒 Kauf anfragen</button>`;
  return `<article class="bg-slate-950 border border-slate-800 hover:border-purple-400/70 rounded-2xl p-2.5 flex gap-3 text-xs" data-sealed-listing="${id}">
    <button type="button" onclick="PS.openListing(${id})" class="w-24 shrink-0 aspect-square rounded-xl overflow-hidden bg-slate-900 relative" aria-label="${esc(l.card_name)} ansehen">
      <img src="${esc(cdn(l.image || FALLBACK_IMG, 240))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" alt="" class="w-full h-full ${photo ? "object-cover" : "object-contain"}" />
      <span class="absolute left-1 top-1 text-[9px] font-black bg-purple-500 text-white px-1.5 rounded">${sealedKindIcon(kind)} OVP</span>
    </button>
    <div class="min-w-0 flex-1 space-y-1">
      <p class="text-[10px] font-black uppercase text-purple-300 truncate">${esc(sealedKindLabel(kind))}${meta.set ? ` · ${esc(meta.set)}` : ""}</p>
      <p class="font-black text-white leading-tight line-clamp-2">${esc(l.card_name)}</p>
      <p class="flex flex-wrap items-baseline gap-x-2"><strong class="text-emerald-300 text-base">${price > 0 ? eur(price) : "Tausch"}</strong>
        ${ref ? `<span class="text-[10px] text-slate-400" title="Richtpreis aus dem Sealed-Katalog: ${esc(ref.name)}">Richtpreis ~${eur(ref.price)}${diff !== null && Math.abs(diff) >= 3 ? ` · <span class="${diff > 0 ? "text-emerald-300" : "text-rose-300"} font-bold">${diff > 0 ? `${diff} % darunter` : `${-diff} % darüber`}</span>` : ""}</span>` : ""}
        <a href="${esc(cm(`${l.card_name}`))}" target="_blank" rel="noopener" class="text-[10px] text-indigo-300 underline font-bold">📊 Cardmarket</a></p>
      <p class="text-[10px] text-slate-400 truncate">${dealer ? "🏪 Händler" : "👤 Privat"} · ${l.seller ? `<button type="button" onclick="PS.openUser(${jsArg(l.user_id)})" class="font-bold text-slate-200">${esc(l.seller)}</button>` : ""}${l.verified ? ` <span class="text-cyan-300">✔</span>` : ""} · 📍 ${esc(l.city || "–")} · ${deliv === "pickup" ? "📍 Safe-Trade Abholung" : deliv === "ship" ? "📦 DHL-Versand" : "📍 Abholung / 📦 Versand"}</p>
      ${badges ? `<div class="flex flex-wrap gap-1">${badges}</div>` : ""}
      ${own ? `<button type="button" onclick="PS.openListing(${id})" class="w-full bg-slate-800 text-white font-black py-2 rounded-xl text-[11px]">✏️ Mein Inserat verwalten</button>`
      : `<div class="grid grid-cols-3 gap-1.5 pt-0.5">${buy}
        ${deliv !== "ship" ? `<button type="button" onclick="PS.requestTrade(${id})" class="bg-emerald-500 text-slate-950 font-black py-2 rounded-xl text-[11px]" title="Treffen an einem sicheren Ort vereinbaren">📍 Safe-Trade</button>` : `<button type="button" onclick="PS.openListing(${id})" class="bg-slate-800 text-white font-bold py-2 rounded-xl text-[11px]">Details</button>`}
        <button type="button" onclick="PS.openDm(${jsArg(l.user_id)})" class="bg-slate-800 text-white font-bold py-2 rounded-xl text-[11px]">💬 Fragen</button></div>`}
    </div>
  </article>`;
}

function renderList() {
  const box = $("ps-sm-list");
  if (!box) return;
  const all = (state.listings || []).filter(isSealedListing);
  const list = filterSealed(all, sm);
  const cnt = $("ps-sm-count");
  if (cnt) cnt.textContent = `${list.length} von ${all.length} Sealed-Angeboten`;
  box.innerHTML = list.length ? list.map(cardHtml).join("")
    : `<div class="col-span-full ps-card p-6 text-center text-xs text-slate-300 space-y-2">
        <p class="text-2xl" aria-hidden="true">📦</p>
        <p>${all.length ? "Keine Sealed-Angebote für diese Filter." : "Noch keine Sealed-Produkte im Marktplatz – biete als Erster ein Display, eine ETB oder ein Tin an!"}</p>
        <div class="flex flex-wrap justify-center gap-1.5">
          ${all.length ? `<button type="button" onclick="PS.sealedMarketReset()" class="bg-slate-800 text-white font-bold px-3 py-1.5 rounded-xl">Filter zurücksetzen</button>` : ""}
          <button type="button" onclick="PS.sealedMarketForm(true)" class="bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-xl">📦 Sealed-Produkt verkaufen</button>
        </div></div>`;
}

// ---------------------------------------------------------------------------
// Formular „📦 Sealed-Produkt verkaufen“
// ---------------------------------------------------------------------------
function photosHtml() {
  const slots = sm.photos.map((src, i) => `<div class="relative aspect-square rounded-xl overflow-hidden border ${i === 0 ? "border-yellow-400" : "border-slate-700"} bg-slate-950">
      <img src="${esc(src)}" alt="Foto ${i + 1}" class="w-full h-full object-cover" />
      <button type="button" onclick="PS.sealedPhotoRemove(${i})" class="absolute right-1 top-1 w-7 h-7 rounded-full bg-slate-950/80 text-white text-xs font-black" aria-label="Foto ${i + 1} entfernen">✕</button></div>`).join("");
  const room = ITEM_MAX_PHOTOS - sm.photos.length;
  return `<div class="grid grid-cols-4 gap-1.5">${slots}${room > 0 ? `<label class="aspect-square rounded-xl border-2 border-dashed border-slate-600 hover:border-yellow-400 flex flex-col items-center justify-center text-center cursor-pointer text-[10px] text-slate-300 font-bold">
      <span class="text-xl" aria-hidden="true">📷</span>Foto<input type="file" accept="image/*" multiple class="hidden" onchange="PS.sealedPhotos(event)" /></label>` : ""}</div>
    <p class="text-[10px] text-slate-400">${sm.photos.length}/${ITEM_MAX_PHOTOS} Fotos · bitte Folie, Ecken und Siegel gut sichtbar fotografieren.</p>`;
}

function formHtml() {
  if (!state.user) {
    return `<div class="ps-card p-4 text-center space-y-2 text-xs"><p class="font-black text-white">📦 Sealed-Produkt verkaufen</p>
      <p class="text-slate-300">Melde dich an, um Displays, ETBs, Tins oder Vintage-Sealed in einer Minute zu inserieren.</p>
      <button type="button" onclick="PS.openAccount()" class="bg-yellow-400 text-slate-950 font-black px-4 py-2 rounded-xl">Anmelden</button></div>`;
  }
  const ready = Boolean(state.me?.sellerReady);
  const setNames = [...new Set((sm.products || []).map((p) => p.set_name).filter(Boolean))].slice(0, 80);
  return `<div class="ps-card p-4 space-y-3 text-xs border border-purple-500/40" id="ps-sm-form">
    <div class="flex items-center justify-between gap-2"><p class="text-sm font-black text-white">📦 Sealed-Produkt verkaufen</p>
      <button type="button" onclick="PS.sealedMarketForm(false)" class="text-slate-400 hover:text-white font-bold" aria-label="Formular schließen">✕</button></div>
    <div id="ps-sm-photos" class="space-y-1.5">${photosHtml()}</div>
    <p class="text-slate-300 font-bold">Produkttyp</p>
    <div id="ps-sm-kinds" class="flex flex-wrap gap-1.5">${kindChips()}</div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label class="block"><span class="text-slate-300 font-bold">Titel *</span><input id="ps-sm-title" maxlength="120" oninput="PS.sealedRefUpdate()" placeholder="z. B. Prismatische Entwicklungen Top-Trainer-Box" class="${inputCls}" /></label>
      <label class="block"><span class="text-slate-300 font-bold">Set</span><input id="ps-sm-fset" list="ps-sm-fsets" maxlength="80" placeholder="z. B. Karmesin & Purpur 151" oninput="PS.sealedRefUpdate()" class="${inputCls}" />
        <datalist id="ps-sm-fsets">${setNames.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist></label>
      <label class="block"><span class="text-slate-300 font-bold">Sprache</span><select id="ps-sm-lang" class="${inputCls}">${SEALED_LANGS.map((l) => `<option value="${l.id}">${l.label}</option>`).join("")}</select></label>
      <label class="block"><span class="text-slate-300 font-bold">Preis (€) *</span><input id="ps-sm-price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00" class="${inputCls}" /></label>
    </div>
    <div id="ps-sm-ref" class="text-[11px] text-slate-400"></div>
    <div class="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
      <label class="flex gap-2 items-start"><input type="checkbox" id="ps-sm-factory" checked class="mt-0.5 accent-emerald-400"><span><strong class="text-white">Original verschweißt / Factory Sealed</strong><span class="block text-[10px] text-slate-400">Originale Hersteller-Folie, nie geöffnet oder neu eingeschweißt.</span></span></label>
      <label class="flex gap-2 items-start"><input type="checkbox" id="ps-sm-mint" class="mt-0.5 accent-emerald-400"><span><strong class="text-white">Mint Box ohne Dellen/Risse</strong><span class="block text-[10px] text-slate-400">Keine Druckstellen, Knicke oder Folienrisse.</span></span></label>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label class="block"><span class="text-slate-300 font-bold">Standort (PLZ / Stadt)</span><input id="ps-sm-city" maxlength="60" value="${esc(state.me?.city || "")}" placeholder="z. B. 50667 Köln" class="${inputCls}" /></label>
      <label class="block"><span class="text-slate-300 font-bold">Übergabe & Versand</span><select id="ps-sm-delivery" class="${inputCls}">${SEALED_DELIVERY.map((d) => `<option value="${d.id}">${d.label}</option>`).join("")}</select></label>
    </div>
    ${ready ? `<label class="block"><span class="text-slate-300 font-bold">Versandkosten versicherter DHL-Versand (€)</span><input id="ps-sm-ship" type="number" step="0.01" min="0" max="25" value="6.99" class="${inputCls}" /></label>` : ""}
    <label class="block"><span class="text-slate-300 font-bold">Beschreibung</span><textarea id="ps-sm-desc" rows="2" maxlength="1000" placeholder="Zustand der Folie, Herkunft, Abholzeiten …" class="${inputCls}"></textarea></label>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <button type="button" data-sm-submit onclick="PS.sealedSubmit(true)" ${ready ? "" : "disabled"} class="bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-950 font-black py-3 rounded-xl text-xs min-h-[48px] disabled:opacity-50" title="${ready ? "Sofort-Kauf mit Käuferschutz (Stripe-Treuhand)" : "Verkäuferkonto nötig"}">🛒 Mit Kaufen-Button &amp; Käuferschutz veröffentlichen</button>
      <button type="button" data-sm-submit onclick="PS.sealedSubmit(false)" class="bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 font-black py-3 rounded-xl text-xs min-h-[48px]">📍 Für Safe-Trade &amp; Anfragen veröffentlichen</button>
    </div>
    ${ready ? "" : `<p class="text-[10px] text-slate-400">Für den Kaufen-Button mit Käuferschutz: <button type="button" onclick="PS.openSeller()" class="text-cyan-300 underline font-bold">Verkäuferkonto einrichten →</button></p>`}
  </div>`;
}

const kindChips = () => SEALED_KINDS.map((k) => `<button type="button" onclick="PS.sealedFormKind(${jsArg(k.id)})" aria-pressed="${sm.fKind === k.id}" class="text-[11px] font-bold px-2.5 py-1.5 rounded-xl border min-h-[36px] ${sm.fKind === k.id ? "bg-yellow-400 text-slate-950 border-yellow-300" : "bg-slate-950 text-slate-200 border-slate-700"}">${k.icon} ${esc(k.label)}</button>`).join("");

/** Richtpreis-Orientierung unter dem Preisfeld (Sealed-Katalog + Cardmarket-Suche). */
function updateRef() {
  const box = $("ps-sm-ref");
  if (!box) return;
  const set = ($("ps-sm-fset")?.value || "").trim();
  const title = ($("ps-sm-title")?.value || "").trim();
  const ref = sealedRefPrice(sm.products || [], sm.fKind, set || title);
  const q = `${set || title || "Pokemon"} ${sealedKindLabel(sm.fKind).split(" (")[0]}`.trim();
  box.innerHTML = `💡 Richtpreis-Orientierung: ${ref ? `<strong class="text-emerald-300">~${eur(ref.price)}</strong> (${esc(ref.name)}) · <button type="button" onclick="PS.sealedUseRef(${ref.price})" class="underline font-bold text-yellow-300">übernehmen</button> · ` : "Set eintragen für einen Richtpreis aus dem Sealed-Katalog · "}<a href="${esc(cm(q))}" target="_blank" rel="noopener" class="underline font-bold text-indigo-300">📊 Cardmarket-Preise prüfen ↗</a>`;
}

async function addPhotos(e) {
  const files = Array.from(e?.target?.files || []).slice(0, ITEM_MAX_PHOTOS - sm.photos.length);
  if (e?.target) e.target.value = "";
  for (const f of files) {
    try { sm.photos.push(await compress(f)); } catch (err) { toast("Foto", err.message || "Bild konnte nicht gelesen werden."); }
  }
  const el = $("ps-sm-photos");
  if (el) el.innerHTML = photosHtml();
}

async function submit(buyNowWanted) {
  if (!requireLogin() || sm.busy) return;
  const title = ($("ps-sm-title")?.value || "").trim();
  const price = String($("ps-sm-price")?.value || "").replace(",", ".");
  if (title.length < 3) return toast("Titel fehlt", "Bitte einen Titel eintragen (z. B. „151 Top-Trainer-Box“).");
  if (price === "" || !(Number(price) >= 0)) return toast("Preis fehlt", "Bitte einen Preis in € eintragen.");
  if (!sm.photos.length && !confirm("Ohne Foto inserieren? Bei Sealed-Produkten wollen Käufer Folie und Siegel sehen.")) return;
  const delivery = ["both", "pickup", "ship"].includes($("ps-sm-delivery")?.value) ? $("ps-sm-delivery").value : "both";
  const buyNow = Boolean(buyNowWanted && state.me?.sellerReady);
  const shippingCents = buyNow && delivery !== "pickup" ? Math.round((parseFloat(String($("ps-sm-ship")?.value || "0").replace(",", ".")) || 0) * 100) : 0;
  const want = delivery === "pickup" ? "Verkauf · Nur Abholung (Safe-Trade)" : delivery === "ship" ? "Verkauf · Nur Versand (DHL versichert)" : "Verkauf · Versand oder Abholung";
  sm.busy = true;
  document.querySelectorAll("[data-sm-submit]").forEach((b) => { b.disabled = true; });
  try {
    await api("/api/listings", { method: "POST", body: { items: [{
      listingType: "item", title, card: title, price, itemCategory: sm.fKind, itemCondition: "sealed", lang: $("ps-sm-lang")?.value || "de",
      description: $("ps-sm-desc")?.value || "", imgs: sm.photos, city: ($("ps-sm-city")?.value || "").trim(), want, buyNow, shippingCents,
      itemMeta: { sealed: true, set: ($("ps-sm-fset")?.value || "").trim(), factorySealed: Boolean($("ps-sm-factory")?.checked), mintBox: Boolean($("ps-sm-mint")?.checked), delivery },
    }] } });
    toast("🚀 Sealed-Produkt live", `${title} ist jetzt im Reiter „📦 Sealed & OVP“.`);
    sm.photos = []; sm.form = false; sm.kind = "all";
    await window.PS?.loadListings?.();
    renderSealedMarket();
  } catch (e) { handleError(e); }
  finally {
    sm.busy = false;
    document.querySelectorAll("[data-sm-submit]").forEach((b) => { b.disabled = b.getAttribute("onclick")?.includes("true") && !state.me?.sellerReady; });
  }
}

// ---------------------------------------------------------------------------
// Gerüst
// ---------------------------------------------------------------------------
export function sealedMarketHtml() {
  return `<section id="ps-sealed-market" class="space-y-3" aria-label="Sealed & OVP Kaufen/Verkaufen">
    <div class="ps-card p-4 space-y-3 border-2 border-purple-500/40">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0"><p class="ps-kicker text-purple-300">📦 Sealed &amp; OVP Kaufen/Verkaufen</p>
          <h2 class="text-base sm:text-lg font-black text-white">Displays, Top-Trainer-Boxen, Tins &amp; Vintage – original verschweißt</h2>
          <p class="text-[11px] text-slate-400" id="ps-sm-count"></p></div>
        <button type="button" onclick="PS.sealedMarketForm(true)" class="bg-yellow-400 text-slate-950 font-black text-xs px-3.5 py-2 rounded-xl shrink-0">📦 Sealed-Produkt verkaufen</button>
      </div>
      <div id="ps-sm-filters">${filtersHtml()}</div>
    </div>
    <div id="ps-sm-formbox">${sm.form ? formHtml() : ""}</div>
    <div id="ps-sm-list" class="grid grid-cols-1 md:grid-cols-2 gap-2"></div>
    <p class="text-[10px] text-slate-500">Richtpreise stammen aus dem PokeSwipe-Sealed-Katalog (eBay-Verkäufe, Angebote &amp; Community-Inserate); „📊 Cardmarket“ öffnet die aktuelle Cardmarket-Suche zum Vergleich.</p>
  </section>`;
}

/** Nach dem Einfügen des Gerüsts (Marktplatz-Reiter) oder bei neuen Inseraten aufrufen. */
export function renderSealedMarket() {
  if (!visible()) return;
  const f = $("ps-sm-filters");
  if (f && !f.contains(document.activeElement)) f.innerHTML = filtersHtml();
  const fb = $("ps-sm-formbox");
  if (fb && !fb.contains(document.activeElement)) { fb.innerHTML = sm.form ? formHtml() : ""; if (sm.form) updateRef(); }
  renderList();
  loadProducts();
}

export function initSealedMarket() {
  window.addEventListener("ps:listings", () => { if (visible()) renderList(); });
}

let filterTimer = 0;
export const sealedMarketApi = {
  sealedMarketHtml,
  renderSealedMarket,
  /** Direkt in den Sealed-Reiter springen (z. B. vom Schwarzen Brett oder der Startseite), optional mit Kategorie. */
  openSealedMarket: (kind = "") => {
    if (SEALED_KINDS.some((k) => k.id === kind)) sm.kind = kind;
    window.PS?.marketTab?.("sealed");
    setTimeout(() => $("ps-sealed-market")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  },
  sealedMarketKind: (k) => { sm.kind = k === "all" || SEALED_KINDS.some((x) => x.id === k) ? k : "all"; const f = $("ps-sm-filters"); if (f) f.innerHTML = filtersHtml(); renderList(); },
  sealedMarketFilter: (key, v) => {
    if (!["set", "min", "max", "seller", "delivery", "q"].includes(key)) return;
    const val = String(v ?? "").slice(0, 80);
    if (key === "delivery") sm.delivery = sm.delivery === val ? "" : val;
    else sm[key] = val;
    if (key === "seller" || key === "delivery") { const f = $("ps-sm-filters"); if (f) f.innerHTML = filtersHtml(); renderList(); return; }
    clearTimeout(filterTimer); filterTimer = setTimeout(renderList, 150);
  },
  sealedMarketReset: () => { Object.assign(sm, { kind: "all", set: "", min: "", max: "", seller: "all", delivery: "", q: "" }); const f = $("ps-sm-filters"); if (f) f.innerHTML = filtersHtml(); renderList(); },
  sealedMarketForm: (open) => {
    if (open && !requireLogin()) return;
    sm.form = Boolean(open);
    const fb = $("ps-sm-formbox");
    if (fb) { fb.innerHTML = sm.form ? formHtml() : ""; if (sm.form) { updateRef(); fb.scrollIntoView({ behavior: "smooth", block: "start" }); } }
    loadProducts();
  },
  sealedFormKind: (k) => { if (SEALED_KINDS.some((x) => x.id === k)) { sm.fKind = k; const el = $("ps-sm-kinds"); if (el) el.innerHTML = kindChips(); updateRef(); } },
  sealedRefUpdate: () => updateRef(),
  sealedUseRef: (p) => { const el = $("ps-sm-price"); if (el && Number(p) > 0) el.value = Number(p).toFixed(2); },
  sealedPhotos: (e) => addPhotos(e),
  sealedPhotoRemove: (i) => { sm.photos.splice(Number(i), 1); const el = $("ps-sm-photos"); if (el) el.innerHTML = photosHtml(); },
  sealedSubmit: (buyNow) => submit(Boolean(buyNow)),
};
