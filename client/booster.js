// PokeSwipe & Radar – Phase 5: echter Set-Booster-Simulator & „Rip or Keep“ mit Erwartungswert.
// Öffnet Booster aller Sets aus dem Live-Katalog (🇩🇪/🇬🇧/🇯🇵) mit Slot-Aufbau und Zieh-Raten (Server: /api/booster/open),
// zeigt jede Karte mit Marktwert, die Pack-Wert-Bilanz (Wert − Kaufpreis) und eine Sitzungs-Bilanz je Set.
// Ohne Verbindung bleibt der bisherige Chase-Karten-Simulator aus index.html aktiv.
import { $, esc, jsArg, eur, toast, cdn, FALLBACK_IMG, api, btn } from "./core.js";

const BAL_KEY = "ps_booster_balance";
const FLAG = { de: "🇩🇪", en: "🇬🇧", ja: "🇯🇵" };
const BUCKET_LABEL = { sir: "🔥 Special Illustration Rare", hyper: "🌟 Hyper / Gold", ir: "🎨 Illustration Rare", ultra: "💎 ex / Ultra Rare", rare: "✨ Selten", common: "Häufig" };
const BUCKET_CLS = { sir: "border-pink-400 shadow-pink-500/40", hyper: "border-yellow-300 shadow-yellow-400/40", ir: "border-violet-400 shadow-violet-500/30", ultra: "border-sky-400", rare: "border-slate-500", common: "border-slate-800" };
// Bekannte Sets der alten Auswahl → Live-Katalog (deutsche Set-IDs sind identisch)
const LEGACY = ["sv08", "sv03.5", "sv08.5", "me01", "swsh12.5gg", "sv03", "sv04", "swsh7"];

let legacyOpen = null;
let legacyRipKeep = null;
let busy = false;
let setsLoaded = false;
const evCache = {};

const readBalance = () => { try { return JSON.parse(localStorage.getItem(BAL_KEY) || "{}") || {}; } catch { return {}; } };
function addBalance(key, b) {
  const all = readBalance();
  const cur = all[key] || { packs: 0, value: 0, cost: 0 };
  all[key] = { packs: cur.packs + b.packs, value: Math.round((cur.value + b.value) * 100) / 100, cost: Math.round((cur.cost + b.cost) * 100) / 100 };
  localStorage.setItem(BAL_KEY, JSON.stringify(all));
  return all[key];
}

function selectedSet() {
  const v = $("pack-set-select")?.value || "sv08";
  return /^(de|en|ja):/.test(v) ? v : `de:${v}`;
}

async function loadSetOptions() {
  if (setsLoaded) return;
  const sel = $("pack-set-select");
  if (!sel) return;
  try {
    const lists = await Promise.all(["de", "en", "ja"].map(async (l) => [l, (await api(`/api/swipe/sets?lang=${l}`)).sets || []]));
    const current = selectedSet();
    const groups = lists.map(([l, sets]) => {
      const usable = sets.filter((s) => Number(s.priced) >= 20).slice(0, 80);
      if (!usable.length) return "";
      return `<optgroup label="${esc(`${FLAG[l]} ${l === "de" ? "Deutsch" : l === "en" ? "Englisch" : "Japanisch"}`)}">${usable.map((s) => {
        const v = `${l}:${s.id}`;
        return `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(FLAG[l])} ${esc(s.name)}${s.code && s.code !== s.id ? ` (${esc(s.code)})` : ""}</option>`;
      }).join("")}</optgroup>`;
    }).join("");
    if (groups) {
      sel.innerHTML = groups;
      if (![...sel.options].some((o) => o.value === current)) sel.selectedIndex = 0;
      setsLoaded = true;
    }
  } catch { /* alte Auswahl bleibt */ }
  sel.onchange = () => renderInfo();
  renderInfo();
}

function ensureUi() {
  const stage = $("pack-stage");
  if (!stage || $("pack-results")) return;
  const openBtn = stage.querySelector('button[onclick="openVirtualBooster()"]');
  const extra = document.createElement("div");
  extra.className = "grid grid-cols-2 gap-2 text-[11px]";
  extra.innerHTML = `${btn("🎁 10 Booster", "PS.openBoosters(10)", "bg-slate-800 text-yellow-300 border border-yellow-400/40")}${btn("📦 Ganzes Display", "PS.openBoosters(36)", "bg-slate-800 text-emerald-300 border border-emerald-400/40")}`;
  openBtn?.after(extra);
  const res = document.createElement("div");
  res.id = "pack-results";
  res.className = "space-y-2 text-left";
  stage.appendChild(res);
  const info = document.createElement("p");
  info.id = "pack-info";
  info.className = "text-[10px] text-slate-400 text-left";
  stage.appendChild(info);
}

async function fetchEv(key) {
  if (evCache[key]) return evCache[key];
  evCache[key] = await api(`/api/booster/ev?set=${encodeURIComponent(key)}`);
  return evCache[key];
}

