// Stateless display helpers retain the existing labels, classes and SVG markup.
export function statusBadge(s){
  const map={Scheduled:'info',Completed:'success',Cancelled:'danger','Pending':'warning','Active':'success','Suspended':'danger','No-show':'gray'};
  return `<span class="badge badge-${map[s]||'gray'}">${s}</span>`;
}

export function collegeBadge(c){
  if(!c)return '';
  return `<span class="badge college-${c}">${c}</span>`;
}

export function priorityBadge(p){
  const map={Student:'info',Teaching:'teal','Non-Teaching':'gray'};
  return `<span class="badge badge-${map[p]||'gray'}">${p||'-'}</span>`;
}

export function svgIcon(d,sz=14){return`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:${sz}px;height:${sz}px;vertical-align:middle"><path stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;}
