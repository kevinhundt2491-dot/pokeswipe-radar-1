// PokeSwipe & Radar – dynamische Swipe-Arena
// Speist den Swipe-Stapel direkt aus dem mehrsprachigen Live-Katalog (de/en/ja), aus Tausch-Inseraten und der
// Wunschliste. Filter: Sprache, Set, Seltenheit, Preisspanne, Wunschliste, „Nur Unter-Marktwert-Deals“.
// Ohne Verbindung bleibt der feste Chase-Katalog aus index.html als Stapel aktiv.
import { $, esc, jsArg, safeUrl, eur, toast, cm, cdn, FALLBACK_IMG, state, api, handleError, requireLogin, modal, closeModalEl, btn, sparkline } from "./core.js";
import { updatePrefs, encodePrefParam, prefSummary, sanitizeScores, COLD_START_SWIPES } from "../server/arena-logic.ts";
import { haptic } from "./native.js";
import { priceTagHtml, dealRating, CONDITION_INFO } from "./price-tag.js";
import { priceDisplay } from "../server/price-display-logic.ts";

const STORE_KEY = "ps_arena_filters";
const PREF_KEY = "ps_arena_prefs";
const SEEN_KEY = "ps_arena_seen";
const LANGS = [
  { lang: "de", flag: "🇩🇪", short: "DE", label: "Deutsch" },
  { lang: "en", flag: "🇬🇧", short: "EN", label: "Englisch" },
  { lang: "ja", flag: "🇯🇵", short: "JP", label: "Japanisch" },
];
const FLAG = Object.fromEntries(LANGS.map((l) => [l.lang, l.flag]));
const RARITIES = [
  ["hits", "Alle Hits (ab Selten)"], ["sir", "Special Illustration Rare"], ["ir", "Illustration Rare"], ["hyper", "Hyper / Gold / Secret"],
  ["ultra", "Ultra / Doppelselten / ex"], ["rare", "Selten & Holo"], ["common", "Häufig & Nicht so häufig"], ["any", "Alle Seltenheiten"],
];
const DEFAULTS = { langs: ["de", "en", "ja"], set: "", rarity: "hits", min: "", max: "", wish: false, deals: false, listings: true, market: false };

let filters = loadFilters();
let loading = false;
let lastLoadAt = 0;
let setCache = {};
let drawerOpen = false;
let usingLive = false;
/** Frisch gescannte Karte: bleibt oben im Stapel, auch wenn der Stapel danach (neu) geladen wird */
let pinnedScan = null;

function loadFilters() {
  try {
    const f = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!f || typeof f !== "object") return { ...DEFAULTS };
    const langs = Array.isArray(f.langs) ? f.langs.filter((l) => FLAG[l]) : DEFAULTS.langs;
    return {
      langs: langs.length ? langs : DEFAULTS.langs,
      set: typeof f.set === "string" && /^(de|en|ja):[A-Za-z0-9.\-_]{1,40}$/.test(f.set) ? f.set : "",
      rarity: RARITIES.some(([k]) => k === f.rarity) ? f.rarity : DEFAULTS.rarity,
      min: /^\d{0,6}([.,]\d{1,2})?$/.test(String(f.min ?? "")) ? String(f.min ?? "") : "",
      max: /^\d{0,6}([.,]\d{1,2})?$/.test(String(f.max ?? "")) ? String(f.max ?? "") : "",
      wish: !!f.wish, deals: !!f.deals, listings: f.listings !== false, market: !!f.market,
    };
  } catch { return { ...DEFAULTS }; }
}
const saveFilters = () => localStorage.setItem(STORE_KEY, JSON.stringify(filters));

/** Von außen (Onboarding) gesetzte Vorgaben übernehmen und den Stapel neu laden. */
export function applyArenaPreset(preset = {}) {
  filters = { ...filters, ...preset };
  if (!filters.langs?.length) filters.langs = [...DEFAULTS.langs];
  saveFilters();
  renderFilterBar();
  reloadDeck();
}

function seenList() {
  try { const v = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function markSeen(key) {
  if (!key) return;
  const list = seenList().filter((k) => k !== key);
  list.push(String(key));
  sessionStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-100)));
}

// ---------------------------------------------------------------------------
// Preference-Learning: jeder Rechts-/Links-Swipe verändert die Gewichte für Seltenheit, Sprache, Set und Preisband.
// Ohne Konto bleibt das Profil auf dem Gerät (und geht als ?pw=… an den Server), mit Konto wird es serverseitig gespeichert.
// ---------------------------------------------------------------------------
let prefs = loadPrefs();
let pendingEvents = [];
let flushTimer = null;
let swipesSinceReload = 0;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    if (p && typeof p === "object") return { scores: sanitizeScores(p.scores), swipes: Number(p.swipes) || 0, likes: Number(p.likes) || 0 };
  } catch {}
  return { scores: {}, swipes: 0, likes: 0 };
}
const savePrefs = () => localStorage.setItem(PREF_KEY, JSON.stringify(prefs));

function featureEvent(item, dir) {
  return {
    dir, lang: item.lang || "de", rarity: item.rarityBucket || null,
    set: item.setId ? `${item.lang || "de"}:${item.setId}` : null, price: Number(item.cm) || 0,
  };
}

async function flushEvents() {
  clearTimeout(flushTimer); flushTimer = null;
  if (!state.user || !pendingEvents.length) { pendingEvents = []; return; }
  const events = pendingEvents.splice(0, 50);
  try {
    const r = await api("/api/swipe/feedback", { method: "POST", body: { events, device: prefs } });
    if (r?.profile) { prefs = { scores: sanitizeScores(r.profile.scores), swipes: Number(r.profile.swipes) || 0, likes: Number(r.profile.likes) || 0 }; savePrefs(); }
  } catch { /* nächster Versuch beim nächsten Swipe */ }
}

function onSwipe(item, dir) {
  if (pinnedScan && item?.key === pinnedScan.key) pinnedScan = null;
  if (!item || item.kind === "listing" && dir === "detail") return;
  // Haptik: Merken spürbar, Weiter leicht; echte Unter-Marktwert-Deals mit Erfolgs-Feedback
  if (dir === "right") haptic(Number(item.cm) > 0 && Number(item.price) > 0 && Number(item.price) <= Number(item.cm) * 0.85 ? "success" : "medium");
  else if (dir === "left") haptic("light");
  const ev = featureEvent(item, dir);
  prefs = updatePrefs(prefs, [ev]);
  savePrefs();
  if (state.user) {
    pendingEvents.push(ev);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushEvents, pendingEvents.length >= 8 ? 0 : 4000);
  }
  if (dir !== "detail") swipesSinceReload++;
  renderTaste();
  // Sobald genug gelernt ist, den Stapel einmal neu (personalisiert) laden
  if (prefs.swipes === COLD_START_SWIPES && usingLive) { swipesSinceReload = 0; loadMore(); }
}

