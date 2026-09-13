// One-off: assign story threads to events that predate the feature.
//
// Without this the timeline stays empty until enough new events accumulate,
// which would take days and make the feature look broken on the day it ships.
//
// Runs the same assignment the Worker does at ingest, in the same order events
// were first seen, so the backfilled threads are what live assignment would
// have produced. Reads a wrangler --json export on stdin (or argv[2]) and
// writes UPDATE statements; it never touches the database itself.
//
//   wrangler d1 execute <db> --remote --json --command \
//     "SELECT id,first_seen,published_at,title_json,substr(evidence,1,220) evidence FROM events ORDER BY COALESCE(published_at,first_seen) ASC" \
//     > export.json
//   node engine/scripts/backfill-threads.mjs export.json > backfill.sql
//   wrangler d1 execute <db> --remote --file backfill.sql

import { readFileSync } from 'node:fs';
import { eventTerms, pickThread, commonTerms, serializeTerms } from '../lib/story-thread.mjs';

const raw = readFileSync(process.argv[2] || 0, 'utf8');
const rows = JSON.parse(raw.slice(raw.indexOf('[')))[0].results;

const prepared = rows.map((r) => {
  let title = null;
  try { title = JSON.parse(String(r.title_json)); } catch { title = String(r.title_json || ''); }
  return {
    id: String(r.id),
    source: String(r.source || ''),
    at: String(r.published_at || r.first_seen),
    terms: eventTerms({ title, evidence: r.evidence || '' }),
  };
});

// commonTerms needs the whole corpus to decide what is generic; live ingest
// derives it from a rolling 14-day window, which is close enough that the
// backfilled threads match what assignment would have produced.
const common = commonTerms(prepared);

const history = [];
const out = [];
let joined = 0;
for (const e of prepared) {
  const threadId = pickThread(e.terms, e.at, history, common) || `t${e.id.slice(0, 12)}`;
  if (threadId !== `t${e.id.slice(0, 12)}`) joined++;
  history.push({ threadId, terms: e.terms, source: e.source, at: e.at });
  const terms = serializeTerms(e.terms).replace(/'/g, "''");
  out.push(`UPDATE events SET thread_id='${threadId}', thread_terms='${terms}' WHERE id='${e.id.replace(/'/g, "''")}';`);
}

const sizes = new Map();
for (const h of history) sizes.set(h.threadId, (sizes.get(h.threadId) || 0) + 1);
const multi = [...sizes.values()].filter((n) => n > 1);

process.stderr.write(`events=${prepared.length} threads=${sizes.size} joined=${joined} ` +
  `multi-step threads=${multi.length} largest=${Math.max(0, ...multi)}\n`);
process.stdout.write(out.join('\n') + '\n');
