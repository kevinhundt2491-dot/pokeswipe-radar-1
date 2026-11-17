// Phase 7: Direktkauf – Warenkorb über mehrere Verkäufer, Checkout mit Käuferschutz, Händler-Bereich
// (privat/gewerblich, Anbieterangaben) und Bestands-Import (CSV im Cardmarket-/TCGplayer-/freien Format).
import { $, esc, jsArg, eur, toast, cdn, state, api, handleError, requireLogin, modal, closeModalEl, btn, FALLBACK_IMG } from "./core.js";

const cents = (c) => eur((Number(c) || 0) / 100);
const ct = { cart: null, importPoll: null, proposal: null };

// ---------------------------------------------------------------------------
// Warenkorb-Zähler im Kopfbereich
// ---------------------------------------------------------------------------
function setBadge(count) {
  const b = $("ps-cart-count");
  if (!b) return;
  b.textContent = count > 99 ? "99+" : String(count || "");
  b.classList.toggle("hidden", !count);
}
export function injectCartButton() {
  const profileBtn = $("authBtnText")?.closest("button");
  if (!profileBtn || $("ps-cart-btn")) return;
  const b = document.createElement("button");
  b.id = "ps-cart-btn"; b.title = "Warenkorb"; b.setAttribute("aria-label", "Warenkorb");
  b.className = "relative bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs px-2.5 py-1.5 rounded-xl border border-slate-600";
  b.innerHTML = `🛒<span id="ps-cart-count" class="hidden absolute -top-1.5 -right-1.5 bg-cyan-400 text-slate-950 text-[9px] font-black rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center"></span>`;
  b.onclick = () => openCart();
  profileBtn.before(b);
}
export async function refreshCartBadge() {
  if (!state.user) return setBadge(0);
  try { ct.cart = await api("/api/cart"); setBadge(ct.cart.count); } catch {}
}

// ---------------------------------------------------------------------------
// In den Warenkorb
// ---------------------------------------------------------------------------
/** Liefert true bei Erfolg (z. B. für den Kauf-Knopf im Swipe-Radar, der danach zur Kasse führt). */
async function addToCart(listingId, quantity = 1) {
  if (!requireLogin()) return false;
  try {
    ct.cart = await api("/api/cart/items", { method: "POST", body: { listingId: Number(listingId), quantity: Number(quantity) || 1 } });
    setBadge(ct.cart.count);
    toast("🛒 Im Warenkorb", `${ct.cart.count} Artikel • ${cents(ct.cart.totalCents)} inkl. Versand`);
    return true;
  } catch (e) { handleError(e); return false; }
}

const SELLER_BADGE = (t) => t === "business"
  ? `<span class="text-[9px] font-black bg-amber-400 text-slate-950 px-1.5 rounded" title="Gewerblicher Händler – 14 Tage Widerrufsrecht">Gewerblich</span>`
  : `<span class="text-[9px] font-black bg-slate-700 text-slate-100 px-1.5 rounded" title="Privatverkauf – kein gesetzliches Widerrufsrecht">Privat</span>`;

function lineHtml(l, editable = true) {
  const id = Number(l.cartItemId);
  return `<div class="flex gap-2 items-center">
    <img src="${esc(cdn(l.image || FALLBACK_IMG, 100))}" onerror="this.src='${FALLBACK_IMG}'" class="w-9 h-[50px] object-contain rounded" loading="lazy">
    <div class="flex-1 min-w-0 text-[11px]">
      <p class="font-black text-white truncate">${esc(l.title)}</p>
      <p class="text-slate-400">${esc([l.variantLabel, l.conditionLabel, String(l.lang || "").toUpperCase()].filter(Boolean).join(" · "))}${l.unitCents !== l.priceCentsAtAdd ? ` <span class="text-amber-300">• Preis geändert</span>` : ""}</p>
    </div>
    ${editable ? `<select onchange="PS.cartQty(${id}, this.value)" class="bg-slate-900 border border-slate-700 rounded-lg text-xs text-white px-1 py-1" aria-label="Menge">
      ${Array.from({ length: Math.max(1, Math.min(20, Number(l.available) || 1)) }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === Number(l.quantity) ? "selected" : ""}>${n}</option>`).join("")}</select>` : `<span class="text-xs text-slate-300">${Number(l.quantity)}×</span>`}
    <span class="text-xs font-black text-white w-16 text-right">${cents(l.unitCents * l.quantity)}</span>
    <button onclick="PS.cartRemove(${id})" class="text-slate-500 hover:text-rose-300 text-sm" aria-label="Entfernen">✕</button>
  </div>`;
}

async function openCart() {
  if (!requireLogin()) return;
  modal("ps-cart", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Warenkorb …</p>`, { wide: true });
  try { ct.cart = await api("/api/cart"); renderCart(); } catch (e) { closeModalEl("ps-cart"); handleError(e); }
}

