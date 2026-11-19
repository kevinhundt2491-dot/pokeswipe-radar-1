// Admin-Zentrale → „Creator-Finder & Outreach“ (wird erst beim Öffnen nachgeladen)
// • Starter-Liste (DACH Pokémon-TCG) mit Wahrscheinlichkeits-Score und 1-Klick-Recherche (Kanalinfo/Impressum, TikTok, Instagram)
// • Kontakt-Extraktor (/api/admin/extract-creator-contact) füllt die E-Mail automatisch aus
// • Automatischer 30-Tage-Promo-Code je Creator, 4 Anschreiben-Vorlagen mit Platzhaltern
// • Kontrollierter Versand über Resend: „Freigeben & senden“ oder gestaffelte Warteschlange (max. 15/Tag), Follow-up nach 4 Tagen
// • Creator-Bewerbungen von /creator freigeben, Viral-Hook- & Kommentar-Generator, Schnellstart Pro-Video-Generator
import { $, esc, jsArg, safeUrl, toast, api, handleError, modal, btn } from "./core.js";
import { uploadCreatorVideo, creatorVideoStatus, deleteCreatorVideo } from "./creator-video-upload.js";

const ca = {
  data: null, tab: "finder", filter: "all", selected: new Set(), open: new Set(), hook: { type: "restock", topic: "" },
  // Laufende 1-Klick-Aktionen (Auto-Finder / Massenversand) – verhindert Doppelklicks und zeigt den Fortschritt
  finder: null, bulk: null, lastSummary: "",
  // Turbo: Auto-Finder + anschließender Launch-Massenversand in einem Klick; Showcase-Video für /creator#video
  turbo: false, video: undefined, videoUpload: null,
  // Live-Versand-Protokoll (Empfänger | Status | Resend-ID | Fehler) des letzten Batch-Laufs + gespeicherte Historie vom Server
  sendLog: [], history: null,
};
/** Zufällige Pause 500–800 ms zwischen zwei Mails (Resend-Rate-Limit). */
const bulkGap = (s) => { const min = Number(s?.bulkGapMinMs) || 500, max = Math.max(min, Number(s?.bulkGapMaxMs) || 800); return Math.round(min + Math.random() * (max - min)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Creator, die der Massenversand anschreibt: echte E-Mail, noch nicht angeschrieben, nicht abgemeldet/Platzhalter. */
const bulkReady = (d) => d.leads.filter((l) => ["ready", "paused", "queued"].includes(l.status) && !l.placeholder && EMAIL_OK.test(String(l.email || "")) && !l.sentAt);
/** Creator, für die der Auto-Finder sucht. */
const finderOpen = (d) => d.leads.filter((l) => !l.email && !l.placeholder && ["ready", "paused"].includes(l.status));

const STATUS_CLS = {
  ready: "bg-sky-500/20 text-sky-200", queued: "bg-violet-500/20 text-violet-200", sending: "bg-violet-500/20 text-violet-200",
  sent: "bg-emerald-500/20 text-emerald-200", followup: "bg-amber-500/25 text-amber-200", replied: "bg-yellow-400/25 text-yellow-200",
  active: "bg-fuchsia-500/25 text-fuchsia-200", dm_sent: "bg-cyan-500/20 text-cyan-200", paused: "bg-slate-700 text-slate-300", optout: "bg-rose-500/20 text-rose-200", no_email: "bg-slate-700 text-slate-300",
};
const fmt = (d) => (d ? new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs";

async function load() {
  ca.data = await api("/api/admin/creators");
  if (ca.data.seeded) toast("🎯 Starter-Liste angelegt", "DACH-Creator & Platzhalter-Slots inkl. persönlicher Promo-Codes sind bereit.");
}

export async function openCreatorAdmin() {
  modal("ps-creators", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Creator-Finder …</p>`, { wide: true });
  try { await load(); render(); } catch (e) { handleError(e); }
  loadVideoStatus();
}

function render() {
  const holder = $("ps-creators");
  const scroll = holder ? holder.scrollTop : 0;
  const d = ca.data;
  if (!d) return;
  const tabs = [["finder", `🎯 Creator-Finder (${d.leads.length})`], ["apps", `📝 Bewerbungen (${d.applications.filter((a) => a.status === "new").length})`], ["hooks", "🔥 Viral-Hooks & Video"]];
  modal("ps-creators", `
    <h3 class="text-base font-black text-white">🎯 Creator-Finder & Outreach</h3>
    ${sendingBox(d.sending)}
    <div class="flex flex-wrap gap-1.5">${tabs.map(([k, l]) => `<button type="button" onclick="PS.caTab(${jsArg(k)})" class="text-xs font-black px-3 py-1.5 rounded-xl ${ca.tab === k ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-200"}">${l}</button>`).join("")}</div>
    ${ca.tab === "finder" ? finderHtml(d) : ca.tab === "apps" ? appsHtml(d) : hooksHtml()}`, { wide: true });
  const h2 = $("ps-creators");
  if (h2) h2.scrollTop = scroll;
}

function sendingBox(s) {
  const pct = Math.min(100, Math.round((s.sentToday / s.cap) * 100));
  return `<div class="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-1.5 text-xs">
    <div class="flex flex-wrap justify-between gap-2"><span class="font-black text-white">📬 Resend-Versand ${s.configured ? '<span class="text-emerald-300">aktiv</span>' : '<span class="text-rose-300">nicht eingerichtet (RESEND_API_KEY / MAIL_FROM)</span>'}</span>
      <span class="text-slate-300">Heute <strong class="text-white">${Number(s.sentToday)}/${Number(s.cap)}</strong> · Abstand ≥ ${Number(s.minGapMin)} Min.${s.lastSentAt ? ` · zuletzt ${esc(fmt(s.lastSentAt))}` : ""}</span></div>
    <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div class="h-full ${pct >= 100 ? "bg-rose-500" : "bg-emerald-500"}" style="width:${pct}%"></div></div>
    ${!s.canSend && s.reason ? `<p class="text-amber-300">${esc(s.reason)}</p>` : ""}
    <details class="text-[11px] text-slate-400"><summary class="cursor-pointer text-slate-300 font-bold">⚖️ Spielregeln für saubere Zustellbarkeit & Rechtssicherheit</summary>
      <ul class="list-disc pl-4 mt-1 space-y-0.5">
        <li>Nur persönliche Kooperationsanfragen an <strong>öffentlich als geschäftlich angegebene</strong> Adressen (Kanalinfo, Impressum, Linktree, „Business-Anfragen“) – jede automatisch gefundene Adresse stammt wörtlich von einer abgerufenen Seite und ist per MX-Eintrag geprüft. Keine gekauften Listen.</li>
        <li>Jede Mail enthält Absender, Impressum-Link und einen Abmelde-Link (auch als One-Click-Header). Abgemeldete Adressen landen auf der Sperrliste und werden nie wieder angeschrieben.</li>
        <li>Einzelversand & Warteschlange: höchstens ${Number(s.cap)} Mails pro Tag, mindestens ${Number(s.minGapMin)} Minuten Abstand. 1-Klick-Massenversand: ~${Number(s.bulkGapMs || 500)} ms Abstand, höchstens ${Number(s.bulkCap || 100)} Mails pro Tag. Genau ein Follow-up – danach ist Schluss.</li>
        <li>Antworten gehen an die erste Adresse aus ADMIN_EMAILS. Absendername in den Vorlagen: ${s.senderName ? `„${esc(s.senderName)}“` : "„das Team“ (eigenen Namen über die Umgebungsvariable OUTREACH_SENDER_NAME setzen)"}.</li>
      </ul></details>
  </div>`;
}

// ---------------------------------------------------------------------------
// Creator-Finder
// ---------------------------------------------------------------------------
const FILTERS = [["all", "Alle"], ["ready", "Bereit"], ["no_email", "Ohne E-Mail"], ["queued", "Warteschlange"], ["sent", "Gesendet"], ["dm_sent", "DM gesendet"], ["followup", "Follow-up fällig"], ["replied", "Antwort"], ["active", "Aktiv"]];

function finderHtml(d) {
  const leads = d.leads.filter((l) => ca.filter === "all" || l.display.key === ca.filter || (ca.filter === "queued" && l.status === "sending"));
  const totalSignups = d.leads.reduce((s, l) => s + (Number(l.signups) || 0), 0);
  const sendable = d.leads.filter((l) => ca.selected.has(l.id) && ["ready", "paused"].includes(l.status) && l.email && !l.placeholder).length;
  return `
    ${buyerSellerBarHtml(d)}
    ${bigActionsHtml(d)}
    ${tiktokFinderHtml(d)}
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
      ${[["Creator", d.leads.filter((l) => !l.placeholder).length], ["Gesendet", d.leads.filter((l) => l.sentAt).length], ["Follow-up fällig", d.leads.filter((l) => l.display.key === "followup").length], ["Anmeldungen über Codes", totalSignups]]
        .map(([k, v]) => `<div class="bg-slate-950 rounded-xl p-2 border border-slate-800"><p class="text-[10px] uppercase text-slate-400 font-bold">${k}</p><p class="text-lg font-black text-white">${Number(v)}</p></div>`).join("")}
    </div>
    <details class="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-xs" ${d.leads.length ? "" : "open"}>
      <summary class="cursor-pointer font-black text-white">➕ Creator hinzufügen (Promo-Code wird automatisch erzeugt)</summary>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">
        <input id="ca-new-name" placeholder="Kanalname *" class="${inputCls} col-span-2 sm:col-span-1" />
        <select id="ca-new-platform" class="${inputCls}">${d.platforms.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("")}</select>
        <select id="ca-new-category" class="${inputCls}">${d.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("")}</select>
        <input id="ca-new-url" placeholder="Kanal-Link (https://…)" class="${inputCls} col-span-2" />
        <input id="ca-new-followers" type="number" min="0" placeholder="Follower (ca.)" class="${inputCls}" />
        <input id="ca-new-email" type="email" placeholder="Kontakt-E-Mail (optional)" class="${inputCls} col-span-2" />
      </div>
      ${btn("+ Anlegen & Code erzeugen", "PS.caAdd()", "w-full mt-2 bg-purple-600 text-white")}
    </details>
    <div class="flex flex-wrap gap-1">${FILTERS.map(([k, l]) => `<button type="button" onclick="PS.caFilter(${jsArg(k)})" class="text-[11px] font-bold px-2.5 py-1 rounded-full ${ca.filter === k ? "bg-white text-slate-950" : "bg-slate-800 text-slate-300"}">${l}</button>`).join("")}</div>
    <div class="flex flex-wrap items-center gap-2 bg-violet-500/10 border border-violet-400/30 rounded-xl p-2 text-xs">
      <span class="text-violet-100 font-bold">${ca.selected.size} ausgewählt${sendable !== ca.selected.size ? ` (${sendable} versandbereit)` : ""}</span>
      ${btn("📤 Ausgewählte nacheinander senden", "PS.caQueue()", "bg-violet-500 text-white")}
      ${btn("Alle Bereiten mit E-Mail wählen", "PS.caSelectReady()", "bg-slate-800 text-slate-200")}
      ${ca.selected.size ? btn("Auswahl leeren", "PS.caSelectNone()", "bg-slate-800 text-slate-300") : ""}
      <span class="text-[10px] text-slate-400 w-full">Die Warteschlange verschickt alle ~6 Min. eine Mail (Job alle 5 Min.), höchstens ${Number(d.sending.cap)} pro Tag – der Rest rutscht automatisch auf den nächsten Morgen.</span>
    </div>
    <div class="space-y-2">${leads.length ? leads.map((l) => leadCard(l, d)).join("") : `<p class="text-xs text-slate-500">Keine Einträge in diesem Filter.</p>`}</div>`;
}

// Schnellleiste: kleinere TikTok-Käufer & -Verkäufer (500–15k Follower) + Direktlink zum Showcase-Video
const BUYER_SELLER_FALLBACK = [
  { label: "TikTok: Pokemon Karten verkaufen", url: "https://www.tiktok.com/search/user?q=pokemon%20karten%20verkaufen" },
  { label: "TikTok: Pokemon Flohmarkt Deals", url: "https://www.tiktok.com/search/user?q=pokemon%20flohmarkt" },
  { label: "TikTok: Pokemon Cardshow / Tausch", url: "https://www.tiktok.com/search/user?q=pokemon%20cardshow%20deutsch" },
  { label: "TikTok: Pokemon Rip & Ship DE", url: "https://www.tiktok.com/search/user?q=pokemon%20rip%20and%20ship%20deutsch" },
  { label: "TikTok: Pokemon Sammlung auflösen", url: "https://www.tiktok.com/search/user?q=pokemon%20sammlung%20verkaufen" },
];
function buyerSellerBarHtml(d) {
  const list = d.buyerSellerSearches?.length ? d.buyerSellerSearches : BUYER_SELLER_FALLBACK;
  const video = d.videoUrl || "https://pokeswipe-radar.de/creator#video";
  return `<div class="bg-gradient-to-r from-fuchsia-500/15 to-yellow-400/10 border border-fuchsia-400/40 rounded-2xl p-3 space-y-2 text-xs">
    <p class="font-black text-white text-sm">🎯 Kleine TikTok Käufer &amp; Verkäufer finden (500–15k Follower)</p>
    <div class="flex flex-wrap gap-1.5">${list.map((x) => `<a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener" class="bg-slate-950 border border-fuchsia-400/40 hover:border-yellow-300 text-white font-bold px-2.5 py-1.5 rounded-lg">${esc(x.label)} ↗</a>`).join("")}</div>
    <p class="text-[10px] text-slate-300">Profil gefunden? Oben unter „TikTok-Creator mit 1 Klick anlegen“ eintragen (Code NAME30 entsteht automatisch, Vorlage <strong>E – Launch-Offer</strong>) und dann „⚡ DM kopieren &amp; TikTok-Profil öffnen“. Video-Link in allen Vorlagen:
      <a href="${esc(safeUrl(video))}" target="_blank" rel="noopener" class="underline text-yellow-300">${esc(video.replace(/^https?:\/\//, ""))}</a>
      ${ca.video === undefined ? "" : ca.video ? '<span class="text-emerald-300">· 🎬 MP4 hinterlegt</span>' : '<span class="text-amber-300">· interaktive Live-Vorschau aktiv (MP4 im Tab „🔥 Viral-Hooks &amp; Video“ veröffentlichen)</span>'}</p>
  </div>`;
}

// Große 1-Klick-Aktionen oben im Creator-Finder: Auto-Finder, Massenversand, Schnell-Import
function bigActionsHtml(d) {
  const ready = bulkReady(d).length;
  const open = finderOpen(d).length;
  const f = ca.finder, b = ca.bulk;
  const busy = Boolean(f || b || ca.turbo);
  const big = "w-full text-left font-black text-sm sm:text-base px-4 py-3.5 rounded-2xl shadow-lg disabled:opacity-60 disabled:cursor-not-allowed";
  const finderLabel = f
    ? `⏳ Suche läuft … ${Number(f.done)} geprüft · ${Number(f.found)} gefunden${f.remaining != null ? ` · ${Number(f.remaining)} offen` : ""}`
    : `🔍 E-Mails für alle Creator automatisch finden <span class="font-bold text-xs opacity-80">(${open} ohne E-Mail)</span>`;
  const bulkLabel = b
    ? `⏳ Sende … ${Number(b.sent)}/${Number(b.total)} versendet${b.failed ? ` · ${Number(b.failed)} Fehler` : ""}`
    : `🚀 Alle bereiten Creator jetzt auf einmal per Resend anschreiben <span class="font-bold text-xs opacity-80">(${ready} bereit)</span>`;
  const turboLabel = ca.turbo
    ? (f ? `⏳ Schritt 1/2: E-Mails suchen … ${Number(f.done)} geprüft · ${Number(f.found)} gefunden` : b ? `⏳ Schritt 2/2: Launch-Mail … ${Number(b.sent)}/${Number(b.total)} versendet` : "⏳ Starte …")
    : `🔍 E-Mails automatisch suchen &amp; alle offenen Creator per Resend anschreiben <span class="font-bold text-xs opacity-80">(${open} ohne E-Mail · ${ready} bereit)</span>`;
  return `<div class="space-y-2">
    ${sammlerBatchHtml(d, ready, busy)}
    <button type="button" onclick="PS.caTurbo()" ${busy || (!open && !ready) || !d.sending.configured ? "disabled" : ""} class="${big} bg-gradient-to-r from-fuchsia-500 via-pink-500 to-yellow-400 text-slate-950 ring-4 ring-fuchsia-300/60">${turboLabel}
      <span class="block text-[10px] font-bold opacity-80 mt-0.5">${d.sending.configured ? "1. Auto-Finder (Impressum · Linktree · Beacons · Website · MX-Prüfung) → 2. Launch-Mail (Vorlage E) inkl. Video-Link pokeswipe-radar.de/creator#video &amp; eigenem Code an alle noch nicht angeschriebenen Creator mit gültiger E-Mail" : "Resend nicht eingerichtet (RESEND_API_KEY / MAIL_FROM)"}</span></button>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
      <button type="button" onclick="PS.caAutoFind()" ${busy || (!open && !f) ? "disabled" : ""} class="${big} bg-gradient-to-r from-cyan-500 to-sky-500 text-slate-950 ring-2 ring-cyan-300/50">${finderLabel}
        <span class="block text-[10px] font-bold opacity-80 mt-0.5">Impressum · Linktree · Beacons · Website · Web-Suche – nur echte, MX-geprüfte Adressen</span></button>
      <button type="button" onclick="PS.caBulkSend()" ${busy || !ready || !d.sending.configured ? "disabled" : ""} class="${big} bg-gradient-to-r from-emerald-400 to-lime-400 text-slate-950 ring-4 ring-emerald-300/60">${bulkLabel}
        <span class="block text-[10px] font-bold opacity-80 mt-0.5">${d.sending.configured ? "Persönliche Mail inkl. eigenem 30-Tage-Code & Link pokeswipe-radar.de/creator · nie doppelt" : "Resend nicht eingerichtet (RESEND_API_KEY / MAIL_FROM)"}</span></button>
    </div>
    ${ca.lastSummary ? `<div class="bg-emerald-500/10 border border-emerald-400/40 rounded-xl p-2 text-xs text-emerald-100 whitespace-pre-line">${esc(ca.lastSummary)}</div>` : ""}
    <details class="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-xs">
      <summary class="cursor-pointer font-black text-white">📋 Mehrere Creator / E-Mails auf einmal einfügen</summary>
      <textarea id="ca-import" rows="5" class="${inputCls} mt-2 font-mono" placeholder="Dario - business@beispiel.de&#10;ZockerEule: kontakt@beispiel.de&#10;info@kanal-beispiel.de"></textarea>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-1.5">
        <select id="ca-import-platform" class="${inputCls}">${d.platforms.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("")}</select>
        <select id="ca-import-category" class="${inputCls}">${d.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("")}</select>
        ${btn("➕ Alle anlegen inkl. Promo-Code", "PS.caImport()", "col-span-2 sm:col-span-1 bg-purple-600 text-white")}
      </div>
      <p class="text-[10px] text-slate-400 mt-1">Eine Zeile pro Creator: „Name - email@domain.de“ (auch „Name: …“, „Name &lt;…&gt;“, CSV) oder nur Adressen – dann wird der Name aus der Adresse abgeleitet. Jede Adresse wird per MX-Eintrag geprüft, Dubletten und abgemeldete Adressen werden übersprungen.</p>
    </details>
  </div>`;
}

// „📧 Mails an alle noch nicht kontaktierten Creator senden“ + „+ Neuen Creator & E-Mail hinzufügen“ + Live-Versand-Protokoll
function sammlerBatchHtml(d, ready, busy) {
  const s = d.sending, b = ca.bulk;
  const withMail = d.leads.filter((l) => !l.placeholder && EMAIL_OK.test(String(l.email || ""))).length;
  const dmOnly = d.leads.filter((l) => !l.placeholder && l.dmOnly).length;
  const label = b && b.sammler
    ? `⏳ Sende … ${Number(b.sent)}/${Number(b.total)} versendet${b.failed ? ` · ${Number(b.failed)} Fehler` : ""}${b.skipped ? ` · ${Number(b.skipped)} übersprungen` : ""}`
    : `📧 Alle offenen Creator-Mails jetzt echt absenden <span class="font-bold text-xs opacity-80">(${ready} offen)</span>`;
  const cfg = s.configured
    ? `✓ Resend aktiv${s.senderOnDomain ? " · Absender @pokeswipe-radar.de" : " · ⚠ Absender nicht auf pokeswipe-radar.de"}${s.replyTo ? " · Antwort-Adresse gesetzt" : " · ⚠ keine Antwort-Adresse (ADMIN_EMAILS)"}`
    : "✗ Resend nicht eingerichtet (RESEND_API_KEY / MAIL_FROM)";
  return `<div class="bg-gradient-to-br from-emerald-500/15 to-sky-500/10 border border-emerald-400/40 rounded-2xl p-3 space-y-2 text-xs">
    <button type="button" onclick="PS.caSammlerBatch()" ${busy || !ready || !s.configured ? "disabled" : ""} class="w-full text-left font-black text-sm sm:text-base px-4 py-3.5 rounded-2xl shadow-lg disabled:opacity-60 disabled:cursor-not-allowed bg-gradient-to-r from-emerald-300 to-sky-300 text-slate-950 ring-4 ring-emerald-300/60">${label}
      <span class="block text-[10px] font-bold opacity-80 mt-0.5">Persönliche Sammler-Mail: 60 Tage Pro + eigener VIP-Creator-Code gratis · Link pokeswipe-radar.de/?src=creator · jeder Creator nur einmal · 500–800 ms Pause</span></button>
    <p class="text-[10px] ${s.configured ? "text-emerald-200" : "text-rose-300"}">${esc(cfg)} · ${withMail} Creator mit E-Mail · ${dmOnly} nur TikTok-DM (keine E-Mail)</p>
    <div class="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
      <input id="ca-q-name" placeholder="Name / @handle *" class="${inputCls} col-span-2 sm:col-span-2" onkeydown="if(event.key==='Enter')PS.caQuickAdd()" />
      <input id="ca-q-email" type="email" placeholder="E-Mail (optional)" class="${inputCls} col-span-2 sm:col-span-2" onkeydown="if(event.key==='Enter')PS.caQuickAdd()" />
      <select id="ca-q-platform" class="${inputCls}">${d.platforms.map((p) => `<option value="${esc(p.id)}" ${p.id === "tiktok" ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
      ${btn("+ Neuen Creator & E-Mail hinzufügen", "PS.caQuickAdd()", "bg-emerald-500 text-slate-950 text-[11px]")}
    </div>
    ${sendLogHtml()}
    ${dmQuickListHtml(d)}
  </div>`;
}

// Schnell-Liste: kopierfertige TikTok-DM-Texte für alle Creator ohne E-Mail (noch nicht per DM angeschrieben zuerst)
function dmQuickListHtml(d) {
  const list = d.leads.filter((l) => !l.placeholder && !EMAIL_OK.test(String(l.email || "")) && l.dm && !["optout", "active", "replied"].includes(l.status))
    .sort((a, b) => (a.status === "dm_sent") - (b.status === "dm_sent"));
  if (!list.length) return "";
  const open = list.filter((l) => l.status !== "dm_sent").length;
  return `<details class="bg-slate-950/70 border border-cyan-500/40 rounded-xl p-2">
    <summary class="cursor-pointer font-black text-white">💬 TikTok-DM-Schnell-Liste (${list.length} ohne E-Mail · ${open} noch nicht per DM angeschrieben)</summary>
    <div class="mt-2 flex flex-wrap gap-1.5">${btn("📋 Alle DM-Texte kopieren", "PS.caCopyAllDms()", "bg-cyan-500 text-slate-950 text-[11px] font-black")}</div>
    <ul class="mt-2 space-y-1.5">${list.map((l) => `<li class="border-t border-slate-800 pt-1.5">
      <div class="flex flex-wrap items-center gap-1.5"><strong class="text-white">${esc(l.name)}</strong>${l.status === "dm_sent" ? '<span class="text-[10px] text-emerald-300">📩 DM gesendet</span>' : ""}
        ${btn("📋 DM kopieren", `PS.caCopyDm(${Number(l.id)})`, "bg-slate-800 text-white text-[10px]")}
        ${l.platform === "tiktok" && l.tiktokUrl ? btn("⚡ Kopieren & Profil öffnen", `PS.caTurboDm(${Number(l.id)})`, "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-slate-950 text-[10px] font-black") : ""}</div>
      <p class="text-[10px] text-slate-300 mt-0.5 whitespace-pre-wrap select-text">${esc(l.dm)}</p></li>`).join("")}</ul>
  </details>`;
}

function sendLogHtml() {
  const live = ca.sendLog;
  const hist = ca.history;
  const rowsOf = (list) => list.map((r) => `<tr class="border-t border-slate-800">
      <td class="py-1 pr-2 align-top"><span class="text-white font-bold">${esc(r.name || "")}</span><br><span class="text-slate-400 break-all">${esc(r.email || "")}</span></td>
      <td class="py-1 pr-2 align-top whitespace-nowrap">${r.ok ? `<span class="text-emerald-300 font-black">✅ Gesendet</span><br><span class="text-slate-400">${esc(fmt(r.at))}</span>` : r.skip ? '<span class="text-slate-300 font-bold">⏭ übersprungen</span>' : r.pending ? '<span class="text-violet-300 font-bold">⏳ sendet …</span>' : '<span class="text-rose-300 font-black">❌ Fehler</span>'}</td>
      <td class="py-1 pr-2 align-top font-mono text-[10px] ${r.ok && r.resendId ? "text-emerald-300 font-bold" : "text-slate-300"} break-all">${esc(r.resendId || "–")}</td>
      <td class="py-1 align-top text-[10px] ${r.ok ? "text-slate-500" : "text-rose-200"}">${esc(r.error || "")}</td></tr>`).join("");
  const table = (list) => `<div class="overflow-x-auto"><table class="w-full text-[11px] text-left"><thead><tr class="text-[10px] uppercase text-slate-400"><th class="pr-2">Empfänger</th><th class="pr-2">Status</th><th class="pr-2">Resend-ID</th><th>Fehlermeldung</th></tr></thead><tbody>${rowsOf(list)}</tbody></table></div>`;
  return `<details class="bg-slate-950/70 border border-slate-800 rounded-xl p-2" ${live.length ? "open" : ""}>
    <summary class="cursor-pointer font-black text-white">📜 Live-Versand-Protokoll${live.length ? ` (${live.length})` : ""}</summary>
    ${live.length ? table(live) : '<p class="text-[10px] text-slate-400 mt-1">Noch kein Versand in dieser Sitzung.</p>'}
    <div class="mt-2">${btn(hist ? "↻ Gespeichertes Protokoll neu laden" : "📂 Gespeichertes Protokoll laden (alle bisherigen Mails)", "PS.caLoadLog()", "bg-slate-800 text-white text-[11px]")}</div>
    ${hist ? (hist.length ? table(hist) : '<p class="text-[10px] text-slate-400 mt-1">Bisher keine Mails versendet.</p>') : ""}
  </details>`;
}

// Schnellsuche: aktive deutsche TikTok-Creator (1k–15k) + 1-Klick-Anlage mit optionalem Linktree/Bio-Link
const TIKTOK_SEARCHES_FALLBACK = [
  { label: "TikTok: Pokemon Karten öffnen", url: "https://www.tiktok.com/search/user?q=pokemon%20karten%20oeffnen" },
  { label: "TikTok: Pokemon Pulls deutsch", url: "https://www.tiktok.com/search/user?q=pokemon%20pulls%20deutsch" },
  { label: "TikTok: Pokemon Flohmarkt", url: "https://www.tiktok.com/search/user?q=pokemon%20flohmarkt" },
  { label: "TikTok: Pokemon Masterset", url: "https://www.tiktok.com/search/user?q=pokemon%20masterset" },
];
function tiktokFinderHtml(d) {
  const searches = d.tiktokSearches?.length ? d.tiktokSearches : TIKTOK_SEARCHES_FALLBACK;
  return `<div class="bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10 border border-cyan-400/30 rounded-2xl p-3 space-y-2 text-xs">
    <p class="font-black text-white">🎯 Aktive deutsche TikTok-Creator (1k–15k Follower) finden</p>
    <div class="flex flex-wrap gap-1.5">${searches.map((x) => `<a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener" class="bg-slate-950 border border-slate-700 hover:border-cyan-400 text-white font-bold px-2.5 py-1.5 rounded-lg">${esc(x.label)} ↗</a>`).join("")}</div>
    <div class="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
      <input id="ca-tt-name" placeholder="TikTok-Name oder @handle *" class="${inputCls} sm:col-span-2" onkeydown="if(event.key==='Enter')PS.caQuickTikTok()" />
      <input id="ca-tt-bio" placeholder="Linktree / Beacons / Website aus der Bio (optional)" class="${inputCls} sm:col-span-2" onkeydown="if(event.key==='Enter')PS.caQuickTikTok()" />
      ${btn("+ TikTok-Creator mit 1 Klick anlegen", "PS.caQuickTikTok()", "bg-cyan-500 text-slate-950")}
    </div>
    <p class="text-[10px] text-slate-400">Promo-Code (z. B. NAME30) wird automatisch erzeugt. Mit Bio-Link sucht der Extraktor sofort nach einer öffentlichen E-Mail und übernimmt sie ins Kontakt-Feld – sonst „📋 DM kopieren“ nutzen.</p>
  </div>`;
}

function leadCard(l, d) {
  const open = ca.open.has(l.id);
  const sel = ca.selected.has(l.id);
  const scoreCls = l.score >= 70 ? "bg-emerald-500" : l.score >= 45 ? "bg-yellow-400" : "bg-rose-500";
  const hasMail = EMAIL_OK.test(String(l.email || ""));
  const canSend = ["ready", "paused", "queued"].includes(l.status) && hasMail && !l.placeholder;
  const followDue = l.display.key === "followup";
  return `<div class="bg-slate-900 border ${l.placeholder ? "border-dashed border-slate-700" : sel ? "border-violet-400" : "border-slate-800"} rounded-2xl p-3 space-y-2 text-xs">
    <div class="flex items-start gap-2">
      <input type="checkbox" ${sel ? "checked" : ""} ${l.placeholder ? "disabled" : ""} onchange="PS.caSelect(${Number(l.id)}, this.checked)" class="mt-1 accent-violet-400" aria-label="Auswählen" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5">
          <strong class="text-white text-sm">${esc(l.name)}</strong>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300">${esc(l.platformLabel)}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300">${esc(l.categoryLabel)}</span>
          <span class="text-[10px] font-black px-1.5 py-0.5 rounded-full ${STATUS_CLS[l.display.key] || STATUS_CLS.ready}">${esc(l.display.label)}${l.status === "sent" && l.sentAt ? ` am ${esc(fmt(l.sentAt))}` : ""}${l.status === "queued" && l.scheduledAt ? ` · ${esc(fmt(l.scheduledAt))}` : ""}</span>
        </div>
        <div class="flex items-center gap-2 mt-1"><span class="text-[10px] text-slate-400">${esc(l.tierLabel)}${l.followers ? ` · ${Number(l.followers).toLocaleString("de-DE")} Follower` : ""}</span>
          <span class="inline-flex items-center gap-1 text-[10px] text-slate-300" title="Antwort-Wahrscheinlichkeit"><span class="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden inline-block"><span class="block h-full ${scoreCls}" style="width:${Number(l.score)}%"></span></span>${Number(l.score)} %</span></div>
        ${l.promoCode ? `<p class="mt-1"><span class="font-mono font-black text-yellow-300">${esc(l.promoCode)}</span> <span class="text-slate-400">· ${Number(l.signups) || 0} Anmeldungen über den Code</span>${l.promoActive === false ? ' <span class="text-amber-300">(Code inaktiv)</span>' : ""} <button type="button" onclick="PS.caCopy(${jsArg(l.link)}, 'Link kopiert')" class="text-[10px] underline text-slate-300">Link kopieren</button></p>` : `<p class="mt-1 text-slate-500">Promo-Code entsteht, sobald der Platzhalter einen echten Namen bekommt.</p>`}
        ${l.email && l.emailSource ? `<p class="text-[10px] mt-0.5 ${l.emailVerifiedAt ? "text-emerald-300" : "text-amber-300"}">${l.emailVerifiedAt ? "✓" : "⚠"} ${esc(l.emailSource)}</p>` : ""}
        ${!l.email && l.emailSearchNote ? `<p class="text-[10px] text-slate-400 mt-0.5">🔍 Auto-Finder${l.emailSearchedAt ? ` (${esc(fmt(l.emailSearchedAt))})` : ""}: ${esc(l.emailSearchNote)}</p>` : ""}
        ${l.sentAt && l.resendId ? `<p class="text-[10px] text-emerald-300 mt-0.5">✅ Gesendet · ${esc(fmt(l.sentAt))} · Resend-ID <span class="font-mono">${esc(l.resendId)}</span></p>` : ""}
        ${l.dmOnly && !l.placeholder ? '<p class="text-[10px] text-cyan-300 mt-0.5">💬 Nur TikTok-DM (keine E-Mail)</p>' : ""}
        ${l.lastError ? `<p class="text-rose-300 text-[10px]">⚠ ${esc(l.lastError)}</p>` : ""}
      </div>
      <button type="button" onclick="PS.caToggle(${Number(l.id)})" class="text-slate-300 font-bold text-[11px] shrink-0">${open ? "▲ zu" : "▼ öffnen"}</button>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <a href="${esc(safeUrl(l.research.youtubeAbout))}" target="_blank" rel="noopener" class="bg-rose-600/80 text-white font-bold px-2 py-1 rounded-lg">▶ YouTube Kanalinfo / Impressum öffnen</a>
      <a href="${esc(safeUrl(l.research.tiktok))}" target="_blank" rel="noopener" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg">TikTok suchen</a>
      <a href="${esc(safeUrl(l.research.instagram))}" target="_blank" rel="noopener" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg">Instagram suchen</a>
      <a href="${esc(safeUrl(l.research.google))}" target="_blank" rel="noopener" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg">Impressum googeln</a>
      ${safeUrl(l.channelUrl, { http: true }) ? `<a href="${esc(safeUrl(l.channelUrl, { http: true }))}" target="_blank" rel="noopener" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg">Kanal ↗</a>` : ""}
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      <div class="flex gap-1"><input id="ca-email-${Number(l.id)}" type="email" value="${esc(l.email)}" placeholder="Kontakt-E-Mail" class="${inputCls}" />${btn("✓", `PS.caSaveEmail(${Number(l.id)})`, "bg-emerald-500 text-slate-950 px-3")}</div>
      <div class="flex gap-1"><input id="ca-extract-${Number(l.id)}" value="${esc(l.bioLink || "")}" placeholder="Linktree / Beacons / Instagram / Website / Impressum-URL" class="${inputCls}" />${btn("🔎 Extrahieren", `PS.caExtract(${Number(l.id)})`, "bg-cyan-600 text-white px-2 shrink-0")}</div>
    </div>
    ${(l.socials || []).length ? `<p class="text-[10px] text-slate-400 break-all">Gefunden: ${(l.socials || []).filter((s) => safeUrl(s, { http: true })).map((s) => `<a href="${esc(safeUrl(s, { http: true }))}" target="_blank" rel="noopener" class="underline text-slate-300">${esc(String(s).replace(/^https?:\/\/(www\.)?/, ""))}</a>`).join(" · ")}</p>` : ""}
    <div class="flex flex-wrap gap-1.5">
      ${canSend ? btn(l.status === "queued" ? "Jetzt statt geplant über Resend senden" : "✅ Freigeben & über Resend senden", `PS.caSend(${Number(l.id)})`, "bg-emerald-500 text-slate-950 font-black ring-2 ring-emerald-300/60") : ""}
      ${followDue ? btn("🔁 Follow-up senden", `PS.caFollowup(${Number(l.id)})`, "bg-amber-400 text-slate-950") : ""}
      ${l.platform === "tiktok" && l.tiktokUrl ? btn("⚡ DM kopieren & TikTok-Profil öffnen", `PS.caTurboDm(${Number(l.id)})`, "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-slate-950 font-black ring-2 ring-cyan-300/60") : ""}
      ${l.platform === "tiktok" ? btn("💬 Video-Kommentar kopieren", `PS.caCopyComment(${Number(l.id)})`, "bg-slate-800 text-white text-[11px]") : ""}
      ${btn("📋 DM kopieren", `PS.caCopyDm(${Number(l.id)})`, hasMail || l.platform === "tiktok" ? "bg-slate-800 text-white" : "bg-cyan-500 text-slate-950 font-black")}
      <select onchange="PS.caStatus(${Number(l.id)}, this.value)" class="bg-slate-800 text-white rounded-xl px-2 text-[11px] font-bold">
        <option value="">Status setzen …</option>
        ${[["dm_sent", "📩 DM gesendet"], ["replied", "💬 Antwort erhalten"], ["active", "🎬 Aktiv (macht mit)"], ["paused", "⏸ Pausieren"], ["ready", "↺ Zurück auf Bereit"], ["optout", "🚫 Abgemeldet / kein Interesse"]].map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}
      </select>
      ${["replied", "active"].includes(l.status) ? btn("🎟️ VIP-Creator-Pass vergeben", `PS.caGrantPass(${Number(l.id)})`, "bg-fuchsia-600 text-white") : ""}
    </div>
    ${open ? leadDetails(l, d) : ""}
  </div>`;
}

function leadDetails(l, d) {
  return `<div class="border-t border-slate-800 pt-2 space-y-1.5">
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
      <input id="ca-name-${Number(l.id)}" value="${esc(l.name)}" class="${inputCls} col-span-2" placeholder="Kanalname" />
      <input id="ca-followers-${Number(l.id)}" type="number" min="0" value="${Number(l.followers) || ""}" class="${inputCls}" placeholder="Follower" />
      <select id="ca-cat-${Number(l.id)}" class="${inputCls}">${d.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === l.category ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
      <select id="ca-plat-${Number(l.id)}" class="${inputCls}">${d.platforms.map((p) => `<option value="${esc(p.id)}" ${p.id === l.platform ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
      <input id="ca-url-${Number(l.id)}" value="${esc(l.channelUrl)}" class="${inputCls} col-span-3" placeholder="Kanal-Link (für den Kanalinfo-Button)" />
      <textarea id="ca-notes-${Number(l.id)}" rows="2" class="${inputCls} col-span-2 sm:col-span-4" placeholder="Notizen">${esc(l.notes)}</textarea>
    </div>
    ${btn("Stammdaten speichern", `PS.caSaveMeta(${Number(l.id)})`, "bg-slate-700 text-white")}
    <div class="flex flex-wrap items-center gap-1.5 pt-1"><span class="font-black text-white">✉️ Vorlage</span>
      ${d.templates.map((t) => `<button type="button" onclick="PS.caTemplate(${Number(l.id)}, ${jsArg(t.id)})" title="${esc(t.label)}" class="text-[11px] font-black px-2 py-1 rounded-lg ${l.template === t.id ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-200"}">${esc(t.label)}</button>`).join("")}
    </div>
    <input id="ca-subj-${Number(l.id)}" value="${esc(l.subject)}" class="${inputCls}" />
    <textarea id="ca-body-${Number(l.id)}" rows="12" class="${inputCls} font-mono leading-relaxed">${esc(l.body)}</textarea>
    <p class="text-[10px] text-slate-500">Beim Versand wird automatisch die Fußzeile mit Impressum und Abmelde-Link angehängt.${l.customBody ? " · Eigener Text (wird bei Vorlagen-Wechsel nicht überschrieben)." : ""}</p>
    <div class="flex flex-wrap gap-1.5">
      ${btn("Text speichern", `PS.caSaveMail(${Number(l.id)})`, "bg-emerald-500 text-slate-950")}
      ${l.customBody ? btn("↺ Vorlage wiederherstellen", `PS.caResetMail(${Number(l.id)})`, "bg-slate-800 text-white") : ""}
      ${btn("🗑 Eintrag löschen", `PS.caDelete(${Number(l.id)})`, "bg-rose-500/30 text-rose-200")}
    </div>
    <p class="text-[10px] text-slate-500">Kurz-DM: <span class="text-slate-300">${esc(l.dm)}</span></p>
    ${l.comment ? `<p class="text-[10px] text-slate-500">Kommentar-Hook (wenn DMs erst nach gegenseitigem Folgen offen sind): <span class="text-slate-300">${esc(l.comment)}</span></p>` : ""}
  </div>`;
}

// ---------------------------------------------------------------------------
// Bewerbungen von /creator
// ---------------------------------------------------------------------------
function appsHtml(d) {
  const list = d.applications;
  return `<p class="text-xs text-slate-300">Bewerbungen über <a href="/creator" target="_blank" class="underline text-yellow-300">pokeswipe-radar.de/creator</a>. Der Wunsch-Code liegt als <strong>Entwurf</strong> (inaktiv) bereit; „Freigeben“ aktiviert ihn, legt den Creator an, vergibt den VIP-Creator-Pass (sofern ein Konto mit der E-Mail existiert) und schickt die Zugangsdaten per E-Mail.</p>
    <div class="space-y-2">${list.length ? list.map((a) => `<div class="bg-slate-900 border ${a.status === "new" ? "border-yellow-400/40" : "border-slate-800"} rounded-2xl p-3 text-xs space-y-1">
      <div class="flex flex-wrap items-center gap-1.5"><strong class="text-white text-sm">${esc(a.channelName)}</strong><span class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300">${esc(a.platformLabel)}</span>
        <span class="text-[10px] text-slate-400">${Number(a.followers).toLocaleString("de-DE")} Follower · ${esc(fmt(a.createdAt))}</span>
        <span class="text-[10px] font-black px-1.5 py-0.5 rounded-full ${a.status === "new" ? "bg-yellow-400/25 text-yellow-200" : a.status === "approved" ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-700 text-slate-300"}">${a.status === "new" ? "Neu" : a.status === "approved" ? "Freigegeben" : "Abgelehnt"}</span></div>
      <p><a href="${esc(safeUrl(a.channelUrl, { http: true }) || "#")}" target="_blank" rel="noopener" class="underline text-slate-300 break-all">${esc(a.channelUrl)}</a> · <span class="text-slate-300">${esc(a.email)}</span></p>
      <p>Code-Entwurf: <span class="font-mono font-black text-yellow-300">${esc(a.promoCode || a.wishCode || "–")}</span></p>
      ${a.message ? `<p class="text-slate-300 bg-slate-950 rounded-lg p-2" data-i18n-skip>${esc(a.message)}</p>` : ""}
      ${a.status === "new" ? `<div class="flex gap-1.5">${btn("✅ Freigeben & Code aktivieren", `PS.caApp(${Number(a.id)}, 'approve')`, "bg-emerald-500 text-slate-950")}${btn("Ablehnen", `PS.caApp(${Number(a.id)}, 'reject')`, "bg-slate-800 text-slate-300")}</div>` : ""}
    </div>`).join("") : `<p class="text-xs text-slate-500">Noch keine Bewerbungen – teile die Seite <strong>/creator</strong> in deinen Anschreiben.</p>`}</div>`;
}

// ---------------------------------------------------------------------------
// Viral-Hook- & Kommentar-Generator (authentisch, ohne Links, nichts automatisch posten)
// ---------------------------------------------------------------------------
const HOOK_TYPES = { restock: "Restock / neue Sets", opening: "Pack-Opening", flohmarkt: "Flohmarkt / Cardshow", value: "„Was ist die Karte wert?“" };
const COMMENTS = {
  restock: [
    "Endlich mal jemand, der sagt, wo es [Thema] wirklich gab 🙏 Ich hab mir für den nächsten Drop einen Restock-Alarm gestellt, beim letzten Mal war's nach 20 Minuten weg.",
    "Danke für die Info! Weiß jemand, ob [Thema] auch online nochmal kommt oder nur im Laden? Bei mir war um 8 Uhr schon alles leer.",
    "Wichtigster Tipp aus dem Video: nicht über UVP kaufen. Bei [Thema] fällt der Preis nach ein paar Wochen fast immer wieder.",
    "Wie viele Displays waren bei euch im Laden? Bei uns gab's [Thema] nur 2 pro Person – fair, aber hart 😅",
    "Mega hilfreich! Ich tracke die Preise von [Thema] seit Release – Displays sind gerade schon leicht über UVP.",
  ],
  opening: [
    "Der Pull bei [Thema] 😳 Hab direkt nachgeschaut – die Karte liegt gerade echt gut im Kurs. Glückwunsch!",
    "Bei Minute 3 hab ich laut gelacht 😂 Welche Karte aus [Thema] ist für dich der Chase?",
    "Endlich ein Opening ohne Fake-Reaktionen. Was machst du mit den Dubletten – tauschen oder verkaufen?",
    "Wie viele Packs hast du insgesamt für [Thema] geöffnet? Ich komme bei der Pull-Rate auf ganz andere Werte.",
    "Sleeve den Hit bitte sofort 😅 Die Zentrierung sah richtig gut aus – vielleicht sogar was für PSA?",
  ],
  flohmarkt: [
    "Der Deal bei [Thema] war krass – ich hätte vermutlich nicht so schnell zugeschlagen. Wie checkst du die Preise am Stand?",
    "Flohmarkt-Videos sind einfach die besten 🙌 Wie viel hast du am Ende für alles bezahlt vs. Marktwert?",
    "Tipp aus eigener Erfahrung: Bei Binder-Käufen am Stand immer erst Zustand prüfen, sonst ist die Marge schnell weg.",
    "Welche Stadt war das? Bei uns gibt's leider kaum noch Pokémon auf Flohmärkten.",
    "Respekt fürs faire Verhandeln! Viele würden den Verkäufer da über den Tisch ziehen.",
  ],
  value: [
    "Kurzer Preis-Check zu [Thema]: Cardmarket-Trend schwankt gerade stark – lohnt sich, den Zustand genau anzuschauen.",
    "Wichtig: Bei [Thema] macht die Variante (Reverse/Holo) preislich einen riesigen Unterschied!",
    "Ich würde [Thema] aktuell eher behalten – die Karte hat sich die letzten Monate stabil gehalten.",
    "Grading lohnt sich bei [Thema] nur, wenn Ecken und Zentrierung top sind – sonst frisst die Gebühr den Gewinn.",
  ],
};
const HOOKS = {
  restock: ["Dieser Restock war nach 7 Minuten weg – so warst du diesmal schneller 👇", "Hör auf, [Thema] über UVP zu kaufen. Hier ist der Grund.", "3 Shops, 1 Display, 0 Scalper – mein Restock-Morgen für [Thema]"],
  opening: ["Ich scanne jeden Pull live – und der dritte Pack hat mich umgehauen", "Was sind diese [Thema]-Packs WIRKLICH wert? Ich rechne live mit.", "POV: Du ziehst den Chase und der Scanner zeigt dir sofort den Preis"],
  flohmarkt: ["2 € auf dem Flohmarkt – der Scanner sagt etwas ganz anderes 😳", "Ich habe einen kompletten Binder gekauft. Lohnt sich das nach Gebühren?", "So checke ich auf Cardshows in 3 Sekunden, ob ein Deal gut ist"],
  value: ["Diese Karte liegt bei vielen in der Schublade – und ist mehr wert als gedacht", "Rip or Keep? Ich zeige dir den echten Marktwert", "Lohnt sich PSA für [Thema]? Ehrliche Rechnung"],
};
function hooksHtml() {
  const t = ca.hook.type;
  const topic = ca.hook.topic || "das neue Set";
  const fill = (s) => s.replace(/\[Thema\]/g, topic);
  const list = (arr, key) => arr.map((c, i) => `<div class="flex gap-2 items-start bg-slate-900 border border-slate-800 rounded-xl p-2"><p class="flex-1 text-slate-200" data-i18n-skip>${esc(fill(c))}</p><button type="button" onclick="PS.caCopyHook(${jsArg(key)}, ${i})" class="text-[10px] font-bold bg-slate-800 text-white rounded-lg px-2 py-1 shrink-0">📋</button></div>`).join("");
  return `<div class="space-y-2 text-xs">
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
      <select id="ca-hook-type" onchange="PS.caHookType(this.value)" class="${inputCls}">${Object.entries(HOOK_TYPES).map(([k, l]) => `<option value="${k}" ${k === t ? "selected" : ""}>${l}</option>`).join("")}</select>
      <input id="ca-hook-topic" value="${esc(ca.hook.topic)}" placeholder="Set / Karte, z. B. Prismatische Entwicklungen" class="${inputCls} sm:col-span-2" onchange="PS.caHookTopic(this.value)" />
    </div>
    <p class="font-black text-white">💬 Kommentar-Ideen (unter aktuellen Videos – keine Links, nicht kopieren & spammen)</p>
    ${list(COMMENTS[t] || [], "c")}
    <p class="font-black text-white pt-1">🎣 Hooks für eigene Reels / Shorts (erste 2 Sekunden)</p>
    ${list(HOOKS[t] || [], "h")}
    <ul class="list-disc pl-4 text-[11px] text-slate-400 space-y-0.5">
      <li>Nur kommentieren, wenn du das Video wirklich gesehen hast – auf einen konkreten Moment eingehen.</li>
      <li>Keine Links (wirkt wie Spam und wird oft automatisch ausgeblendet). Höchstens 1 Kommentar pro Kanal & Woche.</li>
      <li>Erst Mehrwert (Preis-Info, Tipp, Frage) – die App höchstens beiläufig erwähnen, wenn jemand fragt.</li>
    </ul>
    ${videoBoxHtml()}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
      ${btn("🎬 Pro-Video-Generator öffnen", "PS.openGenerator()", "bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white")}
      ${btn("🎥 Make.com & Auto-Reels", "PS.openMakeAdmin()", "bg-slate-800 text-white")}
    </div>
  </div>`;
}

// Showcase-Video (Set-Binder + 1-Klick-Inserieren) für /creator#video
function videoBoxHtml() {
  const v = ca.video, up = ca.videoUpload;
  const state = v === undefined ? "⏳ Lade Status …"
    : v ? `✅ Veröffentlicht am ${esc(fmt(v.uploadedAt))} · ${(Number(v.size) / 1048576).toFixed(1).replace(".", ",")} MB · ${esc(v.type)}${v.source ? ` · Quelle: ${esc(v.source)}` : ""}`
    : "Noch kein MP4 hinterlegt – /creator#video zeigt bis dahin die interaktive Live-Vorschau (Set-Binder blättern + 1-Klick-Inserieren).";
  return `<div class="bg-slate-950 border border-yellow-400/40 rounded-2xl p-3 space-y-2">
    <p class="font-black text-white">🎬 Showcase-Video für <a href="/creator#video" target="_blank" class="underline text-yellow-300">pokeswipe-radar.de/creator#video</a></p>
    <p class="text-[11px] ${v ? "text-emerald-300" : "text-slate-300"}">${state}</p>
    ${v ? `<video src="/api/creator/video?v=${esc(v.version)}" controls muted playsinline preload="metadata" class="w-40 rounded-xl border border-slate-700" style="aspect-ratio:9/16;object-fit:cover"></video>` : ""}
    <p class="text-[10px] text-slate-400">Am schnellsten: Im Pro-Video-Generator die Master-Vorlage „📒 Reel: Neuer automatischer Binder &amp; Bulk-Marktplatz-Power“ aufnehmen und beim fertigen Video auf „📌 Auf /creator#video veröffentlichen“ klicken. Alternativ hier eine MP4-Datei (max. 95 MB) hochladen.</p>
    <div class="flex flex-wrap items-center gap-1.5">
      <input id="ca-video-file" type="file" accept="video/mp4,video/webm" class="text-[11px] text-slate-300" ${up ? "disabled" : ""} />
      ${btn(up ? `⏳ Lade hoch … ${Math.round(up * 100)} %` : "📤 Hochladen & veröffentlichen", "PS.caVideoUpload()", "bg-yellow-400 text-slate-950 font-black")}
      ${v && !up ? btn("🗑 Video entfernen", "PS.caVideoDelete()", "bg-rose-500/30 text-rose-200") : ""}
    </div>
  </div>`;
}
async function loadVideoStatus() {
  try { const r = await creatorVideoStatus(); ca.video = r.video || null; } catch { ca.video = null; }
  render();
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------
const leadById = (id) => ca.data?.leads.find((l) => l.id === id);
function replaceLead(lead) {
  if (!lead || !ca.data) return;
  const i = ca.data.leads.findIndex((l) => l.id === lead.id);
  if (i >= 0) ca.data.leads[i] = lead; else ca.data.leads.unshift(lead);
}
async function patch(id, body, msg) {
  try {
    const r = await api(`/api/admin/creators/${id}`, { method: "PATCH", body });
    replaceLead(r.lead); render();
    if (msg) toast("✅", msg);
  } catch (e) { handleError(e); }
}
async function refreshAll() { try { await load(); render(); } catch (e) { handleError(e); } }
async function copy(text, msg = "In die Zwischenablage kopiert") {
  try { await navigator.clipboard.writeText(String(text || "")); toast("📋 Kopiert", msg); }
  catch { prompt("Zum Kopieren:", String(text || "")); }
}

/** Auto-Finder: ruft die Netlify-Funktion so lange auf, bis alle offenen Creator geprüft sind. */
async function runAutoFind() {
  if (ca.finder || ca.bulk) return;
  ca.finder = { done: 0, found: 0, remaining: finderOpen(ca.data).length, since: null, emails: [] };
  ca.lastSummary = ""; render();
  let rounds = 0, errors = 0;
  try {
    while (rounds++ < 80) {
      let r;
      try {
        r = await api("/.netlify/functions/auto-find-creator-emails", { method: "POST", body: { since: ca.finder.since } });
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        if (++errors > 3) throw e;
        await sleep(e.status === 429 ? 8000 : 2500); continue;
      }
      errors = 0;
      ca.finder.since = r.since;
      ca.finder.done += Number(r.processed) || 0;
      ca.finder.found += Number(r.found) || 0;
      ca.finder.remaining = Number(r.remaining) || 0;
      for (const x of r.results || []) if (x.email) ca.finder.emails.push(`${x.name}: ${x.email} (${x.source})`);
      render();
      if (!r.processed || !r.remaining) break;
    }
    const f = ca.finder;
    ca.lastSummary = f.found
      ? `✅ ${f.found} von ${f.done} Creator-E-Mails automatisch gefunden & MX-geprüft:\n${f.emails.join("\n")}`
      : `🔍 ${f.done} Creator geprüft – keine öffentliche Geschäfts-E-Mail gefunden. Tipp: Linktree/Website-Link beim Creator hinterlegen oder „📋 DM kopieren“.`;
    toast(f.found ? "✅ E-Mails gefunden" : "🔍 Suche beendet", f.found ? `${f.found} Adressen übernommen` : `${f.done} Creator geprüft`);
  } catch (e) { handleError(e); }
  finally { ca.finder = null; await refreshAll(); }
}

/** Massenversand: nacheinander (~500 ms Abstand) an alle bereiten Creator – der Server sperrt jeden Eintrag atomar (nie doppelt).
 *  `template` (z. B. „E“) = Launch-Vorlage für alle Creator ohne eigenen Text; `confirmed` = Rückfrage schon erfolgt (Turbo). */
async function runBulkSend({ template = "", confirmed = false, sammler = false } = {}) {
  if (ca.bulk || ca.finder) return;
  const d = ca.data;
  if (!d?.sending?.configured) return toast("Resend nicht eingerichtet", "RESEND_API_KEY / MAIL_FROM fehlen.");
  const list = bulkReady(d);
  if (!list.length) return toast("Massenversand", "Keine bereiten Creator mit E-Mail – zuerst „🔍 E-Mails automatisch finden“ oder Liste einfügen.");
  if (sammler && !confirmed && !confirm(`${list.length} persönliche Sammler-Mails jetzt über Resend senden?\n\nInhalt: kurze Vorstellung von PokeSwipe Radar, 60 Tage Pro + eigener VIP-Creator-Code gratis, Link pokeswipe-radar.de/?src=creator.\nJeder Creator wird nur einmal angeschrieben – bereits kontaktierte Creator werden übersprungen.`)) return;
  if (!sammler && !confirmed && !confirm(`${list.length} personalisierte Kooperations-Mails jetzt über Resend senden?\n\nJeder Creator bekommt seinen eigenen 30-Tage-Code und den Link pokeswipe-radar.de/creator. Bereits angeschriebene Creator werden nie erneut angeschrieben.`)) return;
  ca.bulk = { total: list.length, sent: 0, failed: 0, skipped: 0, errors: [], sammler };
  ca.lastSummary = ""; ca.sendLog = []; render();
  try {
    for (const l of list) {
      let tries = 0;
      const entry = { name: l.name, email: l.email, ok: false, pending: true, resendId: "", error: "", at: null };
      ca.sendLog.unshift(entry); render();
      while (true) {
        try {
          const r = await api(`/api/admin/creators/${l.id}/send`, { method: "POST", body: { bulk: true, ...(template ? { template } : {}), ...(sammler ? { sammler: true } : {}) } });
          ca.bulk.sent++;
          Object.assign(entry, { ok: true, pending: false, resendId: r?.resendId || "", at: r?.sentAt || new Date().toISOString() });
          const x = leadById(l.id);
          if (x) { x.status = "sent"; x.sentAt = entry.at; x.resendId = entry.resendId; x.display = { key: "sent", label: "E-Mail gesendet" }; }
          break;
        } catch (e) {
          if ((e.status === 429 || e.transient) && tries++ < 3) { await sleep(6000); continue; }
          if (e.status === 401 || e.status === 403) { Object.assign(entry, { pending: false, error: e.message }); throw e; }
          const skip = Boolean(e.data?.skip || /bereits gesendet|schon gesendet|abgemeldet/i.test(e.message));
          Object.assign(entry, { pending: false, skip, error: e.message });
          if (skip) ca.bulk.skipped++;
          else { ca.bulk.failed++; ca.bulk.errors.push(`${l.name}: ${e.message}`); }
          if (e.data?.stop) { ca.bulk.errors.push(`⛔ ${e.message}`); ca.bulk.stopped = true; }
          break;
        }
      }
      render();
      if (ca.bulk.stopped) break;
      await sleep(bulkGap(d.sending));
    }
    const b = ca.bulk;
    ca.lastSummary = `${b.sent ? `✅ ${b.sent} Kooperations-Mail${b.sent === 1 ? "" : "s"} erfolgreich über Resend versendet` : "⚠️ Keine Mail versendet"}${b.skipped ? ` · ${b.skipped} übersprungen` : ""}${b.failed ? ` · ${b.failed} fehlgeschlagen` : ""}${b.errors.length ? `\n${b.errors.slice(0, 8).join("\n")}` : ""}`;
    toast(b.sent ? "📤 Massenversand fertig" : "Massenversand", ca.lastSummary.split("\n")[0]);
  } catch (e) { handleError(e); }
  finally { ca.bulk = null; await refreshAll(); }
}

/** Turbo: erst alle Creator ohne E-Mail durchsuchen, danach die Launch-Mail (Vorlage E) an alle bereiten Creator senden. */
async function runTurbo() {
  if (ca.turbo || ca.finder || ca.bulk) return;
  const d = ca.data;
  if (!d?.sending?.configured) return toast("Resend nicht eingerichtet", "RESEND_API_KEY / MAIL_FROM fehlen.");
  const open = finderOpen(d).length;
  if (!confirm(`Turbo-Outreach starten?\n\n1. Auto-Finder prüft ${open} Creator ohne E-Mail (Impressum, Linktree, Beacons, Website + MX-Prüfung).\n2. Danach geht die Launch-Mail „${d.templates.find((t) => t.id === (d.launchTemplate || "E"))?.label || "E – Launch-Offer"}“ inkl. Video-Link & eigenem Promo-Code über Resend an alle Creator mit gültiger E-Mail, die noch nicht angeschrieben wurden.\n\nEigene, gespeicherte Texte bleiben erhalten. Abgemeldete oder schon angeschriebene Creator werden nie (erneut) angeschrieben.`)) return;
  ca.turbo = true; render();
  try {
    if (open) await runAutoFind();
    const findSummary = ca.lastSummary;
    if (!bulkReady(ca.data).length) {
      ca.lastSummary = `${findSummary ? `${findSummary}\n\n` : ""}📭 Keine bereiten Creator mit gültiger E-Mail – für reine TikTok-Accounts „⚡ DM kopieren & TikTok-Profil öffnen“ nutzen.`;
      toast("Turbo-Outreach", "Keine neuen E-Mail-Kontakte zum Anschreiben.");
      return;
    }
    await runBulkSend({ template: ca.data.launchTemplate || "E", confirmed: true });
    if (findSummary) ca.lastSummary = `${findSummary}\n\n${ca.lastSummary}`;
  } finally { ca.turbo = false; render(); }
}

export const creatorAdminApi = {
  openCreatorAdmin,
  caAutoFind: () => runAutoFind(),
  caBulkSend: () => runBulkSend(),
  caSammlerBatch: () => runBulkSend({ sammler: true }),
  async caLoadLog() {
    try { const r = await api("/api/admin/creators/outreach-log"); ca.history = r.log || []; render(); }
    catch (e) { handleError(e); }
  },
  /** „+ Neuen Creator & E-Mail hinzufügen“ – Name/@handle + optionale E-Mail, Promo-Code entsteht automatisch. */
  async caQuickAdd() {
    const name = $("ca-q-name")?.value.trim() || "";
    const email = $("ca-q-email")?.value.trim() || "";
    const platform = $("ca-q-platform")?.value || "tiktok";
    if (name.length < 2) return toast("Neuer Creator", "Bitte Namen oder @handle eingeben.");
    if (email && !EMAIL_OK.test(email)) return toast("Neuer Creator", "Diese E-Mail-Adresse ist ungültig.");
    const dup = ca.data?.leads.find((l) => l.name.replace(/^@/, "").toLowerCase() === name.replace(/^@/, "").toLowerCase() || (email && String(l.email).toLowerCase() === email.toLowerCase()));
    if (dup) return toast("Schon vorhanden", `${dup.name} steht bereits in der Liste.`);
    try {
      const r = await api("/api/admin/creators", { method: "POST", body: { name, email, platform, category: platform === "discord" ? "community" : "micro", quick: platform === "tiktok" } });
      if (r.lead) ca.data.leads.unshift(r.lead);
      toast("✅ Creator angelegt", `${r.lead?.name || name}${email ? ` · ${email}` : " · Nur DM (keine E-Mail)"}${r.lead?.promoCode ? ` · Code ${r.lead.promoCode}` : ""}`);
      render();
    } catch (e) { handleError(e); }
  },
  caTurbo: () => runTurbo(),
  /** ⚡ DM in die Zwischenablage, Status „DM gesendet“ und TikTok-Profil im neuen Tab – alles in einem Klick. */
  caTurboDm(id) {
    const l = leadById(id);
    if (!l) return;
    // Zwischenablage zuerst (solange dieses Fenster den Fokus hat), dann sofort den Tab öffnen (Popup-Blocker: noch im Klick)
    let copied = Promise.reject(new Error("no clipboard"));
    try { if (navigator.clipboard?.writeText) copied = navigator.clipboard.writeText(String(l.dm || "")); } catch {}
    window.open(l.tiktokUrl, "_blank", "noopener");
    copied.then(
      () => toast("⚡ DM kopiert", "TikTok-Profil ist offen: Nachricht → Einfügen → Senden."),
      () => prompt("DM zum Kopieren (TikTok-Profil ist im neuen Tab offen):", String(l.dm || "")),
    );
    if (["ready", "paused"].includes(l.status)) patch(id, { status: "dm_sent" });
  },
  caCopyComment: (id) => { const l = leadById(id); if (l) copy(l.comment, "Kommentar-Hook kopiert – unter einem aktuellen Video des Creators posten."); },
  async caVideoUpload() {
    const file = $("ca-video-file")?.files?.[0];
    if (!file) return toast("Showcase-Video", "Bitte zuerst eine MP4-Datei wählen.");
    if (ca.videoUpload) return;
    ca.videoUpload = 0.01; render();
    try {
      const r = await uploadCreatorVideo(file, { source: `Upload: ${file.name}`.slice(0, 80), onProgress: (p) => { ca.videoUpload = Math.max(0.01, p); render(); } });
      ca.video = r.video;
      toast("🎬 Video veröffentlicht", "Läuft jetzt auf pokeswipe-radar.de/creator#video.");
    } catch (e) { handleError(e); }
    finally { ca.videoUpload = null; render(); }
  },
  async caVideoDelete() {
    if (!confirm("Showcase-Video entfernen? /creator#video zeigt dann wieder die interaktive Live-Vorschau.")) return;
    try { await deleteCreatorVideo(); ca.video = null; render(); toast("🗑 Entfernt", "Live-Vorschau ist wieder aktiv."); } catch (e) { handleError(e); }
  },
  async caImport() {
    const text = $("ca-import")?.value || "";
    if (!text.trim()) return toast("Import", "Bitte Zeilen im Format „Name - email@domain.de“ oder E-Mail-Adressen einfügen.");
    try {
      const r = await api("/api/admin/creators/import", { method: "POST", body: { text, platform: $("ca-import-platform")?.value, category: $("ca-import-category")?.value } });
      ca.data.leads = r.leads; ca.filter = "all";
      ca.lastSummary = `📋 ${r.created.length} Creator angelegt/ergänzt${r.created.length ? `: ${r.created.map((x) => `${x.name} (${x.promoCode || "–"})`).join(", ")}` : ""}${r.skipped.length ? `\nÜbersprungen: ${r.skipped.map((x) => `${x.email} – ${x.reason}`).join("; ")}` : ""}${r.truncated ? "\nHinweis: höchstens 200 Einträge pro Import." : ""}`;
      render();
      const ta = $("ca-import"); if (ta && r.created.length) ta.value = "";
      toast("📋 Import fertig", `${r.created.length} angelegt · ${r.skipped.length} übersprungen – jetzt „🚀 Alle bereiten Creator anschreiben“.`);
    } catch (e) { handleError(e); }
  },
  caTab: (k) => { ca.tab = k; render(); if (k === "hooks") loadVideoStatus(); },
  caFilter: (k) => { ca.filter = k; render(); },
  caToggle: (id) => { ca.open.has(id) ? ca.open.delete(id) : ca.open.add(id); render(); },
  caSelect: (id, on) => { on ? ca.selected.add(id) : ca.selected.delete(id); render(); },
  caSelectReady: () => { ca.data.leads.filter((l) => l.status === "ready" && l.email && !l.placeholder).forEach((l) => ca.selected.add(l.id)); render(); },
  caSelectNone: () => { ca.selected.clear(); render(); },
  async caAdd() {
    const name = $("ca-new-name")?.value.trim();
    if (!name) return toast("Creator", "Bitte einen Kanalnamen eingeben.");
    try {
      const r = await api("/api/admin/creators", { method: "POST", body: {
        name, platform: $("ca-new-platform").value, category: $("ca-new-category").value, channelUrl: $("ca-new-url").value,
        followers: Number($("ca-new-followers").value) || 0, email: $("ca-new-email").value,
      } });
      replaceLead(r.lead); ca.open.add(r.lead.id); render();
      toast("✅ Creator angelegt", r.lead.promoCode ? `Promo-Code ${r.lead.promoCode} ist aktiv.` : "Angelegt.");
    } catch (e) { handleError(e); }
  },
  caSaveEmail: (id) => patch(id, { email: $(`ca-email-${id}`)?.value || "" }, "E-Mail gespeichert"),
  caSaveMeta: (id) => patch(id, {
    name: $(`ca-name-${id}`)?.value, followers: Number($(`ca-followers-${id}`)?.value) || 0, category: $(`ca-cat-${id}`)?.value,
    platform: $(`ca-plat-${id}`)?.value, channelUrl: $(`ca-url-${id}`)?.value, notes: $(`ca-notes-${id}`)?.value,
  }, "Gespeichert"),
  caTemplate: (id, t) => {
    const l = leadById(id);
    if (l?.customBody && !confirm("Eigener Text vorhanden – durch die Vorlage ersetzen?")) return;
    patch(id, { template: t, ...(l?.customBody ? { resetBody: true } : {}) });
  },
  caSaveMail: (id) => patch(id, { subject: $(`ca-subj-${id}`)?.value || "", body: $(`ca-body-${id}`)?.value || "" }, "Anschreiben gespeichert"),
  caResetMail: (id) => patch(id, { resetBody: true }, "Vorlage wiederhergestellt"),
  caStatus: (id, s) => { if (s) patch(id, { status: s }, "Status aktualisiert"); },
  async caDelete(id) {
    if (!confirm("Eintrag wirklich löschen? (Der Promo-Code bleibt bestehen.)")) return;
    try { await api(`/api/admin/creators/${id}`, { method: "DELETE" }); ca.data.leads = ca.data.leads.filter((l) => l.id !== id); ca.selected.delete(id); render(); } catch (e) { handleError(e); }
  },
  async caQuickTikTok() {
    const name = $("ca-tt-name")?.value.trim();
    const bioUrl = $("ca-tt-bio")?.value.trim() || "";
    if (!name) return toast("TikTok-Creator", "Bitte TikTok-Namen oder @handle eingeben.");
    try {
      const r = await api("/api/admin/creators", { method: "POST", body: { name, platform: "tiktok", category: "micro", bioUrl, quick: true } });
      replaceLead(r.lead); ca.open.delete(r.lead.id); ca.filter = "all"; render();
      toast("✅ TikTok-Creator angelegt", r.lead.promoCode ? `Promo-Code ${r.lead.promoCode} ist aktiv.` : "Angelegt.");
      if (bioUrl) await creatorAdminApi.caExtract(r.lead.id, bioUrl);
    } catch (e) { handleError(e); }
  },
  async caExtract(id, preset) {
    const url = (preset || $(`ca-extract-${id}`)?.value || "").trim();
    if (!url) return toast("Kontakt-Extraktor", "Bitte eine öffentliche URL (Linktree, Beacons, Website, Impressum) eingeben.");
    toast("🔎 Suche Kontakt …", url);
    try {
      const r = await api("/api/admin/extract-creator-contact", { method: "POST", body: { url, leadId: id } });
      if (r.platform) {
        await refreshAll();
        toast("ℹ️ Plattform-Seite", r.hint);
        if (r.open) window.open(r.open, "_blank", "noopener");
        return;
      }
      await refreshAll();
      if (r.emails.length) {
        const l = leadById(id);
        if (r.updated) toast("✅ E-Mail übernommen", `${r.emails[0]} – „Freigeben & über Resend senden“ ist jetzt aktiv.`);
        else if (l && l.email !== r.emails[0] && confirm(`Gefunden: ${r.emails.join(", ")}\n\n„${r.emails[0]}“ als Kontakt übernehmen?`)) await patch(id, { email: r.emails[0] }, "E-Mail übernommen");
        else toast("✅ Kontakt gefunden", r.emails.join(", "));
      } else toast("Keine E-Mail gefunden", r.hint || "Bitte Impressum direkt eingeben.");
    } catch (e) { handleError(e); }
  },
  async caSend(id) {
    const l = leadById(id);
    if (!l) return;
    if (!ca.data?.sending?.configured) return toast("Resend nicht eingerichtet", "RESEND_API_KEY / MAIL_FROM fehlen – bis dahin „📋 DM kopieren“ nutzen.");
    if (!confirm(`Kooperation jetzt über Resend an ${l.email} senden?\n\nBetreff: ${l.subject}\nPromo-Code: ${l.promoCode || "–"}\nLink: ${l.creatorPage || "/creator"}`)) return;
    try { const r = await api(`/api/admin/creators/${id}/send`, { method: "POST", body: {} }); replaceLead(r.lead); await refreshAll(); toast("📤 E-Mail gesendet", `${l.name} wurde über Resend angeschrieben – Status: E-Mail gesendet.`); }
    catch (e) { handleError(e); }
  },
  async caFollowup(id) {
    const l = leadById(id);
    if (!l || !confirm(`Freundliches Follow-up an ${l.email} senden? (Danach keine weiteren Mails.)`)) return;
    try { await api(`/api/admin/creators/${id}/send`, { method: "POST", body: { kind: "followup" } }); await refreshAll(); toast("🔁 Follow-up gesendet", l.name); }
    catch (e) { handleError(e); }
  },
  async caQueue() {
    const ids = [...ca.selected];
    if (!ids.length) return toast("Warteschlange", "Bitte zuerst Creator auswählen.");
    if (!confirm(`${ids.length} ausgewählte E-Mails nacheinander senden?\nMax. ${ca.data.sending.cap} pro Tag, mit Abstand – der Rest folgt automatisch an den nächsten Tagen.`)) return;
    try {
      const r = await api("/api/admin/creators/queue", { method: "POST", body: { ids } });
      ca.data.leads = r.leads; ca.selected.clear(); render();
      toast("📤 In der Warteschlange", `${r.queued} Mails geplant${r.skipped ? `, ${r.skipped} übersprungen (ohne E-Mail, Platzhalter oder schon gesendet)` : ""}.`);
    } catch (e) { handleError(e); }
  },
  caCopyDm: (id) => { const l = leadById(id); if (l) copy(l.dm, "Kurz-Nachricht inkl. Link kopiert – jetzt in TikTok/Instagram/Discord einfügen."); },
  caCopy: (text, msg) => copy(text, msg),
  caCopyAllDms: () => {
    const list = (ca.data?.leads || []).filter((l) => !l.placeholder && !EMAIL_OK.test(String(l.email || "")) && l.dm && !["optout", "active", "replied", "dm_sent"].includes(l.status));
    if (!list.length) return toast("💬 Keine offenen DMs", "Alle Creator ohne E-Mail wurden schon per DM angeschrieben.");
    copy(list.map((l) => `— ${l.name}${l.tiktokUrl ? ` (${l.tiktokUrl})` : ""}\n${l.dm}`).join("\n\n"), `${list.length} DM-Texte kopiert – jeweils in die TikTok-DM einfügen.`);
  },
  async caGrantPass(id) {
    const l = leadById(id);
    const email = prompt("E-Mail des PokeSwipe-Kontos des Creators:", l?.email || "");
    if (!email) return;
    try { await api(`/api/admin/creators/${id}/grant-pass`, { method: "POST", body: { email } }); await refreshAll(); toast("🎟️ VIP-Creator-Pass aktiv", "Dauerhaft Pro + Creator-Badge."); }
    catch (e) { handleError(e); }
  },
  async caApp(id, action) {
    if (action === "approve" && !confirm("Bewerbung freigeben? Der Code wird aktiviert und der Creator per E-Mail informiert.")) return;
    try {
      const r = await api(`/api/admin/creator-applications/${id}`, { method: "POST", body: { action } });
      await refreshAll();
      if (action === "approve") toast("✅ Freigegeben", `Code ${r.code} aktiv${r.passGranted ? " · VIP-Pass vergeben" : " · VIP-Pass folgt nach Registrierung"}${r.mailed ? " · E-Mail gesendet" : ""}.`);
    } catch (e) { handleError(e); }
  },
  caHookType: (v) => { ca.hook.type = HOOK_TYPES[v] ? v : "restock"; render(); },
  caHookTopic: (v) => { ca.hook.topic = String(v || "").slice(0, 60); render(); },
  caCopyHook: (key, i) => {
    const t = ca.hook.type; const topic = ca.hook.topic || "das neue Set";
    const src = (key === "h" ? HOOKS : COMMENTS)[t]?.[i];
    if (src) copy(src.replace(/\[Thema\]/g, topic));
  },
};

// Aktionen global verfügbar machen (Inline-Handler über public/js/csp-handlers.js)
if (typeof window !== "undefined" && window.PS) Object.assign(window.PS, creatorAdminApi);
