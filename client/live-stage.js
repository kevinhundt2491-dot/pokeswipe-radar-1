// Live-Stage: lädt die echte, live laufende PokeSwipe-Radar-Website (gleicher Ursprung) in eine dedizierte
// 9:16-Smartphone-Ansicht und steuert darauf echte Nutzer-Aktionen (Swipes, Taps, Scrollen, Tippen).
// Alle Interaktionen laufen über die echten Event-Handler der App (PointerEvents, click, input) – es wird
// nichts nachgezeichnet. Der eingeblendete Finger-Indikator ist ein Element im DOM der Live-Seite und
// erscheint daher in beiden Aufnahme-Modi.

import { sameOriginImageUrl } from "./dom-capture.js";

/** 9:16-Viewport in CSS-Pixeln (echte Smartphone-Breite, exakt 1080×1920 bei 2,61-facher Pixeldichte). */
export const VIEW_W = 414, VIEW_H = 736;
export const OUT_W = 1080, OUT_H = 1920;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
// Schlüssel der App im localStorage – werden nach jeder Aufnahme wiederhergestellt (Swipes
// in der Aufnahme sollen die echte Merkliste des Admins nicht verändern)
const APP_KEY = /^(?!pokeswipe\.autoReels)(pokeswipe|ps_|ps\.)/i; // Generator-Einstellungen bleiben unberührt

export class StageAbort extends Error { constructor() { super("Live-Aufnahme abgebrochen"); this.name = "StageAbort"; } }

export class LiveStage {
  /** @param {HTMLElement} host  Container, in dem das 9:16-iframe angezeigt wird */
  constructor(host) {
    this.host = host;
    this.frame = null;
    this.win = null;
    this.doc = null;
    this.pending = 0;
    this.aborted = false;
    this.facts = {};
    this.snapshot = null;
    this.finger = null;
  }

  // -------------------------------------------------------------------------
  // Laden & Bereitschaft
  // -------------------------------------------------------------------------
  /** Lädt die Live-Website frisch in die Stage und wartet, bis App, Daten und Bilder fertig sind. */
  async load({ tab = "swipe", timeoutMs = 30_000 } = {}) {
    this.aborted = false;
    this.facts = {};
    this.unload();
    this.snapshotStorage();
    const f = document.createElement("iframe");
    f.className = "ls-frame";
    f.title = "Live-Website PokeSwipe Radar (9:16)";
    f.width = String(VIEW_W); f.height = String(VIEW_H);
    f.setAttribute("allow", "clipboard-write");
    f.style.cssText = `width:${VIEW_W}px;height:${VIEW_H}px;border:0;display:block;background:#0c1022`;
    const url = new URL("/", location.origin);
    url.searchParams.set("reel", "1");
    if (tab) url.searchParams.set("tab", tab);
    url.searchParams.set("t", Date.now().toString(36));
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Live-Website lädt nicht (Zeitüberschreitung)")), timeoutMs);
      f.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    f.src = url.href;
    this.host.append(f);
    this.frame = f;
    await loaded;
    this.win = f.contentWindow;
    this.doc = f.contentDocument;
    if (!this.doc) throw new Error("Live-Website konnte nicht eingebettet werden (X-Frame-Options/CSP prüfen).");
    await this.waitFor(() => this.win.PS && this.doc.getElementById("view-swipe") && this.doc.body, timeoutMs, "App der Live-Website startet nicht");
    this.instrument();
    if (tab) await this.waitFor(() => !this.doc.getElementById(`view-${tab}`)?.classList.contains("hidden"), 15_000, `Bereich „${tab}“ öffnet nicht`).catch(() => this.win.switchTab?.(tab));
    await this.idle();
    this.win.scrollTo(0, 0);
    return this;
  }

  unload() {
    if (this.frame) { try { this.frame.remove(); } catch { /* egal */ } }
    this.frame = null; this.win = null; this.doc = null; this.pending = 0; this.finger = null;
  }

