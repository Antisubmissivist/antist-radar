// ReliefWeb / HDX — UN OCHA humanitarian updates.
// The ReliefWeb v1 API needs an approved appname and its RSS intermittently
// returns 406 to non-browser clients, so try RSS first and fall back to the
// Humanitarian Data Exchange (CKAN) API, which returns JSON with a plain UA.

import { XMLParser } from 'fast-xml-parser';

const RSS = 'https://reliefweb.int/updates/rss.xml';
const HDX = 'https://data.humdata.org/api/3/action/package_search?q=crisis+OR+disaster+OR+emergency&rows=10&sort=metadata_modified+desc';
const UA = 'antist-radar/1.0 (+https://radar.antist.ai)';
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: true });
const array = v => v == null ? [] : Array.isArray(v) ? v : [v];
const strip = v => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function viaRss() {
  const res = await fetch(RSS, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const d = parser.parse(await res.text());
  return array(d.rss?.channel?.item).slice(0, 15).map(i => ({
    title: strip(i.title),
    url: typeof i.link === 'string' ? i.link : i.link?.['#text'],
    date: i.pubDate ? new Date(i.pubDate).toISOString() : null,
    // The feed's own summary. Without it the item is a bare headline, and a bare
    // headline is dropped before it reaches the pool (usableEvidence).
    description: strip(i.description || i.encoded || i['content:encoded'] || '').slice(0, 600),
  }));
}

async function viaHdx() {
  const res = await fetch(HDX, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HDX HTTP ${res.status}`);
  const d = await res.json();
  return (d?.result?.results || []).slice(0, 15).map(p => ({
    title: p.title,
    url: `https://data.humdata.org/dataset/${p.name}`,
    date: p.metadata_modified || null,
    description: strip(p.notes || p.title || '').slice(0, 600),
  }));
}

export async function searchReports() {
  try { return await viaRss(); } catch { return await viaHdx(); }
}
export async function getDisasters() { return []; }

export async function briefing() {
  try {
    const latestReports = await searchReports();
    return { source: 'ReliefWeb (UN OCHA)', timestamp: new Date().toISOString(), latestReports, activeDisasters: [] };
  } catch (e) {
    return { source: 'ReliefWeb (UN OCHA)', timestamp: new Date().toISOString(), rwError: e.message, latestReports: [], activeDisasters: [] };
  }
}

if (process.argv[1]?.endsWith('reliefweb.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
