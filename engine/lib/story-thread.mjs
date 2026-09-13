// Story threads — grouping separate reports of the same developing story.
//
// `change: new|updated` only ever described one feed item changing under its own
// id. It could never say "this is the fourth thing we have heard about the same
// story", which is the claim the site actually makes. A thread is that: an
// ordered set of events about one development, each from whatever source
// carried it that day.
//
// Two properties matter more than cleverness here:
//
// 1. APPEND-ONLY. An event's thread is decided once, when it is first ingested,
//    against the threads that already exist. Nothing is re-clustered later. If
//    assignment could change retroactively, a reader's timeline would rearrange
//    itself between visits and the "on the record" claim would be hollow.
//
// 2. FALSE MERGES COST MORE THAN MISSES. Two unrelated stories welded into one
//    timeline is a visible lie; a story that splits into two threads is only a
//    missed connection. So the bar is deliberately set high (see MIN_SHARED /
//    MIN_DENSITY) and the tests poison it with near-misses that must NOT merge.

// Words that carry no identity. Sharing these means nothing.
const STOP = new Set(`the a an and or but for to of in on at by with from as is are was were be been
being this that these those it its new news report reports says said after before over under into out
up down more most other some such no nor not only own same so than too very can will just should now
what when where which who whom why how all any both each few here there about above below off again
i we you they he she them his her their our your my me us if then else while during because until
also may might must shall would could first second third one two three amid ahead plans plan year
years day days week weeks month months today yesterday tomorrow update updates latest breaking
company companies group inc ltd corp co via amp`.split(/\s+/).filter(Boolean));

// Latin proper-noun-ish tokens: capitalised words and acronyms.
const LATIN = /\b[A-Z][A-Za-z0-9][A-Za-z0-9&.'-]*\b/g;
// Katakana runs are almost always names or loanwords in Japanese headlines.
const KATAKANA = /[ァ-ヺー]{3,}/g;

const clean = (t) => t.replace(/[.'’]+$/, '').toLowerCase();

/**
 * The identity-bearing terms of a headline.
 *
 * Deliberately conservative: capitalised Latin tokens and katakana runs only.
 * Han text is skipped because every edition carries an English title, and
 * segmenting Han without a dictionary produces noise that merges unrelated
 * stories — the failure that costs the most.
 */
export function salientTerms(...parts) {
  const text = parts.filter(Boolean).join(' ');
  const out = new Set();
  for (const m of text.match(LATIN) || []) {
    const t = clean(m);
    if (t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t)) out.add(t);
  }
  for (const m of text.match(KATAKANA) || []) out.add(m);
  return out;
}

/** Terms for one event, from its English title plus the head of its evidence. */
export function eventTerms(event) {
  const title = typeof event?.title === 'object'
    ? (event.title.en || event.title.ja || event.title.zh || '')
    : String(event?.title || '');
  return salientTerms(title, String(event?.evidence || '').slice(0, 220));
}

// Headlines from wire services are Title Case, so "capitalised" does not mean
// "proper noun": `Nvidia CEO ... Calls AI Cybersecurity Panic a Sales Tactic`
// yields calls/panic/sales/tactic alongside the real names. Against
// `Anthropic CEO outlines plan to slow AI development` that shares {ceo, ai} at
// density 0.67 and would have merged two unrelated stories.
//
// The fix is not a hand-kept stopword list — this corpus decides for itself what
// is generic. Any term carried by more than COMMON_RATIO of recent events is
// subject matter, not identity, and is removed from both sides before scoring.
// COLD_COMMON covers the first sweeps, before there is any history to measure.
const COMMON_RATIO = 0.2;
const COLD_COMMON = new Set(['ai', 'ceo', 'cto', 'us', 'u.s', 'uk', 'eu', 'llm', 'gpt', 'api', 'app', 'it', 'tech']);

/**
 * Terms this corpus uses so often they identify nothing.
 * @param {Array<{terms:Set<string>}>} history
 */
export function commonTerms(history) {
  const out = new Set(COLD_COMMON);
  const n = history?.length || 0;
  if (n < 10) return out;
  const df = new Map();
  for (const h of history) for (const t of h.terms || []) df.set(t, (df.get(t) || 0) + 1);
  for (const [t, c] of df) if (c / n > COMMON_RATIO) out.add(t);
  return out;
}

const distinctive = (terms, common) => {
  if (!common?.size) return terms;
  const out = new Set();
  for (const t of terms) if (!common.has(t)) out.add(t);
  return out;
};

// A single shared name ("OpenAI", "Nvidia") is the most common word in this
// feed and says nothing — those two stories share a subject, not a storyline.
export const MIN_SHARED = 2;
// …and the shared part must be a real share of the smaller headline, so a long
// title cannot collect neighbours by sharing two incidental words.
export const MIN_DENSITY = 0.34;
// Beyond this, a "continuation" is really a new story about an old subject.
export const WINDOW_DAYS = 14;

/** Overlap between two term sets: {shared, density}. */
export function overlap(a, b) {
  if (!a?.size || !b?.size) return { shared: 0, density: 0 };
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return { shared, density: shared / Math.min(a.size, b.size) };
}

export function isContinuation(a, b, common) {
  const { shared, density } = overlap(distinctive(a, common), distinctive(b, common));
  return shared >= MIN_SHARED && density >= MIN_DENSITY;
}

/**
 * Which existing thread a new event continues, or null to start its own.
 *
 * @param {Set<string>} terms         terms of the incoming event
 * @param {string} at                 ISO time of the incoming event
 * @param {Array<{threadId:string,terms:Set<string>,at:string}>} history
 * @returns {string|null}
 */
export function pickThread(terms, at, history, common = commonTerms(history)) {
  const now = Date.parse(at) || Date.now();
  const mine = distinctive(terms, common);
  let best = null;
  for (const h of history) {
    if (!h?.threadId) continue;
    const age = (now - (Date.parse(h.at) || 0)) / 86400000;
    if (!(age >= 0 && age <= WINDOW_DAYS)) continue;
    const { shared, density } = overlap(mine, distinctive(h.terms, common));
    if (shared < MIN_SHARED || density < MIN_DENSITY) continue;
    // Strongest match wins; ties go to the older thread so a story keeps
    // accreting onto its original timeline instead of forking.
    if (!best || shared > best.shared || (shared === best.shared && Date.parse(h.at) < Date.parse(best.at))) {
      best = { threadId: h.threadId, shared, at: h.at };
    }
  }
  return best ? best.threadId : null;
}

/** Space-joined terms for storage; parse back with `parseTerms`. */
export const serializeTerms = (terms) => [...terms].join(' ');
export const parseTerms = (s) => new Set(String(s || '').split(/\s+/).filter(Boolean));
