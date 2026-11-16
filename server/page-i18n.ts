// PokeSwipe & Radar – Sprachen der öffentlichen, server-gerenderten Seiten (Deutsch + Englisch unter /en/…).
// Reine Funktionen ohne Datenbank (in tests/en-pages.test.ts geprüft):
//   • pt(lang, key, vars)   Texte mit {platzhaltern}; Deutsch ist die Referenz, Englisch muss dieselben Schlüssel/Platzhalter haben
//   • euroL / fmtPct / fmtDate  Zahlen-, Prozent- und Datumsformat je Sprache (de-DE bzw. en-IE)
//   • toEnPath / toDePath / langFromPath / localPath  Pfad-Zuordnung deutsche ↔ englische Seite
//   • hreflangTags / withAppLang  hreflang-Alternativen und App-Deeplinks (?lang=en)
// Hinweis: Texte mit HTML (z. B. „&amp;“) werden roh eingesetzt; Variablen muss der Aufrufer selbst escapen.
import { euroIn } from "./util.ts";

export type Lang = "de" | "en";
export const LANGS: readonly Lang[] = ["de", "en"];
export const LOCALE: Record<Lang, string> = { de: "de-DE", en: "en-IE" };
export const OG_LOCALE: Record<Lang, string> = { de: "de_DE", en: "en_GB" };

