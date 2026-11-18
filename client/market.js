// Phase 4: P2P-Marktplatz mit Käuferschutz (Treuhand über Stripe Connect)
// Verkäuferkonto einrichten, Sofort-Kauf & verbindliche Preisangebote, Bestellungen (Versand, Erhalt, Reklamation,
// Bewertung) und die Admin-Ansicht für Reklamationen.
import { $, esc, jsArg, safeUrl, eur, toast, cdn, state, api, bearer, handleError, requireLogin, modal, closeModalEl, btn, FALLBACK_IMG } from "./core.js";
import { variantSelect, variantsOf, variantBadge, VARIANT_KEYS } from "./variants.js";

const mk = { meta: null, orders: [], seller: null };
const cents = (c) => eur((Number(c) || 0) / 100);
const STATUS = {
  offered: ["💰 Angebot offen", "bg-amber-500/20 text-amber-200"], awaiting_payment: ["⏳ Wartet auf Zahlung", "bg-amber-500/20 text-amber-200"],
  paid: ["💶 Bezahlt – Versand ausstehend", "bg-cyan-500/20 text-cyan-200"], shipped: ["📦 Versendet", "bg-cyan-500/20 text-cyan-200"],
  disputed: ["⚠️ Reklamation", "bg-rose-500/20 text-rose-200"], releasing: ["⏳ Auszahlung läuft", "bg-slate-700 text-slate-100"],
  released: ["✅ Abgeschlossen", "bg-emerald-500/20 text-emerald-200"], refunded: ["↩️ Erstattet", "bg-slate-700 text-slate-200"],
  cancelled: ["🚫 Abgebrochen", "bg-slate-800 text-slate-400"], declined: ["❌ Abgelehnt", "bg-slate-800 text-slate-400"],
  chargeback: ["🧊 Rückbuchung – eingefroren", "bg-rose-600/30 text-rose-100"], chargeback_lost: ["⛔ Rückbuchung verloren", "bg-rose-700/40 text-rose-100"],
  withdrawn: ["↩️ Widerrufen – Rücksendung", "bg-amber-500/20 text-amber-200"],
};

async function meta() {
  if (!mk.meta) { try { mk.meta = await api("/api/market/meta"); } catch { mk.meta = { conditions: {}, carriers: {}, feeBps: { free: 650, premium: 500, pro: 300 }, autoReleaseDays: 14, shipWindowDays: 7, payWindowHours: 48, enabled: false }; } }
  return mk.meta;
}
const pctBps = (b) => `${(Number(b) / 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;

// ---------------------------------------------------------------------------
// Verkäuferkonto (Stripe Connect Express)
// ---------------------------------------------------------------------------
async function openSeller() {
  if (!requireLogin()) return;
  modal("ps-seller", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Verkäuferkonto …</p>`);
  try {
    const [s, m] = await Promise.all([api("/api/connect/status"), meta()]);
    mk.seller = s;
    const fee = s.fee || { bps: 650, allBps: m.feeBps };
    const feeTable = `<div class="grid grid-cols-3 gap-2 text-center text-[11px]">${[["free", "Free"], ["premium", "Premium"], ["pro", "Pro-Pass"]].map(([k, l]) =>
      `<div class="rounded-xl p-2 ${fee.allBps?.[k] === fee.bps ? "bg-yellow-400 text-slate-950" : "bg-slate-950 text-slate-300"}"><p class="font-black">${pctBps(fee.allBps?.[k] ?? 0)}</p><p>${l}</p></div>`).join("")}</div>`;
    modal("ps-seller", `
      <h3 class="text-base font-black text-white">🔒 Verkaufen mit Käuferschutz</h3>
      <ul class="text-xs text-slate-200 space-y-1 bg-slate-950 border border-slate-800 rounded-2xl p-3">
        <li>• Käufer bezahlen sicher über Stripe (Karte, Apple Pay, Google Pay, Klarna, SEPA …).</li>
        <li>• Das Geld liegt in der Treuhand, bis der Käufer den Erhalt bestätigt – bei DHL-Sendungen wird automatisch erst ${Number(m.releaseAfterDeliveryDays) || 3} Tage nach der DHL-Zustellung ausgezahlt (mit Etikett aus der App wird die Bestellung automatisch „versendet“), bei anderen Versandarten ${m.autoReleaseDays} Tage nach Versand.</li>
        <li>• Die Lieferadresse siehst du erst nach erfolgreicher Zahlung. Bitte innerhalb von ${m.shipWindowDays} Tagen versichert versenden.</li>
        <li>• Provision je Tarif (nur bei Verkauf, mindestens 0,49 €):</li>
      </ul>
      ${feeTable}
      ${psttgBox(s.psttg)}
      ${s.connected ? `<div class="grid grid-cols-3 gap-2 text-center text-[11px]">${[
        ["Angaben", s.detailsSubmitted], ["Zahlungen", s.chargesEnabled || s.ready], ["Auszahlungen", s.payoutsEnabled],
      ].map(([l, ok]) => `<div class="rounded-xl p-2 ${ok ? "bg-emerald-500/15 text-emerald-200" : "bg-slate-950 text-slate-400"}"><p class="font-black">${ok ? "✅" : "⏳"}</p><p>${l}</p></div>`).join("")}</div>` : ""}
      ${!s.enabled ? `<p class="text-xs text-amber-300">Zahlungen sind auf dieser Seite noch nicht eingerichtet.</p>`
        : s.ready ? `<p class="text-sm font-black text-emerald-300">✅ Dein Verkäuferkonto ist verifiziert. Beim Inserieren kannst du „Sofort-Kauf mit Käuferschutz“ aktivieren.</p>
            ${btn("📊 Auszahlungen & Kontodaten (Stripe)", "PS.sellerDashboard()", "w-full bg-slate-800 text-white")}
            ${btn("🧾 Steuerdaten (DAC7)", "PS.openTaxInfo()", "w-full bg-slate-800 text-cyan-200")}`
        : `${s.connected ? `<p class="text-xs text-amber-300">⏳ Die Verifizierung ist noch nicht abgeschlossen${s.requirements?.length ? ` (fehlt: ${esc(s.requirements.slice(0, 4).join(", "))})` : ""}.</p>` : ""}
            ${s.error ? `<p class="text-xs text-rose-300">${esc(s.error)}</p>` : ""}
            ${s.termsAccepted ? "" : `<label class="flex gap-2 items-start text-xs text-slate-200"><input type="checkbox" id="ps-sel-terms" class="mt-0.5 accent-yellow-400"><span>Ich verkaufe als Privatperson oder gebe meine gewerbliche Tätigkeit bei Stripe an, beschreibe Karten wahrheitsgemäß (Zustand, Echtheit), versende innerhalb von ${m.shipWindowDays} Tagen mit Sendungsnummer und akzeptiere die <a href="/rechtliches#agb" target="_blank" rel="noopener" class="underline font-bold">AGB</a> inkl. Provision. Die Identitätsprüfung übernimmt Stripe (<a href="/datenschutz#marktplatz" target="_blank" rel="noopener" class="underline">Datenschutz</a>).</span></label>`}
            <p id="ps-sel-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
            ${btn(s.connected ? "Verifizierung fortsetzen" : "Verkäuferkonto einrichten (ca. 5 Minuten)", "PS.sellerOnboard()", "w-full bg-yellow-400 text-slate-950")}`}`);
  } catch (e) { closeModalEl("ps-seller"); handleError(e); }
}

