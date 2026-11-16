// PokeSwipe & Radar – Restock- & Vorbestell-Radar, Graded-Portfolio mit Einsendungs-Tracker und KI-Fake-Check.
import { $, esc, jsArg, safeUrl, eur, toast, FALLBACK_IMG, cdn, state, api, handleError, requireLogin, btn } from "./core.js";
import { searchCatalog, searchThumb, isAbort } from "./search.js";

const PS = () => window.PS;
const pill = (text, cls = "bg-yellow-400 text-slate-950") => `<span class="text-[10px] font-black uppercase ${cls} px-2.5 py-0.5 rounded-full">${text}</span>`;
const box = (inner, border = "border-slate-800") => `<div class="bg-slate-950 rounded-2xl p-3 border ${border} text-xs space-y-2">${inner}</div>`;
const field = (id, label, attrs = "") => `<label class="block text-[11px] text-slate-400 font-bold space-y-1"><span>${label}</span>
  <input id="${id}" ${attrs} class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-yellow-400 outline-none" /></label>`;
const select = (id, label, options, value = "") => `<label class="block text-[11px] text-slate-400 font-bold space-y-1"><span>${label}</span>
  <select id="${id}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "gerade eben" : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : `vor ${Math.round(m / 1440)} Tg.`;
};
const VERDICT_CLS = { fair: "bg-emerald-400 text-slate-950", high: "bg-amber-400 text-slate-950", scalper: "bg-rose-500 text-white", unknown: "bg-slate-700 text-slate-200" };
const verdictPill = (v) => (v ? pill(`${v.level === "fair" ? "✅" : v.level === "scalper" ? "❌" : v.level === "high" ? "⚠️" : "❔"} ${esc(v.label)}`, VERDICT_CLS[v.level] || VERDICT_CLS.unknown) : "");
const STATUS = {
  in_stock: ["Lieferbar", "bg-emerald-400 text-slate-950"], preorder: ["Vorbestellbar", "bg-cyan-400 text-slate-950"],
  out_of_stock: ["Ausverkauft", "bg-slate-700 text-slate-300"], unknown: ["Unbekannt", "bg-slate-800 text-slate-400"],
};
const KINDS = [["display", "Display"], ["etb", "Elite-Trainer-Box"], ["ttb", "Top-Trainer-Box"], ["bundle", "Booster-Bundle"], ["booster", "Booster"], ["tin", "Tin"], ["collection", "Kollektion"], ["other", "Sonstiges"]];

function resizeImage(file, max = 1400) {
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

// ===========================================================================
// 1. Restock- & Vorbestell-Radar
// ===========================================================================
let drops = null;

function dropsPanelHtml() {
  return `<div id="ps-drops" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-rose-500/50">
    <div>
      ${pill("🚨 Restock- & Vorbestell-Radar", "bg-rose-500 text-white")}
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Displays & ETBs zum UVP – bevor die Scalper sie haben</h2>
      <p class="text-xs text-slate-300">Wir prüfen die Produktseiten großer Shops alle 2 Minuten und melden dir per Push, sobald Ware wieder lieferbar oder vorbestellbar ist – mit UVP-Ampel, damit du keine Scalper-Preise zahlst. Dazu kommen bestätigte Meldungen aus der Community. Keine Kauf-Bots, nur faire Chancen.</p>
    </div>
    <div id="ps-drops-stats" class="grid grid-cols-3 gap-2 text-center"></div>
    <div id="ps-drops-sub"></div>
    <div class="space-y-2"><p class="font-black text-white text-sm">⚡ Live-Drops (letzte 7 Tage)</p><div id="ps-drops-feed" class="space-y-2"><p class="text-xs text-slate-400">⏳ Lädt …</p></div></div>
    <details class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs">
      <summary class="font-black text-white cursor-pointer">📣 Drop melden (Online-Shop oder Laden in deiner Stadt)</summary>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        ${field("rd-title", "Produkt", 'maxlength="100" placeholder="z. B. Prismatische Entwicklungen Top-Trainer-Box"')}
        ${field("rd-url", "Shop-Link (optional)", 'maxlength="500" placeholder="https://www.amazon.de/…"')}
        ${field("rd-city", "Stadt (bei Laden-Meldung)", 'maxlength="60" placeholder="z. B. Köln, Müller Hohe Straße"')}
        ${field("rd-price", "Preis (€)", 'inputmode="decimal" placeholder="54,99"')}
        ${select("rd-kind", "Art", [["restock", "Wieder lieferbar / im Laden"], ["preorder", "Vorbestellung offen"]])}
        <div class="flex items-end">${btn("📣 Melden", "PS.reportDrop()", "w-full bg-rose-500 text-white")}</div>
      </div>
      <p class="text-[10px] text-slate-500 mt-2">Community-Meldungen gehen live, sobald 2 andere Sammler sie bestätigen. Falschmeldungen führen zur Sperre.</p>
    </details>
    <div class="space-y-2"><p class="font-black text-white text-sm">📝 Vorbestell- & Preis-Tracker</p>
      <p class="text-[11px] text-slate-400">Alle beobachteten Produkte mit Preis je Shop. ✅ = UVP, ⚠️ = leicht drüber, ❌ = Scalper-Preis.</p>
      <div id="ps-drops-products" class="grid grid-cols-1 sm:grid-cols-2 gap-2"></div></div>
    <div id="ps-drops-admin"></div>
  </div>`;
}

export async function loadDrops() {
  if (!$("ps-drops-feed")) return;
  try {
    drops = await api("/api/restock");
    renderDrops();
  } catch { $("ps-drops-feed").innerHTML = `<p class="text-rose-400 text-xs">Radar gerade nicht erreichbar.</p>`; }
}

function renderDrops() {
  if (!drops) return;
  const d = drops;
  const stat = (v, l) => `<div class="bg-slate-950 border border-slate-800 rounded-2xl p-2"><p class="text-lg font-black text-white">${v}</p><p class="text-[10px] text-slate-400 font-bold">${l}</p></div>`;
  $("ps-drops-stats").innerHTML = stat(Number(d.stats?.week) || 0, "Drops diese Woche") + stat(Number(d.stats?.watched) || 0, "Shop-Seiten überwacht")
    + stat(d.delayMin ? `${Number(d.delayMin) || 0} Min.` : "Sofort", "Deine Alarm-Zeit");
  renderSubscription();
  const feed = d.feed.filter((x) => x.status === "live" || x.status === "pending");
  $("ps-drops-feed").innerHTML = feed.length ? feed.map(dropCard).join("")
    : `<p class="text-xs text-slate-400">Gerade keine Drops. Aktiviere den Alarm – wir melden uns, sobald etwas reinkommt.</p>`;
  $("ps-drops-products").innerHTML = d.products.length ? d.products.map(productCard).join("")
    : `<p class="text-xs text-slate-400 col-span-full">Die Produktliste wird gerade aufgebaut.</p>`;
  if (d.isAdmin) loadDropsAdmin();
}

function renderSubscription() {
  const el = $("ps-drops-sub");
  const d = drops;
  if (!state.user) {
    el.innerHTML = box(`<p class="font-black text-white">🔔 Restock-Alarm per Push</p><p class="text-slate-300">Kostenlos anmelden und benachrichtigt werden, sobald Displays, ETBs & Co. wieder da sind.</p>
      ${btn("Kostenlos anmelden", "PS.openAccount()", "w-full bg-rose-500 text-white")}`, "border-rose-500/50");
    return;
  }
  const s = d.subscription;
  const pushOff = typeof Notification === "undefined" || Notification.permission !== "granted";
  const upsell = d.delayMin
    ? `<div class="bg-yellow-400/10 border border-yellow-400/40 rounded-xl p-2.5 space-y-1.5"><p class="text-yellow-200 font-bold">⏱ Im Free-Tarif kommen Alarme ${Number(d.delayMin) || 0} Minuten später. Bei beliebten Drops ist die Ware dann oft schon weg.</p>
        ${btn("👑 Premium: Alarme sofort", "PS.openPro()", "w-full bg-yellow-400 text-slate-950")}</div>` : "";
  if (!s || !s.enabled) {
    el.innerHTML = box(`<p class="font-black text-white">🔔 Restock-Alarm ist aus</p><p class="text-slate-300">Push für alle neuen Drops und Vorbestellungen.</p>
      ${btn("🔔 Restock-Alarm aktivieren", "PS.subscribeDrops(true)", "w-full bg-rose-500 text-white")}${upsell}`, "border-rose-500/50");
    return;
  }
  const shopChecks = d.shops.filter((x) => x.id !== "other").map((x) => `<label class="flex items-center gap-1.5"><input type="checkbox" class="rd-shop" value="${esc(x.id)}" ${String(s.shops || "").split(",").includes(x.id) ? "checked" : ""} ${d.filters ? "" : "disabled"} /> ${esc(x.label)}</label>`).join("");
  el.innerHTML = box(`<div class="flex justify-between items-center gap-2"><p class="font-black text-emerald-300">🔔 Restock-Alarm aktiv ${d.delayMin ? `(+${Number(d.delayMin) || 0} Min.)` : "(sofort)"}</p>
      ${btn("Ausschalten", "PS.subscribeDrops(false)", "bg-slate-800 text-slate-200")}</div>
    ${pushOff ? `<div class="flex justify-between items-center gap-2 bg-slate-900 rounded-xl p-2"><p class="text-amber-300">Push ist auf diesem Gerät noch aus.</p>${btn("🔔 Push aktivieren", "PS.enablePush()")}</div>` : ""}
    <label class="flex items-center gap-2"><input id="rd-preorders" type="checkbox" ${s.preorders ? "checked" : ""} /> Auch Vorbestellungen melden</label>
    <details ${d.filters ? "open" : ""}><summary class="font-bold text-white cursor-pointer">🎯 Filter ${d.filters ? "" : "(Pro Trader)"}</summary>
      <div class="space-y-2 mt-2 ${d.filters ? "" : "opacity-60"}">
        <p class="text-slate-400">Nur diese Shops (leer = alle):</p><div class="grid grid-cols-2 sm:grid-cols-3 gap-1">${shopChecks}</div>
        ${field("rd-keywords", "Nur Produkte mit diesen Wörtern (Komma-getrennt)", `value="${esc(s.keywords ?? "")}" placeholder="151, prismatisch, etb" ${d.filters ? "" : "disabled"}`)}
        ${field("rd-max", "Höchstpreis (€)", `value="${esc(s.maxPrice ?? "")}" inputmode="decimal" ${d.filters ? "" : "disabled"}`)}
        <label class="flex items-center gap-2"><input id="rd-uvp" type="checkbox" ${s.uvpOnly ? "checked" : ""} ${d.filters ? "" : "disabled"} /> Nur Drops zum UVP-Preis</label>
        ${d.filters ? "" : `<p class="text-purple-300 font-bold">Mit Pro Trader bekommst du nur die Drops, die du willst – z. B. nur 151-Displays bis 160 € bei Amazon.</p>`}
      </div></details>
    ${btn("Speichern", "PS.saveDropFilters()", "w-full bg-emerald-500 text-slate-950")}
    ${d.filters ? "" : btn("🏪 Pro Trader ansehen", "PS.openPro()", "w-full bg-purple-600 text-white")}
    ${upsell}`, "border-emerald-400/50");
}

function dropCard(x) {
  const icon = x.kind === "preorder" ? "📝" : "🚨";
  if (x.locked) {
    return `<div class="bg-slate-950 border border-yellow-400/50 rounded-2xl p-3 text-xs flex items-center justify-between gap-2">
      <div><p class="font-black text-white">${icon} 🔒 Neuer ${x.kind === "preorder" ? "Vorbestell-Drop" : "Restock"} bei ${esc(x.shopLabel)}</p>
        <p class="text-yellow-200">Premium-Nutzer sehen ihn schon – für dich in ${Number(x.unlockInMin) || 0} Min.</p></div>
      ${btn("👑 Sofort sehen", "PS.openPro()", "bg-yellow-400 text-slate-950 shrink-0")}</div>`;
  }
  const pending = x.status === "pending";
  return `<div class="bg-slate-950 border ${pending ? "border-slate-700 border-dashed" : x.verdict?.level === "fair" ? "border-emerald-400/60" : "border-slate-800"} rounded-2xl p-3 text-xs space-y-1.5">
    <div class="flex justify-between gap-2"><p class="font-black text-white">${icon} ${esc(x.title)}</p><span class="text-slate-500 shrink-0">${ago(x.liveAt || x.createdAt)}</span></div>
    <div class="flex flex-wrap items-center gap-1.5">${pill(esc(x.shopLabel), "bg-slate-800 text-slate-200")}${x.city ? pill(`📍 ${esc(x.city)}`, "bg-slate-800 text-slate-200") : ""}
      ${x.price ? `<span class="font-black text-white">${eur(x.price)}</span>` : ""}${x.price ? verdictPill(x.verdict) : ""}
      ${x.source === "community" ? pill(`👥 ${Number(x.confirmations) || 0} Bestätigung${Number(x.confirmations) === 1 ? "" : "en"}`, "bg-slate-800 text-slate-300") : pill(x.source === "auto" ? "🤖 Automatisch erkannt" : "✔ Vom Team", "bg-slate-800 text-slate-300")}</div>
    ${pending ? `<p class="text-slate-400">Wartet auf Bestätigung (${Number(x.confirmations) || 0}/${Number(drops.confirmationsNeeded) || 0}).</p>` : ""}
    <div class="flex gap-1.5">
      ${x.hasLink ? btn("🛒 Zum Shop", `PS.dropGo(${Number(x.id)})`, "flex-1 bg-rose-500 text-white") : ""}
      ${state.user && !x.mine ? btn(x.confirmed ? "✔ Bestätigt" : "✅ Gibt's noch", `PS.confirmDrop(${Number(x.id)})`, `flex-1 ${x.confirmed ? "bg-slate-800 text-slate-400" : "bg-emerald-500 text-slate-950"}`) : ""}
      ${drops.isAdmin ? btn("🗑", `PS.removeDrop(${Number(x.id)})`, "bg-slate-800 text-rose-300") : ""}
    </div></div>`;
}

function productCard(p) {
  const best = p.offers.filter((o) => o.price && (o.status === "in_stock" || o.status === "preorder")).sort((a, b) => a.price - b.price)[0];
  return box(`<div class="flex justify-between gap-2"><div><p class="font-black text-white">${esc(p.name)}</p>
      <p class="text-slate-400">${esc(p.setName || "")}${p.releaseDay ? ` • Release ${esc(new Date(p.releaseDay).toLocaleDateString("de-DE"))}` : ""}</p></div>
      ${p.uvp ? `<p class="text-right shrink-0"><span class="text-[10px] text-slate-400 block">UVP</span><span class="font-black text-white">${eur(p.uvp)}</span></p>` : ""}</div>
    ${best ? `<p class="text-emerald-300 font-bold">Bester Preis: ${eur(best.price)} bei ${esc(best.shopLabel)}</p>` : ""}
    <div class="space-y-1">${p.offers.map((o) => `<a href="/api/restock/watch/${Number(o.id)}/go" target="_blank" rel="noopener sponsored" class="flex items-center justify-between gap-2 bg-slate-900 hover:bg-slate-800 rounded-xl px-2.5 py-1.5">
      <span class="font-bold text-white">${esc(o.shopLabel)}</span>
      <span class="flex items-center gap-1.5">${pill(STATUS[o.status]?.[0] || esc(o.status), STATUS[o.status]?.[1] || "")}${o.price ? `<span class="font-black text-white">${eur(o.price)}</span>${o.verdict && o.verdict.level !== "unknown" ? `<span title="${esc(o.verdict.label)}">${o.verdict.level === "fair" ? "✅" : o.verdict.level === "scalper" ? "❌" : "⚠️"}</span>` : ""}` : ""}</span></a>`).join("")}</div>`);
}

async function subscribeDrops(enabled) {
  if (!requireLogin()) return;
  try {
    const s = drops?.subscription || {};
    await api("/api/restock/subscribe", { method: "POST", body: { ...s, enabled } });
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") PS().enablePush?.();
    toast(enabled ? "🔔 Restock-Alarm aktiv" : "Restock-Alarm aus", enabled ? (drops?.delayMin ? `Alarme kommen im Free-Tarif ${drops.delayMin} Min. später.` : "Du wirst sofort benachrichtigt.") : "");
    loadDrops();
  } catch (e) { handleError(e); }
}

async function saveDropFilters() {
  try {
    await api("/api/restock/subscribe", { method: "POST", body: {
      enabled: true, preorders: $("rd-preorders")?.checked !== false,
      shops: [...document.querySelectorAll(".rd-shop:checked")].map((c) => c.value).join(","),
      keywords: $("rd-keywords")?.value || "", maxPrice: $("rd-max")?.value || null, uvpOnly: Boolean($("rd-uvp")?.checked),
    } });
    toast("✅ Gespeichert", drops?.filters ? "Deine Filter sind aktiv." : "");
    loadDrops();
  } catch (e) { handleError(e); }
}

async function reportDrop() {
  if (!requireLogin()) return;
  try {
    const r = await api("/api/restock/report", { method: "POST", body: {
      title: $("rd-title").value, url: $("rd-url").value, city: $("rd-city").value, price: $("rd-price").value, kind: $("rd-kind").value,
    } });
    ["rd-title", "rd-url", "rd-city", "rd-price"].forEach((id) => { $(id).value = ""; });
    toast("📣 Danke für deine Meldung!", r.live ? "Der Drop ist live." : `Sobald ${r.needed} Sammler bestätigen, geht der Alarm raus.`);
    loadDrops();
  } catch (e) { handleError(e); }
}

async function confirmDrop(id) {
  if (!requireLogin()) return;
  try {
    const r = await api(`/api/restock/${id}/confirm`, { method: "POST", body: {} });
    toast(r.live ? "🚨 Drop ist live" : "✅ Bestätigt", r.already ? "Du hast schon bestätigt." : "Danke – so helfen sich Sammler gegen Scalper.");
    loadDrops();
  } catch (e) { handleError(e); }
}

async function dropGo(id) {
  // Fenster sofort öffnen (sonst blockt der Browser es nach dem Abruf)
  const w = window.open("", "_blank");
  try {
    const r = await api(`/api/restock/${Number(id)}/link`);
    // Ziel stammt (bei Community-Meldungen) von Nutzern: nur http(s), niemals javascript:/data: –
    // das leere Fenster ist same-origin, ein javascript:-Ziel würde dort mit unseren Rechten laufen.
    const url = safeUrl(r?.url, { http: true });
    if (!url) { w?.close(); toast("⚠️ Link ungültig", "Für diesen Drop ist kein gültiger Shop-Link hinterlegt."); return; }
    if (w) { w.opener = null; w.location.href = url; } else location.href = url;
  } catch (e) { w?.close(); handleError(e); }
}

async function removeDrop(id) {
  if (!confirm("Meldung entfernen?")) return;
  try { await api(`/api/restock/${id}`, { method: "DELETE" }); loadDrops(); } catch (e) { handleError(e); }
}

// ------------------------------ Admin ------------------------------
let adminOpen = false, bulkFailed = [];
async function loadDropsAdmin() {
  const el = $("ps-drops-admin");
  if (!el) return;
  try {
    const a = await api("/api/admin/restock");
    el.innerHTML = `<details ${adminOpen ? "open" : ""} ontoggle="PS.adminPanelToggle(this.open)" class="bg-slate-950 rounded-2xl p-3 border border-purple-500/50 text-xs"><summary class="font-black text-purple-300 cursor-pointer">🛠 Admin: Überwachte Produktseiten (${Number(a.watches.length) || 0})</summary>
      <div class="space-y-3 mt-3">
        <p class="${a.amazonTag ? "text-emerald-300" : "text-amber-300"}">${a.amazonTag ? "✔ Amazon-Partner-Tag aktiv" : "⚠️ AMAZON_PARTNER_TAG nicht gesetzt – Amazon-Klicks bringen noch keine Provision."}</p>
        <p class="${a.cardmarketId ? "text-emerald-300" : "text-amber-300"}">${a.cardmarketId ? "✔ Cardmarket-Partner-ID aktiv" : "⚠️ CARDMARKET_PARTNER_ID nicht gesetzt."}</p>
        ${a.amazonTag && a.cardmarketId ? "" : `<div class="bg-slate-900 rounded-xl p-2.5 space-y-1.5 text-slate-300">
          <p class="font-black text-white">💶 So schaltest du die Provisionen frei</p>
          ${a.amazonTag ? "" : `<p>1. Bei <a class="text-yellow-300 underline" href="https://partnernet.amazon.de/" target="_blank" rel="noopener">Amazon PartnerNet</a> anmelden (kostenlos) und deine Website pokeswipe-radar.de eintragen. Deine Tracking-ID sieht aus wie <b>deinname-21</b>.</p>`}
          ${a.cardmarketId ? "" : `<p>${a.amazonTag ? "1" : "2"}. Bei Cardmarket über den Support das Partnerprogramm anfragen und deine Partner-/Referrer-Kennung notieren.</p>`}
          <p>Dann in Netlify unter <b>Project configuration → Environment variables</b> eintragen: <code class="text-purple-300">AMAZON_PARTNER_TAG</code> und <code class="text-purple-300">CARDMARKET_PARTNER_ID</code>. Nach dem nächsten Deploy hängt die App die Kennung automatisch an jeden Shop-Link – eBay-Links verdienen bereits jetzt.</p>
          <p class="text-slate-500">Hinweis: Amazon verlangt innerhalb von 180 Tagen 3 qualifizierte Verkäufe, sonst wird das Konto geschlossen – also erst freischalten, wenn das Radar ein paar Produkte überwacht.</p>
        </div>`}
        <div class="bg-slate-900 rounded-xl p-2.5 space-y-2">
          <p class="font-black text-white">⚡ Schnell-Import</p>
          <p class="text-slate-400">Eine Produktseite pro Zeile (max. 25). Nur die URL reicht – Name, Preis, Verfügbarkeit und Art werden von der Seite gelesen. Optional: <code>Name | URL | UVP</code>.</p>
          <textarea id="rw-bulk" rows="4" class="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white text-xs" placeholder="https://www.amazon.de/dp/…&#10;151 Display | https://www.smythstoys.com/de/de-de/… | 179,64">${esc(bulkFailed.map((x) => x.line).join("\n"))}</textarea>
          ${btn("⚡ Alle importieren", "PS.adminBulkWatch()", "w-full bg-purple-600 text-white")}
          <div id="rw-bulk-result">${bulkFailed.map((x) => `<p class="text-amber-300 truncate">⚠️ ${esc(x.error)}: ${esc(x.line)}</p>`).join("")}</div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${field("rw-name", "Produkt", 'placeholder="151 Display (36 Booster)"')}${field("rw-set", "Set", 'placeholder="151"')}
          ${field("rw-url", "Produktseite (https)", 'placeholder="https://www.amazon.de/dp/…"')}${field("rw-uvp", "UVP (€)", 'inputmode="decimal"')}
          ${select("rw-kind", "Art", KINDS)}${field("rw-release", "Release", 'type="date"')}
        </div>
        <label class="flex items-center gap-2"><input id="rw-auto" type="checkbox" checked /> Automatisch prüfen (alle 2 Min.)</label>
        <div class="flex gap-2">${btn("➕ Produktseite hinzufügen", "PS.adminAddWatch()", "flex-1 bg-purple-600 text-white")}${btn("▶ Jetzt prüfen", "PS.adminRunRestock()", "bg-slate-800 text-white")}</div>
        <div class="space-y-1">${a.watches.map((w) => `<div class="flex items-center justify-between gap-2 bg-slate-900 rounded-xl px-2.5 py-1.5 ${w.active ? "" : "opacity-50"}">
          <div class="min-w-0"><p class="font-bold text-white truncate">${esc(w.name)} • ${esc(w.shop)}</p>
            <p class="text-slate-500 truncate">${esc(STATUS[w.status]?.[0] || w.status)}${w.lastPrice ? ` • ${eur(w.lastPrice)}` : ""}${w.lastCheckedAt ? ` • geprüft ${ago(w.lastCheckedAt)}` : " • noch nicht geprüft"}${w.failCount ? ` • ⚠️ ${Number(w.failCount) || 0} Fehler (Seite blockt evtl. – dann manuell melden)` : ""}</p></div>
          <div class="flex gap-1 shrink-0">${btn(w.active ? "Pause" : "Aktiv", `PS.adminToggleWatch(${Number(w.id)}, ${!w.active})`, "bg-slate-800 text-white")}${btn("🗑", `PS.adminDeleteWatch(${Number(w.id)})`, "bg-slate-800 text-rose-300")}</div></div>`).join("")}</div>
        <p class="text-slate-500">Tipp: Als Admin gemeldete Drops (oben „Drop melden“) gehen sofort live – praktisch für Shops, die automatische Abrufe blockieren.</p>
      </div></details>`;
  } catch {}
}

async function adminAddWatch() {
  try {
    await api("/api/admin/restock/watches", { method: "POST", body: {
      name: $("rw-name").value, setName: $("rw-set").value, url: $("rw-url").value, uvp: $("rw-uvp").value,
      kind: $("rw-kind").value, releaseDay: $("rw-release").value, autoCheck: $("rw-auto").checked,
    } });
    toast("✅ Hinzugefügt", "Die erste Prüfung legt den Ausgangszustand fest.");
    loadDrops();
  } catch (e) { handleError(e); }
}
async function adminBulkWatch() {
  const out = $("rw-bulk-result");
  if (out) out.innerHTML = `<p class="text-slate-400">⏳ Seiten werden gelesen …</p>`;
  try {
    const r = await api("/api/admin/restock/watches/bulk", { method: "POST", body: { lines: $("rw-bulk").value } });
    toast("✅ Import fertig", `${Number(r.added) || 0} Produktseiten hinzugefügt.`);
    bulkFailed = (r.results || []).filter((x) => !x.ok);
    loadDrops();
  } catch (e) { if (out) out.innerHTML = ""; handleError(e); }
}
async function adminToggleWatch(id, active) {
  try { await api(`/api/admin/restock/watches/${id}`, { method: "PATCH", body: { active } }); loadDrops(); } catch (e) { handleError(e); }
}
async function adminDeleteWatch(id) {
  if (!confirm("Produktseite löschen?")) return;
  try { await api(`/api/admin/restock/watches/${id}`, { method: "DELETE" }); loadDrops(); } catch (e) { handleError(e); }
}
async function adminRunRestock() {
  try {
    const r = await api("/api/admin/restock/run", { method: "POST", body: {} });
    toast("▶ Prüfung fertig", `${r.checked} Seiten geprüft, ${r.drops} Drops, ${r.errors} Fehler, ${r.paid + r.free} Alarme.`);
    loadDrops();
  } catch (e) { handleError(e); }
}

// ===========================================================================
// 2. Graded-Portfolio & Einsendungs-Tracker
// ===========================================================================
let graded = null;
let gradedPick = null;
const COMPANIES = [["PSA", "PSA"], ["CGC", "CGC"], ["BGS", "Beckett (BGS)"], ["TAG", "TAG"], ["other", "Andere"]];
const SUB_STEPS = [["prep", "In Vorbereitung"], ["sent", "Verschickt"], ["arrived", "Angekommen"], ["grading", "Wird bewertet"], ["shipped", "Rückversand"], ["done", "Fertig"]];

function gradedPanelHtml() {
  return `<div id="ps-graded" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-cyan-400/50">
    <div>
      ${pill("🏅 Graded-Portfolio", "bg-cyan-400 text-slate-950")}
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Deine Slabs & Grading-Einsendungen an einem Ort</h2>
      <p class="text-xs text-slate-300">Gegradete Karten mit Firma, Note und Zertifikat – mit Wert, Gewinn und Links zu echten eBay-Verkäufen. Dazu verfolgst du deine Einsendungen bei PSA, CGC, Beckett oder TAG und wirst erinnert, wenn etwas überfällig ist.</p>
    </div>
    <div id="ps-graded-totals"></div>
    <details class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs" id="ps-graded-add">
      <summary class="font-black text-white cursor-pointer">➕ Graded-Karte hinzufügen</summary>
      <div class="space-y-2 mt-3">
        <div class="flex gap-2"><input id="gd-q" placeholder="🔎 Karte suchen (z. B. Glurak ex)" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" />
          <button onclick="PS.gradedSearch()" class="bg-cyan-400 text-slate-950 font-black px-4 rounded-xl">Suchen</button></div>
        <div id="gd-results" class="grid grid-cols-4 sm:grid-cols-6 gap-2"></div>
        <p id="gd-picked" class="text-cyan-300 font-bold"></p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          ${field("gd-name", "Name (falls nicht gefunden)", 'maxlength="100"')}${select("gd-company", "Firma", COMPANIES)}
          ${field("gd-grade", "Note", 'inputmode="decimal" placeholder="10"')}${field("gd-cert", "Zertifikat-Nr.", 'maxlength="30"')}
          ${field("gd-buy", "Einstand (€)", 'inputmode="decimal"')}${field("gd-value", "Aktueller Wert (€)", 'inputmode="decimal"')}
        </div>
        ${btn("🏅 Speichern", "PS.addGraded()", "w-full bg-cyan-400 text-slate-950")}
      </div>
    </details>
    <div id="ps-graded-list" class="grid grid-cols-1 sm:grid-cols-2 gap-2"></div>
    <div class="space-y-2">
      <p class="font-black text-white text-sm">📦 Grading-Einsendungen</p>
      <details class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs">
        <summary class="font-black text-white cursor-pointer">➕ Neue Einsendung</summary>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          ${field("gs-title", "Bezeichnung", 'maxlength="80" placeholder="z. B. 151-Alt-Arts"')}${select("gs-company", "Firma", COMPANIES)}
          ${field("gs-service", "Service-Stufe", 'maxlength="40" placeholder="z. B. Value Bulk"')}${field("gs-count", "Anzahl Karten", 'inputmode="numeric" value="1"')}
          ${field("gs-cost", "Kosten gesamt (€)", 'inputmode="decimal"')}${field("gs-declared", "Versicherter Wert (€)", 'inputmode="decimal"')}
          ${field("gs-sent", "Verschickt am", 'type="date"')}${field("gs-expected", "Erwartet bis", 'type="date"')}${field("gs-number", "Einsendungs-Nr.", 'maxlength="40"')}
        </div>
        <div class="mt-2">${field("gs-tracking", "Sendungsnummer", 'maxlength="60"')}</div>
        <div class="mt-2">${btn("📦 Einsendung anlegen", "PS.addSubmission()", "w-full bg-cyan-400 text-slate-950")}</div>
      </details>
      <div id="ps-graded-subs" class="space-y-2"></div>
    </div>
  </div>`;
}

export async function loadGraded() {
  const list = $("ps-graded-list");
  if (!list) return;
  if (!state.user) {
    $("ps-graded-totals").innerHTML = "";
    list.innerHTML = `<div class="col-span-full">${box(`<p class="text-slate-300">Melde dich an, um deine Slabs und Einsendungen zu verwalten.</p>${btn("Kostenlos anmelden", "PS.openAccount()", "w-full bg-cyan-400 text-slate-950")}`)}</div>`;
    $("ps-graded-subs").innerHTML = "";
    return;
  }
  try {
    graded = await api("/api/graded");
    renderGraded();
  } catch (e) { if (e.status !== 401) list.innerHTML = `<p class="text-rose-400 text-xs">Konnte nicht geladen werden.</p>`; }
}

function renderGraded() {
  const g = graded;
  const t = g.totals, profit = t.value - t.cost;
  const stat = (v, l, cls = "text-white") => `<div class="bg-slate-950 border border-slate-800 rounded-2xl p-2 text-center"><p class="text-base font-black ${cls}">${v}</p><p class="text-[10px] text-slate-400 font-bold">${l}</p></div>`;
  $("ps-graded-totals").innerHTML = `<div class="grid grid-cols-3 gap-2">${stat(eur(t.value), "Wert der Slabs")}${stat(`${profit >= 0 ? "+" : ""}${eur(profit)}`, "Gewinn / Verlust", profit >= 0 ? "text-emerald-300" : "text-rose-300")}${stat(`${Number(t.count) || 0}/${Number(g.limits.graded) || 0}`, "Graded-Karten")}</div>
    ${t.withoutValue ? `<p class="text-[11px] text-amber-300 mt-2">Bei ${Number(t.withoutValue) || 0} Slab${t.withoutValue > 1 ? "s" : ""} fehlt der Wert – tippe auf „eBay-Verkäufe“ und trag den letzten Verkaufspreis ein.</p>` : ""}
    ${g.plan === "free" ? `<div class="mt-2 bg-yellow-400/10 border border-yellow-400/40 rounded-xl p-2.5 text-xs flex items-center justify-between gap-2"><p class="text-yellow-200 font-bold">Free: ${Number(g.limits.graded) || 0} Slabs & ${Number(g.limits.submissions) || 0} Einsendung. Premium: 200 Slabs & 20 Einsendungen.</p>${btn("👑 Upgrade", "PS.openPro()", "bg-yellow-400 text-slate-950 shrink-0")}</div>` : ""}`;
  $("ps-graded-list").innerHTML = g.items.length ? g.items.map((i) => {
    const p = i.value != null && i.purchasePrice != null ? i.value - i.purchasePrice : null;
    return `<div class="bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs flex gap-3 relative">
      <button onclick="PS.removeGraded(${Number(i.id)})" class="absolute top-2 right-3 text-slate-500 hover:text-rose-400" aria-label="Entfernen">✕</button>
      <img src="${esc(cdn(i.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" class="w-14 h-20 object-contain rounded shrink-0" loading="lazy" />
      <div class="min-w-0 space-y-1 flex-1">
        <p class="font-black text-white truncate pr-4">${esc(i.name)}</p>
        <p>${pill(`${esc(i.company)} ${esc(String(i.grade ?? "").replace(".0", ""))}`, "bg-cyan-400 text-slate-950")} ${i.certNumber ? (safeUrl(i.certUrl) ? `<a href="${esc(safeUrl(i.certUrl))}" target="_blank" rel="noopener" class="text-cyan-300 underline">#${esc(i.certNumber)} prüfen</a>` : `<span class="text-slate-400">#${esc(i.certNumber)}</span>`) : ""}</p>
        <p class="text-slate-300">Wert <strong class="text-white">${i.value != null ? eur(i.value) : "–"}</strong>${i.rawPrice ? ` • Raw ${eur(i.rawPrice)}` : ""}${p != null ? ` • <span class="${p >= 0 ? "text-emerald-300" : "text-rose-300"}">${p >= 0 ? "+" : ""}${eur(p)}</span>` : ""}</p>
        <div class="flex gap-1.5">${safeUrl(i.soldUrl) ? `<a href="${esc(safeUrl(i.soldUrl))}" target="_blank" rel="noopener sponsored" class="bg-slate-800 text-white font-bold py-1.5 px-2 rounded-lg">💶 eBay-Verkäufe</a>` : ""}
          ${btn("✏️ Wert", `PS.editGradedValue(${Number(i.id)})`, "bg-slate-800 text-white !py-1.5")}</div>
      </div></div>`;
  }).join("") : `<p class="text-xs text-slate-400 col-span-full">Noch keine Slabs. Füge deine erste gegradete Karte hinzu.</p>`;
  $("ps-graded-subs").innerHTML = g.submissions.length ? g.submissions.map((s) => {
    const idx = SUB_STEPS.findIndex(([k]) => k === s.status);
    const overdue = s.expectedDay && s.status !== "done" && new Date(s.expectedDay) < new Date(new Date().toDateString());
    return box(`<div class="flex justify-between gap-2"><div><p class="font-black text-white">${esc(s.company)} • ${esc(s.title || `${Number(s.cardCount) || 0} Karten`)}</p>
        <p class="text-slate-400">${Number(s.cardCount) || 0} Karte${Number(s.cardCount) > 1 ? "n" : ""}${s.service ? ` • ${esc(s.service)}` : ""}${s.cost != null ? ` • ${eur(s.cost)}` : ""}${s.submissionNumber ? ` • Nr. ${esc(s.submissionNumber)}` : ""}</p></div>
        <button onclick="PS.removeSubmission(${Number(s.id)})" class="text-slate-500 hover:text-rose-400 self-start" aria-label="Löschen">✕</button></div>
      <div class="flex gap-1">${SUB_STEPS.map(([k], i) => `<div class="h-1.5 flex-1 rounded-full ${i <= idx ? "bg-cyan-400" : "bg-slate-800"}"></div>`).join("")}</div>
      <div class="flex flex-wrap items-center gap-2">
        <select onchange="PS.setSubmissionStatus(${Number(s.id)}, this.value)" class="bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-white">${SUB_STEPS.map(([k, l]) => `<option value="${k}" ${k === s.status ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${s.sentDay ? `<span class="text-slate-400">📤 ${esc(new Date(s.sentDay).toLocaleDateString("de-DE"))}</span>` : ""}
        ${s.expectedDay ? `<span class="${overdue ? "text-rose-300 font-bold" : "text-slate-400"}">${overdue ? "⏰ überfällig seit" : "🎯 bis"} ${esc(new Date(s.expectedDay).toLocaleDateString("de-DE"))}</span>` : ""}
        ${s.tracking ? `<span class="text-slate-400">📦 ${esc(s.tracking)}</span>` : ""}
      </div>`, overdue ? "border-rose-400/60" : "border-slate-800");
  }).join("") : `<p class="text-xs text-slate-400">Keine Einsendungen. Lege eine an, sobald du Karten zum Grading schickst.</p>`;
}