function renderTaste() {
  const el = $("arena-taste");
  if (!el) return;
  const s = prefSummary(prefs);
  if (s.learning) {
    el.innerHTML = `🧠 Lerne deinen Geschmack … noch ${Math.max(0, COLD_START_SWIPES - s.swipes)} Swipes`;
    return;
  }
  const likes = s.likesTop.map((x) => esc(x.label)).join(", ");
  el.innerHTML = `🧠 Für dich gewichtet${likes ? `: mehr ${likes}` : ""}${s.dislikes.length ? ` • weniger ${s.dislikes.map((x) => esc(x.label)).join(", ")}` : ""}
    <button type="button" onclick="PS.arenaResetTaste()" class="underline text-slate-500 ml-1">zurücksetzen</button>`;
}

async function resetTaste() {
  prefs = { scores: {}, swipes: 0, likes: 0 };
  savePrefs();
  pendingEvents = [];
  if (state.user) { try { await api("/api/swipe/prefs", { method: "DELETE" }); } catch {} }
  renderTaste();
  reloadDeck();
  toast("🧠 Geschmack zurückgesetzt", "Die Arena lernt ab jetzt neu aus deinen Swipes.");
}

function deckQuery(excludeSeen = true, withTotal = false) {
  const p = new URLSearchParams();
  if (withTotal) p.set("count", "1");
  if (prefs.swipes) p.set("pw", encodePrefParam(prefs));
  p.set("lang", filters.langs.join(","));
  if (filters.set) p.set("set", filters.set);
  p.set("rarity", filters.rarity || "hits");
  if (filters.min) p.set("min", String(filters.min).replace(",", "."));
  if (filters.max) p.set("max", String(filters.max).replace(",", "."));
  if (filters.wish) p.set("wish", "1");
  if (filters.deals) p.set("deals", "1");
  if (!filters.listings) p.set("listings", "0");
  if (filters.market) p.set("market", "1");
  p.set("limit", "30");
  if (excludeSeen) {
    const seen = seenList().slice(-60);
    if (seen.length) p.set("exclude", seen.join(","));
  }
  return p.toString();
}

const ebayLangHint = { de: "", en: " english", ja: " japanese" };

/** Server-Antwort → Format des Swipe-Stapels in index.html (title/setFull/cm/price/img/query + Zusatzfelder). */
function toDeckItem(it) {
  const number = it.number ? ` (${it.number})` : "";
  const title = `${it.name}${it.altName ? ` · ${it.altName}` : ""}${number}`;
  const isListing = it.kind === "listing";
  const setFull = [FLAG[it.lang] || "", it.setName || "", it.setCode && it.setCode !== it.setId ? `· ${it.setCode}` : ""].filter(Boolean).join(" ");
  return {
    kind: it.kind,
    key: it.key,
    id: it.cardId || it.printId || it.key,
    lang: it.lang || "de",
    printId: it.printId || null,
    cardId: it.cardId || null,
    listingId: it.listingId || null,
    variant: it.variant || "normal",
    condition: it.condition || "",
    liked: Boolean(it.liked),
    title,
    setTag: it.setName || "",
    setFull: isListing ? `${setFull}${it.setName ? "" : "Tausch-Hub"}` : setFull,
    rarity: it.rarity || (isListing ? "Tausch-Inserat" : "Karte"),
    cm: Number(it.price) || 0,
    // Nur echte Angebote: Inseratspreis bzw. verifiziertes Live-Angebot (eBay-Radar / PokeSwipe-Sofortkauf).
    // Der Cardmarket-„ab“-Preis (it.low) ist nur eine Info und wird nie als Kaufpreis oder Rabatt angezeigt.
    price: Number(it.offer) || 0,
    offerSource: isListing ? "pokeswipe" : it.offerSource || null,
    offerUrl: it.offerUrl || null,
    offerListingId: it.offerListingId || null,
    cmLow: Number(it.low) || 0,
    img: it.image || FALLBACK_IMG,
    query: `${it.name}${it.number ? ` ${it.number}` : ""}${ebayLangHint[it.lang] || ""}`.trim(),
    usd: it.usd || null,
    source: it.source,
    dealPct: Number(it.dealPct) || 0,
    wish: !!it.wish,
    seller: it.seller || "",
    city: it.city || "",
    want: it.want || "",
    boosted: !!it.boosted,
    buyNow: !!it.buyNow,
    shippingCents: Number(it.shippingCents) || 0,
    photo: !!it.photo,
    catalogImage: it.catalogImage || "",
    scanned: !!it.scanned,
    fresh: !!it.fresh,
    rarityBucket: it.rarityBucket || null,
    setId: it.setId || null,
  };
}

function setStatus(text, tone = "slate") {
  const el = $("arena-status");
  if (!el) return;
  el.textContent = text;
  el.className = `text-[11px] font-bold ${tone === "warn" ? "text-amber-300" : tone === "ok" ? "text-emerald-300" : "text-slate-400"}`;
  el.classList.toggle("hidden", !text);
}

async function fetchDeck(append) {
  // Nachladen überspringen, wenn schon geladen wird; ein Neuladen (Filterwechsel) wartet auf die laufende Anfrage
  if (loading && append) return null;
  while (loading) await new Promise((r) => setTimeout(r, 80));
  loading = true;
  try {
    const res = await api(`/api/swipe/deck?${deckQuery(true, !append)}`);
    let items = (res.items || []).map(toDeckItem).filter((i) => i.img);
    // Alles schon gesehen? Dann ohne Ausschluss erneut mischen
    if (!items.length && seenList().length && !append) {
      sessionStorage.removeItem(SEEN_KEY);
      const again = await api(`/api/swipe/deck?${deckQuery(false)}`);
      items = (again.items || []).map(toDeckItem).filter((i) => i.img);
    }
    return { items, wishlistEmpty: !!res.wishlistEmpty, total: Number.isFinite(res.total) ? res.total : null };
  } finally {
    loading = false;
  }
}

