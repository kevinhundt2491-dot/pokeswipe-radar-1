/* PokeSwipe Radar – Creator-Landingpage (/creator): Live-Vorschau des Wunsch-Codes und Bewerbung an /api/creator/apply */
// Showcase (#video): hinterlegtes MP4 (Pro-Reel-Generator / Admin-Upload) abspielen – sonst interaktive Live-Vorschau
// „Set-Binder durchblättern → doppelte Karte → 1-Klick inserieren“ in Endlosschleife.
(function () {
  "use strict";
  var screen = document.getElementById("showcase-screen");
  var demo = document.getElementById("demo");
  if (!screen || !demo) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var timers = [], stopped = false;

  function showVideo(meta) {
    var v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = !reduce; v.playsInline = true; v.controls = false; v.preload = "auto";
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.setAttribute("aria-label", "Video: Digitaler Set-Binder und 1-Klick-Inserieren bei PokeSwipe Radar");
    if (meta.poster) v.poster = meta.poster;
    var src = document.createElement("source");
    src.src = meta.url; src.type = meta.type || "video/mp4";
    v.appendChild(src);
    var sound = document.createElement("button");
    sound.type = "button"; sound.className = "sound"; sound.textContent = "🔇 Ton an";
    sound.addEventListener("click", function () {
      v.muted = !v.muted;
      if (!v.muted) { v.currentTime = 0; v.play().catch(function () {}); }
      sound.textContent = v.muted ? "🔇 Ton an" : "🔊 Ton aus";
    });
    v.addEventListener("click", function () { if (v.paused) v.play().catch(function () {}); else v.pause(); });
    // Kann das Video nicht geladen werden, bleibt die Live-Vorschau stehen
    v.addEventListener("error", function () { if (v.parentNode) { v.remove(); sound.remove(); demo.style.display = ""; } }, true);
    src.addEventListener("error", function () { if (v.parentNode) { v.remove(); sound.remove(); demo.style.display = ""; } });
    v.addEventListener("loadeddata", function () {
      stopped = true; timers.forEach(clearTimeout); demo.style.display = "none";
    });
    screen.insertBefore(v, demo);
    screen.appendChild(sound);
    if (!reduce) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  }

  fetch("/api/creator/video/meta", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (m) { if (m && m.available && m.url) showVideo(m); })
    .catch(function () {});

  // ---------------- Live-Vorschau ----------------
  var img = function (n) { return "/.netlify/images?url=" + encodeURIComponent("https://images.pokemontcg.io/sv3pt5/" + n + ".png") + "&w=160"; };
  // Zwei Binder-Seiten: owned = in Farbe, sonst grau mit Marktplatz-Preis; dup = doppelt vorhanden
  var PAGES = [
    [{ n: 1, own: true }, { n: 2, own: true }, { n: 3, price: "ab 2,49 €" }, { n: 4, own: true, dup: 2 }, { n: 5, price: "ab 0,89 €" }, { n: 6, own: true },
      { n: 7, own: true }, { n: 8, price: "ab 1,20 €" }, { n: 9, own: true }],
    [{ n: 10, own: true }, { n: 11, price: "ab 0,49 €" }, { n: 12, own: true }, { n: 13, own: true }, { n: 14, price: "ab 0,79 €" }, { n: 15, own: true },
      { n: 16, own: true, dup: 2 }, { n: 17, own: true }, { n: 18, price: "ab 3,90 €" }],
  ];
  var grid = document.getElementById("demo-grid"), btn = document.getElementById("demo-btn"), toast = document.getElementById("demo-toast");
  var cap = document.getElementById("demo-cap"), finger = document.getElementById("demo-finger"), prog = document.getElementById("demo-prog");
  var count = document.getElementById("demo-count"), pageLbl = document.getElementById("demo-page");
  var owned = 96;

  function renderPage(i) {
    grid.innerHTML = PAGES[i].map(function (c, k) {
      return '<div class="slot ' + (c.own ? "own" : "miss") + '" data-k="' + k + '"><img src="' + img(c.n) + '" alt="" loading="eager" decoding="async" />' +
        (c.dup ? '<span class="dup">×' + c.dup + "</span>" : "") + (c.own ? "" : '<span class="tag">' + c.price + " im Marktplatz</span>") + "</div>";
    }).join("");
    pageLbl.textContent = "Seite " + (i + 1);
  }
  function setProgress() {
    count.textContent = owned + " / 165 Karten";
    prog.style.width = Math.round((owned / 165) * 100) + "%";
  }
  function at(ms, fn) { timers.push(setTimeout(function () { if (!stopped) fn(); }, ms)); }
  function point(el) {
    if (!el) return;
    var a = demo.getBoundingClientRect(), b = el.getBoundingClientRect();
    finger.style.left = (b.left - a.left + b.width / 2 - 13) + "px";
    finger.style.top = (b.top - a.top + b.height / 2 - 13) + "px";
    finger.style.opacity = "1";
  }
  function say(t) { cap.textContent = t; }
  function note(t) { toast.textContent = t; toast.classList.add("on"); at(1800, function () { toast.classList.remove("on"); }); }

  function cycle() {
    timers.forEach(clearTimeout); timers = [];
    owned = 96; setProgress();
    renderPage(0); grid.classList.remove("flip");
    btn.className = "listbtn"; btn.textContent = "⚡ 1-Klick inserieren"; finger.style.opacity = "0";
    say("Dein Set-Binder – farbig = deine Karten");
    at(1600, function () { say("Grau = fehlt dir · direkt mit dem Marktplatz abgeglichen"); point(grid.querySelector(".miss")); });
    at(3400, function () { finger.style.opacity = "0"; say("Umblättern …"); grid.classList.add("flip"); });
    at(4000, function () { renderPage(1); grid.classList.remove("flip"); owned = 103; setProgress(); say("Seite 2 – Doppelte erkannt (×2)"); });
    at(5400, function () { var d = grid.querySelector('[data-k="6"]'); if (d) d.classList.add("hl"); point(d); say("Doppelte Karte antippen – Marktpreis 4,90 €"); });
    at(7200, function () { point(btn); btn.textContent = "⚡ 1-Klick inserieren · 4,90 €"; });
    at(8000, function () { btn.classList.add("press"); });
    at(8250, function () {
      btn.classList.remove("press"); btn.classList.add("done"); btn.textContent = "✅ Inseriert in 2 Sekunden";
      var d = grid.querySelector('[data-k="6"]');
      if (d) { d.classList.remove("hl"); d.classList.add("sold"); var t = d.querySelector(".dup"); if (t) t.remove(); d.insertAdjacentHTML("beforeend", '<span class="tag">Im Marktplatz · 4,90 €</span>'); }
      note("📦 Inserat ist live – mit Käuferschutz & DHL-Label");
      say("Fertig! Doppelte verkaufen, Lücken schließen.");
    });
    at(9600, function () { finger.style.opacity = "0"; point(grid.querySelector(".miss")); say("Fehlende Karte? Mit 1 Tipp im Marktplatz kaufen 🛒"); });
    at(11800, function () { finger.style.opacity = "0"; say("PokeSwipe Radar – kostenlos testen"); });
    at(13600, cycle);
  }
  renderPage(0); setProgress();
  if (reduce) say("Set-Binder: farbig = deine Karten · grau = fehlt (mit Marktplatz-Preis) · ⚡ 1-Klick inserieren");
  else cycle();
  // Unsichtbar (anderer Tab) → Animation pausieren
  document.addEventListener("visibilitychange", function () {
    if (demo.style.display === "none" || reduce) return;
    if (document.hidden) { timers.forEach(clearTimeout); timers = []; } else if (!stopped) cycle();
  });
})();

