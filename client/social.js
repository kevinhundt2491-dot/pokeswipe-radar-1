// Sammler-Freunde, privater 1:1-Chat, direkter Tausch im Chat, Treffen-Planer und „🃏 Karte aus meinem Binder anhängen“.
// Server: server/social.ts (Freunde & Chat) und server/community.ts (Karten-Pin am Schwarzen Brett / im Live-Chat).
// Alle Mitteilungen laufen zusätzlich über die Glocke und Web-Push (notify() auf dem Server).
import { isOnline } from "./presence.js";
import { $, esc, jsArg, eur, toast, cdn, state, api, handleError, requireLogin, modal, closeModalEl, btn, FALLBACK_IMG } from "./core.js";

const so = {
  friends: [], incoming: [], outgoing: [], loadedAt: 0, summary: { incoming: 0, unread: 0 },
  dm: { partnerId: "", lastId: 0, messages: [], trades: new Map(), partner: null, friend: "none", timer: null },
  pins: { post: null, chat: null }, picker: { target: "post", intent: "offer", q: "", results: [] },
  trade: { partnerId: "", partnerName: "", mine: [], theirs: [], give: new Map(), want: new Map(), hidden: false },
};
const cents = (c) => eur((Number(c) || 0) / 100);
const ago = (d) => new Date(d).toLocaleString("de-DE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
const avatar = (p, size = "w-9 h-9") => `<span class="ps-avatar relative overflow-hidden ${size} text-sm shrink-0 inline-flex items-center justify-center rounded-full bg-slate-800 text-white font-black" aria-hidden="true">${esc(String(p?.name || "?").slice(0, 1).toUpperCase())}${p?.avatar ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer" class="absolute inset-0 w-full h-full object-cover rounded-full" onerror="this.remove()" />` : ""}</span>`;
const dot = (id) => (isOnline(id) ? '<span class="inline-flex items-center gap-1 text-[10px] text-emerald-300 font-bold"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>online</span>' : '<span class="text-[10px] text-slate-500">offline</span>');

// ===========================================================================
// Freunde & Freundschaftsanfragen
// ===========================================================================
async function loadFriends(force = false) {
  if (!state.user) { so.friends = []; so.incoming = []; so.outgoing = []; renderStrip(); return; }
  if (!force && Date.now() - so.loadedAt < 20_000) return;
  try {
    const r = await api("/api/friends");
    const sig = (l) => l.map((f) => f.id).sort().join(",");
    const changed = sig(r.friends) !== sig(so.friends) || sig(r.incoming) !== sig(so.incoming) || sig(r.outgoing) !== sig(so.outgoing);
    so.friends = r.friends; so.incoming = r.incoming; so.outgoing = r.outgoing; so.loadedAt = Date.now();
    so.summary.incoming = r.incoming.length;
    // Freund-Knöpfe am Brett & im Chat aktualisieren, sobald sich die Freundesliste ändert
    if (changed) { try { window.renderPullWall?.(); window.renderChatList?.(); } catch {} }
  } catch {}
  renderStrip();
}

async function loadSummary() {
  if (!state.user) return;
  try {
    const r = await api("/api/social/summary");
    const changed = r.incoming !== so.summary.incoming || r.unread !== so.summary.unread;
    so.summary = r;
    if (changed) { loadFriends(true); }
    renderStrip();
  } catch {}
}

/** Freundschafts-Status eines Nutzers aus dem Zwischenspeicher. */
export function friendStateOf(id) {
  const k = String(id);
  if (state.user?.id === k) return "self";
  if (so.friends.some((f) => f.id === k)) return "friends";
  if (so.incoming.some((f) => f.id === k)) return "pending_in";
  if (so.outgoing.some((f) => f.id === k)) return "pending_out";
  return "none";
}

/** Kleiner Knopf für Brett, Chat und Profile: ➕ Freund / ⏳ Angefragt / ✅ Annehmen / 👥 Chat. */
export function friendButton(id, name, size = "sm") {
  if (!id || state.user?.id === String(id)) return "";
  const st = friendStateOf(id);
  const cls = size === "lg" ? "font-black py-2.5 px-3 rounded-xl text-xs" : "font-bold text-[10px] px-2 py-0.5 rounded-lg";
  if (st === "friends") return `<button type="button" onclick="PS.openDm(${jsArg(id)})" class="${cls} bg-emerald-500/20 text-emerald-200" title="Privat chatten">${size === "lg" ? "💬 1:1-Chat öffnen" : "👥 Chat"}</button>`;
  if (st === "pending_out") return `<span class="${cls} bg-slate-800 text-slate-400" title="Anfrage gesendet">⏳ Angefragt</span>`;
  if (st === "pending_in") return `<button type="button" onclick="PS.respondFriend(${jsArg(id)}, true)" class="${cls} bg-yellow-400 text-slate-950">✅ ${size === "lg" ? "Freundschaft annehmen" : "Annehmen"}</button>`;
  return `<button type="button" onclick="PS.addFriend(${jsArg(id)}, ${jsArg(name || "")})" class="${cls} bg-slate-800 text-yellow-300 hover:bg-slate-700" title="Freundschaftsanfrage senden">${size === "lg" ? "➕ Freundschaftsanfrage senden" : "➕ Freund"}</button>`;
}

async function addFriend(id, name = "") {
  if (!requireLogin()) return;
  try {
    const r = await api(`/api/friends/${encodeURIComponent(id)}`, { method: "POST", body: {} });
    toast(r.state === "friends" ? "🤝 Ihr seid jetzt Freunde" : "➕ Anfrage gesendet", r.state === "friends" ? "Ihr könnt jetzt privat chatten und tauschen." : `${name || "Der Sammler"} bekommt eine Mitteilung.`);
    await loadFriends(true); rerenderAll();
  } catch (e) { handleError(e); }
}
async function respondFriend(id, accept) {
  try {
    await api(`/api/friends/${encodeURIComponent(id)}/respond`, { method: "POST", body: { accept: Boolean(accept) } });
    toast(accept ? "🤝 Freundschaft angenommen" : "Anfrage abgelehnt", accept ? "Ihr seht jetzt euren Online-Status und könnt direkt chatten." : "");
    await loadFriends(true); rerenderAll();
  } catch (e) { handleError(e); }
}
async function removeFriend(id) {
  if (!confirm("Freundschaft wirklich beenden?")) return;
  try { await api(`/api/friends/${encodeURIComponent(id)}`, { method: "DELETE" }); await loadFriends(true); rerenderAll(); } catch (e) { handleError(e); }
}
function rerenderAll() {
  renderStrip();
  try { window.renderPullWall?.(); window.renderChatList?.(); } catch {}
  if ($("ps-friends") && !$("ps-friends").classList.contains("hidden")) openFriends(true);
  if ($("ps-dm") && !$("ps-dm").classList.contains("hidden")) renderDmHead();
}

/** Leiste oben im Community-Bereich: eingehende Anfragen (Annehmen/Ablehnen), Freunde online, ungelesene Nachrichten. */
function renderStrip() {
  const box = $("ps-social-strip");
  if (!box) return;
  if (!state.user) { box.innerHTML = ""; return; }
  const online = so.friends.filter((f) => isOnline(f.id));
  const unread = so.summary.unread || 0;
  box.innerHTML = `${so.incoming.length ? `<div class="bg-yellow-400/10 border border-yellow-400/50 rounded-2xl p-2.5 space-y-1.5">
      <p class="text-[11px] font-black text-yellow-200">➕ ${so.incoming.length} neue Freundschaftsanfrage${so.incoming.length > 1 ? "n" : ""}</p>
      ${so.incoming.slice(0, 3).map((f) => `<div class="flex items-center gap-2 text-xs">${avatar(f, "w-7 h-7")}<span class="flex-1 min-w-0 truncate font-bold text-white">${esc(f.name)}${f.city ? ` <span class="text-slate-400 font-normal">📍 ${esc(f.city)}</span>` : ""}</span>
        ${btn("Annehmen", `PS.respondFriend(${jsArg(f.id)}, true)`, "bg-emerald-500 text-slate-950 !py-1.5")}${btn("Ablehnen", `PS.respondFriend(${jsArg(f.id)}, false)`, "bg-slate-800 text-slate-300 !py-1.5")}</div>`).join("")}
    </div>` : ""}
    <div class="grid grid-cols-2 gap-2">
      <button type="button" onclick="PS.openFriends()" class="text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl px-3 py-2.5 min-h-[56px]">
        <span class="block text-xs font-black text-white">👥 Freunde & Nachrichten${unread ? ` <span class="ml-1 bg-rose-500 text-white text-[9px] font-black rounded-full px-1.5">${unread > 9 ? "9+" : unread}</span>` : ""}</span>
        <span class="block text-[10px] text-slate-400 truncate">${so.friends.length ? `${so.friends.length} Freunde · ${online.length} online` : "Sammler-Freunde finden & privat chatten"}</span></button>
      <button type="button" onclick="PS.openTradeHub()" class="text-left bg-emerald-500/10 border border-emerald-400/50 hover:border-yellow-400 rounded-2xl px-3 py-2.5 min-h-[56px]">
        <span class="block text-xs font-black text-emerald-200">🔄 Tauschen</span>
        <span class="block text-[10px] text-slate-400 truncate">Tausch-Gesuche, Matches & 1:1-Tausch</span></button>
    </div>`;
}

async function openFriends(refresh = false) {
  if (!requireLogin()) return;
  if (!refresh) { modal("ps-friends", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Freunde …</p>`); await loadFriends(true); }
  let convs = [];
  try { convs = (await api("/api/dm")).conversations; } catch {}
  const row = (f, actions) => `<div class="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs">${avatar(f)}
    <div class="min-w-0 flex-1"><p class="font-black text-white truncate">${esc(f.name)} ${f.badges?.includes("creator") ? "🎬" : f.badges?.includes("founder") ? "🏅" : ""}</p><p class="flex gap-1.5 items-center">${dot(f.id)}${f.city ? `<span class="text-[10px] text-slate-400">📍 ${esc(f.city)}</span>` : ""}</p></div>${actions}</div>`;
  const friends = [...so.friends].sort((a, b) => Number(isOnline(b.id)) - Number(isOnline(a.id)));
  modal("ps-friends", `
    <h3 class="text-base font-black text-white">👥 Sammler-Freunde & Nachrichten</h3>
    ${so.incoming.length ? `<div class="space-y-1.5"><p class="text-xs font-black text-yellow-300">➕ Freundschaftsanfragen (${so.incoming.length})</p>${so.incoming.map((f) => row(f,
      btn("Annehmen", `PS.respondFriend(${jsArg(f.id)}, true)`, "bg-emerald-500 text-slate-950 !py-1.5") + btn("Ablehnen", `PS.respondFriend(${jsArg(f.id)}, false)`, "bg-slate-800 text-slate-300 !py-1.5"))).join("")}</div>` : ""}
    <div class="space-y-1.5"><p class="text-xs font-black text-white">Freunde (${friends.length})</p>
      ${friends.length ? friends.map((f) => row(f, `<div class="flex gap-1">
        <button type="button" onclick="PS.openDm(${jsArg(f.id)})" class="bg-yellow-400 text-slate-950 font-black text-[11px] px-2.5 py-1.5 rounded-lg">💬 Chat${f.unread ? ` (${Number(f.unread)})` : ""}</button>
        <button type="button" onclick="PS.openDmTrade(${jsArg(f.id)}, ${jsArg(f.name)})" class="bg-emerald-500 text-slate-950 font-black text-[11px] px-2.5 py-1.5 rounded-lg">🔄 Tauschen</button>
        <button type="button" onclick="PS.openCollector(${jsArg(f.id)})" class="bg-slate-800 text-white font-bold text-[11px] px-2 py-1.5 rounded-lg" title="Binder ansehen">📒</button>
        <button type="button" onclick="PS.removeFriend(${jsArg(f.id)})" class="text-slate-500 hover:text-rose-300 text-[11px] px-1" title="Freundschaft beenden">✕</button></div>`)).join("")
        : `<p class="text-[11px] text-slate-400">Noch keine Freunde. Tippe im Live-Chat, am Schwarzen Brett oder im „Gerade online“-Radar auf einen Sammler und dann auf „➕ Freundschaftsanfrage senden“.</p>`}</div>
    ${so.outgoing.length ? `<div class="space-y-1"><p class="text-[11px] font-black text-slate-400">⏳ Gesendete Anfragen</p>${so.outgoing.map((f) => `<p class="text-[11px] text-slate-400">• ${esc(f.name)}</p>`).join("")}</div>` : ""}
    ${convs.length ? `<div class="space-y-1.5"><p class="text-xs font-black text-white">💬 Letzte Chats</p>${convs.slice(0, 15).map((c) => `<button type="button" onclick="PS.openDm(${jsArg(c.partner.id)})" class="w-full text-left flex items-center gap-2 bg-slate-900 border ${c.unread ? "border-yellow-400/70" : "border-slate-800"} rounded-xl p-2 text-xs">${avatar(c.partner, "w-8 h-8")}
      <span class="min-w-0 flex-1"><span class="block font-black text-white truncate">${esc(c.partner.name)} ${c.unread ? `<span class="text-yellow-300">• ${Number(c.unread)} neu</span>` : ""}</span><span class="block text-[11px] text-slate-400 truncate">${c.last.mine ? "Du: " : ""}${esc(c.last.body)}</span></span></button>`).join("")}</div>` : ""}
    <button type="button" onclick="PS.openOnlineList()" class="w-full bg-slate-800 text-white font-black py-2.5 rounded-xl text-xs">🟢 Wer ist gerade online? Sammler finden</button>`);
}