const DE = {
  // Rahmen (pageShell)
  "shell.openApp": "App öffnen",
  "shell.switch": "English",
  "shell.footerNote": "Preise: Cardmarket über TCGdex, täglich aktualisiert. *Affiliate-Link (eBay Partner Network): Wir erhalten ggf. eine Provision, für dich ohne Mehrkosten. Pokémon und alle Namen sind Marken ihrer Inhaber; PokeSwipe &amp; Radar ist ein unabhängiges Fanprojekt.",
  "shell.imprint": "Impressum",
  "shell.privacy": "Datenschutz",
  "shell.terms": "AGB",
  "shell.withdrawal": "Widerruf",
  "shell.allSets": "Alle Sets",
  "shell.pokemon": "Pokémon A–Z",
  "shell.sealed": "Displays &amp; ETBs",
  "shell.trends": "Preis-Trends",
  "shell.cancel": "Verträge hier kündigen",
  // Allgemein
  "common.tooMany": "Zu viele Anfragen",
  "common.cardmarket": "Bei Cardmarket ansehen",
  "common.ebay": "🛒 Bei eBay*",
  "common.change30": "{change} (30 Tage)",
  "crumb.start": "Start",
  "crumb.sets": "Sets",
  "crumb.pokemon": "Pokémon A–Z",
  // Preisverlauf
  "chart.empty": "Der Preisverlauf baut sich täglich auf.",
  "chart.aria": "Preisverlauf",
  // Preise nach Zustand
  "cond.title": "📊 Preise nach Zustand",
  "cond.colCondition": "Zustand",
  "cond.colValue": "Wert",
  "cond.colSold": "Verkauft (90 T.)",
  "cond.colLast": "Letzter Verkauf",
  "cond.colAsks": "Ab (Angebote)",
  "cond.note": "Verkäufe und Angebote auf PokeSwipe inkl. anteiligem Versand. „Referenz“ = Cardmarket-Trend (Near Mint) × marktüblicher Zustandsabschlag (EX 85 %, GD 70 %, LP 60 %, PL 45 %, PO 30 %). Ab {min} Verkäufen zählt nur der Verkaufsmedian.",
  "cond.recent": "✅ Zuletzt auf PokeSwipe verkauft",
  // Kartenseite
  "card.notFound": "Karte nicht gefunden",
  "card.notFoundText": "Diese Karte gibt es nicht (mehr).",
  "card.toSearch": "Zur Kartensuche",
  "card.noPrice": "noch kein Preis",
  "card.titlePriceFallback": "aktuell",
  "card.title": "{name} ({set}) – Preis {price} | PokeSwipe & Radar",
  "card.desc": "Aktueller Cardmarket-Preis für {name} aus {set}: {price}{change}. Preisverlauf, Preisalarm und Tauschangebote aus der Community.",
  "card.descChange": " ({change} in 30 Tagen)",
  "card.imgAlt": "{name} Pokémon-Karte",
  "card.number": " • Nr. {n}",
  "card.illustrator": " • Illustration: {n}",
  "card.trend": "Cardmarket-Trend",
  "card.avg7": "Ø 7 Tage",
  "card.avg30": "Ø 30 Tage",
  "card.from": "Ab",
  "card.variants": "Preise je Variante (Near Mint)",
  "card.basePrice": "Basispreis",
  "card.alert": "🎯 Preisalarm setzen",
  "card.wish": "❤️ Auf die Wunschliste",
  "card.list": "🤝 Selbst inserieren",
  "card.ebay": "🛒 Bei eBay kaufen*",
  "card.wishers": "❤️ {n} Sammler suchen diese Karte.",
  "card.type": "Typ: {t}",
  "card.hp": "{n} KP",
  "card.regulation": "Regulation {m}",
  "card.species": "📚 Alle {n} {name}-Karten mit Preisen",
  "card.buyTitle": "🛒 Jetzt kaufen &amp; Angebote",
  "card.shipping": "+ {price} Versand",
  "card.freeShipping": "0 €",
  "card.business": "gewerblich",
  "card.private": "privat",
  "card.pieces": " • {n} Stück",
  "card.addCart": "🛒 In den Warenkorb",
  "card.protection": "🛒 = Kauf mit Käuferschutz direkt in der App: Das Geld wird erst ausgezahlt, wenn du den Erhalt bestätigst. Bei gewerblichen Händlern gilt ein 14-tägiges Widerrufsrecht.",
  "card.noOffers": "Gerade keine Angebote. Setz die Karte auf deine Wunschliste – wir melden uns, sobald sie jemand anbietet.",
  "card.ldRarity": "Seltenheit",
  "card.ldCategory": "Pokémon-Sammelkarte",
  "badge.deal": "🔥 Top-Deal",
  "badge.fair": "✓ Fair",
  "badge.high": "Über Markt",
  // Set-Übersicht
  "sets.otherSets": "Weitere Sets",
  "sets.h1": "Alle deutschen Pokémon-Sets",
  "sets.intro": "{n} Erweiterungen mit Kartenliste und aktuellen Cardmarket-Preisen – von Karmesin &amp; Purpur bis zu den Klassikern.",
  "sets.cards": "{n} Karten",
  "sets.importing": "Der Katalog wird gerade importiert – bitte in Kürze erneut öffnen.",
  "sets.title": "Alle deutschen Pokémon-Sets mit Kartenpreisen | PokeSwipe & Radar",
  "sets.desc": "Alle deutschen Pokémon-TCG-Erweiterungen mit kompletter Kartenliste, aktuellen Cardmarket-Preisen und den wertvollsten Karten je Set.",
  "sets.ldName": "Deutsche Pokémon-Sets",
  // Set-Seite
  "set.notFound": "Set nicht gefunden",
  "set.notFoundText": "Dieses Set ist (noch) nicht im Katalog.",
  "set.allSets": "Alle Sets",
  "set.title": "{name}{abbr} – Kartenliste & Preise{year} | PokeSwipe & Radar",
  "set.desc": "{name}{serie}: alle {n} Karten mit aktuellem Cardmarket-Preis.{top} Set-Wert, Top-10 und Preisalarm.",
  "set.descTop": " Wertvollste Karte: {name} für {price}.",
  "set.released": "Erschienen am {date}",
  "set.cards": "Karten",
  "set.secret": "({a} + {b} Secret)",
  "set.value": "Set-Wert (je 1×)",
  "set.priced": "Mit Preis",
  "set.track": "✅ Set-Fortschritt tracken",
  "set.ebay": "🛒 Display bei eBay*",
  "set.ebayQuery": "Pokemon {name} Display",
  "set.top10": "💎 Die 10 wertvollsten Karten aus {name}",
  "set.list": "📋 Komplette Kartenliste",
  "set.listImporting": "Die Kartenliste wird gerade importiert.",
  "set.priceNote": "Preise: Cardmarket-Trend über TCGdex, werden laufend aktualisiert. Alle Angaben ohne Gewähr.",
  "set.ldName": "{name} – Kartenliste & Preise",
  "set.logoAlt": "{name} Logo",
  // Pokémon A–Z
  "poke.indexH1": "Pokémon-Karten A–Z: Preise für jedes Pokémon",
  "poke.indexIntro": "{n} Pokémon mit allen deutschen Sammelkarten, aktuellem Cardmarket-Preis und der jeweils wertvollsten Karte. Wähle dein Lieblings-Pokémon.",
  "poke.indexTop": "💎 Die gefragtesten Pokémon nach Kartenwert",
  "poke.indexBuilding": "Die Pokémon-Liste wird gerade aus dem Kartenkatalog aufgebaut – bitte in Kürze erneut öffnen.",
  "poke.indexTitle": "Pokémon-Karten A–Z – Preise & Wert jedes Pokémon | PokeSwipe & Radar",
  "poke.indexDesc": "Alle {n} Pokémon mit ihren deutschen Sammelkarten und aktuellen Cardmarket-Preisen: Was ist meine Glurak-, Pikachu- oder Mewtu-Karte wert?",
  "poke.indexLdName": "Pokémon-Karten A–Z",
  // Pokémon-Seite
  "poke.notFound": "Pokémon nicht gefunden",
  "poke.title": "{name} Karten – Wert & Preise aller {n} Karten{alt} | PokeSwipe & Radar",
  "poke.titleAlt": " ({name})",
  "poke.desc": "Alle {n} deutschen {name}-Karten{alt} mit aktuellem Cardmarket-Preis.{top} Preisverlauf, Preisalarm & Tauschangebote.",
  "poke.descAlt": " (engl. {name})",
  "poke.descTop": " Wertvollste: {name} ({set}) für {price}.",
  "poke.faqTopQ": "Was ist die wertvollste {name}-Karte?",
  "poke.faqTopA": "Aktuell ist {card} aus {set} (Nr. {no}) mit einem Cardmarket-Trendpreis von {price} die wertvollste deutsche {name}-Karte.",
  "poke.tcgFallback": "dem Pokémon TCG",
  "poke.faqCountQ": "Wie viele {name}-Karten gibt es?",
  "poke.faqCountA": "Im deutschen Katalog von PokeSwipe & Radar sind {n} {name}-Karten erfasst{priced}.",
  "poke.faqCountPriced": ", {n} davon mit aktuellem Marktpreis",
  "poke.faqValueQ": "Wie viel ist eine {name}-Karte wert?",
  "poke.faqValueA": "Die Preise reichen von etwa {min} bis {max}. Entscheidend sind Set, Seltenheit und Zustand – den genauen Wert deiner Karte siehst du auf der jeweiligen Kartenseite oder per KI-Kartenscan in der App.",
  "poke.h1": "{name}-Karten: alle Preise",
  "poke.dex": "Pokédex Nr. {n}",
  "poke.altName": " • Englisch: {name}",
  "poke.types": " • Typ: {t}",
  "poke.cards": "Karten",
  "poke.mostValuable": "Wertvollste",
  "poke.priced": "Mit Preis",
  "poke.alert": "🎯 Preisalarm für {name}",
  "poke.ebayQuery": "Pokemon {name} Karte",
  "poke.hTop": "💎 Die wertvollsten {name}-Karten",
  "poke.hNew": "🆕 Neueste {name}-Karten",
  "poke.hAll": "📋 Alle {name}-Karten",
  "poke.hFaq": "❓ Häufige Fragen zu {name}-Karten",
  "poke.ldName": "{name}-Karten",
  // Displays & Sealed
  "sealed.crumbHtml": "Displays &amp; Sealed",
  "sealed.crumb": "Displays & Sealed",
  "sealed.indexH1": "Pokémon Displays, ETBs &amp; Boxen: aktuelle Preise",
  "sealed.indexIntro": "{n} versiegelte Produkte mit Marktpreis, UVP-Vergleich und Preis pro Booster. Mit Restock-Alarm verpasst du keinen Display-Drop zum UVP mehr.",
  "sealed.restockOn": "🚨 Restock-Alarm aktivieren",
  "sealed.guide": "Ratgeber: Displays zum UVP",
  "sealed.none": "Noch keine Produkte im Katalog.",
  "sealed.indexTitle": "Pokémon Displays & ETB Preise aktuell – Marktpreis vs. UVP | PokeSwipe & Radar",
  "sealed.indexDesc": "Aktuelle Preise für Pokémon-Displays, Elite-Trainer-Boxen und Top-Trainer-Boxen auf Deutsch: Marktpreis, UVP, Preis pro Booster und Restock-Alarm.",
  "sealed.indexLdName": "Pokémon Displays & Sealed-Produkte",
  "sealed.atUvp": "≈ UVP",
  "sealed.overUvp": "+{change} über UVP",
  "sealed.notFound": "Produkt nicht gefunden",
  "sealed.all": "Alle Displays &amp; Boxen",
  "sealed.product": "Produkt",
  "sealed.title": "{name} – Preis aktuell{price}{uvp} | PokeSwipe & Radar",
  "sealed.titleUvp": " (UVP {price})",
  "sealed.desc": "{name}{set}: aktueller Marktpreis {price}{uvp}{per}. Preisverlauf, Restock-Alarm und Angebote aus der Community.",
  "sealed.descUvp": ", UVP {price}",
  "sealed.descPer": ", {price} pro Booster",
  "sealed.released": "Erschienen {date}",
  "sealed.noPrice": "Noch kein Preis",
  "sealed.refPrice": "Marktpreis (Referenz)",
  "sealed.communityAvg": "Ø Community-Angebote",
  "sealed.uvp": "UVP",
  "sealed.perBooster": "Pro Booster",
  "sealed.offers": "Angebote",
  "sealed.contents": "Inhalt: {c}",
  "sealed.restock": "🚨 Restock-Alarm",
  "sealed.about": "Über das Produkt",
  "sealed.community": "🤝 Angebote aus der Community",
  "sealed.noOffers": "Gerade keine Angebote. Aktiviere den Restock-Alarm, um Drops zum UVP sofort mitzubekommen.",
  "sealed.setLink": "📋 Kartenliste &amp; Preise des Sets",
  // Trends
  "trends.crumb": "Preis-Trends",
  "trends.h1": "Pokémon-Karten Preis-Trends {month}",
  "trends.intro": "Welche Pokémon-Karten steigen gerade im Wert, welche fallen? Vergleich des aktuellen Cardmarket-Trends mit dem 30-Tage-Durchschnitt (Karten ab 3 €). Täglich aktualisiert.",
  "trends.portfolio": "💼 Eigene Sammlung bewerten",
  "trends.up": "📈 Größte Gewinner (30 Tage)",
  "trends.building": "Die Trends bauen sich gerade auf.",
  "trends.down": "📉 Größte Verlierer (30 Tage)",
  "trends.wanted": "❤️ Meistgesuchte Karten der Community",
  "trends.wishers": "❤️ {n} suchen",
  "trends.title": "Pokémon-Karten Preis-Trends {month}: Gewinner & Verlierer | PokeSwipe & Radar",
  "trends.desc": "Welche Pokémon-Karten steigen im Wert? Die größten Preis-Gewinner und -Verlierer der letzten 30 Tage nach Cardmarket-Trend{lead}.",
  "trends.descLead": " – vorne: {name} (+{change})",
  "trends.ldName": "Pokémon-Karten Preis-Gewinner {month}",
  // Händler-Shop
  "shop.respNone": "Antwortzeit: noch keine Daten",
  "shop.resp1h": "Antwortet meist innerhalb 1 Std.",
  "shop.respHours": "Antwortet meist innerhalb {n} Std.",
  "shop.respSameDay": "Antwortet meist am selben Tag",
  "shop.respDays": "Antwortet meist innerhalb {n} Tagen",
  "shop.rating": "⭐ {avg} ({n} Bewertungen)",
  "shop.noRating": "Noch keine Bewertungen",
  "shop.desc": "{title}: {n} Pokémon-Karten-Angebote von {name}{city}. {rating} · {resp}. Verifizierter Pro-Trader auf PokeSwipe & Radar.",
  "shop.descCity": " aus {city}",
  "shop.verified": "✔ Verifizierter Händler",
  "shop.since": "dabei seit {date}",
  "shop.protection": " · 🔒 Käuferschutz verfügbar",
  "shop.active": "aktive Angebote",
  "shop.deals": "abgeschlossene Deals",
  "shop.inventory": "Inventar-Wert",
  "shop.followers": "Follower",
  "shop.allLangs": "Alle Sprachen",
  "shop.langDe": "🇩🇪 Deutsch",
  "shop.langEn": "🇬🇧 Englisch",
  "shop.langJa": "🇯🇵 Japanisch",
  "shop.buyNow": " · 🔒 Sofort-Kauf",
  "shop.empty": "Gerade keine Angebote{filter}.",
  "shop.emptyFilter": " in dieser Sprache",
  "shop.cta": "🤝 In der App anfragen &amp; kaufen",
  "shop.title": "{title} – Pokémon-Karten-Shop | PokeSwipe & Radar",
  "shop.notFoundTitle": "Shop nicht gefunden – PokeSwipe & Radar",
  "shop.notFoundDesc": "Diesen Händler-Shop gibt es nicht (mehr).",
  "shop.notFoundH1": "🏪 Shop nicht gefunden",
  "shop.notFoundText": "Diesen Händler-Shop gibt es nicht (mehr) oder er ist gerade nicht aktiv.",
  "shop.toHub": "Zum Tausch-Hub",
} as const;

