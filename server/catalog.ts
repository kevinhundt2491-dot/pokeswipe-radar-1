// PokeSwipe & Radar – deutscher Kartenkatalog: automatischer Import aller Sets & Einzelkarten (TCGdex),
// Sealed-Preis-Import, öffentliche Set-Seiten (/sets, /set/<id>/<name>) und eine aufgeteilte Sitemap für Google.
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, cards, cardSets, sealedProducts, sealedPriceHistory, catalogImportRuns } from "../db/index.ts";
import { rebuildSpecies, fillEnglishNames, backfillSealedSlugs, SEO_SITEMAPS, SEO_STATIC_PAGES } from "./seo.ts";
import { refreshCard, cardPrice, evaluateSealedAlerts } from "./prices.ts";
import { SITE, h, slugify, cdnImage, pageShell, ebayUrl, cardmarketSearch } from "./growth.ts";
import { str, money, int, rows, rateLimit, clientIp, euro } from "./util.ts";
import { setCompleteness } from "./set-completeness-logic.ts";
import { publicCache } from "./cache.ts";
import { resilientFetch, markPartial, CircuitOpenError } from "./resilience.ts";

const TCGDEX = "https://api.tcgdex.net/v2/de";
const SET_ID_RE = /^[a-zA-Z0-9.\-_]{1,40}$/;
const CARDS_PER_SITEMAP = 10_000;
/** Kartenliste eines Sets nach 7 Tagen erneut abgleichen (neue Karten/Promos). */
const SET_REFRESH_MS = 7 * 86400_000;
/** Preise von Katalogkarten ohne Beobachter höchstens alle 3 Tage auffrischen (TCGdex schonen). */
const CATALOG_PRICE_MAX_AGE_MS = 3 * 86400_000;

const today = () => new Date().toISOString().slice(0, 10);
const validDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const https = (v: unknown, hosts?: string[]) => {
  const s = String(v ?? "").trim();
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return "";
    if (hosts && !hosts.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) return "";
    return u.toString().slice(0, 500);
  } catch { return ""; }
};

