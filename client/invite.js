// PokeSwipe Radar – „Teilen & Freunde einladen“ mit Gründer-Sammler-Belohnung.
// Auffälliger Bereich auf der Startseite und im Profilmenü, dezenter Hinweis nach dem Scannen/Speichern von Karten.
//   • persönlicher Einladungslink (pokeswipe-radar.de/?ref=CODE) – Anmeldungen darüber werden im Profil gespeichert
//   • Fortschritt: 5 eigene Karten hochladen ODER 1 Sammler-Kumpel einladen → Gründer-Sammler-Badge, Gratis-Boosts, mehr Preis-Alarme
//   • 1-Tap-Teilen (navigator.share bzw. natives Teilen in der App) für WhatsApp, TikTok & Instagram + „Link kopieren“ mit Bestätigung
import { $, esc, state, toast, api } from "./core.js";
import { share as nativeShare } from "./native.js";
import {
  founderStatus, inviteShareText, INVITE_CALL, FOUNDER_PERKS, FOUNDER_LABEL, FOUNDER_ICON, FOUNDER_UPLOAD_GOAL,
} from "../server/founder-logic.ts";

const NUDGE_KEY = "ps_invite_nudge_day";
const SEEN_KEY = "ps_founder_seen";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/** Gast-Binder (localStorage) – zählt für die Fortschrittsanzeige, bis er beim Login ins Konto umzieht. */
function guestUploads() {
  try { const v = JSON.parse(lsGet("pokeswipe_portfolio_clean") || "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
}

/** Aktueller Status (Server-Wert, sonst lokal berechnet). */
export function currentFounder() {
  const f = state.me?.founder;
  if (state.user && f) return f;
  return founderStatus({ uploads: guestUploads(), signups: 0 });
}

export const inviteLink = () => state.me?.referral?.link || "";

function shareText() {
  const link = inviteLink() || location.origin;
  return inviteShareText(link, state.me?.displayName || "");
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
function progressHtml(f) {
  const upPct = Math.min(100, Math.round((Number(f.uploads) / FOUNDER_UPLOAD_GOAL) * 100));
  return `<div class="ps-founder-goals grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center">
    <div class="ps-goal" data-goal="uploads">
      <p class="flex justify-between text-[11px] font-black"><span>📸 Karten hochladen</span><span data-founder-uploads>${Math.min(Number(f.uploads) || 0, FOUNDER_UPLOAD_GOAL)} / ${FOUNDER_UPLOAD_GOAL}</span></p>
      <div class="ps-goal-bar" role="progressbar" aria-label="Hochgeladene Karten" aria-valuemin="0" aria-valuemax="${FOUNDER_UPLOAD_GOAL}" aria-valuenow="${Math.min(Number(f.uploads) || 0, FOUNDER_UPLOAD_GOAL)}"><span style="width:${f.unlocked ? 100 : upPct}%"></span></div>
    </div>
    <span class="ps-goal-or" aria-hidden="true">ODER</span>
    <div class="ps-goal" data-goal="signup">
      <p class="flex justify-between text-[11px] font-black"><span>🤝 Sammler einladen</span><span data-founder-signups>${Math.min(Number(f.signups) || 0, 1)} / 1</span></p>
      <div class="ps-goal-bar" role="progressbar" aria-label="Eingeladene Sammler" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${Math.min(Number(f.signups) || 0, 1)}"><span style="width:${f.unlocked || Number(f.signups) >= 1 ? 100 : 0}%"></span></div>
    </div>
  </div>`;
}

function shareButtonsHtml() {
  const link = inviteLink();
  const wa = `https://wa.me/?text=${encodeURIComponent(shareText())}`;
  return `<div class="space-y-2">
    <div class="ps-invite-link flex items-center gap-2">
      <input readonly value="${esc(link)}" aria-label="Dein persönlicher Einladungslink" data-invite-link class="flex-1 min-w-0 bg-slate-950/80 border border-slate-700 rounded-xl px-3 py-2 text-white text-[11px]" onclick="this.select()" />
      <button type="button" onclick="PS.copyInviteLink(this)" data-copy-invite class="ps-invite-copy shrink-0">🔗 Link kopieren</button>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <button type="button" onclick="PS.shareInviteNative()" data-share-native class="ps-share-btn ps-share-main col-span-2 sm:col-span-1">📤 Jetzt teilen</button>
      <a href="${esc(wa)}" target="_blank" rel="noopener" onclick="PS.trackInviteShare('whatsapp')" class="ps-share-btn ps-share-wa">💬 WhatsApp</a>
      <button type="button" onclick="PS.shareInviteNative('tiktok')" class="ps-share-btn ps-share-tt">🎵 TikTok</button>
      <button type="button" onclick="PS.shareInviteNative('instagram')" class="ps-share-btn ps-share-ig">📸 Instagram</button>
    </div>
  </div>`;
}

function perksHtml(unlocked) {
  return `<ul class="grid grid-cols-1 sm:grid-cols-3 gap-1.5">${FOUNDER_PERKS.map((p) => `<li class="ps-perk ${unlocked ? "ps-perk-on" : ""}">
    <span class="text-base" aria-hidden="true">${unlocked ? "✅" : p.icon}</span><span class="min-w-0"><b class="block text-white text-[11px] leading-tight">${esc(p.title)}</b><span class="block text-[10px] text-slate-400 leading-tight">${esc(p.text)}</span></span></li>`).join("")}</ul>`;
}

/** Empfehlungs- & Teilen-Bereich. variant: "home" (Startseite) | "profile" (Profilmenü). */
export function founderInviteHtml({ variant = "home" } = {}) {
  const f = currentFounder();
  const unlocked = Boolean(f.unlocked);
  const head = unlocked
    ? `<p class="ps-kicker text-yellow-300">${FOUNDER_ICON} ${esc(FOUNDER_LABEL)} · freigeschaltet</p>
       <h3 class="ps-invite-title">Danke, dass du den Marktplatz mit aufbaust! 🎉</h3>
       <p class="text-xs text-slate-200">Deine Gratis-Boosts, erweiterten Preis-Alarme und dein verifiziertes Badge sind aktiv. Lade weiter Freunde ein – jeder neue Sammler bringt euch beiden Pro-Tage.</p>`
    : `<p class="ps-kicker text-yellow-300">🚀 Freunde einladen &amp; Vorteile freischalten</p>
       <h3 class="ps-invite-title">${esc(INVITE_CALL)}</h3>`;
  const body = state.user
    ? `${progressHtml(f)}
       <p class="text-[11px] font-bold ${unlocked ? "text-emerald-300" : "text-amber-200"}" data-founder-headline>${esc(f.headline || "")}</p>
       ${perksHtml(unlocked)}
       ${inviteLink() ? shareButtonsHtml() : `<p class="text-[11px] text-slate-400">Dein Einladungslink wird erstellt …</p>`}`
    : `${progressHtml(f)}
       ${perksHtml(false)}
       <div class="flex flex-wrap gap-2">
         <button type="button" onclick="PS.renderLogin('', 'signup')" class="ps-share-btn ps-share-main flex-1">✨ Kostenlos anmelden &amp; Einladungslink holen</button>
         <button type="button" onclick="PS.openScanner()" class="ps-share-btn bg-slate-800 text-white">📷 Karte scannen</button>
       </div>
       <p class="text-[10px] text-slate-400">Deine als Gast gescannten Karten zählen mit und ziehen beim Login ins Konto um.</p>`;
  return `<section class="ps-card ps-invite ${unlocked ? "ps-invite-unlocked" : ""} p-4 space-y-3" data-invite-variant="${esc(variant)}" aria-label="Freunde einladen">
    <div class="ps-invite-radar" aria-hidden="true"></div>
    <div class="relative space-y-1">${head}</div>
    <div class="relative space-y-3">${body}</div>
  </section>`;
}

export function renderHomeInvite() {
  const box = $("home-invite");
  if (box) box.innerHTML = founderInviteHtml({ variant: "home" });
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------
async function copyInviteLink(btnEl) {
  const link = inviteLink();
  if (!link) { toast("Einladungslink", "Bitte kurz anmelden – dann bekommst du deinen persönlichen Link."); return; }
  let ok = false;
  try { await navigator.clipboard.writeText(link); ok = true; } catch {
    try {
      const i = document.querySelector("[data-invite-link]");
      i?.select(); ok = document.execCommand?.("copy") ?? false;
    } catch {}
  }
  const targets = btnEl ? [btnEl] : [...document.querySelectorAll("[data-copy-invite]")];
  for (const b of targets) {
    b.textContent = ok ? "✓ Kopiert!" : "Bitte markieren & kopieren";
    b.classList.add("ps-copied");
    setTimeout(() => { b.textContent = "🔗 Link kopieren"; b.classList.remove("ps-copied"); }, 2200);
  }
  if (ok) toast("🔗 Einladungslink kopiert", "Füge ihn in WhatsApp, deine TikTok-Bio oder Instagram-Story ein.");
  trackInviteShare("copy");
}

const PLATFORM_HINT = {
  tiktok: "Link kopiert – füge ihn in deine TikTok-Bio, ein Video oder eine Nachricht ein.",
  instagram: "Link kopiert – füge ihn in deine Instagram-Story (Link-Sticker) oder eine DM ein.",
};

/** 1-Tap-Teilen: natives Teilen-Menü (WhatsApp, TikTok, Instagram …), sonst Text + Link kopieren. */
async function shareInviteNative(platform = "") {
  if (!state.user) { window.PS?.renderLogin?.("", "signup"); return; }
  const link = inviteLink();
  if (!link) return;
  const res = await nativeShare({ title: "PokeSwipe Radar", text: inviteShareText("", state.me?.displayName || "").replace(/\s*👉\s*$/, " 👉"), url: link });
  if (res === "copied") toast("🔗 Einladung kopiert", PLATFORM_HINT[platform] || "Füge sie in WhatsApp, TikTok oder Instagram ein.");
  else if (res === "unsupported") copyInviteLink();
  if (res !== "cancelled") trackInviteShare(platform || "native");
}

/** Teilen zählen (bestehende Teilen-Statistik); Fehler sind egal. */
function trackInviteShare(channel) {
  if (!state.user) return;
  api("/api/share", { method: "POST", body: { target: "/", kind: "invite", title: `Einladung (${String(channel).slice(0, 16)})` } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Dezenter Hinweis nach dem Scannen / Speichern von Karten
// ---------------------------------------------------------------------------
let lastCount = null;
function binderCount() {
  if (state.user && state.portfolio?.items) return state.portfolio.items.length;
  return guestUploads();
}

export function showInviteNudge(reason = "upload") {
  const today = new Date().toISOString().slice(0, 10);
  if (lsGet(NUDGE_KEY) === today) return false;
  lsSet(NUDGE_KEY, today);
  $("ps-invite-nudge")?.remove();
  const f = currentFounder();
  const el = document.createElement("div");
  el.id = "ps-invite-nudge";
  el.className = "ps-invite-nudge";
  el.setAttribute("role", "status");
  const msg = f.unlocked
    ? "Stark! Hol deine Sammler-Kumpels dazu – jeder neue Sammler bringt euch beiden Pro-Tage. 🎁"
    : `Schon ${Math.min(Number(f.uploads) || 0, FOUNDER_UPLOAD_GOAL)} von ${FOUNDER_UPLOAD_GOAL} Karten! Noch ${Math.max(0, FOUNDER_UPLOAD_GOAL - (Number(f.uploads) || 0))} – oder lade 1 Freund ein – für Gratis-Boosts.`;
  el.innerHTML = `<span aria-hidden="true">🚀</span><span class="flex-1 min-w-0">${esc(msg)}</span>
    <button type="button" onclick="PS.openInviteShare()" class="ps-nudge-cta">${state.user ? "Freunde einladen" : "Mehr erfahren"}</button>
    <button type="button" onclick="this.parentElement.remove()" class="px-1 text-slate-400" aria-label="Hinweis schließen">✕</button>`;
  el.dataset.reason = reason;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 12_000);
  return true;
}

async function refreshFounder() {
  if (!state.user || !state.me) return;
  try {
    const f = await api("/api/founder");
    const was = Boolean(state.me.founder?.unlocked);
    state.me.founder = f;
    if (!was && f?.unlocked) celebrate();
  } catch {}
}

async function onPortfolioChanged() {
  const n = binderCount();
  const grew = lastCount !== null && n > lastCount;
  lastCount = n;
  if (grew) await refreshFounder();
  renderHomeInvite();
  if (grew) showInviteNudge("upload");
}

function celebrate() {
  const f = state.me?.founder;
  if (!state.user || !f?.unlocked) return;
  const key = `${SEEN_KEY}_${state.user.id}`;
  if (lsGet(key)) return;
  lsSet(key, "1");
  toast(`${FOUNDER_ICON} ${FOUNDER_LABEL} freigeschaltet!`, "Gratis-Boosts, erweiterte Preis-Alarme und dein verifiziertes Badge sind jetzt aktiv.");
}

function openInviteShare() {
  $("ps-invite-nudge")?.remove();
  window.switchTab?.("home");
  setTimeout(() => $("home-invite")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
}

export function initInvite() {
  renderHomeInvite();
  window.addEventListener("ps:portfolio", onPortfolioChanged);
  window.addEventListener("ps:plan", () => { renderHomeInvite(); celebrate(); if (lastCount === null) lastCount = binderCount(); });
  window.addEventListener("ps:tab", (e) => { if (e.detail === "home") renderHomeInvite(); });
  // Gast-Binder (Legacy-Speicher) ändert sich ohne Ereignis → beim Zurückkehren zur Seite prüfen
  window.addEventListener("storage", (e) => { if (e.key === "pokeswipe_portfolio_clean") onPortfolioChanged(); });
  document.addEventListener("click", (e) => {
    // Gast speichert im Scanner/Binder: Zähler kurz danach vergleichen
    if (state.user) return;
    if (!(e.target instanceof Element) || !e.target.closest("[data-binder-add], #view-scan, #view-portfolio, #ps-live-scan")) return;
    setTimeout(() => { const n = guestUploads(); if (lastCount !== null && n > lastCount) { showInviteNudge("guest-upload"); renderHomeInvite(); } lastCount = n; }, 800);
  });
}

export const inviteApi = { copyInviteLink, shareInviteNative, trackInviteShare, openInviteShare, showInviteNudge, renderHomeInvite };