async function renderInfo() {
  const info = $("pack-info");
  if (!info) return;
  const key = selectedSet();
  const bal = readBalance()[key];
  let evText = "";
  try {
    const ev = await fetchEv(key);
    evText = `Erwartungswert ${eur(ev.ev)} pro Booster (UVP ca. ${eur(ev.layout.packPrice)}) • Hit-Chance ${Math.round(ev.hitChance * 100)} % pro Pack • ${Number(ev.set.cards)} Karten im Pool`;
  } catch { evText = ""; }
  info.innerHTML = `${esc(evText)}${bal ? `<br>📒 Deine Bilanz in diesem Set: ${bal.packs} Booster • Wert ${eur(bal.value)} • Kosten ${eur(bal.cost)} • <strong class="${bal.value >= bal.cost ? "text-emerald-400" : "text-rose-400"}">${bal.value >= bal.cost ? "+" : ""}${eur(bal.value - bal.cost)}</strong> <button onclick="PS.resetBoosterBalance()" class="underline">zurücksetzen</button>` : ""}`;
}

function cardTile(c) {
  return `<button onclick="${c.lang === "de" ? `PS.openCard(${jsArg(c.id)})` : `PS.openPrint(${jsArg(c.id)})`}" class="bg-slate-900 border-2 ${BUCKET_CLS[c.bucket] || "border-slate-800"} ${c.hit ? "shadow-lg" : ""} rounded-xl p-1 text-[9px] text-white text-center">
    <img src="${esc(cdn(c.image || FALLBACK_IMG, 160))}" onerror="this.src='${FALLBACK_IMG}'" loading="lazy" class="h-24 mx-auto object-contain ${c.reverse ? "ps-reverse" : ""}" alt="${esc(c.name)}" />
    <span class="block truncate font-bold">${esc(c.name)}</span>
    <span class="block ${c.value >= 5 ? "text-emerald-400 font-black" : "text-slate-400"}">${eur(c.value)}${c.reverse ? " • RH" : ""}</span>
  </button>`;
}

async function openBoosters(count = 1) {
  if (busy) return;
  ensureUi();
  const key = selectedSet();
  busy = true;
  const imgEl = $("pack-visual-img");
  imgEl?.classList.remove("pack-shake"); void imgEl?.offsetWidth; imgEl?.classList.add("pack-shake");
  try {
    const r = await api(`/api/booster/open?set=${encodeURIComponent(key)}&packs=${count}`);
    const lang = r.set.lang;
    const all = r.packs.flat().map((c) => ({ ...c, lang }));
    const best = [...all].sort((a, b) => b.value - a.value)[0];
    if (best && imgEl) {
      delete imgEl.dataset.fallback;
      imgEl.src = cdn(best.image || FALLBACK_IMG, 320);
      $("pack-hit-badge").textContent = BUCKET_LABEL[best.bucket] || best.rarity || "Karte";
      $("pack-hit-name").textContent = `${best.name}${best.number ? ` (${best.number})` : ""}`;
      $("pack-hit-val").textContent = `Bester Pull: ${eur(best.value)} • ${r.set.name}`;
      if (window.buildEbayUrl) $("pack-buy-card-link").href = window.buildEbayUrl(`${best.name} ${best.number || ""}${lang === "en" ? " english" : lang === "ja" ? " japanese" : ""}`.trim(), "bin", "booster");
    }
    if (window.buildEbayUrl) $("pack-buy-display-link").href = window.buildEbayUrl(`Pokemon ${r.set.name} ${count >= 30 ? "Display" : "Booster"} ${lang === "de" ? "deutsch" : lang === "en" ? "english" : "japanese"} OVP`, "bin", "booster-ovp");
    const b = r.balance;
    const total = addBalance(r.set.key, b);
    const hits = all.filter((c) => c.hit).sort((a, b2) => b2.value - a.value);
    const shown = count === 1 ? all : hits.slice(0, 18);
    $("pack-results").innerHTML = `
      <div class="grid grid-cols-3 gap-1.5 text-center text-[10px]">
        <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400">Pack-Wert</p><p class="text-sm font-black text-white">${eur(b.value)}</p></div>
        <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400">Kaufpreis</p><p class="text-sm font-black text-white">${eur(b.cost)}</p></div>
        <div class="bg-slate-900 rounded-xl p-2"><p class="text-slate-400">Bilanz</p><p class="text-sm font-black ${b.profit >= 0 ? "text-emerald-400" : "text-rose-400"}">${b.profit >= 0 ? "+" : ""}${eur(b.profit)}</p></div>
      </div>
      <p class="text-[11px] text-slate-300">${count === 1 ? `${all.length} Karten gezogen` : `${count} Booster • ${hits.length} Hits (ab ex/Ultra Rare)`} • Erwartungswert ${eur(r.ev.ev)} pro Booster</p>
      <div class="grid grid-cols-4 sm:grid-cols-5 gap-1.5">${shown.map(cardTile).join("") || `<p class="col-span-4 text-[11px] text-slate-500">Keine Hits in diesen Boostern – genau wie im echten Leben 😅</p>`}</div>
      <p class="text-[10px] text-slate-500">Simulation mit typischen Zieh-Raten der Karmesin-&-Purpur-Ära und echten Marktpreisen (Cardmarket/TCGplayer). RH = Reverse Holo. Gesamt in diesem Set: ${total.packs} Booster, ${total.value >= total.cost ? "+" : ""}${eur(total.value - total.cost)}.</p>`;
    window.playPokePingSound?.();
    const counter = Number(localStorage.getItem("pokeswipe_packs_count") || "0") + count;
    localStorage.setItem("pokeswipe_packs_count", String(counter));
    const stat = $("statPacksOpened");
    if (stat) stat.textContent = counter;
    if (best && best.value >= 50) toast("🔥 Wahnsinns-Pull!", `${best.name} – ${eur(best.value)} Marktwert`);
    renderInfo();
  } catch (e) {
    if (e.status === 429) toast("⏳ Kurz durchatmen", e.message);
    else if (legacyOpen && LEGACY.includes(key.replace(/^de:/, ""))) legacyOpen();
    else toast("⚠️ Booster-Simulator", e.message || "Gerade nicht erreichbar.");
  } finally {
    busy = false;
  }
}

