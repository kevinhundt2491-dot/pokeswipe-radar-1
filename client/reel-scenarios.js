// Live-UI-Choreografien für die Reels: echte Nutzer-Aktionen auf der echten Website in der 9:16-Stage.
// Jedes Szenario hat setup() (läuft VOR Frame 0 – die Seite ist dann fertig geladen und richtig gescrollt)
// und genau 4 Beats, passend zu den 4 Sprecher-Sätzen aus client/reel-scripts.js
// (Hook → Live-Aktion 1 → Live-Aktion 2 → Call to Action). Jeder Beat bekommt seine verfügbare Zeit d
// (Sekunden bis zum nächsten Satz), die aus der echten ElevenLabs-Aufnahme stammt.

import { VIEW_H } from "./live-stage.js";

const num = (s) => {
  const m = String(s || "").replace(/\./g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine
// ---------------------------------------------------------------------------
async function swipeReady(s) {
  await s.waitFor(() => s.$("#swipe-img")?.complete && s.text("#swipe-title"), 15_000, "Swipe-Karte lädt nicht");
}

async function showArena(s) {
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

async function boosterReady(s) {
  await s.waitFor(() => s.$("#pack-results") && s.byText("button", /10 Booster/), 12_000, "Booster-Simulator lädt nicht").catch(() => {});
  const box = s.$("#pack-simulator-box");
  if (box) { const r = box.getBoundingClientRect(); s.win.scrollTo(0, Math.max(0, s.win.scrollY + r.top - 64)); }
  await s.idle({ quietMs: 300 });
}

async function waitPackResult(s, prev) {
  await s.waitFor(() => (s.$("#pack-results")?.textContent || "") !== prev && (s.$("#pack-results")?.children.length || 0) > 0, 12_000, "Booster-Ergebnis lädt nicht").catch(() => {});
  await s.idle({ quietMs: 250, timeoutMs: 5000 });
  s.fact("card", s.text("#pack-hit-name"));
  const bal = s.$("#pack-results .grid")?.textContent || "";
  const val = s.text("#pack-hit-val");
  s.fact("value", val || bal);
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

  // 3) Booster-Simulator: echtes Aufreißen eines Packs, danach 10 Booster
  booster: {
    async setup(s) { await boosterReady(s); s.fact("card", s.text("#pack-hit-name")); },
    beats: [
      async (s, d) => {
        const btn = s.byText("button", /Booster jetzt aufreißen/);
        if (btn) { const { x, y } = s.center(btn); await s.moveFinger(x, y, Math.min(900, d * 400)); }
      },
      async (s) => {
        const btn = s.byText("button", /Booster jetzt aufreißen/);
        const prev = s.$("#pack-results")?.textContent || "";
        if (btn) { await s.tap(btn); await waitPackResult(s, prev); }
      },
      async (s) => {
        const btn = s.byText("button", /10 Booster/);
        const prev = s.$("#pack-results")?.textContent || "";
        if (btn) { await s.tap(btn); await waitPackResult(s, prev); }
        const res = s.$("#pack-results");
        if (res) await s.reveal(res, { ms: 700, ratio: 0.2 });
      },
      async (s, d) => { s.hideFinger(); await s.scrollBy(VIEW_H * 0.55, Math.max(900, d * 800)); },
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

  // 7) Display-Opening: ganzes Display (36 Booster) im echten Simulator
  display: {
    async setup(s) { await boosterReady(s); },
    beats: [
      async (s, d) => {
        const sel = s.$("#pack-set-select");
        if (sel) { const { x, y } = s.center(sel); await s.moveFinger(x, y, Math.min(900, d * 400)); }
      },
      async (s) => {
        const btn = s.byText("button", /Ganzes Display/);
        const prev = s.$("#pack-results")?.textContent || "";
        if (btn) { await s.tap(btn); await waitPackResult(s, prev); }
      },
      async (s, d) => {
        const res = s.$("#pack-results");
        if (res) await s.reveal(res, { ms: 700, ratio: 0.15 });
        const best = s.$$("#pack-results button").find((b) => s.visible(b));
        if (best) { await s.spotlight(best, Math.min(1800, d * 500)); s.fact("card", best.querySelector("span")?.textContent || s.text("#pack-hit-name")); }
      },
      async (s, d) => { s.hideFinger(); await s.scrollBy(VIEW_H * 0.6, Math.max(900, d * 800)); },
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
        const nav = s.$("#mob-flip");
        if (nav) await s.tap(nav, { reveal: false });
        await s.waitFor(() => s.$$("#ps-flip-grid > div").length > 0, 8000).catch(() => {});
        await s.idle({ quietMs: 300, timeoutMs: 4000 });
        const live = s.$("#ps-flip-live");
        if (live) await s.reveal(live, { ms: 600, ratio: 0.05 });
        s.hideFinger();
        await s.scrollBy(VIEW_H * 0.6, Math.max(900, d * 1000 * 0.45));
      },
      async (s, d) => {
        const nav = s.$("#mob-portfolio");
        if (nav) await s.tap(nav, { reveal: false });
        await s.idle({ quietMs: 300, timeoutMs: 4000 });
        s.win.scrollTo(0, Math.max(0, s.win.scrollY + (s.$("#view-portfolio")?.getBoundingClientRect().top || 0) - 64));
        s.fact("total", s.text("#portfolio-total"));
        const total = s.$("#portfolio-total")?.parentElement;
        if (total) await s.spotlight(total, Math.min(2200, d * 500));
      },
      async (s, d) => {
        const nav = s.$("#mob-swipe");
        if (nav) await s.tap(nav, { reveal: false });
        await s.idle({ quietMs: 300, timeoutMs: 4000 });
        await boosterReady(s);
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
    try { await c.beats[i](stage, d); }
    catch (e) { if (e?.name === "StageAbort") return; console.warn(`Reel-Beat ${key}#${i + 1}:`, e); }
  }
}
