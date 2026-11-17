// PokeSwipe & Radar – gestaffeltes Freunde-Empfehlungssystem (?ref=CODE), „App teilen & 14 Tage Pro testen“,
// Video-Promo-Links (?promo=CODE) mit Bonus-Banner und der Promo-Link-Generator in der Admin-Zentrale.
import { $, esc, jsArg, toast, state, api, handleError, requireLogin, modal, btn } from "./core.js";
import { share as nativeShareSheet } from "./native.js";

const PS = () => window.PS;
const PROMO_KEY = "ps_promo";
const REF_KEY = "ps_ref";
const PROMO_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
const OWN_HOSTS = ["pokeswipe-radar.de", "www.pokeswipe-radar.de", "pokeswipe-radar.netlify.app"];

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("de-DE") : "");
function readCookie(k) {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${k}=`));
  try { return hit ? decodeURIComponent(hit.slice(k.length + 1)) : ""; } catch { return ""; }
}
const clearCookie = (k) => { document.cookie = `${k}=; Path=/; Max-Age=0; SameSite=Lax; Secure`; };

// ---------------------------------------------------------------------------
// Persönlichen ?ref=CODE an geteilte Links hängen
// ---------------------------------------------------------------------------
/** Hängt den Einladungscode des eingeloggten Nutzers an eigene Links (Karten, Deals, Pulls, Profile …). */
export function withRef(url) {
  const code = state.me?.referral?.code;
  if (!code || !url) return url;
  try {
    const u = new URL(url, location.origin);
    const own = u.origin === location.origin || OWN_HOSTS.includes(u.hostname);
    if (!own || u.searchParams.has("ref") || /^\/s\//.test(u.pathname)) return url; // /s/-Kurzlinks tragen den Code schon
    u.searchParams.set("ref", code);
    return u.toString();
  } catch { return url; }
}

// ---------------------------------------------------------------------------
// Einladungs- & Promo-Codes aus Links merken (URL oder Cookie von öffentlichen Seiten)
// ---------------------------------------------------------------------------
export function captureGrowthParams() {
  const q = new URLSearchParams(location.search);
  const promo = (q.get("promo") || readCookie("ps_promo") || "").toUpperCase();
  if (PROMO_RE.test(promo)) localStorage.setItem(PROMO_KEY, promo);
  clearCookie("ps_promo");
  const ref = readCookie("ps_ref").toUpperCase();
  if (!localStorage.getItem(REF_KEY) && /^[A-Z0-9]{6,10}$/.test(ref)) localStorage.setItem(REF_KEY, ref);
  clearCookie("ps_ref");
}

// ---------------------------------------------------------------------------
// Video-Promo: schlankes Bonus-Banner + einmalige Gutschrift nach Anmeldung
// ---------------------------------------------------------------------------
let promoInfo = null;
export async function showPromoBanner() {
  const code = localStorage.getItem(PROMO_KEY);
  $("ps-promo-banner")?.remove();
  if (!code) return;
  try { promoInfo = await api(`/api/promo/${encodeURIComponent(code)}`); } catch { promoInfo = null; }
  if (!promoInfo?.valid) { localStorage.removeItem(PROMO_KEY); return; }
  const main = document.querySelector("main");
  if (!main) return;
  const el = document.createElement("div");
  el.id = "ps-promo-banner";
  el.className = "mb-3 flex items-center gap-2 rounded-2xl border border-fuchsia-400/60 bg-gradient-to-r from-fuchsia-600/30 to-yellow-400/20 px-3 py-2 text-xs";
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="text-lg" aria-hidden="true">🎬</span>
    <span class="flex-1 min-w-0 text-white"><b>Video-Bonus ${esc(code)}:</b> ${Number(promoInfo.days)} Tage PokeSwipe Pro gratis${state.user ? " – wird gutgeschrieben …" : " – nach kostenloser Anmeldung"}</span>
    ${state.user ? "" : btn("Jetzt sichern", "PS.renderLogin('', 'signup')", "bg-yellow-400 text-slate-950 !py-1.5 !px-2.5 shrink-0")}
    <button type="button" onclick="PS.dismissPromo()" class="text-slate-300 hover:text-white px-1 shrink-0" aria-label="Banner schließen">✕</button>`;
  main.prepend(el);
}

