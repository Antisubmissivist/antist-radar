// Shared Telegram digest builder. Pure functions, no deps, usable from the
// Worker and from standalone scripts (GitHub Actions). Content comes entirely
// from the published snapshot — no model call.

export const BOARDS = ['ai', 'tech', 'japan-residence', 'japan-life', 'geopolitics', 'crypto', 'stocks'];

const EMOJI = { ai: '🤖', tech: '📱', 'japan-residence': '🛂', 'japan-life': '🏠', geopolitics: '🌍', crypto: '₿', stocks: '📈' };
const LABEL = {
  zh: { ai: 'AI 圈', tech: '科技', 'japan-residence': '日本在留', 'japan-life': '日本生活', geopolitics: '地缘政治', crypto: '加密', stocks: '股票' },
  ja: { ai: 'AI', tech: 'テック', 'japan-residence': '在留・制度', 'japan-life': '日本での暮らし', geopolitics: '地政学', crypto: '暗号資産', stocks: '株式' },
  en: { ai: 'AI', tech: 'Tech', 'japan-residence': 'Residency & rules', 'japan-life': 'Japan life', geopolitics: 'Geopolitics', crypto: 'Crypto', stocks: 'Stocks' },
};
const T = {
  zh: { title: '每日简报', forecast: '预测', none: '（今日无更新）', nof: '（暂无已发布预测）' },
  ja: { title: 'デイリーブリーフ', forecast: '予測', none: '（本日の更新なし）', nof: '（公開済みの予測はありません）' },
  en: { title: 'Daily brief', forecast: 'Forecasts', none: '(no updates today)', nof: '(no published forecasts yet)' },
};

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = cell(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const jst = iso => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const pick = (lang) => (LABEL[lang] || LABEL.zh);

export function buildMarkdown(s, lang = 'zh', boards) {
  const L = pick(lang), t = T[lang] || T.zh;
  const list = (Array.isArray(boards) && boards.length) ? BOARDS.filter(b => boards.includes(b)) : BOARDS;
  const out = [`**${t.title} · ${jst(s.generatedAt)}**`, '', cut(s.digest?.[lang], 500), ''];
  const PER = 3;
  for (const b of list) {
    const items = (s.events || []).filter(e => e.category === b).sort((x, y) => (y.score || 0) - (x.score || 0)).slice(0, PER);
    out.push(`<details><summary>${EMOJI[b]} ${L[b]}（${items.length}）</summary>`, '');
    out.push('| 标题 | 内容 | 链接 |', '| --- | --- | --- |');
    if (items.length) for (const e of items) { const dl = e.deadlineAt ? ('⏰ ' + String(e.deadlineAt).slice(0, 10) + ' · ') : ''; out.push(`| ${cut(e.title?.[lang], 40)} | ${cut(dl + (e.summary?.[lang] || e.action?.[lang]), 110)} | [链接](${e.url}) |`); }
    else out.push(`| ${t.none} | — | — |`);
    out.push('', '</details>', '');
  }
  const fs = s.forecasts || [];
  out.push(`<details><summary>🔮 ${t.forecast}（${fs.length}）</summary>`, '');
  if (fs.length) for (const f of fs) out.push(`- \`${f.symbol}\` ${f.direction === 'above' ? '↑' : '↓'} · ${Math.round(Number(f.probability) * 100)}% · ${f.dueAt.slice(0, 10)} — ${cut(f.claim?.[lang], 120)}`);
  else out.push(`- ${t.nof}`);
  out.push('', '</details>');
  return out.join('\n');
}

export function buildPlain(s, lang = 'zh', boards) {
  const L = pick(lang), t = T[lang] || T.zh;
  const list = (Array.isArray(boards) && boards.length) ? BOARDS.filter(b => boards.includes(b)) : BOARDS;
  const lines = [`${t.title} · ${jst(s.generatedAt)}`, '', cell(s.digest?.[lang]), ''];
  for (const b of list) { const items = (s.events || []).filter(e => e.category === b).sort((x, y) => (y.score || 0) - (x.score || 0)).slice(0, 3); lines.push(`${EMOJI[b]} ${L[b]}（${items.length}）`); for (const e of items) lines.push(`· ${cell(e.title?.[lang])} — ${e.url}`); }
  lines.push('', `${t.forecast}`); for (const f of (s.forecasts || [])) lines.push(`· ${f.symbol} ${f.direction} ${Math.round(Number(f.probability) * 100)}% ${f.dueAt.slice(0, 10)}`);
  return lines.join('\n');
}