  /** localStorage-Stand der App vor der Aufnahme merken … */
  snapshotStorage() {
    if (this.snapshot) return;
    const snap = new Map();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && APP_KEY.test(k)) snap.set(k, localStorage.getItem(k));
      }
    } catch { /* privater Modus */ }
    this.snapshot = snap;
  }

  /** … und danach wiederherstellen (Aufnahmen verändern keine echten Nutzerdaten im Browser). */
  restoreStorage() {
    const snap = this.snapshot;
    if (!snap) return;
    try {
      const now = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && APP_KEY.test(k)) now.push(k); }
      now.forEach((k) => { if (!snap.has(k)) localStorage.removeItem(k); });
      snap.forEach((v, k) => { if (localStorage.getItem(k) !== v) localStorage.setItem(k, v); });
    } catch { /* privater Modus */ }
    this.snapshot = null;
  }

  /** Netzwerk zählen, Seiteneffekte der Demo-Aktionen abschalten, Finger-Indikator einsetzen. */
  instrument() {
    const win = this.win, doc = this.doc;
    // laufende Anfragen zählen (für "alle API-/Datenbank-Werte geladen")
    const orig = win.fetch.bind(win);
    win.fetch = (...args) => {
      this.pending++;
      return orig(...args).finally(() => { this.pending = Math.max(0, this.pending - 1); });
    };
    // Swipes in der Aufnahme sollen weder Wunschliste noch Geschmacksprofil des Admin-Kontos verändern
    win.psArenaMatch = async () => {};
    win.psArenaSwipe = () => {};
    win.playPokePingSound = () => {};
    try { win.navigator.vibrate = () => false; } catch { /* schreibgeschützt */ }
    // keine neuen Tabs/Fenster aus der Aufnahme heraus
    win.open = () => null;
    doc.addEventListener("click", (e) => {
      const a = e.target?.closest?.("a[href]");
      if (a && (a.target === "_blank" || new URL(a.href, doc.baseURI).origin !== location.origin)) e.preventDefault();
    }, true);
    // Kartenbilder von tcgdex & Co. über das Image CDN der Seite laden (gleiches Bild, gleicher Ursprung →
    // für die Live-DOM-Aufnahme lesbar)
    const fix = (img) => {
      const src = img.getAttribute("src") || "";
      if (!/^https:/.test(src) || src.startsWith(location.origin)) return;
      const same = sameOriginImageUrl(src, 640);
      if (same && same !== src) img.setAttribute("src", same);
    };
    Array.from(doc.images).forEach(fix);
    new win.MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "attributes" && m.target.tagName === "IMG") fix(m.target);
        m.addedNodes?.forEach((n) => { if (n.nodeType === 1) { if (n.tagName === "IMG") fix(n); n.querySelectorAll?.("img").forEach(fix); } });
      }
    }).observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
    // Finger-/Tipp-Indikator (Teil der Live-Seite)
    const st = doc.createElement("style");
    st.textContent = `#ps-reel-finger{position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
      background:radial-gradient(circle,rgba(255,255,255,.85) 0 30%,rgba(255,255,255,.35) 31% 60%,rgba(255,255,255,0) 61%);
      box-shadow:0 0 0 2px rgba(255,203,5,.85),0 6px 18px rgba(0,0,0,.45);z-index:2147483647;pointer-events:none;opacity:0;
      transform:translate(-100px,-100px) scale(1);transition:opacity .18s ease}
      #ps-reel-finger.down{box-shadow:0 0 0 6px rgba(255,203,5,.55),0 3px 10px rgba(0,0,0,.45)}
      html.ps-reel-stage{scroll-behavior:auto!important}
      html.ps-reel-stage #ps-install-bar,html.ps-reel-stage #reel-studio-btn,html.ps-reel-stage #auto-reels-btn,html.ps-reel-stage #ps-generator-btn{display:none!important}
      html.ps-reel-stage body{overscroll-behavior:none}
      .ps-reel-spot{outline:3px solid #ffcb05!important;outline-offset:3px!important;box-shadow:0 0 0 8px rgba(255,203,5,.25),0 0 40px rgba(255,203,5,.55)!important;transition:outline-offset .3s ease,box-shadow .3s ease!important}`;
    doc.head.append(st);
    doc.documentElement.classList.add("ps-reel-stage");
    const finger = doc.createElement("div");
    finger.id = "ps-reel-finger";
    doc.body.append(finger);
    this.finger = { el: finger, x: VIEW_W / 2, y: VIEW_H * 0.7 };
  }

  check() { if (this.aborted) throw new StageAbort(); }
  abort() { this.aborted = true; }

  async sleep(ms) {
    const end = performance.now() + ms;
    while (performance.now() < end) { this.check(); await sleepMs(Math.min(80, end - performance.now())); }
    this.check();
  }

  async waitFor(pred, timeoutMs = 10_000, msg = "Element erscheint nicht") {
    const end = performance.now() + timeoutMs;
    for (;;) {
      let ok = false;
      try { ok = !!pred(); } catch { ok = false; }
      if (ok) return true;
      if (this.aborted) throw new StageAbort();
      if (performance.now() > end) throw new Error(msg);
      await sleepMs(60);
    }
  }

  /** rAF-Tween über ms Millisekunden: fn(k) mit k = 0…1 (eased). */
  tween(ms, fn) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const step = () => {
        if (this.aborted) return reject(new StageAbort());
        const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
        try { fn(ease(k), k); } catch (e) { return reject(e); }
        if (k >= 1) return resolve();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /**
   * Wartet, bis die Live-Seite fertig ist: keine laufenden API-Anfragen, keine neuen Ressourcen,
   * alle sichtbaren <img> geladen und per img.decode() dekodiert.
   */
  async idle({ quietMs = 450, timeoutMs = 12_000 } = {}) {
    const end = performance.now() + timeoutMs;
    let count = -1, since = performance.now();
    while (performance.now() < end) {
      this.check();
      const n = this.win.performance.getEntriesByType("resource").length;
      if (n !== count || this.pending > 0) { count = n; since = performance.now(); }
      if (performance.now() - since >= quietMs) break;
      await sleepMs(60);
    }
    await this.decodeImages(Math.max(1500, end - performance.now()));
    await this.frames(2);
  }

  /** Alle sichtbaren Bilder fertig laden und dekodieren: Promise.all() + img.decode(). */
  async decodeImages(timeoutMs = 8000) {
    const imgs = this.visibleImages();
    const one = (img) => new Promise((resolve) => {
      const dec = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(resolve);
      if (img.complete) return dec();
      img.addEventListener("load", dec, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
    await Promise.race([Promise.all(imgs.map(one)), sleepMs(timeoutMs)]);
  }

  visibleImages() {
    if (!this.doc) return [];
    return Array.from(this.doc.images).filter((img) => {
      if (img.id === "ps-reel-finger") return false;
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < VIEW_H && r.right > 0 && r.left < VIEW_W;
    });
  }

  frames(n = 1) {
    return new Promise((resolve) => {
      const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
  }

  // -------------------------------------------------------------------------
  // DOM-Helfer
  // -------------------------------------------------------------------------
  $(sel) { return this.doc?.querySelector(sel) || null; }
  $$(sel) { return Array.from(this.doc?.querySelectorAll(sel) || []); }
  text(sel) { return (this.$(sel)?.textContent || "").replace(/\s+/g, " ").trim(); }
  visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && this.win.getComputedStyle(el).visibility !== "hidden";
  }
  /** Element per Text finden (z. B. Button "📈 Verkaufspreise"). */
  byText(sel, re, root = this.doc) {
    return Array.from(root?.querySelectorAll(sel) || []).find((el) => re.test(el.textContent || "") && this.visible(el)) || null;
  }
  fact(key, value) { if (value !== undefined && value !== null && String(value).trim()) this.facts[key] = String(value).replace(/\s+/g, " ").trim(); }

  // -------------------------------------------------------------------------
  // Echte Nutzer-Aktionen
  // -------------------------------------------------------------------------
  /** Finger-Indikator bewegen (Viewport-Koordinaten der Live-Seite). */
  async moveFinger(x, y, ms = 320) {
    const f = this.finger;
    if (!f) return;
    f.el.style.opacity = "1";
    const x0 = f.x, y0 = f.y;
    await this.tween(ms, (k) => {
      f.x = x0 + (x - x0) * k; f.y = y0 + (y - y0) * k;
      f.el.style.transform = `translate(${f.x}px, ${f.y}px)`;
    });
  }
  hideFinger() { if (this.finger) this.finger.el.style.opacity = "0"; }
  press(down) { this.finger?.el.classList.toggle("down", !!down); }

  center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** Dokument (oder ein Scroll-Container) weich scrollen. */
  async scrollTo(y, ms = 900, box = null) {
    const win = this.win;
    const el = box || this.doc.scrollingElement;
    const max = Math.max(0, el.scrollHeight - (box ? el.clientHeight : VIEW_H));
    const from = box ? el.scrollTop : win.scrollY, to = Math.max(0, Math.min(max, y));
    if (Math.abs(to - from) < 2) return;
    await this.tween(ms, (k) => { const v = from + (to - from) * k; if (box) el.scrollTop = v; else win.scrollTo(0, v); });
  }
  async scrollBy(dy, ms = 900, box = null) {
    const cur = box ? box.scrollTop : this.win.scrollY;
    await this.scrollTo(cur + dy, ms, box);
  }

  /** Element so in den sichtbaren Bereich scrollen, dass es bei ratio (0 = oben, 0.5 = Mitte) steht. */
  async reveal(el, { ms = 800, ratio = 0.35, box = null } = {}) {
    if (!el) return;
    const container = box || this.scrollParent(el);
    if (container && container !== this.doc.scrollingElement && container !== this.doc.body) {
      const cr = container.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (r.top < cr.top || r.bottom > cr.bottom) await this.scrollTo(container.scrollTop + (r.top - cr.top) - cr.height * ratio, ms * 0.7, container);
    }
    const r = el.getBoundingClientRect();
    const target = this.win.scrollY + r.top - Math.max(70, VIEW_H * ratio - r.height / 2);
    await this.scrollTo(target, ms);
  }

  scrollParent(el) {
    let p = el.parentElement;
    while (p && p !== this.doc.body) {
      const cs = this.win.getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
      p = p.parentElement;
    }
    return this.doc.scrollingElement;
  }

  pointer(el, type, x, y) {
    const PE = this.win.PointerEvent || this.win.MouseEvent;
    el.dispatchEvent(new PE(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
  }

  /** Echter Tap: Finger hinbewegen, drücken, echte Pointer-Events + click auf das Element. */
  async tap(el, { reveal = true, hold = 140 } = {}) {
    this.check();
    if (!el) throw new Error("Element für Tap nicht gefunden");
    if (reveal) {
      const r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > VIEW_H - 70) await this.reveal(el, { ms: 650, ratio: 0.5 });
    }
    const { x, y } = this.center(el);
    await this.moveFinger(x, y, 380);
    this.press(true);
    this.pointer(el, "pointerdown", x, y);
    await this.sleep(hold);
    this.pointer(el, "pointerup", x, y);
    this.press(false);
    el.click();
    await this.sleep(120);
  }

  /** Echter Swipe auf der Live-Karte (PointerEvents → Swipe-Handler der App, inkl. Badges & Fly-out). */
  async swipe(el, dir = 1, ms = 620) {
    this.check();
    if (!el) throw new Error("Swipe-Karte nicht gefunden");
    const { x, y } = this.center(el);
    await this.moveFinger(x, y, 300);
    this.press(true);
    this.pointer(el, "pointerdown", x, y);
    const dist = 170 * dir;
    await this.tween(ms, (k) => {
      const px = x + dist * k, py = y - 14 * Math.sin(k * Math.PI);
      this.pointer(el, "pointermove", px, py);
      this.finger.x = px; this.finger.y = py;
      this.finger.el.style.transform = `translate(${px}px, ${py}px)`;
    });
    this.pointer(el, "pointerup", x + dist, y);
    this.press(false);
    await this.sleep(260);
  }

  /** Text wie ein Mensch in ein echtes Eingabefeld tippen. */
  async type(input, value, ms = 900) {
    if (!input) throw new Error("Eingabefeld nicht gefunden");
    await this.tap(input);
    input.focus?.();
    input.value = "";
    const per = ms / Math.max(1, value.length);
    for (const ch of value) {
      input.value += ch;
      input.dispatchEvent(new this.win.Event("input", { bubbles: true }));
      await this.sleep(per);
    }
    input.dispatchEvent(new this.win.Event("change", { bubbles: true }));
  }

  /** Echtes Element der Seite hervorheben (Rahmen + Glow), optional nach ms wieder entfernen. */
  async spotlight(el, ms = 0) {
    if (!el) return;
    el.classList.add("ps-reel-spot");
    if (ms) { await this.sleep(ms); el.classList.remove("ps-reel-spot"); }
  }

  /** Offenes Modal der App finden (fixed Overlay ohne .hidden). */
  openModal(id) {
    const el = id ? this.doc.getElementById(id) : null;
    if (el && !el.classList.contains("hidden")) return el;
    return null;
  }
}

/** true, wenn diese Seite selbst gerade als Live-Stage (iframe ?reel=1) läuft – dann keine Admin-Overlays zeigen. */
export const IN_STAGE = (() => {
  try { return window.self !== window.top && new URLSearchParams(location.search).get("reel") === "1"; } catch { return false; }
})();

/** Gemeinsame Sperre: Reel Studio und Auto-Reels nehmen nie gleichzeitig auf. */
export const recLock = { owner: null };

/** Anzeige-Skalierung der Stage im Overlay (das iframe selbst bleibt immer 414×736 CSS-px). */
export function fitStage(host, maxH) {
  const s = Math.min(1, Math.max(0.3, maxH / VIEW_H));
  host.style.setProperty("--ls-s", String(s));
  return s;
}

/** CSS für die Stage-Anzeige (von beiden Overlays genutzt). */
export const STAGE_CSS = `
.ls-host{position:relative;width:calc(${VIEW_W}px * var(--ls-s,0.8));height:calc(${VIEW_H}px * var(--ls-s,0.8));border-radius:22px;overflow:hidden;background:#0c1022;box-shadow:0 0 0 3px #2a3050,0 20px 50px rgba(0,0,0,.6);flex:none}
.ls-host .ls-frame{position:absolute;left:0;top:0;transform:scale(var(--ls-s,0.8));transform-origin:0 0}
.ls-host.busy .ls-frame{pointer-events:none}
.ls-host .ls-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:800 13px var(--font-body,Figtree,sans-serif);color:#b9b7c9}
.ls-rec-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#e11d48;margin-right:6px;animation:lsblink 1s steps(2) infinite}
@keyframes lsblink{50%{opacity:.2}}
`;
