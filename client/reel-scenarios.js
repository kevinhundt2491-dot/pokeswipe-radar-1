// Live-UI-Choreografien für die Reels: echte Nutzer-Aktionen auf der echten Website in der 9:16-Stage.
// Jedes Szenario hat setup() (läuft VOR Frame 0 – die Seite ist dann fertig geladen und richtig gescrollt)
// und genau 4 Beats, passend zu den 4 Sprecher-Sätzen aus client/reel-scripts.js
// (Hook → Live-Aktion 1 → Live-Aktion 2 → Call to Action). Jeder Beat bekommt seine verfügbare Zeit d
// (Sekunden bis zum nächsten Satz), die aus der echten ElevenLabs-Aufnahme stammt.

import { VIEW_H } from "./live-stage.js";
import { SHOWCASE_TIMELINE as TL, AUTOBINDER_TIMELINE as AB, AUTOBINDER_BADGES, SHORT_TIMELINES as ST, templateByKey } from "./reel-pro.js";

const num = (s) => {
  const m = String(s || "").replace(/\./g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine
// ---------------------------------------------------------------------------
/** Hervorhebungen (ps-reel-spot) wieder entfernen. */
const unspot = (s) => s.$$(".ps-reel-spot").forEach((el) => el.classList.remove("ps-reel-spot"));

async function swipeReady(s) {
  await s.waitFor(() => s.$("#swipe-img")?.complete && s.text("#swipe-title"), 15_000, "Swipe-Karte lädt nicht");
}

async function showArena(s) {
  // Start ist seit dem UI-Upgrade das Dashboard – die Swipe-Arena liegt unter Marktplatz → Swipe-Tausch
  if (s.$("#view-swipe")?.classList.contains("hidden")) { try { s.win.switchTab?.("swipe"); } catch {} }
  await swipeReady(s);
  const card = s.$("#swipe-img")?.closest(".poke-glass") || s.$("#swipe-img");
  const r = card.getBoundingClientRect();
  s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 64));
  await s.idle({ quietMs: 300 });
  s.fact("card", s.text("#swipe-title"));
  s.fact("price", s.text("#swipe-cm"));
}

/** Nach einem Swipe warten, bis die nächste echte Karte geladen und dekodiert ist. */
async function nextCardLoaded(s, before) {
  await s.waitFor(() => s.text("#swipe-title") !== before && s.$("#swipe-img")?.complete, 6000, "Nächste Karte lädt nicht").catch(() => {});
  await s.decodeImages(2500);
}

async function openSwipeDetails(s) {
  s.fact("card", s.text("#swipe-title"));
  s.fact("price", s.text("#swipe-cm"));
  const btn = s.byText("button", /Karten-Details/);
  if (!btn) return false;
  await s.tap(btn);
  await s.waitFor(() => s.openModal("ps-card") && !/Lade/.test(s.openModal("ps-card").textContent || ""), 12_000, "Kartendetails laden nicht").catch(() => {});
  await s.idle({ quietMs: 300, timeoutMs: 5000 });
  const m = s.openModal("ps-card");
  if (m) {
    s.fact("card", m.querySelector("h3")?.textContent);
    const price = Array.from(m.querySelectorAll("p")).find((p) => /€/.test(p.textContent || "") && /text-2xl/.test(p.className));
    if (price) s.fact("price", price.textContent);
  }
  return true;
}

/** Offenes Modal der App langsam durchscrollen (eigener Scroll-Container). */
async function scrollModal(s, id, d) {
  const m = s.openModal(id);
  if (!m) return s.sleep(d * 1000);
  const box = m.scrollHeight > m.clientHeight + 4 ? m : s.scrollParent(m.firstElementChild || m);
  s.hideFinger();
  await s.sleep(Math.min(700, d * 250));
  await s.scrollTo(Math.min(box.scrollHeight, VIEW_H * 0.9), Math.max(800, d * 1000 * 0.7), box);
}

/** Bereich in der echten App öffnen und an den Anfang scrollen. */
async function sectionReady(s, view, sub, selector) {
  try { s.win.PS?.showSub?.(view, sub); } catch {}
  await s.waitFor(() => s.$(selector), 12_000, `${selector} lädt nicht`).catch(() => {});
  const box = s.$(selector);
  if (box) { const r = box.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 64)); }
  await s.idle({ quietMs: 300 });
}

function bestFlipDeal(s) {
  const cards = s.$$("#ps-flip-grid > div").filter((c) => s.visible(c) && !/Pro-Deal|aufdecken/.test(c.textContent || ""));
  let best = null, bestPct = -1;
  for (const c of cards) {
    const badge = c.querySelector("span.rounded-full");
    const p = num(badge?.textContent);
    const pct = Number.isFinite(p) ? Math.abs(p) : 0;
    const score = pct + (c.querySelector("button") && /Verkaufspreise/.test(c.textContent || "") ? 1000 : 0);
    if (score > bestPct) { bestPct = score; best = c; }
  }
  return best;
}


// ---------------------------------------------------------------------------
// Kurz-Reels (7–10 s): gemeinsame Bausteine
// ---------------------------------------------------------------------------
/** Marktplatz-Reiter öffnen und den 16er-Bereich oben ins Bild holen. */
async function marketReady(s, sub = "all") {
  if (s.$("#view-map")?.classList.contains("hidden")) { try { s.win.switchTab?.("map"); } catch {} }
  try { s.win.PS?.marketTab?.(sub); } catch {}
  await s.idle({ quietMs: 120, timeoutMs: 900 });
}
function m16Top(s, off = 66) {
  const el = s.$("#ps-m16 [data-m16-book]") || s.$("#ps-m16 [data-vs]") || s.$("#ps-m16");
  if (!el) return;
  const r = el.getBoundingClientRect();
  s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - off));
}
/** Sichtbares Fach im 16er Binder (bevorzugt ein Deal). */
function m16Pocket(s, deal = true) {
  const all = s.$$("#ps-m16 [data-m16-book] [data-front] .ps-m16-pocket[data-m16-id], #ps-m16 [data-m16-book] .ps-m16-pocket[data-m16-id]")
    .filter((p) => { const r = p.getBoundingClientRect(); return r.width > 10 && r.top > 60 && r.bottom < VIEW_H - 60; });
  return (deal ? all.find((p) => p.classList.contains("is-deal")) : null) || all[5] || all[0] || null;
}
const shortTpl = (k) => templateByKey(k) || {};

