// Phase 6: Plattform-Pflichten im Browser
// • DAC7-Steuerdaten für Verkäufer (Pflicht ab 30 Verkäufen oder 2.000 € im Kalenderjahr, PStTG)
// • DAC7-Auswertung und BZSt-Export für Admins
// • Stripe-Kundenportal („Abo & Rechnungen verwalten“)
import { $, esc, eur, toast, state, api, handleError, requireLogin, modal, closeModalEl, input, btn } from "./core.js";

const cents = (c) => eur((Number(c) || 0) / 100);
const val = (id) => ($(id)?.value || "").trim();

// ---------------------------------------------------------------------------
// Stripe-Kundenportal
// ---------------------------------------------------------------------------
async function openBillingPortal() {
  if (!requireLogin()) return;
  try {
    const r = await api("/api/billing/portal", { method: "POST", body: {} });
    if (!r?.url || !/^https:\/\/billing\.stripe\.com\//.test(r.url)) throw new Error("Das Kundenportal ist gerade nicht erreichbar.");
    location.href = r.url;
  } catch (e) { handleError(e); }
}

/** Button für den Kontobereich (nur mit Stripe-Kundenkonto sinnvoll). */
export function billingPortalButton() {
  return btn("🧾 Abo & Rechnungen verwalten", "PS.openBillingPortal()", "w-full bg-slate-800 text-white");
}

// ---------------------------------------------------------------------------
// DAC7-Steuerdaten (Verkäufer)
// ---------------------------------------------------------------------------
async function openTaxInfo() {
  if (!requireLogin()) return;
  modal("ps-taxinfo", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Steuerdaten …</p>`);
  try {
    const r = await api("/api/market/tax-info");
    renderTaxInfo(r);
  } catch (e) { closeModalEl("ps-taxinfo"); handleError(e); }
}

function renderTaxInfo(r) {
  const t = r.taxInfo || {};
  const entity = t.sellerType === "entity";
  const field = (id, label, value, attrs = "") => `<label class="block text-[11px] text-slate-300 font-bold space-y-1"><span>${label}</span>${input(id, `value="${esc(value || "")}" ${attrs}`)}</label>`;
  modal("ps-taxinfo", `
    <h3 class="text-base font-black text-white">🧾 Steuerdaten für Verkäufer (DAC7)</h3>
    <p class="text-xs text-slate-300">Plattformen müssen Verkäufer an das Bundeszentralamt für Steuern melden, die in einem Kalenderjahr mindestens
      ${Number(r.thresholds.transactions)} Verkäufe oder ${cents(r.thresholds.grossCents)} Umsatz erreichen (Plattformen-Steuertransparenzgesetz).
      Dieses Jahr: <strong class="text-white">${Number(r.year.transactions)} Verkäufe, ${cents(r.year.netCents)}</strong>.</p>
    ${r.required ? `<p class="text-xs font-black ${r.blocked ? "text-rose-300" : "text-amber-300"}">${r.blocked
      ? "⛔ Neue Verkäufe mit Käuferschutz sind gesperrt, bis die Angaben vollständig sind."
      : "⚠️ Du hast die Meldeschwelle erreicht – bitte ergänze deine Angaben, sonst werden neue Verkäufe nach zwei Erinnerungen gesperrt."}</p>` : ""}
    ${!r.required && !r.complete && r.notice?.stage === "warning" ? `<p class="text-xs font-black text-amber-300">⚠️ Du hast die Vorwarnschwelle erreicht (${Number(r.warnThresholds.transactions)} Verkäufe oder ${cents(r.warnThresholds.grossCents)}). Bitte hinterlege Steuer-ID und Anschrift schon jetzt, damit dein Verkaufen bei Erreichen der Meldegrenze nicht unterbrochen wird.</p>` : ""}
    ${r.complete ? `<p class="text-xs font-black text-emerald-300">✅ Angaben vollständig${t.updatedAt ? ` (zuletzt geändert am ${new Date(t.updatedAt).toLocaleDateString("de-DE")})` : ""}.</p>` : ""}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label class="block text-[11px] text-slate-300 font-bold space-y-1 sm:col-span-2"><span>Ich verkaufe als</span>
        <select id="tx-type" onchange="PS.taxTypeChanged()" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white">
          <option value="individual" ${entity ? "" : "selected"}>Privatperson / Einzelunternehmer</option>
          <option value="entity" ${entity ? "selected" : ""}>Unternehmen (GmbH, UG …)</option>
        </select></label>
      ${field("tx-name", entity ? "Firma" : "Vor- und Nachname", t.legalName, 'maxlength="120" autocomplete="name"')}
      <div id="tx-birth-wrap" class="${entity ? "hidden" : ""}">${field("tx-birth", "Geburtsdatum", t.birthDate, 'type="date"')}</div>
      ${field("tx-street", "Straße und Hausnummer", t.street, 'maxlength="120" autocomplete="street-address"')}
      ${field("tx-zip", "PLZ", t.postalCode, 'maxlength="12" autocomplete="postal-code"')}
      ${field("tx-city", "Ort", t.city, 'maxlength="80" autocomplete="address-level2"')}
      ${field("tx-country", "Land (ISO, z. B. DE)", t.country || "DE", 'maxlength="2" autocomplete="country"')}
      ${field("tx-tin", "Steuer-Identifikationsnummer (11 Ziffern bei DE)", t.taxId, 'maxlength="20" inputmode="numeric" autocomplete="off"')}
      ${field("tx-vat", "USt-IdNr. (falls vorhanden)", t.vatId, 'maxlength="20" autocomplete="off"')}
      <div id="tx-reg-wrap" class="${entity ? "" : "hidden"}">${field("tx-reg", "Handelsregisternummer", t.businessRegNo, 'maxlength="40" autocomplete="off"')}</div>
      ${field("tx-iban", "IBAN des Auszahlungskontos", t.iban, 'maxlength="34" autocomplete="off"')}
    </div>
    <p id="tx-msg" class="text-xs text-rose-300 min-h-[1rem]"></p>
    ${btn("Steuerdaten speichern", "PS.saveTaxInfo()", "w-full bg-yellow-400 text-slate-950")}
    <p class="text-[10px] text-slate-500">Rechtsgrundlage: Art. 6 Abs. 1 lit. c DSGVO i. V. m. §§ 13 ff. PStTG. Die Daten werden nur für die gesetzliche Meldung
      verwendet und 10 Jahre aufbewahrt. <a href="/datenschutz#marktplatz" target="_blank" rel="noopener" class="underline">Datenschutz</a></p>`);
}

function taxTypeChanged() {
  const entity = val("tx-type") === "entity";
  $("tx-birth-wrap")?.classList.toggle("hidden", entity);
  $("tx-reg-wrap")?.classList.toggle("hidden", !entity);
}

async function saveTaxInfo() {
  const msg = $("tx-msg");
  const sellerType = val("tx-type") === "entity" ? "entity" : "individual";
  const payload = {
    sellerType, legalName: val("tx-name"), street: val("tx-street"), postalCode: val("tx-zip"), city: val("tx-city"),
    country: val("tx-country").toUpperCase(), birthDate: sellerType === "individual" ? val("tx-birth") : "",
    taxId: val("tx-tin").replace(/\s+/g, ""), vatId: val("tx-vat").replace(/\s+/g, "").toUpperCase(),
    businessRegNo: sellerType === "entity" ? val("tx-reg") : "", iban: val("tx-iban").replace(/\s+/g, "").toUpperCase(),
  };
  try {
    await api("/api/market/tax-info", { method: "PUT", body: payload });
    closeModalEl("ps-taxinfo");
    toast("🧾 Steuerdaten gespeichert", "Vielen Dank – deine Angaben sind vollständig.");
    window.PS?.refreshMe?.().catch?.(() => {});
  } catch (e) {
    if (msg && e.status === 400) { msg.textContent = e.message; if (e.data?.field) $({ sellerType: "tx-type", legalName: "tx-name", street: "tx-street", postalCode: "tx-zip", city: "tx-city", country: "tx-country", birthDate: "tx-birth", taxId: "tx-tin", vatId: "tx-vat", businessRegNo: "tx-reg", iban: "tx-iban" }[e.data.field])?.focus(); }
    else handleError(e);
  }
}

// ---------------------------------------------------------------------------
// DAC7-Auswertung (Admin)
// ---------------------------------------------------------------------------
async function openDac7Admin(year) {
  if (!state.me?.isAdmin) return;
  const y = Number(year) || new Date().getFullYear();
  modal("ps-dac7", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade DAC7-Auswertung …</p>`, { wide: true });
  try {
    const r = await api(`/api/admin/dac7?year=${y}`);
    const s = r.summary;
    const tile = (label, v, cls = "text-white") => `<div class="bg-slate-950 rounded-2xl p-3 border border-slate-800"><p class="text-[10px] uppercase font-bold text-slate-400">${label}</p><p class="text-lg font-black ${cls}">${v}</p></div>`;
    const years = [y - 1, y, y + 1].filter((x) => x <= new Date().getFullYear());
    modal("ps-dac7", `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-base font-black text-white">🧾 DAC7-Meldung ${Number(r.year)}</h3>
        <div class="flex gap-1">${years.map((x) => btn(String(x), `PS.openDac7Admin(${x})`, x === y ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-200")).join("")}</div>
      </div>
      <p class="text-xs text-slate-400">Meldeschwelle: ${Number(r.thresholds.transactions)} Verkäufe oder ${cents(r.thresholds.grossCents)} Vergütung im Kalenderjahr. Meldung an das BZSt bis 31. Januar des Folgejahres.</p>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        ${tile("Verkäufer mit Umsatz", Number(s.sellers))}
        ${tile("Meldepflichtig", Number(s.reportable), "text-amber-300")}
        ${tile("Steuerdaten fehlen", Number(s.missingTaxInfo), s.missingTaxInfo ? "text-rose-300" : "text-emerald-300")}
        ${tile("Gewerbliches Muster", Number(s.commercial), s.commercial ? "text-amber-300" : "text-white")}
      </div>
      <div class="flex flex-wrap gap-2">
        <a href="/api/admin/dac7/export.csv?year=${y}" class="bg-emerald-500 text-slate-950 font-black py-2.5 px-3 rounded-xl text-xs">⬇️ Export meldepflichtige Verkäufer (CSV)</a>
        <a href="/api/admin/dac7/export.csv?year=${y}&all=1" class="bg-slate-800 text-white font-black py-2.5 px-3 rounded-xl text-xs">⬇️ Export alle Verkäufer</a>
      </div>
      <div class="max-h-[55vh] overflow-y-auto space-y-1.5">
        ${r.sellers.length ? r.sellers.map((x) => `<div class="bg-slate-950 border ${x.reportable ? (x.taxInfo?.complete ? "border-emerald-500/40" : "border-rose-500/50") : "border-slate-800"} rounded-xl p-2.5 text-xs space-y-1">
          <div class="flex flex-wrap justify-between gap-2"><p class="font-black text-white">${esc(x.displayName)} <span class="text-slate-500 font-normal">${esc(x.email)}</span></p>
            <p class="text-slate-300">${Number(x.transactions)} Verkäufe • ${cents(x.netCents)} netto • Gebühren ${cents(x.feeCents)}</p></div>
          <p class="text-slate-400">Quartale: ${x.quarters.map((q, i) => `Q${i + 1} ${cents(q)}`).join(" · ")}</p>
          <p class="flex flex-wrap gap-1.5">
            ${x.reportable ? `<span class="text-[10px] font-black bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full">meldepflichtig</span>` : ""}
            ${x.taxInfo?.complete ? `<span class="text-[10px] font-black bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded-full">Steuerdaten ✓ ${esc(x.taxInfo.country)} • TIN ${esc(x.taxInfo.taxId)}</span>`
              : x.reportable ? `<span class="text-[10px] font-black bg-rose-500/20 text-rose-200 px-2 py-0.5 rounded-full">Steuerdaten fehlen • ${Number(x.remindersSent)} Erinnerung(en)</span>` : ""}
            ${x.blocked ? `<span class="text-[10px] font-black bg-rose-600 text-white px-2 py-0.5 rounded-full">Verkauf gesperrt</span>` : ""}
            ${x.flagged ? `<span class="text-[10px] font-black bg-rose-600 text-white px-2 py-0.5 rounded-full">markiert</span>` : ""}
            ${x.commercial ? `<span class="text-[10px] font-black bg-purple-500/30 text-purple-100 px-2 py-0.5 rounded-full">gewerblich? ${esc(x.commercialReasons.join(", "))}</span>` : ""}
          </p></div>`).join("") : `<p class="text-xs text-slate-400 text-center py-4">Keine Verkäufe mit Käuferschutz in diesem Jahr.</p>`}
      </div>`, { wide: true });
  } catch (e) { closeModalEl("ps-dac7"); handleError(e); }
}

// ---------------------------------------------------------------------------
// Set-Vollständigkeit (Admin)
// ---------------------------------------------------------------------------
async function openSetCompleteness(lang = "de", incomplete = true) {
  if (!state.me?.isAdmin) return;
  const l = ["de", "en", "ja"].includes(lang) ? lang : "de";
  modal("ps-setcomp", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Prüfe Sets …</p>`, { wide: true });
  try {
    const r = await api(`/api/admin/set-completeness?lang=${l}${incomplete ? "&incomplete=1" : ""}`);
    const s = r.summary;
    modal("ps-setcomp", `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-base font-black text-white">🧩 Set-Vollständigkeit</h3>
        <div class="flex gap-1">${["de", "en", "ja"].map((x) => btn(x.toUpperCase(), `PS.openSetCompleteness('${x}', ${incomplete})`, x === l ? "bg-yellow-400 text-slate-950" : "bg-slate-800 text-slate-200")).join("")}
          ${btn(incomplete ? "Alle zeigen" : "Nur unvollständige", `PS.openSetCompleteness('${l}', ${!incomplete})`, "bg-slate-800 text-slate-200")}</div>
      </div>
      <p class="text-xs text-slate-300">${Number(s.sets)} Sets • <span class="text-emerald-300">${Number(s.complete)} vollständig</span> • <span class="text-rose-300">${Number(s.incomplete)} unvollständig</span>
        • ${Number(s.unknown)} ohne offizielle Zahl • <strong class="text-white">${Number(s.missingCards)}</strong> fehlende Karten</p>
      <div class="max-h-[60vh] overflow-y-auto space-y-1.5">${r.sets.length ? r.sets.map((x) => `
        <div class="bg-slate-950 border ${x.status === "complete" ? "border-emerald-500/40" : x.status === "incomplete" ? "border-rose-500/40" : "border-slate-800"} rounded-xl p-2.5 text-xs space-y-1">
          <div class="flex flex-wrap justify-between gap-2"><p class="font-black text-white">${esc(x.name)} <span class="text-slate-500 font-normal">${esc(x.id)} • ${esc(x.serie)}</span></p>
            <p class="text-slate-300">${Number(x.imported)}/${Number(x.total)} (${Number(x.pct)} %) • regulär ${Number(x.mainImported)}/${Number(x.official)} • Secret ${Number(x.secretImported)} • Sonder ${Number(x.specialImported)}</p></div>
          ${x.missingMain.length ? `<p class="text-rose-300">Fehlt (regulär): ${x.missingMain.map(esc).join(", ")}</p>` : ""}
          ${x.missingSecret.length ? `<p class="text-amber-300">Fehlt (Secret Rares): ${x.missingSecret.map(esc).join(", ")}</p>` : ""}
        </div>`).join("") : `<p class="text-xs text-emerald-300 text-center py-4">Alle Sets sind vollständig importiert.</p>`}</div>`, { wide: true });
  } catch (e) { closeModalEl("ps-setcomp"); handleError(e); }
}

// ---------------------------------------------------------------------------
// Betrieb: geplante Jobs, Circuit-Breaker, Fehlerprotokoll (Admin)
// ---------------------------------------------------------------------------
async function openOps() {
  if (!state.me?.isAdmin) return;
  modal("ps-ops", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Betriebsdaten …</p>`, { wide: true });
  try {
    const [r, al] = await Promise.all([api("/api/admin/jobs"), api("/api/admin/alerts").catch(() => ({ alerts: [], channels: {} }))]);
    const color = (st) => (st === "ok" ? "text-emerald-300" : st === "partial" ? "text-amber-300" : st === "skipped" ? "text-slate-400" : st ? "text-rose-300" : "text-slate-500");
    modal("ps-ops", `
      <h3 class="text-base font-black text-white">⚙️ Jobs, Circuits & Fehler</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">${r.jobs.map((j) => `
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
          <p class="font-black text-white">${esc(j.name)} <span class="${color(j.lastStatus)}">${esc(j.lastStatus || "noch nie gelaufen")}</span></p>
          <p class="text-slate-400">${j.lastRunAt ? new Date(j.lastRunAt).toLocaleString("de-DE") : "–"} • 24 h: ${Number(j.last24h.runs)} Läufe, ${Number(j.last24h.errors)} Fehler, ${Number(j.last24h.partial)} Teil-Läufe, Ø ${Number(j.last24h.avgMs)} ms</p>
        </div>`).join("")}</div>
      <h4 class="text-sm font-black text-white">🚨 Alarme</h4>
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] space-y-1.5">
        <p class="text-slate-300">Der Wächter prüft alle 10 Minuten Fehler-Spitzen, zahlungskritische Fehler, überfällige Jobs und den Stripe-Webhook. Kanäle:
          <span class="${al.channels.push ? "text-emerald-300" : "text-rose-300"}">Push/Mitteilung ${al.channels.push ? "✓" : "✗ (ADMIN_EMAILS fehlt)"}</span> •
          <span class="${al.channels.email ? "text-emerald-300" : "text-amber-300"}">E-Mail ${al.channels.email ? "✓" : "✗ (RESEND_API_KEY/MAIL_FROM fehlen)"}</span> •
          <span class="${al.channels.webhook ? "text-emerald-300" : "text-slate-400"}">Webhook ${al.channels.webhook ? "✓" : "– (optional: ALERT_WEBHOOK_URL)"}</span></p>
        ${btn("Testalarm senden", "PS.sendTestAlert()", "bg-slate-800 text-white")}
        <div class="max-h-40 overflow-y-auto space-y-1">${al.alerts.length ? al.alerts.map((x) => `<div class="border-t border-slate-800 pt-1"><p class="text-slate-400">${new Date(x.at).toLocaleString("de-DE")} • <span class="${x.severity === "critical" ? "text-rose-300" : "text-amber-300"}">${esc(x.title)}</span></p><p class="text-slate-300 break-words">${esc(x.text)}</p></div>`).join("") : `<p class="text-emerald-300">Noch keine Alarme.</p>`}</div>
      </div>
      <h4 class="text-sm font-black text-white">Externe Quellen</h4>
      <div class="flex flex-wrap gap-1.5 text-[11px]">${r.circuits.length ? r.circuits.map((c) => `<span class="px-2 py-1 rounded-full ${c.phase === "closed" ? "bg-emerald-500/20 text-emerald-200" : c.phase === "half-open" ? "bg-amber-500/20 text-amber-200" : "bg-rose-500/30 text-rose-100"}" title="${esc(c.lastError || "")}">${esc(c.name)} • ${esc(c.phase)}${c.failures ? ` (${Number(c.failures)})` : ""}</span>`).join("") : `<span class="text-slate-400">Keine Störungen erfasst.</span>`}</div>
      <h4 class="text-sm font-black text-white">Letzte Fehler</h4>
      <div class="max-h-[40vh] overflow-y-auto space-y-1 text-[11px]">${r.errors.length ? r.errors.map((e) => `<div class="bg-slate-950 border border-slate-800 rounded-lg p-2">
        <p class="text-slate-400">${new Date(e.createdAt).toLocaleString("de-DE")} • <span class="text-cyan-300">${esc(e.scope)}</span></p><p class="text-rose-200 break-words">${esc(e.message)}</p></div>`).join("") : `<p class="text-emerald-300">Keine Fehler protokolliert.</p>`}</div>`, { wide: true });
  } catch (e) { closeModalEl("ps-ops"); handleError(e); }
}

async function sendTestAlert() {
  try {
    const r = await api("/api/admin/alerts/test", { method: "POST", body: {} });
    toast(r.sent ? "✅ Testalarm gesendet" : "⚠️ Kein Kanal erreichbar", r.sent ? `Kanäle: ${(r.channels || []).join(", ")}` : "Bitte ADMIN_EMAILS, RESEND_API_KEY/MAIL_FROM oder ALERT_WEBHOOK_URL prüfen.");
  } catch (e) { handleError(e); }
}

export const complianceApi = { openBillingPortal, openTaxInfo, taxTypeChanged, saveTaxInfo, openDac7Admin, openSetCompleteness, openOps, sendTestAlert };
