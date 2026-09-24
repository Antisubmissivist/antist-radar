// Parity check: the Telegram brief and the homepage must lead every board with
// the same three items, in the same order.
//
// They already share selectBoard() and the candidate set (boardCandidates), so
// this is a regression guard rather than a hope: run it after touching either
// side. It compares by URL, which cannot be confused by truncation or by HTML
// entity escaping the way a title comparison can.
//
//   node scripts/verify-parity.mjs            # zh
//   node scripts/verify-parity.mjs --lang=ja
import '../apis/utils/env.mjs';
import * as cheerio from 'cheerio';

const base = process.env.RADAR_URL || 'https://radar.antist.ai';
const token = process.env.RADAR_INGEST_TOKEN;
if (!token) throw new Error('Missing RADAR_INGEST_TOKEN');
const lang = (process.argv.find(a => a.startsWith('--lang=')) || '').split('=')[1] || 'zh';

const BOARDS = ['ai', 'tech', 'japan-residence', 'japan-life', 'geopolitics', 'crypto', 'stocks', 'christianity'];

const digest = await fetch(`${base}/api/digest?lang=${lang}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
if (!digest?.ok) throw new Error('digest endpoint failed: ' + JSON.stringify(digest).slice(0, 200));

// The digest emits one <details> per board in BOARDS order, then the forecast
// block, so position is the mapping — no need to parse the localized labels.
const blocks = String(digest.markdown || '').split('<details><summary>').slice(1);
const bot = {};
blocks.forEach((b, i) => {
  if (i >= BOARDS.length) return;
  bot[BOARDS[i]] = [...b.matchAll(/\[链接\]\((https?:\/\/[^)]+)\)/g)].map(m => m[1]);
});

const html = await fetch(`${base}/${lang}`).then(r => r.text());
const $ = cheerio.load(html);

let ok = true;
for (const b of BOARDS) {
  const home = $(`[data-board="${b}"] article`).map((_, el) => $(el).attr('data-url')).get();
  const same = JSON.stringify(bot[b] || []) === JSON.stringify(home);
  if (!same) ok = false;
  console.log((same ? 'MATCH ' : 'DIFFER') + ' ' + b.padEnd(16) + ' bot ' + (bot[b] || []).length + ' · home ' + home.length);
  if (!same) {
    console.log('   bot :', (bot[b] || []).join('\n          '));
    console.log('   home:', home.join('\n          '));
  }
}
console.log(ok
  ? '\nPARITY OK — the brief and the homepage lead every board with the same items.'
  : '\nPARITY BROKEN — the bot and the homepage disagree.');
process.exit(ok ? 0 : 1);
