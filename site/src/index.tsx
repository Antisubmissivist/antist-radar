import {Hono} from 'hono';
import {html} from 'hono/html';
import {publicSnapshot,resolveForecast} from '../../engine/lib/radar-contract.mjs';
import {ORIGIN,languages,titles,descriptions,type Locale,jsonLd} from './seo';
// Tier is a pure function of the source name, so it is computed at render time
// rather than read from the row. Archived events predate the field and would
// otherwise show no badge, making the same source look different by age.
import {sourceTier} from '../../engine/lib/source-tier.mjs';
import {eventTerms,pickThread,commonTerms,parseTerms,serializeTerms,WINDOW_DAYS} from '../../engine/lib/story-thread.mjs';
import {sendDigest,buildMarkdown,selectBoard} from './delivery';
import {getMarkets,setWatchlist,searchSymbols} from './markets';
type Bindings=Env & {RADAR_INGEST_TOKEN:string;TELEGRAM_BOT_TOKEN?:string;TELEGRAM_CHAT_ID?:string;GH_DISPATCH_TOKEN?:string;TG_WEBHOOK_SECRET?:string};
type Snapshot=ReturnType<typeof publicSnapshot>;
const app=new Hono<{Bindings:Bindings}>();
const KEY='radar:public';
const BOARDS=['ai','tech','japan-residence','japan-life','geopolitics','crypto','stocks'] as const;
const STRIP=['BTC-USD','ETH-USD','SOL-USD','^GSPC','^IXIC','^N225','NVDA','^VIX'];
const words={
  en:{tag:'Independent intelligence',hero:'Know what changed.',sub:'Decide what matters.',intro:'A considered view of Japan and the world. Evidence first, useful signals, and predictions that stay on the record.',brief:'The briefing',signals:'Signals',markets:'Markets',editLayout:'Edit layout',addSymbol:'Add symbol…',done:'Done',hint:'Search a symbol to add · drag to reorder · hide or remove in edit mode',all:'All',ai:'AI',tech:'Tech',"japan-residence":'Residency & rules',"japan-life":'Japan · everyday life',geopolitics:'Geopolitics',crypto:'Crypto',stocks:'Stocks',ledger:'Prediction ledger',sources:'Source health',stale:'Data is stale. Check the original before acting.',empty:'The first verified briefing is being prepared.',search:'Search signals…',audience:'Who it affects',action:'Editor\u2019s take',unknowns:'What remains unknown',evidence:'Read the evidence',original:'Original source',disclaimer:'Experimental forecast, not investment advice. The first fresh observation after the deadline determines the result.',due:'Resolves after',prob:'Probability',open:'Open',hit:'Hit',miss:'Miss',unresolved:'Unresolved',noForecast:'No forecast has been published yet.',noresults:'No matching signals.',method:'Method',methodText:'Public sources are checked, changes are deduplicated, and native editions are written from the same evidence. Selection is editorial and bounded, not an exhaustive feed. Unknown applicability stays unknown. No personal profiles are published.',healthy:'sources returned data',quiet:'quiet today (allowed to be empty)',before:'Published forecasts are immutable. Misses remain visible.',read:'Read the source',listen:'Listen',stop:'Stop',highSignal:'HIGH SIGNAL',latestNews:'NEW',radarEmpty:'Silent patrol active · No critical signals (≥ 60) in the past 7 days',viewArchive:'View archive',historyCount:'records',generated:'AI-assisted analysis · primary-source verification required',overview:'Overview',more:'View all',archive:'All news',back:'Back',older:'Older',newer:'Newer',bhint:'Drag to reorder · hide or show topics',editBoards:'Edit topics',subscribe:'Subscribe to the Telegram brief',subintro:'Get one rich daily brief via your own Telegram bot — the day\u2019s news across 7 topics plus forecasts and today\u2019s smallest actions.',subtoken:'Bot token',sublang:'Language',subtime:'Time (JST)',subboards:'Topics (none = all)',subgo:'Register',subcmd:'Commands: /brief now · /topics ai,crypto · /time 8 · /stop · /help',subopen:'Open @Antist_monitor_bot',subprivacy:'Privacy: we never collect your bot token. Settings live only in your own Telegram session; others cannot view or change them. Send /delete to erase everything.',threadSpan:'{n} steps over {d} days',threadDay:'{n} steps since yesterday',threadToday:'{n} steps today',partial:'Some cards failed verification this cycle and were dropped rather than published.',scoreScale:'Relevance 0-100, scored against a fixed rubric: 90+ systemic change, 70-89 a clear action with a deadline, 40-69 routine movement. Below 35 is discarded.',tier_x:'X',tier_primary:'PRIMARY',tier_media:'PRESS',tierWhy_x:'Originates on X, where AI news breaks first. X has no open API, so this reaches us through a scraper — the pipe is second-hand, the source is not.',tierWhy_primary:'The institution publishing its own decision.',tierWhy_media:'Reporting about something that happened elsewhere.',deadline:'due',page:'Page'},
  ja:{tag:'独立インテリジェンス',hero:'変化を捉える。',sub:'判断につなげる。',intro:'日本と世界を根拠から読み解く。役立つ変化と、結果を検証できる予測を。',brief:'今回の見立て',signals:'注目の変化',markets:'マーケット',editLayout:'表示を編集',addSymbol:'銘柄を追加…',done:'完了',hint:'銘柄を検索して追加 · ドラッグで並べ替え · 編集モードで非表示/削除',all:'すべて',ai:'AI',tech:'テック',"japan-residence":'在留・制度',"japan-life":'日本での暮らし',geopolitics:'地政学',crypto:'暗号資産',stocks:'株式',ledger:'予測の記録',sources:'情報源の状態',stale:'情報が古くなっています。行動の前に原文を確認してください。',empty:'検証済みの初回ブリーフィングを準備中です。',search:'変化を検索…',audience:'関係する人',action:'本サイトの見解',unknowns:'未確認の点',evidence:'根拠を確認',original:'一次情報',disclaimer:'実験的な予測であり、投資助言ではありません。期限後の最初の新しい観測で判定します。',due:'判定開始',prob:'確率',open:'未決着',hit:'的中',miss:'不的中',unresolved:'判定保留',noForecast:'公開された予測はまだありません。',noresults:'該当する情報はありません。',method:'編集方針',methodText:'公開情報を確認し、変化を重複なく追跡。同じ根拠から各言語で独立した文章を作成します。全件収集ではなく、範囲を定めた編集です。適用条件が不明なら不明と示し、個人の情報は公開しません。',healthy:'データを返した情報源',quiet:'本日はデータなし（空で正常）',before:'公開した予測は書き換えません。外れた記録も残します。',read:'原文を読む',listen:'読み上げ',stop:'停止',highSignal:'重要シグナル',latestNews:'新着',radarEmpty:'監視哨は静かに哨戒中 · 過去7日間に 60点以上の重要シグナルはありません',viewArchive:'過去の記録を見る',historyCount:'件の記録',generated:'AI 支援による分析 · 一次情報で要確認',overview:'概要',more:'もっと見る',archive:'過去の記事',back:'戻る',older:'古い',newer:'新しい',bhint:'ドラッグで並べ替え · 表示/非表示',editBoards:'表示を編集',subscribe:'Telegram で毎日購読',subintro:'自分の Telegram bot で、その日のニュースを1通のリッチなブリーフにまとめて受け取る（7テーマ＋予測＋今日の最小アクション）。',subtoken:'Bot token',sublang:'言語',subtime:'配信時刻（JST）',subboards:'テーマ（未選択＝すべて）',subgo:'登録',subcmd:'コマンド：/brief · /topics ai,crypto · /time 8 · /stop · /help',subopen:'@Antist_monitor_bot を開く',subprivacy:'プライバシー：bot token は受け取りません。設定はあなたの Telegram セッション内でのみ有効で、他人は閲覧・変更できません。/delete で完全に削除できます。',threadSpan:'{d}日間で{n}件の続報',threadDay:'昨日から{n}件の続報',threadToday:'本日{n}件の続報',partial:'今回、検証を通らなかったカードは公開せずに除外しました。',scoreScale:'関連度 0-100。固定の基準で採点：90以上は制度を変える出来事、70-89 は期限のある明確な行動、40-69 は通常の動き。35未満は破棄。',tier_x:'X',tier_primary:'一次',tier_media:'報道',tierWhy_x:'AI の情報が最初に出る X が発信源。X に公開 API がないためスクレイパー経由で届く — 経路は二次だが、情報源は一次。',tierWhy_primary:'決定した機関自身が公表したもの。',tierWhy_media:'他所で起きたことについての報道。',deadline:'締切',page:'ページ'},
  zh:{tag:'独立情报',hero:'看见变化。',sub:'形成判断。',intro:'从依据出发观察日本与世界。先看证据，只看有用的变化，每次预判都留下可核查的记录。',brief:'本期判断',signals:'信号',markets:'行情',editLayout:'编辑布局',addSymbol:'添加代码…',done:'完成',hint:'搜索代码添加 · 拖拽排序 · 编辑模式可隐藏或删除',all:'全部',ai:'AI 圈',tech:'科技',"japan-residence":'日本在留',"japan-life":'日本生活',geopolitics:'地缘政治',crypto:'加密',stocks:'股票',ledger:'预测记账本',sources:'信源状态',stale:'数据已陈旧，采取行动前请核对原文。',empty:'正在准备首份经过核验的简报。',search:'搜索信号…',audience:'影响谁',action:'本站评价',unknowns:'尚未确认',evidence:'查看依据',original:'原始来源',disclaimer:'实验性预测，不构成投资建议。以到期后首次新报价判定结果。',due:'开始结算',prob:'概率',open:'待结算',hit:'命中',miss:'未命中',unresolved:'待核查',noForecast:'尚无已发布预测。',noresults:'没有匹配的信号。',method:'编辑方法',methodText:'核查公开信源、识别变化并去重，从同一组依据分别写成三语内容。这里是有范围的编辑筛选，不是全量信息流。资格不明就保留未知，不公开任何个人匹配资料。',healthy:'有数据的信源',quiet:'今日无数据（允许为空）',before:'预测发布后保留原文，未命中的记录也不会删除。',read:'阅读原文',listen:'朗读',stop:'停止',highSignal:'重点信号',latestNews:'最新',radarEmpty:'哨位静默巡航中 · 过去 7 天未捕获 ≥ 60 分硬核信号',viewArchive:'查看过往归档',historyCount:'条历史',generated:'AI 辅助分析 · 行动前请核对一手来源',overview:'概览',more:'查看更多',archive:'全部新闻',back:'返回',older:'更早',newer:'更新',bhint:'拖拽排序 · 显示或隐藏主题',editBoards:'编辑主题',subscribe:'订阅 Telegram 每日简报',subintro:'用你自己的 Telegram bot 接收，每天一条，汇总当日全部新闻（7 大主题 + 预测 + 今日最小动作）。',subtoken:'Bot token',sublang:'语言',subtime:'推送时间（JST）',subboards:'主题（不选 = 全部）',subgo:'注册',subcmd:'命令：/brief 立即发一份 · /topics ai,crypto · /time 8 · /stop · /help',subopen:'打开 @Antist_monitor_bot',subprivacy:'隐私：不收集你的 bot token；设置只存在于你自己的 Telegram 会话里，别人无法查看或更改；发送 /delete 可彻底删除全部数据。',threadSpan:'{d} 天内 {n} 条进展',threadDay:'昨日至今 {n} 条进展',threadToday:'今日 {n} 条进展',partial:'本轮有卡片未通过校验，已丢弃而非公开。',scoreScale:'相关度 0-100，按固定标尺打分：90 以上为制度性巨变，70-89 为有明确期限的行动，40-69 为常规动态。低于 35 直接丢弃。',tier_x:'X',tier_primary:'一手',tier_media:'报道',tierWhy_x:'源头在 X——AI 消息最先出现的地方。X 没有公开接口，只能经抓取站转运：管道是二手的，信源不是。',tierWhy_primary:'做出该决定的机构自己发布。',tierWhy_media:'对别处发生之事的报道。',deadline:'截止',page:'页'}
};
function formatDate(s:string,l:Locale){return new Intl.DateTimeFormat(l==='zh'?'zh-CN':l==='ja'?'ja-JP':'en-GB',{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s))+' JST';}
function RadarEmptyState({b,l,w,count}:{b:string;l:Locale;w:Record<string,string>;count:number}){
  return <div class="rounded-xl border border-dashed border-border/80 bg-muted/20 p-8 text-center flex flex-col items-center justify-center">
    <div class="relative flex items-center justify-center w-12 h-12 rounded-full bg-muted/60 mb-3 text-muted-foreground">
      <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" stroke-dasharray="2 3"/>
        <circle cx="12" cy="12" r="6" class="radar-pulse"/>
        <circle cx="12" cy="12" r="2" fill="currentColor"/>
        <path d="M12 12 L19 5" opacity="0.6"/>
      </svg>
    </div>
    <p class="text-sm font-medium text-foreground/80 tracking-tight">{w.radarEmpty}</p>
    <p class="text-xs text-muted-foreground mt-1.5">{(catName=>(catName||b))(w[b])} · {count} {w.historyCount}</p>
    <a href={`/${l}/c/${b}`} class="btn btn-outline btn-sm mt-4 gap-1.5">
      <span>{w.viewArchive}</span>
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </a>
  </div>;
}
type Step={id:string;source:string;url:string;at:string;title:any};

