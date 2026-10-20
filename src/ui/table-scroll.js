// Limit a table by actual row heights, so wrapping names and mobile action buttons still count as ten rows.
export function limitTableRows(wrap,limit=10){
  const table=wrap.querySelector('table');if(!table)return;
  const win=wrap.ownerDocument.defaultView;
  const measure=()=>{const rows=[...table.querySelectorAll('tbody>tr')];const height=rows.length>limit?(table.tHead?.getBoundingClientRect().height||0)+rows.slice(0,limit).reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)+1:0;const next=height?Math.ceil(height)+'px':'none';if(wrap.style.maxHeight!==next)wrap.style.maxHeight=next;};
  measure();const resize=win.ResizeObserver?new win.ResizeObserver(measure):null;resize?.observe(table);
  const detach=win.MutationObserver?new win.MutationObserver(()=>{if(!wrap.isConnected){resize?.disconnect();detach.disconnect();}}):null;detach?.observe(wrap.ownerDocument.body,{childList:true,subtree:true});
}
