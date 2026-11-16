// Phase 4: Authentifizierte Community – Pull-Wall als Social Feed, Live-Chat, Melden/Blockieren, Admin-Moderation.
// Ersetzt die früheren anonymen Firebase-Funktionen der Seite (publishWallPost, sendChatMessage, …) durch die
// eigene API mit Login-Pflicht (Netlify Identity), serverseitigen Limits, Wort-/Link-Filter und Moderation.
import { $, esc, jsArg, toast, cdn, state, api, handleError, requireLogin, modal, closeModalEl, btn, FALLBACK_IMG } from "./core.js";

const cm = {
  posts: [], scope: localStorage.getItem("ps_feed_scope") === "following" ? "following" : "all", nextBefore: null, loading: false,
  chat: [], lastChatId: 0, chatTimer: null, feedTimer: null, me: null, pendingImg: "", focusPost: null, newestSeen: 0,
};

const ago = (d) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(d).toLocaleDateString("de-DE");
};
const levelChip = (a) => a?.level ? `<span title="Vertrauensstufe: ${esc(a.level.label)} (${Number(a.trust) || 0}/100)" class="text-[10px] text-slate-400">${esc(a.level.icon)}</span>` : "";
const authorBtn = (a) => `<button onclick="PS.openAuthor(${jsArg(a.id)}, ${jsArg(a.slug)}, ${a.publicProfile ? "true" : "false"})" class="font-black text-yellow-400 hover:text-yellow-300">${esc(a.name)}</button>${a.verified ? ' <span class="text-cyan-300 text-[10px]" title="Pro Trader">✔</span>' : ""} ${levelChip(a)}`;
const visibleCommunity = () => !$("view-community")?.classList.contains("hidden") && !document.hidden;

// ---------------------------------------------------------------------------
// Status-Leiste: Login, E-Mail-Bestätigung, Vertrauensstufe, Feed-Umschalter
// ---------------------------------------------------------------------------
function mountUi() {
  const feed = $("pullwall-feed");
  if (feed && !$("ps-cm-bar")) {
    const bar = document.createElement("div");
    bar.id = "ps-cm-bar";
    bar.className = "space-y-2";
    feed.before(bar);
    const more = document.createElement("div");
    more.id = "ps-cm-more";
    feed.after(more);
  }
  const chat = $("chat-messages");
  if (chat && !$("ps-chat-note")) {
    const note = document.createElement("p");
    note.id = "ps-chat-note";
    note.className = "text-[10px] text-slate-500";
    chat.parentElement.appendChild(note);
  }
  renderBar();
}

function renderBar() {
  const bar = $("ps-cm-bar");
  if (!bar) return;
  let notice = "";
  if (!state.user) notice = `<div class="bg-yellow-400/10 border border-yellow-400/40 rounded-2xl p-3 text-xs text-yellow-100 flex flex-wrap items-center justify-between gap-2"><span>🔐 Lesen kann jeder – <strong>posten, liken, kommentieren und chatten</strong> nur mit kostenlosem Konto. So bleibt die Community frei von Spam und Fake-Accounts.</span>${btn("Anmelden", "PS.openAccount()", "bg-yellow-400 text-slate-950")}</div>`;
  else if (cm.me && !cm.me.confirmed) notice = `<div class="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-3 text-xs text-amber-100">📧 Bitte bestätige deine E-Mail-Adresse (Link im Postfach) – danach kannst du in der Community schreiben.</div>`;
  else if (cm.me?.mutedUntil && new Date(cm.me.mutedUntil) > new Date()) notice = `<div class="bg-rose-500/10 border border-rose-500/40 rounded-2xl p-3 text-xs text-rose-200">🔇 Du bist bis ${new Date(cm.me.mutedUntil).toLocaleString("de-DE")} stummgeschaltet.</div>`;
  const lvl = cm.me ? `<span class="text-[11px] text-slate-400" title="Steigt mit bestätigter E-Mail, Kontoalter, abgeschlossenen Tauschen und guten Bewertungen">${esc(cm.me.level.icon)} Deine Stufe: <strong class="text-white">${esc(cm.me.level.label)}</strong> (${Number(cm.me.trust) || 0}/100)${cm.me.links ? "" : " • Links ab Stufe „Bekannt“"}</span>` : "";
  const tab = (k, label) => `<button onclick="PS.feedScope('${k}')" class="flex-1 py-1.5 rounded-lg ${cm.scope === k ? "bg-yellow-400 text-slate-950" : "text-slate-300"}">${label}</button>`;
  bar.innerHTML = `${notice}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex bg-slate-900 border border-slate-700 rounded-xl p-1 gap-1 text-xs font-black w-full sm:w-auto">${tab("all", "🌍 Alle Pulls")}${tab("following", "⭐ Gefolgt")}</div>
      ${lvl}
    </div>`;
  const note = $("ps-chat-note");
  if (note) note.textContent = state.user ? "Name = dein Sammlername. Bitte freundlich bleiben – Beleidigungen, Kurzlinks und Bezahlung außerhalb des Käuferschutzes werden automatisch blockiert." : "Zum Mitschreiben bitte anmelden.";
  const chatInput = $("chat-input");
  if (chatInput) chatInput.placeholder = state.user ? "Nachricht schreiben …" : "Zum Schreiben bitte anmelden";
}

