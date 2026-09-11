// OpenCode Zen / OpenCode Go Provider — raw fetch, no SDK
// OpenAI-compatible endpoint. Go models require a stable x-opencode-session header
// and a descriptive User-Agent (https://opencode.ai/docs/go/#where-can-i-use-it).

import { LLMProvider } from './provider.mjs';
import { randomUUID } from 'node:crypto';

export class OpenCodeProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'opencode';
    this.apiKey = process.env.OPENCODE_API_KEY || config.apiKey;
    this.model = config.model || 'deepseek-v4.1-flash';
    // Go routes and caches per conversation; keep one stable id for the process.
    this.session = process.env.OPENCODE_SESSION_ID || `antist-radar-${randomUUID()}`;
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'x-opencode-session': this.session,
        'User-Agent': 'antist-radar/1.0 (+https://radar.antist.ai)',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens || 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenCode API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    // The provider returns reasoning separately; never let it reach the JSON parser.
    const raw = msg.content || '';
    const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .replace(/^[\s\S]*?<\/think>/i, '')
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
