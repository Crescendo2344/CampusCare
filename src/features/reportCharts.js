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
      <button class="btn btn-sm btn-success" ${bindAction('click',(event,element)=>{exportReportExcel()})}><i class="bi bi-file-earmark-excel" aria-hidden="true"></i> Excel (.xlsx)</button>
      <button class="btn btn-sm btn-info" ${bindAction('click',(event,element)=>{exportReportWord()})}><i class="bi bi-file-earmark-word" aria-hidden="true"></i> Word (.docx)</button>
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

// One exporter for every Reports & Analytics table: Excel, Word and PDF (CSV stays for internal callers), the last two on the CTU letterhead.
// `rows` are plain objects whose keys are the column headings; `csv` may supply the grouped CSV layout instead.
const fileStem=title=>String(title||'CampusCare report').trim().replace(/[^\w.-]+/g,'_');
// Column keys written as "Group: Label" get a two-row heading: the group spans its columns.
export function tableHeadings(rows){
  const keys=Object.keys(rows[0]||{});
  const split=keys.map(k=>{const i=k.indexOf(': ');return i>0?{key:k,group:k.slice(0,i),label:k.slice(i+2)}:{key:k,group:'',label:k};});
  const grouped=split.some(c=>c.group);
  const groups=[];
  for(const c of split){const last=groups.at(-1);if(last&&last.label===c.group&&c.group)last.span++;else groups.push({label:c.group,span:1});}
  return {columns:split,grouped,groups};
}
const isNumeric=v=>typeof v==='number'||(/^-?\d+(\.\d+)?$/.test(String(v??''))&&String(v).length<12);
export function tableHtml(rows,{font=11,word=false}={}){
  const {columns,grouped,groups}=tableHeadings(rows);
  // Word wraps cells mid-word when columns are tight, so short values and headings stay on one line there.
  const th=`border:1px solid #9fb3bf;padding:${word?'3px 4px':'5px 7px'};background:#e6eff4;color:#12314a;font-weight:700;text-align:center;vertical-align:middle${word?';white-space:nowrap':''}`;
  const td=`border:1px solid #c5d2da;padding:${word?'2px 4px':'4px 7px'};vertical-align:top`;
  let head=`<tr>${columns.map(c=>`<th style="${th}">${escapeHtml(c.label)}</th>`).join('')}</tr>`;
  if(grouped){
    // Ungrouped columns span both heading rows; grouped ones share a group cell above their labels.
    let col=0;
    const top=groups.map(g=>{const first=columns[col];col+=g.span;
      return g.label?`<th colspan="${g.span}" style="${th}">${escapeHtml(g.label)}</th>`:`<th rowspan="2" style="${th}">${escapeHtml(first.label)}</th>`;}).join('');
    head=`<tr>${top}</tr><tr>${columns.filter(c=>c.group).map(c=>`<th style="${th}">${escapeHtml(c.label)}</th>`).join('')}</tr>`;
  }
  const body=rows.map((r,i)=>`<tr>${columns.map(c=>{const v=r[c.key];return `<td style="${td};${isNumeric(v)?'text-align:right;':''}${word&&String(v??'').length<=16?'white-space:nowrap;':''}${i%2?'background:#f7fafc;':''}">${v==null?'':escapeHtml(String(v))}</td>`;}).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;font-size:${font}px"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ExcelJS (styles, merged headings, images) is loaded only when someone exports to Excel.
function loadExcelJs(){
  return new Promise((resolve,reject)=>{
    if(window.ExcelJS){resolve(window.ExcelJS);return;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(new Error('ExcelJS failed to initialize'));
    s.onerror=()=>reject(new Error('Could not load Excel export library'));
    document.head.appendChild(s);
  });
}
// A formatted workbook: CTU heading with the seal, report title, styled (grouped) headings,
// bordered and banded rows, sized columns, a frozen heading and filters.
export async function excelWorkbook(title,rows){
  const ExcelJS=await loadExcelJs();
  const {columns,grouped,groups}=tableHeadings(rows);
  const wb=new ExcelJS.Workbook();wb.creator='CampusCare';wb.created=new Date();
  const ws=wb.addWorksheet('Report',{pageSetup:{paperSize:9,orientation:columns.length>7?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}});
  const n=columns.length,last=Math.max(n,3);
  const s=appState.data?.DB?.settings||{};
  const heading=[['CEBU TECHNOLOGICAL UNIVERSITY – MAIN CAMPUS',{bold:true,size:14,color:{argb:'FF12314A'}}],
    [`${s.clinicName||'CTU Main Medical & Dental Clinic'} · ${s.contactEmail||''} · ${s.contactPhone||''}`,{size:10,color:{argb:'FF4A5D68'}}],
    [title,{bold:true,size:13}],
    [`Generated ${new Date().toLocaleString('en-PH')}`,{italic:true,size:9,color:{argb:'FF4A5D68'}}]];
  heading.forEach(([text,font],i)=>{const r=ws.getRow(i+1);r.getCell(2).value=text;r.getCell(2).font=font;r.getCell(2).alignment={horizontal:'center'};ws.mergeCells(i+1,2,i+1,last);r.height=i===0?22:16;});
  try{
    const buf=await (await fetch('/assets/ctu-logo.png')).arrayBuffer();
    ws.addImage(wb.addImage({buffer:buf,extension:'png'}),{tl:{col:0.15,row:0.1},ext:{width:58,height:58}});
  }catch{/* The heading reads fine without the seal. */}
  const border={top:{style:'thin',color:{argb:'FF9FB3BF'}},left:{style:'thin',color:{argb:'FF9FB3BF'}},bottom:{style:'thin',color:{argb:'FF9FB3BF'}},right:{style:'thin',color:{argb:'FF9FB3BF'}}};
  const headStyle=cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0A7EA8'}};cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};cell.border=border;};
  let top=6;
  if(grouped){
    let col=1;
    for(const g of groups){
      const r1=ws.getRow(top),r2=ws.getRow(top+1);
      if(g.label){r1.getCell(col).value=g.label;if(g.span>1)ws.mergeCells(top,col,top,col+g.span-1);
        for(let k=0;k<g.span;k++){r2.getCell(col+k).value=columns[col-1+k].label;headStyle(r1.getCell(col+k));headStyle(r2.getCell(col+k));}}
      else{r1.getCell(col).value=columns[col-1].label;ws.mergeCells(top,col,top+1,col);headStyle(r1.getCell(col));headStyle(r2.getCell(col));}
      col+=g.span;
    }
    top+=1;
  }else{
    const r=ws.getRow(top);columns.forEach((c,i)=>{r.getCell(i+1).value=c.label;headStyle(r.getCell(i+1));});
  }
  ws.getRow(top).height=30;
  rows.forEach((row,i)=>{
    const r=ws.getRow(top+1+i);
    columns.forEach((c,j)=>{
      const v=row[c.key],cell=r.getCell(j+1);
      // Numbers stay numbers; dates and labels stay text so Excel does not reformat them.
      cell.value=isNumeric(v)?Number(v):(v==null?'':String(v));
      cell.border=border;cell.alignment={vertical:'top',wrapText:true,horizontal:isNumeric(v)?'right':'left'};
      if(i%2)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F7FA'}};
    });
  });
  columns.forEach((c,j)=>{
    const longest=Math.max(String(c.label).length,...rows.map(r=>String(r[c.key]??'').length));
    ws.getColumn(j+1).width=Math.min(40,Math.max(11,longest+2));
  });
  ws.views=[{state:'frozen',ySplit:top}];
  ws.autoFilter={from:{row:top,column:1},to:{row:top,column:n}};
  return wb;
}

// docx builds a real Word file: page orientation, column widths, and a header and footer on every page.
function loadDocxLib(){
  return new Promise((resolve,reject)=>{
    if(window.docx?.Document){resolve(window.docx);return;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
    s.onload=()=>window.docx?.Document?resolve(window.docx):reject(new Error('docx failed to initialize'));
    s.onerror=()=>reject(new Error('Could not load Word export library'));
    document.head.appendChild(s);
  });
}
const assetBytes=async path=>{try{return new Uint8Array(await (await fetch(path)).arrayBuffer());}catch{return null;}};
export async function wordDocx(title,rows,generated){
  const D=await loadDocxLib();
  const {columns,grouped,groups}=tableHeadings(rows);
  const landscape=columns.length>7;
  // Page content width in twips (1/1440 in): Letter with 0.5 in margins.
  const pageW=landscape?15840:12240,margin=720,contentW=pageW-2*margin;
  const font='Arial',size=columns.length>9?15:columns.length>7?16:18; // half-points
  const run=(text,o={})=>new D.TextRun({text:String(text??''),font,size,...o});
  const para=(children,o={})=>new D.Paragraph({children:Array.isArray(children)?children:[children],spacing:{before:0,after:0},...o});
  const [seal,bagong,foot]=await Promise.all(['/assets/ctu-logo.png','/assets/bagong-pilipinas.png','/assets/dental-cert-footer.png'].map(assetBytes));
  const s=appState.data?.DB?.settings||{};
  const noBorder={top:{style:D.BorderStyle.NONE,size:0,color:'FFFFFF'},bottom:{style:D.BorderStyle.NONE,size:0,color:'FFFFFF'},left:{style:D.BorderStyle.NONE,size:0,color:'FFFFFF'},right:{style:D.BorderStyle.NONE,size:0,color:'FFFFFF'}};
  const center=D.AlignmentType.CENTER;
  const headLine=(text,sz,bold=false)=>para(new D.TextRun({text,font,size:sz,bold}),{alignment:center});
  const headerTable=new D.Table({width:{size:contentW,type:D.WidthType.DXA},columnWidths:[1500,contentW-3000,1500],borders:{...noBorder,insideHorizontal:noBorder.top,insideVertical:noBorder.top},rows:[new D.TableRow({children:[
    new D.TableCell({borders:noBorder,width:{size:1500,type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,children:[seal?para(new D.ImageRun({data:seal,transformation:{width:68,height:68}}),{alignment:D.AlignmentType.RIGHT}):para(run(''))]}),
    new D.TableCell({borders:noBorder,width:{size:contentW-3000,type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,children:[
      headLine('Republic of the Philippines',20),headLine('CEBU TECHNOLOGICAL UNIVERSITY',22,true),headLine('MAIN CAMPUS',19),
      headLine('M. J. Cuenco Avenue Cor. R. Palma Street, Cebu City, Philippines',15),
      headLine(`Website: http://www.ctu.edu.ph   E-mail: ${s.contactEmail||'ctumainmedclinic@gmail.com'}`,15),
      headLine(`Phone: ${s.contactPhone||'(032) 402 4060 loc. 1142'}`,15)]}),
    new D.TableCell({borders:noBorder,width:{size:1500,type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,children:[bagong?para(new D.ImageRun({data:bagong,transformation:{width:66,height:62}})):para(run(''))]})
  ]})]});
  const footW=Math.round(contentW/15); // px at 96 dpi
  const footer=foot?new D.Footer({children:[para(new D.ImageRun({data:foot,transformation:{width:footW,height:Math.round(footW*91/1332)}}),{alignment:center})]}):undefined;

  // Column widths follow content length, within sensible limits.
  const weights=columns.map(c=>Math.min(28,Math.max(6,Math.ceil(String(c.label).length*1.3)+1,...rows.map(r=>String(r[c.key]??'').length))));
  const total=weights.reduce((a,b)=>a+b,0);
  const widths=weights.map(w=>Math.floor(contentW*w/total));
  const cellBorder={style:D.BorderStyle.SINGLE,size:4,color:'9FB3BF'};
  const borders={top:cellBorder,bottom:cellBorder,left:cellBorder,right:cellBorder};
  const shade=fill=>({type:D.ShadingType.CLEAR,color:'auto',fill});
  const margins={top:40,bottom:40,left:70,right:70};
  const headCell=(text,width,o={})=>new D.TableCell({borders,margins,width:{size:width,type:D.WidthType.DXA},shading:shade('0A7EA8'),verticalAlign:D.VerticalAlign.CENTER,children:[para(run(text,{bold:true,color:'FFFFFF'}),{alignment:center})],...o});
  const headRows=[];
  if(grouped){
    let col=0;const top=[],bottom=[];
    for(const g of groups){
      const span=widths.slice(col,col+g.span).reduce((a,b)=>a+b,0);
      if(g.label){top.push(headCell(g.label,span,{columnSpan:g.span}));for(let k=0;k<g.span;k++)bottom.push(headCell(columns[col+k].label,widths[col+k]));}
      else{top.push(headCell(columns[col].label,widths[col],{verticalMerge:D.VerticalMergeType.RESTART}));bottom.push(headCell('',widths[col],{verticalMerge:D.VerticalMergeType.CONTINUE}));}
      col+=g.span;
    }
    headRows.push(new D.TableRow({tableHeader:true,cantSplit:true,children:top}),new D.TableRow({tableHeader:true,cantSplit:true,children:bottom}));
  }else headRows.push(new D.TableRow({tableHeader:true,cantSplit:true,children:columns.map((c,j)=>headCell(c.label,widths[j]))}));
  const bodyRows=rows.map((r,i)=>new D.TableRow({cantSplit:true,children:columns.map((c,j)=>{const v=r[c.key];
    return new D.TableCell({borders,margins,width:{size:widths[j],type:D.WidthType.DXA},shading:i%2?shade('F3F7FA'):undefined,
      children:[para(run(v==null?'':String(v)),{alignment:isNumeric(v)?D.AlignmentType.RIGHT:D.AlignmentType.LEFT})]});})}));
  const doc=new D.Document({creator:'CampusCare',title,styles:{default:{document:{run:{font,size:18}}}},
    sections:[{properties:{page:{size:{width:12240,height:15840,orientation:landscape?D.PageOrientation.LANDSCAPE:D.PageOrientation.PORTRAIT},margin:{top:margin,bottom:margin,left:margin,right:margin,header:360,footer:300}}},
      headers:{default:new D.Header({children:[headerTable]})},...(footer?{footers:{default:footer}}:{}),
      children:[
        para(new D.TextRun({text:title,font,size:26,bold:true}),{alignment:center,spacing:{before:120,after:40}}),
        para(new D.TextRun({text:generated,font,size:16,color:'555555'}),{alignment:center,spacing:{after:160}}),
        new D.Table({width:{size:contentW,type:D.WidthType.DXA},columnWidths:widths,rows:[...headRows,...bodyRows]})
      ]}]});
  return D.Packer.toBlob?D.Packer.toBlob(doc):D.Packer.toBuffer(doc);
}