export type PageKey = keyof typeof DE;

const EN: Record<PageKey, string> = {
  "shell.openApp": "Open app",
  "shell.switch": "Deutsch",
  "shell.footerNote": "Prices: Cardmarket via TCGdex, updated daily. *Affiliate link (eBay Partner Network): we may earn a commission at no extra cost to you. Pokémon and all names are trademarks of their respective owners; PokeSwipe &amp; Radar is an independent fan project.",
  "shell.imprint": "Imprint",
  "shell.privacy": "Privacy (German)",
  "shell.terms": "Terms (German)",
  "shell.withdrawal": "Withdrawal (German)",
  "shell.allSets": "All sets",
  "shell.pokemon": "Pokémon A–Z",
  "shell.sealed": "Booster boxes &amp; ETBs",
  "shell.trends": "Price trends",
  "shell.cancel": "Cancel contract",
  "common.tooMany": "Too many requests",
  "common.cardmarket": "View on Cardmarket",
  "common.ebay": "🛒 On eBay*",
  "common.change30": "{change} (30 days)",
  "crumb.start": "Home",
  "crumb.sets": "Sets",
  "crumb.pokemon": "Pokémon A–Z",
  "chart.empty": "The price history builds up day by day.",
  "chart.aria": "Price history",
  "cond.title": "📊 Prices by condition",
  "cond.colCondition": "Condition",
  "cond.colValue": "Value",
  "cond.colSold": "Sold (90 d)",
  "cond.colLast": "Last sale",
  "cond.colAsks": "From (listings)",
  "cond.note": "Sales and listings on PokeSwipe incl. pro-rata shipping. “Reference” = Cardmarket trend (Near Mint) × typical condition discount (EX 85%, GD 70%, LP 60%, PL 45%, PO 30%). From {min} sales on, only the sales median counts.",
  "cond.recent": "✅ Recently sold on PokeSwipe",
  "card.notFound": "Card not found",
  "card.notFoundText": "This card doesn't exist (anymore).",
  "card.toSearch": "Go to card search",
  "card.noPrice": "no price yet",
  "card.titlePriceFallback": "& value",
  "card.title": "{name} ({set}) – Price {price} | PokeSwipe & Radar",
  "card.desc": "Current Cardmarket price for {name} from {set}: {price}{change}. Price history, price alerts and trade offers from the community.",
  "card.descChange": " ({change} in 30 days)",
  "card.imgAlt": "{name} Pokémon card",
  "card.number": " • No. {n}",
  "card.illustrator": " • Illustrator: {n}",
  "card.trend": "Cardmarket trend",
  "card.avg7": "Avg. 7 days",
  "card.avg30": "Avg. 30 days",
  "card.from": "From",
  "card.variants": "Prices by variant (Near Mint)",
  "card.basePrice": "base price",
  "card.alert": "🎯 Set price alert",
  "card.wish": "❤️ Add to wishlist",
  "card.list": "🤝 List your own",
  "card.ebay": "🛒 Buy on eBay*",
  "card.wishers": "❤️ {n} collectors are looking for this card.",
  "card.type": "Type: {t}",
  "card.hp": "{n} HP",
  "card.regulation": "Regulation mark {m}",
  "card.species": "📚 All {n} {name} cards with prices",
  "card.buyTitle": "🛒 Buy now &amp; offers",
  "card.shipping": "+ {price} shipping",
  "card.freeShipping": "€0",
  "card.business": "business",
  "card.private": "private",
  "card.pieces": " • {n} available",
  "card.addCart": "🛒 Add to cart",
  "card.protection": "🛒 = purchase with buyer protection directly in the app: the money is only paid out once you confirm receipt. Business sellers grant a 14-day right of withdrawal.",
  "card.noOffers": "No offers right now. Add the card to your wishlist – we'll let you know as soon as someone lists it.",
  "card.ldRarity": "Rarity",
  "card.ldCategory": "Pokémon trading card",
  "badge.deal": "🔥 Top deal",
  "badge.fair": "✓ Fair",
  "badge.high": "Above market",
  "sets.otherSets": "Other sets",
  "sets.h1": "All Pokémon TCG sets",
  "sets.intro": "{n} expansions with full card lists and current Cardmarket prices – from Scarlet &amp; Violet back to the classics.",
  "sets.cards": "{n} cards",
  "sets.importing": "The catalogue is being imported – please check back shortly.",
  "sets.title": "All Pokémon TCG sets with card prices | PokeSwipe & Radar",
  "sets.desc": "All Pokémon TCG expansions with complete card lists, current Cardmarket prices and the most valuable cards of each set.",
  "sets.ldName": "Pokémon TCG sets",
  "set.notFound": "Set not found",
  "set.notFoundText": "This set isn't in the catalogue (yet).",
  "set.allSets": "All sets",
  "set.title": "{name}{abbr} – Card list & prices{year} | PokeSwipe & Radar",
  "set.desc": "{name}{serie}: all {n} cards with current Cardmarket prices.{top} Set value, top 10 and price alerts.",
  "set.descTop": " Most valuable card: {name} at {price}.",
  "set.released": "Released {date}",
  "set.cards": "Cards",
  "set.secret": "({a} + {b} secret)",
  "set.value": "Set value (1× each)",
  "set.priced": "Priced",
  "set.track": "✅ Track set progress",
  "set.ebay": "🛒 Booster box on eBay*",
  "set.ebayQuery": "Pokemon {name} booster box",
  "set.top10": "💎 The 10 most valuable cards from {name}",
  "set.list": "📋 Complete card list",
  "set.listImporting": "The card list is being imported.",
  "set.priceNote": "Prices: Cardmarket trend via TCGdex, updated continuously. All information without guarantee.",
  "set.ldName": "{name} – card list & prices",
  "set.logoAlt": "{name} logo",
  "poke.indexH1": "Pokémon cards A–Z: prices for every Pokémon",
  "poke.indexIntro": "{n} Pokémon with all their trading cards, current Cardmarket prices and the most valuable card of each. Pick your favourite Pokémon.",
  "poke.indexTop": "💎 The most sought-after Pokémon by card value",
  "poke.indexBuilding": "The Pokémon list is being built from the card catalogue – please check back shortly.",
  "poke.indexTitle": "Pokémon cards A–Z – prices & value of every Pokémon | PokeSwipe & Radar",
  "poke.indexDesc": "All {n} Pokémon with their trading cards and current Cardmarket prices: what is my Charizard, Pikachu or Mewtwo card worth?",
  "poke.indexLdName": "Pokémon cards A–Z",
  "poke.notFound": "Pokémon not found",
  "poke.title": "{name} cards – value & prices of all {n} cards{alt} | PokeSwipe & Radar",
  "poke.titleAlt": " ({name})",
  "poke.desc": "All {n} {name} cards{alt} with current Cardmarket prices.{top} Price history, price alerts & trade offers.",
  "poke.descAlt": " (German: {name})",
  "poke.descTop": " Most valuable: {name} ({set}) at {price}.",
  "poke.faqTopQ": "What is the most valuable {name} card?",
  "poke.faqTopA": "Currently {card} from {set} (No. {no}) is the most valuable {name} card, with a Cardmarket trend price of {price}.",
  "poke.tcgFallback": "the Pokémon TCG",
  "poke.faqCountQ": "How many {name} cards are there?",
  "poke.faqCountA": "The PokeSwipe & Radar catalogue lists {n} {name} cards{priced}.",
  "poke.faqCountPriced": ", {n} of them with a current market price",
  "poke.faqValueQ": "How much is a {name} card worth?",
  "poke.faqValueA": "Prices range from about {min} to {max}. Set, rarity and condition make the difference – you can see the exact value of your card on its card page or with the AI card scan in the app.",
  "poke.h1": "{name} cards: all prices",
  "poke.dex": "Pokédex No. {n}",
  "poke.altName": " • German: {name}",
  "poke.types": " • Type: {t}",
  "poke.cards": "Cards",
  "poke.mostValuable": "Most valuable",
  "poke.priced": "Priced",
  "poke.alert": "🎯 Price alert for {name}",
  "poke.ebayQuery": "Pokemon {name} card",
  "poke.hTop": "💎 The most valuable {name} cards",
  "poke.hNew": "🆕 Newest {name} cards",
  "poke.hAll": "📋 All {name} cards",
  "poke.hFaq": "❓ FAQ about {name} cards",
  "poke.ldName": "{name} cards",
  "sealed.crumbHtml": "Booster boxes &amp; sealed",
  "sealed.crumb": "Booster boxes & sealed",
  "sealed.indexH1": "Pokémon booster boxes, ETBs &amp; more: current prices",
  "sealed.indexIntro": "{n} sealed products with market price, RRP comparison and price per booster. With the restock alert you'll never miss a booster box drop at RRP again.",
  "sealed.restockOn": "🚨 Enable restock alert",
  "sealed.guide": "Guide: booster boxes at RRP (German)",
  "sealed.none": "No products in the catalogue yet.",
  "sealed.indexTitle": "Pokémon booster box & ETB prices – market price vs. RRP | PokeSwipe & Radar",
  "sealed.indexDesc": "Current prices for Pokémon booster boxes, Elite Trainer Boxes and Top Trainer Boxes on the German market: market price, RRP, price per booster and restock alerts.",
  "sealed.indexLdName": "Pokémon booster boxes & sealed products",
  "sealed.atUvp": "≈ RRP",
  "sealed.overUvp": "+{change} above RRP",
  "sealed.notFound": "Product not found",
  "sealed.all": "All booster boxes &amp; sealed products",
  "sealed.product": "Product",
  "sealed.title": "{name} – current price{price}{uvp} | PokeSwipe & Radar",
  "sealed.titleUvp": " (RRP {price})",
  "sealed.desc": "{name}{set}: current market price {price}{uvp}{per}. Price history, restock alerts and community offers.",
  "sealed.descUvp": ", RRP {price}",
  "sealed.descPer": ", {price} per booster",
  "sealed.released": "Released {date}",
  "sealed.noPrice": "No price yet",
  "sealed.refPrice": "Market price (reference)",
  "sealed.communityAvg": "Avg. community offers",
  "sealed.uvp": "RRP",
  "sealed.perBooster": "Per booster",
  "sealed.offers": "Offers",
  "sealed.contents": "Contents: {c}",
  "sealed.restock": "🚨 Restock alert",
  "sealed.about": "About the product",
  "sealed.community": "🤝 Community offers",
  "sealed.noOffers": "No offers right now. Enable the restock alert to catch drops at RRP immediately.",
  "sealed.setLink": "📋 Card list &amp; prices of the set",
  "trends.crumb": "Price trends",
  "trends.h1": "Pokémon card price trends {month}",
  "trends.intro": "Which Pokémon cards are rising in value right now, and which are falling? The current Cardmarket trend compared with the 30-day average (cards from €3). Updated daily.",
  "trends.portfolio": "💼 Value your collection",
  "trends.up": "📈 Biggest gainers (30 days)",
  "trends.building": "The trends are still building up.",
  "trends.down": "📉 Biggest losers (30 days)",
  "trends.wanted": "❤️ Most wanted cards in the community",
  "trends.wishers": "❤️ {n} looking",
  "trends.title": "Pokémon card price trends {month}: gainers & losers | PokeSwipe & Radar",
  "trends.desc": "Which Pokémon cards are rising in value? The biggest price gainers and losers of the last 30 days by Cardmarket trend{lead}.",
  "trends.descLead": " – leading: {name} (+{change})",
  "trends.ldName": "Pokémon card price gainers {month}",
  "shop.respNone": "Response time: no data yet",
  "shop.resp1h": "Usually replies within 1 hour",
  "shop.respHours": "Usually replies within {n} hours",
  "shop.respSameDay": "Usually replies the same day",
  "shop.respDays": "Usually replies within {n} days",
  "shop.rating": "⭐ {avg} ({n} reviews)",
  "shop.noRating": "No reviews yet",
  "shop.desc": "{title}: {n} Pokémon card listings by {name}{city}. {rating} · {resp}. Verified Pro Trader on PokeSwipe & Radar.",
  "shop.descCity": " from {city}",
  "shop.verified": "✔ Verified seller",
  "shop.since": "member since {date}",
  "shop.protection": " · 🔒 Buyer protection available",
  "shop.active": "active listings",
  "shop.deals": "completed deals",
  "shop.inventory": "Inventory value",
  "shop.followers": "Followers",
  "shop.allLangs": "All languages",
  "shop.langDe": "🇩🇪 German",
  "shop.langEn": "🇬🇧 English",
  "shop.langJa": "🇯🇵 Japanese",
  "shop.buyNow": " · 🔒 Buy now",
  "shop.empty": "No listings right now{filter}.",
  "shop.emptyFilter": " in this language",
  "shop.cta": "🤝 Request &amp; buy in the app",
  "shop.title": "{title} – Pokémon card shop | PokeSwipe & Radar",
  "shop.notFoundTitle": "Shop not found – PokeSwipe & Radar",
  "shop.notFoundDesc": "This seller shop doesn't exist (anymore).",
  "shop.notFoundH1": "🏪 Shop not found",
  "shop.notFoundText": "This seller shop doesn't exist (anymore) or isn't active right now.",
  "shop.toHub": "Go to the trade hub",
};