// ===========================================================================
// Privater 1:1-Chat
// ===========================================================================
function stopDm() { clearInterval(so.dm.timer); so.dm.timer = null; so.dm.partnerId = ""; }

async function openDm(id) {
  if (!requireLogin()) return;
  if (!id || id === state.user.id) return;
  ["ps-collector", "ps-online", "ps-friends", "ps-user"].forEach(closeModalEl);
  stopDm();
  so.dm = { ...so.dm, partnerId: String(id), lastId: 0, messages: [], trades: new Map(), partner: null, friend: "none" };
  modal("ps-dm", `<div id="ps-dm-head"><p class="text-yellow-400 text-xs text-center py-4">⏳ Lade Chat …</p></div>
    <div id="ps-dm-list" data-keep-scroll class="bg-slate-950 rounded-2xl p-3 border border-slate-800 h-72 overflow-y-auto space-y-2 text-xs"></div>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" onclick="PS.openDmTrade(${jsArg(id)})" class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2.5 rounded-xl text-xs">🔄 Direkten Tausch vorschlagen</button>
      <button type="button" onclick="PS.openMeetup(${jsArg(id)})" class="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black py-2.5 rounded-xl text-xs">📍 Treffen vereinbaren</button>
    </div>
    <div class="flex gap-2">
      <input id="ps-dm-in" maxlength="1000" placeholder="Private Nachricht …" onkeydown="if(event.key==='Enter')PS.sendDm()" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
      <button type="button" onclick="PS.sendDm()" class="bg-yellow-400 text-slate-950 font-black px-4 rounded-xl text-xs">Senden</button>
    </div>
    <p class="text-[10px] text-slate-500">Nur ihr beide seht diesen Chat. Tipp: Treffen an belebten Orten (Cardshow, Börse, Café) – Bezahlung nur mit Käuferschutz.</p>`, { wide: true, onClose: stopDm });
  await pollDm(true);
  if (so.dm.partnerId !== String(id)) return;
  so.dm.timer = setInterval(() => { if (!document.hidden) pollDm(); }, 4000);
}

