// OpenCode provider — canned-refusal detection + session rotation.
//
// These are the exact strings the hourly sweeps died on (2026-09-23 for three
// hours, 2026-09-24 twice): the provider's backend answering with a generic
// Chinese non-answer instead of the model. It used to surface downstream as
// "Unexpected token '你', \"你好，我无法给到相关内容。\" is not valid JSON" and,
// after three retries on the same session id, freeze the whole edition.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeProvider, isCannedRefusal } from '../lib/llm/opencode.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { selectFallbackProvider } from '../lib/radar-analysis.mjs';

// Verbatim from the failed sweep logs.
const REAL_REFUSALS = [
  '你好，我无法给到相关内容。',
  '抱歉，我无法回答这个问题。',
  '抱歉，没有找到相关的结果。',
  '抱歉，您的问题我无法识别。',
  '您的问题我无法回答。',
];

describe('isCannedRefusal', () => {
  it('flags every refusal the provider actually returned', () => {
    for (const r of REAL_REFUSALS) assert.equal(isCannedRefusal(r), true, r);
  });

  it('does not flag real JSON answers', () => {
    const ok = [
      '{"ja":"総括","en":"summary","zh":"综述"}',
      '{"items":[{"id":"a1","score":72,"category":"ai"}]}',
      '[{"id":"a1","score":72}]',
      '```json\n{"items":[]}\n```',
    ];
    for (const t of ok) assert.equal(isCannedRefusal(t), false, t);
  });

  it('does not flag a long prose answer that merely mentions 抱歉', () => {
    const long = ('これは普通の回答です。抱歉という語を含みますが長いので拒否ではありません。').repeat(8);
    assert.equal(isCannedRefusal(long), false);
  });

  it('does not flag empty text — that is a separate failure mode', () => {
    assert.equal(isCannedRefusal(''), false);
    assert.equal(isCannedRefusal(null), false);
    assert.equal(isCannedRefusal(undefined), false);
  });
});

describe('OpenCodeProvider canned-refusal handling', () => {
  it('rotates the session and throws a named error so the retry hits another backend', async () => {
    const p = new OpenCodeProvider({ apiKey: 'sk-test' });
    const before = p.session;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '你好，我无法给到相关内容。' }, finish_reason: 'stop' }],
        usage: {},
        model: 'deepseek-v4.1-flash',
      }),
    });
    try {
      await assert.rejects(
        () => p.complete('sys', 'user'),
        (err) => { assert.match(err.message, /canned refusal/); return true; }
      );
      assert.notEqual(p.session, before, 'session must rotate so the retry lands elsewhere');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('passes a normal answer through untouched and keeps the session', async () => {
    const p = new OpenCodeProvider({ apiKey: 'sk-test' });
    const before = p.session;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"items":[]}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: 'deepseek-v4.1-flash',
      }),
    });
    try {
      const r = await p.complete('sys', 'user');
      assert.equal(r.text, '{"items":[]}');
      assert.equal(p.session, before, 'a good answer must not rotate the session');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('selectFallbackProvider', () => {
  it('falls back to a different model on the same vendor, not to null', () => {
    const primary = createLLMProvider({ provider: 'opencode', apiKey: 'sk-test', model: 'deepseek-v4.1-flash' });
    const fb = selectFallbackProvider(primary);
    assert.ok(fb, 'a fallback must exist even when the vendor matches — only the model has to differ');
    assert.equal(fb.name, 'opencode');
    assert.equal(fb.model, 'glm-5.3-flash');
  });

  it('refuses a fallback identical to the primary', () => {
    const primary = createLLMProvider({ provider: 'opencode', apiKey: 'sk-test', model: 'glm-5.3-flash' });
    const saved = process.env.RADAR_LLM_FALLBACK_MODEL;
    process.env.RADAR_LLM_FALLBACK_MODEL = 'glm-5.3-flash';
    try {
      assert.equal(selectFallbackProvider(primary), null);
    } finally {
      if (saved === undefined) delete process.env.RADAR_LLM_FALLBACK_MODEL;
      else process.env.RADAR_LLM_FALLBACK_MODEL = saved;
    }
  });
});
