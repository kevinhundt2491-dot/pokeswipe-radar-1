// Video-Einstellungen der Pro-Reels (Admin-Zentrale) – reine Logik, testbar.
// Muss zu client/reel-pro.js passen (Vorlagen-Schlüssel, Bitraten, FPS, 95-MB-Grenze).

export const PRO_TEMPLATE_KEYS = ["overview", "radar", "swipe", "market", "portfolio"] as const;
export const PRO_TEMPLATE_LABELS: Record<string, string> = {
  overview: "Komplett-Überblick (All-in-One-App)",
  radar: "Live-Preis-Radar (Cardmarket € & TCGplayer $)",
  swipe: "PokeSwipe Entdecker-Modus",
  market: "Sicherer P2P-Marktplatz (Käuferschutz, Stripe, DHL)",
  portfolio: "Sammlung, Portfolio & Release-Kalender",
};
export const HOOK_VARIANTS = 2;
export const SAFE_MB_MAX = 95;

export type VideoConfig = {
  templates: string[]; fps: 30 | 60; mbit: number; maxMb: number;
  tone: "energetic" | "calm"; rotation: number; updatedAt: string | null;
};
export const DEFAULT_VIDEO: VideoConfig = {
  templates: [...PRO_TEMPLATE_KEYS], fps: 30, mbit: 15, maxMb: SAFE_MB_MAX, tone: "energetic", rotation: 0, updatedAt: null,
};

/** Gespeicherte/übergebene Werte auf erlaubte Werte begrenzen. */
export function cleanVideoConfig(raw: any, prev: VideoConfig = DEFAULT_VIDEO): VideoConfig {
  const r = raw && typeof raw === "object" ? raw : {};
  const tpl = Array.isArray(r.templates) ? PRO_TEMPLATE_KEYS.filter((k) => r.templates.includes(k)) : prev.templates;
  const mbit = Number(r.mbit ?? prev.mbit);
  const maxMb = Number(r.maxMb ?? prev.maxMb);
  return {
    templates: tpl.length ? tpl : [...PRO_TEMPLATE_KEYS],
    fps: Number(r.fps ?? prev.fps) === 60 ? 60 : 30,
    mbit: Number.isFinite(mbit) ? Math.min(16, Math.max(14, Math.round(mbit))) : 15,
    maxMb: Number.isFinite(maxMb) ? Math.min(SAFE_MB_MAX, Math.max(20, Math.round(maxMb))) : SAFE_MB_MAX,
    tone: (r.tone ?? prev.tone) === "calm" ? "calm" : "energetic",
    rotation: Math.max(0, Math.trunc(Number(r.rotation ?? prev.rotation) || 0)),
    updatedAt: r.updatedAt ?? prev.updatedAt ?? null,
  };
}

/** Rotation: Vorlagen der Reihe nach, nach jeder Runde die nächste Hook-Schlagzeile. */
export function rotationAt(cfg: VideoConfig, n = cfg.rotation) {
  const list = cfg.templates.length ? cfg.templates : [...PRO_TEMPLATE_KEYS];
  return { template: list[n % list.length], variant: Math.floor(n / list.length) % HOOK_VARIANTS, index: n };
}
