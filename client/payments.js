// PokeSwipe & Radar – Phase 9: Zahlungs-Weiche je Plattform (App Store / EU-DMA / Stripe).
//
//  • Web & Android-App: bestehender Stripe-Checkout – unverändert (AGB, Widerruf, § 312k-Kündigungsbutton).
//  • iOS-App mit In-App-Kauf: Apple StoreKit über das RevenueCat-Plugin (Capacitor), Preise direkt aus dem App Store,
//    „Käufe wiederherstellen“, Bestätigung serverseitig per RevenueCat-Webhook.
//  • iOS-App in der EU mit Apple-Berechtigung für externe Käufe: Apple-konforme Hinweis-Seite und Kauf im
//    System-Browser (Safari) – nie ein Stripe-Fenster innerhalb der App.
//  • iOS-App ohne beides: neutraler Hinweis ohne Kauf-Link (kein „Steering“ nach Apple-Regel 3.1.1).
// Der Marktplatz (physische Karten, Treuhand) und Inserat-Boosts im Web sind davon nicht betroffen.
import { esc, jsArg, toast, state, api, modal, closeModalEl, btn, hooks, handleError } from "./core.js";
import { isNativeIOS, haptic } from "./native.js";

const PLAN_LABEL = { premium: "Premium", pro: "Pro Trader" };
let config = null;
let rcReady = null;

async function nativeConfig() {
  if (config) return config;
  try { config = await api("/api/native/config"); } catch { config = { payments: { ios: "none", products: [] } }; }
  return config;
}

const purchases = () => window.Capacitor?.Plugins?.Purchases;

/** RevenueCat einmalig konfigurieren – App-Nutzer = Konto-ID (damit der Webhook das Abo dem Konto zuordnet). */
async function ensureRevenueCat() {
  const P = purchases(), cfg = await nativeConfig();
  if (!P || cfg.payments?.ios !== "iap" || !cfg.payments.revenuecatIosKey) return null;
  if (!state.user) return null;
  rcReady ??= (async () => {
    await P.configure({ apiKey: cfg.payments.revenuecatIosKey, appUserID: state.user.id });
    return P;
  })().catch((e) => { rcReady = null; throw e; });
  const p = await rcReady;
  try { await p.logIn?.({ appUserID: state.user.id }); } catch {}
  return p;
}

/** Nach einem Kauf: warten, bis der Webhook den Tarif im Profil eingetragen hat (max. ~20 s). */
async function waitForPlan(plan) {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, i < 3 ? 1200 : 2000));
    try { await window.PS?.refreshMe?.(); } catch {}
    const rank = { free: 0, premium: 1, pro: 2 };
    if ((rank[state.me?.plan] ?? 0) >= (rank[plan] ?? 1)) return true;
  }
  return false;
}

const legalLinks = `<p class="text-[10px] text-slate-500 text-center">
  Das Abo verlängert sich automatisch, wenn es nicht mindestens 24 Stunden vor Ablauf in den Einstellungen deiner Apple-ID gekündigt wird.
  Die Zahlung wird bei Kaufbestätigung über deine Apple-ID abgerechnet.
  <a href="/rechtliches#agb" class="underline">AGB / Nutzungsbedingungen</a> · <a href="/datenschutz" class="underline">Datenschutz</a></p>`;

async function iosPaywall() {
  const cfg = await nativeConfig();
  const mode = cfg.payments?.ios || "none";
  if (mode === "external") return externalPurchaseNotice();
  if (mode !== "iap" || !purchases()) {
    modal("ps-ios-pay", `<h3 class="text-base font-black text-white">👑 Premium & Pro Trader</h3>
      <p class="text-xs text-slate-300">Abos lassen sich in dieser App-Version noch nicht abschließen. Bestehende Premium- und Pro-Vorteile deines Kontos gelten hier automatisch.</p>
      ${btn("Verstanden", "PS.closeIosPay()", "w-full bg-slate-800 text-white")}`);
    return;
  }
  if (!state.user) { window.PS?.openAccount?.("Bitte melde dich an, damit dein Abo deinem Konto zugeordnet wird."); return; }
  modal("ps-ios-pay", `<p class="text-xs text-yellow-300 font-bold text-center py-6">⏳ Lade Preise aus dem App Store …</p>`);
  try {
    const P = await ensureRevenueCat();
    const offerings = await P.getOfferings();
    const packs = (offerings?.current?.availablePackages || []).filter((p) => cfg.payments.products.some((x) => x.id === p.product?.identifier));
    if (!packs.length) throw new Error("Keine Produkte");
    const rows = packs.map((p) => {
      const meta = cfg.payments.products.find((x) => x.id === p.product.identifier);
      return `<button type="button" onclick="PS.iosBuy(${jsArg(p.identifier)})" class="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-yellow-400 rounded-2xl p-3 flex items-center justify-between gap-2">
        <span><span class="block text-sm font-black text-white">${esc(PLAN_LABEL[meta.plan])} · ${meta.interval === "year" ? "Jahresabo" : "Monatsabo"}</span>
        <span class="block text-[11px] text-slate-400">${esc(p.product.description || "")}</span></span>
        <span class="text-sm font-black text-yellow-300 shrink-0">${esc(p.product.priceString)}${meta.interval === "year" ? " / Jahr" : " / Monat"}</span></button>`;
    }).join("");
    modal("ps-ios-pay", `<h3 class="text-base font-black text-white">👑 PokeSwipe Premium & Pro Trader</h3>
      <p class="text-xs text-slate-300">Sofort-Restock-Alarme, mehr Scans, unbegrenzte Sammlung, Händler-Shop und geringere Marktplatz-Provision.</p>
      <div class="space-y-2">${rows}</div>
      ${btn("Käufe wiederherstellen", "PS.iosRestore()", "w-full bg-slate-800 text-white")}
      ${legalLinks}`);
    iosPaywall.packs = packs;
  } catch (e) {
    modal("ps-ios-pay", `<h3 class="text-base font-black text-white">App Store nicht erreichbar</h3>
      <p class="text-xs text-slate-300">Die Abos konnten gerade nicht geladen werden. Bitte später erneut versuchen.</p>
      ${btn("Schließen", "PS.closeIosPay()", "w-full bg-slate-800 text-white")}`);
  }
}

