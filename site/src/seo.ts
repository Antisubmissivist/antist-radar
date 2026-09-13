export const ORIGIN='https://radar.antist.ai';
export const languages=['ja','en','zh'] as const;
export type Locale=typeof languages[number];
export const titles={ja:'Antist Radar — 変化を、判断に。',en:'Antist Radar — From signals to decisions.',zh:'Antist Radar — 看见变化，形成判断。'};
export const descriptions={ja:'日本と世界の一次情報、暮らしの選択肢、検証できる予測。根拠と更新時刻を公開する独立レーダー。',en:'An independent radar for Japan and the world. Primary sources, practical decisions and accountable forecasts, with evidence and timestamps.',zh:'面向日本与世界的独立信息雷达。一手信源、生活选择与可验证判断，每条信息附依据和时间。'};

/**
 * JSON-LD for the page head.
 *
 * Two things Google cannot infer from our markup: that ja/en/zh are one work in
 * three languages, and that the homepage is a dated list of items rather than a
 * static brochure. `dateModified` carries the snapshot time, so a page that
 * updates hourly stops looking stale in search.
 *
 * Serialised with `<` escaped so a headline containing markup cannot close the
 * script tag.
 */
export function jsonLd(l:Locale,path:string,opts:{modified?:string|null;items?:{name:string;url:string}[]}={}){
  const url=`${ORIGIN}${path}`;
  const publisher={'@type':'Organization',name:'Antist',url:ORIGIN};
  const graph:Record<string,unknown>[]=[
    {'@type':'WebSite','@id':`${ORIGIN}/#website`,url:ORIGIN,name:'Antist Radar',inLanguage:l,description:descriptions[l],publisher},
    {'@type':'WebPage','@id':`${url}#page`,url,name:titles[l],description:descriptions[l],inLanguage:l,isPartOf:{'@id':`${ORIGIN}/#website`},
      ...(opts.modified?{dateModified:opts.modified}:{})},
  ];
  if(opts.items?.length)graph.push({'@type':'ItemList','@id':`${url}#items`,itemListOrder:'https://schema.org/ItemListOrderDescending',
    numberOfItems:opts.items.length,
    itemListElement:opts.items.map((it,i)=>({'@type':'ListItem',position:i+1,name:it.name,url:it.url}))});
  return JSON.stringify({'@context':'https://schema.org','@graph':graph}).replace(/</g,'\\u003c');
}
