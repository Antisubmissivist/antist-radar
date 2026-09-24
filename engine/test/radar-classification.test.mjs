import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../lib/radar-contract.mjs';
import { selectionSystemPrompt } from '../lib/persona.mjs';

// The board used to be assigned per source in radar.mjs, so a misfiled source
// stayed misfiled no matter which model ran: Cloudflare's global job board was
// published as news about living in Japan for as long as it was registered
// that way. The model reads the item and calls the board now. These tests pin
// the half that stays in code — the model proposes, the whitelist disposes.

// Mirrors the assignment inside selectByPersona.
const applyBoard = (event, proposed) => {
  const p = String(proposed || '').trim();
  if (p && p !== event.category && CATEGORIES.includes(p)) return { ...event, category: p };
  return event;
};

test('the model may overrule the source prefill', () => {
  const jobAd = { source: 'Greenhouse', category: 'japan-life' };
  assert.equal(applyBoard(jobAd, 'tech').category, 'tech');
});

test('POISON: an invented board name is refused, the prefill survives', () => {
  const e = { source: 'GitHub Releases', category: 'ai' };
  for (const junk of ['technology', 'TECH', 'japan_life', 'ai; DROP TABLE events', '', null, undefined, 7, {}]) {
    assert.equal(applyBoard(e, junk).category, 'ai', `must refuse ${JSON.stringify(junk)}`);
  }
});

test('every board the prompt offers is a board the contract accepts', () => {
  const prompt = selectionSystemPrompt();
  for (const c of CATEGORIES) assert.ok(prompt.includes(`- ${c}：`), `${c} must be described to the model`);
  // And nothing is offered that the contract would later reject.
  for (const m of prompt.matchAll(/^- ([a-z-]+)：/gm)) {
    assert.ok(CATEGORIES.includes(m[1]), `prompt offers "${m[1]}" which publicSnapshot would reject`);
  }
});

test('the prompt asks for category in the JSON shape it parses', () => {
  assert.match(selectionSystemPrompt(), /"category"\s*:/);
});

// The boundary cases the prompt is written against. These are the ones the
// model got wrong before the rules were spelled out: an AI lab's IPO read as
// AI news, export controls between states read as AI news, a bitcoin treasury
// company's buyback read as crypto. The prompt must keep naming the rule that
// settles each of them — this test does not call the model, it checks that the
// written spec still covers the cases the spec exists for.
const BOUNDARY_RULES = [
  ['AI 公司的财务事件', 'stocks'],   // Anthropic IPO, OpenAI not listing this year
  ['国家之间围绕 AI 的博弈', 'geopolitics'], // Nvidia export controls
  ['上市公司的股票行为', 'stocks'],   // Metaplanet buyback despite holding bitcoin
  ['加密监管立法', 'crypto'],
  ['身份手续', 'japan-residence'],
  ['宗教本身是事件主体', 'christianity'], // a church story, not a state story about religion
];

test('every boundary rule the model kept failing is still spelled out', () => {
  const prompt = selectionSystemPrompt();
  for (const [rule, board] of BOUNDARY_RULES) {
    assert.ok(prompt.includes(rule), `the prompt must still state the "${rule}" rule`);
    assert.ok(CATEGORIES.includes(board));
  }
});

test('the prompt states subject-over-mention, the rule the AI board kept violating', () => {
  const prompt = selectionSystemPrompt();
  // Without this, "ai" becomes a magnet: in 2026 every story mentions AI.
  assert.ok(/提到 AI ≠ AI 新闻/.test(prompt), 'the mention-is-not-subject rule must survive edits');
  assert.ok(/只能进一个板块/.test(prompt), 'single-board rule must survive edits');
});
