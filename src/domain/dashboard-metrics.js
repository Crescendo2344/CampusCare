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

const dayMs=864e5;
const isoDay=time=>new Date(time).toISOString().slice(0,10);
// Compare the selected date range with the equally long period just before it.
export function periodComparison(records,{date=r=>r.date,from,to}){
  const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
  if(Number.isNaN(start)||Number.isNaN(end)||end<start)return null;
  const days=Math.round((end-start)/dayMs)+1;
  const prevTo=isoDay(start-dayMs),prevFrom=isoDay(start-days*dayMs);
  let current=0,previous=0;
  for(const row of records){
    const day=String(date(row)||'').slice(0,10);
    if(day>=from&&day<=to)current++;
    else if(day>=prevFrom&&day<=prevTo)previous++;
  }
  return {current,previous,delta:current-previous,days};
}

// Plain-language trend line; "upIs" says whether a rise is good, bad or neutral for this metric.
// "unit" names what was counted when it is not the card's own value, e.g. "new" registrations.
export function describeTrend(comparison,{upIs='neutral',unit=''}={}){
  if(!comparison)return null;
  const {current,previous,delta,days}=comparison;
  const period=days===1?'the previous day':`the previous ${days} days`;
  if(delta===0){
    if(!current)return {direction:'flat',sentiment:'neutral',text:unit?`Nothing ${unit} in this or ${period}`:`None in this or ${period}`};
    return {direction:'flat',sentiment:'neutral',text:unit?`${current} ${unit}, same as ${period}`:`Same as ${period}`};
  }
  const direction=delta>0?'up':'down';
  const sentiment=upIs==='neutral'?'neutral':(direction==='up')===(upIs==='good')?'good':'bad';
  const amount=Math.abs(delta);
  const percent=previous?` (${delta>0?'+':'−'}${Math.round(amount/previous*100)}%)`:'';
  const counted=unit?`${amount} ${unit}`:String(amount);
  return {direction,sentiment,text:previous?`${counted}${percent} vs ${period}`:`${unit?counted:amount+' new'} · none in ${period}`};
}
