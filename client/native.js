// PokeSwipe & Radar – Phase 9: native Plattform-Schicht (Capacitor) mit sauberem Web-Fallback.
//
// Ein Modul für alles, was sich in der App „nativ“ anfühlen soll (Apple-Richtlinie 4.2 – keine reine Web-Hülle):
//  • Plattform:    isNativeIOS / isNativeAndroid / isWeb (+ Klassen ps-native, ps-ios, ps-android am <html>)
//  • Haptik:       haptic("light" | "medium" | "heavy" | "success" | "warning" | "error" | "select")
//                  → Capacitor Haptics, im Browser navigator.vibrate (falls vorhanden), sonst nichts
//  • Teilen:       share({ title, text, url }) → natives Teilen-Sheet (Capacitor Share / Web Share API / Kopieren)
//  • Kamera:       takePhoto() → native Kamera-Oberfläche (Capacitor Camera), im Browser Datei-Auswahl mit capture
//  • Safe Area:    CSS-Variablen --ps-safe-top/-bottom/-left/-right (Dynamic Island, Notch, Home-Indikator)
//  • Status-Leiste: dunkles Design passend zur App (Capacitor StatusBar)
// Die Plugins sind als Capacitor-Pakete in package.json eingetragen und kommen über `npm run cap:sync` in die
// nativen Projekte. Die Web-App greift über window.Capacitor.Plugins darauf zu – ohne sie mitzubündeln.

const cap = () => (typeof window !== "undefined" ? window.Capacitor : undefined);
const plugins = () => cap()?.Plugins || {};

export const platform = () => {
  const c = cap();
  if (!c?.isNativePlatform?.()) return "web";
  const p = c.getPlatform?.();
  return p === "ios" || p === "android" ? p : "web";
};
export const isNativeIOS = () => platform() === "ios";
export const isNativeAndroid = () => platform() === "android";
export const isNative = () => platform() !== "web";
export const isWeb = () => platform() === "web";
export const hasPlugin = (name) => Boolean(plugins()[name]);

// ---------------------------------------------------------------------------
// Haptik
// ---------------------------------------------------------------------------
const HAPTIC_PREF = "ps_haptics"; // "off" schaltet Vibration aus (Einstellung im Konto)
const VIBRATE_MS = { light: 8, select: 6, medium: 16, heavy: 28, success: [14, 40, 22], warning: [22, 60, 22], error: [30, 50, 30, 50, 30] };
let lastHaptic = 0;

export function hapticsEnabled() {
  try { return localStorage.getItem(HAPTIC_PREF) !== "off"; } catch { return true; }
}
export function setHapticsEnabled(on) {
  try { localStorage.setItem(HAPTIC_PREF, on ? "on" : "off"); } catch {}
}

/** Kurzes haptisches Feedback (gedrosselt auf max. ~12 pro Sekunde, damit Swipes nicht „brummen“). */
export function haptic(kind = "light") {
  if (!hapticsEnabled()) return;
  const now = Date.now();
  if (now - lastHaptic < 80 && (kind === "light" || kind === "select")) return;
  lastHaptic = now;
  const H = plugins().Haptics;
  try {
    if (H) {
      if (kind === "success" || kind === "warning" || kind === "error") return void H.notification({ type: kind.toUpperCase() }).catch(() => {});
      if (kind === "select") return void H.selectionChanged?.().catch?.(() => {});
      return void H.impact({ style: kind === "heavy" ? "HEAVY" : kind === "medium" ? "MEDIUM" : "LIGHT" }).catch(() => {});
    }
    navigator.vibrate?.(VIBRATE_MS[kind] ?? 10);
  } catch {}
}

// ---------------------------------------------------------------------------
// Teilen
// ---------------------------------------------------------------------------
/** Natives Teilen-Sheet. Rückgabe: "shared" | "copied" | "cancelled" | "unsupported". */
export async function share({ title = "PokeSwipe Radar", text = "", url = "" } = {}) {
  const S = plugins().Share;
  try {
    if (S) {
      await S.share({ title, text, url, dialogTitle: title });
      haptic("light");
      return "shared";
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return "shared";
    }
  } catch (e) {
    if (String(e?.name || e?.message || "").match(/abort|cancel/i)) return "cancelled";
  }
  try {
    await navigator.clipboard.writeText([text, url].filter(Boolean).join(" "));
    return "copied";
  } catch { return "unsupported"; }
}
export const canShareNatively = () => hasPlugin("Share") || typeof navigator !== "undefined" && Boolean(navigator.share);

