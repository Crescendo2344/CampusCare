import {ctuFooterHtml,ctuHeaderHtml,printCtuDocument} from '../shared/ctu-letterhead.js';
import {buildCustomReport,customReportControls} from '../reports/custom-report.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {generateStudentReport} from '../reports/student-report.js';
// reportCharts: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {toast} from './theme.js';
import {bindAction} from '../dependencies.js';
import {csvFileName,objectsToCsv} from '../shared/csv.js';
// ================================================================
// REPORT DATA VISUALIZATION (Chart.js, loaded on demand) + EXPORT
// ================================================================

 // Kept for backward compatibility; SVG charts do not need a Chart.js instance.

export function updateReportMetricOptions(){
  const type=document.getElementById('rpt-type').value;
  const filters=document.getElementById('student-report-filters');
  if(filters)filters.hidden=type!=='students';
  customReportControls();
  document.querySelector('[data-report-view="builder"]')?.click();
  document.getElementById('rpt-result').innerHTML='';
  appState.reportCharts.lastReportRows=[];
  appState.reportCharts.studentReportToken=(appState.reportCharts.studentReportToken||0)+1;
}

export function vizCardHtml(type){
  const metrics=appState.reportCharts.REPORT_METRICS[type];
  return `<div class="card">
    <div class="card-header"><h3><i class="bi bi-bar-chart" aria-hidden="true"></i> Data Visualization</h3></div>
    <div class="toolbar" style="margin-bottom:.9rem">
      <select id="rpt-charttype" ${bindAction('change',(event,element)=>{renderReportChart()})}>
        <option value="bar">Bar Chart</option>
        <option value="pie">Pie Chart</option>
        <option value="doughnut">Doughnut Chart</option>
        <option value="line">Line Chart</option>
      </select>
      <select id="rpt-metric" ${bindAction('change',(event,element)=>{renderReportChart()})}>${metrics.map(m=>`<option value="${m.value}">${m.label}</option>`).join('')}</select>
    </div>
    <div style="max-width:640px;margin:0 auto;position:relative;height:340px">
      <div id="rpt-chart-host" class="report-chart-host"></div>
    </div>
  </div>`;
}

export function computeMetricData(type,metric,rows){
  rows=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key[0].toLowerCase()+key.slice(1),value])));
  if(type==='patients')rows=rows.map(r=>({...r,personType:r.personType||r.type}));

  const count=(arr,keyFn)=>{
    const m={};
    arr.forEach(item=>{const k=keyFn(item)||'Unknown';m[k]=(m[k]||0)+1;});
    return m;
  };
  if(type==='appointments'){
    if(metric==='status')return count(rows,a=>a.status);
    if(metric==='clinic')return count(rows,a=>a.clinic);
    if(metric==='college')return count(rows,a=>a.college);
    if(metric==='trend'){
      const m={};rows.forEach(a=>{m[a.date]=(m[a.date]||0)+1;});
      return Object.fromEntries(Object.entries(m).sort((x,y)=>x[0].localeCompare(y[0])));
    }
  }else if(type==='treatments'){
    if(metric==='diagnosis')return count(rows,t=>t.diagnosis||'Unspecified');
    if(metric==='trend'){
      const m={};rows.forEach(t=>{m[t.date]=(m[t.date]||0)+1;});
      return Object.fromEntries(Object.entries(m).sort((x,y)=>x[0].localeCompare(y[0])));
    }
  }else if(type==='inventory'){
    if(metric==='category')return rows.reduce((m,i)=>{m[i.category]=(m[i.category]||0)+i.qty;return m;},{});
    if(metric==='stocklevel')return count(rows,i=>i.qty<=i.threshold?'Low':i.qty<=i.threshold*1.5?'Medium':'Good');
  }else if(type==='patients'){
    if(metric==='college')return count(rows,p=>p.college);
    if(metric==='type')return count(rows,p=>p.personType);
  }
  return {};
}

export function renderReportChart(){
  clearTimeout(appState.reportCharts._reportChartTimeout);
  appState.reportCharts._reportChartTimeout=setTimeout(renderReportChartNow,120);
}