/**
 * The story so far.
 *
 * Collapsed, this is the whole point: a reader scanning the homepage sees at a
 * glance that a card is the fourth report of something, not an isolated
 * headline. The dots carry that before anything is clicked; expanding gives the
 * dated steps with the original link for each one.
 *
 * Native <details>, no client JS — the rest of the page renders server-side for
 * the same reason.
 */
function StoryRail({steps,currentId,l,w}:{steps:Step[];currentId:string;l:Locale;w:Record<string,string>}){
  if(!steps||steps.length<2)return null;
  const idx=steps.findIndex(s=>s.id===currentId);
  const days=Math.max(0,Math.round((Date.parse(steps[steps.length-1].at)-Date.parse(steps[0].at))/86400000));
  const key=days===0?'threadToday':days===1?'threadDay':'threadSpan';
  const label=w[key].replace('{n}',String(steps.length)).replace('{d}',String(days));
  return <details class="mt-3">
    <summary class="flex items-center gap-2 cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground transition-colors">
      <span class="flex items-center gap-[3px] shrink-0">
        {steps.map((s,i)=><span class="flex items-center gap-[3px]">
          {i>0?<span class="w-2.5 h-px bg-border"/>:null}
          <span class={i===idx?'w-[7px] h-[7px] rounded-full bg-primary':'w-[5px] h-[5px] rounded-full bg-muted-foreground/40'}/>
        </span>)}
      </span>
      <span class="truncate">{label}</span>
    </summary>
    <ol class="mt-3 ml-[3px] border-l border-border pl-4 space-y-3">
      {steps.map((s,i)=><li class="relative">
        <span class={`absolute -left-[21px] top-[5px] w-[7px] h-[7px] rounded-full ring-2 ring-background ${i===idx?'bg-primary':'bg-border'}`}/>
        <div class="text-[10px] text-muted-foreground tabular-nums">{formatDate(s.at,l)} · {s.source}</div>
        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" class={`text-xs leading-snug hover:underline ${i===idx?'font-medium':'text-muted-foreground'}`}>{s.title?.[l]||s.title?.en||''}</a>
      </li>)}
    </ol>
  </details>;
}