(function () {
  "use strict";
  var form = document.getElementById("creator-form");
  if (!form) return;
  var nameIn = document.getElementById("f-name");
  var codeIn = document.getElementById("f-code");
  var msg = document.getElementById("f-msg");
  var submit = document.getElementById("f-submit");
  var touchedCode = false;

  function suggest(name) {
    var map = { "ä": "AE", "ö": "OE", "ü": "UE", "Ä": "AE", "Ö": "OE", "Ü": "UE", "ß": "SS" };
    var base = String(name || "").replace(/[äöüÄÖÜß]/g, function (c) { return map[c] || c; })
      .normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toUpperCase().replace(/^THE\s+/, "").replace(/[^A-Z0-9]+/g, "").slice(0, 22);
    return (base.length >= 2 ? base : "DEINNAME") + "30";
  }
  function clean(v) { return String(v || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9_-]/g, "").slice(0, 24); }
  function preview() {
    var code = clean(codeIn.value) || suggest(nameIn.value);
    document.getElementById("cc-code").textContent = code;
    document.getElementById("cc-code-2").textContent = code;
    document.getElementById("cc-name").textContent = (nameIn.value || "").trim() || "Dein Kanal";
  }
  nameIn.addEventListener("input", function () { if (!touchedCode) codeIn.placeholder = suggest(nameIn.value); preview(); });
  codeIn.addEventListener("input", function () { touchedCode = true; var c = clean(codeIn.value); if (c !== codeIn.value) codeIn.value = c; preview(); });

  function show(text, ok) { msg.textContent = text; msg.className = "msg " + (ok ? "ok" : "err"); }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var body = {
      channelName: String(fd.get("channelName") || "").trim(),
      platform: String(fd.get("platform") || ""),
      channelUrl: String(fd.get("channelUrl") || "").trim(),
      followers: Number(fd.get("followers") || 0),
      email: String(fd.get("email") || "").trim(),
      wishCode: clean(fd.get("wishCode")) || suggest(fd.get("channelName")),
      message: String(fd.get("message") || "").trim(),
      website: String(fd.get("website") || ""),
      consent: fd.get("consent") === "on",
    };
    if (body.channelName.length < 2) return show("Bitte gib deinen Kanalnamen an.", false);
    if (!/^https?:\/\//i.test(body.channelUrl) && body.channelUrl) body.channelUrl = "https://" + body.channelUrl;
    if (!body.channelUrl) return show("Bitte gib den Link zu deinem Kanal an.", false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) return show("Bitte gib eine gültige Kontakt-E-Mail an.", false);
    if (!body.consent) return show("Bitte stimme der Kontaktaufnahme per E-Mail zu.", false);
    submit.disabled = true; submit.textContent = "⏳ Wird gesendet …";
    fetch("/api/creator/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.error || "Senden fehlgeschlagen – bitte später erneut versuchen.");
        show("🎉 " + (res.d.message || "Danke! Wir melden uns.") + (res.d.code ? " Dein Code „" + res.d.code + "“ ist reserviert." : ""), true);
        form.querySelectorAll("input, select, textarea, button").forEach(function (el) { el.disabled = true; });
        submit.textContent = "✅ Bewerbung gesendet";
        if (res.d.code) { document.getElementById("cc-code").textContent = res.d.code; document.getElementById("cc-code-2").textContent = res.d.code; }
      })
      .catch(function (err) { show(err.message || String(err), false); submit.disabled = false; submit.textContent = "🎟️ Creator-Zugang & Code sichern"; });
  });
  preview();
})();
