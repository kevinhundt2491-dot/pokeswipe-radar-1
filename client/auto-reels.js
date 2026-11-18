// 10x Auto-Reel-Generator – nimmt nacheinander 10 Feature-Reels (9:16, 1080×1920) ausschließlich als echte
// Live-Aufnahmen der laufenden Website auf: Die echte App läuft in einer 9:16-Smartphone-Stage, darauf werden
// echte Swipes, Taps und Scrolls ausgeführt; der Live-DOM wird per SVG-foreignObject-Pipeline mit bis zu
// 30 FPS auf den Aufnahme-Canvas gerendert (kein Browser-Dialog nötig → vollautomatisch).
// Ablauf je Reel: Sprecherin (ElevenLabs) komplett erzeugen → Live-Website laden, alle Daten/Bilder fertig →
// Frame 0 zeichnen → MediaRecorder starten → Choreografie synchron zur Stimme → Stopp bei onended + 0,5 s.
// Jede fertige Datei geht per POST (multipart/form-data) an die eingetragene Make.com-Webhook-URL – mit
// separatem Post-Beschreibungstext (caption, title, hashtags) und .txt-Begleitdatei. Ohne Webhook-URL (oder
// wenn der Versand scheitert) werden MP4 und .txt lokal heruntergeladen.
import { toast, hooks, state, api } from "./core.js";
import { unlockAudio } from "./reel-audio.js";
import { LiveStage, STAGE_CSS, IN_STAGE, recLock, fitStage, VIEW_W, VIEW_H } from "./live-stage.js";
import { recordLive, previewLive, loadNarration, pickMime, download, copyText, OUT_W, OUT_H, VO_LEAD, TAIL } from "./reel-recorder.js";
import { PLATFORMS, explainMakeStatus } from "./make-shared.js";
import { PRO_TEMPLATES, ALL_TEMPLATES, templateByKey, proCaption, proScript, checkTemplateScript, estimateMb, bitrateFor, sceneTimes, secondsFor, scenesFor, isHook4, isShowcase, showcaseScenes, SAFE_MB, PRO_MAX_S } from "./reel-pro.js";
import { recordProSafe, loadProNarration } from "./reel-pro-recorder.js";
import { lookFor, cardImageUrl, pickCoverCard } from "./reel-pro.js";
import { sameOriginImageUrl } from "./dom-capture.js";
import { ProCompositor, loadProFonts } from "./reel-compositor.js";
import { SCENARIOS, LENGTHS, WORD_LIMITS, scriptFor, checkScript, buildCaption, captionFile } from "./reel-scripts.js";

// Die 10 Episoden = die 10 Live-Szenarien
const EPISODES = SCENARIOS;

const CSS = `
#auto-reels{position:fixed;inset:0;z-index:9999;background:rgba(5,7,15,.9);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px;font-family:var(--font-body,Figtree,sans-serif);color:var(--ink,#f3efe4)}
#auto-reels[hidden]{display:none}
#auto-reels .ar-panel{width:min(1120px,100%);background:var(--night-2,#131a33);border:2px solid rgba(245,200,75,.28);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
#auto-reels .ar-head{display:flex;align-items:center;gap:14px;padding:14px 18px;background:linear-gradient(180deg,var(--dex-red,#d9363e),var(--dex-red-dark,#9e1f2a));box-shadow:0 6px 0 #1a1420}
#auto-reels .ar-head b{font-family:var(--font-display,"Lilita One",sans-serif);font-weight:400;font-size:24px;display:block;line-height:1.1}
#auto-reels .ar-head small{font-size:12px;font-weight:800;color:#ffd9d4}
#auto-reels .ar-lens{width:40px;height:40px;border-radius:50%;flex:none;border:4px solid #f3efe4;box-shadow:0 0 0 3px #1a1420;background:radial-gradient(circle at 35% 30%,#c8ecff 0 12%,#4a9be0 13% 55%,#1f4f87 56% 100%)}
#auto-reels .ar-x{margin-left:auto;background:rgba(26,20,32,.55);border:1px solid rgba(243,239,228,.22);color:#fff;border-radius:12px;width:40px;height:40px;font-size:18px;font-weight:900;cursor:pointer}
#auto-reels .ar-body{padding:18px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px}
@media (max-width:820px){#auto-reels .ar-body{grid-template-columns:1fr}}
#auto-reels .ar-col{display:flex;flex-direction:column;gap:10px;min-width:0}
#auto-reels .ar-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
#auto-reels select,#auto-reels button.ar-btn{font:800 14px var(--font-body,Figtree,sans-serif);border-radius:12px;padding:11px 14px;border:1px solid rgba(245,200,75,.25);background:var(--night-3,#1b2444);color:var(--ink,#f3efe4);cursor:pointer}
#auto-reels button.ar-go{background:#ffcb05;color:#1a1420;border-color:#ffcb05;font-weight:900;font-size:16px;padding:14px 16px;width:100%}
#auto-reels button.ar-stop{background:#e11d48;border-color:#e11d48;color:#fff}
#auto-reels button:disabled,#auto-reels select:disabled{opacity:.45;cursor:not-allowed}
#auto-reels ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
#auto-reels li{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;background:var(--night-3,#1b2444);border:1px solid transparent;border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.35}
#auto-reels li.on{border-color:#e11d48}#auto-reels li.ok{border-color:rgba(52,211,153,.5)}#auto-reels li.err{border-color:#fb7185}
#auto-reels li .ar-st{flex:none;width:22px;text-align:center;font-size:15px}
#auto-reels li .ar-main{flex:1;min-width:0}
#auto-reels li b{display:block;font-size:13px}
#auto-reels li small{color:var(--ink-soft,#b9b7c9);word-break:break-word}
#auto-reels li .ar-acts{margin-left:auto;display:flex;gap:6px;flex:none}
#auto-reels li .ar-acts button,#auto-reels li .ar-acts a,#auto-reels .ar-out button,#auto-reels .ar-out a{font:800 11px var(--font-body,Figtree,sans-serif);border-radius:8px;padding:5px 8px;border:1px solid rgba(245,200,75,.25);background:var(--night-2,#131a33);color:var(--ink,#f3efe4);cursor:pointer;text-decoration:none}
#auto-reels li .ar-acts a{background:#10b981;color:#052e1f;border-color:#10b981}
#auto-reels .ar-out{flex-basis:100%;display:flex;gap:10px;align-items:flex-start;padding-top:6px;border-top:1px solid rgba(245,200,75,.15)}
#auto-reels .ar-out video{width:96px;aspect-ratio:9/16;border-radius:10px;background:#000;flex:none}
#auto-reels .ar-out .ar-cap{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
#auto-reels .ar-out pre{margin:0;white-space:pre-wrap;word-break:break-word;font:600 11px/1.45 var(--font-body,Figtree,sans-serif);background:var(--night-2,#131a33);border-radius:8px;padding:8px;max-height:150px;overflow:auto}
#auto-reels .ar-out .ar-copy{background:#ffcb05;color:#1a1420;border-color:#ffcb05}
#auto-reels .ar-progress{height:8px;border-radius:4px;background:var(--night-3,#1b2444);overflow:hidden}
#auto-reels .ar-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffcb05,#34d399)}
#auto-reels .ar-status{font-size:14px;font-weight:800;min-height:20px}
#auto-reels .ar-status.err{color:#fb7185}#auto-reels .ar-status.ok{color:#34d399}
#auto-reels .ar-stage{display:flex;flex-direction:column;align-items:center;gap:8px}
#auto-reels .ar-time{background:rgba(12,16,34,.85);border-radius:999px;padding:4px 12px;font-size:12px;font-weight:900;white-space:nowrap}
#auto-reels .ar-time.rec{background:#e11d48;color:#fff}
#auto-reels .ar-hook{display:flex;flex-direction:column;gap:6px;background:var(--night-3,#1b2444);border:1px solid rgba(245,200,75,.2);border-radius:12px;padding:10px}
#auto-reels .ar-hook label{font-size:13px;font-weight:800}
#auto-reels .ar-hook input{font:600 13px var(--font-body,Figtree,sans-serif);border-radius:10px;padding:9px 11px;border:1px solid rgba(245,200,75,.25);background:var(--night-2,#131a33);color:var(--ink,#f3efe4);width:100%;box-sizing:border-box}
#auto-reels .ar-hook input.bad{border-color:#fb7185}
#auto-reels .ar-hook small.warn{color:#fb7185;font-weight:800}
#auto-reels .ar-hook .ar-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:13px;font-weight:800}
#auto-reels .ar-hook .ar-row input{flex:1;min-width:0;width:auto}
#auto-reels .ar-hook .ar-row .ar-btn{flex:none;padding:6px 9px}
#auto-reels .ar-hook small{font-size:12px;color:var(--ink-soft,#b9b7c9)}
#auto-reels li input[type=checkbox]{flex:none;margin-top:3px;width:16px;height:16px;accent-color:#ffcb05}
#auto-reels button.ar-batch{background:#7c3aed;border-color:#7c3aed;color:#fff;flex:1}
#auto-reels .ar-hint{font-size:12px;line-height:1.45;color:var(--ink-soft,#b9b7c9);margin:0}
#auto-reels .ar-monwrap{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;color:var(--ink-soft,#b9b7c9)}
#auto-reels canvas.ar-mon{width:72px;aspect-ratio:9/16;border-radius:8px;background:#000;box-shadow:0 0 0 2px #2a3050}
${STAGE_CSS}`;

const ui = {};
let built = false, mode = "idle", stopAll = false, wake = null, stage = null;
let previewRun = null, previewToken = 0; // laufende Live-Vorschau (wird vor jedem Neustart sauber beendet)
const results = new Map(); // Episode-Nummer -> { url, name, size, sent, cap, txt, txtName, txtUrl }
const batchSel = new Set(); // im Serien-Modus ausgewählte Episoden

const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privater Modus */ } };

// Make.com-Webhook-URL (einmal eintragen, bleibt im localStorage)
const HOOK_KEY = "pokeswipe.autoReels.webhook";
// Voreingestellter Make.com-Webhook kommt vom Server (Umgebungsvariable MAKE_WEBHOOK_URL, nur für Admins)
// und greift, solange in diesem Browser nichts anderes gespeichert ist. Wird das Feld geleert, bleibt
// das als "" gespeichert und Reels werden wieder lokal heruntergeladen.
const getHook = () => load(HOOK_KEY, "");
// Zeitpunkt der letzten Änderung in diesem Browser – neuere Werte aus der Admin-Zentrale haben Vorrang
const HOOK_TS_KEY = "pokeswipe.autoReels.webhookAt";
const TOKEN_TS_KEY = "pokeswipe.autoReels.tokenAt";

// Zielplattformen (Feld "platforms" für den Router im Make-Szenario). Vorgabe kommt aus der Admin-Zentrale.
let platforms = new Set(PLATFORMS.map(([id]) => id));
let makeServer = null; // { url, token, platforms, source, updatedAt } vom Server
function validHook(u) {
  // Nur Make.com-Ziele: andere Hosts blockiert die Content-Security-Policy (connect-src https://*.make.com)
  try { const x = new URL(u); return x.protocol === "https:" && /\.make\.com$/i.test(x.hostname) ? x.href : null; } catch { return null; }
}