// A Word document laid out like the PDF: CTU header, centred title, bordered (grouped) table, footer.
export function wordDocumentHtml(title,rows,generated){
    // Word reads this page setup; widths are in attributes because Word ignores most image CSS.
    const landscape=Object.keys(rows[0]).length>7;
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
    <style>@page Section1{size:${landscape?'11in 8.5in;mso-page-orientation:landscape':'8.5in 11in'};margin:.5in .5in .5in .5in}
      div.Section1{page:Section1}body{font-family:Arial,sans-serif;font-size:10pt}td,th{mso-line-height-rule:exactly;line-height:11pt}
      .doc-title{text-align:center;font-size:14pt;font-weight:bold;margin:6pt 0 2pt}.doc-sub{text-align:center;color:#555555;font-size:9pt;margin:0 0 10pt}</style></head>
    <body><div class="Section1">${ctuHeaderHtml()}
      <p class="doc-title">${escapeHtml(title)}</p><p class="doc-sub">${generated}</p>
      ${tableHtml(rows,{font:Object.keys(rows[0]).length>7?8.5:10,word:true})}
      <div style="margin-top:14pt">${ctuFooterHtml({width:landscape?940:680})}</div></div></body></html>`;
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
      const wb=await excelWorkbook(title,rows);
      downloadBlob(await wb.xlsx.writeBuffer(),`${stem}.xlsx`,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast('Excel file exported.','success');
    }catch(e){console.error('Excel export:',e);toast('Could not create the Excel file (the export library needs an internet connection). Check the connection and try again.','error');}
    return;
  }
  const generated=`CTU Main Medical &amp; Dental Clinic · Generated ${escapeHtml(new Date().toLocaleString('en-PH'))}`;
  if(format==='doc'){
    try{
      const blob=await wordDocx(title,rows,generated.replace(/&amp;/g,'&'));
      downloadBlob(blob,`${stem}.docx`,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }catch(e){
      // Without the Word library (offline), fall back to a Word-readable HTML document.
      console.warn('Word export fell back to HTML:',e?.message||e);
      downloadBlob(wordDocumentHtml(title,rows,generated),`${stem}.doc`,'application/msword');
    }
    toast('Word document exported.','success');return;
  }
  // PDF: the print dialog's "Save as PDF" keeps the letterhead on every page.
  toast('Opening print dialog — choose "Save as PDF" as the destination.','info');
  // Charts need the app's styles; the table and letterhead carry their own.
  const head=extraHtml?[...document.querySelectorAll('link[rel="stylesheet"],style')].map(node=>node.outerHTML).join(''):'';
  // Wide tables print landscape with compact cells, so dates and short values stay on one line.
  const wide=Object.keys(rows[0]||{}).length>7;
  printCtuDocument({title,head,landscape:wide,css:`body{background:#fff!important;color:#111!important}.doc-title{text-align:center;font-weight:700;font-size:15px;margin:4px 0 2px}.doc-sub{text-align:center;color:#555;margin:0 0 12px}.doc-extra{margin-bottom:12px}.doc-extra button,.doc-extra .chart-type-switch{display:none!important}`,
    body:`<div class="doc-title">${escapeHtml(title)}</div><p class="doc-sub">${generated}</p>${extraHtml?`<div class="doc-extra">${extraHtml}</div>`:''}${tableHtml(rows,{font:wide?10:11,word:true})}`});
}
// The download buttons (Excel, Word, PDF); `source()` returns {title,rows,csv?,extraHtml?} at click time.
export function exportButtonsHtml(source,{label='Download'}={}){
  const run=format=>()=>exportTable({...source(),format});
  return `<div class="report-export-buttons" role="group" aria-label="${escapeHtml(label)}"><span class="text-muted" style="font-size:.78rem;margin-right:.25rem">${escapeHtml(label)}:</span>
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