function renderCart() {
  const c = ct.cart;
  setBadge(c.count);
  if (!c.groups.length && !c.unavailable.length) {
    modal("ps-cart", `<h3 class="text-base font-black text-white">🛒 Warenkorb</h3>
      <p class="text-xs text-slate-400">Noch leer. Tippe bei Inseraten mit 🔒 Käuferschutz auf „🛒“, um Karten von mehreren Verkäufern zu sammeln und in einer Zahlung zu kaufen.</p>
      ${btn("Zum Marktplatz", "PS.closeCartGoMarket()", "w-full bg-cyan-400 text-slate-950")}`, { wide: true });
    return;
  }
  const hasBusiness = c.groups.some((g) => g.sellerType === "business");
  const hasPrivate = c.groups.some((g) => g.sellerType !== "business");
  modal("ps-cart", `
    <h3 class="text-base font-black text-white">🛒 Warenkorb (${Number(c.count)} Artikel)</h3>
    ${c.groups.map((g) => `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
      <div class="flex flex-wrap items-center gap-2 text-xs"><button onclick="PS.openUser(${jsArg(g.sellerId)})" class="font-black text-yellow-300">${esc(g.sellerName)}</button>${SELLER_BADGE(g.sellerType)}
        ${g.sellerType === "business" ? `<button onclick="PS.sellerInfo(${jsArg(g.sellerId)})" class="text-[10px] underline text-slate-400">Anbieterangaben</button>` : ""}</div>
      ${g.lines.map((l) => lineHtml(l)).join("")}
      <div class="flex justify-between text-[11px] text-slate-300 border-t border-slate-800 pt-1"><span>Versand (eine Sendung)</span><span>${g.shippingCents ? cents(g.shippingCents) : "kostenlos"}</span></div>
    </div>`).join("")}
    ${c.unavailable.length ? `<div class="bg-rose-950/40 border border-rose-500/30 rounded-2xl p-3 space-y-2"><p class="text-xs font-black text-rose-200">Nicht mehr verfügbar</p>${c.unavailable.map((l) => lineHtml(l, false)).join("")}</div>` : ""}
    <div class="bg-slate-950 rounded-2xl p-3 text-xs space-y-1 border border-slate-800">
      <div class="flex justify-between"><span class="text-slate-300">Artikel</span><span class="text-white font-bold">${cents(c.itemsCents)}</span></div>
      <div class="flex justify-between"><span class="text-slate-300">Versand (${c.groups.length} Verkäufer)</span><span class="text-white font-bold">${cents(c.shippingCents)}</span></div>
      <div class="flex justify-between border-t border-slate-800 pt-1"><span class="text-white font-black">Gesamt</span><span class="text-emerald-400 font-black text-sm">${cents(c.totalCents)}</span></div>
      <p class="text-[10px] text-slate-500">Keine Käufergebühr. Eine Zahlung, je Verkäufer eine eigene Bestellung mit Käuferschutz: Das Geld wird erst ausgezahlt, wenn du den Erhalt bestätigst.</p>
    </div>
    ${c.groups.reduce((n, g) => n + g.lines.length, 0) >= 1 ? `<div id="ps-cart-opt" class="bg-slate-900 border border-cyan-500/30 rounded-2xl p-3 space-y-2">
      <div class="flex items-center justify-between gap-2"><p class="text-xs text-slate-200"><b class="text-cyan-300">💡 Günstiger zusammenstellen</b><br><span class="text-[10px] text-slate-400">Sucht dieselben Karten (gleiche Variante und Sprache, Zustand mindestens gleich gut) bei anderen Verkäufern und spart Versand.</span></p>
        ${btn("Prüfen", "PS.cartOptimize()", "bg-cyan-400 text-slate-950 shrink-0")}</div>
      <label class="flex gap-2 text-[11px] text-slate-300"><input type="checkbox" id="ps-opt-same" class="accent-cyan-400"> Nur exakt gleicher Zustand</label>
      <div id="ps-opt-result"></div></div>` : ""}
    <label class="flex gap-2 items-start text-xs text-slate-200"><input type="checkbox" id="ps-cart-terms" class="mt-0.5 accent-cyan-400">
      <span>Ich schließe mit jedem Verkäufer einen eigenen, verbindlichen Kaufvertrag.${hasBusiness ? ` Bei <b>gewerblichen Händlern</b> habe ich ${Number(c.withdrawalDays)} Tage Widerrufsrecht ab Erhalt (<a href="/rechtliches#widerruf" target="_blank" rel="noopener" class="underline">Belehrung</a>).` : ""}${hasPrivate ? " Bei <b>Privatverkäufen</b> besteht kein gesetzliches Widerrufsrecht und in der Regel keine Gewährleistung." : ""} Es gelten die <a href="/rechtliches#agb" target="_blank" rel="noopener" class="underline font-bold">AGB</a> (<a href="/datenschutz#marktplatz" target="_blank" rel="noopener" class="underline">Datenschutz</a>).</span></label>
    <p id="ps-cart-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
    ${c.groups.length ? btn(`Zahlungspflichtig bestellen (${cents(c.totalCents)})`, "PS.cartCheckout()", "w-full bg-cyan-400 text-slate-950") : ""}`, { wide: true });
}

