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
