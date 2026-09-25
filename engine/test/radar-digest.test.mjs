import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBoard, rankScore, currentScore, BOARDS } from '../lib/radar-digest.mjs';
import { CATEGORIES } from '../lib/radar-contract.mjs';

// selectBoard is the single rule the homepage and the Telegram digest share, so
// these pin down the two things it must do: rank by relevance *decayed by age*,
// and give a board's slots to different stories. Two outlets reporting the same
// event is one story, not two of the three cards — the card's story rail already
// lists every source, so nothing is hidden by collapsing it.

const now = Date.parse('2026-09-24T00:00:00Z');
const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
const ev = (id, { score = 0, days = 0, thread } = {}) => ({
  id, category: 'ai', score, publishedAt: iso(days), fetchedAt: iso(days), threadId: thread,
});

test('gravity decay: a fresh mid score outranks an old high score', () => {
  assert.ok(rankScore(60, iso(0), now) > rankScore(88, iso(11), now));
  const picked = selectBoard(
    [ev('old', { score: 88, days: 11 }), ev('fresh', { score: 60, days: 0 })], 'ai', 1, now);
  assert.deepEqual(picked.map(e => e.id), ['fresh']);
});

test('same story from two outlets: one card, and the freed slot goes to a new story', () => {
  const a = ev('a', { score: 72, days: 0.1, thread: 'T1' });
  const b = ev('b', { score: 72, days: 0.2, thread: 'T1' }); // same thread, other outlet
  const c = ev('c', { score: 60, days: 0.3, thread: 'T2' });
  const d = ev('d', { score: 55, days: 0.4, thread: 'T3' });
  const picked = selectBoard([a, b, c, d], 'ai', 3, now);
  assert.equal(picked.length, 3);
  assert.equal(picked.filter(e => e.threadId === 'T1').length, 1);
  assert.equal(new Set(picked.map(e => e.threadId)).size, 3, 'one card per thread');
});

test('a board never pads itself with a duplicate story', () => {
  const a = ev('a', { score: 70, thread: 'T1' });
  const b = ev('b', { score: 65, thread: 'T1' });
  const picked = selectBoard([a, b], 'ai', 3, now);
  assert.deepEqual(picked.map(e => e.id), ['a']);
});

test('unscored rows are the fallback, newest first, still one per thread', () => {
  const scored = ev('s', { score: 70, days: 0.1, thread: 'T1' });
  const u1 = ev('u1', { score: 0, days: 0.2, thread: 'T2' });
  const u2 = ev('u2', { score: 0, days: 0.3, thread: 'T2' }); // same thread as u1
  const u3 = ev('u3', { score: 0, days: 0.4, thread: 'T3' });
  const picked = selectBoard([scored, u1, u2, u3], 'ai', 3, now);
  assert.deepEqual(picked.map(e => e.id), ['s', 'u1', 'u3']);
});

test('only the requested board is considered', () => {
  const a = ev('a', { score: 70, thread: 'T1' });
  const b = { ...ev('b', { score: 90, thread: 'T2' }), category: 'tech' };
  assert.deepEqual(selectBoard([a, b], 'ai', 3, now).map(e => e.id), ['a']);
});

// The half-life is a product decision, not an implementation detail: the owner
// asked for exactly eight days. Pin it so a "cleanup" of the formula cannot
// silently change how fast news fades.
test('the decay half-life is exactly eight days', () => {
  assert.equal(currentScore(80, iso(0), now), 80);
  assert.equal(currentScore(80, iso(8), now), 40, '8 days later it is exactly half');
  assert.equal(currentScore(80, iso(16), now), 20, 'and half again 8 days after that');
});

test('every board the digest renders is a board the contract accepts', () => {
  for (const b of BOARDS) assert.ok(CATEGORIES.includes(b), `${b} is not a contract category`);
  assert.ok(BOARDS.includes('christianity'), 'the Christianity board must be wired end to end');
});

// The reader can check the order by eye, so the badge must be the sort key. A
// board whose numbers are not descending is a bug report waiting to happen —
// that is exactly how 58-above-60 was reported.
test('the number on the card is the sort key: a board reads descending', () => {
  const picked = selectBoard([
    ev('old', { score: 88, days: 11 }),
    ev('fresh', { score: 60, days: 0 }),
    ev('mid', { score: 70, days: 2 }),
  ], 'ai', 3, now);
  const scores = picked.map(e => currentScore(e.score, e.publishedAt, now));
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] >= scores[i], `board must read descending, got ${scores.join(', ')}`);
  }
  assert.ok(scores[0] > 0);
});

// The thread guard relies on the clusterer, and the clusterer is conservative on
// purpose (a false merge is a visible lie; a miss is only a missed connection).
// So it does miss: the AI board shipped the same Claude Opus 5.5 card twice,
// under two different threads, because two tweets carried the same sentence.
// The title is the second lock — identical once punctuation is stripped means
// the same story, whatever thread it was filed under.
const titled = (id, title, opts) => ({ ...ev(id, opts), title: { zh: title } });

test('the same card title from two different threads collapses to one', () => {
  const t = 'Claude Opus 5.5 以 88.4% 登顶 SimpleBench，成 Anthropic 迄今最佳视觉模型';
  const a = titled('a', t, { score: 72, days: 0.1, thread: 'T1' });
  const b = titled('b', t, { score: 72, days: 0.2, thread: 'T2' }); // same sentence, other tweet
  const c = titled('c', '另一条毫不相干的新闻标题在此', { score: 60, days: 0.3, thread: 'T3' });
  const picked = selectBoard([a, b, c], 'ai', 3, now);
  assert.deepEqual(picked.map(e => e.id), ['a', 'c']);
});

test('the title lock does not swallow a genuinely different story', () => {
  const a = titled('a', 'OpenAI 发布新模型并开源权重', { score: 72, thread: 'T1' });
  const b = titled('b', 'Anthropic 发布安全报告引发争议', { score: 70, thread: 'T2' });
  assert.deepEqual(selectBoard([a, b], 'ai', 3, now).map(e => e.id), ['a', 'b']);
});

test('a trivially short title does not lock out another card', () => {
  const a = titled('a', 'AI', { score: 72, thread: 'T1' });
  const b = titled('b', 'AI', { score: 70, thread: 'T2' });
  assert.deepEqual(selectBoard([a, b], 'ai', 3, now).map(e => e.id), ['a', 'b']);
});
