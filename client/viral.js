// PokeSwipe & Radar – virales Wachstum im Browser: verfolgte Teilen-Links mit Share-Sheet (WhatsApp, Telegram, X …),
// Einladungs-Dashboard mit Stufen-Belohnungen, Teilen-Bonus und Werber-Bestenliste.
import { $, esc, jsArg, toast, state, api, handleError, requireLogin, modal, btn } from "./core.js";
import { localePath } from "./i18n.js";
import { withRef, inviteProgressHtml } from "./referral.js";

const PS = () => window.PS;
const VIA_KEY = "ps_via";

/** Merkt sich, über welchen Teilen-Link jemand kam (wird beim Einlösen der Empfehlung mitgeschickt). */
export function captureVia() {
  const via = new URLSearchParams(location.search).get("via");
  if (via && /^[a-z0-9]{5,10}$/.test(via)) localStorage.setItem(VIA_KEY, via);
}
export const takeVia = () => { const v = localStorage.getItem(VIA_KEY) || ""; localStorage.removeItem(VIA_KEY); return v; };

/** Kurzlink /s/<code> für einen eigenen Pfad – ohne Login der normale Link. */
async function trackedUrl(target, kind, title) {
  if (state.user) {
    try { return (await api("/api/share", { method: "POST", body: { target, kind, title } })).url; } catch {}
  }
  return withRef(`${location.origin}${target}`);
}

/** Share-Sheet: nativ teilen, WhatsApp, Telegram, X, Facebook, Link kopieren. */
export async function shareTarget(target, kind = "card", title = "PokeSwipe & Radar", text = "") {
  target = localePath(target); // englische Oberfläche → /en/karte/… usw.
  const url = await trackedUrl(target, kind, title);
  const msg = text || `${title} 👉`;
  const enc = encodeURIComponent;
  const links = [
    ["WhatsApp", `https://wa.me/?text=${enc(`${msg} ${url}`)}`, "bg-emerald-500 text-slate-950"],
    ["Telegram", `https://t.me/share/url?url=${enc(url)}&text=${enc(msg)}`, "bg-sky-500 text-slate-950"],
    ["X", `https://twitter.com/intent/tweet?text=${enc(msg)}&url=${enc(url)}`, "bg-slate-200 text-slate-950"],
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, "bg-blue-600 text-white"],
  ];
  modal("ps-sharesheet", `<h3 class="text-base font-black text-white">📣 Teilen</h3>
    <p class="text-xs text-slate-300">${esc(title)}</p>
    ${state.user ? `<p class="text-[11px] text-emerald-300 font-bold">🎁 Dein Einladungscode steckt im Link: Jeder neue Besucher = +1 KI-Scan heute, jeder neue Freund = Pro-Tage für euch beide (30 Tage beim 1., danach je 14 Tage).</p>`
      : `<p class="text-[11px] text-amber-300">Tipp: Angemeldet steckt dein Einladungscode im Link – für jeden neuen Freund bekommt ihr beide Pro-Tage.</p>`}
    <div class="flex gap-2"><input readonly value="${esc(url)}" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-[11px]" onclick="this.select()" />
      ${btn("Kopieren", `PS.copyText(${jsArg(url)})`, "bg-slate-700 text-white")}</div>
    <div class="grid grid-cols-2 gap-2">${links.map(([l, href, cls]) => `<a href="${esc(href)}" target="_blank" rel="noopener" class="text-center ${cls} font-black py-2.5 rounded-xl text-xs">${l}</a>`).join("")}</div>
    ${navigator.share ? btn("📱 Mehr Apps (Instagram, Discord …)", `PS.nativeShare(${jsArg(url)}, ${jsArg(title)}, ${jsArg(msg)})`, "w-full bg-yellow-400 text-slate-950") : ""}`);
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast("🔗 Kopiert", t); } catch { toast("Kopieren nicht möglich", t); }
}
async function nativeShare(url, title, text) {
  try { await navigator.share({ url, title, text }); } catch {}
}

// ---------------------------------------------------------------------------
// Einladungs-Dashboard
// ---------------------------------------------------------------------------
const bar = (v, max) => `<div class="h-2 bg-slate-800 rounded-full overflow-hidden"><div class="h-full bg-gradient-to-r from-emerald-400 to-yellow-300" style="width:${Math.min(100, Math.round((v / Math.max(1, max)) * 100))}%"></div></div>`;
const REWARD_LABEL = {
  paid_referral: "Gratismonat (zahlender Freund)", milestone_3: "Stufe 3", milestone_5: "Stufe 5", milestone_10: "Stufe 10", milestone_25: "Stufe 25",
  friend_referral: "Freund eingeladen", invited_bonus: "Einladungs-Geschenk", ms_starter: "🌱 Starter-Werber", ms_community: "🏗️ Community-Builder",
  ms_vip: "💎 VIP-Sammler", promo: "🎬 Promo-Code", share_trial: "📲 App geteilt",
};

