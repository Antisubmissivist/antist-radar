import '../apis/utils/env.mjs';
import { readFile } from 'node:fs/promises';
import { buildMarkdown } from '../lib/radar-digest.mjs';

// Send the published snapshot as a Telegram rich message. No model involved:
// everything is already in the snapshot. Runs locally or from GitHub Actions.
//   node scripts/telegram-brief.mjs --dry            # print markdown only
//   node scripts/telegram-brief.mjs --lang=zh        # send in a language
//   node scripts/telegram-brief.mjs                  # send (default zh)

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const langArg = (args.find(a => a.startsWith('--lang=')) || '').split('=')[1];
const lang = ['ja', 'en', 'zh'].includes(langArg) ? langArg : (process.env.BRIEF_LANG || 'zh');
const base = process.env.RADAR_URL || 'https://radar.antist.ai';

let s;
if (process.env.BRIEF_SOURCE) {
  s = JSON.parse(await readFile(process.env.BRIEF_SOURCE, 'utf8'));
} else {
  const r = await fetch(base + '/api/public', { headers: { 'User-Agent': 'antist-radar-brief/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`snapshot HTTP ${r.status}`);
  s = await r.json();
}
if (!s || !Array.isArray(s.events)) throw new Error('snapshot missing events');

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
