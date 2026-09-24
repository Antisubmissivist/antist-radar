import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBoard, rankScore } from '../lib/radar-digest.mjs';

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