function renderDmHead() {
  const box = $("ps-dm-head");
  const p = so.dm.partner;
  if (!box || !p) return;
  box.innerHTML = `<div class="flex items-center gap-3 pr-6">
    ${avatar(p, "w-11 h-11")}
    <div class="min-w-0 flex-1"><p class="text-base font-black text-white truncate">${esc(p.name)}</p>
      <p class="flex flex-wrap items-center gap-1.5">${dot(p.id)}${p.city ? `<span class="text-[10px] text-slate-400">📍 ${esc(p.city)}</span>` : ""}${friendButton(p.id, p.name)}</p></div>
    <button type="button" onclick="PS.openCollector(${jsArg(p.id)})" class="bg-slate-800 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-lg shrink-0">📒 Binder</button>
  </div>
  ${so.dm.blocked ? `<p class="text-xs text-rose-300 bg-rose-500/10 rounded-xl p-2">🚫 Ihr habt euch blockiert – Nachrichten sind nicht möglich.</p>` : ""}`;
}

async function pollDm(initial = false) {
  const id = so.dm.partnerId;
  if (!id) return;
  try {
    const r = await api(`/api/dm/${encodeURIComponent(id)}${so.dm.lastId ? `?after=${so.dm.lastId}` : ""}`);
    if (so.dm.partnerId !== id) return;
    so.dm.partner = r.partner; so.dm.friend = r.friend; so.dm.blocked = r.blocked;
    for (const t of r.trades || []) so.dm.trades.set(t.id, t);
    let changed = initial;
    for (const u of r.updated || []) {
      const i = so.dm.messages.findIndex((m) => m.id === u.id);
      if (i >= 0 && JSON.stringify(so.dm.messages[i].meta) !== JSON.stringify(u.meta)) { so.dm.messages[i] = u; changed = true; }
    }
    if (r.messages.length) {
      so.dm.messages = so.dm.messages.concat(r.messages.filter((m) => !so.dm.messages.some((x) => x.id === m.id))).slice(-200);
      so.dm.lastId = Math.max(so.dm.lastId, ...r.messages.map((m) => m.id));
      changed = true;
    }
    if (r.trades?.length) changed = true;
    if (initial) renderDmHead();
    if (changed) renderDmList();
    if (r.messages.some((m) => !m.mine)) loadSummary();
  } catch (e) { if (initial) { closeModalEl("ps-dm"); handleError(e); } }
}

