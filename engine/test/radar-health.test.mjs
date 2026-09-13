import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSources, countRecords } from '../lib/health.mjs';

// The public site prints "N / M sources returned data" and a per-source count.
// Before this guard those numbers were a hardcoded 0 next to a green "ok", so a
// dead feed and a quiet day rendered identically. These are poison tests: each
// one breaks a source on purpose and asserts the headline actually moves. A
// guard that never fires is worse than no guard.

const sweep = (sources, errors = []) => ({ sources, errors });

test('a source with records is ok and reports its real count', () => {
  const h = auditSources(sweep({ Feed: { items: [1, 2, 3] } }));
  assert.deepEqual(h.ok, ['Feed']);
  assert.equal(h.counts.Feed, 3);
  assert.equal(h.trueOkCount, 1);
});

test('nested records are counted, not just top-level arrays', () => {
  // AIInfra keeps posts under builders.posts and stories under hackernews.stories.
  assert.equal(countRecords({ hardSignals: [], builders: { posts: [1, 2] }, hackernews: { stories: [3] } }), 3);
});

test('an allowlisted source that is empty is quiet, and is NOT counted as ok', () => {
  const h = auditSources(sweep({ Japan: { quakes: [] } }));
  assert.deepEqual(h.quiet, ['Japan']);
  assert.deepEqual(h.ok, []);
  assert.equal(h.counts.Japan, 0);
  // The regression this locks down: quiet used to inflate the headline.
  assert.equal(h.trueOkCount, 0);
  assert.equal(h.total, 1);
});

test('POISON: a normally-loud source going empty is degraded, not ok', () => {
  const alive = auditSources(sweep({ GDELT: { articles: [1, 2] } }));
  assert.equal(alive.trueOkCount, 1);

  const poisoned = auditSources(sweep({ GDELT: { articles: [] } }));
  assert.equal(poisoned.trueOkCount, 0, 'headline must drop when the feed dies');
  assert.equal(poisoned.degraded.length, 1);
  assert.equal(poisoned.degraded[0].kind, 'empty');
});

test('POISON: an error field inside a 200 response is degraded', () => {
  const h = auditSources(sweep({ ACLED: { events: [1], acledError: 'Access denied' } }));
  assert.deepEqual(h.ok, []);
  assert.equal(h.degraded[0].kind, 'error-in-payload');
});

test('a thrown source is dead and still counted in the total', () => {
  const h = auditSources(sweep({ Feed: { items: [1] } }, [{ name: 'OFAC', error: 'timeout' }]));
  assert.equal(h.trueOkCount, 1);
  assert.equal(h.dead.length, 1);
  assert.equal(h.total, 2);
});

test('counts never silently claim data for a broken source', () => {
  const h = auditSources(sweep({ A: { x: [] }, B: { y: [1] }, Japan: { z: [] } }));
  assert.equal(h.counts.A, 0);
  assert.equal(h.counts.B, 1);
  assert.equal(h.counts.Japan, 0);
  assert.equal(Object.values(h.counts).filter(n => n > 0).length, h.ok.length);
});
