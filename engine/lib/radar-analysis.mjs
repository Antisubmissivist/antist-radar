import config from '../crucix.config.mjs';
import {createLLMProvider} from './llm/index.mjs';
import {writeFile} from 'node:fs/promises';
import {selectionSystemPrompt,PERSONA_EN} from './persona.mjs';
import {sourceTier,TIER_RANK} from './source-tier.mjs';
import {judgeEdition} from './radar-judge.mjs';

const chunk=(a,n)=>{const o=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o;};
const parseJson=t=>{const f=String(t||'').replace(/^```(?:json)?\s*|\s*```$/g,'').trim();const a=f.indexOf('{'),b=f.lastIndexOf('}');return JSON.parse(a>=0&&b>a?f.slice(a,b+1):f);};

function extractScoredItems(text){
  try{const j=parseJson(text);if(j&&Array.isArray(j.items))return j.items;}catch{}
  const items=[];
  const objRegex=/\{[^{}]*\}/g;
  let block;
  while((block=objRegex.exec(text))!==null){
    const idM=block[0].match(/"id"\s*:\s*"([^"]+)"/);
    const scoreM=block[0].match(/"score"\s*:\s*(\d+)/);
    if(idM&&scoreM)items.push({id:idM[1],score:Number(scoreM[1])});
  }
  return items;
}

// Pre-selection: score every candidate for the reader persona, then take the top
// 3 per board deterministically (fill from the freshness pool).
async function selectByPersona(provider,pool){
  if(!pool.length)return [];
  try{
    const r=await provider.complete(selectionSystemPrompt(),JSON.stringify(pool.map(e=>({id:e.id,category:e.category,source:e.source,title:e.title,evidence:(e.evidence||'').slice(0,180)}))),{maxTokens:12000,timeout:180000});
    const items=extractScoredItems(r.text);
    const byId=new Map(pool.map(e=>[e.id,e]));const scored=[];
    for(const row of items){const id=String((row&&row.id)||'');const e=byId.get(id);if(e&&!scored.includes(e)){e.score=Math.max(0,Math.min(100,Math.round(Number(row&&row.score)||0)));scored.push(e);}}
    // Proximity to where the news broke is part of relevance, so it is scored,
    // not bolted on after. For AI, X is the primary source — the labs and
    // builders post there first and outlets rewrite it hours later — so an
    // X-origin item outranks a media rewrite of that same item. It is a bonus
    // rather than a hard sort on purpose: a 40-point tweet must still not bury
    // a 90-point residency rule change (55 vs 90), but a 70-point original
    // post now beats the 78-point article about it (85 vs 78).
    const TIER_BONUS={x:15,primary:8,media:0,data:0};
    for(const e of scored){
      e.tier=sourceTier(e.source);
      e.rank=Math.min(100,(e.score||0)+(TIER_BONUS[e.tier]||0));
    }
    scored.sort((x,y)=>(y.rank-x.rank)||(TIER_RANK[x.tier]-TIER_RANK[y.tier]));
    const per=new Map();const capped=[];
    const push=(e)=>{const n=per.get(e.category)||0;if(n>=3)return;per.set(e.category,n+1);capped.push(e);};
    const MIN_RELEVANCE=35;
    for(const e of scored){if((e.score||0)>=MIN_RELEVANCE)push(e);}
    console.error('[radar] tiers picked: '+JSON.stringify(capped.reduce((m,e)=>((m[e.tier]=(m[e.tier]||0)+1),m),{})));
    console.error(`[radar] persona scored ${scored.length}, capped ${capped.length}/${pool.length}`);
    return capped;
  }catch(e){console.error('[radar] persona selection failed:',e.message);return [];}
}
function roundRobin(sorted,limit){const byCat=new Map();for(const e of sorted){const a=byCat.get(e.category)||[];if(a.length<5)a.push(e);byCat.set(e.category,a);}const lists=[...byCat.values()].filter(l=>l.length);const out=[];while(out.length<limit&&lists.some(l=>l.length)){for(const l of lists){if(out.length>=limit)break;if(l.length)out.push(l.shift());}}return out;}