function tradeCard(m) {
  const t = so.dm.trades.get(Number(m.meta?.tradeId));
  const label = { pending: ["⏳ Wartet auf Antwort", "text-amber-300"], accepted: ["✅ Angenommen – Versand/Übergabe", "text-emerald-300"], shipping: ["📦 Versand läuft", "text-cyan-300"], completed: ["🏁 Abgeschlossen", "text-emerald-300"], declined: ["❌ Abgelehnt", "text-rose-300"], cancelled: ["Abgebrochen", "text-slate-400"] };
  const st = t ? label[t.status] || label.pending : ["", ""];
  const iAmReceiver = t?.role === "receiver";
  return `<div class="bg-emerald-500/10 border border-emerald-400/50 rounded-2xl p-3 space-y-2 max-w-[92%] ${m.mine ? "ml-auto" : ""}">
    <p class="text-[11px] font-black text-emerald-200">🔄 Direkter Tausch-Vorschlag ${st[0] ? `<span class="${st[1]} ml-1">${st[0]}</span>` : ""}</p>
    ${t ? `<div class="grid grid-cols-2 gap-2 text-[11px]">
      <div class="bg-slate-950 rounded-xl p-2"><p class="text-slate-400 font-bold">${t.role === "sender" ? "Du bietest" : `${esc(so.dm.partner?.name || "Partner")} bietet`}</p><p class="text-white" data-i18n-skip>${esc(t.offer)}</p><p class="text-emerald-300 font-black">≈ ${cents(t.fromValueCents)}</p></div>
      <div class="bg-slate-950 rounded-xl p-2"><p class="text-slate-400 font-bold">${t.role === "sender" ? "Du möchtest" : "…möchte dafür"}</p><p class="text-white" data-i18n-skip>${esc(t.request)}</p><p class="text-emerald-300 font-black">≈ ${cents(t.toValueCents)}</p></div>
    </div>
    <p class="text-[10px] text-slate-400">Cardmarket-Richtwerte zur fairen Orientierung${t.cashCents ? ` · Wertausgleich ${cents(t.cashCents)}` : ""}</p>
    <div class="flex flex-wrap gap-1.5">
      ${t.status === "pending" && iAmReceiver ? `${btn("✅ Annehmen", `PS.dmTradeAction(${Number(t.id)}, 'accept')`, "bg-emerald-500 text-slate-950 !py-1.5")}${btn("✏️ Anpassen", `PS.openDmTrade(${jsArg(so.dm.partnerId)}, '', ${Number(t.id)})`, "bg-slate-800 text-white !py-1.5")}${btn("Ablehnen", `PS.dmTradeAction(${Number(t.id)}, 'decline')`, "bg-rose-500/20 text-rose-200 !py-1.5")}` : ""}
      ${t.status === "pending" && !iAmReceiver ? btn("Zurückziehen", `PS.dmTradeAction(${Number(t.id)}, 'cancel')`, "bg-slate-800 text-slate-300 !py-1.5") : ""}
      ${["accepted", "shipping", "completed"].includes(t.status) ? btn(t.status === "completed" ? "⭐ Bewerten & Details" : "📦 Versand, Erhalt & Abschließen", `PS.openTrades(${Number(t.id)})`, "bg-cyan-400 text-slate-950 !py-1.5") : ""}
      ${btn("Details", `PS.openTrades(${Number(t.id)})`, "bg-slate-800 text-slate-300 !py-1.5")}
    </div>` : `<p class="text-[11px] text-slate-300" data-i18n-skip>${esc(m.body)}</p>`}
  </div>`;
}

function meetupCard(m) {
  const x = m.meta || {};
  const [y, mo, d] = String(x.date || "").split("-");
  const kinds = { cardshow: "🎪 Cardshow", flohmarkt: "🛍️ Flohmarkt", local: "📍 Lokaler Treffpunkt", other: "🤝 Treffen" };
  const st = { proposed: ["Offen", "text-amber-300"], accepted: ["✅ Zugesagt", "text-emerald-300"], countered: ["🕒 Andere Zeit vorgeschlagen", "text-slate-400"], declined: ["Abgesagt", "text-rose-300"] }[x.status] || ["", ""];
  const maps = `https://www.openstreetmap.org/search?query=${encodeURIComponent(x.place || "")}`;
  return `<div class="bg-cyan-500/10 border border-cyan-400/50 rounded-2xl p-3 space-y-1.5 max-w-[92%] ${m.mine ? "ml-auto" : ""}">
    <p class="text-[11px] font-black text-cyan-200">📍 Treffen ${m.mine ? "vorgeschlagen" : `von ${esc(so.dm.partner?.name || "Partner")}`} <span class="${st[1]} ml-1">${st[0]}</span></p>
    <p class="text-sm font-black text-white" data-i18n-skip>${esc(kinds[x.kind] || kinds.other)} · ${esc(x.place || "")}</p>
    <p class="text-xs text-slate-200">📅 ${esc(d || "")}.${esc(mo || "")}.${esc(y || "")} · 🕒 ${esc(x.time || "")} Uhr</p>
    ${x.note ? `<p class="text-[11px] text-slate-300" data-i18n-skip>${esc(x.note)}</p>` : ""}
    <div class="flex flex-wrap gap-1.5 pt-1">
      ${x.status === "proposed" && !m.mine ? `${btn("✅ Treffen zusagen", `PS.answerMeetup(${Number(m.id)}, 'accept')`, "bg-emerald-500 text-slate-950 !py-1.5")}${btn("🕒 Andere Zeit vorschlagen", `PS.openMeetup(${jsArg(so.dm.partnerId)}, ${Number(m.id)})`, "bg-slate-800 text-white !py-1.5")}` : ""}
      <a href="${esc(maps)}" target="_blank" rel="noopener" class="bg-slate-800 text-slate-200 font-bold py-1.5 px-3 rounded-xl text-xs">🗺️ Karte</a>
    </div>
  </div>`;
}

function renderDmList() {
  const box = $("ps-dm-list");
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = so.dm.messages.length ? so.dm.messages.map((m) => {
    if (m.kind === "trade") return tradeCard(m);
    if (m.kind === "meetup") return meetupCard(m);
    return `<div class="flex ${m.mine ? "justify-end" : "justify-start"}"><div class="max-w-[80%] ${m.mine ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-white"} rounded-2xl px-3 py-1.5">
      <p class="break-words" data-i18n-skip>${esc(m.body)}</p>${m.pending ? '<p class="text-[10px] text-amber-700">⏳ wird geprüft</p>' : ""}
      <p class="text-[9px] opacity-60 text-right">${ago(m.createdAt)}${m.mine && m.read ? " · gelesen" : ""}${m.mine ? ` · <button type="button" onclick="PS.deleteDm(${Number(m.id)})" class="underline">löschen</button>` : ` · <button type="button" onclick="PS.report('dm', '${Number(m.id)}')" class="underline" title="Melden">⚠ melden</button>`}</p></div></div>`;
  }).join("") : `<p class="text-slate-500 text-center py-6">Noch keine Nachrichten. Sag Hallo, schlag einen Tausch vor oder vereinbart ein Treffen auf der nächsten Cardshow!</p>`;
  if (atBottom || !box.dataset.scrolled) { box.scrollTop = box.scrollHeight; box.dataset.scrolled = "1"; }
}

async function sendDm() {
  const inp = $("ps-dm-in");
  const text = (inp?.value || "").trim();
  if (!text || !so.dm.partnerId) return;
  inp.value = "";
  try {
    const r = await api(`/api/dm/${encodeURIComponent(so.dm.partnerId)}`, { method: "POST", body: { kind: "text", body: text } });
    if (r.notice) toast("⏳ Wird geprüft", r.notice);
    await pollDm();
  } catch (e) { inp.value = text; handleError(e); }
}

async function deleteDm(id) {
  if (!confirm("Nachricht löschen?")) return;
  try { await api(`/api/dm/messages/${Number(id)}`, { method: "DELETE" }); so.dm.messages = so.dm.messages.filter((m) => m.id !== Number(id)); renderDmList(); } catch (e) { handleError(e); }
}

