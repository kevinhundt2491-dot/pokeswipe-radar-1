// Phase 4: PWA Deluxe + native App (Capacitor)
//  – Installations-Hinweis: Android/Chrome mit echtem Installieren-Dialog, iPhone/iPad mit geführter Anleitung
//    „Zum Home-Bildschirm“ (Voraussetzung für Web-Push unter iOS 16.4+)
//  – Offline-Katalog vorladen (Sets, Swipe-Stapel, Scanner-Index) und Offline-Hinweis
//  – In der nativen App (iOS/Android über Capacitor): Push über Firebase Cloud Messaging, Zurück-Taste, Deep-Links
import { $, toast, state, api, modal, closeModalEl, btn, hooks } from "./core.js";

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const cap = () => window.Capacitor;
export const isNativeApp = () => Boolean(cap()?.isNativePlatform?.());
const DISMISS_KEY = "ps_install_dismissed";
const VISITS_KEY = "ps_visits";

// ---------------------------------------------------------------------------
// Installieren
// ---------------------------------------------------------------------------
function iosGuide() {
  modal("ps-ios-install", `
    <h3 class="text-base font-black text-white">📲 PokeSwipe auf den Home-Bildschirm</h3>
    <p class="text-xs text-slate-300">So läuft PokeSwipe wie eine echte App – im Vollbild, schneller, offline nutzbar und mit Push-Nachrichten für Preisalarme, Restocks und Tausch-Anfragen.</p>
    <ol class="text-xs text-slate-200 space-y-2">
      <li class="flex gap-2 items-start bg-slate-900 rounded-xl p-2.5"><span class="text-lg">1️⃣</span><span>Öffne diese Seite in <strong>Safari</strong> (nicht in der Instagram-/TikTok-Vorschau).</span></li>
      <li class="flex gap-2 items-start bg-slate-900 rounded-xl p-2.5"><span class="text-lg">2️⃣</span><span>Tippe unten auf <strong>Teilen</strong> <span class="inline-block border border-slate-500 rounded px-1">⬆️</span>.</span></li>
      <li class="flex gap-2 items-start bg-slate-900 rounded-xl p-2.5"><span class="text-lg">3️⃣</span><span>Scrolle und wähle <strong>„Zum Home-Bildschirm“</strong> ➕, dann <strong>Hinzufügen</strong>.</span></li>
      <li class="flex gap-2 items-start bg-slate-900 rounded-xl p-2.5"><span class="text-lg">4️⃣</span><span>Öffne PokeSwipe über das neue Symbol und tippe im Konto auf <strong>„🔔 Push auf diesem Gerät“</strong>. (Ab iOS 16.4)</span></li>
    </ol>
    ${btn("Verstanden", "PS.closeInstall()", "w-full bg-yellow-400 text-slate-950")}`);
}

async function install() {
  if (isIOS()) return iosGuide();
  const p = window.psInstallPrompt;
  if (p) {
    p.prompt();
    try { const r = await p.userChoice; if (r?.outcome === "accepted") toast("🎉 Installiert", "PokeSwipe ist jetzt auf deinem Startbildschirm."); } catch {}
    window.psInstallPrompt = null;
    $("ps-install-bar")?.remove();
    return;
  }
  toast("📲 Installieren", "Öffne das Browser-Menü (⋮) und wähle „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.");
}

function showInstallBar() {
  if (isStandalone() || isNativeApp() || $("ps-install-bar")) return;
  const dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
  if (dismissed && Date.now() - dismissed < 14 * 86400_000) return;
  const visits = Number(localStorage.getItem(VISITS_KEY) || 0);
  // Erst ab dem 2. Besuch (oder wenn der Browser die Installation anbietet) – nicht gleich beim ersten Eindruck
  if (visits < 2 && !window.psInstallPrompt) return;
  if (!isIOS() && !window.psInstallPrompt) return;
  const bar = document.createElement("div");
  bar.id = "ps-install-bar";
  bar.className = "fixed left-3 right-3 bottom-20 sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm z-[55] poke-glass border-2 border-yellow-400/70 rounded-2xl p-3 flex items-center gap-3 shadow-2xl";
  bar.innerHTML = `<img src="/icons/icon-192.png" alt="" class="w-10 h-10 rounded-xl">
    <div class="flex-1 text-xs"><p class="font-black text-white">PokeSwipe als App</p><p class="text-slate-300">${isIOS() ? "Push & Offline auf dem iPhone" : "Schneller Start, offline & Push"}</p></div>
    <button onclick="PS.installApp()" class="bg-yellow-400 text-slate-950 font-black text-xs px-3 py-2 rounded-xl">${isIOS() ? "So geht's" : "Installieren"}</button>
    <button onclick="PS.dismissInstall()" class="text-slate-400 text-sm px-1" aria-label="Schließen">✕</button>`;
  document.body.appendChild(bar);
}

// ---------------------------------------------------------------------------
// Offline-Katalog vorladen (der Service Worker legt die Antworten ab)
// ---------------------------------------------------------------------------
function warmOfflineCache() {
  if (!("serviceWorker" in navigator) || navigator.connection?.saveData) return;
  const urls = ["/api/catalog/meta", "/api/catalog/sets", "/api/swipe/sets", "/api/market/meta", "/api/community/feed?scope=all"];
  const run = () => urls.forEach((u, i) => setTimeout(() => fetch(u, { credentials: "same-origin" }).catch(() => {}), i * 800));
  if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 8000 }); else setTimeout(run, 4000);
}

