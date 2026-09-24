import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { eventId } from '../../lib/decision-events.mjs';
const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:true});
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
// Atom/HTML content can arrive as an object ({'#text':…} or {div:{p:[…]}}); flatten
// it to text instead of String(obj) === "[object Object]".
const textOf=v=>{if(v==null)return '';if(typeof v==='string')return v;if(Array.isArray(v))return v.map(textOf).filter(Boolean).join(' ');if(typeof v==='object'){for(const k of ['#text','div','p','body','_']){if(v[k]!=null){const t=textOf(v[k]);if(t)return t;}}return Object.values(v).map(textOf).filter(Boolean).join(' ');}return String(v);};
export const plain=v=>{const s=textOf(v).trim();if(!s||s==='[object Object]')return '';try{return cheerio.load(s).text().replace(/\s+/g,' ').trim();}catch{return s.replace(/\s+/g,' ').trim();}};
// Scrub credentials/contacts at the ingestion boundary so the privacy guard in
// publicSnapshot never trips on ordinary article text (it rejects any email).
const SCRUB=[/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g,/\bsk-[a-z]{2}-[A-Za-z0-9_-]{10,}/gi,/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g];
export const scrub=v=>{let s=String(v??'');for(const r of SCRUB)s=s.replace(r,'[withheld]');return s;};
// An item is usable only if it carries real detail beyond its headline.
const NOISE=/^(\s*(subscribe|sign ?in|sign ?up|log ?in|read more|share|advertisement|sponsored|all rights reserved|cookies?|accept all|privacy policy|terms of (use|service))\b)/i;
export const usableEvidence=(evidence,title)=>{const t=String(evidence||'').replace(/\s+/g,' ').trim();if(!t||/\[object object\]/i.test(t))return false;if(t===String(title||'').replace(/\s+/g,' ').trim())return false;if(t.length<40)return false;if(NOISE.test(t))return false;return true;};
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
    publishedAt:iso(i.date||i.pubDate||i.published||i.updated||i.issued),evidence:(()=>{for(const c of [i.content,i.summary,i.description]){const t=plain(c);if(t)return t.slice(0,1600);}return '';})(),
  })).filter(i=>i.title&&i.url);
}
function event(source,category,item) {
  return {id:eventId(source,item.sourceId||item.url),source,category,title:item.title.slice(0,280),url:item.url,
    publishedAt:item.publishedAt||null,fetchedAt:new Date().toISOString(),stage:item.stage||'announcement',deadlineAt:item.deadlineAt||null,
    evidence:(item.evidence||item.title).slice(0,1900),conditions:item.conditions||{},unknowns:item.unknowns||'Individual eligibility and applicability have not been established.'};
}
async function feed(source,category,url,stage='announcement',limit=12) {
  const all=parseFeed(await request(url));
  // BOJ's own RSS still uses http links; upgrade only this verified official host.
  for(const item of all){const u=new URL(item.url);if(u.hostname==='www.boj.or.jp'){u.protocol='https:';item.url=u.href;}}
  return {scanned:all.length,items:all.slice(0,limit).map(x=>event(source,category,{...x,stage}))};
}
async function releases() {
  const repos=['honojs/hono','cloudflare/workers-sdk','tailwindlabs/tailwindcss'];
  const items=[];let scanned=0;
  for(const repo of repos) {
    const rows=await request(`https://api.github.com/repos/${repo}/releases?per_page=4`,'json',process.env.GH_READ_TOKEN?{Authorization:`Bearer ${process.env.GH_READ_TOKEN}`} : {});
    if(!Array.isArray(rows)) throw new Error('Releases schema changed');scanned+=rows.length;
    items.push(...rows.filter(r=>!r.draft&&!r.prerelease).slice(0,2).map(r=>event('GitHub Releases','tech',{sourceId:`${repo}:${r.id}`,title:`${repo} ${r.tag_name}`,url:r.html_url,publishedAt:iso(r.published_at),evidence:plain(r.body).slice(0,1800)})));
  }return {items,scanned};
}
async function grants() {
  const endpoint='https://api.jgrants-portal.go.jp/exp/v1/public/subsidies';
  const data=await request(endpoint+'?keyword=IT&sort=created_date&order=DESC&acceptance=1','json');
  if(!Array.isArray(data.result)) throw new Error('Grants schema changed');
  const items=await Promise.all(data.result.slice(0,6).map(async row=>{
    const detail=await request(`${endpoint}/id/${row.id}`,'json');const d=detail.result?.[0];if(!d)throw new Error('Missing grant detail');
    return event('JGrants','japan-life',{sourceId:row.id,title:row.title,url:d.front_subsidy_detail_page_url,
      stage:Date.parse(row.acceptance_end_datetime)<Date.now()?'closed':'open',deadlineAt:iso(row.acceptance_end_datetime),
      evidence:plain(`${d.detail||''} Region: ${row.target_area_search||''}. Employees: ${row.target_number_of_employees||''}. Purpose: ${d.use_purpose||''}. Industry: ${d.industry||''}. Deadline: ${row.acceptance_end_datetime}.`).slice(0,1900),
      conditions:{region:String(row.target_area_search||'').split(' / ')},unknowns:'Business eligibility, expenses and required documents must be checked in the official application guidelines.'});
  }));return {items,scanned:data.result.length};
}
async function policies() {
  const r=await feed('e-Gov','japan-life','https://public-comment.e-gov.go.jp/rss/pcm_list.xml','draft');
  // The official RSS identifies consultation, not an enacted rule.
  r.items=await Promise.all(r.items.slice(0,6).map(async e=>{
    const raw=await request(e.url);const $=cheerio.load(raw);$('script,style,header,footer,nav').remove();
    const body=plain($('main').length?$('main').html():$('body').html());
    const at=body.search(/受付締切|意見.*締切|意見.*締め切り/);
    const combined=`${e.title} ${body}`;
    const category=/出入国|在留|ビザ|外国人|特定技能|難民|技能実習|育成就労|国籍法|永住|帰化/i.test(combined)?'japan-residence':/IT|通信|電波|AI|デジタル|サイバー|半導体/i.test(combined)?'tech':'japan-life';
    return {...e,category,evidence:body.slice(Math.max(0,at-400),Math.max(0,at-400)+1800),unknowns:'Draft consultation only; enactment, applicability and exact deadline must be verified in the official notice.'};
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
    const text=`${title} ${excerpt}`;
    const finalCategory=(name==='JASSO'&&/ビザ|在留|在留資格|留学ビザ|海外申請|入国/i.test(text))?'japan-residence':category;
    return event(name,finalCategory,{...item,title,evidence:excerpt.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[official contact omitted]'),
      // A date anywhere in a document is not necessarily its publication date.
      publishedAt:iso(doc('meta[property="article:published_time"]').attr('content')),unknowns:'Verify the official conditions and deadlines. Publication date is unknown unless supplied by page metadata.'});
  }));return {items,scanned:links.length};
}
async function clawfeed() {
  const data=await request('https://clawfeed.kevinhe.io/api/digests?type=4h&limit=3','json');
  if(!Array.isArray(data)) throw new Error('ClawFeed schema changed');
  const items=[];let scanned=0;
  for(const digest of data){
    for(const line of String(digest.content||'').split('\n')){
      const t=line.trim();
      if(!t.startsWith('•')) continue;
      const clean=t.replace(/^[•·*\-]\s*/,'').replace(/\s+/g,' ').trim();
      if(clean.length<20) continue;scanned++;
      if(items.length>=12) continue;
      // ClawFeed curates Twitter/X, HN and RSS; key on content so repeats de-duplicate.
      items.push(event('ClawFeed','ai',{sourceId:`cf:${clean.slice(0,140)}`,title:clean.slice(0,200),url:'https://clawfeed.kevinhe.io/',publishedAt:null,evidence:clean.slice(0,1900)}));
    }
  }
  return {items,scanned};
}
// AINews moved from news.smol.ai to Latent Space; the daily "[AINews]" post is
// the same AI Twitter/Discord/Reddit roundup, and its body carries the original
// posts as links. This reads the "AI Twitter Recap" section and emits ONE EVENT
// PER TWEET with url = the tweet itself, so a reader clicks through to the post
// that said it rather than to a digest that mentions it. (The old news.smol.ai
// feed stopped at 2026-09-10; the recap continues on Latent Space.)
async function ainews() {
  const posts=parseFeed(await request('https://www.latent.space/feed')).filter(i=>/\[AINews\]/i.test(i.title));
  const STATUS=/^https?:\/\/(?:x|twitter)\.com\/[^/]+\/status\/\d+/;
  const items=[];let scanned=0;
  for(const post of posts.slice(0,2)){
    const html=await request(post.url,'text',{'User-Agent':'Mozilla/5.0 (compatible; AntistRadar/1.0)'});
    const from=html.search(/id="[^"]*twitter[^"]*recap[^"]*"/i);
    if(from<0) continue;
    const to=html.search(/id="[^"]*reddit[^"]*recap[^"]*"/i);
    const $=cheerio.load(html.slice(from, to>from?to:from+80000));
    const seen=new Set();
    const push=(a)=>{
      const href=$(a).attr('href')||'';
      if(!STATUS.test(href)||seen.has(href)) return;
      seen.add(href);
      const li=$(a).closest('li');
      const text=(li.length?li.text():$(a).parent().text()).replace(/\s+/g,' ').trim();
      scanned++;
      if(text.length<40||items.length>=6) return;
      items.push(event('AINews','ai',{sourceId:href,title:text.slice(0,220),url:href,publishedAt:post.publishedAt||null,evidence:text.slice(0,1900)}));
    };
    // One tweet per theme (h2 subsection) rather than the first N of the lead
    // story: the recap opens with a dozen tweets about the same launch, and a
    // board fed twelve versions of one story is a board with one card.
    const subs=$('h2').toArray();
    if(subs.length) for(const h2 of subs) push($(h2).nextUntil('h2').find('a[href]').filter((_,a)=>STATUS.test($(a).attr('href')||'')).first().get(0));
    else $('a[href]').each((_,a)=>push(a));
  }
  return {items,scanned};
}
// X2RSS (RapidAPI) turns an X advanced-search query into RSS whose items link to
// the original post. `min_faves` is what makes it "the tweets people actually
// engaged with" instead of a firehose. Needs a RapidAPI key; the source is only
// registered when X2RSS_API_KEY is set, so a missing key leaves no red badge.
async function x2rss() {
  const key=process.env.X2RSS_API_KEY;
  if(!key) throw new Error('X2RSS_API_KEY unset');
  const queries=[['ai','(AI OR OpenAI OR Anthropic OR LLM OR GPT) min_faves:1000 -filter:replies'],['tech','(Nvidia OR semiconductor OR datacenter OR chip) min_faves:500 -filter:replies']];
  const items=[];let scanned=0;
  for(const [category,q] of queries){
    const xml=await request(`https://x2rss.p.rapidapi.com/rss?query=${encodeURIComponent(q)}`,'text',{'X-RapidAPI-Key':key,'X-RapidAPI-Host':'x2rss.p.rapidapi.com'});
    const all=parseFeed(xml);scanned+=all.length;
    items.push(...all.slice(0,6).map(x=>event('X2RSS',category,{...x,sourceId:x.url})));
  }
  return {items,scanned};
}
async function stocks() {
  const tickers=['^GSPC','NVDA','7203.T'];
  const items=[];let scanned=0;
  for(const s of tickers){
    const r=await feed('Yahoo Finance','stocks',`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(s)}&region=US&lang=en-US`);
    scanned+=r.scanned;items.push(...r.items.slice(0,3));
  }
  return {items,scanned};
}
// Bridge for topics whose primary source has no usable feed (e-Stat needs an API
// key, UR blocks bots). Google News is a labelled secondary aggregator; the
// reader is sent to the publisher, and primary sources are preferred when added.
async function gnews(source,category,query) {
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
  const all=parseFeed(await request(url));
  return {scanned:all.length,items:all.slice(0,8).map(x=>event(source,category,{...x,sourceId:x.url}))};
}
async function marketwatch() {
  const r=await feed('MarketWatch','stocks','https://feeds.content.dowjones.io/public/rss/mw_topstories');
  const JUNK=/personal-finance|lifestyle|columnist|dear-quentin|on-my-late-husbands|wedding|relationship|restaurant/i;
  return {scanned:r.scanned,items:r.items.filter(i=>!JUNK.test(i.url)&&!JUNK.test(i.title))};
}
export const FEEDS=[
  {name:'GitHub Releases',url:'https://docs.github.com/en/rest/releases/releases',collect:releases},
  {name:'ClawFeed',url:'https://clawfeed.kevinhe.io/',collect:clawfeed},
  // X has no open API, so the only way to read where AI news actually breaks is
  // through something that already scrapes it. These are windows into X, tiered
  // 'x' in lib/source-tier.mjs. AINews links to the original posts; X2RSS is an
  // engagement-ranked search (needs a RapidAPI key); ClawFeed rewrites the same
  // tweets into prose without links, so it is weighted down rather than removed.
  {name:'AINews',url:'https://www.latent.space/',collect:ainews},
  ...(process.env.X2RSS_API_KEY?[{name:'X2RSS',url:'https://x2rss.p.rapidapi.com/',collect:x2rss}]:[]),
  {name:'Techmeme',url:'https://www.techmeme.com/',collect:()=>feed('Techmeme','tech','https://www.techmeme.com/feed.xml')},
  {name:'The Verge',url:'https://www.theverge.com/rss/index.xml',collect:()=>feed('The Verge','tech','https://www.theverge.com/rss/index.xml')},
  {name:'Ars Technica',url:'https://feeds.arstechnica.com/arstechnica/index',collect:()=>feed('Ars Technica','tech','https://feeds.arstechnica.com/arstechnica/index')},
  {name:'TechCrunch',url:'https://techcrunch.com/feed/',collect:()=>feed('TechCrunch','tech','https://techcrunch.com/feed/')},
  {name:'Engadget',url:'https://www.engadget.com/rss.xml',collect:()=>feed('Engadget','tech','https://www.engadget.com/rss.xml')},
  {name:'9to5Mac',url:'https://9to5mac.com/feed/',collect:()=>feed('9to5Mac','tech','https://9to5mac.com/feed/')},
  {name:'JVN',url:'https://jvn.jp/rss/',collect:()=>feed('JVN','tech','https://jvn.jp/rss/jvn.rdf')},
  {name:'e-Gov',url:'https://public-comment.e-gov.go.jp/',collect:policies},
  {name:'JGrants',url:'https://developers.digital.go.jp/documents/jgrants/api/',collect:grants},
  {name:'JASSO',url:'https://www.jasso.go.jp/ryugaku/',collect:()=>notices('JASSO','japan-life','https://www.jasso.go.jp/ryugaku/',/\/(news\/|ryugaku\/.+\/event\/|ryugaku\/.+\/admission)/)},
  {name:'Kokusen',url:'https://www.kokusen.go.jp/mimamori/mj_mglist.html',collect:()=>notices('Kokusen','japan-life','https://www.kokusen.go.jp/mimamori/mj_mglist.html',/\/mj_mailmag\/mj-shinsen\d+\.html$/)},
  {name:'Bank of Japan',url:'https://www.boj.or.jp/rss/whatsnew.xml',collect:()=>feed('Bank of Japan','stocks','https://www.boj.or.jp/rss/whatsnew.xml')},
  {name:'Cointelegraph',url:'https://cointelegraph.com/rss',collect:()=>feed('Cointelegraph','crypto','https://cointelegraph.com/rss')},
  {name:'Decrypt',url:'https://decrypt.co/feed',collect:()=>feed('Decrypt','crypto','https://decrypt.co/feed')},
  {name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/',collect:()=>feed('CoinDesk','crypto','https://www.coindesk.com/arc/outboundfeeds/rss/')},
  {name:'MarketWatch',url:'https://feeds.content.dowjones.io/public/rss/mw_topstories',collect:marketwatch},
  {name:'Yahoo Finance',url:'https://feeds.finance.yahoo.com/rss/2.0/headline',collect:stocks},
  {name:'BBC World',url:'https://feeds.bbci.co.uk/news/world/rss.xml',collect:()=>feed('BBC World','geopolitics','https://feeds.bbci.co.uk/news/world/rss.xml')},
  {name:'Al Jazeera',url:'https://www.aljazeera.com/xml/rss/all.xml',collect:()=>feed('Al Jazeera','geopolitics','https://www.aljazeera.com/xml/rss/all.xml')},
  {name:'DW World',url:'https://rss.dw.com/rdf/rss-en-world',collect:()=>feed('DW World','geopolitics','https://rss.dw.com/rdf/rss-en-world')},
  {name:'Google News · 在留',url:'https://news.google.com/rss/search',collect:()=>gnews('Google News · 在留','japan-residence','在留資格 OR 出入国在留管理庁 OR 在留手続')},
  {name:'Google News · UR/住宅',url:'https://news.google.com/rss/search',collect:()=>gnews('Google News · UR/住宅','japan-life','UR賃貸 OR 公営住宅 募集')},
  // Christianity desk. The wires carry the big church stories but the religion
  // specialists carry the ones a reader who follows the church actually wants,
  // so the board is fed from both: these feeds (prefill 'christianity') plus
  // whatever the general sources file under it after classification.
  {name:'Religion News Service',url:'https://religionnews.com/',collect:()=>feed('Religion News Service','christianity','https://religionnews.com/feed/',undefined,5)},
  {name:'Christianity Today',url:'https://www.christianitytoday.com/',collect:()=>feed('Christianity Today','christianity','https://www.christianitytoday.com/feed/',undefined,5)},
  {name:'Vatican News',url:'https://www.vaticannews.va/',collect:()=>feed('Vatican News','christianity','https://www.vaticannews.va/en.rss.xml',undefined,5)},
  {name:'Crux',url:'https://cruxnow.com/',collect:()=>feed('Crux','christianity','https://cruxnow.com/feed',undefined,5)},
  {name:'キリスト新聞',url:'https://christianpress.jp/',collect:()=>feed('キリスト新聞','christianity','https://christianpress.jp/feed/',undefined,5)},
];
// The X pipes overlap by design: AINews and ClawFeed both summarise the same
// tweets, and ClawFeed's copy links to its own homepage instead of the post.
// When both carry the story, the one a reader can click through to wins and the
// other is dropped, so the pool is not spent on two copies of one story.
//
// Matching is deliberately narrow: only CAPITALISED Latin words count (Firecrawl,
// Opus, Alexandria), because a proper noun is the one thing the same story keeps
// across two languages. Lowercase generics ("agent", "model", "data") are
// stripped — matching on those merged unrelated stories in testing.
const X_TOKEN_STOP=new Set(['the','this','that','these','those','with','from','into','over','after','before','when','what','which','while','their','there','then','than','also','more','most','some','such','launch','launches','release','releases','report','reports','says','said','using','gets','make','makes','new','via','week','today','first','next','best','top','list','price','speed','cost','model','models','openai','anthropic','google','meta','microsoft','apple','nvidia','claude','gpt','chatgpt','gemini','llm','api','ai','agent','agents','data','million','billion','series','round','raises','raised','announces','announced']);
export function distinctiveTokens(title){
  const out=new Set();
  for(const m of String(title||'').matchAll(/[A-Z][A-Za-z0-9.+-]{2,}/g)){
    const t=m[0].toLowerCase();
    if(!X_TOKEN_STOP.has(t))out.add(t);
  }
  return out;
}
export function dropDownstreamXDuplicates(items,winner='AINews',loser='ClawFeed'){
  const covered=new Set();
  for(const it of items) if(it&&it.source===winner) for(const t of distinctiveTokens(it.title)) covered.add(t);
  if(!covered.size) return items;
  return items.filter(it=>{
    if(!it||it.source!==loser) return true;
    for(const t of distinctiveTokens(it.title)) if(covered.has(t)) return false;
    return true;
  });
}
export async function collectFeeds() {
  return Promise.all(FEEDS.map(async f=>{
    const fetchedAt=new Date().toISOString();
    try {const d=await f.collect();return {name:f.name,url:f.url,fetchedAt,status:d.items.length?'ok':'quiet',...d};}
    catch(e) {return {name:f.name,url:f.url,fetchedAt,status:'unavailable',items:[],scanned:0,error:e.message};}
  }));
}
