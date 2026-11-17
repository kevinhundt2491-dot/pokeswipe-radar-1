// PokeSwipe & Radar – Konto, Abo, Portfolio, Preis-Tracker, sicherer Tausch
// Wird zu /assets/app.js gebündelt und von index.html geladen.
// i18n zuerst: setzt window.psLang/<html lang> und startet bei Englisch den DOM-Übersetzer vor dem ersten Rendern
import { langSwitchHtml } from "./i18n.js";
// Phase 8: Browser-Fehler an den Betriebs-Wächter melden (so früh wie möglich, damit auch Startfehler ankommen)
import "./error-report.js";
import {
  getUser, login, signup, logout, oauthLogin, handleAuthCallback, getSettings,
  requestPasswordRecovery, updateUser, acceptInvite, onAuthChange,
} from "@netlify/identity";

import {
  $, esc, jsArg, safeUrl, eur, pct, toast, ebay, cm, FALLBACK_IMG, cdn, state, api, handleError, requireLogin,
  modal, closeModalEl, input, btn, sparkline, areaChart, hooks,
} from "./core.js";
import {
  initFeatures, featureApi, afterAuthFeatures, routeFeatures, beforeLogout, referralHtml, trialBanner, adminExtrasHtml,
} from "./features.js";
import { cardExtrasHtml, accountExtrasHtml } from "./growth.js";
import { refreshDupes } from "./collector.js";
import { groupDuplicates, surplusBadge } from "./collector-logic.js";
import { initArena, arenaApi, addSwipeItemToPortfolio, sellBlockHtml } from "./arena.js";
import { sellApi, loadMyListings, activeListingFor } from "./sell.js";
import { priceTagHtml } from "./price-tag.js";
import { initDealsRadar, dealsRadarApi } from "./deals-radar.js";
import { initShell, shellApi, routeShell, langFlag } from "./shell.js";
import { initFlip, flipApi, syncFlip } from "./flip.js";
import { initCommunity, communityApi, syncCommunity, routeCommunity, communityAdminHtml } from "./community.js";
import { profileApi, routeProfile, userSocialHtml } from "./profile.js";
import { marketApi, routeMarket, listingFormExtras, listingFormValues, listingBuyHtml, listingMetaHtml, renderPsttgBanner } from "./market.js";
import { cartApi, routeCart, injectCartButton, refreshCartBadge } from "./cart.js";
import { initPwa, pwaApi, wrapEnablePush, afterLoginPwa } from "./pwa.js";
import { searchCatalog, searchThumb, searchMeta, isAbort } from "./search.js";
import { complianceApi, billingPortalButton } from "./compliance.js";
import { makeAdminApi } from "./make-admin.js";
import { tradingApi, tradeDetailHtml, routeTrading } from "./trading.js";
import { syncAdminTools, openGenerator, initLazyAdminTools } from "./lazy.js";
import { valuationApi, loadValuation } from "./valuation.js";
import { initNativePlatform, nativeApi } from "./native.js";
import { initPayments, routePayments, paymentsApi } from "./payments.js";
import { variantSelect, conditionSelect, variantsOf, variantBadge, VARIANT_LABEL, VARIANT_KEYS, CONDITION_LABEL } from "./variants.js";

// ---------------------------------------------------------------------------
// Konto (Netlify Identity)
// ---------------------------------------------------------------------------
async function loadMe() {
  if (!state.user) { state.me = null; return; }
  try {
    state.me = await api("/api/me");
    // Früher wurde der Tarif in localStorage gespiegelt und daraus Pro-Funktionen freigeschaltet –
    // das ließ sich über die Konsole fälschen. Maßgeblich ist jetzt nur noch die Server-Antwort.
    localStorage.removeItem("pokeswipe_pro");
    if (state.me.displayName) localStorage.setItem("pokeswipe_user", state.me.displayName);
    try { renderPsttgBanner(); } catch {}
  } catch (e) {
    state.me = null;
    if (e.status === 401) state.user = null;
  }
  announcePlan();
}

/** Teilt der Oberfläche den vom Server bestätigten Tarif mit (Swipe-Limit, Sniper-Deals, Pro-Analyse). */
function announcePlan() {
  try { window.dispatchEvent(new CustomEvent("ps:plan", { detail: verifiedPlan() })); } catch {}
}
const verifiedPlan = () => (state.user && state.me && ["premium", "pro"].includes(state.me.plan) ? state.me.plan : "free");
// Nur lesbar, nicht überschreibbar: der Tarif kommt ausschließlich aus /api/me (geprüftes Identity-Token)
try { Object.defineProperty(window, "psVerifiedPlan", { get: verifiedPlan, configurable: false, enumerable: false }); } catch {}

function renderHeader() {
  const t = $("authBtnText");
  if (t) t.textContent = state.me?.displayName || (state.user ? "Konto" : "Anmelden");
  const badge = $("pro-badge");
  if (badge) badge.classList.toggle("hidden", !state.me || state.me.plan === "free");
  const bell = $("ps-bell-count");
  if (bell) { bell.textContent = state.unread > 9 ? "9+" : String(state.unread); bell.classList.toggle("hidden", !state.unread); }
  const tc = $("ps-trade-count");
  const open = state.me?.usage?.open_trades || 0;
  if (tc) { tc.textContent = String(open); tc.classList.toggle("hidden", !open); }
  syncAdminTools();
}

function openAccount(hint = "") {
  if (state.recovery) return renderRecovery();
  if (state.invite) return renderInvite();
  if (!state.user) return renderLogin(hint);
  const m = state.me;
  const planLabel = m ? m.planInfo.label : "…";
  const until = m?.planUntil ? new Date(m.planUntil).toLocaleDateString("de-DE") : "";
  modal("ps-account", `
    <h3 class="text-base font-black text-white">👤 Dein Sammler-Konto</h3>
    <p class="text-xs text-slate-400">${esc(state.user.email || "")}</p>
    <div class="flex items-center justify-between gap-2 text-xs text-slate-300"><span class="font-bold">🌐 Sprache / Language</span>${langSwitchHtml()}</div>
    <div class="bg-slate-950 rounded-2xl p-3.5 border border-slate-800 space-y-2 text-xs">
      <label class="block text-slate-300 font-bold">Öffentlicher Sammlername</label>
      ${input("ps-name", `maxlength="24" value="${esc(m?.displayName || "")}"`)}
      <label class="block text-slate-300 font-bold">Stadt (für Tausch in deiner Nähe)</label>
      ${input("ps-city", `maxlength="60" value="${esc(m?.city || "")}" placeholder="z. B. Köln"`)}
      ${btn("Speichern", "PS.saveProfile()", "w-full bg-emerald-500 text-slate-950")}
    </div>
    <div class="bg-slate-950 rounded-2xl p-3.5 border border-yellow-400/40 text-xs space-y-2">
      <div class="flex justify-between items-center">
        <span class="font-black text-white">Tarif: <span class="text-yellow-400">${esc(planLabel)}</span></span>
        ${m?.rating?.count ? `<span class="text-amber-300 font-bold">⭐ ${Number(m.rating.avg) || 0} (${Number(m.rating.count) || 0})</span>` : ""}
      </div>
      ${m && m.plan !== "free" ? `<p class="text-slate-400">${m.planInterval === "year" ? "Jahresabo • " : ""}${m.cancelAtPeriodEnd ? `Gekündigt – läuft bis ${until}` : `Verlängert sich am ${until}`}</p>
        ${m.cancelAtPeriodEnd ? btn("Abo fortsetzen", "PS.cancelPlan(true)", "w-full bg-emerald-500 text-slate-950") : btn("Abo kündigen", "PS.cancelPlan(false)", "w-full bg-slate-800 text-slate-200")}`
        : btn("👑 Premium oder Pro freischalten", "PS.openPro()", "w-full bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950")}
      ${m?.hasBilling ? billingPortalButton() : ""}
      <a href="/kuendigen" class="block w-full text-center bg-rose-600 hover:bg-rose-500 text-white font-black py-2.5 px-3 rounded-xl text-xs">Verträge hier kündigen</a>
      <p class="text-[10px] text-slate-500 text-center"><a href="/rechtliches#agb" class="underline">AGB</a> · <a href="/rechtliches#widerruf" class="underline">Widerrufsbelehrung</a> · <a href="/rechtliches#impressum" class="underline">Impressum</a> · <a href="/datenschutz" class="underline">Datenschutz</a></p>
      ${m ? `<p class="text-slate-500">Portfolio ${m.usage.portfolio}/${m.planInfo.portfolio} • Alarme ${m.usage.alerts}/${m.planInfo.alerts} • Inserate ${m.usage.listings}/${m.planInfo.listings}${m.planInfo.freeBoostsPerMonth ? ` • Gratis-Boosts ${m.freeBoostsLeft}/${m.planInfo.freeBoostsPerMonth}` : ""}</p>` : ""}
    </div>
    <div class="grid grid-cols-2 gap-2">
      ${btn("🔔 Push auf diesem Gerät", "PS.enablePush()", "bg-slate-800 text-white")}
      ${btn(m?.shop?.enabled ? "🏪 Mein Händler-Shop" : "🏪 Händler-Shop (Pro)", "PS.openShopSettings()", "bg-slate-800 text-cyan-300")}
    </div>
    ${referralHtml()}
    ${accountExtrasHtml()}
    <div class="grid grid-cols-2 gap-2">
      ${btn(m?.publicProfile ? "🌐 Mein öffentliches Profil" : "🌐 Profil öffentlich machen", m?.publicProfile ? `PS.openProfile(${jsArg(m?.profileSlug || "")})` : "PS.openProfileSettings()", "bg-slate-800 text-yellow-300")}
      ${btn("🛒 Käufe & Verkäufe", "PS.openOrders()", "bg-slate-800 text-white")}
      ${btn(m?.sellerReady ? "🔒 Verkäuferkonto ✓" : "🔒 Verkaufen mit Käuferschutz", "PS.openSeller()", "bg-slate-800 text-cyan-300")}
      ${btn("🛒 Warenkorb", "PS.openCart()", "bg-slate-800 text-white")}
      ${btn("🏪 Händler-Bereich & Bestands-Import", "PS.openSellerHub()", "bg-slate-800 text-amber-200")}
      ${btn("⭐ Gefolgt & Follower", "PS.openFollowing()", "bg-slate-800 text-white")}
      ${btn("🚫 Blockierte Nutzer", "PS.openBlocks()", "bg-slate-800 text-slate-300")}
      ${btn("📲 Als App installieren", "PS.installApp()", "bg-slate-800 text-white")}
    </div>
    <div class="grid grid-cols-2 gap-2">
      ${btn("🤝 Meine Tausche", "PS.openTrades()", "bg-slate-800 text-white")}
      ${btn("🔥 Meine Matches", "PS.openMatches()", "bg-slate-800 text-rose-200")}
      ${btn("🔔 Mitteilungen", "PS.openNotifications()", "bg-slate-800 text-white")}
      ${m?.isAdmin ? btn("🛡️ Admin-Zentrale", "PS.openAdmin()", "col-span-2 bg-purple-600 text-white") : ""}
      ${m?.isAdmin ? btn("🎬 Auto-Reels-Generator", "PS.closeAll(); PS.openGenerator()", "col-span-2 bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950") : ""}
      ${btn("Abmelden", "PS.logout()", "col-span-2 bg-rose-500/20 text-rose-300 border border-rose-500/40")}
    </div>`);
}

function renderLogin(hint = "", mode = "login") {
  const p = state.settings?.providers || {};
  const external = ["google", "github"].filter((k) => p[k]);
  const signupOff = state.settings?.disableSignup;
  modal("ps-account", `
    <h3 class="text-base font-black text-white">${mode === "signup" ? "✨ Kostenloses Konto erstellen" : "🔐 Anmelden"}</h3>
    ${hint ? `<p class="text-xs text-yellow-300">${esc(hint)}</p>` : ""}
    <p class="text-xs text-slate-300">Mit Konto werden Portfolio, Preisalarme und Tausche sicher gespeichert – auf all deinen Geräten.</p>
    ${external.map((k) => btn(`Weiter mit ${k === "google" ? "Google" : "GitHub"}`, `PS.oauth('${k}')`, "w-full bg-white text-slate-900")).join("")}
    <div class="space-y-2">
      ${mode === "signup" ? input("ps-su-name", 'maxlength="24" placeholder="Sammlername (z. B. GlurakKing)" autocomplete="nickname"') : ""}
      ${input("ps-email", 'type="email" placeholder="E-Mail" autocomplete="email"')}
      ${input("ps-pass", `type="password" placeholder="Passwort (min. 8 Zeichen)" autocomplete="${mode === "signup" ? "new-password" : "current-password"}"`)}
      ${mode === "signup"
        ? btn("Konto erstellen", "PS.doSignup()", "w-full bg-emerald-500 text-slate-950")
        : btn("Anmelden", "PS.doLogin()", "w-full bg-yellow-400 text-slate-950")}
    </div>
    ${mode === "signup" ? `<p class="text-[11px] text-slate-400">Mit der Registrierung gelten unsere <a href="/rechtliches#agb" target="_blank" rel="noopener" class="underline">AGB</a>. Wie wir deine Daten verarbeiten, erklärt die <a href="/datenschutz" target="_blank" rel="noopener" class="underline">Datenschutzerklärung</a>.</p>` : ""}
    <p id="ps-auth-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
    <div class="flex justify-between text-xs">
      ${mode === "signup" ? `<button onclick="PS.renderLogin('', 'login')" class="text-slate-300 underline">Schon registriert? Anmelden</button>`
        : signupOff ? "<span></span>" : `<button onclick="PS.renderLogin('', 'signup')" class="text-emerald-300 underline font-bold">Neu hier? Registrieren</button>`}
      <button onclick="PS.forgot()" class="text-slate-400 underline">Passwort vergessen?</button>
    </div>`);
  setTimeout(() => $("ps-email")?.addEventListener("keydown", (e) => e.key === "Enter" && $("ps-pass").focus()), 0);
  setTimeout(() => $("ps-pass")?.addEventListener("keydown", (e) => e.key === "Enter" && (mode === "signup" ? doSignup() : doLogin())), 0);
}

