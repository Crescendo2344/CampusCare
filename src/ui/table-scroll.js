// Apply one responsive scroll policy to every data table, including dynamically rendered modals.
const managed=new WeakMap();
export function limitTableRows(wrap,limit=10){
  if(!wrap)return;
  const table=wrap.querySelector('table');if(!table)return;
  const previous=managed.get(wrap);if(previous?.table===table)return;
  // Filters may replace the table itself while retaining the surrounding panel.
  previous?.dispose();
  const win=wrap.ownerDocument.defaultView;
  const measure=()=>{
    const rows=[...table.querySelectorAll('tbody>tr')],viewport=win.visualViewport?.height||win.innerHeight;
    const tenRows=(table.tHead?.getBoundingClientRect().height||0)+rows.slice(0,limit).reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)+2;
    // Leave space for navigation, filters and footer; short tables keep their natural height.
    const top=wrap.getBoundingClientRect().top;
    const room=top>=0&&top<viewport*.6?viewport-top-24:viewport*.62;
    const cap=Math.max(140,Math.min(viewport*.62,room,tenRows||viewport*.62));
    wrap.style.maxHeight=Math.ceil(cap)+'px';
  };
  wrap.classList.add('data-table-scroll');
  wrap.setAttribute('tabindex','0');wrap.setAttribute('role','region');
  if(!wrap.hasAttribute('aria-label'))wrap.setAttribute('aria-label','Data table — scroll to see more rows and columns');
  const resize=win.ResizeObserver?new win.ResizeObserver(measure):null;
  resize?.observe(table);win.addEventListener('resize',measure);win.visualViewport?.addEventListener('resize',measure);
  managed.set(wrap,{table,measure,dispose(){resize?.disconnect();win.removeEventListener('resize',measure);win.visualViewport?.removeEventListener('resize',measure);managed.delete(wrap);}});
  measure();
}

export function installTableScrolling(root=document){
  const active=new Set();let scheduled=false;
  const scan=()=>{
    scheduled=false;
    for(const wrap of active)if(!wrap.isConnected){managed.get(wrap)?.dispose();active.delete(wrap);}
    for(const table of root.querySelectorAll('table')){
      // Reuse established scroll containers; add one only for previously unwrapped data tables.
      let wrap=table.closest('.table-wrap,.cert-table-wrap,.data-table-scroll');
      if(!wrap){wrap=root.createElement('div');wrap.className='table-wrap';table.before(wrap);wrap.append(table);}
      limitTableRows(wrap);active.add(wrap);managed.get(wrap)?.measure();
    }
  };
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(scan);}});
  observer.observe(root.body,{childList:true,subtree:true});scan();
  return ()=>{observer.disconnect();for(const wrap of active)managed.get(wrap)?.dispose();active.clear();};
}