/** „Rip or Keep“: bisherige Chase-Ansicht + Erwartungswert des ganzen Displays aus dem Live-Katalog. */
async function ripOrKeep() {
  try { legacyRipKeep?.(); } catch {}
  const box = $("ripkeep-box");
  if (!box) return;
  const sel = $("ripkeep-select")?.value || "sv08";
  const price = parseFloat(String($("ripkeep-price")?.value || "0").replace(",", "."));
  let el = $("ripkeep-ev");
  if (!el) { el = document.createElement("div"); el.id = "ripkeep-ev"; el.className = "bg-slate-900 rounded-xl p-2.5 space-y-1"; box.appendChild(el); }
  el.innerHTML = `<p class="text-[10px] text-slate-400">⏳ Berechne Erwartungswert aus allen Karten des Sets …</p>`;
  try {
    const ev = await fetchEv(`de:${sel}`);
    const displayEv = Number(ev.displayEv) || 0;
    const verdict = price > 0
      ? displayEv >= price
        ? `<p class="text-emerald-300 font-black">🎉 RIP: Im Schnitt ziehst du ${eur(displayEv)} aus ${ev.displayPacks} Boostern – mehr als die ${eur(price)} OVP (${Math.round((displayEv / price) * 100)} %).</p>`
        : `<p class="text-yellow-300 font-black">📦 KEEP SEALED: Erwartet ${eur(displayEv)} aus ${ev.displayPacks} Boostern – nur ${Math.round((displayEv / price) * 100)} % der ${eur(price)} OVP.</p>`
      : `<p class="text-slate-300">Erwartungswert eines Displays (${ev.displayPacks} Booster): <strong class="text-white">${eur(displayEv)}</strong>. Trag deinen OVP-Preis ein für die Empfehlung.</p>`;
    el.innerHTML = `<p class="text-[10px] text-slate-400 uppercase font-bold">📊 Erwartungswert aus ${Number(ev.set.cards)} Karten (echte Zieh-Raten)</p>
      ${verdict}
      <p class="text-[10px] text-slate-500">Pro Booster ${eur(ev.ev)} • Hit-Chance ${Math.round(ev.hitChance * 100)} % pro Pack • Einzelkarten verkaufen kostet Zeit und Gebühren – der echte Erlös liegt meist 20–30 % darunter.</p>`;
  } catch {
    el.innerHTML = `<p class="text-[10px] text-slate-500">Erwartungswert gerade nicht verfügbar.</p>`;
  }
}

export const boosterApi = {
  openBoosters,
  resetBoosterBalance: () => { const all = readBalance(); delete all[selectedSet()]; localStorage.setItem(BAL_KEY, JSON.stringify(all)); renderInfo(); },
};

export function initBooster() {
  legacyOpen = typeof window.openVirtualBooster === "function" ? window.openVirtualBooster : null;
  window.openVirtualBooster = () => openBoosters(1);
  const hookRipKeep = () => {
    if (typeof window.calcRipOrKeep !== "function" || window.calcRipOrKeep._ps) return;
    legacyRipKeep = window.calcRipOrKeep;
    const wrapped = () => ripOrKeep();
    wrapped._ps = true;
    window.calcRipOrKeep = wrapped;
    if ($("ripkeep-box")) ripOrKeep();
  };
  hookRipKeep();
  setTimeout(hookRipKeep, 1500);
  const start = () => { ensureUi(); loadSetOptions(); };
  if (!$("view-swipe")?.classList.contains("hidden")) start();
  window.addEventListener("ps:tab", (e) => { if (e.detail === "swipe") start(); });
  setTimeout(start, 4000);
}
