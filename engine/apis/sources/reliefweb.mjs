// ReliefWeb — UN OCHA humanitarian updates.
// The v1 API now requires an approved appname (403 without it); the public
// updates RSS needs no key, so it is the primary path.

import { XMLParser } from 'fast-xml-parser';

const RSS = 'https://reliefweb.int/updates/rss.xml';
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: true });
const array = v => v == null ? [] : Array.isArray(v) ? v : [v];
const strip = v => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export async function searchReports(opts = {}) {
  const { limit = 15 } = opts;
  const res = await fetch(RSS, { headers: { 'User-Agent': 'antist-radar/1.0 (+https://radar.antist.ai)', Accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = parser.parse(await res.text());
  return array(d.rss?.channel?.item).slice(0, limit).map(i => ({
    title: strip(i.title),
    url: typeof i.link === 'string' ? i.link : i.link?.['#text'],
    date: i.pubDate ? new Date(i.pubDate).toISOString() : null,
  }));
}

export async function getDisasters() { return []; }

export async function briefing() {
  try {
    const latestReports = await searchReports({ limit: 15 });
    return { source: 'ReliefWeb (UN OCHA)', timestamp: new Date().toISOString(), latestReports, activeDisasters: [] };
  } catch (e) {
    return { source: 'ReliefWeb (UN OCHA)', timestamp: new Date().toISOString(), rwError: e.message, latestReports: [], activeDisasters: [] };
  }
}

if (process.argv[1]?.endsWith('reliefweb.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
