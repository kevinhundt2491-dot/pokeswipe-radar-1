// PokeSwipe & Radar – Erweiterungen: Web-Push, Kamera-Scan, Set-Fortschritt, Sealed-Tracker,
// Grading-Partner, Händler-Shops, Empfehlungsprogramm und die übersichtliche Unter-Navigation.
import { captureGrowthParams, showPromoBanner, redeemPromo, referralApi, withRef } from "./referral.js";
import {
  $, esc, jsArg, safeUrl, eur, pct, toast, ebay, cm, FALLBACK_IMG, cdn, state, api, handleError, requireLogin,
  modal, closeModalEl, input, btn, sparkline, areaChart, syncUrl,
} from "./core.js";
import { localePath } from "./i18n.js";
import { haptic, takePhoto, isNative } from "./native.js";
import { liveScanPlaceholderHtml, lazyLiveScanApi, onLiveScanShownLazy } from "./lazy.js";
import { showSet, renderSetDetail, getCurrentSet, quickSetsHtml, dupesPanelHtml, collectorApi } from "./collector.js";
import {
  injectGrowthPanels, afterAuthGrowth, routeGrowth, growthApi, loadWishlist, loadCalendar, loadRanks, adminGrowthHtml,
} from "./growth.js";
import { captureVia, takeVia, inviteBoxHtml, injectInviteButton, viralApi } from "./viral.js";
import { injectDropsPanels, afterAuthDrops, routeDrops, dropsApi, loadDrops, loadGraded, loadFakeLeft } from "./drops.js";

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
    toast("🔔 Push aktiv", "Restock-Alarme, Binder-Treffer, Tausch-Angebote, Treffen, Freundschaftsanfragen, Chats & Likes kommen jetzt auch bei geschlossener App.");
    api("/api/push/test", { method: "POST", body: {} }).catch(() => {});
    renderPushBox();
    window.PS?.refreshPushViews?.();
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
  window.PS?.refreshPushViews?.();
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
  // Offline-Kopie der Kontodaten von diesem Gerät entfernen
  try { await caches.delete("ps-api"); } catch {}
}

/** „🧪 Test senden“: echte Push-Nachricht über den Server – zeigt sofort, ob Handy/PC sie empfangen. */
async function testPush() {
  if (!requireLogin()) return;
  const st = await pushState();
  if (st !== "on") return enablePush();
  try {
    // Abo zur Sicherheit erneut beim Konto hinterlegen (z. B. nach Kontowechsel oder abgelaufenem Abo)
    const sub = await currentSubscription();
    if (sub) await api("/api/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
    const r = await api("/api/push/test", { method: "POST", body: {} });
    toast("🧪 Test-Push gesendet", r.devices ? `An ${r.devices} Gerät${r.devices > 1 ? "e" : ""} – die Mitteilung sollte in wenigen Sekunden erscheinen.` : "Kein Gerät registriert – bitte Push erneut aktivieren.");
  } catch (e) { handleError(e); }
}

async function renderPushBox() {
  const box = $("ps-push-box");
  if (!box) return;
  const st = await pushState();
  const text = {
    on: ["✅ Push ist auf diesem Gerät aktiv", `<span class="flex gap-1.5">${btn("🧪 Test senden", "PS.testPush()", "bg-yellow-400 text-slate-950")}${btn("Deaktivieren", "PS.disablePush()", "bg-slate-800 text-slate-300")}</span>`],
    off: ["Restocks, Binder-Treffer, Tausch, Freunde, Chats & Likes auch bei geschlossener App", btn("🔔 Push aktivieren", "PS.enablePush()")],
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
        <span class="text-[10px] font-black uppercase bg-cyan-400 text-slate-950 px-2.5 py-0.5 rounded-full">📷 Foto-Scanner (Gerät + KI)</span>
        <h2 class="text-base sm:text-lg font-black text-white mt-1">Karte fotografieren – Preis sofort sehen</h2>
        <p class="text-xs text-slate-300">Erst erkennt dein Gerät die Karte (kostenlos, ohne Upload) – nur wenn das unsicher ist, liest die KI Name und Nummer. Mit einem Tipp ins Portfolio oder als Preisalarm.</p>
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

/**
 * Foto-Scan im Hybrid-Verfahren:
 *  1. Erkennung auf dem Gerät (Fingerabdruck + Nummer, 0 € und kein Scan-Limit)
 *  2. nur wenn unsicher: KI-Scan auf dem Server (Tageslimit je Tarif)
 *  3. wählt der Nutzer danach eine Karte, lernt der Scanner-Index den Fingerabdruck dieses Fotos
 */
async function handleScan(file, { forceAi = false } = {}) {
  if (!file || !requireLogin()) return;
  const box = $("ps-scan-result");
  box.innerHTML = `<p class="text-cyan-300 text-xs font-bold text-center py-4">⚡ Erkenne Karte auf dem Gerät …</p>`;
  try {
    const image = await resizeImage(file);
    lastScanImage = image;
    let local = null;
    if (!forceAi) {
      box.innerHTML = `<div class="flex gap-3 items-center"><img src="${image}" class="w-20 rounded-xl" /><p class="text-cyan-300 text-xs font-bold">⚡ Erkenne Karte auf dem Gerät …</p></div>`;
      try { local = await lazyLiveScanApi.liveScanRecognize(image); } catch { local = null; }
      scanProbe = local?.probe || window.__psScanProbe || null;
      if (local?.accepted && local.info) {
        const i = local.info;
        haptic("success");
        window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "scan" }));
        box.innerHTML = `<div class="bg-slate-950 rounded-2xl p-3 border border-emerald-400/50 text-xs space-y-2">
          <p class="text-emerald-300 font-black">✅ Auf dem Gerät erkannt – kein KI-Scan verbraucht</p>
          <button onclick="PS.scanPick(${jsArg(i.key)}, 'confirm')" class="w-full flex gap-3 items-center text-left bg-slate-900 hover:bg-slate-800 rounded-xl p-2">
            <img src="${esc(cdn(i.image || FALLBACK_IMG, 160))}" onerror="this.src='${FALLBACK_IMG}'" class="w-14 h-20 object-contain" />
            <span><span class="block font-black text-white">${esc(i.name)} ${esc(i.number || "")}</span>
            <span class="block text-slate-400">${esc(i.setName || "")}</span><span class="block text-emerald-400 font-black">${i.price ? eur(i.price) : "–"}</span></span>
          </button>
          <button onclick="PS.scanSell(${jsArg(i.key)}, 'confirm')" class="w-full bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 font-black py-2.5 rounded-xl">🏷️ Direkt inserieren – fairer Preis ist schon eingetragen</button>
          <button onclick="PS.scanAskAi()" class="w-full text-[11px] text-slate-400 underline">Falsche Karte? KI-Scan starten</button>
        </div>`;
        return;
      }
    }
    box.innerHTML = `<div class="flex gap-3 items-center"><img src="${image}" class="w-20 rounded-xl" /><p class="text-yellow-400 text-xs font-bold">🔍 ${local?.glare ? "Starke Spiegelung – " : ""}KI erkennt deine Karte …</p></div>`;
    const r = await api("/api/scan", { method: "POST", body: { image } });
    PS().refreshMe();
    if (!r.found) {
      box.innerHTML = `<div class="bg-slate-950 rounded-2xl p-3 text-xs text-slate-300 border border-slate-800">${esc(r.message || "Keine passende Karte gefunden.")}
        ${r.detected?.name ? `<br>Erkannt: <strong class="text-white">${esc(r.detected.name)} ${esc(r.detected.number || "")}</strong> – versuche die Suche im Portfolio.` : ""}</div>`;
      return;
    }
    box.innerHTML = `<p class="text-xs text-slate-300">Erkannt: <strong class="text-white">${esc(r.detected.name)}</strong>${r.detected.number ? ` • Nr. ${esc(r.detected.number)}${r.detected.total ? "/" + esc(r.detected.total) : ""}` : ""} – tippe auf die passende Karte:</p>
      <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${r.candidates.map((c) => `
        <div class="bg-slate-900 border border-slate-800 hover:border-cyan-400 rounded-xl p-2 text-center space-y-1">
          <button onclick="PS.scanPick(${jsArg(`card:${c.id}`)}, 'ai')" class="w-full">
            <img src="${esc(cdn(c.image || FALLBACK_IMG, 200))}" onerror="this.src='${FALLBACK_IMG}'" class="h-28 mx-auto object-contain" loading="lazy" />
            <p class="text-[11px] font-bold text-white truncate">${esc(c.name)}</p><p class="text-[10px] text-slate-400">${esc(c.id)}</p>
          </button>
          <button onclick="PS.scanSell(${jsArg(`card:${c.id}`)}, 'ai')" class="w-full bg-emerald-500 text-slate-950 text-[10px] font-black py-1.5 rounded-lg">🏷️ Inserieren</button>
        </div>`).join("")}</div>`;
    window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "scan" }));
    if (r.candidates.length === 1) PS().openCard(r.candidates[0].id);
  } catch (e) {
    box.innerHTML = "";
    handleError(e);
  }
}

