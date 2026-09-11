// Dev helper: run one custom source and print a human-readable summary.
// Usage: node scripts/probe.mjs aiinfra

import '../apis/utils/env.mjs';

const name = process.argv[2];
if (!name) { console.error('usage: node scripts/probe.mjs <sourceName>'); process.exit(1); }

const mod = await import(new URL(`../apis/sources/${name}.mjs`, import.meta.url).href);
const d = await mod.collect();

const P = (...a) => console.log(...a);

if (name === 'aiinfra') {
  P('lookback :', d.lookbackHours + 'h');
  P('builders : x=' + d.builders.xBuilders, 'pod=' + d.builders.podcastEpisodes, 'blog=' + d.builders.blogPosts);
  const top = d.builders.posts[0];
  P('  top X  :', top ? `${top.name} (${top.likes}likes/${top.retweets}rt)` : '—');
  P('HN       :', d.hackernews.stories.length, `stories >${d.hackernews.minPoints}pts`);
  d.hackernews.stories.slice(0, 4).forEach(s => P('   ', String(s.points).padStart(4), s.title.slice(0, 66), s.signal ? '[SIGNAL]' : ''));
  P('RSS      :', `${d.changelogs.feedsOk}/${d.changelogs.feedsTried} feeds,`, d.changelogs.items.length, 'items');
  d.changelogs.items.slice(0, 5).forEach(i => P('   ', `[${i.source}]`, i.title.slice(0, 62), i.signal ? '[SIGNAL]' : ''));
  P('硬信号   :', d.hardSignals.length);
  d.hardSignals.slice(0, 6).forEach(s => P('   ', `[${s.from}]`, s.title.slice(0, 70)));
  P('degraded :', d.degraded, JSON.stringify(d.errors));
} else {
  P(JSON.stringify(d, null, 2));
}