async function gradedSearch() {
  const q = $("gd-q")?.value.trim();
  const res = $("gd-results");
  if (!q) return;
  res.innerHTML = `<p class="col-span-full text-yellow-400">⏳ Suche …</p>`;
  try {
    const { items } = await searchCatalog(q, { lang: "de,en", limit: 18, channel: "graded" });
    const seen = new Set();
    const list = items.filter((c) => c.image && c.cardId && !seen.has(c.cardId) && seen.add(c.cardId));
    res.innerHTML = list.length ? list.map((c) => `<button onclick="PS.gradedPick(${jsArg(c.cardId)}, ${jsArg(`${c.name} ${c.number || ""}`.trim())})" class="bg-slate-900 border border-slate-800 hover:border-cyan-400 rounded-xl p-1 text-center">
      <img src="${esc(searchThumb(c, 120))}" loading="lazy" class="h-20 mx-auto object-contain" /><p class="text-[10px] text-white truncate">${esc(c.name)} ${esc(c.number || "")}</p></button>`).join("")
      : `<p class="col-span-full text-slate-400">Nichts gefunden – gib den Namen unten ein.</p>`;
  } catch (e) {
    if (isAbort(e)) return;
    res.innerHTML = `<p class="col-span-full text-rose-400">${esc(e?.status === 429 ? e.message : "Kartensuche nicht erreichbar.")}</p>`;
  }
}