let lastScanImage = null;
let scanProbe = null;

/** Karte aus dem Foto-Scan übernehmen: Details öffnen und den Fingerabdruck lernen (Stufe 2). */
function scanPick(key, source) {
  if (scanProbe) lazyLiveScanApi.liveScanLearn(key, scanProbe, source).catch?.(() => {});
  const [kind, ...rest] = String(key).split(":");
  const id = rest.join(":");
  if (kind === "print") PS().openPrint?.(id); else PS().openCard(id);
}

/** Karte aus dem Foto-Scan direkt inserieren (Schnell-Inserieren mit fairem Preis), Fingerabdruck lernen. */
async function scanSell(key, source) {
  if (!requireLogin()) return;
  if (scanProbe) lazyLiveScanApi.liveScanLearn(key, scanProbe, source).catch?.(() => {});
  try {
    const { items } = await api(`/api/scan/lookup?keys=${encodeURIComponent(key)}`);
    // Noch nicht im eigenen Katalog: Detailansicht lädt die Karte nach und bietet dort „Inserieren“ an
    if (!items?.length) { scanPick(key, source); return; }
    // Das hochgeladene Foto als echtes Kartenfoto anbieten (Server nimmt bis ca. 600 KB an)
    const photo = typeof lastScanImage === "string" && lastScanImage.startsWith("data:image/") && lastScanImage.length < 780_000 ? lastScanImage : null;
    lazyLiveScanApi.liveScanQuickList(photo ? items.map((it, idx) => (idx === 0 ? { ...it, photo } : it)) : items);
  } catch (e) { handleError(e); }
}

/** Lokales Ergebnis verwerfen und doch die KI fragen. */
async function scanAskAi() {
  if (!lastScanImage) return;
  const blob = await (await fetch(lastScanImage)).blob();
  handleScan(new File([blob], "scan.jpg", { type: "image/jpeg" }), { forceAi: true });
}

/** KI-Foto-Scan (Server, Tageslimit je Tarif) – Rückfall, wenn der Live-Scanner eine Karte nicht kennt. */
export function openPhotoScanner() {
  showSub("scan", "camera");
  // In der App: native Kamera-Oberfläche (Capacitor Camera), im Browser: Datei-Auswahl mit Rückkamera
  if (isNative()) { setTimeout(() => takePhoto().then((f) => f && handleScan(f)), 150); return; }
  setTimeout(() => $("ps-scan-input")?.click(), 150);
}

/** „Karte scannen“: öffnet den Live-Scanner auf dem Gerät und startet die Kamera. */
export function openScanner() {
  lazyLiveScanApi.openLiveScanner();
}

// ===========================================================================
// 3. Set-Fortschritt mit Marktwert
// ===========================================================================
let allSets = null;

