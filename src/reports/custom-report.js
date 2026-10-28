import {state} from '../app/state.js';
import {bindAction} from '../dependencies.js';
import {escapeHtml} from '../features/issueReports.js';
import {reportDefinitions,reportLabels,filterReportRows,groupReportRows} from '../domain/report-analysis.js';
import {reportData} from './report-data.js';
import {chartTypeSwitchHtml,reportChartHtml} from '../ui/report-chart.js';
const esc=value=>escapeHtml(String(value??''));
const value=id=>document.getElementById(id)?.value||'';
export function reportSelect(id,label,options,callback){
  return `<div class="form-group"><label for="${id}">${label}</label><select id="${id}" ${callback?bindAction('change',callback):''}>${options.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>`;
}
export function markReportStale(){
  const note=document.getElementById('rpt-stale');if(note)note.hidden=false;
  // Exports belong to the displayed result, never to newly edited filter values.
}
export function customReportControls(){
  const type=value('rpt-type'),definition=reportDefinitions[type];
  const host=document.getElementById('rpt-custom-controls');if(!host)return;
  if(!definition){host.innerHTML='';return;}
  const data=reportData()[type];
  const dimensions=definition.groups.filter(k=>!['date','week','month','doctor','diagnosis','item','blood'].includes(k));
  host.innerHTML=`<div class="report-control-grid">
    ${reportSelect('rpt-group','Group rows by',definition.groups.map(k=>[k,reportLabels[k]]),markReportStale)}
    ${reportSelect('rpt-split','Then break down by',[['','No second breakdown'],...definition.groups.map(k=>[k,reportLabels[k]])],markReportStale)}
    ${reportSelect('rpt-measure','Measure',definition.measures.map(k=>[k,reportLabels[k]]),markReportStale)}
    ${dimensions.filter(k=>k!=='college').map(k=>reportSelect('rpt-filter-'+k,reportLabels[k],[['','All'],...[...new Set(data.map(r=>r[k]||'Not recorded'))].sort().map(v=>[v,v])],markReportStale)).join('')}
    <div class="form-group"><label for="rpt-search">Search matching records</label><input type="search" id="rpt-search" placeholder="Name, ID or keyword" ${bindAction('input',markReportStale)}></div>
  </div><p class="form-note">${type==='inventory'?'Current stock snapshot. Date range and college do not apply. Stock value uses recorded unit costs; quantities with different units are not added together.':type==='patients'?'Current non-archived patient snapshot. The date range does not reconstruct past patient counts.':'Filters combine with the date range and college above. Counts use the appointment date or treatment date.'}</p>`;
}
export function reportBars(rows,{forecast=false}={}){
  if(!rows.length)return '<p class="form-note">No matching data. Try a wider date range or fewer filters.</p>';
  const max=Math.max(1,...rows.map(r=>Number(r.value)));
  return `<div class="report-bars" role="img" aria-label="${forecast?'Forecast by week':'Report breakdown; exact values are in the table below'}">${rows.slice(0,12).map(r=>`<div class="report-bar-row"><span title="${esc(r.label)}">${esc(r.label)}</span><div class="report-bar-track"><i style="width:${Math.max(0,Number(r.value)/max*100)}%"></i></div><strong>${Number(r.value).toLocaleString(undefined,{maximumFractionDigits:1})}</strong></div>`).join('')}</div>${rows.length>12?'<p class="form-note">First 12 groups shown. All groups are included in the table and export.</p>':''}`;
}
export function buildCustomReport(exportToolbar){
  const type=value('rpt-type'),definition=reportDefinitions[type];if(!definition)return;
  const from=value('rpt-from'),to=value('rpt-to');
  const filters={from,to,college:type==='inventory'?'':value('rpt-college'),search:value('rpt-search').trim()};
  for(const key of ['clinic','status','personType','classSession','sex','category','stock'])filters[key]=value('rpt-filter-'+key);
  const group=value('rpt-group')||definition.groups[0],split=value('rpt-split'),measure=value('rpt-measure')||'count';
  if(!definition.groups.includes(group)||(split&&!definition.groups.includes(split))||!definition.measures.includes(measure))throw new Error('Select a supported grouping and measure.');
  if(group===split)throw new Error('Choose a different second breakdown or select No second breakdown.');
  const rows=filterReportRows(reportData()[type],type,filters),groups=groupReportRows(rows,{group,split,measure});
  const total=measure==='patients'?new Set(rows.map(r=>r.patientId).filter(id=>id!=null)).size:groups.reduce((sum,r)=>sum+r.value,0);
  const title=`${definition.label} — ${reportLabels[measure]} by ${reportLabels[group]}${split?' and '+reportLabels[split]:''}`;
  const snapshot=['patients','inventory'].includes(type);
  const scope=snapshot?`Current snapshot · ${state.clinicInformation.TODAY}`:`${from} to ${to}`;
  const applied=[scope,...Object.entries(filters).filter(([k,v])=>v&&!['from','to'].includes(k)).map(([k,v])=>`${reportLabels[k]||k}: ${v}`)].join(' · ');
  const columns=[reportLabels[group],...(split?[reportLabels[split]]:[]),reportLabels[measure]];
  const summaryRows=groups.map(r=>Object.fromEntries(columns.map((c,i)=>[c,[r.group,...(split?[r.split]:[]),Number(r.value.toFixed(2))][i]])));
  const detailColumns=Object.keys(rows[0]||{}).filter(k=>['id','patient','college','clinic','date','doctor','diagnosis','status','personType','classSession','sex','blood','item','category','qty','unit','value','stock'].includes(k));
  const details=rows.map(r=>Object.fromEntries(detailColumns.map(k=>[reportLabels[k]||k,r[k]??'—'])));
  const setExport=list=>{state.reportCharts.lastReportRows=list;state.reportCharts.lastReportTitle=`${title} ${scope} ${filters.college||'All colleges'}`;};
  setExport(summaryRows);
  const host=document.getElementById('rpt-result');
  host.innerHTML=`<div class="card report-result"><div class="card-header"><div><h3>${esc(title)}</h3><p class="form-note">${esc(applied)}</p></div><span class="intel-badge">${rows.length} matching records</span></div>
    <p id="rpt-stale" class="report-stale" role="status" hidden>Filters changed. Generate the report again to update these results.</p>
    <div class="report-answer"><span>${esc(reportLabels[measure])}</span><strong>${measure==='value'?'₱':''}${total.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><small>${groups.length} group${groups.length===1?'':'s'}${measure==='patients'?' · A patient can appear in more than one group.':''}</small></div>
    <div id="rpt-chart-block"></div>
    <h4>Summary table</h4><div class="table-wrap report-table-scroll"><table><thead><tr>${columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${summaryRows.map(r=>`<tr>${columns.map(c=>`<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${!rows.length?'<p>No records match these filters.</p>':`<details class="report-details"><summary>View ${rows.length} matching records</summary><div class="table-wrap report-table-scroll"><table><thead><tr>${detailColumns.map(c=>`<th>${esc(reportLabels[c]||c)}</th>`).join('')}</tr></thead><tbody>${details.map(r=>`<tr>${Object.values(r).map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`}
    ${rows.length?reportSelect('rpt-export-scope','CSV / Excel / Word contents',[['summary','Summary table'],['details','Matching records']],()=>setExport(value('rpt-export-scope')==='details'?details:summaryRows)):''}
    </div>${rows.length?exportToolbar():''}`;
  const chartRows=groups.map(r=>({label:r.group+(split?' · '+r.split:''),value:r.value}));
  const drawChart=()=>{
    const block=document.getElementById('rpt-chart-block');if(!block)return;
    const type=state.reports.customChart||'bar';
    block.innerHTML=`<div class="report-chart-head"><span class="form-note">Chart</span>${chartTypeSwitchHtml(type,id=>bindAction('click',()=>{state.reports.customChart=id;drawChart();}))}</div>${reportChartHtml(chartRows,{type,label:title})}`;
  };
  drawChart();
}
