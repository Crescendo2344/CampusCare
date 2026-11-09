// One chart component for Reports & Analytics: the same rows can be shown as bars, columns, a line,
// an area, a pie or a doughnut. Rows are {label, value, projected?}; projected rows are estimates.
const esc=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:1});
const short=(text,max)=>{const s=String(text);return s.length>max?s.slice(0,max-1)+'…':s;};

export const CHART_TYPES=[
  ['bar','Bar','bi-bar-chart-steps'],
  ['column','Column','bi-bar-chart'],
  ['line','Line','bi-graph-up'],
  ['area','Area','bi-graph-up-arrow'],
  ['pie','Pie','bi-pie-chart'],
  ['doughnut','Doughnut','bi-circle']
];
export const isChartType=type=>CHART_TYPES.some(([id])=>id===type);
// Categorical palette shared by pie and doughnut slices.
const PALETTE=['#0a7ea8','#5b4fd6','#0b7d63','#c76a00','#c62828','#3aa8d8','#8a5cc7','#2e7d32','#b0431e','#5f7d95'];

export function chartTypeSwitchHtml(current,attrs=type=>''){
  return `<div class="chart-type-switch" role="radiogroup" aria-label="Chart type">${CHART_TYPES.map(([id,label,icon])=>`<button type="button" role="radio" aria-checked="${id===current}" class="${id===current?'active':''}" title="${label} chart" ${attrs(id)}><i class="bi ${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join('')}</div>`;
}

export function reportChartHtml(rows,{type='bar',label='Report chart',limit=12}={}){
  const list=rows.filter(r=>Number.isFinite(Number(r.value)));
  if(!list.length)return '<p class="form-note">No matching data. Try a wider date range or fewer filters.</p>';
  if(type==='pie'||type==='doughnut')return pieHtml(list,type,label);
  if(type==='column'||type==='line'||type==='area')return seriesHtml(list,type,label);
  return barsHtml(list,label,limit);
}

function barsHtml(rows,label,limit){
  const max=Math.max(1,...rows.map(r=>Number(r.value)));
  return `<div class="report-bars" role="img" aria-label="${esc(label)}">${rows.slice(0,limit).map(r=>`<div class="report-bar-row ${r.projected?'projected':''}"><span title="${esc(r.label)}">${esc(r.label)}</span><div class="report-bar-track"><i style="width:${Math.max(0,Number(r.value)/max*100)}%"></i></div><strong>${fmt(r.value)}</strong></div>`).join('')}</div>${rows.length>limit?`<p class="form-note">First ${limit} shown. All rows are in the table and export.</p>`:''}`;
}

function seriesHtml(rows,type,label){
  const w=960,h=300,pl=48,pr=16,pt=18,pb=44,max=Math.max(1,...rows.map(r=>Number(r.value)));
  const plotW=w-pl-pr,plotH=h-pt-pb,n=rows.length;
  const y=v=>pt+(max-v)*plotH/max;
  const step=plotW/Math.max(1,n);
  const cx=i=>type==='column'?pl+step*i+step/2:pl+(n===1?plotW/2:i*plotW/(n-1));
  const every=Math.max(1,Math.ceil(n/12));
  const grid=[0,.25,.5,.75,1].map(r=>{const yy=pt+r*plotH;return `<line x1="${pl}" y1="${yy}" x2="${w-pr}" y2="${yy}" class="chart-grid"/><text x="${pl-8}" y="${yy+3}" text-anchor="end" class="chart-axis">${fmt(max*(1-r))}</text>`;}).join('');
  // A date range is labelled by its first day so ticks stay short.
  const tick=label=>short(String(label).split(' – ')[0],12);
  const labels=rows.map((r,i)=>i%every?'':`<text x="${cx(i)}" y="${h-pb+18}" text-anchor="middle" class="chart-axis">${esc(tick(r.label))}</text>`).join('');
  const tip=r=>`<title>${esc(r.label)}: ${fmt(r.value)}${r.projected?' (estimate)':''}</title>`;
  let marks='';
  if(type==='column'){
    const bw=Math.max(4,Math.min(48,step*.7));
    marks=rows.map((r,i)=>{const top=y(Number(r.value));return `<rect x="${cx(i)-bw/2}" y="${top}" width="${bw}" height="${Math.max(1,h-pb-top)}" rx="4" class="chart-mark ${r.projected?'projected':''}">${tip(r)}</rect>`;}).join('');
  }else{
    const point=(r,i)=>`${cx(i)},${y(Number(r.value))}`;
    const split=rows.findIndex(r=>r.projected);
    const actual=split<0?rows:rows.slice(0,split),projected=split<0?[]:rows.slice(Math.max(0,split-1));
    const offset=split<0?0:Math.max(0,split-1);
    const path=(list,start)=>list.map((r,i)=>point(r,i+start)).join(' ');
    if(type==='area'){
      const area=(list,start,cls)=>list.length?`<polygon class="chart-area ${cls}" points="${cx(start)},${h-pb} ${path(list,start)} ${cx(start+list.length-1)},${h-pb}"/>`:'';
      marks+=area(actual,0,'')+area(projected,offset,'projected');
    }
    if(actual.length)marks+=`<polyline class="chart-line" points="${path(actual,0)}"/>`;
    if(projected.length)marks+=`<polyline class="chart-line projected" points="${path(projected,offset)}"/>`;
    marks+=rows.map((r,i)=>`<circle cx="${cx(i)}" cy="${y(Number(r.value))}" r="3.5" class="chart-dot ${r.projected?'projected':''}">${tip(r)}</circle>`).join('');
  }
  return `<div class="report-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${grid}<line x1="${pl}" y1="${h-pb}" x2="${w-pr}" y2="${h-pb}" class="chart-baseline"/>${marks}${labels}</svg></div>`;
}

