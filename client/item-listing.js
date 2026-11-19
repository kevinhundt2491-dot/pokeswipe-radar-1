// PokeSwipe Radar – „📦 Pokémon-Artikel“ inserieren (Unterreiter „Inserieren“ → Umschalter „🃏 Einzelkarten | 📦 Pokémon-Artikel“).
//   • Fotos direkt per Handykamera oder aus der Galerie (bis zu 4, im Browser verkleinert)
//   • Titel, Unterkategorie (Booster & Displays · ETBs & Kollektionen · Ordner & Zubehör · Plüsch & Figuren · Lots · Sonstiges),
//     Zustand (Neu & OVP · Wie neu · Gebraucht), Preis, Versand/Abholung + Ort, kurze Beschreibung
//   • Gespeichert im bestehenden Marktplatz (POST /api/listings mit listingType „item“) – Käuferschutz/Stripe, DHL-Versand,
//     Stadt-Filter, Chat, Merken und Verkäufer-Rang gelten automatisch genauso wie für Karten.
// Der bestehende Einzelkarten-Flow bleibt unverändert.
import { $, esc, jsArg, state, api, toast, handleError, requireLogin } from "./core.js";
import { ITEM_CATEGORIES, ITEM_CONDITIONS, ITEM_MAX_PHOTOS } from "../server/item-listing-logic.ts";
import { DEMO_ITEMS, demoItemPng } from "./reel-demo-items.js";

// Reel-Aufnahme (Live-Stage-iframe mit ?reel=1): Formular sichtbar vorbefüllen – es wird nie abgeschickt.
const IS_STAGE = (() => { try { return window.self !== window.top && new URLSearchParams(location.search).get("reel") === "1"; } catch { return false; } })();

const it = { photos: [], category: "booster", condition: "sealed", busy: false };
const TITLE_IDEAS = ["Stürmische Funken Display OVP", "Top-Trainer-Box", "9er Sammelordner", "Pikachu Plüschfigur", "Sleeves & Toploader Set", "Sammlung 500 Karten (Lot)"];
const DELIVERY = [
  ["both", "📦 Versand oder 🤝 Abholung", "Versand oder Abholung"],
  ["ship", "📦 Nur Versand", "Nur Versand"],
  ["pickup", "🤝 Nur Abholung", "Nur Abholung"],
];
const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white";

/** Bild verkleinern (max. ~600 KB, Server-Grenze) – wie bei Pull-Wall-Fotos. */
function compress(file, max = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Bitte ein Bild wählen."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let data = canvas.toDataURL("image/jpeg", quality);
      if (data.length > 780_000) data = canvas.toDataURL("image/jpeg", 0.62);
      if (data.length > 780_000) return compress(file, 860, 0.6).then(resolve, reject);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild konnte nicht gelesen werden.")); };
    img.src = url;
  });
}

function photosHtml() {
  const slots = it.photos.map((src, i) => `<div class="relative aspect-square rounded-xl overflow-hidden border ${i === 0 ? "border-yellow-400" : "border-slate-700"} bg-slate-950">
      <img src="${esc(src)}" alt="Foto ${i + 1}" class="w-full h-full object-cover" />
      ${i === 0 ? '<span class="absolute left-1 top-1 text-[9px] font-black bg-yellow-400 text-slate-950 px-1.5 rounded">Titelbild</span>' : ""}
      <button type="button" onclick="PS.itemPhotoRemove(${i})" class="absolute right-1 top-1 w-7 h-7 rounded-full bg-slate-950/80 text-white text-xs font-black" aria-label="Foto ${i + 1} entfernen">✕</button>
    </div>`).join("");
  const room = ITEM_MAX_PHOTOS - it.photos.length;
  return `<div class="grid grid-cols-4 gap-1.5">${slots}${room > 0 ? `<label class="aspect-square rounded-xl border-2 border-dashed border-slate-600 hover:border-yellow-400 flex flex-col items-center justify-center text-center cursor-pointer text-[10px] text-slate-300 font-bold">
      <span class="text-xl" aria-hidden="true">＋</span>Galerie<input type="file" accept="image/*" multiple class="hidden" onchange="PS.itemPhotos(event)" /></label>` : ""}</div>
    ${room > 0 ? `<label class="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 text-white font-black text-xs py-2.5 rounded-xl cursor-pointer min-h-[44px]">📷 Foto mit der Handykamera aufnehmen
      <input type="file" accept="image/*" capture="environment" class="hidden" onchange="PS.itemPhotos(event)" /></label>` : ""}
    <p class="text-[10px] text-slate-400">${it.photos.length}/${ITEM_MAX_PHOTOS} Fotos · das erste Foto ist das Titelbild im Marktplatz.</p>`;
}

