// Admin-Zentrale → „Make.com & Auto-Reels“: Webhook-URL, Sicherheits-Token und Zielplattformen pflegen,
// Verbindung testen und die letzten Zustellungen sehen. Der Test geht – genau wie die echten Reels –
// direkt aus dem Browser an Make, damit auch CORS/Netzwerk mitgeprüft werden.
import { esc, toast, state, api, handleError, modal, closeModalEl, btn } from "./core.js";
import { PLATFORMS, explainMakeStatus } from "./make-shared.js";

const SRC = { admin: "Admin-Zentrale", env: "Netlify-Umgebungsvariable", legacy: "alter Standardwert im Code", null: "–" };
let cfg = null;
let initial = { url: "", token: "" }; // Feldwerte beim Öffnen

const val = (id) => String(document.getElementById(id)?.value ?? "").trim();
const when = (d) => (d ? new Date(d).toLocaleString("de-DE") : "–");

async function openMakeAdmin() {
  if (!state.me?.isAdmin) return;
  modal("ps-make", `<p class="text-yellow-400 text-xs text-center py-6">⏳ Lade Make.com-Einstellungen …</p>`, { wide: true });
  try { cfg = await api("/api/admin/make"); render(); } catch (e) { closeModalEl("ps-make"); handleError(e); }
}

function render() {
  const c = cfg;
  initial = { url: c.urlSource === "admin" ? c.url : "", token: c.tokenSource === "admin" ? c.token : "" };
  const field = "w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-yellow-400 outline-none";
  const status = c.url
    ? `<span class="text-emerald-300">✓ Aktiv</span> – Quelle: ${esc(SRC[c.urlSource] || "–")}`
    : `<span class="text-amber-300">Aus</span> – Reels werden lokal heruntergeladen statt an Make gesendet.`;
  const row = (d) => `<div class="border-t border-slate-800 pt-1"><p class="text-slate-400">${when(d.at)}${d.test ? " • Test" : d.episode != null ? ` • Episode ${Number(d.episode)}` : ""}${d.status ? ` • HTTP ${Number(d.status)}` : ""}${d.sizeMb != null ? ` • ${Number(d.sizeMb)} MB` : ""}</p><p class="${d.ok ? "text-emerald-300" : "text-rose-300"} break-words">${d.ok ? "✓" : "✗"} ${esc(d.message)}</p></div>`;
  modal("ps-make", `
    <h3 class="text-base font-black text-white">🎬 Make.com & Auto-Reels</h3>
    <div class="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] space-y-1">
      <p class="text-slate-200">Status: ${status}</p>
      <p class="text-slate-400">Token: ${c.token ? `gesetzt (${esc(SRC[c.tokenSource])})` : `<span class="text-amber-300">nicht gesetzt</span>`} • Plattformen: ${c.platforms.map(esc).join(", ")} • Zuletzt geändert: ${when(c.updatedAt)}</p>
      <p class="text-slate-400">Umgebungsvariablen: MAKE_WEBHOOK_URL ${c.env.url ? "✓" : "–"} • MAKE_WEBHOOK_TOKEN ${c.env.token ? "✓" : "–"} • MAKE_PLATFORMS ${c.env.platforms ? "✓" : "–"} (Werte aus der Admin-Zentrale haben Vorrang)</p>
      ${c.warnings.map((w) => `<p class="text-amber-300">⚠️ ${esc(w)}</p>`).join("")}
      <p class="text-slate-400">Letzter Erfolg: ${c.lastSuccess ? when(c.lastSuccess.at) : "–"} • Letzter Fehler: ${c.lastError ? `<span class="text-rose-300">${when(c.lastError.at)} – ${esc(c.lastError.message)}</span>` : "–"}</p>
    </div>
    <label class="block text-xs font-black text-white" for="mk-url">🔗 Webhook-URL (Make → Webhooks → Custom webhook → „Copy address“)</label>
    <input id="mk-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://hook.eu1.make.com/…" value="${esc(initial.url)}" class="${field}" />
    <p class="text-[11px] text-slate-400">Leer lassen und speichern = Versand aus. ${c.urlSource !== "admin" && c.url ? "Aktuell wird der Wert aus der Quelle oben verwendet." : ""}</p>
    <label class="block text-xs font-black text-white" for="mk-token">🔐 Sicherheits-Token (Feld <code>token</code>, im Make-Filter prüfen)</label>
    <div class="flex gap-2"><input id="mk-token" type="text" autocomplete="off" spellcheck="false" placeholder="leer = kein Token" value="${esc(initial.token)}" class="${field}" />
      ${btn("🎲", "PS.makeNewToken()", "bg-slate-800 text-white")}</div>
    <p class="text-xs font-black text-white">📲 Plattformen (Feld <code>platforms</code>)</p>
    <div class="flex flex-wrap gap-3 text-xs text-slate-200">${PLATFORMS.map(([id, label]) => `<label class="flex items-center gap-1.5"><input type="checkbox" data-mk-plat="${id}" ${c.platforms.includes(id) ? "checked" : ""} class="accent-yellow-400"> ${esc(label)}</label>`).join("")}</div>
    <div class="flex flex-wrap gap-2">
      ${btn("💾 Speichern", "PS.saveMakeAdmin()")}
      ${btn("🧪 Verbindung testen", "PS.testMakeWebhook()", "bg-purple-600 text-white")}
      ${c.urlSource === "admin" || c.urlSource === null ? btn("↺ Auf Umgebungsvariable zurücksetzen", "PS.resetMakeAdmin()", "bg-slate-800 text-white") : ""}
      ${btn("🎬 Generator öffnen", "PS.openMakeGenerator()", "bg-slate-800 text-white")}
    </div>
    <p id="mk-test" class="text-[11px] text-slate-300"></p>
    <p class="text-[11px] text-slate-400">Der Test sendet alle Felder mit <code>is_test = 1</code> und einer kleinen Text-Datei statt Video. So kann Make die Datenstruktur lernen („Redetermine data structure“); im Szenario muss ein Filter <code>is_test = 0</code> echte Posts davon trennen.</p>
    ${videoHtml(c)}
    <h4 class="text-sm font-black text-white">Letzte Zustellungen</h4>
    <div class="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] space-y-1 max-h-48 overflow-y-auto">${c.deliveries.length ? c.deliveries.map(row).join("") : `<p class="text-slate-500">Noch keine Zustellungen protokolliert.</p>`}</div>`, { wide: true });
}

