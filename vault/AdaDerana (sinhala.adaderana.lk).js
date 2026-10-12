// Ada Derana (Sinhala) scraper - scrape only, no server.
// Setup:  npm install cheerio     (Node 18+ needed)
// Run:    node scrape.js [limit]   e.g. node scrape.js 10
// Output: news.json  (+ debug_list.html if no links were found)
const fs = require('fs');
const cheerio = require('cheerio');

const BASE = 'https://sinhala.adaderana.lk';
const LIST_PAGES = [`${BASE}/`, `${BASE}/sinhala-hot-news.php`];
const LIMIT = Number(process.argv[2]) || 20;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept-Language': 'si,en;q=0.8',
};

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const abs = (h) => { try { return new URL(h, BASE).href; } catch { return null; } };
const idOf = (u) => (u.match(/nid=(\d+)/) || u.match(/\/news\/(\d+)/) || [])[1] || null;

async function getHtml(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function collectLinks(html) {
  const $ = cheerio.load(html);
  const found = new Map();
  $('a[href]').each((_, a) => {
    const url = abs($(a).attr('href'));
    if (!url || !/adaderana\.lk/.test(url)) return;
    const id = idOf(url);
    if (!id) return;
    const img = $(a).find('img').first();
    const hint = {
      id, url,
      title: clean($(a).text()) || clean(img.attr('alt')),
      thumb: img.length ? abs(img.attr('data-src') || img.attr('src')) : null,
    };
    const prev = found.get(id);
    if (!prev) found.set(id, hint);
    else {
      if (!prev.title && hint.title) prev.title = hint.title;
      if (!prev.thumb && hint.thumb) prev.thumb = hint.thumb;
    }
  });
  return [...found.values()];
}

function parseArticle(html, hint) {
  const $ = cheerio.load(html);
  const meta = (n) =>
    $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content') || null;

  const image = abs(meta('og:image') || hint.thumb || '') || null;

  let bodyEl = null;
  for (const sel of ['.news-content', '.news-body', '.article-body', 'article', '#content', '.content']) {
    const el = $(sel).first();
    if (el.length && el.find('p').length) { bodyEl = el; break; }
  }
  const paras = (bodyEl ? bodyEl.find('p') : $('p'))
    .map((_, p) => clean($(p).text())).get().filter((t) => t.length > 1);

  const imgs = new Set();
  if (image) imgs.add(image);
  (bodyEl || $('body')).find('img').each((_, i) => {
    const u = abs($(i).attr('data-src') || $(i).attr('src'));
    if (u && !/logo|icon|banner|ads?\//i.test(u)) imgs.add(u);
  });

  return {
    id: hint.id,
    url: hint.url,
    title: clean(meta('og:title') || $('h1').first().text() || hint.title),
    description: clean(meta('og:description') || meta('description')),
    image,
    images: [...imgs],
    publishedAt: meta('article:published_time'),
    keywords: (meta('keywords') || '').split(',').map(clean).filter(Boolean),
    category: meta('article:section'),
    body: paras.join('\n\n'),
  };
}

(async () => {
  const all = new Map();
  for (const page of LIST_PAGES) {
    try {
      const html = await getHtml(page);
      const links = collectLinks(html);
      console.log(`${page} -> ${links.length} links`);
      if (!links.length) fs.writeFileSync('debug_list.html', html);
      links.forEach((l) => all.has(l.id) || all.set(l.id, l));
    } catch (e) {
      console.log('LIST ERROR:', e.message);
    }
  }

  const links = [...all.values()].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, LIMIT);
  if (!links.length) {
    console.log('\nNo article links found. If debug_list.html was saved, send me its first ~100 lines.');
    return;
  }

  const items = [];
  for (const l of links) {
    try {
      const a = parseArticle(await getHtml(l.url), l);
      items.push(a);
      console.log(`[${items.length}/${links.length}] ${a.title.slice(0, 60)} | img:${a.image ? 'yes' : 'NO'} | body:${a.body.length}`);
    } catch (e) {
      console.log('ARTICLE ERROR:', e.message);
    }
  }

  fs.writeFileSync('news.json', JSON.stringify(items, null, 2));
  console.log(`\nSaved ${items.length} articles to news.json`);
})();
