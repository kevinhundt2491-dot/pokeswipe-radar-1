// PokeSwipe & Radar – Erweiterungen: Web-Push, Kamera-Scan, Set-Fortschritt, Sealed-Tracker,
// Grading-Partner, Händler-Shops, Empfehlungsprogramm und die übersichtliche Unter-Navigation.
import {
  $, esc, eur, pct, toast, ebay, cm, FALLBACK_IMG, state, api, handleError, requireLogin,
  modal, closeModalEl, input, btn, sparkline, areaChart,
} from "./core.js";

const PS = () => window.PS;
const KIND_LABEL = { display: "Display", etb: "Elite-Trainer-Box", ttb: "Top-Trainer-Box", bundle: "Booster-Bundle", booster: "Booster", tin: "Tin", collection: "Kollektion", other: "Sonstiges" };

// ===========================================================================
// 1. Echte Web-Push-Nachrichten
// ===========================================================================
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

function b64ToBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushState() {
  if (!pushSupported()) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return (await currentSubscription()) ? "on" : "off";
}

async function enablePush() {
  if (!requireLogin()) return;
  if (isIOS() && !isStandalone()) {
    modal("ps-push-ios", `<h3 class="text-base font-black text-white">📲 Push auf dem iPhone</h3>
      <p class="text-xs text-slate-300">Apple erlaubt Push-Nachrichten nur für Apps auf dem Home-Bildschirm:</p>
      <ol class="text-xs text-slate-300 list-decimal pl-5 space-y-1"><li>Unten in Safari auf <strong>Teilen (⬆️)</strong> tippen</li>
      <li><strong>„Zum Home-Bildschirm“</strong> wählen</li><li>PokeSwipe vom Home-Bildschirm öffnen und hier erneut „Push aktivieren“ tippen</li></ol>`);
    return;
  }
  if (!pushSupported()) return toast("Push nicht möglich", "Dieser Browser unterstützt keine Push-Nachrichten.");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("🔕 Push blockiert", "Erlaube Mitteilungen in den Browser-Einstellungen, um Alarme zu bekommen.");
    const reg = (await navigator.serviceWorker.getRegistration("/")) || (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const { publicKey } = await api("/api/push/key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
    if ($("pushStatusLabel")) $("pushStatusLabel").textContent = "Push Aktiv";
    toast("🔔 Push aktiv", "Preisalarme & Tausch-Nachrichten kommen jetzt auch bei geschlossener App.");
    api("/api/push/test", { method: "POST", body: {} }).catch(() => {});
    renderPushBox();
  } catch (e) {
    if (e.status) handleError(e);
    else toast("Push nicht möglich", "Bitte Seite neu laden und erneut versuchen.");
  }
}

async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    try { await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }); } catch {}
    await sub.unsubscribe().catch(() => {});
  }
  toast("🔕 Push deaktiviert", "Auf diesem Gerät kommen keine Push-Nachrichten mehr.");
  renderPushBox();
}

/** Bestehendes Abo nach dem Login dem Konto zuordnen (z. B. nach Kontowechsel). */
async function syncPush() {
  if (!state.user || !pushSupported() || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } }).catch(() => {});
}

export async function beforeLogout() {
  const sub = await currentSubscription().catch(() => null);
  if (sub) await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
}

async function renderPushBox() {
  const box = $("ps-push-box");
  if (!box) return;
  const st = await pushState();
  const text = {
    on: ["✅ Push ist auf diesem Gerät aktiv", btn("Deaktivieren", "PS.disablePush()", "bg-slate-800 text-slate-300")],
    off: ["Preisalarme & Tausch-Nachrichten auch bei geschlossener App", btn("🔔 Push aktivieren", "PS.enablePush()")],
    blocked: ["🔕 Mitteilungen sind im Browser blockiert – bitte in den Website-Einstellungen erlauben.", ""],
    "ios-install": ["📲 Auf dem iPhone: erst „Zum Home-Bildschirm“ hinzufügen", btn("Anleitung", "PS.enablePush()")],
    unsupported: ["Dieser Browser unterstützt keine Push-Nachrichten.", ""],
  }[st];
  box.innerHTML = `<div class="flex items-center justify-between gap-2 text-xs"><span class="text-slate-300">${text[0]}</span>${text[1]}</div>`;
}

// ===========================================================================
// 2. Karten-Scan per Handykamera (KI-Erkennung auf dem Server)
// ===========================================================================
function resizeImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild nicht lesbar")); };
    img.src = url;
  });
}

function scanPanelHtml() {
  return `<div id="ps-scan" class="poke-glass rounded-3xl p-4 sm:p-6 space-y-4 border-2 border-cyan-400/40">
    <div class="flex flex-wrap justify-between items-start gap-2">
      <div>
        <span class="text-[10px] font-black uppercase bg-cyan-400 text-slate-950 px-2.5 py-0.5 rounded-full">📷 KI-Karten-Scanner</span>
        <h2 class="text-base sm:text-lg font-black text-white mt-1">Karte fotografieren – Preis sofort sehen</h2>
        <p class="text-xs text-slate-300">Die KI liest Name und Nummer, findet die passende Karte und zeigt dir den Cardmarket-Preis. Mit einem Tipp ins Portfolio oder als Preisalarm.</p>
      </div>
      <span id="ps-scan-left" class="text-xs font-black text-cyan-300"></span>
    </div>
    <label class="block cursor-pointer">
      <input id="ps-scan-input" type="file" accept="image/*" capture="environment" class="hidden" />
      <div class="bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black text-sm sm:text-base text-center py-4 rounded-2xl shadow-lg">📷 Karte scannen</div>
    </label>
    <p class="text-[11px] text-slate-400 text-center">Tipp: Karte flach auf dunklen Untergrund legen, gut ausleuchten, formatfüllend fotografieren.</p>
    <div id="ps-scan-result" class="space-y-3"></div>
  </div>`;
}