export const PAGE_STRINGS: Record<Lang, Record<PageKey, string>> = { de: DE, en: EN };

/** Platzhalter eines Textes, z. B. ["name", "price"]. */
export const placeholders = (s: string) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);

/** Übersetzter Seitentext; {platzhalter} werden durch vars ersetzt (fehlende bleiben stehen). */
export function pt(lang: Lang, key: PageKey, vars: Record<string, string | number> = {}): string {
  const s = PAGE_STRINGS[lang]?.[key] ?? DE[key] ?? key;
  return s.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ---------------------------------------------------------------------------
// Bezeichnungen (Wertelisten)
// ---------------------------------------------------------------------------
/** Zustände (Deutsch: CONDITIONS in market-logic.ts) */
export const CONDITIONS_EN: Record<string, string> = {
  mint: "Mint", nm: "Near Mint", ex: "Excellent", gd: "Good", lp: "Light Played", pl: "Played", po: "Poor", graded: "Graded (slab)", sealed: "Sealed",
};
/** Herkunft des Zustandswerts (Tabelle „Preise nach Zustand“) */
export const SOURCE_NOTES: Record<Lang, Record<string, string>> = {
  de: { sales: "aus Verkäufen", blend: "Verkäufe + Referenz", reference: "Referenz", asks: "günstigstes Angebot", none: "" },
  en: { sales: "from sales", blend: "sales + reference", reference: "reference", asks: "lowest listing", none: "" },
};
/** Sealed-Produktarten (Einzahl) */
export const KIND_LABELS: Record<Lang, Record<string, string>> = {
  de: { display: "Display", etb: "Elite-Trainer-Box", ttb: "Top-Trainer-Box", bundle: "Booster-Bundle", booster: "Booster", tin: "Tin-Box", collection: "Kollektion", other: "Sonstiges" },
  en: { display: "Booster Box", etb: "Elite Trainer Box", ttb: "Top Trainer Box", bundle: "Booster Bundle", booster: "Booster Pack", tin: "Tin", collection: "Collection", other: "Other" },
};
/** Überschrift je Produktart (Mehrzahl). Deutsch bleibt bewusst „<Einzahl>s“ wie bisher. */
export function kindHeading(lang: Lang, kind: string) {
  const label = KIND_LABELS[lang][kind] || kind;
  if (lang === "de") return `${label}s`;
  if (kind === "other") return "Other products";
  return /(x|s|ch|sh)$/i.test(label) ? `${label}es` : `${label}s`;
}
/** Preisvergleich auf der Shop-Seite */
export const PRICE_CHECK_LABELS: Record<Lang, Record<string, string>> = {
  de: { deal: "🔥 Unter Marktwert", fair: "✅ Fairer Preis", high: "über Markt" },
  en: { deal: "🔥 Below market value", fair: "✅ Fair price", high: "above market" },
};
/** Energietypen (TCGdex liefert deutsche Namen) → Englisch */
const TYPES_EN: Record<string, string> = {
  Feuer: "Fire", Wasser: "Water", Pflanze: "Grass", Elektro: "Lightning", Psycho: "Psychic", Kampf: "Fighting",
  Finsternis: "Darkness", Metall: "Metal", Drache: "Dragon", Fee: "Fairy", Farblos: "Colorless",
};
const STAGES_EN: Record<string, string> = { Basis: "Basic", "Phase 1": "Stage 1", "Phase 2": "Stage 2" };
export const typeLabel = (lang: Lang, t: string) => (lang === "en" ? TYPES_EN[t.trim()] || t.trim() : t);
export const stageLabel = (lang: Lang, s: string) => (lang === "en" ? STAGES_EN[s] || s : s);

// ---------------------------------------------------------------------------
// Formate
// ---------------------------------------------------------------------------
/** Euro-Betrag: Deutsch „12,34 €“ (identisch mit euro() aus util.ts), Englisch „€12.34“. */
export const euroL = (lang: Lang, n: number) => euroIn(n, lang);
/** Prozentwert mit Vorzeichen-Option: Deutsch „+1,5 %“, Englisch „+1.5%“. */
export function fmtPct(lang: Lang, n: number, digits = 1, signed = false) {
  const sign = signed && n >= 0 ? "+" : "";
  const v = n.toFixed(digits);
  return lang === "de" ? `${sign}${v.replace(".", ",")} %` : `${sign}${v}%`;
}
/** Datum im Format der Sprache (Deutsch de-DE, Englisch en-IE = Tag Monat Jahr). */
export const fmtDate = (lang: Lang, d: string | number | Date, opts?: Intl.DateTimeFormatOptions) =>
  new Date(d).toLocaleDateString(LOCALE[lang], opts);
export const fmtNumber = (lang: Lang, n: number) => n.toLocaleString(LOCALE[lang]);

// ---------------------------------------------------------------------------
// Pfade
// ---------------------------------------------------------------------------
/** Deutsche Pfad-Präfixe mit englischem Gegenstück (Reihenfolge: längere/spezifischere zuerst ist nicht nötig, da segmentgenau). */
export const PATH_MAP: readonly [string, string][] = [
  ["/karte", "/en/card"], ["/sets", "/en/sets"], ["/set", "/en/set"], ["/pokemon", "/en/pokemon"],
  ["/sealed", "/en/sealed"], ["/trends", "/en/trends"], ["/shop", "/en/shop"],
];
const splitPath = (p: string) => {
  const i = p.search(/[?#]/);
  return i < 0 ? [p, ""] : [p.slice(0, i), p.slice(i)];
};
const swapPrefix = (path: string, from: 0 | 1) => {
  const [pathname, rest] = splitPath(path);
  for (const pair of PATH_MAP) {
    const a = pair[from], b = pair[from === 0 ? 1 : 0];
    if (pathname === a || pathname.startsWith(`${a}/`)) return `${b}${pathname.slice(a.length)}${rest}`;
  }
  return null;
};
/** Englisches Gegenstück einer deutschen Seite („/karte/x/y“ → „/en/card/x/y“), sonst null. */
export const toEnPath = (dePath: string) => swapPrefix(dePath, 0);
/** Deutsches Gegenstück einer englischen Seite („/en/card/x/y“ → „/karte/x/y“), sonst null. */
export const toDePath = (enPath: string) => swapPrefix(enPath, 1);
/** Sprache aus dem Pfad („/en“ oder „/en/…“ = Englisch). */
export const langFromPath = (path: string): Lang => (/^\/en(\/|$|\?)/.test(path) ? "en" : "de");
/** Interner Link in der Seitensprache: deutsche Pfade ohne Gegenstück bleiben deutsch, „/“ wird zur englischen App. */
export function localPath(lang: Lang, dePath: string) {
  if (lang === "de") return dePath;
  if (dePath === "/" || dePath.startsWith("/?")) return withAppLang("en", dePath);
  return toEnPath(dePath) ?? dePath;
}
/** App-Deeplink (/?card=…) in der Seitensprache: Englisch hängt lang=en an. */
export function withAppLang(lang: Lang, url: string) {
  if (lang === "de" || /[?&]lang=/.test(url)) return url;
  const [base, hash] = url.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}lang=en${hash !== undefined ? `#${hash}` : ""}`;
}
export type Alternates = { de: string; en: string };
/** hreflang-Verweise (de, en, x-default = Deutsch) für eine Seite mit beiden Sprachfassungen; Pfade relativ zu site. */
export function hreflangTags(site: string, alt: Alternates, esc: (s: string) => string = (s) => s) {
  return `<link rel="alternate" hreflang="de" href="${esc(site + alt.de)}"><link rel="alternate" hreflang="en" href="${esc(site + alt.en)}"><link rel="alternate" hreflang="x-default" href="${esc(site + alt.de)}">`;
}
/** Beide Sprachfassungen aus einem deutschen Pfad und dem (ggf. abweichenden) englischen Slug-Pfad. */
export function alternatesFor(dePath: string, enDePath = dePath): Alternates {
  return { de: dePath, en: toEnPath(enDePath) ?? enDePath };
}

/** Englischer URL-Slug einer Pokémon-Art: nur bei rein lateinischen Namen (Nidoran♀/♂, Flabébé … behalten den deutschen Slug). */
export function pokemonEnSlug(nameEn: string | null | undefined, slugDe: string) {
  const n = String(nameEn || "").trim();
  if (!n || n === "-" || !/^[A-Za-z0-9 .'’:-]+$/.test(n)) return slugDe;
  const s = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || slugDe;
}
/** Anzeigename (Englisch, falls vorhanden). */
export const displayName = (lang: Lang, de: string, en?: string | null) =>
  lang === "en" && en && en !== "-" ? en : de;
