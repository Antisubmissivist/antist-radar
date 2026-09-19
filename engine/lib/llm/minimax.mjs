// MiniMax Provider — raw fetch, no SDK
// Uses MiniMax's OpenAI-compatible Chat Completions API

import { LLMProvider } from './provider.mjs';

// Extra output budget reserved for the model's chain of thought.
const REASONING_HEADROOM = parseInt(process.env.MINIMAX_REASONING_HEADROOM) || 12000;

export class MiniMaxProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'minimax';
    this.apiKey = config.apiKey;
    this.model = config.model || 'MiniMax-M3';
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        // M3 is a reasoning model: its chain of thought is billed against
        // max_tokens too. Without headroom it spends the whole budget thinking
        // and returns an empty content, which used to surface as a bare
        // "Unexpected end of JSON input" three retries later.
        max_tokens: (opts.maxTokens || 4096) + REASONING_HEADROOM,
        reasoning_split: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`MiniMax API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0] || {};
    const msg = choice.message || {};
    // With reasoning_split the thinking arrives in reasoning_content and
    // content is clean. Older models (M2.5) inline it as <think>...</think>,
    // which corrupts every downstream JSON.parse — strip it either way.
    const raw = msg.content || '';
    const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .replace(/^[\s\S]*?<\/think>/i, '') // unterminated block (hit max_tokens)
                    .trim();

    // An empty answer is a failure, not an empty result. Say why, so the
    // caller's retry logs name the real cause instead of a JSON parse error.
    if (!text) {
      const u = data.usage || {};
      throw new Error(
        `MiniMax returned no content (finish_reason=${choice.finish_reason || 'none'}, ` +
        `reasoning_tokens=${u.completion_tokens_details?.reasoning_tokens ?? '?'}, ` +
        `completion_tokens=${u.completion_tokens ?? '?'}, ` +
        `reasoning_chars=${(msg.reasoning_content || '').length})`
      );
    }

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
      finishReason: choice.finish_reason || null,
    };
  }
}