// ---------------------------------------------------------------------------
// Phase 10: PStTG-Hinweis (ab 25 Verkäufen / 1.700 € Vorwarnung, ab 30 Verkäufen / mehr als 2.000 € meldepflichtig)
// ---------------------------------------------------------------------------
function psttgText(n) {
  if (!n || n.taxInfoComplete) return "";
  const stats = `${Number(n.transactions)} Verkäufe, ${cents(n.netCents)} Umsatz ${Number(n.year)}`;
  return n.stage === "reporting"
    ? `<strong>Meldepflicht nach PStTG erreicht</strong> (${stats}). Bitte hinterlege Steuer-ID, Geburtsdatum und Anschrift – sonst werden neue Verkäufe mit Käuferschutz gesperrt.`
    : `<strong>Bald meldepflichtig</strong> (${stats}). Ab ${Number(n.report.transactions)} Verkäufen oder ${cents(n.report.grossCents)} im Jahr müssen wir dich an das Bundeszentralamt für Steuern melden. Hinterlege jetzt Steuer-ID und Anschrift.`;
}
function psttgBox(n) {
  const t = psttgText(n);
  if (!t) return "";
  const red = n.stage === "reporting";
  return `<div class="${red ? "bg-rose-500/15 border-rose-400/40 text-rose-100" : "bg-amber-500/15 border-amber-400/40 text-amber-100"} border rounded-2xl px-3 py-2 text-xs space-y-2">
    <p>🧾 ${t}</p><button type="button" onclick="PS.openTaxInfo()" class="${red ? "bg-rose-400" : "bg-amber-400"} text-slate-950 font-black px-3 py-1.5 rounded-xl">Steuerdaten hinterlegen</button></div>`;
}
/** Banner unter dem Kopfbereich – erscheint nur bei Verkäufern ab der Vorwarnschwelle ohne vollständige Steuerdaten. */
export function renderPsttgBanner() {
  const n = state.me?.psttg;
  const key = n ? `ps-psttg-hide-${n.year}-${n.stage}` : "";
  let el = $("ps-psttg-banner");
  if (!n || n.taxInfoComplete || sessionStorage.getItem(key)) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "ps-psttg-banner";
    el.className = "relative z-30 max-w-7xl w-full mx-auto px-3 sm:px-6 mt-2";
    document.querySelector("header")?.after(el);
  }
  const red = n.stage === "reporting";
  el.innerHTML = `<div class="${red ? "bg-rose-500/15 border-rose-400/40" : "bg-amber-500/15 border-amber-400/40"} border rounded-2xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs" role="status">
    <p class="${red ? "text-rose-100" : "text-amber-100"}">🧾 ${psttgText(n)}</p>
    <div class="flex gap-1.5">
      <button type="button" onclick="PS.openTaxInfo()" class="${red ? "bg-rose-400" : "bg-amber-400"} text-slate-950 font-black px-3 py-1.5 rounded-xl">Steuerdaten hinterlegen</button>
      ${red ? "" : `<button type="button" onclick="sessionStorage.setItem('${key}','1');document.getElementById('ps-psttg-banner')?.remove()" class="text-amber-200 font-bold px-2" aria-label="Hinweis ausblenden">✕</button>`}
    </div></div>`;
}

