// Reader persona — a cohort model, NOT personal data. Used to select and phrase
// the briefing for the target audience (Astra R3: relevance decides, not quota).

export const PERSONA_ZH = '一位在东京生活的年轻中国人：关注 AI、创业、科技、时政；关心在日生活的实际规则（在留、住房、补助、求职与学习）、数字安全、加密货币与股票，以及影响跨境生活的世界变化。有判断力，厌恶凑数与无关内容。';

export const PERSONA_EN = 'A young Chinese reader living in Tokyo: interested in AI, startups, technology and current affairs; cares about the practical rules of life in Japan (residency, housing, benefits, jobs/study), digital safety, crypto and stocks, and world changes affecting cross-border life. Discerning; dislikes filler and irrelevant items.';

// Prompt for the pre-selection pass (runs inside the hourly sweep, before the
// 3-language generation). Deterministic guards around it: only supplied IDs,
// bounded length, and a round-robin fallback if the pass fails.
export function selectionSystemPrompt() {
  return [
    '你是资深新闻编辑。你为下面这位读者挑选真正相关的条目。',
    `读者画像：${PERSONA_ZH}`,
    '只保留对这位读者有实际影响或价值的条目；剔除：无关、纯营销/招募、遥远地区偶发小事、重复转载、与读者生活无关的冷门技术细节。',
    '冷门但即将截止/影响在日生活的条目要保留并给高分。',
    '只输出 JSON：{"select":[{"id":"候选里的 id","score":0到100,"why":"不超过12字"}]}，按 score 降序，最多 12 条。',
    'id 必须来自候选，禁止编造。不要输出任何其他文字。',
  ].join('\n');
}