function dismissPromo() { $("ps-promo-banner")?.remove(); }

export async function redeemPromo() {
  const code = localStorage.getItem(PROMO_KEY);
  if (!code || !state.user) return;
  try {
    const r = await api("/api/promo/redeem", { method: "POST", body: { code } });
    if (r.ok && !r.already) toast(`🎬 ${Number(r.days)} Tage PokeSwipe Pro aktiviert`, r.proExpiresAt ? `Pro ist aktiv bis ${fmtDate(r.proExpiresAt)}.` : "Viel Spaß mit allen Pro-Funktionen!");
    await PS().refreshMe?.();
  } catch (e) {
    toast("Promo-Code nicht eingelöst", e?.message || "");
  }
  localStorage.removeItem(PROMO_KEY);
  dismissPromo();
}

// ---------------------------------------------------------------------------
// Fortschritts-Karte im Profil
// ---------------------------------------------------------------------------
export function proStatusText(m = state.me) {
  if (!m) return "";
  if (m.proSource === "subscription" && m.plan !== "free") return `${m.planInfo?.label || "Pro"} per Abo${m.planUntil ? ` · bis ${fmtDate(m.planUntil)}` : ""}`;
  if (m.proExpiresAt) return `aktiv bis ${fmtDate(m.proExpiresAt)}`;
  if (m.bonusUntil && new Date(m.bonusUntil) > new Date()) return `${m.bonusPlan === "pro" ? "Pro" : "Premium"} aktiv bis ${fmtDate(m.bonusUntil)}`;
  return "nicht aktiv (Free)";
}

