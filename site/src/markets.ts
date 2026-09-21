// Live market strip: cached Yahoo quotes for a configurable watchlist.
// The watchlist lives in KV (radar:watchlist); callers may override per request
// with an explicit symbol list so readers can add any ticker client-side.

type MarketsEnv = { DB: D1Database };

export type WatchItem = { symbol: string; name: string };
export type LocalizedName = { ja: string; en: string; zh: string };
export type MarketQuote = { symbol: string; name: string; names: LocalizedName; price: number; changePct: number; at: string; source: string };

// Yahoo only ever answers in English — passing lang=ja-JP/zh-Hans-CN returns
// the same string — and for futures it answers with the individual contract,
// so the gold tile read "Gold Dec 26". Proper nouns with settled translations
// are deterministic data, so they live here rather than being guessed per
// request. Keys are normalised symbols.
export const MARKET_NAMES: Record<string, LocalizedName> = {
  '^GSPC': { ja: 'S&P500種指数', en: 'S&P 500', zh: '标普500指数' },
  '^IXIC': { ja: 'ナスダック総合指数', en: 'Nasdaq Composite', zh: '纳斯达克综合指数' },
  '^DJI': { ja: 'ダウ工業株30種平均', en: 'Dow Jones Industrial Average', zh: '道琼斯工业平均指数' },
  '^RUT': { ja: 'ラッセル2000指数', en: 'Russell 2000', zh: '罗素2000指数' },
  '^N225': { ja: '日経平均株価', en: 'Nikkei 225', zh: '日经225指数' },
  '^VIX': { ja: 'VIX指数（恐怖指数）', en: 'CBOE Volatility Index', zh: 'VIX恐慌指数' },
  'TLT': { ja: '米国20年超国債ETF', en: 'iShares 20+ Year Treasury Bond ETF', zh: '20年期以上美国国债ETF' },
  'HYG': { ja: '米ハイイールド社債ETF', en: 'iShares High Yield Corporate Bond ETF', zh: '高收益公司债ETF' },
  'LQD': { ja: '米投資適格社債ETF', en: 'iShares Investment Grade Corporate Bond ETF', zh: '投资级公司债ETF' },
  'GC=F': { ja: '金先物', en: 'Gold Futures', zh: '黄金期货' },
  'SI=F': { ja: '銀先物', en: 'Silver Futures', zh: '白银期货' },
  'CL=F': { ja: 'WTI原油先物', en: 'WTI Crude Oil Futures', zh: 'WTI原油期货' },
  'BZ=F': { ja: 'ブレント原油先物', en: 'Brent Crude Oil Futures', zh: '布伦特原油期货' },
  'NG=F': { ja: '天然ガス先物', en: 'Natural Gas Futures', zh: '天然气期货' },
  'BTC-USD': { ja: 'ビットコイン', en: 'Bitcoin', zh: '比特币' },
  'ETH-USD': { ja: 'イーサリアム', en: 'Ethereum', zh: '以太坊' },
  'SOL-USD': { ja: 'ソラナ', en: 'Solana', zh: 'Solana' },
  'NVDA': { ja: 'エヌビディア', en: 'NVIDIA', zh: '英伟达' },
  'MSFT': { ja: 'マイクロソフト', en: 'Microsoft', zh: '微软' },
  'GOOGL': { ja: 'アルファベット', en: 'Alphabet', zh: 'Alphabet（谷歌母公司）' },
  'META': { ja: 'メタ', en: 'Meta', zh: 'Meta' },
  'AAPL': { ja: 'アップル', en: 'Apple', zh: '苹果' },
  'AMZN': { ja: 'アマゾン', en: 'Amazon', zh: '亚马逊' },
  'AVGO': { ja: 'ブロードコム', en: 'Broadcom', zh: '博通' },
  'TSM': { ja: 'TSMC（台湾積体電路）', en: 'TSMC', zh: '台积电' },
  'AMD': { ja: 'AMD', en: 'AMD', zh: 'AMD' },
  'INTC': { ja: 'インテル', en: 'Intel', zh: '英特尔' },
  'TSLA': { ja: 'テスラ', en: 'Tesla', zh: '特斯拉' },
  'PLTR': { ja: 'パランティア', en: 'Palantir', zh: 'Palantir' },
  'SMH': { ja: '半導体ETF（SMH）', en: 'VanEck Semiconductor ETF', zh: '半导体ETF' },
  '7203.T': { ja: 'トヨタ自動車', en: 'Toyota Motor', zh: '丰田汽车' },
  '6758.T': { ja: 'ソニーグループ', en: 'Sony Group', zh: '索尼集团' },
  '9984.T': { ja: 'ソフトバンクグループ', en: 'SoftBank Group', zh: '软银集团' },
  '8306.T': { ja: '三菱UFJフィナンシャル・グループ', en: 'Mitsubishi UFJ Financial Group', zh: '三菱日联金融集团' },
  'USDJPY=X': { ja: '米ドル/円', en: 'USD/JPY', zh: '美元/日元' },
  'EURUSD=X': { ja: 'ユーロ/米ドル', en: 'EUR/USD', zh: '欧元/美元' },
  'CNY=X': { ja: '米ドル/人民元', en: 'USD/CNY', zh: '美元/人民币' },
};

