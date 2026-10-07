// Shared formatting helpers have no dependency on application state or the DOM.
export function getSemester(dateStr){
  if(!dateStr)return null;
  const d=new Date(dateStr);const yr=d.getFullYear();const mo=d.getMonth()+1;
  return mo<=6?`${yr}-S1`:`${yr}-S2`;
}

export function fmtDate(d){
  if(!d)return '-';
  const value=String(d).trim();
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value);
  const dt=new Date(dateOnly?`${value}T00:00:00`:value);
  if(Number.isNaN(dt.getTime()))return '-';
  return dt.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});
}

export function fmtDateTime(d){
  if(!d)return '-';
  const dt=new Date(d);
  if(Number.isNaN(dt.getTime()))return '-';
  return dt.toLocaleString('en-PH',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

export function fmtTime(t){if(!t)return'-';const [h,m]=t.split(':');const hr=parseInt(h);return `${hr===0?12:hr>12?hr-12:hr}:${m} ${hr<12?'AM':'PM'}`;}

export function genId(prefix,n){return`${prefix}-${String(n).padStart(4,'0')}`;}
