// Build card-specific trends from dated records; unknown timestamps are never invented.
export function metricSeries(points,records,{date=r=>r.date,label='Records in range',cumulative=false,unique=null,from='',to=''}={}){
  const dated=records.map(row=>({row,date:String(date(row)||'').slice(0,10)})).filter(entry=>/^\d{4}-\d{2}-\d{2}$/.test(entry.date));
  if(!dated.length)return {values:[],label:'No dated records for this metric'};
  return {label,values:points.map(point=>{
    // A monthly bucket must stop at the chosen To date, including cumulative series.
    const end=point.key.length===7?point.key+'-31':point.key;
    const ceiling=to&&to<end?to:end;
    const selected=dated.filter(entry=>entry.date<=ceiling&&(cumulative||entry.date.startsWith(point.key)&&(!from||entry.date>=from)));
    return unique?new Set(selected.map(entry=>unique(entry.row))).size:selected.length;
  })};
}
