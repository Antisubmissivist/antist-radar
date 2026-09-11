import * as cheerio from 'cheerio';
const urls=['https://www.jasso.go.jp/ryugaku/','https://www.kokusen.go.jp/mimamori/mj_mglist.html','https://www.moj.go.jp/isa/index','https://www.ur-net.go.jp/chintai/kanto/tokyo/result/','https://www.boj.or.jp/','https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true'];
await Promise.all(urls.map(async url=>{try{
  const r=await fetch(url,{signal:AbortSignal.timeout(20000)});const raw=await r.text();
  if(url.includes('greenhouse')){const d=JSON.parse(raw);console.log(JSON.stringify({url,status:r.status,count:d.jobs?.length,sample:d.jobs?.filter(j=>/Japan|Tokyo|Remote/.test(j.location?.name)).slice(0,3).map(j=>({id:j.id,title:j.title,location:j.location,url:j.absolute_url,updated_at:j.updated_at}))}));return;}
  const doc=cheerio.load(raw);
  const links=doc('a[href],link[href]').map((_,e)=>({text:doc(e).text().trim().slice(0,110),url:new URL(doc(e).attr('href'),url).href})).get();
  console.log(JSON.stringify({url,status:r.status,links:links.filter(l=>/rss|rdf|\.xml|2026|募集|新着|お知らせ|トラブル|空室|物件/.test(l.url+' '+l.text)).slice(0,28)}));
}catch(e){console.log(JSON.stringify({url,error:e.message}));}}));
