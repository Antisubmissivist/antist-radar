import '../apis/utils/env.mjs';
import config from '../crucix.config.mjs';
import {createLLMProvider} from '../lib/llm/index.mjs';

// One-time backfill: rewrite the "本站评价" of already-archived events so they
// match the current single-lens, pure-assessment style. Safe to re-run.

const base = process.env.RADAR_URL || 'https://radar.antist.ai';
const token = process.env.RADAR_INGEST_TOKEN;
if (!token) throw new Error('Missing RADAR_INGEST_TOKEN');
const provider = createLLMProvider({...config.llm, provider: process.env.RADAR_LLM_PROVIDER || config.llm.provider, model: process.env.RADAR_LLM_MODEL || config.llm.model});
if (!provider?.isConfigured) throw new Error('provider unavailable');

const SYS = `你为《Antist Radar》写每条新闻的「本站评价」。固定用**现代世俗人文主义**视角：以人的尊严、权利与福祉为尺度；自由社会确实优于不自由社会，这是立场而非中立比较。
要求：2–4 句、不超过 300 字，必须具体到这条新闻（不能是放之四海的泛泛之谈）；观点鲜明，说清对普通人意味着什么、为什么重要；用大白话，具体意象多于抽象名词；生动但不口号化。
这是**评价不是建议**：禁止祈使句、建议、行动步骤、套话；不要自报用了什么视角；不要数字。
只输出 JSON：{"items":[{"id":"给定id","action":{"ja":"...","en":"...","zh":"..."}}]}。ja 用日语、en 用英语、zh 用简体中文，同一含义。`;

let all = [];
for (let page = 1; page <= 20; page++) {
  const r = await fetch(`${base}/api/events?limit=100&offset=${(page - 1) * 100}`, { headers: { 'User-Agent': 'antist-radar-backfill/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('events HTTP ' + r.status);
  const d = await r.json();
  all = all.concat(d.events || []);
  if (!d.hasMore || !(d.events || []).length) break;
}
console.error('events to review:', all.length);
const chunk = (a, n) => a.length ? [a.slice(0, n), ...chunk(a.slice(n), n)] : [];
let done = 0;
for (const batch of chunk(all, 8)) {
  const usr = JSON.stringify(batch.map(e => ({ id: e.id, category: e.category, source: e.source, title: e.title?.en || e.title?.zh, summary: e.summary?.en || e.summary?.zh, evidence: String(e.evidence || '').slice(0, 400) })));
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      const r = await provider.complete(SYS, usr, { maxTokens: 8000, timeout: 150000 });
      const f = String(r.text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      const s = f.indexOf('{'), e2 = f.lastIndexOf('}');
      const j = JSON.parse(s >= 0 && e2 > s ? f.slice(s, e2 + 1) : f);
      const updates = (j.items || []).filter(x => x && x.id && x.action && x.action.ja && x.action.en && x.action.zh);
      if (!updates.length) throw new Error('no valid items');
      const pr = await fetch(base + '/api/events/review', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ updates }) });
      const pd = await pr.json();
      if (!pr.ok || !pd.ok) throw new Error('post failed ' + pr.status);
      done += Number(pd.updated || 0); ok = true;
      console.error(`batch ok (+${pd.updated}) total ${done}`);
    } catch (e) { console.error('batch attempt', attempt, 'failed:', e.message); }
  }
}
console.log(JSON.stringify({ reviewed: all.length, updated: done }));