const ITEM_SYS=`あなたは日本語・英語・中国語の編集者です。与えられた候補だけを扱い、各言語の読者に自然な独立した文章を書きます。出力は JSON のみ。
- 与えられた候補 ID を EACH 言語版に必ず一度ずつ、与えられた順序どおりに含める。ID を捏造しない。
- 資料にない事実を足さない。ja は日本語のみ、en は英語のみ、zh は簡体字中国語のみ。混ぜない。
- title ≤100 文字、summary・audience・unknowns ≤160 文字、action ≤300 文字。
- ⬛ audienceは【このニュースが当てはまる「状況」】だけを書く（例：「四月に給付金が更新される留学生」）。国籍・民族・居住地・年齢層などの属性ラベルは禁止。
- ⬛ unknownsは【この記事に具体的に欠けている情報】のみ。汎用の注意書き（「適用条件を確認してください」等）は禁止。書くべき具体的な欠落がなければ "" （空文字列）。
- 数字・金額・日付・バージョンは、与えられた資料（evidence）に直接明記されている場合のみ記述可（推測や捏造は厳禁）。action（本站评价）には数字を入れない。
- action は「本站评价」: 最も合う一つの視点（現代世俗人文主義／逃避主義／AI本主義）を選び、2–4 文の純粋な評価を書く。命令・助言・行動指示は禁止。生活に即した比喩を一つ。視点名は書かない。
- action には【反証可能な判断】か【具体的な帰結】のどちらかを必ず含める。どちらも書けなければ "" （空文字列）。空欄は常識論より価値が高い。
- 読者像（選定と語調のためだけに使う。本文に絶対に書かない）: ${PERSONA_EN}
Return {"ja":{"items":[{"id":"...","title":"...","summary":"...","audience":"...","action":"...","unknowns":"..."}]},"en":{same shape},"zh":{same shape}}`;

const DIGEST_SYS=`次の見出し一覧から、日本語・英語・中国語で短い総括を書く。各 ≤240 文字、数字・金額・日付なし。JSON のみ: {"ja":"...","en":"...","zh":"..."}`;
const FORECAST_SYS=`最新の市場クオート（markets）と、直近の重要ニュース催化剤（catalysts: 銘柄やマクロに関連する最新の出来事）を結びつけ、暗号資産を最大1つ・株式/指数を最大1つ、因果関係に基づく明確な方向性仮説を作る。
【ルール】
1. 必ず catalysts の中にある実際のニュース・出来事（空売り開示、規制法案、金利・インフレ動向、AI/テック地殻変動、地政学など）を直接の根拠として銘柄を選び、rationale で言及すること。催化剤と無関係な根拠のない当て推量は禁止。
2. 確率（probability）: 強い催化剤（大口の空売り開示、法的規制、重要政策変更など）がある場合は 0.65〜0.82 の高い確信度を設定。中程度のセンチメントの場合は 0.55〜0.64 を設定。0.51 の固定は厳禁。
3. horizonDays: 3〜14（通常7）。
4. direction: "above" または "below"（基准値に対して上回るか下回るか）。
5. ⛔【超重要】rationale 内には半角・全角の数字（0-9、０-９）を一切含めないこと（数字を入れると検閲器でリジェクトされます。「基准値を下回る」「大幅な売り圧力」「調整局面」など言葉で表現すること）。ja/en/zhの3言語必須。
6. symbol: 提供された markets 配列に含まれる symbol 文字列（例: "BTC-USD", "ETH-USD", "NVDA", "CL=F" など）をそのまま使用すること。
JSON のみ: {"forecasts":[{"symbol":"NVDA","direction":"below","probability":0.74,"horizonDays":7,"rationale":{"ja":"...","en":"...","zh":"..."}}]}`;