function setsPanelHtml() {
  return `<div id="ps-sets" class="poke-glass rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-emerald-500/40">
    <div>
      <span class="text-[10px] font-black uppercase bg-emerald-400 text-slate-950 px-2.5 py-0.5 rounded-full">📘 Set-Fortschritt</span>
      <h2 class="text-base sm:text-lg font-black text-white mt-1">Wie komplett ist dein Set – und was kostet der Rest?</h2>
      <p class="text-xs text-slate-300">Trag für jede Karte die genaue Stückzahl ein (0x, 1x, 2x, 5x …). Wir rechnen live mit Cardmarket-Preisen: Fortschritt, fehlende Karten, Restkosten und Überschuss.</p>
    </div>
    ${quickSetsHtml()}
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
    box.innerHTML = sets.length ? sets.map((s) => `<button onclick="PS.openSet(${jsArg(s.setId)})" class="text-left bg-slate-950 border border-slate-800 hover:border-emerald-400 rounded-2xl p-3 text-xs">
        <p class="font-black text-white truncate">${esc(s.setName)}</p><p class="text-emerald-400 font-bold">${Number(s.owned) || 0} Karten gesammelt</p></button>`).join("")
        + `<p class="text-[10px] text-slate-500 self-center">${sets.length}/${Number(limit) || 0} Sets</p>`
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
  const list = (allSets || []).filter((s) => !q || String(s.name || "").toLowerCase().includes(q) || String(s.id || "").toLowerCase().includes(q)).slice(0, q ? 40 : 12);
  const box = $("ps-set-list");
  if (!box) return;
  box.innerHTML = list.length ? list.map((s) => `<button onclick="PS.openSet(${jsArg(s.id)})" class="bg-slate-900 border border-slate-800 hover:border-emerald-400 rounded-xl p-2 text-left">
      <p class="font-bold text-white truncate">${esc(s.name)}</p><p class="text-slate-500">${Number(s.cardCount?.total) || 0} Karten</p></button>`).join("")
    : `<p class="col-span-full text-slate-500 text-center py-2">Kein Set gefunden.</p>`;
}

async function openSet(setId) {
  if (!requireLogin()) return;
  const box = $("ps-set-detail");
  if (!box) return;
  box.innerHTML = `<p class="text-yellow-400 text-xs font-bold text-center py-6">⏳ Lade Set & Live-Preise …</p>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    showSet(await api(`/api/sets/${encodeURIComponent(setId)}`));
  } catch (e) { box.innerHTML = ""; handleError(e); }
}

async function trackSet(id) {
  try { await api(`/api/sets/${encodeURIComponent(id)}/track`, { method: "POST", body: {} }); getCurrentSet().tracked = true; renderSetDetail(); loadTrackedSets(); }
  catch (e) { handleError(e); }
}
async function untrackSet(id) {
  try { await api(`/api/sets/${encodeURIComponent(id)}/track`, { method: "DELETE" }); getCurrentSet().tracked = false; renderSetDetail(); loadTrackedSets(); }
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
  if ($("ps-sealed-kinds")) $("ps-sealed-kinds").innerHTML = kinds.map((k) => `<button onclick="PS.sealedKind(${jsArg(k)})" class="px-3 py-1.5 rounded-xl font-bold ${sealedKind === k ? "bg-purple-500 text-white" : "bg-slate-800 text-slate-300"}">${k === "all" ? "Alle" : esc(KIND_LABEL[k] || k)}</button>`).join("");
  const box = $("ps-sealed-list");
  if (!box) return;
  const list = sealed.filter((p) => sealedKind === "all" || p.kind === sealedKind);
  box.innerHTML = list.length ? list.map((p) => `<button onclick="PS.openSealed(${Number(p.id)})" class="text-left bg-slate-950 border border-slate-800 hover:border-purple-400 rounded-2xl p-3 text-xs flex gap-3">
      ${p.image ? `<img src="${esc(cdn(p.image, 120))}" class="w-14 h-14 object-contain rounded shrink-0" onerror="this.remove()" />` : `<div class="w-14 h-14 rounded-xl bg-slate-900 flex items-center justify-center text-2xl shrink-0">📦</div>`}
      <div class="min-w-0 flex-1">
        <p class="text-[10px] font-black text-purple-300 uppercase">${esc(KIND_LABEL[p.kind] || p.kind)}</p>
        <p class="font-black text-white truncate">${esc(p.name)}</p>
        <p><strong class="text-emerald-400 text-sm">${p.price ? eur(p.price) : "Preis folgt"}</strong>
          ${p.change30 !== null ? `<span class="${p.change30 >= 0 ? "text-emerald-400" : "text-rose-400"} font-bold">${pct(p.change30)}</span>` : ""}</p>
        <p class="text-slate-500">${p.listing_count ? `${Number(p.listing_count) || 0} Angebote ab ${eur(p.community_min)}` : "Noch keine Community-Angebote"}</p>
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
      <button onclick="PS.deleteSealedAlert(${Number(a.id)})" class="text-slate-400 hover:text-rose-400" aria-label="Alarm löschen">✕</button></div>`).join("");
  } catch {}
}

