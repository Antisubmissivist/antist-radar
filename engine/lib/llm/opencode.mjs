// OpenCode Zen Provider — raw fetch, no SDK
// OpenAI-compatible endpoint at https://opencode.ai/zen/v1

import { LLMProvider } from './provider.mjs';

export class OpenCodeProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'opencode';
    // Prefer the dedicated key so the shared LLM_API_KEY can keep another provider.
    this.apiKey = process.env.OPENCODE_API_KEY || config.apiKey;
    this.model = config.model || 'claude-fable-5-1';
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
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
    // Strip any inline chain-of-thought block before the JSON reaches the parser.
    const raw = data.choices?.[0]?.message?.content || '';
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
