import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustScore, sourceScoreDelta } from '../lib/source-tier.mjs';
import { distinctiveTokens, dropDownstreamXDuplicates } from '../apis/sources/radar-feeds.mjs';

// The source preference lives in the score, not in the sort: a reader who sees
// 58 above 82 is looking at a bug, not a policy. These pin the two halves — the
// score itself moves, and a downstream copy of a story that a clickable source
// already carries is dropped before it ever reaches the pool.

test('the score, not the sort, carries the source preference', () => {
  assert.ok(adjustScore(58, 'AINews') > adjustScore(82, 'ClawFeed'), 'a lower-scored clickable source must still win');
  assert.equal(sourceScoreDelta('Techmeme'), 0);
  assert.equal(adjustScore(95, 'AINews'), 100, 'clamped at 100');
  assert.equal(adjustScore(5, 'ClawFeed'), 0, 'clamped at 0');
});

test('a downstream X copy of the same story is dropped', () => {
  const items = [
    { source: 'AINews', title: 'Firecrawl raises $75M Series B and launches Alexandria' },
    { source: 'ClawFeed', title: 'Firecrawl 宣布 $75M B 轮，发布 Alexandria——面向超级智能的知识库平台' },
    { source: 'ClawFeed', title: '某公司与监管机构就数据本地化达成和解' },
    { source: 'Techmeme', title: 'Firecrawl raises $75M Series B' },
  ];
  const out = dropDownstreamXDuplicates(items);
  assert.equal(out.length, 3);
  assert.ok(out.some(x => x.source === 'ClawFeed'), 'the unrelated ClawFeed item survives');
  assert.ok(out.some(x => x.source === 'Techmeme'), 'only the named downstream source is deduped');
});

test('a generic shared word does not merge two different stories', () => {
  const items = [
    { source: 'AINews', title: 'A new model launch from a lab' },
    { source: 'ClawFeed', title: '另一家实验室发布新模型' },
  ];
  assert.equal(dropDownstreamXDuplicates(items).length, 2, 'no distinctive token, no drop');
  assert.equal(distinctiveTokens('A new model launch from a lab').size, 0);
});
