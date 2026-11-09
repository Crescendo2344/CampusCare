// Shared formatting helpers have no dependency on application state or the DOM.
// Semester key for a date, named by school year: 1st Semester runs July–December and
// 2nd Semester January–June of the following calendar year (SY 2026–2027 → 2026-S1, 2026-S2).
// With the clinic's configured semester dates, a date inside a range uses that range instead.
export function getSemester(dateStr,settings={}){
  if(!dateStr)return null;
  const day=String(dateStr).slice(0,10);
  const within=(from,to)=>from&&to&&day>=from&&day<=to;
  if(within(settings.semesterStart,settings.semesterEnd))return `${settings.semesterStart.slice(0,4)}-S1`;
  if(within(settings.semester2Start,settings.semester2End))return `${settings.semesterStart?.slice(0,4)||Number(settings.semester2Start.slice(0,4))-1}-S2`;
  const yr=Number(day.slice(0,4)),mo=Number(day.slice(5,7));
  return mo>=7?`${yr}-S1`:`${yr-1}-S2`;
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
