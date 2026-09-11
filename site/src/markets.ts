// Live market strip: cached Yahoo quotes for a configurable watchlist.
// The watchlist lives in KV (radar:watchlist); callers may override per request
// with an explicit symbol list so readers can add any ticker client-side.

type MarketsEnv = { MONITOR: KVNamespace };

export type WatchItem = { symbol: string; name: string };
export type MarketQuote = { symbol: string; name: string; price: number; changePct: number; at: string; source: string };

export const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'ETH-USD', name: 'Ethereum' },
  { symbol: 'SOL-USD', name: 'Solana' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'Nasdaq' },
  { symbol: '^N225', name: 'Nikkei 225' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: '^VIX', name: 'VIX' },
];

const CACHE_MS = 10000;
const SYMBOL_RE = /^[A-Za-z0-9.^=_-]{1,24}$/;

export async function getWatchlist(env: MarketsEnv): Promise<WatchItem[]> {
  const raw = await env.MONITOR.get('radar:watchlist');
  if (raw) {
    try { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) return a; } catch { /* fall through */ }
  }
  return DEFAULT_WATCHLIST;
}

export async function setWatchlist(env: MarketsEnv, list: WatchItem[]) {
  await env.MONITOR.put('radar:watchlist', JSON.stringify(list));
}

async function quote(item: WatchItem): Promise<MarketQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?range=1d&interval=5m`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AntistRadar/1.0)' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json() as { chart?: { result?: { meta?: Record<string, unknown> }[] } };
    const m = d?.chart?.result?.[0]?.meta;
    if (!m) return null;
    const price = Number(m.regularMarketPrice);
    const prev = Number(m.chartPreviousClose ?? m.previousClose);
    if (!Number.isFinite(price)) return null;
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    return {
      symbol: item.symbol,
      name: item.name || String(m.shortName || item.symbol),
      price,
      changePct: Math.round(changePct * 100) / 100,
      at: new Date((Number(m.regularMarketTime) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      source: `https://finance.yahoo.com/quote/${encodeURIComponent(item.symbol)}/`,
    };
  } catch { return null; }
}

export async function getMarkets(env: MarketsEnv, override?: string[]): Promise<{ updatedAt: string; items: MarketQuote[] }> {
  const list: WatchItem[] = (override && override.length)
    ? override.filter(s => SYMBOL_RE.test(s)).slice(0, 30).map(s => ({ symbol: s, name: '' }))
    : await getWatchlist(env);
  if (!list.length) return { updatedAt: new Date().toISOString(), items: [] };

  const cacheKey = 'markets:cache:' + list.map(x => x.symbol).join('|');
  const cached = await env.MONITOR.get(cacheKey);
  if (cached) {
    try {
      const c = JSON.parse(cached);
      if (Date.now() - Date.parse(c.updatedAt) < CACHE_MS && Array.isArray(c.items) && c.items.length) return c;
    } catch { /* refresh below */ }
  }
  const items = (await Promise.all(list.map(quote))).filter((x): x is MarketQuote => x !== null);
  const out = { updatedAt: new Date().toISOString(), items };
  if (items.length) await env.MONITOR.put(cacheKey, JSON.stringify(out), { expirationTtl: 60 });
  return out;
}
