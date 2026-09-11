// Daily Chinese digest — same substance as the osint-enhanced-brief skill
// (判断性总结 → 打分排序的板块 → 每条带摘要 → 可执行最小动作), rendered for
// the raw Telegram Bot API.
//
// Rendering constraints, verified against the API rather than assumed:
//   sendMessage with <details> is REJECTED outright —
//     400 Bad Request: can't parse entities: Unsupported start tag "details"
//   The <table>/<details> markup that renders in OpenClaw channels comes from
//   telegram_rich_send's own renderer, not from Telegram.
//   Bot API HTML allows: b i u s a code pre blockquote span(tg-spoiler).
//   Collapsing is <blockquote expandable>. Hard cap 4096 chars per message.
//
// Division of labour, on purpose:
//   • The LLM scores and summarises NEWS items only.
//   • Every number — prices, ranges, shindo, distances — is rendered
//     deterministically from the sweep. A summariser that drops a minus sign
//     turns "out of range" into "0.27% of headroom", so numbers never go
//     through it.
//
// Usage:
//   node scripts/daily-digest.mjs            # dry run
//   node scripts/daily-digest.mjs --send     # post to Telegram
//   node scripts/daily-digest.mjs --sweep    # fresh sweep first

import fs from 'node:fs';
import path from 'node:path';
import '../apis/utils/env.mjs';
import config from '../crucix.config.mjs';
import { fullBriefing } from '../apis/briefing.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { auditSources } from '../lib/health.mjs';

const ARGS = new Set(process.argv.slice(2));
const SEND = ARGS.has('--send');
const FRESH = ARGS.has('--sweep');
const TG_LIMIT = 4096;

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jst = d => new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16);
const fmt = n => (n == null ? '—' : Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : Number(n).toFixed(2));
const pct = n => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`);
// 箭头已经表达方向，跟在箭头后面的数值再带符号就会出现自相矛盾的 ▼+3.23%
const mag = n => (n == null ? '—' : `${Math.abs(Number(n)).toFixed(2)}%`);
const arrow = n => (n > 0 ? '▲' : n < 0 ? '▼' : '–');

// ---------------------------------------------------------------- candidates
// Everything the LLM is allowed to rank and summarise. Facts live elsewhere.

function collectCandidates(s) {
  const out = [];
  const push = (section, title, url, context) => {
    if (!title) return;
    out.push({ id: out.length + 1, section, title: String(title).slice(0, 200), url: url || null, context: context ? String(context).slice(0, 300) : '' });
  };

  const a = s.AIInfra || {};
  for (const h of a.hardSignals || []) push('ai', h.title, h.url, `来源 ${h.from}｜属于发布/定价/弃用类硬信号`);
  for (const st of a.hackernews?.stories || []) push('ai', st.title, st.url, `Hacker News ${st.points} 分`);
  for (const p of a.builders?.posts || []) push('ai', `${p.name}: ${String(p.text).replace(/\s+/g, ' ').slice(0, 140)}`, p.url, `X 建造者推文，${p.likes} 赞 ${p.retweets} 转`);
  for (const b of a.builders?.blogs || []) push('ai', b.title, b.url, `官方博客 ${b.site || ''}`);

  const g = s.GDELT || {};
  for (const art of g.allArticles || []) push('geo', art.title, art.url, `GDELT 新闻聚合${art.domain ? `｜${art.domain}` : ''}`);
  for (const o of s.WHO?.diseaseOutbreakNews || []) push('geo', o.title, o.url || o.link, 'WHO 突发卫生事件通报');
  const ac = s.ACLED || {};
  if (ac.summary?.totalEvents) push('geo', `ACLED 记录武装冲突事件 ${ac.summary.totalEvents} 起`, null, '结构化冲突事件数据');

  const kev = s['CISA-KEV'] || {};
  for (const sig of kev.signals || []) push('sec', sig.signal, null, `CISA KEV 汇总信号，严重度 ${sig.severity}`);
  for (const v of (kev.vulnerabilities || []).slice(0, 8)) {
    push('sec', `${v.cveID} ${v.vendorProject} ${v.product}`, `https://nvd.nist.gov/vuln/detail/${v.cveID}`, `${v.vulnerabilityName}｜已确认在野利用`);
  }
  return out;
}