async function dmTradeAction(id, action) {
  if (action === "cancel" && !confirm("Tausch-Vorschlag zurückziehen?")) return;
  try {
    await api(`/api/trades/${Number(id)}/action`, { method: "POST", body: { action } });
    toast(action === "accept" ? "✅ Tausch angenommen" : "Erledigt", action === "accept" ? "Jetzt Versand oder Übergabe vereinbaren – z. B. mit „📍 Treffen vereinbaren“." : "");
    so.dm.lastId = 0; so.dm.messages = []; await pollDm(true);
    window.PS?.refreshMe?.();
  } catch (e) { handleError(e); }
}

// ===========================================================================
// 📍 Treffen-Planer
// ===========================================================================
function openMeetup(partnerId, counterOf = 0) {
  if (!requireLogin()) return;
  const prev = counterOf ? so.dm.messages.find((m) => m.id === Number(counterOf))?.meta || {} : {};
  const today = new Date().toISOString().slice(0, 10);
  modal("ps-meetup", `
    <h3 class="text-base font-black text-white">${counterOf ? "🕒 Andere Zeit vorschlagen" : "📍 Treffen vereinbaren"}</h3>
    <p class="text-xs text-slate-300">Cardshow, Flohmarkt oder lokaler Treffpunkt – dein Tauschpartner sieht die Einladung direkt im Chat und kann zusagen.</p>
    <label class="block text-xs space-y-1"><span class="font-bold text-slate-300">Art</span>
      <select id="ps-mt-kind" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white">
        ${[["cardshow", "🎪 Cardshow / Börse"], ["flohmarkt", "🛍️ Flohmarkt"], ["local", "📍 Lokaler Treffpunkt"], ["other", "🤝 Sonstiges"]].map(([k, l]) => `<option value="${k}" ${(prev.kind || "local") === k ? "selected" : ""}>${l}</option>`).join("")}
      </select></label>
    <label class="block text-xs space-y-1"><span class="font-bold text-slate-300">Ort / Event</span>
      <input id="ps-mt-place" maxlength="120" value="${esc(prev.place || "")}" placeholder="z. B. Cardshow Köln, Halle 2 · oder Café am Hauptbahnhof" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" /></label>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <label class="space-y-1"><span class="font-bold text-slate-300">Datum</span><input id="ps-mt-date" type="date" min="${today}" value="${esc(prev.date || "")}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" /></label>
      <label class="space-y-1"><span class="font-bold text-slate-300">Uhrzeit</span><input id="ps-mt-time" type="time" value="${esc(prev.time || "")}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" /></label>
    </div>
    <input id="ps-mt-note" maxlength="200" placeholder="Notiz (optional), z. B. „Ich bringe die Karten im Toploader mit“" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
    ${btn(counterOf ? "🕒 Neuen Vorschlag senden" : "📍 Einladung senden", `PS.sendMeetup(${jsArg(partnerId)}, ${Number(counterOf) || 0})`, "w-full bg-cyan-400 text-slate-950")}
    <p class="text-[10px] text-slate-500">🛡️ Trefft euch an belebten, öffentlichen Orten und prüft die Karten vor Ort.</p>`);
}

async function sendMeetup(partnerId, counterOf = 0) {
  const body = { kind: $("ps-mt-kind")?.value, place: $("ps-mt-place")?.value, date: $("ps-mt-date")?.value, time: $("ps-mt-time")?.value, note: $("ps-mt-note")?.value };
  try {
    if (counterOf) await api(`/api/dm/messages/${Number(counterOf)}/meetup`, { method: "POST", body: { action: "counter", ...body } });
    else await api(`/api/dm/${encodeURIComponent(partnerId)}`, { method: "POST", body: { kind: "meetup", ...body } });
    closeModalEl("ps-meetup");
    toast("📍 Treffen gesendet", "Dein Partner bekommt eine Mitteilung und kann zusagen.");
    if (so.dm.partnerId !== String(partnerId)) await openDm(partnerId);
    else { so.dm.lastId = 0; so.dm.messages = []; await pollDm(true); }
  } catch (e) { handleError(e); }
}

async function answerMeetup(id, action) {
  try {
    await api(`/api/dm/messages/${Number(id)}/meetup`, { method: "POST", body: { action } });
    toast("✅ Treffen zugesagt", "Ihr seht euch! Die Zusage steht im Chat.");
    so.dm.lastId = 0; so.dm.messages = []; await pollDm(true);
  } catch (e) { handleError(e); }
}

// ===========================================================================
// 🔄 Direkter Tausch im Chat: „Ich biete dir …“ ↔ „Ich möchte dafür …“
// ===========================================================================
async function ensurePortfolio() {
  if (state.portfolio?.items) return state.portfolio.items;
  await window.PS?.loadPortfolio?.();
  return state.portfolio?.items || [];
}

