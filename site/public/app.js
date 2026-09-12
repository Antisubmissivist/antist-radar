const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cookie={get(n){const m=document.cookie.match('(?:^|; )'+n+'=([^;]*)');return m?decodeURIComponent(m[1]):null;},set(n,v,d=365){document.cookie=n+'='+encodeURIComponent(v)+';path=/;max-age='+(d*86400)+';SameSite=Lax';}};
const LANG=document.documentElement.lang||'en';
const MSG={added:{zh:'已添加',ja:'追加しました',en:'Added'},exists:{zh:'已在自选',ja:'すでに追加済み',en:'Already in list'},hidden:{zh:'已隐藏',ja:'非表示にしました',en:'Hidden'},shown:{zh:'已显示',ja:'表示しました',en:'Shown'},removed:{zh:'已删除',ja:'削除しました',en:'Removed'},boards:{zh:'主题已更新',ja:'テーマを更新',en:'Topics updated'},waiting:{zh:'等待 /start…',ja:'/start を待っています…',en:'Waiting for /start…'},linked:{zh:'✅ 已连接 · 每天',ja:'✅ 接続済み · 毎日',en:'✅ Linked · daily'}};
const T=(k,v)=>((MSG[k]&&(MSG[k][LANG]||MSG[k].en))||k)+(v?' '+v:'');
function toast(msg){const box=$('[data-toast]');if(!box)return;const el=document.createElement('div');el.className='pointer-events-auto rounded-lg border bg-popover text-popover-foreground px-3.5 py-2 text-sm shadow-md animate-in';el.textContent=msg;box.appendChild(el);setTimeout(()=>{el.style.transition='opacity .3s';el.style.opacity='0';setTimeout(()=>el.remove(),350);},2400);}

/* ---------- theme ---------- */
const theme=$('[data-theme]');
theme?.addEventListener('click',()=>{const dark=document.documentElement.classList.toggle('dark');localStorage.setItem('radar-theme',dark?'dark':'light');theme.setAttribute('aria-pressed',String(dark));});

/* ---------- signal search ---------- */
const search=$('[data-search]');
function filterEvents(){const query=search?.value.toLowerCase()||'';let shown=0;$$('[data-event]').forEach(e=>{const visible=e.textContent.toLowerCase().includes(query);e.hidden=!visible;if(visible)shown++;});
  $$('[data-board-section]').forEach(section=>{const id=section.dataset.boardSection;const userHidden=boardEdit?false:hiddenBoards.has(id);const any=section.querySelector('[data-event]:not([hidden])');section.hidden=userHidden||!any;});
  const no=$('[data-no-results]');if(no)no.hidden=shown!==0;}
search?.addEventListener('input',filterEvents);

/* ---------- signal boards: reorder + hide/show (cookie) ---------- */
const BLS='radar-boards';let boardEdit=false;let dragBoard=null;let dragChip=null;
function loadBoards(){try{const a=JSON.parse(cookie.get(BLS)||'null');if(Array.isArray(a)&&a.length)return a;}catch{}return null;}
let boardLayout=loadBoards();const hiddenBoards=new Set();
if(boardLayout)for(const e of boardLayout)if(e.hidden)hiddenBoards.add(e.id);
function boardOrder(){const chips=$('[data-board-chips]');const ids=($('[data-board-chips]')?$$('[data-chip]'):$$('[data-board-section]')).map(c=>c.dataset.chip||c.dataset.boardSection);const order=[];if(boardLayout)for(const e of boardLayout)if(ids.includes(e.id))order.push(e.id);for(const id of ids)if(!order.includes(id))order.push(id);return order;}
function applyBoards(){const wrap=$('[data-boards]');if(!wrap)return;const order=boardOrder();
  order.forEach(id=>{const s=wrap.querySelector(`[data-board-section="${id}"]`);if(s)wrap.appendChild(s);});
  const chips=$('[data-board-chips]');const row=chips?.querySelector('.rounded-lg');
  if(row)order.forEach(id=>{const c=row.querySelector(`[data-chip="${id}"]`);if(c)row.appendChild(c);});
  $$('[data-chip]').forEach(c=>c.classList.toggle('opacity-50',hiddenBoards.has(c.dataset.chip)));
  $$('[data-board-section]',wrap).forEach(s=>{const id=s.dataset.boardSection;const hid=hiddenBoards.has(id);s.hidden=!boardEdit&&hid;s.classList.toggle('opacity-50',boardEdit&&hid);s.querySelector('[data-board-handle]')?.classList.toggle('hidden',!boardEdit);const b=s.querySelector('[data-board-hide]');if(b){b.classList.toggle('hidden',!boardEdit);b.textContent=hid?'◉':'◌';}});
  wireBoardDrag();wireChipDrag();filterEvents();}