async function handleScan(file) {
  if (!file || !requireLogin()) return;
  const box = $("ps-scan-result");
  box.innerHTML = `<p class="text-yellow-400 text-xs font-bold text-center py-4">🔍 KI erkennt deine Karte …</p>`;
  try {
    const image = await resizeImage(file);
    box.innerHTML = `<div class="flex gap-3 items-center"><img src="${image}" class="w-20 rounded-xl" /><p class="text-yellow-400 text-xs font-bold">🔍 KI erkennt deine Karte …</p></div>`;
    const r = await api("/api/scan", { method: "POST", body: { image } });
    PS().refreshMe();
    if (!r.found) {
      box.innerHTML = `<div class="bg-slate-950 rounded-2xl p-3 text-xs text-slate-300 border border-slate-800">${esc(r.message || "Keine passende Karte gefunden.")}
        ${r.detected?.name ? `<br>Erkannt: <strong class="text-white">${esc(r.detected.name)} ${esc(r.detected.number || "")}</strong> – versuche die Suche im Portfolio.` : ""}</div>`;
      return;
    }
    box.innerHTML = `<p class="text-xs text-slate-300">Erkannt: <strong class="text-white">${esc(r.detected.name)}</strong>${r.detected.number ? ` • Nr. ${esc(r.detected.number)}${r.detected.total ? "/" + esc(r.detected.total) : ""}` : ""} – tippe auf die passende Karte:</p>
      <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${r.candidates.map((c) => `
        <button onclick="PS.openCard('${esc(c.id)}')" class="bg-slate-900 border border-slate-800 hover:border-cyan-400 rounded-xl p-2 text-center">
          <img src="${esc(c.image || FALLBACK_IMG)}" onerror="this.src='${FALLBACK_IMG}'" class="h-28 mx-auto object-contain" loading="lazy" />
          <p class="text-[11px] font-bold text-white truncate">${esc(c.name)}</p><p class="text-[10px] text-slate-400">${esc(c.id)}</p>
        </button>`).join("")}</div>`;
    if (r.candidates.length === 1) PS().openCard(r.candidates[0].id);
  } catch (e) {
    box.innerHTML = "";
    handleError(e);
  }
}

export function openScanner() {
  showSub("portfolio", "scan");
  setTimeout(() => $("ps-scan-input")?.click(), 150);
}

// ===========================================================================
// 3. Set-Fortschritt mit Marktwert
// ===========================================================================
let allSets = null;
let currentSet = null;
let setFilter = "all";

function setsPanelHtml() {
  return `<div id="ps-sets" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-emerald-500/40">
    <div>
      <span class="text-[10px] font-black uppercase bg-emerald-400 text-slate-950 px-2.5 py-0.5 rounded-full">📘 Set-Fortschritt</span>
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Wie komplett ist dein Set – und was kostet der Rest?</h2>
      <p class="text-xs text-slate-300">Tippe Karten an, die du besitzt. Wir rechnen live mit Cardmarket-Preisen: Wert deiner Karten und Kosten bis zum Master-Set.</p>
    </div>
    <div id="ps-sets-tracked" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"></div>
    <div class="flex gap-2 text-xs">
      <input id="ps-set-q" placeholder="Set suchen (z. B. 151, Stürmische Funken, Drachenwandel) …" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" />
    </div>
    <div id="ps-set-list" class="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto text-xs"></div>
    <div id="ps-set-detail"></div>
  </div>`;
}

async function loadTrackedSets() {
  const box = $("ps-sets-tracked");
  if (!box) return;
  if (!state.user) {
    box.innerHTML = `<div class="sm:col-span-3 bg-slate-950 rounded-2xl p-3 text-xs text-slate-300 flex justify-between items-center gap-2 border border-slate-800"><span>🔐 Melde dich an, um deinen Set-Fortschritt zu speichern.</span>${btn("Anmelden", "PS.openAccount()")}</div>`;
    return;
  }
  try {
    const { sets, limit } = await api("/api/sets/tracked");
    box.innerHTML = sets.length ? sets.map((s) => `<button onclick="PS.openSet('${esc(s.setId)}')" class="text-left bg-slate-950 border border-slate-800 hover:border-emerald-400 rounded-2xl p-3 text-xs">
        <p class="font-black text-white truncate">${esc(s.setName)}</p><p class="text-emerald-400 font-bold">${s.owned} Karten gesammelt</p></button>`).join("")
        + `<p class="text-[10px] text-slate-500 self-center">${sets.length}/${limit} Sets</p>`
      : `<p class="sm:col-span-3 text-xs text-slate-500">Noch kein Set verfolgt – such unten dein Lieblings-Set.</p>`;
  } catch {}
}

async function loadSetList() {
  if (!allSets) {
    try {
      const res = await fetch("https://api.tcgdex.net/v2/de/sets");
      allSets = (await res.json()).filter((s) => s.cardCount?.total > 0).reverse();
    } catch { allSets = []; }
  }
  renderSetList();
}

function renderSetList() {
  const q = ($("ps-set-q")?.value || "").toLowerCase().trim();
  const list = (allSets || []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)).slice(0, q ? 40 : 12);
  const box = $("ps-set-list");
  if (!box) return;
  box.innerHTML = list.length ? list.map((s) => `<button onclick="PS.openSet('${esc(s.id)}')" class="bg-slate-900 border border-slate-800 hover:border-emerald-400 rounded-xl p-2 text-left">
      <p class="font-bold text-white truncate">${esc(s.name)}</p><p class="text-slate-500">${s.cardCount.total} Karten</p></button>`).join("")
    : `<p class="col-span-full text-slate-500 text-center py-2">Kein Set gefunden.</p>`;
}