const chip = (on, label, call) => `<button type="button" onclick="${call}" aria-pressed="${on}" class="text-[11px] font-bold px-2.5 py-1.5 rounded-xl border min-h-[36px] ${on ? "bg-yellow-400 text-slate-950 border-yellow-300" : "bg-slate-950 text-slate-200 border-slate-700"}">${label}</button>`;

/** Formular „📦 Pokémon-Artikel inserieren“ (wird im Unterreiter „Inserieren“ angezeigt). */
export function itemListingFormHtml() {
  if (!state.user) {
    return `<div class="poke-glass rounded-3xl p-5 text-center space-y-3">
      <p class="text-sm font-black text-white">📦 Pokémon-Artikel verkaufen</p>
      <p class="text-xs text-slate-300">Displays, ETBs, Ordner, Plüsch oder ganze Sammlungen – melde dich an, um deinen Artikel in 1 Minute zu inserieren.</p>
      <button type="button" onclick="PS.openAccount()" class="w-full bg-yellow-400 text-slate-950 font-black text-xs py-2.5 rounded-xl">Anmelden</button>
    </div>`;
  }
  const ready = Boolean(state.me?.sellerReady);
  return `<div id="ps-item-form" class="poke-glass rounded-3xl p-4 space-y-3 text-xs">
    <div><p class="text-sm font-black text-white">📦 Pokémon-Artikel inserieren</p>
      <p class="text-[11px] text-slate-300">Alles rund um Pokémon neben Einzelkarten: Booster, Displays, ETBs, Ordner, Sleeves, Plüsch, Lots …</p></div>
    <div id="ps-item-photos" class="space-y-1.5">${photosHtml()}</div>
    <label class="block text-slate-300 font-bold">Titel *</label>
    <input id="ps-item-title" maxlength="120" list="ps-item-ideas" placeholder="z. B. Stürmische Funken Display OVP" class="${inputCls}" />
    <datalist id="ps-item-ideas">${TITLE_IDEAS.map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist>
    <p class="text-slate-300 font-bold">Unterkategorie</p>
    <div id="ps-item-cats" class="flex flex-wrap gap-1.5">${ITEM_CATEGORIES.map((c) => chip(it.category === c.id, `${c.icon} ${esc(c.label)}`, `PS.itemCategory(${jsArg(c.id)})`)).join("")}</div>
    <p class="text-slate-300 font-bold">Zustand</p>
    <div id="ps-item-conds" class="flex flex-wrap gap-1.5">${ITEM_CONDITIONS.map((c) => chip(it.condition === c.id, esc(c.label), `PS.itemCondition(${jsArg(c.id)})`)).join("")}</div>
    <div class="grid grid-cols-2 gap-2">
      <div><label class="block text-slate-300 font-bold mb-1">Preis (€) *</label><input id="ps-item-price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00" class="${inputCls}" /></div>
      <div><label class="block text-slate-300 font-bold mb-1">Ort (PLZ / Stadt)</label><input id="ps-item-city" maxlength="60" value="${esc(state.me?.city || "")}" placeholder="z. B. 50667 Köln" class="${inputCls}" /></div>
    </div>
    <label class="block text-slate-300 font-bold">Versand / Abholung</label>
    <select id="ps-item-delivery" class="${inputCls}">${DELIVERY.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
    <label class="block text-slate-300 font-bold">Kurze Beschreibung</label>
    <textarea id="ps-item-desc" rows="3" maxlength="1000" placeholder="Inhalt, Zustand der Folie, Besonderheiten, Abholzeiten …" class="${inputCls}"></textarea>
    <div class="bg-slate-950 border ${ready ? "border-cyan-500/40" : "border-slate-800"} rounded-2xl p-3 space-y-2">
      <label class="flex gap-2 items-start ${ready ? "" : "opacity-60"}"><input type="checkbox" id="ps-item-buynow" ${ready ? "checked" : "disabled"} class="mt-0.5 accent-cyan-400">
        <span><strong class="text-white">🔒 Sofort-Kauf mit Käuferschutz</strong><span class="block text-[11px] text-slate-400">Bezahlung über Stripe-Treuhand, Auszahlung nach Erhalt – DHL-Etikett direkt aus der App.</span></span></label>
      ${ready ? `<label class="text-slate-300 font-bold">Versandkosten (€)</label><input id="ps-item-ship" type="number" step="0.01" min="0" max="25" value="4.99" class="${inputCls}">`
        : `<button type="button" onclick="PS.openSeller()" class="text-cyan-300 underline font-bold text-[11px]">Verkäuferkonto einrichten, um Sofort-Kauf zu aktivieren →</button>`}
    </div>
    <button type="button" id="ps-item-submit" onclick="PS.submitItemListing()" class="w-full bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 font-black py-3 rounded-xl text-sm shadow-lg min-h-[48px]">📦 Artikel jetzt inserieren</button>
  </div>`;
}

