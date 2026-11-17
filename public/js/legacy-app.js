// PokeSwipe & Radar – Basis-Oberfläche (ausgelagert aus index.html, Phase 6)
// Klassisches Skript (kein Modul): Funktionen und Variablen bleiben global, weil Vorlagen-Handler (onclick="…")
// und client/*.js darauf zugreifen. Wird mit defer geladen (gleiche Reihenfolge wie zuvor, vor /assets/app.js).
    // Lokale Listen (ohne Konto) – als benannte Funktionen, damit sie auch unter strikter CSP aufrufbar sind
    function removeSavedMatch(i) { savedMatches.splice(Number(i), 1); localStorage.setItem('pokeswipe_matches_clean', JSON.stringify(savedMatches)); renderMatches(); }
    function removeLocalWish(i) { wishlist.splice(Number(i), 1); localStorage.setItem('pokeswipe_wishlist_clean', JSON.stringify(wishlist)); renderWishlist(); }
    function removeLocalPortfolioItem(i) { portfolio.splice(Number(i), 1); localStorage.setItem('pokeswipe_portfolio_clean', JSON.stringify(portfolio)); renderPortfolio(); }
    // ===================================================================
    // ZENTRALE KONFIGURATION – Partner-IDs & Tracking an einer Stelle
    // ===================================================================
    const CONFIG = window.PS_CONFIG = Object.freeze({
      // eBay Partner Network (ePN) – feste Campaign-ID für alle Kauf-Buttons
      EPN_CAMPAIGN_ID: "5339244109",
      // Cardmarket-Partnerkürzel/Referral: sobald vorhanden hier eintragen –
      // wird automatisch an ALLE Cardmarket-Links angehängt (als ?referrer=…).
      CARDMARKET_PARTNER_ID: "",
      // Tracking-Parameter für alle Cardmarket-Links
      CARDMARKET_UTM: { utm_source: "pokeswipe_radar", utm_medium: "referral", utm_campaign: "pokeswipe" },
    });
    const EPN_CAMPAIGN_ID = CONFIG.EPN_CAMPAIGN_ID;
    // Partner-IDs aus den Netlify-Umgebungsvariablen (CARDMARKET_PARTNER_ID) – einmal laden, überall nutzen
    let cardmarketPartnerId = CONFIG.CARDMARKET_PARTNER_ID;
    const publicConfigPromise = fetch("/api/public-config", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((cfg) => {
        const id = String((cfg && cfg.cardmarketPartnerId) || "");
        if (/^[A-Za-z0-9_.-]{1,40}$/.test(id)) cardmarketPartnerId = id;
        return cfg || {};
      });
    window.PS_PUBLIC_CONFIG = publicConfigPromise;
    const firebaseConfig = {
      // Firebase-Projekt „pokeswiperadar“ (Realtime Database in europe-west1) – hier gelten die strengen Regeln
      // (nur stats/totalVisits und presence, beides nur mit Anmeldung beschreibbar).
      databaseURL: "https://pokeswiperadar-default-rtdb.europe-west1.firebasedatabase.app"
      // apiKey kommt aus der Netlify-Umgebungsvariable FIREBASE_WEB_API_KEY über /api/public-config,
      // authDomain/projectId werden aus der databaseURL abgeleitet (pokeswiperadar.firebaseapp.com).
      // Ohne apiKey gibt es keine anonyme Anmeldung – dann lehnen die Regeln Zähler und Präsenz ab.
    };

    function sanitizeHTML(str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function getOwnerId() {
      let id = localStorage.getItem("pokeswipe_uid");
      if (!id) {
        id = "u_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now();
        localStorage.setItem("pokeswipe_uid", id);
      }
      return id;
    }

    function getCurrentUser() {
      return localStorage.getItem("pokeswipe_user") || "";
    }

    function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
    function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

    // PWA INSTALLER
    let deferredInstallPrompt = null;
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstallPrompt = e; window.psInstallPrompt = e; window.dispatchEvent(new Event("ps:installable")); });
    function triggerNativeInstall() {
      if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); closeModal("install-modal"); }
      else alert("Wähle im Browser-Menü 'Zum Startbildschirm hinzufügen'.");
    }

    // AFFILIATE & CARDMARKET URLS
    // eBay-Partner-Link (ePN). mode: bin = Sofortkauf, auction = Auktion, sold = verkaufte Angebote.
    // src landet als customid im ePN-Bericht, damit du siehst, welcher Bereich wie viel verdient.
    function buildEbayUrl(query, mode = "bin", src = "") {
      const encoded = encodeURIComponent(String(query || "Pokemon TCG").slice(0, 120));
      const sort = mode === "auction" ? "&LH_Auction=1&_sop=1" : mode === "sold" ? "&LH_Sold=1&LH_Complete=1&_sop=13" : "&LH_BIN=1&_sop=15";
      const custom = encodeURIComponent(("pokeswipe" + (src ? "-" + src : "")).replace(/[^a-z0-9-]/gi, "").slice(0, 40));
      return `https://www.ebay.de/sch/i.html?_nkw=${encoded}${sort}&mkcid=1&mkrid=707-53477-19255-0&siteid=77&campid=${EPN_CAMPAIGN_ID}&customid=${custom}&toolid=10001&mkevt=1`;
    }
    window.buildEbayUrl = buildEbayUrl;

    // ===================================================================
    // SCHUTZ & ROBUSTHEIT: Cooldown gegen Spam-Klicks, Bild-Fallback, Fehlerfang
    // ===================================================================
    const FALLBACK_CARD_IMG = "/card-fallback.svg";
    const COOLDOWN_MS = 3000;
    const cooldowns = new Map();
    /** true = Aktion erlaubt; false = noch im 3-Sekunden-Cooldown. */
    function cooldownOk(key, ms = COOLDOWN_MS) {
      const now = Date.now();
      const last = cooldowns.get(key) || 0;
      if (now - last < ms) {
        const left = Math.ceil((ms - (now - last)) / 1000);
        try { triggerSmartPush("⏳ Kurz warten", `Bitte ${left} Sek. bis zur nächsten Aktion.`); } catch (e) {}
        return false;
      }
      cooldowns.set(key, now);
      return true;
    }
    // Aktions-Buttons (Senden, Posten, Liken, Inserieren, Anfragen …) global mit 3 s Cooldown schützen
    const ACTION_RE = /(like|send|publish|submit|post|comment|report|request|register|create|add|boost|checkout|claim|confirm|track|review|trade|alert|wish|remind|event|vidrecord|delete)/i;
    const NAV_RE = /(Row|switchTab|showSub|openModal|closeModal|filter|board\(|vidKind|toggle|open[A-Z]|close|select|pick|calc|update|render|load|search)/;
    document.addEventListener("click", (e) => {
      const el = e.target.closest && e.target.closest("button, [data-cooldown]");
      if (!el || el.disabled) return;
      const code = el.getAttribute("onclick") || el.id || "";
      if (!el.hasAttribute("data-cooldown") && (!ACTION_RE.test(code) || NAV_RE.test(code.split("(")[0]))) return;
      const key = code || el.textContent.trim().slice(0, 40);
      const now = Date.now(), last = cooldowns.get("btn:" + key) || 0;
      if (now - last < COOLDOWN_MS) {
        e.preventDefault(); e.stopImmediatePropagation();
        // Sichtbarer Hinweis statt stillem Verschlucken (z. B. nach „Bitte AGB bestätigen“ direkt erneut tippen)
        const left = Math.max(1, Math.ceil((COOLDOWN_MS - (now - last)) / 1000));
        try { triggerSmartPush("⏳ Kurz warten", `Bitte ${left} Sek. bis zur nächsten Aktion.`); } catch (err) {}
        return;
      }
      cooldowns.set("btn:" + key, now);
      el.classList.add("opacity-60");
      setTimeout(() => el.classList.remove("opacity-60"), COOLDOWN_MS);
    }, true);
    // Kaputte Bilder durch eine neutrale Kartenrückseite ersetzen
    document.addEventListener("error", (e) => {
      const img = e.target;
      if (!img || img.tagName !== "IMG" || img.dataset.fallback) return;
      img.dataset.fallback = "1";
      img.src = FALLBACK_CARD_IMG;
    }, true);
    window.addEventListener("unhandledrejection", (e) => { console.warn("Nicht abgefangener Fehler:", e.reason); e.preventDefault(); });
    window.addEventListener("error", (e) => { if (e.message) console.warn("Skriptfehler:", e.message); });
    function safeRun(label, fn) { try { return fn(); } catch (err) { console.warn(label, err); } }
    const fmtEur = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? (window.psLang === "en" ? `€${Number(n).toFixed(2)}` : `${Number(n).toFixed(2).replace(".", ",")} €`) : "–");
    /** localStorage-JSON robust lesen: kaputte/fremde Werte brechen das Skript nicht mehr ab. */
    const lsJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === typeof d && Array.isArray(v) === Array.isArray(d) ? v : d; } catch (e) { return d; } };
    const safeKey = (k) => (/^[A-Za-z0-9_-]{1,64}$/.test(String(k || "")) ? String(k) : "");

    // ===================================================================
    // AUTOMATISCHER TEST-/DUMMY-FILTER FÜR FIREBASE (Chat, Pull-Wall, Radar)
    // Blendet alte Testeinträge, Platzhalter und Spam automatisch aus.
    // ===================================================================
    const DUMMY_RE = /\b(test(user|post|eintrag|nachricht)?|dummy|demo|fake|beispiel|example|lorem|ipsum|asdf|qwert|xxx+|sample|platzhalter|placeholder|bot\d*)\b/i;
    const DAY = 86400000;
    function isDummyEntry(e, { maxAgeDays = 0, textFields = [] } = {}) {
      if (!e || typeof e !== "object") return true;
      const ts = Number(e.timestamp || e.ts || 0);
      if (!ts || ts > Date.now() + DAY) return true;                         // ohne Zeitstempel = alter Import/Test
      if (maxAgeDays && Date.now() - ts > maxAgeDays * DAY) return true;     // veraltet
      const parts = textFields.map((f) => String(e[f] || "")).join(" ").trim();
      if (!parts) return true;
      if (DUMMY_RE.test(parts)) return true;
      if (/(.)\1{7,}/.test(parts)) return true;                              // „aaaaaaaa“-Spam
      return false;
    }
    /**
     * Bereinigt zusätzlich in Firebase, wo die Sicherheitsregeln es erlauben: Der eigene Radar-Pin
     * (Schlüssel = Geräte-ID) wird gelöscht, wenn er ein Test-/Dummy-Eintrag oder älter als 90 Tage ist.
     * Chat und Pull-Wall sind laut Regeln nicht löschbar – dort werden Altlasten nur ausgeblendet.
     */
    function cleanupOwnDummies(ref, entries, textFields, maxAgeDays = 90) {
      if (!ref) return;
      const mine = new Set([getOwnerId(), typeof fbUid === "string" && fbUid ? fbUid : ""].filter(Boolean));
      entries.forEach(([key, v]) => {
        if (mine.has(key) && isDummyEntry(v, { textFields, maxAgeDays })) ref.child(key).remove().catch(() => {});
      });
    }

    /** Hängt UTM-Tracking und (falls hinterlegt) das Cardmarket-Partnerkürzel an jeden Cardmarket-Link. */
    function withCardmarketTracking(url) {
      try {
        const u = new URL(url);
        Object.entries(CONFIG.CARDMARKET_UTM || {}).forEach(([k, v]) => { if (v && !u.searchParams.has(k)) u.searchParams.set(k, v); });
        if (cardmarketPartnerId && /(^|\.)cardmarket\.com$/.test(u.hostname)) u.searchParams.set("referrer", cardmarketPartnerId);
        return u.toString();
      } catch (e) { return url; }
    }
    window.withCardmarketTracking = withCardmarketTracking;
    // Sicherheitsnetz: Links, die vor dem Laden der Partner-ID gerendert wurden, beim Klick nachrüsten
    document.addEventListener("click", (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href*="cardmarket.com"]') : null;
      if (a) a.href = withCardmarketTracking(a.href);
    }, true);
    function buildCardmarketUrl(query) {
      return withCardmarketTracking(`https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(String(query || "").slice(0, 120))}`);
    }
    window.buildCardmarketUrl = buildCardmarketUrl;

    function hydrateStaticAffiliateLinks() {
      document.querySelectorAll(".epn-dynamic-link").forEach(el => {
        el.href = buildEbayUrl(el.getAttribute("data-epn-query") || "Pokemon TCG", "bin");
      });
    }

    // BILD-KOMPRIMIERUNG
    function compressImage(file, callback) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const max = 460;
          let w = img.width, h = img.height;
          if (w > h && w > max) { h = Math.round(h * (max / w)); w = max; }
          else if (h > max) { w = Math.round(w * (max / h)); h = max; }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          callback(canvas.toDataURL("image/jpeg", 0.72));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    // ECHTE KARTEN (offizielle Sets & Set-Nummern). Preise: Cardmarket über TCGdex, Stand 13.11.2026 –
    // werden beim Laden der Seite automatisch live aktualisiert (siehe refreshLivePrices).
    const PRICE_SNAPSHOT_DATE = "13.11.2026";
    const REAL_CARDS = [
      {"id": "sv08-238", "name": "Pikachu-ex", "num": "238/191", "setTag": "Stürmische Funken", "setFull": "Karmesin & Purpur – Stürmische Funken", "rarity": "Special Illustration Rare", "trend": 199.3, "low": 155, "avg30": 243.52, "img": "https://assets.tcgdex.net/de/sv/sv08/238/high.webp", "query": "Pikachu ex 238/191"},
      {"id": "sv08-239", "name": "Latias-ex", "num": "239/191", "setTag": "Stürmische Funken", "setFull": "Karmesin & Purpur – Stürmische Funken", "rarity": "Special Illustration Rare", "trend": 173.91, "low": 99, "avg30": 160.75, "img": "https://assets.tcgdex.net/de/sv/sv08/239/high.webp", "query": "Latias ex 239/191"},
      {"id": "sv08-237", "name": "Milotic-ex", "num": "237/191", "setTag": "Stürmische Funken", "setFull": "Karmesin & Purpur – Stürmische Funken", "rarity": "Special Illustration Rare", "trend": 133.28, "low": 89.99, "avg30": 120.06, "img": "https://assets.tcgdex.net/de/sv/sv08/237/high.webp", "query": "Milotic ex 237/191"},
      {"id": "sv08-247", "name": "Pikachu-ex", "num": "247/191", "setTag": "Stürmische Funken", "setFull": "Karmesin & Purpur – Stürmische Funken", "rarity": "Hyper Rare (Gold)", "trend": 52.87, "low": 48, "avg30": 62.42, "img": "https://assets.tcgdex.net/de/sv/sv08/247/high.webp", "query": "Pikachu ex 247/191"},
      {"id": "sv03.5-199", "name": "Glurak-ex", "num": "199/165", "setTag": "151", "setFull": "Karmesin & Purpur – 151", "rarity": "Special Illustration Rare", "trend": 343.78, "low": 180, "avg30": 325.94, "img": "https://assets.tcgdex.net/de/sv/sv03.5/199/high.webp", "query": "Glurak ex 199/165"},
      {"id": "sv03.5-198", "name": "Bisaflor-ex", "num": "198/165", "setTag": "151", "setFull": "Karmesin & Purpur – 151", "rarity": "Special Illustration Rare", "trend": 112.3, "low": 60, "avg30": 113.85, "img": "https://assets.tcgdex.net/de/sv/sv03.5/198/high.webp", "query": "Bisaflor ex 198/165"},
      {"id": "sv03.5-200", "name": "Turtok-ex", "num": "200/165", "setTag": "151", "setFull": "Karmesin & Purpur – 151", "rarity": "Special Illustration Rare", "trend": 104.07, "low": 69.99, "avg30": 139.21, "img": "https://assets.tcgdex.net/de/sv/sv03.5/200/high.webp", "query": "Turtok ex 200/165"},
      {"id": "sv03.5-202", "name": "Zapdos-ex", "num": "202/165", "setTag": "151", "setFull": "Karmesin & Purpur – 151", "rarity": "Special Illustration Rare", "trend": 96.12, "low": 60, "avg30": 110.45, "img": "https://assets.tcgdex.net/de/sv/sv03.5/202/high.webp", "query": "Zapdos ex 202/165"},
      {"id": "sv03.5-193", "name": "Mew-ex", "num": "193/165", "setTag": "151", "setFull": "Karmesin & Purpur – 151", "rarity": "Ultra Selten", "trend": 27.5, "low": 14.9, "avg30": 28.17, "img": "https://assets.tcgdex.net/de/sv/sv03.5/193/high.webp", "query": "Mew ex 193/165"},
      {"id": "sv03.5-205", "name": "Mew-ex", "num": "205/165", "setTag": "151", "setFull": "Karmesin & Purpur – 151", "rarity": "Hyper Rare (Gold)", "trend": 26.11, "low": 14.5, "avg30": 19.58, "img": "https://assets.tcgdex.net/de/sv/sv03.5/205/high.webp", "query": "Mew ex 205/165"},
      {"id": "sv08.5-161", "name": "Nachtara-ex", "num": "161/131", "setTag": "Prismatische Entwicklungen", "setFull": "Karmesin & Purpur – Prismatische Entwicklungen", "rarity": "Special Illustration Rare", "trend": 1290.1, "low": 699, "avg30": 1064.7, "img": "https://assets.tcgdex.net/de/sv/sv08.5/161/high.webp", "query": "Nachtara ex 161/131"},
      {"id": "sv08.5-144", "name": "Folipurba-ex", "num": "144/131", "setTag": "Prismatische Entwicklungen", "setFull": "Karmesin & Purpur – Prismatische Entwicklungen", "rarity": "Special Illustration Rare", "trend": 276.99, "low": 110, "avg30": 231.27, "img": "https://assets.tcgdex.net/de/sv/sv08.5/144/high.webp", "query": "Folipurba ex 144/131"},
      {"id": "sv08.5-156", "name": "Feelinara-ex", "num": "156/131", "setTag": "Prismatische Entwicklungen", "setFull": "Karmesin & Purpur – Prismatische Entwicklungen", "rarity": "Special Illustration Rare", "trend": 256.69, "low": 183, "avg30": 281.78, "img": "https://assets.tcgdex.net/de/sv/sv08.5/156/high.webp", "query": "Feelinara ex 156/131"},
      {"id": "sv08.5-149", "name": "Aquana-ex", "num": "149/131", "setTag": "Prismatische Entwicklungen", "setFull": "Karmesin & Purpur – Prismatische Entwicklungen", "rarity": "Special Illustration Rare", "trend": 199.71, "low": 90, "avg30": 193.87, "img": "https://assets.tcgdex.net/de/sv/sv08.5/149/high.webp", "query": "Aquana ex 149/131"},
      {"id": "swsh12.5gg-GG69", "name": "Giratina VSTAR", "num": "GG69/GG70", "setTag": "Zenit der Könige", "setFull": "Schwert & Schild – Zenit der Könige (Galar-Galerie)", "rarity": "Alternate Art Secret Rare", "trend": 257.92, "low": 160, "avg30": 279.02, "img": "https://images.pokemontcg.io/swsh12pt5gg/GG69_hires.png", "query": "Giratina VSTAR GG69"},
      {"id": "swsh12.5gg-GG44", "name": "Mewtu VSTAR", "num": "GG44/GG70", "setTag": "Zenit der Könige", "setFull": "Schwert & Schild – Zenit der Könige (Galar-Galerie)", "rarity": "Ultra Selten", "trend": 208.47, "low": 99.95, "avg30": 201.45, "img": "https://images.pokemontcg.io/swsh12pt5gg/GG44_hires.png", "query": "Mewtu VSTAR GG44"},
      {"id": "swsh12.5gg-GG70", "name": "Arceus VSTAR", "num": "GG70/GG70", "setTag": "Zenit der Könige", "setFull": "Schwert & Schild – Zenit der Könige (Galar-Galerie)", "rarity": "Alternate Art Secret Rare", "trend": 172.71, "low": 89.9, "avg30": 184.58, "img": "https://images.pokemontcg.io/swsh12pt5gg/GG70_hires.png", "query": "Arceus VSTAR GG70"},
      {"id": "sv03-223", "name": "Glurak-ex", "num": "223/197", "setTag": "Obsidianflammen", "setFull": "Karmesin & Purpur – Obsidianflammen", "rarity": "Special Illustration Rare", "trend": 64.37, "low": 42, "avg30": 78.9, "img": "https://assets.tcgdex.net/de/sv/sv03/223/high.webp", "query": "Glurak ex 223/197"},
      {"id": "sv03-228", "name": "Glurak-ex", "num": "228/197", "setTag": "Obsidianflammen", "setFull": "Karmesin & Purpur – Obsidianflammen", "rarity": "Hyper Rare (Gold)", "trend": 21.28, "low": 12, "avg30": 28.68, "img": "https://assets.tcgdex.net/de/sv/sv03/228/high.webp", "query": "Glurak ex 228/197"},
      {"id": "me01-188", "name": "Mega-Lucario-ex", "num": "188/132", "setTag": "Mega-Entwicklung", "setFull": "Mega-Entwicklung", "rarity": "Mega Hyper Rare (Gold)", "trend": 169.27, "low": 140, "avg30": 168.12, "img": "https://assets.tcgdex.net/de/me/me01/188/high.webp", "query": "Mega-Lucario ex 188/132"},
      {"id": "me01-187", "name": "Mega-Guardevoir-ex", "num": "187/132", "setTag": "Mega-Entwicklung", "setFull": "Mega-Entwicklung", "rarity": "Mega Hyper Rare (Gold)", "trend": 157.35, "low": 119.99, "avg30": 160.33, "img": "https://assets.tcgdex.net/de/me/me01/187/high.webp", "query": "Mega-Guardevoir ex 187/132"},
      {"id": "me01-178", "name": "Mega-Guardevoir-ex", "num": "178/132", "setTag": "Mega-Entwicklung", "setFull": "Mega-Entwicklung", "rarity": "Special Illustration Rare", "trend": 143.34, "low": 80, "avg30": 127.41, "img": "https://assets.tcgdex.net/de/me/me01/178/high.webp", "query": "Mega-Guardevoir ex 178/132"},
      {"id": "me01-179", "name": "Mega-Lucario-ex", "num": "179/132", "setTag": "Mega-Entwicklung", "setFull": "Mega-Entwicklung", "rarity": "Special Illustration Rare", "trend": 132.11, "low": 69.9, "avg30": 137.55, "img": "https://assets.tcgdex.net/de/me/me01/179/high.webp", "query": "Mega-Lucario ex 179/132"},
      {"id": "sv04-251", "name": "Donnersichel-ex", "num": "251/182", "setTag": "Paradoxrift", "setFull": "Karmesin & Purpur – Paradoxrift", "rarity": "Special Illustration Rare", "trend": 28.43, "low": 19, "avg30": 35.56, "img": "https://assets.tcgdex.net/de/sv/sv04/251/high.webp", "query": "Donnersichel ex 251/182"},
      {"id": "swsh7-215", "name": "Nachtara VMAX", "num": "215/203", "setTag": "Drachenwandel", "setFull": "Schwert & Schild – Drachenwandel", "rarity": "Alternate Art Secret Rare", "trend": 1872.01, "low": 500, "avg30": 1790.22, "img": "https://assets.tcgdex.net/de/swsh/swsh7/215/high.webp", "query": "Nachtara VMAX 215/203"},
      {"id": "swsh7-218", "name": "Rayquaza VMAX", "num": "218/203", "setTag": "Drachenwandel", "setFull": "Schwert & Schild – Drachenwandel", "rarity": "Alternate Art Secret Rare", "trend": 1154.9, "low": 350, "avg30": 1037.8, "img": "https://assets.tcgdex.net/de/swsh/swsh7/218/high.webp", "query": "Rayquaza VMAX 218/203"}
    ];

    const cardLabel = (c) => `${c.name} (${c.num})`;
    // Abwärtskompatibel: Katalog nach Kartennummer (z. B. "238/191")
    const cardCatalog = Object.create(null);
    REAL_CARDS.forEach((c) => {
      cardCatalog[c.num] = { name: cardLabel(c), set: c.setTag, value: c.trend, img: c.img, id: c.id };
    });

    function resolveCard(input) {
      const clean = (input || "").trim();
      if (cardCatalog[clean]) return { ...cardCatalog[clean], value: (REAL_CARDS.find((c) => c.num === clean) || {}).trend || cardCatalog[clean].value };
      for (const k in cardCatalog) {
        if (clean.toLowerCase().includes(k.toLowerCase()) || clean.toLowerCase().includes(cardCatalog[k].name.toLowerCase().split(" ")[0])) {
          return cardCatalog[k];
        }
      }
      return { name: clean || "Pokémon Karte", set: "Pokémon TCG", value: 0, img: FALLBACK_CARD_IMG };
    }

    // ===================================================================
    // ERWEITERTES PUSH-BENACHRICHTIGUNGS-SYSTEM 2.0 (TOAST + SOUND + BROWSER)
    // ===================================================================
    let pushSettings = lsJSON("pokeswipe_push_cfg", {
      market: true,
      wall: true,
      sound: true,
      keywords: ""
    });
    let swRegistration = null;
    let toastTimeout = null;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then(reg => { swRegistration = reg; }).catch(() => {});
    }

    function loadPushSettingsUI() {
      document.getElementById("push-opt-market").checked = pushSettings.market !== false;
      document.getElementById("push-opt-wall").checked = pushSettings.wall !== false;
      document.getElementById("push-opt-sound").checked = pushSettings.sound !== false;
      document.getElementById("push-opt-keywords").value = pushSettings.keywords || "";
      if ("Notification" in window && Notification.permission === "granted") {
        document.getElementById("pushStatusLabel").textContent = "Push Aktiv";
      }
    }

    function savePushSettings() {
      pushSettings = {
        market: document.getElementById("push-opt-market").checked,
        wall: document.getElementById("push-opt-wall").checked,
        sound: document.getElementById("push-opt-sound").checked,
        keywords: document.getElementById("push-opt-keywords").value.trim()
      };
      localStorage.setItem("pokeswipe_push_cfg", JSON.stringify(pushSettings));
    }

    function playPokePingSound() {
      if (!pushSettings.sound) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(784, ctx.currentTime); // G5
        osc.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.09); // C6
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } catch (e) {}
    }

    function triggerSmartPush(title, body, linkUrl = "") {
      playPokePingSound();

      // 1. In-App Live Toast Banner anzeigen (funktioniert auf jedem Smartphone & PC sofort)
      const toast = document.getElementById("live-push-toast");
      document.getElementById("toast-title").textContent = title;
      document.getElementById("toast-body").textContent = body;
      const linkEl = document.getElementById("toast-link");
      if (linkUrl && /^https:\/\//i.test(String(linkUrl))) {
        linkEl.href = linkUrl;
        linkEl.classList.remove("hidden");
      } else {
        linkEl.classList.add("hidden");
      }
      toast.classList.remove("hidden");
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(hideLiveToast, 6500);

      // 2. Nativer Browser- / ServiceWorker-Push (falls freigegeben)
      if ("Notification" in window && Notification.permission === "granted") {
        if (swRegistration && swRegistration.showNotification) {
          swRegistration.showNotification(title, { body, icon: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png" });
        } else {
          try { new Notification(title, { body }); } catch (e) {}
        }
      }
    }

    function hideLiveToast() {
      document.getElementById("live-push-toast").classList.add("hidden");
    }

    function enableBrowserPush() {
      if (!("Notification" in window)) {
        triggerSmartPush("🔔 In-App Live-Push aktiv!", "Dein Browser nutzt ab sofort das Live-Toast-Banner inkl. Sound-Ping.");
        return;
      }
      Notification.requestPermission().then(perm => {
        if (perm === "granted") {
          document.getElementById("pushStatusLabel").textContent = "Push Aktiv";
          triggerSmartPush("🔔 Push-Radar aktiviert!", "Du erhältst ab sofort Echtzeit-Alarme bei neuen Deals & Inseraten!");
        } else {
          triggerSmartPush("🔔 In-App Alarm aktiv!", "Alarme werden dir direkt hier oben als Live-Banner eingeblendet.");
        }
      });
    }

    function sendTestPushNotification() {
      closeModal("push-modal");
      const c = REAL_CARDS[0];
      triggerSmartPush(
        "🔔 Test-Mitteilung",
        `So sieht ein Preisalarm aus: ${cardLabel(c)} – Cardmarket-Trend aktuell ${fmtEur(c.trend)}.`,
        buildEbayUrl(c.query, "bin", "push")
      );
    }

    const REAL_SETS = {"sv08": {"tag": "Stürmische Funken", "full": "Karmesin & Purpur – Stürmische Funken", "sealedQuery": "Pokemon Stürmische Funken Display 36 Booster OVP deutsch"}, "sv03.5": {"tag": "151", "full": "Karmesin & Purpur – 151", "sealedQuery": "Pokemon 151 Booster Bundle deutsch OVP"}, "sv08.5": {"tag": "Prismatische Entwicklungen", "full": "Karmesin & Purpur – Prismatische Entwicklungen", "sealedQuery": "Pokemon Prismatische Entwicklungen Top Trainer Box deutsch"}, "swsh12.5gg": {"tag": "Zenit der Könige", "full": "Schwert & Schild – Zenit der Könige (Galar-Galerie)", "sealedQuery": "Pokemon Zenit der Könige Top Trainer Box deutsch"}, "sv03": {"tag": "Obsidianflammen", "full": "Karmesin & Purpur – Obsidianflammen", "sealedQuery": "Pokemon Obsidianflammen Display 36 Booster deutsch"}, "me01": {"tag": "Mega-Entwicklung", "full": "Mega-Entwicklung", "sealedQuery": "Pokemon Mega-Entwicklung Display 36 Booster deutsch"}, "sv04": {"tag": "Paradoxrift", "full": "Karmesin & Purpur – Paradoxrift", "sealedQuery": "Pokemon Paradoxrift Display 36 Booster deutsch"}, "swsh7": {"tag": "Drachenwandel", "full": "Schwert & Schild – Drachenwandel", "sealedQuery": "Pokemon Drachenwandel Display 36 Booster deutsch"}};
    const setKeyOf = (c) => c.id.slice(0, c.id.lastIndexOf("-"));

    // ===================================================================
    // 1. SWIPE-ARENA
    // ===================================================================
    // Der Swipe-Stapel kommt ausschließlich aus dem Live-Katalog (DE/EN/JP, client/arena.js → /api/swipe/deck).
    // Die festen REAL_CARDS oben dienen nur noch als Beispiele (Test-Push, Rip-or-Keep) und landen NIE im Stapel.
    let activeDeck = [];
    let swipeIdx = 0;
    let savedMatches = lsJSON("pokeswipe_matches_clean", []);

    const SWIPE_LANG = { de: "🇩🇪 Deutsch", en: "🇬🇧 Englisch", ja: "🇯🇵 Japanisch" };

    /**
     * Ersetzt (oder ergänzt) den Swipe-Stapel – die dynamische Arena (client/arena.js) liefert Karten aus dem
     * mehrsprachigen Live-Katalog und Tausch-Inserate. Ohne Verbindung bleibt der feste Chase-Katalog aktiv.
     */
    function setSwipeDeck(items, append = false) {
      if (!Array.isArray(items) || !items.length) return false;
      if (append) {
        const known = new Set(activeDeck.map((c) => c.key || c.id));
        const add = items.filter((c) => !known.has(c.key || c.id));
        const rest = activeDeck.slice(swipeIdx % activeDeck.length);
        activeDeck = rest.concat(add);
        swipeIdx = 0;
      } else {
        activeDeck = items.slice();
        swipeIdx = 0;
      }
      renderSwipeCard();
      return true;
    }
    window.setSwipeDeck = setSwipeDeck;
    /** Eine Karte (z. B. frisch gescannt) ganz oben in den Stapel legen – der restliche Stapel bleibt erhalten. */
    window.prependSwipeCard = (item) => {
      if (!item) return false;
      const id = item.key || item.id;
      const n = activeDeck.length;
      const rest = n ? activeDeck.slice(swipeIdx % n).concat(activeDeck.slice(0, swipeIdx % n)) : [];
      activeDeck = [item, ...rest.filter((c) => (c.key || c.id) !== id)];
      swipeIdx = 0;
      renderSwipeCard();
      return true;
    };
    window.currentSwipeItem = () => (activeDeck.length ? activeDeck[swipeIdx % activeDeck.length] : null);

    function renderSwipeLoading() {
      document.getElementById("swipe-rarity").textContent = "Live-Katalog";
      document.getElementById("swipe-title").textContent = "Karten werden geladen …";
      document.getElementById("swipe-set").textContent = "Pokémon TCG – Deutsch, Englisch & Japanisch";
      ["swipe-cm", "swipe-price", "swipe-margin"].forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = "–"; });
      const kindEl = document.getElementById("swipe-kind");
      if (kindEl) kindEl.classList.add("hidden");
      const img = document.getElementById("swipe-img");
      if (img && img.getAttribute("src") !== "/card-fallback.svg") img.src = "/card-fallback.svg";
    }

    function renderSwipeCard() {
      if (!activeDeck.length) return renderSwipeLoading();
      const item = activeDeck[swipeIdx % activeDeck.length];
      const isListing = item.kind === "listing";
      // item.price ist nur ein echtes Angebot (Inserat bzw. verifiziertes Live-Angebot), sonst 0 – nie der Cardmarket-„ab“-Preis
      const offer = Number(item.price) || 0;
      const diff = offer > 0 && item.cm > offer ? item.cm - offer : 0;
      const pct = diff > 0 ? Math.round((diff / item.cm) * 100) : 0;

      document.getElementById("swipe-rarity").textContent = item.rarity || "Karte";
      document.getElementById("swipe-title").textContent = item.title;
      document.getElementById("swipe-set").textContent = item.setFull || item.setTag || "";
      const langEl = document.getElementById("swipe-lang");
      if (langEl) langEl.textContent = SWIPE_LANG[item.lang || "de"] || SWIPE_LANG.de;
      const kindEl = document.getElementById("swipe-kind");
      if (kindEl) {
        const label = isListing ? (item.boosted ? "🚀 Top-Inserat" : "🤝 Tausch-Inserat") : (pct > 0 ? `🔥 ${pct} % unter Markt` : (item.wish ? "💛 Auf deiner Wunschliste" : ""));
        kindEl.textContent = label;
        kindEl.classList.toggle("hidden", !label);
      }
      const extra = document.getElementById("swipe-extra");
      if (extra) {
        const text = isListing
          ? `Angebot von ${item.seller || "Sammler"}${item.city ? ` aus ${item.city}` : ""}${item.want ? ` • sucht: ${item.want}` : ""}`
          : (item.usd ? `TCGplayer: ${item.usd.toLocaleString("de-DE", { style: "currency", currency: "USD" })}` : "");
        extra.textContent = text;
        extra.classList.toggle("hidden", !text);
      }
      const cmLabel = document.getElementById("swipe-cm-label");
      if (cmLabel) cmLabel.textContent = item.source === "tcgplayer" ? "Marktwert (TCGplayer, in €)" : "Marktwert (Cardmarket-Trend)";
      const priceLabel = document.getElementById("swipe-price-label");
      if (priceLabel) priceLabel.textContent = isListing ? "Preis im Inserat"
        : offer > 0 ? (item.offerSource === "pokeswipe" ? "PokeSwipe-Angebot" : "Live-Angebot (eBay)") : "Kein günstigeres Live-Angebot";
      document.getElementById("swipe-cm").textContent = item.cm ? fmtEur(item.cm) : "–";
      document.getElementById("swipe-price").textContent = offer > 0 ? fmtEur(offer) : "–";
      document.getElementById("swipe-margin").textContent = diff > 0 ? `-${fmtEur(diff)} (-${pct}%)` : "–";
      const img = document.getElementById("swipe-img");
      delete img.dataset.fallback;
      img.onerror = () => { if (!img.dataset.fallback) { img.dataset.fallback = "1"; img.src = "/card-fallback.svg"; } };
      img.src = item.img || "/card-fallback.svg";
      img.alt = item.title;

      document.getElementById("swipe-ebay-buy").href = buildEbayUrl(item.query, "bin", "swipe");
      document.getElementById("swipe-ebay-auction").href = buildEbayUrl(item.query, "auction", "swipe");
      document.getElementById("swipe-cm-link").href = buildCardmarketUrl(String(item.query || "").replace(/ \d+\/\d+.*$/, ""));
      document.getElementById("swipe-psa-link").href = buildEbayUrl(item.query + " PSA 10", "sold", "swipe-psa");
      try { window.dispatchEvent(new CustomEvent("ps:swipe-render", { detail: item })); } catch (e) {}
      // Vorrat knapp → dynamische Arena lädt Nachschub
      const left = activeDeck.length - (swipeIdx % activeDeck.length) - 1;
      if (left < 6 && typeof window.psArenaNeedMore === "function") { try { window.psArenaNeedMore(); } catch (e) {} }
    }

    function nextSwipeCard(mode) {
      if (!activeDeck.length) return;
      const item = activeDeck[swipeIdx % activeDeck.length];
      if (mode === "match") {
        if (!savedMatches.some(m => m.title === item.title)) {
          savedMatches.unshift({ title: item.title, price: item.price || item.cm || 0, query: item.query });
          localStorage.setItem("pokeswipe_matches_clean", JSON.stringify(savedMatches));
          renderMatches();
        }
        if (typeof window.psArenaMatch === "function") { try { window.psArenaMatch(item); } catch (e) {} }
      }
      // Preference-Learning (client/arena.js): Rechts- und Links-Swipes gewichten den weiteren Stapel (Kauf zählt wie Rechts)
      if (typeof window.psArenaSwipe === "function") { try { window.psArenaSwipe(item, mode === "match" || mode === "buy" ? "right" : "left"); } catch (e) {} }
      swipeIdx = (swipeIdx + 1) % activeDeck.length;
      renderSwipeCard();
    }

    // Letzte Karte zurückholen (versehentlich weggewischt)
    function prevSwipeCard() {
      if (!activeDeck.length || swipeIdx === 0) return false;
      swipeIdx = (swipeIdx - 1 + activeDeck.length) % activeDeck.length;
      renderSwipeCard();
      return true;
    }
    window.prevSwipeCard = prevSwipeCard;

    // Profi-Werte für Einsteiger einzeln aufklappen (Progressive Disclosure)
    function psToggleReveal(group, btn) {
      const el = document.querySelector(`[data-reveal-group="${group}"]`);
      if (!el) return;
      const open = el.classList.toggle("ps-revealed");
      if (btn) { btn.setAttribute("aria-expanded", open ? "true" : "false"); btn.textContent = open ? "📊 Profi-Werte ausblenden" : "📊 Profi-Werte anzeigen"; }
    }

    // Details der aktuellen Karte öffnen (Katalog-Detail, englischer/japanischer Druck oder Tausch-Inserat)
    function psSwipeDetails() {
      const item = activeDeck[swipeIdx % activeDeck.length];
      if (!item || !window.PS) return;
      if (typeof window.psArenaSwipe === "function") { try { window.psArenaSwipe(item, "detail"); } catch (e) {} }
      if (item.kind === "listing" && item.listingId && window.PS.requestTrade) return window.PS.requestTrade(item.listingId);
      if (item.printId && /^(en|ja):/.test(item.printId) && window.PS.openPrint) return window.PS.openPrint(item.printId);
      const id = item.cardId || item.id;
      if (id && window.PS.openCard) return window.PS.openCard(id);
    }

    function renderMatches() {
      document.getElementById("matchCountBadge").textContent = savedMatches.length;
      document.getElementById("statMatches").textContent = savedMatches.length;
      const pfMatches = document.getElementById("statMatchesPf");
      if (pfMatches) pfMatches.textContent = savedMatches.length;
      const box = document.getElementById("match-list-box");
      if (!savedMatches.length) {
        box.innerHTML = `<p class="text-slate-500 py-2">Noch keine Karten gemerkt. Klicke beim Swipen auf „💚 Merken & Deal“.</p>`;
        return;
      }
      box.innerHTML = savedMatches.map((m, i) => `
        <div class="flex items-center justify-between bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl">
          <div class="truncate pr-2">
            <p class="font-bold text-white truncate">${sanitizeHTML(m.title)}</p>
            <p class="text-[11px] text-emerald-400 font-bold">Zielpreis: ${fmtEur(m.price)}</p>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <a href="${buildCardmarketUrl(m.query)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white text-[11px] font-bold px-2 py-1 rounded-lg">CM</a>
            <a href="${buildEbayUrl(m.query, 'bin', 'merkliste')}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white text-[11px] font-bold px-2 py-1 rounded-lg">🛒 eBay*</a>
            <button onclick="removeSavedMatch(${i})" class="text-slate-500 hover:text-rose-400 px-1">✕</button>
          </div>
        </div>
      `).join("");
    }

    function clearMatches() { savedMatches = []; localStorage.removeItem("pokeswipe_matches_clean"); renderMatches(); }

    // ===================================================================
    // 2. FLIP-RADAR & WISHLIST
    // ===================================================================
    let wishlist = lsJSON("pokeswipe_wishlist_clean", []);
    function renderWishlist() {
      const box = document.getElementById("wishlist-rules-box");
      if (!wishlist.length) {
        box.innerHTML = `<span class="text-xs text-slate-500">Noch kein Preis-Wächter aktiv.</span>`;
        return;
      }
      box.innerHTML = wishlist.map((w, i) => `
        <div class="flex items-center gap-2 bg-slate-900 border border-yellow-400/40 px-3 py-1 rounded-full text-xs">
          <span class="text-yellow-300 font-bold">🎯 ${sanitizeHTML(w.card)} &le; ${Number(w.max)} €</span>
          <a href="${buildEbayUrl(w.card, 'bin', 'waechter')}" target="_blank" rel="noopener sponsored" class="text-blue-400 underline font-bold">eBay*</a>
          <a href="${buildCardmarketUrl(w.card)}" target="_blank" rel="noopener" class="text-purple-400 underline font-bold">CM</a>
          <button onclick="removeLocalWish(${i})" class="text-slate-400 hover:text-rose-400">✕</button>
        </div>
      `).join("");
    }

    function addWishlistRule() {
      const card = document.getElementById("wish-card").value.trim();
      const max = parseInt(document.getElementById("wish-max").value, 10);
      if (!card || isNaN(max)) return alert("Bitte Karte und Zielpreis eingeben.");
      wishlist.push({ card, max });
      localStorage.setItem("pokeswipe_wishlist_clean", JSON.stringify(wishlist));
      document.getElementById("wish-card").value = "";
      document.getElementById("wish-max").value = "";
      renderWishlist();
      triggerSmartPush("🎯 Preis-Wächter aktiv!", `Wir überwachen "${card}" unter ${max} € für dich.`, buildEbayUrl(card, "bin"));
    }

    // Flip-Radar: echte Karten, bei denen das günstigste Cardmarket-Angebot unter dem Trend liegt
    let communityDeals = [];
    function buildFlipDeals() {
      const real = REAL_CARDS.filter((c) => c.trend > 0 && c.low > 0 && c.low < c.trend).map((c) => ({
        name: `${cardLabel(c)} – ${c.setTag}`, category: "singles", cmPrice: c.trend, ebayPrice: c.low, query: c.query, img: c.img, source: "Cardmarket ab",
      })).sort((a, b) => (b.cmPrice - b.ebayPrice) / b.cmPrice - (a.cmPrice - a.ebayPrice) / a.cmPrice);
      return communityDeals.concat(real);
    }
    let flipDeals = buildFlipDeals();

    function filterFlipDeals(cat = "all") {
      // Wird von der Pro-Version weiter unten ersetzt (Sniper-Deals)
      const items = cat === "all" ? flipDeals : flipDeals.filter(d => d.category === cat);
      document.getElementById("flip-list").innerHTML = items.map(d => `
        <div class="poke-glass rounded-2xl p-4 text-xs"><p class="font-bold text-white">${sanitizeHTML(d.name)}</p>
        <a href="${buildEbayUrl(d.query, 'bin', 'flip')}" target="_blank" rel="noopener sponsored" class="text-blue-400 underline">eBay*</a></div>`).join("");
    }

    function submitCommunityDeal() {
      const title = document.getElementById("rep-title").value.trim();
      const price = parseInt(document.getElementById("rep-price").value, 10);
      if (!title || isNaN(price) || price <= 0) return alert("Bitte Titel und Preis angeben.");
      if (!cooldownOk("deal")) return;
      const t = title.toLowerCase();
      const match = REAL_CARDS.find((c) => t.includes(c.num.split("/")[0]) && t.includes(c.name.toLowerCase().split(/[- ]/)[0]));
      communityDeals.unshift({ name: title.slice(0, 120), category: "singles", cmPrice: match ? match.trend : 0, ebayPrice: price, query: match ? match.query : title, source: "Community-Meldung" });
      flipDeals = buildFlipDeals();
      document.getElementById("rep-title").value = "";
      document.getElementById("rep-price").value = "";
      filterFlipDeals("all");
      triggerSmartPush("🚨 Neuer Community-Deal!", `${title} für ${price} € gemeldet!`, buildEbayUrl(title, "bin"));
    }

    // ===================================================================
    // 3. PULL-WALL & LIVE-CHAT
    // ===================================================================
    let pendingWallImg = "";
    let dbRefWall = null;
    let dbRefChat = null;
    let wallPosts = [];
    let initialWallLoaded = false;

    function previewWallImage(e) {
      compressImage(e.target.files[0], data => {
        pendingWallImg = data;
        const prev = document.getElementById("wall-preview");
        prev.src = data;
        prev.classList.remove("hidden");
      });
    }

    function publishWallPost() {
      const user = (getCurrentUser() || "Sammler").slice(0, 35);
      const caption = document.getElementById("wall-caption").value.trim().slice(0, 300);
      const num = document.getElementById("wall-cardnum").value.trim();
      if (!caption && !pendingWallImg && !num) return alert("Bitte Foto, Kartennummer oder Beschreibung eingeben.");
      if (!cooldownOk("wall")) return;

      let img = pendingWallImg;
      if (!img && num) img = resolveCard(num).img;
      if (!img) img = FALLBACK_CARD_IMG;

      const postObj = {
        user,
        caption: caption || "Neuer Community-Hit!",
        img,
        timestamp: Date.now()
      };

      if (!dbRefWall) return alert("Die Pull-Wall ist gerade nicht erreichbar. Bitte später erneut versuchen.");
      fbPush("pullwall", "wall", postObj).catch(err => alert("Fehler beim Senden: " + fbErrorText(err)));
      pendingWallImg = "";
      document.getElementById("wall-caption").value = "";
      document.getElementById("wall-cardnum").value = "";
      document.getElementById("wall-preview").classList.add("hidden");
    }

    function likeWallPost(key) {
      key = safeKey(key);
      if (!dbRefWall || !key) return;
      const liked = lsJSON("pokeswipe_liked", []);
      if (liked.includes(key)) return triggerSmartPush("❤️ Schon geliked", "Pro Beitrag zählt ein Like.");
      if (!cooldownOk("like")) return;
      liked.push(key);
      localStorage.setItem("pokeswipe_liked", JSON.stringify(liked.slice(-500)));
      fbLike(key).catch((err) => console.warn("Like nicht gespeichert", err));
    }

    function addWallComment(key, idx) {
      key = safeKey(key);
      const inp = document.getElementById(`wall-cmt-${Number(idx)}`);
      if (!inp || !dbRefWall || !key) return;
      const text = inp.value.trim().slice(0, 300);
      if (!text) return;
      if (DUMMY_RE.test(text)) return alert("Bitte einen echten Kommentar schreiben.");
      if (!cooldownOk("comment")) return;
      const author = (getCurrentUser() || "Sammler").slice(0, 35);
      fbPush(`pullwall/${key}/comments`, "comment", { author, text, timestamp: Date.now() }).catch((err) => alert("Kommentar konnte nicht gesendet werden: " + fbErrorText(err)));
      inp.value = "";
    }

    function renderPullWall() {
      const box = document.getElementById("pullwall-feed");
      if (!wallPosts.length) {
        box.innerHTML = `<div class="poke-glass rounded-2xl p-6 text-center text-xs text-slate-400">Noch keine Pulls gepostet – teile jetzt deinen ersten Hit!</div>`;
        return;
      }
      box.innerHTML = wallPosts.map((p, idx) => {
        const comments = p.comments ? Object.values(p.comments).filter((c) => !isDummyEntry(c, { textFields: ["text"] })).slice(-30) : [];
        const key = safeKey(p.firebaseKey);
        return `
          <div class="poke-glass rounded-2xl p-4 space-y-3">
            <div class="flex justify-between items-center text-xs">
              <strong class="text-yellow-400">${sanitizeHTML(p.user)}</strong>
              <span class="text-slate-500">${new Date(p.timestamp || Date.now()).toLocaleDateString("de-DE")}</span>
            </div>
            <p class="text-xs sm:text-sm text-white" data-i18n-skip>${sanitizeHTML(p.caption)}</p>
            <div class="bg-slate-950 rounded-xl p-2 flex justify-center">
              <img src="${/^(data:image\/(jpeg|png|webp);base64,|https:\/\/|\/(?!\/))/.test(String(p.img || "")) ? sanitizeHTML(p.img) : FALLBACK_CARD_IMG}" alt="Pull" loading="lazy" class="max-h-56 rounded-lg object-contain" />
            </div>
            <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
              <button onclick="likeWallPost('${key}')" class="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-bold px-3 py-1 rounded-lg">
                ❤️ Gefällt mir (${Number(p.likes || 0)})
              </button>
              <span class="text-slate-400">💬 ${comments.length} Kommentare</span>
            </div>
            ${comments.length ? `<div class="space-y-1 bg-slate-950 p-2.5 rounded-xl text-xs">${comments.map(c => `<div><strong class="text-yellow-400">${sanitizeHTML(c.author)}:</strong> <span class="text-slate-200">${sanitizeHTML(c.text)}</span></div>`).join("")}</div>` : ""}
            <div class="flex gap-2">
              <input id="wall-cmt-${idx}" type="text" maxlength="300" placeholder="Kommentar schreiben..." onkeydown="if(event.key==='Enter')addWallComment('${key}', ${idx})" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white" />
              <button onclick="addWallComment('${key}', ${idx})" class="bg-slate-800 hover:bg-slate-700 text-yellow-400 font-bold text-xs px-3 py-1.5 rounded-xl">Senden</button>
            </div>
          </div>
        `;
      }).join("");
    }

    function renderChatList(messages) {
      const box = document.getElementById("chat-messages");
      if (!box) return;
      if (!messages || !messages.length) {
        box.innerHTML = `<p class="text-slate-500 text-center py-6">Noch keine Chat-Nachrichten vorhanden. Schreibe die erste Nachricht!</p>`;
        return;
      }
      box.innerHTML = messages.map(m => `
        <div class="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
          <strong class="text-yellow-400">${sanitizeHTML(m.user)}:</strong>
          <span class="text-slate-200 ml-1" data-i18n-skip>${sanitizeHTML(m.text)}</span>
        </div>
      `).join("");
      box.scrollTop = box.scrollHeight;
    }

    function sendChatMessage() {
      const nameInp = document.getElementById("chat-name");
      const textInp = document.getElementById("chat-input");
      const rawName = (nameInp.value.trim() || getCurrentUser() || "Sammler").slice(0, 35);
      const text = textInp.value.trim().slice(0, 500);
      if (!text) return;
      if (DUMMY_RE.test(text) && text.length < 25) return alert("Bitte eine echte Nachricht schreiben.");
      if (!cooldownOk("chat")) return;
      if (rawName) localStorage.setItem("pokeswipe_user", rawName);

      if (!dbRefChat) return alert("Der Live-Chat ist gerade nicht erreichbar. Bitte später erneut versuchen.");
      fbPush("chat", "chat", { user: rawName, text, timestamp: Date.now() }).catch(err => alert("Chat-Fehler: " + fbErrorText(err)));
      textInp.value = "";
    }

    // ===================================================================
    // 4. UNBEGRENZTER TAUSCH-HUB (MASSEN- & STAPEL-INSERATE) + MAP
    // ===================================================================
    let batchRows = [
      { card: "", price: "", want: "", img: "" },
      { card: "", price: "", want: "", img: "" }
    ];
    let mapInstance = null;
    let dbRefRadar = null;
    let dbRefMarket = null;
    let radarUsers = [];
    // Phase 5: Radar-Pins kommen aus /api/radar (client/radar.js)
    window.psSetRadarUsers = function (list) {
      radarUsers = Array.isArray(list) ? list : [];
      renderRadarUsers();
      if (mapInstance) initOrUpdateMap();
    };
    let marketListings = [];
    let initialMarketLoaded = false;

    function toggleBatchMode(mode) {
      document.getElementById("batch-mode-rows").classList.toggle("hidden", mode !== "rows");
      document.getElementById("batch-mode-text").classList.toggle("hidden", mode !== "text");
      document.getElementById("modebtn-rows").className = mode === "rows" ? "bg-yellow-400 text-slate-950 font-black px-2.5 py-1 rounded-lg" : "text-slate-300 font-bold px-2.5 py-1 rounded-lg";
      document.getElementById("modebtn-text").className = mode === "text" ? "bg-yellow-400 text-slate-950 font-black px-2.5 py-1 rounded-lg" : "text-slate-300 font-bold px-2.5 py-1 rounded-lg";
    }

    function syncBatchRowsFromDOM() {
      batchRows.forEach((r, idx) => {
        const cEl = document.getElementById(`brow-card-${idx}`);
        const pEl = document.getElementById(`brow-price-${idx}`);
        const wEl = document.getElementById(`brow-want-${idx}`);
        if (cEl) r.card = cEl.value;
        if (pEl) r.price = pEl.value;
        if (wEl) r.want = wEl.value;
      });
    }

    function renderBatchRows() {
      const container = document.getElementById("dynamic-rows-container");
      container.innerHTML = batchRows.map((r, idx) => `
        <div class="bg-slate-900/95 border border-slate-700 rounded-xl p-2.5 flex flex-wrap sm:flex-nowrap items-center gap-2">
          <span class="text-[11px] font-black text-yellow-400 w-5">#${idx + 1}</span>
          ${r.img ? `<img src="${sanitizeHTML(r.img)}" class="w-8 h-10 object-contain rounded border border-yellow-400 shrink-0" />` : ""}
          <input id="brow-card-${idx}" type="text" maxlength="120" value="${sanitizeHTML(r.card)}" placeholder="Karte oder Nr. (z. B. 238/191)" class="flex-1 min-w-[130px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs" />
          <input id="brow-price-${idx}" type="number" min="0" value="${sanitizeHTML(r.price)}" placeholder="€" class="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs" />
          <input id="brow-want-${idx}" type="text" value="${sanitizeHTML(r.want)}" placeholder="Suche (optional)" class="w-28 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs" />
          <button onclick="removeCardRow(${idx})" class="text-slate-400 hover:text-rose-400 font-bold px-1.5">✕</button>
        </div>
      `).join("");
    }

    function addCardRow() {
      syncBatchRowsFromDOM();
      batchRows.push({ card: "", price: "", want: "", img: "" });
      renderBatchRows();
    }

    function addFiveCardRows() {
      syncBatchRowsFromDOM();
      for (let i = 0; i < 5; i++) batchRows.push({ card: "", price: "", want: "", img: "" });
      renderBatchRows();
    }

    function removeCardRow(idx) {
      syncBatchRowsFromDOM();
      batchRows.splice(idx, 1);
      if (!batchRows.length) batchRows.push({ card: "", price: "", want: "", img: "" });
      renderBatchRows();
    }

    function handleMultiPhotoSelect(e) {
      syncBatchRowsFromDOM();
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      // Leere Standardzeilen entfernen, wenn Fotos geladen werden
      batchRows = batchRows.filter(r => r.card.trim() !== "" || r.img !== "");
      let processed = 0;
      files.forEach((file, i) => {
        compressImage(file, dataUrl => {
          const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").slice(0, 80);
          batchRows.push({ card: cleanName || `Pokémon Karte #${i + 1}`, price: "25", want: "", img: dataUrl });
          processed++;
          if (processed === files.length) renderBatchRows();
        });
      });
    }

    function publishSingleMarketObject(cardStr, priceNum, wantStr, cityStr, customImg = "") {
      const cleanCard = cardStr.trim().slice(0, 120);
      if (!cleanCard) return false;
      const resolved = resolveCard(cleanCard);
      const finalPrice = isNaN(priceNum) || priceNum < 0 ? resolved.value : priceNum;
      const seller = (getCurrentUser() || "Sammler").slice(0, 35);

      const offer = {
        card: cleanCard,
        want: (wantStr || "Tausch / Gebot").slice(0, 120),
        price: Number(finalPrice),
        seller,
        city: (cityStr || "Deutschland").slice(0, 60),
        img: customImg || resolved.img,
        ownerId: getOwnerId(),
        timestamp: Date.now()
      };

      if (dbRefMarket) dbRefMarket.push(offer);
      return true;
    }

    function submitAllCardRows() {
      syncBatchRowsFromDOM();
      const city = document.getElementById("batch-city").value.trim() || "Deutschland";
      const defaultWant = document.getElementById("batch-want-default").value.trim() || "Tausch / Gebot";
      let count = 0;

      batchRows.forEach(r => {
        if (r.card && r.card.trim()) {
          const p = parseEuroPrice(r.price);
          if (publishSingleMarketObject(r.card, p, r.want || defaultWant, city, r.img)) count++;
        }
      });

      if (count === 0) return alert("Bitte mindestens eine Karte in den Zeilen eintragen!");
      batchRows = [{ card: "", price: "", want: "", img: "" }, { card: "", price: "", want: "", img: "" }];
      renderBatchRows();
      triggerSmartPush("⏳ Stapel-Inserat wird gesendet", `${count} Karte(n) werden veröffentlicht – das Ergebnis siehst du gleich.`);
    }

    // Preis aus Eingaben wie „12,50“, „12.50“, „1.234,50 €“ oder „1,234.50“ – vorher wurden alle Nicht-Ziffern
    // entfernt („12,50“ → 1250 €) bzw. per parseInt die Cents abgeschnitten.
    function parseEuroPrice(raw) {
      let s = String(raw ?? "").replace(/[€\s]/g, "").replace(/eur$/i, "");
      if (!s) return NaN;
      const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
      if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
      if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
      const n = Math.round(parseFloat(s) * 100) / 100;
      return Number.isFinite(n) && n >= 0 ? n : NaN;
    }

    function submitBulkTextListings() {
      const rawText = document.getElementById("batch-textarea").value.trim();
      if (!rawText) return alert("Bitte mindestens eine Zeile eingeben.");
      const city = document.getElementById("batch-city").value.trim() || "Deutschland";
      const defaultWant = document.getElementById("batch-want-default").value.trim() || "Tausch / Gebot";

      const lines = rawText.split(/\r?\n/);
      let count = 0;
      lines.forEach(line => {
        if (!line.trim()) return;
        const parts = line.split(/[;|]/).map(s => s.trim());
        const cardName = parts[0];
        const priceVal = parts[1] ? parseEuroPrice(parts[1]) : NaN;
        const wantVal = parts[2] || defaultWant;
        if (publishSingleMarketObject(cardName, priceVal, wantVal, city)) count++;
      });

      if (count > 0) {
        document.getElementById("batch-textarea").value = "";
        triggerSmartPush("⏳ Massen-Import wird gesendet", `${count} Karte(n) werden veröffentlicht – das Ergebnis siehst du gleich.`);
      }
    }

    function deleteMarketItem(key) {
      if (dbRefMarket && key) dbRefMarket.child(key).remove();
    }

    function renderMarket() {
      const box = document.getElementById("market-list");
      const filterStr = (document.getElementById("market-search")?.value || "").toLowerCase().trim();
      const filtered = filterStr
        ? marketListings.filter(m => (m.card || "").toLowerCase().includes(filterStr) || (m.city || "").toLowerCase().includes(filterStr))
        : marketListings;

      document.getElementById("marketTotalBadge").textContent = marketListings.length;
      document.getElementById("statMarketCount").textContent = marketListings.length;

      if (!filtered.length) {
        box.innerHTML = `<div class="poke-glass rounded-2xl p-6 text-center text-xs text-slate-400">Noch keine passenden Inserate vorhanden. Nutze links das Stapel-Inserat!</div>`;
        return;
      }
      const myUid = getOwnerId();
      box.innerHTML = filtered.map(item => `
        <div class="poke-glass rounded-2xl p-3.5 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 truncate">
            <img src="${/^(data:image\/(jpeg|png|webp);base64,|https:\/\/|\/(?!\/))/.test(String(item.img || "")) ? sanitizeHTML(item.img) : FALLBACK_CARD_IMG}" alt="Karte" class="w-12 h-16 object-contain rounded border border-yellow-400/40 shrink-0" />
            <div class="truncate text-xs">
              <span class="font-black text-emerald-400">${Number(item.price || 0)} €</span> • <span class="text-slate-400">📍 ${sanitizeHTML(item.city)} (${sanitizeHTML(item.seller)})</span>
              <h4 class="font-black text-white text-sm truncate">${sanitizeHTML(item.card)}</h4>
              <p class="text-amber-300 truncate">Sucht: ${sanitizeHTML(item.want)}</p>
            </div>
          </div>
          <div class="flex gap-1.5 shrink-0 text-xs">
            <a href="${buildCardmarketUrl(item.card)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-bold px-2.5 py-1.5 rounded-xl">CM</a>
            <a href="${buildEbayUrl(item.card, 'bin', 'tausch')}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2.5 py-1.5 rounded-xl">🛒 eBay*</a>
            ${item.ownerId === myUid && safeKey(item.firebaseKey) ? `<button onclick="deleteMarketItem('${safeKey(item.firebaseKey)}')" class="bg-rose-500/20 text-rose-300 font-bold px-2.5 py-1.5 rounded-xl">🗑️</button>` : ""}
          </div>
        </div>
      `).join("");
    }

    // KARTE & RADAR
    function initOrUpdateMap() {
      // Leaflet lädt per defer – bei sehr frühem Aufruf (z. B. ?tab=map) bis zum Seitenende warten
      // Leaflet wird erst beim Öffnen der Karte geladen (spart ~150 KB beim Seitenstart)
      if (typeof L === "undefined") {
        loadScriptOnce("/vendor/leaflet/leaflet.js").then(() => { if (typeof L !== "undefined") initOrUpdateMap(); })
          .catch((e) => console.warn("Karte konnte nicht geladen werden", e));
        return;
      }
      if (!mapInstance) {
        mapInstance = L.map("radarMap").setView([51.1657, 10.4515], 6);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(mapInstance);
      }
      if (!mapInstance._psLayer) mapInstance._psLayer = L.layerGroup().addTo(mapInstance);
      mapInstance._psLayer.clearLayers();
      radarUsers.forEach(u => {
        if (Number.isFinite(Number(u.lat)) && Number.isFinite(Number(u.lng)) && u.lat && u.lng) {
          L.marker([coarseCoord(u.lat), coarseCoord(u.lng)]).addTo(mapInstance._psLayer)
            .bindPopup(`<b>${sanitizeHTML(u.name)}</b> (${sanitizeHTML(u.city)})<br>${sanitizeHTML(u.cards)}`);
        }
      });
      setTimeout(() => mapInstance.invalidateSize(), 150);
    }

    function locateUserOnMap() {
      if (!navigator.geolocation) return alert("GPS nicht unterstützt.");
      navigator.geolocation.getCurrentPosition(pos => {
        if (mapInstance) {
          const ll = [pos.coords.latitude, pos.coords.longitude];
          mapInstance.setView(ll, 12);
          // Nur EIN Standort-Marker (vorher stapelte jeder Klick einen weiteren)
          if (mapInstance._psMe) mapInstance._psMe.setLatLng(ll);
          else mapInstance._psMe = L.marker(ll).addTo(mapInstance).bindPopup("📍 Dein Standort (nur für dich sichtbar)");
          mapInstance._psMe.openPopup();
        }
      }, () => alert("Standort nicht verfügbar – bitte Standortfreigabe im Browser erlauben."), { timeout: 8000 });
    }

    function registerMyRadarPin() {
      const name = (document.getElementById("radar-my-name").value.trim() || getCurrentUser() || "Sammler").slice(0, 35);
      const city = document.getElementById("radar-my-city").value.trim().slice(0, 60);
      const cards = document.getElementById("radar-my-cards").value.trim().slice(0, 120);
      if (!city || !cards) return alert("Bitte Ort und Karten angeben.");
      if (DUMMY_RE.test(`${name} ${city} ${cards}`)) return alert("Bitte echte Angaben eintragen.");
      if (!cooldownOk("radar")) return;

      const savePin = (lat, lng) => {
        // Datenschutz: nur ungefährer Standort (~1 km Raster) wird öffentlich gespeichert – nie die exakte GPS-Position
        const pin = { name, city, lat: coarseCoord(lat), lng: coarseCoord(lng), cards, timestamp: Date.now() };
        if (!dbRefRadar) return alert("Das Sammler-Radar ist gerade nicht erreichbar. Bitte später erneut versuchen.");
        fbReady.then(() => dbRefRadar.child(fbOwnerKey()).set(pin))
          .then(() => triggerSmartPush("📍 Radar-Pin gesetzt!", `${name} (${city}) ist jetzt (ungefähr, ~1 km genau) auf der Sammler-Karte sichtbar.`))
          .catch((err) => alert("Radar-Pin konnte nicht gespeichert werden: " + fbErrorText(err)));
      };

      // Ohne GPS: Stadt über OpenStreetMap suchen (keine erfundenen Koordinaten)
      const geocode = async () => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de,at,ch&q=${encodeURIComponent(city)}`, { headers: { "Accept-Language": "de" }, signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
          if (!res.ok) throw new Error("Geocoding " + res.status);
          const hit = (await res.json())[0];
          if (hit) return savePin(Number(hit.lat), Number(hit.lon));
        } catch (e) {}
        alert("Ort nicht gefunden. Bitte Stadt oder PLZ genauer angeben oder GPS erlauben.");
      };
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => savePin(pos.coords.latitude, pos.coords.longitude), geocode, { timeout: 8000 });
      } else {
        geocode();
      }
    }

    function renderRadarUsers() {
      const box = document.getElementById("radar-user-list");
      if (!radarUsers.length) {
        box.innerHTML = `<p class="text-xs text-slate-500 col-span-2">Noch keine Sammler-Pins eingetragen. Setze jetzt den ersten Pin!</p>`;
        return;
      }
      box.innerHTML = radarUsers.map(u => `
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-3 flex justify-between items-center text-xs">
          <div>
            <p class="font-bold text-white">${sanitizeHTML(u.name)} <span class="text-yellow-400">(${sanitizeHTML(u.city)})</span></p>
            <p class="text-slate-400 mt-0.5">🃏 ${sanitizeHTML(u.cards)}</p>
          </div>
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(u.city)}" target="_blank" rel="noopener" class="bg-blue-600/20 text-blue-300 border border-blue-500/30 font-bold px-2.5 py-1.5 rounded-lg shrink-0">🗺️ Route</a>
        </div>
      `).join("");
    }

    // ===================================================================
    // 5. PORTFOLIO & RECHNER
    // ===================================================================
    let portfolio = lsJSON("pokeswipe_portfolio_clean", []);

    function renderPortfolio() {
      const total = portfolio.reduce((sum, item) => sum + Number(item.value || 0), 0);
      const formatted = `${total.toFixed(2).replace(".", ",")} €`;
      document.getElementById("portfolio-total").textContent = formatted;
      document.getElementById("statPortfolioVal").textContent = formatted;

      const box = document.getElementById("portfolio-list");
      if (!portfolio.length) {
        box.innerHTML = `<p class="text-xs text-slate-500 py-4 text-center">Dein Portfolio startet bei 0,00 €. Scanne oben eine Kartennummer oder füge Karten hinzu.</p>`;
        return;
      }
      box.innerHTML = portfolio.map((item, idx) => `
        <div class="flex items-center justify-between bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl text-xs">
          <div class="flex items-center gap-2.5 truncate">
            <img src="${/^(data:image\/(jpeg|png|webp);base64,|https:\/\/|\/(?!\/))/.test(String(item.img || "")) ? sanitizeHTML(item.img) : FALLBACK_CARD_IMG}" alt="Card" loading="lazy" class="w-8 h-11 object-contain rounded shrink-0" />
            <div class="truncate">
              <p class="font-bold text-white truncate">${sanitizeHTML(item.name)}</p>
              <p class="text-emerald-400 font-bold">${Number(item.value) > 0 ? fmtEur(item.value) : "Wert eintragen"}</p>
            </div>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <a href="${buildCardmarketUrl(item.name)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white font-bold px-2 py-1 rounded-lg">CM</a>
            <a href="${buildEbayUrl(item.name, 'bin', 'portfolio')}" target="_blank" rel="noopener sponsored" class="bg-blue-600 text-white font-bold px-2 py-1 rounded-lg">🛒 eBay*</a>
            <button onclick="removeLocalPortfolioItem(${idx})" class="text-slate-400 hover:text-rose-400 px-1.5">✕</button>
          </div>
        </div>
      `).join("");
    }

    function addCardByNumber() {
      const num = document.getElementById("scan-card-number").value.trim();
      if (!num) return alert("Bitte eine Kartennummer eingeben (z. B. 238/191).");
      const found = resolveCard(num);
      portfolio.unshift({ name: found.name, value: found.value, img: found.img });
      localStorage.setItem("pokeswipe_portfolio_clean", JSON.stringify(portfolio));
      document.getElementById("scan-card-number").value = "";
      renderPortfolio();
      triggerSmartPush("💼 Karte gespeichert!", found.value ? `${found.name} (${fmtEur(found.value)}) ins Portfolio aufgenommen.` : `${found.name} gespeichert – Nummer nicht im Katalog, bitte Wert eintragen oder oben die Live-Suche nutzen.`);
    }

    function addPortfolioItem() {
      const name = document.getElementById("port-name").value.trim();
      const val = parseFloat(document.getElementById("port-value").value);
      if (!name || isNaN(val)) return alert("Bitte Kartenname und Wert eingeben.");
      const found = resolveCard(name);
      portfolio.unshift({ name, value: val, img: found.img });
      localStorage.setItem("pokeswipe_portfolio_clean", JSON.stringify(portfolio));
      document.getElementById("port-name").value = "";
      document.getElementById("port-value").value = "";
      renderPortfolio();
    }

    function addCurrentSwipeToPortfolio() {
      const item = activeDeck[swipeIdx % activeDeck.length];
      if (!item) return;
      portfolio.unshift({ name: item.title, value: item.cm || 0, img: item.img });
      localStorage.setItem("pokeswipe_portfolio_clean", JSON.stringify(portfolio));
      renderPortfolio();
      triggerSmartPush("💼 Zum Portfolio hinzugefügt!", `${item.title} (${fmtEur(item.cm)}) wurde gespeichert.`);
    }

    function calcBulk() {
      const c = parseInt(document.getElementById("bulk-commons").value || 0, 10);
      const h = parseInt(document.getElementById("bulk-holos").value || 0, 10);
      const ex = parseInt(document.getElementById("bulk-hits").value || 0, 10);
      document.getElementById("bulk-result").textContent = `${(c * 0.02 + h * 0.06 + ex * 0.80).toFixed(2).replace(".", ",")} €`;
    }

    function calcGradingProfit() {
      const raw = parseFloat(document.getElementById("grade-raw-price").value || 0);
      const psa10 = parseFloat(document.getElementById("grade-psa10-price")?.value || 0);
      const fee = parseFloat(document.getElementById("grade-fee")?.value || 0);
      const swipeItem = activeDeck[swipeIdx % activeDeck.length];
      const soldLink = document.getElementById("grade-sold-link");
      if (soldLink && swipeItem) soldLink.href = buildEbayUrl(swipeItem.query + " PSA 10", "sold", "grading");
      const cost = raw + fee;
      const net = psa10 * 0.87; // nach ca. 13 % Verkaufsgebühren
      document.getElementById("grade-cost").textContent = raw ? fmtEur(cost) : "–";
      document.getElementById("grade-psa10").textContent = psa10 ? fmtEur(net) : "–";
      const profit = net - cost;
      const pEl = document.getElementById("grade-profit");
      pEl.textContent = raw && psa10 ? `${profit >= 0 ? "+" : "-"}${fmtEur(Math.abs(profit))}` : "–";
      pEl.className = `font-bold ${profit >= 0 ? "text-emerald-400" : "text-rose-400"}`;
      const box = document.getElementById("grade-pro-box");
      if (!box) return;
      if (!raw || !psa10) { box.innerHTML = `<span class="text-slate-400">Trag Rohpreis und PSA-10-Preis ein (Link oben zeigt echte eBay-Verkäufe).</span>`; return; }
      // Gewinnschwelle: Wie oft muss eine 10 kommen? (Rest wird etwa zum Rohpreis verkauft)
      const breakEven = net > raw ? Math.min(100, Math.max(0, (fee / (net - raw)) * 100)) : null;
      const maxBuy = Math.max(0, net * 0.45 + raw * 0.55 - fee);
      const pro = typeof window.isProUser === "function" ? window.isProUser() : false;
      box.innerHTML = pro
        ? `<p class="font-black text-yellow-300">👑 Pro-Analyse</p><p class="text-slate-200">Gewinnschwelle: <strong>${breakEven === null ? "nie (PSA 10 bringt weniger als raw)" : Math.ceil(breakEven) + " % PSA-10-Quote"}</strong> • Empfohlener Max-Einkauf (bei ~45 % PSA-10-Chance): <strong>${fmtEur(maxBuy)}</strong></p>`
        : `<p class="text-slate-300">🔒 <strong class="text-yellow-300">Pro-Analyse:</strong> Gewinnschwelle & empfohlener Max-Einkaufspreis.</p><button onclick="openModal('pro-modal')" class="mt-1.5 bg-yellow-400 text-slate-950 font-black px-3 py-1.5 rounded-lg">Mit Pro-Pass freischalten (4,99 €/Monat)</button>`;
    }

    // PROFIL & PRO
    function saveUserProfile() {
      const raw = document.getElementById("auth-username").value.trim().slice(0, 30);
      if (!raw) return;
      const clean = raw.startsWith("@") ? raw : "@" + raw;
      localStorage.setItem("pokeswipe_user", clean);
      document.getElementById("authBtnText").textContent = clean;
      closeModal("auth-modal");
    }

    function activatePro(plan) {
      // Freischaltung nur nach echter Stripe-Zahlung (läuft über /assets/app.js → Stripe Checkout)
      closeModal("pro-modal");
      if (window.PS && typeof window.PS.checkout === "function") window.PS.checkout(plan === "VIP" || plan === "pro" ? "pro" : "premium");
      else alert("Die Zahlungsseite lädt gerade – bitte in ein paar Sekunden erneut versuchen.");
    }

    // ===================================================================
    // 6. FIREBASE REALTIME SYNC + ECHTZEIT-PUSH-TRIGGER
    // ===================================================================
    function matchesKeywordFilter(textStr) {
      if (!pushSettings.keywords) return true;
      const keys = pushSettings.keywords.toLowerCase().split(",").map(k => k.trim()).filter(Boolean);
      if (!keys.length) return true;
      return keys.some(k => (textStr || "").toLowerCase().includes(k));
    }

    // ---------------------------------------------------------------
    // Firebase-Helfer: optionale anonyme Anmeldung, Schreib-Bremse (rate/…),
    // ein Like pro Person und verständliche Fehlermeldungen
    // ---------------------------------------------------------------
    let fbDb = null;
    let fbUid = null;               // Firebase-Auth-UID (wenn anonyme Anmeldung aktiv)
    let fbReadyResolve;
    const fbReady = new Promise((r) => { fbReadyResolve = r; });
    function fbOwnerKey() { return fbUid || getOwnerId(); }
    function coarseCoord(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
    function fbErrorText(err) {
      const code = String((err && (err.code || err.message)) || "");
      if (/permission|PERMISSION_DENIED/i.test(code)) return "Bitte kurz warten (max. 1 Beitrag alle paar Sekunden) und Eingaben prüfen.";
      if (/network|offline|disconnect/i.test(code)) return "Keine Verbindung – bitte Internet prüfen.";
      return code.slice(0, 120) || "Unbekannter Fehler";
    }
    /** Neuer Eintrag + (bei aktiver Anmeldung) Zeitstempel in rate/<uid>/<kind> in EINEM Schreibvorgang. */
    async function fbPush(path, kind, obj) {
      if (!fbDb) throw new Error("offline");
      await fbReady;
      const root = fbDb.ref("pokeswipe_radar");
      const key = root.child(path).push().key;
      if (!fbUid) return root.child(`${path}/${key}`).set(obj);
      return root.update({
        [`${path}/${key}`]: { ...obj, uid: fbUid },
        [`rate/${fbUid}/${kind}`]: firebase.database.ServerValue.TIMESTAMP,
      });
    }
    /** Like: mit Anmeldung genau einer pro Person (likers/<uid>), sonst wie bisher +1. */
    async function fbLike(postKey) {
      if (!fbDb) throw new Error("offline");
      await fbReady;
      const postRef = fbDb.ref("pokeswipe_radar/pullwall").child(postKey);
      if (!fbUid) return postRef.child("likes").transaction(c => (c === null ? 1 : Math.min(Number(c) + 1, 1e6)));
      for (let attempt = 0; attempt < 3; attempt++) {
        const [likesSnap, mineSnap] = await Promise.all([postRef.child("likes").once("value"), postRef.child("likers").child(fbUid).once("value")]);
        if (mineSnap.exists()) return;
        const cur = Number(likesSnap.val() || 0);
        try {
          return await postRef.update({ likes: cur + 1, [`likers/${fbUid}`]: true });
        } catch (e) {
          if (attempt === 2) throw e; // gleichzeitiges Like eines anderen Nutzers → neu lesen und wiederholen
        }
      }
    }
    async function fbSignIn() {
      try {
        let apiKey = "";
        try {
          const cfg = await Promise.race([publicConfigPromise, new Promise((r) => setTimeout(() => r({}), 2500))]);
          apiKey = String((cfg && cfg.firebaseApiKey) || "");
        } catch (e) {}
        if (!apiKey || !/^[A-Za-z0-9_-]{20,60}$/.test(apiKey)) return null;
        await new Promise((resolve, reject) => {
          if (firebase.auth) return resolve();
          loadScriptOnce(FIREBASE_SDK + "firebase-auth-compat.js").then(resolve, reject);
        });
        const projectId = new URL(firebaseConfig.databaseURL).hostname.split(".")[0].replace(/-default-rtdb$/, "");
        return { apiKey, authDomain: `${projectId}.firebaseapp.com`, projectId };
      } catch (e) {
        console.warn("Firebase-Anmeldung nicht verfügbar – nutze Geräte-ID", e);
        return null;
      }
    }

    // Firebase-Skripte nicht-blockierend nachladen (erst nach dem ersten Bildaufbau, im Leerlauf des Browsers)
    const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.7.1/";
    function loadScriptOnce(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-src="${src}"]`);
        if (existing) { existing.dataset.loaded ? resolve() : (existing.addEventListener("load", resolve, { once: true }), existing.addEventListener("error", reject, { once: true })); return; }
        const sc = document.createElement("script");
        sc.src = src; sc.async = true; sc.dataset.src = src;
        sc.onload = () => { sc.dataset.loaded = "1"; resolve(); };
        sc.onerror = () => reject(new Error("Skript nicht geladen: " + src));
        document.head.appendChild(sc);
      });
    }
    async function loadFirebaseSdk() {
      if (typeof firebase !== "undefined" && firebase.database) return true;
      try {
        await loadScriptOnce(FIREBASE_SDK + "firebase-app-compat.js");
        await loadScriptOnce(FIREBASE_SDK + "firebase-database-compat.js");
        return typeof firebase !== "undefined";
      } catch (e) {
        console.warn("Firebase konnte nicht geladen werden – Live-Bereich offline", e);
        return false;
      }
    }
    function whenIdle(fn) {
      const run = () => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 200));
      if (document.readyState === "complete") run();
      else window.addEventListener("load", run, { once: true });
    }

    function initFirebase() {
      whenIdle(() => { startFirebase(); });
    }
    async function startFirebase() {
      try {
        if (!(await loadFirebaseSdk())) {
          fbReadyResolve();
          return;
        }
        // Optionale anonyme Anmeldung VOR dem Start, damit Datenbank und Auth dieselbe App nutzen
        const authCfg = firebase.apps.length ? null : await fbSignIn();
        if (!firebase.apps.length) firebase.initializeApp(authCfg ? { ...firebaseConfig, ...authCfg } : firebaseConfig);
        const db = fbDb = firebase.database();
        if (authCfg && firebase.auth) {
          try {
            const cred = await Promise.race([
              firebase.auth().signInAnonymously(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("Auth-Timeout")), 6000)),
            ]);
            fbUid = cred && cred.user ? cred.user.uid : null;
          } catch (e) {
            console.warn("Anonyme Firebase-Anmeldung fehlgeschlagen – nutze Geräte-ID", e);
          }
        }
        fbReadyResolve();
        const listen = (ref, event, cb, errCb) => ref.on(event, cb, errCb || ((err) => console.warn("Firebase", ref.toString(), err)));

        // 1. Echter Besucherzähler
        const visitsRef = db.ref("pokeswipe_radar/stats/totalVisits");
        // Schreiben erlauben die Regeln nur mit Firebase-Anmeldung (auth != null) – ohne Anmeldung nur lesen
        if (fbUid && !sessionStorage.getItem("pokeswipe_counted")) {
          visitsRef.transaction(current => (current === null ? 1 : Number(current) + 1), (err, committed) => {
            if (!err && committed) sessionStorage.setItem("pokeswipe_counted", "1");
          });
        }
        listen(visitsRef, "value", snap => {
          const val = Number(snap.val());
          document.getElementById("totalVisitsCount").textContent = val > 0 ? val.toLocaleString("de-DE") : "1";
        });

        // 2. Echte Online-Präsenz (mit Herzschlag, damit verwaiste Einträge nicht mitgezählt werden)
        //    Regel: presence/<uid> darf nur die angemeldete Firebase-UID selbst schreiben (auth.uid === $uid)
        const myPresence = fbUid ? db.ref("pokeswipe_radar/presence/" + fbUid) : null;
        const beat = () => { if (myPresence) myPresence.set({ online: true, ts: firebase.database.ServerValue.TIMESTAMP }).catch(() => {}); };
        const armDisconnect = () => { if (myPresence) myPresence.onDisconnect().remove().catch(() => {}); };
        // Kontolöschung: eigenen Präsenz-Eintrag entfernen und die anonyme Firebase-Kennung verwerfen
        window.psFirebaseForget = async () => {
          const uid = fbUid || "";
          let cleared = false;
          if (myPresence) { try { await myPresence.onDisconnect().cancel(); await myPresence.remove(); cleared = true; } catch (e) {} }
          try { if (firebase.auth && firebase.auth().currentUser) await firebase.auth().currentUser.delete(); } catch (e) {}
          return { uid, cleared };
        };
        beat();
        armDisconnect();
        setInterval(() => { if (document.visibilityState === "visible") beat(); }, 4 * 60 * 1000);
        listen(db.ref(".info/connected"), "value", (snap) => {
          const dot = document.getElementById("liveVisitorCount");
          if (dot) dot.title = snap.val() ? "Live verbunden" : "Verbindung unterbrochen – verbinde neu …";
          if (snap.val()) { armDisconnect(); beat(); }
        });
        listen(db.ref("pokeswipe_radar/presence"), "value", snap => {
          const all = snap.val() || {};
          const cutoff = Date.now() - 10 * 60 * 1000;
          const count = Object.values(all).filter((p) => p && Number(p.ts) > cutoff).length;
          document.getElementById("liveVisitorCount").textContent = Math.max(1, count);
        });

        // 3. + 4. Live-Chat und Pull-Wall laufen seit Phase 4 über die eigene API mit Login-Pflicht,
        //        Wort-/Link-Filter, Limits und Moderation (/api/community/*, siehe client/community.js).
        //        Die alten, anonymen Firebase-Knoten werden nicht mehr gelesen oder beschrieben.

        // 5. Tausch-Hub: läuft jetzt sicher über die eigene API (/api/listings), siehe /assets/app.js

        // 6. Radar-Pins laufen seit Phase 5 über die eigene API mit Login-Pflicht, Filter, Melden/Blockieren und
        //    serverseitiger Koordinaten-Rundung auf ~1 km (/api/radar, siehe client/radar.js). Der alte, anonym
        //    beschreibbare Firebase-Knoten radar_users wird weder gelesen noch beschrieben.

      } catch (e) {
        fbReadyResolve();
        console.warn("Firebase Info:", e);
      }
    }

    // ===================================================================
    // LIVE-PREISE: echte Cardmarket-Werte für den ganzen Katalog (Server-Cache, 1 Anfrage)
    // ===================================================================
    let livePriceDate = PRICE_SNAPSHOT_DATE;
    async function refreshLivePrices() {
      try {
        const ids = REAL_CARDS.map((c) => c.id).join(",");
        const res = await fetch(`/api/prices?ids=${encodeURIComponent(ids)}`, { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const { prices } = await res.json();
        let newest = 0;
        REAL_CARDS.forEach((c) => {
          const p = prices && prices[c.id];
          if (!p) return;
          if (p.trend > 0) c.trend = p.trend;
          if (p.low > 0) c.low = p.low;
          if (p.avg30 > 0) c.avg30 = p.avg30;
          if (p.updated) newest = Math.max(newest, Date.parse(p.updated) || 0);
          if (cardCatalog[c.num]) cardCatalog[c.num].value = c.trend;
        });
        if (newest) livePriceDate = new Date(newest).toLocaleDateString("de-DE");
        flipDeals = buildFlipDeals();
        safeRun("Swipe", renderSwipeCard);
        safeRun("Flip", () => window.filterFlipDeals("all"));
        safeRun("Rip or Keep", () => window.calcRipOrKeep && window.calcRipOrKeep());
      } catch (e) {
        console.warn("Live-Preise nicht geladen – zeige Stand " + PRICE_SNAPSHOT_DATE, e);
      }
    }

    // TOUCH-SWIPEN: Karte nach rechts = merken, nach links = weiter (Handy & Maus)
    function initTouchSwipe() {
      const img = document.getElementById("swipe-img");
      if (!img) return;
      const hintL = document.getElementById("swipe-hint-left"), hintR = document.getElementById("swipe-hint-right");
      let startX = 0, startY = 0, dx = 0, active = false, horizontal = null;
      const reset = () => {
        img.style.transition = "transform .25s ease";
        img.style.transform = "";
        if (hintL) hintL.style.opacity = "0";
        if (hintR) hintR.style.opacity = "0";
      };
      img.addEventListener("pointerdown", (e) => {
        active = true; horizontal = null; dx = 0; startX = e.clientX; startY = e.clientY;
        img.style.transition = "none";
        try { img.setPointerCapture(e.pointerId); } catch (err) {}
      });
      img.addEventListener("pointermove", (e) => {
        if (!active) return;
        const mx = e.clientX - startX, my = e.clientY - startY;
        if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horizontal = Math.abs(mx) > Math.abs(my);
        if (!horizontal) return;
        dx = mx;
        img.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
        if (hintL) hintL.style.opacity = dx < -30 ? String(Math.min(1, -dx / 110)) : "0";
        if (hintR) hintR.style.opacity = dx > 30 ? String(Math.min(1, dx / 110)) : "0";
      });
      const end = () => {
        if (!active) return;
        active = false;
        const go = Math.abs(dx) > 90 && horizontal;
        const dir = dx;
        if (go) {
          img.style.transition = "transform .2s ease";
          img.style.transform = `translateX(${dir > 0 ? 420 : -420}px) rotate(${dir > 0 ? 18 : -18}deg)`;
          if (navigator.vibrate) navigator.vibrate(12);
          setTimeout(() => {
            img.style.transition = "none";
            img.style.transform = "";
            window.nextSwipeCard(dir > 0 ? "match" : "skip");
            if (hintL) hintL.style.opacity = "0";
            if (hintR) hintR.style.opacity = "0";
          }, 190);
        } else reset();
      };
      img.addEventListener("pointerup", end);
      img.addEventListener("pointercancel", end);
      // Tastatur: Pfeil links/rechts im Swipe-Reiter
      document.addEventListener("keydown", (e) => {
        if (document.getElementById("view-swipe")?.classList.contains("hidden")) return;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
        if (e.key === "ArrowRight") window.nextSwipeCard("match");
        if (e.key === "ArrowLeft") window.nextSwipeCard("skip");
      });
    }

    // NAVIGATION (5 HAUPTBEREICHE): Entdecken · Scanner & Sammlung · Marktplatz & Tausch · Radar · Profil
    // Bereich → Navigationspunkt (Sammlung gehört zum Scanner, Community wird aus „Entdecken“ geöffnet)
    const NAV_OF = { swipe: "swipe", scan: "scan", portfolio: "scan", map: "map", flip: "flip", community: "swipe", profile: "profile" };
    function switchTab(tab) {
      const tabs = ["swipe", "scan", "flip", "community", "map", "portfolio", "profile"];
      if (!tabs.includes(tab)) tab = "swipe";
      tabs.forEach(t => {
        document.getElementById(`view-${t}`)?.classList.add("hidden");
        const desk = document.getElementById(`tab-${t}`);
        if (desk) desk.className = "tab-btn text-slate-200 hover:text-white font-extrabold py-2.5 px-3 rounded-xl text-xs transition flex items-center justify-center gap-1.5";
        const mob = document.getElementById(`mob-${t}`);
        if (mob) mob.className = "mob-nav text-slate-300 py-1.5 rounded-xl flex flex-col items-center";
      });

      document.getElementById(`view-${tab}`).classList.remove("hidden");
      const navKey = NAV_OF[tab] || tab;
      // Eigener Reiter (z. B. Sammlung, Community) hat Vorrang, sonst der übergeordnete Hauptbereich
      const activeDesk = document.getElementById(`tab-${tab}`) || document.getElementById(`tab-${navKey}`);
      if (activeDesk) activeDesk.className = "tab-btn bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black py-2.5 px-3 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow";
      const activeMob = document.getElementById(`mob-${tab}`) || document.getElementById(`mob-${navKey}`);
      if (activeMob) activeMob.className = "mob-nav bg-yellow-400 text-slate-950 font-black py-1.5 rounded-xl flex flex-col items-center";

      if (tab === "map") initOrUpdateMap();
      try { window.dispatchEvent(new CustomEvent("ps:tab", { detail: tab })); } catch (e) {}
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // START-INITIALISIERUNG
    (function init() {
      const u = getCurrentUser();
      if (u) document.getElementById("authBtnText").textContent = u;
      try { localStorage.removeItem("pokeswipe_packs_count"); localStorage.removeItem("ps_booster_balance"); } catch (e) {}

      [loadPushSettingsUI, hydrateStaticAffiliateLinks, renderSwipeCard, renderMatches, () => filterFlipDeals("all"), renderWishlist,
        renderPullWall, () => renderChatList([]), renderBatchRows, renderRadarUsers, renderMarket, renderPortfolio, calcBulk,
        calcGradingProfit, initFirebase, initTouchSwipe].forEach((fn, i) => safeRun("Start-Schritt " + i, fn));
      refreshLivePrices();
    })();