function EventCard({e,index,l,w,steps}:{e:any;index:number;l:Locale;w:Record<string,string>;steps?:Step[]}){
  const score=Number(e.score||0);
  const isHigh=score>=85;
  const tier=sourceTier(e.source);
  return <article data-event data-category={e.category} data-id={e.id} data-url={e.url} class={`card card-hover p-5 animate-in relative ${isHigh?'border-primary/40 shadow-xs':''}`}>
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <span class="badge badge-secondary">{w[e.category]||e.category}</span>
        {score>0?(
          <span class={`badge ${isHigh?'border-primary/50 text-foreground bg-primary/10 font-semibold':'badge-outline text-muted-foreground'} text-[10px] tabular-nums gap-1`}>
            {isHigh&&<span class="inline-block h-1.5 w-1.5 rounded-full bg-up live-dot"/>}
            <span title={w.scoreScale}>{score}</span>
            {isHigh&&<span>{w.highSignal}</span>}
          </span>
        ):(
          <span class="badge badge-outline text-muted-foreground text-[10px] tracking-wide">
            {w.latestNews||'NEW'}
          </span>
        )}
      </div>
      <span class="flex items-center gap-1.5 ml-3 min-w-0">
        {tier!=='data'?<span class={`badge text-[9px] tracking-wide shrink-0 ${tier==='x'?'border-primary/50 bg-primary/10 text-foreground font-semibold':'badge-outline text-muted-foreground'}`} title={w[`tierWhy_${tier}`]}>{w[`tier_${tier}`]}</span>:null}
        <span class="text-[11px] text-muted-foreground truncate">{e.source}</span>
      </span>
    </div>
    <a href={e.url} target="_blank" rel="noopener noreferrer" class="group block">
      <h3 data-tts-title class="font-semibold leading-snug group-hover:text-primary transition-colors flex items-baseline justify-between gap-2">
        <span>{e.title[l]} <span class="text-muted-foreground text-xs font-normal">↗</span></span>
        <span data-eq-slot class="hidden shrink-0 items-end gap-0.5 h-3.5 w-3 text-primary self-center"></span>
      </h3>
    </a>
    {(e.publishedAt||e.deadlineAt)&&<p class="text-[11px] text-muted-foreground mt-1.5">{e.publishedAt?formatDate(e.publishedAt,l):''}{e.publishedAt&&e.deadlineAt?' · ':''}{e.deadlineAt?((w.deadline||'due')+' '+formatDate(e.deadlineAt,l)):''}</p>}
    <p data-tts-summary class="text-sm text-muted-foreground mt-2 leading-relaxed">{e.summary[l]}</p>
    {e.action?.[l]?<div class="mt-4 rounded-lg border bg-muted/40 p-4"><p class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{w.action}</p><p data-tts-review class="text-sm leading-relaxed">{e.action[l]}</p></div>:null}
    <StoryRail steps={steps||[]} currentId={e.id} l={l} w={w}/>
    <details class="mt-4 text-xs text-muted-foreground"><summary class="cursor-pointer select-none">{w.evidence}</summary><dl class="mt-3 space-y-2 leading-relaxed">{e.audience?.[l]?<div><dt class="font-semibold text-foreground/80">{w.audience}</dt><dd>{e.audience[l]}</dd></div>:null}{e.unknowns?.[l]?<div><dt class="font-semibold text-foreground/80">{w.unknowns}</dt><dd>{e.unknowns[l]}</dd></div>:null}<div><dt class="font-semibold text-foreground/80">{w.original}</dt><dd>{e.evidence}</dd></div></dl><a href={e.url} target="_blank" rel="noopener noreferrer" class="inline-block mt-3 underline">{w.read}</a></details>
  </article>;
}
function ForecastCard({r,l,w}:{r:any;l:Locale;w:Record<string,string>}){
  const claim=JSON.parse(String(r.claim_json));
  const rationale=JSON.parse(String(r.rationale_json));
  const rawTitle=String(claim[l]||'');
  const cleanTitle=rawTitle.replace(/^到期后首次新报价中，/,'').replace(/^期限後の最初の新しい観測で/,'').replace(/^At the first fresh observation after the deadline,\s*/,'');
  return <div class="card p-5"><div class="flex items-center justify-between mb-4"><span class="badge badge-secondary">{w[String(r.status) as keyof typeof w]||r.status}</span><span class="text-xs text-muted-foreground tabular-nums">{String(r.created_at).slice(0,10)}</span></div><h3 data-tts-title class="font-semibold leading-relaxed">{cleanTitle}</h3><p data-tts-summary class="text-sm text-muted-foreground mt-2 leading-relaxed">{rationale[l]}</p><div class="grid grid-cols-2 gap-4 border-t mt-5 pt-4"><div><div class="text-[10px] text-muted-foreground">{w.prob}</div><div class="text-2xl font-semibold tabular-nums mt-0.5">{Math.round(Number(r.probability)*100)}%</div></div><div><div class="text-[10px] text-muted-foreground">{w.due}</div><div class="text-xs tabular-nums mt-1.5">{formatDate(String(r.due_at),l)}</div></div></div>{r.observed!=null&&<p class="text-xs tabular-nums mt-3">{r.symbol}: {r.observed} · {r.observation_at}</p>}</div>;
}
function Pagination({page,totalPages,makeHref,w}:{page:number;totalPages:number;makeHref:(p:number)=>string;w:Record<string,string>}){
  if(totalPages<=1)return null;
  const pages:(number|'ellipsis')[]=[];
  if(totalPages<=7){
    for(let i=1;i<=totalPages;i++)pages.push(i);
  }else{
    pages.push(1);
    if(page>3)pages.push('ellipsis');
    const start=Math.max(2,page-1);
    const end=Math.min(totalPages-1,page+1);
    for(let i=start;i<=end;i++){if(i>1&&i<totalPages)pages.push(i);}
    if(page<totalPages-2)pages.push('ellipsis');
    pages.push(totalPages);
  }
  return (
    <nav role="navigation" aria-label="pagination" class="mt-12 mx-auto flex w-full justify-center">
      <ul class="flex flex-wrap items-center gap-1.5 list-none p-0 m-0">
        <li>
          {page>1?(
            <a href={makeHref(page-1)} class="btn btn-outline btn-sm gap-1 pl-2.5" aria-label="Previous page">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              <span class="hidden sm:inline">{w.newer}</span>
            </a>
          ):(
            <span class="btn btn-outline btn-sm gap-1 pl-2.5 opacity-40 pointer-events-none" aria-disabled="true">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              <span class="hidden sm:inline">{w.newer}</span>
            </span>
          )}
        </li>
        {pages.map((p,idx)=>(
          <li key={idx}>
            {p==='ellipsis'?(
              <span class="flex h-8 w-8 items-center justify-center text-xs text-muted-foreground select-none" aria-hidden="true">…</span>
            ):(
              <a href={makeHref(p as number)} class={`btn btn-sm min-w-8 px-2.5 ${p===page?'btn-primary font-semibold shadow-xs':'btn-outline hover:bg-accent'}`} aria-current={p===page?'page':undefined}>
                {p}
              </a>
            )}
          </li>
        ))}
        <li>
          {page<totalPages?(
            <a href={makeHref(page+1)} class="btn btn-outline btn-sm gap-1 pr-2.5" aria-label="Next page">
              <span class="hidden sm:inline">{w.older}</span>
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </a>
          ):(
            <span class="btn btn-outline btn-sm gap-1 pr-2.5 opacity-40 pointer-events-none" aria-disabled="true">
              <span class="hidden sm:inline">{w.older}</span>
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
async function ledger(db:D1Database){return (await db.prepare('SELECT * FROM forecasts ORDER BY created_at DESC LIMIT 10').all()).results;}
async function settle(env:Bindings,s:Snapshot){
  const rows=(await env.DB.prepare("SELECT * FROM forecasts WHERE status='open' AND due_at<=? LIMIT 100").bind(new Date().toISOString()).all()).results;
  for(const r of rows){const result=resolveForecast({symbol:r.symbol,baseline:r.baseline,direction:r.direction,dueAt:r.due_at},s.markets);
    if(result)await env.DB.prepare("UPDATE forecasts SET status=?,observed=?,observation_at=?,resolved_at=? WHERE id=? AND status='open'").bind(result.status,result.observed,result.observationAt,result.resolvedAt,r.id).run();}
}
// Retain all historical events in D1 for subpage pagination; backup copy in events_archive.
const RETAIN_DAYS=10;
async function retain(env:Bindings){
  const cutoff=new Date(Date.now()-RETAIN_DAYS*86400000).toISOString();
  const cols='id,source,category,url,published_at,first_seen,last_seen,stage,deadline_at,change,title_json,summary_json,audience_json,action_json,unknowns_json,evidence,score';
  const cond="COALESCE(NULLIF(published_at,''),first_seen)<?";
  const a=await env.DB.prepare(`INSERT OR REPLACE INTO events_archive (${cols},archived_at) SELECT ${cols},? FROM events WHERE ${cond}`).bind(new Date().toISOString(),cutoff).run();
  return {archived:a.meta.changes,deleted:0,cutoff};
}
// GitHub's scheduled workflows are unreliable on new repos, so the Worker's own
// cron (reliable) dispatches the sweep when the snapshot goes stale.
async function dispatchSweep(env:Bindings){if(!env.GH_DISPATCH_TOKEN)return {ok:false,reason:'GH_DISPATCH_TOKEN unset'};try{const r=await fetch('https://api.github.com/repos/Antisubmissivist/antist-radar/actions/workflows/sweep.yml/dispatches',{method:'POST',headers:{Authorization:`Bearer ${env.GH_DISPATCH_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'antist-radar','Content-Type':'application/json'},body:JSON.stringify({ref:'main'})});return {ok:r.ok,status:r.status};}catch(e){return {ok:false,reason:String(e)};}}
function briefingText(s:Snapshot,l:Locale){const ev=s.events.slice(0,8);const lines=[`Antist Radar · ${formatDate(s.generatedAt,l)}`,'',s.digest[l],''];for(const e of ev){lines.push(`• ${e.title[l]}`,`  ${e.action[l]}`,`  ${e.url}`);}for(const f of (s.forecasts||[])){lines.push('',`Forecast: ${f.symbol} ${f.direction} ${Math.round(Number(f.probability)*100)}% (due ${f.dueAt.slice(0,10)})`);}return lines.join('\n');}
function rowToEvent(r:Record<string,unknown>):any{const j=(v:unknown)=>{try{return JSON.parse(String(v));}catch{return null;}};return {id:String(r.id),source:String(r.source),category:String(r.category),url:String(r.url),publishedAt:r.published_at?String(r.published_at):null,fetchedAt:String(r.first_seen),stage:String(r.stage||'announcement'),deadlineAt:r.deadline_at?String(r.deadline_at):null,title:j(r.title_json),summary:j(r.summary_json),audience:j(r.audience_json),action:j(r.action_json),unknowns:j(r.unknowns_json),evidence:String(r.evidence||''),change:String(r.change||'unchanged'),score:Number(r.score||0),threadId:r.thread_id?String(r.thread_id):null};}
// ---- Telegram self-serve subscribers ----
async function tgApi(token:string,method:string,body:unknown){try{const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});const j=await r.json() as Record<string,unknown>;if(!j.ok)console.log(JSON.stringify({event:'tg-api-fail',method,detail:j.description}));return j;}catch(e){console.log(JSON.stringify({event:'tg-api-error',method,error:String(e)}));return {ok:false,error:String(e)};}}
function newSecret(){return crypto.randomUUID().replace(/-/g,'');}
function normBoards(v:unknown){if(!Array.isArray(v))return [];return v.map(String).filter(b=>(BOARDS as readonly string[]).includes(b));}
async function latestSnapshot(env:Bindings){try{const list=await env.ARCHIVE.list({prefix:'snapshots/',limit:1000});const objs=((list.objects||[]) as {key:string;uploaded:string|Date}[]).slice().sort((a,b)=>new Date(b.uploaded).getTime()-new Date(a.uploaded).getTime());if(objs[0]){const o=await env.ARCHIVE.get(objs[0].key);if(o)return await o.json() as Snapshot;}}catch{}return env.MONITOR.get<Snapshot>(KEY,'json');}
// On-demand brief: rolling last 24h. Calendar-day windows are empty right after
// JST midnight (the day's news has not accumulated yet), which made /brief show 0.
// Same candidate set as the homepage (snapshot ∪ last-7-day archive) so the
// Telegram digest and the site always agree on which 3 items lead each board.
async function digestPayload(env:Bindings){const s=await latestSnapshot(env);const recent=await env.DB.prepare("SELECT * FROM events WHERE first_seen >= datetime('now','-7 days') ORDER BY COALESCE(published_at,first_seen) DESC LIMIT 200").all();const m=new Map<string,any>();for(const r of (recent.results||[]) as Record<string,unknown>[]){const e=rowToEvent(r);if(e&&e.id)m.set(e.id,e);}for(const e of (s?.events||[])){if(e&&e.id)m.set(e.id,e);}const fr=await ledger(env.DB);const forecasts=fr.slice(0,10).map(r=>({symbol:String(r.symbol),direction:r.direction==='above'?'above':'below',probability:Number(r.probability),dueAt:String(r.due_at),claim:JSON.parse(String(r.claim_json))}));return {generatedAt:(s&&s.generatedAt)||new Date().toISOString(),digest:(s&&s.digest)||null,events:Array.from(m.values()),forecasts};}
async function briefPayload(env:Bindings){const end=Date.now();const start=end-24*3600000;const s0=new Date(start).toISOString();const e0=new Date(end).toISOString();const ev=await env.DB.prepare('SELECT * FROM events WHERE first_seen>=? AND first_seen<? ORDER BY COALESCE(published_at,first_seen) DESC LIMIT 400').bind(s0,e0).all();const fcr=await env.DB.prepare('SELECT * FROM forecasts WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 20').bind(s0,e0).all();const s=await latestSnapshot(env);const forecasts=(fcr.results||[]).map(r=>({id:String(r.id),symbol:String(r.symbol),direction:r.direction==='above'?'above':'below',probability:Number(r.probability),dueAt:String(r.due_at),claim:JSON.parse(String(r.claim_json))}));return {generatedAt:new Date(end).toISOString(),digest:s?s.digest:null,events:(ev.results||[]).map(rowToEvent),forecasts,count:(ev.results||[]).length};}
async function dailyPayload(env:Bindings,date:string){const start=new Date(Date.parse(date+'T00:00:00+09:00')).toISOString();const end=new Date(Date.parse(date+'T00:00:00+09:00')+86400000).toISOString();const ev=await env.DB.prepare('SELECT * FROM events WHERE first_seen>=? AND first_seen<? ORDER BY COALESCE(published_at,first_seen) DESC LIMIT 400').bind(start,end).all();const fcr=await env.DB.prepare('SELECT * FROM forecasts WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 20').bind(start,end).all();let digest:unknown=null;try{const list=await env.ARCHIVE.list({prefix:'snapshots/'+date+'/',limit:200});const keys=((list.objects||[]) as {key:string}[]).map(o=>o.key).sort();const last=keys[keys.length-1];if(last){const obj=await env.ARCHIVE.get(last);if(obj){const j=await obj.json() as {digest?:unknown};digest=(j&&j.digest)?j.digest:null;}}}catch{}const forecasts=(fcr.results||[]).map(r=>({id:String(r.id),symbol:String(r.symbol),direction:r.direction==='above'?'above':'below',probability:Number(r.probability),dueAt:String(r.due_at),claim:JSON.parse(String(r.claim_json))}));return {date,generatedAt:date+'T00:00:00+09:00',digest,events:(ev.results||[]).map(rowToEvent),forecasts,count:(ev.results||[]).length};}
async function sendSubscriber(env:Bindings,sub:Record<string,unknown>,date:string){const boards=normBoards((()=>{try{return JSON.parse(String(sub.boards||'[]'));}catch{return [];}})());const p=await digestPayload(env);const md=buildMarkdown(p,String(sub.lang||'zh'),boards.length?boards:undefined);const token=/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(String(sub.token||''))?String(sub.token):String(env.TELEGRAM_BOT_TOKEN||'');const extra=sub.thread_id?{message_thread_id:Number(sub.thread_id)}:{};return tgApi(token,'sendRichMessage',{chat_id:String(sub.chat_id),...extra,rich_message:{markdown:md}});}
const TG_COMMANDS=[{command:'brief',description:'立即发送今日简报 · Today\u2019s brief now'},{command:'topics',description:'设置主题，如 /topics ai,crypto'},{command:'time',description:'设置推送小时，如 /time 8'},{command:'lang',description:'切换语言 · Language (zh|ja|en)'},{command:'stop',description:'停止推送 · Stop'},{command:'start',description:'恢复推送 · Resume'},{command:'help',description:'帮助 · Help'}];
function subHelp(sub:Record<string,unknown>,isStart?:boolean){const b=normBoards((()=>{try{return JSON.parse(String(sub.boards||'[]'));}catch{return [];}})());const sched=Number(sub.hour)>=0?('每天 **'+String(sub.hour)+':41 JST** 推送'):'当前为命令模式（不自动推送，用 `/time 8` 开启）';return [(isStart?'**订阅成功 ✅**':'**Antist Radar bot**'),'',sched+'，主题：'+(b.length?b.join(', '):'全部')+'，语言：'+String(sub.lang)+'（`/lang` 切换）','','你的设置只在本聊天里生效，别人无法更改。','**命令**','- `/brief` 立即发一份今日简报','- `/topics ai,crypto` 订阅这些主题','- `/time 8` 推送时间（0-23 JST）','- `/lang zh|ja|en` 切换语言','- `/stop` 暂停 · `/start` 恢复','- `/delete` 彻底删除你的订阅数据','- `/help` 帮助'].join('\n');}
function subTopics(){return '_'+(BOARDS as readonly string[]).join('_, _')+'_';}
const LANGS=['zh','ja','en'];const LANG_OK={zh:'✅ 已切换为中文。',ja:'✅ 日本語に切り替えました。',en:'✅ Language set to English.'};const LANG_USE={zh:'用法：/lang zh | ja | en',ja:'使い方：/lang ja | en | zh',en:'Usage: /lang en | ja | zh'};
function SiteHeader({l,w,cat}:{l:Locale;w:Record<string,string>;cat?:string}){const href=(lang:string)=>cat?`/${lang}/c/${cat}`:`/${lang}`;return <header class="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"><div class="mx-auto max-w-6xl h-16 px-4 md:px-6 flex items-center justify-between gap-4"><a href={`/${l}`} class="flex items-center gap-2 font-semibold tracking-tight"><span class="logo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><path d="M12 12 19 5"/><path d="M5.5 12a6.5 6.5 0 0 1 6.5-6.5"/><path d="M8.5 12a3.5 3.5 0 0 1 3.5-3.5"/><path d="M2.5 12a9.5 9.5 0 0 1 9.5-9.5" opacity=".5"/></svg></span><span>ANTIST<span class="text-muted-foreground font-normal"> / RADAR</span></span></a><nav class="hidden md:flex items-center gap-1"><a href={`/${l}`} class="navlink">{w.overview}</a><a href={`/${l}#markets`} class="navlink">{w.markets}</a><a href={`/${l}#ledger`} class="navlink">{w.ledger}</a><a href={`/${l}#sources`} class="navlink">{w.sources}</a></nav><div class="flex items-center gap-2"><div class="flex items-center rounded-lg bg-muted p-1">{languages.map(lang=><a href={href(lang)} class={`tab px-2.5 py-1 text-xs ${lang===l?'tab-active':''}`}>{lang.toUpperCase()}</a>)}</div><button data-theme class="btn btn-ghost btn-icon relative" aria-label="Toggle theme"><svg class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><svg class="absolute inset-0 m-auto h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg></button></div></div></header>;}
function SiteFooter({w}:{w:Record<string,string>}){return <footer class="border-t"><div class="mx-auto max-w-6xl px-4 md:px-6 py-10 grid md:grid-cols-[1.2fr_1fr] gap-8"><div><p class="text-sm font-semibold tracking-tight">ANTIST / RADAR.</p><p class="text-xs text-muted-foreground mt-3">Japan & the world. Independently observed.</p><p class="text-xs text-muted-foreground mt-4">© {new Date().getFullYear()} Antist · All rights reserved.</p><a class="text-xs text-muted-foreground underline mt-2 inline-block" href="https://github.com/Antisubmissivist/antist-radar">Source code · AGPL-3.0</a></div><div><h2 class="text-xs font-semibold mb-2">{w.method}</h2><p class="text-xs text-muted-foreground leading-relaxed">{w.methodText}</p></div></div></footer>;}
function pageHead(l:Locale,path:string,modified?:string|null){return <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>{titles[l]}</title><meta name="description" content={descriptions[l]}/><link rel="canonical" href={`${ORIGIN}${path}`}/>{languages.map(lang=><link rel="alternate" hreflang={lang} href={`${ORIGIN}${path.replace(`/${l}`,`/${lang}`)}`}/>)}<link rel="alternate" hreflang="x-default" href={`${ORIGIN}${path.replace(`/${l}`,'/en')}`}/><meta property="og:title" content={titles[l]}/><meta property="og:description" content={descriptions[l]}/><meta property="og:url" content={`${ORIGIN}${path}`}/><meta property="og:type" content="website"/><meta property="og:image" content={`${ORIGIN}/og.png`}/><meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/><meta name="twitter:card" content="summary_large_image"/><meta name="twitter:image" content={`${ORIGIN}/og.png`}/><meta name="theme-color" content="#0a0a0b"/><link rel="icon" type="image/png" sizes="512x512" href="/favicon-512.png"/><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"/><link rel="apple-touch-icon" href="/apple-touch-icon.png"/><link rel="stylesheet" href="/style.css"/><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(l,path,{modified})}}/>{html`<script>try{if((localStorage.getItem('radar-theme')||'dark')==='dark')document.documentElement.classList.add('dark')}catch{}</script>`}<script src="/app.js" defer/></head>;}
app.use('*',async(c,next)=>{await next();if(!c.res.headers.has('Cache-Control'))c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','strict-origin-when-cross-origin');c.header('X-Frame-Options','DENY');});
app.get('/',c=>c.redirect('/en',302));
app.get('/robots.txt',c=>c.text(`User-agent: *\nAllow: /\nDisallow: /api/ingest\nSitemap: ${ORIGIN}/sitemap.xml`));
// Sitemap carries every indexable path in all three languages, each with the
// snapshot time as <lastmod> and xhtml:link alternates so the three editions
// are read as one work. Without lastmod an hourly-updating site looks static.
app.get('/sitemap.xml',async c=>{
  const snap=await latestSnapshot(c.env).catch(()=>null);
  const lastmod=snap?.generatedAt||new Date().toISOString();
  const paths=['',...BOARDS.map(b=>`/c/${b}`),'/ledger'];
  const XH='xmlns:xhtml="http://www.w3.org/1999/xhtml"';
  const urls=paths.flatMap(suffix=>languages.map(l=>{
    const alts=languages.map(a=>`<xhtml:link rel="alternate" hreflang="${a}" href="${ORIGIN}/${a}${suffix}"/>`).join('')
      +`<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/en${suffix}"/>`;
    return `<url><loc>${ORIGIN}/${l}${suffix}</loc><lastmod>${lastmod}</lastmod>${alts}</url>`;
  })).join('');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ${XH}>${urls}</urlset>`,200,{'Content-Type':'application/xml'});
});
app.get('/api/public',async c=>{const s=await latestSnapshot(c.env);c.header('Cache-Control','no-store');return s?c.json(s):c.json({status:'pending'},503);});
app.get('/api/ledger',async c=>c.json({forecasts:await ledger(c.env.DB)}));
app.get('/api/markets',async c=>{const q=c.req.query('symbols');const symbols=q?q.split(',').map(x=>x.trim()).filter(Boolean):undefined;const m=await getMarkets(c.env,symbols);c.header('Cache-Control','no-store');return c.json(m);});
app.get('/api/symbols',async c=>{const q=(c.req.query('q')||'').trim();if(!q)return c.json({results:[]});c.header('Cache-Control','public, max-age=300');return c.json({results:await searchSymbols(q.slice(0,40))});});
app.get('/api/briefing',async c=>{const raw=c.req.query('lang')||'zh';const L=(languages as readonly string[]).includes(raw)?raw as Locale:'zh';const s=await latestSnapshot(c.env);if(!s)return c.json({status:'pending'},503);const events=s.events.slice(0,12).map(e=>({id:e.id,category:e.category,source:e.source,title:e.title[L],summary:e.summary?.[L]||'',action:e.action[L],audience:e.audience?.[L]||'',deadlineAt:e.deadlineAt||null,publishedAt:e.publishedAt||null,score:e.score||0,url:e.url}));const forecasts=(s.forecasts||[]).map(f=>({symbol:f.symbol,direction:f.direction,probability:f.probability,dueAt:f.dueAt,claim:f.claim[L]}));c.header('Cache-Control','no-store');if(c.req.query('format')==='text')return c.text(briefingText(s,L));return c.json({lang:L,updatedAt:s.generatedAt,digest:s.digest[L],events,forecasts,text:briefingText(s,L)});} );
app.post('/api/dispatch',async c=>{const expected=`Bearer ${c.env.RADAR_INGEST_TOKEN||''}`;if(!c.env.RADAR_INGEST_TOKEN||c.req.header('Authorization')!==expected)return c.json({ok:false},401);return c.json(await dispatchSweep(c.env));});
app.get('/api/state',async c=>{const expected=`Bearer ${c.env.RADAR_INGEST_TOKEN||''}`;if(!c.env.RADAR_INGEST_TOKEN||c.req.header('Authorization')!==expected)return c.json({ok:false},401);try{const obj=await c.env.ARCHIVE.get('state/decision-state.json');if(obj){c.header('Content-Type','application/json');c.header('Cache-Control','no-store');return c.body(await obj.text());}}catch{}return c.json({});});
app.post('/api/state',async c=>{const expected=`Bearer ${c.env.RADAR_INGEST_TOKEN||''}`;if(!c.env.RADAR_INGEST_TOKEN||c.req.header('Authorization')!==expected)return c.json({ok:false},401);try{const text=await c.req.text();JSON.parse(text);await c.env.ARCHIVE.put('state/decision-state.json',text,{httpMetadata:{contentType:'application/json'}});return c.json({ok:true});}catch(e){return c.json({ok:false,error:String(e)},400);}});
app.get('/api/digest',async c=>{const expected=`Bearer ${c.env.RADAR_INGEST_TOKEN||''}`;if(!c.env.RADAR_INGEST_TOKEN||c.req.header('Authorization')!==expected)return c.json({ok:false},401);const lang=(['ja','en','zh'].includes(String(c.req.query('lang')))?String(c.req.query('lang')):'zh') as Locale;const boards=normBoards((c.req.query('boards')||'').split(',').map(x=>x.trim()).filter(Boolean));const p=await digestPayload(c.env);const markdown=buildMarkdown(p,lang,boards.length?boards:undefined);c.header('Cache-Control','no-store');return c.json({ok:true,lang,events:p.events.length,markdown});});
app.get('/llms.txt',c=>c.text(['# Antist Radar API','','Independent Japan+world intelligence radar. Public, read-only JSON.','','GET /api/public            Full snapshot (schema 2): digest(ja/en/zh), events, markets, sources, forecasts','GET /api/briefing?lang=zh  Concise agent-first briefing (id, category, source, title, summary, action, deadlineAt, score, url)','GET /api/ledger            Published forecasts and their settled results','GET /api/markets?symbols=  Live quotes for any comma-separated Yahoo symbols','GET /api/symbols?q=        Symbol search (returns symbol, name, exchange)','','Write/Internal endpoints require Authorization: Bearer <token>:','POST /api/ingest  POST /api/digest  POST /api/watchlist  POST /api/dispatch  GET/POST /api/state','','Forecasts are experimental and not investment advice.'].join('\n'),200,{'Content-Type':'text/plain; charset=utf-8'}));
app.get('/api/events',async c=>{const cat=c.req.query('category');const limit=Math.min(100,Math.max(1,Number(c.req.query('limit'))||40));const page=Math.max(1,Number(c.req.query('page'))||1);const off=(page-1)*limit;const sql=cat?'SELECT * FROM events WHERE category=? ORDER BY COALESCE(published_at,first_seen) DESC LIMIT ? OFFSET ?':'SELECT * FROM events ORDER BY COALESCE(published_at,first_seen) DESC LIMIT ? OFFSET ?';const st=c.env.DB.prepare(sql);const res=await (cat?st.bind(cat,limit+1,off):st.bind(limit+1,off)).all();const rows=(res.results||[]);c.header('Cache-Control','no-store');return c.json({category:cat||null,page,hasMore:rows.length>limit,events:rows.slice(0,limit).map(rowToEvent)});});
app.post('/api/events/review',async c=>{const expected=`Bearer ${c.env.RADAR_INGEST_TOKEN||''}`;if(!c.env.RADAR_INGEST_TOKEN||c.req.header('Authorization')!==expected)return c.json({ok:false},401);const b=await c.req.json().catch(()=>null) as {updates?:unknown}|null;const ups=Array.isArray(b?.updates)?(b!.updates as Record<string,any>[]):[];const stmts=[];for(const u of ups){const id=String(u?.id||'');const act=u?.action;if(!id||!act||typeof act!=='object')continue;const a=Object.fromEntries(['ja','en','zh'].map(l=>[l,String(act[l]||'').slice(0,600)]));stmts.push(c.env.DB.prepare('UPDATE events SET action_json=? WHERE id=?').bind(JSON.stringify(a),id));}if(stmts.length)await c.env.DB.batch(stmts);return c.json({ok:true,updated:stmts.length});});
app.get('/api/daily',async c=>{const date=(c.req.query('date')||new Date(Date.now()+9*3600000).toISOString().slice(0,10));c.header('Cache-Control','no-store');return c.json(await dailyPayload(c.env,date));});
app.post('/api/subscribe',async c=>{const b=await c.req.json().catch(()=>null) as Record<string,unknown>|null;const token=String(b?.token||'').trim();if(!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token))return c.json({ok:false,reason:'invalid token format'},400);const me=await tgApi(token,'getMe',{});if(!me.ok)return c.json({ok:false,reason:'token rejected by Telegram',detail:me.description||me.error},400);const botUsername=String((me.result as Record<string,unknown>)?.username||'');const secret=newSecret();const ws=newSecret();const pair=secret.slice(0,6).toUpperCase();const lang=(['ja','en','zh'].includes(String(b?.lang))?String(b?.lang):'zh');const auto=(b?.auto!==false);const hour=auto?Math.min(23,Math.max(0,Number(b?.hour)||8)):-1;const boards=normBoards(b?.boards);const id=crypto.randomUUID();await c.env.DB.prepare('INSERT INTO subscribers (id,secret,token,bot_username,lang,hour,boards,active,created_at,webhook_secret,pair_code) VALUES (?,?,?,?,?,?,?,1,?,?,?)').bind(id,secret,token,botUsername,lang,hour,JSON.stringify(boards),new Date().toISOString(),ws,pair).run();const wh=await tgApi(token,'setWebhook',{url:`${ORIGIN}/api/tg/${secret}`,secret_token:ws,allowed_updates:['message'],drop_pending_updates:true});if(!wh.ok){await c.env.DB.prepare('DELETE FROM subscribers WHERE id=?').bind(id).run();return c.json({ok:false,reason:'could not set webhook',detail:wh.description||wh.error},502);}await tgApi(token,'setMyCommands',{commands:TG_COMMANDS});return c.json({ok:true,secret,pairCode:pair,botUsername,statusUrl:`${ORIGIN}/api/subscribe/${secret}`});});
app.get('/api/subscribe/:secret',async c=>{const r=await c.env.DB.prepare('SELECT bot_username,chat_id,lang,hour,boards,active,last_sent FROM subscribers WHERE secret=?').bind(c.req.param('secret')).first() as Record<string,unknown>|null;if(!r)return c.json({ok:false},404);let boards=[];try{boards=JSON.parse(String(r.boards||'[]'));}catch{}return c.json({ok:true,botUsername:r.bot_username,linked:!!r.chat_id,lang:r.lang,hour:r.hour,boards,active:!!r.active});});
app.post('/api/subscribe/:secret',async c=>{const secret=c.req.param('secret');const ex=await c.env.DB.prepare('SELECT * FROM subscribers WHERE secret=?').bind(secret).first() as Record<string,unknown>|null;if(!ex)return c.json({ok:false},404);const b=await c.req.json().catch(()=>null) as Record<string,unknown>|null;const lang=(['ja','en','zh'].includes(String(b?.lang))?String(b?.lang):String(ex.lang||'zh'));const hour=(b?.hour!=null?Math.min(23,Math.max(0,Number(b.hour))):Number(ex.hour||8));let boards;try{boards=JSON.parse(String(ex.boards||'[]'));}catch{boards=[];}if(b?.boards!=null)boards=normBoards(b.boards);await c.env.DB.prepare('UPDATE subscribers SET lang=?,hour=?,boards=? WHERE secret=?').bind(lang,hour,JSON.stringify(boards),secret).run();return c.json({ok:true,lang,hour,boards});});
app.post('/api/subscribe/:secret/delete',async c=>{const secret=c.req.param('secret');const ex=await c.env.DB.prepare('SELECT token FROM subscribers WHERE secret=?').bind(secret).first() as Record<string,unknown>|null;if(ex){await tgApi(String(ex.token),'deleteWebhook',{});await c.env.DB.prepare('DELETE FROM subscribers WHERE secret=?').bind(secret).run();}return c.json({ok:true});});
app.post('/api/tg/:secret',async c=>{try{
const rawSecret=c.req.param('secret');const isPublic=rawSecret==='public';
const u=await c.req.json().catch(()=>null) as Record<string,any>|null;const msg=u?.message||u?.edited_message;if(!msg)return c.json({ok:true});
const chatId=String(msg.chat?.id||'');const chatType=String(msg.chat?.type||'private');const threadId=msg.message_thread_id!=null?String(msg.message_thread_id):'';const chatTitle=String(msg.chat?.title||'');const fromId=String(msg.from?.id||'');const text=String(msg.text||'').trim();const parts=text.split(/\s+/);const cmd=(parts[0]||'').toLowerCase().replace(/@.*$/,'');const arg=parts[1]||'';const uid=Number(u?.update_id||0);
let sub:Record<string,any>|null=null;let token='';
if(isPublic){
if(c.req.header('x-telegram-bot-api-secret-token')!==String(c.env.TG_WEBHOOK_SECRET||''))return c.json({ok:true});
token=String(c.env.TELEGRAM_BOT_TOKEN||'');
const st=await c.env.DB.prepare('SELECT v FROM tg_state WHERE k=?').bind('last_update_id').first() as {v?:string}|null;
if(uid&&Number(st?.v||0)>=uid)return c.json({ok:true});
if(uid)await c.env.DB.prepare('INSERT INTO tg_state (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('last_update_id',String(uid)).run();
if(isPublic&&(chatType==='group'||chatType==='supergroup')){
  // In a group the bot reacts when addressed (@Antist_monitor_bot) or on a known
  // command. It then pins the daily digest to that exact topic (chat_id + thread_id).
  const KNOWN=['/start','/help','/brief','/time','/topics','/lang','/stop','/delete'];
  if(!text.toLowerCase().includes('@antist_monitor_bot')&&!KNOWN.includes(cmd))return c.json({ok:true});
  let g=await c.env.DB.prepare('SELECT * FROM subscribers WHERE chat_id=? AND IFNULL(thread_id,\'\')=?').bind(chatId,threadId).first() as Record<string,any>|null;
  if(!g){const id=crypto.randomUUID();await c.env.DB.prepare('INSERT INTO subscribers (id,secret,token,bot_username,chat_id,thread_id,chat_title,owner_user_id,lang,hour,boards,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)').bind(id,newSecret(),'Antist_monitor_bot','Antist_monitor_bot',chatId,threadId,chatTitle,fromId,'zh',8,'[]',new Date().toISOString()).run();g=await c.env.DB.prepare('SELECT * FROM subscribers WHERE id=?').bind(id).first() as Record<string,any>;}
  const extra=threadId?{message_thread_id:Number(threadId)}:{};
  if(cmd==='/brief'){await sendSubscriber(c.env,{...g,chat_id:chatId,token},new Date(Date.now()+9*3600000).toISOString().slice(0,10));}
  else if(cmd==='/start'||cmd==='/help'){await tgApi(token,'sendRichMessage',{chat_id:chatId,...extra,rich_message:{markdown:subHelp(g,cmd==='/start')}});}
  else if(cmd==='/time'){const h=Number(arg);if(Number.isInteger(h)&&h>=0&&h<=23){await c.env.DB.prepare('UPDATE subscribers SET hour=? WHERE id=?').bind(h,g.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,...extra,text:'\u23f0 每天约 '+h+':41 JST 在此话题推送'});}else await tgApi(token,'sendMessage',{chat_id:chatId,...extra,text:'用法: /time 8'});}
  else if(cmd==='/lang'){const L=String(arg||'').toLowerCase();if(LANGS.includes(L)){await c.env.DB.prepare('UPDATE subscribers SET lang=? WHERE id=?').bind(L,g.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,...extra,text:(LANG_OK as Record<string,string>)[L]});}else await tgApi(token,'sendMessage',{chat_id:chatId,...extra,text:LANG_USE.zh+' · '+LANG_USE.ja+' · '+LANG_USE.en});}
  else if(cmd==='/topics'){const nb=normBoards(text.split(/\s+/).slice(1).join(',').split(',').map(s=>s.trim()).filter(Boolean));if(nb.length){await c.env.DB.prepare('UPDATE subscribers SET boards=? WHERE id=?').bind(JSON.stringify(nb),g.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,...extra,text:'\u2705 '+nb.join(', ')});}else await tgApi(token,'sendRichMessage',{chat_id:chatId,...extra,rich_message:{markdown:'可选主题：'+subTopics()}});}
  else if(cmd==='/stop'){await c.env.DB.prepare('UPDATE subscribers SET active=0 WHERE id=?').bind(g.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,...extra,text:'已暂停 · 再次 @我 即可恢复'});}
  else if(cmd==='/delete'){await c.env.DB.prepare('DELETE FROM subscribers WHERE id=?').bind(g.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,...extra,text:'已删除。'});}
  else{await c.env.DB.prepare('UPDATE subscribers SET active=1,chat_title=?,lang=lang WHERE id=?').bind(chatTitle,g.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,...extra,text:'✅ 已设置。以后每天 08:00 JST 我会在这个话题里推送每日简报。\n可调整：/time 8 · /topics ai,crypto · /stop · /delete'});}
  return c.json({ok:true});
}
sub=await c.env.DB.prepare('SELECT * FROM subscribers WHERE owner_user_id=?').bind(fromId).first() as Record<string,any>|null;
if(!sub){if(cmd!=='/start'&&cmd!=='/brief'&&cmd!=='/help')return c.json({ok:true});const id=crypto.randomUUID();await c.env.DB.prepare('INSERT INTO subscribers (id,secret,token,bot_username,chat_id,owner_user_id,lang,hour,boards,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)').bind(id,newSecret(),'Antist_monitor_bot',chatId,fromId,'zh',8,'[]',new Date().toISOString()).run();sub=await c.env.DB.prepare('SELECT * FROM subscribers WHERE id=?').bind(id).first() as Record<string,any>;}
else if(chatId!==String(sub.chat_id))await c.env.DB.prepare('UPDATE subscribers SET chat_id=? WHERE id=?').bind(chatId,sub.id).run();
if(cmd==='/start'||cmd==='/help')await tgApi(token,'sendRichMessage',{chat_id:chatId,rich_message:{markdown:subHelp(sub,cmd==='/start')}});
else if(cmd==='/brief')await sendSubscriber(c.env,{...sub,chat_id:chatId,token},new Date(Date.now()+9*3600000).toISOString().slice(0,10));
else if(cmd==='/lang'){const L=String(arg||'').toLowerCase();if(LANGS.includes(L)){await c.env.DB.prepare('UPDATE subscribers SET lang=? WHERE id=?').bind(L,sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:(LANG_OK as Record<string,string>)[L]});}else await tgApi(token,'sendMessage',{chat_id:chatId,text:LANG_USE.zh+' · '+LANG_USE.ja+' · '+LANG_USE.en});}
else if(cmd==='/topics'){const nb=normBoards(text.split(/\s+/).slice(1).join(',').split(',').map(s=>s.trim()).filter(Boolean));if(nb.length){await c.env.DB.prepare('UPDATE subscribers SET boards=? WHERE id=?').bind(JSON.stringify(nb),sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:'\u2705 '+nb.join(', ')});}else await tgApi(token,'sendRichMessage',{chat_id:chatId,rich_message:{markdown:'可选主题：'+subTopics()}});}
else if(cmd==='/time'){const h=Number(arg);if(Number.isInteger(h)&&h>=0&&h<=23){await c.env.DB.prepare('UPDATE subscribers SET hour=? WHERE id=?').bind(h,sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:'\u23f0 每天约 '+h+':41 JST 推送'});}else await tgApi(token,'sendMessage',{chat_id:chatId,text:'用法: /time 8'});}
else if(cmd==='/stop'){await c.env.DB.prepare('UPDATE subscribers SET active=0 WHERE id=?').bind(sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:'已暂停 · /start 恢复'});}
else if(cmd==='/delete'){await c.env.DB.prepare('DELETE FROM subscribers WHERE id=?').bind(sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:'已删除。可随时 /start 重新订阅。'});}
}else{
sub=await c.env.DB.prepare('SELECT * FROM subscribers WHERE secret=?').bind(rawSecret).first() as Record<string,any>|null;if(!sub)return c.json({ok:true});
if(sub.webhook_secret&&c.req.header('x-telegram-bot-api-secret-token')!==String(sub.webhook_secret))return c.json({ok:true});
if(uid&&Number(sub.last_update_id||0)>=uid)return c.json({ok:true});if(uid)await c.env.DB.prepare('UPDATE subscribers SET last_update_id=? WHERE id=?').bind(uid,sub.id).run();
token=String(sub.token);
if(!sub.chat_id){if(cmd==='/start'&&arg&&arg.toUpperCase()===String(sub.pair_code||'')){await c.env.DB.prepare('UPDATE subscribers SET chat_id=?,owner_user_id=?,active=1 WHERE id=?').bind(chatId,fromId,sub.id).run();await tgApi(token,'sendRichMessage',{chat_id:chatId,rich_message:{markdown:subHelp({...sub,chat_id:chatId,owner_user_id:fromId},true)}});}else{await tgApi(token,'sendMessage',{chat_id:chatId,text:'请发送  /start '+String(sub.pair_code||'')+'  完成绑定'});}return c.json({ok:true});}
if(chatId!==String(sub.chat_id)||fromId!==String(sub.owner_user_id))return c.json({ok:true});
if(cmd==='/start'||cmd==='/help')await tgApi(token,'sendRichMessage',{chat_id:chatId,rich_message:{markdown:subHelp(sub,cmd==='/start')}});
else if(cmd==='/brief')await sendSubscriber(c.env,{...sub,chat_id:chatId},new Date(Date.now()+9*3600000).toISOString().slice(0,10));
else if(cmd==='/lang'){const L=String(arg||'').toLowerCase();if(LANGS.includes(L)){await c.env.DB.prepare('UPDATE subscribers SET lang=? WHERE id=?').bind(L,sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:(LANG_OK as Record<string,string>)[L]});}else await tgApi(token,'sendMessage',{chat_id:chatId,text:LANG_USE.zh+' · '+LANG_USE.ja+' · '+LANG_USE.en});}
else if(cmd==='/topics'){const nb=normBoards(text.split(/\s+/).slice(1).join(',').split(',').map(s=>s.trim()).filter(Boolean));if(nb.length){await c.env.DB.prepare('UPDATE subscribers SET boards=? WHERE id=?').bind(JSON.stringify(nb),sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:'\u2705 '+nb.join(', ')});}else await tgApi(token,'sendRichMessage',{chat_id:chatId,rich_message:{markdown:'可选主题：'+subTopics()}});}
else if(cmd==='/time'){const h=Number(arg);if(Number.isInteger(h)&&h>=0&&h<=23){await c.env.DB.prepare('UPDATE subscribers SET hour=? WHERE id=?').bind(h,sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:'\u23f0 每天约 '+h+':41 JST 推送'});}else await tgApi(token,'sendMessage',{chat_id:chatId,text:'用法: /time 8'});}
else if(cmd==='/stop'){await c.env.DB.prepare('UPDATE subscribers SET active=0 WHERE id=?').bind(sub.id).run();await tgApi(token,'sendMessage',{chat_id:chatId,text:'已暂停 · /start 恢复'});}
}
}catch{}return c.json({ok:true});});
app.post('/api/ingest',async c=>{
  const actual=c.req.header('Authorization')||'';const expected=`Bearer ${c.env.RADAR_INGEST_TOKEN||''}`;
  const hash=async(v:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
  const [a,b]=await Promise.all([hash(actual),hash(expected)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  if(!c.env.RADAR_INGEST_TOKEN||diff!==0)return c.json({ok:false},401);
  if(Number(c.req.header('Content-Length')||0)>700000)return c.json({ok:false},413);
  let s:Snapshot;try {const reader=c.req.raw.body?.getReader();if(!reader)return c.json({ok:false},400);const decoder=new TextDecoder();let raw='',size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>700000){await reader.cancel();return c.json({ok:false},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();s=publicSnapshot(JSON.parse(raw));}catch{return c.json({ok:false,reason:'invalid public payload'},400);}
  if(Math.abs(Date.now()-Date.parse(s.generatedAt))>7200000)return c.json({ok:false,reason:'stale publication'},409);
  const current=await c.env.MONITOR.get<Snapshot>(KEY,'json');
  if(current&&Date.parse(current.generatedAt)>Date.parse(s.generatedAt))return c.json({ok:false,reason:'out of order'},409);
  const key=`snapshots/${s.generatedAt.slice(0,10)}/${s.id}.json`;
  for(const f of (s.forecasts||[])){await c.env.DB.prepare('INSERT OR IGNORE INTO forecasts (id,created_at,due_at,symbol,baseline,direction,probability,claim_json,rationale_json,evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(f.id,f.createdAt,f.dueAt,f.symbol,f.baseline,f.direction,f.probability,JSON.stringify(f.claim),JSON.stringify(f.rationale),JSON.stringify(f.evidence)).run();}
  for(const f of (s.forecasts||[])){const r=await c.env.DB.prepare('SELECT * FROM forecasts WHERE id=?').bind(f.id).first();if(r){f.createdAt=String(r.created_at);f.dueAt=String(r.due_at);f.symbol=String(r.symbol);f.baseline=Number(r.baseline);f.direction=r.direction==='above'?'above':'below';f.probability=Number(r.probability);f.claim=JSON.parse(String(r.claim_json));f.rationale=JSON.parse(String(r.rationale_json));f.evidence=JSON.parse(String(r.evidence_json));}}
  await c.env.ARCHIVE.put(key,JSON.stringify(s),{httpMetadata:{contentType:'application/json'}});
  await settle(c.env,s);
  const nowIso=new Date().toISOString();

  // Assign each incoming event to a story thread. This happens here because the
  // engine cannot see history — D1 holds it. Assignment is append-only: the
  // ON CONFLICT clause below deliberately leaves thread_id and thread_terms
  // alone, so an event keeps the timeline it was first placed in.
  const since=new Date(Date.now()-WINDOW_DAYS*86400000).toISOString();
  const hist=await c.env.DB.prepare('SELECT thread_id,thread_terms,source,first_seen FROM events WHERE thread_id IS NOT NULL AND first_seen>=? ORDER BY first_seen DESC LIMIT 600').bind(since).all();
  const history=(hist.results||[]).map((r:any)=>({threadId:String(r.thread_id),terms:parseTerms(r.thread_terms),source:String(r.source),at:String(r.first_seen)}));
  const common=commonTerms(history);
  const threadOf=new Map<string,{id:string;terms:string}>();
  for(const e of (s.events||[])){
    const terms=eventTerms(e);
    // Later events in the same sweep can continue a thread opened earlier in it.
    const id=pickThread(terms,nowIso,history,common)||`t${e.id.slice(0,12)}`;
    threadOf.set(e.id,{id,terms:serializeTerms(terms)});
    history.push({threadId:id,terms,source:String(e.source||''),at:nowIso});
  }

  const evStmts=(s.events||[]).map(e=>c.env.DB.prepare('INSERT INTO events (id,source,category,url,published_at,first_seen,last_seen,stage,deadline_at,change,title_json,summary_json,audience_json,action_json,unknowns_json,evidence,score,thread_id,thread_terms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,source=excluded.source,category=excluded.category,url=excluded.url,published_at=excluded.published_at,stage=excluded.stage,deadline_at=excluded.deadline_at,change=excluded.change,title_json=excluded.title_json,summary_json=excluded.summary_json,audience_json=excluded.audience_json,action_json=excluded.action_json,unknowns_json=excluded.unknowns_json,evidence=excluded.evidence,score=excluded.score').bind(e.id,e.source,e.category,e.url,e.publishedAt||null,nowIso,nowIso,e.stage||null,e.deadlineAt||null,e.change||null,JSON.stringify(e.title),JSON.stringify(e.summary),JSON.stringify(e.audience),JSON.stringify(e.action),JSON.stringify(e.unknowns),e.evidence,e.score||0,threadOf.get(e.id)?.id||null,threadOf.get(e.id)?.terms||null));
  if(evStmts.length)await c.env.DB.batch(evStmts);
  await c.env.DB.prepare('INSERT OR IGNORE INTO sweeps (id,fetched_at,published_at,source_count,healthy_count,event_count,archive_key) VALUES (?,?,?,?,?,?,?)').bind(s.id,s.generatedAt,new Date().toISOString(),s.sources.length,s.sources.filter(x=>['ok','quiet'].includes(x.status)).length,s.events.length,key).run();
  try{await c.env.MONITOR.put('radar:version',s.generatedAt);}catch{}return c.json({ok:true,id:s.id,archived:true});
});
app.get('/subscribe',c=>c.redirect('/zh#subscribe',302));
app.get('/ledger',c=>c.redirect('/en/ledger',302));
app.get('/:locale/c/:category',async c=>{
const l=c.req.param('locale') as Locale;const cat=c.req.param('category');
if(!languages.includes(l)||!(cat==='all'||(BOARDS as readonly string[]).includes(cat)))return c.notFound();
const w=words[l] as unknown as Record<string,string>;
const page=Math.max(1,Number(c.req.query('page'))||1);const per=40;const off=(page-1)*per;
const q=(c.req.query('q')||'').trim().slice(0,60);
const conds:string[]=[];const binds:(string|number)[]=[];
if(cat!=='all'){conds.push('category=?');binds.push(cat);}
if(q){conds.push("instr(lower(title_json||' '||coalesce(summary_json,'')||' '||coalesce(audience_json,'')||' '||coalesce(action_json,'')||' '||coalesce(unknowns_json,'')||' '||evidence),lower(?))>0");binds.push(q);}
const where=conds.length?(' WHERE '+conds.join(' AND ')):'';
const res=await c.env.DB.prepare('SELECT * FROM events'+where+' ORDER BY COALESCE(published_at,first_seen) DESC LIMIT ? OFFSET ?').bind(...binds,per+1,off).all();
const rows=(res.results||[]);const hasMore=rows.length>per;const events=rows.slice(0,per).map(rowToEvent);
const cnt=await c.env.DB.prepare('SELECT COUNT(*) n FROM events'+where).bind(...binds).first() as {n?:number}|null;
const total=Number(cnt?.n||events.length);
const label=cat==='all'?w.archive:(w[cat]||cat);
const qs=(p:number)=>{const sp=new URLSearchParams();if(p>1)sp.set('page',String(p));if(q)sp.set('q',q);const s=sp.toString();return `/${l}/c/${cat}`+(s?'?'+s:'');};
c.header('Cache-Control','no-store');c.header('Content-Language',l);
return c.html(<html lang={l}>{pageHead(l,`/${l}/c/${cat}`)}<body><SiteHeader l={l} w={w} cat={cat}/><main class="mx-auto max-w-6xl px-4 md:px-6 pb-20">
<div class="pt-8"><div class="inline-flex items-center gap-1 rounded-lg border bg-card p-1 shadow-sm"><a href={`/${l}`} class="btn btn-ghost btn-sm">← {w.back}</a></div></div>
<div class="mt-4 mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{w.archive}</p><h1 class="text-3xl font-bold tracking-tight">{label}</h1></div><span class="text-xs tabular-nums text-muted-foreground">{String(total).padStart(2,'0')} · {w.page} {page}</span><button data-speak class="btn btn-outline btn-sm gap-1.5" aria-label={w.listen}><svg data-speak-icon class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg><span data-speak-label>{w.listen}</span></button></div>
<form method="get" action={`/${l}/c/${cat}`} class="mb-4 flex flex-wrap gap-2"><div class="relative flex items-center w-full sm:w-80"><input type="search" name="q" value={q} class="input h-9 w-full pr-8" placeholder={w.search}/><kbd class="pointer-events-none absolute right-2.5 hidden sm:inline-flex h-4 select-none items-center rounded border border-border/80 bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">/</kbd></div><button class="btn btn-outline btn-sm">{w.search}</button></form>
<div class="mb-8 inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1"><a href={`/${l}/c/all`} class={`tab ${cat==='all'?'tab-active':''}`}>{w.archive}</a>{BOARDS.map(b=><a href={`/${l}/c/${b}`} class={`tab ${b===cat?'tab-active':''}`}>{w[b]}</a>)}</div>
{events.length?<div class="grid md:grid-cols-2 gap-4">{events.map((e,i)=><EventCard e={e} index={i} l={l} w={w}/>)}</div>:<RadarEmptyState b={cat} l={l} w={w} count={total}/>}
<Pagination page={page} totalPages={Math.max(1,Math.ceil(total/per))} makeHref={qs} w={w}/>
</main><SiteFooter w={w}/></body></html>);});
app.get('/:locale/ledger',async c=>{const l=c.req.param('locale') as Locale;if(!languages.includes(l))return c.notFound();const w=words[l] as unknown as Record<string,string>;const page=Math.max(1,Number(c.req.query('page'))||1);const per=10;const off=(page-1)*per;const res=await c.env.DB.prepare('SELECT * FROM forecasts ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(per+1,off).all();const rows=(res.results||[]);const hasMore=rows.length>per;const list=rows.slice(0,per);const cntF=await c.env.DB.prepare('SELECT COUNT(*) n FROM forecasts').first() as {n?:number}|null;const totalF=Number(cntF?.n||rows.length);const q2=(p:number)=>`/${l}/ledger${p>1?`?page=${p}`:''}`;c.header('Cache-Control','no-store');c.header('Content-Language',l);return c.html(<html lang={l}>{pageHead(l,`/${l}/ledger`)}<body><SiteHeader l={l} w={w}/><main class="mx-auto max-w-6xl px-4 md:px-6 pb-20"><div class="pt-8"><div class="inline-flex items-center gap-1 rounded-lg border bg-card p-1 shadow-sm"><a href={`/${l}`} class="btn btn-ghost btn-sm">← {w.back}</a></div></div><div class="mt-4 mb-8 flex flex-wrap items-end justify-between gap-4"><div><p class="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">On the record</p><h1 class="text-3xl font-bold tracking-tight">{w.ledger}</h1><p class="text-sm text-muted-foreground mt-1">{w.before}</p></div><div class="flex items-center gap-3"><span class="text-xs tabular-nums text-muted-foreground">{w.page} {page} / {Math.max(1,Math.ceil(totalF/per))}</span><button data-speak class="btn btn-outline btn-sm gap-1.5" aria-label={w.listen}><svg data-speak-icon class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg><span data-speak-label>{w.listen}</span></button></div></div>{list.length?<div class="grid md:grid-cols-2 gap-4">{list.map(r=><ForecastCard r={r} l={l} w={w}/>)}</div>:<div class="card p-12 text-center text-sm text-muted-foreground">{w.noForecast}</div>}<Pagination page={page} totalPages={Math.max(1,Math.ceil(totalF/per))} makeHref={q2} w={w}/></main><SiteFooter w={w}/></body></html>);});
app.get('/:locale',async c=>{
  const l=c.req.param('locale') as Locale;if(!languages.includes(l))return c.notFound();
  const __ver=await c.env.MONITOR.get('radar:version')||'0';const __cache=(caches as unknown as {default:{match(r:Request):Promise<Response|undefined>;put(r:Request,res:Response):Promise<void>}}).default;const __ck=new Request(`${ORIGIN}/__ssr/${l}?v=${encodeURIComponent(__ver)}`,{method:'GET'});try{const __hit=await __cache.match(__ck);if(__hit){const __r=new Response(__hit.body,__hit);__r.headers.set('Cache-Control','no-store');return __r;}}catch{}const w=words[l];const s=await latestSnapshot(c.env);const rows=await ledger(c.env.DB);
  const agg=await c.env.DB.prepare('SELECT category, COUNT(*) n FROM events GROUP BY category').all();
  const countMap=new Map((agg.results||[]).map(r=>[String(r.category),Number(r.n)]));
  const totalEvents=(agg.results||[]).reduce((a,r)=>a+Number(r.n),0);
  const recentRes=await c.env.DB.prepare("SELECT * FROM events WHERE first_seen >= datetime('now', '-7 days') ORDER BY COALESCE(published_at,first_seen) DESC LIMIT 200").all();
  const recentEvents=(recentRes.results||[]).map(rowToEvent);
  const eventMap=new Map<string,any>();
  for(const e of recentEvents){if(e&&e.id)eventMap.set(e.id,e);}
  for(const e of (s?.events||[])){if(e&&e.id)eventMap.set(e.id,e);}
  const allCandidates=Array.from(eventMap.values());

  // Boards are chosen up front so the story timelines can be fetched for
  // exactly the cards that will render — one query instead of one per card.
  const boardLists=new Map(BOARDS.map(b=>[b as string,selectBoard(allCandidates,b,3)]));
  const shownThreadIds=[...new Set([...boardLists.values()].flat().map((e:any)=>e?.threadId).filter(Boolean))] as string[];
  const stepsByThread=new Map<string,any[]>();
  if(shownThreadIds.length){
    const marks=shownThreadIds.map(()=>'?').join(',');
    const tr=await c.env.DB.prepare(`SELECT id,thread_id,source,url,first_seen,published_at,title_json FROM events WHERE thread_id IN (${marks}) ORDER BY COALESCE(published_at,first_seen) ASC LIMIT 400`).bind(...shownThreadIds).all().catch(()=>({results:[]as any[]}));
    for(const r of ((tr as any).results||[])){
      const t=String(r.thread_id);
      let title:any=null;try{title=JSON.parse(String(r.title_json));}catch{}
      const arr=stepsByThread.get(t)||[];
      arr.push({id:String(r.id),source:String(r.source),url:String(r.url),at:String(r.published_at||r.first_seen),title});
      stepsByThread.set(t,arr);
    }
  }
  const stale=!s||Date.now()-Date.parse(s.generatedAt)>150*60000;
  // Only sources that actually returned records. `quiet` is reported beside the
  // number, never folded into it: a headline that counts empty feeds as healthy
  // is a claim the reader can disprove with one click.
  const healthy=s?.sources.filter(x=>x.status==='ok').length||0;
  const quietN=s?.sources.filter(x=>x.status==='quiet').length||0;
  const strip=(s?.markets.filter(q=>STRIP.includes(q.symbol))||[]);
  c.header('Cache-Control','no-store');c.header('Content-Language',l);
  const __resp=await c.html(<html lang={l}><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>{titles[l]}</title><meta name="description" content={descriptions[l]}/><link rel="canonical" href={`${ORIGIN}/${l}`}/>{languages.map(lang=><link rel="alternate" hreflang={lang} href={`${ORIGIN}/${lang}`}/>)}<link rel="alternate" hreflang="x-default" href={`${ORIGIN}/en`}/><meta property="og:title" content={titles[l]}/><meta property="og:description" content={descriptions[l]}/><meta property="og:url" content={`${ORIGIN}/${l}`}/><meta property="og:type" content="website"/><meta property="og:image" content={`${ORIGIN}/og.png`}/><meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/><meta property="og:image:alt" content="Antist Radar"/><meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content={titles[l]}/><meta name="twitter:description" content={descriptions[l]}/><meta name="twitter:image" content={`${ORIGIN}/og.png`}/><meta name="theme-color" content="#0a0a0b"/><link rel="icon" type="image/png" sizes="512x512" href="/favicon-512.png"/><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"/><link rel="apple-touch-icon" href="/apple-touch-icon.png"/><link rel="stylesheet" href="/style.css"/><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(l,`/${l}`,{modified:s?.generatedAt,items:(s?.events||[]).slice(0,12).map(e=>({name:String((e.title as any)?.[l]||''),url:e.url})).filter(x=>x.name&&x.url)})}}/>{html`<script>try{if((localStorage.getItem('radar-theme')||'dark')==='dark')document.documentElement.classList.add('dark')}catch{}</script>`}<script src="/app.js" defer/></head>
  <body><header class="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"><div class="mx-auto max-w-6xl h-16 px-4 md:px-6 flex items-center justify-between gap-4"><a href={`/${l}`} class="flex items-center gap-2 font-semibold tracking-tight"><span class="logo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><path d="M12 12 19 5"/><path d="M5.5 12a6.5 6.5 0 0 1 6.5-6.5"/><path d="M8.5 12a3.5 3.5 0 0 1 3.5-3.5"/><path d="M2.5 12a9.5 9.5 0 0 1 9.5-9.5" opacity=".5"/></svg></span><span>ANTIST<span class="text-muted-foreground font-normal"> / RADAR</span></span></a><nav class="hidden md:flex items-center gap-1"><a href="#signals" class="navlink">{w.overview}</a><a href="#markets" class="navlink">{w.markets}</a><a href="#ledger" class="navlink">{w.ledger}</a><a href="#sources" class="navlink">{w.sources}</a></nav><div class="flex items-center gap-2"><div class="flex items-center rounded-lg bg-muted p-1">{languages.map(lang=><a href={`/${lang}`} class={`tab px-2.5 py-1 text-xs ${lang===l?'tab-active':''}`}>{lang.toUpperCase()}</a>)}</div><button data-theme class="btn btn-ghost btn-icon relative" aria-label="Toggle theme"><svg class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><svg class="absolute inset-0 m-auto h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg></button></div></div></header>
  <main class="mx-auto max-w-6xl px-4 md:px-6 pb-16"><section class="py-12 md:py-16 grid lg:grid-cols-[1.4fr_1fr] gap-8 items-start"><div><span class="badge badge-secondary mb-5 gap-1.5">{(stale?<span class="inline-block h-2 w-2 rounded-full bg-down"/>:<span class="live-dot inline-block h-2 w-2 rounded-full bg-up"/>)} {w.tag}</span><h1 class="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.06]">{w.hero}<br/><span class="text-muted-foreground">{w.sub}</span></h1><p class="mt-5 max-w-xl text-muted-foreground leading-relaxed">{w.intro}</p></div><div class="card p-6"><div class="flex items-center justify-between text-xs text-muted-foreground mb-3"><span class="uppercase tracking-wide">{w.brief}</span><span class="tabular-nums">{s?formatDate(s.generatedAt,l):'—'}</span></div><p class="text-base leading-relaxed">{s?.digest[l]||w.empty}</p><p class="text-[11px] text-muted-foreground mt-4">{w.generated}</p>{s?.analysisStatus==='degraded'?<p class="text-[11px] text-muted-foreground mt-1">{w.partial}</p>:null}</div></section>
  <section id="markets" class="mb-12"><div class="card p-4 md:p-5"><div class="flex flex-wrap items-center justify-between gap-3 mb-4"><div class="flex items-center gap-2"><h2 class="text-sm font-semibold tracking-tight">{w.markets}</h2><span class="badge badge-outline gap-1.5 text-[10px]"><span class="live-dot inline-block h-1.5 w-1.5 rounded-full bg-up"></span>LIVE</span><span data-markets-status class="text-[11px] text-muted-foreground"></span></div><div class="flex items-center gap-2"><div class="relative"><input data-markets-search class="input h-8 w-44 text-xs" placeholder={w.addSymbol} autocomplete="off"/><div data-markets-suggest class="absolute right-0 top-9 z-50 hidden w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"></div></div><button data-markets-done class="btn btn-primary btn-sm hidden">{w.done}</button><button data-markets-edit class="btn btn-outline btn-sm">{w.editLayout}</button></div></div><div data-markets class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">{strip.map(q=><a href={q.source} target="_blank" rel="noopener noreferrer" class="market-tile"><div class="text-[11px] font-medium text-muted-foreground truncate">{q.name}</div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">{q.price.toLocaleString(l,{maximumFractionDigits:2})}</span><span class={`text-xs font-medium tabular-nums ${q.changePct>=0?'text-up':'text-down'}`}>{q.changePct>=0?'+':''}{q.changePct}%</span></div></a>)}</div><p class="text-[11px] text-muted-foreground mt-3 hidden md:block">{w.hint}</p></div></section>
  <section id="signals" class="mb-5"><div class="flex flex-wrap items-center justify-between gap-3 mb-4"><h2 class="text-xl font-semibold tracking-tight">{w.signals} <span class="text-sm text-muted-foreground tabular-nums">{String(totalEvents).padStart(2,'0')}</span></h2><div class="flex items-center gap-2"><div class="relative flex items-center w-full sm:w-64"><input data-search type="search" class="input h-9 w-full pr-8" placeholder={w.search}/><kbd class="pointer-events-none absolute right-2.5 hidden sm:inline-flex h-4 select-none items-center rounded border border-border/80 bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">/</kbd></div><button data-boards-done class="btn btn-primary btn-sm hidden">{w.done}</button><button data-boards-edit class="btn btn-outline btn-sm">{w.editBoards}</button><button data-speak class="btn btn-outline btn-sm gap-1.5" aria-label={w.listen}><svg data-speak-icon class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg><span data-speak-label>{w.listen}</span></button></div></div><div data-board-chips class="hidden mt-3"><div class="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1"><span class="tab opacity-60 pointer-events-none">{w.all}</span>{BOARDS.map(b=><button data-chip={b} class="tab cursor-move">{w[b]}</button>)}</div></div><p class="text-[11px] text-muted-foreground hidden md:block">{w.bhint}</p></section>
  <div data-boards>{BOARDS.map(b=>{
    const list=boardLists.get(b)||[];
    return <section id={`board-${b}`} data-board={b} data-board-section={b} class="mb-10"><div class="flex items-center justify-between mb-4"><h3 class="text-lg font-semibold tracking-tight"><span data-board-handle class="hidden cursor-move text-muted-foreground mr-1">⠿</span><a href={`/${l}/c/${b}`} class="no-underline">{w[b]}</a> <span class="text-xs text-muted-foreground tabular-nums">{String(countMap.get(b)||0).padStart(2,'0')}</span></h3><div class="flex items-center gap-1"><button data-board-hide={b} class="btn btn-ghost btn-sm hidden" title="hide/show">◌</button><a href={`/${l}/c/${b}`} class="btn btn-outline btn-sm">{w.more} →</a></div></div>{list.length?<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-3">{list.map((e:any,i:number)=><EventCard e={e} index={i} l={l} w={w} steps={e.threadId?stepsByThread.get(e.threadId):undefined}/>)}</div>:<RadarEmptyState b={b} l={l} w={w} count={countMap.get(b)||0}/>}</section>;
  })}</div>
  <p data-no-results hidden class="py-12 text-center text-muted-foreground">{w.noresults}</p>
  <section id="ledger" class="py-12 border-t"><div class="mb-6 flex items-start justify-between gap-4"><div><p class="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">On the record</p><h2 class="text-xl font-semibold tracking-tight">{w.ledger}</h2><p class="text-sm text-muted-foreground mt-1">{w.before}</p></div><a href={`/${l}/ledger`} class="btn btn-outline btn-sm shrink-0">{w.more} →</a></div><div class="grid md:grid-cols-2 gap-4">{rows.length?rows.slice(0,10).map(r=><ForecastCard r={r} l={l} w={w}/>):<p class="text-sm text-muted-foreground">{w.noForecast}</p>}</div></section>
  <section id="sources" class="py-12 border-t grid md:grid-cols-[1fr_2fr] gap-8"><div><h2 class="text-xl font-semibold tracking-tight">{w.sources}</h2><p class="text-4xl font-semibold tabular-nums mt-3">{healthy}<span class="text-xl text-muted-foreground"> / {s?.sources.length||0}</span></p><p class="text-xs text-muted-foreground mt-1">{w.healthy}</p>{quietN>0&&<p class="text-xs text-muted-foreground mt-2">{quietN} · {w.quiet}</p>}</div><div class="grid sm:grid-cols-3 gap-x-4">{s?.sources.map(source=>{
    const body=<><span class="truncate">{source.name}</span><span class="shrink-0 tabular-nums">{source.count>0&&<span class="text-muted-foreground mr-2">{source.count}</span>}<span class={source.status==='ok'?'text-up':source.status==='quiet'?'text-muted-foreground':'text-down'}>{source.status}</span></span></>;
    const cls="flex justify-between gap-3 border-b py-2.5 text-xs";
    return source.url
      ? <a href={source.url} target="_blank" rel="noopener noreferrer" class={cls}>{body}</a>
      : <div class={cls}>{body}</div>;
  })}</div></section>
  <section id="subscribe" class="py-12 border-t"><div class="card p-6 md:p-8 grid md:grid-cols-[1.2fr_1fr] gap-8 items-center"><div><h2 class="text-xl font-semibold tracking-tight">{w.subscribe}</h2><p class="text-sm text-muted-foreground mt-2 leading-relaxed">{w.subintro}</p><p class="text-xs text-muted-foreground mt-4 leading-relaxed">{w.subprivacy}</p></div><div class="flex flex-col gap-3"><a href="https://t.me/Antist_monitor_bot" target="_blank" rel="noopener" class="btn btn-primary w-full">{w.subopen} ↗</a><p class="text-xs text-muted-foreground">{w.subcmd}</p></div></div></section>
  <footer class="border-t py-10 grid md:grid-cols-2 gap-8"><div><p class="text-sm font-semibold tracking-tight">ANTIST / RADAR.</p><p class="text-xs text-muted-foreground mt-3">Japan & the world. Independently observed.</p><p class="text-xs text-muted-foreground mt-4">© {new Date().getFullYear()} Antist · All rights reserved.</p><a class="text-xs text-muted-foreground underline mt-2 inline-block" href="https://github.com/Antisubmissivist/antist-radar">Source code · AGPL-3.0</a></div><div><h2 class="text-xs font-semibold mb-2">{w.method}</h2><p class="text-xs text-muted-foreground leading-relaxed">{w.methodText}</p></div></footer><div data-toast class="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col gap-2 items-end"></div></main></body></html>);try{c.executionCtx.waitUntil(__cache.put(__ck,__resp.clone()));}catch{}return __resp;
});
app.onError((err,c)=>{console.error('worker-error: '+((err&&(err as Error).stack)||String(err)));return c.json({error:'Temporarily unavailable'},503);});
export default {fetch:app.fetch,async scheduled(event:ScheduledController,env:Bindings){const s=await latestSnapshot(env);if(!s||Date.now()-Date.parse(s.generatedAt)>50*60000){console.log(JSON.stringify({event:'sweep-dispatch',...(await dispatchSweep(env))}));}if(s){await settle(env,s);}
try{console.log(JSON.stringify({event:'retention',...(await retain(env))}));}catch(e){console.log(JSON.stringify({event:'retention-error',error:String(e)}));}
try{const jstHour=new Date(event.scheduledTime+9*3600000).getUTCHours();const date=new Date(event.scheduledTime+9*3600000).toISOString().slice(0,10);const due=await env.DB.prepare('SELECT * FROM subscribers WHERE active=1 AND hour=? AND (last_sent IS NULL OR last_sent<>?) LIMIT 100').bind(jstHour,date).all();for(const sub of (due.results||[])){try{const r=await sendSubscriber(env,sub as Record<string,unknown>,date) as {ok?:boolean;description?:string};if(r&&r.ok){await env.DB.prepare('UPDATE subscribers SET last_sent=? WHERE id=?').bind(date,(sub as Record<string,unknown>).id).run();}else{console.log(JSON.stringify({event:'subscriber-send-fail',id:(sub as Record<string,unknown>).id,detail:r?.description}));}}catch(e){console.log(JSON.stringify({event:'subscriber-fail',id:(sub as Record<string,unknown>).id,error:String(e)}));}}}catch(e){console.log(JSON.stringify({event:'subscribers-error',error:String(e)}));}}};