async function openSealed(id) {
  modal("ps-sealed-m", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Produkt …</p>`, { wide: true });
  try {
    const { product: p, history, offers } = await api(`/api/sealed/${Number(id)}`);
    const points = history.map((h) => ({ day: h.day, value: Number(h.refPrice ?? h.communityAvg) })).filter((x) => x.value > 0);
    modal("ps-sealed-m", `
      <p class="text-[10px] font-black text-purple-300 uppercase">${esc(KIND_LABEL[p.kind] || p.kind)} • ${esc(p.set_name)}</p>
      <h3 class="text-base font-black text-white">${esc(p.name)}</h3>
      <div class="grid grid-cols-3 gap-2 text-xs text-center">
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] text-slate-400 uppercase font-bold">Referenzpreis</p><p class="text-base font-black text-emerald-400">${p.ref_price ? eur(p.ref_price) : "–"}</p>
          <p class="text-[10px] text-slate-500">${p.ref_updated_at ? "Stand " + new Date(p.ref_updated_at).toLocaleDateString("de-DE") : "folgt"}</p></div>
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] text-slate-400 uppercase font-bold">Community Ø</p><p class="text-base font-black text-white">${p.community_avg ? eur(p.community_avg) : "–"}</p><p class="text-[10px] text-slate-500">${Number(p.listing_count) || 0} Angebote</p></div>
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] text-slate-400 uppercase font-bold">30 Tage</p><p class="text-base font-black ${p.change30 >= 0 ? "text-emerald-400" : "text-rose-400"}">${p.change30 !== null ? pct(p.change30) : "–"}</p></div>
      </div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800">${areaChart(points)}</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="bg-slate-950 rounded-2xl p-3 border border-yellow-400/40 space-y-2">
          <p class="font-black text-yellow-300">🎯 Preisalarm</p>
          <div class="flex gap-2"><select id="ps-sa-dir" class="bg-slate-900 border border-slate-700 rounded-xl px-2 text-white"><option value="below">unter</option><option value="above">über</option></select>
          ${input("ps-sa-price", `type="number" step="0.01" min="0.01" value="${p.price ? ((Number(p.price) || 0) * 0.9).toFixed(2) : ""}" placeholder="Zielpreis €"`)}</div>
          ${btn("Alarm aktivieren", `PS.createSealedAlert(${Number(p.id)})`, "w-full bg-yellow-400 text-slate-950")}
        </div>
        <div class="bg-slate-950 rounded-2xl p-3 border border-emerald-500/40 space-y-2">
          <p class="font-black text-emerald-300">🤝 Selbst anbieten</p>
          ${input("ps-sl-price", `type="number" step="0.01" min="0" value="${p.price ? (Number(p.price) || 0).toFixed(2) : ""}" placeholder="Dein Preis €"`)}
          ${btn("Im Tausch-Hub inserieren", `PS.listSealed(${Number(p.id)})`, "w-full bg-emerald-500 text-slate-950")}
        </div>
      </div>
      <div class="space-y-1.5 text-xs">
        <p class="font-black text-white">Aktuelle Angebote</p>
        ${offers.length ? offers.map((o) => `<div class="flex items-center justify-between bg-slate-900 rounded-xl px-3 py-2"><span><strong class="text-emerald-400">${eur(o.price)}</strong> • 📍 ${esc(o.city)} • ${esc(o.seller)}</span>
          ${state.user?.id === o.user_id ? `<span class="text-slate-500">dein Angebot</span>` : btn("🤝 Anfragen", `PS.requestTrade(${Number(o.id)})`, "bg-emerald-500 text-slate-950")}</div>`).join("")
          : `<p class="text-slate-500">Noch keine Angebote – sei der Erste!</p>`}
      </div>
      <button onclick="PS.openComps('sealed', ${jsArg(p.id)})" class="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black py-2.5 rounded-xl text-xs">📈 eBay-Angebote, Verkäufe & Preisherkunft</button>
      <div class="flex gap-2 text-xs">
        <a href="${cm(p.name)}" target="_blank" rel="noopener" class="flex-1 text-center bg-indigo-600 text-white font-bold py-2 rounded-xl">Cardmarket ↗</a>
        <a href="${ebay(p.name + " Pokemon OVP")}" target="_blank" rel="noopener sponsored" class="flex-1 text-center bg-blue-600 text-white font-bold py-2 rounded-xl">eBay* ↗</a>
      </div>
      <p class="text-[10px] text-slate-500">Referenzpreise werden automatisch aus eBay-Verkäufen, -Angeboten und Community-Inseraten berechnet; Sonderprodukte pflegt das PokeSwipe-Team von Hand. *Affiliate-Link</p>`, { wide: true });
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
      <div class="flex flex-wrap gap-1">${(Array.isArray(p.features) ? p.features : []).map((f) => `<span class="bg-slate-800 text-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold">${esc(f)}</span>`).join("")}</div>
      ${safeUrl(p.link || p.officialUrl) ? `<a href="${esc(safeUrl(p.link || p.officialUrl))}" target="_blank" rel="noopener sponsored" class="block text-center bg-yellow-400 text-slate-950 font-black py-2 rounded-xl mt-1">Zu ${esc(p.name)}${p.affiliate ? "*" : ""} ↗</a>` : ""}
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

const SHOP_ACCENTS = ["#22d3ee", "#facc15", "#f472b6", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#60a5fa"];
const SHOP_FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const shopAccent = (v) => (SHOP_ACCENTS.includes(v) ? v : "#22d3ee");
const shopView = { slug: "", lang: "", timer: null };

async function loadShops() {
  const box = $("ps-shop-list");
  if (!box) return;
  try {
    const { shops } = await api("/api/shops");
    box.innerHTML = shops.length ? shops.map((s) => {
      const accent = shopAccent(s.shop_accent);
      return `<button onclick="PS.openShop(${jsArg(s.shop_slug)})" class="text-left bg-slate-950 border border-slate-800 hover:border-cyan-400 rounded-2xl overflow-hidden text-xs">
        <div class="h-14 bg-cover bg-center" style="background-image:${s.shop_banner ? `url('${esc(cdn(s.shop_banner, 480))}')` : `linear-gradient(120deg, ${accent}, #312e81)`}"></div>
        <div class="p-3 pt-0 space-y-1">
          <div class="-mt-5 w-10 h-10 rounded-xl border-2 bg-slate-900 bg-cover bg-center flex items-center justify-center text-lg" style="border-color:${accent};${s.shop_logo ? `background-image:url('${esc(cdn(s.shop_logo, 120))}')` : ""}">${s.shop_logo ? "" : "🏪"}</div>
          <p class="text-sm font-black text-white truncate">${esc(s.title)} <span class="text-[10px]" style="color:${accent}">✔</span></p>
          <p class="text-slate-400 truncate">${esc(s.display_name)}${s.city ? " • 📍 " + esc(s.city) : ""}</p>
          <p class="text-slate-300 line-clamp-2">${esc(s.shop_bio || "")}</p>
          <p><span class="text-emerald-400 font-bold">${Number(s.listing_count) || 0} Angebote</span> ${s.rating_count ? `<span class="text-amber-300">⭐ ${Number(s.rating) || 0} (${Number(s.rating_count) || 0})</span>` : ""}</p>
        </div>
      </button>`;
    }).join("") : `<p class="sm:col-span-3 text-xs text-slate-500">Noch keine Händler-Shops. Pro-Trader können ihren Shop im Konto einrichten.</p>`;
  } catch {}
}

function stopShopSync() { clearInterval(shopView.timer); shopView.timer = null; }

function renderShopListings(listings) {
  const box = $("ps-shop-inv");
  if (!box) return;
  box.innerHTML = listings.length ? listings.map((l) => PS().listingCard({ ...l, card_name: `${SHOP_FLAG[l.lang] || ""} ${l.card_name}`.trim() })).join("")
    : `<p class="text-xs text-slate-500 text-center py-4">Gerade keine Angebote${shopView.lang ? " in dieser Sprache" : ""}.</p>`;
  for (const l of listings) if (!state.listings.find((x) => x.id === l.id)) state.listings.push(l);
}

/** Inventar live halten: alle 30 Sekunden neu laden, solange der Shop offen und die Seite sichtbar ist. */
async function refreshShopInventory() {
  if (!shopView.slug || document.hidden || $("ps-shop")?.classList.contains("hidden")) return;
  try {
    const { listings } = await api(`/api/shops/${encodeURIComponent(shopView.slug)}${shopView.lang ? `?lang=${shopView.lang}` : ""}`);
    renderShopListings(listings);
    const t = $("ps-shop-sync");
    if (t) t.textContent = `🟢 Live • aktualisiert ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {}
}

