const theme=document.querySelector('[data-theme]');
theme?.addEventListener('click',()=>{const dark=document.documentElement.classList.toggle('dark');localStorage.setItem('radar-theme',dark?'dark':'light');theme.setAttribute('aria-pressed',String(dark));});
const search=document.querySelector('[data-search]');
const buttons=[...document.querySelectorAll('[data-filter]')];let category='all';
function filter(){const query=search?.value.toLowerCase()||'';let shown=0;document.querySelectorAll('[data-event]').forEach(e=>{const visible=(category==='all'||e.dataset.category===category)&&e.textContent.toLowerCase().includes(query);e.hidden=!visible;if(visible)shown++;});
  document.querySelectorAll('[data-board]').forEach(section=>{const any=section.querySelector('[data-event]:not([hidden])');section.hidden=!any;});
  const no=document.querySelector('[data-no-results]');if(no)no.hidden=shown!==0;}
search?.addEventListener('input',filter);
buttons.forEach(b=>b.addEventListener('click',()=>{category=b.dataset.filter;buttons.forEach(x=>{const active=x===b;x.setAttribute('aria-pressed',String(active));x.classList.toggle('bg-zinc-900',active);x.classList.toggle('text-white',active);});filter();}));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function liveMarkets(){try{const r=await fetch('/api/markets',{cache:'no-store'});if(!r.ok)return;const d=await r.json();const el=document.querySelector('[data-markets]');if(!el||!Array.isArray(d.items)||!d.items.length)return;
  el.innerHTML=d.items.map(q=>`<a href="${esc(q.source)}" target="_blank" rel="noopener noreferrer" class="p-5 border-r rule no-underline"><div class="text-[10px] uppercase tracking-widest muted">${esc(q.name)}</div><div class="flex justify-between gap-3 items-baseline mt-2"><span class="number text-xl">${Number(q.price).toLocaleString()}</span><span class="number text-xs ${q.changePct>=0?'text-lime-600 dark:text-lime-400':'text-red-500'}">${q.changePct>=0?'+':''}${q.changePct}%</span></div></a>`).join('');}catch{}}
liveMarkets();setInterval(liveMarkets,30000);
