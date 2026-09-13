import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEditorial } from '../lib/radar-editorial.mjs';
import { sourceTier, TIER_RANK } from '../lib/source-tier.mjs';
import { PERSONA_LEAK, GENERIC_UNKNOWN } from '../lib/radar-analysis.mjs';

// "Who it affects", "What remains unknown" and the editor's take are allowed to
// be empty, because a sentence repeated on every card teaches readers to skip
// the field. Making them optional is the risky half: `validateEditorial` used
// to throw on any blank, and the judge aborts publication after three rejected
// attempts. These tests pin down exactly how much blankness is allowed.

const three = (v) => ({ ja: v, en: v, zh: v });

test('an optional field may be blank in every language at once', () => {
  assert.doesNotThrow(() => validateEditorial(three(''), { optional: true }));
  assert.doesNotThrow(() => validateEditorial({ ja: '  ', en: '', zh: '\t' }, { optional: true }));
});

test('POISON: blank in some languages only is rejected', () => {
  // The three editions would otherwise disagree about what is known — an English
  // reader sees no caveat where a Japanese reader sees one.
  const partial = { ja: '四月に更新される留学生。', en: '', zh: '四月续期的留学生。' };
  assert.throws(() => validateEditorial(partial, { optional: true }), /blank in some languages only/);
});

test('optional does not weaken the checks on a field that IS present', () => {
  const contaminated = { ja: '事業所を开设する人。', en: 'People opening an office.', zh: '开设事业所的人。' };
  assert.throws(() => validateEditorial(contaminated, { optional: true }));

  const ungrounded = { ja: '999人が対象。', en: '999 people are covered.', zh: '999 人受影响。' };
  assert.throws(() => validateEditorial(ungrounded, { optional: true, evidence: 'No numbers here.' }));
});

test('a required field is still rejected when blank', () => {
  assert.throws(() => validateEditorial(three('')));
  assert.throws(() => validateEditorial({ ja: 'ある。', en: '', zh: '有。' }));
});

test('source tiers put X above the press, and unknown feeds claim the least', () => {
  assert.equal(sourceTier('ClawFeed'), 'x');
  assert.equal(sourceTier('AINews'), 'x');
  assert.equal(sourceTier('Japan'), 'primary');
  assert.equal(sourceTier('Bank of Japan'), 'primary');
  assert.equal(sourceTier('TechCrunch'), 'media');
  assert.equal(sourceTier('Google News · UR/住宅'), 'media');
  assert.equal(sourceTier('Some feed added next week'), 'data');

  // X outranks every outlet reporting on X.
  assert.ok(TIER_RANK[sourceTier('ClawFeed')] < TIER_RANK[sourceTier('TechCrunch')]);
  assert.ok(TIER_RANK[sourceTier('Bank of Japan')] < TIER_RANK[sourceTier('BBC World')]);
});

test('the tier bonus lifts an origin post over a rewrite, but never over a major rule change', () => {
  // Mirrors the weights in radar-analysis.mjs. If those change, this must too.
  const BONUS = { x: 15, primary: 8, media: 0, data: 0 };
  const rank = (score, tier) => Math.min(100, score + BONUS[tier]);

  // A 70-point original post beats the 78-point article written about it.
  assert.ok(rank(70, 'x') > rank(78, 'media'));
  // A 40-point tweet must NOT bury a 90-point residency rule change.
  assert.ok(rank(40, 'x') < rank(90, 'primary'));
});

// The six live variants of the same non-statement, measured in D1 on
// 2026-09-13 (139 of 276 events). The first version of this guard only caught
// the exact phrase "have not been established" and would have missed four of
// them, so the shapes are pinned here rather than left to one example.
test('the boilerplate-unknowns guard catches every live variant and spares specifics', () => {
  for (const v of [
    'Individual eligibility and applicability have not been established.',
    'Eligibility and applicability have not been established.',
    'Individual eligibility and how the rules apply have not yet been established.',
    'Individual eligibility and applicability are not established.',
    'Applicability needs verification in the original source.',
    'Individual eligibility and applicability remain unestablished.',
  ]) assert.ok(GENERIC_UNKNOWN.test(v), 'should be caught as boilerplate: ' + v);

  // These name what THIS story is missing and must survive.
  for (const v of [
    'Price, release timing, supported software and availability in Japan are not established.',
    'The affected version range and whether a fixed release shipped.',
    'The eligibility cutoff date is not given in the release.',
  ]) assert.ok(!GENERIC_UNKNOWN.test(v), 'should be kept as specific: ' + v);
});

test('the persona guard catches the wording that actually shipped', () => {
  for (const v of [
    'Young Chinese readers in Tokyo interested in AI, startups, and technology.',
    'A Chinese reader in Tokyo into AI, startups, tech and current affairs.',
  ]) assert.ok(PERSONA_LEAK.test(v), 'should be caught as persona leak: ' + v);

  for (const v of [
    'Anyone on a student visa whose JASSO stipend renews in April.',
    'Holders of the discontinued top tier, at their next renewal.',
  ]) assert.ok(!PERSONA_LEAK.test(v), 'should be kept: ' + v);
});
