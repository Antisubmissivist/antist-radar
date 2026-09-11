// Shared publication boundary. Pure functions: safe to import in the Worker.
export const LANGS = ['ja', 'en', 'zh'];
export const CATEGORIES = ['ai', 'tech', 'japan-residence', 'japan-life', 'geopolitics', 'crypto', 'stocks'];
export function text(value, max = 1500) {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Control character');
  return value;
}
export function url(value) {
  const u = new URL(text(value, 2000));
  if (u.protocol !== 'https:' || u.username || u.password || /(?:token|key|password|secret|auth)=/i.test(u.search)) throw new Error('Unsafe URL');
  return u.href;
}
export function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !/(Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error('Invalid timestamp');
  return new Date(value).toISOString();
}
export function multilingual(value, max = 1500) {
  return Object.fromEntries(LANGS.map(l => [l, text(value?.[l], max)]));
}
function number(n) { if (!Number.isFinite(n)) throw new Error('Invalid number'); return n; }
function list(v, max) { if (!Array.isArray(v) || v.length > max) throw new Error('Invalid list'); return v; }
function choice(v, values) { if (!values.includes(v)) throw new Error('Invalid choice'); return v; }
export function assertPrivateFree(value, privateValues = []) {
  const s = JSON.stringify(value);
  const patterns = [ /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/, /\bsk-[a-z]{2}-[A-Za-z0-9_-]{10,}/i,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, /-----BEGIN .*PRIVATE KEY-----/,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /"(?:wallet|positions|nftMint|watchedAreas|warnings|areaCode|bandState|bands|password|apiKey|chatId)"\s*:/i ];
  if (patterns.some(p=>p.test(s)) || privateValues.some(v=>v && v.length>5 && s.includes(v))) throw new Error('Private information rejected');
  return value;
}
export function publicSnapshot(input, privateValues = []) {
  // Reject poison even in unknown fields, then construct the entire output by allowlist.
  assertPrivateFree(input, privateValues);
  if (input.schema !== 2) throw new Error('Unsupported schema');
  const events=list(input.events,150).map(e=>({
    id:text(e.id,160), source:text(e.source,80), url:url(e.url), category:choice(e.category,CATEGORIES),
    publishedAt:e.publishedAt ? timestamp(e.publishedAt) : null, fetchedAt:timestamp(e.fetchedAt),
    stage:choice(e.stage,['announcement','draft','open','closed','withdrawn','unknown']),
    deadlineAt:e.deadlineAt ? timestamp(e.deadlineAt) : null,
    title:multilingual(e.title,300), summary:multilingual(e.summary,1500),
    audience:multilingual(e.audience,400), action:multilingual(e.action,600), unknowns:multilingual(e.unknowns,600),
    evidence:text(e.evidence,2000), change:choice(e.change,['new','updated','unchanged']),
  }));
  if (new Set(events.map(e=>e.id)).size!==events.length) throw new Error('Duplicate event');
  const markets=list(input.markets,50).map(q=>({symbol:text(q.symbol,24),name:text(q.name,80),price:number(q.price),changePct:number(q.changePct),at:timestamp(q.at),source:url(q.source)}));
  const sources=list(input.sources,80).map(s=>({name:text(s.name,80),status:choice(s.status,['ok','quiet','degraded','unavailable','stale']),count:number(s.count),url:url(s.url),fetchedAt:timestamp(s.fetchedAt)}));
  const forecasts=list(input.forecasts,6).map(f=>({
    id:text(f.id,80),createdAt:timestamp(f.createdAt),dueAt:timestamp(f.dueAt),
    symbol:text(f.symbol,24),baseline:number(f.baseline),direction:choice(f.direction,['above','below']),
    probability:number(f.probability),claim:multilingual(f.claim,500),rationale:multilingual(f.rationale,1000),
    evidence:list(f.evidence,10).map(url),
  }));
  for (const f of forecasts) if (f.probability<=0 || f.probability>=1 || Date.parse(f.dueAt)<=Date.parse(f.createdAt)) throw new Error('Invalid forecast');
  if (new Set(forecasts.map(f=>f.id)).size!==forecasts.length) throw new Error('Duplicate forecast');
  const out={schema:2,id:text(input.id,100),generatedAt:timestamp(input.generatedAt),sweepMs:number(input.sweepMs),
    analysisStatus:choice(input.analysisStatus,['complete','degraded']),digest:multilingual(input.digest,2000),events,markets,sources,forecasts};
  return assertPrivateFree(out,privateValues);
}
export function resolveForecast(forecast, quotes, now=Date.now()) {
  if (Date.parse(forecast.dueAt)>now) return null;
  const q=quotes.filter(x=>x.symbol===forecast.symbol && Number.isFinite(x.price) && x.price>0 && Date.parse(x.at)>=Date.parse(forecast.dueAt) && Date.parse(x.at)<=now && now-Date.parse(x.at)<3600000).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))[0];
  if (!q) return null;
  const hit=forecast.direction==='above' ? q.price>forecast.baseline : q.price<forecast.baseline;
  return {status:hit?'hit':'miss',observed:q.price,observationAt:q.at,resolvedAt:new Date(now).toISOString()};
}
