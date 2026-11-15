// Phase 4: Öffentliche Sammlungs-Profile in der App (Showcase, Tausch-Ordner, Wunschliste, Abzeichen, Follower)
// und die Einstellungen fürs eigene Profil unter pokeswipe-radar.de/u/<name>.
import { $, esc, jsArg, eur, toast, cdn, state, api, handleError, requireLogin, modal, closeModalEl, btn, FALLBACK_IMG } from "./core.js";

const cardGrid = (items, extra = () => "") => `<div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${items.map((x) => `
  <button onclick="${x.card_id ? `PS.openCard(${jsArg(x.card_id)})` : ""}" class="bg-slate-950 border border-slate-800 rounded-xl p-1.5 text-left text-[10px]">
    <img src="${esc(cdn(x.image || FALLBACK_IMG, 200))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" class="w-full aspect-[245/342] object-cover rounded-lg" alt="${esc(x.name || x.card_name || "Karte")}">
    <span class="block text-white font-bold truncate mt-1">${esc(x.name || x.card_name || "Karte")}</span>${extra(x)}</button>`).join("")}</div>`;

async function openProfile(slug) {
  modal("ps-profile", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Profil …</p>`, { wide: true });
  try {
    const { profile: p } = await api(`/api/u/${encodeURIComponent(slug)}`);
    const url = `${location.origin}/u/${encodeURIComponent(p.slug)}`;
    const stat = (v, l) => `<div class="bg-slate-950 rounded-xl p-2 text-center"><p class="text-sm font-black text-white">${v}</p><p class="text-[10px] text-slate-400">${l}</p></div>`;
    modal("ps-profile", `
      <div class="flex items-center gap-3">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-2xl font-black text-slate-950">${esc((p.name.replace("@", "")[0] || "S").toUpperCase())}</div>
        <div class="min-w-0">
          <h3 class="text-base font-black text-white truncate">${esc(p.name)} ${p.verified ? '<span class="text-cyan-300 text-xs">✔ Pro Trader</span>' : ""}</h3>
          <p class="text-[11px] text-slate-400">${esc(p.level.icon)} ${esc(p.level.label)} • seit ${new Date(p.memberSince).toLocaleDateString("de-DE", { month: "short", year: "numeric" })}${p.city ? ` • 📍 ${esc(p.city)}` : ""}${p.sellerVerified ? " • 🔒 Verifizierter Verkäufer" : ""}</p>
        </div>
      </div>
      ${p.bio ? `<p class="text-xs text-slate-200">${esc(p.bio)}</p>` : ""}
      ${p.isMe && !p.publicProfile ? `<p class="text-[11px] bg-amber-500/15 text-amber-200 rounded-xl px-3 py-2">🔒 Dein Profil ist privat – nur du siehst diese Vorschau. ${btn("Jetzt öffentlich machen", "PS.openProfileSettings()", "bg-yellow-400 text-slate-950 ml-1")}</p>` : ""}
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
        ${stat(p.stats.cards, "Karten")}${stat(p.stats.sets, "Sets")}${stat(`<span id="ps-pf-followers">${p.followers}</span>`, "Follower")}${stat(p.following, "Folgt")}
        ${stat(p.rating.count ? `⭐ ${p.rating.avg}` : "–", `${p.rating.count} Bewertungen`)}${stat(p.valueTier ? `${esc(p.valueTier.icon)} ${esc(p.valueTier.label)}` : p.deals, p.valueTier ? "Sammlungswert" : "Deals")}
      </div>
      ${p.badges.length ? `<div class="flex flex-wrap gap-1.5">${p.badges.map((b) => `<span title="${esc(b.description)}" class="bg-slate-800 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-slate-100">${esc(b.icon)} ${esc(b.label)}</span>`).join("")}</div>` : ""}
      <div class="flex flex-wrap gap-2">
        ${p.isMe ? btn("⚙️ Profil bearbeiten", "PS.openProfileSettings()", "bg-slate-800 text-white")
          : `<span id="ps-pf-follow">${followBtn(p.id, p.isFollowing)}</span>${state.user ? btn("🚫 Blockieren", `PS.blockUser(${jsArg(p.id)}, ${jsArg(p.name)})`, "bg-slate-800 text-slate-300") + btn("⚠️ Melden", `PS.report('user', ${jsArg(p.id)})`, "bg-slate-800 text-slate-300") : ""}`}
        ${p.publicProfile ? btn("📤 Profil teilen", `PS.shareProfile(${jsArg(url)}, ${jsArg(p.name)})`, "bg-emerald-500 text-slate-950") : ""}
      </div>
      ${p.showcase.length ? `<h4 class="text-sm font-black text-white">🏆 Showcase</h4>${cardGrid(p.showcase, (x) => (x.quantity > 1 ? `<span class="text-slate-400">${Number(x.quantity)}×</span>` : ""))}` : `<p class="text-xs text-slate-500">Noch keine Karten in der Sammlung.</p>`}
      ${p.binder.length ? `<h4 class="text-sm font-black text-white">📒 Tausch-Ordner</h4>${cardGrid(p.binder, (x) => `<span class="text-emerald-400 font-black">${eur(x.price)}</span>${x.buy_now ? ' <span class="text-cyan-300">🔒</span>' : ""}`)}
        ${p.isMe ? "" : btn("🤝 Zum Tausch-Hub", "PS.closeProfileGoMarket()", "w-full bg-slate-800 text-white")}` : ""}
      ${p.dupes.length ? `<h4 class="text-sm font-black text-white">♻️ Doppelte Karten (tauschbar)</h4>${cardGrid(p.dupes, (x) => `<span class="text-slate-400">${Number(x.spare)}× doppelt</span>`)}` : ""}
      ${p.wishlist.length ? `<h4 class="text-sm font-black text-white">❤️ Sucht</h4>${cardGrid(p.wishlist)}` : ""}
      ${p.posts.length ? `<h4 class="text-sm font-black text-white">📸 Letzte Pulls</h4><div class="grid grid-cols-3 gap-2">${p.posts.map((x) => `<a href="/?tab=community&post=${Number(x.id)}" class="block bg-slate-950 rounded-xl p-1.5 text-[10px] text-slate-300">${x.image ? `<img src="${esc(cdn(x.image, 240))}" class="w-full h-24 object-cover rounded-lg" loading="lazy">` : ""}<span class="block truncate mt-1">${esc(x.caption)}</span><span>❤️ ${Number(x.likes)}</span></a>`).join("")}</div>` : ""}`, { wide: true });
  } catch (e) {
    closeModalEl("ps-profile");
    if (e.status === 404) toast("🔒 Profil privat", "Dieses Sammler-Profil ist nicht öffentlich.");
    else handleError(e);
  }
}

const followBtn = (id, following) => btn(following ? "✓ Gefolgt" : "➕ Folgen", `PS.toggleFollow(${jsArg(id)}, ${following ? "true" : "false"})`, following ? "bg-slate-700 text-white" : "bg-yellow-400 text-slate-950");

async function toggleFollow(id, following) {
  if (!requireLogin()) return;
  try {
    const r = await api(`/api/follow/${encodeURIComponent(id)}`, { method: following ? "DELETE" : "POST", body: following ? undefined : {} });
    const slot = $("ps-pf-follow"); if (slot) slot.innerHTML = followBtn(id, r.following);
    const slot2 = $("ps-us-follow"); if (slot2) slot2.innerHTML = followBtn(id, r.following);
    const n = $("ps-pf-followers"); if (n) n.textContent = String(r.followers);
    toast(r.following ? "➕ Gefolgt" : "Nicht mehr gefolgt", r.following ? "Neue Pulls erscheinen unter „⭐ Gefolgt“ in der Community." : "");
  } catch (e) { handleError(e); }
}

function shareProfile(url, name) {
  const text = `Schau dir die Pokémon-Sammlung von ${name} an`;
  if (navigator.share) { navigator.share({ title: `${name} auf PokeSwipe`, text, url }).catch(() => {}); return; }
  const enc = encodeURIComponent;
  modal("ps-share-profile", `<h3 class="text-base font-black text-white">📤 Profil teilen</h3>
    <p class="text-xs text-slate-300">Der Link zeigt in WhatsApp & Co. automatisch eine Vorschau mit deinen Top-Karten.</p>
    <div class="grid grid-cols-2 gap-2">
      <a href="https://wa.me/?text=${esc(enc(`${text}: ${url}`))}" target="_blank" rel="noopener" class="bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs text-center">WhatsApp</a>
      <a href="https://t.me/share/url?url=${esc(enc(url))}&text=${esc(enc(text))}" target="_blank" rel="noopener" class="bg-sky-500 text-white font-black py-2.5 rounded-xl text-xs text-center">Telegram</a>
    </div>
    <div class="flex gap-2"><input readonly value="${esc(url)}" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
    ${btn("Kopieren", `navigator.clipboard.writeText(${jsArg(url)}).then(() => PS.toastOk('🔗 Link kopiert'))`, "bg-yellow-400 text-slate-950")}</div>`);
}

async function openProfileSettings() {
  if (!requireLogin()) return;
  try {
    const s = await api("/api/me/public-profile");
    const tgl = (id, on, label, sub) => `<label class="flex gap-2 items-start bg-slate-900 rounded-xl p-2.5 cursor-pointer"><input type="checkbox" id="${id}" ${on ? "checked" : ""} class="mt-0.5 accent-yellow-400"><span><strong class="text-white">${label}</strong><span class="block text-slate-400 text-[11px]">${sub}</span></span></label>`;
    modal("ps-profile-settings", `
      <h3 class="text-base font-black text-white">🌐 Öffentliches Sammler-Profil</h3>
      <p class="text-xs text-slate-300">Teile deine Sammlung unter <strong class="text-yellow-300 break-all">${esc(s.url)}</strong>. Angezeigt werden Sammlername, Stadt, Showcase (deine 12 wertvollsten Karten), Tausch-Ordner, Abzeichen und Pulls. <strong>Nie</strong> angezeigt werden E-Mail, Kaufpreise oder genaue Werte.</p>
      <div class="space-y-2 text-xs">
        ${tgl("ps-pp-public", s.publicProfile, "Profil öffentlich", "Auffindbar über den Link und bei Google. Jederzeit wieder privat schaltbar.")}
        ${tgl("ps-pp-wish", s.showWishlist, "Wunschliste zeigen", "Andere sehen, was du suchst, und können dir passende Karten anbieten.")}
        ${tgl("ps-pp-value", s.showValueTier, "Sammlungswert als Stufe zeigen", "Nur grob (z. B. „1.000 €+“), nie der genaue Betrag.")}
        <label class="block text-slate-300 font-bold">Über mich (max. 200 Zeichen, keine Links)</label>
        <textarea id="ps-pp-bio" maxlength="200" rows="2" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" placeholder="z. B. Sammle Glurak & alles aus 151 – tausche fair!">${esc(s.bio || "")}</textarea>
        ${btn("Speichern", "PS.saveProfileSettings()", "w-full bg-emerald-500 text-slate-950")}
        ${btn("👀 Vorschau ansehen", `PS.openProfile(${jsArg(s.slug)})`, "w-full bg-slate-800 text-white")}
      </div>`);
  } catch (e) { handleError(e); }
}

async function saveProfileSettings() {
  try {
    await api("/api/me/public-profile", { method: "PUT", body: { publicProfile: $("ps-pp-public").checked, showWishlist: $("ps-pp-wish").checked, showValueTier: $("ps-pp-value").checked, bio: $("ps-pp-bio").value } });
    closeModalEl("ps-profile-settings");
    toast("✅ Gespeichert", $("ps-pp-public")?.checked ? "Dein Profil ist öffentlich – teile den Link!" : "Dein Profil ist privat.");
    window.PS?.refreshMe?.();
  } catch (e) { handleError(e); }
}

async function openFollowing() {
  if (!requireLogin()) return;
  try {
    const r = await api("/api/me/follows");
    modal("ps-following", `<h3 class="text-base font-black text-white">⭐ Du folgst ${r.following.length} Sammlern • ${r.followers} Follower</h3>
      <div class="space-y-1.5 text-xs max-h-80 overflow-y-auto">${r.following.length ? r.following.map((f) => `<div class="flex justify-between items-center bg-slate-900 rounded-xl px-3 py-2">
        <button onclick="PS.openAuthor(${jsArg(f.id)}, ${jsArg(f.slug)}, ${f.public_profile ? "true" : "false"})" class="text-white font-bold">${esc(f.name)}</button>
        <button onclick="PS.toggleFollow(${jsArg(f.id)}, true).then(() => PS.openFollowing())" class="text-slate-400 font-bold">Entfolgen</button></div>`).join("") : `<p class="text-slate-500">Du folgst noch niemandem. Tippe in der Community auf einen Namen!</p>`}</div>`);
  } catch (e) { handleError(e); }
}

/** Zusatz für das bestehende Nutzer-Popup (Bewertungen): Folgen, öffentliches Profil, Blockieren. */
export function userSocialHtml(u) {
  if (!u?.id) return "";
  const me = state.user?.id === u.id;
  return `<div class="flex flex-wrap gap-2">
    ${!me ? `<span id="ps-us-follow">${followBtn(u.id, false)}</span>` : ""}
    ${u.publicProfile ? btn("🌐 Sammlung ansehen", `PS.openProfile(${jsArg(u.slug)})`, "bg-slate-800 text-white") : ""}
    ${!me && state.user ? btn("🚫 Blockieren", `PS.blockUser(${jsArg(u.id)}, ${jsArg(u.displayName)})`, "bg-slate-800 text-slate-300") : ""}
  </div>${u.sellerVerified ? `<p class="text-[11px] text-cyan-300">🔒 Verifizierter Verkäufer – Käufe mit Käuferschutz möglich</p>` : ""}`;
}

export const profileApi = {
  openProfile, toggleFollow, shareProfile, openProfileSettings, saveProfileSettings, openFollowing,
  closeProfileGoMarket: () => { closeModalEl("ps-profile"); window.PS?.goMarket?.(); },
};

export function routeProfile() {
  const slug = new URLSearchParams(location.search).get("profile");
  if (slug && /^[\p{L}\p{N}_.\-]{2,24}$/u.test(slug)) openProfile(slug);
}
