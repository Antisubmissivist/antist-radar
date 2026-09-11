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

/* ---------- markets: live + reorder + add/hide ---------- */
const DEFAULTS=['BTC-USD','ETH-USD','SOL-USD','^GSPC','^IXIC','^N225','NVDA','^VIX'];
const LS='radar-markets';let edit=false;
function loadLayout(){try{const a=JSON.parse(localStorage.getItem(LS));if(Array.isArray(a)&&a.length)return a.map(x=>typeof x==='string'?{symbol:x,hidden:false}:x).filter(x=>x&&x.symbol);}catch{}return DEFAULTS.map(s=>({symbol:s,hidden:false}));}
let layout=loadLayout();
const saveLayout=()=>localStorage.setItem(LS,JSON.stringify(layout));
let dragSym=null;

function tileView(q){const up=q.changePct>=0;return `<a href="${esc(q.source)}" target="_blank" rel="noopener noreferrer" class="market-tile"><div class="text-[11px] font-medium text-muted-foreground truncate">${esc(q.name||q.symbol)}</div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">${Number(q.price).toLocaleString()}</span><span class="text-xs font-medium tabular-nums ${up?'text-up':'text-down'}">${up?'+':''}${q.changePct}%</span></div></a>`;}
function tileEdit(q,item){const up=q.changePct>=0;return `<div data-symbol="${esc(item.symbol)}" draggable="true" class="market-tile cursor-move ${item.hidden?'opacity-50':''}"><div class="flex items-center justify-between gap-1"><span class="text-[11px] font-medium text-muted-foreground truncate">⠿ ${esc(q.name||q.symbol)}</span><button data-hide="${esc(item.symbol)}" class="btn btn-ghost h-5 w-5 p-0 text-xs leading-none" title="hide/show">${item.hidden?'+':'×'}</button></div><div class="flex items-baseline justify-between gap-2"><span class="text-lg font-semibold tabular-nums">${Number(q.price).toLocaleString()}</span><span class="text-xs font-medium tabular-nums ${up?'text-up':'text-down'}">${up?'+':''}${q.changePct}%</span></div></div>`;}

function render(map,updatedAt){const el=$('[data-markets]');if(!el)return;const parts=[];
  for(const item of layout){const q=map.get(item.symbol);if(!q)continue;if(item.hidden&&!edit)continue;parts.push(edit?tileEdit(q,item):tileView(q));}
  el.innerHTML=parts.join('')||`<p class="col-span-full text-xs text-muted-foreground">—</p>`;
  wireDrag();
  const st=$('[data-markets-status]');if(st&&updatedAt){const secs=Math.max(0,Math.round((Date.now()-Date.parse(updatedAt))/1000));st.textContent=`· ${secs}s`;}}

async function refresh(){const syms=layout.map(x=>x.symbol);if(!syms.length)return;try{const r=await fetch('/api/markets?symbols='+encodeURIComponent(syms.join(',')),{cache:'no-store'});if(!r.ok)return;const d=await r.json();render(new Map((d.items||[]).map(q=>[q.symbol,q])),d.updatedAt);}catch{}}

function wireDrag(){if(!edit)return;$$('[data-markets] [data-symbol]').forEach(el=>{
  el.addEventListener('dragstart',e=>{dragSym=el.dataset.symbol;el.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
  el.addEventListener('dragend',()=>{el.classList.remove('dragging');$$('.drop-target').forEach(x=>x.classList.remove('drop-target'));});
  el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drop-target');});
  el.addEventListener('dragleave',()=>el.classList.remove('drop-target'));
  el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drop-target');const to=el.dataset.symbol;if(!dragSym||dragSym===to)return;const from=layout.findIndex(x=>x.symbol===dragSym);const ti=layout.findIndex(x=>x.symbol===to);if(from<0||ti<0)return;const [m]=layout.splice(from,1);layout.splice(ti,0,m);saveLayout();refresh();});
  el.addEventListener('click',e=>{const b=e.target.closest('[data-hide]');if(!b)return;const it=layout.find(x=>x.symbol===b.dataset.hide);if(it){it.hidden=!it.hidden;saveLayout();refresh();}});
});}

const editBtn=$('[data-markets-edit]');const doneBtn=$('[data-markets-done]');const addInput=$('[data-markets-add]');
function setEdit(on){edit=on;editBtn?.classList.toggle('hidden',on);doneBtn?.classList.toggle('hidden',!on);addInput?.classList.toggle('hidden',!on);refresh();}
editBtn?.addEventListener('click',()=>setEdit(true));
doneBtn?.addEventListener('click',()=>setEdit(false));
addInput?.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const v=e.target.value.trim().toUpperCase();if(v&&!layout.some(x=>x.symbol===v)){layout.push({symbol:v,hidden:false});saveLayout();}e.target.value='';refresh();});

refresh();setInterval(()=>{if(!document.hidden)refresh();},12000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('focus',refresh);
