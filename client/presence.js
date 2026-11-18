// Live-Online-Radar („Gerade online“), Binder-Einblick & Direkt-Tausch
// • Präsenz in Echtzeit über Firebase (public/js/legacy-app.js schreibt pokeswipe_radar/presence/<uid> mit
//   onDisconnect().remove() und Herzschlag alle 45 s). Dieses Modul liefert die Zusatzfelder: Gast-Nummer (g),
//   aktueller Bereich (a) und – für angemeldete Sammler – die vom Server ausgegebene Nonce (n).
// • Name, Avatar, Badges und Tausch-Kartenzahl kommen ausschließlich vom Server (/api/presence/members),
//   damit niemand in Firebase fremde Namen oder Badges vortäuschen kann.
// • Antippen eines Sammlers öffnet die Binder-Vorschau mit „Anschreiben“ und 1-Klick-Tauschangebot.
import { $, esc, jsArg, eur, toast, cdn, state, api, handleError, modal, closeModalEl, btn, FALLBACK_IMG } from "./core.js";

const ACTIVE_MS = 150_000; // Einträge ohne Herzschlag seit 2,5 Min. gelten als offline
const pr = {
  all: {}, me: null, members: {}, fetchedAt: {}, fetching: false, lastFetch: 0,
  nonce: "", claimKey: "", lastUserId: null, lastArea: "", online: new Map(), binder: null, renderTimer: 0,
};

// ---------------------------------------------------------------------------
// Eigener Präsenz-Eintrag
// ---------------------------------------------------------------------------
function guestNo() {
  try {
    let n = Number(localStorage.getItem("ps_guest_no"));
    if (!(n >= 1000 && n <= 9999)) { n = 1000 + Math.floor(Math.random() * 9000); localStorage.setItem("ps_guest_no", String(n)); }
    return n;
  } catch { return 1000 + Math.floor(Math.random() * 9000); }
}
const GUEST_NO = guestNo();

const AREAS = {
  home: "Auf der Startseite", swipe: "Swipt in der Arena", scan: "Scannt Karten", flip: "Checkt Flip-Deals",
  community: "Im Live-Chat", map: "Stöbert im Marktplatz", portfolio: "Pflegt den Set-Binder", profile: "Im Profil", trades: "Im Tausch-Hub",
};
function currentArea() {
  if ($("ps-trades") && !$("ps-trades").classList.contains("hidden")) return "trades";
  for (const k of Object.keys(AREAS)) {
    const v = $(`view-${k}`);
    if (v && !v.classList.contains("hidden")) return k;
  }
  return "home";
}

window.psPresenceExtra = () => ({ g: GUEST_NO, a: currentArea(), ...(state.user && pr.nonce ? { n: pr.nonce } : {}) });

async function claim() {
  const uid = window.psFb?.uid;
  const userId = state.user?.id || null;
  if (!uid || !userId) { if (pr.nonce) { pr.nonce = ""; window.psFb?.beat?.(); } return; }
  const key = `${uid}|${userId}`;
  if (pr.claimKey === key && pr.nonce) return;
  pr.claimKey = key;
  try {
    const cached = sessionStorage.getItem(`ps_pn_${key}`);
    if (cached) pr.nonce = cached;
    else {
      const r = await api("/api/presence/claim", { method: "POST", body: { fbUid: uid } });
      pr.nonce = r.nonce || "";
      if (pr.nonce) sessionStorage.setItem(`ps_pn_${key}`, pr.nonce);
    }
  } catch { pr.claimKey = ""; }
  window.psFb?.beat?.();
}

// ---------------------------------------------------------------------------
// Liste der aktiven Einträge
// ---------------------------------------------------------------------------
function activeEntries() {
  const now = Date.now();
  return Object.entries(pr.all || {})
    .filter(([, p]) => p && Number(p.ts) > now - ACTIVE_MS)
    .map(([f, p]) => ({ f, n: typeof p.n === "string" ? p.n : "", g: Number(p.g) || 0, a: String(p.a || ""), me: f === pr.me }));
}