// ---------------------------------------------------------------------------
// Phase 8: Warenkorb-Optimierer
// ---------------------------------------------------------------------------
async function cartOptimize() {
  const box = $("ps-opt-result");
  if (!box) return;
  const sameCondition = Boolean($("ps-opt-same")?.checked);
  box.innerHTML = `<p class="text-[11px] text-yellow-300">⏳ Vergleiche Angebote …</p>`;
  try {
    const p = await api("/api/cart/optimize", { method: "POST", body: { sameCondition } });
    ct.proposal = { ...p, sameCondition };
    box.innerHTML = proposalHtml(p);
  } catch (e) { box.innerHTML = ""; handleError(e); }
}

function proposalHtml(p) {
  if (!p.possible) return `<p class="text-[11px] text-emerald-300">✅ Dein Warenkorb ist bereits die günstigste Zusammenstellung.</p>`;
  return `<div class="space-y-1 text-[11px]">
    <p class="text-white">Spare <b class="text-emerald-400">${cents(p.savingsCents)}</b>: ${cents(p.currentCents)} → <b>${cents(p.optimizedCents)}</b> inkl. Versand
      <span class="text-slate-400">(${Number(p.sellersBefore)} → ${Number(p.sellersAfter)} Verkäufer, Versand ${cents(p.currentShippingCents)} → ${cents(p.optimizedShippingCents)})</span></p>
    ${p.changes.map((ch) => `<div class="bg-slate-950 rounded-xl p-2 border border-slate-800">
      <p class="font-bold text-white truncate">${esc(ch.title)} <span class="text-slate-400">${Number(ch.quantity)}×</span></p>
      <p class="text-slate-400 line-through">${esc(ch.from.seller)} · ${esc(ch.from.conditionLabel)} · ${cents(ch.from.unitCents)}</p>
      ${ch.to.map((t) => `<p class="text-emerald-300">→ ${esc(t.seller)} · ${esc(t.conditionLabel)} · ${Number(t.quantity)}× ${cents(t.unitCents)}</p>`).join("")}
    </div>`).join("")}
    ${btn(`Vorschlag übernehmen (−${cents(p.savingsCents)})`, "PS.cartOptimizeApply()", "w-full bg-emerald-500 text-slate-950")}
  </div>`;
}

async function cartOptimizeApply() {
  const p = ct.proposal;
  if (!p?.possible) return;
  try {
    const r = await api("/api/cart/optimize/apply", { method: "POST", body: { expectedTotalCents: p.optimizedCents, sameCondition: p.sameCondition } });
    ct.cart = r.cart; ct.proposal = null;
    renderCart();
    toast("💡 Warenkorb optimiert", `Du sparst ${cents(r.savingsCents)}.`);
  } catch (e) {
    const d = e?.data || {};
    if (d.proposal) { ct.proposal = { ...d.proposal, sameCondition: p.sameCondition }; const box = $("ps-opt-result"); if (box) box.innerHTML = `<p class="text-[11px] text-amber-300">${esc(e.message)}</p>${proposalHtml(d.proposal)}`; return; }
    handleError(e);
  }
}

async function cartQty(id, qty) {
  try { ct.cart = await api(`/api/cart/items/${Number(id)}`, { method: "PATCH", body: { quantity: Number(qty) } }); renderCart(); } catch (e) { handleError(e); openCart(); }
}
async function cartRemove(id) {
  try { ct.cart = await api(`/api/cart/items/${Number(id)}`, { method: "DELETE" }); renderCart(); } catch (e) { handleError(e); }
}

async function cartCheckout(acceptPriceChanges = false) {
  const msg = $("ps-cart-msg");
  if (!$("ps-cart-terms")?.checked) { if (msg) msg.textContent = "Bitte bestätige die Kaufbedingungen."; return; }
  try {
    const r = await api("/api/checkout/connect/session", { method: "POST", body: { acceptTerms: true, acceptPriceChanges } });
    if (r.url) location.href = r.url;
  } catch (e) {
    const d = e?.data || {};
    if (d.cart) { ct.cart = d.cart; renderCart(); const m = $("ps-cart-msg"); if (m) m.textContent = e.message; return; }
    handleError(e);
  }
}