function authMsg(text, ok = false) {
  const el = $("ps-auth-msg");
  if (el) { el.textContent = text; el.className = `text-xs min-h-[1rem] ${ok ? "text-emerald-300" : "text-rose-300"}`; }
}

async function afterLogin() {
  state.user = await getUser();
  await loadMe();
  await migrateLocalPortfolio();
  afterAuthFeatures();
  closeModalEl("ps-account");
  renderHeader();
  refreshAll();
  toast("✅ Angemeldet", `Willkommen ${state.me?.displayName || ""}!`);
  await confirmCheckoutFromUrl();
}

async function doLogin() {
  const email = $("ps-email").value.trim(), pass = $("ps-pass").value;
  if (!email || !pass) return authMsg("Bitte E-Mail und Passwort eingeben.");
  authMsg("Anmeldung läuft …", true);
  try { await login(email, pass); await afterLogin(); }
  catch (e) { authMsg(e?.status === 401 || /invalid/i.test(e?.message || "") ? "E-Mail oder Passwort falsch – oder E-Mail noch nicht bestätigt." : (e?.message || "Anmeldung fehlgeschlagen.")); }
}

async function doSignup() {
  const email = $("ps-email").value.trim(), pass = $("ps-pass").value, name = $("ps-su-name")?.value.trim() || "";
  if (!email || pass.length < 8) return authMsg("Bitte gültige E-Mail und mindestens 8 Zeichen Passwort.");
  authMsg("Konto wird erstellt …", true);
  try {
    const u = await signup(email, pass, { full_name: name });
    if (u && u.confirmedAt) { await login(email, pass); await afterLogin(); }
    else authMsg("📧 Fast geschafft! Bitte bestätige den Link in deiner E-Mail – danach kannst du dich anmelden.", true);
  } catch (e) { authMsg(e?.message?.includes("already") ? "Diese E-Mail ist bereits registriert." : (e?.message || "Registrierung fehlgeschlagen.")); }
}

async function forgot() {
  const email = $("ps-email")?.value.trim();
  if (!email) return authMsg("Bitte zuerst deine E-Mail eintragen.");
  try { await requestPasswordRecovery(email); authMsg("📧 Falls ein Konto existiert, ist der Link zum Zurücksetzen unterwegs.", true); }
  catch { authMsg("📧 Falls ein Konto existiert, ist der Link zum Zurücksetzen unterwegs.", true); }
}

function renderRecovery() {
  modal("ps-account", `<h3 class="text-base font-black text-white">🔑 Neues Passwort festlegen</h3>
    ${input("ps-newpass", 'type="password" placeholder="Neues Passwort (min. 8 Zeichen)" autocomplete="new-password"')}
    ${btn("Passwort speichern", "PS.saveNewPassword()", "w-full bg-emerald-500 text-slate-950")}
    <p id="ps-auth-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>`);
}
async function saveNewPassword() {
  const pw = $("ps-newpass").value;
  if (pw.length < 8) return authMsg("Mindestens 8 Zeichen.");
  try { await updateUser({ password: pw }); state.recovery = false; await afterLogin(); }
  catch (e) { authMsg(e?.message || "Speichern fehlgeschlagen."); }
}

function renderInvite() {
  modal("ps-account", `<h3 class="text-base font-black text-white">🎟️ Einladung annehmen</h3>
    ${input("ps-newpass", 'type="password" placeholder="Passwort wählen (min. 8 Zeichen)" autocomplete="new-password"')}
    ${btn("Konto aktivieren", "PS.saveInvite()", "w-full bg-emerald-500 text-slate-950")}
    <p id="ps-auth-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>`);
}
async function saveInvite() {
  const pw = $("ps-newpass").value;
  if (pw.length < 8) return authMsg("Mindestens 8 Zeichen.");
  try { await acceptInvite(state.invite, pw); state.invite = null; await afterLogin(); }
  catch (e) { authMsg(e?.message || "Einladung ungültig oder abgelaufen."); }
}

async function saveProfile() {
  try {
    const r = await api("/api/me", { method: "PUT", body: { displayName: $("ps-name").value, city: $("ps-city").value } });
    await loadMe(); renderHeader();
    toast("✅ Profil gespeichert", r.displayName || "");
    openAccount();
  } catch (e) { handleError(e); }
}

async function doLogout() {
  await beforeLogout();
  try { await logout(); } catch {}
  state.user = null; state.me = null; state.portfolio = null; state.alerts = null; state.trades = []; state.unread = 0;
  localStorage.removeItem("pokeswipe_pro");
  announcePlan();
  closeModalEl("ps-account");
  renderHeader(); refreshAll();
  toast("👋 Abgemeldet", "Bis bald!");
}

// Lokales Portfolio (aus der Zeit vor dem Login) einmalig ins Konto übernehmen
async function migrateLocalPortfolio() {
  if (!state.user || localStorage.getItem("ps_migrated_" + state.user.id)) return;
  const local = Array.isArray(window.portfolio) ? window.portfolio : (typeof portfolio !== "undefined" ? portfolio : []);
  if (local.length) {
    try {
      const r = await api("/api/portfolio/import", { method: "POST", body: { items: local } });
      if (r.imported) toast("💼 Portfolio übernommen", `${r.imported} Karten sind jetzt sicher in deinem Konto gespeichert.`);
    } catch {}
  }
  localStorage.setItem("ps_migrated_" + state.user.id, "1");
}

