// OFAC — US Treasury sanctions recent actions.
// The full SDN XML exports are hundreds of MB and time out; the recent-actions
// index page is small, dated and stable, so scrape that instead.

import * as cheerio from 'cheerio';

const PAGE = 'https://ofac.treasury.gov/recent-actions';

export async function recentActions() {
  const res = await fetch(PAGE, { headers: { 'User-Agent': 'antist-radar/1.0 (+https://radar.antist.ai)' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const items = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/^\/recent-actions\/(\d{4})(\d{2})(\d{2})$/);
    if (!m) return;
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    const url = `https://ofac.treasury.gov${href}`;
    if (!title || items.some(x => x.url === url)) return;
    items.push({ title, url, date: `${m[1]}-${m[2]}-${m[3]}` });
  });
  return items;
}

export async function briefing() {
  try {
    const recent = await recentActions();
    return { source: 'OFAC Recent Actions', timestamp: new Date().toISOString(), recent: recent.slice(0, 15) };
  } catch (e) {
    return { source: 'OFAC Recent Actions', timestamp: new Date().toISOString(), ofacError: e.message, recent: [] };
  }
}

if (process.argv[1]?.endsWith('ofac.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