async function sellerInfo(id) {
  try {
    const s = await api(`/api/marketplace/sellers/${encodeURIComponent(id)}`);
    const b = s.business || {};
    modal("ps-seller-info", `<h3 class="text-base font-black text-white">🏪 Anbieterangaben</h3>
      <div class="text-xs text-slate-200 space-y-1"><p class="font-black">${esc(b.name || s.name)}</p><p>${esc(b.address || "")}</p>
      ${b.email ? `<p>E-Mail: ${esc(b.email)}</p>` : ""}${b.phone ? `<p>Telefon: ${esc(b.phone)}</p>` : ""}${b.vatId ? `<p>USt-IdNr.: ${esc(b.vatId)}</p>` : ""}${b.register ? `<p>${esc(b.register)}</p>` : ""}</div>
      <p class="text-[10px] text-slate-500">Gewerblicher Händler: Für Verbraucher gilt ein 14-tägiges Widerrufsrecht ab Erhalt der Ware. Vertragspartner ist der Händler, nicht PokeSwipe.</p>`);
  } catch (e) { handleError(e); }
}

/** Rückkehr von Stripe nach dem Warenkorb-Checkout */
export async function routeCart() {
  const q = new URLSearchParams(location.search);
  const clean = () => history.replaceState(null, "", location.pathname);
  if (q.get("cart") === "paid" && q.get("session_id")) {
    if (!state.user) return;
    try {
      const r = await api("/api/checkout/connect/confirm", { method: "POST", body: { sessionId: q.get("session_id") } });
      toast("✅ Bezahlt – Käuferschutz aktiv", r.refunded ? `${r.refunded} Teilbestellung(en) waren nicht mehr verfügbar und werden erstattet.` : "Die Verkäufer wurden benachrichtigt und versenden jetzt.");
    } catch (e) { handleError(e); }
    clean(); refreshCartBadge(); window.PS?.openOrders?.(); window.PS?.loadListings?.();
  } else if (q.get("cart") === "1") {
    clean();
    if (!state.user) return;
    // Checkout abgebrochen: offene Reservierung sofort freigeben
    try { const { open } = await api("/api/checkout/connect/open"); for (const o of open) await api(`/api/checkout/connect/${Number(o.id)}/cancel`, { method: "POST", body: {} }); } catch {}
    openCart();
  } else if (q.get("buy")) {
    // Link von der öffentlichen Kartenseite: Inserat in den Warenkorb
    const id = Number(q.get("buy"));
    clean();
    if (id && requireLogin()) { await addToCart(id); openCart(); }
  } else if (q.get("seller-hub") === "1") { clean(); if (state.user) openSellerHub(); }
}