function makeNewToken() {
  const el = document.getElementById("mk-token");
  if (el) el.value = (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
  toast("🔐 Neuer Token", "Speichern und denselben Wert im Make-Filter eintragen.");
}

async function saveMakeAdmin() {
  const plats = [...document.querySelectorAll("[data-mk-plat]")].filter((b) => b.checked).map((b) => b.dataset.mkPlat);
  if (!plats.length) return toast("⚠️ Plattformen", "Bitte mindestens eine Plattform auswählen.");
  const url = val("mk-url"), token = val("mk-token");
  if (url && !/^https:\/\//i.test(url)) return toast("⚠️ Ungültige URL", "Nur https://-Adressen von Make sind erlaubt.");
  // Nur geänderte Felder senden: ein leeres URL-Feld schaltet den Versand nur ab, wenn bisher hier eine URL stand
  const body = { platforms: plats };
  if (url !== initial.url) body.url = url;
  if (token !== initial.token) body.token = token;
  if (body.url === "" && !confirm("Webhook-URL leeren? Dann werden Reels nicht mehr an Make gesendet, sondern heruntergeladen.")) return;
  try {
    await api("/api/admin/make", { method: "PUT", body });
    toast("✅ Gespeichert", body.url === "" ? "Versand an Make ist ausgeschaltet." : "Der Generator verwendet ab sofort diese Einstellungen.");
    await openMakeAdmin();
  } catch (e) { handleError(e); }
}

async function resetMakeAdmin() {
  if (!confirm("Webhook-URL aus der Admin-Zentrale entfernen und wieder MAKE_WEBHOOK_URL verwenden?")) return;
  try { await api("/api/admin/make", { method: "PUT", body: { url: "", reset: true } }); await openMakeAdmin(); } catch (e) { handleError(e); }
}

/** Testaufruf mit allen Feldern des echten Uploads (is_test = 1). Nutzt die gespeicherten Werte. */
async function testMakeWebhook() {
  const out = document.getElementById("mk-test");
  let note = "";
  const say = (t, cls = "text-slate-300") => { if (out) { out.className = `text-[11px] ${cls}`; out.textContent = t + note; } };
  try { cfg = await api("/api/admin/make"); } catch (e) { return handleError(e); }
  if (!cfg.url) return say("⚠️ Keine Webhook-URL aktiv – bitte zuerst eintragen und speichern.", "text-amber-300");
  note = val("mk-url") !== initial.url || val("mk-token") !== initial.token ? " (Hinweis: getestet wurden die zuletzt GESPEICHERTEN Werte – Änderungen bitte erst speichern.)" : "";
  const title = "Test-Reel | PokeSwipe Radar";
  const caption = "Testlauf aus der Admin-Zentrale von pokeswipe-radar.de – bitte nicht veröffentlichen.\n\n#pokeswipe #test";
  const hashtags = ["#pokeswipe", "#test"];
  const uploadId = `test-${Date.now().toString(36)}`;
  const f = new FormData();
  f.append("file", new Blob(["PokeSwipe Radar – Make.com-Verbindungstest (kein Video)"], { type: "text/plain" }), "pokeswipe-webhook-test.txt");
  f.append("caption_file", new Blob([`Titel: ${title}\n\n${caption}\n`], { type: "text/plain;charset=utf-8" }), "pokeswipe-webhook-test-caption.txt");
  const fields = {
    title, caption, description: caption, hashtags: hashtags.join(" "), hashtags_json: JSON.stringify(hashtags),
    meta: JSON.stringify({ title, caption, hashtags, hook: "Testlauf", body: [], facts: {}, platforms: cfg.platforms }),
    filename: "pokeswipe-webhook-test.txt", episode: "0", scenario: "test", slogan: "Testlauf", duration: "0",
    capture_mode: "test", voiceover: "", voiceover_mode: "off", mime_type: "text/plain", size_bytes: "54", upload_id: uploadId,
    platforms: cfg.platforms.join(","), platforms_json: JSON.stringify(cfg.platforms), is_test: "1",
    source: "pokeswipe-radar.de", created_at: new Date().toISOString(),
    // Felder der Pro-Videos (damit Make die komplette Struktur lernt)
    thumb_offset_ms: "0", cover_headline: "ALL-IN-ONE: Diese App verändert Pokémon-TCG!", cover_badge: "FUNKTIONS-CHECK", cover_color: "cyan",
    cover_accent: "#22d3ee", cover_layout: "left", cover_card_id: "sv03.5-199", cover_card_name: "Test-Karte", cover_card_price_eur: "49.9", video_mode: "pro", video_template: "overview",
    video_template_label: "Komplett-Überblick", hook_variant: "0", fps: "30", video_bitrate_mbit: "15", audio_bitrate_kbps: "192",
    resolution: "1080x1920", aspect_ratio: "9:16", max_mb: "95", scenes_json: JSON.stringify([{ key: "cover", start: 0, end: 2 }]),
  };
  const tc = document.createElement("canvas"); tc.width = 108; tc.height = 192;
  const tx = tc.getContext("2d"); tx.fillStyle = "#0c1226"; tx.fillRect(0, 0, 108, 192); tx.fillStyle = "#ffcb05"; tx.fillRect(14, 80, 80, 30);
  const thumb = await new Promise((r) => tc.toBlob(r, "image/jpeg", 0.8));
  if (thumb) f.append("thumbnail", thumb, "pokeswipe-webhook-test-cover.jpg");
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (cfg.token) f.append("token", cfg.token);
  say("⏳ Sende Testaufruf an Make …");
  const report = (r) => api("/api/admin/make/report", { method: "POST", body: { ...r, test: true, uploadId } }).catch(() => {});
  try {
    const res = await fetch(cfg.url, { method: "POST", body: f, signal: AbortSignal.timeout?.(30_000) });
    const text = (await res.text().catch(() => "")).slice(0, 120);
    if (res.ok) {
      say(`✅ Make hat den Test angenommen (HTTP ${res.status}${text ? ` „${text}“` : ""}). Im Szenario unter „History“ bzw. im Webhook-Modul prüfen.`, "text-emerald-300");
      report({ ok: true, status: res.status, message: "Testaufruf angenommen" });
    } else {
      const why = explainMakeStatus(res.status);
      say(`❌ HTTP ${res.status}: ${why}.`, "text-rose-300");
      report({ ok: false, status: res.status, message: `Test: ${why}` });
    }
  } catch (e) {
    const msg = e?.name === "TimeoutError" ? "Zeitüberschreitung" : "Netzwerkfehler oder Antwort von Make nicht lesbar (CORS)";
    say(`❔ ${msg}. Der Aufruf kann trotzdem angekommen sein – bitte in Make prüfen.`, "text-amber-300");
    report({ ok: false, message: `Test: ${msg}` });
  }
}

function openMakeGenerator() {
  closeModalEl("ps-make"); closeModalEl("ps-admin");
  window.PS?.openGenerator?.();
}

// ---------------------------------------------------------------------------
// Pro-Video-Einstellungen (Vorlagen, Rotation, Qualität, Größen-Garantie, Stimme)
// ---------------------------------------------------------------------------
function videoHtml(c) {
  const v = c.video;
  if (!v) return "";
  const sel = "bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white";
  const opt = (val, cur, label) => `<option value="${val}"${String(val) === String(cur) ? " selected" : ""}>${label}</option>`;
  const list = v.templates.length ? v.templates : c.allTemplates.map((t) => t.id);
  const nextKey = list[v.rotation % list.length];
  const nextLabel = c.allTemplates.find((t) => t.id === nextKey)?.label || nextKey;
  const sizeAt30 = (((v.mbit + 0.192) * 30) / 8 * 1.05).toFixed(0);
  return `
    <h4 class="text-sm font-black text-white">🎞️ Pro-Video-Vorlagen & Qualität</h4>
    <div class="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs space-y-2">
      <p class="text-[11px] text-slate-400">Jedes Pro-Video hat 5 Szenen (Cover/Hook 0–2 s → Fokus-Zoom auf die echte App → „Warum das genial ist“ mit Feature-Badges → Vertrauen &amp; Praxis-Mehrwert → Endscreen mit pokeswipe-radar.de), Untertitel im sicheren Mittelbereich und dauert 20–30 s. Aktive Vorlagen rotieren automatisch; nach jeder Runde wechselt die Hook-Schlagzeile.</p>
      <div class="space-y-1">${c.allTemplates.map((t) => `<label class="flex items-center gap-2 text-slate-200"><input type="checkbox" data-mk-tpl="${t.id}" ${v.templates.includes(t.id) ? "checked" : ""} class="accent-yellow-400"> ${esc(t.label)}${t.id === nextKey ? ` <span class="text-yellow-300">• als Nächstes</span>` : ""}</label>`).join("")}</div>
      <div class="flex flex-wrap gap-2 items-center">
        <label class="text-slate-300">FPS <select id="mk-fps" class="${sel}">${opt(30, v.fps, "30 FPS (empfohlen)")}${opt(60, v.fps, "60 FPS (flüssiger)")}</select></label>
        <label class="text-slate-300">Video-Bitrate <select id="mk-mbit" class="${sel}">${[14, 15, 16].map((m) => opt(m, v.mbit, `${m} Mbit/s`)).join("")}</select></label>
        <label class="text-slate-300">Max. Dateigröße <select id="mk-maxmb" class="${sel}">${[95, 90, 80, 60, 45].map((m) => opt(m, v.maxMb, `${m} MB${m === 95 ? " (Make Core 100 MB − Puffer)" : ""}`)).join("")}</select></label>
        <label class="text-slate-300">Stimme <select id="mk-tone" class="${sel}">${opt("energetic", v.tone, "Energiegeladenes Storytelling")}${opt("calm", v.tone, "Ruhig & sachlich")}</select></label>
      </div>
      <p class="text-[11px] text-slate-400">Format: MP4 1080×1920 (9:16), H.264 High Profile, AAC 192 kbit/s Stereo. Bei 30 s ≈ ${sizeAt30} MB. Die Bitrate wird vor jeder Aufnahme an die echte Länge angepasst; liegt eine Datei trotzdem über ${v.maxMb} MB, wird sie automatisch mit niedrigerer Bitrate neu aufgenommen – Make.com lehnt so keinen Upload ab.</p>
      <p class="text-[11px] text-slate-400">Rotation: ${Number(v.rotation)} Videos erzeugt • Nächste Vorlage: <span class="text-yellow-300">${esc(nextLabel)}</span></p>
      <div class="flex flex-wrap gap-2">${btn("💾 Video-Einstellungen speichern", "PS.saveVideoAdmin()")}${btn("↺ Rotation neu starten", "PS.saveVideoAdmin(true)", "bg-slate-800 text-white")}</div>
    </div>`;
}

async function saveVideoAdmin(resetRotation = false) {
  const templates = [...document.querySelectorAll("[data-mk-tpl]")].filter((b) => b.checked).map((b) => b.dataset.mkTpl);
  if (!templates.length) return toast("⚠️ Vorlagen", "Bitte mindestens eine Vorlage aktivieren.");
  try {
    await api("/api/admin/make/video", { method: "PUT", body: { templates, fps: Number(val("mk-fps")), mbit: Number(val("mk-mbit")), maxMb: Number(val("mk-maxmb")), tone: val("mk-tone"), resetRotation } });
    toast("✅ Gespeichert", resetRotation ? "Rotation beginnt wieder bei der ersten aktiven Vorlage." : "Der Generator verwendet ab sofort diese Video-Einstellungen.");
    await openMakeAdmin();
  } catch (e) { handleError(e); }
}

export const makeAdminApi = { openMakeAdmin, saveMakeAdmin, resetMakeAdmin, testMakeWebhook, makeNewToken, openMakeGenerator, saveVideoAdmin };