// Fields the reader is better off not seeing than seeing filled with filler.
//
// The persona exists to SELECT stories and pitch tone. It is not a fact about
// any particular story, and it leaked: on 2026-09-13 twelve of twenty-one
// English cards answered "who does this affect" with "Young Chinese readers in
// Tokyo" — wrong for this site's audience and useless as an answer.
const PERSONA_LEAK=/chinese|中国人|中国读者|華人|在日中国|中文读者|reader persona|读者画像|読者像/i;

// "What remains unknown" earns a line only when it names what THIS story is
// missing. Generic caution filled 11 of 21 cards, which trains readers to skip
// the field entirely.
const GENERIC_UNKNOWN=/(individual )?(eligibility|applicability).{0,40}(not been established|unclear|unknown)|have not been established|verify the official conditions|適用(条件|可否)[はが]?(不明|未確認)|資格.{0,6}不明|尚未确认.{0,6}(资格|适用)|适用性.{0,6}未(确认|确定)|请(核对|确认)(原文|官方)/i;


/**
 * Blank the three soft fields when they carry no information.
 *
 * Duplicate detection is the honest part: a sentence repeated across cards is
 * boilerplate by definition, whatever it says. Judging whether a single
 * "Editor's take" is vacuous is NOT something code can do reliably, so that
 * constraint lives in the prompt and this only catches repeats and stubs.
 */
