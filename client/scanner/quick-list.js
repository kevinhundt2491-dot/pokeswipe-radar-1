// PokeSwipe & Radar – Schnell-Inserieren aus dem Scanner.
// Eine oder viele gescannte Karten in einer Liste: fairer Preisvorschlag (eigene Preis-Pipeline + Konkurrenz-Inserate)
// steht direkt im Preisfeld und lässt sich an derselben Stelle ändern. Ein Tipp veröffentlicht alles (in 20er-Blöcken).
import { $, esc, jsArg, eur, toast, cdn, FALLBACK_IMG, state, api, handleError, requireLogin, modal, closeModalEl } from "../core.js";
import { VARIANT_LABEL, VARIANT_KEYS } from "../variants.js";
import { haptic } from "../native.js";
import { priceTagHtml, CONDITION_INFO } from "../price-tag.js";

const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const CONDS = { mint: "Mint", nm: "Near Mint", ex: "Excellent", gd: "Good", lp: "Light Played", pl: "Played", po: "Poor" };
const PREF_KEY = "ps_quicklist_prefs";
const BATCH = 20;
const MODAL_ID = "ps-quicklist";
/** Pro-Video-Aufnahme (Live-Stage-iframe ?reel=1): Ablauf echt zeigen, aber NIE echte Inserate anlegen. */
const IS_STAGE = (() => {
  try { return window.self !== window.top && new URLSearchParams(location.search).get("reel") === "1"; } catch { return false; }
})();

const INSTANT_SECONDS = 4;

// prefs: zuletzt genutzte Angaben (Stadt, Tauschwunsch, Sofort-Kauf, Versand) – das nächste Inserat braucht keinen Extra-Tipp
const ql = { rows: [], seq: 0, strategy: "fair", condition: "nm", busy: false, timer: 0, instant: false, countdown: 0, cdTimer: 0, prefs: {}, lastIds: [] };

function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    if (CONDS[p.condition]) ql.condition = p.condition;
    if (p.strategy === "quick" || p.strategy === "fair") ql.strategy = p.strategy;
    ql.prefs = {
      city: typeof p.city === "string" ? p.city.slice(0, 60) : "",
      want: typeof p.want === "string" ? p.want.slice(0, 120) : "",
      buyNow: p.buyNow !== false,
      ship: typeof p.ship === "string" && /^\d{0,2}([.,]\d{1,2})?$/.test(p.ship) ? p.ship : "1,95",
    };
  } catch {}
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ condition: ql.condition, strategy: ql.strategy, ...ql.prefs })); } catch {}
}

