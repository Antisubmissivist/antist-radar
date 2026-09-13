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

/**
 * Terms for one event — headline only, deliberately.
 *
 * Including the head of `evidence` was tried and measured over 277 live events:
 * it raised multi-step threads from 23 to 40, but the extra connections were
 * wrong. Body text drags in every name a report mentions in passing, so four
 * unrelated ClawFeed items ("a model rebuilds landing gear", "GPT-6 free for
 * clinicians", "top tier discontinued", "users say the model got dumber")
 * collapsed into one timeline. With headlines alone every surviving thread on
 * that sample was a single real story. Fewer links, all of them true.
 */
export function eventTerms(event) {
  const title = typeof event?.title === 'object'
    ? (event.title.en || event.title.ja || event.title.zh || '')
    : String(event?.title || '');
  return salientTerms(title);
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

// A publisher's own boilerplate is invisible to corpus-wide frequency: e-Gov
// files every notice as "Public Comment on Draft <X> Order", which is 100% of
// that source and 2% of the feed. Six unrelated consultations merged into one
// timeline on exactly that. So each source is also measured against itself.
const SOURCE_TEMPLATE_RATIO = 0.4;
// A template only reveals itself across many filings. Set too low, a source
// that happens to be covering one story hard has that story's own words
// stripped as "boilerplate" — with four Red Sea reports from one outlet,
// red/sea/houthis all looked like a template and the thread lost its identity.
const SOURCE_MIN_ITEMS = 8;

/**
 * Terms this corpus uses so often they identify nothing — measured globally and
 * again within each source, so a publisher's template is caught too.
 * @param {Array<{terms:Set<string>,source?:string}>} history
 */
export function commonTerms(history) {
  const out = new Set(COLD_COMMON);
  const n = history?.length || 0;
  if (!n) return out;

  const bySource = new Map();
  const df = new Map();
  for (const h of history) {
    for (const t of h.terms || []) df.set(t, (df.get(t) || 0) + 1);
    if (!h.source) continue;
    const g = bySource.get(h.source) || [];
    g.push(h.terms || new Set());
    bySource.set(h.source, g);
  }
  if (n >= 10) for (const [t, c] of df) if (c / n > COMMON_RATIO) out.add(t);

  for (const [, group] of bySource) {
    if (group.length < SOURCE_MIN_ITEMS) continue;
    const sdf = new Map();
    for (const terms of group) for (const t of terms) sdf.set(t, (sdf.get(t) || 0) + 1);
    for (const [t, c] of sdf) if (c / group.length > SOURCE_TEMPLATE_RATIO) out.add(t);
  }
  return out;
}

/**
 * What a thread is *about*: the terms at least half its members carry.
 *
 * Matching a newcomer against any single member produces single-linkage
 * chaining — one off-topic item joins, and from then on it acts as a magnet for
 * its own subject. That is how "Anthropic asks to slow AI" and "Altman says no
 * IPO this year" ended up on one timeline. Matching the core instead means a
 * thread can only grow along what it has consistently been about.
 */
export function threadCore(members) {
  const n = members?.length || 0;
  if (!n) return new Set();
  if (n === 1) return new Set(members[0]);
  const df = new Map();
  for (const terms of members) for (const t of terms) df.set(t, (df.get(t) || 0) + 1);
  const out = new Set();
  for (const [t, c] of df) if (c * 2 >= n) out.add(t);
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
  if (mine.size < MIN_SHARED) return null;

  // Group history into threads, keeping each thread's newest timestamp so the
  // window applies to the thread rather than to whichever member matched.
  const threads = new Map();
  for (const h of history || []) {
    if (!h?.threadId) continue;
    const t = threads.get(h.threadId) || { members: [], at: h.at };
    t.members.push(distinctive(h.terms, common));
    if (Date.parse(h.at) > Date.parse(t.at)) t.at = h.at;
    threads.set(h.threadId, t);
  }

  let best = null;
  for (const [threadId, t] of threads) {
    const age = (now - (Date.parse(t.at) || 0)) / 86400000;
    if (!(age >= 0 && age <= WINDOW_DAYS)) continue;
    const core = threadCore(t.members);
    const { shared, density } = overlap(mine, core);
    if (shared < MIN_SHARED || density < MIN_DENSITY) continue;
    if (!best || shared > best.shared || (shared === best.shared && Date.parse(t.at) < Date.parse(best.at))) {
      best = { threadId, shared, at: t.at };
    }
  }
  return best ? best.threadId : null;
}

/** Space-joined terms for storage; parse back with `parseTerms`. */
export const serializeTerms = (terms) => [...terms].join(' ');
export const parseTerms = (s) => new Set(String(s || '').split(/\s+/).filter(Boolean));