// Reel-Länge (bestimmt das Skript: 15 s = 32–36 Wörter, 30 s = 65–72 Wörter)
const LEN_KEY = "pokeswipe.autoReels.len";
let reelLen = Number(load(LEN_KEY, "30")) === 15 ? 15 : 30;

// Video-Bitrate (Mbit/s) – bestimmt die Dateigröße: MB ≈ Mbit/s × Sekunden ÷ 8
const BITRATES = [8, 10, 12, 16, 20, 24];
const BITRATE_KEY = "pokeswipe.autoReels.mbit.v2";
let mbit = BITRATES.includes(Number(load(BITRATE_KEY, 8))) ? Number(load(BITRATE_KEY, 8)) : 8;
// Maximale Dateigröße, die das Make.com-Szenario annimmt (je nach Make-Tarif). Größere Reels werden
// gar nicht erst gesendet, sondern direkt lokal heruntergeladen.
const LIMITS = [[5, "Free"], [100, "Core"], [250, "Pro"], [500, "Teams"], [1000, "Enterprise"]];
const LIMIT_KEY = "pokeswipe.autoReels.limitMb";
let limitMb = LIMITS.some(([mb]) => mb === Number(load(LIMIT_KEY, 100))) ? Number(load(LIMIT_KEY, 100)) : 100;
const MB = 1024 * 1024;
// geschätzte Länge: Stimme füllt ungefähr die Ziellänge, dazu Vorlauf + 0,5 s Ausklang
const estSeconds = () => reelLen + VO_LEAD + TAIL;
const estMb = () => (mbit * estSeconds()) / 8 * 1.05; // +5 % Container-Overhead

// Deutsche Sprecherstimme (Voiceover) – ElevenLabs "Matilda"
const VOICE_KEY = "pokeswipe.autoReels.voice";
let voiceOn = load(VOICE_KEY, "1") !== "0";
const voiceModes = new Map(); // Episode -> "voice" | "off" (geht als Feld voiceover_mode an Make)
const b64ToBuf = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

// Geheimer Token: wird als Feld "token" mitgeschickt. Im Make-Szenario direkt nach dem Webhook einen
// Filter "token = <Wert>" setzen – Aufrufe ohne passenden Token laufen dann ins Leere.
// Liegt nur im localStorage dieses Browsers, nie im Code oder Repository.
const TOKEN_KEY = "pokeswipe.autoReels.token";
const TOKEN_MANUAL_KEY = "pokeswipe.autoReels.tokenManual"; // "1" = Token wurde hier bewusst geändert
const newToken = () => (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
function getToken() {
  let t = load(TOKEN_KEY, null);
  if (t === null) { t = newToken(); save(TOKEN_KEY, t); }
  return t;
}

const isAdmin = () => !!state.me?.isAdmin && !IN_STAGE;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (t, D) => `${t.toFixed(1).replace(".", ",")} / ${D.toFixed(1).replace(".", ",")} s`;

/** Dateiname (ohne in Windows/macOS/Drive verbotene Zeichen). */
function fileBase(ep) {
  if (ep.pro) return `Pro ${ep.pro.n} - ${ep.title} (${ep.pro.fps} FPS)`.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return `Episode ${ep.n} - ${ep.title} (Live ${reelLen}s)`.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

/** URL aus dem Eingabefeld: { url } (leer → null) oder { error }, damit nie eine "alte" URL heimlich weiter benutzt wird. */
function hookState() {
  const raw = ui.hook.value.trim();
  if (!raw) return { url: null };
  const url = validHook(raw);
  return url ? { url } : { error: "Die eingetragene Webhook-URL ist ungültig (nur https://…make.com-Adressen erlaubt). Bitte korrigieren oder das Feld leeren." };
}

function build() {
  if (built) return;
  built = true;
  const style = document.createElement("style");
  style.textContent = CSS + PRO_CSS;
  document.head.append(style);
  const el = document.createElement("div");
  el.id = "auto-reels"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Auto-Reels (10x)");
  el.innerHTML = `
    <div class="ar-panel">
      <div class="ar-head"><div class="ar-lens"></div><div><b>🎬 Auto-Reels (10x) · Live</b><small>10 echte Live-Aufnahmen der Website · 9:16 · ${OUT_W}×${OUT_H} · Live-DOM bis 30 FPS · Stimme: Matilda</small></div>
        <button type="button" class="ar-x" data-ar="close" aria-label="Schließen">✕</button></div>
      <div class="ar-body">
        <div class="ar-col">
          ${PRO_HTML}
          <div class="ar-bar">
            <label for="ar-len" style="font-size:13px;font-weight:800">Länge pro Reel:</label>
            <select id="ar-len">${LENGTHS.map((s) => `<option value="${s}"${s === reelLen ? " selected" : ""}>${s} Sekunden (${WORD_LIMITS[s][0]}–${WORD_LIMITS[s][1]} Wörter)</option>`).join("")}</select>
          </div>
          <div class="ar-hook">
            <label for="ar-hook">🔗 Make.com Webhook-URL</label>
            <input id="ar-hook" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://hook.eu1.make.com/…">
            <small id="ar-hook-info"></small>
            <span style="font-size:13px;font-weight:800">📲 Plattformen (Feld <code>platforms</code>):</span>
            <div class="ar-row" id="ar-plats">${PLATFORMS.map(([id, label]) => `<label style="display:flex;gap:4px;align-items:center;cursor:pointer;font-weight:700"><input type="checkbox" data-plat="${id}" style="width:16px;height:16px;accent-color:#ffcb05" checked> ${label}</label>`).join("")}</div>
            <label for="ar-token">🔐 Sicherheits-Token (Feld <code>token</code>)</label>
            <div class="ar-row"><input id="ar-token" type="text" autocomplete="off" spellcheck="false" placeholder="leer = kein Token senden">
              <button type="button" class="ar-btn" data-ar="token-new" title="Neuen Token erzeugen">🎲</button>
              <button type="button" class="ar-btn" data-ar="token-copy" title="Token kopieren">📋</button></div>
            <small>Im Make-Szenario direkt nach dem Webhook einen Filter setzen: <code>token</code> = dieser Wert. Fremde Aufrufe ohne Token werden dann verworfen.</small>
            <div class="ar-row">
              <label for="ar-mbit">Qualität:</label>
              <select id="ar-mbit">${BITRATES.map((b) => `<option value="${b}"${b === mbit ? " selected" : ""}>${b} Mbit/s</option>`).join("")}</select>
              <label for="ar-limit">Make-Limit:</label>
              <select id="ar-limit">${LIMITS.map(([mb, plan]) => `<option value="${mb}"${mb === limitMb ? " selected" : ""}>${mb} MB (${plan})</option>`).join("")}</select>
            </div>
            <small id="ar-size-info"></small>
            <label class="ar-row" for="ar-voice" style="cursor:pointer;gap:8px"><input id="ar-voice" type="checkbox" style="width:18px;height:18px;accent-color:#ffcb05"> 🎙️ Deutsche Sprecherstimme (Voiceover) einbetten</label>
            <div class="ar-row" id="ar-voice-pick" hidden>
              <span>Stimme: <b>Matilda</b> – weiblich, freundlich &amp; warm (ElevenLabs, Hochdeutsch)</span>
              <button type="button" class="ar-btn" id="ar-voice-test">▶ Probe hören</button>
            </div>
            <small id="ar-voice-info"></small>
          </div>
          <button type="button" class="ar-btn ar-go" data-ar="all">🚀 Alle 10 Live-Reels jetzt vollautomatisch aufnehmen</button>
          <button type="button" class="ar-btn ar-stop" data-ar="stop" hidden>■ Generierung abbrechen</button>
          <div class="ar-progress"><i id="ar-bar"></i></div>
          <div class="ar-bar">
            <button type="button" class="ar-btn" data-ar="sel-all">☑ Alle</button>
            <button type="button" class="ar-btn" data-ar="sel-none">☐ Keine</button>
            <button type="button" class="ar-btn ar-batch" data-ar="batch">🎞️ Serien-Modus: ausgewählte nacheinander</button>
          </div>
          <div class="ar-status" id="ar-status"></div>
          <ol id="ar-list"></ol>
          <p class="ar-hint" id="ar-format"></p>
          <p class="ar-hint">Jedes Reel ist eine echte Live-Aufnahme der laufenden Website in der 9:16-Stage rechts: echte Karten, echte Preise, echte Buttons, echte Swipes. Vor jeder Aufnahme wird zuerst die Sprecherin komplett erzeugt (Audio-First), dann lädt die Live-Website mit allen Daten und Bildern; der erste Frame liegt schon vor dem Aufnahmestart auf dem Canvas. Die Aufnahme endet erst, wenn die Sprecherin ihr letztes Wort gesprochen hat (+ 0,5 s Ausklang). Diesen Tab sichtbar lassen – wird er verdeckt, nimmt der Generator die Episode danach neu auf. Ist eine Webhook-URL eingetragen, geht jedes MP4 an Make.com (Felder: <code>file</code> (MP4), <code>caption_file</code> (.txt), <code>title</code>, <code>caption</code> (Post-Beschreibung inkl. Hashtags), <code>hashtags</code> (durch Leerzeichen getrennt), <code>hashtags_json</code>, <code>meta</code> (JSON mit title/caption/hashtags/hook/body), zusätzlich <code>filename</code>, <code>episode</code>, <code>scenario</code>, <code>duration</code>, <code>capture_mode</code>, <code>token</code>, <code>voiceover</code>, <code>voiceover_mode</code>, <code>mime_type</code>, <code>size_bytes</code>, <code>upload_id</code>). Ohne URL landen MP4 und .txt im Download-Ordner – beim ersten Mal fragt der Browser evtl. „Mehrere Dateien herunterladen?“, bitte erlauben.</p>
        </div>
        <div class="ar-stage">
          <div class="ls-host" id="ar-host"><div class="ls-empty">📱 Hier läuft die echte Website in 9:16 (${VIEW_W}×${VIEW_H}).<br>▶ bei einer Episode startet die Live-Vorschau.</div></div>
          <span class="ar-time" id="ar-time">Live-Stage bereit</span>
          <div class="ar-monwrap"><canvas class="ar-mon" id="ar-canvas" width="${OUT_W}" height="${OUT_H}" aria-label="Aufnahme-Monitor"></canvas><span>Aufnahme-Monitor:<br>genau dieses Bild landet im Video</span></div>
        </div>
      </div>
    </div>`;
  document.body.append(el);
  ui.root = el;
  ui.canvas = el.querySelector("#ar-canvas");
  ui.host = el.querySelector("#ar-host");
  ui.list = el.querySelector("#ar-list");
  ui.bar = el.querySelector("#ar-bar");
  ui.status = el.querySelector("#ar-status");
  ui.time = el.querySelector("#ar-time");
  ui.format = el.querySelector("#ar-format");
  ui.len = el.querySelector("#ar-len");
  ui.go = el.querySelector('[data-ar="all"]');
  ui.stop = el.querySelector('[data-ar="stop"]');
  ui.batch = el.querySelector('[data-ar="batch"]');
  ui.hook = el.querySelector("#ar-hook");
  ui.hookInfo = el.querySelector("#ar-hook-info");
  ui.hook.value = getHook();
  const saveHook = () => {
    const raw = ui.hook.value.trim(), ok = !raw || validHook(raw);
    ui.hook.classList.toggle("bad", !ok);
    if (ok) { save(HOOK_KEY, raw); save(HOOK_TS_KEY, new Date().toISOString()); }
    updateHookInfo();
  };
  ui.hook.addEventListener("input", saveHook);
  ui.hook.addEventListener("change", saveHook);
  ui.token = el.querySelector("#ar-token");
  ui.mbit = el.querySelector("#ar-mbit");
  ui.limit = el.querySelector("#ar-limit");
  ui.sizeInfo = el.querySelector("#ar-size-info");
  ui.voice = el.querySelector("#ar-voice");
  ui.voiceInfo = el.querySelector("#ar-voice-info");
  ui.voice.checked = voiceOn;
  ui.voice.addEventListener("change", () => { voiceOn = ui.voice.checked; save(VOICE_KEY, voiceOn ? "1" : "0"); updateVoiceInfo(); });
  ui.voicePick = el.querySelector("#ar-voice-pick");
  ui.voiceTest = el.querySelector("#ar-voice-test");
  ui.voiceTest.addEventListener("click", testVoice);
  ui.token.value = getToken();
  ui.token.addEventListener("input", () => { save(TOKEN_KEY, ui.token.value.trim()); save(TOKEN_MANUAL_KEY, "1"); save(TOKEN_TS_KEY, new Date().toISOString()); });
  ui.plats = el.querySelector("#ar-plats");
  ui.plats.addEventListener("change", (e) => {
    const box = e.target.closest("[data-plat]");
    if (!box) return;
    if (box.checked) platforms.add(box.dataset.plat); else platforms.delete(box.dataset.plat);
    e.stopPropagation();
  });
  ui.len.addEventListener("change", () => { reelLen = Number(ui.len.value) === 15 ? 15 : 30; save(LEN_KEY, String(reelLen)); updateSizeInfo(); renderList(); });
  ui.mbit.addEventListener("change", () => { mbit = Math.max(8, Number(ui.mbit.value) || 8); save(BITRATE_KEY, String(mbit)); updateSizeInfo(); });
  ui.limit.addEventListener("change", () => { limitMb = Number(ui.limit.value) || 100; save(LIMIT_KEY, String(limitMb)); updateSizeInfo(); });
  stage = new LiveStage(ui.host);
  renderList();
  renderPro();
  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-ar]");
    if (e.target === el && mode === "idle") return close();
    if (!btn) return;
    const act = btn.dataset.ar, n = Number(btn.dataset.n);
    if (act === "close") close();
    if (btn.dataset.pro) return onProClick(btn);
    if (act === "all") generateAll();
    if (act === "stop") { stopAll = true; if (mode === "preview") endPreview(); setStatus(mode === "rec" ? "Abbruch nach der laufenden Episode …" : "■ Gestoppt."); }
    if (act === "preview") startPreview(EPISODES[n - 1]);
    if (act === "one") generateAll([EPISODES[n - 1]]);
    if (act === "copy") {
      const r = results.get(n);
      if (!r) return;
      const ok = await copyText(r.cap.caption);
      btn.textContent = ok ? "✓ Kopiert" : "Kopieren fehlgeschlagen";
      setTimeout(() => { btn.textContent = "📋 Text kopieren"; }, 1800);
    }
    if (act === "sel-all") { EPISODES.forEach((ep) => batchSel.add(ep.n)); renderList(); }
    if (act === "sel-none") { batchSel.clear(); renderList(); }
    if (act === "token-new") { ui.token.value = newToken(); save(TOKEN_KEY, ui.token.value); save(TOKEN_MANUAL_KEY, "1"); save(TOKEN_TS_KEY, new Date().toISOString()); setStatus("🔐 Neuer Token erzeugt – den Filter im Make-Szenario entsprechend anpassen (oder den Token in der Admin-Zentrale hinterlegen).", "ok"); }
    if (act === "hook-admin" && makeServer) {
      ui.hook.value = makeServer.url || ""; save(HOOK_KEY, ui.hook.value); save(HOOK_TS_KEY, new Date().toISOString());
      if (makeServer.token) { ui.token.value = makeServer.token; save(TOKEN_KEY, makeServer.token); save(TOKEN_MANUAL_KEY, ""); }
      ui.hook.classList.remove("bad"); updateHookInfo(); setStatus("✓ Webhook-Einstellungen aus der Admin-Zentrale übernommen.", "ok");
    }
    if (act === "token-copy") {
      const ok = await copyText(ui.token.value.trim());
      if (ok) setStatus("📋 Token kopiert – im Make-Filter einfügen.", "ok");
      else { ui.token.select(); setStatus("Token markiert – bitte mit Strg+C kopieren.", ""); }
    }
    if (act === "batch") {
      const list = EPISODES.filter((ep) => batchSel.has(ep.n));
      if (!list.length) return setStatus("Bitte zuerst Episoden für den Serien-Modus anhaken.", "err");
      generateAll(list);
    }
  });
  el.addEventListener("change", (e) => {
    const box = e.target.closest("[data-sel]");
    if (!box) return;
    const n = Number(box.dataset.sel);
    if (box.checked) batchSel.add(n); else batchSel.delete(n);
    updateBatchLabel();
  });
  window.addEventListener("resize", () => { if (!ui.root.hidden) fit(); });
  updateHookInfo();
}

