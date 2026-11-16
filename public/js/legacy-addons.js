// PokeSwipe & Radar – Erweiterungen der Basis-Oberfläche (ausgelagert aus index.html, Phase 6)
// Klassisches Skript mit defer, läuft nach /js/legacy-app.js und vor /assets/app.js.
(function initPokeSwipeExpansionV2() {
  // =========================================================================
  // ZAHLUNGEN: Pro-Pass (4,99 €/Monat) und Pro Trader laufen über Stripe Checkout auf dem Server
  // (sichere Freischaltung erst nach bestätigter Zahlung, siehe server/app.ts → /api/billing/checkout).
  // =========================================================================

  const FREE_DAILY_SWIPE_LIMIT = 15;
  const FREE_PORTFOLIO_LIMIT = 15;
  const FREE_WISHLIST_LIMIT = 2;

  // Pro-Status NUR aus der Server-Antwort (/api/me, geprüftes Login) – nicht aus localStorage,
  // sonst ließe er sich per Browser-Konsole fälschen. Kostenpflichtige Daten prüft zusätzlich der Server.
  function isProUser() {
    try { return "psVerifiedPlan" in window && window.psVerifiedPlan !== "free"; } catch (e) { return false; }
  }
  window.isProUser = isProUser;

  function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getRemainingFreeSwipes() {
    if (isProUser()) return Infinity;
    const savedDate = localStorage.getItem("pokeswipe_swipe_date");
    const today = getTodayKey();
    if (savedDate !== today) {
      localStorage.setItem("pokeswipe_swipe_date", today);
      localStorage.setItem("pokeswipe_swipe_used", "0");
      return FREE_DAILY_SWIPE_LIMIT;
    }
    const used = parseInt(localStorage.getItem("pokeswipe_swipe_used") || "0", 10);
    return Math.max(0, FREE_DAILY_SWIPE_LIMIT - used);
  }

  function consumeFreeSwipe() {
    if (isProUser()) return true;
    const rem = getRemainingFreeSwipes();
    if (rem <= 0) {
      triggerSmartPush("🔒 Tageslimit erreicht (15/15 Swipes)", "Hol dir PRO (4,99 €/Mo) für unbegrenzte Swipes & Sniper-Deals!");
      openModal("pro-modal");
      return false;
    }
    const used = parseInt(localStorage.getItem("pokeswipe_swipe_used") || "0", 10) + 1;
    localStorage.setItem("pokeswipe_swipe_used", String(used));
    updateSwipeCounterBadge();
    return true;
  }

  function updateSwipeCounterBadge() {
    let badge = document.getElementById("v2-swipe-limit-badge");
    if (!badge) {
      const headerRight = document.querySelector("header .flex.items-center.gap-1\\.5.sm\\:gap-2");
      if (headerRight) {
        badge = document.createElement("div");
        badge.id = "v2-swipe-limit-badge";
        badge.className = "bg-slate-950/90 border border-rose-500/40 px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-1 cursor-pointer";
        badge.onclick = () => openModal("pro-modal");
        headerRight.prepend(badge);
      }
    }
    if (badge) {
      badge.innerHTML = isProUser()
        ? `<span>🔥 Swipes:</span><strong class="text-emerald-400 font-black">∞ PRO</strong>`
        : `<span>🔥 Frei-Swipes:</span><strong class="text-rose-400 font-black">${getRemainingFreeSwipes()}/${FREE_DAILY_SWIPE_LIMIT}</strong>`;
    }
  }

  // =========================================================================
  // POSITION 1: DEUTSCHE LIVE-KARTENDATENBANK (TCGDEX API) + RIP OR KEEP
  // =========================================================================
  function injectArenaUpgrades() {
    const viewSwipe = document.getElementById("view-swipe");
    if (!viewSwipe) return;

    const arenaAddon = document.createElement("div");
    arenaAddon.className = "grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mt-6";
    arenaAddon.innerHTML = `
      <!-- LIVE TCGDEX DEUTSCHE KARTEN-SUCHE -->
      <div class="lg:col-span-7 poke-glass rounded-3xl p-4 sm:p-5 space-y-3 border border-yellow-400/40">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-[10px] font-black uppercase bg-emerald-400 text-slate-950 px-2.5 py-0.5 rounded-full">🌐 Live TCGdex API (Deutsch)</span>
            <h3 class="text-base font-black text-white mt-1">Alle deutschen Pokémon-Karten live durchsuchen</h3>
          </div>
        </div>
        <div class="flex gap-2 text-xs">
          <input id="tcgdex-search-inp" type="text" placeholder="Kartenname oder Nummer (z. B. Glurak, Nachtara, Lugia, Pikachu)..." onkeydown="if(event.key==='Enter')window.searchTCGdexLive()" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white" />
          <button onclick="window.searchTCGdexLive()" class="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-black px-4 py-2 rounded-xl shrink-0">🔎 Live suchen</button>
        </div>
        <div id="tcgdex-results" class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pt-1 text-xs">
          <p class="text-slate-400 col-span-3 text-center py-3">Tippe oben einen beliebigen deutschen Pokémon-Namen ein, um echte Karten-Scans zu laden.</p>
        </div>
      </div>

      <!-- POSITION 7A: VIRALER "RIP OR KEEP" DISPLAY-SIMULATOR -->
      <div class="lg:col-span-5 poke-glass rounded-3xl p-4 sm:p-5 space-y-3.5 border border-purple-500/40">
        <div>
          <span class="text-[10px] font-black uppercase bg-purple-500 text-white px-2.5 py-0.5 rounded-full">🎲 Viraler TikTok-Check</span>
          <h3 class="text-base font-black text-white mt-1">„Rip or Keep“ – Display öffnen oder OVP lassen?</h3>
        </div>
        <select id="ripkeep-select" onchange="window.calcRipOrKeep()" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold">
          <option value="sv08">⚡ Stürmische Funken – Display (36 Booster)</option>
          <option value="sv03.5">🔥 151 – Booster-Bundle / Display</option>
          <option value="sv08.5">💎 Prismatische Entwicklungen – Top-Trainer-Box</option>
          <option value="me01">🌀 Mega-Entwicklung – Display (36 Booster)</option>
          <option value="swsh12.5gg">👑 Zenit der Könige – Top-Trainer-Box</option>
          <option value="sv03">🌋 Obsidianflammen – Display (36 Booster)</option>
          <option value="swsh7">🌙 Drachenwandel – Display (36 Booster)</option>
        </select>
        <div class="flex items-center gap-2 text-xs"><span class="text-slate-300 shrink-0">Dein OVP-Preis (€):</span>
          <input id="ripkeep-price" type="number" min="0" step="0.01" placeholder="Preis vom Händler / eBay" oninput="window.calcRipOrKeep()" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-white" /></div>
        <div id="ripkeep-box" class="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2 text-xs"></div>
      </div>
    `;
    viewSwipe.appendChild(arenaAddon);
    window.calcRipOrKeep();
  }

  window.searchTCGdexLive = async function() {
    const q = (document.getElementById("tcgdex-search-inp")?.value || "").trim();
    const box = document.getElementById("tcgdex-results");
    if (!q) return alert("Bitte einen Kartennamen eingeben (z. B. Glurak).");
    box.innerHTML = `<p class="text-yellow-400 col-span-3 text-center py-4 font-bold">⏳ Suche im Kartenkatalog …</p>`;
    try {
      // Zentrale Katalogsuche (client/search.js → /api/search); Felder auf das bisherige Format abbilden
      if (typeof window.psSearchCatalog !== "function") throw new Error("Suche noch nicht bereit");
      const data = await window.psSearchCatalog(q, { lang: "de", limit: 18, channel: "legacy" });
      const withImg = data.items.filter(c => c.image).map(c => ({ id: c.cardId || c.id, name: c.name, localId: c.number, image: String(c.image).replace(/\/(high|low)\.webp$/, "") }));
      if (!withImg.length) {
        box.innerHTML = `<p class="text-slate-400 col-span-3 text-center py-4">Keine Karte mit Bild gefunden. Versuche z. B. „Pikachu“, „Glurak“ oder „Mew“.</p>`;
        return;
      }
      window._tcgResults = withImg;
      box.innerHTML = withImg.map((c, i) => {
        const imgUrl = /^https:\/\/assets\.tcgdex\.net\//.test(String(c.image)) ? `${c.image}/high.webp` : FALLBACK_CARD_IMG;
        const safeName = sanitizeHTML(`${c.name} (${c.localId || ""})`);
        return `
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-2 flex flex-col justify-between gap-2 text-center">
            <img src="${sanitizeHTML(imgUrl)}" loading="lazy" class="h-32 mx-auto object-contain rounded" />
            <div>
              <p class="font-bold text-white truncate text-[11px]">${safeName}</p>
            </div>
            <div class="grid grid-cols-2 gap-1">
              <button onclick="window.addApiCardToPortfolioIdx(${i})" class="bg-emerald-500 text-slate-950 font-black py-1 rounded text-[10px]">+ Portfolio</button>
              <a href="${buildEbayUrl(c.name + ' ' + (c.localId || ''), 'bin', 'suche')}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold py-1 rounded text-[10px]">🛒 eBay* ↗</a>
            </div>
          </div>
        `;
      }).join("");
    } catch (e) {
      box.innerHTML = `<p class="text-rose-400 col-span-3 text-center py-4">API aktuell nicht erreichbar.</p>`;
    }
  };

  window.addApiCardToPortfolioIdx = function(i) {
    const c = (window._tcgResults || [])[Number(i)];
    if (!c) return;
    if (window.PS && typeof window.PS.openCard === "function" && localStorage.getItem("gotrue.user")) return window.PS.openCard(c.id);
    window.addApiCardToPortfolio(`${c.name} (${c.localId || ""})`, `${c.image}/high.webp`);
  };
  window.addApiCardToPortfolio = function(cardTitle, imgUrl) {
    if (!isProUser() && portfolio.length >= FREE_PORTFOLIO_LIMIT) {
      triggerSmartPush("🔒 Portfolio-Limit (15 Karten)", "Schalte PRO frei für unbegrenzte Portfolio-Karten!");
      openModal("pro-modal");
      return;
    }
    const estVal = parseFloat(String(prompt(`Marktwert in € für "${cardTitle}" (siehe Cardmarket):`, "") || "").replace(",", "."));
    if (isNaN(estVal) || estVal < 0) return;
    portfolio.unshift({ name: cardTitle, value: estVal, img: imgUrl });
    localStorage.setItem("pokeswipe_portfolio_clean", JSON.stringify(portfolio));
    renderPortfolio();
    triggerSmartPush("✅ Live-Karte gespeichert!", `${cardTitle} (${fmtEur(estVal)}) liegt jetzt im Portfolio.`);
  };

  window.calcRipOrKeep = function() {
    const sel = document.getElementById("ripkeep-select")?.value || "sv08";
    const box = document.getElementById("ripkeep-box");
    if (!box) return;
    const set = REAL_SETS[sel] || REAL_SETS.sv08;
    const hits = REAL_CARDS.filter((c) => setKeyOf(c) === sel).sort((a, b) => b.trend - a.trend).slice(0, 4);
    const price = parseFloat(document.getElementById("ripkeep-price")?.value || "0");
    const top = hits[0];
    let verdict = `<p class="text-slate-300">Trag den OVP-Preis ein, den du zahlen würdest – wir vergleichen ihn mit den echten Chase-Preisen.</p>`;
    if (price > 0 && top) {
      const share = Math.round((top.trend / price) * 100);
      verdict = share >= 100
        ? `<p class="text-emerald-300 font-bold">Der Top-Hit allein (${fmtEur(top.trend)}) ist mehr wert als die OVP (${share} %). Aber: Die Chance auf genau diese Karte ist gering – ein geöffnetes Display bringt im Schnitt meist weniger als den OVP-Preis. Wer auf Wert spielt, kauft die Wunschkarte einzeln.</p>`
        : `<p class="text-yellow-300 font-bold">Selbst der Top-Hit (${fmtEur(top.trend)}) deckt nur ${share} % des OVP-Preises. Rein finanziell: eher <strong>KEEP SEALED</strong> oder die Karte direkt einzeln kaufen.</p>`;
    }
    box.innerHTML = `
      <p class="text-[10px] text-slate-400 uppercase font-bold">Echte Chase-Karten (Cardmarket-Trend, Stand ${livePriceDate})</p>
      <div class="space-y-1">${hits.map((c) => `<div class="flex justify-between gap-2"><span class="truncate text-white">${sanitizeHTML(cardLabel(c))}</span><a href="${buildEbayUrl(c.query, "bin", "ripkeep")}" target="_blank" rel="noopener sponsored" class="text-emerald-400 font-black shrink-0">${fmtEur(c.trend)} 🛒</a></div>`).join("")}</div>
      ${verdict}
      <a href="${buildEbayUrl(set.sealedQuery, 'bin', 'ripkeep-ovp')}" target="_blank" rel="noopener sponsored" class="block text-center bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black py-2 rounded-xl mt-1">📦 Aktuelle OVP-Preise auf eBay prüfen*</a>
    `;
  };

  // =========================================================================
  // POSITION 3: PRO-EXKLUSIVE SNIPER-DEALS (>25% UNTER TREND VERSCHWOMMEN)
  // =========================================================================
  const origFilterFlipDeals = window.filterFlipDeals;
  window.filterFlipDeals = function(cat = "all") {
    const items = cat === "all" ? flipDeals : flipDeals.filter(d => d.category === cat);
    const proActive = isProUser();
    const listEl = document.getElementById("flip-list");
    if (!listEl) return origFilterFlipDeals && origFilterFlipDeals(cat);

    if (!items.length) { listEl.innerHTML = `<div class="poke-glass rounded-2xl p-6 text-center text-xs text-slate-400">Gerade keine Angebote unter Marktwert – der Radar aktualisiert sich automatisch.</div>`; return; }
    listEl.innerHTML = items.map(d => {
      const known = d.cmPrice > 0;
      const diff = known ? Math.max(0, d.cmPrice - d.ebayPrice) : 0;
      const pct = known ? Math.round((diff / d.cmPrice) * 100) : 0;
      const isSniperDeal = pct >= 25;
      const lockedForFree = isSniperDeal && !proActive;

      return `
        <div class="poke-glass rounded-2xl p-4 flex flex-col justify-between gap-3 relative overflow-hidden ${isSniperDeal ? 'border-2 border-yellow-400/70' : ''}">
          <div class="flex justify-between items-start gap-2">
            <div>
              <span class="text-[11px] font-black ${isSniperDeal ? 'bg-yellow-400 text-slate-950' : 'bg-emerald-500/20 text-emerald-300'} px-2.5 py-0.5 rounded-full">
                ${known ? `${isSniperDeal ? '👑 PRO SNIPER-DEAL: ' : '🔥 '}-${pct}% unter CM-Trend (${fmtEur(diff)} Ersparnis)` : '📣 Community-Meldung (Marktwert unbekannt)'}
              </span>
              <h3 class="font-bold text-white text-sm mt-2 ${lockedForFree ? 'sniper-blur' : ''}">${lockedForFree ? "Pokémon-Karte (Pro-Deal)" : sanitizeHTML(d.name)}</h3>
            </div>
            <span class="text-xs text-slate-400 shrink-0">${known ? `Trend: <del>${fmtEur(d.cmPrice)}</del>` : ""}</span>
          </div>

          <div class="flex items-center justify-between pt-3 border-t border-slate-800 ${lockedForFree ? 'sniper-blur' : ''}">
            <div><p class="text-lg font-black text-emerald-400">${lockedForFree ? "?? €" : fmtEur(d.ebayPrice)}</p><p class="text-[10px] text-slate-500">${lockedForFree ? "" : sanitizeHTML(d.source || "")}</p></div>
            ${lockedForFree ? `<div class="flex gap-1.5"><span class="bg-slate-800 text-slate-500 text-xs font-bold px-3 py-1.5 rounded-xl">🔒 Links mit Pro</span></div>` : `<div class="flex gap-1.5">
              <a href="${buildCardmarketUrl(d.query)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl">Cardmarket</a>
              <a href="${buildEbayUrl(d.query, 'auction', 'flip')}" target="_blank" rel="noopener sponsored" class="bg-amber-400 text-slate-950 text-xs font-bold px-2.5 py-1.5 rounded-xl">Auktion*</a>
              <a href="${buildEbayUrl(d.query, 'bin', 'flip')}" target="_blank" rel="noopener sponsored" class="bg-emerald-500 text-slate-950 text-xs font-black px-3 py-1.5 rounded-xl">🛒 eBay-Deal*</a>
            </div>`}
          </div>

          ${lockedForFree ? `
            <div class="absolute inset-0 bg-slate-950/75 backdrop-blur-[3px] flex flex-col items-center justify-center p-4 text-center z-10">
              <p class="text-xs font-black text-yellow-400 uppercase">🔒 PRO Sniper-Deal (-${pct}% unter Trend)</p>
              <p class="text-[11px] text-slate-200 mt-1">Angebote mehr als 25 % unter Marktwert sind exklusiv für Pro-Pass-Mitglieder sichtbar.</p>
              <button onclick="openModal('pro-modal')" class="mt-2.5 bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black text-xs px-4 py-2 rounded-xl shadow-lg">
                👑 Pro-Pass (4,99 €/Monat) – jetzt aufdecken
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join("");
  };

  // =========================================================================
  // POSITION 4 & 8: 1:1 TRADE-ANALYZER (ZUSTAND/SPRACHE) + UVP RESTOCK-MELDER
  // =========================================================================
  function injectMapAndTradeUpgrades() {
    const viewMap = document.getElementById("view-map");
    if (!viewMap) return;

    // 1:1 Trade Analyzer einfügen
    const tradeBox = document.createElement("div");
    tradeBox.className = "poke-glass rounded-3xl p-5 space-y-4 border-2 border-emerald-400/50";
    tradeBox.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span class="text-[10px] font-black uppercase bg-emerald-400 text-slate-950 px-2.5 py-0.5 rounded-full">⚖️ 1:1 Fair-Trade-Analyzer</span>
          <h3 class="text-base sm:text-lg font-black text-white mt-1">Tausch-Rechner inkl. Zustand (NM/EX/PL) & Sprache (DE/EN/JP)</h3>
        </div>
        <div id="trade-verdict-badge" class="bg-slate-900 border border-slate-700 px-3.5 py-1.5 rounded-xl text-xs font-black text-emerald-400">
          ⚖️ Differenz: 0,00 € (Fairer 1:1 Tausch)
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <!-- Seite A: Ich gebe -->
        <div class="bg-slate-950/90 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
          <div class="flex justify-between items-center">
            <strong class="text-yellow-400 uppercase">📤 Ich gebe ab:</strong>
            <strong id="trade-sum-a" class="text-sm font-black text-white">0,00 €</strong>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-1.5">
            <input id="tr-a-name" type="text" placeholder="Karte..." class="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white" />
            <input id="tr-a-val" type="number" placeholder="Basis €" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
            <select id="tr-a-cond" class="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-white">
              <option value="1.0">NM (100%)</option>
              <option value="1.15">Mint (115%)</option>
              <option value="0.8">EX (80%)</option>
              <option value="0.6">PL (60%)</option>
            </select>
          </div>
          <div class="flex justify-between items-center gap-2">
            <select id="tr-a-lang" class="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white">
              <option value="1.0">🇩🇪 Deutsch (100%)</option>
              <option value="0.92">🇬🇧 Englisch (92%)</option>
              <option value="0.75">🇯🇵 Japanisch (75%)</option>
            </select>
            <button onclick="window.addTradeSideItem('A')" class="bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-lg">+ Hinzufügen</button>
          </div>
          <div id="trade-list-a" class="space-y-1 pt-1"></div>
        </div>

        <!-- Seite B: Du gibst -->
        <div class="bg-slate-950/90 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
          <div class="flex justify-between items-center">
            <strong class="text-emerald-400 uppercase">📥 Tauschpartner gibt:</strong>
            <strong id="trade-sum-b" class="text-sm font-black text-white">0,00 €</strong>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-1.5">
            <input id="tr-b-name" type="text" placeholder="Karte..." class="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white" />
            <input id="tr-b-val" type="number" placeholder="Basis €" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
            <select id="tr-b-cond" class="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-white">
              <option value="1.0">NM (100%)</option>
              <option value="1.15">Mint (115%)</option>
              <option value="0.8">EX (80%)</option>
              <option value="0.6">PL (60%)</option>
            </select>
          </div>
          <div class="flex justify-between items-center gap-2">
            <select id="tr-b-lang" class="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white">
              <option value="1.0">🇩🇪 Deutsch (100%)</option>
              <option value="0.92">🇬🇧 Englisch (92%)</option>
              <option value="0.75">🇯🇵 Japanisch (75%)</option>
            </select>
            <button onclick="window.addTradeSideItem('B')" class="bg-emerald-500 text-slate-950 font-black px-3 py-1.5 rounded-lg">+ Hinzufügen</button>
          </div>
          <div id="trade-list-b" class="space-y-1 pt-1"></div>
        </div>
      </div>
    `;
    viewMap.prepend(tradeBox);

    // Position 8: UVP Restock-Button bei der Radar-Eingabe ergänzen
    const radarBtn = document.querySelector("button[onclick='registerMyRadarPin()']");
    if (radarBtn && radarBtn.parentElement) {
      const restockBtn = document.createElement("button");
      restockBtn.className = "bg-amber-400 hover:bg-amber-300 text-slate-950 font-black py-2 px-3 rounded-xl text-xs sm:col-span-4";
      restockBtn.textContent = "🛒 UVP-Restock / Karten-Automat auf der Karte melden (z. B. Smyths, Müller, Kiosk)";
      restockBtn.onclick = function() {
        const store = (prompt("Welcher Laden / Automat hat gerade UVP-Ware? (z. B. Müller, Smyths Toys, Kiosk):", "") || "").trim().slice(0, 40);
        const city = (prompt("In welcher Stadt / PLZ?", "") || "").trim().slice(0, 60);
        const setInfo = (prompt("Welches Set ist zur UVP vorrätig?", "") || "").trim().slice(0, 80);
        if (!store || !city) return;
        document.getElementById("radar-my-name").value = "🛒 UVP-RESTOCK: " + store;
        document.getElementById("radar-my-city").value = city;
        document.getElementById("radar-my-cards").value = "🔥 VORRÄTIG: " + (setInfo || "Displays & TTBs zur UVP");
        registerMyRadarPin();
      };
      radarBtn.parentElement.appendChild(restockBtn);
    }
  }

  let tradeSideA = [];
  let tradeSideB = [];

  window.addTradeSideItem = function(side) {
    const prefix = side === "A" ? "tr-a" : "tr-b";
    const name = (document.getElementById(`${prefix}-name`)?.value || "").trim() || "Pokémon Karte";
    const baseVal = parseFloat(document.getElementById(`${prefix}-val`)?.value || "0");
    const condMult = parseFloat(document.getElementById(`${prefix}-cond`)?.value || "1");
    const langMult = parseFloat(document.getElementById(`${prefix}-lang`)?.value || "1");
    if (isNaN(baseVal) || baseVal <= 0) return alert("Bitte einen gültigen Basiswert in € eingeben.");

    const realVal = Math.round(baseVal * condMult * langMult * 100) / 100;
    const targetArr = side === "A" ? tradeSideA : tradeSideB;
    targetArr.push({ name, realVal });
    document.getElementById(`${prefix}-name`).value = "";
    document.getElementById(`${prefix}-val`).value = "";
    window.renderTradeAnalyzer();
  };

  window.renderTradeAnalyzer = function() {
    const sumA = tradeSideA.reduce((s, i) => s + i.realVal, 0);
    const sumB = tradeSideB.reduce((s, i) => s + i.realVal, 0);
    document.getElementById("trade-sum-a").textContent = `${sumA.toFixed(2).replace(".", ",")} €`;
    document.getElementById("trade-sum-b").textContent = `${sumB.toFixed(2).replace(".", ",")} €`;

    document.getElementById("trade-list-a").innerHTML = tradeSideA.map((item, idx) => `
      <div class="flex justify-between items-center bg-slate-900 px-2.5 py-1 rounded">
        <span class="truncate text-slate-200">${sanitizeHTML(item.name)}</span>
        <span class="font-bold text-yellow-400">${item.realVal.toFixed(2)} € <button onclick="window.removeTradeItem('A',${idx})" class="text-slate-500 ml-1">✕</button></span>
      </div>
    `).join("");

    document.getElementById("trade-list-b").innerHTML = tradeSideB.map((item, idx) => `
      <div class="flex justify-between items-center bg-slate-900 px-2.5 py-1 rounded">
        <span class="truncate text-slate-200">${sanitizeHTML(item.name)}</span>
        <span class="font-bold text-emerald-400">${item.realVal.toFixed(2)} € <button onclick="window.removeTradeItem('B',${idx})" class="text-slate-500 ml-1">✕</button></span>
      </div>
    `).join("");

    const diff = sumB - sumA;
    const badge = document.getElementById("trade-verdict-badge");
    if (Math.abs(diff) < 1) {
      badge.textContent = "⚖️ Perfekter 1:1 Tausch (0,00 € Differenz)";
      badge.className = "bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-1.5 rounded-xl text-xs font-black text-emerald-300";
    } else if (diff > 0) {
      badge.textContent = `✅ +${diff.toFixed(2).replace(".", ",")} € Vorteil für dich (Du müsstest ${diff.toFixed(2).replace(".", ",")} € zuzahlen)`;
      badge.className = "bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-1.5 rounded-xl text-xs font-black text-emerald-300";
    } else {
      badge.textContent = `⚠️ ${diff.toFixed(2).replace(".", ",")} € Nachteil (Tauschpartner muss ${Math.abs(diff).toFixed(2).replace(".", ",")} € zuzahlen)`;
      badge.className = "bg-rose-500/20 border border-rose-500/40 px-3.5 py-1.5 rounded-xl text-xs font-black text-rose-300";
    }
  };

  window.removeTradeItem = function(side, idx) {
    if (side === "A") tradeSideA.splice(idx, 1);
    else tradeSideB.splice(idx, 1);
    window.renderTradeAnalyzer();
  };

  // =========================================================================
  // POSITION 5, 6 & 7B: INTERAKTIVES PSA-CENTERING-TOOL, 9:16 FLEX-CARD & MASTER-SET
  // =========================================================================
  function injectPortfolioUpgrades() {
    const viewPort = document.getElementById("view-portfolio");
    if (!viewPort) return;

    const portAddon = document.createElement("div");
    portAddon.className = "grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mt-6";
    portAddon.innerHTML = `
      <!-- POSITION 5: INTERAKTIVES PSA 10 CENTERING-LASER-TOOL -->
      <div class="lg:col-span-6 poke-glass rounded-3xl p-5 space-y-3.5 border border-yellow-400/40">
        <div>
          <span class="text-[10px] font-black uppercase bg-yellow-400 text-slate-950 px-2.5 py-0.5 rounded-full">🎯 Interaktiver PSA-10-Laser</span>
          <h3 class="text-base font-black text-white mt-1">Karten-Centering live abmessen (PSA 10 Check)</h3>
          <p class="text-xs text-slate-300">Lade ein Foto deiner Karte hoch und schiebe die 4 Laser-Linien auf die Kartenränder:</p>
        </div>

        <input type="file" accept="image/*" onchange="window.loadCenteringPhoto(event)" class="w-full bg-slate-900 border border-slate-700 rounded-xl p-1.5 text-xs text-slate-300" />

        <div class="relative mx-auto w-56 h-76 bg-slate-950 rounded-2xl overflow-hidden border-2 border-slate-700 flex items-center justify-center">
          <img id="centering-img" src="https://assets.tcgdex.net/de/sv/sv08/238/high.webp" class="max-w-full max-h-full object-contain select-none" />
          <div id="laser-left" class="laser-line-v bg-yellow-400" style="left: 9%;"></div>
          <div id="laser-right" class="laser-line-v bg-yellow-400" style="left: 91%;"></div>
          <div id="laser-top" class="laser-line-h bg-rose-500" style="top: 8%;"></div>
          <div id="laser-bottom" class="laser-line-h bg-rose-500" style="top: 92%;"></div>
        </div>

        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <label class="text-yellow-300 font-bold">Linker Rand (%):</label>
            <input id="sl-left" type="range" min="2" max="25" step="0.5" value="9" oninput="window.updateCenteringCalc()" class="w-full accent-yellow-400" />
          </div>
          <div>
            <label class="text-yellow-300 font-bold">Rechter Rand (%):</label>
            <input id="sl-right" type="range" min="2" max="25" step="0.5" value="9" oninput="window.updateCenteringCalc()" class="w-full accent-yellow-400" />
          </div>
          <div>
            <label class="text-rose-400 font-bold">Oberer Rand (%):</label>
            <input id="sl-top" type="range" min="2" max="25" step="0.5" value="8" oninput="window.updateCenteringCalc()" class="w-full accent-rose-500" />
          </div>
          <div>
            <label class="text-rose-400 font-bold">Unterer Rand (%):</label>
            <input id="sl-bottom" type="range" min="2" max="25" step="0.5" value="8" oninput="window.updateCenteringCalc()" class="w-full accent-rose-500" />
          </div>
        </div>

        <div id="centering-result-box" class="bg-slate-950 p-3 rounded-2xl border border-emerald-500/40 text-center text-xs font-bold text-emerald-400">
          🎯 Links/Rechts: 50 / 50 • Oben/Unten: 50 / 50 &rarr; 🏆 PSA 10 GEM MINT KANDIDAT!
        </div>
      </div>

      <!-- POSITION 6 & 7B: VIRALER 9:16 STORY FLEX-GENERATOR & MASTER-SET TRACKER -->
      <div class="lg:col-span-6 space-y-5">
        <!-- 9:16 Story Flex-Card Generator -->
        <div class="poke-glass rounded-3xl p-5 space-y-3 border-2 border-purple-500/50">
          <span class="text-[10px] font-black uppercase bg-gradient-to-r from-purple-500 to-pink-500 text-white px-2.5 py-0.5 rounded-full">📲 Virales TikTok / Insta-Story Feature</span>
          <h3 class="text-base font-black text-white">9:16 Portfolio „Flex-Card“ als Bild herunterladen</h3>
          <p class="text-xs text-slate-300">Generiert auf Knopfdruck eine edle Story-Grafik deiner besten Hits inkl. Gesamtwert & <code class="text-yellow-300">pokeswipe-radar.de</code> Branding zum Teilen!</p>
          <button onclick="window.downloadStoryFlexCard()" class="w-full bg-gradient-to-r from-yellow-400 via-amber-500 to-red-500 text-slate-950 font-black py-3 rounded-xl text-xs sm:text-sm shadow-lg">
            📸 Story Flex-Card (PNG) jetzt erstellen & herunterladen
          </button>
          <canvas id="flex-card-canvas" width="720" height="1280" class="hidden"></canvas>
        </div>

        <!-- Master-Set & Reverse-Holo Tracker -->
        <div class="poke-glass rounded-3xl p-5 space-y-3">
          <div class="flex justify-between items-center">
            <div>
              <span class="text-[10px] font-black uppercase bg-emerald-400 text-slate-950 px-2.5 py-0.5 rounded-full">📘 Master-Set Checkliste</span>
              <h3 class="text-sm font-black text-white mt-1">Stürmische Funken & 151 Chase-Tracker (inkl. Reverse-Holo)</h3>
            </div>
            <strong id="masterset-progress" class="text-xs text-yellow-400 font-black">0 / 6</strong>
          </div>
          <div id="masterset-list" class="space-y-1.5 text-xs"></div>
        </div>
      </div>
    `;
    viewPort.appendChild(portAddon);
    window.renderMasterSetChecklist();
  }

  window.loadCenteringPhoto = function(e) {
    compressImage(e.target.files[0], dataUrl => {
      document.getElementById("centering-img").src = dataUrl;
    });
  };

  window.updateCenteringCalc = function() {
    const l = parseFloat(document.getElementById("sl-left").value);
    const r = parseFloat(document.getElementById("sl-right").value);
    const t = parseFloat(document.getElementById("sl-top").value);
    const b = parseFloat(document.getElementById("sl-bottom").value);

    document.getElementById("laser-left").style.left = l + "%";
    document.getElementById("laser-right").style.left = (100 - r) + "%";
    document.getElementById("laser-top").style.top = t + "%";
    document.getElementById("laser-bottom").style.top = (100 - b) + "%";

    const lrLeft = Math.round((l / (l + r)) * 100);
    const lrRight = 100 - lrLeft;
    const tbTop = Math.round((t / (t + b)) * 100);
    const tbBottom = 100 - tbTop;

    const maxDeviation = Math.max(lrLeft, lrRight, tbTop, tbBottom);
    const resBox = document.getElementById("centering-result-box");
    if (maxDeviation <= 55) {
      resBox.textContent = `🎯 L/R: ${lrLeft}/${lrRight} • O/U: ${tbTop}/${tbBottom} → 🏆 PSA 10 GEM MINT KANDIDAT (≤ 55/45)!`;
      resBox.className = "bg-slate-950 p-3 rounded-2xl border border-emerald-500/40 text-center text-xs font-bold text-emerald-400";
    } else if (maxDeviation <= 60) {
      resBox.textContent = `🎯 L/R: ${lrLeft}/${lrRight} • O/U: ${tbTop}/${tbBottom} → ✨ PSA 9 MINT KANDIDAT (≤ 60/40)`;
      resBox.className = "bg-slate-950 p-3 rounded-2xl border border-yellow-400/40 text-center text-xs font-bold text-yellow-300";
    } else {
      resBox.textContent = `⚠️ L/R: ${lrLeft}/${lrRight} • O/U: ${tbTop}/${tbBottom} → Off-Center (PSA 8 oder niedriger – lieber roh verkaufen)`;
      resBox.className = "bg-slate-950 p-3 rounded-2xl border border-rose-500/40 text-center text-xs font-bold text-rose-400";
    }
  };

  // 9:16 STORY FLEX-CARD PNG GENERATOR
  window.downloadStoryFlexCard = function() {
    const canvas = document.getElementById("flex-card-canvas");
    const ctx = canvas.getContext("2d");

    // Dunkler Holo-Gradient Hintergrund
    const grad = ctx.createLinearGradient(0, 0, 720, 1280);
    grad.addColorStop(0, "#0b0f19");
    grad.addColorStop(0.5, "#1e1b4b");
    grad.addColorStop(1, "#090d1a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 720, 1280);

    // Goldener Rahmen
    ctx.strokeStyle = "#ffcb05";
    ctx.lineWidth = 10;
    ctx.strokeRect(28, 28, 664, 1224);

    // Header
    ctx.fillStyle = "#ffcb05";
    ctx.font = "900 42px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚡ POKESWIPE & RADAR ⚡", 360, 115);

    const user = getCurrentUser() || "einem Sammler";
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText(`Sammler-Portfolio von ${user}`, 360, 165);

    // Gesamtwert Box
    const total = portfolio.reduce((s, i) => s + Number(i.value || 0), 0);
    ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
    ctx.fillRect(70, 210, 580, 150);
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 4;
    ctx.strokeRect(70, 210, 580, 150);

    ctx.fillStyle = "#6ee7b7";
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillText("PORTFOLIO GESAMTWERT", 360, 260);
    ctx.fillStyle = "#10b981";
    ctx.font = "900 64px system-ui, sans-serif";
    ctx.fillText(`${total.toFixed(2).replace(".", ",")} €`, 360, 332);

    // Top 5 Karten auflisten
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillText("🏆 MEINE TOP GRAILS & HITS:", 360, 430);

    const topCards = [...portfolio].sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 5);
    if (!topCards.length) {
      alert("Füge zuerst Karten zu deinem Portfolio hinzu – dann entsteht deine Flex-Card.");
      return;
    }

    ctx.textAlign = "left";
    topCards.forEach((c, idx) => {
      const y = 480 + idx * 105;
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.fillRect(70, y, 580, 82);
      ctx.strokeStyle = "rgba(255, 203, 5, 0.4)";
      ctx.lineWidth = 2;
      ctx.strokeRect(70, y, 580, 82);

      ctx.fillStyle = "#ffcb05";
      ctx.font = "bold 26px system-ui, sans-serif";
      ctx.fillText(`#${idx + 1}  ${String(c.name).slice(0, 28)}`, 95, y + 50);

      ctx.textAlign = "right";
      ctx.fillStyle = "#34d399";
      ctx.fillText(Number(c.value) > 0 ? `${Number(c.value).toFixed(0)} €` : "–", 625, y + 50);
      ctx.textAlign = "left";
    });

    // Virales Wasserzeichen unten
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffcb05";
    ctx.font = "900 34px system-ui, sans-serif";
    ctx.fillText("🌐 pokeswipe-radar.de", 360, 1140);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText("Live-Preise • Restock-Radar • Tausch-Hub", 360, 1185);

    const link = document.createElement("a");
    link.download = "pokeswipe-radar-story-flex.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    triggerSmartPush("📸 Story Flex-Card heruntergeladen!", "Teile das Bild jetzt in deiner TikTok- oder Instagram-Story!");
  };

  // MASTER-SET & REVERSE-HOLO CHECKLISTE
  const masterSetItems = [
    { id: "ms1", name: "Pikachu ex (238/191) – Stürmische Funken" },
    { id: "ms2", name: "Latias ex (239/191) – Stürmische Funken" },
    { id: "ms3", name: "Glurak ex (199/165) – K&P 151" },
    { id: "ms4", name: "Turtok ex (200/165) – K&P 151" },
    { id: "ms5", name: "Bisaflor ex (198/165) – K&P 151" },
    { id: "ms6", name: "Mew ex (205/165) – K&P 151" }
  ];
  let masterChecked = (typeof lsJSON === "function" ? lsJSON("pokeswipe_masterset", {}) : {});

  window.toggleMasterSetCheck = function(id) {
    masterChecked[id] = !masterChecked[id];
    localStorage.setItem("pokeswipe_masterset", JSON.stringify(masterChecked));
    window.renderMasterSetChecklist();
  };

  window.renderMasterSetChecklist = function() {
    const box = document.getElementById("masterset-list");
    if (!box) return;
    let doneCount = 0;
    box.innerHTML = masterSetItems.map(item => {
      const hasNorm = Boolean(masterChecked[item.id + "_norm"]);
      const hasRev = Boolean(masterChecked[item.id + "_rev"]);
      if (hasNorm || hasRev) doneCount++;
      return `
        <div class="flex items-center justify-between bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl">
          <span class="text-white font-semibold truncate pr-2">${item.name}</span>
          <div class="flex items-center gap-2 shrink-0">
            <label class="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
              <input type="checkbox" ${hasNorm ? "checked" : ""} onchange="window.toggleMasterSetCheck('${item.id}_norm')" class="accent-yellow-400" /> Normal/SIR
            </label>
            <label class="flex items-center gap-1 text-[11px] text-purple-300 cursor-pointer">
              <input type="checkbox" ${hasRev ? "checked" : ""} onchange="window.toggleMasterSetCheck('${item.id}_rev')" class="accent-purple-400" /> Reverse/Masterball
            </label>
          </div>
        </div>
      `;
    }).join("");
    const prog = document.getElementById("masterset-progress");
    if (prog) prog.textContent = `${doneCount} / ${masterSetItems.length} komplett`;
  };

  // =========================================================================
  // POSITION 2: FREEMIUM-HOOKS IN BESTEHENDE FUNKTIONEN EINBAUEN
  // =========================================================================
  const origNextSwipeCard = window.nextSwipeCard;
  window.nextSwipeCard = function(mode) {
    if (!consumeFreeSwipe()) return;
    if (origNextSwipeCard) origNextSwipeCard(mode);
  };

  const origAddPortfolioItem = window.addPortfolioItem;
  window.addPortfolioItem = function() {
    if (!isProUser() && portfolio.length >= FREE_PORTFOLIO_LIMIT) {
      triggerSmartPush("🔒 Gratis-Limit erreicht (15 Karten)", "Mit PRO (4,99 €) kannst du unbegrenzt viele Karten im Portfolio verwalten!");
      openModal("pro-modal");
      return;
    }
    if (origAddPortfolioItem) origAddPortfolioItem();
  };

  const origAddCardByNumber = window.addCardByNumber;
  window.addCardByNumber = function() {
    if (!isProUser() && portfolio.length >= FREE_PORTFOLIO_LIMIT) {
      triggerSmartPush("🔒 Gratis-Limit erreicht (15 Karten)", "Mit PRO (4,99 €) scannst du unbegrenzt viele Karten ins Portfolio!");
      openModal("pro-modal");
      return;
    }
    if (origAddCardByNumber) origAddCardByNumber();
  };

  const origAddWishlistRule = window.addWishlistRule;
  window.addWishlistRule = function() {
    if (!isProUser() && wishlist.length >= FREE_WISHLIST_LIMIT) {
      triggerSmartPush("🔒 Gratis-Limit (2 Preis-Wächter)", "Schalte PRO frei für unbegrenzte Echtzeit-Preiswächter!");
      openModal("pro-modal");
      return;
    }
    if (origAddWishlistRule) origAddWishlistRule();
  };

  const origActivatePro = window.activatePro;
  window.activatePro = function(plan) {
    if (origActivatePro) origActivatePro(plan);
    updateSwipeCounterBadge();
    window.filterFlipDeals("all");
  };

  // =========================================================================
  // INITIALISIERUNG ALLER 8 ERWEITERUNGEN
  // =========================================================================
  updateSwipeCounterBadge();
  injectArenaUpgrades();
  injectMapAndTradeUpgrades();
  injectPortfolioUpgrades();
  window.filterFlipDeals("all");
  try { calcGradingProfit(); } catch (e) {}

  // Sobald der Server den Tarif bestätigt (Login, Checkout, Abmelden): Pro-Ansichten neu zeichnen
  window.addEventListener("ps:plan", () => {
    safeRun("Plan-Update Swipe", updateSwipeCounterBadge);
    safeRun("Plan-Update Flip", () => window.filterFlipDeals("all"));
    safeRun("Plan-Update Grading", () => calcGradingProfit());
  });
})();
