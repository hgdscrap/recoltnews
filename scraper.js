const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const URL = "https://www.lesechos.fr/idees-debats/editos-analyses";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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

async function scrape() {
  console.log(`[${new Date().toISOString()}] Scraping ${URL}...`);

  const { data: html } = await axios.get(URL, {
    headers: HEADERS,
    timeout: 20000,
  });

  const $ = cheerio.load(html);
  const articles = [];

  // Sélecteurs Les Échos — multiples fallbacks
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

        // Titre
        const title =
          $el.find("h2, h3, [class*='title'], [class*='heading']").first().text().trim() ||
          $el.find("a").first().attr("title") ||
          "";

        // URL
        let url =
          $el.find("a").first().attr("href") || "";
        if (url && !url.startsWith("http")) {
          url = "https://www.lesechos.fr" + url;
        }

        // Auteur
        const author =
          $el.find("[class*='author'], [class*='auteur'], [rel='author']").first().text().trim() || "";

        // Résumé/description
        const summary =
          $el.find("p, [class*='desc'], [class*='summary'], [class*='chapo']").first().text().trim() || "";

        // Date
        const dateRaw =
          $el.find("time").attr("datetime") ||
          $el.find("[class*='date'], [class*='time']").first().text().trim() ||
          "";

        if (title && url && url.includes("lesechos.fr")) {
          articles.push({
            title,
            url,
            author,
            summary: summary.slice(0, 200),
            date: dateRaw || new Date().toISOString(),
            source: "LES ÉCHOS",
            section: "Éditos & Analyses",
          });
        }
      });

      if (articles.length > 0) break;
    }
  }

  if (!found || articles.length === 0) {
    console.warn("Aucun article trouvé — Les Échos a peut-être bloqué ou changé sa structure HTML.");
    console.log("Dump HTML (500 premiers chars):", html.slice(0, 500));

    // On écrit quand même un fichier pour ne pas écraser les données existantes
    const existing = readExisting();
    if (existing.length > 0) {
      console.log("Conservation des données existantes.");
      return;
    }
  }

  // Dédoublonnage par URL
  const unique = dedup(articles);

  // Fusion avec existant (garde les 48 dernières heures)
  const existing = readExisting();
  const merged = mergeAndClean([...unique, ...existing]);

  const outputPath = path.join(__dirname, "data", "lesechos-editos.json");
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
  // Dédoublonnage global
  const seen = new Set();
  const unique = articles.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // Garde seulement les 48 dernières heures + max 60 articles
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