async function openSet(setId) {
  if (!requireLogin()) return;
  const box = $("ps-set-detail");
  box.innerHTML = `<p class="text-yellow-400 text-xs font-bold text-center py-6">⏳ Lade Set & Live-Preise …</p>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    currentSet = await api(`/api/sets/${encodeURIComponent(setId)}`);
    renderSetDetail();
  } catch (e) { box.innerHTML = ""; handleError(e); }
}

function renderSetDetail() {
  const s = currentSet, box = $("ps-set-detail");
  if (!s || !box) return;
  const pctDone = s.total ? Math.round((s.owned / s.total) * 100) : 0;
  const list = s.cards.filter((c) => setFilter === "all" || (setFilter === "missing" ? !c.owned : c.owned));
  box.innerHTML = `<div class="bg-slate-950 rounded-2xl p-3 sm:p-4 border border-emerald-500/30 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-3">${s.logo ? `<img src="${esc(s.logo)}" class="h-10 object-contain" onerror="this.remove()" />` : ""}
        <div><h3 class="text-sm font-black text-white">${esc(s.name)}</h3><p class="text-[11px] text-slate-400">${s.owned} / ${s.total} Karten (${s.official} im Grundset)</p></div></div>
      ${s.tracked ? btn("✓ Wird verfolgt", `PS.untrackSet('${esc(s.id)}')`, "bg-slate-800 text-emerald-300") : btn("📌 Set verfolgen", `PS.trackSet('${esc(s.id)}')`, "bg-emerald-500 text-slate-950")}
    </div>
    <div class="h-3 bg-slate-800 rounded-full overflow-hidden"><div class="h-full bg-gradient-to-r from-emerald-400 to-cyan-400" style="width:${pctDone}%"></div></div>
    <div class="grid grid-cols-3 gap-2 text-xs text-center">
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400 text-[10px] uppercase font-bold">Fortschritt</p><p class="text-lg font-black text-white">${pctDone} %</p></div>
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400 text-[10px] uppercase font-bold">Wert deiner Karten</p><p class="text-lg font-black text-emerald-400">${eur(s.ownedValue)}</p></div>
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400 text-[10px] uppercase font-bold">Kosten bis komplett</p><p class="text-lg font-black text-yellow-300">${eur(s.missingCost)}</p></div>
    </div>
    ${s.priced < s.total ? `<p class="text-[11px] text-amber-300">⏳ Preise für ${s.total - s.priced} Karten werden noch geladen – öffne das Set später erneut für den vollständigen Wert.</p>` : ""}
    <div class="flex gap-1.5 text-xs">${[["all", "Alle"], ["missing", "Fehlend"], ["owned", "Vorhanden"]].map(([k, l]) =>
      `<button onclick="PS.setFilter('${k}')" class="px-3 py-1.5 rounded-xl font-bold ${setFilter === k ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-slate-300"}">${l}</button>`).join("")}
      <span class="ml-auto text-[10px] text-slate-500 self-center">Antippen = besitze ich</span></div>
    <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2 max-h-[34rem] overflow-y-auto">${list.map((c) => `
      <div class="relative rounded-xl border ${c.owned ? "border-emerald-400 bg-emerald-500/10" : "border-slate-800 bg-slate-900"} p-1.5 text-center">
        <button onclick="PS.toggleOwned('${esc(c.id)}')" class="block w-full" aria-label="${c.owned ? "Als fehlend markieren" : "Als vorhanden markieren"}">
          <img src="${esc(c.image || FALLBACK_IMG)}" loading="lazy" onerror="this.src='${FALLBACK_IMG}'" class="h-24 mx-auto object-contain ${c.owned ? "" : "opacity-40 grayscale"}" />
          <p class="text-[10px] font-bold text-white truncate">${esc(c.localId)} ${esc(c.name)}</p>
          <p class="text-[10px] ${c.owned ? "text-emerald-400" : "text-slate-400"} font-bold">${c.price ? eur(c.price) : "–"}</p>
        </button>
        ${c.owned ? `<span class="absolute top-1 left-1 bg-emerald-400 text-slate-950 text-[9px] font-black rounded px-1">✓${c.qty > 1 ? c.qty : ""}</span>` : ""}
        <button onclick="PS.openCard('${esc(c.id)}')" class="absolute top-1 right-1 bg-slate-950/80 text-white text-[10px] rounded px-1" aria-label="Details">ℹ</button>
      </div>`).join("")}</div>
  </div>`;
}

async function toggleOwned(cardId) {
  const c = currentSet?.cards.find((x) => x.id === cardId);
  if (!c) return;
  try {
    if (c.owned) {
      await api(`/api/portfolio/by-card/${encodeURIComponent(cardId)}`, { method: "DELETE" });
      c.qty = Math.max(0, c.qty - 1); c.owned = c.qty > 0;
      if (!c.owned) { currentSet.owned--; currentSet.ownedValue -= c.price; currentSet.missingCost += c.price; }
    } else {
      await api("/api/portfolio", { method: "POST", body: { cardId } });
      c.owned = true; c.qty = 1; currentSet.owned++; currentSet.ownedValue += c.price; currentSet.missingCost -= c.price;
    }
    renderSetDetail();
    PS().loadPortfolio();
  } catch (e) { handleError(e); }
}

async function trackSet(id) {
  try { await api(`/api/sets/${encodeURIComponent(id)}/track`, { method: "POST", body: {} }); currentSet.tracked = true; renderSetDetail(); loadTrackedSets(); }
  catch (e) { handleError(e); }
}
async function untrackSet(id) {
  try { await api(`/api/sets/${encodeURIComponent(id)}/track`, { method: "DELETE" }); currentSet.tracked = false; renderSetDetail(); loadTrackedSets(); }
  catch (e) { handleError(e); }
}

// ===========================================================================
// 4. Sealed-Produkte im Preis-Tracker
// ===========================================================================
let sealed = [];
let sealedKind = "all";

function sealedPanelHtml() {
  return `<div id="ps-sealed" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-3 border-2 border-purple-500/40">
    <div>
      <span class="text-[10px] font-black uppercase bg-purple-500 text-white px-2.5 py-0.5 rounded-full">📦 Sealed-Tracker</span>
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Displays, Top-Trainer-Boxen & Bundles im Blick</h2>
      <p class="text-xs text-slate-300">Referenzpreis vom PokeSwipe-Team + Durchschnitt der Community-Inserate. Lege Alarme an – auch neue Inserate unter deinem Zielpreis melden sich sofort.</p>
    </div>
    <div id="ps-sealed-alerts" class="space-y-1.5"></div>
    <div id="ps-sealed-kinds" class="flex flex-wrap gap-1.5 text-xs"></div>
    <div id="ps-sealed-list" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"></div>
  </div>`;
}

async function loadSealed() {
  try { sealed = (await api("/api/sealed")).products; } catch { sealed = []; }
  renderSealed();
  loadSealedAlerts();
}

function renderSealed() {
  const kinds = ["all", ...new Set(sealed.map((p) => p.kind))];
  if ($("ps-sealed-kinds")) $("ps-sealed-kinds").innerHTML = kinds.map((k) => `<button onclick="PS.sealedKind('${k}')" class="px-3 py-1.5 rounded-xl font-bold ${sealedKind === k ? "bg-purple-500 text-white" : "bg-slate-800 text-slate-300"}">${k === "all" ? "Alle" : KIND_LABEL[k] || k}</button>`).join("");
  const box = $("ps-sealed-list");
  if (!box) return;
  const list = sealed.filter((p) => sealedKind === "all" || p.kind === sealedKind);
  box.innerHTML = list.length ? list.map((p) => `<button onclick="PS.openSealed(${p.id})" class="text-left bg-slate-950 border border-slate-800 hover:border-purple-400 rounded-2xl p-3 text-xs flex gap-3">
      ${p.image ? `<img src="${esc(p.image)}" class="w-14 h-14 object-contain rounded shrink-0" onerror="this.remove()" />` : `<div class="w-14 h-14 rounded-xl bg-slate-900 flex items-center justify-center text-2xl shrink-0">📦</div>`}
      <div class="min-w-0 flex-1">
        <p class="text-[10px] font-black text-purple-300 uppercase">${esc(KIND_LABEL[p.kind] || p.kind)}</p>
        <p class="font-black text-white truncate">${esc(p.name)}</p>
        <p><strong class="text-emerald-400 text-sm">${p.price ? eur(p.price) : "Preis folgt"}</strong>
          ${p.change30 !== null ? `<span class="${p.change30 >= 0 ? "text-emerald-400" : "text-rose-400"} font-bold">${pct(p.change30)}</span>` : ""}</p>
        <p class="text-slate-500">${p.listing_count ? `${p.listing_count} Angebote ab ${eur(p.community_min)}` : "Noch keine Community-Angebote"}</p>
      </div>
      <div class="self-center hidden sm:block">${sparkline(p.history, 70, 28, "#a78bfa")}</div>
    </button>`).join("") : `<p class="text-xs text-slate-500">Noch keine Produkte.</p>`;
}

