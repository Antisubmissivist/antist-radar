import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { eventId } from '../../lib/decision-events.mjs';
const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:true});
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
export const plain=v=>cheerio.load(String(v??'')).text().replace(/\s+/g,' ').trim();
const iso=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export async function request(url, type='text', headers={}) {
  const r=await fetch(url,{headers:{'User-Agent':'AntistRadar/1.0 (+https://radar.antist.ai)',...headers},signal:AbortSignal.timeout(18000)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const reader=r.body.getReader();const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64_000_000){await reader.cancel();throw new Error('Response too large');}chunks.push(value);}
  const raw=Buffer.concat(chunks).toString('utf8');
  return type==='json'?JSON.parse(raw):raw;
}
export function parseFeed(raw) {
  const d=parser.parse(raw);const root=d.RDF||d.rss?.channel||d.feed;
  if(!root) throw new Error('Feed schema changed');
  return array(root.item||root.entry).map(i=>({
    title:plain(i.title?.['#text']||i.title),url:typeof i.link==='string'?i.link:array(i.link).find(x=>!x['@_rel']||x['@_rel']==='alternate')?.['@_href'],
    publishedAt:iso(i.date||i.pubDate||i.published||i.updated||i.issued),evidence:plain(i.description||i.summary||i.content||'').slice(0,1600),
  })).filter(i=>i.title&&i.url);
}
function event(source,category,item) {
  return {id:eventId(source,item.sourceId||item.url),source,category,title:item.title.slice(0,280),url:item.url,
    publishedAt:item.publishedAt||null,fetchedAt:new Date().toISOString(),stage:item.stage||'announcement',deadlineAt:item.deadlineAt||null,
    evidence:(item.evidence||item.title).slice(0,1900),conditions:item.conditions||{},unknowns:item.unknowns||'Individual eligibility and applicability have not been established.'};
}
async function feed(source,category,url,stage='announcement') {
  const all=parseFeed(await request(url));
  // BOJ's own RSS still uses http links; upgrade only this verified official host.
  for(const item of all){const u=new URL(item.url);if(u.hostname==='www.boj.or.jp'){u.protocol='https:';item.url=u.href;}}
  return {scanned:all.length,items:all.slice(0,12).map(x=>event(source,category,{...x,stage}))};
}
async function releases() {
  const repos=['honojs/hono','cloudflare/workers-sdk','tailwindlabs/tailwindcss'];
  const items=[];let scanned=0;
  for(const repo of repos) {
    const rows=await request(`https://api.github.com/repos/${repo}/releases?per_page=4`,'json',process.env.GH_READ_TOKEN?{Authorization:`Bearer ${process.env.GH_READ_TOKEN}`} : {});
    if(!Array.isArray(rows)) throw new Error('Releases schema changed');scanned+=rows.length;
    items.push(...rows.filter(r=>!r.draft&&!r.prerelease).slice(0,2).map(r=>event('GitHub Releases','tools',{sourceId:`${repo}:${r.id}`,title:`${repo} ${r.tag_name}`,url:r.html_url,publishedAt:iso(r.published_at),evidence:plain(r.body).slice(0,1800)})));
  }return {items,scanned};
}
async function grants() {
  const endpoint='https://api.jgrants-portal.go.jp/exp/v1/public/subsidies';
  const data=await request(endpoint+'?keyword=IT&sort=created_date&order=DESC&acceptance=1','json');
  if(!Array.isArray(data.result)) throw new Error('Grants schema changed');
  const items=await Promise.all(data.result.slice(0,6).map(async row=>{
    const detail=await request(`${endpoint}/id/${row.id}`,'json');const d=detail.result?.[0];if(!d)throw new Error('Missing grant detail');
    return event('JGrants','opportunity',{sourceId:row.id,title:row.title,url:d.front_subsidy_detail_page_url,
      stage:Date.parse(row.acceptance_end_datetime)<Date.now()?'closed':'open',deadlineAt:iso(row.acceptance_end_datetime),
      evidence:plain(`${d.detail||''} Region: ${row.target_area_search||''}. Employees: ${row.target_number_of_employees||''}. Purpose: ${d.use_purpose||''}. Industry: ${d.industry||''}. Deadline: ${row.acceptance_end_datetime}.`).slice(0,1900),
      conditions:{region:String(row.target_area_search||'').split(' / ')},unknowns:'Business eligibility, expenses and required documents must be checked in the official application guidelines.'});
  }));return {items,scanned:data.result.length};
}
async function policies() {
  const r=await feed('e-Gov','policy','https://public-comment.e-gov.go.jp/rss/pcm_list.xml','draft');
  // The official RSS identifies consultation, not an enacted rule.
  r.items=await Promise.all(r.items.slice(0,6).map(async e=>{
    const raw=await request(e.url);const $=cheerio.load(raw);$('script,style,header,footer,nav').remove();
    const body=plain($('main').length?$('main').html():$('body').html());
    const at=body.search(/受付締切|意見.*締切|意見.*締め切り/);
    return {...e,evidence:body.slice(Math.max(0,at-400),Math.max(0,at-400)+1800),unknowns:'Draft consultation only; enactment, applicability and exact deadline must be verified in the official notice.'};
  }));return r;
}
export function noticeLinks(raw,base,pattern) {
  const doc=cheerio.load(raw);const links=[];
  for(const el of doc('a[href]').toArray()){
    const href=new URL(doc(el).attr('href'),base);const title=plain(doc(el).text());
    if(href.origin===new URL(base).origin&&pattern.test(href.pathname)&&title&&!links.some(x=>x.url===href.href))links.push({title:title.slice(0,280),url:href.href});
  }
  if(!links.length)throw new Error('Notice list schema changed or access blocked');
  return links;
}
async function notices(name,category,base,pattern) {
  const links=noticeLinks(await request(base),base,pattern);
  const items=await Promise.all(links.slice(0,4).map(async item=>{
    const doc=cheerio.load(await request(item.url));doc('script,style,nav,header,footer').remove();
    const body=plain(doc('main').length?doc('main').html():doc('body').html());
    if(body.length<100)throw new Error('Notice detail unavailable');
    const title=plain(doc('h1').first().text())||item.title;
    const at=body.indexOf(title);const excerpt=body.slice(Math.max(0,at),Math.max(0,at)+1700);
    const date=body.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    return event(name,category,{...item,title,evidence:excerpt.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[official contact omitted]'),
      // A date anywhere in a document is not necessarily its publication date.
      publishedAt:iso(doc('meta[property="article:published_time"]').attr('content')),unknowns:'Verify the official conditions and deadlines. Publication date is unknown unless supplied by page metadata.'});
  }));return {items,scanned:links.length};
}
async function jobs() {
  const d=await request('https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true','json');
  if(!Array.isArray(d.jobs))throw new Error('Jobs schema changed');
  const matched=d.jobs.filter(j=>/Japan|Tokyo|Remote/i.test(j.location?.name||''));
  matched.sort((a,b)=>Number(/Japan|Tokyo/i.test(b.location?.name))-Number(/Japan|Tokyo/i.test(a.location?.name))||Date.parse(b.updated_at)-Date.parse(a.updated_at));
  return {scanned:d.jobs.length,items:matched.slice(0,4).map(j=>{
    const detail=plain(plain(j.content));const start=detail.search(/About the role|What you|Responsibilities|About the department|Location/i);
    return event('Greenhouse · Cloudflare','opportunity',{sourceId:j.id,title:j.title,url:j.absolute_url,stage:'open',
      evidence:`Employer: Cloudflare. Location: ${j.location?.name}. Updated: ${j.updated_at}. ${detail.slice(Math.max(0,start),Math.max(0,start)+1400)}`.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[official contact omitted]'),
      unknowns:'Selected employer only, not the whole job market. A remote label does not mean worldwide eligibility. Salary, work authorization and sponsorship require original-source verification.'});
  })};
}
export const FEEDS=[
  {name:'GitHub Releases',url:'https://docs.github.com/en/rest/releases/releases',collect:releases},
  {name:'JVN',url:'https://jvn.jp/rss/',collect:()=>feed('JVN','security','https://jvn.jp/rss/jvn.rdf')},
  {name:'e-Gov',url:'https://public-comment.e-gov.go.jp/',collect:policies},
  {name:'JGrants',url:'https://developers.digital.go.jp/documents/jgrants/api/',collect:grants},
  {name:'Greenhouse · Cloudflare',url:'https://www.cloudflare.com/careers/jobs/',collect:jobs},
  {name:'JASSO',url:'https://www.jasso.go.jp/ryugaku/',collect:()=>notices('JASSO','opportunity','https://www.jasso.go.jp/ryugaku/',/\/(news\/|ryugaku\/.+\/event\/|ryugaku\/.+\/admission)/)},
  {name:'Kokusen',url:'https://www.kokusen.go.jp/mimamori/mj_mglist.html',collect:()=>notices('Kokusen','living','https://www.kokusen.go.jp/mimamori/mj_mglist.html',/\/mj_mailmag\/mj-shinsen\d+\.html$/)},
  {name:'Bank of Japan',url:'https://www.boj.or.jp/rss/whatsnew.xml',collect:()=>feed('Bank of Japan','policy','https://www.boj.or.jp/rss/whatsnew.xml')},
];
export async function collectFeeds() {
  return Promise.all(FEEDS.map(async f=>{
    const fetchedAt=new Date().toISOString();
    try {const d=await f.collect();return {name:f.name,url:f.url,fetchedAt,status:d.items.length?'ok':'quiet',...d};}
    catch(e) {return {name:f.name,url:f.url,fetchedAt,status:'unavailable',items:[],scanned:0,error:e.message};}
  }));
}
