// AI Infrastructure Layer — model releases, pricing shifts, builder chatter.
// Reuses the Follow-Builders feeds already vetted in osint-enhanced-brief,
// plus Hacker News and official changelog RSS. All free, no API key.

import { pathToFileURL } from 'node:url';
import { safeFetch } from '../utils/fetch.mjs';

const FB = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main';
const HN = 'https://hn.algolia.com/api/v1/search_by_date';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

const FEEDS = [
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { name: 'Google Research', url: 'https://research.google/blog/rss/' },
  { name: 'HuggingFace', url: 'https://huggingface.co/blog/feed.xml' },
];

// Words that mean "the ground moved", not "someone had an opinion".
const SIGNAL_WORDS = /(pricing|price cut|deprecat|shut ?down|sunset|rate limit|launch|release|generally available|general availability|open[- ]sourc|benchmark|context window|now available)/i;

const HOURS = parseInt(process.env.AI_LOOKBACK_HOURS || '24', 10);
const HN_MIN_POINTS = parseInt(process.env.AI_HN_MIN_POINTS || '80', 10);

async function fetchText(url, timeout = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const res = await fetch(url, { signal: c.signal, headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function strip(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function parseRss(xml, sourceName, since) {
  const items = [];
  // Handles both RSS <item> and Atom <entry> without pulling in a parser.
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) || [];
  for (const b of blocks) {
    const title = strip((b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
    const linkMatch = b.match(/<link[^>]*href=["']([^"']+)/) || b.match(/<link[^>]*>([\s\S]*?)<\/link>/);
    const link = strip(linkMatch ? linkMatch[1] : '');
    const dateMatch = b.match(/<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/);
    const ts = Date.parse(dateMatch ? strip(dateMatch[2]) : '');
    if (!title) continue;
    if (Number.isFinite(ts) && ts < since) continue;
    items.push({
      source: sourceName,
      title,
      url: link || null,
      publishedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      signal: SIGNAL_WORDS.test(title),
    });
  }
  return items;
}

async function builders() {
  const files = ['feed-x.json', 'feed-podcasts.json', 'feed-blogs.json'];
  const [x, pods, blogs] = await Promise.all(
    files.map(f => safeFetch(`${FB}/${f}`, { timeout: 12000, headers: UA }).catch(e => ({ error: e.message })))
  );

  // feed-x.json is a list of BUILDERS, each holding a `tweets` array —
  // not a flat list of posts. Flatten first or every engagement count is 0.
  const posts = (x?.x || [])
    .flatMap(builder => (builder.tweets || []).map(t => ({
      kind: 'x',
      name: builder.name,
      handle: builder.handle,
      text: String(t.text || '').slice(0, 400),
      url: t.url || null,
      likes: t.likes ?? 0,
      retweets: t.retweets ?? 0,
      replies: t.replies ?? 0,
      publishedAt: t.createdAt || null,
    })))
    // Skill's rule: rank by engagement, keep the top handful.
    .sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets))
    .slice(0, 8);

  return {
    generatedAt: x?.generatedAt || null,
    xBuilders: x?.stats?.xBuilders ?? posts.length,
    podcastEpisodes: pods?.stats?.podcastEpisodes ?? (pods?.podcasts || []).length,
    blogPosts: blogs?.stats?.blogPosts ?? (blogs?.blogs || []).length,
    posts,
    podcasts: (pods?.podcasts || []).slice(0, 5).map(p => ({
      title: p.title, show: p.show || p.podcast, url: p.url || p.link, publishedAt: p.publishedAt || p.date,
    })),
    blogs: (blogs?.blogs || []).slice(0, 5).map(p => ({
      title: p.title, site: p.site || p.source, url: p.url || p.link, publishedAt: p.publishedAt || p.date,
    })),
    errors: [x, pods, blogs].filter(f => f?.error).map(f => f.error),
  };
}

// Topic filter is applied locally, not as an Algolia `query`. A long
// "AI OR LLM OR ..." query silently returns almost nothing on search_by_date;
// pulling the whole high-score window and filtering here is both more
// reliable and easy to widen.
const AI_TOPIC = /\b(ai|llm|gpt|claude|gemini|openai|anthropic|deepseek|qwen|mistral|llama|agent|model|transformer|inference|embedding|rag|diffusion|nvidia|cuda|gpus?|vllm|pytorch|fine[- ]tun|prompt|token)\b/i;

async function hackernews(since) {
  const filters = `points>${HN_MIN_POINTS},created_at_i>${Math.floor(since / 1000)}`;
  const url = `${HN}?tags=story&numericFilters=${encodeURIComponent(filters)}&hitsPerPage=200`;
  const d = await safeFetch(url, { timeout: 12000, headers: UA });
  if (d?.error) return { error: d.error, stories: [] };
  const hits = (d.hits || []).filter(h => AI_TOPIC.test(h.title || ''));
  return {
    minPoints: HN_MIN_POINTS,
    scanned: (d.hits || []).length,
    matched: hits.length,
    stories: hits
      .map(h => ({
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        points: h.points,
        comments: h.num_comments,
        publishedAt: h.created_at,
        signal: SIGNAL_WORDS.test(h.title || ''),
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 12),
  };
}

async function changelogs(since) {
  const items = [];
  const errors = [];
  await Promise.all(FEEDS.map(async f => {
    try {
      items.push(...parseRss(await fetchText(f.url), f.name, since));
    } catch (e) {
      errors.push(`${f.name}: ${e.message}`);
    }
  }));
  items.sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
  return { items: items.slice(0, 20), errors, feedsTried: FEEDS.length, feedsOk: FEEDS.length - errors.length };
}

export async function briefing() { return collect(); }

export async function collect() {
  const since = Date.now() - HOURS * 3600 * 1000;
  const [b, hn, cl] = await Promise.all([
    builders().catch(e => ({ error: e.message, posts: [] })),
    hackernews(since).catch(e => ({ error: e.message, stories: [] })),
    changelogs(since).catch(e => ({ error: e.message, items: [], errors: [] })),
  ]);

  // "Hard signals" = releases/pricing/deprecations, i.e. things that change
  // what you should build on. Opinions are deliberately filtered out here.
  const hardSignals = [
    ...(cl.items || []).filter(i => i.signal)
      .map(i => ({ from: i.source, title: i.title, url: i.url, at: i.publishedAt })),
    ...(hn.stories || []).filter(s => s.signal)
      .map(s => ({ from: 'HN', title: s.title, url: s.url, at: s.publishedAt, points: s.points })),
  ];

  const errors = [
    ...(b.errors || []),
    ...(cl.errors || []),
    ...(hn.error ? [`HN: ${hn.error}`] : []),
    ...(b.error ? [`Builders: ${b.error}`] : []),
  ];

  return {
    lookbackHours: HOURS,
    builders: b,
    hackernews: hn,
    changelogs: cl,
    hardSignals: hardSignals.slice(0, 15),
    // Report degradation out loud rather than letting a dead feed look quiet.
    degraded: errors.length > 0,
    errors,
    actionable: hardSignals.length > 0,
    timestamp: new Date().toISOString(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await collect(), null, 2));
}