// ---------------------------------------------------------------------------
// Kamera
// ---------------------------------------------------------------------------
/**
 * Foto aufnehmen. In der App: native Kamera-Oberfläche (Capacitor Camera, inkl. Berechtigungsdialog),
 * im Browser: Datei-Auswahl mit Rückkamera. Ergebnis: File oder null (abgebrochen).
 */
export async function takePhoto({ source = "camera" } = {}) {
  const C = plugins().Camera;
  if (C) {
    try {
      const perm = await C.checkPermissions?.();
      if (perm && perm.camera !== "granted" && source === "camera") await C.requestPermissions?.({ permissions: ["camera"] });
      const photo = await C.getPhoto({
        quality: 85, width: 1600, correctOrientation: true, resultType: "dataUrl",
        source: source === "camera" ? "CAMERA" : "PHOTOS", saveToGallery: false,
      });
      if (!photo?.dataUrl) return null;
      const blob = await (await fetch(photo.dataUrl)).blob();
      haptic("light");
      return new File([blob], "scan.jpg", { type: blob.type || "image/jpeg" });
    } catch (e) {
      if (String(e?.message || e).match(/cancel/i)) return null;
      // Plugin-Fehler → Web-Fallback
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (source === "camera") input.setAttribute("capture", "environment");
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Safe Area & Status-Leiste
// ---------------------------------------------------------------------------
function applySafeArea() {
  const root = document.documentElement;
  // env() liefert in WKWebView/Chrome die echten Abstände (Dynamic Island, Notch, Home-Indikator, Kamera-Loch)
  root.style.setProperty("--ps-safe-top", "env(safe-area-inset-top, 0px)");
  root.style.setProperty("--ps-safe-bottom", "env(safe-area-inset-bottom, 0px)");
  root.style.setProperty("--ps-safe-left", "env(safe-area-inset-left, 0px)");
  root.style.setProperty("--ps-safe-right", "env(safe-area-inset-right, 0px)");
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta && !/viewport-fit=cover/.test(meta.content)) meta.content = `${meta.content}, viewport-fit=cover`;
}

function nativeChrome() {
  const SB = plugins().StatusBar;
  if (SB) {
    SB.setStyle?.({ style: "DARK" }).catch?.(() => {});
    if (isNativeAndroid()) {
      SB.setOverlaysWebView?.({ overlay: true }).catch?.(() => {});
      SB.setBackgroundColor?.({ color: "#00000000" }).catch?.(() => {});
    }
  }
  plugins().SplashScreen?.hide?.().catch?.(() => {});
  // Natives Verhalten: kein Text-Markieren/Long-Press-Menü auf Bedienelementen, kein Gummiband-Überscrollen
  document.documentElement.classList.add("ps-native-ui");
}

/** Haptik an typische Bedienelemente koppeln (Navigation, Unter-Reiter, Primär-Buttons) – ohne jede Stelle einzeln anzupassen. */
function wireTapFeedback() {
  document.addEventListener("click", (e) => {
    const el = e.target?.closest?.(".tab-btn, .mob-nav, [data-subbtn], [data-mode-btn], .dex-cta");
    if (el) haptic("select");
  }, { capture: true, passive: true });
}

/**
 * In der App übernimmt das native Teilen-Sheet jede bestehende navigator.share-Stelle (Pull-Wall, Profile, Shops,
 * Einladungen) – ohne dass jede Stelle angepasst werden muss.
 */
function bridgeWebShare() {
  const S = plugins().Share;
  if (!S) return;
  const nativeShare = async (data = {}) => {
    await S.share({ title: data.title || "PokeSwipe Radar", text: data.text || "", url: data.url || "", dialogTitle: data.title || "Teilen" });
    haptic("light");
  };
  try { Object.defineProperty(navigator, "share", { value: nativeShare, configurable: true, writable: true }); } catch {}
}

export function initNativePlatform() {
  const p = platform();
  document.documentElement.dataset.platform = p;
  applySafeArea();
  if (p === "web") return;
  document.documentElement.classList.add("ps-native", `ps-${p}`);
  nativeChrome();
  bridgeWebShare();
  wireTapFeedback();
}

export const nativeApi = {
  haptic, share: (title, text, url) => share({ title, text, url }), setHaptics: (on) => setHapticsEnabled(Boolean(on)),
};