// ------------------------------------------------------------------ LLM pass

const SYS = `你是 Antist 的私人情报分析师。全程简体中文。

任务：给候选条目打分、排序、写摘要，并给出全局判断。

打分优先级（高→低）：
1 AI 行业动向、模型发布、定价变化、大厂布局、芯片
2 投资、市场、并购、财报、宏观数据
3 地缘政治、制裁、冲突升级
4 已确认在野利用的安全漏洞（尤其影响开发者常用组件的）
5 其他科技产品/平台变化

严格只输出 JSON，不要任何解释文字：
{
  "summary": "...",
  "items": [{"id": 1, "score": 9, "digest": "..."}],
  "actions": ["..."]
}

- summary：1-2 句、不超过 150 字的判断性评价——今天最重要的变化是什么、意味着什么。禁止罗列标题。
- items：只保留值得看的，每个板块最多 4 条，总共不超过 12 条。score 是 1-10。
  digest 是一句话摘要，20-45 字，说清"这是什么 + 为什么值得你知道"，禁止复述标题原文。
- actions：1-3 条今天可执行的最小动作，每条不超过 40 字，必须由事实推出。
  确实无事可做就返回 ["今天无需动作，保持观察"]。`;

async function analyse(candidates, facts) {
  if (!candidates.length) return { summary: null, byId: new Map(), actions: [] };
  const provider = createLLMProvider(config.llm);

  const list = candidates.map(c => `[${c.id}] (${c.section}) ${c.title}${c.context ? `\n     ${c.context}` : ''}`).join('\n');
  const user = `今天的确定性事实（已核实，供你写 summary 和 actions 时参考，不要放进 items）：\n${facts}\n\n候选新闻条目：\n${list}`;

  try {
    const r = await provider.complete(SYS, user, { maxTokens: 6000, timeout: 120000 });
    const clean = r.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    const byId = new Map((parsed.items || []).map(i => [Number(i.id), i]));
    return { summary: parsed.summary, byId, actions: parsed.actions || [], model: r.model, usage: r.usage };
  } catch (e) {
    // The digest must survive a bad LLM day; it just gets less useful.
    return { summary: null, byId: new Map(), actions: [], error: e.message };
  }
}

// ------------------------------------------------------------------- render

function newsSection(title, section, candidates, byId, max = 4) {
  const rows = candidates
    .filter(c => c.section === section && byId.has(c.id))
    .map(c => ({ ...c, ...byId.get(c.id) }))
    .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
    .slice(0, max);
  if (!rows.length) return null;

  const body = rows.map((r, i) => {
    const head = r.url ? `<a href="${esc(r.url)}">${esc(r.title)}</a>` : `<b>${esc(r.title)}</b>`;
    return `<b>${i + 1}.</b> ${head}\n     ${esc(r.digest || '')}`;
  }).join('\n\n');

  return `<b>${title}（${rows.length}条）</b>\n<blockquote expandable>${body}</blockquote>`;
}

function marketsBlock(s) {
  const lines = [];
  for (const r of Object.values(s.FX?.rates || {})) {
    if (r.error) continue;
    const band = r.bandState === 'inside' ? ` <i>(距下轨 ${r.distToLowPct}% / 上轨 ${r.distToHighPct}%)</i>`
      : r.bandState ? ` <b>[${r.bandState === 'above' ? '破上轨' : '破下轨'}]</b>` : '';
    lines.push(`${esc(r.label)}  <b>${fmt(r.price)}</b> ${arrow(r.changePct)}${mag(r.changePct)}${band}`);
  }
  const y = s.YFinance || {};
  for (const q of [...(y.indexes || []), ...(y.volatility || []), ...(y.commodities || []).slice(0, 3), ...(y.crypto || [])]) {
    if (!q || q.error) continue;
    lines.push(`${esc(q.name)}  <b>${fmt(q.price)}</b> ${arrow(q.changePct)}${mag(q.changePct)}`);
  }
  return lines.length ? `<b>💱 市场与汇率（${lines.length}项）</b>\n<blockquote expandable>${lines.join('\n')}</blockquote>` : null;
}

