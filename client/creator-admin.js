// Admin-Zentrale → „Creator-Finder & Outreach“ (wird erst beim Öffnen nachgeladen)
// • Starter-Liste (DACH Pokémon-TCG) mit Wahrscheinlichkeits-Score und 1-Klick-Recherche (Kanalinfo/Impressum, TikTok, Instagram)
// • Kontakt-Extraktor (/api/admin/extract-creator-contact) füllt die E-Mail automatisch aus
// • Automatischer 30-Tage-Promo-Code je Creator, 4 Anschreiben-Vorlagen mit Platzhaltern
// • Kontrollierter Versand über Resend: „Freigeben & senden“ oder gestaffelte Warteschlange (max. 15/Tag), Follow-up nach 4 Tagen
// • Creator-Bewerbungen von /creator freigeben, Viral-Hook- & Kommentar-Generator, Schnellstart Pro-Video-Generator
import { $, esc, jsArg, toast, api, handleError, modal, btn } from "./core.js";

const ca = { data: null, tab: "finder", filter: "all", selected: new Set(), open: new Set(), hook: { type: "restock", topic: "" } };

const STATUS_CLS = {
  ready: "bg-sky-500/20 text-sky-200", queued: "bg-violet-500/20 text-violet-200", sending: "bg-violet-500/20 text-violet-200",
  sent: "bg-emerald-500/20 text-emerald-200", followup: "bg-amber-500/25 text-amber-200", replied: "bg-yellow-400/25 text-yellow-200",
  active: "bg-fuchsia-500/25 text-fuchsia-200", paused: "bg-slate-700 text-slate-300", optout: "bg-rose-500/20 text-rose-200", no_email: "bg-slate-700 text-slate-300",
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
        <li>Nur einzelne, persönliche Kooperationsanfragen an <strong>öffentlich als geschäftlich angegebene</strong> Adressen (Kanalinfo, Impressum, „Business-Anfragen“). Keine gekauften Listen, keine Massen-Mails.</li>
        <li>Jede Mail enthält Absender, Impressum-Link und einen Abmelde-Link (auch als One-Click-Header). Abgemeldete Adressen landen auf der Sperrliste und werden nie wieder angeschrieben.</li>
        <li>Höchstens ${Number(s.cap)} Mails pro Tag, mindestens ${Number(s.minGapMin)} Minuten Abstand, genau ein Follow-up – danach ist Schluss.</li>
        <li>Antworten gehen an die erste Adresse aus ADMIN_EMAILS. Absendername in den Vorlagen: ${s.senderName ? `„${esc(s.senderName)}“` : "„das Team“ (eigenen Namen über die Umgebungsvariable OUTREACH_SENDER_NAME setzen)"}.</li>
      </ul></details>
  </div>`;
}

// ---------------------------------------------------------------------------
// Creator-Finder
// ---------------------------------------------------------------------------
const FILTERS = [["all", "Alle"], ["ready", "Bereit"], ["no_email", "Ohne E-Mail"], ["queued", "Warteschlange"], ["sent", "Gesendet"], ["followup", "Follow-up fällig"], ["replied", "Antwort"], ["active", "Aktiv"]];

function finderHtml(d) {
  const leads = d.leads.filter((l) => ca.filter === "all" || l.display.key === ca.filter || (ca.filter === "queued" && l.status === "sending"));
  const totalSignups = d.leads.reduce((s, l) => s + (Number(l.signups) || 0), 0);
  const sendable = d.leads.filter((l) => ca.selected.has(l.id) && ["ready", "paused"].includes(l.status) && l.email && !l.placeholder).length;
  return `
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
    <div class="flex flex-wrap gap-1.5">${searches.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" class="bg-slate-950 border border-slate-700 hover:border-cyan-400 text-white font-bold px-2.5 py-1.5 rounded-lg">${esc(x.label)} ↗</a>`).join("")}</div>
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
          <span class="text-[10px] font-black px-1.5 py-0.5 rounded-full ${STATUS_CLS[l.display.key] || STATUS_CLS.ready}">${esc(l.display.label)}${l.status === "sent" && l.sentAt ? ` am ${esc(fmtDay(l.sentAt))}` : ""}${l.status === "queued" && l.scheduledAt ? ` · ${esc(fmt(l.scheduledAt))}` : ""}</span>
        </div>
        <div class="flex items-center gap-2 mt-1"><span class="text-[10px] text-slate-400">${esc(l.tierLabel)}${l.followers ? ` · ${Number(l.followers).toLocaleString("de-DE")} Follower` : ""}</span>
          <span class="inline-flex items-center gap-1 text-[10px] text-slate-300" title="Antwort-Wahrscheinlichkeit"><span class="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden inline-block"><span class="block h-full ${scoreCls}" style="width:${Number(l.score)}%"></span></span>${Number(l.score)} %</span></div>
        ${l.promoCode ? `<p class="mt-1"><span class="font-mono font-black text-yellow-300">${esc(l.promoCode)}</span> <span class="text-slate-400">· ${Number(l.signups) || 0} Anmeldungen über den Code</span>${l.promoActive === false ? ' <span class="text-amber-300">(Code inaktiv)</span>' : ""} <button type="button" onclick="PS.caCopy(${jsArg(l.link)}, 'Link kopiert')" class="text-[10px] underline text-slate-300">Link kopieren</button></p>` : `<p class="mt-1 text-slate-500">Promo-Code entsteht, sobald der Platzhalter einen echten Namen bekommt.</p>`}
        ${l.lastError ? `<p class="text-rose-300 text-[10px]">⚠ ${esc(l.lastError)}</p>` : ""}
      </div>
      <button type="button" onclick="PS.caToggle(${Number(l.id)})" class="text-slate-300 font-bold text-[11px] shrink-0">${open ? "▲ zu" : "▼ öffnen"}</button>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <a href="${esc(l.research.youtubeAbout)}" target="_blank" rel="noopener" class="bg-rose-600/80 text-white font-bold px-2 py-1 rounded-lg">▶ YouTube Kanalinfo / Impressum öffnen</a>
      <a href="${esc(l.research.tiktok)}" target="_blank" rel="noopener" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg">TikTok suchen</a>
      <a href="${esc(l.research.instagram)}" target="_blank" rel="noopener" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg">Instagram suchen</a>
      <a href="${esc(l.research.google)}" target="_blank" rel="noopener" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg">Impressum googeln</a>
      ${l.channelUrl ? `<a href="${esc(l.channelUrl)}" target="_blank" rel="noopener" class="bg-slate-800 text-white font-bold px-2 py-1 rounded-lg">Kanal ↗</a>` : ""}
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      <div class="flex gap-1"><input id="ca-email-${Number(l.id)}" type="email" value="${esc(l.email)}" placeholder="Kontakt-E-Mail" class="${inputCls}" />${btn("✓", `PS.caSaveEmail(${Number(l.id)})`, "bg-emerald-500 text-slate-950 px-3")}</div>
      <div class="flex gap-1"><input id="ca-extract-${Number(l.id)}" value="${esc(l.bioLink || "")}" placeholder="Linktree / Beacons / Instagram / Website / Impressum-URL" class="${inputCls}" />${btn("🔎 Extrahieren", `PS.caExtract(${Number(l.id)})`, "bg-cyan-600 text-white px-2 shrink-0")}</div>
    </div>
    ${(l.socials || []).length ? `<p class="text-[10px] text-slate-400 break-all">Gefunden: ${(l.socials || []).map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener" class="underline text-slate-300">${esc(String(s).replace(/^https?:\/\/(www\.)?/, ""))}</a>`).join(" · ")}</p>` : ""}
    <div class="flex flex-wrap gap-1.5">
      ${canSend ? btn(l.status === "queued" ? "Jetzt statt geplant über Resend senden" : "✅ Freigeben & über Resend senden", `PS.caSend(${Number(l.id)})`, "bg-emerald-500 text-slate-950 font-black ring-2 ring-emerald-300/60") : ""}
      ${followDue ? btn("🔁 Follow-up senden", `PS.caFollowup(${Number(l.id)})`, "bg-amber-400 text-slate-950") : ""}
      ${btn("📋 DM kopieren", `PS.caCopyDm(${Number(l.id)})`, hasMail ? "bg-slate-800 text-white" : "bg-cyan-500 text-slate-950 font-black")}
      <select onchange="PS.caStatus(${Number(l.id)}, this.value)" class="bg-slate-800 text-white rounded-xl px-2 text-[11px] font-bold">
        <option value="">Status setzen …</option>
        ${[["replied", "💬 Antwort erhalten"], ["active", "🎬 Aktiv (macht mit)"], ["paused", "⏸ Pausieren"], ["ready", "↺ Zurück auf Bereit"], ["optout", "🚫 Abgemeldet / kein Interesse"]].map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}
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
      <p><a href="${esc(a.channelUrl)}" target="_blank" rel="noopener" class="underline text-slate-300 break-all">${esc(a.channelUrl)}</a> · <span class="text-slate-300">${esc(a.email)}</span></p>
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
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
      ${btn("🎬 Pro-Video-Generator öffnen", "PS.openGenerator()", "bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white")}
      ${btn("🎥 Make.com & Auto-Reels", "PS.openMakeAdmin()", "bg-slate-800 text-white")}
    </div>
  </div>`;
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

export const creatorAdminApi = {
  openCreatorAdmin,
  caTab: (k) => { ca.tab = k; render(); },
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