async function iosBuy(packageId) {
  const pack = (iosPaywall.packs || []).find((p) => p.identifier === packageId);
  const cfg = await nativeConfig();
  const meta = pack && cfg.payments.products.find((x) => x.id === pack.product.identifier);
  if (!pack || !meta) return;
  try {
    const P = await ensureRevenueCat();
    await P.purchasePackage({ aPackage: pack });
    haptic("success");
    closeModalEl("ps-ios-pay");
    toast("✅ Kauf bestätigt", "Dein Abo wird aktiviert …");
    const ok = await waitForPlan(meta.plan);
    toast(ok ? `👑 ${PLAN_LABEL[meta.plan]} aktiv` : "⏳ Fast fertig", ok ? "Viel Spaß mit allen Vorteilen!" : "Apple hat den Kauf bestätigt – die Freischaltung kann einen Moment dauern.");
  } catch (e) {
    if (e?.userCancelled || /cancel/i.test(String(e?.message || e?.code || ""))) return;
    haptic("error");
    toast("Kauf nicht abgeschlossen", String(e?.message || "Bitte erneut versuchen.").slice(0, 140));
  }
}

async function iosRestore() {
  try {
    const P = await ensureRevenueCat();
    await P.restorePurchases();
    toast("🔄 Käufe wiederhergestellt", "Aktive Abos werden deinem Konto zugeordnet.");
    await waitForPlan("premium");
  } catch (e) { toast("Wiederherstellen fehlgeschlagen", String(e?.message || "").slice(0, 140)); }
}

/** EU-DMA: Apple-konformer Hinweis vor dem Wechsel zum externen Kauf (nur mit Apple-Berechtigung aktiv). */
function externalPurchaseNotice() {
  modal("ps-ios-pay", `<h3 class="text-base font-black text-white">Du verlässt die App</h3>
    <p class="text-xs text-slate-300">Du wirst zu einer externen Website weitergeleitet, um dort einzukaufen. Apple ist nicht für die Privatsphäre oder Sicherheit von Käufen im Web verantwortlich. Für diesen Kauf gelten die Bedingungen von PokeSwipe Radar; Abo-Verwaltung und Erstattungen laufen nicht über Apple.</p>
    ${btn("Weiter zur Website", "PS.iosExternal()", "w-full bg-yellow-400 text-slate-950")}
    ${btn("Abbrechen", "PS.closeIosPay()", "w-full bg-slate-800 text-white")}`);
}

function openExternal() {
  closeModalEl("ps-ios-pay");
  const url = `${location.origin}/?pro=1&src=ios-external`;
  const B = window.Capacitor?.Plugins?.Browser;
  // System-Browser (Safari View Controller), kein Webview in der App
  if (B) B.open({ url }).catch(() => window.open(url, "_blank")); else window.open(url, "_blank");
}

export const paymentsApi = {
  iosBuy, iosRestore, iosExternal: openExternal, closeIosPay: () => closeModalEl("ps-ios-pay"),
};

/**
 * Weiche aktivieren. Nur in der iOS-App werden Tarif-Dialog und Checkout ersetzt; im Web und auf Android bleibt der
 * Stripe-Checkout unverändert.
 */
/**
 * Inserat-Boosts in der iOS-App: Inklusive-Boosts aus Pro Trader funktionieren wie gewohnt; kostenpflichtige Boosts
 * (digitale Leistung) werden dort nicht über Stripe verkauft.
 */
async function iosBoost(listingId) {
  if (!state.user) { window.PS?.openAccount?.(); return; }
  try {
    const r = await api("/api/billing/boost", { method: "POST", body: { listingId } });
    if (r.url) { toast("ℹ️ Boost", "Kostenpflichtige Boosts sind in der iOS-App nicht verfügbar."); return; }
    haptic("success");
    toast("🚀 Boost aktiv", "Inklusive-Boost aus deinem Pro-Tarif genutzt.");
    await window.PS?.refreshMe?.(); window.PS?.loadListings?.();
  } catch (e) {
    if (e.status === 428 && e.data?.needsConsent) { toast("ℹ️ Boost", "Kostenpflichtige Boosts sind in der iOS-App nicht verfügbar. Pro Trader enthält 3 Boosts pro Monat."); return; }
    handleError(e);
  }
}

export function initPayments() {
  if (!isNativeIOS()) return;
  const open = () => iosPaywall();
  if (window.PS) { window.PS.openPro = open; window.PS.checkout = open; window.PS.boost = iosBoost; }
  window.activatePro = open;
  hooks.openPro = open;
  nativeConfig();
}

/** Web: nach externem Kauf aus der iOS-App direkt den Tarif-Dialog öffnen (?pro=1). */
export function routePayments() {
  const q = new URLSearchParams(location.search);
  if (q.get("pro") === "1" && !isNativeIOS()) setTimeout(() => window.PS?.openPro?.(), 500);
}
