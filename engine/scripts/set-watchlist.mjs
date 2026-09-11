import '../apis/utils/env.mjs';
// Set the live price-strip watchlist.
//   node scripts/set-watchlist.mjs "BTC-USD:Bitcoin,SOL-USD:Solana,^N225:Nikkei 225"
const raw = process.argv.slice(2).join(',');
if (!raw) { console.error('Usage: node scripts/set-watchlist.mjs "SYM:Name,SYM:Name"'); process.exit(1); }
const symbols = raw.split(',').map(s => {
  const i = s.indexOf(':');
  const sym = (i >= 0 ? s.slice(0, i) : s).trim();
  const name = (i >= 0 ? s.slice(i + 1) : '').trim();
  return sym ? { symbol: sym, name: name || sym } : null;
}).filter(Boolean);
const token = process.env.RADAR_INGEST_TOKEN;
if (!token) throw new Error('Missing RADAR_INGEST_TOKEN in .env');
const base = process.env.RADAR_URL || 'https://radar.antist.ai';
const r = await fetch(base + '/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ symbols }) });
const body = await r.json();
console.log(JSON.stringify({ status: r.status, ...body }));
if (!r.ok || !body.ok) process.exit(1);
