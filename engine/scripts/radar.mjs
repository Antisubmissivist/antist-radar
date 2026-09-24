import '../apis/utils/env.mjs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fullBriefing} from '../apis/briefing.mjs';
import {collectFeeds,usableEvidence,scrub,dropDownstreamXDuplicates} from '../apis/sources/radar-feeds.mjs';
import {changes,eventId,eligibility} from '../lib/decision-events.mjs';
import {analyseRadar} from '../lib/radar-analysis.mjs';
import {publicSnapshot} from '../lib/radar-contract.mjs';
const push=process.argv.includes('--push');
const reuse=process.argv.includes('--reuse');
const origin=process.env.RADAR_URL||'https://radar.antist.ai';
await mkdir('runs',{recursive:true});
async function atomic(path,value){const tmp=path+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),'utf8');await rename(tmp,path);}
async function load(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
const start=Date.now();
const [sweep,feeds]=reuse ? [await load('runs/latest.json',null),await load('runs/radar-feeds.json',null)] : await Promise.all([fullBriefing(),collectFeeds()]);
if(!sweep||!feeds)throw new Error('Missing source snapshot');
const sweepMs=reuse?sweep.crucix.totalDurationMs:Date.now()-start;
await atomic('runs/latest.json',sweep);await atomic('runs/radar-feeds.json',feeds);
const s=sweep.sources;const now=new Date().toISOString();
const markets=Object.values(s.YFinance?.quotes||{}).filter(q=>!q.error&&q.observedAt&&Number.isFinite(q.price)&&Number.isFinite(q.changePct)).map(q=>({symbol:q.symbol,name:q.name,price:q.price,changePct:q.changePct,at:q.observedAt,source:`https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}/`}));
const raw=feeds.flatMap(f=>f.items);
function add(source,category,title,url,evidence,at=null,stableId=url) {if(!title||!url?.startsWith('https:'))return;raw.push({id:eventId(source,stableId),source,category,title:String(title).slice(0,280),url,publishedAt:at||null,fetchedAt:sweep.crucix.timestamp,stage:'announcement',deadlineAt:null,evidence:String(evidence||title).slice(0,1900),unknowns:'Applicability needs verification in the original source.'});}
for(const a of (s.AIInfra?.hardSignals||[]).slice(0,8))add(a.from,'ai',a.title,a.url,a.title,a.at);
for(const a of (s.GDELT?.allArticles||[]).slice(0,5))add('GDELT','geopolitics',a.title,a.url,a.title);
// Social and humanitarian feeds carry the story first-hand, so they feed the
// pool like any other source instead of being collected and thrown away.
// (Reddit is not here: it comes in through the Arctic Shift collector in
// radar-feeds.mjs, which needs no credentials.) Category is a prefill; the
// model re-reads it.
const at=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
for(const topic of ['conflict','markets','health'])for(const p of (s.Bluesky?.topics?.[topic]||[]).slice(0,4))if(p.url)add('Bluesky','geopolitics',p.text,p.url,`Bluesky post by @${p.author} · ${p.likes} likes\n${p.text}`,at(p.date));
for(const o of (s.WHO?.diseaseOutbreakNews||[]).slice(0,5))if(o.url)add('WHO','geopolitics',o.title,o.url,o.summary||`WHO Disease Outbreak News${o.donId?' ('+o.donId+')':''}: ${o.title}`,at(o.date));
for(const r of (s.ReliefWeb?.latestReports||[]).slice(0,5))if(r.url)add('ReliefWeb','geopolitics',r.title,r.url,r.description||`ReliefWeb (UN OCHA) update: ${r.title}`,at(r.date));
for(const a of (s.OFAC?.recent||[]).slice(0,5))if(a.url)add('OFAC','geopolitics',a.title,a.url,`OFAC recent action${a.date?' dated '+a.date:''}: ${a.title}`,at(a.date));
for(const a of (s['CISA-KEV']?.vulnerabilities||[]).slice(0,5))add('CISA-KEV','tech',`${a.cveID}: ${a.vulnerabilityName}`,`https://www.cisa.gov/known-exploited-vulnerabilities-catalog`,`${a.vendorProject} ${a.product}. ${a.shortDescription||''}. ${a.requiredAction||''}. Federal remediation due date is not a deadline applying to every reader.`,null,a.cveID);
const all=[...new Map(raw.map(x=>[x.id,x])).values()].map(x=>({...x,title:scrub(x.title),evidence:scrub(x.evidence)}));
// Drop items with no usable content (unreadable/missing extraction): only real news stays.
const withEvidence=all.filter(x=>usableEvidence(x.evidence,x.title));
// Then drop a downstream copy of a story a clickable X source already has.
const unique=dropDownstreamXDuplicates(withEvidence);
const droppedEvidence=all.length-withEvidence.length;
const droppedDuplicate=withEvidence.length-unique.length;
if(droppedDuplicate)console.error(JSON.stringify({event:'dropped-downstream-duplicate',count:droppedDuplicate}));
// Pool composition, so "source X never appears on the site" can be told apart
// from "source X never reaches the pool" without guesswork.
{const c={};for(const x of unique)c[x.source]=(c[x.source]||0)+1;console.error(JSON.stringify({event:'pool-sources',total:unique.length,Bluesky:c.Bluesky||0,WHO:c.WHO||0,ReliefWeb:c.ReliefWeb||0,OFAC:c.OFAC||0}));}
async function fetchRemoteState(endpoint,token){
  if(!token)return null;
  try{
    const r=await fetch(endpoint+'/api/state',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
    if(r.ok){const d=await r.json();if(d&&typeof d==='object'&&!Array.isArray(d)&&Object.keys(d).length)return d;}
  }catch(e){console.error('[radar] remote state fetch skipped:',e.message);}
  return null;
}
const remoteState=await fetchRemoteState(origin,process.env.RADAR_INGEST_TOKEN);
const previous=remoteState||await load('runs/decision-state.json',{});
const delta=changes(unique,previous);
// 10-day window: keep the candidate pool bounded so scoring stays fast.
const cutoff=Date.now()-10*86400000;
const analysis=await analyseRadar(delta.events.filter(e=>eligibility(e)!=='ineligible'&&Date.parse(e.publishedAt||e.fetchedAt||0)>=cutoff),markets);
// Reader-facing home of every sweep source, derived from the endpoint each
// module actually calls (see engine/apis/sources/*.mjs). A source missing from
// this table gets NO link rather than a fallback: pointing "NOAA" at the Crucix
// repo is a false attribution on a site whose entire claim is primary sources.
const known={
  GDELT:'https://www.gdeltproject.org/',
  OpenSky:'https://opensky-network.org/',
  FIRMS:'https://firms.modaps.eosdis.nasa.gov/',
  Maritime:'https://aisstream.io/',
  Safecast:'https://safecast.org/',
  ACLED:'https://acleddata.com/',
  ReliefWeb:'https://reliefweb.int/',
  WHO:'https://www.who.int/emergencies/disease-outbreak-news',
  OFAC:'https://ofac.treasury.gov/recent-actions',
  OpenSanctions:'https://www.opensanctions.org/',
  FRED:'https://fred.stlouisfed.org/',
  Treasury:'https://fiscaldata.treasury.gov/',
  BLS:'https://www.bls.gov/',
  EIA:'https://www.eia.gov/',
  GSCPI:'https://www.newyorkfed.org/research/policy/gscpi',
  Comtrade:'https://comtradeplus.un.org/',
  NOAA:'https://www.weather.gov/',
  Bluesky:'https://bsky.app/',
  Reddit:'https://www.reddit.com/',
  Telegram:'https://t.me/',
  Space:'https://celestrak.org/',
  YFinance:'https://finance.yahoo.com/',
  'CISA-KEV':'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
  'Cloudflare-Radar':'https://radar.cloudflare.com/',
  Japan:'https://www.jma.go.jp/',
  FX:'https://finance.yahoo.com/',            // fx.mjs calls query1.finance.yahoo.com, not frankfurter
  AIInfra:'https://news.ycombinator.com/',
};
// `count` is the real record count from the health audit. It used to be a
// hardcoded 0, which made the public "N/M healthy" headline unfalsifiable:
// a dead feed and a quiet day both rendered as a green "ok · 0".
const health=sweep.health;
const sources=Object.keys(sweep.timing||{}).filter(n=>n!=='Positions').map(name=>({
  name,
  url:known[name]||null,
  fetchedAt:sweep.crucix.timestamp,
  status:health.ok.includes(name)?'ok'
    :(health.quiet||[]).includes(name)?'quiet'
    :health.dead.some(x=>x.name===name)?'unavailable'
    :'degraded',
  count:(health.counts||{})[name]??0,
}));
sources.push(...feeds.map(f=>({name:f.name,url:f.url,fetchedAt:f.fetchedAt,status:f.status,count:f.items.length})));
const candidate={schema:2,id:createHash('sha256').update(now).digest('hex').slice(0,24),generatedAt:now,sweepMs,analysisStatus:analysis.status||'complete',digest:analysis.digest,events:analysis.events,markets,sources,forecasts:analysis.forecasts};
// Diagnose a private-value collision without printing the value itself.
{const js=JSON.stringify(candidate);const keys=['LLM_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','BYREAL_WALLET','BLUESKY_APP_PASSWORD'];const hit=keys.find(k=>{const v=process.env[k];return v&&v.length>5&&js.includes(v);});if(hit)console.log(JSON.stringify({event:'private-value-in-snapshot',envKey:hit}));}
const secrets=['LLM_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','BYREAL_WALLET','BLUESKY_APP_PASSWORD'].map(k=>process.env[k]).filter(Boolean);
const snapshot=publicSnapshot(candidate,secrets);await atomic('runs/public.json',snapshot);
if(push){
  if(!process.env.RADAR_INGEST_TOKEN)throw new Error('Missing ingestion credential');
  const r=await fetch(origin+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.RADAR_INGEST_TOKEN}`},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(60000)});
  const body=await r.json().catch(()=>null);
  await atomic('runs/decision-state.json',delta.state);
  try{await fetch(origin+'/api/state',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.RADAR_INGEST_TOKEN}`},body:JSON.stringify(delta.state),signal:AbortSignal.timeout(15000)});}catch(e){console.error('[radar] remote state push skipped:',e.message);}
  console.log(JSON.stringify({published:true,id:snapshot.id,events:snapshot.events.length,analysisUsage:analysis.usage,receipt:body}));
}else console.log(JSON.stringify({dryRun:true,id:snapshot.id,events:snapshot.events.length,sources:snapshot.sources.length,sweepMs,analysisUsage:analysis.usage}));