// ---------------------------------------------------------------------------
// Händler-Bereich: Verkäufertyp & Anbieterangaben, Bestands-Import
// ---------------------------------------------------------------------------
async function openSellerHub() {
  if (!requireLogin()) return;
  modal("ps-seller-hub", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Händler-Bereich …</p>`, { wide: true });
  try {
    const [p, { imports }] = await Promise.all([api("/api/seller/profile"), api("/api/seller/imports")]);
    const biz = p.sellerType === "business";
    const inp = (id, label, val, ph = "") => `<label class="text-[11px] text-slate-300 font-bold">${label}</label><input id="${id}" value="${esc(val || "")}" placeholder="${esc(ph)}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">`;
    modal("ps-seller-hub", `
      <h3 class="text-base font-black text-white">🏪 Händler-Bereich</h3>
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
        <p class="text-sm font-black text-white">Verkäufertyp</p>
        <div class="flex gap-3 text-xs text-slate-200"><label><input type="radio" name="ps-st" value="private" ${biz ? "" : "checked"} onchange="PS.sellerTypeToggle()"> Privatperson</label>
          <label><input type="radio" name="ps-st" value="business" ${biz ? "checked" : ""} onchange="PS.sellerTypeToggle()"> Gewerblicher Händler</label></div>
        <p class="text-[10px] text-slate-500">Wer regelmäßig mit Gewinnabsicht verkauft, handelt gewerblich und muss sich so kennzeichnen. Käufer sehen den Typ vor dem Kauf; bei gewerblichen Händlern gilt für Verbraucher ein 14-tägiges Widerrufsrecht.</p>
        <div id="ps-biz" class="space-y-1 ${biz ? "" : "hidden"}">
          ${inp("ps-biz-name", "Name / Firma", p.businessName)}${inp("ps-biz-addr", "Anschrift", p.businessAddress, "Straße Nr., PLZ Ort, Land")}
          ${inp("ps-biz-mail", "Geschäftliche E-Mail", p.businessEmail)}${inp("ps-biz-phone", "Telefon (optional)", p.businessPhone)}
          ${inp("ps-biz-vat", "USt-IdNr. (falls vorhanden)", p.businessVatId, "DE123456789")}${inp("ps-biz-reg", "Handelsregister (falls vorhanden)", p.businessRegister, "HRB 12345, AG Köln")}
        </div>
        <p id="ps-biz-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
        ${btn("Speichern", "PS.sellerSaveProfile()", "w-full bg-emerald-500 text-slate-950")}
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
        <p class="text-sm font-black text-white">📦 Bestands-Import (CSV)</p>
        <p class="text-[11px] text-slate-400">Cardmarket-Bestandsexport, TCGplayer-Export oder eigene CSV (Spalten z. B. Name, Nummer, Set, Zustand, Sprache, Menge, Preis). Bis 5 MB bzw. 50.000 Zeilen. Ein erneuter Import derselben Artikel aktualisiert Preis und Menge.</p>
        <input id="ps-imp-file" type="file" accept=".csv,.txt,text/csv" class="w-full text-xs text-slate-300">
        <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
          <label>Preis<select id="ps-imp-mode" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white"><option value="file">aus der Datei</option><option value="trend">Marktpreis × Faktor</option></select></label>
          <label>Faktor<input id="ps-imp-factor" value="1,00" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white"></label>
          <label>Mindestpreis (€)<input id="ps-imp-min" value="0,10" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white"></label>
          <label>Versand je Bestellung (€)<input id="ps-imp-ship" value="1,60" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white"></label>
          <label>Sprache ohne Angabe<select id="ps-imp-lang" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white"><option value="de">Deutsch</option><option value="en">Englisch</option><option value="ja">Japanisch</option></select></label>
          <label>Ort<input id="ps-imp-city" value="${esc(state.me?.city || "")}" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white"></label>
        </div>
        <label class="flex gap-2 text-xs text-slate-200"><input type="checkbox" id="ps-imp-buy" checked class="accent-cyan-400"> Als Sofort-Kauf mit Käuferschutz anbieten${state.me?.sellerReady ? "" : ` <span class="text-amber-300">(erst nach Einrichtung des Verkäuferkontos)</span>`}</label>
        <label class="flex gap-2 text-xs text-slate-200"><input type="checkbox" id="ps-imp-sync" class="accent-cyan-400"> Sync-Modus: frühere CSV-Inserate, die nicht mehr in der Datei stehen, entfernen</label>
        <p id="ps-imp-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
        ${btn("Import starten", "PS.sellerImportStart()", "w-full bg-cyan-400 text-slate-950")}
      </div>
      <div class="space-y-2"><p class="text-sm font-black text-white">Letzte Importe</p><div id="ps-imp-list">${importsHtml(imports)}</div></div>
      <div id="ps-ship-acc" class="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2"><p class="text-[11px] text-slate-400">⏳ Lade DHL-Versand …</p></div>`, { wide: true });
    loadShipAccount();
    pollImports(imports);
  } catch (e) { closeModalEl("ps-seller-hub"); handleError(e); }
}

// ---------------------------------------------------------------------------
// Phase 8: DHL-Versandetiketten – eigene Geschäftskunden-Zugangsdaten des Händlers
// ---------------------------------------------------------------------------
async function loadShipAccount() {
  const el = $("ps-ship-acc");
  if (!el) return;
  try {
    const [{ enabled, account: a }, meta] = await Promise.all([api("/api/seller/shipping-account"), api("/api/shipping/meta")]);
    const inp = (id, label, val, ph = "", type = "text") => `<label class="text-[11px] text-slate-300 font-bold">${label}<input id="${id}" type="${type}" value="${esc(val ?? "")}" placeholder="${esc(ph)}" autocomplete="off" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-normal"></label>`;
    const status = !a.configured ? "" : a.verifiedAt
      ? `<p class="text-[11px] text-emerald-300">✅ Von DHL bestätigt${a.sandbox ? " (Testumgebung)" : ""}</p>`
      : `<p class="text-[11px] text-amber-300">⚠️ Noch nicht bestätigt${a.lastError ? `: ${esc(a.lastError)}` : ""}</p>`;
    el.innerHTML = `
      <p class="text-sm font-black text-white">📮 DHL-Versandetiketten</p>
      <p class="text-[11px] text-slate-400">Mit deinem eigenen DHL-Geschäftskundenvertrag erstellst du Etiketten direkt aus der Bestellung. Die Sendungsnummer wird automatisch eingetragen, abgerechnet wird über deinen DHL-Vertrag. Dein Passwort wird verschlüsselt gespeichert.</p>
      ${enabled ? "" : `<p class="text-[11px] text-amber-300">Die DHL-Anbindung ist auf der Plattform noch nicht freigeschaltet. Du kannst deine Daten schon hinterlegen.</p>`}
      ${status}
      <div class="grid grid-cols-2 gap-2">
        ${inp("ps-ship-user", "Benutzername (Geschäftskundenportal)", a.username)}
        ${inp("ps-ship-pass", a.configured ? "Passwort (leer = unverändert)" : "Passwort", "", "", "password")}
        ${inp("ps-ship-ekp", "EKP (10-stellige Kundennummer)", a.ekp, "1234567890")}
        <label class="text-[11px] text-slate-300 font-bold">Standard-Produkt<select id="ps-ship-prod" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-normal">
          ${meta.products.filter((p) => !p.international).map((p) => `<option value="${esc(p.code)}" ${a.defaultProduct === p.code ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label>
        ${inp("ps-ship-weight", "Standardgewicht (g)", a.defaultWeightG ?? 500)}
        ${inp("ps-ship-part", "Teilnahme (meist 01)", Object.values(a.participation || {})[0] || "01")}
        ${inp("ps-ship-name", "Absender: Name / Firma", a.senderName ?? (state.me?.displayName || ""))}
        ${inp("ps-ship-mail", "Absender: E-Mail (optional)", a.senderEmail)}
        ${inp("ps-ship-street", "Straße", a.senderStreet)}${inp("ps-ship-house", "Hausnummer", a.senderHouse)}
        ${inp("ps-ship-zip", "PLZ", a.senderZip)}${inp("ps-ship-city", "Ort", a.senderCity ?? (state.me?.city || ""))}
      </div>
      <label class="flex gap-2 text-xs text-slate-200"><input type="checkbox" id="ps-ship-sandbox" ${a.sandbox ? "checked" : ""} class="accent-cyan-400"> DHL-Testumgebung (Sandbox) – Etiketten sind nicht gültig</label>
      <p id="ps-ship-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
      <div class="flex gap-2">${btn(a.configured ? "Speichern & prüfen" : "Verbinden", "PS.shipAccountSave()", "flex-1 bg-emerald-500 text-slate-950")}
        ${a.configured ? btn("Erneut prüfen", "PS.shipAccountVerify()", "bg-slate-700 text-white") + btn("Entfernen", "PS.shipAccountDelete()", "bg-rose-900 text-rose-100") : ""}</div>`;
  } catch (e) { el.innerHTML = `<p class="text-[11px] text-rose-300">${esc(e.message || "DHL-Versand konnte nicht geladen werden.")}</p>`; }
}

async function shipAccountSave() {
  const v = (id) => $(id)?.value?.trim() || "";
  const part = v("ps-ship-part") || "01";
  const body = {
    username: v("ps-ship-user"), password: $("ps-ship-pass")?.value || "", ekp: v("ps-ship-ekp").replace(/\s/g, ""),
    participation: { V62KP: part, V01PAK: part, V53WPAK: part, V66WPI: part }, sandbox: Boolean($("ps-ship-sandbox")?.checked),
    senderName: v("ps-ship-name"), senderEmail: v("ps-ship-mail"), senderStreet: v("ps-ship-street"), senderHouse: v("ps-ship-house"),
    senderZip: v("ps-ship-zip"), senderCity: v("ps-ship-city"), senderCountry: "DEU", defaultProduct: v("ps-ship-prod"), defaultWeightG: Number(v("ps-ship-weight")) || 500,
  };
  const msg = $("ps-ship-msg");
  if (msg) msg.textContent = "⏳ Speichere und prüfe bei DHL …";
  try {
    const r = await api("/api/seller/shipping-account", { method: "PUT", body });
    toast(r.verified ? "✅ DHL verbunden" : "💾 Gespeichert", r.verified ? "Du kannst jetzt Etiketten aus deinen Bestellungen erstellen." : r.verifyError);
    loadShipAccount();
  } catch (e) { if (msg) msg.textContent = e.message || "Speichern fehlgeschlagen."; }
}
async function shipAccountVerify() {
  try { const r = await api("/api/seller/shipping-account/verify", { method: "POST", body: {} }); toast(r.verified ? "✅ DHL bestätigt" : "⚠️ DHL-Prüfung", r.verified ? "Zugangsdaten sind gültig." : r.error); loadShipAccount(); }
  catch (e) { handleError(e); }
}
async function shipAccountDelete() {
  if (!confirm("DHL-Zugangsdaten wirklich entfernen?")) return;
  try { await api("/api/seller/shipping-account", { method: "DELETE" }); toast("🗑️ Entfernt", "Deine DHL-Zugangsdaten wurden gelöscht."); loadShipAccount(); }
  catch (e) { handleError(e); }
}

const IMP_STATUS = { queued: "⏳ Wartet", running: "⚙️ Läuft", done: "✅ Fertig", failed: "❌ Fehlgeschlagen" };
function importsHtml(list) {
  if (!list?.length) return `<p class="text-xs text-slate-500">Noch keine Importe.</p>`;
  return list.map((i) => {
    const pct = i.totalRows ? Math.min(100, Math.round((i.processedRows / i.totalRows) * 100)) : 0;
    return `<div class="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-[11px] space-y-1">
      <p class="text-white font-bold">${esc(i.filename || `Import #${Number(i.id)}`)} <span class="text-slate-400">• ${esc(i.format)} • ${new Date(i.createdAt).toLocaleString("de-DE")}</span></p>
      <p class="text-slate-300">${IMP_STATUS[i.status] || esc(i.status)} • ${Number(i.processedRows)}/${Number(i.totalRows)} Zeilen • ${Number(i.createdRows)} neu • ${Number(i.updatedRows)} aktualisiert • <span class="${i.reviewRows ? "text-amber-300" : ""}">${Number(i.reviewRows)} zu prüfen</span> • ${Number(i.errorRows)} Fehler</p>
      ${["queued", "running"].includes(i.status) ? `<div class="h-1.5 bg-slate-800 rounded"><div class="h-1.5 bg-cyan-400 rounded" style="width:${pct}%"></div></div>` : ""}
      ${i.message ? `<p class="text-slate-400">${esc(i.message)}</p>` : ""}
      <div class="flex flex-wrap gap-1.5">${i.reviewRows ? btn("Prüfen", `PS.sellerImportReview(${Number(i.id)})`, "bg-amber-400 text-slate-950") : ""}${i.errorRows ? btn("Fehler ansehen", `PS.sellerImportErrors(${Number(i.id)})`, "bg-slate-800 text-rose-300") : ""}
        ${["queued", "running", "failed"].includes(i.status) ? btn("Neu anstoßen", `PS.sellerImportRetry(${Number(i.id)})`, "bg-slate-800 text-slate-200") : ""}</div>
    </div>`;
  }).join("");
}
function pollImports(list) {
  clearTimeout(ct.importPoll);
  if (!list?.some((i) => ["queued", "running"].includes(i.status))) return;
  ct.importPoll = setTimeout(async () => {
    if (!$("ps-imp-list")) return;
    try { const { imports } = await api("/api/seller/imports"); const el = $("ps-imp-list"); if (el) el.innerHTML = importsHtml(imports); pollImports(imports); if (!imports.some((i) => ["queued", "running"].includes(i.status))) window.PS?.loadListings?.(); } catch {}
  }, 3000);
}

function sellerTypeToggle() {
  const biz = document.querySelector('input[name="ps-st"]:checked')?.value === "business";
  $("ps-biz")?.classList.toggle("hidden", !biz);
}
async function sellerSaveProfile() {
  const v = (id) => $(id)?.value || "";
  const body = { sellerType: document.querySelector('input[name="ps-st"]:checked')?.value || "private", businessName: v("ps-biz-name"), businessAddress: v("ps-biz-addr"),
    businessEmail: v("ps-biz-mail"), businessPhone: v("ps-biz-phone"), businessVatId: v("ps-biz-vat"), businessRegister: v("ps-biz-reg") };
  try { await api("/api/seller/profile", { method: "PUT", body }); toast("✅ Gespeichert", body.sellerType === "business" ? "Käufer sehen dich ab jetzt als gewerblichen Händler." : "Du verkaufst als Privatperson."); const m = $("ps-biz-msg"); if (m) m.textContent = ""; }
  catch (e) { const m = $("ps-biz-msg"); if (m) m.textContent = e.message || "Speichern fehlgeschlagen."; }
}

async function sellerImportStart() {
  const msg = $("ps-imp-msg");
  const f = $("ps-imp-file")?.files?.[0];
  if (!f) { if (msg) msg.textContent = "Bitte eine CSV-Datei auswählen."; return; }
  if (f.size > 5 * 1024 * 1024) { if (msg) msg.textContent = "Die Datei ist größer als 5 MB – bitte aufteilen."; return; }
  const csv = await f.text();
  const options = { priceMode: $("ps-imp-mode").value, factor: $("ps-imp-factor").value, minPrice: $("ps-imp-min").value, shipping: $("ps-imp-ship").value,
    defaultLang: $("ps-imp-lang").value, city: $("ps-imp-city").value, buyNow: Boolean($("ps-imp-buy")?.checked), removeMissing: Boolean($("ps-imp-sync")?.checked) };
  if (options.removeMissing && !confirm("Sync-Modus: Frühere CSV-Inserate, die nicht in dieser Datei stehen, werden entfernt. Fortfahren?")) return;
  if (msg) msg.textContent = "";
  try {
    const r = await api("/api/seller/import", { method: "POST", body: { filename: f.name, csv, options } });
    toast("📦 Import gestartet", `${Number(r.preview?.rows || 0)} Zeilen erkannt (${r.preview?.format}) – die Verarbeitung läuft im Hintergrund.`);
    openSellerHub();
  } catch (e) { if (msg) msg.textContent = e.message || "Import fehlgeschlagen."; }
}

async function sellerImportReview(id) {
  try {
    const { rows } = await api(`/api/seller/import/${Number(id)}/rows?status=review&limit=50`);
    modal("ps-imp-review", `<h3 class="text-base font-black text-white">🔎 Zuordnung prüfen</h3>
      <p class="text-[11px] text-slate-400">Für diese Zeilen gab es keine eindeutige Karte. Wähle die richtige oder überspringe die Zeile.</p>
      ${rows.length ? rows.map((r) => `<div id="ps-imp-row-${Number(r.id)}" class="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-[11px] space-y-1.5">
        <p class="text-white font-bold">Zeile ${Number(r.rowNo)}: ${esc(r.raw?.name || "")} ${esc(r.raw?.number || "")} <span class="text-slate-400">${esc(r.raw?.setName || r.raw?.setCode || "")} • ${esc(String(r.raw?.lang || "").toUpperCase())}</span></p>
        <p class="text-slate-400">${esc(r.message)}</p>
        <div class="flex flex-wrap gap-1.5">${(r.candidates || []).map((cd, i) => `<button onclick="PS.sellerImportResolve(${Number(id)}, ${Number(r.id)}, ${i})" class="flex gap-1.5 items-center bg-slate-800 rounded-lg px-2 py-1 text-left">
          <img src="${esc(cdn(cd.image || FALLBACK_IMG, 60))}" onerror="this.src='${FALLBACK_IMG}'" class="w-6 h-8 object-contain"><span>${esc(cd.name)}<br><span class="text-slate-400">${esc(cd.setName)} ${esc(cd.number)}${cd.marketEur ? ` • ${eur(cd.marketEur)}` : ""}</span></span></button>`).join("")}
          <button onclick="PS.sellerImportSkip(${Number(id)}, ${Number(r.id)})" class="bg-slate-800 text-slate-400 rounded-lg px-2 py-1">Überspringen</button></div></div>`).join("") : `<p class="text-xs text-slate-500">Alles erledigt.</p>`}`, { wide: true });
  } catch (e) { handleError(e); }
}
async function resolveRow(id, rowId, body) {
  try { await api(`/api/seller/import/${Number(id)}/resolve`, { method: "POST", body: { rowId: Number(rowId), ...body } }); $(`ps-imp-row-${Number(rowId)}`)?.remove(); }
  catch (e) { handleError(e); }
}
async function sellerImportErrors(id) {
  try {
    const { rows } = await api(`/api/seller/import/${Number(id)}/rows?status=error&limit=200`);
    modal("ps-imp-review", `<h3 class="text-base font-black text-white">⚠️ Fehlerhafte Zeilen</h3>
      <div class="space-y-1 text-[11px] max-h-96 overflow-y-auto">${rows.map((r) => `<p class="text-slate-300"><b class="text-white">Zeile ${Number(r.rowNo)}</b>: ${esc(r.message)}</p>`).join("") || `<p class="text-slate-500">Keine Fehler.</p>`}</div>`, { wide: true });
  } catch (e) { handleError(e); }
}
async function sellerImportRetry(id) {
  try { await api(`/api/seller/import/${Number(id)}/retry`, { method: "POST", body: {} }); toast("⚙️ Neu angestoßen", ""); openSellerHub(); } catch (e) { handleError(e); }
}

export const cartApi = {
  openCart, addToCart: (id, q) => addToCart(id, q), cartQty, cartRemove, cartCheckout: () => cartCheckout(false), sellerInfo,
  cartOptimize, cartOptimizeApply, shipAccountSave, shipAccountVerify, shipAccountDelete,
  closeCartGoMarket: () => { closeModalEl("ps-cart"); window.PS?.goMarket?.(); },
  openSellerHub, sellerTypeToggle, sellerSaveProfile, sellerImportStart, sellerImportReview, sellerImportErrors, sellerImportRetry,
  sellerImportResolve: (id, rowId, i) => resolveRow(id, rowId, { candidate: Number(i) }),
  sellerImportSkip: (id, rowId) => resolveRow(id, rowId, { skip: true }),
};