// ---------------------------------------------------------------------------
// Die 10 Choreografien (Schlüssel = SCENARIOS[].key)
// ---------------------------------------------------------------------------
export const CHOREO = {
  // 1) Swipe-Arena: echte Links-/Rechts-Swipes, Match-Badge, Karten-Detailansicht
  arena: {
    setup: showArena,
    beats: [
      async (s, d) => {
        const img = s.$("#swipe-img");
        const { x, y } = s.center(img);
        await s.moveFinger(x, y + 40, Math.min(900, d * 400));
      },
      async (s, d) => {
        const img = s.$("#swipe-img");
        let t = s.text("#swipe-title");
        if (d > 3.2) { await s.swipe(img, -1, 620); await nextCardLoaded(s, t); await s.sleep(Math.min(900, d * 150)); t = s.text("#swipe-title"); }
        await s.swipe(s.$("#swipe-img"), 1, 760);
        await nextCardLoaded(s, t);
      },
      async (s) => { await openSwipeDetails(s); },
      async (s, d) => { await scrollModal(s, "ps-card", d); },
    ],
  },

  // 2) Live Flip-Radar: echtes Scrollen durch die Live-Angebote, Schnäppchen hervorheben, Preis-Analyse öffnen
  flip: {
    async setup(s) {
      await s.waitFor(() => s.$$("#ps-flip-grid > div").length > 0, 15_000, "Flip-Radar lädt keine Angebote").catch(() => {});
      const live = s.$("#ps-flip-live");
      if (live) { const r = live.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 64)); }
      await s.idle({ quietMs: 400 });
      const first = s.$("#ps-flip-grid > div");
      if (first) s.fact("card", first.querySelector("p.text-xs")?.textContent);
    },
    beats: [
      async (s, d) => {
        const status = s.$("#ps-flip-status");
        if (status) { const { x, y } = s.center(status); await s.moveFinger(x, y + 30, Math.min(800, d * 300)); }
      },
      async (s, d) => {
        const grid = s.$("#ps-flip-grid");
        const span = grid ? Math.min(grid.getBoundingClientRect().height - VIEW_H * 0.5, VIEW_H * 1.6) : VIEW_H;
        s.hideFinger();
        await s.scrollBy(Math.max(VIEW_H * 0.6, span), Math.max(1200, d * 1000 * 0.85));
      },
      async (s, d) => {
        const deal = bestFlipDeal(s);
        if (!deal) return s.sleep(d * 1000);
        await s.reveal(deal, { ms: 700, ratio: 0.38 });
        await s.spotlight(deal);
        s.fact("card", deal.querySelector("p.text-xs")?.textContent);
        s.fact("pct", (deal.querySelector("span.rounded-full")?.textContent || "").replace(/[^\d,.%−-]/g, "").replace(/^[−-]/, ""));
        s.fact("price", deal.querySelector("p.text-lg")?.textContent);
        await s.sleep(Math.min(1400, d * 350));
        const btn = s.byText("button", /Verkaufspreise/, deal);
        if (btn) {
          await s.tap(btn, { reveal: false });
          await s.waitFor(() => s.openModal("ps-comps") && !/Lade Verkaufspreise/.test(s.openModal("ps-comps").textContent || ""), 12_000).catch(() => {});
          await s.idle({ quietMs: 300, timeoutMs: 5000 });
        }
      },
      async (s, d) => {
        if (s.openModal("ps-comps")) return scrollModal(s, "ps-comps", d);
        s.hideFinger();
        await s.scrollBy(VIEW_H * 0.5, Math.max(900, d * 700));
      },
    ],
  },

  // 3) Restock-Radar: Live-Drops, UVP-Ampel und Preisvergleich je Shop
  restock: {
    async setup(s) {
      await sectionReady(s, "flip", "drops", "#ps-drops");
      const first = s.$("#ps-drops p.font-black");
      if (first) s.fact("card", first.textContent?.replace(/^[^\p{L}\d]+/u, ""));
    },
    beats: [
      async (s, d) => {
        const head = s.$("#ps-drops");
        if (head) { const { x, y } = s.center(head); await s.moveFinger(x, Math.min(y, VIEW_H * 0.4), Math.min(900, d * 400)); }
      },
      async (s, d) => { s.hideFinger(); await s.scrollBy(VIEW_H * 0.45, Math.max(900, d * 800)); },
      async (s, d) => { await s.scrollBy(VIEW_H * 0.45, Math.max(900, d * 800)); },
      async (s, d) => { await s.sleep(Math.min(1500, d * 400)); },
    ],
  },


  // 4) Sammlung: echtes Scrollen durch das Live-Portfolio mit realem Gesamtwert
  portfolio: {
    async setup(s) {
      await s.waitFor(() => s.$("#portfolio-total") && (s.$("#portfolio-list")?.children.length || 0) > 0, 12_000).catch(() => {});
      s.win.scrollTo(0, Math.max(0, s.win.scrollY + s.$("#view-portfolio").getBoundingClientRect().top - 64));
      await s.idle({ quietMs: 400 });
      s.fact("total", s.text("#portfolio-total"));
      const n = s.$$("#portfolio-list > div").length;
      if (n) s.fact("count", String(n));
    },
    beats: [
      async (s, d) => {
        const total = s.$("#portfolio-total")?.parentElement;
        if (total) { const { x, y } = s.center(total); await s.moveFinger(x, y + 30, 500); await s.spotlight(total, Math.min(2200, d * 600)); }
      },
      async (s, d) => {
        const list = s.$("#portfolio-list");
        if (!list) return s.sleep(d * 1000);
        await s.reveal(list, { ms: 600, ratio: 0.15 });
        s.hideFinger();
        if (list.scrollHeight > list.clientHeight + 4) await s.scrollTo(list.scrollHeight, Math.max(1200, d * 1000 * 0.8), list);
        else await s.scrollBy(VIEW_H * 0.4, Math.max(900, d * 700));
      },
      async (s) => {
        const item = s.$$("#portfolio-list [onclick*='openCard'], #portfolio-list [onclick*='openPrint']").find((el) => s.visible(el));
        if (!item) return;
        s.fact("card", item.querySelector("p.font-bold")?.textContent);
        await s.tap(item);
        await s.waitFor(() => s.openModal("ps-card") && !/Lade/.test(s.openModal("ps-card").textContent || ""), 12_000).catch(() => {});
        await s.idle({ quietMs: 300, timeoutMs: 5000 });
      },
      async (s, d) => {
        if (s.openModal("ps-card")) return scrollModal(s, "ps-card", d);
        await s.scrollTo(0, Math.max(900, d * 700));
      },
    ],
  },

  // 5) Scanner: echter Suchbegriff, echte Treffer aus der Kartendatenbank, Live-Preis
  scanner: {
    async setup(s) {
      const q = s.$("#scan-quick-q");
      if (q) { const r = q.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 180)); }
      await s.idle({ quietMs: 300 });
    },
    beats: [
      async (s, d) => {
        const q = s.$("#scan-quick-q");
        if (q) { const { x, y } = s.center(q); await s.moveFinger(x, y, Math.min(900, d * 400)); }
      },
      async (s) => {
        const q = s.$("#scan-quick-q");
        await s.type(q, "Glurak", 900);
        const go = s.byText("button", /Finden/);
        if (go) await s.tap(go, { reveal: false });
        await s.waitFor(() => s.$$("#scan-quick-results button").length > 0, 12_000).catch(() => {});
        await s.idle({ quietMs: 300, timeoutMs: 6000 });
        s.fact("card", "Glurak");
      },
      async (s) => {
        const first = s.$$("#scan-quick-results button")[0];
        if (!first) return;
        await s.reveal(first, { ms: 600, ratio: 0.3 });
        await s.sleep(350);
        await s.tap(first, { reveal: false });
        await s.waitFor(() => s.openModal("ps-card") && !/Lade/.test(s.openModal("ps-card").textContent || ""), 12_000).catch(() => {});
        await s.idle({ quietMs: 300, timeoutMs: 5000 });
        const m = s.openModal("ps-card");
        if (m) { s.fact("card", m.querySelector("h3")?.textContent); const p = m.querySelector("p.text-2xl"); if (p) s.fact("price", p.textContent); }
      },
      async (s, d) => { await scrollModal(s, "ps-card", d); },
    ],
  },

  // 6) Preis-Check: Profi-Werte aufklappen, Karten-Details mit Preisverlauf
  pricecheck: {
    setup: showArena,
    beats: [
      async (s, d) => {
        const img = s.$("#swipe-img");
        const { x, y } = s.center(img);
        await s.moveFinger(x, y + 60, Math.min(900, d * 400));
      },
      async (s, d) => {
        const btn = s.byText("button", /Profi-Werte anzeigen/);
        if (btn) await s.tap(btn);
        const grid = s.$('[data-reveal-group="swipe-pro"]');
        if (grid) { await s.reveal(grid, { ms: 500, ratio: 0.45 }); await s.spotlight(grid, Math.min(2600, d * 650)); }
        s.fact("price", s.text("#swipe-cm"));
      },
      async (s) => { await openSwipeDetails(s); },
      async (s, d) => { await scrollModal(s, "ps-card", d); },
    ],
  },

  // 7) Graded-Portfolio & Grading-Rechner
  graded: {
    async setup(s) { await sectionReady(s, "portfolio", "graded", "#ps-graded"); },
    beats: [
      async (s, d) => {
        const box = s.$("#ps-graded");
        if (box) await s.spotlight(box, Math.min(1800, d * 500));
      },
      async (s, d) => { s.hideFinger(); await s.scrollBy(VIEW_H * 0.45, Math.max(900, d * 800)); },
      async (s, d) => { await s.scrollBy(VIEW_H * 0.45, Math.max(900, d * 800)); },
      async (s, d) => { await s.sleep(Math.min(1500, d * 400)); },
    ],
  },


  // 8) Tausch-Markt: echte Inserate anderer Sammler
  market: {
    async setup(s) {
      await s.waitFor(() => (s.$("#market-list")?.children.length || 0) > 0, 12_000).catch(() => {});
      const list = s.$("#market-list");
      if (list) { const r = list.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 150)); }
      await s.idle({ quietMs: 400 });
      const first = s.$("#market-list > div p.font-bold, #market-list > div p.font-black");
      if (first) s.fact("card", first.textContent);
    },
    beats: [
      async (s, d) => {
        const first = s.$("#market-list > div");
        if (first) { const { x, y } = s.center(first); await s.moveFinger(x, y, Math.min(900, d * 400)); }
      },
      async (s, d) => {
        const list = s.$("#market-list");
        s.hideFinger();
        if (list && list.scrollHeight > list.clientHeight + 4) await s.scrollTo(Math.min(list.scrollHeight, VIEW_H * 1.2), Math.max(1200, d * 1000 * 0.8), list);
        else await s.scrollBy(VIEW_H * 0.5, Math.max(1000, d * 800));
      },
      async (s, d) => {
        const item = s.$$("#market-list > div").find((el) => { const r = el.getBoundingClientRect(); return r.top > 80 && r.bottom < VIEW_H - 80; });
        if (!item) return s.sleep(d * 1000);
        s.fact("card", item.querySelector("p.font-bold, p.font-black")?.textContent);
        const { x, y } = s.center(item);
        await s.moveFinger(x, y, 450);
        await s.spotlight(item, Math.min(2600, d * 700));
      },
      async (s, d) => { s.hideFinger(); await s.scrollBy(VIEW_H * 0.35, Math.max(900, d * 700)); },
    ],
  },

  // 9) Pull-Wall: echter Community-Feed
  community: {
    async setup(s) {
      await s.waitFor(() => (s.$("#pullwall-feed")?.children.length || 0) > 0, 12_000).catch(() => {});
      const feed = s.$("#pullwall-feed");
      if (feed) { const r = feed.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 120)); }
      await s.idle({ quietMs: 400 });
      const n = s.$$("#pullwall-feed > div").length;
      if (n) s.fact("count", String(n));
    },
    beats: [
      async (s, d) => {
        const first = s.$("#pullwall-feed > div");
        if (first) { const { x, y } = s.center(first); await s.moveFinger(x, Math.min(y, VIEW_H - 120), Math.min(900, d * 400)); }
      },
      async (s, d) => { s.hideFinger(); await s.scrollBy(VIEW_H * 0.9, Math.max(1200, d * 1000 * 0.85)); },
      async (s, d) => {
        const post = s.$$("#pullwall-feed > div").find((el) => { const r = el.getBoundingClientRect(); return r.top > 60 && r.top < VIEW_H * 0.6; });
        if (post) { const { x, y } = s.center(post); await s.moveFinger(x, Math.min(y, VIEW_H - 120), 450); await s.spotlight(post, Math.min(2600, d * 700)); }
        else await s.sleep(d * 1000);
      },
      async (s, d) => { s.hideFinger(); await s.scrollBy(VIEW_H * 0.5, Math.max(900, d * 700)); },
    ],
  },

  // 11) Scannen & Verkaufen (Pro-Video „scansell“): Live-Scanner erkennt eine echte Katalogkarte, echter Marktpreis +
  // fairer Preisvorschlag im Schnell-Inserieren, 1 Klick → Erfolgsansicht mit Käuferschutz & DHL-Etikett.
  // In der Stage legt „Inserieren“ KEIN echtes Inserat an (Demo-Modus in quick-list.js).
  scansell: {
    async setup(s) {
      try { s.win.PS?.showSub?.("scan", "live"); } catch {}
      await s.waitFor(() => s.$("#ps-ls-stage"), 15_000, "Live-Scanner lädt nicht").catch(() => {});
      let info = null;
      try { info = await s.win.PS?.liveScanDemoPrepare?.(); } catch (e) { console.warn("Scan-Demo:", e); }
      if (info) { s.fact("card", info.name); if (Number(info.price) > 0) s.fact("price", `${Number(info.price).toFixed(2).replace(".", ",")} €`); }
      const st = s.$("#ps-ls-stage");
      if (st) { const r = st.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 70)); }
      await s.decodeImages(3000);
      await s.idle({ quietMs: 300, timeoutMs: 5000 });
    },
    beats: [
      // Kamera auf die Karte → Laser-Scan → „Erkannt“ mit Marktpreis
      async (s, d) => {
        const card = s.$("#ps-ls-demo-card");
        if (card) { const { x, y } = s.center(card); await s.moveFinger(x + 60, y + 90, 350); }
        s.hideFinger();
        await s.win.PS?.liveScanDemoScan?.(Math.max(700, Math.min(1500, d * 1000 * 0.6)));
        await s.idle({ quietMs: 200, timeoutMs: 1500 });
        const hud = s.$("#ps-ls-hud");
        if (hud) await s.spotlight(hud.firstElementChild || hud);
      },
      // „Verkaufen“ → Schnell-Inserieren mit fairem, editierbarem Preisvorschlag
      async (s, d) => {
        const hud = s.$("#ps-ls-hud");
        s.$$(".ps-reel-spot").forEach((el) => el.classList.remove("ps-reel-spot"));
        const sell = hud ? s.byText("button", /Verkaufen/, hud) : null;
        if (!sell) return s.sleep(d * 1000);
        await s.tap(sell, { reveal: false });
        await s.waitFor(() => { const i = s.$('[id^="ql-price-"]'); return i && String(i.value || "").trim(); }, 8000).catch(() => {});
        await s.idle({ quietMs: 200, timeoutMs: 2500 });
        const price = s.$('[id^="ql-price-"]');
        if (price) {
          const { x, y } = s.center(price);
          await s.moveFinger(x, y, 420);
          await s.spotlight(price);
          s.fact("fair", price.value);
        }
      },
      // 1 Klick: Inserat live (Demo-Erfolgsansicht)
      async (s, d) => {
        s.$$(".ps-reel-spot").forEach((el) => el.classList.remove("ps-reel-spot"));
        const btn = s.$("#ql-submit");
        if (!btn) return s.sleep(d * 1000);
        await s.tap(btn);
        await s.waitFor(() => s.$("#ql-done-protect"), 4000).catch(() => {});
        await s.idle({ quietMs: 200, timeoutMs: 1500 });
      },
      // Käuferschutz & DHL-Etikett hervorheben
      async (s, d) => {
        const box = s.$("#ql-done-protect");
        if (!box) return s.sleep(d * 1000);
        const { x, y } = s.center(box);
        await s.moveFinger(x, y, 400);
        await s.spotlight(box);
        await s.sleep(Math.min(1200, d * 400));
        s.hideFinger();
      },
    ],
  },

  // ---- Hook-Presets (4 Szenen: Hook → UI-Beweis → USP → Frage). Beats: 1 Hook · 2+3 UI-Beweis · 4 USP ----

  // H1) Schnäppchen-FOMO: echter Live Flip-Radar – Live-Status, durch Echtzeit-Listings scrollen,
  // bestes Angebot (grünes Rabatt-Badge) hervorheben, im USP-Teil per Klick die Verkaufspreise öffnen.
  flipdeal: {
    async setup(s) {
      try { s.win.PS?.showSub?.("flip", "deals", { silent: true }); } catch {}
      await CHOREO.flip.setup(s);
    },
    beats: [
      async (s, d) => { await CHOREO.flip.beats[0](s, d); },
      async (s, d) => {
        const grid = s.$("#ps-flip-grid");
        const span = grid ? Math.min(grid.getBoundingClientRect().height - VIEW_H * 0.5, VIEW_H * 1.2) : VIEW_H * 0.6;
        s.hideFinger();
        await s.scrollBy(Math.max(VIEW_H * 0.45, span), Math.max(900, d * 1000 * 0.8));
      },
      async (s, d) => {
        const deal = bestFlipDeal(s);
        if (!deal) return s.sleep(d * 1000);
        await s.reveal(deal, { ms: 600, ratio: 0.38 });
        await s.spotlight(deal);
        s.fact("card", deal.querySelector("p.text-xs")?.textContent);
        s.fact("pct", (deal.querySelector("span.rounded-full")?.textContent || "").replace(/[^\d,.%−-]/g, "").replace(/^[−-]/, ""));
        s.fact("price", deal.querySelector("p.text-lg")?.textContent);
        const { x, y } = s.center(deal);
        await s.moveFinger(x, y, Math.min(700, d * 300));
      },
      async (s, d) => {
        const deal = bestFlipDeal(s);
        const btn = deal ? s.byText("button", /Verkaufspreise/, deal) || deal.querySelector("button") : null;
        if (!btn) return s.sleep(d * 1000);
        await s.sleep(Math.min(400, d * 100));
        await s.tap(btn, { reveal: false });
        await s.waitFor(() => s.openModal("ps-comps") && !/Lade Verkaufspreise/.test(s.openModal("ps-comps").textContent || ""), 6000).catch(() => {});
        await s.idle({ quietMs: 200, timeoutMs: 2500 });
      },
    ],
  },

  // H2) Flohmarkt-Schutz: echter Live-Kartenscanner im Browser – Kamera-Ansicht im Hook,
  // Laser-Scan + „Erkannt“ mit echtem Marktwert im UI-Beweis, Ergebnis bleibt im USP-Teil stehen.
  fleascan: {
    setup: (s) => CHOREO.scansell.setup(s),
    beats: [
      async (s, d) => {
        const card = s.$("#ps-ls-demo-card");
        if (card) { const { x, y } = s.center(card); await s.moveFinger(x + 60, y + 90, Math.min(600, d * 250)); }
      },
      async (s, d) => {
        s.hideFinger();
        await s.win.PS?.liveScanDemoScan?.(Math.max(700, Math.min(1500, d * 1000 * 0.6)));
        await s.idle({ quietMs: 200, timeoutMs: 1500 });
      },
      async (s, d) => {
        const hud = s.$("#ps-ls-hud");
        if (hud) await s.spotlight(hud.firstElementChild || hud, Math.min(2200, d * 800));
        else await s.sleep(d * 1000);
      },
      async (s, d) => { s.hideFinger(); await s.sleep(Math.min(1500, d * 400)); },
    ],
  },

  // H3) Tinder für Sammler: echte Swipes (rechts im Hook, links/rechts im UI-Beweis), danach über die echte
  // Navigation in den P2P-Tausch-Hub und weiter ins lokale Sammler-Radar.
  chase: {
    setup: showArena,
    beats: [
      async (s, d) => {
        await s.sleep(Math.min(700, d * 250));
        const t = s.text("#swipe-title");
        await s.swipe(s.$("#swipe-img"), 1, 650);
        await nextCardLoaded(s, t);
      },
      async (s, d) => {
        let t = s.text("#swipe-title");
        await s.swipe(s.$("#swipe-img"), -1, 560);
        await nextCardLoaded(s, t);
        if (d > 2.4) { t = s.text("#swipe-title"); await s.swipe(s.$("#swipe-img"), 1, 600); await nextCardLoaded(s, t); }
      },
      async (s) => {
        const t = s.text("#swipe-title");
        s.fact("card", t);
        await s.swipe(s.$("#swipe-img"), 1, 650);
        await nextCardLoaded(s, t);
      },
      async (s, d) => {
        try { s.win.PS?.marketMode?.("trade"); } catch {}
        try { s.win.switchTab?.("map"); } catch {}
        await s.waitFor(() => (s.$("#market-list")?.children.length || 0) > 0, 4000).catch(() => {});
        await s.idle({ quietMs: 200, timeoutMs: 2000 });
        const list = s.$("#market-list");
        if (list) { const r = list.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 150)); }
        s.hideFinger();
        await s.sleep(Math.min(1800, d * 450));
        try { s.win.PS?.showSub?.("map", "radar"); } catch {}
        await s.idle({ quietMs: 200, timeoutMs: 2000 });
        const map = s.$("#radarMap");
        if (map) { const r = map.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 120)); }
      },
    ],
  },

  // F1–F4) 15-s-Feature-Vorlagen (Set-Binder, Lücken-Kauf, Doppelte verkaufen, All-in-One) – Hook-Format mit 4 Szenen.
  // Alles läuft über die echte Oberfläche als Stage-Demo: nichts wird gespeichert, „Kaufen“ wird nur sichtbar angetippt.
  f15binder: {
    async setup(s) {
      try { s.win.PS?.showSub?.("scan", "live"); } catch {}
      await s.waitFor(() => s.$("#ps-ls-stage"), 15_000, "Live-Scanner lädt nicht").catch(() => {});
      let info = null;
      try { info = await s.win.PS?.liveScanDemoPrepare?.({ keys: ["card:sv03.5-006", "card:sv03.5-025", "card:sv03.5-003"], sleeve: true, zoom: 1.4, autoFile: true }); } catch (e) { console.warn("F15 Scan:", e); }
      if (info) { s.fact("card", info.name); if (Number(info.price) > 0) s.fact("price", `${Number(info.price).toFixed(2).replace(".", ",")} €`); }
      try { const b = await s.win.PS?.binderDemoPrepare?.("sv03.5"); if (b) s.fact("set", b.name); } catch (e) { console.warn("F15 Binder:", e); }
      const st = s.$("#ps-ls-stage");
      if (st) { const r = st.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 70)); }
      await s.decodeImages(3000);
      await s.idle({ quietMs: 300, timeoutMs: 5000 });
    },
    beats: [
      async (s, d) => {
        const card = s.$("#ps-ls-demo-card");
        if (card) { const { x, y } = s.center(card); await s.moveFinger(x + 60, y + 90, Math.min(600, d * 250)); }
      },
      async (s, d) => {
        s.hideFinger();
        await s.win.PS?.liveScanDemoScan?.(Math.max(700, Math.min(1400, d * 1000 * 0.4)));
        await s.idle({ quietMs: 150, timeoutMs: 800 });
        const price = s.$("[data-hud-price]");
        if (price) s.fact("price", price.textContent);
        const filed = await s.win.PS?.liveScanDemoFile?.();
        if (filed) await s.spotlight(filed, Math.min(1200, d * 300));
      },
      async (s, d) => {
        unspot(s); s.hideFinger();
        try { s.win.switchTab?.("portfolio"); } catch {}
        s.win.PS?.binderDemoOpen?.();
        await s.decodeImages(500);
        const slot = s.win.PS?.binderDemoGoto?.("scanned");
        if (slot) await s.spotlight(slot, Math.min(1200, d * 300));
        unspot(s);
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        if (vp) { await s.swipe(vp, -1, 520); if (d > 3) { await s.sleep(250); await s.swipe(vp, -1, 520); } }
        s.hideFinger();
      },
      async (s, d) => {
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        if (vp) await s.swipe(vp, 1, 560);
        s.hideFinger();
        await s.sleep(Math.min(1200, d * 300));
      },
    ],
  },

  f15gaps: {
    async setup(s) {
      let b = null;
      try { b = await s.win.PS?.binderDemoPrepare?.("sv03.5", { price: 6.5 }); } catch (e) { console.warn("F15 Binder:", e); }
      if (b) { s.fact("set", b.name); s.fact("gap", b.hero); }
      try { await s.win.PS?.m16DemoPrepare?.({ setId: "sv03.5", mode: "std", offer: b?.heroCard ? { ...b.heroCard, price: 6.5 } : null }); } catch (e) { console.warn("F15 Marktplatz:", e); }
      if (s.$("#view-portfolio")?.classList.contains("hidden")) { try { s.win.switchTab?.("portfolio"); } catch {} }
      s.win.PS?.binderDemoOpen?.();
      await s.decodeImages(3000);
      await s.idle({ quietMs: 250, timeoutMs: 4000 });
    },
    beats: [
      async (s, d) => {
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        await s.sleep(Math.min(500, d * 120));
        if (vp) { await s.swipe(vp, -1, 520); if (d > 3) { await s.sleep(300); await s.swipe(vp, -1, 520); } }
        const gap = s.$$("#ps-binder-view .ps-bslot:not(.owned)").find((el) => s.visible(el));
        if (gap) await s.spotlight(gap, Math.min(1200, d * 250));
        s.hideFinger();
      },
      async (s, d) => {
        unspot(s);
        s.win.PS?.binderDemoReveal?.();
        const gap = s.win.PS?.binderDemoGoto?.("hero") || s.win.PS?.binderDemoSlot?.("hero");
        if (gap) { await s.spotlight(gap); const { x, y } = s.center(gap); await s.moveFinger(x + 30, y + 60, Math.min(500, d * 300)); }
      },
      async (s, d) => {
        unspot(s);
        const gap = s.win.PS?.binderDemoSlot?.("hero");
        if (gap) await s.tap(gap, { reveal: false });
        await marketReady(s, "all");
        s.win.PS?.m16DemoMode?.("binder", "all");
        m16Top(s);
        try { s.win.PS?.m16Open?.(-900); } catch {}
        await s.idle({ quietMs: 100, timeoutMs: 600 });
        await s.sleep(Math.min(900, d * 250));
        const cta = s.$("#ps-m16-sheet .ps-m16-cta");
        if (cta) await s.tapVisual(cta); // sichtbarer Tipp – kein echter Kauf in der Aufnahme
      },
      async (s, d) => { s.hideFinger(); await s.sleep(Math.min(1500, d * 400)); },
    ],
  },

  f15dupes: {
    async setup(s) {
      let b = null;
      try { b = await s.win.PS?.binderDemoPrepare?.("sv03.5", { mode: "autobinder", listedPrice: 12.9 }); } catch (e) { console.warn("F15 Binder:", e); }
      if (b) { s.fact("set", b.name); s.fact("listed", b.listed); }
      if (s.$("#view-portfolio")?.classList.contains("hidden")) { try { s.win.switchTab?.("portfolio"); } catch {} }
      s.win.PS?.binderDemoOpen?.();
      await s.decodeImages(3000);
      await s.idle({ quietMs: 250, timeoutMs: 4000 });
    },
    beats: [
      async (s, d) => {
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        await s.sleep(Math.min(400, d * 120));
        if (vp) await s.swipe(vp, -1, 520);
        s.hideFinger();
      },
      async (s, d) => {
        const dup = s.win.PS?.binderDemoGoto?.("scanned") || s.win.PS?.binderDemoSlot?.("scanned");
        if (dup) { await s.spotlight(dup); const { x, y } = s.center(dup); await s.moveFinger(x + 30, y + 60, Math.min(500, d * 250)); await s.tapVisual(dup); }
        else await s.sleep(d * 1000);
      },
      async (s, d) => {
        unspot(s);
        s.win.PS?.binderDemoReveal?.();
        const listed = s.win.PS?.binderDemoSlot?.("listed");
        if (listed) { await s.spotlight(listed, Math.min(1500, d * 400)); const { x, y } = s.center(listed); await s.moveFinger(x + 30, y + 60, 450); }
        else await s.sleep(Math.min(1500, d * 400));
      },
      async (s, d) => { unspot(s); s.hideFinger(); await s.sleep(Math.min(1500, d * 400)); },
    ],
  },

  f15all: {
    async setup(s) {
      await CHOREO.f15binder.setup(s);
      try { await s.win.PS?.m16DemoPrepare?.({ setId: "sv03.5", mode: "std" }); } catch (e) { console.warn("F15 Marktplatz:", e); }
    },
    beats: [
      async (s, d) => {
        s.hideFinger();
        await s.win.PS?.liveScanDemoScan?.(Math.max(700, Math.min(1200, d * 1000 * 0.5)));
        await s.idle({ quietMs: 150, timeoutMs: 600 });
        const filed = await s.win.PS?.liveScanDemoFile?.();
        if (filed) await s.spotlight(filed, Math.min(900, d * 250));
        unspot(s);
        try { s.win.switchTab?.("portfolio"); } catch {}
        s.win.PS?.binderDemoOpen?.();
        await s.decodeImages(400);
      },
      async (s, d) => {
        s.win.PS?.binderDemoReveal?.();
        const gap = s.win.PS?.binderDemoGoto?.("hero") || s.win.PS?.binderDemoSlot?.("hero");
        if (gap) { await s.spotlight(gap); await s.tap(gap, { reveal: false }); }
        unspot(s);
        await marketReady(s, "all");
        m16Top(s);
        await s.sleep(Math.min(800, d * 300));
      },
      async (s, d) => {
        s.hideFinger();
        await s.scrollBy(VIEW_H * 0.3, Math.max(700, d * 1000 * 0.6));
      },
      async (s, d) => {
        s.$("#ps-binder-view")?.classList.add("hidden");
        s.win.document?.body?.classList.remove("ps-binder-open");
        try { s.win.switchTab?.("map"); s.win.PS?.showSub?.("map", "radar"); } catch {}
        await s.idle({ quietMs: 200, timeoutMs: 1500 });
        const map = s.$("#radarMap");
        if (map) { const r = map.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 120)); }
        s.hideFinger();
        await s.sleep(Math.min(1200, d * 300));
      },
    ],
  },

  // P1–P4) 🔥 Aktuelle Pro-Videos (Set-Binder & Marktplatz) – Hook-Format mit 4 Beats:
  // Beat 1 = Hook · Beat 2+3 = UI-Beweis (erste/zweite Hälfte) · Beat 4 = Nutzen (Kauf-/Verkaufs-Sheet im Compositor).
  // Alles läuft über die echte Oberfläche als Stage-Demo: nichts wird gespeichert, gekauft oder wirklich inseriert.
  p4binder: {
    async setup(s) { await CHOREO.f15binder.setup(s); },
    beats: [
      async (s, d) => { // Hook: Kamera über der Karte
        const card = s.$("#ps-ls-demo-card");
        if (card) { const { x, y } = s.center(card); await s.moveFinger(x + 60, y + 90, Math.min(700, d * 250)); }
      },
      async (s, d) => { // „scannst du deine Karte einfach ein“
        s.hideFinger();
        await s.win.PS?.liveScanDemoScan?.(Math.max(700, Math.min(1400, d * 1000 * 0.6)));
        await s.idle({ quietMs: 150, timeoutMs: 800 });
        const price = s.$("[data-hud-price]");
        if (price) s.fact("price", price.textContent);
      },
      async (s, d) => { // „sortiert sich … an ihren exakten Platz“
        const filed = await s.win.PS?.liveScanDemoFile?.();
        if (filed) await s.spotlight(filed, Math.min(1200, d * 300));
        unspot(s);
        try { s.win.switchTab?.("portfolio"); } catch {}
        s.win.PS?.binderDemoOpen?.();
        await s.decodeImages(500);
        const slot = s.win.PS?.binderDemoGoto?.("scanned");
        if (slot) await s.spotlight(slot, Math.min(1500, d * 400));
      },
      async (s, d) => { // Switch-Funktion: durch die Seiten blättern, zurück, Fortschritt
        unspot(s);
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        const flips = d > 6 ? 3 : 2;
        if (vp) for (let i = 0; i < flips; i++) { await s.swipe(vp, -1, 520); await s.sleep(Math.min(900, d * 80)); }
        if (vp) { await s.swipe(vp, 1, 560); await s.sleep(250); await s.swipe(vp, 1, 560); }
        s.hideFinger();
      },
    ],
  },

  p4gaps: {
    async setup(s) { await CHOREO.f15gaps.setup(s); },
    beats: [
      async (s, d) => { // Hook: durch das Set blättern
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        await s.sleep(Math.min(500, d * 100));
        if (vp) { await s.swipe(vp, -1, 520); if (d > 3) { await s.sleep(500); await s.swipe(vp, -1, 520); } }
        s.hideFinger();
      },
      async (s, d) => { // graue Platzhalter zeigen
        const gaps = s.$$("#ps-binder-view .ps-bslot:not(.owned)").filter((el) => s.visible(el)).slice(0, 3);
        for (const g of gaps) { await s.spotlight(g, Math.min(900, (d * 1000) / 4)); unspot(s); }
        if (!gaps.length) await s.sleep(Math.min(1500, d * 400));
      },
      async (s, d) => { // „Ein Tipp auf die Lücke genügt“
        unspot(s);
        s.win.PS?.binderDemoReveal?.();
        const gap = s.win.PS?.binderDemoGoto?.("hero") || s.win.PS?.binderDemoSlot?.("hero");
        if (gap) { await s.spotlight(gap); const { x, y } = s.center(gap); await s.moveFinger(x + 30, y + 60, Math.min(500, d * 250)); await s.tap(gap, { reveal: false }); }
        unspot(s);
      },
      async (s, d) => { // 1-Klick-Kauf auf dem Marktplatz (nur sichtbarer Tipp)
        await marketReady(s, "all");
        s.win.PS?.m16DemoMode?.("binder", "all");
        m16Top(s);
        try { s.win.PS?.m16Open?.(-900); } catch {}
        await s.idle({ quietMs: 100, timeoutMs: 600 });
        await s.sleep(Math.min(900, d * 200));
        const cta = s.$("#ps-m16-sheet .ps-m16-cta");
        if (cta) await s.tapVisual(cta);
        s.hideFinger();
      },
    ],
  },

  p4dupes: {
    async setup(s) { await CHOREO.f15dupes.setup(s); },
    beats: [
      async (s, d) => { // Hook: Binder öffnen und blättern
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        await s.sleep(Math.min(400, d * 100));
        if (vp) await s.swipe(vp, -1, 520);
        s.hideFinger();
      },
      async (s, d) => { // Doppelte im Binder (2×) antippen
        const dup = s.win.PS?.binderDemoGoto?.("scanned") || s.win.PS?.binderDemoSlot?.("scanned");
        if (dup) { await s.spotlight(dup); const { x, y } = s.center(dup); await s.moveFinger(x + 30, y + 60, Math.min(500, d * 250)); await s.tapVisual(dup); }
        else await s.sleep(d * 1000);
      },
      async (s, d) => { // „mit einem Klick auf den Marktplatz“ → Inserat im Binder sichtbar
        unspot(s);
        s.win.PS?.binderDemoReveal?.();
        const listed = s.win.PS?.binderDemoSlot?.("listed");
        if (listed) { await s.spotlight(listed, Math.min(1500, d * 400)); const { x, y } = s.center(listed); await s.moveFinger(x + 30, y + 60, 450); }
        else await s.sleep(Math.min(1500, d * 400));
      },
      async (s, d) => { unspot(s); s.hideFinger(); await s.sleep(Math.min(1500, d * 300)); }, // Verkaufs-Sheet (−5 % / −10 %) im Compositor
    ],
  },

  p4all: {
    async setup(s) {
      await CHOREO.f15binder.setup(s);
      try { await s.win.PS?.m16DemoPrepare?.({ setId: "sv03.5", mode: "std" }); } catch (e) { console.warn("P4 Marktplatz:", e); }
    },
    beats: [
      async (s, d) => { // Hook: Scanner mit Karte
        const card = s.$("#ps-ls-demo-card");
        if (card) { const { x, y } = s.center(card); await s.moveFinger(x + 60, y + 90, Math.min(800, d * 200)); }
        s.hideFinger();
      },
      async (s, d) => { // scannen → einsortieren → blättern
        await s.win.PS?.liveScanDemoScan?.(Math.max(800, Math.min(1400, d * 1000 * 0.25)));
        await s.idle({ quietMs: 150, timeoutMs: 600 });
        const filed = await s.win.PS?.liveScanDemoFile?.();
        if (filed) await s.spotlight(filed, Math.min(1000, d * 150));
        unspot(s);
        try { s.win.switchTab?.("portfolio"); } catch {}
        s.win.PS?.binderDemoOpen?.();
        await s.decodeImages(400);
        const slot = s.win.PS?.binderDemoGoto?.("scanned");
        if (slot) await s.spotlight(slot, Math.min(1000, d * 150));
        unspot(s);
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        if (vp) { await s.swipe(vp, -1, 520); await s.sleep(400); await s.swipe(vp, -1, 520); }
        s.hideFinger();
      },
      async (s, d) => { // fehlende Karte → 1-Klick-Kauf
        s.win.PS?.binderDemoReveal?.();
        const gap = s.win.PS?.binderDemoGoto?.("hero") || s.win.PS?.binderDemoSlot?.("hero");
        if (gap) { await s.spotlight(gap, Math.min(1200, d * 200)); await s.tap(gap, { reveal: false }); }
        unspot(s);
        await marketReady(s, "all");
        m16Top(s);
        try { s.win.PS?.m16Open?.(-900); } catch {}
        await s.idle({ quietMs: 100, timeoutMs: 600 });
        await s.sleep(Math.min(900, d * 150));
        const cta = s.$("#ps-m16-sheet .ps-m16-cta");
        if (cta) await s.tapVisual(cta);
        s.hideFinger();
      },
      async (s, d) => { // Doppelte verkaufen (Sheet im Compositor) → Sammler-Radar auf der Karte
        await s.sleep(Math.min(5000, d * 1000 * 0.5));
        s.$("#ps-binder-view")?.classList.add("hidden");
        s.win.document?.body?.classList.remove("ps-binder-open");
        try { s.win.switchTab?.("map"); s.win.PS?.showSub?.("map", "radar"); } catch {}
        await s.idle({ quietMs: 200, timeoutMs: 1500 });
        const map = s.$("#radarMap");
        if (map) { const r = map.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 120)); }
        s.hideFinger();
      },
    ],
  },

  // 12) Pro-Showcase (29 s, 4 Szenen mit festem Regie-Zeitplan TL aus reel-pro.js – die Tonspur legt ihre
  // Mikro-SFX exakt auf dieselben Zeitpunkte). Beat 1 Blitz-Scanner · 2 Set-Binder & Lücken-Radar ·
  // 3 Marktplatz, Swipe-Tausch & Live-Chat (+ Pro-Einblendung im Compositor) · 4 Startseite ohne Login-Zwang.
  // Alles läuft über die echte Oberfläche; Scanner-„Binder“, Ordner-Füllung und Badge sind Stage-Demos ohne Schreibzugriff,
  // „Kaufen“ wird nur sichtbar angetippt (kein Kauf, keine Reservierung).
  showcase: {
    async setup(s) {
      try { s.win.PS?.showSub?.("scan", "live"); } catch {}
      await s.waitFor(() => s.$("#ps-ls-stage"), 15_000, "Live-Scanner lädt nicht").catch(() => {});
      let info = null;
      try {
        info = await s.win.PS?.liveScanDemoPrepare?.({ keys: ["card:sv03.5-006", "card:sv03.5-003", "card:sv03.5-009", "card:sv03.5-025"], sleeve: true, zoom: 1.4 });
      } catch (e) { console.warn("Showcase-Scan-Demo:", e); }
      if (info) { s.fact("card", info.name); if (Number(info.price) > 0) s.fact("price", `${Number(info.price).toFixed(2).replace(".", ",")} €`); }
      try { const b = await s.win.PS?.binderDemoPrepare?.("sv03.5", { price: 29.9 }); if (b) { s.fact("set", b.name); s.fact("gap", b.hero); } } catch (e) { console.warn("Showcase-Binder-Demo:", e); }
      const st = s.$("#ps-ls-stage");
      if (st) { const r = st.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 70)); }
      await s.decodeImages(3000);
      await s.idle({ quietMs: 300, timeoutMs: 5000 });
    },
    beats: [
      // Szene 1 (0–6 s): Blitz-Scanner – 1,4×-Zoom, „Erkannt“ mit Near-Mint-Preis, Zustand ▾, Tipp auf „Binder“
      async (s, d, at) => {
        const card = s.$("#ps-ls-demo-card");
        if (card) { const { x, y } = s.center(card); await s.moveFinger(x + 70, y + 110, 420); }
        await at(TL.scanStart);
        s.hideFinger();
        await s.win.PS?.liveScanDemoScan?.(TL.scanMs);
        await s.idle({ quietMs: 150, timeoutMs: 900 });
        const price = s.$("[data-hud-price]");
        if (price) { s.fact("price", price.textContent); await s.spotlight(price); }
        await at(TL.condTap);
        s.$$(".ps-reel-spot").forEach((el) => el.classList.remove("ps-reel-spot"));
        const cond = s.$("[data-hud-cond]");
        if (cond) await s.tap(cond, { reveal: false });
        await at(TL.condPick);
        const nm = s.$('[data-cond][aria-selected="true"]') || s.$('[data-cond="NM"]');
        if (nm) await s.tap(nm, { reveal: false });
        await at(TL.binderTap);
        const bin = s.$('#ps-ls-hud [data-act="binder"]');
        if (bin) await s.tap(bin, { reveal: false });
        await at(TL.navCollection);
        const nav = s.$("#mob-portfolio");
        if (nav) await s.tap(nav, { reveal: false });
      },
      // Szene 2 (6–15 s): gefüllter 3×3-Set-Ordner, flüssig blättern, Lücke leuchtet „Auf Marktplatz: 29,90 €“, Tipp → Angebot
      async (s, d, at) => {
        await at(TL.binderOpen);
        s.hideFinger();
        const opened = s.win.PS?.binderDemoOpen?.();
        if (!opened) {
          // Rückfall: echter Sammlungs-Reiter (Mein Binder) ohne Demo-Ordner
          const seg = s.$('#view-portfolio [data-seg="binder"]');
          if (seg) await s.tap(seg, { reveal: false });
          return s.sleep(Math.max(0, d * 1000 - 800));
        }
        await s.decodeImages(900);
        const vp = () => s.$("#ps-binder-view [data-binder-viewport]");
        await at(TL.flip1);
        if (vp()) await s.swipe(vp(), -1, 520);
        await at(TL.flip2);
        if (vp()) await s.swipe(vp(), -1, 520);
        await at(TL.flipBack);
        if (vp()) await s.swipe(vp(), 1, 560);
        s.hideFinger();
        await at(TL.badgeOn);
        const slot = s.win.PS?.binderDemoReveal?.();
        if (!slot) return;
        await s.spotlight(slot);
        const { x, y } = s.center(slot);
        await s.moveFinger(x + 40, y + 70, 700);
        await at(TL.missingTap);
        s.$$(".ps-reel-spot").forEach((el) => el.classList.remove("ps-reel-spot"));
        const fresh = s.$(`#ps-binder-view [data-binder-card="${slot.dataset.binderCard}"]`) || slot;
        await s.tap(fresh, { reveal: false });
        if (s.$("#view-map")?.classList.contains("hidden")) { try { s.win.switchTab?.("map"); } catch {} }
        await s.waitFor(() => s.$$("#market-list .ps-tile[data-listing]").length > 0, 2500).catch(() => {});
        const list = s.$("#ps-market-main");
        if (list) { const r = list.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 64)); }
      },
      // Szene 3 (15–23 s): 2-Spalten-Marktplatz (Kaufen/Verkaufen), Swipe-Tausch, aktiver Live-Chat – Pro-Einblendung ab 19 s
      async (s, d, at) => {
        await at(TL.marketPan);
        s.hideFinger();
        await s.scrollBy(VIEW_H * 0.32, 1100);
        const tile = s.$$("#market-list .ps-tile[data-listing]").find((t) => { const r = t.getBoundingClientRect(); return r.top > 90 && r.bottom < VIEW_H - 90; });
        if (tile) {
          await at(TL.buyTap);
          const cta = tile.querySelector(".ps-tile-cta") || tile;
          await s.tapVisual(cta);
          await at(TL.priceGlow);
          await s.spotlight(tile);
        }
        await at(TL.swipeTab);
        s.$$(".ps-reel-spot").forEach((el) => el.classList.remove("ps-reel-spot"));
        const seg = s.$('#view-map [data-seg="swipe"]');
        if (seg) { await s.reveal(seg, { ms: 250, ratio: 0.2 }); await s.tap(seg, { reveal: false }); }
        await at(TL.chatTab);
        const com = s.$("#mob-community");
        if (com) await s.tap(com, { reveal: false });
        try { s.win.PS?.communityTab?.("chat"); } catch {}
        await s.idle({ quietMs: 150, timeoutMs: 800 });
        const chat = s.$("#ps-chat-panel");
        s.hideFinger();
        if (chat) await s.reveal(chat, { ms: 600, ratio: 0.12 });
        const box = s.$("#chat-messages");
        if (box) await s.scrollTo(box.scrollHeight, 1400, box);
        await at(TL.homeTap);
        const home = s.$("#mob-home");
        if (home) await s.tap(home, { reveal: false });
        s.win.scrollTo(0, 0);
      },
      // Szene 4 (23–29 s): aufgeräumte Startseite ohne Login-Zwang – ruhige Kamerafahrt, Endtafel im Compositor
      async (s, d) => {
        s.hideFinger();
        s.win.scrollTo(0, 0);
        await s.sleep(Math.min(900, d * 150));
        await s.scrollBy(VIEW_H * 0.18, Math.max(1200, d * 1000 * 0.45));
      },
    ],
  },

  // 13) Master-Vorlage „Reel: Neuer automatischer Binder & Bulk-Marktplatz-Power“ (29 s, fester Regie-Zeitplan AB aus
  // reel-pro.js – die Tonspur legt ihre Mikro-SFX exakt auf dieselben Zeitpunkte). Beat 1 Live-Scan & automatische Ablage ·
  // 2 Set-Binder mit Doppelten & Gesamtwert-Schalter · 3 Meine Inserate → „Alle Doppelten inserieren“ → zurück zur Lücke ·
  // 4 Live-Chat → Startseite. Alles läuft über die echte Oberfläche; Ablage, Inserate und Ordner-Füllung sind Stage-Demos
  // ohne Schreibzugriff aufs Konto.
  autobinder: {
    async setup(s) {
      try { s.win.PS?.showSub?.("scan", "live"); } catch {}
      await s.waitFor(() => s.$("#ps-ls-stage"), 15_000, "Live-Scanner lädt nicht").catch(() => {});
      let info = null;
      try {
        info = await s.win.PS?.liveScanDemoPrepare?.({ keys: ["card:sv03.5-006", "card:sv03.5-199", "card:sv03.5-025", "card:sv03.5-003"], sleeve: true, zoom: 1.4, autoFile: true, listDemo: true });
      } catch (e) { console.warn("Master-Scan-Demo:", e); }
      if (info) { s.fact("card", info.name); if (Number(info.price) > 0) s.fact("price", `${Number(info.price).toFixed(2).replace(".", ",")} €`); }
      try {
        const b = await s.win.PS?.binderDemoPrepare?.("sv03.5", { mode: "autobinder", price: AUTOBINDER_BADGES.gap, listedPrice: AUTOBINDER_BADGES.listed });
        if (b) { s.fact("set", b.name); s.fact("gap", b.hero); s.fact("listed", b.listed); }
      } catch (e) { console.warn("Master-Binder-Demo:", e); }
      const st = s.$("#ps-ls-stage");
      if (st) { const r = st.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 70)); }
      await s.decodeImages(3000);
      await s.idle({ quietMs: 300, timeoutMs: 5000 });
    },
    beats: [
      // Szene 1 (0–6 s): Karte in Schutzhülle scharf erfassen → Panel (Bild, Name, NM, Cardmarket-Wert) →
      // „📒 Im Set-Ordner einsortiert“ → Tipp auf „🏷️ Als Inserat einstellen“ → Bestätigung → Reiter „Sammlung“
      async (s, d, at) => {
        const card = s.$("#ps-ls-demo-card");
        if (card) { const { x, y } = s.center(card); await s.moveFinger(x + 70, y + 110, 420); }
        await at(AB.scanStart);
        s.hideFinger();
        await s.win.PS?.liveScanDemoScan?.(AB.scanMs);
        await s.idle({ quietMs: 150, timeoutMs: 600 });
        const price = s.$("[data-hud-price]");
        if (price) s.fact("price", price.textContent);
        await at(AB.filed);
        const filed = await s.win.PS?.liveScanDemoFile?.();
        if (filed) await s.spotlight(filed);
        await at(AB.sellTap);
        unspot(s);
        const sell = s.$('#ps-ls-hud [data-act="sell"]');
        if (sell) await s.tap(sell, { reveal: false });
        await at(AB.navCollection);
        const nav = s.$("#mob-portfolio");
        if (nav) await s.tap(nav, { reveal: false });
      },
      // Szene 2 (6–14 s): Set-Ordner „151“ – wischen, „2x“ auf der gescannten Karte, Schalter „Doppelte im Gesamtwert mitzählen“
      async (s, d, at) => {
        await at(AB.binderOpen);
        s.hideFinger();
        const opened = s.win.PS?.binderDemoOpen?.();
        if (!opened) {
          const seg = s.$('#view-portfolio [data-seg="binder"]');
          if (seg) await s.tap(seg, { reveal: false });
          return s.sleep(Math.max(0, d * 1000 - 800));
        }
        await s.decodeImages(900);
        const vp = () => s.$("#ps-binder-view [data-binder-viewport]");
        await at(AB.flip1);
        if (vp()) await s.swipe(vp(), -1, 520);
        await at(AB.flipBack);
        if (vp()) await s.swipe(vp(), 1, 560);
        const sw = () => s.$("#ps-binder-view [data-count-dupes]");
        await at(AB.toggleOff);
        if (sw()) await s.tap(sw(), { reveal: false });
        await at(AB.toggleOn);
        if (sw()) await s.tap(sw(), { reveal: false });
        s.hideFinger();
        await at(AB.dupeSpot);
        const dupe = s.win.PS?.binderDemoSlot?.("scanned");
        if (dupe) await s.spotlight(dupe);
      },
      // Szene 3 (14–22 s): Marktplatz → Meine Inserate → „🏷️ Alle Doppelten inserieren (12)“ → Bestätigen → Lade-Animation →
      // zurück in den Ordner: graue Lücke mit „Auf Marktplatz: 4,50 €“ + eigenes Inserat „Im Verkauf: 12,90 €“
      async (s, d, at) => {
        await at(AB.mineOpen);
        unspot(s);
        s.hideFinger();
        try { s.win.PS?.closeSetBinder?.(); } catch {}
        const demo = s.win.PS?.listPickerDemoStart?.({ ms: AB.listMs });
        if (demo) s.fact("dupes", String(demo.copies));
        try { s.win.PS?.marketTab?.("sell"); } catch {}
        await s.idle({ quietMs: 120, timeoutMs: 600 });
        const picker = s.$("#ps-list-picker");
        if (picker) { const r = picker.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 120)); }
        await s.decodeImages(500);
        await at(AB.bulkTap);
        const bulk = s.$("#ps-list-picker [data-list-dupes]");
        if (bulk) await s.tap(bulk, { reveal: false });
        await at(AB.confirmTap);
        const ok = s.$("#ps-dupes-confirm:not(.hidden) [data-dupes-confirm]");
        if (ok) await s.tap(ok, { reveal: false });
        s.hideFinger();
        await at(AB.binderBack);
        try { s.win.switchTab?.("portfolio"); } catch {}
        s.win.PS?.binderDemoOpen?.();
        await s.decodeImages(400);
        await at(AB.reveal);
        const gap = s.win.PS?.binderDemoReveal?.();
        if (gap) await s.spotlight(gap);
        await at(AB.listedSpot);
        const listed = s.win.PS?.binderDemoSlot?.("listed");
        if (listed) await s.spotlight(listed);
      },
      // Szene 4 (22–29 s): Community-Live-Chat (Sammler besprechen Tauschangebote) → zurück zur Startseite, Endtafel im Compositor
      async (s, d, at) => {
        unspot(s);
        try { s.win.PS?.closeSetBinder?.(); } catch {}
        await at(AB.chatTab);
        const com = s.$("#mob-community");
        if (com) await s.tap(com, { reveal: false });
        try { s.win.PS?.communityTab?.("chat"); } catch {}
        await s.idle({ quietMs: 150, timeoutMs: 800 });
        s.hideFinger();
        const chat = s.$("#ps-chat-panel");
        if (chat) await s.reveal(chat, { ms: 600, ratio: 0.12 });
        const box = s.$("#chat-messages");
        if (box) await s.scrollTo(box.scrollHeight, 1500, box);
        await at(AB.homeTap);
        const home = s.$("#mob-home");
        if (home) await s.tap(home, { reveal: false });
        s.win.scrollTo(0, 0);
        s.hideFinger();
        await s.sleep(700);
        await s.scrollBy(VIEW_H * 0.16, 1600);
      },
    ],
  },


  // K1) Kurz-Reel „Verbesserter Live-Scanner & Preisschild“ (8 s): Frame 0 = freies Scanner-Kamerabild mit Top-Karte, Laser läuft
  // sofort → Preis-Etikett poppt auf → automatisch im Set-Ordner (Seite der Karte) → nächste Karte gescannt → „⚡ Inserat“ →
  // eigenes Inserat unter Cardmarket-Preis im 16er Marktplatz. Kein Schreibzugriff (Stage-Demos).
  shortscan: {
    async setup(s) {
      const tpl = shortTpl("shortscan");
      try { s.win.PS?.showSub?.("scan", "live"); } catch {}
      await s.waitFor(() => s.$("#ps-ls-stage"), 15_000, "Live-Scanner lädt nicht").catch(() => {});
      // 2. Karte einmal vorab bereitlegen (Bild im Cache), damit der zweite Scan ohne Ladezeit startet
      try { await s.win.PS?.liveScanDemoPrepare?.({ keys: tpl.nextKeys, sleeve: true, listDemo: true, autoFile: true }); } catch (e) { console.warn("Kurz-Reel Scan 2:", e); }
      try { const b = await s.win.PS?.binderDemoPrepare?.(tpl.binderSet || "sv03.5", { price: 6.5 }); if (b) s.fact("set", b.name); } catch (e) { console.warn("Kurz-Reel Binder:", e); }
      try { await s.win.PS?.m16DemoPrepare?.({ setId: tpl.binderSet || "sv03.5", mode: "std" }); } catch (e) { console.warn("Kurz-Reel Marktplatz:", e); }
      let info = null;
      try { info = await s.win.PS?.liveScanDemoPrepare?.({ keys: tpl.scanKeys, sleeve: true, zoom: 1.4, autoFile: true, listDemo: true }); } catch (e) { console.warn("Kurz-Reel Scan:", e); }
      if (info) { s.fact("card", info.name); if (Number(info.price) > 0) s.fact("price", `${Number(info.price).toFixed(2).replace(".", ",")} €`); }
      const st = s.$("#ps-ls-stage");
      if (st) { const r = st.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 70)); }
      await s.decodeImages(3000);
      await s.idle({ quietMs: 250, timeoutMs: 4000 });
    },
    beats: [
      async (s, d, at) => {
        const T = ST.shortscan;
        s.hideFinger();
        await at(T.scanStart);
        await s.win.PS?.liveScanDemoScan?.(T.scanMs);
        const price = s.$("[data-hud-price]");
        if (price) { s.fact("price", price.textContent); await s.spotlight(price); }
        await at(T.filed);
        unspot(s);
        const filed = await s.win.PS?.liveScanDemoFile?.();
        if (filed) await s.spotlight(filed);
      },
      async (s, d, at) => {
        const T = ST.shortscan;
        await at(T.binderOpen);
        unspot(s); s.hideFinger();
        if (!s.win.PS?.binderDemoOpen?.()) { const nav = s.$("#mob-portfolio"); if (nav) await s.tap(nav, { reveal: false }); return; }
        const slot = s.win.PS?.binderDemoGoto?.("scanned");
        await s.decodeImages(500);
        await at(T.scannedSpot);
        const el = slot?.isConnected ? slot : s.win.PS?.binderDemoSlot?.("scanned");
        if (el) await s.spotlight(el);
      },
      async (s, d, at) => {
        const T = ST.shortscan, tpl = shortTpl("shortscan");
        await at(T.scanner2);
        unspot(s);
        try { s.win.PS?.closeSetBinder?.(); } catch {}
        try { s.win.PS?.showSub?.("scan", "live"); } catch {}
        try { await s.win.PS?.liveScanDemoPrepare?.({ keys: tpl.nextKeys, sleeve: true, zoom: 1.3, listDemo: true, autoFile: true }); } catch {}
        const st = s.$("#ps-ls-stage");
        if (st) { const r = st.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 70)); }
        await at(T.scan2Start);
        await s.win.PS?.liveScanDemoScan?.(T.scan2Ms);
        await at(T.instantTap);
        const btn = s.$('#ps-ls-hud [data-act="instant"]') || s.$('#ps-ls-hud [data-act="sell"]');
        if (btn) await s.tap(btn, { reveal: false });
      },
      async (s, d, at) => {
        const T = ST.shortscan;
        await at(T.marketOpen);
        unspot(s); s.hideFinger();
        await marketReady(s, "all");
        s.win.PS?.m16DemoMode?.("binder", "all");
        await s.idle({ quietMs: 100, timeoutMs: 500 });
        m16Top(s);
        await s.decodeImages(500);
        await at(T.sheetOpen);
        const own = s.$('#ps-m16 [data-m16-id="-1"]');
        if (own) await s.spotlight(own);
        try { s.win.PS?.m16Open?.(own ? -1 : Number(m16Pocket(s)?.dataset.m16Id)); } catch {}
        await s.idle({ quietMs: 100, timeoutMs: 500 });
      },
    ],
  },

  // K2) Kurz-Reel „Echtes 3D-Binder-Blättern & Preisetiketten“ (9 s): Frame 0 = geöffneter dunkler Set-Ordner, der Finger
  // blättert sofort in 3D um → Preisetiketten an eigenen Karten → Lücke „🛒 Ab 6,50 €“ (bzw. eBay-Etikett) → 1 Tipp → Angebot
  // im Marktplatz-Sheet → zurück in den Ordner, Schwenk über die gefüllte Seite.
  shortbinder: {
    async setup(s) {
      const tpl = shortTpl("shortbinder");
      let b = null;
      try { b = await s.win.PS?.binderDemoPrepare?.(tpl.binderSet || "sv03.5", { price: tpl.gapPrice || 6.5 }); } catch (e) { console.warn("Kurz-Reel Binder:", e); }
      if (b) { s.fact("set", b.name); s.fact("gap", b.hero); }
      try { await s.win.PS?.m16DemoPrepare?.({ setId: tpl.binderSet || "sv03.5", mode: "std", offer: b?.heroCard ? { ...b.heroCard, price: tpl.gapPrice || 6.5 } : null }); } catch (e) { console.warn("Kurz-Reel Marktplatz:", e); }
      if (s.$("#view-portfolio")?.classList.contains("hidden")) { try { s.win.switchTab?.("portfolio"); } catch {} }
      s.win.PS?.binderDemoOpen?.();
      await s.decodeImages(3000);
      await s.idle({ quietMs: 250, timeoutMs: 4000 });
    },
    beats: [
      async (s, d, at) => {
        const T = ST.shortbinder;
        const vp = () => s.$("#ps-binder-view [data-binder-viewport]");
        await at(T.flip1);
        if (vp()) await s.swipe(vp(), -1, 480);
        await at(T.flip2);
        if (vp()) await s.swipe(vp(), -1, 480);
        s.hideFinger();
      },
      async (s, d, at) => {
        const T = ST.shortbinder;
        await at(T.tagSpot);
        const tag = s.$$("#ps-binder-view .ps-bslot.owned").find((el) => s.visible(el));
        if (tag) await s.spotlight(tag);
        await at(T.reveal);
        unspot(s);
        // Lücke mit Marktplatz-Angebot: Ordner springt auf deren Seite, das Etikett leuchtet auf
        s.win.PS?.binderDemoReveal?.();
        const gap = s.win.PS?.binderDemoGoto?.("hero") || s.win.PS?.binderDemoSlot?.("hero");
        if (gap) { await s.spotlight(gap); const { x, y } = s.center(gap); await s.moveFinger(x + 30, y + 60, 500); }
      },
      async (s, d, at) => {
        const T = ST.shortbinder;
        await at(T.gapTap);
        unspot(s);
        const gap = s.win.PS?.binderDemoSlot?.("hero");
        if (gap) await s.tap(gap, { reveal: false });
        await marketReady(s, "all");
        s.win.PS?.m16DemoMode?.("binder", "all");
        m16Top(s);
        await at(T.sheetOpen);
        try { s.win.PS?.m16Open?.(-900); } catch {}
        await s.idle({ quietMs: 100, timeoutMs: 500 });
        await at(T.buyTap);
        const cta = s.$("#ps-m16-sheet .ps-m16-cta");
        if (cta) await s.tapVisual(cta); // sichtbarer Tipp – kein echter Kauf in der Aufnahme
      },
      async (s, d, at) => {
        const T = ST.shortbinder;
        await at(T.binderBack);
        s.hideFinger();
        try { s.win.PS?.m16Close?.(); } catch {}
        try { s.win.switchTab?.("portfolio"); } catch {}
        s.win.PS?.binderDemoOpen?.();
        await s.decodeImages(400);
        await at(T.pan);
        const vp = s.$("#ps-binder-view [data-binder-viewport]");
        if (vp) await s.swipe(vp, -1, 560);
        s.hideFinger();
      },
    ],
  },

  // K3) Kurz-Reel „16er Marktplatz-Binder & Echtes Hochschieben“ (9 s): Frame 0 = voller 4×4-Marktplatz-Binder, Seite schlägt
  // sofort in 3D um → Deal antippen (Detail-Sheet) → Umschalter „👆 Swipe“ → 2× echtes Hochschieben → „⚡ Spontan mitnehmen“.
  shortmarket: {
    async setup(s) {
      const tpl = shortTpl("shortmarket");
      await marketReady(s, "all");
      try { await s.win.PS?.m16DemoPrepare?.({ setId: tpl.binderSet || "sv03.5", mode: "binder" }); } catch (e) { console.warn("Kurz-Reel Marktplatz:", e); }
      await s.waitFor(() => s.$("#ps-m16 [data-m16-book]"), 8000, "16er Binder lädt nicht").catch(() => {});
      m16Top(s);
      await s.decodeImages(3000);
      await s.idle({ quietMs: 250, timeoutMs: 4000 });
    },
    beats: [
      async (s, d, at) => {
        const T = ST.shortmarket;
        await at(T.turn1);
        const book = s.$("#ps-m16 [data-m16-book]");
        if (book) await s.swipe(book, -1, 460);
        s.hideFinger();
        await at(T.dealSpot);
        const p = m16Pocket(s, true);
        if (p) { await s.spotlight(p); const { x, y } = s.center(p); await s.moveFinger(x + 20, y + 40, 420); }
      },
      async (s, d, at) => {
        const T = ST.shortmarket;
        await at(T.dealTap);
        unspot(s);
        const p = m16Pocket(s, true);
        if (p) await s.tap(p, { reveal: false });
        await at(T.sheetSpot);
        const price = s.$("#ps-m16-sheet .ps-m16-vprice") || s.$("#ps-m16-sheet .ps-m16-cta");
        if (price) await s.spotlight(price);
        await at(T.closeTap);
        unspot(s);
        const x = s.$("#ps-m16-sheet .ps-m16-sheet-x");
        if (x) await s.tap(x, { reveal: false }); else s.win.PS?.m16Close?.();
        await at(T.swipeMode);
        const tab = s.$('#ps-m16 [data-m16-mode="swipe"]');
        if (tab) await s.tap(tab, { reveal: false }); else s.win.PS?.m16DemoMode?.("swipe");
        await s.idle({ quietMs: 80, timeoutMs: 400 });
        m16Top(s);
      },
      async (s, d, at) => {
        const T = ST.shortmarket;
        const vs = () => s.$("#ps-m16 [data-vs-cur]") || s.$("#ps-m16 [data-vs]");
        await at(T.up1);
        if (vs()) await s.swipeV(vs(), -270, 430);
        await at(T.up2);
        if (vs()) await s.swipeV(vs(), -270, 430);
        s.hideFinger();
      },
      async (s, d, at) => {
        const T = ST.shortmarket;
        await at(T.buyTap);
        const cta = s.$("#ps-m16 .ps-m16-cta");
        if (cta) await s.tapVisual(cta); // sichtbarer Tipp – kein echter Kauf in der Aufnahme
        s.hideFinger();
      },
    ],
  },

  // K4) Kurz-Reel „NEU: Pokémon-Artikel verkaufen & entdecken“ (8 s): Frame 0 = 📦 Pokémon-Artikel im Hochschieben-Modus mit
  // den Unterkategorien → Display, Top-Trainer-Box, Sammelordner → Verkaufen-Flow (Foto, Titel, Preis, „Neu & OVP“) →
  // 16er Binder mit Karten + Artikeln gemischt. Das Formular wird nie abgeschickt.
  shortitems: {
    async setup(s) {
      const tpl = shortTpl("shortitems");
      await marketReady(s, "all");
      try { await s.win.PS?.m16DemoPrepare?.({ setId: tpl.binderSet || "sv03.5", mode: "swipe", type: "item", itemsFirst: true }); } catch (e) { console.warn("Kurz-Reel Artikel:", e); }
      await s.waitFor(() => s.$("#ps-m16 [data-vs]"), 8000, "Artikel-Stapel lädt nicht").catch(() => {});
      const bar = s.$("#ps-m16 [data-m16-bar]");
      if (bar) { const r = bar.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 60)); }
      await s.decodeImages(3000);
      await s.idle({ quietMs: 250, timeoutMs: 4000 });
    },
    beats: [
      async (s, d, at) => {
        const T = ST.shortitems;
        const vs = () => s.$("#ps-m16 [data-vs-cur]") || s.$("#ps-m16 [data-vs]");
        await at(T.up1);
        if (vs()) await s.swipeV(vs(), -260, 420);
        await at(T.up2);
        if (vs()) await s.swipeV(vs(), -260, 420);
      },
      async (s, d, at) => {
        const T = ST.shortitems;
        const vs = () => s.$("#ps-m16 [data-vs-cur]") || s.$("#ps-m16 [data-vs]");
        await at(T.up3);
        if (vs()) await s.swipeV(vs(), -260, 420);
        s.hideFinger();
        await at(T.sellOpen);
        try { s.win.PS?.marketTab?.("sell"); s.win.PS?.sellType?.("item"); } catch {}
        await s.waitFor(() => s.$("#ps-item-form"), 3000).catch(() => {});
        const form = s.$("#ps-item-form");
        if (form) { const r = form.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 64)); }
        await at(T.photo);
        const ph = await s.win.PS?.itemDemoFill?.({ index: 0, step: "photo" });
        if (ph) await s.spotlight(ph);
        await at(T.fields);
        unspot(s);
        await s.win.PS?.itemDemoFill?.({ index: 0, step: "fields" });
      },
      async (s, d, at) => {
        const T = ST.shortitems;
        await at(T.condTap);
        const cond = s.$("#ps-item-conds button");
        if (cond) await s.tap(cond, { reveal: true });
        await at(T.catTap);
        const cat = s.$("#ps-item-cats button");
        if (cat) await s.tap(cat, { reveal: false });
        await at(T.submitTap);
        const sub = s.$("#ps-item-submit");
        if (sub) { await s.reveal(sub, { ms: 220, ratio: 0.6 }); await s.tapVisual(sub); } // nie abschicken
      },
      async (s, d, at) => {
        const T = ST.shortitems;
        await at(T.marketAll);
        s.hideFinger();
        try { s.win.PS?.marketTab?.("all"); } catch {}
        s.win.PS?.m16DemoMode?.("binder", "all");
        await s.idle({ quietMs: 80, timeoutMs: 400 });
        m16Top(s);
        await at(T.turn);
        const book = s.$("#ps-m16 [data-m16-book]");
        if (book) await s.swipe(book, -1, 460);
        s.hideFinger();
      },
    ],
  },

  // 10) App-Tour: Swipe → Flip-Radar → Sammlung über die echte Bottom-Navigation
  tour: {
    setup: showArena,
    beats: [
      async (s) => {
        const t = s.text("#swipe-title");
        await s.swipe(s.$("#swipe-img"), 1, 700);
        await nextCardLoaded(s, t);
      },
      async (s, d) => {
        // Preis-Radar ist Unterreiter der Sammlung: Tab „Sammlung“ → Segment „📡 Preis-Radar“
        const nav = s.$("#mob-portfolio");
        if (nav) await s.tap(nav, { reveal: false });
        await s.idle({ quietMs: 200, timeoutMs: 2000 });
        const radar = s.$('#view-portfolio [data-seg="radar"]');
        if (radar) await s.tap(radar, { reveal: false });
        else s.win.switchTab?.("flip");
        await s.waitFor(() => s.$$("#ps-flip-grid > div").length > 0, 8000).catch(() => {});
        await s.idle({ quietMs: 300, timeoutMs: 4000 });
        const live = s.$("#ps-flip-live");
        if (live) await s.reveal(live, { ms: 600, ratio: 0.05 });
        s.hideFinger();
        await s.scrollBy(VIEW_H * 0.6, Math.max(900, d * 1000 * 0.45));
      },
      async (s, d) => {
        // Sammlung ist ein eigener Hauptreiter (Unterreiter „💼 Mein Binder“)
        const nav = s.$("#mob-portfolio");
        if (nav) await s.tap(nav, { reveal: false });
        await s.idle({ quietMs: 200, timeoutMs: 2000 });
        const seg = s.$('#view-portfolio [data-seg="binder"]');
        if (seg) await s.tap(seg, { reveal: false });
        else s.win.switchTab?.("portfolio");
        await s.idle({ quietMs: 300, timeoutMs: 4000 });
        s.win.scrollTo(0, Math.max(0, s.win.scrollY + (s.$("#view-portfolio")?.getBoundingClientRect().top || 0) - 64));
        s.fact("total", s.text("#portfolio-total"));
        const total = s.$("#portfolio-total")?.parentElement;
        if (total) await s.spotlight(total, Math.min(2200, d * 500));
      },
      async (s, d) => {
        // Swipe-Tausch ist Unterreiter des Marktplatzes
        const nav = s.$("#mob-map");
        if (nav) await s.tap(nav, { reveal: false });
        await s.idle({ quietMs: 200, timeoutMs: 2000 });
        const swipe = s.$('#view-map [data-seg="swipe"]');
        if (swipe) await s.tap(swipe, { reveal: false });
        else s.win.switchTab?.("swipe");
        await s.idle({ quietMs: 300, timeoutMs: 4000 });
        s.hideFinger();
        await s.sleep(Math.min(1500, d * 300));
      },
    ],
  },
};

