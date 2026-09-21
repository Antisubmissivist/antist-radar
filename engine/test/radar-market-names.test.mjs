import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGS } from '../lib/radar-contract.mjs';

// markets.ts is TypeScript inside the Worker, so read the table out of source
// rather than importing it. What matters here is the data, not the types.
const SRC = readFileSync(new URL('../../site/src/markets.ts', import.meta.url), 'utf8');

const block = SRC.slice(SRC.indexOf('MARKET_NAMES: Record<string, LocalizedName> = {'), SRC.indexOf('const CONTRACT_MONTH'));
const entries = [...block.matchAll(/'([^']+)':\s*\{\s*ja:\s*'([^']*)',\s*en:\s*'([^']*)',\s*zh:\s*'([^']*)'\s*\}/g)]
  .map(m => ({ symbol: m[1], ja: m[2], en: m[3], zh: m[4] }));

test('the curated table actually parsed', () => {
  assert.ok(entries.length >= 30, `expected the full watchlist, parsed ${entries.length}`);
});

test('every curated symbol has all three languages filled', () => {
  for (const e of entries) for (const l of LANGS) assert.ok(e[l]?.trim(), `${e.symbol} is missing ${l}`);
});

test('the three languages are actually different scripts, not English copied three times', () => {
  // A row where ja and zh are both the English string means nobody translated
  // it — the exact failure the table exists to prevent. Latin-only tickers
  // (AMD, Meta) are legitimately identical, so require a translated majority.
  const translated = entries.filter(e => /[\u3040-\u30ff\u4e00-\u9fff]/.test(e.ja) && /[\u4e00-\u9fff]/.test(e.zh));
  assert.ok(translated.length >= entries.length * 0.7,
    `only ${translated.length}/${entries.length} rows carry real ja+zh names`);
});

test('the symbols the strip ships with are all curated', () => {
  const shipped = ['^GSPC', '^IXIC', '^DJI', '^N225', '^VIX', 'GC=F', 'SI=F', 'CL=F', 'BTC-USD', 'ETH-USD', 'NVDA', 'TSM', '7203.T', '6758.T', 'SMH', 'TLT'];
  const have = new Set(entries.map(e => e.symbol));
  for (const s of shipped) assert.ok(have.has(s), `${s} is on the strip but has no curated name`);
});

// The bug the user reported: the gold tile read "Gold Dec 26". The stripper is
// asserted directly because the first version of it was built with RegExp and
// a template string, which ate the backslashes and matched nothing.
const CONTRACT_MONTH = /\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}$/;
const cleanVendorName = (raw, symbol) => {
  let t = String(raw || '').trim().replace(CONTRACT_MONTH, '');
  if (/-USD$/i.test(symbol)) t = t.replace(/\s+USD$/i, '');
  return t.trim() || symbol;
};

test('POISON: a futures contract month is stripped, not shipped to the tile', () => {
  assert.equal(cleanVendorName('Gold Dec 26', 'GC=F'), 'Gold');
  assert.equal(cleanVendorName('Crude Oil Nov 26', 'CL=F'), 'Crude Oil');
  assert.equal(cleanVendorName('Silver Dec 26', 'SI=F'), 'Silver');
});

test('the pattern as actually written in markets.ts strips the month', () => {
  // Asserting on the source TEXT needs an escaped backslash, and getting that
  // wrong is how a check passes while the thing it guards is broken. So lift
  // the pattern out of the file and run it. The first version of this was
  // built with RegExp and a template string, which ate the backslashes and
  // matched nothing; that version fails here.
  const m = SRC.match(/const CONTRACT_MONTH = (\/.*\/);/);
  assert.ok(m, 'CONTRACT_MONTH must be a single-line regex literal');
  const live = new Function('return ' + m[1])();
  assert.equal('Gold Dec 26'.replace(live, ''), 'Gold');
  assert.equal('Crude Oil Nov 26'.replace(live, ''), 'Crude Oil');
  assert.equal('Gold'.replace(live, ''), 'Gold', 'a name with no contract month must survive untouched');
});

test('a trailing USD is dropped for crypto pairs only', () => {
  assert.equal(cleanVendorName('Bitcoin USD', 'BTC-USD'), 'Bitcoin');
  assert.equal(cleanVendorName('ProShares Ultra USD', 'UUP'), 'ProShares Ultra USD');
});

test('an unknown symbol never renders as an empty label', () => {
  assert.equal(cleanVendorName('', 'FOO'), 'FOO');
  assert.equal(cleanVendorName(null, 'BAR'), 'BAR');
});
