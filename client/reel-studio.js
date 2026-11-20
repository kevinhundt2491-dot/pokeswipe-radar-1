// Admin-Reel-Studio – nimmt ein 9:16-Promo-Reel (1080×1920) ausschließlich als echte Live-Aufnahme der
// laufenden Website pokeswipe-radar.de auf: Die echte App läuft in einer 9:16-Smartphone-Stage, darauf werden
// echte Swipes, Taps und Scrolls ausgeführt (client/reel-scenarios.js).
// Zwei Aufnahme-Modi:
//   1. Live-DOM-to-Canvas (Standard): echter DOM-Baum → SVG foreignObject → Canvas, bis 30 FPS, kein Browser-Dialog
//   2. Native Tab-Aufnahme: getDisplayMedia({ preferCurrentTab: true }) mit 60 FPS, auf die Stage zugeschnitten
// Ton: ElevenLabs-Sprecherin (Audio-First) + dezente Musik. Zu jedem Video gibt es einen separaten
// Social-Media-Beschreibungstext (nicht im Bild) mit 1-Klick-Kopieren und .txt-Export.
import { state, api } from "./core.js";
import { unlockAudio } from "./reel-audio.js";
import { LiveStage, STAGE_CSS, IN_STAGE, recLock, fitStage, VIEW_W, VIEW_H } from "./live-stage.js";
import { recordLive, previewLive, loadNarration, requestTabCapture, pickMime, download, copyText, OUT_W, OUT_H } from "./reel-recorder.js";
import { SCENARIOS, LENGTHS, WORD_LIMITS, scenarioByKey, scriptFor, checkScript, buildCaption, captionFile } from "./reel-scripts.js";

const CSS = `
#reel-studio{position:fixed;inset:0;z-index:9999;background:rgba(5,7,15,.9);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px;font-family:var(--font-body,Figtree,sans-serif);color:var(--ink,#f3efe4)}
#reel-studio[hidden]{display:none}
#reel-studio .rs-panel{width:min(1040px,100%);background:var(--night-2,#131a33);border:2px solid rgba(245,200,75,.28);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
#reel-studio .rs-head{display:flex;align-items:center;gap:14px;padding:14px 18px;background:linear-gradient(180deg,var(--dex-red,#d9363e),var(--dex-red-dark,#9e1f2a));box-shadow:0 6px 0 #1a1420}
#reel-studio .rs-head b{font-family:var(--font-display,"Lilita One",sans-serif);font-weight:400;font-size:24px;display:block;line-height:1.1}
#reel-studio .rs-head small{font-size:12px;font-weight:800;color:#ffd9d4}
#reel-studio .rs-lens{width:40px;height:40px;border-radius:50%;flex:none;border:4px solid #f3efe4;box-shadow:0 0 0 3px #1a1420;background:radial-gradient(circle at 35% 30%,#c8ecff 0 12%,#4a9be0 13% 55%,#1f4f87 56% 100%)}
#reel-studio .rs-x{margin-left:auto;background:rgba(26,20,32,.55);border:1px solid rgba(243,239,228,.22);color:#fff;border-radius:12px;width:40px;height:40px;font-size:18px;font-weight:900;cursor:pointer}
#reel-studio .rs-body{padding:18px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px}
@media (max-width:820px){#reel-studio .rs-body{grid-template-columns:1fr}}
#reel-studio .rs-col{display:flex;flex-direction:column;gap:10px;min-width:0}
#reel-studio .rs-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#reel-studio label.rs-l{font-size:12px;font-weight:800;color:var(--ink-soft,#b9b7c9)}
#reel-studio select,#reel-studio button.rs-btn,#reel-studio a.rs-btn{font:800 14px var(--font-body,Figtree,sans-serif);border-radius:12px;padding:10px 13px;border:1px solid rgba(245,200,75,.25);background:var(--night-3,#1b2444);color:var(--ink,#f3efe4);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
#reel-studio button.rs-rec{background:#e11d48;border-color:#e11d48;color:#fff}
#reel-studio button.rs-tab{background:#2563eb;border-color:#2563eb;color:#fff}
#reel-studio button.rs-go{background:#ffcb05;color:#1a1420;border-color:#ffcb05;font-weight:900}
#reel-studio button:disabled,#reel-studio select:disabled{opacity:.45;cursor:not-allowed}
#reel-studio .rs-progress{height:8px;border-radius:4px;background:var(--night-3,#1b2444);overflow:hidden}
#reel-studio .rs-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffcb05,#34d399)}
#reel-studio .rs-status{font-size:14px;font-weight:800;min-height:20px}
#reel-studio .rs-status.err{color:#fb7185}#reel-studio .rs-status.ok{color:#34d399}
#reel-studio .rs-hint{font-size:12px;line-height:1.45;color:var(--ink-soft,#b9b7c9);margin:0}
#reel-studio .rs-box{background:var(--night-3,#1b2444);border:1px solid rgba(245,200,75,.2);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px}
#reel-studio .rs-box b{font-size:13px}
#reel-studio .rs-script{font-size:12px;line-height:1.5;color:var(--ink,#f3efe4);margin:0}
#reel-studio .rs-words{font-size:11px;font-weight:800}
#reel-studio .rs-words.ok{color:#34d399}#reel-studio .rs-words.err{color:#fb7185}
#reel-studio .rs-stagewrap{display:flex;flex-direction:column;align-items:center;gap:8px}
#reel-studio .rs-time{font-size:12px;font-weight:900;background:rgba(12,16,34,.85);border-radius:999px;padding:4px 12px;white-space:nowrap}
#reel-studio .rs-time.rec{background:#e11d48;color:#fff}
#reel-studio .rs-result{display:flex;flex-direction:column;gap:8px}
#reel-studio .rs-result video{width:180px;aspect-ratio:9/16;border-radius:14px;background:#000;align-self:flex-start}
#reel-studio textarea{width:100%;box-sizing:border-box;min-height:170px;font:600 12px/1.45 var(--font-body,Figtree,sans-serif);border-radius:10px;padding:9px 11px;border:1px solid rgba(245,200,75,.25);background:var(--night-2,#131a33);color:var(--ink,#f3efe4);resize:vertical}
#reel-studio .rs-monwrap{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;color:var(--ink-soft,#b9b7c9)}
#reel-studio .rs-master{border-color:rgba(56,189,248,.55);background:linear-gradient(135deg,rgba(56,189,248,.16),rgba(27,36,68,.95))}
#reel-studio canvas.rs-mon{width:72px;aspect-ratio:9/16;border-radius:8px;background:#000;box-shadow:0 0 0 2px #2a3050}
${STAGE_CSS}`;