async function tcgdex(path: string, timeoutMs = 8000) {
  const res = await resilientFetch("tcgdex", `${TCGDEX}${path}`, { headers: { Accept: "application/json" } }, { timeoutMs, attempts: 3 });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TCGdex ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Schritt 1: Liste aller deutschen Sets holen und anlegen (neue Sets bekommen Vorrang). */
export async function syncSetList() {
  const list: any[] = (await tcgdex("/sets", 10_000)) || [];
  let added = 0;
  for (const s of list) {
    const id = String(s?.id || "");
    if (!SET_ID_RE.test(id) || !s?.name) continue;
    const name = String(s.name).slice(0, 120);
    const [row] = await db.insert(cardSets).values({
      id, name, slug: slugify(name),
      logo: s.logo ? `${String(s.logo).slice(0, 300)}` : "",
      symbol: s.symbol ? `${String(s.symbol).slice(0, 300)}` : "",
      cardCountOfficial: int(s.cardCount?.official, 0, 5000, 0),
      cardCountTotal: int(s.cardCount?.total, 0, 5000, 0),
    }).onConflictDoUpdate({
      target: cardSets.id,
      set: { name, slug: slugify(name), cardCountOfficial: int(s.cardCount?.official, 0, 5000, 0), cardCountTotal: int(s.cardCount?.total, 0, 5000, 0), updatedAt: new Date() },
    }).returning({ id: cardSets.id, cardsImportedAt: cardSets.cardsImportedAt });
    if (row && !row.cardsImportedAt) added++;
  }
  return { sets: list.length, pending: added };
}

/** Schritt 2: Set-Details + Kartenliste eines Sets importieren (Karten als Katalog-Einträge ohne Preis). */
export async function importSet(setId: string) {
  if (!SET_ID_RE.test(setId)) throw new Error("Ungültige Set-ID");
  const data: any = await tcgdex(`/sets/${encodeURIComponent(setId)}`);
  if (!data) {
    await db.update(cardSets).set({ active: false, detailsCheckedAt: new Date() }).where(eq(cardSets.id, setId));
    return { setId, cards: 0 };
  }
  const name = String(data.name || setId).slice(0, 120);
  const release = validDate(data.releaseDate);
  await db.update(cardSets).set({
    name, slug: slugify(name),
    serieId: String(data.serie?.id || "").slice(0, 40),
    serieName: String(data.serie?.name || "").slice(0, 120),
    abbreviation: String(data.abbreviation?.official || "").slice(0, 20),
    logo: data.logo ? String(data.logo).slice(0, 300) : "",
    symbol: data.symbol ? String(data.symbol).slice(0, 300) : "",
    releaseDate: release,
    cardCountOfficial: int(data.cardCount?.official, 0, 5000, 0),
    cardCountTotal: int(data.cardCount?.total, 0, 5000, 0),
    // Neuere Sets zuerst mit Preisen versorgen (Suchanfragen drehen sich meist um aktuelle Sets)
    priority: release ? Number(release.slice(0, 4)) : 0,
    detailsCheckedAt: new Date(), updatedAt: new Date(),
  }).where(eq(cardSets.id, setId));

  const list: any[] = Array.isArray(data.cards) ? data.cards : [];
  const now = new Date();
  const values = list
    .filter((c) => c?.id && /^[a-zA-Z0-9.\-_]{2,40}$/.test(String(c.id)) && c.name)
    .map((c) => ({
      id: String(c.id), name: String(c.name).slice(0, 120), setName: name,
      image: c.image ? `${String(c.image).slice(0, 280)}/high.webp` : "",
      setId, localId: String(c.localId ?? "").slice(0, 20), importedAt: now,
    }));
  for (let i = 0; i < values.length; i += 250) {
    const chunk = values.slice(i, i + 250);
    await db.insert(cards).values(chunk).onConflictDoUpdate({
      target: cards.id,
      // Bestehende Karten (mit Preis) behalten ihre Werte – nur Katalog-Zuordnung ergänzen
      set: { setId: sql`excluded.set_id`, localId: sql`excluded.local_id`, importedAt: sql`COALESCE(${cards.importedAt}, excluded.imported_at)`,
        image: sql`CASE WHEN ${cards.image} = '' THEN excluded.image ELSE ${cards.image} END` },
    });
  }
  await db.update(cardSets).set({ cardsImportedAt: new Date() }).where(eq(cardSets.id, setId));
  return { setId, cards: values.length };
}

/**
 * Ein Durchlauf des Katalog-Imports (läuft regelmäßig als geplante Funktion):
 * Set-Liste täglich abgleichen → fehlende/alte Sets importieren → Preise der ältesten Katalogkarten auffrischen.
 */
export async function runCatalogImport({ deadlineMs = 24_000, maxSets = 3, maxPrices = 60 } = {}) {
  const deadline = Date.now() + deadlineMs;
  const result = { setList: null as null | { sets: number; pending: number }, setsImported: [] as string[], prices: 0, species: 0, englishNames: 0, errors: 0 };
  const [run] = await db.insert(catalogImportRuns).values({}).returning({ id: catalogImportRuns.id }).catch(() => [null as any]);

  const [state] = rows(await db.execute(sql`SELECT count(*)::int AS n, max(updated_at) AS last FROM card_sets`));
  if (!Number(state?.n) || !state?.last || Date.now() - new Date(state.last).getTime() > 86400_000) {
    try { result.setList = await syncSetList(); } catch (e) { result.errors++; console.warn("Katalog: Set-Liste nicht geladen", e); }
  }

  const due = await db.select({ id: cardSets.id }).from(cardSets)
    .where(and(eq(cardSets.active, true), sql`(${cardSets.cardsImportedAt} IS NULL OR ${cardSets.cardsImportedAt} < ${new Date(Date.now() - SET_REFRESH_MS)})`))
    .orderBy(sql`${cardSets.cardsImportedAt} IS NOT NULL`, desc(cardSets.priority), desc(cardSets.releaseDate), asc(cardSets.id))
    .limit(maxSets);
  for (const s of due) {
    if (Date.now() > deadline - 6000) { markPartial("Zeitbudget: weitere Sets im nächsten Lauf"); break; }
    try { await importSet(s.id); result.setsImported.push(s.id); } catch (e) { result.errors++; console.warn("Katalog: Set nicht importiert", s.id, e); }
  }

  // Preise: zuerst Karten ganz ohne Preisabruf, dann die ältesten – neue Sets zuerst
  const stale = rows(await db.execute(sql`
    SELECT c.id FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id
    WHERE c.imported_at IS NOT NULL AND (c.checked_at IS NULL OR c.details_at IS NULL OR c.checked_at < ${new Date(Date.now() - CATALOG_PRICE_MAX_AGE_MS)})
    ORDER BY (c.checked_at IS NOT NULL), (c.details_at IS NOT NULL), s.priority DESC NULLS LAST, s.release_date DESC NULLS LAST, c.checked_at ASC NULLS FIRST
    LIMIT ${maxPrices}
  `));
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < stale.length && Date.now() < deadline) {
      const id = String(stale[i++].id);
      try { await refreshCard(id); result.prices++; } catch (e) { result.errors++; if (e instanceof CircuitOpenError) break; }
    }
  }));
  if (i < stale.length) markPartial(`Zeitbudget/Quelle: ${stale.length - i} Preise offen`);

  // Pokémon-Arten (für /pokemon/<name>) aus den Kartendetails ableiten, englische Namen & Sealed-Slugs ergänzen
  try {
    if (Date.now() < deadline - 4000) result.species = await rebuildSpecies();
    if (Date.now() < deadline - 3000) result.englishNames = await fillEnglishNames(12, deadline - 1000);
    await backfillSealedSlugs();
  } catch (e) { result.errors++; console.warn("Katalog: Pokémon-Arten nicht aktualisiert", e); }

  if (run?.id) {
    await db.update(catalogImportRuns).set({
      finishedAt: new Date(), setsImported: result.setsImported.length, prices: result.prices, species: result.species, errors: result.errors,
      note: [result.setList ? `Set-Liste: ${result.setList.sets}` : "", result.setsImported.join(", "), result.englishNames ? `${result.englishNames} engl. Namen` : ""].filter(Boolean).join(" • ").slice(0, 500),
    }).where(eq(catalogImportRuns.id, run.id)).catch(() => {});
    // Protokoll schlank halten (30 Tage)
    await db.execute(sql`DELETE FROM catalog_import_runs WHERE started_at < now() - interval '30 days'`).catch(() => {});
  }
  return result;
}