async function loadMe() {
  if (!state.user) { cm.me = null; renderBar(); return; }
  try { cm.me = await api("/api/community/me"); } catch { cm.me = null; }
  renderBar();
}

// ---------------------------------------------------------------------------
// Pull-Wall / Social Feed
// ---------------------------------------------------------------------------
async function loadFeed({ more = false, quiet = false } = {}) {
  if (cm.loading) return;
  cm.loading = true;
  try {
    const q = new URLSearchParams({ scope: cm.scope });
    if (more && cm.nextBefore) q.set("before", String(cm.nextBefore));
    const r = await api(`/api/community/feed?${q}`);
    if (more) cm.posts = cm.posts.concat(r.posts.filter((p) => !cm.posts.some((x) => x.id === p.id)));
    else {
      const newest = r.posts[0];
      if (quiet && newest && cm.newestSeen && newest.id > cm.newestSeen && !newest.mine) {
        const cfg = (() => { try { return JSON.parse(localStorage.getItem("pokeswipe_push_cfg") || "{}"); } catch { return {}; } })();
        if (cfg.wall !== false) toast("📸 Neuer Pull-Wall Hit!", `${newest.author.name}: ${String(newest.caption || "").slice(0, 100)}`);
      }
      cm.posts = r.posts;
      if (newest) cm.newestSeen = Math.max(cm.newestSeen, newest.id);
    }
    cm.nextBefore = r.nextBefore;
    renderFeed();
  } catch (e) {
    if (!quiet) { const box = $("pullwall-feed"); if (box) box.innerHTML = `<div class="poke-glass rounded-2xl p-6 text-center text-xs text-rose-300">Pull-Wall gerade nicht erreichbar. Bitte später erneut versuchen.</div>`; }
  } finally { cm.loading = false; }
}