function pickGraded(id, label) {
  gradedPick = id;
  $("gd-picked").textContent = `✔ Ausgewählt: ${label}`;
  $("gd-results").innerHTML = "";
}

async function addGraded() {
  if (!requireLogin()) return;
  try {
    await api("/api/graded", { method: "POST", body: {
      cardId: gradedPick, name: $("gd-name").value, company: $("gd-company").value, grade: $("gd-grade").value,
      certNumber: $("gd-cert").value, purchasePrice: $("gd-buy").value, value: $("gd-value").value,
    } });
    gradedPick = null;
    ["gd-name", "gd-grade", "gd-cert", "gd-buy", "gd-value", "gd-q"].forEach((id) => { $(id).value = ""; });
    $("gd-picked").textContent = "";
    toast("🏅 Slab gespeichert");
    loadGraded();
  } catch (e) { handleError(e); }
}

async function editGradedValue(id) {
  const item = graded?.items.find((i) => i.id === id);
  const v = prompt(`Aktueller Wert für ${item?.name || "die Karte"} (€) – z. B. letzter eBay-Verkauf:`, item?.value ?? "");
  if (v === null) return;
  try { await api(`/api/graded/${id}`, { method: "PUT", body: { value: v } }); loadGraded(); } catch (e) { handleError(e); }
}