// Renders report charts with inline SVG/CSS so Reports & Analytics works offline.
export function renderReportChartNow(){
  const type=document.getElementById('rpt-type').value;
  const metric=(document.getElementById('rpt-metric')||{}).value||appState.reportCharts.REPORT_METRICS[type][0].value;
  const chartType=(document.getElementById('rpt-charttype')||{}).value||'bar';
  const host=document.getElementById('rpt-chart-host');
  if(!host)return;
  const data=computeMetricData(type,metric,appState.reportCharts.lastReportRows);
  const labels=Object.keys(data);
  const values=Object.values(data).map(Number);
  const metricObj=appState.reportCharts.REPORT_METRICS[type].find(m=>m.value===metric);
  if(!labels.length){host.innerHTML='<div class="dashboard-trend-empty">No data to visualize for this selection.</div>';return;}

  const palette=['#0a7ea8','#3aa8d8','#5b4fd6','#0b7d63','#c62828','#a15c00','#b0431e','#2e7d32','#5cb3ea','#a89bf5'];
  const esc=s=>escapeHtml(String(s));

  // Pie and doughnut charts use conic-gradient, which is responsive and dependency-free.
  if(chartType==='pie'||chartType==='doughnut'){
    const total=values.reduce((a,b)=>a+b,0)||1;
    let acc=0;
    const stops=values.map((v,i)=>{const a=acc/total*360;acc+=v;const b=acc/total*360;return `${palette[i%palette.length]} ${a}deg ${b}deg`;}).join(',');
    const hole=chartType==='doughnut'?'<div style="position:absolute;inset:24%;border-radius:50%;background:var(--glass-surface-strong);display:flex;align-items:center;justify-content:center;flex-direction:column"><strong style="font-size:1.2rem">'+values.reduce((a,b)=>a+b,0).toLocaleString()+'</strong><span class="text-muted">Total</span></div>':'';
    host.innerHTML=`<div style="width:min(230px,65vw);aspect-ratio:1;border-radius:50%;background:conic-gradient(${stops});position:relative;box-shadow:var(--glass-shadow-sm)">${hole}</div>`;
    host.insertAdjacentHTML('afterend',`<div class="report-chart-legend" id="rpt-chart-legend">${labels.map((l,i)=>`<span><i style="background:${palette[i%palette.length]}"></i>${esc(l)}: <strong>${values[i].toLocaleString()}</strong></span>`).join('')}</div>`);
    const old=document.querySelectorAll('#rpt-chart-legend');if(old.length>1)old[0].remove();
    return;
  }

  const w=720,h=320,pl=52,pr=18,pt=22,pb=58,max=Math.max(1,...values);
  const y=v=>pt+(max-v)*(h-pt-pb)/max;
  const grid=[0,.25,.5,.75,1].map(r=>{const yy=pt+r*(h-pt-pb);const val=Math.round(max*(1-r));return `<line x1="${pl}" y1="${yy}" x2="${w-pr}" y2="${yy}" stroke="currentColor" opacity=".08"/><text x="${pl-8}" y="${yy+3}" text-anchor="end" font-size="10" fill="currentColor" opacity=".55">${val}</text>`;}).join('');
  let marks='';
  if(chartType==='line'){
    const x=i=>pl+i*(w-pl-pr)/Math.max(1,labels.length-1);
    const pts=values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
    marks=`<polyline points="${pts}" fill="none" stroke="var(--primary-mid)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`+values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="var(--primary-mid)"><title>${esc(labels[i])}: ${v}</title></circle>`).join('')+labels.map((l,i)=>`<text x="${x(i)}" y="${h-20}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".65">${esc(l.length>13?l.slice(0,12)+'…':l)}</text>`).join('');
  }else{
    const avail=w-pl-pr,gap=10,bw=Math.max(12,(avail-gap*(labels.length+1))/Math.max(1,labels.length));
    marks=values.map((v,i)=>{const x=pl+gap+i*(bw+gap),yy=y(v),bh=h-pb-yy;return `<rect x="${x}" y="${yy}" width="${bw}" height="${Math.max(1,bh)}" rx="5" fill="var(--primary-mid)" opacity=".82"><title>${esc(labels[i])}: ${v}</title></rect><text x="${x+bw/2}" y="${h-20}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".65">${esc(labels[i].length>12?labels[i].slice(0,11)+'…':labels[i])}</text>`;}).join('');
  }
  host.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(metricObj?metricObj.label:'Report chart')}">${grid}${marks}</svg>`;
  const legend=document.getElementById('rpt-chart-legend');if(legend)legend.remove();
}