function refreshPart(id, html) { const el = $(id); if (el) el.innerHTML = html; }
function refreshChips() {
  refreshPart("ps-item-cats", ITEM_CATEGORIES.map((c) => chip(it.category === c.id, `${c.icon} ${esc(c.label)}`, `PS.itemCategory(${jsArg(c.id)})`)).join(""));
  refreshPart("ps-item-conds", ITEM_CONDITIONS.map((c) => chip(it.condition === c.id, esc(c.label), `PS.itemCondition(${jsArg(c.id)})`)).join(""));
}

async function addPhotos(e) {
  const files = Array.from(e?.target?.files || []).slice(0, ITEM_MAX_PHOTOS - it.photos.length);
  if (e?.target) e.target.value = "";
  for (const f of files) {
    try { it.photos.push(await compress(f)); } catch (err) { toast("Foto", err.message || "Bild konnte nicht gelesen werden."); }
  }
  refreshPart("ps-item-photos", photosHtml());
}

async function submit() {
  if (!requireLogin() || it.busy) return;
  const title = ($("ps-item-title")?.value || "").trim();
  const price = String($("ps-item-price")?.value || "").replace(",", ".");
  if (title.length < 3) return toast("Titel fehlt", "Bitte einen Titel eintragen (z. B. „Top-Trainer-Box“).");
  if (!(Number(price) >= 0) || price === "") return toast("Preis fehlt", "Bitte einen Preis in € eintragen.");
  if (!it.photos.length && !confirm("Ohne Foto inserieren? Mit Foto verkauft sich ein Artikel deutlich schneller.")) return;
  const delivery = DELIVERY.find(([k]) => k === $("ps-item-delivery")?.value) || DELIVERY[0];
  const city = ($("ps-item-city")?.value || "").trim();
  const buyNow = Boolean($("ps-item-buynow")?.checked && state.me?.sellerReady);
  const shippingCents = buyNow && delivery[0] !== "pickup" ? Math.round((parseFloat(String($("ps-item-ship")?.value || "0").replace(",", ".")) || 0) * 100) : 0;
  it.busy = true;
  const btnEl = $("ps-item-submit");
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "⏳ Wird veröffentlicht …"; }
  try {
    await api("/api/listings", { method: "POST", body: { items: [{
      listingType: "item", title, card: title, price, itemCategory: it.category, itemCondition: it.condition,
      description: $("ps-item-desc")?.value || "", imgs: it.photos, city,
      want: `Verkauf · ${delivery[2]}`, buyNow, shippingCents,
    }] } });
    toast("🚀 Artikel live", `${title} ist jetzt im Marktplatz unter „📦 Pokémon-Artikel“.`);
    it.photos = [];
    await window.PS?.loadListings?.();
    window.PS?.m16Type?.("item");
    window.PS?.marketTab?.("all");
  } catch (e) { handleError(e); }
  finally {
    it.busy = false;
    const b = $("ps-item-submit");
    if (b) { b.disabled = false; b.textContent = "📦 Artikel jetzt inserieren"; }
  }
}

/** Stage-Demo: Foto „hochladen“ (Produkt-Abbildung), Titel und Preis eintragen – Zustand/Kategorie tippt die Aufnahme selbst. */
async function itemDemoFill({ index = 0, step = "photo" } = {}) {
  if (!IS_STAGE) return null;
  const a = DEMO_ITEMS[Math.max(0, Math.min(DEMO_ITEMS.length - 1, Number(index) || 0))];
  if (step === "photo") {
    const png = await demoItemPng(a);
    if (png) it.photos = [png];
    refreshPart("ps-item-photos", photosHtml());
    return $("ps-item-photos");
  }
  const t = $("ps-item-title"), p = $("ps-item-price");
  if (t) t.value = a.title;
  if (p) p.value = String(a.price);
  return t;
}

export const itemListingApi = {
  ...(IS_STAGE ? { itemDemoFill } : {}),
  itemListingFormHtml,
  itemPhotos: (e) => addPhotos(e),
  itemPhotoRemove: (i) => { it.photos.splice(Number(i), 1); refreshPart("ps-item-photos", photosHtml()); },
  itemCategory: (id) => { if (ITEM_CATEGORIES.some((c) => c.id === id)) { it.category = id; refreshChips(); } },
  itemCondition: (id) => { if (ITEM_CONDITIONS.some((c) => c.id === id)) { it.condition = id; refreshChips(); } },
  submitItemListing: () => submit(),
};
