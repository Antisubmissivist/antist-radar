// GDELT — Global Database of Events, Language, and Tone
// No auth required. Updates every 15 minutes. Monitors news in 100+ languages.
// DOC 2.0 API: full-text search across last 3 months of global news
// GEO 2.0 API: geolocation mapping of events

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://api.gdeltproject.org/api/v2';

// GDELT rejects a bare OR query with a 200 whose body is the text "Queries
// containing OR'd terms must be surrounded by ()". The request "succeeds", so
// the health check only sees a payload with no articles and marks the source
// degraded — which is what it did for months. Parenthesise OR queries here so
// no caller can forget.
export const orQuery = (q) => {
  const s = String(q || '').trim();
  return (/\bOR\b/i.test(s) && !s.startsWith('(')) ? `(${s})` : s;
};

// Search recent global events/articles by keyword
export async function searchEvents(query = '', opts = {}) {
  const {
    mode = 'ArtList',       // ArtList, TimelineVol, TimelineVolInfo, TimelineTone, TimelineLang, TimelineSourceCountry
    maxRecords = 75,
    timespan = '24h',       // e.g. "24h", "7d", "3m"
    format = 'json',
    sortBy = 'DateDesc',    // DateDesc, DateAsc, ToneDesc, ToneAsc
    retries = 1,
    retryDelayMs = 6000,
  } = opts;

  // If no query, use broad geopolitical terms
  const q = orQuery(query || 'conflict OR crisis OR military OR sanctions OR war OR economy');
  const params = new URLSearchParams({
    query: q,
    mode,
    maxrecords: String(maxRecords),
    timespan,
    format,
    sort: sortBy,
  });

  return safeFetch(`${BASE}/doc/doc?${params}`, { timeout: 14000, retries, retryDelayMs });
}

// Get tone/sentiment timeline for a topic
export async function toneTrend(query, timespan = '7d') {
  const params = new URLSearchParams({
    query: orQuery(query),
    mode: 'TimelineTone',
    timespan,
    format: 'json',
  });
  return safeFetch(`${BASE}/doc/doc?${params}`, { timeout: 14000, retryDelayMs: 6000 });
}

// Get volume timeline for a topic (how much coverage)
export async function volumeTrend(query, timespan = '7d') {
  const params = new URLSearchParams({
    query: orQuery(query),
    mode: 'TimelineVol',
    timespan,
    format: 'json',
  });
  return safeFetch(`${BASE}/doc/doc?${params}`, { timeout: 14000, retryDelayMs: 6000 });
}

// GEO API — geographic event mapping
export async function geoEvents(query = '', opts = {}) {
  const {
    mode = 'PointData',
    timespan = '24h',
    format = 'GeoJSON',
    maxPoints = 500,
  } = opts;

  const q = orQuery(query || 'conflict OR military OR protest OR explosion');
  const params = new URLSearchParams({
    query: q,
    mode,
    timespan,
    format,
    maxpoints: String(maxPoints),
  });

  return safeFetch(`${BASE}/geo/geo?${params}`, { timeout: 12000, retryDelayMs: 6000 });
}

// Compact article for briefing
function compactArticle(a) {
  return {
    title: a.title,
    url: a.url,
    date: a.seendate,
    domain: a.domain,
    language: a.language,
    country: a.sourcecountry,
  };
}

// GDELT rate limit: 1 request per 5 seconds
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Briefing mode — get top global events summary (sequential due to rate limit)
export async function briefing() {
  // Short query + patient retry: GDELT returns HTTP 429 on long OR queries and
  // on bursts, so fewer terms plus backoff recovers far more often.
  const all = await searchEvents(
    'conflict OR sanctions OR military OR election',
    { maxRecords: 40, timespan: '24h', retries: 1, retryDelayMs: 6000 }
  );

  const articles = (all?.articles || []).map(compactArticle);

  // Categorize by keyword matching in titles
  const categorize = (keywords) => articles.filter(a =>
    keywords.some(k => a.title?.toLowerCase().includes(k))
  );

  // Geo events — separate API, same IP budget. If the first query already got
  // refused there is no point spending another 18s to be refused again.
  let geoPoints = [];
  const rateLimited = articles.length === 0;
  if (!rateLimited) {
    await delay(5500);
  }
  try {
    if (rateLimited) throw new Error('skipped: first GDELT query returned nothing (likely 429)');
    const geo = await geoEvents('conflict OR military OR protest OR crisis', { maxPoints: 30, timespan: '24h' });
    geoPoints = (geo?.features || []).filter(f => f.geometry?.coordinates).map(f => ({
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      name: f.properties?.name || f.properties?.html || '',
      count: f.properties?.count || 1,
      type: f.properties?.type || 'event',
    }));
  } catch (e) { /* geo endpoint optional — don't break briefing */ }

  return {
    source: 'GDELT',
    timestamp: new Date().toISOString(),
    ...(articles.length === 0 ? { gdeltError: all?.error || 'no articles returned — GDELT likely rate-limited (HTTP 429)' } : {}),
    totalArticles: articles.length,
    allArticles: articles,
    geoPoints,
    conflicts: categorize(['military', 'conflict', 'war', 'strike', 'missile', 'attack', 'bomb', 'troops']),
    economy: categorize(['economy', 'recession', 'inflation', 'market', 'sanctions', 'tariff', 'trade', 'gdp']),
    health: categorize(['pandemic', 'outbreak', 'epidemic', 'disease', 'virus', 'health']),
    crisis: categorize(['crisis', 'disaster', 'emergency', 'refugee', 'famine']),
  };
}

// Run standalone
if (process.argv[1]?.endsWith('gdelt.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
