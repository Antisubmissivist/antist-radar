// MiniMax Provider — raw fetch, no SDK
// Uses MiniMax's OpenAI-compatible Chat Completions API

import { LLMProvider } from './provider.mjs';

export class MiniMaxProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'minimax';
    this.apiKey = config.apiKey;
    this.model = config.model || 'MiniMax-M2.5';
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
        max_tokens: opts.maxTokens || 4096,
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
    // M2.5+ emits its chain of thought inline as <think>...</think> in the
    // OpenAI-compatible response. Left in, it corrupts every downstream
    // JSON.parse of trade ideas and alert verdicts.
    const raw = data.choices?.[0]?.message?.content || '';
    const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .replace(/^[\s\S]*?<\/think>/i, '') // unterminated block (hit max_tokens)
                    .trim();

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
      finishReason: data.choices?.[0]?.finish_reason || null,
    };
  }
}