async function removeGraded(id) {
  if (!confirm("Slab entfernen?")) return;
  try { await api(`/api/graded/${id}`, { method: "DELETE" }); loadGraded(); } catch (e) { handleError(e); }
}

async function addSubmission() {
  if (!requireLogin()) return;
  const sent = $("gs-sent").value;
  try {
    await api("/api/submissions", { method: "POST", body: {
      title: $("gs-title").value, company: $("gs-company").value, service: $("gs-service").value, cardCount: $("gs-count").value,
      cost: $("gs-cost").value, declaredValue: $("gs-declared").value, sentDay: sent, expectedDay: $("gs-expected").value,
      submissionNumber: $("gs-number").value, tracking: $("gs-tracking").value, status: sent ? "sent" : "prep",
    } });
    ["gs-title", "gs-service", "gs-cost", "gs-declared", "gs-sent", "gs-expected", "gs-number", "gs-tracking"].forEach((id) => { $(id).value = ""; });
    toast("📦 Einsendung angelegt", "Wir erinnern dich, wenn das erwartete Datum überschritten ist.");
    loadGraded();
  } catch (e) { handleError(e); }
}

async function setSubmissionStatus(id, status) {
  try {
    await api(`/api/submissions/${id}`, { method: "PUT", body: { status } });
    if (status === "done") toast("🎉 Fertig!", "Trag deine Slabs jetzt oben als Graded-Karten ein.");
    loadGraded();
  } catch (e) { handleError(e); }
}

