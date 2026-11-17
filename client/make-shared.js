// Gemeinsame Make.com-Helfer für Auto-Reels-Generator und Admin-Zentrale (klein, ohne Abhängigkeiten).

/** Zielplattformen – Feld "platforms" (kommagetrennt) bzw. "platforms_json" im Webhook. */
export const PLATFORMS = [["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube Shorts"], ["facebook", "Facebook"]];

/** Verständliche Erklärung typischer Antworten eines Make.com-Webhooks. */
export function explainMakeStatus(status) {
  if (status >= 200 && status < 300) return "angenommen";
  if (status === 400) return "Make lehnt ab (Warteschlange voll oder Szenario erwartet andere Felder)";
  if (status === 401 || status === 403) return "Zugriff verweigert – API-Key/Header-Schutz am Make-Webhook prüfen";
  if (status === 404 || status === 410) return "dieser Webhook existiert in Make nicht (mehr) – URL in Make neu kopieren und in der Admin-Zentrale eintragen";
  if (status === 413) return "Datei zu groß für den Make-Tarif – Qualität/Länge reduzieren oder Make-Limit prüfen";
  if (status === 429) return "zu viele Anfragen – Make drosselt kurz";
  if (status >= 500) return "Make ist gerade nicht erreichbar";
  return "unerwartete Antwort";
}