// Yahoo labels a futures symbol with its front-month contract, so GC=F came
// back as "Gold Dec 26". Written as a literal: building this with RegExp and a
// template string silently ate the backslashes and matched nothing.
const CONTRACT_MONTH = /\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}$/;

// For a symbol nobody curated, Yahoo's own label is the best available answer —
// minus the contract month, or a reader watching gold sees whichever contract
// happens to be front-month today.
export function cleanVendorName(raw: string, symbol: string): string {
  let t = String(raw || '').trim().replace(CONTRACT_MONTH, '');
  if (/-USD$/i.test(symbol)) t = t.replace(/\s+USD$/i, '');
  return t.trim() || symbol;
}

export function resolveNames(symbol: string, vendorName?: string): LocalizedName {
  const curated = MARKET_NAMES[normalizeSymbol(symbol)];
  if (curated) return curated;
  const t = cleanVendorName(vendorName || symbol, symbol);
  return { ja: t, en: t, zh: t };
}

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

// Investing.com-style indices use a leading dot (".VIX"); Yahoo uses a caret.
export function normalizeSymbol(s: string): string {
  return String(s || '').trim().replace(/^\./, '^').toUpperCase();
}

export async function getWatchlist(env: MarketsEnv): Promise<WatchItem[]> {
  try {
    const r = await env.DB.prepare("SELECT v FROM settings WHERE k='watchlist'").first() as { v?: string } | null;
    if (r && r.v) { const a = JSON.parse(r.v); if (Array.isArray(a) && a.length) return a; }
  } catch { /* fall through */ }
  return DEFAULT_WATCHLIST;
}

export async function setWatchlist(env: MarketsEnv, list: WatchItem[]) {
  await env.DB.prepare('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('watchlist', JSON.stringify(list)).run();
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
    const names = resolveNames(item.symbol, String(m.shortName || m.longName || ''));
    return {
      symbol: item.symbol,
      // `name` stays English for the published snapshot contract; `names`
      // carries all three for the strip, which renders per locale.
      name: names.en || item.name || item.symbol,
      names,
      price,
      changePct: Math.round(changePct * 100) / 100,
      at: new Date((Number(m.regularMarketTime) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      source: `https://finance.yahoo.com/quote/${encodeURIComponent(item.symbol)}/`,
    };
  } catch { return null; }
}

export async function getMarkets(env: MarketsEnv, override?: string[]): Promise<{ updatedAt: string; items: MarketQuote[] }> {
  const list: WatchItem[] = (override && override.length)
    ? override.map(normalizeSymbol).filter(s => SYMBOL_RE.test(s)).slice(0, 30).map(s => ({ symbol: s, name: '' }))
    : await getWatchlist(env);
  if (!list.length) return { updatedAt: new Date().toISOString(), items: [] };

  // Cache via the Cache API (free, no KV write quota). KV writes are reserved
  // for the snapshot/ledger, whose daily budget is small.
  const ck = new Request('https://radar.antist.ai/__markets?symbols=' + encodeURIComponent(list.map(x => x.symbol).join(',')), { method: 'GET' });
  const cache = (caches as unknown as { default: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } }).default;
  try {
    const hit = await cache.match(ck);
    if (hit) { const c = await hit.json() as { updatedAt: string; items: MarketQuote[] }; if (Date.now() - Date.parse(c.updatedAt) < CACHE_MS && Array.isArray(c.items) && c.items.length) return c; }
  } catch { /* refresh below */ }
  const items = (await Promise.all(list.map(quote))).filter((x): x is MarketQuote => x !== null);
  const out = { updatedAt: new Date().toISOString(), items };
  if (items.length) { try { await cache.put(ck, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' } })); } catch { /* cache best-effort */ } }
  return out;
}

export type SymbolHit = { symbol: string; name: string; type: string; exchange: string };

export async function searchSymbols(q: string): Promise<SymbolHit[]> {
  try {
    const query = q.trim().replace(/^\./, '^');
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AntistRadar/1.0)' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const d = await r.json() as { quotes?: Record<string, unknown>[] };
    return (d?.quotes || []).filter(x => x.symbol).map(x => ({
      symbol: String(x.symbol),
      name: String(x.shortname || x.longname || x.symbol),
      type: String(x.typeDisp || x.quoteType || ''),
      exchange: String(x.exchange || ''),
    }));
  } catch { return []; }
}