function fit() { fitStage(ui.host, Math.min(window.innerHeight * 0.72, 760)); }

function updateHookInfo() {
  const raw = ui.hook.value.trim();
  ui.hookInfo.classList.toggle("warn", !!raw && !validHook(raw));
  const differs = makeServer && (validHook(raw) || "") !== (makeServer.url || "");
  if (differs) {
    ui.hookInfo.classList.add("warn");
    ui.hookInfo.innerHTML = `⚠️ Weicht von der Admin-Zentrale ab (${makeServer.url ? "dort ist eine andere URL hinterlegt" : "dort ist der Versand ausgeschaltet"}). <button type="button" class="ar-btn" data-ar="hook-admin" style="padding:3px 8px;font-size:11px">Admin-Wert übernehmen</button>`;
    updateSizeInfo();
    return;
  }
  ui.hookInfo.textContent = !raw
    ? "Keine URL eingetragen → fertige Reels (MP4 + .txt-Beschreibung) werden lokal heruntergeladen."
    : validHook(raw)
      ? "✓ Gespeichert. Fertige MP4-Reels werden samt Beschreibung (caption, title, hashtags, .txt) per POST an diesen Webhook geschickt."
      : "⚠️ Ungültige URL – so wird nichts gesendet und der Start ist gesperrt. Bitte eine gültige https://-Adresse eintragen oder das Feld leeren.";
  updateSizeInfo();
}
function updateSizeInfo() {
  if (!ui.sizeInfo) return;
  const est = estMb(), over = est > limitMb;
  ui.sizeInfo.classList.toggle("warn", over);
  ui.sizeInfo.textContent = over
    ? `⚠️ ≈ ${est.toFixed(0)} MB pro Reel – über dem Make-Limit von ${limitMb} MB. Solche Reels werden nicht gesendet, sondern heruntergeladen. Qualität oder Länge reduzieren.`
    : `✓ ≈ ${est.toFixed(1).replace(".", ",")} MB pro Reel bei ca. ${estSeconds().toFixed(0)} s (Limit ${limitMb} MB). Größere Dateien werden automatisch lokal gespeichert statt gesendet.`;
}
let voiceReady = null; // null = unbekannt, sonst { ready, provider }
function updateVoiceInfo() {
  if (!ui.voiceInfo) return;
  if (ui.voicePick) ui.voicePick.hidden = !voiceOn || !voiceReady?.ready;
  ui.voiceInfo.classList.toggle("warn", voiceOn && voiceReady && !voiceReady.ready);
  ui.voiceInfo.textContent = !voiceOn
    ? "Aus – die Reels bekommen nur dezente Musik und laufen genau die gewählte Länge."
    : !voiceReady
      ? "Sprachdienst wird geprüft …"
      : voiceReady.error
        ? `⚠️ Sprachdienst-Status konnte nicht geprüft werden (${voiceReady.error}). Bitte als Admin anmelden und die Seite neu laden.`
        : voiceReady.ready
          ? creditText() + "✓ Matilda (ElevenLabs) wird vor jeder Aufnahme komplett erzeugt; jedes Reel läuft exakt so lange wie ihre Stimme (+ 0,5 s), alle Live-Klicks und Swipes folgen ihren Sätzen."
          : "⚠️ ElevenLabs ist nicht eingerichtet (ELEVENLABS_API_KEY fehlt). Mit eingeschaltetem Voiceover startet der Generator erst, wenn der Schlüssel gesetzt ist – es werden keine Reels ohne Sprecherin gesendet.";
}
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("de-DE"); } catch { return ""; } };
/** ElevenLabs-Credits als Hinweis (leer, wenn unbekannt). */
function creditText() {
  const cr = voiceReady?.credits;
  if (!cr) return "";
  const reset = cr.resetAt ? ` – wird am ${fmtDate(cr.resetAt)} aufgefüllt` : "";
  return `${cr.remaining < 1500 ? "⚠️ " : ""}ElevenLabs: ${cr.remaining.toLocaleString("de-DE")} von ${cr.limit.toLocaleString("de-DE")} Credits übrig${reset}. `;
}
async function checkVoice() {
  try { voiceReady = await api("/api/admin/voiceover/status"); }
  catch (e) { voiceReady = { ready: false, error: e?.message || "Netzwerkfehler" }; }
  applyMakeDefaults(voiceReady?.make);
  applyProDefaults(voiceReady?.make);
  updateVoiceInfo();
}
/** Make.com-Vorgaben vom Server übernehmen: wenn im Browser nichts Eigenes steht oder die Admin-Zentrale neuer ist. */
function applyMakeDefaults(make) {
  if (!make || !ui.hook || ui.hook.disabled || mode === "rec") return;
  makeServer = make;
  const newer = (k) => !!make.updatedAt && make.updatedAt > load(k, "");
  if (load(HOOK_KEY, null) === null || newer(HOOK_TS_KEY)) {
    ui.hook.value = make.url || ""; ui.hook.classList.remove("bad");
    if (make.updatedAt) { save(HOOK_KEY, ui.hook.value); save(HOOK_TS_KEY, make.updatedAt); }
  }
  if (make.token && (load(TOKEN_MANUAL_KEY, "") !== "1" || newer(TOKEN_TS_KEY)) && ui.token.value !== make.token) {
    ui.token.value = make.token; save(TOKEN_KEY, make.token); save(TOKEN_MANUAL_KEY, "");
    if (make.updatedAt) save(TOKEN_TS_KEY, make.updatedAt);
  }
  if (Array.isArray(make.platforms) && make.platforms.length) {
    platforms = new Set(make.platforms);
    ui.plats?.querySelectorAll("[data-plat]").forEach((b) => { b.checked = platforms.has(b.dataset.plat); });
  }
  updateHookInfo();
}
let testAudio = null;
async function testVoice() {
  const btn = ui.voiceTest;
  btn.disabled = true; const label = btn.textContent; btn.textContent = "⏳ lädt …";
  try {
    const res = await api("/api/admin/voiceover", { method: "POST", body: { lines: [{ id: "t", text: "Hallo und willkommen bei PokeSwipe Radar. Hier siehst du echte Karten, echte Preise und echte Deals, live aus der App." }] } });
    const clip = res.clips?.[0];
    if (!clip) throw new Error("Keine Probe erhalten");
    testAudio?.pause();
    testAudio = new Audio(URL.createObjectURL(new Blob([b64ToBuf(clip.audio)], { type: "audio/mpeg" })));
    await testAudio.play();
  } catch (e) { setStatus(`⚠️ Stimmprobe fehlgeschlagen: ${e?.message || "unbekannt"}`, "err"); }
  finally { btn.disabled = false; btn.textContent = label; }
}
function updateBatchLabel() {
  if (ui.batch) ui.batch.textContent = `🎞️ Serien-Modus: ${batchSel.size} ausgewählte nacheinander`;
}

