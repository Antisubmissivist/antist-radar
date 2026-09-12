import '../apis/utils/env.mjs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fullBriefing} from '../apis/briefing.mjs';
import {collectFeeds,usableEvidence} from '../apis/sources/radar-feeds.mjs';
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
for(const a of (s['CISA-KEV']?.vulnerabilities||[]).slice(0,5))add('CISA-KEV','tech',`${a.cveID}: ${a.vulnerabilityName}`,`https://www.cisa.gov/known-exploited-vulnerabilities-catalog`,`${a.vendorProject} ${a.product}. ${a.shortDescription||''}. ${a.requiredAction||''}. Federal remediation due date is not a deadline applying to every reader.`,null,a.cveID);
const all=[...new Map(raw.map(x=>[x.id,x])).values()];
// Drop items with no usable content (unreadable/missing extraction): only real news stays.
const unique=all.filter(x=>usableEvidence(x.evidence,x.title));
const droppedEvidence=all.length-unique.length;
if(droppedEvidence)console.log(JSON.stringify({event:'dropped-unusable',count:droppedEvidence,of:all.length}));
const previous=await load('runs/decision-state.json',{});const delta=changes(unique,previous);
// 10-day window: keep the candidate pool bounded so scoring stays fast.
const cutoff=Date.now()-10*86400000;
const analysis=await analyseRadar(delta.events.filter(e=>eligibility(e)!=='ineligible'&&Date.parse(e.publishedAt||e.fetchedAt||0)>=cutoff),markets);
const known={YFinance:'https://finance.yahoo.com/',AIInfra:'https://news.ycombinator.com/',Japan:'https://www.jma.go.jp/',FX:'https://www.frankfurter.app/',GDELT:'https://www.gdeltproject.org/','CISA-KEV':'https://www.cisa.gov/known-exploited-vulnerabilities-catalog'};
const health=sweep.health;const sources=Object.keys(sweep.timing||{}).filter(n=>n!=='Positions').map(name=>({name,url:known[name]||'https://github.com/calesthio/Crucix',fetchedAt:sweep.crucix.timestamp,status:health.ok.includes(name)?'ok':health.dead.some(x=>x.name===name)?'unavailable':'degraded',count:0}));
sources.push(...feeds.map(f=>({name:f.name,url:f.url,fetchedAt:f.fetchedAt,status:f.status,count:f.items.length})));
const candidate={schema:2,id:createHash('sha256').update(now).digest('hex').slice(0,24),generatedAt:now,sweepMs,analysisStatus:'complete',digest:analysis.digest,events:analysis.events,markets,sources,forecasts:analysis.forecasts};
const secrets=['LLM_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','BYREAL_WALLET','ACLED_EMAIL','ACLED_PASSWORD'].map(k=>process.env[k]).filter(Boolean);
const snapshot=publicSnapshot(candidate,secrets);await atomic('runs/public.json',snapshot);
if(push){
  if(!process.env.RADAR_INGEST_TOKEN)throw new Error('Missing ingestion credential');
  const r=await fetch(origin+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.RADAR_INGEST_TOKEN}`},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(60000)});
  const body=await r.json();if(!r.ok||!body.ok)throw new Error(`Publication rejected (${r.status})`);
  await atomic('runs/decision-state.json',delta.state);
  console.log(JSON.stringify({published:true,id:snapshot.id,events:snapshot.events.length,analysisUsage:analysis.usage,receipt:body}));
}else console.log(JSON.stringify({dryRun:true,id:snapshot.id,events:snapshot.events.length,sources:snapshot.sources.length,sweepMs,analysisUsage:analysis.usage}));