const fmtCount = (n) => Number(n).toLocaleString("de-DE");
let retryTimer = null;
let retryCount = 0;

export async function reloadDeck() {
  clearTimeout(retryTimer); retryTimer = null;
  setStatus("⏳ Lade Karten aus dem Live-Katalog …");
  try {
    const res = await fetchDeck(false);
    if (!res) return;
    lastLoadAt = Date.now();
    if (!res.items.length) {
      setStatus(res.wishlistEmpty
        ? "Deine Wunschliste ist noch leer – merke dir Karten mit 💚 oder füge sie in der Sammlung hinzu."
        : filters.market
          ? "Gerade keine passenden Inserate. Tipp: Filter lockern – oder eigene Karten scannen und inserieren (📷 Scanner → 🏷️ Alle inserieren)."
          : "Keine Karten für diese Filter. Tipp: Preisspanne erweitern oder mehr Sprachen wählen.", "warn");
      return;
    }
    usingLive = window.setSwipeDeck?.(res.items, false) || false;
    if (pinnedScan) window.prependSwipeCard?.(pinnedScan);
    retryCount = 0;
    const listings = res.items.filter((i) => i.kind === "listing").length;
    const scanned = res.items.filter((i) => i.scanned && i.photo).length;
    setStatus(filters.market
      ? `🛒 ${listings} Inserate zum Durchswipen${scanned ? ` • ${scanned} mit echtem Scan-Foto` : ""}`
      : res.total
        ? `🃏 ${fmtCount(res.total)} passende Karten im Live-Katalog (${filters.langs.map((l) => LANGS.find((x) => x.lang === l)?.short || l).join("/")}) • wird beim Swipen automatisch nachgeladen${listings ? ` • ${listings} Tausch-Hub-Inserate dabei` : ""}`
        : `${res.items.length} Karten geladen${listings ? ` • ${listings} davon aus dem Tausch-Hub` : ""}`, "ok");
  } catch (e) {
    // Wunschlisten-Filter ohne (gültigen) Login: Filter zurücksetzen und normal weiterswipen
    if (e.status === 401) { filters.wish = false; saveFilters(); renderFilterBar(); setStatus("Für den Wunschlisten-Filter bitte anmelden.", "warn"); return; }
    // Kein Ausweichen auf feste Demo-Karten: der echte Katalog wird mit wachsendem Abstand erneut geladen
    retryCount++;
    const wait = Math.min(30_000, 2000 * 2 ** Math.min(retryCount - 1, 4));
    setStatus(`Live-Katalog gerade nicht erreichbar – neuer Versuch in ${Math.round(wait / 1000)} s …`, "warn");
    retryTimer = setTimeout(() => { if (!document.hidden) reloadDeck(); else retryTimer = null; }, wait);
  }
}

async function loadMore() {
  if (!usingLive || loading || Date.now() - lastLoadAt < 1500) return;
  lastLoadAt = Date.now();
  try {
    const res = await fetchDeck(true);
    if (res?.items?.length) window.setSwipeDeck?.(res.items, true);
  } catch { /* Stapel bleibt, beim nächsten Wischen erneut versuchen */ }
}

// Rechts-Wisch auf ein Tausch-Inserat = verbindlicher Like. Der Server prüft sofort auf gegenseitiges Interesse
// und liefert bei einem Match den vorausgefüllten Tauschvorschlag.
async function likeListing(item) {
  if (!state.user) { toast("🔐 Anmelden zum Tauschen", "Mit Konto wird dein Like gespeichert – bei gegenseitigem Interesse gibt es ein Match."); return; }
  try {
    const r = await api("/api/swipe/like", { method: "POST", body: { listingId: item.listingId } });
    if (r?.match?.created && r.proposal) window.PS?.openMatchProposal?.(r.proposal);
    else if (r?.match) toast("🔥 Ihr habt schon ein Match", "Öffne „Meine Matches“, um den Tausch vorzuschlagen.");
    else if (r?.new) toast("💚 Gemerkt", `${item.seller || "Der Sammler"} sieht dein Interesse, sobald er auch etwas von dir sucht.`);
  } catch (e) {
    if (e.status === 404) toast("Inserat", "Dieses Inserat ist nicht mehr verfügbar.");
    else handleError(e);
  }
}

// Rechts-Wisch („Merken“): mit Konto zusätzlich auf die Wunschliste (deutsche/englische Karten)
async function onMatch(item) {
  if (item?.kind === "listing" && item.listingId) return likeListing(item);
  if (!state.user || !item?.cardId) return;
  try {
    const r = await api("/api/wishlist", { method: "POST", body: { cardId: item.cardId } });
    if (r?.matches) toast("🔥 It's a Match!", "Ein Sammler, der diese Karte anbietet, möchte auch etwas von dir. Schau in „Meine Matches“.");
    else if (r?.offers) toast("💛 Auf der Wunschliste", `${item.title}: ${r.offers} passende${r.offers === 1 ? "s" : ""} Angebot${r.offers === 1 ? "" : "e"} im Tausch-Hub!`);
  } catch (e) {
    if (e.upgrade) toast("💛 Wunschliste voll", e.message);
  }
}

// ---------------------------------------------------------------------------
// Filterleiste
// ---------------------------------------------------------------------------
async function loadSets(lang) {
  if (setCache[lang]) return setCache[lang];
  try {
    const r = await api(`/api/swipe/sets?lang=${encodeURIComponent(lang)}`);
    setCache[lang] = (r.sets || []).filter((s) => s.priced > 0);
  } catch { setCache[lang] = []; }
  return setCache[lang];
}

function activeCount() {
  let n = 0;
  if (filters.set) n++;
  if (filters.rarity && filters.rarity !== "hits") n++;
  if (filters.min || filters.max) n++;
  if (!filters.listings) n++;
  return n;
}

