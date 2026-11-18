// PokeSwipe & Radar – reine Logik des Live-Scanner-Ergebnisfelds (ohne DOM, deshalb mit node:test prüfbar):
// Zustand „Near Mint“ als Standard, kompakter Zustands-/Preis-Umschalter, Varianten-Umschalter (Normal/Reverse/Holo),
// Auto-Close nach Aktionsklick, Cooldown gegen Doppel-Scans, Zoom-Fähigkeitsprüfung (iOS Safari), Blendungs-Check und
// die Entscheidung, wann ein Bild-Fingerabdruck allein (ohne lesbare Sammlernummer) als Treffer reicht.
import { CONDITION_FACTORS } from "../../server/variant-logic.ts";
import { SCORE_STRONG, MARGIN_MIN, GLARE_HIGH } from "../../server/scan-logic.ts";

/** Zustände im Dropdown – Reihenfolge von bester zu schlechtester Erhaltung */
export const SCAN_CONDS = ["NM", "EX", "GD", "LP", "PL", "PO"];
export const SCAN_COND_LABEL = { NM: "Near Mint", EX: "Excellent", GD: "Good", LP: "Light Played", PL: "Bespielt / Played", PO: "Poor" };
/** Jeder neue Scan startet mit „Near Mint“ – unabhängig davon, was beim vorigen Treffer gewählt war */
export const DEFAULT_CONDITION = "NM";
/** 1-Tap-Varianten (kurze Beschriftung, damit sie in eine Zeile passen) */
export const SCAN_FINISHES = [["normal", "Normal"], ["reverse_holo", "Reverse"], ["holo", "Holo"]];
/** Dieselbe Karte wird so lange nach einem Treffer ignoriert (Durchblättern eines Stapels ohne Doppel-Scans) */
export const SAME_CARD_COOLDOWN_MS = 900;
/** Gewünschter Kamera-Zoom – Handykameras stellen unter ~10–15 cm nicht scharf */
export const TARGET_ZOOM = 1.4;

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** Richtwert je Variante: Reverse Holo / Holo haben (wo vorhanden) einen eigenen Marktpreis, sonst der Normalpreis. */
export function finishPrice(info, finish = "normal") {
  if (!info) return 0;
  if (finish === "reverse_holo" && num(info.reversePrice)) return num(info.reversePrice);
  if (finish === "holo" && num(info.holoPrice)) return num(info.holoPrice);
  return num(info.price);
}

/** Preis nach Zustand (gleiche Faktoren wie Portfolio und Marktplatz). */
export function conditionPrice(info, finish = "normal", cond = DEFAULT_CONDITION) {
  const b = finishPrice(info, finish);
  return b ? Math.round(b * (CONDITION_FACTORS[cond] ?? 1) * 100) / 100 : 0;
}

/** Hat die Variante einen eigenen Preis (sonst zeigt der Umschalter den Normalpreis)? */
export const hasOwnFinishPrice = (info, finish) =>
  finish === "normal" || (finish === "reverse_holo" && num(info?.reversePrice) > 0) || (finish === "holo" && num(info?.holoPrice) > 0);

/** Ansichts-Zustand eines frischen Treffers: immer Near Mint, Dropdown und „Mehr“ zu. */
export function newHitView({ finish = "normal" } = {}) {
  return { condition: DEFAULT_CONDITION, finish: SCAN_FINISHES.some(([f]) => f === finish) ? finish : "normal", condMenu: false, more: false };
}

/** Hauptpreis im Ergebnisfeld (gewählter Zustand + Variante). */
export const mainPrice = (info, view) => conditionPrice(info, view?.finish || "normal", view?.condition || DEFAULT_CONDITION);

/** Einträge des Zustands-Dropdowns mit Vergleichspreis. */
export function conditionOptions(info, view) {
  const finish = view?.finish || "normal", active = view?.condition || DEFAULT_CONDITION;
  return SCAN_CONDS.map((code) => ({ code, label: SCAN_COND_LABEL[code], price: conditionPrice(info, finish, code), active: code === active }));
}

/** Text des Unter-Buttons („Zustand: Near Mint ▾“). */
export const conditionChipLabel = (view) => `Zustand: ${SCAN_COND_LABEL[view?.condition] || SCAN_COND_LABEL[DEFAULT_CONDITION]} ${view?.condMenu ? "▴" : "▾"}`;

export const toggleConditionMenu = (view) => ({ ...view, condMenu: !view?.condMenu });

/** Zustand übernehmen → Hauptpreis passt sich an, Dropdown schließt sich. Ungültige Codes ändern nur das Dropdown. */
export function selectCondition(view, code) {
  return { ...view, condition: SCAN_CONDS.includes(code) ? code : view?.condition || DEFAULT_CONDITION, condMenu: false };
}

export function selectFinish(view, finish) {
  return SCAN_FINISHES.some(([f]) => f === finish) ? { ...view, finish } : { ...view };
}