function postHtml(p) {
  const img = p.image ? cdn(p.image, 720) : "";
  const canModerate = p.mine || state.me?.isAdmin;
  return `<article id="ps-post-${p.id}" class="poke-glass rounded-2xl p-4 space-y-3 ${cm.focusPost === p.id ? "ring-2 ring-yellow-400" : ""}">
    <div class="flex justify-between items-center text-xs gap-2">
      <div class="min-w-0 truncate">${authorBtn(p.author)}</div>
      <span class="text-slate-500 shrink-0">${ago(p.createdAt)}</span>
    </div>
    ${p.pending ? `<p class="text-[11px] bg-amber-500/15 text-amber-200 rounded-lg px-2 py-1">⏳ Wird geprüft – nur für dich sichtbar.</p>` : ""}
    ${p.caption ? `<p class="text-xs sm:text-sm text-white whitespace-pre-line break-words" data-i18n-skip>${esc(p.caption)}</p>` : ""}
    ${img ? `<div class="bg-slate-950 rounded-xl p-2 flex justify-center"><img src="${esc(img)}" onerror="this.src='${FALLBACK_IMG}'" alt="Pull von ${esc(p.author.name)}" loading="lazy" class="max-h-80 rounded-lg object-contain" /></div>` : ""}
    <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800 text-xs">
      <button onclick="PS.likePost(${p.id})" class="${p.liked ? "bg-rose-500 text-white" : "bg-rose-500/20 text-rose-300"} hover:bg-rose-500/40 font-bold px-3 py-1 rounded-lg" aria-pressed="${p.liked}">❤️ ${p.likes}</button>
      <span class="text-slate-400 px-1">💬 ${p.commentCount}</span>
      <button onclick="PS.sharePost(${p.id})" class="bg-slate-800 text-slate-200 font-bold px-2.5 py-1 rounded-lg ml-auto">📤 Teilen</button>
      ${!p.mine && state.user ? `<button onclick="PS.report('post', '${p.id}')" class="bg-slate-800 text-slate-400 font-bold px-2 py-1 rounded-lg" title="Melden">⚠️</button>
        <button onclick="PS.blockUser(${jsArg(p.author.id)}, ${jsArg(p.author.name)})" class="bg-slate-800 text-slate-400 font-bold px-2 py-1 rounded-lg" title="Blockieren">🚫</button>` : ""}
      ${canModerate ? `<button onclick="PS.deletePost(${p.id})" class="bg-slate-800 text-rose-300 font-bold px-2 py-1 rounded-lg" title="Löschen">🗑️</button>` : ""}
    </div>
    ${p.comments.length ? `<div class="space-y-1 bg-slate-950 p-2.5 rounded-xl text-xs max-h-60 overflow-y-auto">${p.comments.map((c) => `
      <div class="flex gap-1.5 items-start group"><div class="flex-1 min-w-0 break-words">${authorBtn(c.author)}<span class="text-slate-200 ml-1" data-i18n-skip>${esc(c.body)}</span>${c.pending ? ' <span class="text-amber-300 text-[10px]">⏳ wird geprüft</span>' : ""}</div>
      ${c.mine || p.mine || state.me?.isAdmin ? `<button onclick="PS.deleteComment(${c.id})" class="text-slate-600 hover:text-rose-400" title="Löschen">✕</button>` : state.user ? `<button onclick="PS.report('comment', '${c.id}')" class="text-slate-600 hover:text-amber-300" title="Melden">⚠</button>` : ""}</div>`).join("")}</div>` : ""}
    ${state.user ? `<div class="flex gap-2">
      <input id="wall-cmt-${p.id}" type="text" maxlength="300" placeholder="Kommentar schreiben …" onkeydown="if(event.key==='Enter')PS.commentPost(${p.id})" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white" />
      <button onclick="PS.commentPost(${p.id})" class="bg-slate-800 hover:bg-slate-700 text-yellow-400 font-bold text-xs px-3 py-1.5 rounded-xl">Senden</button></div>` : ""}
  </article>`;
}

function renderFeed() {
  const box = $("pullwall-feed");
  if (!box) return;
  if (!cm.posts.length) {
    box.innerHTML = `<div class="poke-glass rounded-2xl p-6 text-center text-xs text-slate-400">${cm.scope === "following" ? "Noch keine Pulls von Sammlern, denen du folgst. Tippe bei einem Beitrag auf den Namen und folge ihm!" : "Noch keine Pulls gepostet – teile jetzt deinen ersten Hit!"}</div>`;
  } else box.innerHTML = cm.posts.map(postHtml).join("");
  const more = $("ps-cm-more");
  if (more) more.innerHTML = cm.nextBefore ? `<button onclick="PS.feedMore()" class="w-full mt-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs py-2.5 rounded-xl">Ältere Pulls laden</button>` : "";
  if (cm.focusPost) {
    const el = $(`ps-post-${cm.focusPost}`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => { cm.focusPost = null; }, 4000); }
  }
}