async function openShop(slug, lang = "") {
  const keep = shopView.slug === slug && $("ps-shop") && !$("ps-shop").classList.contains("hidden");
  shopView.slug = slug; shopView.lang = ["de", "en", "ja"].includes(lang) ? lang : "";
  if (!keep) modal("ps-shop", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Shop …</p>`, { wide: true });
  try {
    const { shop, listings } = await api(`/api/shops/${encodeURIComponent(slug)}${shopView.lang ? `?lang=${shopView.lang}` : ""}`);
    const url = localePath(shop.publicUrl || `${location.origin}/shop/${encodeURIComponent(shop.slug || "")}`);
    const accent = shopAccent(shop.accent);
    const st = shop.stats || { active: 0, sales: 0, followers: 0, inventoryValue: 0, langs: { de: 0, en: 0, ja: 0 } };
    const tab = (l, label, n) => `<button onclick="PS.openShop(${jsArg(shop.slug)}, ${jsArg(l)})" class="shrink-0 text-[11px] font-black px-3 py-1.5 rounded-xl ${shopView.lang === l ? "text-slate-950" : "bg-slate-800 text-slate-200"}" ${shopView.lang === l ? `style="background:${accent}"` : ""}>${label}${l ? ` (${Number(n) || 0})` : ""}</button>`;
    modal("ps-shop", `
      <div class="rounded-2xl overflow-hidden border" style="border-color:${accent}88">
        <div class="h-28 sm:h-36 bg-cover bg-center" style="background-image:${shop.banner ? `url('${esc(cdn(shop.banner, 900))}')` : `linear-gradient(120deg, ${accent}, #312e81 60%, #0b1220)`}"></div>
        <div class="px-4 pb-3 bg-slate-950">
          <div class="flex items-end gap-3 -mt-10">
            <div class="w-20 h-20 rounded-2xl border-4 bg-slate-900 bg-cover bg-center flex items-center justify-center text-4xl shrink-0" style="border-color:${accent};${shop.logo ? `background-image:url('${esc(cdn(shop.logo, 200))}')` : ""}">${shop.logo ? "" : "🏪"}</div>
            <div class="min-w-0 pb-1">
              <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full text-slate-950" style="background:${accent}">✔ Verifizierter Händler</span>
              <h3 class="text-lg font-black text-white truncate">${esc(shop.title)}</h3>
            </div>
          </div>
          <p class="text-xs text-slate-300 mt-2">${esc(shop.displayName)}${shop.city ? " • 📍 " + esc(shop.city) : ""} • dabei seit ${new Date(shop.memberSince).toLocaleDateString("de-DE", { month: "short", year: "numeric" })}</p>
          <p class="text-xs text-white">${shop.rating?.count ? `⭐ ${Number(shop.rating.avg) || 0} (${Number(shop.rating.count) || 0} Bewertungen)` : "Noch keine Bewertungen"} • ⏱️ ${esc(shop.responseLabel || "")}${shop.sellerVerified ? " • 🔒 Käuferschutz" : ""}</p>
          ${shop.bio ? `<p class="text-xs text-slate-200 mt-2 whitespace-pre-line" data-i18n-skip>${esc(shop.bio)}</p>` : ""}
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-2"><p class="text-base font-black text-white">${Number(st.active) || 0}</p><p class="text-slate-400">aktive Angebote</p></div>
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-2"><p class="text-base font-black text-white">${(Number(shop.completedTrades) || 0) + (Number(st.sales) || 0)}</p><p class="text-slate-400">abgeschlossene Deals</p></div>
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-2"><p class="text-base font-black text-white">${eur(st.inventoryValue)}</p><p class="text-slate-400">Inventar-Wert</p></div>
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-2"><p class="text-base font-black text-white">${Number(st.followers) || 0}</p><p class="text-slate-400">Follower</p></div>
      </div>
      <div class="flex flex-wrap gap-2 text-xs">
        ${btn("🔗 Shop-Link teilen", `PS.shareLink(${jsArg(url)}, ${jsArg(shop.title)})`, "bg-slate-800 text-white")}
        ${btn("⭐ Bewertungen", `PS.openUser(${jsArg(shop.userId)})`, "bg-slate-800 text-white")}
        ${state.user?.id === shop.userId ? btn("🎨 Shop gestalten", "PS.openShopSettings()", "bg-slate-800 text-cyan-300") : ""}
      </div>
      <div class="flex gap-1.5 overflow-x-auto no-scrollbar">${tab("", "Alle", st.active)}${tab("de", "🇩🇪 DE", st.langs?.de)}${tab("en", "🇬🇧 EN", st.langs?.en)}${tab("ja", "🇯🇵 JP", st.langs?.ja)}</div>
      <p id="ps-shop-sync" class="text-[10px] text-emerald-400">🟢 Live-Inventar</p>
      <div id="ps-shop-inv" class="space-y-2 max-h-[50vh] overflow-y-auto"></div>`, {
      wide: true,
      onClose: () => { stopShopSync(); shopView.slug = ""; if (location.pathname.startsWith("/shop/") || location.search.includes("shop=")) history.replaceState(null, "", "/"); },
    });
    renderShopListings(listings);
    stopShopSync();
    shopView.timer = setInterval(refreshShopInventory, 30_000);
  } catch (e) { stopShopSync(); closeModalEl("ps-shop"); handleError(e); }
}

function openShopSettings() {
  if (!requireLogin()) return;
  const m = state.me;
  if (!m?.shop?.enabled) {
    modal("ps-shop-set", `<h3 class="text-base font-black text-white">🏪 Eigener Händler-Shop</h3>
      <p class="text-xs text-slate-300">Mit <strong class="text-purple-300">Pro Trader</strong> bekommst du eine eigene Shop-Seite (z. B. <code>pokeswipe-radar.de/shop/dein-name</code>) mit Banner, Logo, allen deinen Angeboten, Bewertungen und ✔-Badge – inklusive Vorschaubild für WhatsApp, Instagram, TikTok & Discord.</p>
      ${btn("👑 Pro Trader ansehen", "PS.openPro()", "w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white")}`);
    return;
  }
  const accent = shopAccent(m.shop.accent);
  modal("ps-shop-set", `<h3 class="text-base font-black text-white">🏪 Shop einrichten</h3>
    <div class="space-y-2 text-xs">
      <label class="text-slate-300 font-bold">Shop-Adresse</label>
      <div class="flex items-center gap-1"><span class="text-slate-500">/shop/</span>${input("ps-shop-slug", `maxlength="30" value="${esc(m.shop.slug || "")}" placeholder="dein-shop"`)}</div>
      <label class="text-slate-300 font-bold">Shop-Name</label>${input("ps-shop-title", `maxlength="60" value="${esc(m.shop.title || "")}" placeholder="z. B. Glurak Corner NRW"`)}
      <label class="text-slate-300 font-bold">Beschreibung</label>
      <textarea id="ps-shop-bio" maxlength="600" rows="4" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" placeholder="Was bietest du an? Versand, Zahlungsarten, Abholung …">${esc(m.shop.bio || "")}</textarea>
      ${btn("Speichern", "PS.saveShop()", "w-full bg-emerald-500 text-slate-950")}
      <div class="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
        <p class="font-black text-white">🎨 Branding</p>
        <label class="text-slate-300 font-bold block">Banner (Querformat, max. 600 KB)<input id="ps-shop-banner" type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-[11px] text-slate-400 mt-1" /></label>
        <label class="text-slate-300 font-bold block">Logo (quadratisch, max. 600 KB)<input id="ps-shop-logo" type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-[11px] text-slate-400 mt-1" /></label>
        <p class="text-slate-300 font-bold">Akzentfarbe</p>
        <div class="flex flex-wrap gap-2">${SHOP_ACCENTS.map((c) => `<button type="button" onclick="PS.shopAccentPick(${jsArg(c)})" data-accent="${c}" aria-label="Farbe ${c}" class="w-8 h-8 rounded-full border-4 ${c === accent ? "border-white" : "border-slate-800"}" style="background:${c}"></button>`).join("")}</div>
        <div class="grid grid-cols-2 gap-2">
          ${btn("Branding speichern", "PS.saveShopBranding()", "bg-cyan-400 text-slate-950")}
          ${btn("Banner & Logo entfernen", "PS.saveShopBranding(true)", "bg-slate-800 text-slate-300")}
        </div>
      </div>
      ${m.shop.slug ? btn("Meinen Shop ansehen", `PS.openShop(${jsArg(m.shop.slug)})`, "w-full bg-slate-800 text-white") : ""}
      ${m.shop.slug ? `<a href="/shop/${esc(encodeURIComponent(m.shop.slug))}" target="_blank" rel="noopener" class="block text-center w-full bg-slate-800 text-white font-black py-2.5 px-3 rounded-xl">🌐 Öffentliche Shop-Seite (mit Vorschaubild)</a>` : ""}
      ${btn("📊 Shop-Statistik", "PS.openShopStats()", "w-full bg-slate-800 text-cyan-300")}
    </div>`);
  shopView.accent = accent;
}

const readImageFile = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve(undefined);
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error("Bitte JPEG, PNG oder WebP wählen."));
  if (file.size > 600_000) return reject(new Error("Das Bild ist größer als 600 KB."));
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
  r.readAsDataURL(file);
});

async function saveShopBranding(remove = false) {
  try {
    const payload = remove ? { banner: "", logo: "" } : {
      banner: await readImageFile($("ps-shop-banner")?.files?.[0]),
      logo: await readImageFile($("ps-shop-logo")?.files?.[0]),
      accent: shopView.accent || "#22d3ee",
    };
    await api("/api/shop/branding", { method: "PUT", body: payload });
    await PS().refreshMe();
    toast("🎨 Shop-Branding gespeichert", "Banner, Logo und Farbe erscheinen sofort im Shop und im Vorschaubild.");
    loadShops();
  } catch (e) { handleError(e); }
}

function shopAccentPick(c) {
  if (!SHOP_ACCENTS.includes(c)) return;
  shopView.accent = c;
  document.querySelectorAll("[data-accent]").forEach((el) => {
    el.classList.toggle("border-white", el.dataset.accent === c);
    el.classList.toggle("border-slate-800", el.dataset.accent !== c);
  });
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
  url = withRef(url);
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
  captureVia();
  captureGrowthParams(); // ?promo=CODE und Codes von öffentlichen Seiten (Cookie)
}

export async function claimReferral() {
  const code = localStorage.getItem(REF_KEY);
  if (!code || !state.user) return;
  try {
    const r = await api("/api/referral/claim", { method: "POST", body: { code, via: takeVia() } });
    if (r.ok && !r.already) {
      toast("🎁 Einladung angenommen", r.qualified
        ? `+${Number(r.days)} Tage PokeSwipe Pro sind freigeschaltet – viel Spaß!`
        : "Scanne deine erste Karte, füge eine zur Sammlung oder Wunschliste hinzu – dann bekommt ihr beide Pro-Tage geschenkt.");
    }
    await PS().refreshMe();
  } catch {}
  localStorage.removeItem(REF_KEY);
}

export function referralHtml() {
  return inviteBoxHtml();
}

export function trialBanner() {
  const invited = state.me ? state.me.referred : Boolean(localStorage.getItem(REF_KEY));
  if (state.me?.referral?.friendPending) {
    return `<div class="bg-emerald-500/20 border border-emerald-400 rounded-2xl p-3 text-xs text-emerald-200 font-bold">🎁 Du wurdest eingeladen: Scanne deine erste Karte oder füge eine zur Sammlung/Wunschliste hinzu – dann schalten wir dir und deinem Freund gratis Pro-Tage frei.</div>`;
  }
  const days = state.me ? state.me.trialDays : invited ? 30 : 7;
  if (!days) return "";
  return `<div class="bg-emerald-500/20 border border-emerald-400 rounded-2xl p-3 text-xs text-emerald-200 font-bold">🎁 ${invited ? "Du wurdest eingeladen: Dein erster Monat ist gratis" : `${days} Tage kostenlos testen`} – jederzeit vorher kündbar, keine Abbuchung in der Testphase.</div>`;
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
      <input id="ps-ad-sp-${Number(p.id)}" type="number" step="0.01" min="0" value="${esc(p.ref_price ?? "")}" placeholder="€" class="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white" />
      <button onclick="PS.adminSealedPrice(${Number(p.id)})" class="bg-emerald-500 text-slate-950 font-black px-2.5 py-1 rounded-lg">✓</button>
      <button onclick="PS.adminSealedHide(${Number(p.id)})" class="text-slate-400 hover:text-rose-400 px-1" title="Ausblenden">✕</button></div>`).join("")}</div>
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
          <p class="text-slate-300">${c ? Number(c.this_month) || 0 : 0} Klicks (Monat) • ${c ? Number(c.total) || 0 : 0} gesamt</p>
          <p class="text-[10px] ${p.configured ? "text-emerald-400" : "text-amber-300"}">${p.configured ? "Partner-Link aktiv" : `Partner-Link fehlt: ${esc(p.env)}`}</p></div>`;
      }).join("")}</div>
      <p class="text-xs text-slate-300">🎁 Empfehlungen: ${Number(aff.referrals?.referred) || 0} geworbene Nutzer, ${Number(aff.referrals?.converted) || 0} davon zahlend.</p>` : ""}
    ${await adminGrowthHtml()}`;
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
    { key: "swipe", label: "Karten swipen", fallback: true, match: () => false },
    { key: "search", label: "Kartensuche & Rip or Keep", match: (el) => el.querySelector("#tcgdex-search-inp, #ripkeep-select") },
  ],
  flip: [
    { key: "drops", label: "🚨 Restock-Radar", match: (el) => el.id === "ps-drops" },
    { key: "deals", label: "📡 Netto-Flip-Radar", fallback: true, match: () => false },
    { key: "alerts", label: "🔔 Preisalarme", match: (el) => el.id === "ps-tracker" },
    { key: "sealed", label: "Sealed-Analyse", pro: true, match: (el) => el.id === "ps-sealed" },
  ],
  scan: [
    { key: "live", label: "⚡ Live-Scan", match: (el) => el.id === "ps-live-scan" },
    { key: "camera", label: "📷 Foto-Scan & Suche", fallback: true, match: () => false },
    { key: "fake", label: "🛡️ Fake-Check", match: (el) => el.id === "ps-fakecheck" },
  ],
  map: [
    { key: "market", label: "Inserate", fallback: true, match: () => false },
    { key: "shops", label: "Händler-Shops", match: (el) => el.id === "ps-shops" },
    { key: "calc", label: "Tausch-Rechner", pro: true, match: (el) => el.querySelector("#trade-sum-a") },
    { key: "radar", label: "Sammler-Radar", match: (el) => el.querySelector("#radarMap") },
  ],
  community: [
    { key: "feed", label: "Beiträge & Chat", fallback: true, match: () => false },
    { key: "calendar", label: "Kalender & Events", match: (el) => el.id === "ps-calendar" },
    { key: "ranks", label: "Abzeichen & Bestenliste", match: (el) => el.id === "ps-ranks" },
  ],
  portfolio: [
    { key: "overview", label: "Übersicht", fallback: true, match: () => false },
    { key: "wishlist", label: "Wunschliste", match: (el) => el.id === "ps-wishlist" },
    { key: "graded", label: "🏅 Graded", match: (el) => el.id === "ps-graded" },
    { key: "sets", label: "Sets", match: (el) => el.id === "ps-sets" },
    { key: "grading", label: "Grading & Tools", pro: true, match: (el) => el.id === "ps-grading" || el.id === "ps-gradecalc" || el.querySelector("#centering-img, #masterset-list") },
  ],
};
const subLoaders = {
  "flip:sealed": () => loadSealed(),
  "map:shops": () => loadShops(),
  "portfolio:sets": () => { loadTrackedSets(); loadSetList(); },
  "portfolio:grading": () => loadPartners(),
  "scan:camera": () => renderScanLeft(),
  "scan:live": () => onLiveScanShownLazy(),
  "scan:fake": () => loadFakeLeft(),
  "portfolio:graded": () => loadGraded(),
  "flip:drops": () => loadDrops(),
  "portfolio:wishlist": () => loadWishlist(),
  "community:calendar": () => loadCalendar(),
  "community:ranks": () => loadRanks(),
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
    // Zweite Ebene unter den Unterreitern (Segmented Control aus client/app-nav.js): kompakte, horizontal scrollbare Chips
    bar.className = "ps-subchips flex gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1";
    bar.dataset.subchips = view;
    bar.setAttribute("role", "tablist");
    bar.innerHTML = tabs.map((t) => `<button role="tab" data-subbtn="${t.key}" ${t.pro ? 'data-pro="1"' : ""} onclick="PS.showSub('${view}', '${t.key}')" class="shrink-0 px-3.5 py-2 rounded-xl text-xs font-black transition"></button>`).join("");
    tabs.forEach((t) => { bar.querySelector(`[data-subbtn="${t.key}"]`).textContent = t.label; });
    section.appendChild(bar);
    tabs.forEach((t) => section.appendChild(panels[t.key]));
    showSub(view, localStorage.getItem(`ps_sub_${view}`) || tabs[0].key, { silent: true });
  }
}

export function showSub(view, key, { silent = false } = {}) {
  // Der Scanner war früher ein Unter-Reiter der Sammlung – alte Links (?tab=portfolio&sub=scan) führen zum neuen Bereich
  if (view === "portfolio" && key === "scan") { view = "scan"; key = "camera"; }
  // view/key können aus der URL (?tab=…&sub=…) kommen – nur bekannte Bereiche, sonst wirft querySelector
  if (!Object.prototype.hasOwnProperty.call(SUBTABS, view)) return;
  if (!/^\w{1,32}$/.test(String(key || ""))) key = SUBTABS[view][0].key;
  const section = $(`view-${view}`);
  if (!section) return;
  if (!silent && section.classList.contains("hidden")) { try { window.switchTab(view); } catch {} }
  if (!section.querySelector(`[data-sub="${key}"]`)) key = SUBTABS[view]?.[0]?.key;
  section.querySelectorAll("[data-sub]").forEach((p) => p.classList.toggle("hidden", p.dataset.sub !== key));
  section.querySelectorAll("[data-subbtn]").forEach((b) => {
    const on = b.dataset.subbtn === key;
    b.className = `ps-subchip shrink-0 ${b.dataset.pro ? "ps-pro-only " : ""}`;
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  localStorage.setItem(`ps_sub_${view}`, key);
  // Unterbereich in der Adresse (?tab=…&sub=…) – nur für den gerade sichtbaren Reiter, ohne Neuladen
  if (state.urlSync && !section.classList.contains("hidden")) syncUrl({ tab: view, sub: key, section: null });
  try { window.dispatchEvent(new CustomEvent("ps:sub", { detail: { view, key } })); } catch {}
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
  if (!$("ps-live-scan")) add("scan", liveScanPlaceholderHtml(), "prepend");
  if (!$("ps-sealed")) add("flip", sealedPanelHtml());
  if (!$("ps-shops")) add("map", shopsPanelHtml());
  if (!$("ps-dupes") && $("portfolio-list")) {
    const tmp = document.createElement("div");
    tmp.innerHTML = dupesPanelHtml();
    $("portfolio-list").after(tmp.firstElementChild);
  }
  if (!$("ps-scan")) add("scan", scanPanelHtml());
  if (!$("ps-sets")) add("portfolio", setsPanelHtml());
  if (!$("ps-grading")) add("portfolio", gradingPanelHtml());

  $("ps-scan-input")?.addEventListener("change", (e) => { handleScan(e.target.files[0]); e.target.value = ""; });
  $("ps-scan-input")?.closest("label")?.addEventListener("click", (e) => {
    if (!isNative()) return;
    e.preventDefault();
    takePhoto().then((f) => f && handleScan(f));
  });
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
    scan: svg('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="8.5" y="7" width="7" height="10" rx="1.2"/>'),
    map: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.9.6 3.1 2.5 3.5 5.5"/>'),
    portfolio: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h6M15 12h6"/><circle cx="12" cy="12" r="3"/>'),
    profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.4 4.2-6.5 8-6.5s7 2.1 8 6.5"/>'),
    radar: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>'),
    market: svg('<path d="M4 7h16l-1.5 9.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>'),
  };
  icons.home = svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>');
  icons.community = svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>');
  // 5 Hauptreiter: Start · Scanner · Marktplatz · Sammlung · Community (Profil über den Avatar oben rechts)
  const names = { home: ["electric", "Start"], scan: ["water", "Scanner"], map: ["psychic", "Marktplatz"], portfolio: ["grass", "Sammlung"], community: ["fire", "Community"] };
  const iconOf = { home: "home", scan: "scan", map: "market", portfolio: "portfolio", community: "community" };
  const short = {};
  for (const [k, [type, label]] of Object.entries(names)) {
    const d = $(`tab-${k}`);
    if (d) { d.dataset.type = type; d.innerHTML = `<span class="ico">${icons[iconOf[k]]}</span><span>${label}</span>`; }
    const m = $(`mob-${k}`);
    if (m) { m.dataset.type = type; m.setAttribute("aria-label", label); m.innerHTML = `<span class="ico">${icons[iconOf[k]]}</span><span class="text-[10px] mt-0.5">${short[k] || label}</span>`; }
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
  enablePush, disablePush, testPush, pushState, openScanner, openPhotoScanner, scanFile: (file) => handleScan(file), scanPick, scanSell, scanAskAi, openSet, trackSet, untrackSet,
  ...lazyLiveScanApi,
  ...collectorApi,
  sealedKind: (k) => { sealedKind = k; renderSealed(); },
  openSealed, createSealedAlert, deleteSealedAlert, listSealed, openShop, openShopSettings, saveShop, saveShopBranding, shopAccentPick, shareLink,
  adminSealedPrice, adminSealedHide, adminSealedAdd, showSub,
  ...growthApi,
  ...dropsApi,
  ...viralApi,
  ...referralApi,
};

export function initFeatures() {
  captureReferral();
  tidyLayout();
  injectPanels();
  injectGrowthPanels();
  injectDropsPanels();
  buildSubtabs();
  injectInviteButton();
  showPromoBanner();
  window.enableBrowserPush = () => (state.user ? enablePush() : requireLogin());
}

export function afterAuthFeatures() {
  syncPush();
  claimReferral().then(() => redeemPromo());
  renderPushBox();
  renderScanLeft();
  loadTrackedSets();
  loadSealedAlerts();
  afterAuthGrowth();
  afterAuthDrops();
}

export function routeFeatures() {
  const params = new URLSearchParams(location.search);
  const m = /^\/shop\/([a-z0-9-]{3,30})\/?$/.exec(location.pathname);
  const slug = m?.[1] || (/^[a-z0-9-]{3,30}$/.test(params.get("shop") || "") ? params.get("shop") : null);
  if (slug) { showSub("map", "shops"); openShop(slug); }
  const tab = params.get("tab"), sub = params.get("sub");
  if (tab && sub && Object.prototype.hasOwnProperty.call(SUBTABS, tab)) showSub(tab, sub);
  if (params.get("scan") === "1") openScanner();
  if (tab === "account" && sub === "invite") setTimeout(() => PS().openInvite?.(), 400);
  const sealedId = Number(params.get("sealed"));
  if (Number.isInteger(sealedId) && sealedId > 0) { showSub("flip", "sealed"); setTimeout(() => openSealed(sealedId), 300); }
  routeGrowth();
  routeDrops();
}
