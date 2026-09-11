// FX Layer — the JPY/CNY/USD triangle Antist actually lives in.
// Yahoo Finance quotes, no API key. Thresholds are what make this actionable:
// a rate without a band is just a number you scroll past.

import { pathToFileURL } from 'node:url';
import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

const PAIRS = {
  'JPY=X':    { label: 'USD/JPY', desc: '美元兑日元' },
  'CNYJPY=X': { label: 'CNY/JPY', desc: '人民币兑日元（换汇最相关）' },
  'USDCNY=X': { label: 'USD/CNY', desc: '美元兑人民币' },
  'EURJPY=X': { label: 'EUR/JPY', desc: '欧元兑日元' },
};

// Bands: cross either edge and it is worth a push. Override in .env, e.g.
// FX_BANDS="CNYJPY=X:21.5:23.5,JPY=X:145:158"
function loadBands() {
  const bands = {
    'CNYJPY=X': { low: 21.5, high: 23.5 },
    'JPY=X': { low: 145, high: 158 },
  };
  for (const part of (process.env.FX_BANDS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const bits = part.split(':');
    if (bits.length !== 3) continue;
    const [sym, low, high] = bits;
    if (Number.isFinite(+low) && Number.isFinite(+high)) bands[sym] = { low: +low, high: +high };
  }
  return bands;
}

// A 1-day move that clears this is noteworthy on its own, band or not.
const MOVE_PCT = parseFloat(process.env.FX_MOVE_PCT || '1.0');

async function quote(symbol) {
  const url = `${BASE}/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
  const data = await safeFetch(url, { timeout: 10000, headers: UA });
  const r = data?.chart?.result?.[0];
  if (!r) return { symbol, error: data?.error || 'no chart result' };

  const meta = r.meta || {};
  const closes = (r.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  const price = meta.regularMarketPrice ?? closes.at(-1);
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? closes.at(-2);
  if (!Number.isFinite(price)) return { symbol, error: 'no price' };

  const round = n => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null);
  const changePct = Number.isFinite(prev) && prev ? ((price - prev) / prev) * 100 : 0;

  return {
    symbol,
    ...PAIRS[symbol],
    price: round(price),
    prevClose: round(prev),
    changePct: Math.round(changePct * 100) / 100,
    month: { high: round(Math.max(...closes)), low: round(Math.min(...closes)), samples: closes.length },
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

export async function briefing() { return collect(); }

export async function collect() {
  const bands = loadBands();
  const results = await Promise.allSettled(Object.keys(PAIRS).map(quote));

  const rates = {};
  const alerts = [];
  let ok = 0;

  for (const r of results) {
    const q = r.status === 'fulfilled' ? r.value : { symbol: 'unknown', error: r.reason?.message };
    rates[q.symbol] = q;
    if (q.error) continue;
    ok++;

    const band = bands[q.symbol];
    if (band) {
      q.band = band;
      if (q.price <= band.low) {
        q.bandState = 'below';
        alerts.push({ symbol: q.symbol, label: q.label, severity: 'high', price: q.price,
          message: `${q.label} ${q.price} 跌破下轨 ${band.low}` });
      } else if (q.price >= band.high) {
        q.bandState = 'above';
        alerts.push({ symbol: q.symbol, label: q.label, severity: 'high', price: q.price,
          message: `${q.label} ${q.price} 突破上轨 ${band.high}` });
      } else {
        q.bandState = 'inside';
        // How much room is left before the next push fires.
        q.distToLowPct = Math.round(((q.price - band.low) / q.price) * 10000) / 100;
        q.distToHighPct = Math.round(((band.high - q.price) / q.price) * 10000) / 100;
      }
    }

    if (Math.abs(q.changePct) >= MOVE_PCT) {
      alerts.push({ symbol: q.symbol, label: q.label, severity: 'medium', price: q.price,
        message: `${q.label} 单日 ${q.changePct > 0 ? '+' : ''}${q.changePct}%（阈值 ${MOVE_PCT}%）` });
    }
  }

  return {
    rates,
    bands,
    movePctThreshold: MOVE_PCT,
    alerts,
    actionable: alerts.length > 0,
    summary: { pairs: Object.keys(PAIRS).length, ok, failed: Object.keys(PAIRS).length - ok },
    timestamp: new Date().toISOString(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await collect(), null, 2));
}