const ui = {};
let built = false, mode = "idle", stage = null, last = null, voiceReady = null;

const isAdmin = () => !!state.me?.isAdmin && !IN_STAGE;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (t, D) => `${t.toFixed(1).replace(".", ",")} / ${D.toFixed(1).replace(".", ",")} s`;
const fileBase = (sc, len) => `PokeSwipe Radar Live - ${sc.label} (${len}s)`.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();

function build() {
  if (built) return;
  built = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement("div");
  el.id = "reel-studio"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Admin-Reel-Studio");
  el.innerHTML = `
    <div class="rs-panel">
      <div class="rs-head"><div class="rs-lens"></div><div><b>🎬 Admin-Reel-Studio · Live</b><small>Echte Live-Aufnahme von pokeswipe-radar.de · 9:16 · ${OUT_W}×${OUT_H} · Stimme: eigene ElevenLabs-Stimme</small></div>
        <button type="button" class="rs-x" data-rs="close" aria-label="Schließen">✕</button></div>
      <div class="rs-body">
        <div class="rs-col">
          <div class="rs-bar">
            <label class="rs-l" for="rs-scn">Szenario</label>
            <select id="rs-scn">${SCENARIOS.map((s) => `<option value="${s.key}">${s.n}) ${esc(s.label)}</option>`).join("")}</select>
            <label class="rs-l" for="rs-len">Länge</label>
            <select id="rs-len">${LENGTHS.map((l) => `<option value="${l}"${l === 15 ? " selected" : ""}>${l} s (${WORD_LIMITS[l][0]}–${WORD_LIMITS[l][1]} Wörter)</option>`).join("")}</select>
          </div>
          <div class="rs-box rs-master" data-rs-master="autobinder">
            <b>📒 Master-Vorlage: Reel: Neuer automatischer Binder &amp; Bulk-Marktplatz-Power</b>
            <small class="rs-hint">Live-Scan → automatisch im Set-Binder → Doppelte zählen → „Alle Doppelten inserieren“ → Lücken direkt kaufen → Live-Chat &amp; Start. Exakt 29 s · 1080×1920 · 60 FPS · 11 Mbit/s · ElevenLabs-Voiceover · UI-Sounds · mittige Untertitel · Make.com-Versand.</small>
            <div class="rs-bar"><button type="button" class="rs-btn rs-go" data-rs="master" data-k="autobinder">🎬 Vorlage auswählen &amp; im Pro-Generator aufnehmen</button></div>
          </div>
          <div class="rs-box">
            <b>🎙️ Voiceover-Skript</b>
            <p class="rs-script" id="rs-script"></p>
            <span class="rs-words" id="rs-words"></span>
            <label class="rs-bar" style="font-size:13px;font-weight:800;cursor:pointer"><input id="rs-voice" type="checkbox" checked style="width:18px;height:18px;accent-color:#ffcb05"> ElevenLabs-Sprecherin einbetten (Video läuft exakt so lange wie die Stimme + 0,5 s)</label>
            <small class="rs-hint" id="rs-voice-info"></small>
          </div>
          <div class="rs-bar">
            <button type="button" class="rs-btn rs-go" data-rs="preview">▶ Live-Vorschau</button>
            <button type="button" class="rs-btn rs-rec" data-rs="record">⏺ Live-Reel aufnehmen (DOM)</button>
            <button type="button" class="rs-btn rs-tab" data-rs="tab" title="Native 60-FPS-Browser-Aufnahme dieses Tabs (Browser fragt einmal nach Freigabe)">🖥️ Native Tab-Aufnahme (60 FPS)</button>
            <button type="button" class="rs-btn" data-rs="stop" hidden>■ Stopp</button>
          </div>
          <div class="rs-progress"><i id="rs-bar"></i></div>
          <div class="rs-status" id="rs-status"></div>
          <div class="rs-result" id="rs-result" hidden>
            <video id="rs-video" controls playsinline></video>
            <div class="rs-bar">
              <a class="rs-btn" id="rs-dl" download>⬇ Video</a>
              <button type="button" class="rs-btn" data-rs="txt">📄 Beschreibung (.txt)</button>
            </div>
            <div class="rs-box">
              <b>📝 Post-Beschreibung (Instagram Reels · TikTok · YouTube Shorts · Facebook)</b>
              <textarea id="rs-caption" spellcheck="false" aria-label="Post-Beschreibung"></textarea>
              <div class="rs-bar"><button type="button" class="rs-btn rs-go" data-rs="copy">📋 Text kopieren</button><small class="rs-hint" id="rs-copy-info"></small></div>
            </div>
          </div>
          <p class="rs-hint" id="rs-format"></p>
          <p class="rs-hint">Das Video zeigt ausschließlich die echte, live laufende Website: echte Karten, echte Preise, echte Buttons und Animationen. Vor dem Start werden alle Live-Daten und Kartenbilder vollständig geladen und dekodiert; der erste Frame liegt schon vor dem Start der Aufnahme auf dem Canvas. Während der Aufnahme diesen Tab sichtbar lassen. Swipes und Booster in der Aufnahme verändern weder deine Merkliste noch deine Booster-Bilanz.</p>
        </div>
        <div class="rs-stagewrap">
          <div class="ls-host" id="rs-host"><div class="ls-empty">📱 Hier läuft die echte Website in 9:16 (${VIEW_W}×${VIEW_H}).<br>▶ Live-Vorschau starten.</div></div>
          <span class="rs-time" id="rs-time">Live-Stage bereit</span>
          <div class="rs-monwrap"><canvas class="rs-mon" id="rs-canvas" width="${OUT_W}" height="${OUT_H}" aria-label="Aufnahme-Monitor"></canvas><span>Aufnahme-Monitor:<br>genau dieses Bild landet im Video</span></div>
        </div>
      </div>
    </div>`;
  document.body.append(el);
  ui.root = el;
  ui.scn = el.querySelector("#rs-scn");
  ui.len = el.querySelector("#rs-len");
  ui.script = el.querySelector("#rs-script");
  ui.words = el.querySelector("#rs-words");
  ui.voice = el.querySelector("#rs-voice");
  ui.voiceInfo = el.querySelector("#rs-voice-info");
  ui.bar = el.querySelector("#rs-bar");
  ui.status = el.querySelector("#rs-status");
  ui.time = el.querySelector("#rs-time");
  ui.host = el.querySelector("#rs-host");
  ui.canvas = el.querySelector("#rs-canvas");
  ui.result = el.querySelector("#rs-result");
  ui.video = el.querySelector("#rs-video");
  ui.dl = el.querySelector("#rs-dl");
  ui.caption = el.querySelector("#rs-caption");
  ui.copyInfo = el.querySelector("#rs-copy-info");
  ui.format = el.querySelector("#rs-format");
  ui.stop = el.querySelector('[data-rs="stop"]');
  stage = new LiveStage(ui.host);
  el.addEventListener("click", (e) => {
    const act = e.target.closest("[data-rs]")?.dataset.rs;
    if (e.target === el && mode === "idle") return close();
    if (act === "close") close();
    if (act === "preview") preview();
    if (act === "record") record("dom");
    if (act === "tab") record("tab");
    if (act === "stop") stopNow();
    if (act === "master" && mode === "idle") openMaster(e.target.closest("[data-k]")?.dataset.k || "autobinder");
    if (act === "copy") copyCaption();
    if (act === "txt" && last) download(new Blob([last.txt], { type: "text/plain;charset=utf-8" }), `${last.base}.txt`);
  });
  ui.scn.addEventListener("change", showScript);
  ui.len.addEventListener("change", showScript);
  ui.voice.addEventListener("change", updateVoiceInfo);
  window.addEventListener("resize", () => { if (!ui.root.hidden) fit(); });
  showScript();
}

