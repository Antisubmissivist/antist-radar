import assert from 'node:assert/strict';
const origin='http://127.0.0.1:8787';
const native=s=>({ja:s,en:s,zh:s});const now=new Date().toISOString();const id='local-'+Date.now();
const s={schema:2,id,generatedAt:now,sweepMs:100,analysisStatus:'complete',digest:native('Integration fixture'),events:[{id:'test-signal',source:'Test source',url:'https://example.org/news',category:'living',publishedAt:now,fetchedAt:now,stage:'draft',deadlineAt:null,title:native('<script>unsafe()</script>'),summary:native('Evidence summary'),audience:native('Readers'),action:native('Check original'),unknowns:native('Eligibility unknown'),evidence:'Original fixture',change:'new'}],sources:[{name:'Test source',status:'ok',count:1,url:'https://example.org',fetchedAt:now}],markets:[{symbol:'BTC-USD',name:'Bitcoin',price:110,changePct:1,at:now,source:'https://example.org/quote'}],forecast:{id,createdAt:new Date(Date.now()-120000).toISOString(),dueAt:new Date(Date.now()-60000).toISOString(),symbol:'BTC-USD',baseline:100,direction:'above',probability:.55,claim:native('Falsifiable fixture'),rationale:native('Fixture rationale'),evidence:['https://example.org/quote']}};
async function post(payload,token='local-integration-only'){return fetch(origin+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(payload)});}
assert.equal((await post(s,'wrong')).status,401);
assert.equal((await post({...s,password:'synthetic'})).status,400);
assert.equal((await post({...s,digest:{ja:'one',en:'two'}})).status,400);
assert.equal((await post({...s,generatedAt:'2000-01-01T00:00:00Z'})).status,409);
assert.equal((await post({...s,digest:native('a'.repeat(710000))})).status,413);
assert.equal((await post(s)).status,200);
let current=await (await fetch(origin+'/api/public')).json();assert.equal(current.id,id);assert.equal(current.events[0].stage,'draft');
const ledger=await (await fetch(origin+'/api/ledger')).json();const recorded=ledger.forecasts.find(f=>f.id===id);assert.equal(recorded.status,'hit');assert.equal(recorded.observed,110);
const second={...s,id:id+'-second',generatedAt:new Date().toISOString(),forecast:{...s.forecast,baseline:900}};
assert.equal((await post(second)).status,200);current=await(await fetch(origin+'/api/public')).json();assert.equal(current.forecast.baseline,100);
assert.equal((await post({...s,generatedAt:new Date(Date.parse(now)-1000).toISOString()})).status,409);
for(const l of ['ja','en','zh']){const r=await fetch(origin+'/'+l);const html=await r.text();assert.equal(r.status,200);assert.ok(html.includes(`lang="${l}"`));assert.ok(html.includes(`href="https://radar.antist.ai/${l}"`));assert.ok(html.includes('hreflang="x-default"'));assert.ok(!html.includes('<script>unsafe()</script>'));assert.ok(html.includes('&lt;script&gt;'));}
assert.equal((await fetch(origin+'/style.css')).status,200);assert.equal((await fetch(origin+'/sitemap.xml')).status,200);
console.log('PASS: actual local Worker authorization, privacy, size, locale, stale/order, KV roundtrip, D1 settlement, forecast immutability, XSS escaping, CSS and SEO.');
