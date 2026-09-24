// OpenCode Zen / OpenCode Go Provider — raw fetch, no SDK
// OpenAI-compatible endpoint. Go models require a stable x-opencode-session header
// and a descriptive User-Agent (https://opencode.ai/docs/go/#where-can-i-use-it).

import { LLMProvider } from './provider.mjs';
import { randomUUID } from 'node:crypto';

// deepseek-v4.1-flash reasons before it answers and bills that thinking against
// max_tokens. Scoring a 70-item pool measured 13,279 reasoning tokens, so the
// old flat 12,000 budget was spent before the first score was written and the
// call came back empty. Reserve the thinking budget separately.
const REASONING_HEADROOM = parseInt(process.env.OPENCODE_REASONING_HEADROOM) || 24000;

// A "canned refusal" is the provider's own backend answering with a generic
// Chinese non-answer ("你好，我无法给到相关内容。") instead of the model's output.
// It is NOT content moderation — the same prompt succeeds on the next run — and
// it is not our quota, which would be a 429. It is a provider-side routing
// fault: Go fans out across several upstreams and one of them intermittently
// serves a fallback assistant that refuses the task, while still stamping the
// reply with the requested model name. The giveaways are that it is short,
// Chinese, a refusal, and not JSON (the engine only ever asks for JSON).
const CANNED_REFUSAL = /(无法(给到|回答|识别|提供|协助|满足|处理)|没有找到(相关|到)|抱歉[，,、]|很抱歉|对不起[，,、]|不能回答)/;
export function isCannedRefusal(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 200) return false; // a real answer is never this short
  if (t.includes('{') || t.includes('[')) return false; // the engine asks for JSON; a refusal is prose
  return CANNED_REFUSAL.test(t);
}

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

  // Go pins routing to the session id, so a backend that answers with a canned
  // refusal keeps answering that way for every retry on the same id (this is
  // why three retries all failed inside one second). Rotating the id moves the
  // next attempt onto a different backend.
  rotateSession() {
    this.session = `antist-radar-${randomUUID()}`;
    return this.session;
  }

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
        max_tokens: (opts.maxTokens || 4096) + REASONING_HEADROOM,
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
    const choice = data.choices?.[0] || {};
    const msg = choice.message || {};
    // The provider returns reasoning separately; never let it reach the JSON parser.
    const raw = msg.content || '';
    const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .replace(/^[\s\S]*?<\/think>/i, '')
                    .trim();

    // A canned refusal is a provider fault, not the model's answer. Rotate the
    // session before throwing so the caller's retry lands on another backend,
    // and name the real cause instead of letting it surface downstream as
    // "Unexpected token '你' ... is not valid JSON".
    if (isCannedRefusal(text)) {
      const prev = this.session.slice(-8);
      this.rotateSession();
      throw new Error(
        `OpenCode canned refusal (provider backend, not the model; session ${prev}→${this.session.slice(-8)}): ${text.slice(0, 60)}`
      );
    }

    // An empty answer is a failure, not an empty result. Said plainly here, it
    // stops surfacing downstream as "0 items scored" or a JSON parse error.
    if (!text) {
      const u = data.usage || {};
      throw new Error(
        `OpenCode returned no content (finish_reason=${choice.finish_reason || 'none'}, ` +
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