/**
 * Choreografie live auf der Stage abspielen – synchron zur Sprecherin.
 * @param {import("./live-stage.js").LiveStage} stage
 * @param {string} key       Szenario-Schlüssel
 * @param {Array<{start:number,end:number}>} marks  Satz-Zeitpunkte in Videozeit (s)
 * @param {() => number} clock  aktuelle Videozeit (s) – bei Ton die Audio-Uhr
 * @param {number} D         Gesamtlänge (s)
 */
export async function runChoreo(stage, key, marks, clock, D) {
  const c = CHOREO[key];
  if (!c) return;
  const PRE = 0.15; // Aktion beginnt minimal vor dem Wort – das Bild ist da, wenn es fällt
  const starts = c.beats.map((_, i) => (i === 0 ? 0 : Math.max(0, (marks[i]?.start ?? (D * i) / c.beats.length) - PRE)));
  const until = async (t) => { while (clock() < t) { stage.check(); await new Promise((r) => setTimeout(r, 30)); } };
  for (let i = 0; i < c.beats.length; i++) {
    await until(starts[i]);
    const end = i < c.beats.length - 1 ? starts[i + 1] : D;
    const d = Math.max(0.6, end - clock());
    try { await c.beats[i](stage, d, until); }
    catch (e) { if (e?.name === "StageAbort") return; console.warn(`Reel-Beat ${key}#${i + 1}:`, e); }
  }
}