function scrubFields(lanes){
  const stats={personaLeak:0,genericUnknown:0,duplicate:0,tooShort:0};
  const txt=v=>typeof v==='string'?v.trim():'';
  const LANGS=['ja','en','zh'];
  const FIELDS=['audience','unknowns','action'];

  // Duplicate counts are per language (the same idea repeats as a different
  // sentence in each), but blanking is applied across all three: the judge now
  // rejects a field that is present in one edition and blank in another.
  const dupes={};
  for(const l of LANGS){
    dupes[l]={};
    for(const f of FIELDS){
      const m=new Map();
      for(const it of lanes[l]||[]){const v=txt(it&&it[f]);if(v)m.set(v,(m.get(v)||0)+1);}
      dupes[l][f]=m;
    }
  }

  const byId=new Map();
  for(const l of LANGS)for(const it of lanes[l]||[]){
    if(!it||!it.id)continue;
    const row=byId.get(it.id)||{};row[l]=it;byId.set(it.id,row);
  }

  for(const row of byId.values()){
    for(const f of FIELDS){
      let kill='';
      for(const l of LANGS){
        const v=txt(row[l]&&row[l][f]);
        if(!v){kill=kill||'missing';continue;}
        if(f==='audience'&&PERSONA_LEAK.test(v))kill=kill||'personaLeak';
        else if(f==='unknowns'&&GENERIC_UNKNOWN.test(v))kill=kill||'genericUnknown';
        else if(v.length<12)kill=kill||'tooShort';
        else if((dupes[l][f].get(v)||0)>1)kill=kill||'duplicate';
      }
      if(!kill)continue;
      if(stats[kill]!==undefined)stats[kill]++;
      for(const l of LANGS)if(row[l])row[l][f]='';
    }
  }

  if(Object.values(stats).some(Boolean))console.log(JSON.stringify({event:'scrubbed-filler',...stats}));
  return lanes;
}
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
  // Candidate pool (all eligible changed events across boards; 70 cap to prevent model JSON truncation),
  // scored by the persona; the code then takes the top 3 per board.
  const pool=sorted.slice(0,70);
  const picked=await selectByPersona(provider,pool);
  const candidateSymbols=['BTC-USD','ETH-USD','SOL-USD','^GSPC','^IXIC','^N225','CL=F','GC=F','NVDA','MSFT','GOOGL','META','AVGO','TSM','AMD','PLTR','SMH','7203.T','6758.T'];
  const freshMarkets=markets.filter(q=>Number.isFinite(q.price)&&q.price>0&&Date.now()-Date.parse(q.at)<5*86400000&&candidateSymbols.includes(q.symbol));
  const candidates=picked.length?picked:roundRobin(sorted,21);
  // The fallback path skips persona scoring, so tier is stamped here for every
  // candidate regardless of how it was chosen.
  for(const c of candidates)if(!c.tier)c.tier=sourceTier(c.source);
  const catalysts=candidates
    .filter(c=>['stocks','crypto','ai','tech','geopolitics'].includes(c.category))
    .slice(0,10)
    .map(c=>({
      category:c.category,
      title:typeof c.title==='object'?(c.title.zh||c.title.en||Object.values(c.title)[0]):String(c.title||''),
      evidence:String(c.evidence||'').slice(0,250)
    }));
  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const [lanes,dig,fc]=await Promise.all([
        runItems(provider,candidates),
        (async()=>{for(let t=1;t<=2;t++){try{const r=await provider.complete(DIGEST_SYS,JSON.stringify(candidates.map(e=>({title:typeof e.title==='object'?(e.title.zh||e.title.en||Object.values(e.title)[0]):e.title,category:e.category}))),{maxTokens:8000,timeout:120000});const j=parseJson(r.text);if(j&&typeof j.ja==='string'&&typeof j.en==='string'&&typeof j.zh==='string')return j;}catch(e){console.error('[radar] digest attempt',t,'failed:',e.message);}}return null;})(),
        (async()=>{for(let t=1;t<=2;t++){try{const r=await provider.complete(FORECAST_SYS,JSON.stringify({markets:freshMarkets,catalysts}),{maxTokens:6000,timeout:120000});const j=parseJson(r.text);if(j&&Array.isArray(j.forecasts))return j;}catch(e){console.error('[radar] forecast attempt',t,'failed:',e.message);}}return null;})(),
      ]);
      const have=new Set(lanes.en.map(i=>i&&i.id));
      const missing=candidates.filter(c=>!have.has(c.id));
      if(missing.length)throw new Error('Incomplete analysis: '+missing.length+' of '+candidates.length+' candidates missing');
      // Drop "no content" cards: the model states the material lacks usable detail.
      const NOCONTENT=/没有(提供|可读)|看不见内容|未提供更多|细节(尚|还)未|尚未(确认|明确)|正文不完整|无法(读取|确认|获取|证实)|信息不足|内容不完整|確認できません|確認できない|詳細は未|本文が不完全|insufficient (evidence|information)|no further details|not (yet )?(confirmed|available|known)|incomplete|unreadable|cannot be (confirmed|determined)/i;
      const okInfo=r=>r&&!NOCONTENT.test([r.summary&&r.summary.zh,r.summary&&r.summary.ja,r.summary&&r.summary.en].filter(Boolean).join(' '));
      const drop=new Set(lanes.en.filter(r=>!okInfo(r)).map(r=>r&&r.id).filter(Boolean));
      if(drop.size){for(const l of ['ja','en','zh'])lanes[l]=lanes[l].filter(r=>r&&!drop.has(r.id));console.log(JSON.stringify({event:'dropped-no-content',count:drop.size,ids:[...drop]}));}
      scrubFields(lanes);
      const editionData={ja:{digest:dig&&dig.ja,items:lanes.ja},en:{digest:dig&&dig.en,items:lanes.en},zh:{digest:dig&&dig.zh,items:lanes.zh},forecasts:(fc&&fc.forecasts)||[]};
      await writeFile('runs/analysis-response.json',JSON.stringify({attempt,editionData}));
      const judged=judgeEdition(editionData,events,markets);
      if(!judged.ok)throw new Error('Judge rejected: '+judged.errors.slice(0,3).join(' | '));
      return {...judged.result,usage:null};
    }catch(e){lastError=e;console.error(`[radar] analysis attempt ${attempt}/3 rejected: ${e.message}`);}
  }
  throw lastError;
}
