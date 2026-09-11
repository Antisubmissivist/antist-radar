// Telegram delivery: rich message (collapsible topic blocks + 3-column tables).
// Format follows the osint-enhanced-brief skill, adapted to this site's boards.

type DeliveryEnv = { DB: D1Database; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string; TELEGRAM_THREAD_ID?: string };
type Lang = 'ja' | 'en' | 'zh';
type Digest = { generatedAt: string; digest: Record<Lang, string>; events: { category: string; url: string; title: Record<Lang, string>; summary: Record<Lang, string>; action: Record<Lang, string> }[]; forecasts?: { symbol: string; direction: string; probability: number; dueAt: string; claim: Record<Lang, string> }[] };

const BOARDS = ['ai', 'tech', 'japan-residence', 'japan-life', 'geopolitics', 'crypto', 'stocks'] as const;
const EMOJI: Record<string, string> = { ai: '🤖', tech: '📱', 'japan-residence': '🛂', 'japan-life': '🏠', geopolitics: '🌍', crypto: '₿', stocks: '📈' };
const LABEL: Record<Lang, Record<string, string>> = {
  zh: { ai: 'AI 圈', tech: '科技', 'japan-residence': '日本在留', 'japan-life': '日本生活', geopolitics: '地缘政治', crypto: '加密', stocks: '股票' },
  ja: { ai: 'AI', tech: 'テック', 'japan-residence': '在留・制度', 'japan-life': '日本での暮らし', geopolitics: '地政学', crypto: '暗号資産', stocks: '株式' },
  en: { ai: 'AI', tech: 'Tech', 'japan-residence': 'Residency & rules', 'japan-life': 'Japan life', geopolitics: 'Geopolitics', crypto: 'Crypto', stocks: 'Stocks' },
};
const T: Record<Lang, Record<string, string>> = {
  zh: { title: '每日简报', ai: 'AI 圈', forecast: '预测', actions: '今日最小动作', none: '（今日无更新）', nof: '（暂无已发布预测）', conf: '把握' },
  ja: { title: 'デイリーブリーフ', forecast: '予測', actions: '今日の最小アクション', none: '（本日の更新なし）', nof: '（公開済みの予測はありません）', conf: '確度' },
  en: { title: 'Daily brief', forecast: 'Forecasts', actions: 'Today\u2019s smallest actions', none: '(no updates today)', nof: '(no published forecasts yet)', conf: 'conf' },
};

const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const cut = (s: unknown, n: number) => { const t = cell(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export function buildMarkdown(s: Digest, lang: Lang): string {
  const L = LABEL[lang], t = T[lang];
  const date = new Date(Date.parse(s.generatedAt) + 9 * 3600000).toISOString().slice(0, 10);
  const out: string[] = [`**${t.title} · ${date}**`, '', cut(s.digest?.[lang], 500), ''];
  for (const b of BOARDS) {
    const items = (s.events || []).filter(e => e.category === b);
    out.push(`<details><summary>${EMOJI[b]} ${L[b]}（${items.length} 条）</summary>`, '');
    out.push('| 标题 | 内容 | 链接 |', '| --- | --- | --- |');
    if (items.length) for (const e of items) out.push(`| ${cut(e.title?.[lang], 40)} | ${cut(e.summary?.[lang] || e.action?.[lang], 90)} | [链接](${e.url}) |`);
    else out.push(`| ${t.none} | — | — |`);
    out.push('', '</details>', '');
  }
  out.push('---', '');
  out.push(`**${t.forecast}**`);
  const fs = s.forecasts || [];
  if (fs.length) for (const f of fs) { const arrow = f.direction === 'above' ? '↑' : '↓'; out.push(`- \`${f.symbol}\` ${arrow} · ${Math.round(Number(f.probability) * 100)}% · ${f.dueAt.slice(0, 10)} — ${cut(f.claim?.[lang], 120)}`); }
  else out.push(`- ${t.nof}`);
  out.push('');
  const actions: string[] = [];
  for (const e of (s.events || [])) { const a = cell(e.action?.[lang]); if (a && !actions.includes(a)) actions.push(a); }
  out.push(`**✅ ${t.actions}**`);
  if (actions.length) for (const a of actions.slice(0, 6)) out.push(`- [ ] ${a}`);
  else out.push('- （—）');
  return out.join('\n');
}

// Plain fallback if the rich-message API is unavailable.
export function buildPlain(s: Digest, lang: Lang): string {
  const L = LABEL[lang], t = T[lang];
  const date = new Date(Date.parse(s.generatedAt) + 9 * 3600000).toISOString().slice(0, 10);
  const lines = [`${t.title} · ${date}`, '', cell(s.digest?.[lang]), ''];
  for (const b of BOARDS) { const items = (s.events || []).filter(e => e.category === b); lines.push(`${EMOJI[b]} ${L[b]}（${items.length}）`); for (const e of items) lines.push(`· ${cell(e.title?.[lang])} — ${e.url}`); }
  lines.push('', `${t.forecast}`); for (const f of (s.forecasts || [])) lines.push(`· ${f.symbol} ${f.direction} ${Math.round(Number(f.probability) * 100)}% ${f.dueAt.slice(0, 10)}`);
  lines.push('', `✅ ${t.actions}`); const acts: string[] = []; for (const e of (s.events || [])) { const a = cell(e.action?.[lang]); if (a && !acts.includes(a)) acts.push(a); } acts.slice(0, 6).forEach(a => lines.push(`· ${a}`));
  return lines.join('\n');
}

async function send(env: DeliveryEnv, payload: object): Promise<boolean> {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendRichMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const d = await r.json() as { ok: boolean; result?: { message_id: number; chat: { id: number } } };
  if (!r.ok || !d.ok) throw new Error('Rich delivery not confirmed');
  if (String(d.result?.chat.id) !== String(env.TELEGRAM_CHAT_ID)) throw new Error('Delivery target mismatch');
  return true;
}

export async function sendDigest(env: DeliveryEnv, s: Digest, at = Date.now(), opts: { force?: boolean; lang?: Lang } = {}) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { status: 'unconfigured' };
  const lang = opts.lang || 'zh';
  if (!opts.force && at - Date.parse(s.generatedAt) > 90 * 60000) return { status: 'stale' };
  const date = new Date(at + 9 * 3600000).toISOString().slice(0, 10);
  const id = opts.force ? `test:${Date.now()}` : `daily:${date}`;
  const reserved = await env.DB.prepare('INSERT OR IGNORE INTO deliveries (id,state,created_at,message_ids) VALUES (?,?,?,?)').bind(id, 'sending', new Date(at).toISOString(), '[]').run();
  if (!reserved.meta.changes) return { status: 'already-attempted', id };
  const payload: Record<string, unknown> = { chat_id: env.TELEGRAM_CHAT_ID, rich_message: { markdown: buildMarkdown(s, lang) } };
  if (env.TELEGRAM_THREAD_ID) payload.message_thread_id = Number(env.TELEGRAM_THREAD_ID);
  try {
    await send(env, payload);
    await env.DB.prepare('UPDATE deliveries SET state=? WHERE id=?').bind('sent', id).run();
    return { status: 'sent', id, lang };
  } catch {
    await env.DB.prepare('UPDATE deliveries SET state=? WHERE id=?').bind('uncertain', id).run();
    return { status: 'uncertain', id };
  }
}