function setStatus(msg, kind = "") { ui.status.textContent = msg; ui.status.className = `ar-status ${kind}`; }
function setBusy(b) {
  ui.len.disabled = b; ui.go.disabled = b; ui.stop.hidden = !b;
  ui.batch.disabled = b; ui.hook.disabled = b;
  ui.token.disabled = b; ui.mbit.disabled = b; ui.limit.disabled = b; ui.voice.disabled = b; ui.voiceTest.disabled = b;
  ui.root.querySelectorAll('[data-ar^="sel-"],[data-ar^="token-"]').forEach((x) => { x.disabled = b; });
  ui.list.querySelectorAll('button:not([data-ar="copy"]),input').forEach((x) => { x.disabled = b; });
  ui.root.querySelectorAll('[data-pro]').forEach((x) => { x.disabled = b; });
  ui.host.classList.toggle("busy", b);
}

function renderList(states = {}) {
  ui.list.innerHTML = EPISODES.map((ep) => {
    const st = states[ep.n] || (results.has(ep.n) ? "ok" : "");
    const r = results.get(ep.n);
    const icon = { on: "⏺", ok: "✅", err: "⚠️", wait: "⏳" }[st] || "🎞️";
    const chk = checkScript(scriptFor(ep, reelLen), reelLen);
    const out = r ? `<div class="ar-out"><video src="${r.url}" preload="metadata" controls playsinline></video>
        <div class="ar-cap"><b style="font-size:12px">📝 Post-Beschreibung (nicht im Video)</b><pre>${esc(r.cap.caption)}</pre>
          <div class="ar-bar" style="gap:6px"><button type="button" class="ar-copy" data-ar="copy" data-n="${ep.n}">📋 Text kopieren</button><a href="${r.txtUrl}" download="${esc(r.txtName)}">📄 .txt</a></div></div></div>` : "";
    return `<li class="${st}"><input type="checkbox" data-sel="${ep.n}" aria-label="Episode ${ep.n} für den Serien-Modus"${batchSel.has(ep.n) ? " checked" : ""}><span class="ar-st">${icon}</span><div class="ar-main"><b>${ep.n}. ${esc(ep.title)}</b><small>Live: ${esc(ep.label)} · Skript ${chk.words} Wörter (${chk.min}–${chk.max})</small></div>
      <span class="ar-acts"><button type="button" data-ar="preview" data-n="${ep.n}" title="Live-Vorschau auf der echten Website">▶</button><button type="button" data-ar="one" data-n="${ep.n}" title="Nur diese Episode aufnehmen">⏺</button>${r ? `${r.sent ? `<span title="An Make.com gesendet">📤</span>` : ""}<a href="${r.url}" download="${esc(r.name)}" title="Herunterladen">⬇</a>` : ""}</span>${out}</li>`;
  }).join("");
  if (mode === "rec") ui.list.querySelectorAll('button:not([data-ar="copy"]),input').forEach((x) => { x.disabled = true; });
  updateBatchLabel();
}

/** Laufende Live-Vorschau stoppen und warten, bis sie wirklich beendet ist. */
async function endPreview() {
  if (!previewRun) return;
  stage.abort();
  try { await previewRun; } catch { /* abgebrochen */ }
}

async function startPreview(ep) {
  if (mode === "rec") return;
  if (recLock.owner) return setStatus("⚠️ Das Reel Studio nimmt gerade auf – bitte warten.", "err");
  await endPreview();
  const token = ++previewToken;
  mode = "preview";
  ui.stop.hidden = false;
  ui.host.classList.add("busy");
  setStatus(`▶ Live-Vorschau Episode ${ep.n}: ${ep.label} auf der echten Website …`);
  previewRun = (async () => {
    try {
      await previewLive({ stage, scenario: ep, len: reelLen, onTick: (t, D) => { if (token === previewToken) ui.time.textContent = `▶ Ep. ${ep.n} · ${fmt(t, D)}`; } });
      if (token === previewToken) setStatus(`✓ Vorschau Episode ${ep.n} fertig.`, "ok");
    } catch (e) {
      if (token === previewToken) setStatus(e?.name === "StageAbort" ? "■ Vorschau gestoppt." : `⚠️ ${e.message}`, e?.name === "StageAbort" ? "" : "err");
    } finally {
      if (token === previewToken && mode === "preview") { mode = "idle"; ui.stop.hidden = true; ui.host.classList.remove("busy"); ui.time.textContent = "Live-Stage bereit"; }
    }
  })();
  await previewRun;
  if (token === previewToken) previewRun = null;
}

const waitVisible = () => new Promise((resolve) => {
  if (!document.hidden) return resolve();
  const on = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", on); resolve(); } };
  document.addEventListener("visibilitychange", on);
});

/** Ergebnis merken (für ⬇-Link, Video-Vorschau und Beschreibung) und optional sofort lokal herunterladen. */
function keep(ep, res, cap, txt, { click = false, sent = false } = {}) {
  const old = results.get(ep.n);
  if (old) { URL.revokeObjectURL(old.url); URL.revokeObjectURL(old.txtUrl); }
  const base = fileBase(ep);
  const name = `${base}.${res.ext}`, txtName = `${base}.txt`;
  const txtBlob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(res.blob), txtUrl = URL.createObjectURL(txtBlob);
  results.set(ep.n, { url, name, size: res.blob.size, sent, cap, txt, txtName, txtUrl });
  if (click) {
    download(res.blob, name);
    setTimeout(() => download(txtBlob, txtName), 500); // .txt-Begleitdatei direkt neben dem MP4
  }
  return name;
}

/** Fertiges Reel als multipart/form-data an den Make.com-Webhook schicken (mit Upload-Fortschritt). */
// Fehler beim Versand. retry = gefahrlos wiederholbar (Make hat das Reel sicher NICHT angenommen),
// unconfirmed = Datei wurde komplett hochgeladen, aber die Antwort fehlt → evtl. schon angekommen, NICHT wiederholen.
class HookError extends Error {
  constructor(msg, { retry = false, unconfirmed = false, status = null } = {}) { super(msg); this.retry = retry; this.unconfirmed = unconfirmed; this.status = status; }
}
/** Ergebnis eines Uploads im Protokoll der Admin-Zentrale vermerken (ohne URL/Token). */
function reportDelivery(r) {
  api("/api/admin/make/report", { method: "POST", body: r }).catch(() => { /* Protokoll ist optional */ });
}
// Diese Antworten bedeuten "nicht verarbeitet" (überlastet/Gateway) – ein neuer Versuch erzeugt keinen Doppel-Post.
const RETRY_STATUS = new Set([429, 502, 503, 504]);

function postToWebhook(url, ep, res, cap, txt, uploadId, onProgress, extra = {}) {
  const base = fileBase(ep);
  const name = `${base}.${res.ext}`;
  const form = new FormData();
  // Kernfelder: Video + separater Post-Beschreibungstext (nicht im Videobild)
  form.append("file", res.blob, name);
  form.append("caption_file", new Blob([txt], { type: "text/plain;charset=utf-8" }), `${base}.txt`);
  form.append("title", cap.title);
  form.append("caption", cap.caption);
  form.append("description", cap.caption); // gleicher Text, eindeutiger Name für YouTube/Facebook-Module
  form.append("hashtags", cap.hashtags.join(" "));
  form.append("hashtags_json", JSON.stringify(cap.hashtags));
  form.append("meta", JSON.stringify({ title: cap.title, caption: cap.caption, hashtags: cap.hashtags, hook: cap.hook, body: cap.body, facts: res.facts, platforms: PLATFORMS.map(([id]) => id).filter((id) => platforms.has(id)) }));
  // Zusatzfelder
  form.append("filename", name);
  form.append("episode", String(ep.n));
  form.append("scenario", ep.key);
  form.append("slogan", cap.hook);
  form.append("duration", res.duration.toFixed(2));
  form.append("capture_mode", res.capture === "tab" ? "native-tab" : "live-dom");
  form.append("voiceover", res.lines.join(" ")); // gesprochener Text (z. B. für Untertitel)
  form.append("voiceover_mode", voiceModes.get(ep.n) || "off"); // "voice" = Matilda eingebettet, "off" = nur Musik
  form.append("mime_type", res.blob.type || `video/${res.ext}`);
  form.append("size_bytes", String(res.blob.size));
  form.append("upload_id", uploadId); // bleibt bei Wiederholungen gleich → Make kann Duplikate erkennen
  const plats = PLATFORMS.map(([id]) => id).filter((id) => platforms.has(id));
  form.append("platforms", plats.join(",")); // z. B. "instagram,tiktok,youtube,facebook" → Router-Filter "enthält"
  form.append("platforms_json", JSON.stringify(plats));
  form.append("is_test", "0");
  form.append("source", "pokeswipe-radar.de");
  form.append("created_at", new Date().toISOString());
  for (const [k, v] of Object.entries(extra)) {
    if (v instanceof Blob) form.append(k, v, v.name || k); else if (v != null) form.append(k, String(v));
  }
  const token = ui.token.value.trim();
  if (token) form.append("token", token);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    let uploaded = false; // true, sobald der komplette Body beim Server angekommen ist
    x.open("POST", url);
    x.timeout = 10 * 60 * 1000;
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.upload.onload = () => { uploaded = true; };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve(name);
      reject(new HookError(`Webhook antwortet mit ${x.status}: ${explainMakeStatus(x.status)}`, { retry: RETRY_STATUS.has(x.status), status: x.status }));
    };
    const fail = (what) => reject(uploaded
      ? new HookError(`${what} nach vollständigem Upload – Eingang bei Make unbestätigt`, { unconfirmed: true })
      : new HookError(`${what} vor Abschluss des Uploads`, { retry: true }));
    x.onerror = () => fail("Netzwerkfehler");
    x.ontimeout = () => fail("Zeitüberschreitung");
    x.send(form);
  });
}

