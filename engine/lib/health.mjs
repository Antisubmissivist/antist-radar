// Source health guard.
//
// Crucix counts a source as "ok" whenever its module returns an object. But a
// module that fails politely — no credentials, HTTP 406, an empty array — also
// returns an object. The headline "26/28 OK" therefore over-reports, and a
// feed that silently died reads exactly like a quiet day.
//
// This walks each source's payload and classifies it: ok / degraded / dead.
// Anything less than ok is stated out loud, never folded into the OK count.

// Error-ish fields a source module may set instead of throwing.
const ERROR_KEY = /(^|[a-z])error$/i;

// Sources that are legitimately empty most days. An empty payload here is a
// real "nothing happened", not a broken feed.
const QUIET_OK = new Set(['NOAA', 'WHO', 'Safecast', 'Japan', 'Positions', 'CISA-KEV']);

function findErrors(obj, depth = 0, out = []) {
  if (!obj || typeof obj !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (ERROR_KEY.test(k) && v) {
      const msg = typeof v === 'string' ? v : JSON.stringify(v);
      if (msg && msg !== '""' && msg !== '{}' && msg !== '[]') out.push(`${k}: ${msg.slice(0, 160)}`);
    } else if (Array.isArray(v)) {
      // Arrays literally named "errors" carry messages, not records.
      if (/errors?$/i.test(k)) for (const e of v.slice(0, 3)) out.push(`${k}: ${String(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 160)}`);
    } else if (typeof v === 'object' && depth < 3) {
      findErrors(v, depth + 1, out);
    }
  }
  return out;
}

// Collect data-bearing arrays one level down as well. A top-level-only check
// misjudges sources that nest their records (aiinfra keeps posts under
// builders.posts and stories under hackernews.stories, leaving just one
// legitimately-empty `hardSignals` at the top) and flags a healthy quiet day
// as a dead feed. A guard that cries wolf gets ignored, which is worse than
// no guard at all.
function dataArrays(obj, depth = 0, out = []) {
  if (!obj || typeof obj !== 'object' || depth > 2) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (/errors?$/i.test(k)) continue; // holds messages, not records
    if (Array.isArray(v)) out.push(v);
    else if (v && typeof v === 'object') dataArrays(v, depth + 1, out);
  }
  return out;
}

function payloadIsEmpty(data) {
  if (!data || typeof data !== 'object') return true;
  const arrays = dataArrays(data);
  if (arrays.length === 0) return false; // scalar-only payloads (e.g. quote maps)
  return arrays.every(a => a.length === 0);
}

/**
 * @param {object} briefing output of fullBriefing()
 * @returns {{ok:string[], degraded:object[], dead:object[], trueOkCount:number, report:string}}
 */
export function auditSources(briefing) {
  const ok = [];
  const degraded = [];
  const dead = (briefing.errors || []).map(e => ({ name: e.name, reason: e.error }));

  for (const [name, data] of Object.entries(briefing.sources || {})) {
    const errs = findErrors(data);
    const empty = payloadIsEmpty(data);

    if (errs.length) {
      degraded.push({ name, reason: errs.join(' | '), kind: 'error-in-payload' });
    } else if (empty && !QUIET_OK.has(name)) {
      degraded.push({ name, reason: '返回成功但所有数据数组为空', kind: 'empty' });
    } else {
      ok.push(name);
    }
  }

  const total = ok.length + degraded.length + dead.length;
  const lines = [
    `真实健康度: ${ok.length}/${total} 正常` +
      (degraded.length ? ` · ${degraded.length} 降级` : '') +
      (dead.length ? ` · ${dead.length} 失败` : ''),
  ];
  for (const d of degraded) lines.push(`  ⚠️ ${d.name} — ${d.reason}`);
  for (const d of dead) lines.push(`  ❌ ${d.name} — ${d.reason}`);

  return { ok, degraded, dead, trueOkCount: ok.length, total, report: lines.join('\n') };
}