async function fetchMembers(force = false) {
  const need = activeEntries().filter((e) => e.n && (force || !pr.fetchedAt[e.f] || Date.now() - pr.fetchedAt[e.f] > 90_000));
  if (!need.length || pr.fetching || (!force && Date.now() - pr.lastFetch < 8000)) return;
  pr.fetching = true; pr.lastFetch = Date.now();
  try {
    const r = await api("/api/presence/members", { method: "POST", body: { entries: need.map((e) => ({ f: e.f, n: e.n })) } });
    for (const e of need) { pr.fetchedAt[e.f] = Date.now(); pr.members[e.f] = r.members?.[e.f] || null; }
  } catch {} finally { pr.fetching = false; }
  render();
}

/** Mitglieder (je Konto nur einmal, auch bei mehreren Tabs) und Gäste. */
function snapshot() {
  const entries = activeEntries();
  const members = new Map(), guests = [];
  for (const e of entries) {
    const m = e.n ? pr.members[e.f] : null;
    if (m) {
      const prev = members.get(m.id);
      if (!prev || e.me) members.set(m.id, { ...m, area: e.a, me: e.me || prev?.me });
    } else if (!(e.me && state.user)) guests.push(e); // eigener Tab ohne bestätigte Nonce: nicht als Gast zählen
  }
  // Eigener Eintrag sofort sichtbar, auch bevor der Server antwortet
  if (state.user && pr.me && ![...members.values()].some((m) => m.me) && entries.some((e) => e.me)) {
    members.set(state.user.id, {
      id: state.user.id, name: state.me?.displayName || "Du", avatar: state.me?.avatarUrl || "", badges: myBadges(),
      tradeCards: 0, binderVisible: state.me?.binderVisible !== false, area: currentArea(), me: true,
    });
  }
  return { members: [...members.values()].sort((a, b) => Number(b.me) - Number(a.me) || (b.tradeCards || 0) - (a.tradeCards || 0)), guests };
}
function myBadges() {
  const b = [];
  if (state.me?.creator) b.push("creator");
  if (state.me?.founder?.unlocked) b.push("founder");
  if (state.me?.plan === "pro") b.push("pro"); else if (state.me?.plan === "premium") b.push("premium");
  return b;
}

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------
const BADGE = {
  creator: '<span class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-fuchsia-500/25 text-fuchsia-200" title="Verifizierter Creator">🎬 Creator</span>',
  founder: '<span class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/25 text-amber-200" title="Gründer-Sammler">🏅 Gründer</span>',
  pro: '<span class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-cyan-500/25 text-cyan-200" title="PokeSwipe Pro">✔ Pro</span>',
  premium: '<span class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-200" title="Premium">⭐ Premium</span>',
  member: '<span class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200" title="Registrierter Sammler">Sammler</span>',
  guest: '<span class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-300" title="Nicht angemeldet">Gast</span>',
};
export const badgesHtml = (list = []) => (list.length ? list.map((b) => BADGE[b] || "").join(" ") : BADGE.member);
const initial = (name) => esc((String(name || "?").replace(/^@/, "").trim()[0] || "?").toUpperCase());
function avatarHtml(m, size = "w-8 h-8") {
  const dot = '<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950" aria-hidden="true"></span>';
  const inner = m.avatar
    ? `<img src="${esc(m.avatar)}" alt="" class="${size} rounded-full object-cover" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />`
    : `<span class="${size} rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 text-slate-950 font-black grid place-items-center text-xs">${initial(m.name)}</span>`;
  return `<span class="relative shrink-0 inline-flex">${inner}${dot}</span>`;
}

function memberRow(m) {
  return `<button type="button" onclick="PS.openCollector(${jsArg(m.id)})" class="w-full text-left flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl px-2.5 py-2">
    ${avatarHtml(m)}
    <span class="min-w-0 flex-1"><span class="flex items-center gap-1 flex-wrap"><strong class="text-white text-xs truncate">${esc(m.name)}${m.me ? " (du)" : ""}</strong>${badgesHtml(m.badges)}</span>
      <span class="block text-[10px] text-slate-400 truncate">🟢 ${esc(AREAS[m.area] || "Online")}${m.binderVisible ? ` · ${Number(m.tradeCards) || 0} Tausch-Karten` : " · Sammlung privat"}</span></span>
    <span class="text-[10px] text-yellow-300 font-bold shrink-0">Binder ›</span></button>`;
}
function guestChip(g) {
  return `<span class="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-full px-2 py-1 text-[10px] text-slate-400" title="${esc(AREAS[g.a] || "Online")}">
    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Gast #${Number(g.g) || "????"}${g.me ? " (du)" : ""} ${BADGE.guest}</span>`;
}