function fit(native = false) {
  const maxH = native ? Math.min(window.innerHeight - 120, VIEW_H) : Math.min(window.innerHeight * 0.74, 780);
  fitStage(ui.host, maxH);
}

function current() { return { sc: scenarioByKey(ui.scn.value), len: Number(ui.len.value) === 30 ? 30 : 15 }; }

function showScript() {
  const { sc, len } = current();
  const lines = scriptFor(sc, len);
  const chk = checkScript(lines, len);
  ui.script.textContent = lines.join(" ");
  ui.words.textContent = `${chk.words} Wörter (Ziel ${chk.min}–${chk.max} für ${len} s)`;
  ui.words.className = `rs-words ${chk.ok ? "ok" : "err"}`;
}

function setStatus(msg, kind = "") { ui.status.textContent = msg; ui.status.className = `rs-status ${kind}`; }
function setBusy(b) {
  ui.root.querySelectorAll("select, button.rs-btn, #rs-voice").forEach((x) => { if (x !== ui.stop) x.disabled = b; });
  ui.stop.hidden = !b;
  ui.host.classList.toggle("busy", b);
}

function updateVoiceInfo() {
  ui.voiceInfo.textContent = !ui.voice.checked
    ? "Aus – das Reel bekommt nur dezente Musik und läuft genau die gewählte Länge."
    : !voiceReady ? "Sprachdienst wird geprüft …"
      : voiceReady.ready ? "✓ Die eigene ElevenLabs-Stimme wird vor der Aufnahme komplett erzeugt; Klicks und Swipes laufen synchron zu ihren Sätzen."
        : `⚠️ ElevenLabs nicht verfügbar${voiceReady.error ? ` (${voiceReady.error})` : " (ELEVENLABS_API_KEY fehlt)"} – Voiceover ausschalten oder Schlüssel setzen.`;
}
async function checkVoice() {
  try { voiceReady = await api("/api/admin/voiceover/status"); }
  catch (e) { voiceReady = { ready: false, error: e?.message || "Netzwerkfehler" }; }
  updateVoiceInfo();
}

