// Reader persona — a cohort model, NOT personal data. Used to select and phrase
// the briefing for the target audience (Astra R3: relevance decides, not quota).

export const PERSONA_ZH = '一位在东京生活的年轻中国人：关注 AI、创业、科技、时政；关心在日生活的实际规则（在留、住房、补助、求职与学习）、数字安全、加密货币与股票，以及影响跨境生活的世界变化。有判断力，厌恶凑数与无关内容。';

export const PERSONA_EN = 'A young Chinese reader living in Tokyo: interested in AI, startups, technology and current affairs; cares about the practical rules of life in Japan (residency, housing, benefits, jobs/study), digital safety, crypto and stocks, and world changes affecting cross-border life. Discerning; dislikes filler and irrelevant items.';

// Prompt for the pre-selection pass (runs inside the hourly sweep, before the
// 3-language generation). Deterministic guards around it: only supplied IDs,
// bounded length, and a round-robin fallback if the pass fails.
export function selectionSystemPrompt() {
  return [
    '你是资深新闻编辑。为下面这位读者，给**每一条候选**打一个 0–100 的相关度分，并给一句不超过 12 字的理由。',
    `读者画像：${PERSONA_ZH}`,
    '打分标准：对这位读者有实际影响或价值 → 高分；无关、纯营销/招募、遥远地区偶发小事、重复转载、与读者生活无关的冷门技术细节 → 低分。',
    '冷门但即将截止/影响在日生活的条目给高分。',
    '只输出 JSON：{"items":[{"id":"候选里的 id","score":0到100,"why":"不超过12字"}]}。',
    '必须覆盖**全部候选**，每条恰好一次；不要遗漏、不要编造 id；按 score 降序。不要输出任何其他文字。',
  ].join('\n');
}
