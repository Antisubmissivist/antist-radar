// Judge: deterministic acceptance test for a model-generated edition. It does
// NOT trust the model — it re-checks every field against the contract, the
// supplied evidence IDs and the language rules. The caller retries on rejection
// and, after bounded retries, aborts publication (the site then keeps the last
// good snapshot), so a weak model cannot publish malformed content.

import {LANGS,multilingual} from './radar-contract.mjs';
import {validateEditorial} from './radar-editorial.mjs';

const CONTAM=/[\uac00-\ud7af]|本周|事业|半导体|主办/;
const FIELDS=['title','summary','audience','action','unknowns'];
// These three may be dropped entirely when the model has nothing specific to
// say. An empty slot beats a sentence that is identical on every card.
const OPTIONAL=new Set(['audience','action','unknowns']);

export function judgeEdition(editionData,events,markets){
  const errors=[];
  const digest=Object.fromEntries(LANGS.map(l=>[l,editionData?.[l]?.digest]));
  const items=(editionData?.en?.items||[]).map(row=>({
    id:row?.id,
    ...Object.fromEntries(FIELDS.map(k=>[k,Object.fromEntries(LANGS.map(l=>[l,editionData?.[l]?.items?.find(i=>i.id===row?.id)?.[k]]))])),
  }));
  const lookup=new Map(events.map(e=>[e.id,e]));const selected=[];
  for(const row of items){
    const original=lookup.get(row.id);
    if(!original){errors.push('unknown evidence id '+row.id);continue;}
    if(selected.some(e=>e.id===row.id)){errors.push('duplicate evidence id '+row.id);continue;}
    let bad=false;
    const evText=`${original.title} ${original.evidence}`;
    for(const k of FIELDS){
      try{multilingual(row[k]);validateEditorial(row[k],{title:k==='title',evidence:k==='action'?'':evText,optional:OPTIONAL.has(k)});if(CONTAM.test(row[k].ja))throw new Error('ja contamination');}
      catch(e){errors.push(`${k}[${row.id}]: ${e.message}`);bad=true;}
    }
    if(!bad)selected.push({...original,title:row.title,summary:row.summary,audience:row.audience,action:row.action,unknowns:row.unknowns});
  }
  if(!selected.length)errors.push('empty analysis');
  try{multilingual(digest);validateEditorial(digest);if(CONTAM.test(digest.ja))throw new Error('ja digest contamination');}
  catch(e){errors.push('digest: '+e.message);}
  // Forecasts are per-board and optional: a bad one is dropped, never fatal.
  const forecasts=[];
  for(const f of (editionData?.forecasts||[])){
    const targetSymbol=f?.symbol;
    const q=markets.find(q=>(q.symbol===targetSymbol||q.symbol===`${targetSymbol}-USD`||q.symbol===`${targetSymbol}=F`||`${q.symbol}-USD`===targetSymbol)&&Number.isFinite(q.price)&&q.price>0&&Date.now()-Date.parse(q.at)<5*86400000);
    if(!q||!['above','below'].includes(f.direction)||!(f.probability>0&&f.probability<1))continue;
    if(forecasts.some(x=>x.symbol===q.symbol))continue;
    try{multilingual(f.rationale);validateEditorial(f.rationale);if(CONTAM.test(f.rationale.ja))throw new Error('contamination');}catch{continue;}
    const horizon=Math.min(30,Math.max(1,Math.round(Number(f.horizonDays)||1)));
    const createdAt=new Date().toISOString();const dueAt=new Date(Date.now()+horizon*86400000).toISOString();const above=f.direction==='above';
    const d=dueAt.slice(0,10);
    forecasts.push({id:`${createdAt.slice(0,10)}:${q.symbol}`,createdAt,dueAt,symbol:q.symbol,baseline:q.price,direction:f.direction,probability:f.probability,
      claim:{
        ja:`${d}までに（${horizon}日間）：${q.symbol} は基準値 ${q.price} を${above?'上回る':'下回る'}見通し。`,
        en:`By ${d} (${horizon}d): ${q.symbol} projected to trade ${above?'above':'below'} baseline ${q.price}.`,
        zh:`截至 ${d}（${horizon}天内）：${q.symbol} 预计${above?'突破或站稳':'跌破'}基准价 ${q.price}。`
      },rationale:f.rationale,evidence:[q.source]});
  }
  return {ok:errors.length===0,errors,result:{digest,events:selected,forecasts}};
}
