const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

const URLS = [
  'https://www.lemonde.fr/economie/',
  'https://www.lemonde.fr/argent/',
  'https://www.lemonde.fr/entreprises/',
];

async function scrapeLeMonde() {
  console.log('[LeMonde] Lancement du scraper...');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
    ],
  });

  const allArticles = [];

  for (const url of URLS) {
    try {
      console.log(`[LeMonde] Scraping: ${url}`);
      const page = await browser.newPage();

      // Simule un vrai navigateur Mac/Chrome
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Bloque les ressources inutiles pour aller plus vite
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        if (['font', 'media', 'stylesheet'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Attend que les articles soient dans le DOM
      await page.waitForSelector('article', { timeout: 10000 }).catch(() => {
        console.log(`[LeMonde] Pas d'articles trouvés sur ${url}`);
      });

      const articles = await page.evaluate((sourceUrl) => {
        const items = [];

        // Sélecteurs Le Monde (section économie/argent)
        const elements = document.querySelectorAll('article, .article, [data-type="article"]');

        elements.forEach((el) => {
          const titre = 
            el.querySelector('h2, h3, .article__title, .teaser__title')?.innerText?.trim();
          const chapo = 
            el.querySelector('p, .article__desc, .teaser__desc')?.innerText?.trim();
          const lienEl = el.querySelector('a[href]');
          const lien = lienEl?.href || null;
          const image = 
            el.querySelector('img')?.src || 
            el.querySelector('img')?.dataset?.src || 
            null;
          const categorie = 
            el.querySelector('.article__rubrique, .tag, .label, [class*="rubrique"], [class*="category"]')?.innerText?.trim();
          const auteur = 
            el.querySelector('.article__author, .author, [class*="author"]')?.innerText?.trim();
          const date = 
            el.querySelector('time, .article__date, [datetime]')?.getAttribute('datetime') ||
            el.querySelector('time, .article__date')?.innerText?.trim();
          const paywall = 
            el.querySelector('[class*="premium"], [class*="abonne"], [class*="subscriber"]') !== null ||
            el.innerText?.includes('🔒');

          if (titre && lien && lien.includes('lemonde.fr')) {
            items.push({
              titre,
              chapo: chapo?.substring(0, 300) || null,
              lien,
              image,
              categorie: categorie || sourceUrl.split('/')[3] || 'economie',
              auteur: auteur || null,
              date: date || null,
              paywall,
              source: 'Le Monde',
              scraped_at: new Date().toISOString(),
            });
          }
        });

        // Dédoublonne par lien
        const seen = new Set();
        return items.filter((a) => {
          if (seen.has(a.lien)) return false;
          seen.add(a.lien);
          return true;
        });
      }, url);

      console.log(`[LeMonde] ${articles.length} articles trouvés sur ${url}`);
      allArticles.push(...articles);
      await page.close();

    } catch (err) {
      console.error(`[LeMonde] Erreur sur ${url}:`, err.message);
    }
  }

  await browser.close();

  // Dédoublonne global
  const seen = new Set();
  const unique = allArticles.filter((a) => {
    if (seen.has(a.lien)) return false;
    seen.add(a.lien);
    return true;
  });

  // Trie par date (plus récent en premier)
  unique.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  console.log(`[LeMonde] Total: ${unique.length} articles uniques`);
  return unique;
}

// Cache en mémoire
let cache = { data: null, timestamp: null };
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Route principale
app.get('/scrape', async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === 'true';

    if (!forceRefresh && cache.data && now - cache.timestamp < CACHE_TTL) {
      console.log('[LeMonde] Retour depuis le cache');
      return res.json({
        success: true,
        count: cache.data.length,
        cached: true,
        articles: cache.data,
      });
    }

    const articles = await scrapeLeMonde();
    cache = { data: articles, timestamp: now };

    res.json({
      success: true,
      count: articles.length,
      cached: false,
      articles,
    });
  } catch (err) {
    console.error('[LeMonde] Erreur scrape:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'lemonde-scraper',
    status: 'ok',
    cached: !!cache.data,
    cache_age_minutes: cache.timestamp
      ? Math.round((Date.now() - cache.timestamp) / 60000)
      : null,
    endpoints: {
      scrape: '/scrape',
      scrape_force: '/scrape?refresh=true',
    },
  });
});

app.listen(PORT, () => {
  console.log(`[LeMonde] Scraper démarré sur port ${PORT}`);
});
