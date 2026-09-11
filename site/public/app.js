const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cookie={get(n){const m=document.cookie.match('(?:^|; )'+n+'=([^;]*)');return m?decodeURIComponent(m[1]):null;},set(n,v,d=365){document.cookie=n+'='+encodeURIComponent(v)+';path=/;max-age='+(d*86400)+';SameSite=Lax';}};
const LANG=document.documentElement.lang||'en';
const MSG={added:{zh:'已添加',ja:'追加しました',en:'Added'},exists:{zh:'已在自选',ja:'すでに追加済み',en:'Already in list'},hidden:{zh:'已隐藏',ja:'非表示にしました',en:'Hidden'},shown:{zh:'已显示',ja:'表示しました',en:'Shown'},removed:{zh:'已删除',ja:'削除しました',en:'Removed'},boards:{zh:'主题已更新',ja:'テーマを更新',en:'Topics updated'}};
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
const norm=s=>String(s||'').trim().replace(/^\./,'^').toUpperCase();
function loadLayout(){let src;try{src=JSON.parse(localStorage.getItem(LS));}catch{}if(!Array.isArray(src)||!src.length)src=DEFAULTS;const seen=new Set();const out=[];for(const x of src){const it=typeof x==='string'?{symbol:x,hidden:false}:x;const sym=norm(it.symbol);if(!sym||seen.has(sym))continue;seen.add(sym);out.push({symbol:sym,hidden:!!it.hidden});}return out;}
let layout=loadLayout();
const saveLayout=()=>localStorage.setItem(LS,JSON.stringify(layout));

function tileView(q){const up=q.changePct>=0;return `<a data-symbol="${esc(q.symbol)}" href="${esc(q.source)}" target="_blank" rel="noopener noreferrer" class="market-tile"><div class="text-[11px] font-medium text-muted-foreground truncate">${esc(q.name||q.symbol)}</div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">${Number(q.price).toLocaleString()}</span><span class="text-xs font-medium tabular-nums ${up?'text-up':'text-down'}">${up?'+':''}${q.changePct}%</span></div></a>`;}
function tileEdit(q,item){const up=q.changePct>=0;return `<div data-symbol="${esc(item.symbol)}" draggable="true" class="market-tile cursor-move ${item.hidden?'opacity-50':''}"><div class="flex items-center justify-between gap-1"><span class="text-[11px] font-medium text-muted-foreground truncate">⠿ ${esc(q.name||q.symbol)}</span><span class="flex items-center gap-0.5"><button data-hide="${esc(item.symbol)}" title="hide/show" class="btn btn-ghost h-5 w-5 p-0 text-xs leading-none">${item.hidden?'◉':'◌'}</button><button data-del="${esc(item.symbol)}" title="remove" class="btn btn-ghost h-5 w-5 p-0 text-xs leading-none text-destructive">✕</button></span></div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">${Number(q.price).toLocaleString()}</span><span class="text-xs font-medium tabular-nums ${up?'text-up':'text-down'}">${up?'+':''}${q.changePct}%</span></div></div>`;}

function render(map,updatedAt){const el=$('[data-markets]');if(!el)return;const parts=[];
  for(const item of layout){const q=map.get(item.symbol);if(!q)continue;if(item.hidden&&!edit)continue;parts.push(edit?tileEdit(q,item):tileView(q));}
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
