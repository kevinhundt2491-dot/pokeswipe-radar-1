// Phase 8: Browser-Fehler der App an den Server melden (/api/client-errors → Fehlerprotokoll, Betriebs-Wächter).
// Gedrosselt: höchstens 5 Meldungen je Seitenaufruf, gleiche Meldung nur einmal. Keine Query-Parameter, keine Eingaben.
const MAX_REPORTS = 5;
const seen = new Set();
let sent = 0;

function report(kind, message, extra = {}) {
  try {
    const msg = String(message || "").slice(0, 500);
    if (!msg || sent >= MAX_REPORTS) return;
    const key = `${kind}:${msg}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const payload = JSON.stringify({
      kind, message: msg, stack: String(extra.stack || "").slice(0, 2000),
      url: location.origin + location.pathname, line: extra.line || 0, col: extra.col || 0,
      release: document.documentElement.dataset.release || "",
    });
    const blob = new Blob([payload], { type: "application/json" });
    if (!(navigator.sendBeacon && navigator.sendBeacon("/api/client-errors", blob))) {
      fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, credentials: "same-origin" }).catch(() => {});
    }
  } catch {
    // Fehlerberichte dürfen nie selbst Fehler auslösen
  }
}

window.addEventListener("error", (e) => {
  // Ressourcen-Ladefehler (Bilder etc.) haben kein message-Feld – nicht melden
  if (!e || !e.message) return;
  report("error", e.message, { stack: e.error && e.error.stack, line: e.lineno, col: e.colno });
});

window.addEventListener("unhandledrejection", (e) => {
  const r = e && e.reason;
  if (!r) return;
  // Erwartete Abbrüche (AbortController) und API-Fehlermeldungen mit Status < 500 sind kein Programmfehler
  if (r.name === "AbortError" || (typeof r.status === "number" && r.status < 500)) return;
  report("unhandledrejection", r.message || String(r), { stack: r.stack });
});

/** Für bewusst abgefangene, aber unerwartete Fehler an wichtigen Stellen (z. B. Checkout). */
export function reportError(err, context = "") {
  report("error", `${context ? `${context}: ` : ""}${(err && err.message) || String(err)}`, { stack: err && err.stack });
}
