const theme=document.querySelector('[data-theme]');
theme?.addEventListener('click',()=>{const dark=document.documentElement.classList.toggle('dark');localStorage.setItem('radar-theme',dark?'dark':'light');theme.setAttribute('aria-pressed',String(dark));});
const search=document.querySelector('[data-search]');
const buttons=[...document.querySelectorAll('[data-filter]')];let category='all';
function filter(){const query=search?.value.toLowerCase()||'';let shown=0;document.querySelectorAll('[data-event]').forEach(e=>{const visible=(category==='all'||e.dataset.category===category)&&e.textContent.toLowerCase().includes(query);e.hidden=!visible;if(visible)shown++;});
  document.querySelectorAll('[data-board]').forEach(section=>{const any=section.querySelector('[data-event]:not([hidden])');section.hidden=!any;});
  const no=document.querySelector('[data-no-results]');if(no)no.hidden=shown!==0;}
search?.addEventListener('input',filter);
buttons.forEach(b=>b.addEventListener('click',()=>{category=b.dataset.filter;buttons.forEach(x=>{const active=x===b;x.setAttribute('aria-pressed',String(active));x.classList.toggle('bg-zinc-900',active);x.classList.toggle('text-white',active);});filter();}));