const parsePrice = (v) => {
  const n = parseFloat(String(v ?? "").replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const fmtInput = (n) => (n === null || n === undefined ? "" : Number(n).toFixed(2).replace(".", ","));
const rowOf = (uid) => ql.rows.find((r) => r.uid === uid);

/** Preis aus dem Vorschlag je nach Strategie (Fair / Schnell verkaufen) */
function suggested(r) {
  const s = r.sug;
  if (!s) return null;
  return ql.strategy === "quick" ? (s.quick ?? s.fair) : s.fair;
}

// ---------------------------------------------------------------------------
// Öffnen & Vorschläge laden
// ---------------------------------------------------------------------------
/**
 * infos: Treffer aus /api/scan/lookup (key, kind, id, lang, name, number, setName, image, price) – oder Karten aus
 * Sammlung, Kartendetails und Swipe-Radar (optional mit condition, variant, portfolioItemId, maxQty).
 * opts.instant: 1-Tap-Verkauf – sobald der faire Preis da ist, läuft ein kurzer Countdown und das Inserat geht live.
 * Jede Berührung (Preis, Zustand, Variante) stoppt den Countdown, damit man an gleicher Stelle noch ändern kann.
 */
export function openQuickList(infos, opts = {}) {
  if (!IS_STAGE && !requireLogin()) return;
  const list = (Array.isArray(infos) ? infos : [infos]).filter((i) => i?.key && i?.id);
  if (!list.length) { toast("Keine Karte", "Scanne zuerst eine Karte."); return; }
  readPrefs();
  stopCountdown();
  ql.instant = Boolean(opts.instant);
  ql.lastIds = [];
  ql.rows = list.map((info) => ({
    uid: `q${++ql.seq}`, info,
    condition: CONDS[String(info.condition || "").toLowerCase()] ? String(info.condition).toLowerCase() : ql.condition,
    variant: VARIANT_KEYS.includes(info.variant) ? info.variant : "normal",
    price: null, touched: false, sug: null, loading: true, status: "", preview: false,
    // Echtes Scan-Foto standardmäßig anhängen – Käufer sehen im Swipe-Radar die tatsächliche Karte und ihren Zustand
    usePhoto: Boolean(info.photo),
  }));
  render();
  loadSuggestions(ql.rows);
}

async function loadSuggestions(rows) {
  if (!rows.length) return;
  rows.forEach((r) => { r.loading = true; paintRow(r); });
  try {
    const { items } = await api("/api/listings/suggest", { method: "POST", body: { items: rows.map((r) => ({ key: r.info.key, condition: r.condition, variant: r.variant })) } });
    rows.forEach((r, idx) => {
      const s = items?.[idx];
      r.sug = s && s.key === r.info.key ? s : null;
      r.loading = false;
      // Ohne Daten der Pipeline: Marktpreis aus dem Scan als Rückfall
      if (!r.sug?.fair && Number(r.info.price) > 0) r.sug = { ...(r.sug || {}), fair: Number(r.info.price), quick: Math.round(Number(r.info.price) * 0.92 * 10) / 10, basis: "scan" };
      if (!r.touched) r.price = suggested(r);
      paintRow(r);
    });
  } catch (e) {
    rows.forEach((r) => {
      r.loading = false;
      if (!r.touched && r.price === null && Number(r.info.price) > 0) r.price = Number(r.info.price);
      paintRow(r);
    });
    if (e?.status !== 429) handleError(e);
  }
  paintSummary();
  if (ql.instant) startCountdown();
}

// ---------------------------------------------------------------------------
// 1-Tap-Verkauf: Countdown → automatisch veröffentlichen (abbrechbar, jede Änderung stoppt ihn)
// ---------------------------------------------------------------------------
function stopCountdown() {
  clearInterval(ql.cdTimer); ql.cdTimer = 0; ql.countdown = 0;
}

function startCountdown() {
  if (!ql.instant || ql.cdTimer || ql.busy) return;
  const open = ql.rows.filter((r) => r.status !== "done");
  // Nur starten, wenn wirklich jede Karte einen Preis hat – sonst bleibt der normale Knopf
  if (!open.length || open.some((r) => r.loading || !(r.price > 0))) { ql.instant = false; paintSummary(); return; }
  ql.countdown = INSTANT_SECONDS;
  paintSummary();
  ql.cdTimer = setInterval(() => {
    if (!$(MODAL_ID)) { stopCountdown(); ql.instant = false; return; }
    ql.countdown -= 1;
    if (ql.countdown <= 0) { stopCountdown(); ql.instant = false; submit(); return; }
    paintSummary();
  }, 1000);
}

/** Jede Nutzereingabe beendet den Autopiloten – ab dann entscheidet der Nutzer per Knopf. */
function cancelInstant() {
  if (!ql.instant && !ql.cdTimer) return;
  stopCountdown(); ql.instant = false; paintSummary();
}

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------
const selCls = "bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-[11px] text-white";

function rowHtml(r) {
  const i = r.info, u = jsArg(r.uid);
  return `<div id="ql-${r.uid}" class="bg-slate-950 border border-slate-800 rounded-2xl p-2 space-y-1.5">
    <div class="flex gap-2 items-start">
      <button type="button" onclick="PS.quickListPreview(${u})" title="So sieht die Karte im Swipe-Radar aus" class="relative shrink-0 w-14">
        <img id="ql-img-${r.uid}" src="${esc(r.usePhoto && i.photo ? i.photo : cdn(i.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" alt="" loading="lazy" class="w-14 ${r.usePhoto && i.photo ? "object-cover" : "object-contain"} rounded bg-slate-900" style="height:4.75rem" />
        <div id="ql-tag-${r.uid}" class="absolute -bottom-1.5 -left-1 ps-price-tag-tilt"></div>
        <span class="absolute top-0.5 right-0.5 text-[8px] font-black bg-slate-950/80 text-yellow-300 px-1 rounded" aria-hidden="true">👁️</span>
      </button>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-black text-white leading-tight truncate">${FLAG[i.lang] || ""} ${esc(i.name)} <span class="text-slate-400 font-bold">${esc(i.number || "")}</span></p>
        <p class="text-[10px] text-slate-400 truncate">${esc(i.setName || "")}${i.rarity ? ` · ${esc(i.rarity)}` : ""}${i.portfolioItemId ? ` · <span class="text-emerald-300 font-bold">💼 aus deiner Sammlung</span>` : ""}</p>
        <div class="flex gap-1 mt-1">
          <select aria-label="Zustand" onchange="PS.quickListSet(${u}, 'condition', this.value)" class="${selCls} flex-1 min-w-0">${Object.entries(CONDS).map(([k, l]) => `<option value="${k}" ${k === r.condition ? "selected" : ""}>${l}</option>`).join("")}</select>
          <select aria-label="Variante" onchange="PS.quickListSet(${u}, 'variant', this.value)" class="${selCls} flex-1 min-w-0">${VARIANT_KEYS.map((k) => `<option value="${k}" ${k === r.variant ? "selected" : ""}>${esc(VARIANT_LABEL[k])}</option>`).join("")}</select>
        </div>
      </div>
      <div class="shrink-0 w-28 text-right">
        <label class="sr-only" for="ql-price-${r.uid}">Preis in Euro</label>
        <div class="relative">
          <input id="ql-price-${r.uid}" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${fmtInput(r.price)}" placeholder="Preis"
            oninput="PS.quickListPrice(${u}, this.value)" onfocus="this.select()"
            class="w-full bg-slate-900 border-2 border-emerald-500/60 focus:border-emerald-300 rounded-xl pl-2 pr-6 py-2 text-base font-black text-emerald-300 text-right outline-none" />
          <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-400 pointer-events-none">€</span>
        </div>
        <button onclick="PS.quickListRemove(${u})" class="mt-1 text-[10px] text-slate-500 hover:text-rose-300 underline">entfernen</button>
      </div>
    </div>
    ${i.photo ? `<label class="flex items-center gap-1.5 text-[10px] text-slate-300"><input type="checkbox" ${r.usePhoto ? "checked" : ""} onchange="PS.quickListPhoto(${u}, this.checked)" class="accent-cyan-400" /> 📷 Mein Scan-Foto im Inserat zeigen (Käufer sehen den echten Zustand)</label>` : ""}
    <div id="ql-hint-${r.uid}" class="text-[10px]"></div>
    <div id="ql-prev-${r.uid}" class="${r.preview ? "" : "hidden"}"></div>
  </div>`;
}

/** Swipe-Vorschau: genau so sehen Käufer die Karte im Swipe-Radar (Bild, Etikett mit Preis-Ampel, Zustand, Knöpfe). */
function previewHtml(r) {
  const i = r.info;
  const img = r.usePhoto && i.photo ? i.photo : cdn(i.image || FALLBACK_IMG, 320);
  const market = r.sug?.fair || Number(i.price) || null;
  const cond = CONDITION_INFO[r.condition];
  const buyNow = Boolean(state.me?.sellerReady && ql.prefs.buyNow !== false);
  const ship = buyNow ? Math.round((parsePrice(ql.prefs.ship) ?? 0) * 100) : 0;
  return `<div class="mt-1 bg-gradient-to-b from-slate-900 to-slate-950 border border-yellow-400/40 rounded-2xl p-3 space-y-2">
    <p class="text-[10px] font-black uppercase text-yellow-300 text-center">👁️ Vorschau im Swipe-Radar</p>
    <div class="relative mx-auto w-40">
      <img src="${esc(img)}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="w-40 h-56 ${r.usePhoto && i.photo ? "object-cover" : "object-contain"} rounded-xl bg-slate-900 shadow-2xl" />
      ${i.photo && r.usePhoto ? `<span class="absolute top-1 left-1 text-[9px] font-black bg-emerald-500 text-slate-950 px-1.5 py-0.5 rounded-full">📷 Frisch gescannt</span>` : ""}
      <div class="absolute -bottom-2 -left-3 ps-price-tag-tilt">${r.price ? priceTagHtml({ price: r.price, market, condition: r.condition, shippingCents: ship, label: buyNow ? "Sofort" : "Preis" }, "lg") : ""}</div>
    </div>
    <p class="text-center text-xs font-black text-white pt-2 truncate">${esc(i.name)} ${esc(i.number || "")}</p>
    <p class="text-center text-[10px] text-cyan-200">${esc(`Verkauft von ${state.me?.displayName || "dir"}`)}${cond ? ` • ${esc(cond.label)}` : ""}</p>
    <div class="grid grid-cols-[auto_1fr_auto] gap-2 items-center opacity-80 pointer-events-none" aria-hidden="true">
      <span class="w-9 h-9 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">❌</span>
      <span class="bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-black text-[11px] py-2 rounded-xl text-center">${r.price ? `🛒 ${buyNow ? "Kaufen" : "Anfragen"} · ${eur(r.price + ship / 100)}` : "🛒 Kaufen"}</span>
      <span class="w-9 h-9 rounded-full bg-rose-500 border border-rose-300 flex items-center justify-center">❤️</span>
    </div>
  </div>`;
}

function hintHtml(r) {
  if (r.status === "done") return `<p class="text-emerald-300 font-black">✅ Inseriert</p>`;
  if (r.loading) return `<p class="text-slate-500">⏳ Berechne fairen Preis …</p>`;
  const s = r.sug;
  if (!s?.fair) return `<p class="text-amber-300">Noch kein Marktpreis bekannt – bitte selbst eintragen.</p>`;
  const u = jsArg(r.uid);
  const chip = (label, v, on) => `<button type="button" onclick="PS.quickListUse(${u}, ${Number(v)})" class="px-1.5 py-0.5 rounded-md font-black ${on ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-200"}">${label} ${eur(v)}</button>`;
  const cur = r.price;
  const parts = [];
  if (s.low && s.high && s.high > s.low) parts.push(`Spanne ${eur(s.low)}–${eur(s.high)}`);
  if (s.sampleSize) parts.push(`${s.sampleSize} echte Verkäufe`);
  else if (s.basis === "reference" || s.basis === "valuation") parts.push("Cardmarket-Referenz");
  else if (s.basis === "scan") parts.push("Scan-Marktpreis");
  if (s.activeCount) parts.push(`${s.activeCount} andere Inserate ab ${eur(s.activeLow)}`);
  let warn = "";
  if (cur !== null && s.fair) {
    const ratio = cur / s.fair;
    if (ratio < 0.7) warn = `<span class="text-amber-300 font-bold">⚠️ deutlich unter Marktwert</span>`;
    else if (ratio > 1.25) warn = `<span class="text-amber-300 font-bold">⚠️ über Marktwert – verkauft sich langsamer</span>`;
  }
  return `<div class="flex flex-wrap items-center gap-1">
      ${chip("⚖️ Fair", s.fair, cur === s.fair)}
      ${s.quick && s.quick < s.fair ? chip("⚡ Schnell", s.quick, cur === s.quick) : ""}
      ${r.touched ? `<button type="button" onclick="PS.quickListUse(${u}, ${Number(suggested(r))})" class="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300">↺ Vorschlag</button>` : ""}
      ${warn}
    </div>
    <p class="text-slate-500 mt-0.5">${parts.map(esc).join(" · ")}</p>`;
}

function paintRow(r) {
  const h = $(`ql-hint-${r.uid}`);
  if (h) h.innerHTML = hintHtml(r);
  const inp = $(`ql-price-${r.uid}`);
  // Feld nur überschreiben, wenn der Nutzer gerade nicht darin tippt
  if (inp && document.activeElement !== inp) inp.value = fmtInput(r.price);
  const box = $(`ql-${r.uid}`);
  if (box) box.classList.toggle("opacity-50", r.status === "done");
  paintTag(r);
  paintPreview(r);
}

function paintPreview(r) {
  const p = $(`ql-prev-${r.uid}`);
  if (!p) return;
  p.classList.toggle("hidden", !r.preview);
  p.innerHTML = r.preview ? previewHtml(r) : "";
}

/** Etikett auf dem Vorschaubild – genau so erscheint die Karte im Swipe-Radar */
function paintTag(r) {
  const t = $(`ql-tag-${r.uid}`);
  if (t) t.innerHTML = r.price ? priceTagHtml({ price: r.price, condition: r.condition }, "sm") : "";
}

function paintSummary() {
  const open = ql.rows.filter((r) => r.status !== "done");
  const ready = open.filter((r) => r.price !== null && r.price > 0);
  const total = ready.reduce((s, r) => s + r.price, 0);
  const head = $("ql-head");
  if (head) head.textContent = `${open.length} Karte${open.length === 1 ? "" : "n"} • ${eur(total)}`;
  const b = $("ql-submit");
  if (b) {
    b.disabled = ql.busy || !ready.length;
    b.textContent = ql.busy ? "⏳ Wird veröffentlicht …"
      : ql.countdown > 0 ? `⚡ Geht in ${ql.countdown} s live • ${eur(total)} – jetzt sofort`
      : ready.length ? `🚀 ${ready.length === 1 ? "Jetzt inserieren" : `Alle ${ready.length} inserieren`} • ${eur(total)}` : "Preis eintragen, um zu inserieren";
  }
  const cd = $("ql-countdown");
  if (cd) {
    cd.classList.toggle("hidden", !(ql.countdown > 0));
    const bar = $("ql-countdown-bar");
    if (bar) bar.style.width = `${Math.max(0, (ql.countdown / INSTANT_SECONDS) * 100)}%`;
  }
  const miss = $("ql-missing");
  if (miss) miss.textContent = open.length > ready.length ? `${open.length - ready.length} Karte(n) ohne Preis werden übersprungen.` : "";
}

function render() {
  const ready = Boolean(state.me?.sellerReady);
  const stratBtn = (k, label) => `<button type="button" onclick="PS.quickListStrategy('${k}')" data-ql-strat="${k}" class="flex-1 text-[11px] font-black px-2 py-2 rounded-xl ${ql.strategy === k ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-200"}">${label}</button>`;
  modal(MODAL_ID, `<div class="space-y-3">
    <div>
      <h3 class="text-base font-black text-white">🏷️ Schnell-Inserieren</h3>
      <p class="text-[11px] text-slate-400"><span id="ql-head" class="font-black text-emerald-300"></span> · Fairer Preis ist schon eingetragen – tippe ins Preisfeld, um ihn direkt zu ändern. 👁️ aufs Bild = Swipe-Vorschau.</p>
    </div>
    <div class="grid grid-cols-2 gap-2 text-[11px]">
      <label class="space-y-1"><span class="text-slate-400 font-bold">Zustand für alle</span>
        <select id="ql-cond-all" onchange="PS.quickListConditionAll(this.value)" class="w-full ${selCls}">${Object.entries(CONDS).map(([k, l]) => `<option value="${k}" ${k === ql.condition ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="space-y-1"><span class="text-slate-400 font-bold block">Preis-Strategie</span>
        <div class="flex gap-1">${stratBtn("fair", "⚖️ Fair")}${stratBtn("quick", "⚡ Schnell")}</div></div>
    </div>
    <div id="ql-rows" class="space-y-2 max-h-[52vh] overflow-y-auto pr-0.5">${ql.rows.map(rowHtml).join("")}</div>
    <details class="text-[11px] bg-slate-950 border border-slate-800 rounded-2xl p-2">
      <summary class="font-bold text-slate-300 cursor-pointer">Weitere Angaben (Stadt, Tauschwunsch${ready ? ", Sofort-Kauf" : ""})</summary>
      <div class="space-y-1.5 mt-2">
        <input id="ql-city" maxlength="60" value="${esc(ql.prefs.city || state.me?.city || "")}" placeholder="Stadt" oninput="PS.quickListCancel()" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
        <input id="ql-want" maxlength="120" value="${esc(ql.prefs.want || "Verkauf / Tausch")}" placeholder="Suche im Tausch" oninput="PS.quickListCancel()" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
        ${ready ? `<label class="flex gap-2 items-center"><input type="checkbox" id="ql-buynow" ${ql.prefs.buyNow !== false ? "checked" : ""} onchange="PS.quickListCancel()" class="accent-cyan-400"><span class="text-white font-bold">🔒 Sofort-Kauf mit Käuferschutz</span></label>
          <label class="flex gap-2 items-center"><span class="text-slate-400">Versand je Karte (€)</span><input id="ql-ship" type="text" inputmode="decimal" value="${esc(ql.prefs.ship || "1,95")}" oninput="PS.quickListCancel()" class="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white" /></label>`
          : `<button type="button" onclick="PS.openSeller()" class="text-cyan-300 underline font-bold">Verkäuferkonto einrichten, um Sofort-Kauf zu aktivieren →</button>`}
      </div>
    </details>
    <div id="ql-countdown" class="hidden space-y-1">
      <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div id="ql-countdown-bar" class="h-full bg-gradient-to-r from-yellow-300 to-emerald-400 transition-all duration-1000 ease-linear" style="width:100%"></div></div>
      <p class="text-[10px] text-slate-300 text-center">⚡ 1-Tap-Verkauf: Preis oder Zustand antippen, um noch etwas zu ändern – <button type="button" onclick="PS.quickListCancel()" class="underline font-bold text-yellow-300">Countdown stoppen</button></p>
    </div>
    <button id="ql-submit" onclick="PS.quickListSubmit()" class="w-full bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 font-black text-sm py-3 rounded-2xl shadow-lg disabled:opacity-50"></button>
    <p id="ql-missing" class="text-[10px] text-amber-300 text-center"></p>
    <p class="text-[10px] text-slate-500">Preisvorschlag aus der eigenen PokeSwipe-Preisdatenbank: Cardmarket-Referenz, echte eBay- und PokeSwipe-Verkäufe im gewählten Zustand sowie aktuelle Inserate anderer Verkäufer.</p>
  </div>`, { wide: true });
  ql.rows.forEach(paintRow);
  paintSummary();
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------
function setField(uid, field, value) {
  const r = rowOf(uid);
  if (!r || r.status === "done") return;
  cancelInstant();
  if (field === "condition" && CONDS[value]) r.condition = value;
  else if (field === "variant" && VARIANT_KEYS.includes(value)) r.variant = value;
  else return;
  // Zustand/Variante ändern = neuer fairer Preis (bewusste Änderung, daher Vorschlag übernehmen)
  r.touched = false;
  loadSuggestions([r]);
}

function setPrice(uid, value) {
  const r = rowOf(uid);
  if (!r) return;
  cancelInstant();
  r.price = parsePrice(value);
  r.touched = true;
  const h = $(`ql-hint-${r.uid}`);
  if (h) h.innerHTML = hintHtml(r);
  paintTag(r);
  paintPreview(r);
  paintSummary();
}

function usePrice(uid, v) {
  const r = rowOf(uid);
  if (!r || !(Number(v) > 0)) return;
  cancelInstant();
  r.price = Math.round(Number(v) * 100) / 100;
  r.touched = false;
  haptic("select");
  const inp = $(`ql-price-${r.uid}`);
  if (inp) inp.value = fmtInput(r.price);
  paintRow(r); paintSummary();
}

function setStrategy(k) {
  if (k !== "fair" && k !== "quick") return;
  cancelInstant();
  ql.strategy = k; savePrefs();
  document.querySelectorAll("[data-ql-strat]").forEach((b) => {
    const on = b.dataset.qlStrat === k;
    b.classList.toggle("bg-emerald-500", on); b.classList.toggle("text-slate-950", on);
    b.classList.toggle("bg-slate-800", !on); b.classList.toggle("text-slate-200", !on);
  });
  for (const r of ql.rows) if (!r.touched && r.status !== "done" && r.sug) r.price = suggested(r);
  ql.rows.forEach(paintRow); paintSummary();
}

function setConditionAll(v) {
  if (!CONDS[v]) return;
  cancelInstant();
  ql.condition = v; savePrefs();
  const changed = ql.rows.filter((r) => r.status !== "done" && r.condition !== v);
  for (const r of changed) {
    r.condition = v; r.touched = false;
    const sel = document.querySelector(`#ql-${r.uid} select[aria-label="Zustand"]`);
    if (sel) sel.value = v;
  }
  // in Blöcken, damit 60 Karten nicht 60 Anfragen werden
  for (let i = 0; i < changed.length; i += 60) loadSuggestions(changed.slice(i, i + 60));
}

function removeRow(uid) {
  cancelInstant();
  ql.rows = ql.rows.filter((r) => r.uid !== uid);
  $(`ql-${uid}`)?.remove();
  if (!ql.rows.length) { closeModalEl(MODAL_ID); return; }
  paintSummary();
}

function itemFor(r, extra) {
  const i = r.info;
  const name = `${i.name}${i.number ? ` ${i.number}` : ""}`.slice(0, 120);
  const ref = i.kind === "print" ? { printId: i.id } : { cardId: i.id };
  const photo = r.usePhoto && typeof i.photo === "string" && i.photo.startsWith("data:image/") ? { img: i.photo } : {};
  const link = Number(i.portfolioItemId) > 0 ? { portfolioItemId: Number(i.portfolioItemId) } : {};
  // Herkunft „scan“ nur für echte Scans (Swipe-Radar zeigt „Frisch gescannt“) – Sammlung/Katalog bleiben normale Inserate
  const source = i.source && i.source !== "scan" ? {} : { source: "scan" };
  return { ...ref, card: name, price: r.price.toFixed(2), condition: r.condition, variant: r.variant, lang: i.lang || "de", ...source, ...photo, ...link, ...extra };
}

async function submit() {
  if (ql.busy) return;
  if (IS_STAGE) return demoSubmit();
  if (!requireLogin()) return;
  stopCountdown(); ql.instant = false;
  const todo = ql.rows.filter((r) => r.status !== "done" && r.price !== null && r.price > 0);
  if (!todo.length) { toast("Preis fehlt", "Trage für mindestens eine Karte einen Preis ein."); return; }
  const buyNow = Boolean($("ql-buynow")?.checked && state.me?.sellerReady);
  const ship = buyNow ? Math.round((parsePrice($("ql-ship")?.value) ?? 0) * 100) : 0;
  const extra = { city: $("ql-city")?.value || "", want: $("ql-want")?.value || "Verkauf / Tausch", buyNow, shippingCents: ship };
  // Angaben fürs nächste Mal merken (so bleibt es beim nächsten Scan bei einem Tipp)
  ql.prefs = { city: extra.city.slice(0, 60), want: extra.want.slice(0, 120), buyNow: $("ql-buynow") ? Boolean($("ql-buynow").checked) : ql.prefs.buyNow !== false, ship: String($("ql-ship")?.value ?? ql.prefs.ship ?? "1,95").slice(0, 6) };
  savePrefs();
  ql.busy = true; paintSummary();
  let created = 0, skipped = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    try {
      const r = await api("/api/listings", { method: "POST", body: { items: chunk.map((row) => itemFor(row, extra)) } });
      const n = Number(r.created) || 0;
      created += n; skipped += Number(r.skipped) || 0;
      for (const l of r.listings || []) if (Number(l?.id) > 0) ql.lastIds.push(Number(l.id));
      // Server übernimmt der Reihe nach (bis zum Limit) – genau diese als erledigt markieren
      chunk.slice(0, n).forEach((row) => { row.status = "done"; paintRow(row); });
      if (n < chunk.length) break;
    } catch (e) { handleError(e); break; }
  }
  ql.busy = false;
  if (created) {
    haptic("success");
    window.dispatchEvent(new CustomEvent("ps:quickstart", { detail: "listing" }));
    toast(`🚀 ${created} Inserat${created === 1 ? "" : "e"} live`, skipped ? `${skipped} übersprungen (Inserat-Limit deines Tarifs).` : "Deine Karten sind jetzt im Tausch-Hub.");
    window.PS?.loadListings?.(); window.PS?.refreshMe?.(); window.PS?.loadMyListings?.();
  }
  const rest = ql.rows.filter((r) => r.status !== "done");
  if (!rest.length) { if (created) showDone(created); else closeModalEl(MODAL_ID); return; }
  // Erledigte ausblenden, Rest bleibt zum Nachbessern stehen
  ql.rows.filter((r) => r.status === "done").forEach((r) => $(`ql-${r.uid}`)?.remove());
  ql.rows = rest;
  paintSummary();
}

/** Aufnahme-Modus: gleicher Ablauf und gleiche Erfolgsansicht, aber ohne Anfrage an /api/listings. */
async function demoSubmit() {
  stopCountdown(); ql.instant = false;
  const todo = ql.rows.filter((r) => r.status !== "done" && r.price > 0);
  if (!todo.length) return;
  ql.busy = true; paintSummary();
  await new Promise((r) => setTimeout(r, 450));
  ql.busy = false;
  todo.forEach((r) => { r.status = "done"; });
  showDone(todo.length, { protect: true });
}

/** Erfolg: direkt in den Swipe-Radar springen und die eigenen Etiketten so sehen wie Käufer */
function showDone(n, { protect = false } = {}) {
  // Sofort-Kauf-Inserate laufen über Stripe-Käuferschutz (Treuhand) und bekommen beim Verkauf automatisch ein DHL-Etikett
  const safe = protect || Boolean(ql.prefs.buyNow !== false && state.me?.sellerReady);
  modal(MODAL_ID, `<div class="space-y-3 text-center py-2">
    <p class="text-4xl" aria-hidden="true">🚀</p>
    <h3 class="text-base font-black text-white">${n} Karte${n === 1 ? " ist" : "n sind"} live</h3>
    ${safe ? `<div id="ql-done-protect" class="grid grid-cols-2 gap-2 text-[11px] font-black">
      <span class="bg-emerald-500/15 border border-emerald-400/60 text-emerald-200 rounded-xl px-2 py-2">🔒 Stripe-Käuferschutz aktiv</span>
      <span class="bg-yellow-400/15 border border-yellow-400/60 text-yellow-200 rounded-xl px-2 py-2">📦 DHL-Etikett per Klick aus der Bestellung</span>
    </div>` : ""}
    <p class="text-xs text-slate-300">Deine Karten erscheinen jetzt mit Preis-Etikett, Zustand und Foto im Swipe-Radar. Käufer wischen mit ❌ weiter, tippen auf 🛒 Kaufen oder merken sie mit ❤️ – du wirst benachrichtigt.</p>
    <div class="grid grid-cols-2 gap-2">
      <button onclick="PS.quickListGo('swipe')" class="bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black text-xs py-2.5 rounded-xl">🃏 Marktplatz durchswipen</button>
      <button onclick="PS.quickListGo('scan')" class="bg-slate-800 text-white font-black text-xs py-2.5 rounded-xl">📷 Weiter scannen</button>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <button onclick="PS.quickListGo('mine')" class="bg-slate-800 text-white font-bold text-[11px] py-2 rounded-xl">📋 Meine Inserate</button>
      ${ql.lastIds.length ? `<button id="ql-undo" onclick="PS.quickListUndo()" class="bg-rose-500/20 text-rose-200 font-bold text-[11px] py-2 rounded-xl">↩️ Rückgängig</button>` : ""}
    </div>
  </div>`);
}

/** Versehentlich inseriert? Alle Inserate des letzten Vorgangs wieder entfernen. */
async function undoLast() {
  const ids = ql.lastIds.splice(0);
  if (!ids.length) return;
  const b = $("ql-undo");
  if (b) { b.disabled = true; b.textContent = "⏳ Wird entfernt …"; }
  let n = 0;
  for (const id of ids) {
    try { await api(`/api/listings/${id}/status`, { method: "POST", body: { status: "removed" } }); n++; } catch (e) { handleError(e); }
  }
  closeModalEl(MODAL_ID);
  toast("↩️ Rückgängig gemacht", `${n} Inserat${n === 1 ? "" : "e"} entfernt.`);
  window.PS?.loadListings?.(); window.PS?.refreshMe?.(); window.PS?.loadMyListings?.();
}

export const quickListApi = {
  quickListGo: (where) => {
    closeModalEl(MODAL_ID);
    if (where === "swipe") window.PS?.arenaMarket?.();
    else if (where === "scan") window.PS?.openLiveScanner?.();
    else if (where === "mine") window.PS?.showSub?.("map", "market");
  },
  quickListPreview: (uid) => {
    const r = rowOf(uid);
    if (!r) return;
    r.preview = !r.preview;
    haptic("select");
    paintPreview(r);
  },
  quickListCancel: cancelInstant,
  quickListUndo: undoLast,
  quickListPhoto: (uid, on) => {
    const r = rowOf(uid);
    if (!r?.info.photo) return;
    cancelInstant();
    r.usePhoto = Boolean(on);
    const img = $(`ql-img-${r.uid}`);
    if (img) {
      img.src = r.usePhoto ? r.info.photo : cdn(r.info.image || FALLBACK_IMG, 120);
      img.classList.toggle("object-cover", r.usePhoto); img.classList.toggle("object-contain", !r.usePhoto);
    }
    paintPreview(r);
  },
  quickListSet: setField,
  quickListPrice: setPrice,
  quickListUse: usePrice,
  quickListStrategy: setStrategy,
  quickListConditionAll: setConditionAll,
  quickListRemove: removeRow,
  quickListSubmit: submit,
};