export function inviteProgressHtml({ dashboardButton = true } = {}) {
  const m = state.me, r = m?.referral;
  if (!state.user) {
    return `<p class="text-slate-300">Melde dich kostenlos an, um deinen persönlichen Einladungslink zu bekommen: <b>+30 Tage Pro</b> für dich und deinen ersten Freund, danach <b>+14 Tage</b> für jeden weiteren.</p>
      ${btn("Kostenlos anmelden", "PS.renderLogin('', 'signup')", "w-full bg-emerald-500 text-slate-950")}`;
  }
  if (!r?.code) return `<p class="text-slate-500">Einladungslink wird erstellt …</p>`;
  const confirmed = Number(r.confirmed) || 0, pending = Number(r.pending) || 0;
  const next = r.next;
  const pct = next ? Math.min(100, Math.round((confirmed / next.count) * 100)) : 100;
  const waText = `🎁 Ich schenke dir ${Number(r.firstDays) || 30} Tage PokeSwipe Pro: Live-Preise, KI-Kartenscan & Restock-Radar für Pokémon-Karten. ${r.link}`;
  return `
    <div class="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2" id="ps-invite-progress">
      <p class="text-[13px] font-black text-white leading-snug">Deine Einladungen: <span class="text-emerald-300">${confirmed} Freund${confirmed === 1 ? "" : "e"}</span>
        <span class="text-slate-500">•</span> Dein Pro-Status: <span class="text-yellow-300">${esc(proStatusText(m))}</span>
        <span class="text-slate-500">•</span> ${next ? `Noch <span class="text-emerald-300">${Number(next.missing)} Freund${next.missing === 1 ? "" : "e"}</span> bis zum Badge „${esc(next.icon)} ${esc(next.label)}“` : "👑 Alle Bonus-Badges erreicht"}</p>
      <div class="h-2 bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="h-full bg-gradient-to-r from-emerald-400 to-yellow-300" style="width:${pct}%"></div></div>
      ${pending ? `<p class="text-[11px] text-amber-300">⏳ ${pending} Einladung${pending === 1 ? "" : "en"} ausstehend (wartet auf erste Aktion)</p>` : ""}
      ${r.badges?.length ? `<p class="flex flex-wrap gap-1">${r.badges.map((b) => `<span class="text-[10px] font-black bg-yellow-400/20 text-yellow-200 border border-yellow-400/40 rounded-full px-2 py-0.5">${esc(b.icon)} ${esc(b.label)}</span>`).join("")}</p>` : ""}
      <div class="flex gap-2"><input readonly value="${esc(r.link)}" aria-label="Dein Einladungslink" class="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-[11px]" onclick="this.select()" />
        ${btn("Kopieren", `PS.copyText(${jsArg(r.link)})`, "bg-slate-700 text-white shrink-0")}</div>
      <div class="grid grid-cols-2 gap-2">
        <a href="${esc(`https://wa.me/?text=${encodeURIComponent(waText)}`)}" target="_blank" rel="noopener" class="text-center bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs">💬 Über WhatsApp einladen</a>
        ${btn("📤 Teilen", "PS.shareInvite()", "bg-yellow-400 text-slate-950")}
      </div>
      ${m.shareTrialAvailable ? btn(`📲 App teilen &amp; ${Number(m.shareTrialDays) || 14} Tage Pro testen`, "PS.shareAppTrial()", "w-full bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white") : ""}
      <p class="text-[10px] text-slate-400">1. Freund: ihr beide +${Number(r.firstDays) || 30} Tage Pro · ab dem 2. Freund: ihr beide +${Number(r.nextDays) || 14} Tage · 3 Freunde: Community-Builder +14 Tage · 10 Freunde: VIP-Sammler +30 Tage. Gutschrift, sobald dein Freund seine E-Mail bestätigt oder die erste Karte scannt, sammelt oder auf die Wunschliste setzt.</p>
      ${dashboardButton ? btn("📊 Alle Einladungen & Belohnungen", "PS.openInvite()", "w-full bg-slate-800 text-white") : ""}
    </div>`;
}

// ---------------------------------------------------------------------------
// „App teilen & 14 Tage Pro testen“
// ---------------------------------------------------------------------------
async function shareAppTrial() {
  if (!state.user) return requireLogin();
  const r = state.me?.referral;
  let url = r?.link || location.origin;
  try { url = (await api("/api/share", { method: "POST", body: { target: "/", kind: "invite", title: "PokeSwipe & Radar – App" } })).url || url; } catch {}
  const res = await nativeShareSheet({
    title: "PokeSwipe & Radar",
    text: `📲 Die Pokémon-Karten-App mit Live-Preisen, KI-Scanner & Restock-Radar – mit meinem Link bekommst du Pro-Tage geschenkt:`,
    url,
  });
  if (res === "cancelled" || res === "unsupported") { toast("Teilen abgebrochen", "Teile den Link, um deine 14 Gratis-Tage freizuschalten."); return; }
  if (res === "copied") toast("🔗 Link kopiert", "Füge ihn in WhatsApp, Instagram oder TikTok ein.");
  try {
    const t = await api("/api/growth/share-trial", { method: "POST", body: {} });
    toast(`🎉 ${Number(t.days)} Tage PokeSwipe Pro aktiviert`, t.proExpiresAt ? `Pro ist aktiv bis ${fmtDate(t.proExpiresAt)}.` : "");
    await PS().refreshMe?.();
    PS().renderProfileHub?.();
  } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Admin-Zentrale: Promo-Link-Generator
// ---------------------------------------------------------------------------
export async function promoAdminHtml() {
  let codes = [];
  try { codes = (await api("/api/admin/promo-codes")).codes || []; } catch { return ""; }
  const inp = (id, attrs) => `<input id="${id}" ${attrs} class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs min-w-0" />`;
  return `<div class="bg-slate-950 rounded-2xl p-3 border border-fuchsia-500/40 space-y-2" id="ps-promo-admin">
    <h4 class="text-sm font-black text-white">🎬 Promo-Link-Generator (TikTok, Reels, Shorts, Creator)</h4>
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
      ${inp("ps-pc-code", `placeholder="CODE z. B. DARIO30" maxlength="24" autocapitalize="characters" aria-label="Code"`)}
      ${inp("ps-pc-label", `placeholder="Name (intern)" maxlength="80" aria-label="Bezeichnung"`)}
      <select id="ps-pc-days" aria-label="Gratis-Tage" class="bg-slate-900 border border-slate-700 rounded-lg px-2 text-white text-xs">${[7, 14, 30, 60, 90].map((d) => `<option value="${d}" ${d === 30 ? "selected" : ""}>${d} Tage Pro</option>`).join("")}</select>
      ${inp("ps-pc-max", `type="number" min="0" placeholder="Max. Einlösungen (leer = ∞)" aria-label="Maximale Einlösungen"`)}
      ${btn("+ Code erstellen", "PS.adminPromoCreate()", "bg-fuchsia-600 text-white")}
    </div>
    <div class="space-y-1.5 max-h-80 overflow-y-auto text-xs">${codes.length ? codes.map((p) => `<div class="bg-slate-900 rounded-xl p-2 border ${p.active ? "border-emerald-500/40" : "border-slate-800 opacity-70"} space-y-1">
      <div class="flex flex-wrap items-center gap-2">
        <b class="text-yellow-300">${esc(p.code)}</b><span class="text-slate-400">${esc(p.label || "")}</span>
        <span class="ml-auto text-slate-300">${Number(p.days)} Tage · ${Number(p.redemptions)}${p.maxRedemptions ? `/${Number(p.maxRedemptions)}` : ""} eingelöst</span>
        ${btn(p.active ? "✅ aktiv" : "⏸ inaktiv", `PS.adminPromoToggle(${Number(p.id)}, ${p.active ? "false" : "true"})`, p.active ? "bg-emerald-500/30 text-emerald-200 !py-1 !px-2" : "bg-slate-800 text-slate-300 !py-1 !px-2")}
      </div>
      <div class="flex gap-1.5"><input readonly value="${esc(p.link)}" aria-label="Promo-Link" class="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white text-[11px]" onclick="this.select()" />
        ${btn("Kopieren", `PS.copyText(${jsArg(p.link)})`, "bg-slate-700 text-white !py-1 !px-2")}</div></div>`).join("") : `<p class="text-slate-500">Noch keine Promo-Codes.</p>`}</div>
    <p class="text-[10px] text-slate-500">Jeder Code ist pro Konto einmal einlösbar und schreibt die Tage nach der Anmeldung auf den Pro-Status gut. Inaktive Codes zeigen kein Banner mehr.</p>
  </div>`;
}

async function refreshPromoAdmin() {
  const box = $("ps-promo-admin");
  if (box) box.outerHTML = await promoAdminHtml();
}

async function adminPromoCreate() {
  const code = String($("ps-pc-code")?.value || "").trim().toUpperCase();
  const max = String($("ps-pc-max")?.value || "").trim();
  try {
    await api("/api/admin/promo-codes", { method: "POST", body: { code, label: $("ps-pc-label")?.value || "", days: Number($("ps-pc-days")?.value || 30), maxRedemptions: max ? Number(max) : null, active: true } });
    toast("✅ Promo-Code erstellt", `${location.origin}/?promo=${code}`);
    await refreshPromoAdmin();
  } catch (e) { handleError(e); }
}

async function adminPromoToggle(id, active) {
  try { await api(`/api/admin/promo-codes/${Number(id)}`, { method: "PATCH", body: { active: Boolean(active) } }); await refreshPromoAdmin(); }
  catch (e) { handleError(e); }
}

export const referralApi = { shareAppTrial, dismissPromo, adminPromoCreate, adminPromoToggle };