function dashboardHtml(d) {
  const nextMax = d.next ? d.next.count : Math.max(1, d.confirmed);
  return `
    <div class="grid grid-cols-4 gap-2 text-center text-xs">
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-lg font-black text-white">${Number(d.share.visitors)}</p><p class="text-slate-400">Besucher</p></div>
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-lg font-black text-white">${Number(d.invited)}</p><p class="text-slate-400">Angemeldet</p></div>
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-lg font-black text-emerald-300">${Number(d.confirmed)}</p><p class="text-slate-400">Bestätigt</p></div>
      <div class="bg-slate-900 rounded-xl p-2"><p class="text-lg font-black text-amber-300">${Number(d.pending)}</p><p class="text-slate-400">Ausstehend</p></div>
    </div>
    <p class="text-xs text-slate-200">👑 Dein Pro-Status: <b class="text-yellow-300">${d.proExpiresAt ? `aktiv bis ${new Date(d.proExpiresAt).toLocaleDateString("de-DE")}` : state.me?.plan !== "free" ? "aktiv (Abo)" : "nicht aktiv"}</b></p>
    ${d.next ? `<div class="space-y-1"><p class="text-xs text-slate-200"><b>${esc(d.next.icon)} Nächstes Badge:</b> noch ${Number(d.next.missing)} Freund${d.next.missing === 1 ? "" : "e"} → <b class="text-yellow-300">${esc(d.next.label)}</b> <span class="text-slate-400">(${esc(d.next.reward)})</span></p>${bar(d.confirmed, nextMax)}</div>`
      : `<p class="text-xs font-black text-yellow-300">💎 Alle Badges erreicht – du bist VIP-Sammler! Jeder weitere Freund bringt euch beiden +${Number(d.tiers?.nextDays) || 14} Tage.</p>`}
    <div class="grid grid-cols-3 gap-1.5 text-[11px]">${d.milestones.map((m) => `<div class="rounded-xl p-2 border ${m.reached ? "border-emerald-400 bg-emerald-500/10" : "border-slate-800 bg-slate-900"}">
      <p class="font-black ${m.reached ? "text-emerald-300" : "text-white"}">${esc(m.icon)} ${Number(m.count)} Freund${m.count === 1 ? "" : "e"} ${m.reached ? "✓" : ""}</p><p class="text-slate-300">${esc(m.label)}</p><p class="text-slate-500">${esc(m.reward)}</p></div>`).join("")}</div>
    ${d.friends?.length ? `<details class="text-[11px]" open><summary class="font-bold text-slate-200 cursor-pointer">👥 Deine eingeladenen Freunde (${d.friends.length})</summary><div class="space-y-1 mt-1">${d.friends.map((f) => `<div class="flex justify-between gap-2 bg-slate-900 rounded-lg px-2 py-1"><span class="truncate text-slate-200">${esc(f.name)}</span>${f.status === "confirmed"
      ? `<span class="text-emerald-300 whitespace-nowrap">✅ Bestätigt${f.days ? ` · +${Number(f.days)} Tage` : ""}</span>`
      : `<span class="text-amber-300 whitespace-nowrap">⏳ Ausstehend (wartet auf erste Aktion)</span>`}</div>`).join("")}</div></details>` : ""}
    <p class="text-[11px] text-cyan-300">⚡ Teilen-Bonus heute: <b>+${Number(d.shareBonus.today)}/${Number(d.shareBonus.max)} KI-Scans</b> (1 pro neuem Besucher über deine Links)</p>
    ${d.share.top?.length ? `<details class="text-[11px]"><summary class="font-bold text-slate-200 cursor-pointer">🔗 Deine erfolgreichsten Links</summary><div class="space-y-1 mt-1">${d.share.top.map((l) => `<div class="flex justify-between gap-2 bg-slate-900 rounded-lg px-2 py-1"><span class="truncate text-slate-300">${esc(l.title || l.target)}</span><span class="text-slate-400 whitespace-nowrap">👀 ${Number(l.uniqueVisitors)} • ✍️ ${Number(l.signups)}</span></div>`).join("")}</div></details>` : ""}
    ${d.rewards?.length ? `<details class="text-[11px]"><summary class="font-bold text-slate-200 cursor-pointer">🎁 Deine Belohnungen (${d.rewards.length})</summary><div class="space-y-1 mt-1">${d.rewards.map((r) => `<div class="flex justify-between bg-slate-900 rounded-lg px-2 py-1"><span class="text-slate-300">${esc(REWARD_LABEL[r.kind] || r.kind)}</span><span class="text-emerald-300">${r.creditCents ? `${(r.creditCents / 100).toFixed(2).replace(".", ",")} € Gutschrift` : Number(r.days) ? `+${Number(r.days)} Tage ${r.plan === "pro" ? "Pro" : "Premium"}` : "Badge"}</span></div>`).join("")}</div></details>` : ""}
    <div class="text-[11px] space-y-1"><p class="font-black text-white">🏆 Top-Werber diesen Monat</p>
      ${d.leaderboard.length ? d.leaderboard.map((b) => `<div class="flex justify-between rounded-lg px-2 py-1 ${b.me ? "bg-yellow-400/20 text-yellow-200" : "bg-slate-900 text-slate-300"}"><span>#${b.rank} ${esc(b.name)}</span><span>${Number(b.paid)} zahlend • ${Number(b.joined)} neu</span></div>`).join("") : `<p class="text-slate-500">Noch niemand diesen Monat – sei die oder der Erste!</p>`}
      ${d.leaderboardOptIn ? "" : `<p class="text-slate-500">Du erscheinst nur mit Zustimmung in der Bestenliste. ${btn("In Bestenliste zeigen", "PS.inviteOptIn()", "bg-slate-800 text-white !py-1 !px-2")}</p>`}
    </div>`;
}

export async function loadInviteDashboard() {
  const box = $("ps-invite-dash");
  if (!box || !state.user) return;
  try { box.innerHTML = dashboardHtml(await api("/api/referral/dashboard")); } catch { box.innerHTML = ""; }
}

/** Ersetzt den bisherigen Empfehlungs-Kasten im Konto. */
export function inviteBoxHtml() {
  const r = state.me?.referral;
  if (!r?.code) return "";
  setTimeout(loadInviteDashboard, 0);
  return `<div class="bg-slate-950 rounded-2xl p-3.5 border border-emerald-500/40 text-xs space-y-2.5" id="ps-invite">
    <p class="font-black text-emerald-300 text-sm">🎁 Freunde einladen – Pro-Tage für euch beide</p>
    <p class="text-slate-300">1. Freund: <b>ihr beide +${Number(r.firstDays) || 30} Tage Pro</b> · jeder weitere Freund: <b>ihr beide +${Number(r.nextDays) || 14} Tage</b> (stapelbar). Zahlt ein Freund später ein Abo, gibt's für dich zusätzlich einen Gratismonat.</p>
    ${inviteProgressHtml({ dashboardButton: false })}
    <p class="text-slate-400">Dein Code: <b class="text-yellow-300">${esc(r.code)}</b></p>
    <div id="ps-invite-dash" class="space-y-2.5"><p class="text-slate-500">Lade Statistik …</p></div>
  </div>`;
}

function shareInvite() {
  if (!state.user) return requireLogin();
  const r = state.me?.referral;
  shareTarget(`/einladung/${r.code}`, "invite", `PokeSwipe & Radar – ${Number(r.firstDays) || 30} Tage Pro geschenkt`,
    `🎁 Ich schenke dir ${Number(r.firstDays) || 30} Tage PokeSwipe Pro: Live-Preise für alle deutschen Pokémon-Karten, Restock-Alarm für Displays zum UVP & KI-Kartenscan. Mein Code: ${r.code}`);
}

function openInvite() {
  if (!state.user) return requireLogin();
  modal("ps-invite-modal", `<h3 class="text-base font-black text-white">🎁 Einladen &amp; belohnt werden</h3>${inviteBoxHtml()}`);
}

async function inviteOptIn() {
  try { await api("/api/me/preferences", { method: "POST", body: { leaderboardOptIn: true } }); toast("🏆 Du bist dabei", "Dein Sammlername erscheint jetzt in den Bestenlisten."); loadInviteDashboard(); }
  catch (e) { handleError(e); }
}

/** Kleiner „Einladen“-Knopf im Kopfbereich. */
export function injectInviteButton() {
  const bell = $("ps-bell");
  if (!bell || $("ps-invite-btn")) return;
  const b = document.createElement("button");
  b.id = "ps-invite-btn"; b.title = "Freunde einladen – Pro-Tage für euch beide"; b.setAttribute("aria-label", b.title);
  b.className = "relative bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs px-2.5 py-1.5 rounded-xl";
  b.textContent = "🎁";
  b.onclick = () => (state.user ? openInvite() : PS().openAccount?.("Kostenlos anmelden – dann Freunde einladen und Pro-Tage für euch beide sichern."));
  bell.before(b);
}

export const viralApi = { shareTarget, shareInvite, openInvite, inviteOptIn, copyText, nativeShare };
