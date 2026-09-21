import '../apis/utils/env.mjs';
import config from '../crucix.config.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { selectionSystemPrompt } from '../lib/persona.mjs';
import { CATEGORIES } from '../lib/radar-contract.mjs';

// Re-file archived events under the board the model reads off the item, using
// the SAME prompt the live sweep uses. Rows written before the sweep started
// classifying still carry the old source-level board — Techmeme filed as tech
// even when the story is about a model, BBC World filed as geopolitics even
// when the story is about Gemini — and the homepage shows a week of them.
//
//   node scripts/category-backfill.mjs --dry     # print the moves, write nothing
//   node scripts/category-backfill.mjs           # apply them
//   node scripts/category-backfill.mjs --limit=100

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const pageSize = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 200;
const base = process.env.RADAR_URL || 'https://radar.antist.ai';
const token = process.env.RADAR_INGEST_TOKEN;
if (!token) throw new Error('Missing RADAR_INGEST_TOKEN');
const HDR = { 'User-Agent': 'antist-radar-category/1.0', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const provider = createLLMProvider({ ...config.llm, provider: process.env.RADAR_LLM_PROVIDER || config.llm.provider, model: process.env.RADAR_LLM_MODEL || config.llm.model });
if (!provider?.isConfigured) throw new Error('Analysis provider unavailable');

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const parse = t => { const f = String(t || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim(); const i = f.indexOf('{'), j = f.lastIndexOf('}'); return JSON.parse(i >= 0 && j > i ? f.slice(i, j + 1) : f); };

async function classifyBatch(items) {
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await provider.complete(selectionSystemPrompt(), JSON.stringify(items.map(e => ({
        id: e.id, category: e.category, source: e.source,
        title: (e.title && (e.title.zh || e.title.en)) || '',
        evidence: String(e.evidence || '').slice(0, 180),
      }))), { maxTokens: 6000, timeout: 180000 });
      const j = parse(r.text);
      if (j && Array.isArray(j.items)) return j.items;
      throw new Error('bad shape');
    } catch (e) { console.error('[category] batch attempt', t, 'failed:', e.message); }
  }
  return [];
}

let moved = 0, seen = 0, offset = 0, total = 0;
for (;;) {
  const r = await fetch(`${base}/api/events/rows?limit=${pageSize}&offset=${offset}`, { headers: HDR, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`rows fetch failed (${r.status})`);
  const items = j.events || [];
  total = Number(j.total || 0);
  if (!items.length) break;
  seen += items.length;

  const updates = [];
  for (const part of chunk(items, 25)) {
    const rows = await classifyBatch(part);
    const by = new Map(rows.map(x => [String(x && x.id), String((x && x.category) || '')]));
    for (const it of part) {
      const proposed = by.get(it.id);
      // Same rule as the sweep: only one of the seven published boards wins.
      if (proposed && proposed !== it.category && CATEGORIES.includes(proposed)) {
        updates.push({ id: it.id, category: proposed, from: it.category, source: it.source, title: (it.title?.zh || it.title?.en || '').slice(0, 40) });
      }
    }
  }
  console.log(JSON.stringify({ event: 'page', offset, scanned: items.length, moves: updates.length, total }));
  for (const u of updates.slice(0, 8)) console.log(`   ${u.source}: ${u.from}→${u.category} | ${u.title}`);

  if (updates.length && !dry) {
    const w = await fetch(`${base}/api/events/category`, { method: 'POST', headers: HDR, body: JSON.stringify({ updates: updates.map(u => ({ id: u.id, category: u.category })) }), signal: AbortSignal.timeout(30000) });
    const wj = await w.json().catch(() => ({}));
    if (!w.ok || !wj.ok) throw new Error(`write failed (${w.status})`);
    moved += Number(wj.updated || 0);
    console.log(JSON.stringify({ event: 'written', offset, updated: wj.updated }));
  } else if (dry) { moved += updates.length; }

  offset += items.length;
  if (offset >= total) break;
}
console.log(JSON.stringify({ done: true, dry, scanned: seen, moved }));