function offlineHints() {
  window.addEventListener("offline", () => toast("📴 Offline", "Du siehst gespeicherte Daten – Sammlung, Katalog und Scanner funktionieren weiter."));
  window.addEventListener("online", () => toast("📶 Wieder online", "Daten werden aktualisiert."));
}

// ---------------------------------------------------------------------------
// Native App (Capacitor)
// ---------------------------------------------------------------------------
async function registerNativePush() {
  const P = cap()?.Plugins?.PushNotifications;
  if (!P) return toast("Push", "Push-Modul fehlt in dieser App-Version.");
  if (!state.user) { window.PS?.openAccount?.("Bitte melde dich an, um Push zu aktivieren."); return; }
  try {
    let perm = await P.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await P.requestPermissions();
    if (perm.receive !== "granted") return toast("🔕 Push blockiert", "Erlaube Mitteilungen für PokeSwipe in den Einstellungen deines Handys.");
    await P.register();
  } catch (e) { toast("Push nicht möglich", String(e?.message || e).slice(0, 120)); }
}

function initNative() {
  if (!isNativeApp()) return;
  document.documentElement.classList.add("ps-native", `ps-${cap().getPlatform?.() || "app"}`);
  // Apple-Richtlinie 3.1.1: digitale Abos in iOS-Apps nur über In-App-Kauf → in der iOS-Hülle keine Stripe-Abo-Kasse
  // (der Marktplatz für physische Karten ist davon nicht betroffen). Bestehende Abos gelten weiter.
  if (cap().getPlatform?.() === "ios") {
    const info = () => toast("ℹ️ Tarife", "Abos lassen sich in der iOS-App nicht abschließen. Bestehende Premium- und Pro-Vorteile gelten hier automatisch.");
    if (window.PS) window.PS.openPro = info;
    window.activatePro = info;
    hooks.openPro = info;
  }
  const P = cap().Plugins || {};
  if (P.PushNotifications) {
    P.PushNotifications.addListener("registration", async (t) => {
      try {
        const r = await api("/api/push/native", { method: "POST", body: { token: t.value, platform: cap().getPlatform() } });
        localStorage.setItem("ps_native_push", t.value);
        toast("🔔 Push aktiv", r.active ? "Alarme kommen jetzt auch bei geschlossener App." : "Gerät registriert – Push wird vom Betreiber gerade eingerichtet.");
      } catch (e) { console.warn("Native Push", e); }
    });
    P.PushNotifications.addListener("registrationError", (e) => console.warn("Push-Registrierung", e));
    P.PushNotifications.addListener("pushNotificationReceived", (n) => toast(`🔔 ${n.title || "PokeSwipe"}`, n.body || ""));
    P.PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      const url = a?.notification?.data?.url;
      if (typeof url === "string" && url.startsWith("/")) location.href = url;
    });
    // Bereits erlaubte Geräte nach dem Login automatisch neu registrieren (Token kann sich ändern)
    P.PushNotifications.checkPermissions?.().then((p) => { if (p.receive === "granted" && state.user) P.PushNotifications.register(); }).catch(() => {});
  }
  if (P.App) {
    P.App.addListener("backButton", ({ canGoBack }) => {
      const open = [...document.querySelectorAll(".fixed.inset-0:not(.hidden)")].pop();
      if (open?.id) return closeModalEl(open.id);
      if (canGoBack) history.back(); else P.App.exitApp();
    });
    // Universal/App Links: https://pokeswipe-radar.de/... in der App öffnen
    P.App.addListener("appUrlOpen", ({ url }) => {
      try { const u = new URL(url); if (u.hostname.endsWith("pokeswipe-radar.de")) location.href = u.pathname + u.search; } catch {}
    });
  }
  // Externe Links (eBay, Cardmarket, Stripe) im System-Browser öffnen
  document.addEventListener("click", (e) => {
    const a = e.target?.closest?.("a[target=_blank]");
    if (!a || !P.Browser) return;
    e.preventDefault();
    P.Browser.open({ url: a.href }).catch(() => window.open(a.href, "_blank"));
  }, true);
}

export const pwaApi = {
  installApp: install,
  dismissInstall: () => { localStorage.setItem(DISMISS_KEY, String(Date.now())); $("ps-install-bar")?.remove(); },
  closeInstall: () => closeModalEl("ps-ios-install"),
  iosInstallGuide: iosGuide,
};

/** Push-Aktivierung: in der nativen App über FCM, sonst wie bisher Web-Push (inkl. iOS-Anleitung). */
export function wrapEnablePush(webEnablePush) {
  return () => (isNativeApp() ? registerNativePush() : webEnablePush());
}

export function afterLoginPwa() {
  if (isNativeApp()) cap()?.Plugins?.PushNotifications?.checkPermissions?.().then((p) => { if (p.receive === "granted") cap().Plugins.PushNotifications.register(); }).catch(() => {});
}

export function initPwa() {
  localStorage.setItem(VISITS_KEY, String(Number(localStorage.getItem(VISITS_KEY) || 0) + 1));
  initNative();
  offlineHints();
  warmOfflineCache();
  window.addEventListener("ps:installable", () => setTimeout(showInstallBar, 1500));
  setTimeout(showInstallBar, 20_000);
  if (isStandalone()) document.documentElement.classList.add("ps-standalone");
}