function stopNow() {
  stage?.abort();
  setStatus("■ Wird gestoppt …");
}

async function preview() {
  if (mode !== "idle") return;
  if (recLock.owner) return setStatus("⚠️ Auto-Reels nimmt gerade auf – bitte warten.", "err");
  const { sc, len } = current();
  mode = "preview"; setBusy(true); fit();
  setStatus(`▶ Live-Vorschau: ${sc.label} auf der echten Website …`);
  try {
    await previewLive({ stage, scenario: sc, len, onTick: (t, D) => { ui.time.textContent = `▶ ${fmt(t, D)}`; ui.bar.style.width = `${(t / D) * 100}%`; } });
    setStatus("✓ Vorschau fertig. Jetzt aufnehmen – das Timing richtet sich dann exakt nach der Sprecherin.", "ok");
  } catch (e) {
    if (e?.name === "StageAbort") setStatus("■ Vorschau gestoppt.");
    else setStatus(`⚠️ ${e.message}`, "err");
  } finally { mode = "idle"; setBusy(false); ui.time.textContent = "Live-Stage bereit"; }
}

async function record(capture) {
  if (mode !== "idle") return;
  if (recLock.owner) return setStatus("⚠️ Auto-Reels nimmt gerade auf – bitte warten.", "err");
  const { sc, len } = current();
  const { mime, audio } = pickMime();
  if (mime === null) return setStatus("⚠️ Dieser Browser kann keine Videos aufnehmen. Bitte aktuelles Chrome oder Edge verwenden.", "err");
  const useVoice = ui.voice.checked;
  // Im Klick-Handler: AudioContext entsperren und ggf. die Tab-Freigabe holen (braucht die Nutzer-Geste)
  const ac = audio || useVoice ? unlockAudio() : null;
  let tabStream = null;
  if (capture === "tab") {
    fit(true);
    try { tabStream = await requestTabCapture(); }
    catch (e) { fit(); return setStatus(`⚠️ Tab-Aufnahme nicht freigegeben: ${e.message || e.name}`, "err"); }
  }
  mode = "rec"; recLock.owner = "studio"; setBusy(true);
  ui.time.classList.add("rec");
  let wake = null;
  try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; }
  try {
    let voice = null;
    if (useVoice) {
      if (!ac) throw new Error("Dieser Browser kann keinen Ton mit aufnehmen.");
      if (!voiceReady?.ready) await checkVoice();
      if (!voiceReady?.ready) throw new Error("ElevenLabs ist nicht eingerichtet – Voiceover ausschalten oder ELEVENLABS_API_KEY setzen.");
      setStatus("🎙️ Sprecherin wird komplett erzeugt und geladen (Audio-First) …");
      voice = await loadNarration(scriptFor(sc, len), ac);
      setStatus(`🎙️ Stimme fertig: ${voice.duration.toFixed(1).replace(".", ",")} s, ${voice.words} Wörter. Lade die Live-Website …`);
    }
    let res = null;
    while (!res) {
      res = await recordLive({
        stage, scenario: sc, len, capture, tabStream, voice, mbit: 10, canvas: ui.canvas,
        onStatus: (m) => setStatus(m),
        onTick: (t, D) => { ui.time.innerHTML = `<span class="ls-rec-dot"></span>${fmt(t, D)}`; ui.bar.style.width = `${(t / D) * 100}%`; },
      });
      if (!res) {
        if (capture === "tab") throw new Error("Tab wurde verdeckt – Aufnahme verworfen.");
        setStatus("⏸ Tab war verdeckt – Aufnahme wird neu gestartet, sobald er wieder sichtbar ist …", "err");
        await new Promise((r) => { const on = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", on); r(); } }; if (!document.hidden) r(); else document.addEventListener("visibilitychange", on); });
      }
    }
    const cap = buildCaption(sc, res.facts);
    const base = fileBase(sc, len);
    const txt = captionFile(sc, cap, { voiceover: res.lines.join(" "), recorded: new Date().toLocaleString("de-DE"), mode: capture === "tab" ? "native Tab-Aufnahme" : "Live-DOM" });
    if (last?.url) URL.revokeObjectURL(last.url);
    const url = URL.createObjectURL(res.blob);
    last = { url, base, txt, cap, ext: res.ext };
    ui.video.src = url;
    ui.dl.href = url; ui.dl.download = `${base}.${res.ext}`;
    ui.caption.value = cap.caption;
    ui.copyInfo.textContent = "";
    ui.result.hidden = false;
    // MP4 + .txt-Begleitdatei direkt speichern
    download(res.blob, `${base}.${res.ext}`);
    setTimeout(() => download(new Blob([txt], { type: "text/plain;charset=utf-8" }), `${base}.txt`), 600);
    setStatus(`✓ Live-Reel fertig: ${(res.blob.size / 1048576).toFixed(1).replace(".", ",")} MB, ${res.duration.toFixed(1).replace(".", ",")} s, ${res.ext.toUpperCase()}, ${res.fps} FPS (${capture === "tab" ? "native Tab-Aufnahme" : "Live-DOM"}). Beschreibung steht unten.`, "ok");
  } catch (e) {
    setStatus(`⚠️ ${e?.name === "StageAbort" ? "Aufnahme gestoppt." : e.message}`, "err");
  } finally {
    tabStream?.getTracks().forEach((t) => t.stop());
    try { await wake?.release(); } catch { /* egal */ }
    mode = "idle"; recLock.owner = null; setBusy(false); fit();
    ui.time.classList.remove("rec"); ui.time.textContent = "Live-Stage bereit";
  }
}

async function copyCaption() {
  const ok = await copyText(ui.caption.value, ui.caption);
  ui.copyInfo.textContent = ok ? "✓ Kopiert – direkt in Instagram, TikTok, YouTube oder Facebook einfügen." : "Text markiert – bitte mit Strg+C kopieren.";
}

function open() {
  if (!isAdmin()) return;
  build();
  if (!ui.root.hidden) return;
  ui.root.hidden = false;
  document.documentElement.style.overflow = "hidden";
  fit();
  const { mime, audio } = pickMime();
  ui.format.textContent = mime === null
    ? "⚠️ MediaRecorder wird von diesem Browser nicht unterstützt."
    : String(mime).startsWith("video/mp4") || mime === ""
      ? `✓ Ausgabe: MP4${mime ? ` (${mime})` : ""} – passt für Instagram Reels, TikTok, YouTube Shorts und Facebook.${audio ? " 🔊 Mit Ton." : " 🔇 Ohne Ton (Browser)."}`
      : `⚠️ Dieser Browser kann kein MP4 aufnehmen – es wird WebM gespeichert. Für MP4 aktuelles Chrome/Edge (ab Version 126) nutzen.${audio ? " 🔊 Mit Ton." : ""}`;
  updateVoiceInfo();
  checkVoice();
  setStatus("✓ Bereit. Szenario wählen, ▶ Live-Vorschau ansehen, dann aufnehmen.", "ok");
}

/** Master-Vorlage (Showcase-Familie) läuft über die Pro-Render-Pipeline des Generators: Studio schließen, Generator mit Vorlage öffnen. */
async function openMaster(key) {
  close();
  try { (await import("./auto-reels.js")).openAutoReels({ focus: key }); }
  catch (e) { console.warn("Pro-Generator:", e); setStatus(`⚠️ Pro-Generator konnte nicht geöffnet werden: ${e?.message || e}`, "err"); }
}

function close() {
  if (!ui.root || mode === "rec") return;
  stage?.abort();
  stage?.unload();
  ui.host.innerHTML = `<div class="ls-empty">📱 Hier läuft die echte Website in 9:16 (${VIEW_W}×${VIEW_H}).<br>▶ Live-Vorschau starten.</div>`;
  ui.root.hidden = true;
  document.documentElement.style.overflow = "";
  if (location.hash === "#reel-studio") history.replaceState(null, "", location.pathname + location.search);
}

/** Footer-Button und Hash-Link nur für Admins freischalten (nach jedem Login-Wechsel aufrufen). */
export function syncReelStudio() {
  const btn = document.getElementById("reel-studio-btn");
  if (btn) btn.classList.toggle("hidden", !isAdmin());
  if (isAdmin() && location.hash === "#reel-studio") open();
  if (!isAdmin()) close();
}

/** true, solange das Reel Studio aufnimmt. */
export const isStudioBusy = () => mode === "rec";

export function initReelStudio() {
  if (IN_STAGE) return; // in der Live-Stage selbst keine Admin-Werkzeuge
  document.getElementById("reel-studio-btn")?.addEventListener("click", () => { if (isAdmin()) open(); });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "KeyR" || e.key === "R" || e.key === "r")) {
      if (!isAdmin()) return; // für alle anderen bleibt Strg+Shift+R der normale Neu-Laden-Befehl
      e.preventDefault();
      open();
    }
    if (e.key === "Escape" && ui.root && !ui.root.hidden) close();
  }, true);
}