const compactText = (s) => `🟢 ${s.members.length} ${s.members.length === 1 ? "Sammler" : "Sammler"} & ${s.guests.length} ${s.guests.length === 1 ? "Gast" : "Gäste"} gerade online`;

function mount() {
  // Kompakte Anzeige im Start-Dashboard (neben dem bisherigen Zähler)
  const homeHead = $("liveVisitorCount")?.closest("span");
  if (homeHead && !$("ps-online-compact-home")) {
    const b = document.createElement("button");
    b.type = "button"; b.id = "ps-online-compact-home";
    b.className = "block w-full text-left text-[11px] font-bold text-emerald-300 hover:text-emerald-200";
    b.setAttribute("onclick", "PS.openOnlineList()");
    homeHead.parentElement?.insertAdjacentElement("afterend", b);
  }
  // „Gerade online“-Leiste im Live-Chat
  const panel = $("ps-chat-panel");
  const chat = $("chat-messages");
  if (panel && chat && !$("ps-online-panel")) {
    const d = document.createElement("div");
    d.id = "ps-online-panel";
    d.className = "bg-slate-950/70 border border-emerald-500/30 rounded-xl p-2.5 space-y-2";
    chat.insertAdjacentElement("beforebegin", d);
  }
}

function render() {
  clearTimeout(pr.renderTimer);
  pr.renderTimer = setTimeout(doRender, 120);
}
function doRender() {
  mount();
  const s = snapshot();
  // Online-Status für den Chat (grüner Punkt neben Nachrichten)
  const ids = new Map(s.members.map((m) => [m.id, m]));
  const changed = ids.size !== pr.online.size || [...ids.keys()].some((k) => !pr.online.has(k));
  pr.online = ids;
  if (changed) { try { window.dispatchEvent(new CustomEvent("ps:online")); } catch {} }

  const home = $("ps-online-compact-home");
  if (home) home.textContent = compactText(s) + " ›";
  const panel = $("ps-online-panel");
  if (panel) {
    const top = s.members.slice(0, 6);
    panel.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <p class="text-[11px] font-black text-emerald-300">${esc(compactText(s))}</p>
        <button type="button" onclick="PS.openOnlineList()" class="text-[10px] font-bold text-slate-400 hover:text-white">Alle ›</button>
      </div>
      ${top.length ? `<div class="flex gap-1.5 overflow-x-auto pb-1">${top.map((m) => `<button type="button" onclick="PS.openCollector(${jsArg(m.id)})" class="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-full pl-1 pr-2.5 py-1 shrink-0 hover:border-yellow-400/60" title="${esc(AREAS[m.area] || "Online")}">${avatarHtml(m, "w-6 h-6")}<span class="text-[11px] text-white font-bold max-w-[7rem] truncate">${esc(m.name)}</span>${m.badges?.includes("creator") ? "🎬" : m.badges?.includes("founder") ? "🏅" : m.badges?.includes("pro") ? '<span class="text-cyan-300 text-[10px]">✔</span>' : ""}</button>`).join("")}</div>` : `<p class="text-[10px] text-slate-500">Gerade ist kein angemeldeter Sammler online.</p>`}
      ${s.guests.length ? `<div class="flex flex-wrap gap-1">${s.guests.slice(0, 5).map(guestChip).join("")}${s.guests.length > 5 ? `<span class="text-[10px] text-slate-500 px-1 py-1">+${s.guests.length - 5} Gäste</span>` : ""}</div>` : ""}
      ${guestHint()}`;
  }
  if ($("ps-online") && !$("ps-online").classList.contains("hidden")) openOnlineList(true);
}

function guestHint() {
  if (state.user) return "";
  return `<p class="text-[10px] bg-yellow-400/10 border border-yellow-400/30 text-yellow-100 rounded-lg px-2 py-1.5">👋 Du bist als <strong>Gast #${GUEST_NO}</strong> online – <button type="button" onclick="PS.openAccount()" class="underline font-bold text-yellow-300">jetzt kostenlos anmelden</button>, um eigene Karten zu zeigen & zu tauschen.</p>`;
}

function openOnlineList(refresh = false) {
  const s = snapshot();
  if (!refresh) fetchMembers(true);
  modal("ps-online", `
    <h3 class="text-base font-black text-white">${esc(compactText(s))}</h3>
    ${guestHint()}
    <div class="space-y-1.5 max-h-96 overflow-y-auto">${s.members.length ? s.members.map(memberRow).join("") : `<p class="text-xs text-slate-500">Gerade ist kein angemeldeter Sammler online.</p>`}</div>
    ${s.guests.length ? `<p class="text-[11px] font-black text-slate-300">Gäste (${s.guests.length})</p><div class="flex flex-wrap gap-1">${s.guests.slice(0, 40).map(guestChip).join("")}</div>` : ""}
    <p class="text-[10px] text-slate-500">Tippe auf einen Sammler, um seinen Binder & seine Tausch-Karten zu sehen. Wer seine Sammlung nicht zeigen möchte, schaltet das im Profil ab.</p>`);
}

// ---------------------------------------------------------------------------
// Chat-Integration
// ---------------------------------------------------------------------------
/** Grüner Punkt + „Sammler“-Badge neben Chat-Nachrichten, wenn der Autor gerade online ist. */
export function onlineDot(userId) {
  const m = pr.online.get(String(userId));
  return m ? ' <span class="inline-flex items-center gap-0.5 text-[9px] text-emerald-300 font-bold" title="Gerade online"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>online</span>' : "";
}
export const isOnline = (userId) => pr.online.has(String(userId));

/** „Anschreiben“: öffnet den Live-Chat mit @Erwähnung des Sammlers. */
function chatMention(name) {
  if (!state.user) return guestPrompt("anschreiben");
  closeModalEl("ps-collector"); closeModalEl("ps-online");
  try { window.PS?.communityTab?.("chat"); } catch {}
  setTimeout(() => {
    const inp = $("chat-input");
    if (!inp) return;
    const tag = `@${String(name || "").replace(/^@/, "")} `;
    if (!inp.value.startsWith(tag)) inp.value = tag + inp.value.replace(/^@\S+\s/, "");
    inp.focus();
    try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch {}
    $("ps-chat-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 150);
}

function guestPrompt(what = "tauschen") {
  modal("ps-guest-prompt", `
    <h3 class="text-base font-black text-white">🔐 Kostenlos anmelden & ${what === "anschreiben" ? "Sammler anschreiben" : "direkt tauschen"}</h3>
    <p class="text-xs text-slate-300">Als Gast kannst du dich umsehen. Zum Anschreiben, Tauschen und um <strong>deine eigenen Karten</strong> zu zeigen, brauchst du ein kostenloses Konto – dauert 20 Sekunden.</p>
    <ul class="text-xs text-slate-300 space-y-1"><li>✅ Live-Chat & Direkt-Tausch mit Sammlern</li><li>✅ Eigener Set-Binder mit Live-Preisen</li><li>✅ Tausch mit Käuferschutz & Bewertungen</li></ul>
    ${btn("Jetzt kostenlos registrieren", "PS.closeGuestPrompt(); PS.openAccount()", "w-full bg-yellow-400 text-slate-950")}
    ${btn("Später", "PS.closeGuestPrompt()", "w-full bg-slate-800 text-slate-300")}`);
}

// ---------------------------------------------------------------------------
// Binder-Vorschau eines Sammlers
// ---------------------------------------------------------------------------
function cardTile(item, kind, partner) {
  const val = Number(item.market) || 0;
  const price = kind === "listing" ? Number(item.price) || 0 : 0;
  return `<div class="bg-slate-900 border border-slate-800 rounded-xl p-2 flex flex-col gap-1">
    <img src="${esc(item.image ? cdn(item.image, 200) : FALLBACK_IMG)}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="w-full aspect-[63/88] object-contain rounded-lg bg-slate-950" loading="lazy" />
    <p class="text-[11px] font-bold text-white leading-tight line-clamp-2">${esc(item.name)}</p>
    <p class="text-[10px] text-slate-400">${esc(item.condition || "NM")}${item.lang && item.lang !== "de" ? ` · ${esc(String(item.lang).toUpperCase())}` : ""}${kind === "dupe" ? ` · ${Number(item.spare) || 1}× übrig` : ""}</p>
    <p class="text-[10px]">${val ? `<span class="text-emerald-300 font-black">${eur(val)}</span> <span class="text-slate-500">Markt</span>` : '<span class="text-slate-500">Marktpreis –</span>'}${price ? ` · <span class="text-yellow-300 font-bold">${eur(price)}</span>` : ""}</p>
    ${partner.isMe ? "" : `<button type="button" onclick="PS.binderTrade(${jsArg(kind)}, ${Number(item.id)})" class="mt-auto bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px] rounded-lg py-1.5">🤝 Tauschen</button>`}
  </div>`;
}

async function openCollector(id) {
  modal("ps-collector", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Binder …</p>`, { wide: true });
  try {
    const r = await api(`/api/collectors/${encodeURIComponent(id)}/binder`);
    pr.binder = r;
    const p = r.collector;
    const online = pr.online.get(String(p.id));
    const sect = (title, list, kind, sub = "") => (list.length ? `<div class="space-y-1.5"><p class="text-xs font-black text-white">${title} <span class="text-slate-500 font-bold">${list.length}</span>${sub ? ` <span class="text-[10px] text-slate-400 font-normal">${sub}</span>` : ""}</p>
      <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${list.map((x) => cardTile(x, kind, p)).join("")}</div></div>` : "");
    const head = `<div class="flex items-center gap-3">
      ${avatarHtml({ name: p.name, avatar: p.avatar }, "w-12 h-12")}
      <div class="min-w-0 flex-1"><p class="text-base font-black text-white truncate">${esc(p.name)}</p>
        <p class="flex flex-wrap gap-1 items-center">${badgesHtml(p.badges)} ${online ? `<span class="text-[10px] text-emerald-300 font-bold">🟢 ${esc(AREAS[online.area] || "Gerade online")}</span>` : '<span class="text-[10px] text-slate-500">offline</span>'}${p.city ? ` <span class="text-[10px] text-slate-400">📍 ${esc(p.city)}</span>` : ""}</p>
        ${p.bio ? `<p class="text-[11px] text-slate-300 mt-0.5" data-i18n-skip>${esc(p.bio)}</p>` : ""}</div></div>`;
    const actions = p.isMe ? `<label class="flex gap-2 items-start bg-slate-900 rounded-xl p-2.5 cursor-pointer text-xs"><input type="checkbox" id="ps-bv-toggle" ${p.binderVisible ? "checked" : ""} onchange="PS.setBinderVisible(this.checked)" class="mt-0.5 accent-yellow-400"><span><strong class="text-white">Meine Sammlung / Tausch-Karten für andere Sammler sichtbar machen</strong><span class="block text-slate-400 text-[11px]">So sehen dich andere in „Gerade online“ und können dir 1-Klick-Tauschangebote schicken. Jederzeit abschaltbar.</span></span></label>`
      : `<div class="grid grid-cols-2 gap-2">
        ${btn("💬 Anschreiben", `PS.chatMention(${jsArg(p.name)})`, "bg-yellow-400 text-slate-950")}
        ${btn("🤝 Tausch anbieten", "PS.binderTrade('any', 0)", "bg-emerald-500 text-slate-950")}
      </div>
      ${state.user ? `<div class="grid grid-cols-2 gap-2">
        ${window.PS?.friendButton?.(p.id, p.name, "lg") || ""}
        ${btn("🔒 Privater 1:1-Chat", `PS.openDm(${jsArg(p.id)})`, "bg-slate-800 text-white")}
      </div>` : ""}`;
    const stats = r.stats ? `<p class="text-[11px] text-slate-400">${Number(r.stats.cards) || 0} Karten · ${Number(r.stats.unique) || 0} verschiedene · <strong class="text-emerald-300">${(Number(r.stats.spare) || 0) + (Number(r.stats.listings) || 0)} zum Tausch</strong></p>` : "";
    const body = r.hidden
      ? `<p class="text-xs bg-slate-900 rounded-xl p-3 text-slate-300">🔒 ${esc(p.name)} zeigt seine Sammlung gerade nicht öffentlich. Du kannst ihn trotzdem im Live-Chat anschreiben.</p>`
      : `${sect("🔁 Zum Tausch markiert", r.listings, "listing", "Inserate im Tausch-Hub")}
         ${sect("♻️ Dubletten", r.dupes, "dupe", "doppelt in der Sammlung")}
         ${sect("⭐ Highlights aus dem Set-Binder", r.highlights, "highlight")}
         ${!r.listings.length && !r.dupes.length && !r.highlights.length ? `<p class="text-xs text-slate-500">Noch keine Karten im Binder.</p>` : ""}
         ${r.guest ? `<div class="text-xs bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-2.5 text-yellow-100">👀 Als Gast siehst du nur eine Vorschau. ${btn("Kostenlos anmelden & alles sehen", "PS.openAccount()", "bg-yellow-400 text-slate-950 ml-1")}</div>` : ""}`;
    modal("ps-collector", `${head}${stats}${actions}${body}
      <div class="flex flex-wrap gap-2">${p.publicProfile ? btn("🌐 Öffentliches Profil", `PS.openAuthor(${jsArg(p.id)}, ${jsArg(p.slug)}, true)`, "bg-slate-800 text-white") : ""}${!p.isMe ? btn("⭐ Bewertungen & mehr", `PS.openUser(${jsArg(p.id)})`, "bg-slate-800 text-white") : ""}</div>`, { wide: true });
  } catch (e) { closeModalEl("ps-collector"); handleError(e); }
}

function binderTrade(kind, itemId) {
  if (!state.user) return guestPrompt("tauschen");
  const r = pr.binder;
  if (!r?.collector) return;
  const p = r.collector;
  let item = null;
  if (kind === "listing") { const l = r.listings.find((x) => x.id === itemId); if (l) item = { ...l, listingId: l.id }; }
  else if (kind === "dupe" || kind === "highlight") {
    const i = (kind === "dupe" ? r.dupes : r.highlights).find((x) => x.id === itemId);
    if (i) item = { ...i, portfolioItemId: i.id };
  } else {
    // „Tausch anbieten“ ohne bestimmte Karte: wertvollste Tausch-Karte vorauswählen
    const l = r.listings[0]; const d = r.dupes[0] || r.highlights[0];
    item = l ? { ...l, listingId: l.id } : d ? { ...d, portfolioItemId: d.id } : null;
  }
  if (!item) return toast("Tausch", "Dieser Sammler hat gerade keine Karten zum Tausch freigegeben – schreib ihn im Chat an.");
  window.PS?.openBinderTrade?.(p.id, p.name, item);
}

async function setBinderVisible(on) {
  try {
    await api("/api/me/binder-visibility", { method: "PUT", body: { binderVisible: Boolean(on) } });
    if (state.me) state.me.binderVisible = Boolean(on);
    pr.fetchedAt = {}; fetchMembers(true);
    toast(on ? "👀 Sammlung sichtbar" : "🔒 Sammlung privat", on ? "Andere Sammler sehen deine Tausch-Karten und können dir Angebote schicken." : "Andere sehen nur noch deinen Namen in „Gerade online“.");
  } catch (e) { handleError(e); }
}

export const presenceApi = {
  openCollector, openOnlineList: () => openOnlineList(false), chatMention, binderTrade, setBinderVisible,
  closeGuestPrompt: () => closeModalEl("ps-guest-prompt"), guestPrompt,
};

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
export function initPresence() {
  window.addEventListener("ps:presence", (e) => {
    pr.all = e.detail?.all || {};
    pr.me = e.detail?.me || pr.me;
    fetchMembers();
    render();
  });
  window.addEventListener("ps:fb-ready", (e) => { pr.me = e.detail?.uid || null; claim(); });
  // Konto- und Bereichswechsel erkennen (leichtgewichtig, ohne in bestehende Abläufe einzugreifen)
  setInterval(() => {
    const uid = state.user?.id || null;
    if (uid !== pr.lastUserId) { pr.lastUserId = uid; claim(); render(); }
    const a = currentArea();
    if (a !== pr.lastArea) { pr.lastArea = a; window.psFb?.beat?.(); }
  }, 3000);
  setInterval(() => { if (!document.hidden) render(); }, 30_000); // abgelaufene Einträge ausblenden
  mount();
}
