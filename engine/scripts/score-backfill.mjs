import '../apis/utils/env.mjs';
import config from '../crucix.config.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { selectionSystemPrompt } from '../lib/persona.mjs';

// Backfill relevance scores for every archived event that has none, using the
// SAME persona prompt as the live sweep, then write them back via the Worker.
//   node scripts/score-backfill.mjs            # score all unscored rows
//   node scripts/score-backfill.mjs --dry      # print scores, do not write
//   node scripts/score-backfill.mjs --limit=100

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const limitArg = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 200;
const base = process.env.RADAR_URL || 'https://radar.antist.ai';
const token = process.env.RADAR_INGEST_TOKEN;
if (!token) throw new Error('Missing RADAR_INGEST_TOKEN');
const HDR = { 'User-Agent': 'antist-radar-score/1.0', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const provider = createLLMProvider({ ...config.llm, provider: process.env.RADAR_LLM_PROVIDER || config.llm.provider, model: process.env.RADAR_LLM_MODEL || config.llm.model });
if (!provider?.isConfigured) throw new Error('Analysis provider unavailable');

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const parse = t => { const f = String(t || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim(); const i = f.indexOf('{'), j = f.lastIndexOf('}'); return JSON.parse(i >= 0 && j > i ? f.slice(i, j + 1) : f); };

async function scoreBatch(items) {
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
    } catch (e) { console.error('[score] batch attempt', t, 'failed:', e.message); }
  }
  return [];
}

let total = 0, round = 0;
for (;;) {
  const r = await fetch(`${base}/api/events/unscored?limit=${limitArg}`, { headers: HDR, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`unscored fetch failed (${r.status})`);
  const items = j.events || [];
  if (!items.length) break;
  round++;
  console.log(JSON.stringify({ event: 'round', round, remaining: j.total, batch: items.length }));
  const updates = [];
  for (const part of chunk(items, 25)) {
    const scored = await scoreBatch(part);
    const by = new Map(scored.map(x => [String(x && x.id), Number(x && x.score)]));
    for (const it of part) { const s = by.get(it.id); if (Number.isFinite(s)) updates.push({ id: it.id, score: Math.max(0, Math.min(100, Math.round(s))) }); }
  }
  if (!updates.length) { console.error('[score] no scores parsed this round; aborting to avoid a loop'); break; }
  if (dry) { console.log(JSON.stringify({ dry: true, wouldScore: updates.length, sample: updates.slice(0, 5) })); break; }
  const w = await fetch(`${base}/api/events/score`, { method: 'POST', headers: HDR, body: JSON.stringify({ updates }), signal: AbortSignal.timeout(30000) });
  const wj = await w.json().catch(() => ({}));
  total += Number(wj.updated || 0);
  console.log(JSON.stringify({ event: 'written', round, updated: wj.updated }));
  if (items.length < limitArg) break;
}
console.log(JSON.stringify({ done: true, scored: total, rounds: round }));