/** Wiederholt nur, wenn sicher ist, dass Make das Reel nicht bekommen hat – so entstehen keine Doppel-Posts. */
async function sendWithRetry(url, ep, res, cap, txt, onProgress, extra) {
  const uploadId = `ep${ep.n}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  for (let attempt = 1; ; attempt++) {
    try { return await postToWebhook(url, ep, res, cap, txt, uploadId, onProgress, extra); }
    catch (e) {
      if (!e.retry || attempt >= 3) throw e;
      setStatus(`↻ ${e.message} – neuer Versuch ${attempt + 1}/3 für Episode ${ep.n} …`, "err");
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function generateAll(list = EPISODES) {
  if (mode === "rec") return;
  if (recLock.owner) return setStatus("⚠️ Das Reel Studio nimmt gerade auf – bitte warten.", "err");
  const { mime, audio } = pickMime();
  if (mime === null || typeof ui.canvas.captureStream !== "function") {
    return setStatus("⚠️ Dieser Browser kann nicht aufnehmen. Bitte aktuelles Chrome oder Edge verwenden.", "err");
  }
  const ac = audio || voiceOn ? unlockAudio() : null; // noch im Klick-Handler entsperren, sonst bleibt der AudioContext stumm
  if (voiceOn && !ac) return setStatus("⚠️ Dieser Browser kann keinen Ton mit aufnehmen – für das Voiceover bitte aktuelles Chrome oder Edge verwenden.", "err");
  if (voiceOn && !voiceReady?.ready) await checkVoice(); // vor jedem Start neu prüfen – ein frisch gesetzter Schlüssel greift ohne Neuladen
  if (voiceOn && !voiceReady?.ready) {
    return setStatus(voiceReady?.error
      ? `⚠️ Sprachdienst nicht erreichbar (${voiceReady.error}) – Start abgebrochen, damit kein Reel ohne Sprecherin entsteht.`
      : "⚠️ ElevenLabs ist nicht eingerichtet (ELEVENLABS_API_KEY fehlt) – Start abgebrochen. Alternativ das Voiceover ausschalten.", "err");
  }
  const useVoice = voiceOn;
  // Immer die URL verwenden, die gerade im Feld steht – eine ungültige Eingabe sperrt den Start.
  const hs = hookState();
  if (hs.error) { ui.hook.focus(); return setStatus(`⚠️ ${hs.error}`, "err"); }
  const hook = hs.url;
  if (hook && !platforms.size) return setStatus("⚠️ Bitte mindestens eine Plattform für Make.com auswählen (oder die Webhook-URL leeren).", "err");
  if (hook && estMb() > limitMb && !confirm(`Geschätzt ≈ ${estMb().toFixed(0)} MB pro Reel – das liegt über dem eingestellten Make-Limit von ${limitMb} MB.\n\nZu große Reels werden nicht gesendet, sondern lokal heruntergeladen. Trotzdem starten?\n(Tipp: Qualität oder Länge reduzieren.)`)) return;
  previewToken++;
  if (previewRun) { stage.abort(); try { await previewRun; } catch { /* abgebrochen */ } previewRun = null; }
  mode = "rec"; recLock.owner = "auto"; stopAll = false; setBusy(true); ui.time.classList.add("rec");
  fit();
  try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; }
  const len = reelLen, states = {};
  list.forEach((ep) => { states[ep.n] = "wait"; });
  renderList(states);
  let ok = 0, sent = 0;
  for (let i = 0; i < list.length && !stopAll; i++) {
    const ep = list[i];
    states[ep.n] = "on"; renderList(states); setBusy(true);
    try {
      const lines = scriptFor(ep, len);
      const chk = checkScript(lines, len);
      if (!chk.ok) throw new Error(`Skript hat ${chk.words} Wörter (erlaubt ${chk.min}–${chk.max})`);
      let voice = null;
      if (useVoice) {
        setStatus(`🎙️ Episode ${ep.n}: Sprecherin wird komplett erzeugt und geladen (Audio-First) …`);
        try { voice = await loadNarration(lines, ac); }
        catch (e) { throw new Error(`Voiceover fehlgeschlagen (${e.message}) – Episode wurde nicht aufgenommen`); }
        setStatus(`🎙️ Episode ${ep.n}: Stimme fertig (${voice.duration.toFixed(1).replace(".", ",")} s, ${voice.words} Wörter) – lade die Live-Website …`);
      }
      voiceModes.set(ep.n, voice ? "voice" : "off");
      let res = null;
      while (!res && !stopAll) {
        await waitVisible();
        // Displaysperre geht verloren, wenn der Tab verdeckt war – neu anfordern
        if (!wake || wake.released) { try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; } }
        res = await recordLive({
          stage, scenario: ep, len, capture: "dom", voice, mbit, canvas: ui.canvas,
          onStatus: (m) => setStatus(`Ep. ${ep.n} (${i + 1}/${list.length}): ${m}`),
          onTick: (t, D) => {
            ui.time.innerHTML = `<span class="ls-rec-dot"></span>Ep. ${ep.n} · ${fmt(t, D)}`;
            ui.bar.style.width = `${((i + t / D) / list.length) * 100}%`;
          },
        });
        if (!res && !stopAll) setStatus(`⏸ Tab war verdeckt – Episode ${ep.n} wird neu aufgenommen, sobald der Tab wieder sichtbar ist …`, "err");
      }
      if (!res) break;
      const cap = buildCaption(ep, res.facts);
      const txt = captionFile(ep, cap, { voiceover: res.lines.join(" "), recorded: new Date().toLocaleString("de-DE"), mode: "Live-DOM" });
      const mb = (res.blob.size / 1048576).toFixed(1);
      const info = `${res.duration.toFixed(1).replace(".", ",")} s, ${res.fps} FPS`;
      if (hook && res.ext === "mp4" && res.blob.size > limitMb * MB) {
        const name = keep(ep, res, cap, txt, { click: true });
        reportDelivery({ ok: false, episode: ep.n, sizeMb: res.blob.size / MB, message: `Nicht gesendet: ${mb} MB über dem Make-Limit von ${limitMb} MB` });
        setStatus(`⚠️ ${name} ist ${mb} MB groß – über dem Make-Limit von ${limitMb} MB, daher nicht gesendet, sondern (mit .txt) heruntergeladen.`, "err");
        await new Promise((r) => setTimeout(r, 1500));
      } else if (hook && res.ext === "mp4") {
        try {
          setStatus(`📤 Episode ${ep.n} wird an Make.com gesendet (${mb} MB, ${info}) …`);
          const name = await sendWithRetry(hook, ep, res, cap, txt, (p) => { ui.time.textContent = `📤 Ep. ${ep.n} · ${Math.round(p * 100)} %`; });
          keep(ep, res, cap, txt, { sent: true }); sent++;
          reportDelivery({ ok: true, episode: ep.n, sizeMb: res.blob.size / MB, message: `${name} angenommen` });
          setStatus(`✓ ${name} (${mb} MB, ${info}) samt Beschreibung an Make.com übergeben.`, "ok");
        } catch (e) {
          const name = keep(ep, res, cap, txt, { click: true });
          reportDelivery({ ok: false, episode: ep.n, status: e.status, sizeMb: res.blob.size / MB, message: e.message });
          // Unklarer Ausgang (Upload evtl. angekommen): wie gesendet merken, damit kein zweiter Upload ohne Rückfrage startet
          if (e.unconfirmed) markSent(tpl, variant, name);
          setStatus(e.unconfirmed
            ? `❔ ${e.message} – kein erneuter Versand (vermeidet Doppel-Posts). ${name} wurde zur Sicherheit zusätzlich heruntergeladen; bitte in Make prüfen, ob es angekommen ist.`
            : `⚠️ Webhook fehlgeschlagen (${e.message}) – ${name} wurde stattdessen heruntergeladen.`, "err");
          await new Promise((r) => setTimeout(r, 1500));
        }
      } else {
        const name = keep(ep, res, cap, txt, { click: true });
        setStatus(`✓ ${name} (${mb} MB, ${info}) + .txt heruntergeladen${hook ? " (WebM wird nicht an Make.com gesendet)" : ""}.`, hook ? "err" : "ok");
        await new Promise((r) => setTimeout(r, 900)); // kurze Pause zwischen den Downloads
      }
      states[ep.n] = "ok"; ok++;
    } catch (e) {
      states[ep.n] = "err";
      setStatus(`⚠️ Episode ${ep.n}: ${e?.name === "StageAbort" ? "abgebrochen" : e.message}`, "err");
    }
    renderList(states);
  }
  try { await wake?.release(); } catch { /* egal */ }
  wake = null;
  mode = "idle"; recLock.owner = null; ui.time.classList.remove("rec"); ui.time.textContent = "Live-Stage bereit"; setBusy(false);
  renderList(Object.fromEntries(Object.entries(states).filter(([, s]) => s === "err")));
  ui.bar.style.width = "100%";
  const failed = Object.values(states).filter((s) => s === "err").length;
  const where = sent && sent === ok ? "an Make.com gesendet" : sent ? `fertig (${sent} an Make.com, ${ok - sent} heruntergeladen)` : "heruntergeladen";
  if (stopAll) setStatus(`■ Abgebrochen – ${ok} von ${list.length} Live-Reels ${where}.`, ok ? "ok" : "err");
  else if (failed) setStatus(`⚠️ ${ok} von ${list.length} Live-Reels ${where}, ${failed} fehlgeschlagen – einzeln über ⏺ erneut aufnehmen.`, "err");
  else setStatus(`🎉 Fertig! ${ok} Live-Reel${ok === 1 ? "" : "s"} ${where} – jeweils mit Titel, Beschreibung und Hashtags.`, "ok");
}


// ---------------------------------------------------------------------------
// Pro-Videos: 5 Szenen (Cover → Fokus-Zoom → Nutzen → Vertrauen → Endscreen) statt Bildschirmaufnahme
// ---------------------------------------------------------------------------
const PRO_CSS = `
#auto-reels .ar-pro{display:flex;flex-direction:column;gap:8px;background:linear-gradient(135deg,rgba(124,58,237,.25),rgba(27,36,68,.9));border:1px solid rgba(167,139,250,.5);border-radius:14px;padding:12px}
#auto-reels .ar-pro b.t{font-family:var(--font-display,"Lilita One",sans-serif);font-weight:400;font-size:19px}
#auto-reels .ar-pro small{font-size:12px;color:var(--ink-soft,#b9b7c9)}
#auto-reels .ar-pro ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
#auto-reels .ar-pro li{background:rgba(19,26,51,.85);padding:7px 9px}
#auto-reels .ar-pro li.next{border-color:#ffcb05}
#auto-reels .ar-pro .ar-note{flex-basis:100%;display:block;margin:2px 0 0 32px;padding:6px 9px;border-radius:8px;font:700 12px/1.45 var(--font-body,Figtree,sans-serif);white-space:pre-wrap;word-break:break-word;user-select:text}
#auto-reels .ar-pro .ar-note.err{background:rgba(251,113,133,.14);border:1px solid rgba(251,113,133,.55);color:#fecdd3}
#auto-reels .ar-pro .ar-note.warn{background:rgba(255,203,5,.1);border:1px solid rgba(255,203,5,.45);color:#fde68a}
#auto-reels .ar-pro .ar-note.info{background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:#bbf7d0}
#auto-reels button.ar-pro-go{background:#a78bfa;border-color:#a78bfa;color:#1a1420;font-weight:900;flex:1}
`;
const PRO_HTML = `
  <div class="ar-pro" id="ar-pro">
    <b class="t">🎬 Pro-Videos · 15–30 s</b>
    <small id="ar-pro-spec">Lade Video-Einstellungen …</small>
    <div class="ar-bar">
      <button type="button" class="ar-btn ar-pro-go" data-ar="pro" data-pro="next">🔁 Nächstes Pro-Video (Rotation)</button>
      <button type="button" class="ar-btn" data-ar="pro" data-pro="all">🚀 Alle aktiven Vorlagen</button>
      <button type="button" class="ar-btn ar-pro-go" data-ar="pro" data-pro="showcase" title="High-End-Showcase: Scanner, Set-Binder, Marktplatz, Live-Chat und Pro-Abo – exakt 29 s, 1080×1920, 60 FPS, 11 Mbit/s">🎬 Pro-Showcase (29 s · 60 FPS)</button>
      <button type="button" class="ar-btn ar-pro-go" data-ar="pro" data-pro="hook4" title="Schnäppchen-FOMO, Flohmarkt-Schutz und Tinder für Sammler nacheinander aufnehmen">🎯 Alle 3 Hook-Presets (15–17 s)</button>
    </div>
    <ul id="ar-pro-list"></ul>
    <small>Cover mit Hook-Schlagzeile (0–2 s, zugleich Vorschaubild) → Fokus-Zoom auf die echte App → „Warum das genial ist“ mit Feature-Badges → Vertrauen &amp; Praxis-Mehrwert → Endscreen „${esc("Jetzt kostenlos testen auf pokeswipe-radar.de")}“. Untertitel im sicheren Mittelbereich. Einstellungen: Admin-Zentrale → 🎬 Make.com &amp; Auto-Reels.</small>
  </div>`;
const proResults = new Map(); // Vorlage -> { url, name, size, sent, cap, txt, txtUrl, txtName, thumbUrl }
// Vorlage -> [{ kind: "err" | "warn" | "info", text }] – lesbarer Hinweis/Fehlertext direkt unter der Karte
const proNotes = new Map();
const addNote = (key, kind, text) => { proNotes.set(key, [...(proNotes.get(key) || []), { kind, text: String(text || "unbekannter Fehler") }]); };
let proCfg = { templates: PRO_TEMPLATES.map((t) => t.key), fps: 30, mbit: 18, maxMb: SAFE_MB, tone: "energetic" };
let proNext = null; // { template, variant } vom Server

function proMaxMb() { return Math.min(proCfg.maxMb || SAFE_MB, Math.floor(limitMb * 0.95)); }

function renderPro(states = {}) {
  const spec = ui.root?.querySelector("#ar-pro-spec");
  if (!spec) return;
  const est = estimateMb(PRO_MAX_S, bitrateFor(PRO_MAX_S, proCfg.mbit, proMaxMb()));
  spec.textContent = `1080×1920 · H.264 High · ${proCfg.fps} FPS · bis ${proCfg.mbit} Mbit/s · AAC 192 kbit/s Stereo · Stimme ${proCfg.tone === "calm" ? "ruhig" : "energiegeladen"} · Größen-Garantie ≤ ${proMaxMb()} MB (≈ ${est.toFixed(0)} MB bei 30 s)`;
  ui.root.querySelector("#ar-pro-list").innerHTML = ALL_TEMPLATES.map((tpl, i) => {
    const on = proCfg.templates.includes(tpl.key), r = proResults.get(tpl.key), st = states[tpl.key];
    const icon = { on: "⏺", ok: "✅", err: "⚠️", wait: "⏳" }[st] || (r ? "✅" : on ? "🎞️" : "⏸");
    const words = checkTemplateScript(tpl, proScript(tpl, 0).say).words;
    const isNext = proNext?.template === tpl.key;
    const out = r ? `<div class="ar-out"><img src="${r.thumbUrl}" alt="Vorschaubild" style="width:72px;aspect-ratio:9/16;border-radius:8px;object-fit:cover"><video src="${r.url}" controls playsinline preload="metadata"></video><div class="ar-cap"><pre>${esc(r.cap.caption)}</pre><span><a href="${r.url}" download="${esc(r.name)}">⬇ ${r.name.endsWith(".mp4") ? "MP4" : "Video (WebM)"} herunterladen</a> <a href="${r.thumbUrl}" download="${esc(r.name.replace(/\.\w+$/, ""))} - Cover.jpg">⬇ Cover</a> <a href="${r.txtUrl}" download="${esc(r.txtName)}">⬇ .txt</a> ${r.sent ? "📤 an Make gesendet" : ""}</span></div></div>` : "";
    const notes = (proNotes.get(tpl.key) || []).map((n) => `<small class="ar-note ${n.kind}" role="${n.kind === "err" ? "alert" : "status"}">${n.kind === "err" ? "⚠️ Fehler: " : n.kind === "warn" ? "⚠️ " : "ℹ️ "}${esc(n.text)}</small>`).join("");
    return `<li class="${st || ""}${isNext ? " next" : ""}"><span class="ar-st">${icon}</span><span class="ar-main"><b>${i + 1}. ${esc(tpl.label)}${isNext ? " · als Nächstes" : ""}</b><small>${esc(tpl.title)} · ${words} Wörter${tpl.seconds ? ` · ${[...new Set(secondsFor(tpl))].join("–")} s` : ""}${tpl.fps ? ` · ${tpl.fps} FPS` : ""}${tpl.mbit ? ` · ${tpl.mbit} Mbit/s` : ""}${proSent()[tpl.key] ? ` · 📤 zuletzt an Make gesendet am ${esc(new Date(proSent()[tpl.key].at).toLocaleString("de-DE"))}` : ""}${on ? "" : " · nicht in der Rotation (Admin-Zentrale)"}</small></span>
      <span class="ar-acts"><button type="button" data-ar="pro" data-pro="one" data-k="${tpl.key}" title="Nur diese Vorlage aufnehmen">⏺</button></span>${notes}${out}</li>`;
  }).join("");
}

function applyProDefaults(make) {
  if (make?.video) proCfg = { ...proCfg, ...make.video };
  if (make?.next) proNext = make.next;
  renderPro();
}

async function onProClick(btn) {
  if (mode !== "idle") return;
  const what = btn.dataset.pro;
  if (what === "one") return generatePro([{ tpl: templateByKey(btn.dataset.k), variant: proNext?.template === btn.dataset.k ? proNext.variant : 0 }]);
  if (what === "all") return generatePro(ALL_TEMPLATES.filter((t) => proCfg.templates.includes(t.key)).map((tpl) => ({ tpl, variant: 0 })));
  // High-End-Showcase immer einzeln per Klick – unabhängig von der Rotation der Admin-Zentrale
  if (what === "showcase") return generatePro(ALL_TEMPLATES.filter(isShowcase).map((tpl) => ({ tpl, variant: proNext?.template === tpl.key ? proNext.variant : 0 })));
  // Die 3 Hook-Presets immer gemeinsam – unabhängig davon, ob sie in der Rotation der Admin-Zentrale aktiv sind
  if (what === "hook4") return generatePro(PRO_TEMPLATES.filter(isHook4).map((tpl) => ({ tpl, variant: 0 })));
  if (what === "next") {
    let pick = null;
    try { pick = await api("/api/admin/make/video/next", { method: "POST", body: {} }); } catch { pick = proNext; }
    const tpl = templateByKey(pick?.template) || PRO_TEMPLATES[0];
    await generatePro([{ tpl, variant: pick?.variant || 0 }]);
    proNext = { template: proCfg.templates[(Number(pick?.index ?? -1) + 1) % proCfg.templates.length], variant: 0 };
    renderPro();
  }
}

// Doppel-Upload-Schutz: welche Vorlage (mit welchem Skript) zuletzt erfolgreich an Make.com ging
const SENT_KEY = "pokeswipe.pro.sent";
const proSent = () => { try { return JSON.parse(load(SENT_KEY, "{}")) || {}; } catch { return {}; } };
const scriptSig = (tpl, variant) => { const t = proScript(tpl, variant).say.join("|"); let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return `${tpl.key}:${variant}:${h}`; };
const markSent = (tpl, variant, name) => save(SENT_KEY, JSON.stringify({ ...proSent(), [tpl.key]: { sig: scriptSig(tpl, variant), at: new Date().toISOString(), name } }));

const LOOK_KEY = "pokeswipe.pro.look"; // Zähler für Farb-/Layout-Rotation der Startbilder
const RECENT_KEY = "pokeswipe.pro.recentCards"; // zuletzt genutzte Kartenmotive (max. 40)
const recentCards = () => { try { return JSON.parse(load(RECENT_KEY, "[]")) || []; } catch { return []; } };
const rememberCard = (id) => save(RECENT_KEY, JSON.stringify([id, ...recentCards().filter((x) => x !== id)].slice(0, 40)));

async function coverCards(n) {
  try {
    const ex = recentCards().slice(0, 40).join(",");
    const r = await api(`/api/admin/reel-cover-cards?n=${Math.min(24, n)}${ex ? `&exclude=${encodeURIComponent(ex)}` : ""}`);
    return Array.isArray(r?.cards) ? r.cards : [];
  } catch { return []; }
}

/** Kartenbild über das eigene Image CDN laden (gleicher Ursprung → Canvas bleibt exportierbar). */
async function loadCardImage(card) {
  const url = sameOriginImageUrl(cardImageUrl(card.image), 700);
  if (!url) return null;
  try {
    const img = new Image();
    img.decoding = "async"; img.src = url;
    await img.decode();
    return img;
  } catch { return null; }
}

const jpeg = (canvas) => new Promise((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.92));

async function generatePro(list) {
  if (mode === "rec" || !list.length) return;
  if (recLock.owner) return setStatus("⚠️ Das Reel Studio nimmt gerade auf – bitte warten.", "err");
  const { mime } = pickMime();
  if (mime === null || typeof ui.canvas.captureStream !== "function") return setStatus("⚠️ Dieser Browser kann nicht aufnehmen. Bitte aktuelles Chrome oder Edge verwenden.", "err");
  const ac = unlockAudio(); // im Klick-Handler entsperren
  if (voiceOn && !ac) return setStatus("⚠️ Dieser Browser kann keinen Ton mit aufnehmen – bitte Chrome oder Edge verwenden.", "err");
  if (voiceOn && !voiceReady?.ready) await checkVoice();
  if (voiceOn && !voiceReady?.ready) return setStatus(voiceReady?.error
    ? `⚠️ Sprachdienst nicht erreichbar (${voiceReady.error}) – Start abgebrochen. Alternativ das Voiceover ausschalten.`
    : "⚠️ ElevenLabs ist nicht eingerichtet (ELEVENLABS_API_KEY fehlt) – Start abgebrochen. Alternativ das Voiceover ausschalten.", "err");
  if (voiceOn) {
    await checkVoice(); // aktuelle Credits holen
    const cr = voiceReady?.credits;
    // ElevenLabs berechnet ca. 1 Credit je Zeichen; jede Vorlage braucht mindestens einen kompletten Take
    const need = list.map(({ tpl }) => proScript(tpl, 0).say.join(" ").length);
    if (cr && need.length && cr.remaining < Math.min(...need)) {
      const reset = cr.resetAt ? ` Das Kontingent wird am ${fmtDate(cr.resetAt)} wieder aufgefüllt.` : "";
      return setStatus(`⚠️ ElevenLabs-Credits reichen nicht: noch ${cr.remaining} übrig, ein Pro-Video braucht ca. ${Math.min(...need)}.${reset} Bitte im ElevenLabs-Konto Credits aufladen bzw. den Tarif erhöhen – oder das Voiceover ausschalten (dann nur Musik).`, "err");
    }
    const total = need.reduce((a, b) => a + b, 0);
    if (cr && cr.remaining < total) setStatus(`⚠️ ElevenLabs-Credits reichen nur für einen Teil (${cr.remaining} übrig, ca. ${total} nötig) – die übrigen Videos werden ohne Sprecherin aufgenommen.`, "err");
  }
  const hs = hookState();
  if (hs.error) { ui.hook.focus(); return setStatus(`⚠️ ${hs.error}`, "err"); }
  const hook = hs.url;
  if (hook && !platforms.size) return setStatus("⚠️ Bitte mindestens eine Plattform für Make.com auswählen (oder die Webhook-URL leeren).", "err");
  // Kein versehentlicher Doppel-Upload: dasselbe Video (gleiche Vorlage + gleiches Skript) wurde schon an Make.com übergeben
  if (hook) {
    const sent = proSent();
    const dup = list.filter(({ tpl, variant }) => sent[tpl.key]?.sig === scriptSig(tpl, variant));
    if (dup.length && !confirm(`${dup.map(({ tpl }) => `„${tpl.label}“ (${new Date(sent[tpl.key].at).toLocaleString("de-DE")})`).join(", ")} wurde bereits an Make.com gesendet.\n\nNochmal aufnehmen UND erneut senden? (Abbrechen = nichts tun)`)) return;
  }
  for (const { tpl } of list) proNotes.delete(tpl.key); // alte Hinweise dieser Vorlagen zurücksetzen
  previewToken++;
  if (previewRun) { stage.abort(); try { await previewRun; } catch { /* abgebrochen */ } previewRun = null; }
  mode = "rec"; recLock.owner = "auto"; stopAll = false; setBusy(true); ui.time.classList.add("rec"); fit();
  try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; }
  const states = Object.fromEntries(list.map(({ tpl }) => [tpl.key, "wait"]));
  renderPro(states);
  const maxMb = proMaxMb();
  // echte Kartenmotive mit Live-Preisen – jedes Video bekommt ein anderes, zuletzt genutzte werden übersprungen
  setStatus("🃏 Lade echte Kartenmotive und Live-Preise für die Startbilder …");
  let pool = await coverCards(list.length + 4);
  let ok = 0, sent = 0;
  for (let i = 0; i < list.length && !stopAll; i++) {
    const { tpl, variant } = list[i];
    const look = lookFor(Number(load(LOOK_KEY, "0")) || 0); // Farbe + Layout rotieren je Video
    const pick = pickCoverCard(pool, recentCards());
    if (pick) pool = pool.filter((c) => c !== pick);
    const coverCard = pick ? { ...pick, img: await loadCardImage(pick) } : null;
    const n = ALL_TEMPLATES.indexOf(tpl) + 1;
    states[tpl.key] = "on"; renderPro(states); setBusy(true);
    try {
      const script = proScript(tpl, variant);
      let voice = null, speed = 1, voiceFailed = null, voiceSec = 0;
      if (voiceOn) {
        setStatus(`🎙️ ${tpl.label}: Sprecherin (${proCfg.tone === "calm" ? "ruhig" : "energiegeladen"}) wird erzeugt …`);
        try { ({ take: voice, speed, seconds: voiceSec } = await loadProNarration(script.say, ac, tpl.tone || proCfg.tone, secondsFor(tpl), tpl.maxSpeed || 1.12, { format: tpl.format || "" })); }
        catch (e) {
          // Kein Abbruch: das Video wird mit Musik (ohne Sprecherin) aufgenommen und heruntergeladen,
          // aber NICHT automatisch an Make.com gesendet. Der genaue Fehler steht unter der Karte.
          voiceFailed = e?.message || String(e);
          voice = null;
          console.warn(`Pro-Voiceover „${tpl.label}“ fehlgeschlagen:`, e);
          addNote(tpl.key, "warn", `Voiceover fehlgeschlagen: ${voiceFailed} – Video wurde ohne Sprecherin (nur Musik) aufgenommen und nicht an Make.com gesendet.`);
          renderPro(states);
          setStatus(`⚠️ ${tpl.label}: Voiceover fehlgeschlagen (${voiceFailed}) – nehme ohne Sprecherin auf …`, "err");
        }
        if (voice) {
          const sec = voiceSec; // exakte Videolänge: Vorlauf + gemessene Sprechdauer + 0,8 s Ausblenden
          const [lo, hi] = secondsFor(tpl);
          setStatus(`🎙️ Stimme fertig: ${sec.toFixed(1).replace(".", ",")} s (Tempo ${speed.toFixed(2).replace(".", ",")})${sec < lo || sec > hi ? ` – außerhalb ${lo}–${hi} s, Tempo-Spielraum ausgeschöpft` : ""} – lade die Live-Website …`);
        }
      }
      let res = null;
      while (!res && !stopAll) {
        await waitVisible();
        if (!wake || wake.released) { try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; } }
        res = await recordProSafe({
          stage, tpl, variant, look, coverCard, voice, mbit: tpl.mbit || proCfg.mbit, fps: tpl.fps || proCfg.fps, maxMb, canvas: ui.canvas,
          onStatus: (m) => setStatus(`Pro ${n} (${i + 1}/${list.length}): ${m}`),
          onTick: (t, D) => { ui.time.innerHTML = `<span class="ls-rec-dot"></span>Pro ${n} · ${fmt(t, D)}`; ui.bar.style.width = `${((i + t / D) / list.length) * 100}%`; },
        });
        if (!res && !stopAll) setStatus(`⏸ Tab war verdeckt – „${tpl.label}“ wird neu aufgenommen, sobald der Tab wieder sichtbar ist …`, "err");
      }
      if (!res) break;
      // nächstes Video bekommt eine andere Farbe/Layout und ein anderes Kartenmotiv
      save(LOOK_KEY, String(look.index + 1));
      if (pick) rememberCard(pick.id);
      // Vorschaubild = exakt Frame 0 der Aufnahme (Rückfall: gleiches Motiv ohne Live-Ansicht neu zeichnen)
      const thumb = res.thumb?.size ? res.thumb : await renderCoverThumb(tpl, script, look, coverCard);
      const cap = proCaption(tpl, variant, res.facts);
      const ep = { n: 100 + n, key: `pro-${tpl.key}`, title: tpl.label, pro: { n, fps: tpl.fps || proCfg.fps } };
      const txt = captionFile(ep, cap, { voiceover: res.lines.join(" "), recorded: new Date().toLocaleString("de-DE"), mode: `Pro-Video, ${res.fps} FPS, ${res.mbit} Mbit/s${res.exact ? ", frame-genau (WebCodecs)" : ""}` });
      const mb = (res.blob.size / MB).toFixed(1);
      const name = `${fileBase(ep)}.${res.ext}`;
      thumb.name = `${fileBase(ep)} - Cover.jpg`;
      const extra = {
        thumbnail: thumb, thumb_offset_ms: 0, cover_headline: res.cover, cover_badge: script.badge, cover_color: look.color, cover_accent: look.accent,
        cover_layout: look.layout, cover_card_id: pick?.id || "", cover_card_name: pick?.name || "", cover_card_price_eur: pick?.price ?? "", video_mode: "pro", video_template: tpl.key, video_template_label: tpl.label, promo_link: tpl.link || "",
        hook_variant: variant, fps: res.fps, video_bitrate_mbit: res.mbit, audio_bitrate_kbps: 192, resolution: "1080x1920", aspect_ratio: "9:16",
        max_mb: maxMb, scenes_json: JSON.stringify(res.scenes.map((s) => ({ key: s.key, start: +s.start.toFixed(2), end: +s.end.toFixed(2) }))),
        ...(isHook4(tpl) ? {
          video_format: "hook4", video_bitrate_mode: res.bitrateMode || "", comment_question: cap.question || "", target_seconds: secondsFor(tpl).join("-"),
          speech_seconds: res.speech ? +res.speech.toFixed(2) : "", segments_json: JSON.stringify(res.timing), timing_ok: res.timing?.ok ? "1" : "0",
        } : {}),
        ...(isShowcase(tpl) ? {
          video_format: "showcase", video_bitrate_mode: res.bitrateMode || "", target_seconds: String(tpl.exact), duration_seconds: +res.duration.toFixed(3),
          speech_seconds: res.speech ? +res.speech.toFixed(2) : "", spec_json: JSON.stringify(res.spec), spec_ok: res.spec?.ok ? "1" : "0",
        } : {}),
      };
      if (res.spec && !res.spec.ok) {
        const bad = Object.entries(res.spec.checks).filter(([, v]) => !v).map(([k]) => ({ duration: "Länge ≠ 29 s", fps: "nicht 60 FPS", bitrate: "Bitrate außerhalb 10–12 Mbit/s", size: "nicht 1080×1920" })[k]).join(", ");
        addNote(tpl.key, "warn", `Showcase-Spezifikation nicht ganz erfüllt (${bad}) – ${res.duration.toFixed(2).replace(".", ",")} s, ${res.fps} FPS, ${res.mbit} Mbit/s${res.exact ? "" : " (Browser ohne WebCodecs-MP4: bitte aktuelles Chrome/Edge nutzen)"}.`);
      }
      if (res.timing && !res.timing.ok) {
        const t = res.timing.rows.map((r) => `${r.key} ${r.start.toFixed(1)}–${r.end.toFixed(1)} s (Soll ${r.want.join("–")})`).join(" · ");
        addNote(tpl.key, "info", `Länge ${res.timing.duration.toFixed(1).replace(".", ",")} s – Szenen folgen den echten Satz-Zeitstempeln der Sprecherin: ${t}.`);
      }
      // 1) Fertiges Video IMMER sofort sichern: Ergebnis-Karte mit Download-Buttons + automatischer Download
      //    (MP4, .txt und Cover). Der Make.com-Versand ist danach nur noch ein optionaler Zusatz.
      const old = proResults.get(tpl.key);
      if (old) [old.url, old.txtUrl, old.thumbUrl].forEach((u) => URL.revokeObjectURL(u));
      const txtBlob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      const r = { url: URL.createObjectURL(res.blob), name, size: res.blob.size, sent: false, cap, txt, txtName: `${fileBase(ep)}.txt`, txtUrl: URL.createObjectURL(txtBlob), thumbUrl: URL.createObjectURL(thumb) };
      proResults.set(tpl.key, r);
      try {
        download(res.blob, name);
        setTimeout(() => { try { download(txtBlob, r.txtName); } catch { /* Button bleibt */ } }, 500);
        setTimeout(() => { try { download(thumb, thumb.name); } catch { /* Button bleibt */ } }, 1000);
      } catch (e) { addNote(tpl.key, "warn", `Automatischer Download blockiert (${e?.message || e}) – bitte unten auf „⬇ MP4 herunterladen“ klicken.`); }
      states[tpl.key] = "ok"; ok++;
      renderPro(states);
      const info = `${res.duration.toFixed(1).replace(".", ",")} s, ${res.fps} FPS, ${res.mbit} Mbit/s${res.attempts > 1 ? `, ${res.attempts}. Versuch` : ""}`;
      if (res.ext !== "mp4") addNote(tpl.key, "warn", `Dieser Browser hat WebM statt MP4 aufgenommen (${res.mime || res.ext}). Für MP4 bitte aktuelles Chrome oder Edge nutzen.`);
      if (res.oversize) addNote(tpl.key, "warn", `${mb} MB liegt trotz reduzierter Bitrate über ${maxMb} MB – Video wurde heruntergeladen, aber nicht an Make.com gesendet.`);
      // 2) Optional: an Make.com senden – ein Fehlschlag bricht NICHTS ab, das Video ist bereits gespeichert
      const sendable = hook && res.ext === "mp4" && !res.oversize && !voiceFailed;
      if (sendable) {
        try {
          setStatus(`📤 „${tpl.label}“ wird an Make.com gesendet (${mb} MB, ${info}) …`);
          await sendWithRetry(hook, ep, res, cap, txt, (p) => { ui.time.textContent = `📤 Pro ${n} · ${Math.round(p * 100)} %`; }, extra);
          r.sent = true; sent++;
          markSent(tpl, variant, name);
          reportDelivery({ ok: true, episode: ep.n, sizeMb: res.blob.size / MB, message: `${name} angenommen (Pro-Video)` });
          setStatus(`✓ ${name} (${mb} MB, ${info}) heruntergeladen und samt Cover und Beschreibung an Make.com übergeben.`, "ok");
        } catch (e) {
          reportDelivery({ ok: false, episode: ep.n, status: e.status, sizeMb: res.blob.size / MB, message: e.message });
          addNote(tpl.key, "warn", e.unconfirmed
            ? `Make.com: ${e.message} – kein erneuter Versand, bitte in Make prüfen. Das MP4 wurde trotzdem heruntergeladen.`
            : `Make.com-Versand fehlgeschlagen: ${e.message}. Das MP4 wurde trotzdem heruntergeladen.`);
          setStatus(`✓ ${name} heruntergeladen – Make.com-Versand fehlgeschlagen (${e.message}).`, "err");
          await new Promise((r) => setTimeout(r, 1200));
        }
      } else {
        setStatus(`✓ ${name} (${mb} MB, ${info}) + Cover + .txt heruntergeladen.`, "ok");
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch (e) {
      if (states[tpl.key] !== "ok") states[tpl.key] = "err";
      const msg = e?.name === "StageAbort" ? "abgebrochen" : (e?.message || String(e));
      console.error(`Pro-Video „${tpl.label}“ fehlgeschlagen:`, e);
      addNote(tpl.key, "err", msg);
      setStatus(`⚠️ ${tpl.label}: ${msg}`, "err");
    }
    renderPro(states);
  }
  try { await wake?.release(); } catch { /* egal */ }
  wake = null;
  mode = "idle"; recLock.owner = null; ui.time.classList.remove("rec"); ui.time.textContent = "Live-Stage bereit"; setBusy(false);
  ui.bar.style.width = "100%";
  renderPro(Object.fromEntries(Object.entries(states).filter(([, s]) => s === "err")));
  const failed = Object.values(states).filter((s) => s === "err").length;
  const where = sent ? `heruntergeladen (${sent} davon zusätzlich an Make.com gesendet)` : "heruntergeladen";
  const warned = list.filter(({ tpl }) => states[tpl.key] === "ok" && (proNotes.get(tpl.key) || []).some((x) => x.kind === "warn")).length;
  setStatus(failed ? `⚠️ ${ok} von ${list.length} Pro-Videos ${where}, ${failed} fehlgeschlagen – der genaue Fehler steht unter der jeweiligen Karte.`
    : warned ? `✓ ${ok} Pro-Video${ok === 1 ? "" : "s"} ${where} – bei ${warned} gibt es Hinweise (siehe Text unter der Karte).`
      : `🎉 ${ok} Pro-Video${ok === 1 ? "" : "s"} ${where} – mit Cover, Untertiteln, Beschreibung und Hashtags.`, failed || warned ? "err" : "ok");
}

/** Rückfall-Vorschaubild (nur falls Frame 0 nicht exportiert werden konnte): gleiches Cover-Motiv. */
async function renderCoverThumb(tpl, script, look, coverCard) {
  await loadProFonts();
  const c = document.createElement("canvas"); c.width = OUT_W; c.height = OUT_H;
  const comp = new ProCompositor({ tpl, cover: script.cover, badge: script.badge, look, coverCard, scenes: isShowcase(tpl) ? showcaseScenes(tpl.exact) : sceneTimes([], isHook4(tpl) ? 17 : 26, scenesFor(tpl)), captions: [] });
  comp.draw(c.getContext("2d", { alpha: false }), 0, null);
  return (await jpeg(c)) || new Blob([], { type: "image/jpeg" });
}

function open() {
  build();
  if (!ui.root.hidden) return;
  ui.root.hidden = false;
  document.documentElement.style.overflow = "hidden";
  fit();
  const { mime, audio } = pickMime();
  const tone = audio ? " 🔊 Mit Ton (Sprecherin + dezente Musik)." : " 🔇 Dieser Browser kann hier keinen Ton mit aufnehmen.";
  updateVoiceInfo(); checkVoice();
  ui.format.textContent = mime === null
    ? "⚠️ MediaRecorder wird von diesem Browser nicht unterstützt."
    : String(mime).startsWith("video/mp4") || mime === ""
      ? `✓ Ausgabeformat: MP4${mime ? ` (${mime})` : ""} – passt für Instagram Reels, TikTok, YouTube Shorts, Facebook und Make.com.${tone}`
      : `⚠️ Dieser Browser kann kein MP4 aufnehmen – es wird WebM gespeichert, das Instagram nicht annimmt. Für MP4 bitte aktuelles Chrome/Edge (ab Version 126) nutzen.${tone}`;
  setStatus("✓ Bereit. ▶ startet eine Live-Vorschau auf der echten Website, 🚀 nimmt alle 10 Live-Reels nacheinander auf.", "ok");
}

function close() {
  if (!ui.root || mode === "rec") return;
  stage?.abort();
  stage?.unload();
  mode = "idle";
  ui.host.innerHTML = `<div class="ls-empty">📱 Hier läuft die echte Website in 9:16 (${VIEW_W}×${VIEW_H}).<br>▶ bei einer Episode startet die Live-Vorschau.</div>`;
  ui.root.hidden = true;
  document.documentElement.style.overflow = "";
  // Anker entfernen, damit Neu-Laden/Zurück den Generator nicht ungewollt wieder öffnet
  if (HASHES.includes(location.hash)) history.replaceState(null, "", location.pathname + location.search);
}

// Direkte Anker: pokeswipe-radar.de/#generator (alt: /#auto-reels)
const HASHES = ["#generator", "#auto-reels"];

/** Generator öffnen – mit klarer Rückmeldung, falls nicht (als Admin) angemeldet. */
export function openAutoReels() {
  if (IN_STAGE) return;
  if (isAdmin()) {
    if (!HASHES.includes(location.hash)) history.replaceState(null, "", "#generator");
    return open();
  }
  if (!state.user) return hooks.openAccount("Der Auto-Reels-Generator ist nur für Admins – bitte mit deinem Admin-Konto anmelden.");
  if (!state.me) return; // Konto lädt noch – syncAutoReels() öffnet danach automatisch
  toast("🔒 Nur für Admins", "Der Auto-Reels-Generator ist nur mit einem Admin-Konto verfügbar.");
}

/** Beim Start bzw. bei Anker-Wechsel: /#generator öffnet den Generator. */
export function routeAutoReels() {
  if (!IN_STAGE && HASHES.includes(location.hash)) openAutoReels();
}

/** Footer-Button nur für Admins zeigen (nach jedem Login-Wechsel aufrufen). */
export function syncAutoReels() {
  const show = isAdmin();
  for (const id of ["auto-reels-btn", "ps-generator-btn"]) document.getElementById(id)?.classList.toggle("hidden", !show);
  if (show && HASHES.includes(location.hash)) open();
  if (!show) close();
}

export function initAutoReels() {
  if (IN_STAGE) return; // in der Live-Stage selbst keine Admin-Werkzeuge
  document.getElementById("auto-reels-btn")?.addEventListener("click", openAutoReels);
  // Gut sichtbarer Admin-Button im Kopfbereich (neben dem Konto-Button)
  const profileBtn = document.getElementById("authBtnText")?.closest("button");
  if (profileBtn && !document.getElementById("ps-generator-btn")) {
    const b = document.createElement("a");
    b.id = "ps-generator-btn"; b.href = "#generator"; b.title = "Auto-Reels-Generator (10x)"; b.setAttribute("aria-label", "Auto-Reels-Generator öffnen");
    b.className = "hidden relative bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs px-2.5 py-1.5 rounded-xl border border-yellow-400/50";
    b.innerHTML = `🎬<span class="hidden sm:inline ml-1">Generator</span>`;
    b.addEventListener("click", (e) => { e.preventDefault(); openAutoReels(); });
    profileBtn.before(b);
  }
  window.addEventListener("hashchange", routeAutoReels);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.root && !ui.root.hidden) close();
  }, true);
}