function japanBlock(s) {
  const j = s.Japan; if (!j) return null;
  const q = j.quakes || {};
  const lines = [];
  if (q.total != null) {
    lines.push(`48h 地震 <b>${q.total}</b> 次 · 最大震度 <b>${q.maxShindo ?? '—'}</b>（推送门槛 震度${q.alertThresholdShindo}）`);
    for (const e of (q.events || []).filter(e => e.alert).slice(0, 3)) lines.push(`⚠️ ${esc(e.region)} M${e.magnitude} 震度${e.maxShindo} — ${jst(e.at)}`);
    const l = q.events?.[0];
    if (l && !l.alert) lines.push(`最近：${esc(l.region)} M${l.magnitude} 震度${l.maxShindo}（${jst(l.at)}）`);
  }
  for (const t of j.typhoons?.storms || []) lines.push(`🌀 ${esc(t.id)}（${esc(t.category)}）— ${jst(t.issuedAt)}`);
  for (const w of j.warnings || []) {
    if (w.error) { lines.push(`気象警報取得失敗：${esc(w.error)}`); continue; }
    lines.push(w.warningCount > 0
      ? `⚠️ 発表中の警報：${esc(w.warnings.map(x => x.label).join('、'))}`
      : `無警報（注意報 ${w.advisoryCount} 件のみ）`);
  }
  return lines.length ? `<b>🇯🇵 日本生活</b>\n<blockquote expandable>${lines.join('\n')}</blockquote>` : null;
}

function positionsBlock(s) {
  const p = s.Positions; if (!p) return null;
  if (!p.configured) return `<b>⛓️ 链上仓位</b>\n<blockquote expandable>⚙️ ${esc(p.note)}</blockquote>`;
  const lines = p.positions.map(r => {
    if (r.status === 'error' || r.status === 'config-error') return `❌ <b>${esc(r.label)}</b> ${esc(r.error || r.configError)}`;
    const icon = { 'out-of-range': '🔴', flash: '🟠', warn: '🟡', ok: '🟢' }[r.status] || '⚪';
    // State in words, first. A bare "-0.27%" reads as headroom to a summariser
    // that drops the sign — the exact opposite of out-of-range.
    const verdict = r.inRange === false
      ? `<b>已脱离区间，停止收费</b>（高出上轨 ${Math.abs(r.distToUpperPct ?? 0)}%${r.feeApr24h ? `，正在错过 ${esc(r.feeApr24h)} APR` : ''}）`
      : `在区间内，距${r.nearestEdge === 'lower' ? '下' : '上'}轨 <b>${r.nearestPct}%</b>`;
    return `${icon} <b>${esc(r.label)}</b> ${fmt(r.price)}（${fmt(r.range?.lower)}–${fmt(r.range?.upper)}）\n     ${verdict}`;
  });
  return `<b>⛓️ 链上仓位（${lines.length}）</b>\n<blockquote expandable>${lines.join('\n')}</blockquote>`;
}

// Anything critical is hoisted above the fold, unfolded. If you have to expand
// a blockquote to find out a position stopped earning, the alert has failed.
function urgentBlock(s) {
  const urgent = [];
  for (const al of s.Positions?.alerts || []) if (al.severity === 'critical' || al.severity === 'high') urgent.push(`🔴 ${esc(al.message)}`);
  for (const al of s.FX?.alerts || []) if (al.severity === 'high') urgent.push(`💱 ${esc(al.message)}`);
  for (const f of s.Japan?.flags || []) urgent.push(`🇯🇵 ${esc(f)}`);
  return urgent.length ? `<b>⚠️ 需要现在看的</b>\n${urgent.map(u => `• ${u}`).join('\n')}` : null;
}

// Telegram caps a message at 4096 chars. Pack whole blocks, never split one —
// a blockquote cut in half is a 400 from the API, not a shorter message.
function pack(blocks, header, footer) {
  const messages = [];
  let cur = header;
  for (const b of blocks) {
    if (!b) continue;
    const candidate = cur ? `${cur}\n\n${b}` : b;
    if (candidate.length + footer.length > TG_LIMIT) {
      if (cur) messages.push(cur);
      cur = b;
    } else {
      cur = candidate;
    }
  }
  if (cur) messages.push(cur);
  if (messages.length) {
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = last.length + footer.length <= TG_LIMIT ? last + footer : (messages.push(footer.trim()), last);
  }
  return messages.filter(Boolean);
}