function saveBoards(){boardLayout=boardOrder().map(id=>({id,hidden:hiddenBoards.has(id)}));cookie.set(BLS,JSON.stringify(boardLayout));}
function wireBoardDrag(){const wrap=$('[data-boards]');if(!wrap)return;$$('[data-board-section]',wrap).forEach(s=>{s.setAttribute('draggable',boardEdit?'true':'false');if(!boardEdit)return;
  s.addEventListener('dragstart',()=>{dragBoard=s.dataset.boardSection;s.classList.add('dragging');});
  s.addEventListener('dragend',()=>{s.classList.remove('dragging');$$('.drop-target').forEach(x=>x.classList.remove('drop-target'));});
  s.addEventListener('dragover',e=>{e.preventDefault();s.classList.add('drop-target');});
  s.addEventListener('dragleave',()=>s.classList.remove('drop-target'));
  s.addEventListener('drop',e=>{e.preventDefault();s.classList.remove('drop-target');if(!dragBoard||dragBoard===s.dataset.boardSection)return;const from=wrap.querySelector(`[data-board-section="${dragBoard}"]`);if(from)wrap.insertBefore(from,s);saveBoards();applyBoards();});
  s.querySelector('[data-board-hide]')?.addEventListener('click',e=>{e.preventDefault();const id=s.dataset.boardSection;hiddenBoards.has(id)?hiddenBoards.delete(id):hiddenBoards.add(id);toast(T('boards'));saveBoards();applyBoards();});});}