/** Folge-Aktionen im Ergebnisfeld und die kurze Bestätigung nach dem automatischen Schließen. */
export const RESULT_ACTIONS = {
  binder: { label: "💼 Binder", toast: "💼 Zum Binder hinzugefügt" },
  sell: { label: "🏷️ Verkaufen", toast: "🏷️ Inserat vorbereitet" },
  instant: { label: "⚡ Inserat", toast: "⚡ 1-Tap-Inserat gestartet" },
  wish: { label: "❤️ Wunsch", toast: "❤️ Auf die Wunschliste gesetzt" },
  flip: { label: "📈 Flip-Check", toast: "📈 Flip-Check geöffnet" },
  details: { label: "ℹ️ Details", toast: "ℹ️ Details geöffnet" },
  swiper: { label: "🃏 Swiper", toast: "🃏 Im Swiper geöffnet" },
};

/**
 * Auto-Close: Aktionsklick → Ergebnisfeld SOFORT schließen und die Kamera weiterscannen lassen, die Aktion läuft
 * dahinter; ist sie erfolgreich (Rückgabe ≠ false, kein Fehler), kommt eine kurze, nicht blockierende Bestätigung.
 *   close(name)  – Ergebnisfeld schließen, aktuelle Karte bis zum Herausnehmen ignorieren
 *   resume(name) – Kamera/Sucher wieder auf „nächste Karte“
 *   notify(text) – kurzer Toast
 *   onError(e)   – Fehleranzeige
 */
export function createActionRunner({ close, resume, notify, onError } = {}) {
  return async function run(name, fn) {
    const def = RESULT_ACTIONS[name] || { toast: "✅ Erledigt" };
    close?.(name);
    resume?.(name);
    try {
      const r = await fn?.();
      if (r !== false) notify?.(typeof r === "string" ? r : def.toast);
      return r;
    } catch (e) {
      onError?.(e);
      return false;
    }
  };
}

/** Cooldown je Karte: nach einem Treffer wird dieselbe Karte ms lang nicht erneut gemeldet. */
export function createCooldown(ms = SAME_CARD_COOLDOWN_MS) {
  const until = new Map();
  return {
    /** true = Karte (eine ihrer Varianten-Keys) ist gerade im Cooldown */
    blocked(keys, now = Date.now()) {
      for (const k of [].concat(keys || [])) if ((until.get(k) ?? 0) > now) return true;
      return false;
    },
    mark(keys, now = Date.now()) {
      for (const k of [].concat(keys || [])) until.set(k, now + ms);
      if (until.size > 200) for (const [k, t] of until) if (t <= now) until.delete(k);
    },
    reset() { until.clear(); },
  };
}

/**
 * Zoom-Fähigkeitsprüfung: nur wenn getCapabilities() einen Zoom-Bereich meldet, der 1,4× enthält, wird gezoomt.
 * iOS Safari vor 17 kennt kein „zoom“ (oder keine getCapabilities) → Standard-Zoom, ohne Fehler und ohne Versuch.
 * Ergebnis: { apply, zoom, reason }
 */
export function zoomPlan(caps, target = TARGET_ZOOM) {
  const z = caps && typeof caps === "object" ? caps.zoom : null;
  if (!z || typeof z !== "object") return { apply: false, zoom: 1, reason: "unsupported" };
  const min = Number(z.min ?? 1), max = Number(z.max);
  if (!Number.isFinite(max) || !Number.isFinite(min) || max < target || min > target) return { apply: false, zoom: 1, reason: "out-of-range" };
  const step = Number(z.step) > 0 ? Number(z.step) : 0;
  const zoom = step ? Math.round((Math.round((target - min) / step) * step + min) * 1000) / 1000 : target;
  return { apply: true, zoom: Math.max(min, Math.min(max, zoom)), reason: "ok" };
}

/**
 * Blendungs-Check vor dem OCR-Schnitt: Anteil (nahezu) überbelichteter Pixel in einem RGBA-Ausschnitt (jedes
 * stride-te Pixel). high = deutlicher Holo-/Sleeve-Glanz → Hinweis „Karte leicht kippen“; skip = so stark, dass die
 * Texterkennung sinnlos wäre (das Bild-Matching läuft trotzdem weiter).
 */
export const GLARE_SKIP = 0.22;
export function glareCheck(rgba, w, h, { threshold = 245, stride = 2 } = {}) {
  let hot = 0, n = 0;
  if (!rgba || !w || !h) return { ratio: 0, high: false, skip: false };
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      n++;
      if (rgba[i] >= threshold && rgba[i + 1] >= threshold && rgba[i + 2] >= threshold) hot++;
    }
  }
  const ratio = n ? hot / n : 0;
  return { ratio: Math.round(ratio * 1000) / 1000, high: ratio > GLARE_HIGH, skip: ratio > GLARE_SKIP };
}

/**
 * Bild-Fingerabdruck zuerst: entscheidet, ob ein Hash-Ergebnis des Workers sofort als Treffer gilt – auch ohne lesbare
 * Sammlernummer (fett-kursive Nummern der deutschen Karmesin-&-Purpur-Sets). Sofort bei bestätigter Nummer, sehr
 * kleinem Abstand oder deutlichem Vorsprung vor der nächsten Karte (eindeutiges Artwork, nicht durch Glanz verfälscht);
 * sonst ab dem zweiten übereinstimmenden Bild.
 */
export function hashDecision(m, streak = 1) {
  if (!m?.accepted) return "none";
  if (m.byNumber || Number(m.score) <= SCORE_STRONG) return "hit";
  if (!m.glareHigh && Number(m.margin) >= MARGIN_MIN * 2) return "hit";
  return streak >= 2 ? "hit" : "wait";
}
