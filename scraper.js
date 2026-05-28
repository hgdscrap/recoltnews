const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const URL = "https://www.lesechos.fr/idees-debats/editos-analyses";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

function parseLeEchosDate(rawDate) {
  if (!rawDate) return null;
  const s = rawDate.trim();
  const heureMatch = s.match(/(\d{1,2}):(\d{2})/);
  if (heureMatch) {
    const dateMatch = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      return new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T${heureMatch[1].padStart(2,"0")}:${heureMatch[2]}:00`).toISOString();
    }
    const d = new Date();
    d.setHours(parseInt(heureMatch[1]), parseInt(heureMatch[2]), 0, 0);
    return d.toISOString();
  }
  const heuresMatch = s.match(/il y a (\d+) heure/);
  if (heuresMatch) {
    const d = new Date();
    d.setHours(d.getHours() - parseInt(heuresMatch[1]));
    return d.toISOString();
  }
  const minsMatch = s.match(/il y a (\d+) min/);
  if (minsMatch) {
    const d = new Date();
    d.setMinutes(d.getMinutes() - parseInt(minsMatch[1]));
    return d.toISOString();
  }
  return null;
}

async function scrape() {
  console.log(`[${new Date().toISOString()}] Scraping ${URL}...`);

  const { data: html } = await axios.get(URL, { headers: HEADERS, timeout: 20000 });
  const $ = cheerio.load(html);
  const articles = [];

  const selectors = [
    "article",
    "[data-testid='article-card']",
    ".article-card",
    ".card-article",
    ".story-card",
  ];

  let found = false;

  for (const sel of selectors) {
    const els = $(sel);
    if (els.length > 0) {
      console.log(`Sélecteur actif: ${sel} (${els.length} éléments)`);
      found = true;

      els.each((i, el) => {
        const $el = $(el);

        const title =
          $el.find("h2, h3, [class*='title'], [class*='heading']").first().text().trim() ||
          $el.find("a").first().attr("title") || "";

        let url = $el.find("a").first().attr("href") || "";
        if (url && !url.startsWith("http")) url = "https://www.lesechos.fr" + url;

        const author = $el.find("[class*='author'], [class*='auteur'], [rel='author']").first().text().trim() || "";
        const summary = $el.find("p, [class*='desc'], [class*='summary'], [class*='chapo']").first().text().trim() || "";
        const category = $el.find("[class*='category'], [class*='rubrique'], [class*='label'], [class*='tag']").first().text().trim() || "";

        const datetimeAttr = $el.find("time").attr("datetime") || "";
        const dateText =
          $el.find("time").text().trim() ||
          $el.find("[class*='date'], [class*='time'], [class*='published']").first().text().trim() || "";

        let date = null;
        if (datetimeAttr) {
          const parsed = new Date(datetimeAttr);
          if (!isNaN(parsed.getTime())) date = parsed.toISOString();
        }
        if (!date && dateText) date = parseLeEchosDate(dateText);
        if (!date) {
          console.warn(`  [no-date] ${title.slice(0, 60)}`);
          date = new Date().toISOString();
        }

        if (title && url && url.includes("lesechos.fr")) {
          articles.push({ title, url, author, summary: summary.slice(0, 200), category, date, source: "LES ÉCHOS", section: "Éditos & Analyses" });
        }
      });

      if (articles.length > 0) break;
    }
  }

  if (!found || articles.length === 0) {
    console.warn("Aucun article trouvé.");
    console.log("Dump HTML (500 chars):", html.slice(0, 500));
    const existing = readExisting();
    if (existing.length > 0) {
      console.log("Conservation des données existantes.");
      return;
    }
  }

  articles.forEach(a => console.log(`  [${a.date}] ${a.title.slice(0, 60)}`));

  const unique = dedup(articles);
  const existing = readExisting();
  const merged = mergeAndClean([...unique, ...existing]);
  merged.sort((a, b) => new Date(b.date) - new Date(a.date));

  const outputPath = path.join(__dirname, "data", "lesechos-editos.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`✓ ${merged.length} articles sauvegardés (${unique.length} nouveaux)`);
}

function dedup(articles) {
  const seen = new Set();
  return articles.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

function readExisting() {
  const p = path.join(__dirname, "data", "lesechos-editos.json");
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function mergeAndClean(articles) {
  const seen = new Set();
  const unique = articles.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = unique.filter((a) => {
    const d = new Date(a.date).getTime();
    return isNaN(d) || d > cutoff;
  });
  return recent.slice(0, 60);
}

scrape().catch((err) => {
  console.error("Erreur scraper:", err.message);
  process.exit(1);
});