async function send(html) {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 未配置');
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
  });
  const j = await res.json();
  // Telegram answers 200 with ok:false on markup errors — the status code lies.
  if (!j.ok) throw new Error(`Telegram ${j.error_code}: ${j.description}`);
  return j.result.message_id;
}

// --------------------------------------------------------------------- main

const latestPath = path.resolve('runs/latest.json');
const sweep = FRESH || !fs.existsSync(latestPath)
  ? await fullBriefing()
  : JSON.parse(fs.readFileSync(latestPath, 'utf8'));
const s = sweep.sources;

const candidates = collectCandidates(s);

// Facts handed to the LLM as context for summary/actions — never re-rendered
// from its output.
const factLines = [];
for (const r of Object.values(s.FX?.rates || {})) if (!r.error) factLines.push(`${r.label} ${r.price} (${pct(r.changePct)})`);
for (const q of [...(s.YFinance?.indexes || []), ...(s.YFinance?.volatility || []), ...(s.YFinance?.commodities || [])]) if (q && !q.error) factLines.push(`${q.name} ${q.price} (${pct(q.changePct)})`);
for (const p of s.Positions?.positions || []) {
  if (p.inRange === false) factLines.push(`⚠️ LP ${p.label} 已脱离区间（现价 ${p.price}，区间 ${p.range?.lower}–${p.range?.upper}），停止收费，错过 ${p.feeApr24h} APR`);
  else if (p.nearestPct != null) factLines.push(`LP ${p.label} 在区间内，距${p.nearestEdge === 'lower' ? '下' : '上'}轨 ${p.nearestPct}%`);
}
if (s.Japan?.quakes) factLines.push(`日本 48h 地震 ${s.Japan.quakes.total} 次，最大震度 ${s.Japan.quakes.maxShindo}`);

const judged = await analyse(candidates, factLines.join('\n'));

const header = `<b>📰 每日情报简报 · ${jst(sweep.crucix.timestamp)} JST</b>\n\n`
  + (judged.summary
    ? `<b>今日热点新闻总结：</b>${esc(judged.summary)}`
    : `<i>（LLM 总结不可用${judged.error ? '：' + esc(judged.error.slice(0, 60)) : ''}，以下为原始信号）</i>`);

const blocks = [
  urgentBlock(s),
  newsSection('🤖 AI 与模型', 'ai', candidates, judged.byId),
  newsSection('🌍 地缘政治', 'geo', candidates, judged.byId),
  newsSection('🛡️ 在野利用漏洞', 'sec', candidates, judged.byId),
  marketsBlock(s),
  japanBlock(s),
  positionsBlock(s),
  judged.actions.length ? `<b>✅ 今日可执行最小动作</b>\n<blockquote expandable>${judged.actions.map(a => '• ' + esc(a)).join('\n')}</blockquote>` : null,
];

const h = auditSources(sweep);
const footer = `\n\n<i>源 ${h.trueOkCount}/${h.total} 真正有数据`
  + (h.degraded.length ? ` · 降级 ${esc(h.degraded.map(d => d.name).join(','))}` : '')
  + (h.dead.length ? ` · 失败 ${esc(h.dead.map(d => d.name).join(','))}` : '')
  + (judged.model ? ` · ${esc(judged.model)}` : '') + '</i>';

const messages = pack(blocks, header, footer);

for (const [i, m] of messages.entries()) {
  console.log('─'.repeat(58) + ` 消息 ${i + 1}/${messages.length} (${m.length}/${TG_LIMIT})`);
  console.log(m);
}
console.log('─'.repeat(70));
console.log(`候选 ${candidates.length} 条 → 入选 ${judged.byId.size} 条 · 分 ${messages.length} 条消息`);
if (judged.usage) console.log(`LLM ${judged.model} in=${judged.usage.inputTokens} out=${judged.usage.outputTokens}`);
if (judged.error) console.log(`⚠️ LLM 失败：${judged.error}`);

if (SEND) {
  for (const m of messages) console.log(`✅ 已发送 message_id=${await send(m)}`);
} else {
  console.log('（dry-run：未发送。加 --send 才实际推送）');
}
