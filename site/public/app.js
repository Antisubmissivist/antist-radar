const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- theme ---------- */
const theme=$('[data-theme]');
theme?.addEventListener('click',()=>{const dark=document.documentElement.classList.toggle('dark');localStorage.setItem('radar-theme',dark?'dark':'light');theme.setAttribute('aria-pressed',String(dark));});

/* ---------- signal search + board filter ---------- */
const search=$('[data-search]');
const buttons=$$('[data-filter]');let category='all';
function filter(){const query=search?.value.toLowerCase()||'';let shown=0;$$('[data-event]').forEach(e=>{const visible=(category==='all'||e.dataset.category===category)&&e.textContent.toLowerCase().includes(query);e.hidden=!visible;if(visible)shown++;});
  $$('[data-board]').forEach(section=>{const any=section.querySelector('[data-event]:not([hidden])');section.hidden=!any;});
  const no=$('[data-no-results]');if(no)no.hidden=shown!==0;}
search?.addEventListener('input',filter);
buttons.forEach(b=>b.addEventListener('click',()=>{category=b.dataset.filter;buttons.forEach(x=>{const active=x===b;x.setAttribute('aria-pressed',String(active));x.classList.toggle('tab-active',active);});filter();}));

/* ---------- markets: live + search/add + reorder + hide/delete ---------- */
const DEFAULTS=['BTC-USD','ETH-USD','SOL-USD','^GSPC','^IXIC','^N225','NVDA','^VIX'];
const LS='radar-markets';let edit=false;let dragSym=null;
function loadLayout(){try{const a=JSON.parse(localStorage.getItem(LS));if(Array.isArray(a)&&a.length)return a.map(x=>typeof x==='string'?{symbol:x,hidden:false}:x).filter(x=>x&&x.symbol);}catch{}return DEFAULTS.map(s=>({symbol:s,hidden:false}));}
let layout=loadLayout();
const saveLayout=()=>localStorage.setItem(LS,JSON.stringify(layout));

function tileView(q){const up=q.changePct>=0;return `<a href="${esc(q.source)}" target="_blank" rel="noopener noreferrer" class="market-tile"><div class="text-[11px] font-medium text-muted-foreground truncate">${esc(q.name||q.symbol)}</div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">${Number(q.price).toLocaleString()}</span><span class="text-xs font-medium tabular-nums ${up?'text-up':'text-down'}">${up?'+':''}${q.changePct}%</span></div></a>`;}
function tileEdit(q,item){const up=q.changePct>=0;return `<div data-symbol="${esc(item.symbol)}" draggable="true" class="market-tile cursor-move ${item.hidden?'opacity-50':''}"><div class="flex items-center justify-between gap-1"><span class="text-[11px] font-medium text-muted-foreground truncate">⠿ ${esc(q.name||q.symbol)}</span><span class="flex items-center gap-0.5"><button data-hide="${esc(item.symbol)}" title="${item.hidden?'show':'hide'}" class="btn btn-ghost h-5 w-5 p-0 text-xs leading-none">${item.hidden?'◉':'◌'}</button><button data-del="${esc(item.symbol)}" title="remove" class="btn btn-ghost h-5 w-5 p-0 text-xs leading-none text-destructive">✕</button></span></div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">${Number(q.price).toLocaleString()}</span><span class="text-xs font-medium tabular-nums ${up?'text-up':'text-down'}">${up?'+':''}${q.changePct}%</span></div></div>`;}

function render(map,updatedAt){const el=$('[data-markets]');if(!el)return;const parts=[];
  for(const item of layout){const q=map.get(item.symbol);if(!q)continue;if(item.hidden&&!edit)continue;parts.push(edit?tileEdit(q,item):tileView(q));}
  el.innerHTML=parts.join('')||`<p class="col-span-full text-xs text-muted-foreground">—</p>`;
  wireTiles();
  const st=$('[data-markets-status]');if(st&&updatedAt){const secs=Math.max(0,Math.round((Date.now()-Date.parse(updatedAt))/1000));st.textContent=`· ${secs}s`;}}

async function refresh(){const syms=layout.map(x=>x.symbol);if(!syms.length){render(new Map(),null);return;}try{const r=await fetch('/api/markets?symbols='+encodeURIComponent(syms.join(',')),{cache:'no-store'});if(!r.ok)return;const d=await r.json();render(new Map((d.items||[]).map(q=>[q.symbol,q])),d.updatedAt);}catch{}}

function addSymbol(sym){sym=String(sym||'').trim().replace(/^\./,'^').toUpperCase();if(!sym)return;if(!layout.some(x=>x.symbol===sym)){layout.push({symbol:sym,hidden:false});saveLayout();}refresh();}

function wireTiles(){$$('[data-markets] [data-symbol]').forEach(el=>{
  el.addEventListener('click',e=>{const h=e.target.closest('[data-hide]');const d=e.target.closest('[data-del]');
    if(h){const it=layout.find(x=>x.symbol===h.dataset.hide);if(it){it.hidden=!it.hidden;saveLayout();}refresh();return;}
    if(d){layout=layout.filter(x=>x.symbol!==d.dataset.del);saveLayout();refresh();return;}});
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

/* symbol search */
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
