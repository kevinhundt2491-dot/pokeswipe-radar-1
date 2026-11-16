// Promo-Reel-Seite (ausgelagert aus promo.html für die strikte Content-Security-Policy)
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const stage = $("stage");
  const DURATION = 43;

  // ---------- Echte Karten (TCGdex-IDs, deutsche Kartenbilder) ----------
  // Fallback-Preise = Cardmarket-Trend beim Erstellen; werden beim Laden live über /api/prices ersetzt.
  const CARDS = {
    "sv08-238": { name: "Pikachu-ex", set: "Stürmische Funken", no: "238/191", img: "https://assets.tcgdex.net/de/sv/sv08/238/high.webp", price: 199.3 },
    "sv08-247": { name: "Pikachu-ex", set: "Stürmische Funken", no: "247/191", img: "https://assets.tcgdex.net/de/sv/sv08/247/high.webp", price: 52.87 },
    "sv08-057": { name: "Pikachu-ex", set: "Stürmische Funken", no: "057/191", img: "https://assets.tcgdex.net/de/sv/sv08/057/high.webp", price: 4.14 },
    "sv03.5-199": { name: "Glurak-ex", set: "151", no: "199/165", img: "https://assets.tcgdex.net/de/sv/sv03.5/199/high.webp", price: 343.78 },
    "sv03.5-200": { name: "Turtok-ex", set: "151", no: "200/165", img: "https://assets.tcgdex.net/de/sv/sv03.5/200/high.webp", price: 104.07 },
    "sv03.5-205": { name: "Mew-ex", set: "151", no: "205/165", img: "https://assets.tcgdex.net/de/sv/sv03.5/205/high.webp", price: 26.11 },
  };
  const SET_GRID = ["001","002","003","004","005","006","007","008","009","025","026","150"].map((n) => ({ id: `sv03.5-${n}`, no: n, img: `https://assets.tcgdex.net/de/sv/sv03.5/${n}/high.webp` }));

  const local = location.hostname === "localhost" && location.port !== "8889";
  const cdn = (url, w) => (local ? url : `/.netlify/images?url=${encodeURIComponent(url)}&w=${w}`);
  const eur = (v) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const imgEl = (url, w) => { const i = new Image(); i.decoding = "async"; i.src = cdn(url, w); i.onerror = () => { i.onerror = null; i.src = "/card-fallback.svg"; }; return i; };

  function hydrateImages() {
    document.querySelectorAll("img[data-card]").forEach((i) => {
      const c = CARDS[i.dataset.card]; if (!c) return;
      i.src = cdn(c.img, 400); i.onerror = () => { i.onerror = null; i.src = "/card-fallback.svg"; };
    });
    // Swipe-Deck
    const deck = $("deck");
    ["sv03.5-199", "sv03.5-200", "sv08-247", "sv08-238"].forEach((id, k) => {
      const c = CARDS[id];
      const el = document.createElement("div");
      el.className = "scard"; el.dataset.id = id;
      el.style.transform = `translateY(${(3 - k) * 14}px) scale(${1 - (3 - k) * 0.03})`;
      el.append(imgEl(c.img, 600));
      el.insertAdjacentHTML("beforeend", `<div class="holo"></div><div class="stamp like">WILL ICH</div><div class="stamp nope">NOPE</div><div class="pricepill"><span>${c.name} · ${c.set}</span><b data-price="${id}">${eur(c.price)}</b></div>`);
      deck.append(el);
    });
    // Set-Grid
    const grid = $("grid");
    SET_GRID.forEach((s) => {
      const cell = document.createElement("div");
      cell.className = "cell"; cell.append(imgEl(s.img, 160));
      cell.insertAdjacentHTML("beforeend", `<div class="no">#${s.no}</div>`);
      grid.append(cell);
    });
    // Flips
    const flips = [
      { id: "sv03.5-199", ask: 0.78 }, { id: "sv08-238", ask: 0.84 }, { id: "sv03.5-205", ask: 0.8 }, { id: "sv08-247", ask: 0.87 },
    ];
    $("flips").innerHTML = "";
    flips.forEach((f, k) => {
      const c = CARDS[f.id];
      const row = document.createElement("div");
      row.className = "flip" + (k === 0 ? " hot" : ""); row.dataset.ask = f.ask; row.dataset.id = f.id;
      row.append(imgEl(c.img, 160));
      row.insertAdjacentHTML("beforeend", `<div><div class="nm">${c.name}</div><div class="mt">${c.set} · ${c.no}</div><div class="mt">Angebot <b style="color:#f3efe4" data-ask="${f.id}">${eur(c.price * f.ask)}</b> · Trend <span data-price="${f.id}">${eur(c.price)}</span></div></div><div class="sp"><b data-gain="${f.id}">+${eur(c.price * (1 - f.ask))}</b><span>Spanne ${Math.round((1 - f.ask) * 100)} %</span></div>`);
      $("flips").append(row);
    });
    // Portfolio-Karten
    ["sv03.5-199", "sv08-238", "sv03.5-200"].forEach((id) => {
      const i = imgEl(CARDS[id].img, 260); i.style.cssText = "width:100%;border-radius:12px"; $("pf-cards").append(i);
    });
  }

  // ---------- Live-Preise aus der eigenen API ----------
  async function loadPrices() {
    try {
      const res = await fetch(`/api/prices?ids=${Object.keys(CARDS).join(",")}`);
      if (!res.ok) return;
      const { prices } = await res.json();
      for (const [id, p] of Object.entries(prices || {})) if (CARDS[id] && p && p.trend > 0) CARDS[id].price = p.trend;
      renderPrices();
    } catch { /* Fallback-Preise bleiben stehen */ }
  }
  function renderPrices() {
    document.querySelectorAll("[data-price]").forEach((e) => (e.textContent = eur(CARDS[e.dataset.price].price)));
    document.querySelectorAll(".flip").forEach((r) => {
      const c = CARDS[r.dataset.id], a = Number(r.dataset.ask);
      r.querySelector("[data-ask]").textContent = eur(c.price * a);
      r.querySelector("[data-gain]").textContent = "+" + eur(c.price * (1 - a));
    });
    $("miss-price").textContent = eur(CARDS["sv03.5-200"].price);
    $("dup-price").textContent = eur(CARDS["sv08-057"].price);
    $("dup-val").textContent = "Verkaufswert: " + eur(CARDS["sv08-057"].price * 4);
  }

  // ---------- Skalierung der 1080x1920-Bühne ----------
  function fit() {
    const rec = document.body.classList.contains("rec");
    const h = window.innerHeight - (rec ? 0 : 80), w = window.innerWidth;
    const s = Math.min(w / 1080, h / 1920);
    stage.style.transform = `scale(${s})`;
    stage.style.margin = `${(1920 * s - 1920) / 2}px ${(1080 * s - 1080) / 2}px`;
    document.body.style.paddingBottom = rec ? "0" : "80px";
  }
  window.addEventListener("resize", fit);

  // ---------- Hilfen für die Timeline ----------
  const caps = [...document.querySelectorAll(".cap")];
  const views = ["v-swipe", "v-set", "v-dup", "v-flip", "v-pf"];
  const cap = (id) => caps.forEach((c) => { if (c.id === id) { c.classList.remove("out"); c.classList.add("on"); } else if (c.classList.contains("on")) { c.classList.remove("on"); c.classList.add("out"); } });
  const capOff = () => caps.forEach((c) => { if (c.classList.contains("on")) { c.classList.remove("on"); c.classList.add("out"); } });
  const sub = (t) => { const s = $("sub"); if (!t) return s.classList.remove("on"); s.textContent = t; s.classList.add("on"); };
  const view = (id, tab, label) => {
    views.forEach((v) => { const e = $(v); if (v === id) { e.classList.remove("left"); e.classList.add("on"); } else if (e.classList.contains("on")) { e.classList.remove("on"); e.classList.add("left"); } });
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
    if (label) $("dexsub").textContent = label;
  };
  const cut = () => { const f = $("flashcut"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); sfx("whoosh"); };
  function tapAt(el, dx = 0.5, dy = 0.5) {
    const f = $("finger"), r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect(), s = sr.width / 1080;
    f.style.left = (r.left - sr.left + r.width * dx) / s + "px";
    f.style.top = (r.top - sr.top + r.height * dy) / s + "px";
    f.classList.add("on");
    setTimeout(() => { f.classList.remove("tap"); void f.offsetWidth; f.classList.add("tap"); sfx("tap"); }, 450);
  }
  const fingerOff = () => $("finger").classList.remove("on");
  const flash = (id) => { const e = $(id); e.classList.remove("flash"); void e.offsetWidth; e.classList.add("flash"); };
  function countTo(el, from, to, ms, fmt) {
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms), v = from + (to - from) * (1 - Math.pow(1 - k, 3)); el.textContent = fmt(v); if (k < 1 && running) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function swipe(dir) {
    const cards = [...document.querySelectorAll(".scard:not(.gone-r):not(.gone-l)")];
    const top = cards[cards.length - 1]; if (!top) return;
    top.classList.add(dir === "r" ? "show-like" : "show-nope");
    sfx("whoosh");
    setTimeout(() => top.classList.add(dir === "r" ? "gone-r" : "gone-l"), 260);
    cards.slice(0, -1).forEach((c, k, arr) => { const d = arr.length - 1 - k; c.style.transform = `translateY(${d * 14}px) scale(${1 - d * 0.03})`; });
  }
  let haveCount = 0;
  function setProgress(have) {
    haveCount = have;
    const p = have / 207;
    $("have").textContent = have; $("miss").textContent = 207 - have; $("pct").textContent = Math.round(p * 100);
    $("setbar").style.width = p * 100 + "%"; $("ringarc").style.strokeDashoffset = 263.9 * (1 - p);
  }
  function addCell(k) {
    const cell = $("grid").children[k]; if (!cell) return;
    cell.classList.add("have", "pop"); setProgress(haveCount + 1); sfx("ding");
    const t = $("addtoast"); t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 500);
  }

  // ---------- Timeline (Sekunden) ----------
  const VO = [
    [0.2, "Schluss mit unübersichtlichen Tabellen und verpassten Deals auf dem Pokémon-Cardmarket!"],
    [5.2, "Mit PokeSwipe Radar hast du deine Sammlung perfekt im Griff. Der Master-Set-Tracker erkennt sofort, welche Karten dir noch fehlen, zeigt dir reale Marktpreise und schickt dich mit einem Klick direkt zu den besten Angeboten auf Cardmarket und eBay."],
    [20.2, "Du hast Karten doppelt? Verkaufe deinen Überschuss direkt in der Community oder exportiere sie für Cardmarket. Finde die krassesten Flips vor allen anderen und verfolge deine Portfolio-Gewinne live."],
    [35.2, "Spare Zeit, finde die besten Deals und vervollständige dein Binder schneller als je zuvor. Geh jetzt auf pokeswipe-radar.de und leg direkt los – völlig kostenlos!"],
  ];
  const TL = [
    // Szene 1 – Hook
    [0.0, () => { view("v-swipe", "swipe", "ARENA · SWIPE"); cap("c1a"); }],
    [0.9, () => swipe("l")],
    [1.7, () => swipe("r")],
    [2.5, () => { cap("c1b"); swipe("l"); }],
    [3.1, () => { $("alert").classList.add("on"); $("alert-line").classList.add("go"); sfx("alert"); }],
    [4.2, () => tapAt($("alert"))],
    // Szene 2 – Master-Set-Tracker
    [5.0, () => { cut(); fingerOff(); view("v-set", "portfolio", "SAMMLUNG · MASTER-SET"); cap("c2a"); setProgress(0); countTo($("have"), 0, 136, 900, (v) => Math.round(v)); setTimeout(() => setProgress(136), 900); }],
    [6.3, () => { cap("c2b"); [0, 1, 3, 9].forEach((k, j) => setTimeout(() => addCell(k), j * 280)); }],
    [7.8, () => [4, 2, 10, 11].forEach((k, j) => setTimeout(() => addCell(k), j * 280))],
    [9.4, () => $("missing").classList.add("on")],
    [10.4, () => { cap("c2c"); tapAt($("b-cm")); setTimeout(() => flash("b-cm"), 450); }],
    [11.9, () => { tapAt($("b-eb")); setTimeout(() => flash("b-eb"), 450); sub("eBay-Bestpreis* mit Partner-ID · Cardmarket-Deep-Link"); }],
    // Szene 2b – Duplikat-Radar
    [13.8, () => { cut(); fingerOff(); sub(""); view("v-dup", "portfolio", "SAMMLUNG · DUPLIKAT-RADAR"); cap("c2d"); }],
    [15.2, () => { $("badge").classList.add("on"); sfx("alert"); }],
    [17.0, () => sub("Reale Cardmarket-Preise für jede Karte")],
    // Szene 3 – Verkaufen, Flips, Portfolio
    [20.0, () => { cap("c3c"); sub(""); tapAt($("b-p2p")); setTimeout(() => flash("b-p2p"), 450); }],
    [21.2, () => { $("toast-p2p").classList.add("on"); sfx("ding"); }],
    [22.4, () => { tapAt($("b-csv")); setTimeout(() => { flash("b-csv"); $("toast-p2p").textContent = "✓ CSV für Cardmarket exportiert"; }, 450); }],
    [24.0, () => { cut(); fingerOff(); view("v-flip", "flip", "PREISE · FLIP-RADAR"); cap("c3a"); document.querySelectorAll(".flip").forEach((f, k) => setTimeout(() => { f.classList.add("on"); sfx("tick"); }, 250 + k * 260)); }],
    [26.4, () => cap("c3b")],
    [27.6, () => { tapAt($("b-eb2")); setTimeout(() => flash("b-eb2"), 450); }],
    [29.6, () => {
      cut(); fingerOff(); view("v-pf", "portfolio", "SAMMLUNG · PORTFOLIO"); cap("c3d");
      const total = CARDS["sv03.5-199"].price + CARDS["sv08-238"].price + CARDS["sv03.5-200"].price + CARDS["sv03.5-205"].price + CARDS["sv08-247"].price * 2 + CARDS["sv08-057"].price * 5;
      const fmt0 = (v) => Math.round(v).toLocaleString("de-DE");
      $("pf-line").classList.add("go"); $("pf-area").style.opacity = 1;
      countTo($("pfv"), total * 0.72, total, 2400, fmt0);
      countTo($("pfg"), 0, total * 0.28, 2400, (v) => `▲ +${fmt0(v)} € (${Math.round((v / (total * 0.72)) * 100)} %)`);
    }],
    // Szene 4 – CTA
    [35.0, () => { cut(); capOff(); sub(""); $("phone").style.transform = "translateY(1500px) scale(.8)"; $("cta").classList.add("on"); $("note").style.opacity = 0; }],
    [DURATION, () => stop(true)],
  ];

  // ---------- Audio: synthetischer Tech-Beat (124 BPM) + SFX ----------
  let ac = null, master = null, beatTimer = null, nextBeat = 0, beatStep = 0;
  function ensureAudio() {
    if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination); }
    if (ac.state === "suspended") ac.resume();
  }
  function env(node, t, a, d, peak) { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function noise(len) { const b = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = ac.createBufferSource(); s.buffer = b; return s; }
  function kick(t) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18); env(g, t, 0.003, 0.32, 1); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4); }
  function hat(t, v = 0.18) { const n = noise(0.06), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = "highpass"; f.frequency.value = 8000; env(g, t, 0.001, 0.045, v); n.connect(f).connect(g).connect(master); n.start(t); }
  function snare(t) { const n = noise(0.2), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = "bandpass"; f.frequency.value = 1800; env(g, t, 0.002, 0.16, 0.5); n.connect(f).connect(g).connect(master); n.start(t); }
  function bass(t, freq) { const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(); o.type = "sawtooth"; o.frequency.value = freq; f.type = "lowpass"; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(160, t + 0.2); env(g, t, 0.005, 0.2, 0.32); o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.3); }
  function pluck(t, freq) { const o = ac.createOscillator(), g = ac.createGain(); o.type = "triangle"; o.frequency.value = freq; env(g, t, 0.004, 0.3, 0.12); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4); }
  const BASS = [55, 55, 65.4, 49];           // A1, A1, C2, G1 – pro Takt
  const ARP = [440, 523.3, 659.3, 784, 659.3, 523.3, 440, 392];
  function scheduleBeat() {
    const sixteenth = 60 / 124 / 4;
    while (nextBeat < ac.currentTime + 0.12) {
      const s = beatStep % 16, bar = Math.floor(beatStep / 16) % 4, t = nextBeat, intro = beatStep < 16;
      if (s % 4 === 0) kick(t);
      if (s === 4 || s === 12) snare(t);
      if (s % 2 === 1) hat(t, 0.14); else if (!intro) hat(t, 0.07);
      if (!intro && (s % 4 === 2 || s === 15)) bass(t, BASS[bar]);
      if (!intro && s % 2 === 0) pluck(t, ARP[(s / 2 + bar) % 8] * (bar === 3 ? 0.89 : 1));
      nextBeat += sixteenth; beatStep++;
    }
  }
  function startBeat() { if (!$("opt-beat").checked) return; ensureAudio(); nextBeat = ac.currentTime + 0.05; beatStep = 0; beatTimer = setInterval(scheduleBeat, 25); }
  function stopBeat() { clearInterval(beatTimer); beatTimer = null; }
  function sfx(kind) {
    if (!ac || !beatTimer) return; const t = ac.currentTime;
    if (kind === "tap") { pluck(t, 1318); }
    if (kind === "tick") { pluck(t, 1046); }
    if (kind === "ding") { pluck(t, 1568); pluck(t + 0.06, 2093); }
    if (kind === "alert") { [880, 1174, 1568].forEach((f, k) => pluck(t + k * 0.07, f)); }
    if (kind === "whoosh") { const n = noise(0.35), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = "bandpass"; f.Q.value = 0.8; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.3); env(g, t, 0.05, 0.25, 0.25); n.connect(f).connect(g).connect(master); n.start(t); }
  }

  // ---------- Sprecher (Browser-Sprachausgabe, de-DE) ----------
  function speak(text) {
    if (!$("opt-voice").checked || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("de"));
    u.voice = voices.find((v) => /google|neural|natural|premium/i.test(v.name)) || voices[0] || null;
    u.lang = "de-DE"; u.rate = 1.22; u.pitch = 1.05;
    speechSynthesis.speak(u);
  }

  // ---------- Wiedergabe ----------
  let running = false, t0 = 0, idx = 0, voIdx = 0, raf = 0;
  function reset() {
    document.querySelectorAll(".on, .left, .out, .go, .flash, .gone-r, .gone-l, .show-like, .show-nope, .have, .pop").forEach((e) => {
      if (e.id === "controls") return;
      e.classList.remove("on", "left", "out", "go", "flash", "gone-r", "gone-l", "show-like", "show-nope", "have", "pop");
    });
    document.querySelectorAll(".scard").forEach((c, k, a) => { const d = a.length - 1 - k; c.style.transform = `translateY(${d * 14}px) scale(${1 - d * 0.03})`; });
    $("phone").style.transform = ""; $("note").style.opacity = 1; $("pf-area").style.opacity = 0;
    $("toast-p2p").textContent = "✓ Angebot ist live in der Community";
    setProgress(0); $("pfv").textContent = "0";
    view("v-swipe", "swipe", "ARENA · SWIPE");
  }
  function play() {
    stop(false); reset(); running = true; idx = 0; voIdx = 0;
    startBeat(); t0 = performance.now();
    $("btn-play").textContent = "■ Stopp";
    loop();
  }
  function loop() {
    if (!running) return;
    const t = (performance.now() - t0) / 1000;
    while (idx < TL.length && TL[idx][0] <= t) TL[idx++][1]();
    while (voIdx < VO.length && VO[voIdx][0] <= t) speak(VO[voIdx++][1]);
    $("progress").style.width = Math.min(100, (t / DURATION) * 100) + "%";
    $("time").textContent = t.toFixed(1).replace(".", ",") + " s";
    raf = requestAnimationFrame(loop);
  }
  function stop(ended) {
    running = false; cancelAnimationFrame(raf); stopBeat();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    $("btn-play").textContent = ended ? "↻ Nochmal" : "▶ Abspielen";
    if (ended && document.body.classList.contains("rec") && params.has("loop")) setTimeout(play, 1500);
  }

  const params = new URLSearchParams(location.search);
  $("btn-play").onclick = () => (running ? stop(false) : play());
  $("btn-rec").onclick = () => {
    document.body.classList.add("rec"); fit();
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    setTimeout(play, 1200);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("rec")) { document.body.classList.remove("rec"); stop(false); fit(); }
    if (e.key === " ") { e.preventDefault(); running ? stop(false) : play(); }
  });
  if ("speechSynthesis" in window) speechSynthesis.getVoices();

  hydrateImages();
  loadPrices();
  if (params.has("rec")) document.body.classList.add("rec");
  fit();
  reset();
  // Erstes Standbild: Hook-Caption sichtbar, damit die Seite nicht leer wirkt
  cap("c1a");
  if (params.has("autoplay")) setTimeout(play, 800);
})();
