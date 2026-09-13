import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeEdition } from '../lib/radar-judge.mjs';

// One card with an ungrounded number used to make the whole edition
// unpublishable: the sweep burned six minutes of analysis, threw twenty good
// cards away with the bad one, and left the site on the previous snapshot.
// About one sweep in five failed this way.
//
// Items are dropped individually now. These tests pin down both halves of that
// change — the loss that is tolerated, and the damage that must still stop a
// publish. A guard that only ever says yes is not a guard.

const L = (v) => ({ ja: v.ja, en: v.en, zh: v.zh });

const goodItem = (id, n) => ({
  id,
  title: L({ ja: `お知らせ${'ア'.repeat(n % 3)}`, en: `Notice ${'A'.repeat(n % 3)}`, zh: `通知${'甲'.repeat(n % 3)}` }),
  summary: L({ ja: `制度の運用が変わるという案内がありました${n % 5}`.replace(/\d/g, ''), en: `A change to how the rule is applied was announced ${'again'.slice(0, 1 + (n % 4))}`, zh: `发布了关于规则适用方式变化的通知${'。'.repeat(1)}` }),
  audience: L({ ja: '窓口で手続きを控えている人。', en: 'People with a filing still pending at the counter.', zh: '仍有手续未在窗口办理的人。' }),
  action: L({ ja: '運用の変更は、駅の案内表示が差し替わるようなもので、行き先自体は変わらない。', en: 'A change in how a rule is applied is like a station sign being replaced: the destination itself has not moved.', zh: '适用方式的改动像车站更换指示牌，目的地本身没有变。' }),
  unknowns: L({ ja: '対象となる窓口の範囲は示されていない。', en: 'The range of counters covered is not stated.', zh: '未说明覆盖哪些窗口。' }),
});

// Fails validateEditorial: a number in the summary that no evidence supports.
const ungroundedItem = (id) => {
  const it = goodItem(id, 0);
  it.summary = L({ ja: '対象は七百人と説明された。', en: 'The scope was described as 700 people.', zh: '范围被说明为 700 人。' });
  return it;
};

const digest = L({
  ja: '制度の運用と案内の変更が中心の回。',
  en: 'A cycle dominated by changes to how rules are applied.',
  zh: '本轮以规则适用方式的调整为主。',
});

function edition(items, d = digest) {
  const lane = (l) => ({ digest: d[l], items: items.map((it) => ({ id: it.id, ...Object.fromEntries(['title', 'summary', 'audience', 'action', 'unknowns'].map((k) => [k, it[k][l]])) })) });
  return { ja: lane('ja'), en: lane('en'), zh: lane('zh'), forecasts: [] };
}

const sourceEvents = (ids) => ids.map((id) => ({
  id, source: 'e-Gov', category: 'japan-residence', url: 'https://example.org/' + id,
  publishedAt: null, fetchedAt: new Date().toISOString(), stage: 'announcement',
  deadlineAt: null, change: 'new', evidence: 'The announcement describes a change to how the rule is applied.',
  title: 'Notice', score: 70,
}));

test('one bad card is dropped, the rest of the edition still publishes', () => {
  const items = [goodItem('a', 1), ungroundedItem('b'), goodItem('c', 2)];
  const j = judgeEdition(edition(items), sourceEvents(['a', 'b', 'c']), []);

  assert.equal(j.ok, true, 'a single bad card must not sink the edition');
  assert.equal(j.result.events.length, 2);
  assert.deepEqual(j.result.events.map((e) => e.id), ['a', 'c']);
  // The loss is reported, never silent.
  assert.equal(j.dropped, 1);
  assert.equal(j.analysed, 3);
  assert.ok(j.errors.some((e) => e.includes('b')), 'the dropped id must appear in errors');
});

test('POISON: a broken digest still blocks the whole edition', () => {
  // The digest is the one piece every reader sees; a bad one cannot be dropped.
  const bad = { ja: '', en: 'Fine.', zh: '没问题。' };
  const j = judgeEdition(edition([goodItem('a', 1)], bad), sourceEvents(['a']), []);
  assert.equal(j.ok, false);
  assert.equal(j.digestOk, false);
});

test('POISON: an edition where nothing survives still blocks', () => {
  const j = judgeEdition(edition([ungroundedItem('a'), ungroundedItem('b')]), sourceEvents(['a', 'b']), []);
  assert.equal(j.ok, false, 'publishing zero cards is worse than keeping the old snapshot');
  assert.equal(j.result.events.length, 0);
});

test('an unknown or duplicated evidence id is dropped, not fatal', () => {
  const ghost = goodItem('not-in-sweep', 3);
  const j = judgeEdition(edition([goodItem('a', 1), ghost]), sourceEvents(['a']), []);
  assert.equal(j.ok, true);
  assert.deepEqual(j.result.events.map((e) => e.id), ['a']);
  assert.ok(j.errors.some((e) => e.includes('unknown evidence id')));
});

test('the keep threshold retries a thin edition but accepts a normal loss', () => {
  // Mirrors KEEP_RATIO / MIN_KEPT in radar-analysis.mjs.
  const KEEP_RATIO = 0.8, MIN_KEPT = 3;
  const need = (n) => Math.max(MIN_KEPT, Math.ceil(n * KEEP_RATIO));

  assert.ok(20 >= need(21), 'losing 1 of 21 publishes immediately');
  assert.ok(!(12 >= need(21)), 'losing 9 of 21 is retried, not published as-is');
  assert.ok(!(2 >= need(3)), 'a tiny edition must clear MIN_KEPT, not just the ratio');
});
