// Englisches Wörterbuch (Deutsch → Englisch) für den DOM-Übersetzer (client/i18n.js).
// Wird nur bei englischer Oberfläche per dynamischem import() geladen (eigener Chunk).
// Einträge: ["Deutscher Text", "English text"]; {platzhalter} machen einen Eintrag zum Muster
// (["Noch {n} Swipes heute", "{n} swipes left today"]). Emoji/Pfeile am Anfang/Ende und
// abschließende Satzzeichen (":" "…" "!") werden automatisch abgetrennt – "🔥 Top-Deal" braucht nur "Top-Deal".
// Fehlende Texte finden: node scripts/i18n-extract.mjs   (Details im Kopf des Skripts)
import d1, { KEEP as k1 } from "./i18n-en-1.js";
import d2, { KEEP as k2 } from "./i18n-en-2.js";
import d3, { KEEP as k3 } from "./i18n-en-3.js";
import d4, { KEEP as k4 } from "./i18n-en-4.js";
import d5, { KEEP as k5 } from "./i18n-en-5.js";
import d6, { KEEP as k6 } from "./i18n-en-6.js"; // Warenkorb-Optimierer & DHL-Etiketten
import d7, { KEEP as k7 } from "./i18n-en-7.js"; // UI/UX- & Login-Upgrade (Start, Navigation, Marktplatz-Raster, Login)
import d8, { KEEP as k8 } from "./i18n-en-8.js"; // App-Icon, Freunde einladen (Gründer-Sammler), Set-Binder & Marktplatz-Abgleich
import d9, { KEEP as k9 } from "./i18n-en-9.js"; // Schwarzes Brett, Live-Binder-Match, Freunde, 1:1-Chat, Direkt-Tausch & Treffen-Planer

/** Texte, die absichtlich unverändert bleiben (Marken, bereits Englisch, Eigennamen). */
export const KEEP = [...k1, ...k2, ...k3, ...k4, ...k5, ...k6, ...k7, ...k8, ...k9];

export default [...d1, ...d2, ...d3, ...d4, ...d5, ...d6, ...d7, ...d8, ...d9];
