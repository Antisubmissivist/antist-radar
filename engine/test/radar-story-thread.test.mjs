import test from 'node:test';
import assert from 'node:assert/strict';
import { salientTerms, eventTerms, isContinuation, pickThread, commonTerms, overlap, threadCore } from '../lib/story-thread.mjs';

// Every headline below was taken off radar.antist.ai on 2026-09-13 rather than
// invented, because the thresholds are only meaningful against the shape of
// text this site actually ingests — Title Case wire headlines, where
// "capitalised" does not mean "proper noun".
//
// The merges that must NOT happen are the point of this file. A story split
// into two threads is a missed connection; two stories welded into one timeline
// is a false claim printed on the page.

const H = {
  nvidiaPanic: 'Nvidia CEO Jensen Huang Calls AI Cybersecurity Panic a Sales Tactic',
  anthropicSlow: 'Anthropic CEO outlines plan to slow AI development',
  chatgptTier: 'ChatGPT top tier subscription discontinued; lower tiers remain as OpenAI adjusts pricing',
  chatgptTier2: 'OpenAI confirms ChatGPT top tier will not return, pricing tiers under review',
  openaiIpo: 'OpenAI delays IPO, says it will stay private for now',
  openaiMath: 'OpenAI reports Navier-Stokes singularity find',
  grokBots: 'Grok Bot open-sources six bots, hits 1M+ views',
  automattic: 'Automattic confirms Matt Mullenweg has returned as chair',
};

// A believable corpus, so commonTerms() has something to measure.
const corpus = Object.values(H).map((t) => ({ terms: salientTerms(t) }));

test('salient terms keep names and drop filler', () => {
  const t = salientTerms(H.openaiIpo);
  assert.ok(t.has('openai'));
  assert.ok(t.has('ipo'));
  assert.ok(!t.has('the'));
  assert.ok(!t.has('for'));
});

test('katakana runs survive as identity terms', () => {
  const t = salientTerms('ソフトバンクが新しい出資を発表');
  assert.ok([...t].some((x) => x.includes('ソフトバンク')));
});

test('POISON: two Title Case headlines sharing only AI and CEO must not merge', () => {
  // This is the exact pair that defeated the first version of the guard.
  const a = salientTerms(H.nvidiaPanic);
  const b = salientTerms(H.anthropicSlow);
  assert.ok(overlap(a, b).shared >= 2, 'they really do share two capitalised tokens');
  assert.equal(isContinuation(a, b, commonTerms(corpus)), false, 'but AI/CEO are subject matter, not identity');
});

test('POISON: same company, different stories must not merge', () => {
  const common = commonTerms(corpus);
  for (const [x, y] of [
    [H.openaiIpo, H.openaiMath],
    [H.grokBots, H.automattic],
    [H.nvidiaPanic, H.openaiIpo],
  ]) assert.equal(isContinuation(salientTerms(x), salientTerms(y), common), false, `${x} / ${y}`);
});

test('a genuine continuation of the same story does merge', () => {
  const common = commonTerms(corpus);
  assert.equal(isContinuation(salientTerms(H.chatgptTier), salientTerms(H.chatgptTier2), common), true);
});

test('pickThread joins the matching thread and starts a new one otherwise', () => {
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  const history = [
    { threadId: 't-tier', terms: salientTerms(H.chatgptTier), at: iso(2) },
    { threadId: 't-ipo', terms: salientTerms(H.openaiIpo), at: iso(1) },
  ];
  assert.equal(pickThread(salientTerms(H.chatgptTier2), iso(0), history), 't-tier');
  assert.equal(pickThread(salientTerms(H.automattic), iso(0), history), null);
});

test('a story older than the window starts a fresh thread', () => {
  const now = Date.now();
  const iso = (d) => new Date(now - d * 86400000).toISOString();
  const history = [{ threadId: 't-old', terms: salientTerms(H.chatgptTier), at: iso(30) }];
  assert.equal(pickThread(salientTerms(H.chatgptTier2), iso(0), history), null,
    'a month later it is a new story about an old subject');
});

test('ties go to the older thread so a story does not fork', () => {
  const now = Date.now();
  const iso = (d) => new Date(now - d * 86400000).toISOString();
  const terms = salientTerms(H.chatgptTier);
  const history = [
    { threadId: 't-newer', terms, at: iso(1) },
    { threadId: 't-older', terms, at: iso(5) },
  ];
  assert.equal(pickThread(salientTerms(H.chatgptTier2), iso(0), history), 't-older');
});

test('commonTerms measures the corpus instead of trusting a fixed list', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ terms: salientTerms(`Acme Corp ships Widget ${i} to Tokyo`) }));
  const c = commonTerms(many);
  assert.ok(c.has('acme'), 'a term in every headline identifies nothing here');
  assert.ok(c.has('ai'), 'the cold-start list is still applied');
});

test('event terms come from the headline only, not the body', () => {
  // Measured on 277 live events: adding evidence text raised multi-step threads
  // from 23 to 40, and the extra links were false — body text drags in every
  // name a report mentions in passing. This pins the decision down.
  const t = eventTerms({
    title: { en: 'Saudi Arabia shuts critical oil pipeline after drone attack' },
    evidence: 'Analysts at Goldman Sachs compared the move to Nvidia and OpenAI supply shocks.',
  });
  assert.ok(t.has('saudi'));
  assert.ok(!t.has('nvidia'), 'a name mentioned only in the body must not become identity');
  assert.ok(!t.has('goldman'));
});

test('POISON: a thread grows along its core, not along its last member', () => {
  // Single-linkage chaining is how "Anthropic asks to slow AI" and "Altman says
  // no IPO this year" ended up on one live timeline: one off-topic item joined
  // and then acted as a magnet for its own subject.
  const now = Date.now();
  const iso = (d) => new Date(now - d * 86400000).toISOString();
  const core = ['Houthis tighten grip on Red Sea shipping', 'Houthis advance in Yemen near the Red Sea', 'Houthis claim Red Sea coast in Yemen'];
  const history = core.map((t) => ({ threadId: 't-redsea', terms: salientTerms(t), at: iso(1), source: 'BBC World' }));
  // An item sharing two words with ONE member but not with what the thread is about.
  history.push({ threadId: 't-redsea', terms: salientTerms('Yemen Airways resumes Red Sea route bookings'), at: iso(1), source: 'BBC World' });

  assert.equal(pickThread(salientTerms('Houthis seize Mayun Island in the Red Sea'), iso(0), history), 't-redsea');
  assert.equal(pickThread(salientTerms('Yemen Airways adds new bookings system'), iso(0), history), null,
    'the off-topic member must not pull its own subject into the thread');
});