function compress(file, max = 1080, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Bitte ein Bild wählen."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const scale = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let data = canvas.toDataURL("image/jpeg", quality);
      // Server-Grenze ~600 KB: notfalls stärker komprimieren
      if (data.length > 780_000) data = canvas.toDataURL("image/jpeg", 0.6);
      if (data.length > 780_000) return compress(file, 800, 0.6).then(resolve, reject);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild konnte nicht gelesen werden.")); };
    img.src = url;
  });
}

async function previewImage(e) {
  try {
    cm.pendingImg = await compress(e.target.files[0]);
    const prev = $("wall-preview");
    if (prev) { prev.src = cm.pendingImg; prev.classList.remove("hidden"); }
  } catch (err) { toast("⚠️ Foto", err.message); }
}

async function publishPost() {
  if (!requireLogin()) return;
  const caption = ($("wall-caption")?.value || "").trim().slice(0, 300);
  const num = ($("wall-cardnum")?.value || "").trim();
  let image = cm.pendingImg;
  if (!image && num && window.resolveCard) {
    const r = window.resolveCard(num);
    if (r?.img && /^https:\/\//.test(r.img)) image = r.img;
  }
  if (!caption && !image) return toast("📸 Pull-Wall", "Bitte Foto, Kartennummer oder Beschreibung eingeben.");
  const btnEl = document.querySelector("[onclick='publishWallPost()']");
  if (btnEl) btnEl.disabled = true;
  try {
    const r = await api("/api/community/posts", { method: "POST", body: { caption, image } });
    cm.pendingImg = "";
    ["wall-caption", "wall-cardnum", "wall-file"].forEach((id) => { if ($(id)) $(id).value = ""; });
    $("wall-preview")?.classList.add("hidden");
    toast(r.pending ? "⏳ Wird geprüft" : "🚀 Gepostet!", r.notice || "Dein Pull ist jetzt in der Community.");
    if (cm.scope !== "all") cm.scope = "all";
    await loadFeed();
    if (!r.pending) setTimeout(() => sharePost(r.id, true), 400);
  } catch (e) { handleError(e); }
  finally { if (btnEl) btnEl.disabled = false; }
}

async function likePost(id) {
  if (!requireLogin()) return;
  const p = cm.posts.find((x) => x.id === id);
  try {
    const r = await api(`/api/community/posts/${id}/like`, { method: "POST", body: {} });
    if (p) { p.liked = r.liked; p.likes = r.likes; renderFeed(); }
  } catch (e) { handleError(e); }
}

async function commentPost(id) {
  if (!requireLogin()) return;
  const inp = $(`wall-cmt-${id}`);
  const text = (inp?.value || "").trim();
  if (!text) return;
  try {
    const r = await api(`/api/community/posts/${id}/comments`, { method: "POST", body: { body: text } });
    if (inp) inp.value = "";
    if (r.notice) toast("⏳ Wird geprüft", r.notice);
    await loadFeed({ quiet: true });
  } catch (e) { handleError(e); }
}

async function deletePost(id) {
  if (!confirm("Beitrag wirklich löschen?")) return;
  try { await api(`/api/community/posts/${id}`, { method: "DELETE" }); cm.posts = cm.posts.filter((p) => p.id !== id); renderFeed(); } catch (e) { handleError(e); }
}
async function deleteComment(id) {
  if (!confirm("Kommentar löschen?")) return;
  try { await api(`/api/community/comments/${id}`, { method: "DELETE" }); await loadFeed({ quiet: true }); } catch (e) { handleError(e); }
}

/** Teilen: natives Teilen-Menü (Handy) oder Auswahl mit WhatsApp, Telegram, X, Facebook und Link kopieren. */
function sharePost(id, afterPublish = false) {
  const p = cm.posts.find((x) => x.id === id);
  const url = `${location.origin}/p/${id}`;
  const text = p ? `${p.caption || "Mein Pull"} – auf PokeSwipe & Radar` : "Schau dir diesen Pull an!";
  if (!afterPublish && navigator.share) { navigator.share({ title: "PokeSwipe Pull-Wall", text, url }).catch(() => {}); return; }
  const enc = encodeURIComponent;
  const link = (href, label, cls) => `<a href="${esc(href)}" target="_blank" rel="noopener" class="${cls} font-black py-2.5 rounded-xl text-xs text-center">${label}</a>`;
  modal("ps-share-post", `
    <h3 class="text-base font-black text-white">${afterPublish ? "🎉 Gepostet! Jetzt teilen" : "📤 Pull teilen"}</h3>
    <p class="text-xs text-slate-300">Der Link zeigt in WhatsApp, Telegram & Co. automatisch dein Pull-Foto als Vorschau.</p>
    <div class="grid grid-cols-2 gap-2">
      ${link(`https://wa.me/?text=${enc(`${text} ${url}`)}`, "WhatsApp", "bg-emerald-500 text-slate-950")}
      ${link(`https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`, "Telegram", "bg-sky-500 text-white")}
      ${link(`https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(text)}`, "X / Twitter", "bg-slate-200 text-slate-900")}
      ${link(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, "Facebook", "bg-blue-600 text-white")}
    </div>
    ${navigator.share ? btn("📱 Weitere Apps (Instagram, TikTok …)", `navigator.share({ url: ${jsArg(url)}, text: ${jsArg(text)} }).catch(() => {})`, "w-full bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white") : ""}
    <div class="flex gap-2"><input readonly value="${esc(url)}" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
    ${btn("Kopieren", `navigator.clipboard.writeText(${jsArg(url)}).then(() => PS.toastOk('🔗 Link kopiert'))`, "bg-yellow-400 text-slate-950")}</div>`);
}

async function blockUser(id, name) {
  if (!requireLogin()) return;
  if (!confirm(`${name} blockieren? Ihr seht euch gegenseitig nicht mehr in Pull-Wall, Kommentaren und Chat, und Tausch- oder Kaufanfragen sind nicht mehr möglich.`)) return;
  try {
    await api("/api/community/blocks", { method: "POST", body: { userId: id } });
    toast("🚫 Blockiert", `${name} wird dir nicht mehr angezeigt. Aufheben kannst du das im Konto unter „Blockierte Nutzer“.`);
    closeModalEl("ps-user"); closeModalEl("ps-profile");
    loadFeed({ quiet: true }); cm.lastChatId = 0; cm.chat = []; pollChat();
  } catch (e) { handleError(e); }
}

async function openBlocks() {
  if (!requireLogin()) return;
  try {
    const { blocks } = await api("/api/community/blocks");
    modal("ps-blocks", `<h3 class="text-base font-black text-white">🚫 Blockierte Nutzer</h3>
      <div class="space-y-1.5 text-xs max-h-80 overflow-y-auto">${blocks.length ? blocks.map((b) => `<div class="flex justify-between items-center bg-slate-900 rounded-xl px-3 py-2"><span class="text-white font-bold">${esc(b.name)}</span>
        <button onclick="PS.unblockUser(${jsArg(b.id)})" class="text-emerald-300 font-bold">Aufheben</button></div>`).join("") : `<p class="text-slate-500">Du hast niemanden blockiert.</p>`}</div>`);
  } catch (e) { handleError(e); }
}
async function unblockUser(id) {
  try { await api(`/api/community/blocks/${encodeURIComponent(id)}`, { method: "DELETE" }); openBlocks(); loadFeed({ quiet: true }); } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Live-Chat (Abfrage alle 4 Sekunden, solange der Bereich sichtbar ist)
// ---------------------------------------------------------------------------
async function pollChat() {
  try {
    const r = await api(`/api/community/chat${cm.lastChatId ? `?after=${cm.lastChatId}` : ""}`);
    if (r.removed?.length) cm.chat = cm.chat.filter((m) => !r.removed.includes(m.id));
    if (r.messages.length) {
      cm.chat = cm.chat.concat(r.messages.filter((m) => !cm.chat.some((x) => x.id === m.id))).slice(-80);
      cm.lastChatId = Math.max(cm.lastChatId, ...r.messages.map((m) => m.id));
    }
    if (r.messages.length || r.removed?.length || !cm.chatRendered) renderChat();
  } catch {}
}

function renderChat() {
  const box = $("chat-messages");
  if (!box) return;
  cm.chatRendered = true;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  if (!cm.chat.length) { box.innerHTML = `<p class="text-slate-500 text-center py-6">Noch keine Chat-Nachrichten. Schreibe die erste!</p>`; return; }
  box.innerHTML = cm.chat.map((m) => `
    <div class="bg-slate-900 border ${m.mine ? "border-yellow-400/30" : "border-slate-800"} rounded-xl px-3 py-2 flex gap-2 items-start">
      <div class="flex-1 min-w-0 break-words">${authorBtn(m.author)}<span class="text-slate-200 ml-1" data-i18n-skip>${esc(m.body)}</span>
        ${m.pending ? '<span class="text-amber-300 text-[10px] ml-1">⏳ wird geprüft</span>' : ""}<span class="block text-[9px] text-slate-600">${ago(m.createdAt)}</span></div>
      ${m.mine || state.me?.isAdmin ? `<button onclick="PS.deleteChat(${m.id})" class="text-slate-600 hover:text-rose-400 text-[11px]" title="Löschen">✕</button>`
        : state.user ? `<button onclick="PS.report('chat', '${m.id}')" class="text-slate-600 hover:text-amber-300 text-[11px]" title="Melden">⚠</button>` : ""}
    </div>`).join("");
  if (atBottom || !cm.chatScrolled) { box.scrollTop = box.scrollHeight; cm.chatScrolled = true; }
}

async function sendChat() {
  if (!requireLogin()) return;
  const inp = $("chat-input");
  const text = (inp?.value || "").trim();
  if (!text) return;
  try {
    const r = await api("/api/community/chat", { method: "POST", body: { body: text } });
    if (inp) inp.value = "";
    if (r.notice) toast("⏳ Wird geprüft", r.notice);
    await pollChat();
  } catch (e) { handleError(e); }
}

async function deleteChat(id) {
  try { await api(`/api/community/chat/${id}`, { method: "DELETE" }); cm.chat = cm.chat.filter((m) => m.id !== id); renderChat(); } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Admin: Moderations-Panel
// ---------------------------------------------------------------------------
export async function communityAdminHtml() {
  return `<div class="flex flex-wrap gap-2">${btn("🛡️ Community-Moderation", "PS.openModeration()", "flex-1 bg-purple-600 text-white")}${btn("⚖️ Marktplatz & Reklamationen", "PS.openMarketAdmin()", "flex-1 bg-purple-600 text-white")}</div>`;
}

const TYPE_LABEL = { post: "📸 Pull", comment: "💬 Kommentar", chat: "🗨️ Chat" };
const ACTION_LABEL = { hide: "ausgeblendet", restore: "wiederhergestellt", remove: "entfernt", mute: "stummgeschaltet", unmute: "Stummschaltung aufgehoben", ban: "gesperrt", unban: "entsperrt", auto_hide: "automatisch zur Prüfung", auto_block: "automatisch blockiert", order_release: "Auszahlung freigegeben", order_refund: "erstattet" };

async function openModeration() {
  modal("ps-moderation", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Moderation …</p>`, { wide: true });
  try {
    const d = await api("/api/admin/moderation");
    const act = (type, id, action, label, cls, extra = "") => `<button onclick="PS.moderate(${jsArg(type)}, ${jsArg(String(id))}, ${jsArg(action)}${extra})" class="${cls} font-black px-2 py-1 rounded-lg text-[11px]">${label}</button>`;
    const contentRow = (type, id, content, image, meta, extraBtns = "") => `<div class="bg-slate-900 rounded-xl p-2.5 border border-slate-800 space-y-1.5">
      <p class="text-[11px] text-slate-400"><strong class="text-white">${TYPE_LABEL[type] || esc(type)} #${esc(String(id))}</strong> ${meta}</p>
      <div class="flex gap-2">${image ? `<img src="${esc(cdn(image, 120))}" class="w-14 h-14 object-cover rounded-lg" loading="lazy">` : ""}<p class="text-xs text-slate-200 break-words flex-1">${esc(content || "–")}</p></div>
      <div class="flex flex-wrap gap-1.5">${extraBtns}</div></div>`;
    modal("ps-moderation", `
      <h3 class="text-base font-black text-white">🛡️ Community-Moderation</h3>
      <div class="grid grid-cols-3 gap-2 text-center text-xs">
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] uppercase text-slate-400 font-bold">Pulls 24 h</p><p class="font-black text-white">${Number(d.stats?.posts_24h) || 0}</p></div>
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] uppercase text-slate-400 font-bold">Chat 24 h</p><p class="font-black text-white">${Number(d.stats?.chat_24h) || 0}</p></div>
        <div class="bg-slate-950 rounded-xl p-2"><p class="text-[10px] uppercase text-slate-400 font-bold">Filter-Blocks 24 h</p><p class="font-black text-amber-300">${Number(d.stats?.blocked_24h) || 0}</p></div>
      </div>
      <h4 class="text-sm font-black text-white">⚠️ Gemeldete Inhalte (${d.reports.length})</h4>
      <div class="space-y-1.5 max-h-80 overflow-y-auto">${d.reports.length ? d.reports.map((r) => contentRow(r.target_type, r.target_id, r.content, r.image,
        `von <strong>${esc(r.author || "?")}</strong> • gemeldet von ${esc(r.reporter)}: „${esc(r.reason)}“ • Status: ${esc(r.content_status || "?")}`,
        act(r.target_type, r.target_id, "remove", "Entfernen", "bg-rose-500/30 text-rose-200", `, ${Number(r.id)}`)
        + act(r.target_type, r.target_id, "mute", "Autor 7 Tage stumm", "bg-amber-500/30 text-amber-200", `, ${Number(r.id)}, 7`)
        + act(r.target_type, r.target_id, "ban", "Autor sperren", "bg-rose-600 text-white", `, ${Number(r.id)}`)
        + act(r.target_type, r.target_id, "restore", "Unbedenklich", "bg-emerald-500/30 text-emerald-200", `, ${Number(r.id)}, 0, true`))).join("") : `<p class="text-xs text-slate-500">Keine offenen Meldungen 🎉</p>`}</div>
      <h4 class="text-sm font-black text-white">⏳ Automatisch zurückgehalten (${d.flagged.length})</h4>
      <div class="space-y-1.5 max-h-72 overflow-y-auto">${d.flagged.length ? d.flagged.map((f) => contentRow(f.type, f.id, f.content, f.image,
        `von <strong>${esc(f.author)}</strong> • ${esc(f.flag_reason || "")} • ${new Date(f.created_at).toLocaleString("de-DE")}`,
        act(f.type, f.id, "restore", "Freigeben", "bg-emerald-500 text-slate-950") + act(f.type, f.id, "remove", "Entfernen", "bg-rose-500/30 text-rose-200")
        + act(f.type, f.id, "mute", "Autor 3 Tage stumm", "bg-amber-500/30 text-amber-200", `, 0, 3`))).join("") : `<p class="text-xs text-slate-500">Nichts in der Warteschlange.</p>`}</div>
      <h4 class="text-sm font-black text-white">🔇 Gesperrte & stummgeschaltete Nutzer (${d.restricted.length})</h4>
      <div class="space-y-1 max-h-52 overflow-y-auto text-xs">${d.restricted.length ? d.restricted.map((u) => `<div class="flex flex-wrap items-center gap-2 bg-slate-900 rounded-xl px-2.5 py-1.5">
        <span class="flex-1 text-white font-bold">${esc(u.display_name)}</span><span class="text-slate-400">${u.banned ? "gesperrt" : `stumm bis ${new Date(u.muted_until).toLocaleString("de-DE")}`}</span>
        ${u.banned ? act("user", u.user_id, "unban", "Entsperren", "bg-emerald-500/30 text-emerald-200") : act("user", u.user_id, "unmute", "Aufheben", "bg-emerald-500/30 text-emerald-200")}</div>`).join("") : `<p class="text-slate-500">Niemand.</p>`}</div>
      <details class="bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs"><summary class="font-black text-white cursor-pointer">📜 Protokoll (letzte 60)</summary>
        <div class="space-y-0.5 pt-2 max-h-60 overflow-y-auto">${d.log.map((l) => `<p class="text-[11px] text-slate-400">${new Date(l.created_at).toLocaleString("de-DE")} • ${esc(l.actor || "Filter")} • ${esc(ACTION_LABEL[l.action] || l.action)} • ${esc(l.target_type)} #${esc(l.target_id)}${l.user_name ? ` (${esc(l.user_name)})` : ""}${l.reason ? ` • ${esc(String(l.reason).slice(0, 120))}` : ""}</p>`).join("")}</div></details>`, { wide: true });
  } catch (e) { closeModalEl("ps-moderation"); handleError(e); }
}

async function moderate(targetType, targetId, action, reportId = 0, days = 0, dismiss = false) {
  if (["remove", "ban"].includes(action) && !confirm(action === "ban" ? "Nutzer wirklich sperren? Alle Inhalte werden ausgeblendet und Inserate entfernt." : "Inhalt entfernen?")) return;
  const reason = ["remove", "mute", "ban"].includes(action) ? (prompt("Begründung (wird dem Nutzer mitgeteilt, optional):") || "") : "";
  try {
    await api("/api/admin/moderation", { method: "POST", body: { targetType, targetId, action, reportId: reportId || undefined, days: days || undefined, dismiss, reason } });
    toast("✅ Erledigt", ACTION_LABEL[action] || action);
    openModeration(); loadFeed({ quiet: true });
  } catch (e) { handleError(e); }
}

// ---------------------------------------------------------------------------
// Öffentliche API & Start
// ---------------------------------------------------------------------------
export const communityApi = {
  feedScope: (s) => { cm.scope = s === "following" ? "following" : "all"; localStorage.setItem("ps_feed_scope", cm.scope); if (cm.scope === "following" && !state.user) { requireLogin(); cm.scope = "all"; } renderBar(); loadFeed(); },
  feedMore: () => loadFeed({ more: true }),
  likePost, commentPost, deletePost, deleteComment, sharePost, blockUser, unblockUser, openBlocks, deleteChat,
  openModeration, moderate,
  openAuthor: (id, slug, isPublic) => (isPublic && window.PS?.openProfile ? window.PS.openProfile(slug) : window.PS?.openUser(id)),
  toastOk: (t) => toast(t, ""),
};

/** Nach Login/Logout: Status, Feed (Likes) und Chat neu laden. */
export function syncCommunity() {
  loadMe();
  loadFeed({ quiet: true });
  cm.lastChatId = 0; cm.chat = []; cm.chatScrolled = false;
  pollChat();
}

export function routeCommunity() {
  const post = Number(new URLSearchParams(location.search).get("post"));
  if (post > 0) {
    cm.focusPost = post;
    try { window.switchTab("community"); } catch {}
    if (!cm.posts.some((p) => p.id === post)) {
      api(`/api/community/posts/${post}`).then(({ post: p }) => { if (p && !cm.posts.some((x) => x.id === p.id)) { cm.posts.unshift(p); renderFeed(); } }).catch(() => toast("Beitrag", "Dieser Beitrag ist nicht mehr verfügbar."));
    } else renderFeed();
  }
}

export function initCommunity() {
  // Frühere Firebase-Funktionen der Seite durch die API-Varianten ersetzen
  window.publishWallPost = publishPost;
  window.previewWallImage = previewImage;
  window.likeWallPost = likePost;
  window.addWallComment = (id) => commentPost(Number(id));
  window.renderPullWall = renderFeed;
  window.sendChatMessage = sendChat;
  window.renderChatList = renderChat;
  mountUi();
  loadFeed();
  pollChat();
  clearInterval(cm.chatTimer); clearInterval(cm.feedTimer);
  cm.chatTimer = setInterval(() => { if (visibleCommunity()) pollChat(); }, 4000);
  cm.feedTimer = setInterval(() => { if (visibleCommunity()) loadFeed({ quiet: true }); }, 45_000);
  document.addEventListener("visibilitychange", () => { if (visibleCommunity()) { pollChat(); loadFeed({ quiet: true }); } });
}