function wireChipDrag(){const chips=$('[data-board-chips]');if(!chips)return;const row=chips.querySelector('.rounded-lg');$$('[data-chip]',chips).forEach(c=>{c.setAttribute('draggable',boardEdit?'true':'false');if(!boardEdit)return;
  c.addEventListener('dragstart',e=>{dragChip=c.dataset.chip;c.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
  c.addEventListener('dragend',()=>{c.classList.remove('dragging');$$('.drop-target').forEach(x=>x.classList.remove('drop-target'));});
  c.addEventListener('dragover',e=>{e.preventDefault();c.classList.add('drop-target');});
  c.addEventListener('dragleave',()=>c.classList.remove('drop-target'));
  c.addEventListener('drop',e=>{e.preventDefault();c.classList.remove('drop-target');if(!dragChip||dragChip===c.dataset.chip)return;const from=row.querySelector(`[data-chip="${dragChip}"]`);if(from)row.insertBefore(from,c);saveBoards();applyBoards();});
  c.addEventListener('click',e=>{e.preventDefault();const id=c.dataset.chip;hiddenBoards.has(id)?hiddenBoards.delete(id):hiddenBoards.add(id);toast(T('boards'));saveBoards();applyBoards();});});}
const bEdit=$('[data-boards-edit]');const bDone=$('[data-boards-done]');
function setBoardEdit(on){boardEdit=on;bEdit?.classList.toggle('hidden',on);bDone?.classList.toggle('hidden',!on);$('[data-board-chips]')?.classList.toggle('hidden',!on);applyBoards();}
bEdit?.addEventListener('click',()=>setBoardEdit(true));
bDone?.addEventListener('click',()=>setBoardEdit(false));
applyBoards();

/* ---------- markets: live + search/add + reorder + hide/delete ---------- */
const DEFAULTS=['BTC-USD','ETH-USD','SOL-USD','^GSPC','^IXIC','^N225','NVDA','^VIX'];
const LS='radar-markets';let edit=false;let dragSym=null;let highlight=null;
const prevPrices=new Map();
const norm=s=>String(s||'').trim().replace(/^\./,'^').toUpperCase();
function loadLayout(){let src;try{src=JSON.parse(localStorage.getItem(LS));}catch{}if(!Array.isArray(src)||!src.length)src=DEFAULTS;const seen=new Set();const out=[];for(const x of src){const it=typeof x==='string'?{symbol:x,hidden:false}:x;const sym=norm(it.symbol);if(!sym||seen.has(sym))continue;seen.add(sym);out.push({symbol:sym,hidden:!!it.hidden});}return out;}
let layout=loadLayout();
const saveLayout=()=>localStorage.setItem(LS,JSON.stringify(layout));

function tileView(q,flash=''){const up=q.changePct>=0;return `<a data-symbol="${esc(q.symbol)}" href="${esc(q.source)}" target="_blank" rel="noopener noreferrer" class="market-tile ${flash}"><div class="text-[11px] font-medium text-muted-foreground truncate">${esc(q.name||q.symbol)}</div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">${Number(q.price).toLocaleString()}</span><span class="text-xs font-medium tabular-nums ${up?'text-up':'text-down'}">${up?'+':''}${q.changePct}%</span></div></a>`;}
function tileEdit(q,item,flash=''){const up=q.changePct>=0;return `<div data-symbol="${esc(item.symbol)}" draggable="true" class="market-tile cursor-move ${item.hidden?'opacity-50':''} ${flash}"><div class="flex items-center justify-between gap-1"><span class="text-[11px] font-medium text-muted-foreground truncate">⠿ ${esc(q.name||q.symbol)}</span><span class="flex items-center gap-0.5"><button data-hide="${esc(item.symbol)}" title="hide/show" class="btn btn-ghost h-5 w-5 p-0 text-xs leading-none">${item.hidden?'◉':'◌'}</button><button data-del="${esc(item.symbol)}" title="remove" class="btn btn-ghost h-5 w-5 p-0 text-xs leading-none text-destructive">✕</button></span></div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">${Number(q.price).toLocaleString()}</span><span class="text-xs font-medium tabular-nums ${up?'text-up':'text-down'}">${up?'+':''}${q.changePct}%</span></div></div>`;}

function render(map,updatedAt){const el=$('[data-markets]');if(!el)return;const parts=[];
  for(const item of layout){const q=map.get(item.symbol);if(!q)continue;if(item.hidden&&!edit)continue;
    const old=prevPrices.get(item.symbol);let flash='';
    if(old!=null&&old!==q.price){flash=q.price>old?'flash-up':'flash-down';}
    prevPrices.set(item.symbol,q.price);
    parts.push(edit?tileEdit(q,item,flash):tileView(q,flash));}
  el.innerHTML=parts.join('')||`<p class="col-span-full text-xs text-muted-foreground">—</p>`;
  wireTiles();
  if(highlight){const t=el.querySelector(`[data-symbol="${highlight}"]`);if(t){t.classList.add('drop-target');setTimeout(()=>t.classList.remove('drop-target'),2500);}highlight=null;}
  const st=$('[data-markets-status]');if(st&&updatedAt){const secs=Math.max(0,Math.round((Date.now()-Date.parse(updatedAt))/1000));st.textContent=`· ${secs}s`;}}

async function refresh(){const syms=layout.map(x=>x.symbol);if(!syms.length){render(new Map(),null);return;}try{const r=await fetch('/api/markets?symbols='+encodeURIComponent(syms.join(',')),{cache:'no-store'});if(!r.ok)return;const d=await r.json();render(new Map((d.items||[]).map(q=>[q.symbol,q])),d.updatedAt);}catch{}}

function addSymbol(sym){sym=norm(sym);if(!sym)return;const ex=layout.find(x=>x.symbol===sym);if(ex){ex.hidden=false;toast(T('exists',sym));}else{layout.push({symbol:sym,hidden:false});toast(T('added',sym));}highlight=sym;saveLayout();refresh();}

function wireTiles(){$$('[data-markets] [data-symbol]').forEach(el=>{
  el.addEventListener('click',e=>{const h=e.target.closest('[data-hide]');const d=e.target.closest('[data-del]');
    if(h){const it=layout.find(x=>x.symbol===h.dataset.hide);if(it){it.hidden=!it.hidden;toast(T(it.hidden?'hidden':'shown',it.symbol));saveLayout();}refresh();return;}
    if(d){layout=layout.filter(x=>x.symbol!==d.dataset.del);toast(T('removed',d.dataset.del));saveLayout();refresh();return;}});
  if(!edit)return;
  el.addEventListener('dragstart',e=>{dragSym=el.dataset.symbol;el.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
  el.addEventListener('dragend',()=>{el.classList.remove('dragging');$$('.drop-target').forEach(x=>x.classList.remove('drop-target'));});
  el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drop-target');});
  el.addEventListener('dragleave',()=>el.classList.remove('drop-target'));
  el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drop-target');const to=el.dataset.symbol;if(!dragSym||dragSym===to)return;const from=layout.findIndex(x=>x.symbol===dragSym);const ti=layout.findIndex(x=>x.symbol===to);if(from<0||ti<0)return;const [m]=layout.splice(from,1);layout.splice(ti,0,m);saveLayout();refresh();});
});}

const editBtn=$('[data-markets-edit]');const doneBtn=$('[data-markets-done]');
function setEdit(on){edit=on;editBtn?.classList.toggle('hidden',on);doneBtn?.classList.toggle('hidden',!on);refresh();}
editBtn?.addEventListener('click',()=>setEdit(true));
doneBtn?.addEventListener('click',()=>setEdit(false));

const box=$('[data-markets-suggest]');
function hideSuggest(){if(box){box.classList.add('hidden');box.innerHTML='';}}
function showSuggest(list){if(!box)return;if(!list.length){hideSuggest();return;}
  box.innerHTML=list.map(r=>`<button type="button" data-add="${esc(r.symbol)}" class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-accent"><span class="font-medium">${esc(r.symbol)}</span><span class="truncate text-muted-foreground">${esc(r.name)}${r.exchange?' · '+esc(r.exchange):''}</span></button>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('mousedown',e=>{e.preventDefault();addSymbol(b.dataset.add);const i=$('[data-markets-search]');if(i)i.value='';hideSuggest();}));}
const searchInput=$('[data-markets-search]');let debounce;
searchInput?.addEventListener('input',()=>{const q=searchInput.value.trim();clearTimeout(debounce);if(!q){hideSuggest();return;}debounce=setTimeout(async()=>{try{const r=await fetch('/api/symbols?q='+encodeURIComponent(q));const d=await r.json();showSuggest(d.results||[]);}catch{hideSuggest();}},220);});
searchInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const first=box?.querySelector('[data-add]');addSymbol(first?first.dataset.add:searchInput.value);searchInput.value='';hideSuggest();}if(e.key==='Escape')hideSuggest();});
document.addEventListener('click',e=>{if(!e.target.closest('[data-markets-search]')&&!e.target.closest('[data-markets-suggest]'))hideSuggest();});

refresh();setInterval(()=>{if(!document.hidden)refresh();},12000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('focus',refresh);

/* ---------- Telegram subscribe form ---------- */
const subForm=$('[data-sub-form]');
if(subForm){
  const out=$('[data-sub-out]');const go=$('[data-sub-go]');
  subForm.addEventListener('submit',async e=>{e.preventDefault();go.disabled=true;out.innerHTML='<p class="text-muted-foreground">…</p>';
    const boards=$$('[data-sub-board]:checked').map(function(x){return x.value});
    try{const r=await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:$('[data-sub-token]').value.trim(),lang:$('[data-sub-lang]').value,hour:Number($('[data-sub-hour]').value),boards:boards})});const d=await r.json();
      if(!d.ok){out.innerHTML='<div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">'+esc(d.reason||'failed')+(d.detail?' — '+esc(d.detail):'')+'</div>';go.disabled=false;return;}
      out.innerHTML='<div class="rounded-md border p-3 text-xs space-y-2"><p>@'+esc(d.botUsername)+' &nbsp;<code>/start '+esc(d.pairCode)+'</code></p><a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://t.me/'+esc(d.botUsername)+'">'+esc('@'+d.botUsername)+'</a><p data-sub-st class="text-muted-foreground">'+T('waiting')+'</p></div>';
      (function poll(){fetch('/api/subscribe/'+d.secret).then(r=>r.json()).then(s=>{const st=$('[data-sub-st]');if(s&&s.linked){if(st)st.textContent=T('linked',String(s.hour).padStart(2,'0')+':41 JST');}else setTimeout(poll,3000);}).catch(()=>setTimeout(poll,5000));})();
    }catch(err){out.innerHTML='<div class="rounded-md border p-3 text-xs text-destructive">network error</div>';go.disabled=false;}});
}

/* ---------- read aloud (Web Speech API — free, on-device, ja/en/zh with shadcn SVG icons) ---------- */
(function(){
  const btns=$$('[data-speak]');
  if(!btns.length||!('speechSynthesis' in window))return;
  const synth=window.speechSynthesis;
  const bcp=LANG==='ja'?'ja-JP':LANG==='zh'?'zh-CN':LANG==='en'?'en-US':LANG;
  const sep=LANG==='en'?'. ':'。';
  const STOP={en:'Stop',ja:'停止',zh:'停止'};
  const NONE={en:'Nothing to read',ja:'読み上げる内容がありません',zh:'暂无可朗读内容'};
  const ICON_SPEAK='<svg data-speak-icon class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  const ICON_STOP='<svg data-speak-icon class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>';
  const EQUALIZER_HTML='<span class="inline-flex items-end gap-0.5 h-3.5 w-3 pb-0.5"><span class="w-0.5 bg-primary rounded-full eq-bar-1" style="height:8px"></span><span class="w-0.5 bg-primary rounded-full eq-bar-2" style="height:12px"></span><span class="w-0.5 bg-primary rounded-full eq-bar-3" style="height:6px"></span></span>';

  const MALE={ja:['ichiro','otoya','takehiro','keita','naoki','kaito','male','男'],zh:['kangkang','yunyang','yunjian','yunxi','yunfeng','yunjie','yunye','kunkun','limu','li-mu','male','男'],en:['david','mark','guy','daniel','alex','fred','george','james','google uk english male','male']};
  const FEMALE={ja:['haruka','kyoko','nanami','ayumi','sayaka','female','女'],zh:['huihui','xiaoxiao','xiaoyi','xiaobei','xiaoni','xiaohan','xiaoqiu','xiaozhen','xiaoxuan','xiaomeng','yaoyao','ting-ting','tingting','mei-jia','meijia','sin-ji','female','女'],en:['zira','susan','samantha','karen','moira','tessa','fiona','victoria','female']};
  let queue=[],idx=0,active=false,gen=0;
  let currentPlayingCard=null;
  const clean=s=>String(s).replace(/[↗→←·•|]/g,' ').replace(/\s+/g,' ').trim();
  const has=(v,list)=>{const n=String(v.name||'').toLowerCase();return list.some(x=>n.includes(x));};
  const voices=()=>{try{return synth.getVoices()||[];}catch(e){return [];}};
  try{synth.getVoices();}catch(e){}

  function pickVoice(){
    const pool=voices().filter(v=>v.lang&&v.lang.toLowerCase().startsWith(bcp.slice(0,2).toLowerCase()));
    if(!pool.length)return {voice:null,male:false};
    const exact=v=>String(v.lang||'').replace('_','-').toLowerCase()===bcp.toLowerCase();
    const byLocal=(a,b)=>(exact(b)-exact(a))||((b.localService?1:0)-(a.localService?1:0));
    const male=MALE[LANG]||MALE.en,female=FEMALE[LANG]||FEMALE.en;
    const known=pool.filter(v=>has(v,male)).sort(byLocal);
    if(known.length)return {voice:known[0],male:true};
    const neutral=pool.filter(v=>!has(v,female)).sort(byLocal);
    if(neutral.length)return {voice:neutral[0],male:true};
    return {voice:pool.slice().sort(byLocal)[0]||null,male:false};
  }

  function setActiveCard(card){
    if(currentPlayingCard&&currentPlayingCard!==card){
      currentPlayingCard.classList.remove('playing-card');
      const slot=currentPlayingCard.querySelector('[data-eq-slot]');
      if(slot){slot.innerHTML='';slot.classList.add('hidden');slot.classList.remove('inline-flex');}
    }
    currentPlayingCard=card;
    if(card){
      card.classList.add('playing-card');
      const slot=card.querySelector('[data-eq-slot]');
      if(slot){slot.innerHTML=EQUALIZER_HTML;slot.classList.remove('hidden');slot.classList.add('inline-flex');}
      try{card.scrollIntoView({behavior:'smooth',block:'center'});}catch(e){}
    }
  }

  function clearActiveCard(){
    if(currentPlayingCard){
      currentPlayingCard.classList.remove('playing-card');
      const slot=currentPlayingCard.querySelector('[data-eq-slot]');
      if(slot){slot.innerHTML='';slot.classList.add('hidden');slot.classList.remove('inline-flex');}
      currentPlayingCard=null;
    }
  }

  function parts(card,t){const out=[clean(t.textContent)];const s=card.querySelector('[data-tts-summary]');if(s)out.push(clean(s.textContent));const r=card.querySelector('[data-tts-review]');if(r)out.push(clean(r.textContent));return out.filter(Boolean);}
  function label(){
    btns.forEach(b=>{
      b.innerHTML=`${ICON_SPEAK}<span data-speak-label>${b.dataset.label||'Listen'}</span>`;
      b.setAttribute('aria-pressed','false');
    });
    clearActiveCard();
  }
  function stop(){active=false;gen++;try{synth.cancel();}catch(e){}label();}
  function speak(g){
    if(!active||g!==gen)return;
    if(idx>=queue.length){active=false;return label();}
    const item=queue[idx];
    setActiveCard(item.card);
    const sel=pickVoice();const u=new SpeechSynthesisUtterance(item.text);
    if(sel.voice)u.voice=sel.voice;
    u.lang=bcp;u.rate=sel.male?0.98:0.95;u.pitch=sel.male?1:0.55;
    const adv=()=>{if(active&&g===gen){idx++;setTimeout(()=>speak(g),60);}};
    u.onend=adv;u.onerror=adv;
    try{synth.resume();synth.speak(u);}catch(e){adv();}
  }
  function start(){
    const seen=new Set();queue=[];
    $$('[data-tts-title]').forEach(t=>{const card=t.closest('.card')||t.parentElement;if(!card||seen.has(card))return;seen.add(card);const p=parts(card,t);if(p.length)queue.push({text:p.join(sep),card});});
    if(!queue.length){toast(NONE[LANG]||NONE.en);return;}
    try{synth.cancel();}catch(e){}
    idx=0;active=true;gen++;const g=gen;
    btns.forEach(b=>{
      b.innerHTML=`${ICON_STOP}<span data-speak-label>${STOP[LANG]||STOP.en}</span>`;
      b.setAttribute('aria-pressed','true');
    });
    if(voices().length)speak(g);
    else{let fired=false;const onv=()=>{if(fired||g!==gen)return;fired=true;speak(g);};try{synth.addEventListener('voiceschanged',onv);}catch(e){}setTimeout(onv,700);}
  }
  btns.forEach(b=>{
    const lText=b.querySelector('[data-speak-label]')?.textContent||b.textContent.replace(/[^\w\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g,'').trim();
    b.dataset.label=lText;
    b.setAttribute('aria-pressed','false');
    b.addEventListener('click',()=>{active?stop():start();});
  });
  window.addEventListener('beforeunload',()=>{try{synth.cancel();}catch(e){}});
})();

/* ---------- keyboard power-user navigation ---------- */
(function(){
  let focusedCardIndex=-1;
  function getVisibleCards(){
    return $$('[data-event]:not([hidden])').filter(el=>{
      const parent=el.closest('[data-board-section]');
      return !parent||!parent.hidden;
    });
  }
  function setCardFocus(idx){
    const cards=getVisibleCards();
    if(!cards.length)return;
    cards.forEach(c=>c.classList.remove('card-focused'));
    if(idx<0)idx=0;
    if(idx>=cards.length)idx=cards.length-1;
    focusedCardIndex=idx;
    const target=cards[idx];
    if(target){
      target.classList.add('card-focused');
      try{target.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(e){}
    }
  }
  function clearCardFocus(){
    $$('.card-focused').forEach(c=>c.classList.remove('card-focused'));
    focusedCardIndex=-1;
  }

  window.addEventListener('keydown',e=>{
    const activeEl=document.activeElement;
    const isTyping=activeEl&&(activeEl.tagName==='INPUT'||activeEl.tagName==='TEXTAREA'||activeEl.isContentEditable);

    // Global / or Cmd+K to search
    if((e.key==='/'&&!isTyping)||((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k')){
      e.preventDefault();
      const s=$('[data-search]')||$('input[type="search"]');
      if(s){s.focus();s.select();}
      return;
    }

    // Escape clears search / popovers / card focus
    if(e.key==='Escape'){
      if(isTyping){activeEl.blur();}
      hideSuggest();
      clearCardFocus();
      return;
    }

    if(isTyping)return;

    // 'j' / 'k' card navigation
    if(e.key==='j'||e.key==='J'){
      e.preventDefault();
      const cards=getVisibleCards();
      if(cards.length){setCardFocus(focusedCardIndex+1);}
      return;
    }
    if(e.key==='k'||e.key==='K'){
      e.preventDefault();
      const cards=getVisibleCards();
      if(cards.length){setCardFocus(focusedCardIndex<=0?0:focusedCardIndex-1);}
      return;
    }

    // 'Enter' opens focused card url
    if(e.key==='Enter'&&focusedCardIndex>=0){
      const cards=getVisibleCards();
      const target=cards[focusedCardIndex];
      const url=target?.dataset.url||target?.querySelector('a[href]')?.getAttribute('href');
      if(url){
        e.preventDefault();
        window.open(url,'_blank','noopener,noreferrer');
      }
      return;
    }

    // 'Space' toggles evidence details on focused card
    if(e.key===' '&&focusedCardIndex>=0){
      const cards=getVisibleCards();
      const target=cards[focusedCardIndex];
      const det=target?.querySelector('details');
      if(det){
        e.preventDefault();
        det.open=!det.open;
      }
      return;
    }

    // 'l' / 'L' cycles language zh -> ja -> en -> zh
    if(e.key==='l'||e.key==='L'){
      const langs=['zh','ja','en'];
      const nextLang=langs[(langs.indexOf(LANG)+1)%langs.length];
      const curPath=window.location.pathname;
      const newPath=curPath.replace(/^\/(zh|ja|en)/,'/'+nextLang);
      if(newPath!==curPath){
        window.location.href=newPath+window.location.search+window.location.hash;
      }else{
        window.location.href='/'+nextLang;
      }
      return;
    }
  });

  document.addEventListener('click',e=>{
    if(!e.target.closest('[data-event]')){
      clearCardFocus();
    }
  });
})();