/** Fortschritt für die Admin-Zentrale. */
export async function catalogStatus() {
  const [r] = rows(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM card_sets WHERE active) AS sets,
      (SELECT count(*)::int FROM card_sets WHERE active AND cards_imported_at IS NOT NULL) AS sets_imported,
      (SELECT count(*)::int FROM cards WHERE imported_at IS NOT NULL) AS catalog_cards,
      (SELECT count(*)::int FROM cards WHERE imported_at IS NOT NULL AND checked_at IS NOT NULL) AS cards_checked,
      (SELECT count(*)::int FROM cards WHERE COALESCE(trend, avg, low) IS NOT NULL) AS cards_priced,
      (SELECT count(*)::int FROM sealed_products WHERE active) AS sealed,
      (SELECT count(*)::int FROM sealed_products WHERE active AND ref_price IS NOT NULL) AS sealed_priced,
      (SELECT count(*)::int FROM cards WHERE details_at IS NOT NULL) AS cards_detailed,
      (SELECT count(*)::int FROM pokemon_species) AS species,
      (SELECT count(*)::int FROM pokemon_species WHERE name_en NOT IN ('', '-')) AS species_en
  `));
  const runs = await db.select().from(catalogImportRuns).orderBy(desc(catalogImportRuns.startedAt)).limit(8);
  return {
    sets: Number(r?.sets ?? 0), setsImported: Number(r?.sets_imported ?? 0), catalogCards: Number(r?.catalog_cards ?? 0),
    cardsChecked: Number(r?.cards_checked ?? 0), cardsPriced: Number(r?.cards_priced ?? 0),
    sealed: Number(r?.sealed ?? 0), sealedPriced: Number(r?.sealed_priced ?? 0),
    cardsDetailed: Number(r?.cards_detailed ?? 0), species: Number(r?.species ?? 0), speciesEn: Number(r?.species_en ?? 0),
    runs,
  };
}

// ---------------------------------------------------------------------------
// Sealed-Import (Displays, ETBs, Top-Trainer-Boxen …) – per Admin-JSON/CSV, Abgleich über EAN oder Slug
// ---------------------------------------------------------------------------
const SEALED_KINDS = ["display", "etb", "ttb", "bundle", "booster", "tin", "collection", "other"];
const IMAGE_HOSTS = ["assets.tcgdex.net", "images.pokemontcg.io", "raw.githubusercontent.com"];

export type SealedImportRow = {
  name?: string; setName?: string; setId?: string; kind?: string; ean?: string; uvp?: unknown; refPrice?: unknown;
  releaseDate?: string; image?: string; cardmarketUrl?: string; slug?: string;
  contents?: string; boosterCount?: unknown; description?: string;
};

export async function importSealed(items: SealedImportRow[], source: "admin" | "import" = "import") {
  let created = 0, updated = 0, priced = 0;
  const skipped: string[] = [];
  for (const raw of items.slice(0, 500)) {
    const name = str(raw.name, 120);
    if (!name) { skipped.push("(ohne Name)"); continue; }
    const ean = String(raw.ean ?? "").replace(/\D/g, "");
    const eanOk = /^\d{8}$|^\d{12,14}$/.test(ean) ? ean : null;
    const slug = slugify(str(raw.slug, 80) || name);
    const values: Record<string, any> = {
      name, setName: str(raw.setName, 120), kind: SEALED_KINDS.includes(String(raw.kind)) ? String(raw.kind) : "other",
      slug, ean: eanOk, setId: SET_ID_RE.test(String(raw.setId ?? "")) ? String(raw.setId) : null,
      uvp: money(raw.uvp), releaseDate: validDate(raw.releaseDate),
      cardmarketUrl: https(raw.cardmarketUrl, ["cardmarket.com"]),
      contents: str(raw.contents, 200), boosterCount: int(raw.boosterCount, 0, 1000, 0) || null,
      description: str(raw.description, 2000),
    };
    const img = https(raw.image, IMAGE_HOSTS);
    if (img) values.image = img;
    const ref = money(raw.refPrice);

    const [existing] = await db.select({ id: sealedProducts.id }).from(sealedProducts)
      .where(sql`${sealedProducts.slug} = ${slug} OR lower(${sealedProducts.name}) = lower(${name})${eanOk ? sql` OR ${sealedProducts.ean} = ${eanOk}` : sql``}`)
      .orderBy(sql`${sealedProducts.ean} = ${eanOk ?? ""} DESC NULLS LAST`, asc(sealedProducts.id)).limit(1);
    let id: number;
    if (existing) {
      // Leere Felder überschreiben keine vorhandenen Werte
      const updates = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== ""));
      await db.update(sealedProducts).set(updates).where(eq(sealedProducts.id, existing.id));
      id = existing.id; updated++;
    } else {
      const [row] = await db.insert(sealedProducts).values({ ...values, name, priceSource: source } as any).returning({ id: sealedProducts.id });
      id = row.id; created++;
    }
    if (ref) {
      // CSV-/Admin-Preis = manueller Override für Sonderprodukte: der automatische Job (update-sealed-prices) überschreibt ihn nicht
      await db.update(sealedProducts).set({ refPrice: ref, refUpdatedAt: new Date(), priceSource: source, priceLocked: true }).where(eq(sealedProducts.id, id));
      await db.insert(sealedPriceHistory).values({ productId: id, day: today(), refPrice: ref })
        .onConflictDoUpdate({ target: [sealedPriceHistory.productId, sealedPriceHistory.day], set: { refPrice: ref } });
      await evaluateSealedAlerts(id, Number(ref));
      priced++;
    }
  }
  return { created, updated, priced, skipped };
}

/** CSV (Semikolon oder Komma) → Import-Zeilen. Erwartete Spalten: name;set;kind;ean;uvp;price;release;image;cardmarket – optional: inhalt;boosters;beschreibung */
export function parseSealedCsv(text: string): SealedImportRow[] {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].split(";").length >= lines[0].split(",").length ? ";" : ",";
  const split = (l: string) => {
    const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const head = split(lines[0]).map((x) => x.toLowerCase());
  const col = (...names: string[]) => head.findIndex((x) => names.includes(x));
  const idx = {
    name: col("name", "produkt", "product"), setName: col("set", "setname", "set_name", "erweiterung"), setId: col("setid", "set_id"),
    kind: col("kind", "art", "typ", "type"), ean: col("ean", "gtin"), uvp: col("uvp", "msrp"),
    refPrice: col("price", "preis", "refprice", "trend", "referenzpreis"), releaseDate: col("release", "releasedate", "erscheinung", "datum"),
    image: col("image", "bild"), cardmarketUrl: col("cardmarket", "cardmarketurl", "url"),
    contents: col("contents", "inhalt"), boosterCount: col("boosters", "booster", "boostercount", "booster_count", "anzahl_booster"),
    description: col("description", "beschreibung"),
  };
  if (idx.name < 0) return [];
  const num = (v: string | undefined) => (v ? Number(v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) : null);
  return lines.slice(1).map((l) => {
    const c = split(l);
    const get = (k: keyof typeof idx) => (idx[k] >= 0 ? c[idx[k]] : undefined);
    return {
      name: get("name"), setName: get("setName"), setId: get("setId"), kind: get("kind")?.toLowerCase(), ean: get("ean"),
      uvp: num(get("uvp")), refPrice: num(get("refPrice")), releaseDate: get("releaseDate"), image: get("image"), cardmarketUrl: get("cardmarketUrl"),
      contents: get("contents"), boosterCount: get("boosterCount"), description: get("description"),
    };
  });
}

// ---------------------------------------------------------------------------
// Öffentliche Set-Seiten (SEO)
// ---------------------------------------------------------------------------
const cmSearch = cardmarketSearch;
const fmtDate = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" }) : "");
const SET_CSS = `<style>.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}.ci{background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:6px;text-decoration:none;font-size:12px;display:block}
.ci img{width:100%;border-radius:8px;display:block;aspect-ratio:245/342;object-fit:cover;background:#0f172a}.ci b{display:block;color:#34d399;font-size:13px}.ci span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sets{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.si{display:flex;gap:10px;align-items:center;background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:10px;text-decoration:none;font-size:13px}
.si img{width:64px;height:36px;object-fit:contain}.crumb{font-size:12px;color:#94a3b8;margin-bottom:10px}.crumb a{color:#cbd5e1}</style>`;

export async function setsIndexPage(c: any) {
  if (!(await rateLimit(`setpage:${clientIp(c)}`, 60, 60_000))) return c.text("Zu viele Anfragen", 429);
  const list = rows(await db.execute(sql`
    SELECT s.id, s.name, s.slug, s.serie_name, s.logo, s.release_date, s.card_count_total,
      (SELECT count(*)::int FROM cards c WHERE c.set_id = s.id AND COALESCE(c.trend, c.avg, c.low) IS NOT NULL) AS priced
    FROM card_sets s WHERE s.active AND s.cards_imported_at IS NOT NULL
    ORDER BY s.release_date DESC NULLS LAST, s.name
  `));
  const groups = new Map<string, any[]>();
  for (const s of list) { const k = s.serie_name || "Weitere Sets"; groups.set(k, [...(groups.get(k) || []), s]); }
  const canonical = `${SITE()}/sets`;
  const body = `${SET_CSS}<div class="card"><h1>Alle deutschen Pokémon-Sets</h1>
    <p class="muted">${list.length} Erweiterungen mit Kartenliste und aktuellen Cardmarket-Preisen – von Karmesin &amp; Purpur bis zu den Klassikern.</p></div>
    ${[...groups].map(([serie, sets]) => `<h2>${h(serie)}</h2><div class="sets">${sets.map((s: any) => `<a class="si" href="/set/${encodeURIComponent(s.id)}/${h(s.slug)}">
      ${s.logo ? `<img src="${h(cdnImage(`${s.logo}.png`, 160))}" alt="" loading="lazy">` : ""}<span><b>${h(s.name)}</b><br><span class="muted">${s.release_date ? h(new Date(s.release_date).getFullYear()) + " • " : ""}${Number(s.card_count_total) || ""} Karten</span></span></a>`).join("")}</div>`).join("")
    || `<p class="muted">Der Katalog wird gerade importiert – bitte in Kürze erneut öffnen.</p>`}`;
  publicCache(c, "page");
  return c.html(pageShell({
    title: "Alle deutschen Pokémon-Sets mit Kartenpreisen | PokeSwipe & Radar",
    description: "Alle deutschen Pokémon-TCG-Erweiterungen mit kompletter Kartenliste, aktuellen Cardmarket-Preisen und den wertvollsten Karten je Set.",
    canonical, body,
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: "Deutsche Pokémon-Sets", url: canonical,
      breadcrumb: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Start", item: `${SITE()}/` }, { "@type": "ListItem", position: 2, name: "Sets", item: canonical }] } },
  }));
}

export async function setPage(c: any) {
  const id = String(c.req.param("id") || "");
  if (!SET_ID_RE.test(id)) return c.html(pageShell({ title: "Set nicht gefunden", description: "", canonical: `${SITE()}/sets`, body: `<div class="card"><h1>Set nicht gefunden</h1><a class="btn y" href="/sets">Alle Sets</a></div>` }), 404);
  if (!(await rateLimit(`setpage:${clientIp(c)}`, 60, 60_000))) return c.text("Zu viele Anfragen", 429);
  const [set] = await db.select().from(cardSets).where(and(eq(cardSets.id, id), eq(cardSets.active, true))).limit(1);
  if (!set) {
    return c.html(pageShell({ title: "Set nicht gefunden | PokeSwipe & Radar", description: "", canonical: `${SITE()}/sets`,
      body: `<div class="card"><h1>Set nicht gefunden</h1><p class="muted">Dieses Set ist (noch) nicht im Katalog.</p><a class="btn y" href="/sets">Alle Sets</a></div>` }), 404);
  }
  const list = await db.select({
    id: cards.id, name: cards.name, image: cards.image, localId: cards.localId, rarity: cards.rarity,
    trend: cards.trend, avg: cards.avg, low: cards.low,
  }).from(cards).where(eq(cards.setId, id)).limit(1500);
  const byNumber = [...list].sort((a, b) => String(a.localId).localeCompare(String(b.localId), "de", { numeric: true }));
  const priced = list.map((x) => ({ ...x, price: cardPrice(x) })).filter((x) => x.price > 0).sort((a, b) => b.price - a.price);
  const setValue = priced.reduce((sum, x) => sum + x.price, 0);
  const top = priced.slice(0, 10);
  const canonical = `${SITE()}/set/${encodeURIComponent(set.id)}/${set.slug || slugify(set.name)}`;
  const year = set.releaseDate ? new Date(set.releaseDate).getFullYear() : "";
  const title = `${set.name}${set.abbreviation ? ` (${set.abbreviation})` : ""} – Kartenliste & Preise${year ? ` ${year}` : ""} | PokeSwipe & Radar`;
  const description = `${set.name}${set.serieName ? ` (${set.serieName})` : ""}: alle ${set.cardCountTotal || list.length} Karten mit aktuellem Cardmarket-Preis.${top[0] ? ` Wertvollste Karte: ${top[0].name} für ${euro(top[0].price)}.` : ""} Set-Wert, Top-10 und Preisalarm.`;
  const cardLink = (x: { id: string; name: string }) => `/karte/${encodeURIComponent(x.id)}/${slugify(x.name)}`;
  const tile = (x: any) => `<a class="ci" href="${h(cardLink(x))}">${x.image ? `<img src="${h(cdnImage(x.image, 200))}" alt="${h(x.name)} ${h(x.localId)}" loading="lazy" width="120" height="167">` : ""}
    <span>${h(x.name)}</span><span class="muted">#${h(x.localId)}${x.rarity ? ` • ${h(x.rarity)}` : ""}</span><b>${cardPrice(x) ? h(euro(cardPrice(x))) : "–"}</b></a>`;
  const body = `${SET_CSS}<p class="crumb"><a href="/">Start</a> › <a href="/sets">Sets</a> › ${h(set.name)}</p>
  <div class="card">
    ${set.logo ? `<img src="${h(cdnImage(`${set.logo}.png`, 400))}" alt="${h(set.name)} Logo" style="max-height:80px;max-width:260px;object-fit:contain;display:block;margin-bottom:10px">` : ""}
    <h1>${h(set.name)}</h1>
    <p class="muted">${[set.serieName, set.abbreviation, set.releaseDate ? `Erschienen am ${fmtDate(set.releaseDate)}` : ""].filter(Boolean).map(h).join(" • ")}</p>
    <div class="stats">
      <div class="stat">Karten<b>${Number(set.cardCountTotal) || list.length}${set.cardCountOfficial && set.cardCountTotal > set.cardCountOfficial ? ` <span class="muted">(${set.cardCountOfficial} + ${set.cardCountTotal - set.cardCountOfficial} Secret)</span>` : ""}</b></div>
      <div class="stat">Set-Wert (je 1×)<b>${setValue ? h(euro(setValue)) : "–"}</b></div>
      <div class="stat">Mit Preis<b>${priced.length}/${list.length}</b></div>
    </div>
    <div class="btns">
      <a class="btn y" href="/?tab=portfolio&set=${encodeURIComponent(set.id)}">✅ Set-Fortschritt tracken</a>
      <a class="btn" style="background:#4f46e5;color:#fff" href="${h(cmSearch(set.name))}" target="_blank" rel="noopener sponsored">Bei Cardmarket ansehen</a>
      <a class="btn" style="background:#2563eb;color:#fff" href="${h(ebayUrl(`Pokemon ${set.name} Display`, "set"))}" target="_blank" rel="noopener sponsored">🛒 Display bei eBay*</a>
    </div>
  </div>
  ${top.length ? `<h2>💎 Die 10 wertvollsten Karten aus ${h(set.name)}</h2><div class="cards">${top.map(tile).join("")}</div>` : ""}
  <h2>📋 Komplette Kartenliste</h2>
  ${byNumber.length ? `<div class="cards">${byNumber.map(tile).join("")}</div>` : `<p class="muted">Die Kartenliste wird gerade importiert.</p>`}
  <p class="muted" style="margin-top:14px">Preise: Cardmarket-Trend über TCGdex, werden laufend aktualisiert. Alle Angaben ohne Gewähr.</p>`;
  const jsonLd = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: `${set.name} – Kartenliste & Preise`, url: canonical, description,
    breadcrumb: { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Start", item: `${SITE()}/` },
      { "@type": "ListItem", position: 2, name: "Sets", item: `${SITE()}/sets` },
      { "@type": "ListItem", position: 3, name: set.name, item: canonical },
    ] },
    mainEntity: { "@type": "ItemList", numberOfItems: top.length, itemListElement: top.map((x, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE()}${cardLink(x)}`, name: x.name })) },
  };
  publicCache(c, "page");
  return c.html(pageShell({ title, description, canonical, image: set.logo ? `${SITE()}${cdnImage(`${set.logo}.png`, 600, "jpg")}` : undefined, body, jsonLd }));
}

// ---------------------------------------------------------------------------
// Sitemaps (Index + Teil-Sitemaps, je max. 10.000 Karten)
// ---------------------------------------------------------------------------
const STATIC_PAGES = [...SEO_STATIC_PAGES, "/umzug", "/sets", "/ratgeber/pokemon-karten-wert", "/ratgeber/pokemon-karten-fake-erkennen", "/ratgeber/pokemon-displays-zum-uvp", "/rechtliches", "/datenschutz"];
const xml = (c: any, body: string) => {
  publicCache(c, "sitemap");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, 200, { "Content-Type": "application/xml; charset=utf-8" });
};
const loc = (path: string, extra = "") => `<url><loc>${h(`${SITE()}${path}`)}</loc>${extra}</url>`;
const sitemapCards = sql`FROM cards WHERE COALESCE(trend, avg, low) IS NOT NULL OR (imported_at IS NOT NULL AND checked_at IS NOT NULL)`;

export function registerCatalog(app: any, hlp: { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> }) {
  const { auth, adminOnly, body } = hlp;

  // Phase 6: Set-Vollständigkeits-Report (Admin) – importierte Karten je Set gegen card_count_official/total
  app.get("/api/admin/set-completeness", auth, adminOnly, async (c: any) => {
    const langRaw = String(c.req.query("lang") || "de");
    if (!["de", "en", "ja"].includes(langRaw)) return c.json({ error: "Unbekannte Sprache." }, 400);
    const onlyIncomplete = c.req.query("incomplete") === "1";
    const sets = langRaw === "de"
      ? rows(await db.execute(sql`SELECT s.id, s.name, s.serie_name, s.release_date, s.card_count_official AS official, s.card_count_total AS total, s.cards_imported_at,
          COALESCE(array_agg(c.local_id) FILTER (WHERE c.local_id IS NOT NULL), '{}') AS local_ids
          FROM card_sets s LEFT JOIN cards c ON c.set_id = s.id WHERE s.active GROUP BY s.id ORDER BY s.release_date DESC NULLS LAST`))
      : rows(await db.execute(sql`SELECT s.id, s.name, s.serie_name, s.release_date, s.card_count_official AS official, s.card_count_total AS total, s.cards_imported_at,
          COALESCE(array_agg(p.local_id) FILTER (WHERE p.local_id <> ''), '{}') AS local_ids
          FROM print_sets s LEFT JOIN card_prints p ON p.lang = s.lang AND p.set_id = s.id WHERE s.lang = ${langRaw} AND s.active
          GROUP BY s.lang, s.id ORDER BY s.release_date DESC NULLS LAST`));
    const report = sets.map((s: any) => ({
      id: String(s.id), name: String(s.name), serie: String(s.serie_name || ""),
      releaseDate: s.release_date ? String(s.release_date).slice(0, 10) : null, importedAt: s.cards_imported_at,
      ...setCompleteness(Array.isArray(s.local_ids) ? s.local_ids : [], { official: Number(s.official), total: Number(s.total) }),
    })).filter((r: any) => !onlyIncomplete || r.status === "incomplete");
    const summary = {
      sets: report.length, complete: report.filter((r: any) => r.status === "complete").length,
      incomplete: report.filter((r: any) => r.status === "incomplete").length, unknown: report.filter((r: any) => r.status === "unknown").length,
      missingCards: report.reduce((a: number, r: any) => a + r.missingCount, 0),
    };
    c.header("Cache-Control", "private, no-store");
    return c.json({ lang: langRaw, summary, sets: report });
  });

  app.get("/sets", setsIndexPage);
  app.get("/set/:id/:slug?", setPage);

  app.get("/sitemap.xml", async (c: any) => {
    const [r] = rows(await db.execute(sql`SELECT count(*)::int AS n ${sitemapCards}`));
    const parts = Math.max(1, Math.ceil(Number(r?.n ?? 0) / CARDS_PER_SITEMAP));
    const now = today();
    const maps = ["/sitemaps/pages.xml", "/sitemaps/sets.xml", ...SEO_SITEMAPS, ...Array.from({ length: parts }, (_, i) => `/sitemaps/cards-${i + 1}.xml`)];
    return xml(c, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${maps.map((m) => `<sitemap><loc>${h(`${SITE()}${m}`)}</loc><lastmod>${now}</lastmod></sitemap>`).join("")}</sitemapindex>`);
  });

  app.get("/sitemaps/pages.xml", async (c: any) => {
    const shops = rows(await db.execute(sql`
      SELECT shop_slug FROM profiles WHERE shop_slug IS NOT NULL AND plan = 'pro' AND plan_until > now() AND NOT banned LIMIT 2000
    `));
    const urls = [loc("/", "<changefreq>daily</changefreq><priority>1.0</priority>")]
      .concat(STATIC_PAGES.map((p) => loc(p, "<changefreq>weekly</changefreq><priority>0.8</priority>")))
      .concat(shops.map((s: any) => loc(`/shop/${encodeURIComponent(s.shop_slug)}`, "<changefreq>daily</changefreq>")));
    return xml(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
  });

  app.get("/sitemaps/sets.xml", async (c: any) => {
    const list = rows(await db.execute(sql`SELECT id, slug, name, cards_imported_at FROM card_sets WHERE active AND cards_imported_at IS NOT NULL ORDER BY release_date DESC NULLS LAST`));
    const urls = list.map((s: any) => loc(`/set/${encodeURIComponent(s.id)}/${s.slug || slugify(s.name)}`,
      `<lastmod>${new Date(s.cards_imported_at).toISOString().slice(0, 10)}</lastmod><changefreq>daily</changefreq><priority>0.7</priority>`));
    return xml(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
  });

  app.get("/sitemaps/:file", async (c: any) => {
    const m = /^cards-(\d{1,3})\.xml$/.exec(String(c.req.param("file") || ""));
    if (!m) return c.text("Nicht gefunden", 404);
    const page = Number(m[1]);
    const list = rows(await db.execute(sql`
      SELECT id, name, COALESCE(price_updated_at, checked_at) AS updated ${sitemapCards}
      ORDER BY id LIMIT ${CARDS_PER_SITEMAP} OFFSET ${(page - 1) * CARDS_PER_SITEMAP}
    `));
    if (!list.length && page > 1) return c.text("Nicht gefunden", 404);
    const urls = list.map((r: any) => loc(`/karte/${encodeURIComponent(r.id)}/${slugify(r.name)}`,
      `${r.updated ? `<lastmod>${new Date(r.updated).toISOString().slice(0, 10)}</lastmod>` : ""}<changefreq>daily</changefreq>`));
    return xml(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
  });

  // ------------------------------- Admin -----------------------------------
  app.get("/api/admin/catalog", auth, adminOnly, async (c: any) => c.json(await catalogStatus()));

  app.post("/api/admin/catalog/run", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const setId = str(b.setId, 40);
    if (setId) {
      if (!SET_ID_RE.test(setId)) return c.json({ error: "Ungültige Set-ID" }, 400);
      try { await syncSetList(); } catch {}
      return c.json({ ...(await importSet(setId)), status: await catalogStatus() });
    }
    const result = await runCatalogImport({ deadlineMs: 20_000, maxSets: 4, maxPrices: 40 });
    return c.json({ ...result, status: await catalogStatus() });
  });

  /** Sealed-Import: { items: [...] } oder { csv: "name;set;kind;ean;uvp;price;release;image;cardmarket\n…" } */
  app.post("/api/admin/catalog/sealed", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const items: SealedImportRow[] = Array.isArray(b.items) ? b.items : typeof b.csv === "string" ? parseSealedCsv(b.csv.slice(0, 500_000)) : [];
    if (!items.length) return c.json({ error: "Keine Zeilen gefunden. Erste Zeile muss die Spaltennamen enthalten (mindestens „name“)." }, 400);
    return c.json(await importSealed(items, "import"));
  });

  /** Öffentliche Set-Liste (für die App, z. B. Set-Auswahl). */
  app.get("/api/catalog/sets", async (c: any) => {
    const list = await db.select({
      id: cardSets.id, name: cardSets.name, serieName: cardSets.serieName, releaseDate: cardSets.releaseDate,
      cardCountTotal: cardSets.cardCountTotal, logo: cardSets.logo,
    }).from(cardSets).where(and(eq(cardSets.active, true), isNotNull(cardSets.cardsImportedAt))).orderBy(desc(cardSets.releaseDate)).limit(400);
    publicCache(c, "data", { sMaxAge: 1800, swr: 86_400 });
    return c.json({ sets: list });
  });
}