async function removeSubmission(id) {
  if (!confirm("Einsendung löschen?")) return;
  try { await api(`/api/submissions/${id}`, { method: "DELETE" }); loadGraded(); } catch (e) { handleError(e); }
}

// ===========================================================================
// 3. KI-Fake-Check
// ===========================================================================
function fakePanelHtml() {
  return `<div id="ps-fakecheck" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-3 border-2 border-amber-400/50">
    <div>
      ${pill("🕵️ KI-Fake-Check", "bg-amber-400 text-slate-950")}
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Ist die Karte echt?</h2>
      <p class="text-xs text-slate-300">Fotografiere Vorder- und Rückseite. Die KI prüft Schrift, Energiesymbole, Farben, Holo-Muster, Ränder, Set-Symbol und Rückseite auf typische Fälschungsmerkmale – ideal vor einem Kauf oder Tausch.</p>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <label class="cursor-pointer bg-slate-900 border border-dashed border-slate-600 hover:border-amber-400 rounded-2xl p-3 text-center font-bold text-white">📸 Vorderseite<span id="fc-front-ok" class="block text-[10px] text-slate-400">Pflicht</span>
        <input id="fc-front" type="file" accept="image/*" capture="environment" class="hidden" /></label>
      <label class="cursor-pointer bg-slate-900 border border-dashed border-slate-600 hover:border-amber-400 rounded-2xl p-3 text-center font-bold text-white">🔄 Rückseite<span id="fc-back-ok" class="block text-[10px] text-slate-400">Empfohlen</span>
        <input id="fc-back" type="file" accept="image/*" capture="environment" class="hidden" /></label>
    </div>
    ${btn("🕵️ Jetzt prüfen", "PS.runFakeCheck()", "w-full bg-amber-400 text-slate-950")}
    <p id="fc-left" class="text-[11px] text-slate-400 text-center"></p>
    <div id="fc-result"></div>
  </div>`;
}