async function loadSealedAlerts() {
  const box = $("ps-sealed-alerts");
  if (!box) return;
  if (!state.user) { box.innerHTML = ""; return; }
  try {
    const { alerts } = await api("/api/sealed-alerts");
    box.innerHTML = alerts.map((a) => `<div class="flex items-center justify-between gap-2 bg-slate-900 border border-purple-500/40 rounded-xl px-3 py-2 text-xs">
      <span class="truncate"><strong class="text-white">${esc(a.name)}</strong> • jetzt ${a.price ? eur(a.price) : "–"} • Ziel ${a.direction === "below" ? "≤" : "≥"} <strong class="text-yellow-300">${eur(a.target_price)}</strong></span>
      <button onclick="PS.deleteSealedAlert(${a.id})" class="text-slate-400 hover:text-rose-400" aria-label="Alarm löschen">✕</button></div>`).join("");
  } catch {}
}

async function openSealed(id) {
  modal("ps-sealed-m", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Produkt …</p>`, { wide: true });
  try {
    const { product: p, history, offers } = await api(`/api/sealed/${id}`);
    const points = history.map((h) => ({ day: h.day, value: Number(h.refPrice ?? h.communityAvg) })).filter((x) => x.value > 0);
    modal("ps-sealed-m", `
      <p class="text-[10px] font-black text-purple-300 uppercase">${esc(KIND_LABEL[p.kind] || p.kind)} • ${esc(p.set_name)}</p>
      <h3 class="text-base font-black text-white">${esc(p.name)}</h3>
      <div class="grid grid-cols-3 gap-2 text-xs text-center">
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] text-slate-400 uppercase font-bold">Referenzpreis</p><p class="text-base font-black text-emerald-400">${p.ref_price ? eur(p.ref_price) : "–"}</p>
          <p class="text-[10px] text-slate-500">${p.ref_updated_at ? "Stand " + new Date(p.ref_updated_at).toLocaleDateString("de-DE") : "folgt"}</p></div>
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] text-slate-400 uppercase font-bold">Community Ø</p><p class="text-base font-black text-white">${p.community_avg ? eur(p.community_avg) : "–"}</p><p class="text-[10px] text-slate-500">${p.listing_count} Angebote</p></div>
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] text-slate-400 uppercase font-bold">30 Tage</p><p class="text-base font-black ${p.change30 >= 0 ? "text-emerald-400" : "text-rose-400"}">${p.change30 !== null ? pct(p.change30) : "–"}</p></div>
      </div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800">${areaChart(points)}</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="bg-slate-950 rounded-2xl p-3 border border-yellow-400/40 space-y-2">
          <p class="font-black text-yellow-300">🎯 Preisalarm</p>
          <div class="flex gap-2"><select id="ps-sa-dir" class="bg-slate-900 border border-slate-700 rounded-xl px-2 text-white"><option value="below">unter</option><option value="above">über</option></select>
          ${input("ps-sa-price", `type="number" step="0.01" min="0.01" value="${p.price ? (p.price * 0.9).toFixed(2) : ""}" placeholder="Zielpreis €"`)}</div>
          ${btn("Alarm aktivieren", `PS.createSealedAlert(${p.id})`, "w-full bg-yellow-400 text-slate-950")}
        </div>
        <div class="bg-slate-950 rounded-2xl p-3 border border-emerald-500/40 space-y-2">
          <p class="font-black text-emerald-300">🤝 Selbst anbieten</p>
          ${input("ps-sl-price", `type="number" step="0.01" min="0" value="${p.price ? p.price.toFixed(2) : ""}" placeholder="Dein Preis €"`)}
          ${btn("Im Tausch-Hub inserieren", `PS.listSealed(${p.id})`, "w-full bg-emerald-500 text-slate-950")}
        </div>
      </div>
      <div class="space-y-1.5 text-xs">
        <p class="font-black text-white">Aktuelle Angebote</p>
        ${offers.length ? offers.map((o) => `<div class="flex items-center justify-between bg-slate-900 rounded-xl px-3 py-2"><span><strong class="text-emerald-400">${eur(o.price)}</strong> • 📍 ${esc(o.city)} • ${esc(o.seller)}</span>
          ${state.user?.id === o.user_id ? `<span class="text-slate-500">dein Angebot</span>` : btn("🤝 Anfragen", `PS.requestTrade(${o.id})`, "bg-emerald-500 text-slate-950")}</div>`).join("")
          : `<p class="text-slate-500">Noch keine Angebote – sei der Erste!</p>`}
      </div>
      <div class="flex gap-2 text-xs">
        <a href="${cm(p.name)}" target="_blank" rel="noopener" class="flex-1 text-center bg-indigo-600 text-white font-bold py-2 rounded-xl">Cardmarket ↗</a>
        <a href="${ebay(p.name + " Pokemon OVP")}" target="_blank" rel="noopener sponsored" class="flex-1 text-center bg-blue-600 text-white font-bold py-2 rounded-xl">eBay* ↗</a>
      </div>
      <p class="text-[10px] text-slate-500">Referenzpreise werden vom PokeSwipe-Team gepflegt; Community-Werte stammen aus aktiven Inseraten. *Affiliate-Link</p>`, { wide: true });
  } catch (e) { closeModalEl("ps-sealed-m"); handleError(e); }
}

async function createSealedAlert(productId) {
  if (!requireLogin()) return;
  try {
    await api("/api/sealed-alerts", { method: "POST", body: { productId, targetPrice: $("ps-sa-price").value, direction: $("ps-sa-dir").value } });
    closeModalEl("ps-sealed-m");
    toast("🎯 Sealed-Alarm aktiv", "Du bekommst eine Push-Nachricht, sobald der Preis passt.");
    loadSealedAlerts();
  } catch (e) { handleError(e); }
}
async function deleteSealedAlert(id) {
  try { await api(`/api/sealed-alerts/${id}`, { method: "DELETE" }); loadSealedAlerts(); } catch (e) { handleError(e); }
}
async function listSealed(productId) {
  if (!requireLogin()) return;
  const p = sealed.find((x) => x.id === productId);
  try {
    await api("/api/listings", { method: "POST", body: { items: [{ sealedProductId: productId, card: p?.name || "Sealed-Produkt", price: $("ps-sl-price").value, want: "Verkauf / Tausch", city: state.me?.city || "" }] } });
    closeModalEl("ps-sealed-m");
    toast("🚀 Inserat live", `${p?.name || "Produkt"} ist jetzt im Tausch-Hub.`);
    PS().loadListings(); loadSealed();
  } catch (e) { handleError(e); }
}

// ===========================================================================
// 5. Grading-Partner (Affiliate)
// ===========================================================================
function gradingPanelHtml() {
  return `<div id="ps-grading" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-3 border-2 border-yellow-400/40">
    <div>
      <span class="text-[10px] font-black uppercase bg-yellow-400 text-slate-950 px-2.5 py-0.5 rounded-full">🏆 Grading-Partner</span>
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Karte graden lassen – die Anbieter im Vergleich</h2>
      <p class="text-xs text-slate-300">Erst mit dem Centering-Laser und dem PSA-10-Rechner prüfen, dann beim passenden Anbieter einreichen. Aktuelle Preise und Bearbeitungszeiten stehen beim Anbieter.</p>
    </div>
    <div id="ps-partners" class="grid grid-cols-1 sm:grid-cols-2 gap-2"></div>
    <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs space-y-1.5">
      <p class="font-black text-white">📦 Checkliste für die Einreichung</p>
      <p class="text-slate-300">1. Karte in Penny Sleeve + Card Saver (Semi-Rigid) • 2. Centering & Oberfläche prüfen • 3. Versichert versenden</p>
      <div class="flex flex-wrap gap-1.5 pt-1">
        <a href="${ebay("Card Saver 1 Semi Rigid")}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2.5 py-1 rounded-lg">Card Saver* ↗</a>
        <a href="${ebay("Penny Sleeves Pokemon")}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2.5 py-1 rounded-lg">Penny Sleeves* ↗</a>
        <a href="${ebay("Graded Card Slab Case")}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2.5 py-1 rounded-lg">Slab-Schutz* ↗</a>
      </div>
    </div>
    <p class="text-[10px] text-slate-500">*Partner-/Affiliate-Links: Wir erhalten ggf. eine Provision, für dich ohne Mehrkosten.</p>
  </div>`;
}

async function loadPartners() {
  const box = $("ps-partners");
  if (!box || box.dataset.loaded) return;
  try {
    const { partners } = await api("/api/partners");
    box.dataset.loaded = "1";
    box.innerHTML = partners.map((p) => `<div class="bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs space-y-1.5 flex flex-col">
      <p class="text-sm font-black text-white">${esc(p.name)}</p>
      <p class="text-slate-300 flex-1">${esc(p.tagline)}</p>
      <div class="flex flex-wrap gap-1">${p.features.map((f) => `<span class="bg-slate-800 text-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold">${esc(f)}</span>`).join("")}</div>
      <a href="${esc(p.link)}" target="_blank" rel="noopener sponsored" class="block text-center bg-yellow-400 text-slate-950 font-black py-2 rounded-xl mt-1">Zu ${esc(p.name)}${p.affiliate ? "*" : ""} ↗</a>
    </div>`).join("");
  } catch {}
}

// ===========================================================================
// 6. Händler-Shops für Pro-Trader
// ===========================================================================
function shopsPanelHtml() {
  return `<div id="ps-shops" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-3 border-2 border-cyan-400/40">
    <div class="flex flex-wrap justify-between items-start gap-2">
      <div>
        <span class="text-[10px] font-black uppercase bg-cyan-400 text-slate-950 px-2.5 py-0.5 rounded-full">🏪 Händler-Shops</span>
        <h2 class="text-base sm:text-lg font-black text-white mt-1">Verifizierte Händler mit eigenem Shop</h2>
        <p class="text-xs text-slate-300">Alle Shops gehören Pro-Tradern mit ✔-Badge und Bewertungen aus echten Tauschen.</p>
      </div>
      ${btn("Eigenen Shop eröffnen", "PS.openShopSettings()", "bg-slate-800 text-cyan-300 border border-cyan-400/40")}
    </div>
    <div id="ps-shop-list" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"></div>
  </div>`;
}

async function loadShops() {
  const box = $("ps-shop-list");
  if (!box) return;
  try {
    const { shops } = await api("/api/shops");
    box.innerHTML = shops.length ? shops.map((s) => `<button onclick="PS.openShop('${esc(s.shop_slug)}')" class="text-left bg-slate-950 border border-slate-800 hover:border-cyan-400 rounded-2xl p-3 text-xs space-y-1">
        <p class="text-sm font-black text-white truncate">🏪 ${esc(s.title)} <span class="text-cyan-300 text-[10px]">✔</span></p>
        <p class="text-slate-400 truncate">${esc(s.display_name)}${s.city ? " • 📍 " + esc(s.city) : ""}</p>
        <p class="text-slate-300 line-clamp-2">${esc(s.shop_bio || "")}</p>
        <p><span class="text-emerald-400 font-bold">${s.listing_count} Angebote</span> ${s.rating_count ? `<span class="text-amber-300">⭐ ${s.rating} (${s.rating_count})</span>` : ""}</p>
      </button>`).join("") : `<p class="sm:col-span-3 text-xs text-slate-500">Noch keine Händler-Shops. Pro-Trader können ihren Shop im Konto einrichten.</p>`;
  } catch {}
}

async function openShop(slug) {
  modal("ps-shop", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Shop …</p>`, { wide: true });
  try {
    const { shop, listings } = await api(`/api/shops/${encodeURIComponent(slug)}`);
    const url = `${location.origin}/shop/${shop.slug}`;
    modal("ps-shop", `
      <div class="rounded-2xl p-4 bg-gradient-to-r from-cyan-600/80 via-indigo-700/80 to-purple-800/80 border border-cyan-300/50">
        <p class="text-[10px] font-black uppercase text-cyan-200">✔ Verifizierter Händler</p>
        <h3 class="text-lg font-black text-white">🏪 ${esc(shop.title)}</h3>
        <p class="text-xs text-slate-100">${esc(shop.displayName)}${shop.city ? " • 📍 " + esc(shop.city) : ""} • dabei seit ${new Date(shop.memberSince).toLocaleDateString("de-DE", { month: "short", year: "numeric" })}</p>
        <p class="text-xs text-white mt-1">${shop.rating.count ? `⭐ ${shop.rating.avg} (${shop.rating.count} Bewertungen)` : "Noch keine Bewertungen"} • ${shop.completedTrades} Tausche</p>
        ${shop.bio ? `<p class="text-xs text-slate-100 mt-2 whitespace-pre-line">${esc(shop.bio)}</p>` : ""}
      </div>
      <div class="flex gap-2 text-xs">
        ${btn("🔗 Shop-Link teilen", `PS.shareLink('${esc(url)}', ${JSON.stringify(shop.title).replace(/"/g, "&quot;")})`, "bg-slate-800 text-white")}
        ${btn("⭐ Bewertungen", `PS.openUser('${esc(shop.userId)}')`, "bg-slate-800 text-white")}
      </div>
      <div class="space-y-2 max-h-[55vh] overflow-y-auto">${listings.length ? listings.map((l) => PS().listingCard(l)).join("") : `<p class="text-xs text-slate-500 text-center py-4">Gerade keine Angebote.</p>`}</div>`, {
      wide: true,
      onClose: () => { if (location.pathname.startsWith("/shop/") || location.search.includes("shop=")) history.replaceState(null, "", "/"); },
    });
    for (const l of listings) if (!state.listings.find((x) => x.id === l.id)) state.listings.push(l);
  } catch (e) { closeModalEl("ps-shop"); handleError(e); }
}

function openShopSettings() {
  if (!requireLogin()) return;
  const m = state.me;
  if (!m?.shop?.enabled) {
    modal("ps-shop-set", `<h3 class="text-base font-black text-white">🏪 Eigener Händler-Shop</h3>
      <p class="text-xs text-slate-300">Mit <strong class="text-purple-300">Pro Trader</strong> bekommst du eine eigene Shop-Seite (z. B. <code>pokeswipe-radar.de/shop/dein-name</code>) mit allen deinen Angeboten, Bewertungen und ✔-Badge – perfekt zum Teilen auf Instagram, TikTok & Discord.</p>
      ${btn("👑 Pro Trader ansehen", "PS.openPro()", "w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white")}`);
    return;
  }
  modal("ps-shop-set", `<h3 class="text-base font-black text-white">🏪 Shop einrichten</h3>
    <div class="space-y-2 text-xs">
      <label class="text-slate-300 font-bold">Shop-Adresse</label>
      <div class="flex items-center gap-1"><span class="text-slate-500">/shop/</span>${input("ps-shop-slug", `maxlength="30" value="${esc(m.shop.slug || "")}" placeholder="dein-shop"`)}</div>
      <label class="text-slate-300 font-bold">Shop-Name</label>${input("ps-shop-title", `maxlength="60" value="${esc(m.shop.title || "")}" placeholder="z. B. Glurak Corner NRW"`)}
      <label class="text-slate-300 font-bold">Beschreibung</label>
      <textarea id="ps-shop-bio" maxlength="600" rows="4" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" placeholder="Was bietest du an? Versand, Zahlungsarten, Abholung …">${esc(m.shop.bio || "")}</textarea>
      ${btn("Speichern", "PS.saveShop()", "w-full bg-emerald-500 text-slate-950")}
      ${m.shop.slug ? btn("Meinen Shop ansehen", `PS.openShop('${esc(m.shop.slug)}')`, "w-full bg-slate-800 text-white") : ""}
    </div>`);
}

async function saveShop() {
  try {
    await api("/api/me", { method: "PUT", body: { shopSlug: $("ps-shop-slug").value, shopTitle: $("ps-shop-title").value, shopBio: $("ps-shop-bio").value } });
    await PS().refreshMe();
    closeModalEl("ps-shop-set");
    toast("🏪 Shop gespeichert", state.me?.shop?.slug ? `pokeswipe-radar.de/shop/${state.me.shop.slug}` : "");
    loadShops();
  } catch (e) { handleError(e); }
}

async function shareLink(url, title = "PokeSwipe & Radar") {
  try {
    if (navigator.share) { await navigator.share({ title, url }); return; }
    await navigator.clipboard.writeText(url);
    toast("🔗 Link kopiert", url);
  } catch {}
}

// ===========================================================================
// 7. Empfehlungsprogramm
// ===========================================================================
const REF_KEY = "ps_ref";

function captureReferral() {
  const code = new URLSearchParams(location.search).get("ref");
  if (code && /^[A-Za-z0-9]{6,10}$/.test(code)) localStorage.setItem(REF_KEY, code.toUpperCase());
}

export async function claimReferral() {
  const code = localStorage.getItem(REF_KEY);
  if (!code || !state.user) return;
  try {
    const r = await api("/api/referral/claim", { method: "POST", body: { code } });
    if (r.ok && !r.already) toast("🎁 Empfehlung aktiviert", `Dein erster Monat Premium oder Pro ist gratis (${r.trialDays} Tage Testphase).`);
    await PS().refreshMe();
  } catch {}
  localStorage.removeItem(REF_KEY);
}

export function referralHtml() {
  const r = state.me?.referral;
  if (!r?.code) return "";
  return `<div class="bg-slate-950 rounded-2xl p-3.5 border border-emerald-500/40 text-xs space-y-2">
    <p class="font-black text-emerald-300">🎁 Freunde einladen – Gratismonat sichern</p>
    <p class="text-slate-300">Deine Freunde bekommen den ersten Monat Premium/Pro gratis. Sobald jemand danach zahlt, bekommst du einen Monat geschenkt.</p>
    <div class="flex gap-2"><input readonly value="${esc(r.link)}" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-[11px]" onclick="this.select()" />
      ${btn("Teilen", `PS.shareLink('${esc(r.link)}', 'PokeSwipe & Radar – 1 Monat Premium gratis')`, "bg-emerald-500 text-slate-950")}</div>
    <p class="text-slate-500">${r.invited} eingeladen • ${r.rewarded} Gratismonate verdient${state.me.bonusUntil && new Date(state.me.bonusUntil) > new Date() ? ` • Premium geschenkt bis ${new Date(state.me.bonusUntil).toLocaleDateString("de-DE")}` : ""}</p>
  </div>`;
}

export function trialBanner() {
  const eligible = state.me ? state.me.trialEligible : Boolean(localStorage.getItem(REF_KEY));
  return eligible ? `<div class="bg-emerald-500/20 border border-emerald-400 rounded-2xl p-3 text-xs text-emerald-200 font-bold">🎁 Du wurdest eingeladen: Dein erster Monat ist gratis – jederzeit vorher kündbar.</div>` : "";
}

// ===========================================================================
// 8. Admin: Sealed-Preise pflegen & Partner-Statistik
// ===========================================================================
export async function adminExtrasHtml() {
  let aff = null, products = [];
  try { aff = await api("/api/admin/affiliate"); } catch {}
  try { products = (await api("/api/sealed")).products; } catch {}
  return `
    <h4 class="text-sm font-black text-white">📦 Sealed-Referenzpreise</h4>
    <div class="space-y-1.5 max-h-72 overflow-y-auto text-xs">${products.map((p) => `<div class="flex items-center gap-2 bg-slate-900 rounded-xl px-2.5 py-1.5">
      <span class="flex-1 truncate text-white">${esc(p.name)} <span class="text-slate-500">(${esc(KIND_LABEL[p.kind] || p.kind)})</span></span>
      <input id="ps-ad-sp-${p.id}" type="number" step="0.01" min="0" value="${p.ref_price ?? ""}" placeholder="€" class="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white" />
      <button onclick="PS.adminSealedPrice(${p.id})" class="bg-emerald-500 text-slate-950 font-black px-2.5 py-1 rounded-lg">✓</button>
      <button onclick="PS.adminSealedHide(${p.id})" class="text-slate-400 hover:text-rose-400 px-1" title="Ausblenden">✕</button></div>`).join("")}</div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs">
      <input id="ps-ad-sn" placeholder="Neues Produkt" class="col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
      <select id="ps-ad-sk" class="bg-slate-900 border border-slate-700 rounded-lg px-2 text-white">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <input id="ps-ad-sr" type="number" step="0.01" placeholder="Preis €" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
      <input id="ps-ad-ss" placeholder="Set (optional)" class="col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
      <input id="ps-ad-si" placeholder="Bild-URL https:// (optional)" class="col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
    </div>
    ${btn("+ Sealed-Produkt anlegen", "PS.adminSealedAdd()", "w-full bg-purple-600 text-white")}
    ${aff ? `<h4 class="text-sm font-black text-white">🏆 Partner-Klicks & Empfehlungen</h4>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">${aff.partners.map((p) => {
        const c = aff.clicks.find((x) => x.partner === p.id);
        return `<div class="bg-slate-950 rounded-xl p-2 border ${p.configured ? "border-emerald-500/40" : "border-amber-500/40"}"><p class="font-black text-white">${esc(p.name)}</p>
          <p class="text-slate-300">${c ? c.this_month : 0} Klicks (Monat) • ${c ? c.total : 0} gesamt</p>
          <p class="text-[10px] ${p.configured ? "text-emerald-400" : "text-amber-300"}">${p.configured ? "Partner-Link aktiv" : `Partner-Link fehlt: ${esc(p.env)}`}</p></div>`;
      }).join("")}</div>
      <p class="text-xs text-slate-300">🎁 Empfehlungen: ${aff.referrals.referred} geworbene Nutzer, ${aff.referrals.converted} davon zahlend.</p>` : ""}`;
}

async function adminSealedPrice(id) {
  try { await api(`/api/admin/sealed/${id}`, { method: "PATCH", body: { refPrice: $(`ps-ad-sp-${id}`).value || null } }); toast("✅ Preis gespeichert", "Alarme wurden geprüft."); loadSealed(); }
  catch (e) { handleError(e); }
}
async function adminSealedHide(id) {
  if (!confirm("Produkt ausblenden?")) return;
  try { await api(`/api/admin/sealed/${id}`, { method: "PATCH", body: { active: false } }); PS().openAdmin(); loadSealed(); } catch (e) { handleError(e); }
}
async function adminSealedAdd() {
  try {
    await api("/api/admin/sealed", { method: "POST", body: { name: $("ps-ad-sn").value, kind: $("ps-ad-sk").value, refPrice: $("ps-ad-sr").value || null, setName: $("ps-ad-ss").value, image: $("ps-ad-si").value } });
    toast("✅ Produkt angelegt", ""); PS().openAdmin(); loadSealed();
  } catch (e) { handleError(e); }
}

// ===========================================================================
// 9. Übersichtliche Navigation: Unter-Reiter je Bereich
// ===========================================================================
const SUBTABS = {
  swipe: [
    { key: "swipe", label: "Swipen & Booster", fallback: true, match: () => false },
    { key: "search", label: "Kartensuche & Rip or Keep", match: (el) => el.querySelector("#tcgdex-search-inp, #ripkeep-select") },
  ],
  flip: [
    { key: "alerts", label: "Preisalarme", match: (el) => el.id === "ps-tracker" },
    { key: "sealed", label: "Sealed", match: (el) => el.id === "ps-sealed" },
    { key: "deals", label: "Flip-Deals", fallback: true, match: () => false },
  ],
  map: [
    { key: "market", label: "Inserate", fallback: true, match: () => false },
    { key: "shops", label: "Händler-Shops", match: (el) => el.id === "ps-shops" },
    { key: "calc", label: "Tausch-Rechner", match: (el) => el.querySelector("#trade-sum-a") },
    { key: "radar", label: "Sammler-Radar", match: (el) => el.querySelector("#radarMap") },
  ],
  portfolio: [
    { key: "overview", label: "Portfolio", fallback: true, match: () => false },
    { key: "scan", label: "Scan", match: (el) => el.id === "ps-scan" },
    { key: "sets", label: "Sets", match: (el) => el.id === "ps-sets" },
    { key: "grading", label: "Grading & Tools", match: (el) => el.id === "ps-grading" || el.querySelector("#centering-img, #masterset-list") },
  ],
};
const subLoaders = {
  "flip:sealed": () => loadSealed(),
  "map:shops": () => loadShops(),
  "portfolio:sets": () => { loadTrackedSets(); loadSetList(); },
  "portfolio:grading": () => loadPartners(),
  "portfolio:scan": () => renderScanLeft(),
};

function buildSubtabs() {
  for (const [view, tabs] of Object.entries(SUBTABS)) {
    const section = $(`view-${view}`);
    if (!section || section.dataset.subtabs) continue;
    section.dataset.subtabs = "1";
    const children = [...section.children];
    const panels = Object.fromEntries(tabs.map((t) => {
      const p = document.createElement("div");
      p.dataset.sub = t.key;
      p.className = "space-y-5";
      return [t.key, p];
    }));
    const fallback = tabs.find((t) => t.fallback)?.key || tabs[0].key;
    for (const el of children) {
      const target = tabs.find((t) => t.key !== fallback && t.match(el))?.key || fallback;
      panels[target].appendChild(el);
    }
    const bar = document.createElement("div");
    bar.className = "flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 sticky top-0 z-20";
    bar.setAttribute("role", "tablist");
    bar.innerHTML = tabs.map((t) => `<button role="tab" data-subbtn="${t.key}" onclick="PS.showSub('${view}', '${t.key}')" class="shrink-0 px-3.5 py-2 rounded-xl text-xs font-black transition"></button>`).join("");
    tabs.forEach((t) => { bar.querySelector(`[data-subbtn="${t.key}"]`).textContent = t.label; });
    section.appendChild(bar);
    tabs.forEach((t) => section.appendChild(panels[t.key]));
    showSub(view, localStorage.getItem(`ps_sub_${view}`) || tabs[0].key, { silent: true });
  }
}

export function showSub(view, key, { silent = false } = {}) {
  const section = $(`view-${view}`);
  if (!section) return;
  if (!silent && section.classList.contains("hidden")) { try { window.switchTab(view); } catch {} }
  if (!section.querySelector(`[data-sub="${key}"]`)) key = SUBTABS[view]?.[0]?.key;
  section.querySelectorAll("[data-sub]").forEach((p) => p.classList.toggle("hidden", p.dataset.sub !== key));
  section.querySelectorAll("[data-subbtn]").forEach((b) => {
    const on = b.dataset.subbtn === key;
    b.className = `shrink-0 px-3.5 py-2 rounded-xl text-xs font-black transition ${on ? "bg-yellow-400 text-slate-950 shadow" : "bg-slate-900/90 text-slate-300 border border-slate-700 hover:text-white"}`;
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  localStorage.setItem(`ps_sub_${view}`, key);
  if (view === "map" && key === "radar") {
    setTimeout(() => { try { if (typeof mapInstance !== "undefined" && mapInstance) mapInstance.invalidateSize(); else window.initOrUpdateMap?.(); } catch {} }, 80);
  }
  subLoaders[`${view}:${key}`]?.();
}

function renderScanLeft() {
  const el = $("ps-scan-left");
  if (el) el.textContent = state.me ? `${state.me.scansLeft} Scans heute übrig` : "";
}

function injectPanels() {
  const add = (view, html, where = "append") => {
    const section = $(`view-${view}`);
    if (!section) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    section[where](tmp.firstElementChild);
  };
  if (!$("ps-sealed")) add("flip", sealedPanelHtml());
  if (!$("ps-shops")) add("map", shopsPanelHtml());
  if (!$("ps-scan")) add("portfolio", scanPanelHtml());
  if (!$("ps-sets")) add("portfolio", setsPanelHtml());
  if (!$("ps-grading")) add("portfolio", gradingPanelHtml());

  $("ps-scan-input")?.addEventListener("change", (e) => { handleScan(e.target.files[0]); e.target.value = ""; });
  $("ps-set-q")?.addEventListener("input", renderSetList);

  // Push-Zentrale: echte Web-Push-Freigabe
  const pm = $("push-modal")?.querySelector(".space-y-2\\.5");
  if (pm && !$("ps-push-box")) {
    const box = document.createElement("div");
    box.id = "ps-push-box";
    box.className = "bg-slate-950 p-3 rounded-2xl border border-yellow-400/40";
    pm.before(box);
    renderPushBox();
  }
}

/** Klare Namen für die Hauptnavigation und ein aufgeräumter Kopfbereich. */
function tidyLayout() {
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const icons = {
    swipe: svg('<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M13 7l-3 5h4l-3 5"/>'),
    flip: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
    community: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.9.6 3.1 2.5 3.5 5.5"/>'),
    map: svg('<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>'),
    portfolio: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h6M15 12h6"/><circle cx="12" cy="12" r="3"/>'),
  };
  const names = { swipe: ["electric", "Arena"], flip: ["fire", "Preise"], community: ["psychic", "Community"], map: ["water", "Tausch"], portfolio: ["grass", "Sammlung"] };
  for (const [k, [type, label]] of Object.entries(names)) {
    const d = $(`tab-${k}`);
    if (d) { d.dataset.type = type; d.innerHTML = `<span class="ico">${icons[k]}</span><span>${label}</span>`; }
    const m = $(`mob-${k}`);
    if (m) { m.dataset.type = type; m.innerHTML = `<span class="ico">${icons[k]}</span><span class="text-[10px] mt-0.5">${label}</span>`; }
  }
  const origSwitch = window.switchTab;
  window.switchTab = (tab) => {
    origSwitch(tab);
    const key = localStorage.getItem(`ps_sub_${tab}`);
    if (SUBTABS[tab]) showSub(tab, key || SUBTABS[tab][0].key, { silent: true });
  };
}

// ===========================================================================
// Start
// ===========================================================================
export const featureApi = {
  enablePush, disablePush, openScanner, openSet, toggleOwned, trackSet, untrackSet,
  setFilter: (k) => { setFilter = k; renderSetDetail(); },
  sealedKind: (k) => { sealedKind = k; renderSealed(); },
  openSealed, createSealedAlert, deleteSealedAlert, listSealed, openShop, openShopSettings, saveShop, shareLink,
  adminSealedPrice, adminSealedHide, adminSealedAdd, showSub,
};

export function initFeatures() {
  captureReferral();
  tidyLayout();
  injectPanels();
  buildSubtabs();
  window.enableBrowserPush = () => (state.user ? enablePush() : requireLogin());
}

export function afterAuthFeatures() {
  syncPush();
  claimReferral();
  renderPushBox();
  renderScanLeft();
  loadTrackedSets();
  loadSealedAlerts();
}

export function routeFeatures() {
  const params = new URLSearchParams(location.search);
  const m = /^\/shop\/([a-z0-9-]{3,30})\/?$/.exec(location.pathname);
  const slug = m?.[1] || (/^[a-z0-9-]{3,30}$/.test(params.get("shop") || "") ? params.get("shop") : null);
  if (slug) { showSub("map", "shops"); openShop(slug); }
  const tab = params.get("tab"), sub = params.get("sub");
  if (tab && sub && SUBTABS[tab]) showSub(tab, sub);
  if (params.get("scan") === "1") openScanner();
}
