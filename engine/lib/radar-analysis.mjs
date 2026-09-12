import config from '../crucix.config.mjs';
import {createLLMProvider} from './llm/index.mjs';
import {writeFile} from 'node:fs/promises';
import {selectionSystemPrompt,PERSONA_EN} from './persona.mjs';
import {judgeEdition} from './radar-judge.mjs';

const chunk=(a,n)=>{const o=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o;};
const parseJson=t=>{const f=String(t||'').replace(/^```(?:json)?\s*|\s*```$/g,'').trim();const a=f.indexOf('{'),b=f.lastIndexOf('}');return JSON.parse(a>=0&&b>a?f.slice(a,b+1):f);};

// Pre-selection: score every candidate for the reader persona, then take the top
// 3 per board deterministically (fill from the freshness pool).
async function selectByPersona(provider,pool){
  if(!pool.length)return [];
  try{
    const r=await provider.complete(selectionSystemPrompt(),JSON.stringify(pool.map(e=>({id:e.id,category:e.category,source:e.source,title:e.title,evidence:(e.evidence||'').slice(0,180)}))),{maxTokens:12000,timeout:180000});
    const j=parseJson(r.text);
    const byId=new Map(pool.map(e=>[e.id,e]));const scored=[];
    for(const row of (Array.isArray(j&&j.items)?j.items:[])){const id=String((row&&row.id)||'');const e=byId.get(id);if(e&&!scored.includes(e)){e.score=Math.max(0,Math.min(100,Math.round(Number(row&&row.score)||0)));scored.push(e);}}
    scored.sort((x,y)=>(y.score||0)-(x.score||0));
    const per=new Map();const capped=[];
    const push=(e)=>{const n=per.get(e.category)||0;if(n>=3)return;per.set(e.category,n+1);capped.push(e);};
    for(const e of scored)push(e);
    for(const e of pool){if(capped.includes(e))continue;if(e.score===undefined)e.score=0;push(e);}
    console.error(`[radar] persona scored ${scored.length}, capped ${capped.length}/${pool.length}`);
    return capped;
  }catch(e){console.error('[radar] persona selection failed:',e.message);return [];}
}
function roundRobin(sorted,limit){const byCat=new Map();for(const e of sorted){const a=byCat.get(e.category)||[];if(a.length<5)a.push(e);byCat.set(e.category,a);}const lists=[...byCat.values()].filter(l=>l.length);const out=[];while(out.length<limit&&lists.some(l=>l.length)){for(const l of lists){if(out.length>=limit)break;if(l.length)out.push(l.shift());}}return out;}

const ITEM_SYS=`あなたは日本語・英語・中国語の編集者です。与えられた候補だけを扱い、各言語の読者に自然な独立した文章を書きます。出力は JSON のみ。
- 与えられた候補 ID を EACH 言語版に必ず一度ずつ、与えられた順序どおりに含める。ID を捏造しない。
- 資料にない事実を足さない。ja は日本語のみ、en は英語のみ、zh は簡体字中国語のみ。混ぜない。
- title ≤100 文字、summary・audience・unknowns ≤160 文字、action ≤300 文字。title 以外の叙述に数字・金額・日付を入れない。
- action は「本站评价」: 最も合う一つの視点（現代世俗人文主義／逃避主義／AI本主義）を選び、2–4 文の純粋な評価を書く。命令・助言・行動指示は禁止。生活に即した比喩を一つ。視点名は書かない。
- 読者像: ${PERSONA_EN}
Return {"ja":{"items":[{"id":"...","title":"...","summary":"...","audience":"...","action":"...","unknowns":"..."}]},"en":{same shape},"zh":{same shape}}`;

const DIGEST_SYS=`次の見出し一覧から、日本語・英語・中国語で短い総括を書く。各 ≤240 文字、数字・金額・日付なし。JSON のみ: {"ja":"...","en":"...","zh":"..."}`;
const FORECAST_SYS=`新しく取得した市場クオートだけを使い、暗号資産を最大1つ・株式/指数を最大1つ、実験的な方向性仮説を作る。rationale は数字なし。JSON のみ: {"forecasts":[{"symbol":"...","direction":"above or below","probability":0.51,"horizonDays":7,"rationale":{"ja":"...","en":"...","zh":"..."}}]}`;

