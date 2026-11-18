/* PokeSwipe Radar – Creator-Landingpage (/creator): Live-Vorschau des Wunsch-Codes und Bewerbung an /api/creator/apply */
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