function renderFilterBar() {
  const box = $("arena-filters");
  if (!box) return;
  const chip = (on, label, onclick, extra = "") => `<button type="button" onclick="${onclick}" aria-pressed="${on ? "true" : "false"}" class="ps-chip shrink-0 border border-slate-700 bg-slate-900 text-white font-bold text-xs px-3 py-1.5 rounded-xl ${extra}">${label}</button>`;
  const n = activeCount();
  box.innerHTML = `
    <div class="flex flex-wrap justify-between items-center gap-2">
      <div class="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Sprache">
        ${LANGS.map((l) => chip(filters.langs.includes(l.lang), `${l.flag} ${l.short}`, `PS.arenaLang('${l.lang}')`, "")).join("")}
      </div>
      <span id="swipe-rarity" class="text-[11px] font-black bg-yellow-400 text-slate-950 px-2.5 py-1 rounded-lg truncate max-w-[45%]">${esc(document.getElementById("swipe-rarity")?.textContent || "Karte")}</span>
    </div>
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar">
      ${chip(filters.market, "🛒 Marktplatz", "PS.arenaToggle('market')", filters.market ? "" : "border-cyan-400/50")}
      ${chip(filters.wish, "💛 Wunschliste", "PS.arenaToggle('wish')")}
      ${chip(filters.deals, "🔥 Nur Unter-Marktwert", "PS.arenaToggle('deals')")}
      ${chip(drawerOpen, `⚙️ Filter${n ? ` (${n})` : ""}`, "PS.arenaDrawer()")}
      ${n || filters.wish || filters.deals || filters.market ? chip(false, "↺ Zurücksetzen", "PS.arenaReset()", "text-slate-300") : ""}
    </div>
    <div id="arena-drawer" class="${drawerOpen ? "" : "hidden"} bg-slate-950/90 border border-slate-800 rounded-2xl p-3 grid grid-cols-2 gap-2 text-xs">
      <label class="col-span-2 sm:col-span-1 space-y-1"><span class="text-slate-400 font-bold">Set</span>
        <select id="arena-set" onchange="PS.arenaSet(this.value)" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-white"><option value="">Alle Sets</option></select></label>
      <label class="col-span-2 sm:col-span-1 space-y-1"><span class="text-slate-400 font-bold">Seltenheit</span>
        <select id="arena-rarity" onchange="PS.arenaRarity(this.value)" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-white">
          ${RARITIES.map(([k, label]) => `<option value="${k}" ${filters.rarity === k ? "selected" : ""}>${esc(label)}</option>`).join("")}
        </select></label>
      <label class="space-y-1"><span class="text-slate-400 font-bold">Preis ab (€)</span>
        <input id="arena-min" type="number" min="0" step="1" inputmode="decimal" value="${esc(filters.min)}" placeholder="0" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-white" /></label>
      <label class="space-y-1"><span class="text-slate-400 font-bold">Preis bis (€)</span>
        <input id="arena-max" type="number" min="0" step="1" inputmode="decimal" value="${esc(filters.max)}" placeholder="beliebig" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-white" /></label>
      <label class="col-span-2 flex items-center gap-2 text-slate-300"><input id="arena-listings" type="checkbox" ${filters.listings ? "checked" : ""} class="accent-yellow-400" /> Tausch-Inserate anderer Sammler in den Stapel mischen</label>
      <button type="button" onclick="PS.arenaApplyDrawer()" class="col-span-2 bg-yellow-400 text-slate-950 font-black py-2 rounded-xl">Filter anwenden</button>
    </div>
    <p id="arena-status" class="hidden"></p>
    <p id="arena-taste" class="text-[10px] text-slate-400"></p>`;
  renderTaste();
  if (drawerOpen) fillSetSelect();
}

async function fillSetSelect() {
  const sel = $("arena-set");
  if (!sel) return;
  const langs = filters.langs;
  const lists = await Promise.all(langs.map(async (l) => [l, await loadSets(l)]));
  const current = filters.set;
  sel.innerHTML = `<option value="">Alle Sets</option>` + lists.map(([l, sets]) => sets.length
    ? `<optgroup label="${esc(`${FLAG[l]} ${LANGS.find((x) => x.lang === l)?.label || l}`)}">${sets.map((s) => {
      const v = `${l}:${s.id}`;
      return `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(s.name)}${s.code && s.code !== s.id ? ` (${esc(s.code)})` : ""} – ${Number(s.priced)}</option>`;
    }).join("")}</optgroup>` : "").join("");
}

function toggleLang(lang) {
  if (!FLAG[lang]) return;
  const on = filters.langs.includes(lang);
  if (on && filters.langs.length === 1) return toast("Sprache", "Mindestens eine Sprache muss aktiv bleiben.");
  filters.langs = on ? filters.langs.filter((l) => l !== lang) : [...filters.langs, lang];
  if (filters.set && !filters.langs.includes(filters.set.split(":")[0])) filters.set = "";
  saveFilters(); renderFilterBar(); reloadDeck();
}

function toggle(key) {
  if (!["wish", "deals", "market"].includes(key)) return;
  if (key === "wish" && !filters.wish && !requireLogin()) return;
  filters[key] = !filters[key];
  saveFilters(); renderFilterBar(); reloadDeck();
}

function applyDrawer() {
  const num = (v) => { const s = String(v ?? "").trim().replace(",", "."); return /^\d{1,6}(\.\d{1,2})?$/.test(s) ? s : ""; };
  filters.rarity = $("arena-rarity")?.value || "hits";
  filters.min = num($("arena-min")?.value);
  filters.max = num($("arena-max")?.value);
  filters.listings = !!$("arena-listings")?.checked;
  const set = $("arena-set")?.value || "";
  filters.set = /^(de|en|ja):[A-Za-z0-9.\-_]{1,40}$/.test(set) ? set : "";
  drawerOpen = false;
  saveFilters(); renderFilterBar(); reloadDeck();
}

// ---------------------------------------------------------------------------
// Detailansicht englischer/japanischer Drucke (beide Preis-Feeds getrennt)
// ---------------------------------------------------------------------------
const usd = (n) => (globalThis.psLang === "en"
  ? "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $");

/**
 * „Verkaufen“-Block für Detailansichten: großes Etikett mit fairem Preis + ein Tipp zum Schnell-Inserieren
 * (oder 1-Tap mit Countdown). fn: Name der PS-Funktion, args: bereits escapte Argumentliste.
 */