/** preset: { give: [portfolioItemId], want: [{ portfolioItemId|listingId }] } – z. B. aus einem ⚡ PokeSwipe-Match. */
async function openDmTrade(partnerId, partnerName = "", adjustTradeId = 0, preset = null) {
  if (!requireLogin()) return;
  if (!partnerId || partnerId === state.user.id) return;
  ["ps-collector", "ps-friends"].forEach(closeModalEl);
  modal("ps-dm-trade", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade beide Binder …</p>`, { wide: true });
  try {
    const [mine, theirs] = await Promise.all([ensurePortfolio(), api(`/api/collectors/${encodeURIComponent(partnerId)}/binder`)]);
    const t = so.trade;
    t.partnerId = String(partnerId); t.partnerName = partnerName || theirs.collector?.name || so.dm.partner?.name || "Sammler";
    t.mine = mine; t.hidden = Boolean(theirs.hidden); t.adjust = Number(adjustTradeId) || 0;
    const seen = new Set();
    t.theirs = [
      ...(theirs.listings || []).map((l) => ({ key: `l${l.id}`, listingId: l.id, name: l.name, image: l.image, condition: l.condition, market: Number(l.market) || Number(l.price) || 0, tag: "Inserat" })),
      ...(theirs.dupes || []).map((d) => ({ key: `p${d.id}`, portfolioItemId: d.id, name: d.name, image: d.image, condition: d.condition, market: Number(d.market) || 0, tag: `${Number(d.spare) || 1}× doppelt` })),
      ...(theirs.highlights || []).map((d) => ({ key: `p${d.id}`, portfolioItemId: d.id, name: d.name, image: d.image, condition: d.condition, market: Number(d.market) || 0, tag: "Binder" })),
    ].filter((x) => (seen.has(x.key) ? false : seen.add(x.key)));
    t.give = new Map(); t.want = new Map();
    for (const id of preset?.give || []) if (mine.some((i) => i.id === Number(id))) t.give.set(Number(id), 1);
    for (const w of preset?.want || []) {
      const key = w.listingId ? `l${w.listingId}` : `p${w.portfolioItemId}`;
      if (!t.theirs.some((x) => x.key === key) && (w.portfolioItemId || w.listingId)) t.theirs.unshift({ key, listingId: w.listingId, portfolioItemId: w.portfolioItemId, name: w.name, image: w.image, condition: w.condition, market: Number(w.market) || 0, tag: "📌 angeboten" });
      t.want.set(key, true);
    }
    renderDmTrade();
  } catch (e) { closeModalEl("ps-dm-trade"); handleError(e); }
}

function dmTradeTotals() {
  const t = so.trade;
  const give = t.mine.filter((i) => t.give.has(i.id)).reduce((s, i) => s + Math.round((Number(i.unitValue) || 0) * 100), 0);
  const want = t.theirs.filter((x) => t.want.has(x.key)).reduce((s, x) => s + Math.round((Number(x.market) || 0) * 100), 0);
  return { give, want };
}

function renderDmTrade() {
  const t = so.trade;
  const { give, want } = dmTradeTotals();
  const larger = Math.max(give, want), ratio = larger ? Math.abs(give - want) / larger : 0;
  const verdict = !give && !want ? ["Wähle Karten aus", "text-slate-400"] : ratio <= 0.15 ? ["⚖️ Fairer Tausch", "text-emerald-300"] : give > want ? ["⬆️ Du gibst mehr", "text-amber-300"] : ["⬇️ Partner gibt mehr", "text-amber-300"];
  const tile = (x, on, onclick, price) => `<button type="button" onclick="${onclick}" class="text-left flex items-center gap-2 rounded-xl p-2 border ${on ? "border-yellow-400 bg-yellow-400/10" : "border-slate-800 bg-slate-900"}">
    <img src="${esc(x.image ? cdn(x.image, 80) : FALLBACK_IMG)}" onerror="this.src='${FALLBACK_IMG}'" class="w-9 h-12 object-contain rounded shrink-0" loading="lazy" alt="" />
    <span class="min-w-0 flex-1"><span class="block font-bold text-white truncate">${esc(x.name)}</span><span class="block text-[10px] text-slate-400">${esc(x.condition || "NM")}${x.tag ? ` · ${esc(x.tag)}` : ""}</span></span>
    <span class="text-[11px] font-black ${on ? "text-yellow-300" : "text-slate-300"}">${on ? "✓ " : ""}${price ? eur(price) : "–"}</span></button>`;
  const mineSorted = [...t.mine].sort((a, b) => (Number(b.quantity) >= 2) - (Number(a.quantity) >= 2) || (Number(b.unitValue) || 0) - (Number(a.unitValue) || 0));
  modal("ps-dm-trade", `
    <h3 class="text-base font-black text-white">🔄 ${t.adjust ? "Tausch anpassen (Gegenangebot)" : "Direkten Tausch vorschlagen"} – ${esc(t.partnerName)}</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      <div class="space-y-1.5"><p class="font-black text-cyan-300">Ich biete dir … <span class="text-slate-400 font-bold">(aus meinem Album, max. 10)</span></p>
        <div class="max-h-72 overflow-y-auto space-y-1.5" data-keep-scroll>${mineSorted.length ? mineSorted.map((i) => tile({ ...i, tag: Number(i.quantity) >= 2 ? `${Number(i.quantity)}× im Binder` : "" }, t.give.has(i.id), `PS.dmTradeToggle('give', ${Number(i.id)})`, Number(i.unitValue) || 0)).join("") : `<p class="text-slate-400">Dein Album ist leer – scanne zuerst Karten.</p>`}</div></div>
      <div class="space-y-1.5"><p class="font-black text-emerald-300">Ich möchte dafür … <span class="text-slate-400 font-bold">(aus ${esc(t.partnerName)}s Binder)</span></p>
        <div class="max-h-72 overflow-y-auto space-y-1.5" data-keep-scroll>${t.theirs.length ? t.theirs.map((x) => tile(x, t.want.has(x.key), `PS.dmTradeToggle('want', ${jsArg(x.key)})`, Number(x.market) || 0)).join("")
          : `<p class="text-slate-400">${t.hidden ? "🔒 Die Sammlung ist privat – frag im Chat nach Karten oder bitte um einen Karten-Pin am Schwarzen Brett." : "Noch keine Tausch-Karten im Binder."}</p>`}</div></div>
    </div>
    <div class="bg-slate-950 border border-slate-800 rounded-2xl p-3 grid grid-cols-3 gap-2 text-center text-xs">
      <div><p class="text-slate-400">Du gibst</p><p class="font-black text-white">${cents(give)}</p></div>
      <div><p class="text-slate-400">Du bekommst</p><p class="font-black text-white">${cents(want)}</p></div>
      <div><p class="text-slate-400">Bilanz</p><p class="font-black ${verdict[1]}">${verdict[0]}</p></div></div>
    <input id="ps-dmt-msg" maxlength="500" placeholder="Nachricht dazu (optional)" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
    ${btn("🔄 Tausch-Vorschlag in den Chat senden", "PS.sendDmTrade()", "w-full bg-emerald-500 text-slate-950")}
    <p class="text-[10px] text-slate-500">Werte: Cardmarket-Trend (Richtwert). Dein Partner kann annehmen, anpassen oder ablehnen; nach dem Tausch bestätigt ihr beide den Erhalt (Versand mit Sendungsnummer oder persönliche Übergabe).</p>`, { wide: true });
}

function dmTradeToggle(side, key) {
  const t = so.trade;
  const map = side === "give" ? t.give : t.want;
  const k = side === "give" ? Number(key) : String(key);
  if (map.has(k)) map.delete(k);
  else if (map.size >= 10) return toast("Tausch", "Höchstens 10 Karten pro Seite.");
  else map.set(k, side === "give" ? 1 : true);
  renderDmTrade();
}

async function sendDmTrade() {
  const t = so.trade;
  if (!t.want.size) return toast("Tausch", "Bitte mindestens eine Karte deines Partners auswählen („Ich möchte dafür …“).");
  if (!t.give.size) return toast("Tausch", "Bitte mindestens eine eigene Karte auswählen („Ich biete dir …“).");
  const want = t.theirs.filter((x) => t.want.has(x.key)).map((x) => (x.listingId ? { listingId: x.listingId } : { portfolioItemId: x.portfolioItemId }));
  const message = $("ps-dmt-msg")?.value || "";
  try {
    // Nur Inserate gewünscht → erstes Inserat als Anker; sonst Tausch direkt aus dem Binder des Partners
    const anchor = want.every((w) => w.listingId) ? want[0] : null;
    const trade = await api("/api/trades", { method: "POST", body: {
      listingId: anchor?.listingId, partnerId: anchor ? undefined : t.partnerId, want,
      give: [...t.give].map(([portfolioItemId, quantity]) => ({ portfolioItemId, quantity })), message,
    } });
    // Anpassen = Gegenangebot: der alte Vorschlag wird abgelehnt, sobald der neue steht
    if (t.adjust) await api(`/api/trades/${t.adjust}/action`, { method: "POST", body: { action: "decline" } }).catch(() => {});
    await api(`/api/dm/${encodeURIComponent(t.partnerId)}`, { method: "POST", body: { kind: "trade", tradeId: trade.id, body: message } });
    closeModalEl("ps-dm-trade");
    toast("🔄 Tausch-Vorschlag gesendet", `${t.partnerName} sieht ihn im Chat und bekommt eine Mitteilung.`);
    if (so.dm.partnerId === t.partnerId) { so.dm.lastId = 0; so.dm.messages = []; await pollDm(true); } else openDm(t.partnerId);
  } catch (e) {
    if (e.data?.tradeId) { closeModalEl("ps-dm-trade"); window.PS?.openTrades?.(e.data.tradeId); return; }
    handleError(e);
  }
}

/** „🔄 Tauschen“-Zentrale: alle Tausch-Wege an einem Ort. */
function openTradeHub() {
  modal("ps-trade-hub", `
    <h3 class="text-base font-black text-white">🔄 Tauschen</h3>
    <p class="text-xs text-slate-300">Karte gegen Karte – mit Cardmarket-Richtwert, beidseitiger Bestätigung und Bewertungen.</p>
    <div class="grid grid-cols-2 gap-2">
      ${[["📌", "Tausch-Gesuche am Brett", "Wer sucht & bietet was?", "PS.closeTradeHub(); PS.boardCategory('trade')"],
        ["💚", "Swipe-Tausch", "Rechts wischen = Interesse", "PS.closeTradeHub(); PS.marketTab('swipe')"],
        ["🤝", "Meine Tausche", "Offene Tausche & Tausch-Chat", "PS.closeTradeHub(); PS.openTrades()"],
        ["🔥", "Meine Matches", "Gegenseitiges Interesse", "PS.closeTradeHub(); PS.openMatches()"],
        ["👥", "Mit Freunden tauschen", "1:1-Chat & Treffen", "PS.closeTradeHub(); PS.openFriends()"],
        ["🛒", "Tausch-Inserate", "Marktplatz-Filter „Tausch“", "PS.closeTradeHub(); PS.marketTab('trade')"],
      ].map(([i, l, s, on]) => `<button type="button" onclick="${on}" class="text-left bg-slate-950 border border-slate-800 hover:border-yellow-400 rounded-2xl p-3 min-h-[64px]"><span class="block text-sm font-black text-white">${i} ${l}</span><span class="block text-[11px] text-slate-400">${s}</span></button>`).join("")}
    </div>
    ${btn("📌 Tausch-Gesuch ans Brett heften", "PS.closeTradeHub(); PS.boardCompose('trade')", "w-full bg-emerald-500 text-slate-950")}`);
}

// ===========================================================================
// 🃏 Karte aus meinem Binder anhängen (Schwarzes Brett & Live-Chat)
// ===========================================================================
function openCardPicker(target = "post", intent = "offer") {
  if (!requireLogin()) return;
  so.picker = { target, intent, q: "", results: [], wish: so.picker.wish || null };
  renderPicker();
  ensurePortfolio().then(renderPicker);
  if (!so.picker.wish) api("/api/wishlist").then((r) => { so.picker.wish = r.items || []; renderPicker(); }).catch(() => { so.picker.wish = []; });
}

function renderPicker() {
  const p = so.picker;
  const items = state.portfolio?.items || [];
  const q = p.q.toLowerCase();
  const tile = (x, onclick, sub, price) => `<button type="button" onclick="${onclick}" class="text-left bg-slate-900 border border-slate-800 hover:border-yellow-400 rounded-xl p-2 flex flex-col gap-1">
    <img src="${esc(x.image ? cdn(x.image, 200) : FALLBACK_IMG)}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="w-full aspect-[63/88] object-contain rounded-lg bg-slate-950" loading="lazy" />
    <span class="text-[11px] font-bold text-white leading-tight line-clamp-2">${esc(x.name)}</span><span class="text-[10px] text-slate-400">${sub}</span>
    <span class="text-[10px] font-black text-emerald-300">${price ? eur(price) : "Preis –"}</span></button>`;
  let list = "";
  if (p.intent === "offer") {
    const mine = items.filter((i) => !q || String(i.name).toLowerCase().includes(q)).sort((a, b) => (Number(b.quantity) >= 2) - (Number(a.quantity) >= 2) || (Number(b.unitValue) || 0) - (Number(a.unitValue) || 0)).slice(0, 48);
    list = mine.length ? mine.map((i) => tile(i, `PS.pickPin(${Number(i.id)}, '')`, `${esc(i.condition || "NM")} · ${Number(i.quantity)}×${Number(i.quantity) >= 2 ? " ♻️ doppelt" : ""}`, Number(i.unitValue) || 0)).join("")
      : `<p class="col-span-full text-xs text-slate-400">Keine passende Karte im Album. Scanne Karten, um sie hier anzubieten.</p>`;
  } else {
    const wish = (p.wish || []).filter((w) => !q || String(w.name).toLowerCase().includes(q)).slice(0, 24);
    const found = p.results.filter((r) => !wish.some((w) => w.cardId === r.card_id));
    list = `${wish.length ? `<p class="col-span-full text-[11px] font-black text-yellow-300">⭐ Von deiner Wunschliste</p>${wish.map((w) => tile(w, `PS.pickPin(0, ${jsArg(w.cardId)})`, esc(w.setName || ""), Number(w.price) || 0)).join("")}` : ""}
      ${found.length ? `<p class="col-span-full text-[11px] font-black text-cyan-300">🔎 Katalog</p>${found.map((r) => tile(r, `PS.pickPin(0, ${jsArg(r.card_id)})`, `${esc(r.set_name || "")}${r.local_id ? ` · ${esc(r.local_id)}` : ""}`, Number(r.price) || 0)).join("")}` : ""}
      ${!wish.length && !found.length ? `<p class="col-span-full text-xs text-slate-400">Tippe den Namen der gesuchten Karte ein (z. B. „Glurak ex“) – oder setze fehlende (graue) Karten im Set-Binder auf die Wunschliste.</p>` : ""}`;
  }
  modal("ps-card-pick", `
    <h3 class="text-base font-black text-white">🃏 Karte aus meinem Binder anhängen</h3>
    <div class="flex bg-slate-900 border border-slate-700 rounded-xl p-1 gap-1 text-xs font-black">
      <button type="button" onclick="PS.pinIntent('offer')" class="flex-1 py-1.5 rounded-lg ${p.intent === "offer" ? "bg-emerald-500 text-slate-950" : "text-slate-300"}">🔄 Ich biete zum Tausch</button>
      <button type="button" onclick="PS.pinIntent('seek')" class="flex-1 py-1.5 rounded-lg ${p.intent === "seek" ? "bg-cyan-400 text-slate-950" : "text-slate-300"}">🔎 Ich suche für mein Set</button>
    </div>
    <input id="ps-pin-q" value="${esc(p.q)}" oninput="PS.pinSearch(this.value)" placeholder="${p.intent === "offer" ? "In meinem Album suchen …" : "Gesuchte Karte, z. B. Glurak ex 199"}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
    <div class="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[55dvh] overflow-y-auto" data-keep-scroll>${list}</div>
    <p class="text-[10px] text-slate-500">⚡ Sammler, die deine gesuchte Karte doppelt haben – oder deine angebotene Karte für ihr Set suchen – sehen sofort ein „PokeSwipe-Match“.</p>`, { wide: true });
}

let pinTimer = null;
function pinSearch(v) {
  so.picker.q = String(v || "");
  clearTimeout(pinTimer);
  if (so.picker.intent === "offer") { pinTimer = setTimeout(renderPicker, 150); return; }
  pinTimer = setTimeout(async () => {
    const q = so.picker.q.trim();
    if (q.length >= 2) {
      try { const r = await api(`/api/search?q=${encodeURIComponent(q)}&lang=de&limit=16`); so.picker.results = (r.items || []).filter((x) => x.card_id); } catch { so.picker.results = []; }
    } else so.picker.results = [];
    renderPicker();
  }, 300);
}

function pickPin(itemId, cardId) {
  const p = so.picker;
  let pin = null;
  if (itemId) {
    const i = (state.portfolio?.items || []).find((x) => x.id === Number(itemId));
    if (i) pin = { intent: p.intent, binderItemId: i.id, name: i.name, image: i.image, price: Number(i.unitValue) || 0 };
  } else if (cardId) {
    const w = (p.wish || []).find((x) => x.cardId === cardId) || p.results.find((x) => x.card_id === cardId);
    if (w) pin = { intent: "seek", pinCardId: cardId, name: w.name, image: w.image, price: Number(w.price) || 0 };
  }
  if (!pin) return;
  so.pins[p.target] = pin;
  closeModalEl("ps-card-pick");
  renderPinChip(p.target);
  if (p.target === "post") { const cat = $("ps-post-cat"); if (cat) cat.value = "trade"; }
}

export function renderPinChip(target) {
  const box = $(target === "post" ? "ps-post-pin" : "ps-chat-pin");
  if (!box) return;
  const pin = so.pins[target];
  box.innerHTML = pin ? `<div class="flex items-center gap-2 bg-slate-950 border ${pin.intent === "offer" ? "border-emerald-400/60" : "border-cyan-400/60"} rounded-xl p-1.5 text-[11px]">
    <img src="${esc(pin.image ? cdn(pin.image, 80) : FALLBACK_IMG)}" onerror="this.src='${FALLBACK_IMG}'" class="w-7 h-10 object-contain rounded" alt="" />
    <span class="flex-1 min-w-0"><span class="block font-black ${pin.intent === "offer" ? "text-emerald-200" : "text-cyan-200"}">${pin.intent === "offer" ? "🔄 Ich biete zum Tausch" : "🔎 Ich suche für mein Set"}</span><span class="block text-white truncate">${esc(pin.name)}${pin.price ? ` · ${eur(pin.price)}` : ""}</span></span>
    <button type="button" onclick="PS.clearPin('${target}')" class="text-slate-400 hover:text-rose-300 px-1" title="Entfernen">✕</button></div>` : "";
  box.classList.toggle("hidden", !pin);
}

/** Für community.js: Felder des Karten-Pins zum Mitsenden (und danach leeren). */
export function takePin(target) {
  const pin = so.pins[target];
  if (!pin) return {};
  return { cardIntent: pin.intent, binderItemId: pin.binderItemId || undefined, pinCardId: pin.pinCardId || undefined };
}
export function clearPin(target) { so.pins[target] = null; renderPinChip(target); }

// ===========================================================================
// Mount, Deep-Links & öffentliche API
// ===========================================================================
function mount() {
  const quick = $("ps-community-quick");
  if (quick && !$("ps-social-strip")) {
    const d = document.createElement("div");
    d.id = "ps-social-strip";
    d.className = "space-y-2";
    quick.after(d);
  }
  renderStrip();
}

export function routeSocial() {
  const params = new URLSearchParams(location.search);
  const dm = params.get("dm");
  if (dm && /^[\w-]{4,80}$/.test(dm)) setTimeout(() => { try { window.switchTab("community"); } catch {} openDm(dm); }, 400);
  if (params.get("friends") === "1") setTimeout(() => { try { window.switchTab("community"); } catch {} openFriends(); }, 400);
}

export function syncSocial() {
  so.loadedAt = 0; so.picker.wish = null;
  loadFriends(true);
  loadSummary();
}

export const socialApi = {
  openFriends: () => openFriends(false), addFriend, respondFriend, removeFriend,
  openDm, sendDm, deleteDm, dmTradeAction, openMeetup, sendMeetup, answerMeetup,
  openDmTrade, dmTradeToggle, sendDmTrade, openTradeHub, closeTradeHub: () => closeModalEl("ps-trade-hub"),
  openCardPicker, pinIntent: (i) => { so.picker.intent = i === "seek" ? "seek" : "offer"; so.picker.q = ""; so.picker.results = []; renderPicker(); },
  pinSearch, pickPin, clearPin, friendButton,
};

export function initSocial() {
  mount();
  // Community-Kopf wird bei Tab-Wechsel neu gezeichnet → Leiste wieder einhängen
  const obs = () => { if (!$("ps-social-strip")) mount(); };
  window.addEventListener("ps:plan", obs);
  window.addEventListener("ps:online", () => { renderStrip(); if ($("ps-dm") && !$("ps-dm").classList.contains("hidden")) renderDmHead(); });
  setInterval(() => { if (state.user && !document.hidden) loadSummary(); }, 30_000);
  syncSocial();
}
