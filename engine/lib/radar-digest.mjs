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
  zh: { title: '每日简报', forecast: '预测', none: '（今日无更新）', nof: '（暂无已发布预测）', more: '想看更多内容，请访问本站' },
  ja: { title: 'デイリーブリーフ', forecast: '予測', none: '（本日の更新なし）', nof: '（公開済みの予測はありません）', more: 'もっと見るなら本サイトへ' },
  en: { title: 'Daily brief', forecast: 'Forecasts', none: '(no updates today)', nof: '(no published forecasts yet)', more: 'More updates on the site' },
};

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = cell(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const jst = iso => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const pick = (lang) => (LABEL[lang] || LABEL.zh);

// Single source of truth for "which 3 items represent this board", shared by the
// site homepage and the Telegram digest so the two can never disagree.
//
// Gravity time-decay: a board is led by the most relevant thing that is still
// current. Rank = score / ((ageHours/48)+1)^1.2, so a card's pull roughly halves
// every two days — yesterday's 80 outranks last week's 88. The number printed on
// the card stays the raw relevance (the 0-100 rubric in the tooltip); only the
// ordering decays.
//
// The >=60 gate that used to sit here is deliberately gone. When the pool scored
// in the 50s the gate was always empty and the board silently fell back to
// newest-first — which is exactly what "top of the board" must never mean.
// Unscored rows only fill leftover slots, newest first.
export function rankScore(score, dateStr, now = Date.now()) {
  const s = Number(score) || 0;
  if (s <= 0) return -1;
  const ts = Date.parse(dateStr || '') || now;
  const ageHours = Math.max(0, (now - ts) / 3600000);
  return s / Math.pow(ageHours / 48 + 1, 1.2);
}
export function selectBoard(events, board, n = 3, now = Date.now()) {
  const cand = (events || []).filter(e => e && e.category === board);
  const byRecency = (a, b) => Date.parse(b.publishedAt || b.fetchedAt || 0) - Date.parse(a.publishedAt || a.fetchedAt || 0);
  const ranked = cand.filter(e => Number(e.score) > 0)
    .map(e => ({ e, r: rankScore(e.score, e.publishedAt || e.fetchedAt, now) }))
    .filter(x => x.r > 0).sort((a, b) => (b.r - a.r) || byRecency(a.e, b.e)).slice(0, n).map(x => x.e);
  const have = new Set(ranked.map(e => e.id));
  const rest = ranked.length < n ? cand.filter(e => !have.has(e.id)).sort(byRecency).slice(0, n - ranked.length) : [];
  return [...ranked, ...rest];
}

export function buildMarkdown(s, lang = 'zh', boards) {
  const L = pick(lang), t = T[lang] || T.zh;
  const list = (Array.isArray(boards) && boards.length) ? BOARDS.filter(b => boards.includes(b)) : BOARDS;
  const out = [`**${t.title} · ${jst(s.generatedAt)}**`, '', cut(s.digest?.[lang], 500), ''];
  const PER = 3;
  for (const b of list) {
    const items = selectBoard(s.events, b, PER);
    out.push(`<details><summary>${EMOJI[b]} ${L[b]}（${items.length}）</summary>`, '');
    out.push('| 标题 | 内容 | 链接 |', '| --- | --- | --- |');
    if (items.length) for (const e of items) { const dl = e.deadlineAt ? ('⏰ ' + String(e.deadlineAt).slice(0, 10) + ' · ') : ''; out.push(`| ${cut(e.title?.[lang], 60)} | ${cut(dl + (e.summary?.[lang] || e.action?.[lang]), 110)} | [链接](${e.url}) |`); }
    else out.push(`| ${t.none} | — | — |`);
    out.push('', '</details>', '');
  }
  const fs = (s.forecasts || []).slice(0, 10);
  out.push(`<details><summary>🔮 ${t.forecast}（${fs.length}）</summary>`, '');
  if (fs.length) for (const f of fs) out.push(`- \`${f.symbol}\` ${f.direction === 'above' ? '↑' : '↓'} · ${Math.round(Number(f.probability) * 100)}% · ${f.dueAt.slice(0, 10)} — ${cut(f.claim?.[lang], 120)}`);
  else out.push(`- ${t.nof}`);
  out.push('', '</details>');
  out.push('', `📡 ${t.more} → [radar.antist.ai](https://radar.antist.ai/${lang})`);
  return out.join('\n');
}

export function buildPlain(s, lang = 'zh', boards) {
  const L = pick(lang), t = T[lang] || T.zh;
  const list = (Array.isArray(boards) && boards.length) ? BOARDS.filter(b => boards.includes(b)) : BOARDS;
  const lines = [`${t.title} · ${jst(s.generatedAt)}`, '', cell(s.digest?.[lang]), ''];
  for (const b of list) { const items = selectBoard(s.events, b, 3); lines.push(`${EMOJI[b]} ${L[b]}（${items.length}）`); for (const e of items) lines.push(`· ${cell(e.title?.[lang])} — ${e.url}`); }
  lines.push('', `${t.forecast}`); for (const f of (s.forecasts || []).slice(0, 10)) lines.push(`· ${f.symbol} ${f.direction} ${Math.round(Number(f.probability) * 100)}% ${f.dueAt.slice(0, 10)}`);
  lines.push('', `📡 ${t.more} → https://radar.antist.ai/${lang}`);
  return lines.join('\n');
}
