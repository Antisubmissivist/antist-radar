import '../apis/utils/env.mjs';
import { buildMarkdown } from '../lib/radar-digest.mjs';

// Send a Telegram rich message. No model involved: everything is already in the
// snapshot / archive. Default mode = one daily summary of the previous JST day,
// including every event collected that day.
//   node scripts/telegram-brief.mjs                    # daily summary (yesterday JST)
//   node scripts/telegram-brief.mjs --date=2026-09-10  # a specific day
//   node scripts/telegram-brief.mjs --snapshot         # current snapshot (2/board)
//   node scripts/telegram-brief.mjs --dry              # print markdown, do not send
//   node scripts/telegram-brief.mjs --lang=ja

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const mode = args.includes('--snapshot') ? 'snapshot' : (args.includes('--daily') ? 'daily' : (process.env.BRIEF_MODE || 'daily'));
const dateArg = (args.find(a => a.startsWith('--date=')) || '').split('=')[1] || process.env.BRIEF_DATE || '';
const langArg = (args.find(a => a.startsWith('--lang=')) || '').split('=')[1];
const lang = ['ja', 'en', 'zh'].includes(langArg) ? langArg : (process.env.BRIEF_LANG || 'zh');
const base = process.env.RADAR_URL || 'https://radar.antist.ai';
const HDR = { 'User-Agent': 'antist-radar-brief/1.0' };

async function getJson(path) {
  const r = await fetch(base + path, { headers: HDR, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

let s;
if (mode === 'snapshot') {
  s = await getJson('/api/public');
} else {
  const date = dateArg || new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
  const d = await getJson('/api/daily?date=' + date);
  s = { generatedAt: date + 'T00:00:00+09:00', digest: d.digest || {}, events: d.events || [], forecasts: d.forecasts || [] };
  console.error(`daily ${date}: ${s.events.length} events, ${s.forecasts.length} forecasts`);
}
if (!s || !Array.isArray(s.events)) throw new Error('no events in payload');
if (!dry && s.events.length === 0) { console.log(JSON.stringify({ skipped: 'no events' })); process.exit(0); }

const markdown = buildMarkdown(s, lang);
if (dry) { console.log(markdown); process.exit(0); }

const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;
if (!token || !chat) throw new Error('Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
const body = { chat_id: chat, rich_message: { markdown } };
if (process.env.TELEGRAM_THREAD_ID) body.message_thread_id = Number(process.env.TELEGRAM_THREAD_ID);

const r = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
});
const d = await r.json();
console.log(JSON.stringify({ ok: d.ok, status: r.status, messageId: d.result?.message_id, error: d.description }));
if (!r.ok || !d.ok) process.exit(1);