// Fan-out with bounded concurrency and per-batch retries; every batch must succeed
// (the caller also checks coverage) so a board never silently loses its items.
async function runItems(provider,candidates){
  const batches=chunk(candidates,3);
  const lanes={ja:[],en:[],zh:[]};
  const pending=batches.slice();
  const merge=(res)=>{for(const l of ['ja','en','zh']){const items=res[l]&&res[l].items;if(Array.isArray(items))lanes[l].push(...items);}};
  async function worker(){
    while(pending.length){
      const b=pending.shift();
      let ok=false;
      for(let t=1;t<=3&&!ok;t++){
        try{
          const r=await provider.complete(ITEM_SYS,JSON.stringify({candidates:b.map(e=>({id:e.id,category:e.category,source:e.source,title:e.title,evidence:(e.evidence||'').slice(0,800),stage:e.stage,unknowns:e.unknowns}))}),{maxTokens:20000,timeout:240000});
          const j=parseJson(r.text);
          if(j&&j.en&&Array.isArray(j.en.items)&&j.ja&&j.zh){const ids=new Set(j.en.items.map(i=>i&&i.id));if(b.every(e=>ids.has(e.id))){merge(j);ok=true;break;}}
          throw new Error('bad shape or incomplete');
        }catch(e){console.error('[radar] batch attempt',t,'failed:',e.message);}
      }
      if(!ok)console.error('[radar] batch gave up:',b.map(e=>e.id).join(','));
    }
  }
  const conc=Math.max(1,Math.min(3,batches.length));
  await Promise.all(Array.from({length:conc},()=>worker()));
  return lanes;
}

export async function analyseRadar(events,markets){
  const provider=createLLMProvider({...config.llm,provider:process.env.RADAR_LLM_PROVIDER||config.llm.provider,model:process.env.RADAR_LLM_MODEL||config.llm.model});if(!provider?.isConfigured)throw new Error('Analysis provider unavailable');
  const sorted=[...events].sort((a,b)=>Date.parse(b.publishedAt||b.fetchedAt)-Date.parse(a.publishedAt||a.fetchedAt));
  // Whole candidate pool (all eligible changed events across boards; 120 safety cap),
  // scored by the persona; the code then takes the top 3 per board.
  const pool=sorted.slice(0,120);
  const picked=await selectByPersona(provider,pool);
  const candidates=picked.length?picked:roundRobin(sorted,21);
  const freshMarkets=markets.filter(q=>Date.now()-Date.parse(q.at)<3600000&&['BTC-USD','ETH-USD','SOL-USD','^GSPC','^IXIC','^N225','NVDA','MSFT','GOOGL','AVGO','TSM','7203.T'].includes(q.symbol));
  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const [lanes,dig,fc]=await Promise.all([
        runItems(provider,candidates),
        (async()=>{for(let t=1;t<=2;t++){try{const r=await provider.complete(DIGEST_SYS,JSON.stringify(candidates.map(e=>({title:e.title,source:e.source,category:e.category}))),{maxTokens:3000,timeout:120000});const j=parseJson(r.text);if(j&&typeof j.ja==='string'&&typeof j.en==='string'&&typeof j.zh==='string')return j;}catch(e){console.error('[radar] digest attempt',t,'failed:',e.message);}}return null;})(),
        (async()=>{for(let t=1;t<=2;t++){try{const r=await provider.complete(FORECAST_SYS,JSON.stringify({markets:freshMarkets}),{maxTokens:3000,timeout:120000});const j=parseJson(r.text);if(j&&Array.isArray(j.forecasts))return j;}catch(e){console.error('[radar] forecast attempt',t,'failed:',e.message);}}return null;})(),
      ]);
      const have=new Set(lanes.en.map(i=>i&&i.id));
      const missing=candidates.filter(c=>!have.has(c.id));
      if(missing.length)throw new Error('Incomplete analysis: '+missing.length+' of '+candidates.length+' candidates missing');
      // Drop "no content" cards: the model states the material lacks usable detail.
      const NOCONTENT=/没有提供|未提供更多|细节(尚|还)未|尚未(确认|明确)|正文不完整|无法读取|无法确认|无法获取|信息不足|内容不完整|確認できません|確認できない|詳細は未|本文が不完全|insufficient (evidence|information)|no further details|not (yet )?(confirmed|available|known)|incomplete|unreadable|cannot be (confirmed|determined)/i;
      const okInfo=r=>r&&!NOCONTENT.test([r.summary&&r.summary.zh,r.summary&&r.summary.ja,r.summary&&r.summary.en].filter(Boolean).join(' '));
      const drop=new Set(lanes.en.filter(r=>!okInfo(r)).map(r=>r&&r.id).filter(Boolean));
      if(drop.size){for(const l of ['ja','en','zh'])lanes[l]=lanes[l].filter(r=>r&&!drop.has(r.id));console.log(JSON.stringify({event:'dropped-no-content',count:drop.size,ids:[...drop]}));}
      const editionData={ja:{digest:dig&&dig.ja,items:lanes.ja},en:{digest:dig&&dig.en,items:lanes.en},zh:{digest:dig&&dig.zh,items:lanes.zh},forecasts:(fc&&fc.forecasts)||[]};
      await writeFile('runs/analysis-response.json',JSON.stringify({attempt,editionData}));
      const judged=judgeEdition(editionData,events,markets);
      if(!judged.ok)throw new Error('Judge rejected: '+judged.errors.slice(0,3).join(' | '));
      return {...judged.result,usage:null};
    }catch(e){lastError=e;console.error(`[radar] analysis attempt ${attempt}/3 rejected: ${e.message}`);}
  }
  throw lastError;
}
