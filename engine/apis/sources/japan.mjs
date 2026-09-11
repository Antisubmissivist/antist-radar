// Japan Life Layer — JMA earthquakes, typhoons, weather warnings (no API key)
// Custom source for Antist. All endpoints are public JMA bosai JSON feeds.

import { pathToFileURL } from 'node:url';
import { safeFetch } from '../utils/fetch.mjs';

const QUAKE_LIST = 'https://www.jma.go.jp/bosai/quake/data/list.json';
const TYPHOON_TARGET = 'https://www.jma.go.jp/bosai/typhoon/data/targetTc.json';
const WARNING = code => `https://www.jma.go.jp/bosai/warning/data/warning/${code}.json`;

// Prefecture office codes to watch. Override with JMA_AREAS="130000,140000".
// 130000 = 東京都, 140000 = 神奈川県, 270000 = 大阪府, 016000 = 石狩(札幌)
const DEFAULT_AREAS = '130000';

// Shindo (震度) is the actionable scale in Japan, not magnitude.
// maxi comes as "1".."4","5-","5+","6-","6+","7"
const SHINDO_RANK = { '1': 1, '2': 2, '3': 3, '4': 4, '5-': 5, '5+': 6, '6-': 7, '6+': 8, '7': 9 };
const ALERT_SHINDO = process.env.JMA_ALERT_SHINDO || '4'; // notify at 震度4+

// JMA warning code table. Tier matters far more than count:
// 特別警報 (emergency) > 警報 (warning) > 注意報 (advisory, = background noise).
const WARN_CODES = {
  '02': ['暴風雪特別警報', 'emergency'], '03': ['大雨特別警報', 'emergency'],
  '04': ['暴風特別警報', 'emergency'], '05': ['大雪特別警報', 'emergency'],
  '06': ['波浪特別警報', 'emergency'], '07': ['高潮特別警報', 'emergency'],
  '32': ['暴風雪特別警報', 'emergency'], '33': ['大雨特別警報', 'emergency'],
  '35': ['暴風特別警報', 'emergency'], '36': ['大雪特別警報', 'emergency'],
  '37': ['波浪特別警報', 'emergency'], '38': ['高潮特別警報', 'emergency'],
  '08': ['暴風雪警報', 'warning'], '09': ['大雨警報', 'warning'],
  '10': ['大雨注意報', 'advisory'], '12': ['大雪注意報', 'advisory'],
  '13': ['風雪注意報', 'advisory'], '14': ['雷注意報', 'advisory'],
  '15': ['強風注意報', 'advisory'], '16': ['波浪注意報', 'advisory'],
  '17': ['融雪注意報', 'advisory'], '18': ['洪水注意報', 'advisory'],
  '19': ['高潮注意報', 'advisory'], '20': ['濃霧注意報', 'advisory'],
  '21': ['乾燥注意報', 'advisory'], '22': ['なだれ注意報', 'advisory'],
  '23': ['低温注意報', 'advisory'], '24': ['霜注意報', 'advisory'],
  '25': ['着氷注意報', 'advisory'], '26': ['着雪注意報', 'advisory'],
  '27': ['その他の注意報', 'advisory'],
};
const TIER_RANK = { advisory: 1, warning: 2, emergency: 3 };

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

function shindoRank(maxi) {
  return SHINDO_RANK[String(maxi ?? '').trim()] ?? 0;
}

// JMA packs coordinates as "+32.5+130.6-10000/" (lat, lon, depth in metres)
function parseCod(cod) {
  const m = String(cod ?? '').match(/([+-][\d.]+)([+-][\d.]+)([+-][\d.]+)?/);
  if (!m) return null;
  return {
    lat: parseFloat(m[1]),
    lon: parseFloat(m[2]),
    depthKm: m[3] ? Math.abs(parseFloat(m[3])) / 1000 : null,
  };
}