async function sellerOnboard() {
  const box = $("ps-sel-terms");
  if (box && !box.checked) { const m = $("ps-sel-msg"); if (m) m.textContent = "Bitte bestätige die Bedingungen."; return; }
  try {
    const r = await api("/api/connect/onboard", { method: "POST", body: { acceptTerms: true } });
    location.href = r.url;
  } catch (e) { handleError(e); }
}
async function sellerDashboard() {
  try { const r = await api("/api/connect/dashboard-link", { method: "POST", body: {} }); window.open(r.url, "_blank", "noopener"); } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Inserat-Formular: Sofort-Kauf, Versandkosten, Zustand
// ---------------------------------------------------------------------------
export function listingFormExtras(variantsField = "") {
  const ready = Boolean(state.me?.sellerReady);
  const conds = { mint: "Mint", nm: "Near Mint", ex: "Excellent", gd: "Good", lp: "Light Played", pl: "Played", po: "Poor", graded: "Gegradet (Slab)", sealed: "Sealed / OVP" };
  return `<label class="text-slate-300 font-bold">Variante</label>${variantSelect("ps-li-variant", variantsOf(variantsField))}
    <label class="text-slate-300 font-bold">Sprache der Karte</label>
    <select id="ps-li-lang" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"><option value="de">🇩🇪 Deutsch</option><option value="en">🇬🇧 Englisch</option><option value="ja">🇯🇵 Japanisch</option></select>
    <label class="text-slate-300 font-bold">Zustand</label>
    <select id="ps-li-cond" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"><option value="">– bitte wählen –</option>${Object.entries(conds).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
    <div class="bg-slate-950 border ${ready ? "border-cyan-500/40" : "border-slate-800"} rounded-2xl p-3 space-y-2">
      <label class="flex gap-2 items-start ${ready ? "" : "opacity-60"}"><input type="checkbox" id="ps-li-buynow" ${ready ? "checked" : "disabled"} class="mt-0.5 accent-cyan-400">
        <span><strong class="text-white">🔒 Sofort-Kauf mit Käuferschutz</strong><span class="block text-[11px] text-slate-400">Käufer bezahlen direkt in der App, Auszahlung nach Erhalt. Mehr Vertrauen = schnellerer Verkauf.</span></span></label>
      ${ready ? `<label class="text-slate-300 font-bold">Versandkosten (€)</label><input id="ps-li-ship" type="number" step="0.01" min="0" max="25" value="1.95" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">`
        : `<button type="button" onclick="PS.openSeller()" class="text-cyan-300 underline font-bold text-[11px]">Verkäuferkonto einrichten, um Sofort-Kauf zu aktivieren →</button>`}
    </div>`;
}
export function listingFormValues() {
  const buyNow = Boolean($("ps-li-buynow")?.checked && state.me?.sellerReady);
  const lang = ["de", "en", "ja"].includes($("ps-li-lang")?.value) ? $("ps-li-lang").value : "de";
  const variant = VARIANT_KEYS.includes($("ps-li-variant")?.value) ? $("ps-li-variant").value : "normal";
  return { condition: $("ps-li-cond")?.value || "", lang, variant, buyNow, shippingCents: buyNow ? Math.round((parseFloat(String($("ps-li-ship")?.value || "0").replace(",", ".")) || 0) * 100) : 0 };
}

/** Kauf-Buttons im Inserat (nur fremde Inserate mit verifiziertem Verkäufer) */
export function listingBuyHtml(l) {
  const own = l.user_id === state.user?.id;
  if (!l.buy_now) return "";
  if (own) return `<span class="text-[10px] font-black bg-cyan-500/20 text-cyan-200 px-2 py-1 rounded-lg self-center">🔒 Sofort-Kauf aktiv</span>`;
  return `<button onclick="PS.openBuy(${Number(l.id)})" class="bg-cyan-400 text-slate-950 font-black px-3 py-1.5 rounded-xl" title="Kauf mit Käuferschutz">🔒 Kaufen</button>
    <button onclick="PS.addToCart(${Number(l.id)})" class="bg-slate-800 text-cyan-200 font-bold px-2.5 py-1.5 rounded-xl" title="In den Warenkorb (mehrere Karten, eine Zahlung)" aria-label="In den Warenkorb">🛒</button>
    <button onclick="PS.openOffer(${Number(l.id)})" class="bg-slate-800 text-cyan-200 font-bold px-2.5 py-1.5 rounded-xl">💰 Angebot</button>`;
}
export function listingMetaHtml(l) {
  const conds = { mint: "Mint", nm: "NM", ex: "EX", gd: "GD", lp: "LP", pl: "PL", po: "PO", graded: "Slab", sealed: "OVP" };
  return `${variantBadge(l.variant)}${l.condition ? `<span class="text-[9px] font-black bg-slate-700 text-slate-100 px-1.5 rounded">${esc(conds[l.condition] || l.condition)}</span>` : ""}${l.buy_now ? `<span class="text-[9px] font-black bg-cyan-400 text-slate-950 px-1.5 rounded" title="Bezahlung über Treuhand, Auszahlung erst nach Erhalt">🔒 Käuferschutz</span>` : ""}`;
}

const buyerConsent = (m) => `<label class="flex gap-2 items-start text-xs text-slate-200"><input type="checkbox" id="ps-buy-terms" class="mt-0.5 accent-cyan-400">
  <span>Ich schließe einen verbindlichen Kaufvertrag mit dem Verkäufer (in der Regel Privatperson – dann ohne Widerrufsrecht und Gewährleistung). PokeSwipe verwahrt die Zahlung treuhänderisch: Bestätige ich den Erhalt nicht und melde kein Problem, wird bei DHL ${Number(m.releaseAfterDeliveryDays) || 3} Tage nach der bestätigten Zustellung, sonst ${m.autoReleaseDays} Tage nach Versand ausgezahlt. Es gelten die <a href="/rechtliches#agb" target="_blank" rel="noopener" class="underline font-bold">AGB</a> (<a href="/datenschutz#marktplatz" target="_blank" rel="noopener" class="underline">Datenschutz</a>).</span></label>
  <p id="ps-buy-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>`;

async function openBuy(listingId) {
  if (!requireLogin()) return;
  const l = state.listings.find((x) => x.id === listingId);
  if (!l) return toast("Inserat", "Nicht mehr verfügbar.");
  const m = await meta();
  const ship = Number(l.shipping_cents) || 0, price = Math.round(Number(l.price) * 100);
  modal("ps-buy", `
    <h3 class="text-base font-black text-white">🔒 Kaufen mit Käuferschutz</h3>
    <div class="flex gap-3 items-center"><img src="${esc(cdn(l.image || FALLBACK_IMG, 160))}" class="w-16 h-[88px] object-contain rounded" onerror="this.src='${FALLBACK_IMG}'">
      <div class="text-xs"><p class="font-black text-white text-sm">${esc(l.card_name)}</p><p class="text-slate-400">von ${esc(l.seller)} • 📍 ${esc(l.city)}</p></div></div>
    <div class="bg-slate-950 rounded-2xl p-3 text-xs space-y-1 border border-slate-800">
      <div class="flex justify-between"><span class="text-slate-300">Preis</span><span class="text-white font-bold">${cents(price)}</span></div>
      <div class="flex justify-between"><span class="text-slate-300">Versand</span><span class="text-white font-bold">${ship ? cents(ship) : "kostenlos"}</span></div>
      <div class="flex justify-between border-t border-slate-800 pt-1"><span class="text-white font-black">Gesamt</span><span class="text-emerald-400 font-black text-sm">${cents(price + ship)}</span></div>
      <p class="text-[10px] text-slate-500">Keine Käufergebühr. Lieferadresse gibst du sicher bei Stripe ein – der Verkäufer sieht sie erst nach der Zahlung.</p>
    </div>
    ${buyerConsent(m)}
    ${btn("Weiter zur sicheren Zahlung", `PS.buyNow(${Number(l.id)})`, "w-full bg-cyan-400 text-slate-950")}
    <button onclick="PS.openOffer(${Number(l.id)})" class="w-full text-cyan-300 text-xs underline">Lieber einen Preis vorschlagen</button>`);
}

async function buyNow(listingId, offerCents) {
  if (!$("ps-buy-terms")?.checked) { const msg = $("ps-buy-msg"); if (msg) msg.textContent = "Bitte bestätige die Kaufbedingungen."; return; }
  try {
    const r = await api("/api/orders", { method: "POST", body: { listingId, acceptTerms: true, offerCents, message: $("ps-off-msg")?.value || "" } });
    if (r.url) { location.href = r.url; return; }
    closeModalEl("ps-buy");
    toast("💰 Angebot gesendet", "Der Verkäufer hat 72 Stunden Zeit zu antworten. Nimmt er an, kannst du direkt bezahlen.");
    openOrders();
  } catch (e) { handleError(e); }
}

async function openOffer(listingId) {
  if (!requireLogin()) return;
  const l = state.listings.find((x) => x.id === listingId);
  if (!l) return toast("Inserat", "Nicht mehr verfügbar.");
  const m = await meta();
  const price = Number(l.price);
  modal("ps-buy", `
    <h3 class="text-base font-black text-white">💰 Verbindliches Preisangebot</h3>
    <p class="text-xs text-slate-300"><strong class="text-white">${esc(l.card_name)}</strong> – Inserat ${eur(price)}${Number(l.shipping_cents) ? ` + ${cents(l.shipping_cents)} Versand` : ""}. Nimmt ${esc(l.seller)} an, hast du ${m.payWindowHours} Stunden Zeit zum Bezahlen.</p>
    <label class="text-xs text-slate-300 font-bold">Dein Angebot (€, mind. ${eur(Math.ceil(price * 50) / 100)})</label>
    <input id="ps-off-amt" type="number" step="0.01" min="${(Math.ceil(price * 50) / 100).toFixed(2)}" max="${price.toFixed(2)}" value="${(Math.round(price * 90) / 100).toFixed(2)}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white font-black">
    <textarea id="ps-off-msg" maxlength="400" rows="2" placeholder="Nachricht an den Verkäufer (optional)" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"></textarea>
    ${buyerConsent(m)}
    ${btn("Angebot verbindlich abgeben", `PS.sendOffer(${Number(l.id)})`, "w-full bg-cyan-400 text-slate-950")}`);
}
function sendOffer(listingId) {
  const amt = Math.round((parseFloat(String($("ps-off-amt")?.value || "").replace(",", ".")) || 0) * 100);
  if (!amt) { const msg = $("ps-buy-msg"); if (msg) msg.textContent = "Bitte einen Betrag eingeben."; return; }
  return buyNow(listingId, amt);
}

// ---------------------------------------------------------------------------
// Bestellungen
// ---------------------------------------------------------------------------
async function openOrders() {
  if (!requireLogin()) return;
  modal("ps-orders", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Käufe & Verkäufe …</p>`, { wide: true });
  try {
    const [{ orders }, m] = await Promise.all([api("/api/orders"), meta()]);
    mk.orders = orders;
    const section = (title, list) => `<h4 class="text-sm font-black text-white">${title} (${list.length})</h4>
      <div class="space-y-2">${list.length ? list.map((o) => orderCard(o, m)).join("") : `<p class="text-xs text-slate-500">Noch nichts hier.</p>`}</div>`;
    modal("ps-orders", `
      <div class="flex flex-wrap justify-between items-center gap-2"><h3 class="text-base font-black text-white">🛒 Käufe & Verkäufe</h3>
      ${btn(state.me?.sellerReady ? "🔒 Verkäuferkonto" : "🔒 Verkäufer werden", "PS.openSeller()", "bg-slate-800 text-cyan-200")}</div>
      ${section("🛍️ Meine Käufe", orders.filter((o) => o.role === "buyer"))}
      ${section("💼 Meine Verkäufe", orders.filter((o) => o.role === "seller"))}
      <p class="text-[10px] text-slate-500">Käuferschutz: Zahlung liegt in der Treuhand, bis der Käufer den Erhalt bestätigt (automatisch bei DHL ${Number(m.releaseAfterDeliveryDays) || 3} Tage nach Zustellung, sonst ${m.autoReleaseDays} Tage nach Versand). Nicht versendet nach ${m.shipWindowDays} Tagen → automatische Erstattung. Bei Problemen „Reklamation“ wählen – unser Team entscheidet.</p>`, { wide: true });
  } catch (e) { closeModalEl("ps-orders"); handleError(e); }
}

function orderCard(o, m) {
  const st = STATUS[o.status] || [o.status, "bg-slate-800 text-slate-300"];
  const isB = o.role === "buyer", isS = o.role === "seller";
  const id = Number(o.id);
  const a = (action, label, cls) => btn(label, `PS.orderAction(${id}, '${action}')`, cls);
  const acts = [];
  if (isS && o.status === "offered") acts.push(a("accept", "✅ Annehmen", "bg-emerald-500 text-slate-950"), a("decline", "Ablehnen", "bg-slate-800 text-slate-300"));
  if (isB && o.status === "awaiting_payment" && !o.checkoutId) acts.push(btn(`💳 Jetzt bezahlen (${cents(o.totalCents)})`, `PS.payOrder(${id})`, "bg-cyan-400 text-slate-950"));
  if (isB && o.canWithdraw) acts.push(btn("↩️ Widerrufen", `PS.withdrawOrder(${id})`, "bg-slate-800 text-amber-200"));
  if (isS && o.status === "withdrawn") acts.push(a("accept_return", "Rücksendung erhalten – erstatten", "bg-emerald-500 text-slate-950"));
  if (!o.checkoutId && ((isB && ["offered", "awaiting_payment"].includes(o.status)) || (isS && o.status === "awaiting_payment"))) acts.push(a("cancel", "Abbrechen", "bg-slate-800 text-slate-300"));
  if (isS && o.status === "paid") acts.push(btn("📦 Versand eintragen / DHL-Etikett", `PS.shipOrder(${id})`, "bg-yellow-400 text-slate-950"), a("refund", "Stornieren & erstatten", "bg-slate-800 text-rose-300"));
  if (isS && o.status === "shipped" && o.labelShipped && !["transit", "delivered"].includes(o.trackingStatus)) acts.push(btn("📮 Etikett verwalten", `PS.shipOrder(${id})`, "bg-slate-800 text-cyan-200"));
  if (isB && ["paid", "shipped"].includes(o.status)) acts.push(a("confirm", "✅ Erhalten – Geld freigeben", "bg-emerald-500 text-slate-950"), a("dispute", "⚠️ Problem melden", "bg-slate-800 text-rose-300"));
  if (o.status === "released" && !o.reviewed) acts.push(btn("⭐ Bewerten", `PS.reviewOrder(${id})`, "bg-amber-400 text-slate-950"));
  const other = isB ? o.seller : o.buyer;
  const addr = o.address;
  return `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-xs space-y-2">
    <div class="flex gap-3 items-start">
      <img src="${esc(cdn(o.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" class="w-11 h-[60px] object-contain rounded" loading="lazy">
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap gap-1.5 items-center"><span class="text-[10px] font-black px-2 py-0.5 rounded-full ${st[1]}">${st[0]}</span><span class="text-slate-500">#${id} • ${new Date(o.createdAt).toLocaleDateString("de-DE")}</span></div>
        <p class="font-black text-white truncate mt-0.5">${esc(o.title)}</p>
        <p class="text-slate-300">${cents(o.priceCents)}${o.shippingCents ? ` + ${cents(o.shippingCents)} Versand` : ""} • ${isB ? "Verkäufer" : "Käufer"}: <button onclick="PS.openUser(${jsArg(other.id)})" class="font-bold text-yellow-300">${esc(other.name)}</button></p>
        ${isS && o.payoutCents !== undefined ? `<p class="text-[11px] text-slate-400">Auszahlung an dich: <strong class="text-emerald-300">${cents(o.payoutCents)}</strong> (Provision ${cents(o.feeCents)})</p>` : ""}
        ${o.message ? `<p class="text-[11px] text-slate-400">„${esc(o.message)}“</p>` : ""}
        ${o.status === "awaiting_payment" && o.payBy ? `<p class="text-[11px] text-amber-300">Zahlung bis ${new Date(o.payBy).toLocaleString("de-DE")}</p>` : ""}
        ${o.trackingNumber ? `<p class="text-[11px] text-slate-300">📦 ${esc(o.carrierLabel)} ${safeUrl(o.trackingUrl) ? `<a href="${esc(safeUrl(o.trackingUrl))}" target="_blank" rel="noopener" class="underline text-cyan-300">${esc(o.trackingNumber)}</a>` : esc(o.trackingNumber)}${o.releaseAfter && o.status === "shipped" && (!o.trackable || o.deliveredAt) ? ` • automatische Auszahlung am ${new Date(o.releaseAfter).toLocaleDateString("de-DE")}` : ""}</p>` : ""}
        ${o.trackingNumber && o.trackingStatusLabel && ["shipped", "released"].includes(o.status) ? `<p class="text-[11px] ${o.trackingStatus === "delivered" ? "text-emerald-300" : o.trackingStatus === "failure" ? "text-rose-300" : "text-cyan-200"}">🛰️ DHL-Status: ${esc(o.trackingStatusLabel)}${o.deliveredAt ? ` am ${new Date(o.deliveredAt).toLocaleDateString("de-DE")}` : ""}${o.status === "shipped" && o.trackable && !o.deliveredAt ? " • Auszahlung erst nach Zustellung" : ""}</p>` : ""}
        ${o.releaseReview && o.status === "shipped" ? `<p class="text-[11px] text-amber-300">🔎 Auszahlung in Prüfung: noch kein Versandnachweis von DHL.</p>` : ""}
        ${o.disputeReason ? `<p class="text-[11px] text-rose-300">⚠️ ${esc(o.disputeReason)}</p>` : ""}
        <p class="text-[10px] text-slate-400">${o.sellerType === "business" ? `🏪 Gewerblicher Händler${o.sellerBusiness?.name ? `: ${esc(o.sellerBusiness.name)}, ${esc(o.sellerBusiness.address)}` : ""}${o.withdrawalUntil && ["shipped", "released"].includes(o.status) ? ` • Widerruf bis ${new Date(o.withdrawalUntil).toLocaleDateString("de-DE")}` : ""}` : "Privatverkauf (kein gesetzliches Widerrufsrecht)"}</p>
        ${o.status === "withdrawn" ? `<p class="text-[11px] text-amber-200">↩️ Widerrufen ${o.withdrawnAt ? `am ${new Date(o.withdrawnAt).toLocaleDateString("de-DE")}` : ""}${o.returnTracking ? ` • Rücksendung ${esc(o.returnTracking)}` : ""}${o.withdrawalNote ? ` • „${esc(o.withdrawalNote)}“` : ""}</p>` : ""}
        ${o.items?.length > 1 || (o.items?.length === 1 && o.items[0].quantity > 1) ? `<ul class="text-[11px] text-slate-300 list-disc pl-4">${o.items.map((i) => `<li>${Number(i.quantity)}× ${esc(i.title)}${i.condition ? ` (${esc(String(i.condition).toUpperCase())})` : ""} – ${cents(i.unitCents * i.quantity)}</li>`).join("")}</ul>` : ""}
      </div>
    </div>
    ${addr ? `<div class="bg-slate-950 border border-cyan-500/30 rounded-xl p-2.5 text-[11px] text-slate-200"><p class="font-black text-cyan-200 mb-0.5">📮 Lieferadresse (nur für dich sichtbar)</p>
      <p>${esc(addr.name || "")}<br>${esc(addr.line1 || "")}${addr.line2 ? `<br>${esc(addr.line2)}` : ""}<br>${esc(addr.postal_code || "")} ${esc(addr.city || "")}<br>${esc(addr.country || "")}</p></div>` : ""}
    ${acts.length ? `<div class="flex flex-wrap gap-1.5">${acts.join("")}</div>` : ""}
  </div>`;
}

async function orderAction(id, action) {
  const body = { action };
  if (action === "confirm" && !confirm("Hast du die Karte erhalten und ist sie wie beschrieben? Danach wird das Geld an den Verkäufer ausgezahlt – das lässt sich nicht rückgängig machen.")) return;
  if (action === "refund" && !confirm("Verkauf stornieren? Der Käufer bekommt den vollen Betrag zurück.")) return;
  if (action === "cancel" && !confirm("Bestellung abbrechen?")) return;
  if (action === "dispute") {
    const reason = prompt("Was ist das Problem? (z. B. nicht angekommen, falsche Karte, Zustand schlechter als beschrieben, Fälschung)");
    if (!reason || reason.trim().length < 10) return toast("Reklamation", "Bitte beschreibe das Problem mit mindestens 10 Zeichen.");
    body.reason = reason;
  }
  try { await api(`/api/orders/${id}/action`, { method: "POST", body }); toast("✅ Erledigt", ""); openOrders(); window.PS?.loadListings?.(); }
  catch (e) { handleError(e); }
}

async function withdrawOrder(id) {
  const o = mk.orders.find((x) => x.id === id);
  if (!confirm(`Kauf „${o?.title || ""}“ widerrufen? Du sendest die Ware an den Händler zurück; nach Eingang wird dir der volle Betrag erstattet.`)) return;
  const reason = prompt("Optional: Grund oder Hinweis für den Händler") || "";
  const returnTracking = prompt("Optional: Sendungsnummer der Rücksendung (kannst du auch später per Nachricht nennen)") || "";
  try { await api(`/api/orders/${Number(id)}/action`, { method: "POST", body: { action: "withdraw", reason, returnTracking } }); toast("↩️ Widerruf erklärt", "Bitte sende die Ware an die Anschrift des Händlers zurück."); openOrders(); }
  catch (e) { handleError(e); }
}

async function payOrder(id) {
  const m = await meta();
  const o = mk.orders.find((x) => x.id === id);
  modal("ps-buy", `<h3 class="text-base font-black text-white">💳 Bezahlen: ${esc(o?.title || "")}</h3>
    <p class="text-sm font-black text-emerald-400">${cents(o?.totalCents)}</p>
    ${buyerConsent(m)}
    ${btn("Weiter zur sicheren Zahlung", `PS.payOrderGo(${id})`, "w-full bg-cyan-400 text-slate-950")}`);
}
async function payOrderGo(id) {
  if (!$("ps-buy-terms")?.checked) { const msg = $("ps-buy-msg"); if (msg) msg.textContent = "Bitte bestätige die Kaufbedingungen."; return; }
  try { const r = await api(`/api/orders/${id}/pay`, { method: "POST", body: { acceptTerms: true } }); location.href = r.url; } catch (e) { handleError(e); }
}

async function shipOrder(id) {
  const m = await meta();
  modal("ps-ship", `<h3 class="text-base font-black text-white">📦 Versand eintragen</h3>
    <div id="ps-label-box" class="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2"><p class="text-[11px] text-slate-400">⏳ Prüfe DHL-Etiketten …</p></div>
    <p class="text-xs text-slate-300">Tipp: Karten im Toploader + Teambag, versichert als Paket oder Einschreiben versenden.</p>
    <select id="ps-ship-carrier" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white">${Object.entries(m.carriers || {}).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select>
    <input id="ps-ship-nr" maxlength="40" placeholder="Sendungsnummer" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white">
    ${btn("Als versendet markieren", `PS.shipOrderGo(${id})`, "w-full bg-yellow-400 text-slate-950")}`);
  renderLabelBox(id);
}

// ---------------------------------------------------------------------------
// Phase 8: DHL-Versandetikett direkt aus der Bestellung (eigene DHL-Zugangsdaten des Händlers)
// ---------------------------------------------------------------------------
async function renderLabelBox(id) {
  const box = $("ps-label-box");
  if (!box) return;
  try {
    const [meta, { account }, { labels }] = await Promise.all([api("/api/shipping/meta"), api("/api/seller/shipping-account"), api(`/api/orders/${id}/labels`)]);
    const active = labels.find((l) => l.status === "created");
    if (active) fillTracking(active.shipmentNo);
    if (!meta.enabled) { box.innerHTML = `<p class="text-[11px] text-slate-400">📮 DHL-Etiketten sind auf der Plattform noch nicht freigeschaltet.</p>`; return; }
    if (!account.configured) {
      box.innerHTML = `<p class="text-[11px] text-slate-300">📮 <b>DHL-Etikett mit einem Klick:</b> Hinterlege einmalig deine DHL-Geschäftskunden-Zugangsdaten im Händler-Bereich.</p>
        ${btn("Zum Händler-Bereich", "PS.closeShipOpenSellerHub()", "w-full bg-slate-700 text-white")}`;
      return;
    }
    const opts = meta.products.map((p) => `<option value="${esc(p.code)}">${esc(p.label)}</option>`).join("");
    box.innerHTML = `<p class="text-sm font-black text-white">📮 DHL-Etikett${account.sandbox ? ` <span class="text-[10px] text-amber-300">(Testumgebung)</span>` : ""}</p>
      ${active ? `<p class="text-[11px] text-emerald-300">✅ Etikett ${esc(active.productLabel)} · ${esc(active.shipmentNo)} · ${Number(active.weightG)} g</p>
        <div class="flex gap-2">${btn("🖨️ PDF herunterladen", `PS.labelPdf(${jsArg(active.pdfUrl)}, ${jsArg(active.shipmentNo)})`, "flex-1 bg-cyan-400 text-slate-950")}
          ${btn("Stornieren", `PS.cancelLabel(${Number(id)}, ${Number(active.id)})`, "bg-slate-700 text-rose-200")}</div>` : ""}
      <div class="grid grid-cols-3 gap-2 text-[11px] text-slate-300">
        <label class="col-span-2">Produkt<select id="ps-lbl-prod" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white"><option value="">Automatisch (nach Ziel & Gewicht)</option>${opts}</select></label>
        <label>Gewicht (g)<input id="ps-lbl-w" type="number" min="10" max="31500" value="${Number(account.defaultWeightG) || 500}" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white"></label>
        <label class="col-span-3">Format<select id="ps-lbl-fmt" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white">${meta.printFormats.map((f) => `<option value="${esc(f)}">${f === "A4" ? "A4 (Drucker)" : esc(f) + " (Etikettendrucker)"}</option>`).join("")}</select></label>
      </div>
      <p id="ps-lbl-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
      ${btn(active ? "Neues Etikett erstellen (altes wird storniert)" : "Etikett erstellen (über deinen DHL-Vertrag)", `PS.createLabel(${Number(id)}, ${active ? "true" : "false"})`, "w-full bg-emerald-500 text-slate-950")}`;
  } catch (e) { box.innerHTML = `<p class="text-[11px] text-rose-300">${esc(e.message || "DHL-Etiketten nicht verfügbar.")}</p>`; }
}

function fillTracking(no) {
  const sel = $("ps-ship-carrier"), nr = $("ps-ship-nr");
  if (sel && [...sel.options].some((o) => o.value === "dhl")) sel.value = "dhl";
  if (nr && !nr.value) nr.value = no;
}

async function createLabel(id, replace = false) {
  const msg = $("ps-lbl-msg");
  if (msg) msg.textContent = "⏳ DHL erstellt das Etikett …";
  try {
    const r = await api(`/api/orders/${Number(id)}/label`, { method: "POST", body: {
      product: $("ps-lbl-prod")?.value || "", weightG: Number($("ps-lbl-w")?.value) || 500, printFormat: $("ps-lbl-fmt")?.value || "A4", replace,
    } });
    const nr = $("ps-ship-nr"); if (nr) nr.value = "";
    fillTracking(r.trackingNumber);
    labelPdf(r.label.pdfUrl, r.trackingNumber);
    if (r.autoShipped) {
      // Treuhand-Härtung: Etikett erzeugt → Bestellung ist automatisch „versendet“, der Käufer wurde benachrichtigt
      toast("📦 Etikett erstellt & versendet", `Sendungsnummer ${r.trackingNumber}${r.sandbox ? " (Testumgebung)" : ""}. Die Bestellung ist jetzt als versendet markiert – die Auszahlung startet nach der DHL-Zustellung.`);
      closeModalEl("ps-ship");
      openOrders();
      return;
    }
    toast("📮 Etikett erstellt", `Sendungsnummer ${r.trackingNumber}${r.sandbox ? " (Testumgebung)" : ""}.`);
    renderLabelBox(id);
  } catch (e) { if (msg) msg.textContent = e.message || "Etikett konnte nicht erstellt werden."; }
}

/** Etikett-PDF mit Anmeldung laden und als Datei speichern (der Download-Link braucht das Login-Token). */
async function labelPdf(url, shipmentNo) {
  try {
    const token = bearer();
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "same-origin" });
    if (!res.ok) throw new Error("Etikett konnte nicht geladen werden.");
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = href; a.download = `DHL-${String(shipmentNo || "Etikett").replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch (e) { handleError(e); }
}

async function cancelLabel(id, labelId) {
  if (!confirm("Etikett bei DHL stornieren? Bereits eingelieferte Sendungen lassen sich nicht stornieren.")) return;
  try {
    const r = await api(`/api/orders/${Number(id)}/label/${Number(labelId)}`, { method: "DELETE" });
    const nr = $("ps-ship-nr"); if (nr) nr.value = "";
    toast("🗑️ Storniert", r?.orderStatus === "paid" ? "Das Etikett wurde storniert – die Bestellung ist wieder „bezahlt, noch nicht versendet“." : "Das Etikett wurde bei DHL storniert.");
    renderLabelBox(id);
  } catch (e) { handleError(e); }
}

async function shipOrderGo(id) {
  try {
    await api(`/api/orders/${id}/action`, { method: "POST", body: { action: "ship", carrier: $("ps-ship-carrier").value, trackingNumber: $("ps-ship-nr").value } });
    closeModalEl("ps-ship"); toast("📦 Versendet", "Der Käufer wurde benachrichtigt."); openOrders();
  } catch (e) { handleError(e); }
}

function reviewOrder(id) {
  modal("ps-ship", `<h3 class="text-base font-black text-white">⭐ Kauf bewerten</h3>
    <div class="flex gap-1 text-2xl" id="ps-ro-stars">${[1, 2, 3, 4, 5].map((n) => `<button onclick="PS.orderStars(${n})" data-n="${n}" class="text-slate-600">★</button>`).join("")}</div>
    <textarea id="ps-ro-c" maxlength="500" rows="2" placeholder="Kommentar (optional)" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"></textarea>
    ${btn("Bewertung senden", `PS.sendOrderReview(${id})`, "w-full bg-amber-400 text-slate-950")}`);
  mk.stars = 0;
}
function orderStars(n) {
  mk.stars = n;
  document.querySelectorAll("#ps-ro-stars button").forEach((b) => { b.className = Number(b.dataset.n) <= n ? "text-yellow-400" : "text-slate-600"; });
}
async function sendOrderReview(id) {
  if (!mk.stars) return toast("⭐", "Bitte Sterne wählen.");
  try { await api(`/api/orders/${id}/review`, { method: "POST", body: { stars: mk.stars, comment: $("ps-ro-c").value } }); closeModalEl("ps-ship"); toast("⭐ Danke!", "Deine Bewertung ist gespeichert."); openOrders(); }
  catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Admin: Reklamationen & Treuhand
// ---------------------------------------------------------------------------
async function openMarketAdmin(status = "") {
  modal("ps-market-admin", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Marktplatz …</p>`, { wide: true });
  try {
    const d = await api(`/api/admin/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    const tile = (l, v, cls = "text-white") => `<div class="bg-slate-950 rounded-xl p-2 text-center"><p class="text-[10px] uppercase font-bold text-slate-400">${l}</p><p class="font-black ${cls}">${v}</p></div>`;
    modal("ps-market-admin", `
      <h3 class="text-base font-black text-white">⚖️ Marktplatz & Reklamationen</h3>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        ${tile("Reklamationen", Number(d.stats?.disputed) || 0, "text-rose-300")}${tile("In Treuhand", Number(d.stats?.in_escrow) || 0)}
        ${tile("Treuhand-Summe", cents(d.stats?.escrow_cents))}${tile("Umsatz Monat (GMV)", cents(d.stats?.gmv_month_cents))}${tile("Provision Monat", cents(d.stats?.fees_month_cents), "text-emerald-400")}
      </div>
      <div class="flex flex-wrap gap-1.5 text-xs">${[["", "Offen"], ["disputed", "Reklamationen"], ["released", "Abgeschlossen"], ["refunded", "Erstattet"]].map(([k, l]) => btn(l, `PS.openMarketAdmin('${k}')`, status === k ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-white")).join("")}
        ${btn("⏱️ Fristen jetzt prüfen", "PS.runEscrow()", "bg-slate-800 text-white")}</div>
      <div class="space-y-2 max-h-[28rem] overflow-y-auto">${d.orders.length ? d.orders.map((o) => `<div class="bg-slate-900 border ${o.status === "disputed" ? "border-rose-500/50" : "border-slate-800"} rounded-2xl p-3 text-xs space-y-1">
        <p><span class="text-[10px] font-black px-2 py-0.5 rounded-full ${(STATUS[o.status] || ["", "bg-slate-800"])[1]}">${(STATUS[o.status] || [o.status])[0]}</span> <strong class="text-white">#${Number(o.id)} ${esc(o.title)}</strong></p>
        <p class="text-slate-300">${cents(o.totalCents)} • Käufer ${esc(o.buyer.name)} → Verkäufer ${esc(o.seller.name)} • Provision ${cents(o.feeCents)}</p>
        ${o.trackingNumber ? `<p class="text-slate-400">📦 ${esc(o.carrierLabel)} ${safeUrl(o.trackingUrl) ? `<a href="${esc(safeUrl(o.trackingUrl))}" target="_blank" rel="noopener" class="underline">${esc(o.trackingNumber)}</a>` : esc(o.trackingNumber)} • versendet ${o.shippedAt ? new Date(o.shippedAt).toLocaleDateString("de-DE") : "–"}</p>` : ""}
        ${o.disputeReason ? `<p class="text-rose-300">⚠️ ${esc(o.disputeReason)}</p>` : ""}
        ${["paid", "shipped", "disputed"].includes(o.status) ? `<div class="flex flex-wrap gap-1.5">${btn("↩️ Käufer erstatten", `PS.resolveOrder(${Number(o.id)}, 'refund')`, "bg-rose-500/30 text-rose-200")}${btn("💸 An Verkäufer auszahlen", `PS.resolveOrder(${Number(o.id)}, 'release')`, "bg-emerald-500/30 text-emerald-200")}</div>` : ""}
      </div>`).join("") : `<p class="text-xs text-slate-500">Keine Bestellungen in dieser Ansicht.</p>`}</div>`, { wide: true });
  } catch (e) { closeModalEl("ps-market-admin"); handleError(e); }
}
async function resolveOrder(id, action) {
  if (!confirm(action === "refund" ? "Dem Käufer den vollen Betrag erstatten?" : "Betrag an den Verkäufer auszahlen?")) return;
  const note = prompt("Notiz an beide Parteien (optional):") || "";
  try { await api(`/api/admin/orders/${id}/resolve`, { method: "POST", body: { action, note } }); toast("✅ Entschieden", ""); openMarketAdmin("disputed"); } catch (e) { handleError(e); }
}

export const marketApi = {
  openSeller, sellerOnboard, sellerDashboard, openBuy, buyNow: (id) => buyNow(id), openOffer, sendOffer,
  openOrders, orderAction, withdrawOrder, payOrder, payOrderGo, shipOrder, shipOrderGo, createLabel, cancelLabel, labelPdf,
  closeShipOpenSellerHub: () => { closeModalEl("ps-ship"); window.PS?.openSellerHub?.(); }, reviewOrder, orderStars, sendOrderReview,
  openMarketAdmin, resolveOrder,
  runEscrow: async () => { try { const r = await api("/api/admin/escrow/run", { method: "POST", body: {} }); toast("⏱️ Fristen geprüft", `${r.released} ausgezahlt, ${r.refunded} erstattet, ${r.expired} verfallen.`); openMarketAdmin(); } catch (e) { handleError(e); } },
};

/** Rückkehr von Stripe (Zahlung / Verkäufer-Verifizierung) und Links aus Mitteilungen */
export async function routeMarket() {
  const q = new URLSearchParams(location.search);
  const clean = () => history.replaceState(null, "", location.pathname);
  if (q.get("order") === "paid" && q.get("session_id")) {
    if (!state.user) return;
    try {
      const r = await api("/api/orders/confirm-session", { method: "POST", body: { sessionId: q.get("session_id") } });
      toast(r.refunded ? "↩️ Leider schon verkauft" : "✅ Bezahlt – Käuferschutz aktiv", r.refunded ? "Die Karte wurde zeitgleich verkauft. Dein Geld wird automatisch erstattet." : "Der Verkäufer wurde benachrichtigt und versendet jetzt.");
    } catch (e) { handleError(e); }
    clean(); openOrders(); window.PS?.loadListings?.();
  } else if (q.get("orders") === "1") { clean(); if (state.user) openOrders(); }
  else if (/^\d{1,10}$/.test(q.get("listing") || "")) {
    // Direktlink aus Mitteilung/Push („Fehlende Binder-Karte verfügbar“, Wunschkarte): Marktplatz + Inserat öffnen
    const id = Number(q.get("listing"));
    try { history.replaceState(history.state, "", `${location.pathname}?tab=map`); } catch {}
    window.PS?.goMarket?.();
    window.PS?.openListing?.(id);
  } else if (q.get("seller")) {
    const which = q.get("seller");
    clean();
    if (state.user) { await window.PS?.refreshMe?.(); if (which === "taxinfo" && window.PS?.openTaxInfo) window.PS.openTaxInfo(); else openSeller(); }
  }
}