// Slices beyond the first nine are combined so the legend stays readable.
function pieHtml(rows,type,label){
  const positive=rows.filter(r=>Number(r.value)>0);
  if(!positive.length)return '<p class="form-note">Nothing to show as slices: every value is zero.</p>';
  const sorted=positive.length>10?[...positive].sort((a,b)=>b.value-a.value):positive;
  const slices=sorted.length>10?[...sorted.slice(0,9),{label:`Other (${sorted.length-9})`,value:sorted.slice(9).reduce((s,r)=>s+Number(r.value),0)}]:sorted;
  const total=slices.reduce((s,r)=>s+Number(r.value),0);
  const r=90,c=110,inner=type==='doughnut'?52:0;
  let angle=-Math.PI/2;
  const arc=(a0,a1,radius)=>[c+radius*Math.cos(a0),c+radius*Math.sin(a0),c+radius*Math.cos(a1),c+radius*Math.sin(a1)];
  const paths=slices.map((s,i)=>{
    const share=Number(s.value)/total,a0=angle,a1=angle+share*Math.PI*2;angle=a1;
    const large=a1-a0>Math.PI?1:0,color=PALETTE[i%PALETTE.length];
    const tip=`<title>${esc(s.label)}: ${fmt(s.value)} (${Math.round(share*100)}%)</title>`;
    if(share>=.9999)return inner?`<circle cx="${c}" cy="${c}" r="${(r+inner)/2}" fill="none" stroke="${color}" stroke-width="${r-inner}">${tip}</circle>`:`<circle cx="${c}" cy="${c}" r="${r}" fill="${color}">${tip}</circle>`;
    const [x0,y0,x1,y1]=arc(a0,a1,r);
    if(!inner)return `<path d="M${c},${c} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z" fill="${color}">${tip}</path>`;
    const [ix1,iy1,ix0,iy0]=arc(a1,a0,inner);
    return `<path d="M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${ix1},${iy1} A${inner},${inner} 0 ${large} 0 ${ix0},${iy0} Z" fill="${color}">${tip}</path>`;
  }).join('');
  const centre=inner?`<text x="${c}" y="${c-2}" text-anchor="middle" class="chart-total">${fmt(total)}</text><text x="${c}" y="${c+16}" text-anchor="middle" class="chart-axis">Total</text>`:'';
  return `<div class="report-pie"><svg viewBox="0 0 220 220" role="img" aria-label="${esc(label)}">${paths}${centre}</svg>
    <ul class="report-chart-legend">${slices.map((s,i)=>`<li><i style="background:${PALETTE[i%PALETTE.length]}"></i><span>${esc(s.label)}</span><strong>${fmt(s.value)}</strong><small>${Math.round(Number(s.value)/total*100)}%</small></li>`).join('')}</ul></div>`;
}