async function quakes() {
  const list = await safeFetch(QUAKE_LIST, { timeout: 12000, headers: UA });
  if (!Array.isArray(list)) return { error: list?.error || 'unexpected JMA quake payload' };

  const threshold = shindoRank(ALERT_SHINDO);
  const cutoff = Date.now() - 48 * 3600 * 1000;

  // The feed repeats an event as reports are revised; keep the newest per eid.
  const byEvent = new Map();
  for (const e of list) {
    const t = Date.parse(e.at || e.rdt || '');
    if (!Number.isFinite(t) || t < cutoff) continue;
    const prev = byEvent.get(e.eid);
    if (!prev || Number(e.ser || 0) >= Number(prev.ser || 0)) byEvent.set(e.eid, e);
  }

  const events = [...byEvent.values()]
    .map(e => ({
      id: e.eid,
      at: e.at || e.rdt,
      title: e.ttl,
      region: e.anm,
      magnitude: e.mag ? parseFloat(e.mag) : null,
      maxShindo: e.maxi ?? null,
      shindoRank: shindoRank(e.maxi),
      ...(parseCod(e.cod) || {}),
      alert: shindoRank(e.maxi) >= threshold,
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const alerting = events.filter(e => e.alert);
  return {
    windowHours: 48,
    alertThresholdShindo: ALERT_SHINDO,
    total: events.length,
    alerting: alerting.length,
    maxShindo: events.reduce((m, e) => (e.shindoRank > shindoRank(m) ? e.maxShindo : m), null),
    events: events.slice(0, 20),
  };
}

async function typhoons() {
  const list = await safeFetch(TYPHOON_TARGET, { timeout: 12000, headers: UA });
  if (!Array.isArray(list)) return { active: 0, storms: [], note: list?.error || 'no active tropical cyclones' };
  return {
    active: list.length,
    storms: list.map(t => ({
      id: t.tropicalCyclone,
      number: t.typhoonNumber,
      category: t.category, // TD = tropical depression, TS/STS/TY = escalating
      issuedAt: t.issue,
    })),
  };
}

async function warnings(areaCodes) {
  const out = [];
  await Promise.all(areaCodes.map(async code => {
    const w = await safeFetch(WARNING(code), { timeout: 12000, headers: UA });
    if (w?.error) { out.push({ area: code, error: w.error }); return; }

    // Two traps live here, both silent:
    //  1. `status: 解除` means CANCELLED but the code is still present.
    //  2. JMA repeats every warning across areaTypes (prefecture + municipality),
    //     so a naive count roughly doubles. Dedupe on areaCode+code.
    const seen = new Map();
    for (const at of w.areaTypes || []) {
      for (const a of at.areas || []) {
        for (const warn of a.warnings || []) {
          if (!warn.code) continue;
          if (warn.status === '解除') continue;
          const [label, tier] = WARN_CODES[warn.code] || [`未知コード${warn.code}`, 'advisory'];
          seen.set(`${a.code}:${warn.code}`, { areaCode: a.code, code: warn.code, label, tier, status: warn.status });
        }
      }
    }
    const live = [...seen.values()].sort((x, y) => TIER_RANK[y.tier] - TIER_RANK[x.tier]);
    const serious = live.filter(x => x.tier !== 'advisory');

    out.push({
      area: code,
      office: w.publishingOffice,
      reportedAt: w.reportDatetime,
      headline: w.headlineText || null,
      advisoryCount: live.length - serious.length,
      warningCount: serious.length,
      topTier: live[0]?.tier || 'none',
      // Only 警報 and above are worth a push; 注意報 stay as context.
      warnings: serious,
      advisories: live.filter(x => x.tier === 'advisory').map(x => x.label),
    });
  }));
  return out;
}

export async function briefing() { return collect(); }

export async function collect() {
  const areaCodes = (process.env.JMA_AREAS || DEFAULT_AREAS).split(',').map(s => s.trim()).filter(Boolean);

  const [q, t, w] = await Promise.all([
    quakes().catch(e => ({ error: e.message })),
    typhoons().catch(e => ({ error: e.message })),
    warnings(areaCodes).catch(e => [{ error: e.message }]),
  ]);

  const flags = [];
  if (q?.alerting > 0) flags.push(`震度${ALERT_SHINDO}以上の地震 ${q.alerting} 件`);
  // Only escalate typhoons once they pass tropical-depression stage.
  const realStorms = (t?.storms || []).filter(s => s.category && s.category !== 'TD');
  if (realStorms.length) flags.push(`台風 ${realStorms.length} 個（${realStorms.map(s => s.category).join(',')}）`);
  const warned = (w || []).filter(a => a.warningCount > 0);
  if (warned.length) flags.push(`${warned.length} 地域に警報発表中（${warned.flatMap(a => a.warnings.map(x => x.label)).join('、')}）`);

  return {
    watchedAreas: areaCodes,
    quakes: q,
    typhoons: t,
    warnings: w,
    flags,
    actionable: flags.length > 0,
    timestamp: new Date().toISOString(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await collect(), null, 2));
}