export function sellBlockHtml(fn, args, price) {
  return `<div class="bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 border-2 border-emerald-400/50 rounded-2xl p-3 space-y-2">
    <div class="flex items-center gap-3">
      <div class="ps-price-tag-tilt shrink-0">${Number(price) > 0 ? priceTagHtml({ price, label: "Markt" }, "md") : `<span class="text-2xl" aria-hidden="true">🏷️</span>`}</div>
      <p class="text-[11px] text-slate-200 leading-snug"><strong class="text-white">Hast du die Karte?</strong> Fairer Preis ist schon eingetragen – in 1–2 Tipps mit Etikett im Swipe-Radar und Tausch-Hub.</p>
    </div>
    <div class="grid grid-cols-[1fr_auto] gap-2">
      <button type="button" onclick="PS.${fn}(${args})" class="bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 font-black text-xs py-2.5 rounded-xl shadow">🏷️ Jetzt verkaufen</button>
      <button type="button" onclick="PS.${fn}(${args}, 'instant')" class="bg-yellow-400 text-slate-950 font-black text-xs px-3 py-2.5 rounded-xl shadow" title="Fairer Preis, gemerkte Angaben – geht nach kurzem Countdown live">⚡ 1-Tap</button>
    </div>
  </div>`;
}

export async function openPrint(id) {
  if (!/^(en|ja):[A-Za-z0-9.\-_]{2,40}$/.test(String(id || ""))) return;
  modal("ps-card", `<p class="text-yellow-400 text-xs font-bold text-center py-6">⏳ Lade Marktpreise …</p>`);
  try {
    const { print: p, history, related, fx } = await api(`/api/prints/${encodeURIComponent(id)}`);
    const price = Number(p.priceEur) || 0;
    const avg30 = Number(p.cmAvg30) || 0;
    const ch30 = avg30 && p.priceSource === "cardmarket" && price ? ((price - avg30) / avg30) * 100 : null;
    const q = `${p.name} ${p.number || p.localId || ""}${ebayLangHint[p.lang] || ""}`.trim();
    const series = history.map((h) => Number(h.priceEur) || null).filter((v) => v);
    const rate = fx?.USD ? `1 € = ${Number(fx.USD).toLocaleString("de-DE", { maximumFractionDigits: 4 })} $${fx.day ? ` (EZB, ${new Date(fx.day).toLocaleDateString("de-DE")})` : ""}${fx.estimated ? " – geschätzt" : ""}` : "";
    modal("ps-card", `
      <div class="flex gap-4">
        <img src="${esc(cdn(p.image || FALLBACK_IMG, 320))}" onerror="this.src='${FALLBACK_IMG}'" class="w-28 sm:w-36 rounded-xl object-contain shrink-0" alt="${esc(p.name)}" />
        <div class="space-y-1 text-xs min-w-0">
          <span class="inline-block text-[10px] font-black uppercase bg-slate-800 text-slate-100 px-2 py-0.5 rounded-full">${esc(p.flag || "")} ${esc(p.langLabel || p.lang)}</span>
          <h3 class="text-base font-black text-white">${esc(p.name)}${p.number ? ` <span class="text-slate-400">${esc(p.number)}</span>` : ""}</h3>
          ${p.altName ? `<p class="text-slate-300">🇩🇪 ${p.speciesSlug ? `<a href="/pokemon/${esc(encodeURIComponent(p.speciesSlug))}" class="underline">${esc(p.altName)}</a>` : esc(p.altName)}</p>` : ""}
          <p class="text-slate-400">${esc(p.setName)}${p.setCode ? ` • ${esc(p.setCode)}` : ""}${p.rarity ? ` • ${esc(p.rarity)}` : ""}</p>
          <p class="text-2xl font-black text-emerald-400">${price ? eur(price) : "Noch kein Marktpreis"}</p>
          <p class="text-slate-400">${p.priceSource === "tcgplayer" ? "TCGplayer-Marktpreis, in Euro umgerechnet" : p.priceSource === "cardmarket" ? "Cardmarket-Trend" : "Preis wird beim nächsten Abgleich geladen"}${ch30 !== null ? ` • <span class="${ch30 >= 0 ? "text-emerald-400" : "text-rose-400"} font-bold">${ch30 > 0 ? "+" : ""}${ch30.toFixed(1).replace(".", ",")} % (30 Tage)</span>` : ""}</p>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div class="bg-slate-950 rounded-2xl p-3 border border-indigo-500/40 space-y-1">
          <p class="font-black text-indigo-300">Cardmarket (EUR)</p>
          <p class="text-white font-bold">${p.cmTrend ? `Trend ${eur(p.cmTrend)}` : "kein Preis"}</p>
          <p class="text-slate-400">CM-Tiefstpreis (alle Zustände) ${p.cmLow ? eur(p.cmLow) : "–"} • Ø 7 T ${p.cmAvg7 ? eur(p.cmAvg7) : "–"} • Ø 30 T ${p.cmAvg30 ? eur(p.cmAvg30) : "–"}</p>
        </div>
        <div class="bg-slate-950 rounded-2xl p-3 border border-sky-500/40 space-y-1">
          <p class="font-black text-sky-300">TCGplayer (USD)</p>
          <p class="text-white font-bold">${p.tcgMarketUsd ? `Markt ${usd(p.tcgMarketUsd)}${p.tcgMarketEur ? ` ≈ ${eur(p.tcgMarketEur)}` : ""}` : "kein Preis"}</p>
          <p class="text-slate-400">${p.tcgLowUsd ? `ab ${usd(p.tcgLowUsd)}` : ""}${p.tcgVariant ? ` • Variante: ${esc(p.tcgVariant)}` : ""}</p>
        </div>
      </div>
      ${series.length > 1 ? `<div class="bg-slate-950 rounded-2xl p-3 border border-slate-800">${sparkline(series, 400, 60)}</div>` : ""}
      <div id="ps-print-comps"></div>
      ${sellBlockHtml("sellPrint", `${jsArg(p.id)}, ${jsArg(p.lang)}, ${jsArg(`${p.name}${p.number ? ` ${p.number}` : ""}`)}, ${price || 0}, ${jsArg(p.image || "")}, ${jsArg(p.setName || "")}`, price)}
      <div class="grid grid-cols-2 gap-2">
        ${btn("💼 Zur Sammlung", `PS.addPrintToPortfolio(${jsArg(p.id)})`, "bg-emerald-500 text-slate-950")}
        ${p.baseCardId ? btn("🔔 Preisalarm & Wunschliste", `PS.openCard(${jsArg(p.baseCardId)})`, "bg-yellow-400 text-slate-950") : btn("💎 PSA-Werte & Verkäufe", `PS.openComps("print", ${jsArg(p.id)})`, "bg-slate-800 text-purple-300")}
        <a href="${esc(window.buildEbayUrl ? window.buildEbayUrl(q, "bin", `print-${p.lang}`) : "#")}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-black py-2.5 px-3 rounded-xl text-xs text-center">🛒 eBay*</a>
        <a href="${esc(cm(p.name))}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-black py-2.5 px-3 rounded-xl text-xs text-center">📊 Cardmarket</a>
      </div>
      ${related?.length ? `<div class="space-y-1.5"><p class="text-xs font-black text-white">🌍 Andere Sprachen</p>
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-2">${related.map((r) => `
          <button onclick="${r.lang === "de" ? `PS.openCard(${jsArg(r.id)})` : `PS.openPrint(${jsArg(r.id)})`}" class="bg-slate-900 border border-slate-800 hover:border-yellow-400 rounded-xl p-1.5 text-[10px] text-white">
            <img src="${esc(cdn(r.image || FALLBACK_IMG, 120))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" class="h-20 mx-auto object-contain" alt="" />
            <span class="block truncate">${esc(FLAG[r.lang] || "")} ${r.price ? eur(r.price) : "–"}</span>
          </button>`).join("")}</div></div>` : ""}
      <p class="text-[10px] text-slate-500">Preise: Cardmarket und TCGplayer über TCGdex, getrennt gespeichert. ${esc(rate)} *Affiliate-Link</p>`, { wide: true });
    window.PS?.compsSummary?.("ps-print-comps", "print", p.id);
  } catch (e) {
    closeModalEl("ps-card");
    handleError(e);
  }
}

async function addPrintToPortfolio(id) {
  if (!requireLogin()) return;
  try {
    await api("/api/portfolio", { method: "POST", body: { printId: id } });
    closeModalEl("ps-card");
    toast("💼 In deiner Sammlung", "Der Marktwert wird automatisch aktualisiert.");
    window.PS?.loadPortfolio?.();
  } catch (e) { handleError(e); }
}

/** Aktuelle Swipe-Karte in die Sammlung (mit Konto: echte Karte/Druck mit Live-Preis). */
export function addSwipeItemToPortfolio(item, fallback) {
  if (!item) return fallback?.();
  if (item.kind === "listing" && item.listingId) return window.PS?.requestTrade?.(item.listingId);
  if (item.printId && /^(en|ja):/.test(item.printId)) return addPrintToPortfolio(item.printId);
  if (item.lang === "de" && item.cardId && state.user) {
    return api("/api/portfolio", { method: "POST", body: { cardId: item.cardId } })
      .then(() => { toast("💼 In deiner Sammlung", `${item.title} – mit Live-Preis.`); window.PS?.loadPortfolio?.(); })
      .catch(handleError);
  }
  return fallback?.();
}

// ---------------------------------------------------------------------------
// Swipe-Karte: Preis-Etikett, echtes Foto und Aktionen ❌ Weiter · 🛒 Kaufen · ❤️ Merken
// Inserate (auch frisch gescannte Karten) zeigen Foto, Preis, Zustand und einen direkten Kauf-Knopf.
// ---------------------------------------------------------------------------
const catalogView = new Set(); // Inserate, bei denen gerade das Katalogbild statt des Verkäufer-Fotos gezeigt wird
let lastBuyAt = 0;

const totalOf = (item) => (Number(item.price) || 0) + (Number(item.shippingCents) || 0) / 100;

/** Preisanzeige einer Katalogkarte (Etikett, Mittelzeile und Kauf-Knopf nutzen genau dieses Ergebnis). */
export function catalogPrice(item) {
  return priceDisplay({ market: item?.cm, offer: item?.price, offerSource: item?.offerSource });
}

function actionsHtml(item) {
  const isListing = item.kind === "listing";
  const round = "w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-2xl shadow-lg transition active:scale-90";
  let buyLabel, buyCls = "bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950";
  if (isListing && item.buyNow) buyLabel = `🛒 Kaufen · ${eur(totalOf(item))}`;
  else if (isListing) { buyLabel = "🤝 Anfragen / Kaufen"; buyCls = "bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950"; }
  else {
    // Gleiche Quelle wie Etikett und Mittelzeile: verifiziertes Live-Angebot oder Cardmarket-Trend
    const pd = catalogPrice(item);
    buyLabel = pd.buttonLabel;
    if (pd.mode !== "offer") buyCls = "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950";
  }
  return `<div class="grid grid-cols-[auto_1fr_auto] gap-3 items-center">
      <button type="button" onclick="nextSwipeCard('skip')" class="${round} bg-slate-800 hover:bg-slate-700 border-2 border-slate-600 text-white" aria-label="Weiter (nicht interessiert)" title="Weiter">❌</button>
      <button type="button" onclick="PS.arenaBuy()" class="${buyCls} font-black py-3.5 rounded-2xl text-sm shadow-lg truncate px-2">${esc(buyLabel)}</button>
      <button type="button" onclick="nextSwipeCard('match')" class="${round} bg-rose-500 hover:bg-rose-400 border-2 border-rose-300 text-white" aria-label="Merken" title="${isListing ? "Merken – der Verkäufer sieht dein Interesse" : "Merken &amp; Wunschliste"}">${item.liked ? "💖" : "❤️"}</button>
    </div>
    <div class="flex justify-center flex-wrap gap-x-4 gap-y-1 text-[11px]">
      <button type="button" onclick="PS.arenaUndo()" class="text-slate-400 hover:text-white font-bold">↩️ Zurück</button>
      ${isListing ? "" : `<button type="button" onclick="addCurrentSwipeToPortfolio()" class="text-purple-300 hover:text-purple-200 font-bold">💼 + Portfolio</button>`}
      ${isListing || !(item.cardId || item.printId || item.lang === "de") ? "" : `<button type="button" onclick="PS.sellSwipeCard()" class="text-emerald-300 hover:text-emerald-200 font-black" title="Du hast die Karte? Fairer Preis ist schon eingetragen">🏷️ Hab ich – verkaufen${Number(item.cm) > 0 ? ` · ${eur(item.cm)}` : ""}</button>`}
      ${isListing && item.buyNow ? `<button type="button" onclick="PS.arenaBuy('cart')" class="text-cyan-300 hover:text-cyan-200 font-bold">➕ In den Warenkorb &amp; weiter</button>` : ""}
    </div>`;
}

/** Wird nach jedem Rendern der Swipe-Karte aufgerufen (Ereignis ps:swipe-render aus legacy-app.js). */
function paintSwipeExtras(item) {
  if (!item) return;
  const isListing = item.kind === "listing";
  const hasPhoto = isListing && item.photo && item.catalogImage;
  const showCatalog = hasPhoto && catalogView.has(item.key);
  // Bild: echtes Foto des Verkäufers oder (umgeschaltet) das Katalogbild zum Vergleich
  const img = $("swipe-img");
  if (img && hasPhoto) {
    const want = showCatalog ? item.catalogImage : item.img;
    if (img.getAttribute("src") !== want) img.src = want;
  }
  const toggle = $("swipe-photo-toggle");
  if (toggle) {
    toggle.classList.toggle("hidden", !hasPhoto);
    toggle.textContent = showCatalog ? "📷 Echtes Foto" : "🖼️ Katalogbild";
  }
  // Preis-Etikett: Inserat = Verkaufspreis + Zustand + Versand; Katalogkarte = günstigstes Angebot
  const tag = $("swipe-tag");
  if (tag) {
    if (isListing) {
      const offer = Number(item.price) || 0;
      tag.innerHTML = offer > 0 ? priceTagHtml({
        price: offer, market: item.cm, condition: item.condition,
        shippingCents: item.buyNow ? item.shippingCents : 0, label: item.buyNow ? "Sofort" : "Preis",
      }, "lg") : "";
    } else {
      // Katalogkarte: „ab“ nur mit verifiziertem, günstigerem Live-Angebot – sonst der echte Marktwert (Cardmarket-Trend)
      const pd = catalogPrice(item);
      tag.innerHTML = pd.tagPrice ? priceTagHtml({
        price: pd.tagPrice, label: pd.tagLabel, dealPct: pd.mode === "offer" ? pd.dealPct : 0,
        note: pd.mode === "offer" ? (pd.offerSource === "pokeswipe" ? "PokeSwipe-Angebot" : "Live bei eBay") : "",
      }, "lg") : "";
    }
  }
  // Kennzeichen: frisch gescannt mit echtem Foto, Zustand ausgeschrieben
  const kind = $("swipe-kind");
  if (kind && isListing) {
    kind.textContent = item.scanned && item.photo ? (item.fresh ? "📷 Frisch gescannt · echtes Foto" : "📷 Echtes Foto")
      : item.boosted ? "🚀 Top-Inserat" : item.buyNow ? "🔒 Sofort-Kauf mit Käuferschutz" : "🤝 Tausch-Inserat";
    kind.classList.remove("hidden");
  }
  const extra = $("swipe-extra");
  if (extra && isListing) {
    const cond = CONDITION_INFO[item.condition];
    const parts = [
      `${item.buyNow ? "Verkauft von" : "Angebot von"} ${item.seller || "Sammler"}${item.city ? ` aus ${item.city}` : ""}`,
      cond ? `Zustand: ${cond.label}` : "",
      item.cm ? `Marktwert ${eur(item.cm)}` : "",
      item.want && !/^verkauf/i.test(item.want) ? `sucht: ${item.want}` : "",
    ].filter(Boolean);
    extra.textContent = parts.join(" • ");
    extra.classList.remove("hidden");
  }
  const hintR = $("swipe-hint-right");
  if (hintR) hintR.textContent = isListing ? "❤️ Merken" : "💚 Merken";
  const box = $("swipe-actions");
  if (box) box.innerHTML = actionsHtml(item);
}

/** 🛒 Kaufen: Sofort-Kauf-Inserat → Warenkorb (Kasse), Tausch-Inserat → Anfrage, Katalogkarte → Angebote. */
async function buyCurrent(mode = "checkout") {
  const item = window.currentSwipeItem?.();
  if (!item) return;
  if (Date.now() - lastBuyAt < 600) return; // Doppeltipp
  lastBuyAt = Date.now();
  if (item.kind === "listing" && item.listingId) {
    if (!item.buyNow) { window.PS?.requestTrade?.(item.listingId); return; }
    if (!requireLogin()) return;
    if (!(await window.PS?.addToCart?.(item.listingId))) return;
    haptic("success");
    window.nextSwipeCard?.("buy");
    if (mode !== "cart") window.PS?.openCart?.();
    return;
  }
  openBuySheet(item);
}

/** Katalogkarte: Sofort-Kauf-Angebote anderer Sammler (mit Preis-Etikett) und externe Händler. */
async function openBuySheet(item) {
  const q = item.query || item.title;
  const ext = `<div class="grid grid-cols-2 gap-2">
      <a href="${esc(window.buildEbayUrl ? window.buildEbayUrl(q, "bin", "swipe-buy") : "#")}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-black py-2.5 rounded-xl text-xs text-center">🛒 eBay Sofort-Kauf*</a>
      <a href="${esc(cm(String(q).replace(/ \d+\/\d+.*$/, "")))}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-black py-2.5 rounded-xl text-xs text-center">📊 Cardmarket</a>
    </div><p class="text-[10px] text-slate-500">*Affiliate-Link</p>`;
  const head = `<div class="flex gap-3 items-center">
      <img src="${esc(cdn(item.img || FALLBACK_IMG, 160))}" onerror="this.src='${FALLBACK_IMG}'" alt="" class="w-14 h-20 object-contain rounded" />
      <div class="min-w-0"><p class="text-sm font-black text-white">${esc(item.title)}</p><p class="text-[11px] text-slate-400">${esc(item.setFull || "")}</p>
      ${item.cm ? `<p class="text-[11px] text-slate-300">Marktwert (${item.source === "tcgplayer" ? "TCGplayer" : "Cardmarket-Trend"}): ${eur(item.cm)}</p>` : ""}</div></div>`;
  modal("ps-swipe-buy", `<h3 class="text-base font-black text-white">🛒 Kaufen</h3>${head}<p class="text-yellow-400 text-xs font-bold text-center py-3">⏳ Suche Angebote mit Käuferschutz …</p>`);
  let offers = [];
  const cardId = item.cardId || (item.lang === "de" ? item.id : null);
  if (cardId) {
    try { offers = (await api(`/api/marketplace/offers?card=${encodeURIComponent(cardId)}&limit=8`)).offers || []; } catch { offers = []; }
  }
  const list = offers.length ? `<p class="text-xs font-black text-white">🔒 Bei PokeSwipe-Sammlern (Käuferschutz)</p>
    <div class="space-y-2 max-h-[45vh] overflow-y-auto">${offers.map((o) => `
      <div class="flex gap-2 items-center bg-slate-950 border border-slate-800 rounded-2xl p-2">
        <img src="${esc(cdn(o.image || FALLBACK_IMG, 100))}" onerror="this.src='${FALLBACK_IMG}'" alt="" loading="lazy" class="w-10 h-14 ${String(o.image || "").startsWith("/api/images/") ? "object-cover" : "object-contain"} rounded" />
        <div class="flex-1 min-w-0 text-[11px]">
          ${priceTagHtml({ price: o.priceCents / 100, market: item.cm, condition: o.condition, shippingCents: o.shippingCents }, "md")}
          <p class="text-slate-400 truncate mt-0.5">${esc(o.seller)}${o.city ? ` · ${esc(o.city)}` : ""}${o.rating ? ` · ⭐ ${esc(String(o.rating).replace(".", ","))} (${Number(o.ratingCount)})` : ""}${o.variantLabel ? ` · ${esc(o.variantLabel)}` : ""}</p>
        </div>
        <button type="button" onclick="PS.arenaBuyOffer(${Number(o.listingId)})" class="shrink-0 bg-cyan-400 text-slate-950 font-black text-xs px-3 py-2 rounded-xl">🛒 Kaufen</button>
      </div>`).join("")}</div>`
    : `<p class="text-xs text-slate-400">Gerade bietet kein PokeSwipe-Sammler diese Karte mit Sofort-Kauf an. Merke sie dir mit ❤️ – du bekommst eine Nachricht, sobald jemand sie inseriert.</p>`;
  const pd = catalogPrice(item);
  const live = pd.mode === "offer" && pd.offerSource === "ebay" && safeUrl(item.offerUrl)
    ? `<a href="${esc(safeUrl(item.offerUrl))}" target="_blank" rel="noopener sponsored" class="block bg-emerald-400 text-slate-950 font-black py-2.5 rounded-xl text-xs text-center">🛒 Live-Angebot bei eBay: ${esc(eur(pd.offer))} inkl. Versand${pd.dealPct ? ` (−${pd.dealPct} % unter Markt)` : ""}*</a>`
    : "";
  modal("ps-swipe-buy", `<h3 class="text-base font-black text-white">🛒 Kaufen</h3>${head}${live}${list}${ext}`);
}

async function buyOffer(listingId) {
  if (!requireLogin()) return;
  if (!(await window.PS?.addToCart?.(listingId))) return;
  closeModalEl("ps-swipe-buy");
  haptic("success");
  window.PS?.openCart?.();
}

/** Vom Flip-Radar, nach dem Inserieren oder per Link: Swipe-Reiter im Marktplatz-Modus öffnen. */
/**
 * Gescannte Karte (Live-Scanner / Foto-Scan, Format von /api/scan/lookup) oben in den Swiper legen und den Swiper öffnen:
 * Marktpreis, Preis-Ampel und Live-Angebote erscheinen wie bei jeder anderen Karte.
 */
function showScanned(info) {
  if (!info?.key) return;
  const isPrint = info.kind === "print";
  pinnedScan = toDeckItem({
    kind: "card", key: info.id, lang: info.lang || "de",
    printId: isPrint ? info.id : null, cardId: isPrint ? info.baseCardId || null : info.id,
    name: info.name, altName: info.altName || "", number: info.number || "", setName: info.setName || "", setCode: info.setCode || "",
    rarity: info.rarity || "", price: info.price ?? null, image: info.image || "", source: "scan",
  });
  try { window.switchTab?.("swipe"); } catch {}
  if (!window.prependSwipeCard?.(pinnedScan)) window.setSwipeDeck?.([pinnedScan], false);
  setStatus(`📸 Gescannt: ${info.name}${info.number ? ` ${info.number}` : ""} liegt oben im Stapel – Marktpreis und Deals siehst du direkt an der Karte.`, "ok");
  haptic("success");
  try { document.getElementById("swipe-img")?.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
}

function openMarketSwipe(preset = {}) {
  filters = { ...filters, market: true, set: "", ...preset };
  saveFilters();
  try { window.switchTab?.("swipe"); } catch {}
  renderFilterBar();
  reloadDeck();
}

export const arenaApi = {
  arenaLang: toggleLang,
  arenaToggle: toggle,
  arenaDrawer: () => { drawerOpen = !drawerOpen; renderFilterBar(); },
  arenaApplyDrawer: applyDrawer,
  arenaSet: (v) => { filters.set = /^(de|en|ja):[A-Za-z0-9.\-_]{1,40}$/.test(v) ? v : ""; },
  arenaRarity: (v) => { if (RARITIES.some(([k]) => k === v)) filters.rarity = v; },
  arenaReset: () => { filters = { ...DEFAULTS, langs: filters.langs }; drawerOpen = false; saveFilters(); renderFilterBar(); reloadDeck(); },
  arenaReload: reloadDeck,
  arenaResetTaste: resetTaste,
  arenaBuy: (mode) => buyCurrent(mode),
  arenaBuyOffer: buyOffer,
  arenaUndo: () => { if (!window.prevSwipeCard?.()) toast("↩️ Zurück", "Du bist schon bei der ersten Karte."); else haptic("light"); },
  arenaPhotoToggle: () => {
    const item = window.currentSwipeItem?.();
    if (!item?.key) return;
    if (catalogView.has(item.key)) catalogView.delete(item.key); else catalogView.add(item.key);
    paintSwipeExtras(item);
  },
  /** Marktplatz-Modus: nur Inserate durchswipen (optional nur Deals unter Marktwert) */
  arenaMarket: (mode = "") => openMarketSwipe(mode === "deals" ? { market: false, deals: true } : { deals: false }),
  openPrint,
  addPrintToPortfolio,
  arenaShowScanned: showScanned,
};

export function initArena() {
  renderFilterBar();
  window.psArenaNeedMore = loadMore;
  window.psArenaMatch = onMatch;
  window.psArenaSwipe = onSwipe;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushEvents();
    else if (!usingLive && retryCount && !retryTimer) reloadDeck();
  });
  window.addEventListener("ps:swipe-render", (e) => { markSeen(e.detail?.key); paintSwipeExtras(e.detail); });
  paintSwipeExtras(window.currentSwipeItem?.());
  // Arena erst laden, wenn sie sichtbar ist (spart Anfragen bei Direktlinks in andere Bereiche)
  const start = () => { if (!lastLoadAt) reloadDeck(); };
  if (!$("view-swipe")?.classList.contains("hidden")) start();
  window.addEventListener("ps:tab", (e) => { if (e.detail === "swipe") start(); });
}
