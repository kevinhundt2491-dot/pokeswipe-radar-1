// PokeSwipe & Radar – Nachladen bei Bedarf (Code-Splitting, Phase 6)
// Große, selten genutzte Bereiche liegen in eigenen Chunks (esbuild --splitting) und werden erst geladen, wenn sie
// gebraucht werden:
// • Admin-Reel-Studio & Auto-Reels (reel-studio, auto-reels, live-stage, dom-capture, reel-recorder, reel-audio, …): nur für Admins
// • Live-Scanner (Kamera + Bild-Fingerabdrücke): beim Öffnen des Scanner-Bereichs
// Leaflet-Karte: wird bereits beim Öffnen der Karte nachgeladen (/vendor/leaflet, legacy-app.js).
import { $, toast, state } from "./core.js";

const failed = (what) => (e) => {
  console.error(`${what} konnte nicht geladen werden`, e);
  toast("⚠️ Ladefehler", `${what} konnte nicht geladen werden. Bitte Verbindung prüfen und erneut versuchen.`);
  throw e;
};
const once = (fn) => { let p = null; return () => (p ??= fn().catch((e) => { p = null; throw e; })); };

// ---------------------------------------------------------------------------
// Admin-Werkzeuge: Reel-Studio & Auto-Reels
// ---------------------------------------------------------------------------
const REEL_HASHES = ["#reel-studio", "#generator", "#auto-reels"];
const loadReels = once(async () => {
  const [studio, auto] = await Promise.all([import("./reel-studio.js"), import("./auto-reels.js")]);
  studio.initReelStudio();
  auto.initAutoReels();
  return { studio, auto };
});
let reelsLoaded = null;

/** Nach jedem Login-/Kontowechsel: für Admins laden und Buttons einblenden, sonst geladene Overlays schließen. */
export function syncAdminTools() {
  if (state.me?.isAdmin || REEL_HASHES.includes(location.hash)) {
    loadReels().then((m) => { reelsLoaded = m; m.studio.syncReelStudio(); m.auto.syncAutoReels(); if (REEL_HASHES.includes(location.hash)) m.auto.routeAutoReels(); })
      .catch(() => {});
  } else if (reelsLoaded) {
    reelsLoaded.studio.syncReelStudio();
    reelsLoaded.auto.syncAutoReels();
  }
}

/** Generator öffnen (Admin-Button, Konto-Menü) */
export const openGenerator = () => loadReels().then((m) => m.auto.openAutoReels()).catch(failed("Der Auto-Reels-Generator"));

export function initLazyAdminTools() {
  // Hash-Links (#generator, #reel-studio) funktionieren auch, bevor das Admin-Modul geladen ist
  window.addEventListener("hashchange", () => { if (REEL_HASHES.includes(location.hash)) syncAdminTools(); });
  // Footer-Buttons (für Admins sichtbar) laden das Modul beim ersten Klick
  $("reel-studio-btn")?.addEventListener("click", () => {
    if (reelsLoaded) return; // danach übernimmt der Klick-Handler des Moduls
    loadReels().then((m) => {
      reelsLoaded = m;
      if (state.me?.isAdmin) { history.replaceState(null, "", "#reel-studio"); m.studio.syncReelStudio(); }
    }).catch(failed("Das Reel-Studio"));
  }, { once: true });
  $("auto-reels-btn")?.addEventListener("click", () => { if (!reelsLoaded) openGenerator(); }, { once: true });
}

// ---------------------------------------------------------------------------
// Live-Scanner
// ---------------------------------------------------------------------------
const LIVE_SCAN_KEYS = [
  "liveScanStart", "liveScanStop", "liveScanTorch", "liveScanLang", "liveScanAdd", "liveScanAddAll", "liveScanWish", "liveScanFlip",
  "liveScanDetails", "liveScanPhoto", "liveScanDismiss", "liveScanVariant", "liveScanClear", "liveScanAdminRun", "openLiveScanner",
  "liveScanRecognize", "liveScanLearn", "liveScanSell", "liveScanSellAll", "liveScanQuickList",
  "quickListSet", "quickListPhoto", "quickListGo", "quickListPrice", "quickListUse", "quickListStrategy", "quickListConditionAll", "quickListRemove", "quickListSubmit",
];

/** Platzhalter mit derselben ID – die Unter-Reiter-Navigation findet den Bereich sofort, der Inhalt kommt beim Öffnen. */
export function liveScanPlaceholderHtml() {
  return `<div id="ps-live-scan" class="poke-glass rounded-3xl p-3 sm:p-5 space-y-3 border-2 border-cyan-400/40">
    <p class="text-xs text-cyan-200 text-center py-6 font-bold">⚡ Live-Scanner wird geladen …</p></div>`;
}

export const loadScanner = once(async () => {
  const m = await import("./scanner/live-scanner.js");
  const slot = $("ps-live-scan");
  if (slot) {
    const tmp = document.createElement("div");
    tmp.innerHTML = m.liveScanPanelHtml();
    const fresh = tmp.firstElementChild;
    if (fresh) {
      // Inhalt übernehmen, Element (inkl. Attributen der Unter-Reiter-Navigation) behalten
      slot.innerHTML = fresh.innerHTML;
      for (const c of fresh.classList) slot.classList.add(c);
    }
  }
  m.initLiveScanner();
  return m;
});

export const lazyLiveScanApi = Object.fromEntries(LIVE_SCAN_KEYS.map((k) => [k, (...args) =>
  loadScanner().then((m) => m.liveScanApi[k](...args)).catch(failed("Der Live-Scanner"))]));

/** Unter-Reiter „Live-Scanner“ wurde geöffnet */
export const onLiveScanShownLazy = () => loadScanner().then((m) => m.onLiveScanShown()).catch(failed("Der Live-Scanner"));
