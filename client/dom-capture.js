// Live-DOM-to-Canvas-Capture: rendert den echten, live laufenden DOM-Baum der Website (im 9:16-Stage-iframe)
// über eine SVG-<foreignObject>-Pipeline (Prinzip von html-to-image) als Bild, das auf den Aufnahme-Canvas
// gezeichnet wird. Damit laufen alle Auto-Reels vollautomatisch ohne Browser-Freigabe-Dialog als echte
// Website-Aufnahme durch.
//
// Was hier passiert (pro Frame):
//  1. body des iframes klonen (inkl. aktueller Formularwerte, Scroll-Positionen, Canvas-Inhalte)
//  2. laufende CSS-Animationen/Transitions einfrieren: berechnete transform/opacity werden inline übernommen
//  3. alle Bilder als data:-URLs einbetten (SVG-Bilder dürfen keine externen Ressourcen nachladen)
//  4. zusammen mit den einmalig vorbereiteten Stylesheets (Media-Queries für den 9:16-Viewport aufgelöst,
//     vh/vw in px umgerechnet, Schriften eingebettet) zu einem SVG serialisieren und dekodieren.

const XHTML = "http://www.w3.org/1999/xhtml";
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const CDN_HOSTS = ["assets.tcgdex.net", "images.pokemontcg.io", "raw.githubusercontent.com"];
const DROP_TAGS = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "LINK", "STYLE", "META"]);

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error || new Error("Datei konnte nicht gelesen werden"));
  r.readAsDataURL(blob);
});
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Bild-URL über das Netlify Image CDN der Seite laden (gleicher Ursprung → lesbare Pixel). */
export function sameOriginImageUrl(src, w = 900) {
  try {
    const u = new URL(src, location.href);
    if (u.origin === location.origin || u.protocol === "data:" || u.protocol === "blob:") return u.href;
    const local = location.hostname === "localhost" && location.port !== "8889";
    if (!local && u.protocol === "https:" && CDN_HOSTS.includes(u.hostname)) return `${location.origin}/.netlify/images?url=${encodeURIComponent(u.href)}&w=${w}`;
    return null;
  } catch { return null; }
}

export class DomCapture {
  /**
   * @param {Window} win   Fenster der Live-Stage (gleicher Ursprung)
   * @param {{ width: number, height: number, outW: number, outH: number }} size  Viewport (CSS-px) und Ausgabegröße
   */
  constructor(win, { width, height, outW, outH }) {
    this.win = win;
    this.w = width; this.h = height; this.outW = outW; this.outH = outH;
    this.scale = outW / width;
    this.css = "";
    this.images = new Map(); // src → data-URL
    this.loading = new Map(); // src → Promise
    this.urlCache = new Map(); // CSS-url → data-URL
    this.useBlob = true;
    this.frames = 0;
    this.lastMs = 0;
  }

  // -------------------------------------------------------------------------
  // Vorbereitung (einmal pro Aufnahme)
  // -------------------------------------------------------------------------
  async prepare() {
    await this.checkSupport();
    this.css = await this.collectCss();
  }