// ---------------------------------------------------------------------------
// Abo & Zahlungen
// ---------------------------------------------------------------------------
let proInterval = "month";
function openPro(interval) {
  if (interval === "month" || interval === "year") proInterval = interval;
  const m = state.me, plans = m?.plans;
  const current = m?.plan || "free";
  const yearly = proInterval === "year";
  const yearCents = { premium: plans?.premium?.yearlyPriceCents || 4900, pro: plans?.pro?.yearlyPriceCents || 9900 };
  const monthCents = { premium: plans?.premium?.priceCents || 499, pro: plans?.pro?.priceCents || 999 };
  const priceOf = (id) => (id === "free" ? "0 €" : eur((yearly ? yearCents[id] : monthCents[id]) / 100));
  const isCurrent = (id) => current === id && (id === "free" || (m?.planInterval === "year") === yearly);
  const tier = (id, color, features) => {
    const price = priceOf(id);
    const saving = yearly && id !== "free" ? Math.round((1 - yearCents[id] / (monthCents[id] * 12)) * 100) : 0;
    return `
    <div class="bg-slate-950 border-2 ${color} rounded-2xl p-4 space-y-2 flex flex-col ${current === id ? "ring-2 ring-emerald-400" : ""}">
      <p class="font-black uppercase text-[10px] ${id === "pro" ? "text-purple-300" : id === "premium" ? "text-yellow-400" : "text-slate-400"}">${id === "pro" ? "Pro Trader" : id === "premium" ? "Premium" : "Free"}</p>
      <p class="text-xl font-black text-white">${price}<span class="text-xs font-normal text-slate-400">${id === "free" ? "" : yearly ? " / Jahr" : " / Monat"}</span></p>
      ${saving ? `<p class="text-[10px] font-black text-emerald-300">≈ ${eur(yearCents[id] / 1200)} pro Monat • ${saving} % gespart</p>` : ""}
      <ul class="text-slate-300 space-y-1 flex-1">${features.map((f) => `<li>✅ ${f}</li>`).join("")}</ul>
      ${isCurrent(id) ? `<p class="text-center text-emerald-400 font-black py-2">✓ Dein Tarif</p>`
        : id === "free" ? "" : btn(m?.trialDays ? `${m.trialDays} Tage gratis testen` : `${price} – jetzt starten`, `PS.checkout('${id}', '${yearly ? "year" : "month"}')`, `w-full ${id === "pro" ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white" : "bg-yellow-400 text-slate-950"}`)}
    </div>`;
  };
  const p = plans || { free: { portfolio: 25, alerts: 3, listings: 5 }, premium: { portfolio: 500, alerts: 50, listings: 40 }, pro: { alerts: 500, listings: 500, freeBoostsPerMonth: 3 } };
  modal("ps-pro", `
    <span class="bg-yellow-400 text-slate-950 text-xs font-black px-3 py-1 rounded-full">👑 POKESWIPE PREMIUM</span>
    <h3 class="text-lg font-black text-white">Mehr Gewinn bei jedem Deal</h3>
    ${trialBanner()}
    <p class="text-xs text-slate-300">Restock-Alarme ohne Wartezeit, echte Cardmarket-Preise, stündlicher Preis-Tracker, KI-Kartenscan & Fake-Check, sichere Tausche. Sichere Zahlung über Stripe (Karte, Apple Pay, Google Pay, Klarna u. a.).</p>
    <div class="flex justify-center"><div class="inline-flex bg-slate-900 border border-slate-700 rounded-2xl p-1 text-xs font-black">
      <button onclick="PS.openPro('month')" class="px-4 py-2 rounded-xl ${yearly ? "text-slate-300" : "bg-yellow-400 text-slate-950"}">Monatlich</button>
      <button onclick="PS.openPro('year')" class="px-4 py-2 rounded-xl ${yearly ? "bg-yellow-400 text-slate-950" : "text-slate-300"}">Jährlich <span class="${yearly ? "text-emerald-700" : "text-emerald-400"}">2 Monate gratis</span></button>
    </div></div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
      ${tier("free", "border-slate-700", [`${p.free.portfolio} Portfolio-Karten`, `${p.free.alerts} Preisalarme`, `${p.free.listings} aktive Inserate`, `${p.free.scansPerDay || 3} KI-Scans pro Tag`, `Restock-Alarm (${p.free.restockDelayMin ?? 15} Min. verzögert)`, `${p.free.fakeChecksPerMonth ?? 1} Fake-Check pro Monat`, "Push-Alarme", "Sicherer Tausch & Bewertungen"])}
      ${tier("premium", "border-yellow-400/60", ["🚨 Restock-Alarme sofort (ohne Wartezeit)", `🕵️ ${p.premium.fakeChecksPerMonth ?? 20} KI-Fake-Checks pro Monat`, `🏅 Graded-Portfolio (${p.premium.gradedCards ?? 200} Slabs) & Einsendungs-Tracker`, `${p.premium.portfolio} Portfolio-Karten`, `${p.premium.alerts} Preisalarme (stündlich)`, "👑 Sniper-Deals >25 % unter Marktwert", "🏆 Grading-Profit-Analyse", "Wertverlauf & Top-Mover", `${p.premium.scansPerDay || 40} KI-Scans pro Tag`, `${p.premium.sets || 10} Sets verfolgen`, `${p.premium.listings} aktive Inserate`, "Unbegrenzte Swipes", "Goldenes Badge"])}
      ${tier("pro", "border-purple-500", ["Alles aus Premium", "🎯 Restock-Filter: Shop, Stichwort, Höchstpreis, nur UVP", `🕵️ ${p.pro.fakeChecksPerMonth ?? 200} Fake-Checks pro Monat`, "🏪 Eigener Händler-Shop", "Unbegrenzte Alarme & Inserate", "✔ Verifizierter Händler-Badge", `${p.pro.freeBoostsPerMonth || 3} Gratis-Boosts pro Monat`, "Inserate vor Free & Premium", "Portfolio-Export (CSV)", "📊 Shop-Statistik"])}
    </div>
    <p class="text-[11px] text-slate-400">🚀 Einzel-Boost für jedes Inserat: ${eur((m?.boost?.priceCents || 199) / 100)} für ${m?.boost?.days || 7} Tage ganz oben im Tausch-Hub.</p>
    ${m && !m.paymentsEnabled ? `<p class="text-xs text-amber-300">⏳ Zahlungen werden gerade eingerichtet – bitte versuche es in Kürze erneut.</p>` : ""}`, { wide: true });
}

/**
 * Bestellübersicht vor dem Bezahlen (§ 312j BGB): Preis, Laufzeit, Verlängerung, Kündigung,
 * AGB/Widerrufsbelehrung und ausdrückliches Verlangen des sofortigen Leistungsbeginns (§ 356 Abs. 4/5 BGB).
 */
function orderConsent({ title, lines, button }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModalEl("ps-consent"); resolve(v); };
    const el = modal("ps-consent", `
      <h3 class="text-base font-black text-white">🧾 ${esc(title)}</h3>
      <ul class="text-xs text-slate-200 space-y-1 bg-slate-950 border border-slate-800 rounded-2xl p-3">${lines.map((l) => `<li>• ${esc(l)}</li>`).join("")}</ul>
      <label class="flex gap-2 items-start text-xs text-slate-200"><input type="checkbox" id="ps-c-terms" class="mt-0.5 accent-yellow-400">
        <span>Ich akzeptiere die <a href="/rechtliches#agb" target="_blank" rel="noopener" class="underline font-bold">AGB</a> und habe die <a href="/rechtliches#widerruf" target="_blank" rel="noopener" class="underline font-bold">Widerrufsbelehrung</a> zur Kenntnis genommen. Hinweise zur Datenverarbeitung: <a href="/datenschutz" target="_blank" rel="noopener" class="underline font-bold">Datenschutzerklärung</a>.</span></label>
      <label class="flex gap-2 items-start text-xs text-slate-200"><input type="checkbox" id="ps-c-early" class="mt-0.5 accent-yellow-400">
        <span>Ich verlange ausdrücklich, dass PokeSwipe &amp; Radar vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass ich bei einem Widerruf anteiligen Wertersatz für die bereits erbrachte Leistung zahle und mein Widerrufsrecht erlischt, sobald die Leistung vollständig erbracht ist.</span></label>
      <p id="ps-c-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
      <button id="ps-c-go" class="w-full bg-yellow-400 text-slate-950 font-black py-3 px-3 rounded-xl text-sm">${esc(button)}</button>
      <p class="text-[11px] text-slate-400">Du wirst zur sicheren Bezahlseite von Stripe weitergeleitet und schließt die Bestellung dort ab. <a href="/kuendigen" target="_blank" rel="noopener" class="underline">Verträge hier kündigen</a></p>`,
      { onClose: () => finish(null) });
    el.querySelector("#ps-c-go").onclick = () => {
      const acceptTerms = el.querySelector("#ps-c-terms").checked, earlyStart = el.querySelector("#ps-c-early").checked;
      if (!acceptTerms || !earlyStart) { el.querySelector("#ps-c-msg").textContent = "Bitte bestätige beide Punkte, um fortzufahren."; return; }
      finish({ acceptTerms: true, earlyStart: true });
    };
  });
}

async function checkout(plan, interval = "month") {
  if (!requireLogin()) return;
  const m = state.me, plans = m?.plans;
  const yearly = interval === "year";
  const cents = yearly ? (plans?.[plan]?.yearlyPriceCents || (plan === "pro" ? 9900 : 4900)) : (plans?.[plan]?.priceCents || (plan === "pro" ? 999 : 499));
  const label = plan === "pro" ? "Pro Trader" : "Premium";
  const price = `${eur(cents / 100)} pro ${yearly ? "Jahr" : "Monat"}`;
  const consent = await orderConsent({
    title: `${label} ${yearly ? "Jahresabo" : "Monatsabo"} bestellen`,
    lines: [
      m?.trialDays ? `${m.trialDays} Tage kostenlos testen, danach ${price}` : `Preis: ${price} (Endpreis)`,
      yearly ? "Laufzeit 12 Monate, verlängert sich danach auf unbestimmte Zeit (monatlich kündbar)" : "Laufzeit 1 Monat, verlängert sich automatisch um je 1 Monat",
      m?.trialDays ? "Kündigung während der Testphase: es entstehen keine Kosten" : "Jederzeit kündbar zum Ende des bezahlten Zeitraums",
      "Zahlung sicher über Stripe (Karte, Apple Pay, Google Pay, Klarna u. a.)",
    ],
    button: m?.trialDays ? "Weiter zur Bestellung – Testphase starten" : "Weiter zur zahlungspflichtigen Bestellung",
  });
  if (!consent) return;
  try {
    const { url } = await api("/api/billing/checkout", { method: "POST", body: { plan, interval, ...consent } });
    location.href = url;
  } catch (e) { handleError(e); }
}

async function cancelPlan(resume) {
  if (!resume && !confirm("Abo wirklich kündigen? Deine Vorteile bleiben bis zum Ende des bezahlten Zeitraums aktiv.")) return;
  try {
    await api("/api/billing/cancel", { method: "POST", body: { resume } });
    await loadMe(); renderHeader(); openAccount();
    toast(resume ? "✅ Abo läuft weiter" : "Abo gekündigt", resume ? "" : "Du kannst es jederzeit wieder fortsetzen.");
  } catch (e) { handleError(e); }
}

async function boost(listingId, consent = null) {
  if (!requireLogin()) return;
  try {
    const r = await api("/api/billing/boost", { method: "POST", body: { listingId, ...(consent || {}) } });
    if (r.url) { location.href = r.url; return; }
    toast("🚀 Boost aktiv", "Inklusive-Boost aus deinem Pro-Tarif genutzt.");
    await loadMe(); loadListings();
  } catch (e) {
    // Kostenpflichtiger Boost: erst Bestellübersicht bestätigen, dann erneut anfragen
    if (e.status === 428 && e.data?.needsConsent && !consent) {
      const m = state.me;
      const c = await orderConsent({
        title: "Inserat-Boost bestellen",
        lines: [`Einmalig ${eur((m?.boost?.priceCents || 199) / 100)} (Endpreis)`, `${m?.boost?.days || 7} Tage ganz oben im Tausch-Hub`, "Kein Abo – endet automatisch"],
        button: "Weiter zur zahlungspflichtigen Bestellung",
      });
      if (c) return boost(listingId, c);
      return;
    }
    handleError(e);
  }
}

async function confirmCheckoutFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get("checkout") === "cancel") { toast("Zahlung abgebrochen", "Es wurde nichts berechnet."); cleanUrl(); return; }
  const sid = params.get("session_id");
  if (params.get("checkout") !== "success" || !sid) return;
  if (!state.user) { openAccount("Bitte melde dich an, um deine Zahlung zu bestätigen."); return; }
  try {
    const r = await api("/api/billing/confirm", { method: "POST", body: { sessionId: sid } });
    await loadMe(); renderHeader();
    toast(r.kind === "boost" ? "🚀 Boost aktiv!" : "👑 Danke! Dein Abo ist aktiv", r.kind === "boost" ? "Dein Inserat steht jetzt ganz oben." : `Tarif: ${state.me?.planInfo?.label || ""}`);
    loadListings(); loadPortfolio(); loadAlerts();
  } catch (e) { handleError(e); }
  cleanUrl();
}
const cleanUrl = () => history.replaceState(null, "", location.pathname);

// ---------------------------------------------------------------------------
// Karten-Detail mit Live-Preis, Verlauf, Alarm & Portfolio
// ---------------------------------------------------------------------------
async function openCard(cardId) {
  modal("ps-card", `<p class="text-yellow-400 text-xs font-bold text-center py-6">⏳ Lade Live-Preis von Cardmarket …</p>`);
  try {
    const { card, history, priceInfo } = await api(`/api/cards/${encodeURIComponent(cardId)}`);
    const price = card.price;
    const ch30 = card.avg30 && price ? ((price - card.avg30) / card.avg30) * 100 : null;
    modal("ps-card", `
      <div class="flex gap-4">
        <img src="${esc(cdn(card.image || FALLBACK_IMG, 320))}" onerror="this.src='${FALLBACK_IMG}'" class="w-28 sm:w-36 rounded-xl object-contain shrink-0" />
        <div class="space-y-1 text-xs min-w-0">
          <h3 class="text-base font-black text-white">${esc(card.name)}</h3>
          <p class="text-slate-400">${esc(card.setName)} • ${esc(card.id)}</p>
          <p class="text-2xl font-black text-emerald-400">${price ? eur(price) : "Kein Preis"}</p>
          <p class="text-slate-400">Cardmarket-Trend${ch30 !== null ? ` • <span class="${ch30 >= 0 ? "text-emerald-400" : "text-rose-400"} font-bold">${pct(ch30)} (30 Tage)</span>` : ""}</p>
          <p class="text-slate-500">Ø 7 T: ${card.avg7 ? eur(card.avg7) : "–"} • Ø 30 T: ${card.avg30 ? eur(card.avg30) : "–"} • ab ${card.low ? eur(card.low) : "–"}</p>
          ${priceInfo ? `<p class="text-[10px] ${priceInfo.stale || priceInfo.degraded ? "text-amber-300" : "text-slate-500"}">🕒 Zuletzt aktualisiert: ${esc(priceInfo.freshness)}${priceInfo.degraded ? " (aus der PokeSwipe-Datenbank)" : ""}</p>` : ""}
          ${Number(card.reverseTrend || card.reverseAvg) ? `<p class="text-purple-200 font-bold">✨ Reverse Holo: ${eur(Number(card.reverseTrend || card.reverseAvg))}${card.reverseLow ? ` <span class="text-slate-500 font-normal">• ab ${eur(Number(card.reverseLow))}</span>` : ""}</p>` : ""}
          ${variantsOf(card.variants).length < VARIANT_KEYS.length ? `<p class="text-slate-500">Varianten: ${variantsOf(card.variants).map((v) => esc(VARIANT_LABEL[v])).join(", ")}</p>` : ""}
          <div class="flex gap-1.5 pt-1">
            <a href="${cm(card.name)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-bold px-2.5 py-1 rounded-lg">Cardmarket ↗</a>
            <a href="${ebay(card.name + " " + (card.id.split("-").pop() || ""))}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2.5 py-1 rounded-lg">eBay* ↗</a>
          </div>
        </div>
      </div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800">${sparkline(history.map((h) => h.trend), 400, 60)}</div>
      <div id="ps-card-valuation"></div>
      <div id="ps-card-comps"></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="bg-slate-950 rounded-2xl p-3 border border-yellow-400/40 space-y-2">
          <p class="font-black text-yellow-300">🎯 Preisalarm</p>
          <div class="flex gap-2">
            <select id="ps-al-dir" class="bg-slate-900 border border-slate-700 rounded-xl px-2 text-white"><option value="below">unter</option><option value="above">über</option></select>
            ${input("ps-al-price", `type="number" step="0.01" min="0.01" value="${price ? (price * 0.9).toFixed(2) : ""}" placeholder="Zielpreis €"`)}
          </div>
          ${btn("Alarm aktivieren", `PS.createAlert(${jsArg(card.id)})`, "w-full bg-yellow-400 text-slate-950")}
        </div>
        <div class="bg-slate-950 rounded-2xl p-3 border border-emerald-500/40 space-y-2">
          <p class="font-black text-emerald-300">💼 Ins Portfolio</p>
          <div class="flex gap-2">
            ${input("ps-pf-qty", 'type="number" min="1" max="999" value="1" placeholder="Anzahl"')}
            ${input("ps-pf-buy", 'type="number" step="0.01" min="0" placeholder="Einkauf €"')}
          </div>
          <div class="grid grid-cols-2 gap-2">${variantSelect("ps-pf-variant", variantsOf(card.variants))}${conditionSelect("ps-pf-cond")}</div>
          ${btn("Hinzufügen", `PS.addCardToPortfolio(${jsArg(card.id)})`, "w-full bg-emerald-500 text-slate-950")}
        </div>
      </div>
      ${sellBlockHtml("sellCatalogCard", `${jsArg(card.id)}, ${jsArg(card.name)}, ${Number(price) || 0}, ${jsArg(card.image || "")}, ${jsArg(card.setName || "")}`, price)}
      <button onclick="PS.listCard(${jsArg(card.id)}, ${jsArg(card.name)}, ${Number(price) || 0})" class="w-full bg-slate-800 text-slate-200 font-bold py-2 rounded-xl text-[11px]">🤝 Nur zum Tausch anbieten (mit Tauschwunsch)</button>
      ${cardExtrasHtml(card)}
      <p class="text-[10px] text-slate-500">Preise: eigene PokeSwipe-Preisdatenbank (Cardmarket-Referenz, eBay- und PokeSwipe-Verkäufe), stündlich aktualisiert. *Affiliate-Link</p>`, { wide: true });
    // Eigene Bewertung nach Zustand & Graded-Stufen (Phase 9)
    loadValuation(card.id);
    // Verkaufspreise, PSA-Werte & bestes eBay-Angebot (Flip-Radar Phase 2)
    flipApi.compsSummary("ps-card-comps", "card", card.id);
  } catch (e) {
    closeModalEl("ps-card");
    handleError(e);
  }
}

async function createAlert(cardId) {
  if (!requireLogin()) return;
  try {
    await api("/api/alerts", { method: "POST", body: { cardId, targetPrice: $("ps-al-price").value, direction: $("ps-al-dir").value } });
    closeModalEl("ps-card");
    toast("🎯 Preisalarm aktiv", "Der Tracker prüft die Karte jede Stunde – du bekommst sofort eine Mitteilung.");
    window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "alert" }));
    loadAlerts(); loadMe().then(renderHeader);
  } catch (e) { handleError(e); }
}

async function addCardToPortfolio(cardId) {
  if (!requireLogin()) return;
  try {
    await api("/api/portfolio", { method: "POST", body: {
      cardId, quantity: $("ps-pf-qty")?.value || 1, purchasePrice: $("ps-pf-buy")?.value || null,
      variant: $("ps-pf-variant")?.value || "normal", condition: $("ps-pf-cond")?.value || "NM",
    } });
    closeModalEl("ps-card");
    toast("💼 Im Portfolio", "Der Wert wird ab jetzt automatisch mit Live-Preisen aktualisiert.");
    loadPortfolio();
  } catch (e) { handleError(e); }
}

function listCard(cardId, name, price) {
  if (!requireLogin()) return;
  modal("ps-card", `<h3 class="text-base font-black text-white">🤝 Inserieren: ${esc(name)}</h3>
    <div class="space-y-2 text-xs">
      <label class="text-slate-300 font-bold">Preis / Tauschwert (€)</label>${input("ps-li-price", `type="number" step="0.01" min="0" value="${price ? price.toFixed(2) : ""}"`)}
      <label class="text-slate-300 font-bold">Suche im Tausch</label>${input("ps-li-want", 'maxlength="120" placeholder="z. B. Glurak ex SIR oder Gebot"')}
      <label class="text-slate-300 font-bold">Stadt</label>${input("ps-li-city", `maxlength="60" value="${esc(state.me?.city || "")}"`)}
      ${listingFormExtras()}
      ${btn("Jetzt inserieren", `PS.submitCardListing(${jsArg(cardId)}, ${jsArg(name)})`, "w-full bg-emerald-500 text-slate-950")}
    </div>`);
}

async function submitCardListing(cardId, name) {
  try {
    await api("/api/listings", { method: "POST", body: { items: [{ cardId, card: name, price: $("ps-li-price").value, want: $("ps-li-want").value, city: $("ps-li-city").value, ...listingFormValues() }] } });
    closeModalEl("ps-card");
    toast("🚀 Inserat live", `${name} ist jetzt im Tausch-Hub.`);
    loadListings(); loadMe().then(renderHeader);
  } catch (e) { handleError(e); }
}

// Kartensuche über den eigenen Katalog (/api/search, alle Sprachen) – Ergebnisse öffnen die Detailansicht
async function searchCards(q, boxId) {
  const box = $(boxId);
  if (!box) return;
  if (!q || q.length < 2) return toast("Suche", "Bitte mindestens 2 Zeichen eingeben (z. B. Glurak oder „Glurak 4/102“).");
  box.innerHTML = `<p class="text-yellow-400 col-span-full text-center py-4 font-bold">⏳ Suche im Kartenkatalog …</p>`;
  try {
    const { items } = await searchCatalog(q, { lang: "de,en,ja", limit: 24, channel: boxId });
    const list = items.filter((c) => c.image);
    if (!list.length) { box.innerHTML = `<p class="text-slate-400 col-span-full text-center py-4">Keine Karte gefunden. Versuche z. B. „Pikachu“, „Glurak 4/102“ oder „Mew ex“.</p>`; return; }
    box.innerHTML = list.map((c) => `
      <button onclick="${c.lang === "de" ? `PS.openCard(${jsArg(c.cardId || c.id)})` : `PS.openPrint(${jsArg(c.printId)})`}" class="bg-slate-900 border border-slate-800 hover:border-yellow-400 rounded-xl p-2 flex flex-col gap-1.5 text-center transition">
        <img src="${esc(searchThumb(c, 200))}" loading="lazy" onerror="this.src='${FALLBACK_IMG}'" class="h-32 mx-auto object-contain rounded" />
        <p class="font-bold text-white truncate text-[11px] w-full">${esc(c.name)}</p>
        <p class="text-[10px] text-slate-500 truncate">${esc(searchMeta(c))}</p>
        <span class="text-[10px] font-black text-yellow-300">${c.price ? `💶 ${esc(eur(c.price))}` : "💶 Live-Preis & Alarm"}</span>
      </button>`).join("");
  } catch (e) {
    if (isAbort(e)) return;
    box.innerHTML = `<p class="text-rose-400 col-span-full text-center py-4">${esc(e?.status === 429 ? e.message : "Kartensuche gerade nicht erreichbar. Bitte gleich erneut versuchen.")}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Preis-Tracker (Flip-Radar)
// ---------------------------------------------------------------------------
function injectTracker() {
  const view = $("view-flip");
  if (!view || $("ps-tracker")) return;
  const el = document.createElement("div");
  el.id = "ps-tracker";
  el.className = "poke-glass rounded-3xl p-4 sm:p-5 space-y-3 border-2 border-yellow-400/50";
  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <span class="text-[10px] font-black uppercase bg-emerald-400 text-slate-950 px-2.5 py-0.5 rounded-full">📡 Live-Preis-Tracker • Cardmarket</span>
        <h2 class="text-base sm:text-lg font-black text-white mt-1">Preisalarme: Wir beobachten deine Wunschkarten stündlich</h2>
        <p class="text-xs text-slate-300">Karte suchen → Zielpreis festlegen → Mitteilung, sobald der Preis fällt (oder steigt). Auch neue Inserate unter deinem Zielpreis melden sich sofort.</p>
      </div>
      <span id="ps-alert-usage" class="text-xs font-black text-yellow-300"></span>
    </div>
    <div class="flex gap-2 text-xs">
      <input id="ps-track-q" placeholder="Karte suchen (z. B. Glurak, Nachtara, Pikachu) …" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" />
      <button id="ps-track-go" class="bg-yellow-400 text-slate-950 font-black px-4 rounded-xl">🔎 Suchen</button>
    </div>
    <div id="ps-track-results" class="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs max-h-80 overflow-y-auto"></div>
    <div id="ps-alert-list" class="space-y-2"></div>`;
  view.prepend(el);
  const go = () => searchCards($("ps-track-q").value.trim(), "ps-track-results");
  $("ps-track-go").onclick = go;
  $("ps-track-q").addEventListener("keydown", (e) => e.key === "Enter" && go());
}

async function loadAlerts() {
  const box = $("ps-alert-list");
  if (!box) return;
  if (!state.user) {
    state.alerts = null;
    box.innerHTML = `<div class="bg-slate-950 rounded-2xl p-3 text-xs text-slate-300 flex items-center justify-between gap-2 border border-slate-800">
      <span>🔐 Melde dich kostenlos an, um bis zu 3 Preisalarme zu aktivieren.</span>${btn("Anmelden", "PS.openAccount()")}</div>`;
    $("ps-alert-usage").textContent = "";
    return;
  }
  try {
    const { alerts, limit } = await api("/api/alerts");
    state.alerts = alerts;
    $("ps-alert-usage").textContent = `${alerts.length}/${limit} Alarme`;
    box.innerHTML = alerts.length ? alerts.map((a) => {
      const hit = a.price && (a.direction === "below" ? a.price <= a.targetPrice : a.price >= a.targetPrice);
      return `<div class="flex items-center gap-3 bg-slate-900 border ${hit ? "border-emerald-400" : "border-slate-800"} rounded-xl p-2.5 text-xs">
        <img src="${esc(cdn(a.image || FALLBACK_IMG, 80))}" class="w-9 h-12 object-contain rounded shrink-0 cursor-pointer" onclick="PS.openCard(${jsArg(a.cardId)})" />
        <div class="min-w-0 flex-1">
          <p class="font-bold text-white truncate">${esc(a.name)}</p>
          <p class="text-slate-400">Jetzt <strong class="text-emerald-400">${a.price ? eur(a.price) : "–"}</strong> • Ziel ${a.direction === "below" ? "≤" : "≥"} <strong class="text-yellow-300">${eur(a.targetPrice)}</strong> ${hit ? `<span class="text-emerald-400 font-black">• ZIEL ERREICHT</span>` : ""}</p>
        </div>
        <div class="hidden sm:block">${sparkline(a.history)}</div>
        <a href="${cm(a.name)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-bold px-2 py-1 rounded-lg">CM</a>
        <a href="${ebay(a.name)}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2 py-1 rounded-lg">eBay</a>
        <button onclick="PS.deleteAlert(${Number(a.id)})" class="text-slate-400 hover:text-rose-400 px-1" aria-label="Alarm löschen">✕</button>
      </div>`;
    }).join("") : `<p class="text-xs text-slate-500 text-center py-2">Noch keine Alarme. Suche oben eine Karte und lege deinen Zielpreis fest.</p>`;
  } catch (e) { if (e.status !== 401) box.innerHTML = `<p class="text-xs text-rose-300">${esc(e.message)}</p>`; }
}

async function deleteAlert(id) {
  try { await api(`/api/alerts/${id}`, { method: "DELETE" }); loadAlerts(); } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Portfolio mit Wertentwicklung
// ---------------------------------------------------------------------------
const origRenderPortfolio = window.renderPortfolio;
const origAddPortfolioItem = window.addPortfolioItem;
const origAddCardByNumber = window.addCardByNumber;
const origAddCurrentSwipe = window.addCurrentSwipeToPortfolio;
const origAddApiCard = window.addApiCardToPortfolio;

function injectPortfolioDash() {
  const view = $("view-portfolio");
  if (!view || $("ps-pf-dash")) return;
  const el = document.createElement("div");
  el.id = "ps-pf-dash";
  el.className = "poke-glass rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-emerald-500/40";
  view.prepend(el);

  // Schnellsuche im Portfolio-Bereich: echte Karten mit Live-Preis hinzufügen
  const scan = $("scan-card-number")?.parentElement;
  if (scan && !$("ps-pf-search")) {
    const s = document.createElement("div");
    s.innerHTML = `<div class="bg-slate-950 p-3 rounded-2xl border border-emerald-500/40 space-y-2 text-xs">
      <div class="flex gap-2"><input id="ps-pf-search" placeholder="🔎 Echte Karte mit Live-Preis suchen (z. B. Glurak ex) …" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" />
      <button id="ps-pf-search-go" class="bg-emerald-500 text-slate-950 font-black px-4 rounded-xl">Suchen</button></div>
      <div id="ps-pf-results" class="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto"></div></div>`;
    scan.before(s.firstElementChild);
    const go = () => searchCards($("ps-pf-search").value.trim(), "ps-pf-results");
    $("ps-pf-search-go").onclick = go;
    $("ps-pf-search").addEventListener("keydown", (e) => e.key === "Enter" && go());
  }
}

function renderPortfolioDash() {
  const el = $("ps-pf-dash");
  if (!el) return;
  if (!state.user) {
    el.innerHTML = `<div class="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
      <div><h2 class="text-base font-black text-white">📈 Portfolio mit Live-Wertentwicklung</h2>
      <p class="text-slate-300">Melde dich an: Deine Karten werden sicher gespeichert, täglich mit echten Cardmarket-Preisen bewertet und du siehst Gewinn, Verlust und Top-Mover.</p></div>
      ${btn("Kostenlos anmelden", "PS.openAccount()", "shrink-0 bg-emerald-500 text-slate-950")}</div>`;
    return;
  }
  const p = state.portfolio;
  if (!p) { el.innerHTML = `<p class="text-xs text-yellow-400 text-center py-4">⏳ Lade dein Portfolio …</p>`; return; }
  const gainCls = p.gain >= 0 ? "text-emerald-400" : "text-rose-400";
  el.innerHTML = `
    <div class="flex flex-wrap justify-between items-center gap-2">
      <h2 class="text-base sm:text-lg font-black text-white">📈 Wertentwicklung deiner Sammlung</h2>
      <div class="flex gap-2 text-xs">
        ${state.me?.plan === "pro" ? `<a href="/api/portfolio/export.csv" class="bg-slate-800 text-white font-bold px-3 py-1.5 rounded-xl">⬇️ CSV</a>` : ""}
        <span class="text-slate-400 py-1.5">${p.items.length}/${p.limit} Karten</span>
      </div>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800"><p class="text-slate-400 font-bold uppercase text-[10px]">Marktwert</p><p class="text-lg font-black text-emerald-400">${eur(p.total)}</p></div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800"><p class="text-slate-400 font-bold uppercase text-[10px]">Einkauf</p><p class="text-lg font-black text-white">${p.cost ? eur(p.cost) : "–"}</p></div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800"><p class="text-slate-400 font-bold uppercase text-[10px]">Gewinn / Verlust</p><p class="text-lg font-black ${gainCls}">${p.cost ? `${p.gain >= 0 ? "+" : ""}${eur(p.gain)}` : "–"}</p></div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800"><p class="text-slate-400 font-bold uppercase text-[10px]">Rendite</p><p class="text-lg font-black ${gainCls}">${p.gainPct !== null ? pct(p.gainPct) : "–"}</p></div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div class="lg:col-span-2 bg-slate-950 rounded-2xl p-3 border border-slate-800 relative">
        ${p.historyLocked ? `<div class="h-36 flex flex-col items-center justify-center gap-2 text-xs text-center"><p class="text-slate-300">🔒 Der tägliche Wertverlauf ist in Premium enthalten.</p>${btn("Premium ansehen", "PS.openPro()")}</div>` : areaChart(p.history)}
      </div>
      <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800 text-xs space-y-1.5">
        <p class="font-black text-white">🔥 Top-Mover (30 Tage)</p>
        ${p.movers.length ? p.movers.map((m) => `<div class="flex justify-between gap-2"><span class="truncate text-slate-300">${esc(m.name)}</span><strong class="${m.change30 >= 0 ? "text-emerald-400" : "text-rose-400"}">${pct(m.change30)}</strong></div>`).join("")
          : `<p class="text-slate-500">Füge Karten über die Suche hinzu, dann erscheinen hier die größten Preisbewegungen.</p>`}
      </div>
    </div>`;
}

function renderServerPortfolio() {
  renderPortfolioDash();
  const p = state.portfolio;
  if (!p) return;
  const total = eur(p.total);
  if ($("portfolio-total")) $("portfolio-total").textContent = total;
  if ($("statPortfolioVal")) $("statPortfolioVal").textContent = total;
  const box = $("portfolio-list");
  if (!box) return;
  refreshDupes();
  if (!p.items.length) { $("ps-pf-sellbar")?.remove(); box.innerHTML = `<p class="text-xs text-slate-500 py-4 text-center">Dein Portfolio ist leer. Suche oben eine Karte – der Wert wird automatisch live berechnet.</p>`; return; }
  const dupeMap = new Map(groupDuplicates(p.items).map((d) => [d.cardId, d]));
  const sellable = (i) => Boolean(i.cardId || i.printId);
  // Verkaufen-Leiste: Auswahlmodus für mehrere Karten → ein Schnell-Inserat für alle
  const bar = $("ps-pf-sellbar") || (() => {
    const el = document.createElement("div");
    el.id = "ps-pf-sellbar";
    box.before(el);
    return el;
  })();
  for (const id of [...pfSell.sel]) if (!p.items.some((i) => Number(i.id) === id && sellable(i))) pfSell.sel.delete(id);
  const selItems = p.items.filter((i) => pfSell.sel.has(Number(i.id)));
  const selTotal = selItems.reduce((sum, i) => sum + (Number(i.unitValue) || 0), 0);
  bar.className = "mb-2";
  bar.innerHTML = pfSell.on
    ? `<div class="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-2 border-emerald-400/60 rounded-2xl p-2 flex flex-wrap items-center gap-2 text-xs">
        <span class="font-black text-white flex-1 min-w-[8rem]">🏷️ ${selItems.length} ausgewählt${selItems.length ? ` • ${eur(selTotal)}` : " – Karten antippen"}</span>
        <button onclick="PS.pfSellAll()" class="bg-slate-800 text-white font-bold px-2.5 py-1.5 rounded-xl">Alle</button>
        <button onclick="PS.pfSellGo()" ${selItems.length ? "" : "disabled"} class="bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 font-black px-3 py-1.5 rounded-xl disabled:opacity-40">🚀 Verkaufen</button>
        <button onclick="PS.pfSellGo('instant')" ${selItems.length ? "" : "disabled"} class="bg-yellow-400 text-slate-950 font-black px-2.5 py-1.5 rounded-xl disabled:opacity-40" title="Faire Preise, gemerkte Angaben – nach kurzem Countdown live">⚡ 1-Tap</button>
        <button onclick="PS.pfSellMode(false)" class="text-slate-400 hover:text-white px-1" aria-label="Auswahl beenden">✕</button>
      </div>`
    : p.items.some(sellable) ? `<button onclick="PS.pfSellMode(true)" class="w-full bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-400/50 text-emerald-200 font-black text-xs py-2 rounded-xl">🏷️ Mehrere Karten auf einmal verkaufen – faire Preise sind schon eingetragen</button>` : "";
  const shownDupe = new Set();
  const dupeBadge = (i) => {
    const d = i.cardId && dupeMap.get(i.cardId);
    if (!d || shownDupe.has(d.cardId)) return "";
    shownDupe.add(d.cardId);
    return `<button onclick="event.stopPropagation();PS.sellSurplus(${jsArg(d.cardId)})" class="mt-0.5 inline-block bg-amber-400 text-slate-950 text-[10px] font-black rounded-md px-1.5 py-0.5 text-left">♻️ ${esc(surplusBadge(d, eur))} • verkaufen</button>`;
  };
  const condKey = (c) => ({ M: "mint", NM: "nm", EX: "ex", GD: "gd", LP: "lp", PL: "pl", PO: "po" })[String(c || "").toUpperCase()] || "";
  box.innerHTML = p.items.map((i) => {
    const listed = activeListingFor(i);
    const picked = pfSell.sel.has(Number(i.id));
    const open = pfSell.on && sellable(i) ? `onclick="PS.pfSellToggle(${Number(i.id)})"`
      : i.printId ? `onclick="PS.openPrint(${jsArg(i.printId)})"` : i.cardId ? `onclick="PS.openCard(${jsArg(i.cardId)})"` : "";
    return `
    <div class="flex items-center justify-between gap-2 bg-slate-900 border ${picked ? "border-emerald-400 ring-1 ring-emerald-400" : "border-slate-800"} px-3 py-2 rounded-xl text-xs">
      <div class="flex items-center gap-2.5 min-w-0 ${i.cardId || i.printId ? "cursor-pointer" : ""}" ${open}>
        ${pfSell.on ? `<span class="shrink-0 w-5 h-5 rounded-md border-2 ${picked ? "bg-emerald-400 border-emerald-300 text-slate-950" : "border-slate-500"} ${sellable(i) ? "" : "opacity-30"} flex items-center justify-center text-[11px] font-black" aria-hidden="true">${picked ? "✓" : ""}</span>` : ""}
        <div class="relative shrink-0 w-10 pb-1">
          <img src="${esc(cdn(i.image || FALLBACK_IMG, 80))}" onerror="this.src='${FALLBACK_IMG}'" class="w-10 h-14 object-contain rounded" />
          ${listed ? `<div class="absolute -bottom-1 -left-1.5 ps-price-tag-tilt">${priceTagHtml({ price: Number(listed.price), condition: listed.condition || condKey(i.condition) }, "sm")}</div>`
            : Number(i.unitValue) > 0 ? `<div class="absolute -bottom-1 -left-1.5 ps-price-tag-tilt opacity-80">${priceTagHtml({ price: Number(i.unitValue), condition: condKey(i.condition) }, "sm")}</div>` : ""}
        </div>
        <div class="min-w-0">
          <p class="font-bold text-white truncate">${langFlag(i.lang)}${i.quantity > 1 ? `${Number(i.quantity) || 0}× ` : ""}${esc(i.name)}</p>
          <p class="flex gap-1 items-center">${variantBadge(i.variant)}${i.condition && i.condition !== "NM" ? `<span class="text-[9px] font-black bg-slate-700 text-slate-100 px-1.5 rounded">${esc(i.condition)}</span>` : ""}${i.live && i.variant !== "normal" && !i.exactVariant ? `<span class="text-[9px] text-slate-500">Basispreis</span>` : ""}</p>
          <p><span class="text-emerald-400 font-bold">${eur(i.value)}</span>
            ${i.live ? `<span class="text-[10px] text-cyan-300 font-bold">• LIVE</span>` : `<span class="text-[10px] text-slate-500">• Schätzwert</span>`}
            ${i.change30 !== null ? `<span class="${i.change30 >= 0 ? "text-emerald-400" : "text-rose-400"} text-[10px] font-bold">${pct(i.change30)}</span>` : ""}
            ${i.purchasePrice !== null ? `<span class="text-slate-500 text-[10px]">• EK ${eur(i.purchasePrice)}</span>` : ""}</p>
          ${dupeBadge(i)}
          ${listed ? `<span class="mt-0.5 inline-block text-[10px] font-black text-emerald-300">✅ Inseriert für ${eur(listed.price)}${listed.buy_now ? " • Sofort-Kauf" : ""}</span>` : ""}
        </div>
      </div>
      <div class="flex gap-1.5 shrink-0 items-center">
        ${sellable(i) && !pfSell.on ? (listed
          ? `<button onclick="PS.showSub('map', 'market')" class="bg-emerald-500/20 text-emerald-300 font-bold px-2 py-1 rounded-lg" title="Zu deinen Inseraten">📋</button>`
          : `<button onclick="PS.sellPortfolioItem(${Number(i.id)})" class="bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 font-black px-2 py-1 rounded-lg" title="Verkaufen – fairer Preis ist schon eingetragen">🏷️ Verkaufen</button>`) : ""}
        <button onclick="PS.editItem(${Number(i.id)})" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg" title="Anzahl / Einkaufspreis">✏️</button>
        <a href="${cm(i.name)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-bold px-2 py-1 rounded-lg">CM</a>
        <a href="${ebay(i.name)}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2 py-1 rounded-lg">eBay</a>
        <button onclick="PS.removeItem(${Number(i.id)})" class="text-slate-400 hover:text-rose-400 px-1.5" aria-label="Entfernen">✕</button>
      </div>
    </div>`;
  }).join("");
}

// Auswahlmodus „Mehrere verkaufen“ in der Sammlung
const pfSell = { on: false, sel: new Set() };
const pfSellApi = {
  pfSellMode: (on) => { pfSell.on = Boolean(on); if (!on) pfSell.sel.clear(); renderServerPortfolio(); },
  pfSellToggle: (id) => { id = Number(id); if (pfSell.sel.has(id)) pfSell.sel.delete(id); else pfSell.sel.add(id); renderServerPortfolio(); },
  pfSellAll: () => {
    const items = (state.portfolio?.items || []).filter((i) => (i.cardId || i.printId) && !activeListingFor(i));
    const all = items.length && items.every((i) => pfSell.sel.has(Number(i.id)));
    pfSell.sel = all ? new Set() : new Set(items.slice(0, 60).map((i) => Number(i.id)));
    renderServerPortfolio();
  },
  pfSellGo: (mode = "") => {
    const ids = [...pfSell.sel].slice(0, 60);
    if (!ids.length) return toast("Nichts ausgewählt", "Tippe die Karten an, die du verkaufen möchtest.");
    sellApi.sellPortfolioItems(ids, mode);
    pfSell.on = false; pfSell.sel.clear(); renderServerPortfolio();
  },
};
window.addEventListener("ps:my-listings", () => { if (state.portfolio) renderServerPortfolio(); });

async function loadPortfolio() {
  if (!state.user) { state.portfolio = null; renderPortfolioDash(); origRenderPortfolio?.(); refreshDupes(); return; }
  try { state.portfolio = await api("/api/portfolio"); renderServerPortfolio(); loadMyListings(); }
  catch (e) { if (e.status === 401) { state.user = null; renderPortfolioDash(); } }
}

async function addPortfolioQuick(body) {
  try { await api("/api/portfolio", { method: "POST", body }); toast("💼 Gespeichert", `${body.name || "Karte"} ist im Portfolio.`); loadPortfolio(); }
  catch (e) { handleError(e); }
}

function editItem(id) {
  const i = state.portfolio?.items.find((x) => x.id === id);
  if (!i) return;
  modal("ps-card", `<h3 class="text-base font-black text-white">✏️ ${esc(i.name)}</h3>
    <div class="space-y-2 text-xs">
      <label class="text-slate-300 font-bold">Anzahl</label>${input("ps-ed-qty", `type="number" min="1" max="999" value="${Number(i.quantity) || 1}"`)}
      <label class="text-slate-300 font-bold">Einkaufspreis pro Stück (€)</label>${input("ps-ed-buy", `type="number" step="0.01" min="0" value="${esc(i.purchasePrice ?? "")}"`)}
      <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-slate-300 font-bold">Variante</span>${variantSelect("ps-ed-variant", i.variants?.length ? i.variants : VARIANT_KEYS, i.variant || "normal")}</label>
        <label class="space-y-1"><span class="text-slate-300 font-bold">Zustand</span>${conditionSelect("ps-ed-cond", CONDITION_LABEL[i.condition] ? i.condition : "NM")}</label></div>
      ${i.live ? "" : `<label class="text-slate-300 font-bold">Geschätzter Wert pro Stück (€)</label>${input("ps-ed-val", `type="number" step="0.01" min="0" value="${esc(i.manualValue ?? "")}"`)}`}
      ${btn("Speichern", `PS.saveItem(${Number(i.id)})`, "w-full bg-emerald-500 text-slate-950")}
    </div>`);
}
async function saveItem(id) {
  const body = { quantity: $("ps-ed-qty").value, purchasePrice: $("ps-ed-buy").value || null, variant: $("ps-ed-variant")?.value || "normal", condition: $("ps-ed-cond")?.value || "NM" };
  if ($("ps-ed-val")) body.manualValue = $("ps-ed-val").value || null;
  try { await api(`/api/portfolio/${id}`, { method: "PATCH", body }); closeModalEl("ps-card"); loadPortfolio(); } catch (e) { handleError(e); }
}
async function removeItem(id) {
  try { await api(`/api/portfolio/${id}`, { method: "DELETE" }); loadPortfolio(); } catch (e) { handleError(e); }
}

function overridePortfolio() {
  window.renderPortfolio = () => (state.user ? renderServerPortfolio() : origRenderPortfolio?.());
  window.addPortfolioItem = () => {
    if (!state.user) return origAddPortfolioItem?.();
    const name = $("port-name").value.trim(), val = $("port-value").value;
    if (!name) return toast("Portfolio", "Bitte einen Kartennamen eingeben – oder oben eine echte Karte mit Live-Preis suchen.");
    const img = window.resolveCard ? window.resolveCard(name).img : "";
    $("port-name").value = ""; $("port-value").value = "";
    addPortfolioQuick({ name, manualValue: val, image: img });
  };
  window.addCardByNumber = () => {
    if (!state.user) return origAddCardByNumber?.();
    const num = $("scan-card-number").value.trim();
    if (!num) return toast("Portfolio", "Bitte eine Kartennummer eingeben (z. B. 238/191).");
    const f = window.resolveCard(num);
    $("scan-card-number").value = "";
    addPortfolioQuick({ name: f.name, manualValue: f.value, image: f.img });
  };
  window.addCurrentSwipeToPortfolio = () => {
    const item = window.currentSwipeItem?.();
    // Tausch-Inserat im Stapel → Tauschanfrage statt Sammlung
    if (item?.kind === "listing" && item.listingId) return requestTrade(item.listingId);
    if (!state.user) return origAddCurrentSwipe?.();
    try {
      if (item && (item.printId || item.cardId)) return addSwipeItemToPortfolio(item, () => addPortfolioQuick({ name: item.title, manualValue: item.cm, image: item.img }));
      const cur = item || activeDeck[swipeIdx % activeDeck.length];
      addPortfolioQuick({ name: cur.title, manualValue: cur.cm, image: cur.img });
    } catch { origAddCurrentSwipe?.(); }
  };
  window.addApiCardToPortfolio = (title, img) => {
    if (!state.user) return origAddApiCard?.(title, img);
    addPortfolioQuick({ name: title, image: img });
  };
  // Die Arena-Kartensuche öffnet jetzt die Detailansicht mit Live-Preis
  window.searchTCGdexLive = () => searchCards(($("tcgdex-search-inp")?.value || "").trim(), "tcgdex-results");
  // Zentrale Katalogsuche auch für ältere Seitenteile (index.html)
  window.psSearchCatalog = searchCatalog;
  // Alte lokale Preis-Wächter → echter Preis-Tracker
  window.addWishlistRule = () => {
    const q = ($("wish-card")?.value || "").trim();
    switchTabSafe("flip");
    if ($("ps-track-q")) { $("ps-track-q").value = q; if (q) searchCards(q, "ps-track-results"); }
    $("ps-tracker")?.scrollIntoView({ behavior: "smooth" });
  };
}

// ---------------------------------------------------------------------------
// Tausch-Hub (Marktplatz) – serverseitig gespeichert, nur Eigentümer dürfen ändern
// ---------------------------------------------------------------------------
async function loadListings() {
  try {
    const { listings } = await api("/api/listings");
    state.listings = listings;
    renderMarket();
  } catch {}
}

const priceBadge = { deal: ["🔥 Top-Deal", "bg-emerald-500 text-slate-950"], fair: ["✓ Fairer Preis", "bg-slate-700 text-slate-100"], high: ["Über Markt", "bg-rose-500/30 text-rose-200"] };

function renderMarket() {
  const box = $("market-list");
  if (!box) return;
  const f = ($("market-search")?.value || "").toLowerCase().trim();
  const list = f ? state.listings.filter((m) => (m.card_name || "").toLowerCase().includes(f) || (m.city || "").toLowerCase().includes(f)) : state.listings;
  if ($("marketTotalBadge")) $("marketTotalBadge").textContent = state.listings.length;
  if ($("statMarketCount")) $("statMarketCount").textContent = state.listings.length;
  if (!list.length) { box.innerHTML = `<div class="poke-glass rounded-2xl p-6 text-center text-xs text-slate-400">Noch keine passenden Inserate. Nutze links das Stapel-Inserat!</div>`; return; }
  box.innerHTML = list.map(listingCard).join("");
}

function listingCard(l) {
  {
    const own = l.user_id === state.user?.id;
    const pb = l.priceCheck ? priceBadge[l.priceCheck] : null;
    return `<div class="poke-glass rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${l.boosted ? "border-2 border-yellow-400 shadow-[0_0_18px_rgba(250,204,21,.25)]" : ""}">
      <div class="flex items-center gap-3 min-w-0">
        <div class="relative shrink-0 pb-1">
          <img src="${esc(cdn(l.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" class="w-12 h-16 ${String(l.image || "").startsWith("/api/images/") ? "object-cover" : "object-contain"} rounded border border-yellow-400/40" />
          <div class="absolute -bottom-1 -left-2 ps-price-tag-tilt">${priceTagHtml({ price: Number(l.price), condition: l.condition || "" }, "sm")}</div>
        </div>
        <div class="min-w-0 text-xs space-y-0.5">
          <div class="flex flex-wrap gap-1">
            ${l.boosted ? `<span class="text-[9px] font-black bg-yellow-400 text-slate-950 px-1.5 rounded">🚀 TOP</span>` : ""}
            ${pb ? `<span class="text-[9px] font-black ${pb[1]} px-1.5 rounded" title="Vergleich mit Cardmarket-Trend ${l.market_price ? eur(l.market_price) : ""}">${pb[0]}</span>` : ""}
            ${listingMetaHtml(l)}
          </div>
          <h4 class="font-black text-white text-sm truncate">${esc(l.card_name)}</h4>
          <p><span class="font-black text-emerald-400">${eur(l.price)}</span>${l.market_price ? ` <span class="text-slate-500">(Markt ${eur(l.market_price)})</span>` : ""} • <span class="text-slate-400">📍 ${esc(l.city)}</span></p>
          <p class="text-amber-300 truncate">Sucht: ${esc(l.want)}</p>
          <button onclick="PS.openUser(${jsArg(l.user_id)})" class="text-slate-300 hover:text-white font-bold">${esc(l.seller)} ${l.verified ? `<span class="text-cyan-300">✔ Verifiziert</span>` : ""} ${l.rating_count ? `<span class="text-amber-300">⭐ ${Number(l.rating) || 0} (${Number(l.rating_count) || 0})</span>` : `<span class="text-slate-500">• neu</span>`}</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5 shrink-0 text-xs">
        ${own ? `
          ${l.boosted ? "" : `<button onclick="PS.boost(${Number(l.id)})" class="bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black px-2.5 py-1.5 rounded-xl">🚀 Boost</button>`}
          ${listingBuyHtml(l)}
          <button onclick="PS.setListingStatus(${Number(l.id)}, 'sold')" class="bg-emerald-500/20 text-emerald-300 font-bold px-2.5 py-1.5 rounded-xl">✓ Verkauft</button>
          <button onclick="PS.setListingStatus(${Number(l.id)}, 'removed')" class="bg-rose-500/20 text-rose-300 font-bold px-2.5 py-1.5 rounded-xl" aria-label="Löschen">🗑️</button>`
        : `${listingBuyHtml(l)}<button onclick="PS.requestTrade(${Number(l.id)})" class="bg-emerald-500 text-slate-950 font-black px-3 py-1.5 rounded-xl">🤝 Anfragen</button>
          <button onclick="PS.report('listing', '${Number(l.id)}')" class="bg-slate-800 text-slate-300 font-bold px-2 py-1.5 rounded-xl" title="Melden">⚠️</button>`}
        <a href="${cm(l.card_name)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-bold px-2.5 py-1.5 rounded-xl">CM</a>
        <a href="${ebay(l.card_name)}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2.5 py-1.5 rounded-xl">eBay</a>
      </div>
    </div>`;
  }
}

async function setListingStatus(id, status) {
  if (status === "removed" && !confirm("Inserat wirklich löschen?")) return;
  try { await api(`/api/listings/${id}/status`, { method: "POST", body: { status } }); loadListings(); loadMe().then(renderHeader); }
  catch (e) { handleError(e); }
}

// Stapel-Inserate der bestehenden Oberfläche gesammelt an den Server senden
let listingQueue = [];
function overrideMarket() {
  window.renderMarket = renderMarket;
  window.deleteMarketItem = (id) => setListingStatus(id, "removed");
  window.publishSingleMarketObject = (cardStr, priceNum, wantStr, cityStr, customImg = "") => {
    const card = String(cardStr || "").trim().slice(0, 120);
    if (!card) return false;
    const resolved = window.resolveCard ? window.resolveCard(card) : { value: 0, img: "" };
    const price = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : resolved.value;
    listingQueue.push({ card, price, want: wantStr, city: cityStr, img: customImg || resolved.img });
    if (listingQueue.length === 1) queueMicrotask(flushListings);
    return true;
  };
  for (const name of ["submitAllCardRows", "submitBulkTextListings"]) {
    const orig = window[name];
    window[name] = (...args) => { if (requireLogin()) return orig?.(...args); };
  }
}
// Der Server nimmt höchstens LISTING_BATCH Inserate pro Anfrage an – größere Stapel in Blöcken senden
const LISTING_BATCH = 20;
async function flushListings() {
  const items = listingQueue; listingQueue = [];
  if (!items.length) return;
  let created = 0, skipped = 0, failed = 0;
  for (let i = 0; i < items.length; i += LISTING_BATCH) {
    const chunk = items.slice(i, i + LISTING_BATCH);
    try {
      const r = await api("/api/listings", { method: "POST", body: { items: chunk } });
      created += Number(r.created) || 0; skipped += Number(r.skipped) || 0;
    } catch (e) {
      // Limit erreicht o. Ä.: Rest nicht mehr senden, Fehler einmal anzeigen
      failed += items.length - i;
      handleError(e);
      break;
    }
  }
  if (items.length > 1 || skipped || failed) {
    toast(created ? `🚀 ${created} Inserat(e) veröffentlicht` : "Keine Inserate veröffentlicht",
      [skipped ? `${skipped} übersprungen (Limit oder fehlender Preis)` : "", failed ? `${failed} nicht gesendet` : ""].filter(Boolean).join(" • "));
  }
  loadListings(); loadMe().then(renderHeader);
}

// ---------------------------------------------------------------------------
// Sicherer Tausch
// ---------------------------------------------------------------------------
// Tauschanfrage & Match-Vorschlag: client/trading.js (strukturierte Kartenauswahl statt Freitext)
const requestTrade = (id) => tradingApi.requestTrade(id);

const safetyTips = () => `<div class="bg-slate-950 border border-cyan-500/30 rounded-2xl p-3 text-[11px] text-slate-300 space-y-1">
  <p class="font-black text-cyan-300">🛡️ Sicher tauschen</p>
  <p>• Zahle nur mit Käuferschutz (z. B. PayPal Waren & Dienstleistungen) – niemals „Freunde & Familie“.</p>
  <p>• Versand versichert mit Sendungsnummer; bei hohen Werten persönlich übergeben.</p>
  <p>• Achte auf Bewertungen und den ✔-Badge. Verdächtig? Sofort ⚠️ melden.</p></div>`;

const statusLabel = {
  pending: ["⏳ Offen", "text-amber-300"], accepted: ["✅ Angenommen", "text-emerald-300"], shipping: ["📦 Versand läuft", "text-cyan-300"], declined: ["❌ Abgelehnt", "text-rose-300"],
  cancelled: ["🚫 Abgebrochen", "text-slate-400"], completed: ["🏆 Abgeschlossen", "text-cyan-300"],
};

async function openTrades(selectId) {
  if (!requireLogin()) return;
  closeModalEl("ps-account");
  modal("ps-trades", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade deine Tausche …</p>`, { wide: true, onClose: stopChat });
  try {
    const { trades } = await api("/api/trades");
    state.trades = trades;
    renderTrades(selectId || state.openTrade || trades[0]?.id);
  } catch (e) { closeModalEl("ps-trades"); handleError(e); }
}

function renderTrades(selectId) {
  const t = state.trades;
  modal("ps-trades", `
    <h3 class="text-base font-black text-white">🤝 Meine Tausche</h3>
    ${t.length ? `<div class="grid grid-cols-1 md:grid-cols-5 gap-3">
      <div class="md:col-span-2 space-y-1.5 max-h-[60vh] overflow-y-auto">
        ${t.map((x) => `<button onclick="PS.selectTrade(${Number(x.id)})" class="w-full text-left bg-slate-900 border ${x.id === selectId ? "border-yellow-400" : "border-slate-800"} rounded-xl p-2.5 text-xs">
          <p class="font-bold text-white truncate">${esc(x.request)}</p>
          <p class="text-slate-400 truncate">${x.role === "sender" ? `an ${esc(x.to_name)}` : `von ${esc(x.from_name)}`} • <span class="${(statusLabel[x.status] || statusLabel.pending)[1]}">${(statusLabel[x.status] || statusLabel.pending)[0]}</span></p>
        </button>`).join("")}
      </div>
      <div id="ps-trade-detail" class="md:col-span-3"></div>
    </div>` : `<p class="text-xs text-slate-400 text-center py-6">Noch keine Tausche. Im Tausch-Hub kannst du bei jedem Inserat „🤝 Anfragen“ tippen.</p>`}`, { wide: true, onClose: stopChat });
  if (selectId && t.find((x) => x.id === selectId)) selectTrade(selectId);
}

function stopChat() { clearInterval(state.chatTimer); state.chatTimer = null; state.openTrade = null; }

async function selectTrade(id) {
  stopChat();
  state.openTrade = id; state.lastMsgId = 0;
  document.querySelectorAll("#ps-trades button[onclick^='PS.selectTrade']").forEach((b) => {
    b.classList.toggle("border-yellow-400", b.getAttribute("onclick") === `PS.selectTrade(${id})`);
    b.classList.toggle("border-slate-800", b.getAttribute("onclick") !== `PS.selectTrade(${id})`);
  });
  const x = state.trades.find((t) => t.id === id);
  const box = $("ps-trade-detail");
  if (!x || !box) return;
  const recv = x.role === "receiver";
  const myConfirmed = recv ? x.to_confirmed : x.from_confirmed;
  const partner = recv ? x.from_name : x.to_name;
  const partnerId = recv ? x.from_user : x.to_user;
  box.innerHTML = `
    <div class="bg-slate-950 rounded-2xl p-3 border border-slate-800 space-y-2 text-xs">
      <div class="flex justify-between items-start gap-2">
        <div class="min-w-0">
          <p class="font-black text-white">${esc(x.request)}</p>
          ${x.structured ? "" : `<p class="text-slate-400">Angebot: <span class="text-amber-300">${esc(x.offer)}</span></p>`}
          <button onclick="PS.openUser(${jsArg(partnerId)})" class="text-slate-300 underline">Partner: ${esc(partner)}</button>
        </div>
        <span class="${(statusLabel[x.status] || statusLabel.pending)[1]} font-black shrink-0">${(statusLabel[x.status] || statusLabel.pending)[0]}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${x.status === "pending" && recv ? btn("Annehmen", `PS.tradeAction(${Number(x.id)}, 'accept')`, "bg-emerald-500 text-slate-950") + btn("Ablehnen", `PS.tradeAction(${Number(x.id)}, 'decline')`, "bg-rose-500/20 text-rose-300") : ""}
        ${x.status === "accepted" && !myConfirmed && !x.structured ? btn("📦 Erhalt bestätigen", `PS.tradeAction(${Number(x.id)}, 'complete')`, "bg-cyan-400 text-slate-950") : ""}
        ${x.status === "accepted" && myConfirmed && !x.structured ? `<span class="text-cyan-300 py-2">✓ Du hast bestätigt – wartet auf Partner</span>` : ""}
        ${["pending", "accepted"].includes(x.status) && !x.from_shipped_at && !x.to_shipped_at ? btn("Abbrechen", `PS.tradeAction(${Number(x.id)}, 'cancel')`, "bg-slate-800 text-slate-300") : ""}
        ${btn("⚠️ Melden", `PS.report('trade', '${Number(x.id)}')`, "bg-slate-800 text-slate-400")}
      </div>
      ${tradeDetailHtml(x)}
      ${x.status === "completed" && !x.reviewed ? `<div class="border-t border-slate-800 pt-2 space-y-1.5">
        <p class="font-black text-yellow-300">⭐ Wie lief der Tausch mit ${esc(partner)}?</p>
        <div class="flex gap-1" id="ps-stars">${[1, 2, 3, 4, 5].map((n) => `<button onclick="PS.pickStars(${n})" data-star="${n}" class="text-2xl text-slate-600">★</button>`).join("")}</div>
        ${input("ps-rev-text", 'maxlength="500" placeholder="Kurzer Kommentar (optional)"')}
        ${btn("Bewertung abgeben", `PS.sendReview(${Number(x.id)})`, "w-full bg-yellow-400 text-slate-950")}
      </div>` : ""}
    </div>
    <div id="ps-chat" class="mt-2 bg-slate-950 rounded-2xl p-3 border border-slate-800 h-56 overflow-y-auto space-y-1.5 text-xs"></div>
    ${["declined", "cancelled"].includes(x.status) ? "" : `<div class="flex gap-2 mt-2">
      <input id="ps-chat-in" maxlength="1000" placeholder="Private Nachricht …" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
      <button onclick="PS.sendMsg(${Number(x.id)})" class="bg-yellow-400 text-slate-950 font-black px-4 rounded-xl text-xs">Senden</button></div>`}
    ${["pending", "accepted", "shipping"].includes(x.status) ? safetyTips() : ""}`;
  $("ps-chat-in")?.addEventListener("keydown", (e) => e.key === "Enter" && sendMsg(x.id));
  await pollChat(id);
  // Während des Ladens wurde evtl. schon ein anderer Tausch gewählt – sonst bliebe ein verwaister Timer übrig
  if (state.openTrade !== id) return;
  clearInterval(state.chatTimer);
  state.chatTimer = setInterval(() => { if (!document.hidden) pollChat(id); }, 4000);
}

let stars = 0;
function pickStars(n) {
  stars = n;
  document.querySelectorAll("#ps-stars [data-star]").forEach((b) => b.classList.toggle("text-yellow-400", Number(b.dataset.star) <= n));
}

async function pollChat(id) {
  if (state.openTrade !== id) return;
  try {
    const { messages, trade } = await api(`/api/trades/${id}/messages?after=${state.lastMsgId}`);
    const box = $("ps-chat");
    if (!box) return;
    if (!state.lastMsgId && !messages.length) box.innerHTML = `<p class="text-slate-500 text-center">Noch keine Nachrichten. Nur ihr beide könnt diesen Chat sehen.</p>`;
    if (messages.length) {
      if (!state.lastMsgId) box.innerHTML = "";
      box.insertAdjacentHTML("beforeend", messages.map((m) => `<div class="flex ${m.mine ? "justify-end" : "justify-start"}">
        <div class="max-w-[80%] ${m.mine ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-white"} rounded-2xl px-3 py-1.5">
          ${m.mine ? "" : `<p class="text-[10px] font-black text-cyan-300">${esc(m.name)}</p>`}<p class="break-words" data-i18n-skip>${esc(m.body)}</p>
          <p class="text-[9px] opacity-60 text-right">${new Date(m.createdAt).toLocaleString("de-DE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</p>
        </div></div>`).join(""));
      state.lastMsgId = messages[messages.length - 1].id;
      box.scrollTop = box.scrollHeight;
    }
    const local = state.trades.find((t) => t.id === id);
    if (local && trade && (local.status !== trade.status || local.from_confirmed !== trade.fromConfirmed || local.to_confirmed !== trade.toConfirmed
      || Boolean(local.from_shipped_at) !== Boolean(trade.fromShippedAt) || Boolean(local.to_shipped_at) !== Boolean(trade.toShippedAt)
      || Boolean(local.from_received_at) !== Boolean(trade.fromReceivedAt) || Boolean(local.to_received_at) !== Boolean(trade.toReceivedAt))) {
      const { trades } = await api("/api/trades");
      state.trades = trades;
      renderTrades(id);
    }
  } catch {}
}

async function sendMsg(id) {
  const inp = $("ps-chat-in");
  const text = inp?.value.trim();
  if (!text) return;
  inp.value = "";
  try { await api(`/api/trades/${id}/messages`, { method: "POST", body: { body: text } }); pollChat(id); }
  catch (e) { inp.value = text; handleError(e); }
}

async function tradeAction(id, action) {
  if (action === "cancel" && !confirm("Tausch wirklich abbrechen?")) return;
  if (action === "complete" && !confirm("Hast du die Karte/Zahlung wirklich erhalten? Das kann nicht rückgängig gemacht werden.")) return;
  if (action === "received" && !confirm("Ist das Paket deines Partners vollständig und wie beschrieben angekommen? Das kann nicht rückgängig gemacht werden.")) return;
  try {
    await api(`/api/trades/${id}/action`, { method: "POST", body: { action } });
    const { trades } = await api("/api/trades");
    state.trades = trades; renderTrades(id); loadListings(); loadMe().then(renderHeader);
  } catch (e) { handleError(e); }
}

async function sendReview(id) {
  if (!stars) return toast("Bewertung", "Bitte 1 bis 5 Sterne auswählen.");
  try {
    await api(`/api/trades/${id}/review`, { method: "POST", body: { stars, comment: $("ps-rev-text").value } });
    stars = 0;
    toast("⭐ Danke für deine Bewertung", "Das macht die Community sicherer.");
    const { trades } = await api("/api/trades");
    state.trades = trades; renderTrades(id);
  } catch (e) { handleError(e); }
}

async function openUser(id) {
  modal("ps-user", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Profil …</p>`);
  try {
    const u = await api(`/api/users/${encodeURIComponent(id)}`);
    modal("ps-user", `
      <h3 class="text-base font-black text-white">${esc(u.displayName)} ${u.verified ? `<span class="text-cyan-300 text-xs">✔ Verifizierter Händler</span>` : ""}</h3>
      <div class="grid grid-cols-3 gap-2 text-center text-xs">
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-lg font-black text-amber-300">${u.rating?.count ? `⭐ ${Number(u.rating.avg) || 0}` : "–"}</p><p class="text-slate-400">${Number(u.rating?.count) || 0} Bewertungen</p></div>
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-lg font-black text-emerald-400">${Number(u.completedTrades) || 0}</p><p class="text-slate-400">Tausche</p></div>
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-sm font-black text-white">${new Date(u.memberSince).toLocaleDateString("de-DE", { month: "short", year: "numeric" })}</p><p class="text-slate-400">Dabei seit</p></div>
      </div>
      ${u.city ? `<p class="text-xs text-slate-400">📍 ${esc(u.city)}</p>` : ""}
      <div class="space-y-1.5 max-h-60 overflow-y-auto text-xs">
        ${u.reviews.length ? u.reviews.map((r) => `<div class="bg-slate-900 rounded-xl p-2"><p><span class="text-yellow-400">${"★".repeat(Math.max(0, Math.min(5, Math.round(Number(r.stars) || 0))))}${"☆".repeat(5 - Math.max(0, Math.min(5, Math.round(Number(r.stars) || 0))))}</span> <span class="text-slate-400">von ${esc(r.reviewer)}</span></p>${r.comment ? `<p class="text-slate-200" data-i18n-skip>${esc(r.comment)}</p>` : ""}</div>`).join("")
          : `<p class="text-slate-500">Noch keine Bewertungen.</p>`}
      </div>
      ${userSocialHtml(u)}
      ${state.user && state.user.id !== id ? btn("⚠️ Nutzer melden", `PS.report('user', ${jsArg(id)})`, "w-full bg-slate-800 text-slate-300") : ""}`);
  } catch (e) { closeModalEl("ps-user"); handleError(e); }
}

async function report(targetType, targetId) {
  if (!requireLogin()) return;
  const reason = prompt("Was ist das Problem? (z. B. Fake, Betrugsversuch, beleidigend)");
  if (!reason || reason.trim().length < 3) return;
  try { await api("/api/reports", { method: "POST", body: { targetType, targetId, reason } }); toast("🛡️ Danke!", "Unser Team prüft die Meldung."); }
  catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Mitteilungen (Echtzeit-Abfrage)
// ---------------------------------------------------------------------------
async function pollNotifications(initial = false) {
  if (!state.user || document.hidden) return;
  try {
    const r = await api("/api/notifications");
    state.notifications = r.notifications; state.unread = r.unread;
    const fresh = r.notifications.filter((n) => n.id > state.lastNotifId && !n.read);
    if (!initial) fresh.slice(0, 3).reverse().forEach((n) => toast(n.title, n.body, String(n.link || "").startsWith("https://") ? n.link : ""));
    if (r.notifications[0]) { state.lastNotifId = Math.max(state.lastNotifId, r.notifications[0].id); localStorage.setItem("ps_last_notif", String(state.lastNotifId)); }
    if (fresh.some((n) => String(n.title || "").includes("Tausch") || String(n.title || "").includes("Nachricht"))) loadMe().then(renderHeader);
    renderHeader();
  } catch (e) { if (e.status === 401) { state.user = null; renderHeader(); } }
}

async function openNotifications() {
  if (!requireLogin()) return;
  closeModalEl("ps-account");
  await pollNotifications(true);
  const list = state.notifications;
  modal("ps-notifs", `
    <h3 class="text-base font-black text-white">🔔 Mitteilungen</h3>
    <div class="space-y-1.5 max-h-[60vh] overflow-y-auto text-xs">
      ${list.length ? list.map((n) => {
        const nl = String(n.link || "");
        const sub = /^\/\?tab=(\w+)&sub=(\w+)$/.exec(nl);
        const post = /^\/\?tab=community&post=(\d+)$/.exec(nl);
        const link = nl.startsWith("/?tab=trades") ? `PS.openTrades()` : nl.startsWith("/?tab=map") ? `PS.goMarket()`
          : nl.startsWith("/?orders=1") ? `PS.closeAll(); PS.openOrders()` : post ? `PS.closeAll(); PS.openPost(${Number(post[1])})`
          : nl.startsWith("/?tab=community") ? `PS.closeAll(); switchTab('community')`
          : sub ? `PS.closeAll(); PS.showSub('${sub[1]}', '${sub[2]}')` : "";
        const ext = safeUrl(nl).startsWith("https://") ? nl : "";
        return `<div class="bg-slate-900 border ${n.read ? "border-slate-800" : "border-yellow-400/60"} rounded-xl p-2.5">
          <p class="font-black text-white">${esc(n.title)}</p><p class="text-slate-300">${esc(n.body)}</p>
          <div class="flex justify-between items-center mt-1"><span class="text-[10px] text-slate-500">${new Date(n.createdAt).toLocaleString("de-DE")}</span>
          ${link ? `<button onclick="${link}" class="text-yellow-300 font-bold">Öffnen →</button>` : ext ? `<a href="${esc(ext)}" target="_blank" rel="noopener" class="text-yellow-300 font-bold">Ansehen ↗</a>` : ""}</div></div>`;
      }).join("") : `<p class="text-slate-500 text-center py-4">Noch keine Mitteilungen. Lege einen Preisalarm an oder starte einen Tausch!</p>`}
    </div>
    ${btn("🔔 Browser-Push & Töne einstellen", "closeModal('push-modal'); openModal('push-modal')", "w-full bg-slate-800 text-white")}`);
  if (state.unread) { api("/api/notifications/read", { method: "POST", body: {} }).then(() => { state.unread = 0; renderHeader(); }).catch(() => {}); }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
async function openAdmin() {
  closeModalEl("ps-account");
  modal("ps-admin", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Admin-Daten …</p>`, { wide: true });
  try {
    const { stats, reports } = await api("/api/admin/overview");
    const tile = (label, val, cls = "text-white") => `<div class="bg-slate-950 rounded-2xl p-3 border border-slate-800"><p class="text-[10px] uppercase font-bold text-slate-400">${label}</p><p class="text-lg font-black ${cls}">${val}</p></div>`;
    modal("ps-admin", `
      <h3 class="text-base font-black text-white">🛡️ Admin-Zentrale</h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        ${tile("Monatl. Abo-Umsatz (MRR)", eur(stats.mrr), "text-emerald-400")}
        ${tile("Einnahmen diesen Monat", eur(stats.revenue_month_cents / 100), "text-emerald-400")}
        ${tile("Nutzer", Number(stats.users) || 0)}
        ${tile("Premium / Pro", `${Number(stats.premium) || 0} / ${Number(stats.pro) || 0}`, "text-yellow-300")}
        ${tile("Aktive Inserate", Number(stats.active_listings) || 0)}
        ${tile("Abgeschlossene Tausche", Number(stats.completed_trades) || 0)}
      </div>
      <div class="flex flex-wrap gap-2">${btn("🧾 DAC7-Meldung & BZSt-Export", "PS.openDac7Admin()", "bg-slate-800 text-white")}${btn("🧩 Set-Vollständigkeit", "PS.openSetCompleteness()", "bg-slate-800 text-white")}${btn("⚙️ Jobs & Fehler", "PS.openOps()", "bg-slate-800 text-white")}${btn("🎬 Make.com & Auto-Reels", "PS.openMakeAdmin()", "bg-slate-800 text-white")}</div>
      <h4 class="text-sm font-black text-white">Offene Meldungen (${reports.length})</h4>
      <div class="space-y-1.5 max-h-80 overflow-y-auto text-xs">
        ${reports.length ? reports.map((r) => `<div class="bg-slate-900 rounded-xl p-2.5 border border-slate-800">
          <p><strong class="text-rose-300">${esc(r.target_type)} #${esc(r.target_id)}</strong> <span class="text-slate-400">von ${esc(r.reporter)} • ${new Date(r.created_at).toLocaleString("de-DE")}</span></p>
          <p class="text-slate-200">${esc(r.reason)}</p>
          <div class="flex flex-wrap gap-1.5 mt-1.5">
            ${r.target_type === "listing" || r.target_type === "event" ? btn(r.target_type === "event" ? "Event entfernen" : "Inserat entfernen", `PS.resolveReport(${Number(r.id)}, {removeListing:true})`, "bg-rose-500/30 text-rose-200") : ""}
            ${["post", "comment", "chat"].includes(r.target_type) ? btn("Inhalt entfernen", `PS.resolveReport(${Number(r.id)}, {removeListing:true})`, "bg-rose-500/30 text-rose-200") : ""}
            ${r.target_type !== "trade" ? btn("Nutzer sperren", `PS.resolveReport(${Number(r.id)}, {banUser:true, removeListing:true})`, "bg-rose-600 text-white") : ""}
            ${btn("Erledigt", `PS.resolveReport(${Number(r.id)}, {})`, "bg-emerald-500/30 text-emerald-200")}
            ${btn("Verwerfen", `PS.resolveReport(${Number(r.id)}, {dismiss:true})`, "bg-slate-800 text-slate-300")}
          </div></div>`).join("") : `<p class="text-slate-500">Keine offenen Meldungen 🎉</p>`}
      </div>
      ${await communityAdminHtml()}
      ${await adminExtrasHtml()}
      ${btn("📡 Preis-Tracker jetzt ausführen", "PS.runTracker()", "w-full bg-slate-800 text-white")}`, { wide: true });
  } catch (e) { closeModalEl("ps-admin"); handleError(e); }
}
async function resolveReport(id, opts) {
  if ((opts.banUser || opts.removeListing) && !confirm("Aktion wirklich ausführen?")) return;
  try { await api(`/api/admin/reports/${id}`, { method: "POST", body: opts }); openAdmin(); loadListings(); } catch (e) { handleError(e); }
}
async function runTrackerNow() {
  try { const r = await api("/api/admin/run-tracker", { method: "POST", body: {} }); toast("📡 Tracker", `${r.refreshed} Karten aktualisiert, ${r.alerts} Alarme ausgelöst.`); } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Header-Elemente
// ---------------------------------------------------------------------------
function injectHeader() {
  injectCartButton();
  const authText = $("authBtnText");
  const profileBtn = authText?.closest("button");
  if (profileBtn) profileBtn.onclick = () => openAccount();
  const proBtn = [...document.querySelectorAll("header button")].find((b) => (b.getAttribute("onclick") || "").includes("pro-modal"));
  if (proBtn) proBtn.onclick = () => openPro();
  if (profileBtn && !$("ps-bell")) {
    const mk = (id, icon, countId, title, fn) => {
      const b = document.createElement("button");
      b.id = id; b.title = title; b.setAttribute("aria-label", title);
      b.className = "relative bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs px-2.5 py-1.5 rounded-xl border border-slate-600";
      b.innerHTML = `${icon}<span id="${countId}" class="hidden absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center"></span>`;
      b.onclick = fn;
      profileBtn.before(b);
    };
    mk("ps-trades-btn", "🤝", "ps-trade-count", "Meine Tausche", () => openTrades());
    mk("ps-bell", "🔔", "ps-bell-count", "Mitteilungen", () => openNotifications());
  }
}

function switchTabSafe(tab) { try { window.switchTab(tab); } catch {} }
function goMarket() { ["ps-notifs", "ps-account"].forEach(closeModalEl); switchTabSafe("map"); }

function refreshAll() {
  loadPortfolio(); loadAlerts(); loadListings(); pollNotifications(true);
  syncFlip();
  syncCommunity();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
window.PS = {
  openAccount, renderLogin, doLogin, doSignup, forgot, saveProfile, logout: doLogout, oauth: (p) => oauthLogin(p),
  ...valuationApi,
  ...paymentsApi,
  ...nativeApi,
  saveNewPassword, saveInvite, openPro, checkout, cancelPlan, boost, openCard, createAlert, addCardToPortfolio,
  listCard, submitCardListing, deleteAlert, editItem, saveItem, removeItem, setListingStatus,
  openTrades, selectTrade, tradeAction, sendMsg, pickStars, sendReview, openUser, report,
  openNotifications, openAdmin, resolveReport, openGenerator, runTracker: runTrackerNow, goMarket,
  loadPortfolio, loadListings, listingCard, refreshMe: async () => { await loadMe(); renderHeader(); },
  closeAll: () => ["ps-notifs", "ps-account"].forEach(closeModalEl),
  searchCards,
  scanQuickSearch: () => searchCards(($("scan-quick-q")?.value || "").trim(), "scan-quick-results"),
  ...featureApi,
  ...arenaApi,
  ...sellApi,
  ...pfSellApi,
  ...dealsRadarApi,
  ...shellApi,
  ...flipApi,
  ...communityApi,
  ...profileApi,
  ...marketApi,
  ...cartApi,
  ...pwaApi,
  ...complianceApi,
  ...makeAdminApi,
  ...tradingApi,
  enablePush: wrapEnablePush(featureApi.enablePush),
  openPost: (id) => { history.replaceState(null, "", `/?tab=community&post=${Number(id)}`); routeCommunity(); },
};
hooks.openAccount = openAccount;
hooks.openPro = openPro;
window.activatePro = (plan) => checkout(plan === "VIP" || plan === "pro" ? "pro" : "premium");

async function boot() {
  initNativePlatform(); // Plattform-Erkennung, Safe Area, Status-Leiste, natives Teilen & Haptik (Web: nur Safe Area)
  injectHeader();
  injectTracker();
  injectPortfolioDash();
  overridePortfolio();
  overrideMarket();
  initFeatures();
  initLazyAdminTools();
  initShell();
  initArena();
  initFlip();
  initCommunity();
  initDealsRadar();
  initPwa();
  initPayments(); // nach initPwa: ersetzt in der iOS-App den Stripe-Checkout durch In-App-Kauf

  try {
    const result = await handleAuthCallback();
    if (result?.type === "invite" && result.token) state.invite = result.token;
    if (result?.type === "recovery") state.recovery = true;
    if (result && result.type !== "invite") history.replaceState(null, "", location.pathname + location.search);
  } catch (e) {
    toast("⚠️ Link ungültig", "Der Bestätigungs- oder Login-Link ist abgelaufen. Bitte erneut anfordern.");
  }
  getSettings().then((s) => { state.settings = s; }).catch(() => {});

  state.user = await getUser();
  await loadMe();
  if (state.user) { await migrateLocalPortfolio(); afterAuthFeatures(); afterLoginPwa(); }
  renderHeader();
  refreshAll();
  if (state.recovery || state.invite) openAccount();

  await confirmCheckoutFromUrl();
  const tab = new URLSearchParams(location.search).get("tab");
  if (tab === "trades") openTrades();
  else if (["swipe", "scan", "flip", "community", "map", "portfolio"].includes(tab)) switchTabSafe(tab);
  routeFeatures();
  routeCart();
  if (state.user) refreshCartBadge();
  routeShell();
  routePayments();
  routeCommunity();
  routeProfile();
  routeMarket();
  routeTrading();

  onAuthChange(async (event, user) => {
    if (event === "login" && user && !state.user) { state.user = user; await loadMe(); renderHeader(); refreshAll(); afterAuthFeatures(); }
    if (event === "logout") { state.user = null; state.me = null; renderHeader(); refreshAll(); }
  });

  setInterval(() => pollNotifications(), 30_000);
  setInterval(() => { if (!document.hidden && !$("view-map")?.classList.contains("hidden")) loadListings(); }, 30_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollNotifications(); });
}

boot();