export function exportToolbarHtml(){
  return `<div class="card">
    <div class="card-header"><h3>Export Report</h3></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      <button class="btn btn-sm" ${bindAction('click',(event,element)=>{exportReportCSV()})}>⬇️ CSV</button>
      <button class="btn btn-sm btn-success" ${bindAction('click',(event,element)=>{exportReportExcel()})}><i class="bi bi-file-earmark-excel" aria-hidden="true"></i> Excel (.xlsx)</button>
      <button class="btn btn-sm btn-info" ${bindAction('click',(event,element)=>{exportReportWord()})}><i class="bi bi-file-earmark-word" aria-hidden="true"></i> Word (.doc)</button>
      <button class="btn btn-sm btn-danger" ${bindAction('click',(event,element)=>{exportReportPDF()})}><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i> PDF (Print)</button>
    </div>
  </div>`;
}

export function downloadBlob(content,filename,mime){
  const blob=new Blob([content],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},100);
}

// Report tables keep their column labels as the header row, in the shared CampusCare CSV format.
export function rowsToCSV(rows){
  return rows.length?objectsToCsv(rows):'';
}

// One exporter for every Reports & Analytics table: CSV, Excel, Word and PDF, the last two on the CTU letterhead.
// `rows` are plain objects whose keys are the column headings; `csv` may supply the grouped CSV layout instead.
const fileStem=title=>String(title||'CampusCare report').trim().replace(/[^\w.-]+/g,'_');
function tableHtml(rows){
  const headers=Object.keys(rows[0]||{});
  const cell='border:1px solid #bbb;padding:4px 8px;text-align:left';
  return `<table style="border-collapse:collapse;width:100%;font-size:11px"><thead><tr>${headers.map(h=>`<th style="${cell};background:#eef3f6">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td style="${cell}">${r[h]==null?'':escapeHtml(String(r[h]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
export async function exportTable({title,rows=[],format,csv=null,extraHtml='',csvName=''}){
  if(!rows.length){toast('There is nothing to export yet.','error');return;}
  const stem=fileStem(title);
  if(format==='csv'){
    downloadBlob(csv?csv():rowsToCSV(rows),csvName||csvFileName(title,appState.clinicInformation.TODAY),'text/csv;charset=utf-8;');
    toast('CSV exported.','success');return;
  }
  if(format==='xlsx'){
    try{
      const XLSX=await loadSheetJs();
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Report');
      XLSX.writeFile(wb,`${stem}.xlsx`);
      toast('Excel file exported.','success');
    }catch{toast('Could not load the Excel export library (needs an internet connection). Try CSV instead.','error');}
    return;
  }
  const generated=`CTU Main Medical &amp; Dental Clinic · Generated ${escapeHtml(new Date().toLocaleString('en-PH'))}`;
  if(format==='doc'){
    const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
    <body style="font-family:Arial,sans-serif">${ctuHeaderHtml()}
      <h2 style="text-align:center;font-size:15px">${escapeHtml(title)}</h2><p style="text-align:center;color:#555;font-size:11px">${generated}</p>
      ${tableHtml(rows)}${ctuFooterHtml()}</body></html>`;
    downloadBlob(html,`${stem}.doc`,'application/msword');
    toast('Word document exported.','success');return;
  }
  // PDF: the print dialog's "Save as PDF" keeps the letterhead on every page.
  toast('Opening print dialog — choose "Save as PDF" as the destination.','info');
  // Charts need the app's styles; the table and letterhead carry their own.
  const head=extraHtml?[...document.querySelectorAll('link[rel="stylesheet"],style')].map(node=>node.outerHTML).join(''):'';
  printCtuDocument({title,head,css:`body{background:#fff!important;color:#111!important}.doc-title{text-align:center;font-weight:700;font-size:15px;margin:4px 0 2px}.doc-sub{text-align:center;color:#555;margin:0 0 12px}.doc-extra{margin-bottom:12px}.doc-extra button,.doc-extra .chart-type-switch{display:none!important}`,
    body:`<div class="doc-title">${escapeHtml(title)}</div><p class="doc-sub">${generated}</p>${extraHtml?`<div class="doc-extra">${extraHtml}</div>`:''}${tableHtml(rows)}`});
}
// The four download buttons; `source()` returns {title,rows,csv?,extraHtml?} at click time.
export function exportButtonsHtml(source,{label='Download'}={}){
  const run=format=>()=>exportTable({...source(),format});
  return `<div class="report-export-buttons" role="group" aria-label="${escapeHtml(label)}"><span class="text-muted" style="font-size:.78rem;margin-right:.25rem">${escapeHtml(label)}:</span>
    <button type="button" class="btn btn-sm" ${bindAction('click',run('csv'))}><i class="bi bi-filetype-csv" aria-hidden="true"></i> CSV</button>
    <button type="button" class="btn btn-sm" ${bindAction('click',run('xlsx'))}><i class="bi bi-file-earmark-excel" aria-hidden="true"></i> Excel</button>
    <button type="button" class="btn btn-sm" ${bindAction('click',run('doc'))}><i class="bi bi-file-earmark-word" aria-hidden="true"></i> Word</button>
    <button type="button" class="btn btn-sm" ${bindAction('click',run('pdf'))}><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i> PDF</button></div>`;
}

export function exportReportCSV(){
  if(!appState.reportCharts.lastReportRows.length){toast('Generate a report first.','error');return;}
  return exportTable({title:appState.reportCharts.lastReportTitle,rows:appState.reportCharts.lastReportRows,format:'csv'});
}

export function loadSheetJs(){
  return new Promise((resolve,reject)=>{
    if(window.XLSX){resolve(window.XLSX);return;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('SheetJS failed to initialize'));
    s.onerror=()=>reject(new Error('Could not load Excel export library'));
    document.head.appendChild(s);
  });
}

export async function exportReportExcel(){
  if(!appState.reportCharts.lastReportRows.length){toast('Generate a report first.','error');return;}
  return exportTable({title:appState.reportCharts.lastReportTitle,rows:appState.reportCharts.lastReportRows,format:'xlsx'});
}

export function exportReportWord(){
  if(!appState.reportCharts.lastReportRows.length){toast('Generate a report first.','error');return;}
  return exportTable({title:appState.reportCharts.lastReportTitle,rows:appState.reportCharts.lastReportRows,format:'doc'});
}

export function exportReportPDF(){
  if(!appState.reportCharts.lastReportRows.length){toast('Generate a report first.','error');return;}
  // The report's charts and summary print above the table on the CTU letterhead.
  const result=document.getElementById('rpt-result');
  const charts=[...(result?.querySelectorAll('.report-chart,svg.report-svg,.stats-grid')||[])].slice(0,3).map(n=>n.outerHTML).join('');
  return exportTable({title:appState.reportCharts.lastReportTitle,rows:appState.reportCharts.lastReportRows,format:'pdf',extraHtml:charts});
}

export async function generateReport(){
  const type=document.getElementById('rpt-type').value;
  if(type!=='students')appState.reportCharts.studentReportToken=(appState.reportCharts.studentReportToken||0)+1;
  const from=document.getElementById('rpt-from').value;
  const to=document.getElementById('rpt-to').value;
  const college=document.getElementById('rpt-college').value;
  if(!from||!to){toast('Select a date range.','error');return;}
  if(from>to){toast('From date must be before To date.','error');return;}
  const el=document.getElementById('rpt-result');

  if(type==='students'){
    const reportAccount=appState.auth.currentUser,reportToken=captureCampusPageToken(),studentToken=(appState.reportCharts.studentReportToken||0)+1;
    try{await generateStudentReport(exportToolbarHtml,downloadBlob);}catch(error){
      if(appState.auth.currentUser!==reportAccount||!isCampusPageCurrent('reports',reportToken)||appState.reportCharts.studentReportToken!==studentToken)return;
      document.getElementById('rpt-result').innerHTML=`<div class="alert alert-danger show">${escapeHtml(error.message||'Report failed.')}</div>`;
    }
    return;
  }
  try{buildCustomReport(exportToolbarHtml);}catch(error){
    el.innerHTML=`<div class="alert alert-danger show" role="alert">${escapeHtml(error.message||'Unable to generate report.')}</div>`;
    appState.reportCharts.lastReportRows=[];
  }
}

// Run side effects only after every feature's function exports are available.
// State defaults are initialized by the application before this optional module loads.
