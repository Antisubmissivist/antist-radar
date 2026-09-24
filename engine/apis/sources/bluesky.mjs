// Bluesky — AT Protocol social intelligence.
//
// The public AppView (public.api.bsky.app) answers anonymous searchPosts with
// HTTP 403 now (a CDN rule, not a rate limit), and bsky.social wants a token, so
// the search runs authenticated against the PDS. Credentials are an app password
// — revocable, and not the account password: BLUESKY_HANDLE + BLUESKY_APP_PASSWORD.

import { safeFetch } from '../utils/fetch.mjs';

const PDS = process.env.BLUESKY_PDS || 'https://bsky.social';

// Session cache — one login per process.
let session = null;

async function auth() {
  const id = process.env.BLUESKY_HANDLE;
  const pw = process.env.BLUESKY_APP_PASSWORD;
  if (!id || !pw) return null;
  if (session && Date.now() < session.expires) return session;
  const r = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'AntistRadar/1.0' },
    body: JSON.stringify({ identifier: id, password: pw }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Bluesky login failed (HTTP ${r.status}): ${(await r.text().catch(() => '')).slice(0, 150)}`);
  const j = await r.json();
  if (!j?.accessJwt) throw new Error('Bluesky login returned no accessJwt');
  session = { jwt: j.accessJwt, expires: Date.now() + 90 * 60 * 1000 };
  return session;
}

// Rate-limit-safe delay
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Search public posts by query string (authenticated)
export async function searchPosts(query, opts = {}) {
  const { limit = 25, sort = 'latest' } = opts;
  const s = await auth();
  if (!s) return { error: 'No Bluesky credentials. Set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD.' };
  const params = new URLSearchParams({ q: query, limit: String(limit), sort });
  return safeFetch(`${PDS}/xrpc/app.bsky.feed.searchPosts?${params}`, { headers: { Authorization: `Bearer ${s.jwt}` } });
}

// Compact a post for briefing output
function compactPost(post) {
  const record = post?.record || post;
  const author = post?.author;
  return {
    text: (record?.text || '').slice(0, 200),
    author: author?.handle || author?.displayName || 'unknown',
    date: record?.createdAt || null,
    likes: post?.likeCount ?? 0,
  };
}

// Briefing — search key geopolitical/market terms and categorize
export async function briefing() {
  const searchQueries = [
    { label: 'conflict', q: 'Iran war OR missile strike OR sanctions' },
    { label: 'markets', q: 'market crash OR oil prices OR gold OR recession' },
    { label: 'health', q: 'pandemic OR outbreak OR epidemic' },
  ];

  const allPosts = [];
  const topicResults = {};
  let error = null;

  for (const { label, q } of searchQueries) {
    try {
      const result = await searchPosts(q, { limit: 25 });
      if (result?.error) { error = result.error; continue; }
      const posts = (result?.posts || []).map(compactPost);
      topicResults[label] = posts;
      allPosts.push(...posts);
    } catch (e) { error = e.message; }
    // Small delay between searches to be polite to the API
    await delay(1500);
  }

  return {
    source: 'Bluesky',
    timestamp: new Date().toISOString(),
    ...(allPosts.length === 0 ? { blueskyError: error || 'search returned 0 posts' } : {}),
    topics: {
      conflict: topicResults.conflict || [],
      markets: topicResults.markets || [],
      health: topicResults.health || [],
    },
  };
}

// Run standalone
if (process.argv[1]?.endsWith('bluesky.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