const fakeFiles = { front: null, back: null };

export async function loadFakeLeft() {
  const el = $("fc-left");
  if (!el) return;
  if (!state.user) { el.textContent = "Anmelden, um Karten zu prüfen."; return; }
  try {
    const r = await api("/api/scan/fake");
    el.textContent = `${r.left} von ${r.limit} Fake-Checks in diesem Monat übrig`;
  } catch {}
}

async function runFakeCheck() {
  if (!requireLogin()) return;
  if (!fakeFiles.front) { toast("📸 Foto fehlt", "Bitte zuerst die Vorderseite fotografieren."); return; }
  const out = $("fc-result");
  out.innerHTML = `<p class="text-yellow-400 font-bold text-xs">🔍 KI prüft die Karte … (ca. 10–20 Sekunden)</p>`;
  try {
    const front = await resizeImage(fakeFiles.front);
    const back = fakeFiles.back ? await resizeImage(fakeFiles.back) : undefined;
    const r = await api("/api/scan/fake", { method: "POST", body: { front, back } });
    if ($("fc-left")) $("fc-left").textContent = `${r.left} Fake-Checks in diesem Monat übrig`;
    if (!r.ok) { out.innerHTML = box(esc(r.message)); return; }
    const V = {
      likely_real: ["✅ Wirkt echt", "border-emerald-400/60", "text-emerald-300"],
      suspicious: ["⚠️ Verdächtig – genauer prüfen", "border-amber-400/60", "text-amber-300"],
      likely_fake: ["❌ Wahrscheinlich gefälscht", "border-rose-500/70", "text-rose-300"],
      unclear: ["❔ Nicht eindeutig", "border-slate-600", "text-slate-300"],
    }[r.verdict] || ["❔ Nicht eindeutig", "border-slate-600", "text-slate-300"];
    out.innerHTML = box(`<div class="flex justify-between items-center gap-2"><p class="font-black text-base ${V[2]}">${V[0]}</p><span class="text-slate-400">Sicherheit ${Number(r.confidence) || 0} %</span></div>
      ${r.cardName ? `<p class="text-slate-300">Erkannt: <strong class="text-white">${esc(r.cardName)}</strong></p>` : ""}
      <div class="space-y-1">${(r.checks || []).map((c) => `<div class="flex gap-2"><span>${c.ok === true ? "✅" : c.ok === false ? "❌" : "➖"}</span><p><strong class="text-white">${esc(c.name)}</strong> <span class="text-slate-400">${esc(c.note)}</span></p></div>`).join("")}</div>
      ${r.tips?.length ? `<div><p class="font-bold text-white">Tipps zur weiteren Prüfung</p><ul class="list-disc pl-4 text-slate-300">${r.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      ${r.hadBack ? "" : `<p class="text-amber-300">Mit einem Foto der Rückseite wird die Prüfung deutlich genauer.</p>`}
      <p class="text-[10px] text-slate-500">KI-Einschätzung anhand von Fotos – keine Echtheitsgarantie. Bei teuren Karten zusätzlich Licht-Test, Lupe, Gewicht oder Grading nutzen.</p>`, V[1]);
  } catch (e) { out.innerHTML = ""; handleError(e); }
}

// ===========================================================================
// Einbau
// ===========================================================================
export const dropsApi = {
  subscribeDrops, saveDropFilters, reportDrop, confirmDrop, dropGo, removeDrop, loadDrops,
  adminAddWatch, adminBulkWatch, adminPanelToggle: (o) => { adminOpen = Boolean(o); }, adminToggleWatch, adminDeleteWatch, adminRunRestock,
  gradedSearch, gradedPick: pickGraded, addGraded, editGradedValue, removeGraded, addSubmission, setSubmissionStatus, removeSubmission,
  runFakeCheck,
};

/** Fügt die Bereiche ein, bevor die Unter-Reiter gebaut werden. */
export function injectDropsPanels() {
  const add = (view, html, where = "append") => {
    const section = $(`view-${view}`);
    if (!section) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    section[where](tmp.firstElementChild);
  };
  if (!$("ps-drops")) add("flip", dropsPanelHtml(), "prepend");
  if (!$("ps-graded")) add("portfolio", gradedPanelHtml());
  if (!$("ps-fakecheck")) add("scan", fakePanelHtml());
  const pickFile = (key) => (e) => {
    fakeFiles[key] = e.target.files[0] || null;
    const ok = $(`fc-${key}-ok`);
    if (ok) { ok.textContent = fakeFiles[key] ? "✔ Foto bereit" : key === "front" ? "Pflicht" : "Empfohlen"; ok.className = `block text-[10px] ${fakeFiles[key] ? "text-emerald-300" : "text-slate-400"}`; }
  };
  $("fc-front")?.addEventListener("change", pickFile("front"));
  $("fc-back")?.addEventListener("change", pickFile("back"));
  $("gd-q")?.addEventListener("keydown", (e) => e.key === "Enter" && gradedSearch());
}

export function afterAuthDrops() {
  if (drops) loadDrops();
  if (!$("ps-graded")?.closest("[data-sub]")?.classList.contains("hidden")) loadGraded();
  loadFakeLeft();
}

export function routeDrops() {
  const params = new URLSearchParams(location.search);
  if (params.get("locked") === "1") {
    toast("🔒 Premium sieht Drops sofort", `Im Free-Tarif kommen Restock-Alarme ${PLANS_DELAY()} Minuten später.`);
    setTimeout(() => PS().openPro?.(), 600);
  }
}
const PLANS_DELAY = () => drops?.freeDelayMin ?? state.me?.plans?.free?.restockDelayMin ?? 15;
