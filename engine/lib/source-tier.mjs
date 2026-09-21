// Source tiers — how close a source sits to where the news actually broke.
//
// The ordering that matters here is deliberate and not the obvious one. For AI,
// X *is* the primary source: the labs, the researchers and the builders post
// there first and everything else is downstream reporting. X has no open API,
// so a scraper that surfaces what is hot on X is not a "secondary aggregator" —
// it is the only available pipe to a primary source. It ranks above every news
// outlet, not below them.
//
// `primary` is the other kind of first-hand: the institution publishing its own
// decision (JMA on an earthquake, BOJ on rates, e-Gov on a rule change). Nobody
// is closer to those facts than the body that made them.
//
// `media` is professional reporting about something that happened elsewhere.
// `data` is machine-read measurement with no editorial voice at all.

export const TIERS = ['x', 'primary', 'media', 'data'];

// Lower sorts first.
export const TIER_RANK = { x: 0, primary: 1, media: 2, data: 3 };

const BY_NAME = new Map(Object.entries({
  // --- x: windows into X/Twitter, where AI news breaks first -----------------
  ClawFeed: 'x',
  AINews: 'x',

  // --- primary: the institution publishing its own decision ------------------
  Japan: 'primary',              // JMA
  'Bank of Japan': 'primary',
  'e-Gov': 'primary',
  JGrants: 'primary',
  JASSO: 'primary',
  Kokusen: 'primary',
  JVN: 'primary',
  'CISA-KEV': 'primary',
  OFAC: 'primary',
  OpenSanctions: 'primary',
  WHO: 'primary',
  ReliefWeb: 'primary',
  'GitHub Releases': 'primary',

  // --- media: reporting about something that happened elsewhere --------------
  Techmeme: 'media',
  'The Verge': 'media',
  'Ars Technica': 'media',
  TechCrunch: 'media',
  Engadget: 'media',
  '9to5Mac': 'media',
  Cointelegraph: 'media',
  Decrypt: 'media',
  CoinDesk: 'media',
  MarketWatch: 'media',
  'Yahoo Finance': 'media',
  'BBC World': 'media',
  'Al Jazeera': 'media',
  'DW World': 'media',
}));

/**
 * Tier for a source name. Google News routes are labelled aggregators, so they
 * stay in `media`; everything unrecognised falls to `data`, the lowest claim we
 * can make about a feed we have not classified.
 */
export function sourceTier(name) {
  const n = String(name || '');
  if (BY_NAME.has(n)) return BY_NAME.get(n);
  if (n.startsWith('Google News')) return 'media';
  return 'data';
}

/** Sort comparator: X first, then primary, then media, then data. */
export function byTier(a, b) {
  return TIER_RANK[sourceTier(a)] - TIER_RANK[sourceTier(b)];
}
