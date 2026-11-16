// i18n-Vorlauf (klassisches Skript im <head>, vor allen anderen): setzt <html lang> sofort und
// blendet die Seite bei englischer Oberfläche kurz aus, bis client/i18n.js die erste Übersetzung
// erledigt hat – so blitzt kein deutscher Text auf. Gleiche Regeln wie detectLang() in client/i18n-core.js.
(function () {
  var lang = "de";
  try {
    var q = (new URLSearchParams(location.search).get("lang") || "").toLowerCase();
    var s = "";
    try { s = (localStorage.getItem("ps_lang") || "").toLowerCase(); } catch (e) {}
    if (q === "de" || q === "en") lang = q;
    else if (s === "de" || s === "en") lang = s;
    else {
      var primary = String(navigator.language || "").toLowerCase();
      var all = [primary].concat(Array.prototype.slice.call(navigator.languages || [])).map(function (l) { return String(l).toLowerCase(); });
      var german = all.some(function (l) { var r = (l.split("-")[1] || "").toUpperCase(); return l === "de" || l.indexOf("de-") === 0 || ["DE", "AT", "CH", "LI", "LU"].indexOf(r) >= 0; });
      if (primary.indexOf("en") === 0 && !german) lang = "en";
    }
  } catch (e) {}
  var root = document.documentElement;
  root.lang = lang;
  if (lang === "en") {
    root.classList.add("ps-i18n-pending");
    // Sicherheitsnetz: falls das App-Bundle nicht lädt, Seite trotzdem zeigen
    setTimeout(function () { root.classList.remove("ps-i18n-pending"); }, 2500);
  }
})();
