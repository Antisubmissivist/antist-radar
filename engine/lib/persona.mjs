// Reader persona — a cohort model, NOT personal data. Used to select and phrase
// the briefing for the target audience (Astra R3: relevance decides, not quota).

export const PERSONA_ZH = '一位在东京生活的年轻中国人：关注 AI、创业、科技、时政；关心在日生活的实际规则（在留、住房、补助、求职与学习）、数字安全、加密货币与股票，以及影响跨境生活的世界变化。有判断力，厌恶凑数与无关内容。';

export const PERSONA_EN = 'A young Chinese reader living in Tokyo: interested in AI, startups, technology and current affairs; cares about the practical rules of life in Japan (residency, housing, benefits, jobs/study), digital safety, crypto and stocks, and world changes affecting cross-border life. Discerning; dislikes filler and irrelevant items.';

// Prompt for the pre-selection pass (runs inside the hourly sweep, before the
// 3-language generation). Deterministic guards around it: only supplied IDs,
// bounded length, and a round-robin fallback if the pass fails.
export function selectionSystemPrompt() {
  return [
    '你是资深情报分析师与主编。为下面这位读者，给**每一条候选**打一个 0–100 的客观相关度分，并给一句不超过 12 字的理由。',
    `读者画像：${PERSONA_ZH}`,
    '严格按以下客观阶梯锚点打分，严禁打分通胀与无锚打高分：',
    '- 90–100 分（系统性巨变）：直接颠覆在留资格/法律法规/基准利率/大模型生态断代的全国性或全球关键事件。',
    '- 70–89 分（高价值明确行动）：影响在日生活实操的政策实施、重点在留/就职节点、高价值补助金截止、重大安全防骗警报。',
    '- 40–69 分（常规有效动态）：普通行业进展、局部公开意见征集、常规技术发布。',
    '- 0–34 分（噪音/琐碎/无关）：冷门行业琐碎细则（如鱼类配额、无线电规程）、与读者生活无关的技术细节、纯营销招募宣传。',
    '注意：不得为了让某条新闻排在前面而故意拔高分数。低于 35 分的条目将被系统自动丢弃，宁缺毋滥。',
    '',
    '同时**按内容重新判定每条属于哪个板块**。候选里自带的 category 只是按「来源」预填的粗标签，经常是错的（例：一条全球招聘启事被预填成 japan-life，一个版本号发布被预填成 ai）——**以正文为准，不要迁就预填值**。七选一：',
    '- ai：模型能力、AI 产品与生态、AI 政策与安全。',
    '- tech：非 AI 的技术新闻——软件发版、漏洞与安全通告、硬件、平台变更。',
    '- japan-residence：在留资格、签证、入管、留学生入学与在日身份手续。',
    '- japan-life：在日本生活的实务——补助金、消费与防骗、交通与住房、医疗与教育。',
    '- geopolitics：国际政治、战争与制裁、跨国秩序变化。',
    '- crypto：加密货币、链上生态、交易所与相关监管。',
    '- stocks：股票、指数、宏观与货币政策、上市公司财报。',
    '判不准就沿用预填值；**绝不输出七个值以外的字符串**。',
    '',
    '只输出 JSON：{"items":[{"id":"候选里的 id","score":0到100,"category":"七选一","why":"不超过12字"}]}。',
    '必须覆盖**全部候选**，每条恰好一次；不要遗漏、不要编造 id；按 score 降序。不要输出任何其他文字。',
  ].join('\n');
}