  /** Prüft, ob der Browser foreignObject-SVGs ohne "tainted canvas" zeichnet (Chrome/Edge/Firefox: ja). */
  async checkSupport() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><foreignObject width="4" height="4"><div xmlns="${XHTML}" style="width:4px;height:4px;background:#f00"></div></foreignObject></svg>`;
    const tryMode = async (blob) => {
      const img = await this.decodeSvg(svg, blob);
      const c = document.createElement("canvas");
      c.width = 4; c.height = 4;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      x.getImageData(0, 0, 1, 1); // wirft SecurityError, wenn das Canvas "tainted" ist
    };
    try { await tryMode(true); this.useBlob = true; return; } catch { /* nächster Versuch */ }
    try { await tryMode(false); this.useBlob = false; return; } catch { /* nicht unterstützt */ }
    throw new Error("Dieser Browser erlaubt keine Live-DOM-Aufnahme (SVG foreignObject). Bitte Chrome/Edge nutzen oder im Reel Studio die native Tab-Aufnahme wählen.");
  }

  /** Alle Stylesheets der Live-Seite einsammeln und für den SVG-Kontext umschreiben. */
  async collectCss() {
    const doc = this.win.document;
    const parts = [];
    for (const sheet of Array.from(doc.styleSheets)) {
      try { parts.push(await this.sheetText(sheet, sheet.href || doc.baseURI)); }
      catch { /* fremdes Stylesheet ohne Zugriff – überspringen */ }
    }
    let css = parts.join("\n");
    // :root gibt es im SVG-Bild nicht als <html> – Variablen & Grundstile auf das eingebettete <html> legen
    css = css.replace(/:root\b/g, "html");
    // Viewport-Einheiten beziehen sich im SVG auf die Ausgabegröße → auf den 9:16-Viewport (CSS-px) umrechnen
    const vh = this.h / 100, vw = this.w / 100, vmin = Math.min(vh, vw), vmax = Math.max(vh, vw);
    // nur Werte umrechnen (nach ":", "(", ",", "/" oder Leerzeichen) – nie Tailwind-Klassennamen wie .max-h-\[90vh\]
    css = css.replace(/(?<=[\s:(,/])(-?\d*\.?\d+)(d|s|l)?(vh|vw|vmin|vmax)\b/g, (_, n, _p, u) => {
      const f = u === "vh" ? vh : u === "vw" ? vw : u === "vmin" ? vmin : vmax;
      return `${(Number(n) * f).toFixed(2)}px`;
    });
    return css;
  }

  async sheetText(sheet, base) {
    let rules;
    try { rules = sheet.cssRules; } catch { rules = null; }
    if (!rules) return "";
    return this.rulesText(rules, base);
  }

  /** Regeln rekursiv: @media wird mit dem echten Stage-Viewport ausgewertet und "flach" übernommen. */
  async rulesText(rules, base) {
    const win = this.win;
    const out = [];
    for (const r of Array.from(rules)) {
      const type = r.constructor?.name || "";
      if (r.type === 3 || type === "CSSImportRule") { // @import
        if (r.styleSheet) out.push(await this.sheetText(r.styleSheet, r.href ? new URL(r.href, base).href : base));
        continue;
      }
      if (r.type === 4 || type === "CSSMediaRule") { // @media → nur übernehmen, was im 9:16-Viewport gilt
        let match = false;
        try { match = win.matchMedia(r.conditionText || r.media.mediaText).matches; } catch { match = false; }
        if (match) out.push(await this.rulesText(r.cssRules, base));
        continue;
      }
      if (r.type === 12 || type === "CSSSupportsRule") {
        out.push(`@supports ${r.conditionText}{${await this.rulesText(r.cssRules, base)}}`);
        continue;
      }
      if (r.type === 5 || type === "CSSFontFaceRule") { // @font-face → Schrift einbetten (latin-ext weglassen, spart Zeit pro Frame)
        const text = r.cssText;
        if (/latin-ext/.test(text)) continue;
        out.push(await this.inlineUrls(text, base));
        continue;
      }
      const text = r.cssText;
      out.push(/url\(/.test(text) ? await this.inlineUrls(text, base) : text);
    }
    return out.join("\n");
  }

  async inlineUrls(text, base) {
    const re = /url\((['"]?)([^'")]+)\1\)/g;
    const abs = (raw) => { try { return new URL(raw, base).href; } catch { return null; } };
    const found = new Set();
    let m;
    while ((m = re.exec(text))) if (!/^(data:|#)/.test(m[2])) { const a = abs(m[2]); if (a) found.add(a); }
    await Promise.all([...found].map((u) => this.fetchData(u)));
    return text.replace(re, (all, _q, raw) => {
      if (/^(data:|#)/.test(raw)) return all;
      const a = abs(raw);
      const data = a ? this.urlCache.get(a) : null;
      return `url("${data || BLANK}")`;
    });
  }

  /** Ressource (gleicher Ursprung) als data:-URL laden – mit Cache. */
  async fetchData(url) {
    if (this.urlCache.has(url)) return this.urlCache.get(url);
    let data = null;
    const src = sameOriginImageUrl(url) || (url.startsWith(location.origin) ? url : null);
    if (src) {
      try {
        const res = await fetch(src, { credentials: "same-origin" });
        if (res.ok) data = await blobToDataUrl(await res.blob());
      } catch { data = null; }
    }
    this.urlCache.set(url, data);
    return data;
  }

  // -------------------------------------------------------------------------
  // Bilder
  // -------------------------------------------------------------------------
  /** Bild synchron in eine data:-URL umwandeln (geht, wenn es geladen ist und vom gleichen Ursprung kommt). */
  imageData(img) {
    const src = img.currentSrc || img.src;
    if (!src) return BLANK;
    if (src.startsWith("data:")) return src;
    const hit = this.images.get(src);
    if (hit) return hit;
    if (img.complete && img.naturalWidth > 0) {
      try {
        const rect = img.getBoundingClientRect();
        const target = Math.max(1, Math.round(Math.max(rect.width, 24) * this.scale));
        const ratio = Math.min(1, target / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * ratio));
        c.height = Math.max(1, Math.round(img.naturalHeight * ratio));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL("image/webp", 0.9);
        this.images.set(src, data);
        return data;
      } catch { /* fremder Ursprung → asynchron über das Image CDN */ }
    }
    this.requestImage(src);
    return BLANK;
  }

  requestImage(src) {
    if (this.images.has(src) || this.loading.has(src)) return this.loading.get(src) || Promise.resolve();
    const p = (async () => {
      const data = await this.fetchData(src);
      if (data) this.images.set(src, data);
    })().finally(() => this.loading.delete(src));
    this.loading.set(src, p);
    return p;
  }

  /** Alle sichtbaren Bilder der Stage vorab einbetten (vor Frame 0). */
  async primeImages(timeoutMs = 10_000) {
    const doc = this.win.document;
    const vis = Array.from(doc.images).filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > -this.h && r.top < this.h * 2;
    });
    vis.forEach((img) => this.imageData(img));
    const pending = [...this.loading.values()];
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
    vis.forEach((img) => this.imageData(img));
  }

  // -------------------------------------------------------------------------
  // Frame erzeugen
  // -------------------------------------------------------------------------
  decodeSvg(svg, blob = this.useBlob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      let url = null;
      if (blob) { url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" })); img.src = url; }
      else img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      const done = () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.decode().then(() => { done(); resolve(img); }, (e) => { done(); reject(e); });
    });
  }

  /** Erzeugt den aktuellen Zustand der echten Website als dekodiertes Bild (outW × outH). */
  async snapshot() {
    const t0 = performance.now();
    const svg = this.serialize();
    const img = await this.decodeSvg(svg);
    this.frames++;
    this.lastMs = performance.now() - t0;
    return img;
  }

  serialize() {
    const win = this.win, doc = win.document, body = doc.body, html = doc.documentElement;
    const animated = new Set();
    try {
      for (const a of doc.getAnimations()) {
        const t = a.effect?.target;
        if (t && t.nodeType === 1 && a.playState !== "idle") animated.add(t);
      }
    } catch { /* ältere Browser */ }
    const clone = body.cloneNode(true);
    const ops = [];
    const visit = (o, c) => {
      const tag = o.tagName;
      if (DROP_TAGS.has(tag)) { ops.push(() => c.remove()); return; }
      if ((o.classList.contains("hidden") || o.hidden) && win.getComputedStyle(o).display === "none") { ops.push(() => c.remove()); return; }
      if (tag === "IMG") {
        c.setAttribute("src", this.imageData(o));
        c.removeAttribute("srcset"); c.removeAttribute("sizes"); c.removeAttribute("loading");
      } else if (tag === "CANVAS" || tag === "VIDEO") {
        let data = BLANK;
        try {
          if (tag === "CANVAS") data = o.toDataURL("image/webp", 0.9);
          else {
            const k = document.createElement("canvas");
            k.width = o.videoWidth || 2; k.height = o.videoHeight || 2;
            k.getContext("2d").drawImage(o, 0, 0, k.width, k.height);
            data = k.toDataURL("image/webp", 0.85);
          }
        } catch { data = BLANK; }
        const r = o.getBoundingClientRect();
        const rep = doc.createElement("img");
        rep.setAttribute("src", data);
        rep.setAttribute("class", o.getAttribute("class") || "");
        rep.setAttribute("style", `${o.getAttribute("style") || ""};width:${r.width}px;height:${r.height}px;object-fit:contain`);
        ops.push(() => c.replaceWith(rep));
        return;
      } else if (tag === "INPUT") {
        const type = (o.type || "").toLowerCase();
        if (type === "checkbox" || type === "radio") { if (o.checked) c.setAttribute("checked", ""); else c.removeAttribute("checked"); }
        else if (type !== "file" && type !== "password") c.setAttribute("value", o.value);
        else if (type === "password") c.setAttribute("value", o.value ? "••••••••" : "");
      } else if (tag === "TEXTAREA") {
        c.textContent = o.value;
      } else if (tag === "SELECT") {
        Array.from(c.options).forEach((opt, i) => { if (i === o.selectedIndex) opt.setAttribute("selected", ""); else opt.removeAttribute("selected"); });
      }
      const style = c.getAttribute("style");
      if (style && style.includes("url(")) c.setAttribute("style", style.replace(/url\((['"]?)([^'")]+)\1\)/g, (all, _q, u) => {
        if (u.startsWith("data:")) return all;
        let abs; try { abs = new URL(u, doc.baseURI).href; } catch { return "none"; }
        const hit = this.urlCache.get(abs) || this.images.get(abs);
        if (!hit) { this.requestImage(abs); return "none"; }
        return `url("${hit}")`;
      }));
      if (animated.has(o)) {
        const cs = win.getComputedStyle(o);
        c.style.setProperty("animation", "none", "important");
        c.style.setProperty("transition", "none", "important");
        if (cs.transform && cs.transform !== "none") c.style.setProperty("transform", cs.transform, "important");
        ["translate", "rotate", "scale"].forEach((p) => { const v = cs.getPropertyValue(p); if (v && v !== "none") c.style.setProperty(p, v, "important"); });
        c.style.setProperty("opacity", cs.opacity, "important");
        if (cs.filter && cs.filter !== "none") c.style.setProperty("filter", cs.filter, "important");
      }
      const st = o.scrollTop, sl = o.scrollLeft;
      const kids = o.children, ckids = c.children;
      if ((st || sl) && o !== body) {
        ops.push(() => {
          for (const k of Array.from(c.children)) {
            const prev = k.style.transform;
            k.style.setProperty("transform", `translate(${-sl}px, ${-st}px)${prev && prev !== "none" ? ` ${prev}` : ""}`, "important");
          }
        });
      }
      for (let i = 0; i < kids.length; i++) if (ckids[i]) visit(kids[i], ckids[i]);
    };
    for (let i = 0; i < body.children.length; i++) if (clone.children[i]) visit(body.children[i], clone.children[i]);
    ops.forEach((op) => { try { op(); } catch { /* Knoten schon entfernt */ } });
    const sy = win.scrollY || doc.scrollingElement?.scrollTop || 0;
    const sx = win.scrollX || 0;
    const bodyCs = win.getComputedStyle(body);
    clone.style.setProperty("margin-top", `${(parseFloat(bodyCs.marginTop) || 0) - sy}px`, "important");
    if (sx) clone.style.setProperty("margin-left", `${(parseFloat(bodyCs.marginLeft) || 0) - sx}px`, "important");
    clone.style.setProperty("width", `${this.w}px`, "important");
    clone.style.setProperty("overflow", "visible", "important");
    const bodyXml = new XMLSerializer().serializeToString(clone);
    const htmlStyle = `${html.getAttribute("style") || ""};width:${this.w}px;height:${this.h}px;overflow:hidden;`;
    const htmlBg = win.getComputedStyle(html).backgroundColor;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.outW}" height="${this.outH}" viewBox="0 0 ${this.outW} ${this.outH}">`
      + `<foreignObject x="0" y="0" width="${this.w}" height="${this.h}" transform="scale(${this.scale})">`
      + `<html xmlns="${XHTML}" class="${escAttr(html.className)}" lang="${escAttr(html.lang || "de")}" style="${escAttr(htmlStyle)}${htmlBg ? `background-color:${escAttr(htmlBg)};` : ""}">`
      + `<head><style>${escText(this.css)}</style></head>`
      + bodyXml
      + `</html></foreignObject></svg>`;
  }
}
