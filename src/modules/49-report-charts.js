// ================================================================
// REPORT DATA VISUALIZATION (Chart.js, loaded on demand) + EXPORT
// ================================================================
let lastReportRows=[];
let lastReportTitle='Report';
let reportChartInstance=null; // Kept for backward compatibility; SVG charts do not need a Chart.js instance.

const REPORT_METRICS={
  appointments:[
    {value:'status',label:'By Status'},
    {value:'clinic',label:'By Clinic'},
    {value:'college',label:'By College'},
    {value:'trend',label:'Trend Over Time (by date)'}
  ],
  treatments:[
    {value:'diagnosis',label:'By Diagnosis'},
    {value:'trend',label:'Trend Over Time (by date)'}
  ],
  inventory:[
    {value:'category',label:'By Category (Qty)'},
    {value:'stocklevel',label:'By Stock Level'},
    {value:'value',label:'Value by Category (₱)'}
  ],
  patients:[
    {value:'college',label:'By College'},
    {value:'type',label:'By Person Type'}
  ]
};

function updateReportMetricOptions(){
  const type=document.getElementById('rpt-type').value;
  const sel=document.getElementById('rpt-metric');
  if(!sel)return;
  sel.innerHTML=REPORT_METRICS[type].map(m=>`<option value="${m.value}">${m.label}</option>`).join('');
}

function vizCardHtml(type){
  const metrics=REPORT_METRICS[type];
  return `<div class="card">
    <div class="card-header"><h3>📊 Data Visualization</h3></div>
    <div class="toolbar" style="margin-bottom:.9rem">
      <select id="rpt-charttype" onchange="renderReportChart()">
        <option value="bar">Bar Chart</option>
        <option value="pie">Pie Chart</option>
        <option value="doughnut">Doughnut Chart</option>
        <option value="line">Line Chart</option>
      </select>
      <select id="rpt-metric" onchange="renderReportChart()">${metrics.map(m=>`<option value="${m.value}">${m.label}</option>`).join('')}</select>
    </div>
    <div style="max-width:640px;margin:0 auto;position:relative;height:340px">
      <div id="rpt-chart-host" class="report-chart-host"></div>
    </div>
  </div>`;
}

function computeMetricData(type,metric,rows){
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
    if(metric==='value')return rows.reduce((m,i)=>{m[i.category]=(m[i.category]||0)+i.qty*(i.unitCost||0);return m;},{});
  }else if(type==='patients'){
    if(metric==='college')return count(rows,p=>p.college);
    if(metric==='type')return count(rows,p=>p.personType);
  }
  return {};
}

const CHART_PALETTE=['#0a7ea8','#3aa8d8','#5b4fd6','#0b7d63','#c62828','#a15c00','#b0431e','#2e7d32','#5cb3ea','#a89bf5'];

let _reportChartTimeout=null;
function renderReportChart(){
  clearTimeout(_reportChartTimeout);
  _reportChartTimeout=setTimeout(renderReportChartNow,120);
}

// Renders report charts with inline SVG/CSS so Reports & Analytics works offline.
function renderReportChartNow(){
  const type=document.getElementById('rpt-type').value;
  const metric=(document.getElementById('rpt-metric')||{}).value||REPORT_METRICS[type][0].value;
  const chartType=(document.getElementById('rpt-charttype')||{}).value||'bar';
  const host=document.getElementById('rpt-chart-host');
  if(!host)return;
  const data=computeMetricData(type,metric,lastReportRows);
  const labels=Object.keys(data);
  const values=Object.values(data).map(Number);
  const metricObj=REPORT_METRICS[type].find(m=>m.value===metric);
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

function exportToolbarHtml(){
  return `<div class="card">
    <div class="card-header"><h3>Export Report</h3></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      <button class="btn btn-sm" onclick="exportReportCSV()">⬇️ CSV</button>
      <button class="btn btn-sm btn-success" onclick="exportReportExcel()">📊 Excel (.xlsx)</button>
      <button class="btn btn-sm btn-info" onclick="exportReportWord()">📄 Word (.doc)</button>
      <button class="btn btn-sm btn-danger" onclick="exportReportPDF()">🖨️ PDF (Print)</button>
    </div>
  </div>`;
}

function downloadBlob(content,filename,mime){
  const blob=new Blob([content],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},100);
}

function rowsToCSV(rows){
  if(!rows.length)return '';
  const headers=Object.keys(rows[0]);
  const esc=v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`;
  return [headers.map(esc).join(','),...rows.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\n');
}

function exportReportCSV(){
  if(!lastReportRows.length){toast('Generate a report first.','error');return;}
  downloadBlob(rowsToCSV(lastReportRows),`${lastReportTitle.replace(/\s+/g,'_')}.csv`,'text/csv;charset=utf-8;');
  toast('CSV exported.','success');
}

function loadSheetJs(){
  return new Promise((resolve,reject)=>{
    if(window.XLSX){resolve(window.XLSX);return;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('SheetJS failed to initialize'));
    s.onerror=()=>reject(new Error('Could not load Excel export library'));
    document.head.appendChild(s);
  });
}

async function exportReportExcel(){
  if(!lastReportRows.length){toast('Generate a report first.','error');return;}
  try{
    const XLSX=await loadSheetJs();
    const ws=XLSX.utils.json_to_sheet(lastReportRows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Report');
    XLSX.writeFile(wb,`${lastReportTitle.replace(/\s+/g,'_')}.xlsx`);
    toast('Excel file exported.','success');
  }catch(e){
    toast('Could not load the Excel export library (needs an internet connection). Try CSV instead.','error');
  }
}

function exportReportWord(){
  if(!lastReportRows.length){toast('Generate a report first.','error');return;}
  const headers=Object.keys(lastReportRows[0]);
  const tableRows=lastReportRows.map(r=>`<tr>${headers.map(h=>`<td style="border:1px solid #ccc;padding:4px 8px">${r[h]==null?'':escapeHtml(String(r[h]))}</td>`).join('')}</tr>`).join('');
  const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${escapeHtml(lastReportTitle)}</title></head>
    <body>
      <h2>${escapeHtml(lastReportTitle)}</h2>
      <p>Generated ${new Date().toLocaleString('en-PH')} — ${escapeHtml(DB.settings.clinicName)}</p>
      <table style="border-collapse:collapse">
        <tr>${headers.map(h=>`<th style="border:1px solid #ccc;padding:4px 8px;background:#f0f0f0">${escapeHtml(h)}</th>`).join('')}</tr>
        ${tableRows}
      </table>
    </body></html>`;
  downloadBlob(html,`${lastReportTitle.replace(/\s+/g,'_')}.doc`,'application/msword');
  toast('Word document exported.','success');
}

function exportReportPDF(){
  if(!lastReportRows.length){toast('Generate a report first.','error');return;}
  toast('Opening print dialog — choose "Save as PDF" as the destination.','info');
  setTimeout(()=>window.print(),400);
}

function generateReport(){
  const type=document.getElementById('rpt-type').value;
  const from=document.getElementById('rpt-from').value;
  const to=document.getElementById('rpt-to').value;
  const college=document.getElementById('rpt-college').value;
  if(!from||!to){toast('Select a date range.','error');return;}
  if(from>to){toast('From date must be before To date.','error');return;}
  const el=document.getElementById('rpt-result');

  if(type==='appointments'){
    let data=appointmentRecords().filter(a=>a.date>=from&&a.date<=to&&(!college||a.college===college));
    lastReportRows=data.map(a=>{const pt=getPatientById(a.patientId);const doc=getUserById(a.doctorId);return{ID:appointmentDisplayId(a),Patient:pt?pt.fname+' '+pt.lname:'?',College:a.college,Clinic:a.clinic,Date:a.date,Time:a.time,Doctor:doc?'Dr. '+doc.fname+' '+doc.lname:'?',Status:a.status};});
    lastReportTitle=`Appointment Report ${from} to ${to}`;
    el.innerHTML=`<div class="card"><div class="card-header"><h3>Appointment Report – ${fmtDate(from)} to ${fmtDate(to)}</h3></div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-val">${data.length}</div><div class="stat-lbl">Total</div></div>
        <div class="stat-card"><div class="stat-val text-primary">${data.filter(a=>a.status==='Scheduled').length}</div><div class="stat-lbl">Scheduled</div></div>
        <div class="stat-card"><div class="stat-val text-success">${data.filter(a=>a.status==='Completed').length}</div><div class="stat-lbl">Completed</div></div>
        <div class="stat-card"><div class="stat-val text-danger">${data.filter(a=>a.status==='Cancelled').length}</div><div class="stat-lbl">Cancelled</div></div>
        <div class="stat-card"><div class="stat-val">${data.filter(a=>a.clinic==='Dental Clinic').length}</div><div class="stat-lbl">Dental</div></div>
        <div class="stat-card"><div class="stat-val">${data.filter(a=>a.clinic==='Medical Clinic').length}</div><div class="stat-lbl">Medical</div></div>
      </div>
      ${data.length?`<div class="table-wrap"><table><thead><tr><th>Photo</th><th>#</th><th>Patient</th><th>College</th><th>Clinic</th><th>Date</th><th>Doctor</th><th>Status</th></tr></thead><tbody>${data.map(a=>{const pt=getPatientById(a.patientId);const doc=getUserById(a.doctorId);return`<tr><td>${pt?patientAvatarHtml(pt,30):'—'}</td><td>#${appointmentDisplayId(a)}</td><td>${pt?pt.fname+' '+pt.lname:'?'}</td><td>${collegeBadge(a.college)}</td><td>${a.clinic}</td><td>${fmtDate(a.date)}</td><td>${doc?docName(doc):'?'}</td><td>${statusBadge(a.status)}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-state"><p>No records found.</p></div>'}
    </div>
    ${data.length?vizCardHtml(type)+exportToolbarHtml():''}`;
  }else if(type==='treatments'){
    let data=treatmentRecords().filter(t=>!t.archived&&t.date>=from&&t.date<=to);
    if(college)data=data.filter(t=>{const pt=getPatientById(t.patientId);return pt&&pt.college===college;});
    lastReportRows=data.map(t=>{const pt=getPatientById(t.patientId);const doc=getUserById(t.doctorId);return{ID:treatmentDisplayId(t),Patient:pt?pt.fname+' '+pt.lname:'?',Diagnosis:t.diagnosis,Doctor:doc?'Dr. '+doc.fname+' '+doc.lname:'?',Date:t.date,FollowUp:t.followupDate||''};});
    lastReportTitle=`Treatment Report ${from} to ${to}`;
    el.innerHTML=`<div class="card"><div class="card-header"><h3>Treatment Report</h3></div>
      <div class="stats-grid"><div class="stat-card"><div class="stat-val">${data.length}</div><div class="stat-lbl">Total Treatments</div></div></div>
      ${data.length?`<div class="table-wrap"><table><thead><tr><th>Photo</th><th>#</th><th>Patient</th><th>Diagnosis</th><th>Doctor</th><th>Date</th><th>Follow-up</th></tr></thead><tbody>${data.map(t=>{const pt=getPatientById(t.patientId);const doc=getUserById(t.doctorId);return`<tr><td>${pt?patientAvatarHtml(pt,30):'—'}</td><td>#${treatmentDisplayId(t)}</td><td>${pt?pt.fname+' '+pt.lname:'?'}</td><td>${t.diagnosis}</td><td>${doc?docName(doc):'?'}</td><td>${fmtDate(t.date)}</td><td>${fmtDate(t.followupDate)}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-state"><p>No records found.</p></div>'}
    </div>
    ${data.length?vizCardHtml(type)+exportToolbarHtml():''}`;
  }else if(type==='inventory'){
    const inv=inventoryRecords().filter(i=>!i.archived);
    const low=getLowStock();
    const total=inv.reduce((s,i)=>s+i.qty,0);
    const val=inv.reduce((s,i)=>s+i.qty*(i.unitCost||0),0);
    lastReportRows=inv.map(i=>({ID:inventoryDisplayId(i),Item:i.name,Category:i.category,Qty:i.qty,Threshold:i.threshold,UnitCost:i.unitCost||0,Value:(i.qty*(i.unitCost||0)).toFixed(2),Status:i.qty<=i.threshold?'Low':'OK'}));
    lastReportTitle=`Inventory Report ${TODAY}`;
    el.innerHTML=`<div class="card"><div class="card-header"><h3>Inventory Report</h3></div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-val">${inv.length}</div><div class="stat-lbl">Total Items</div></div>
        <div class="stat-card"><div class="stat-val text-danger">${low.length}</div><div class="stat-lbl">Low Stock</div></div>
        <div class="stat-card"><div class="stat-val">${total}</div><div class="stat-lbl">Total Units</div></div>
        <div class="stat-card"><div class="stat-val text-primary">₱${val.toFixed(2)}</div><div class="stat-lbl">Inventory Value</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Photo</th><th>Item</th><th>Category</th><th>Qty</th><th>Threshold</th><th>Value</th><th>Status</th></tr></thead><tbody>${inv.map(i=>{const bdg=i.qty<=i.threshold?'badge-danger':'badge-success';const lvl=i.qty<=i.threshold?'Low':'OK';return`<tr><td>${itemAvatarHtml(i,30)}</td><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.category)}</td><td>${i.qty}</td><td>${i.threshold}</td><td>₱${(i.qty*(i.unitCost||0)).toFixed(2)}</td><td><span class="badge ${bdg}">${lvl}</span></td></tr>`;}).join('')}</tbody></table></div>
    </div>
    ${inv.length?vizCardHtml(type)+exportToolbarHtml():''}`;
  }else{
    let pts=(currentUser?._realSupabase?DB.patients.filter(p=>p._realSupabase&&!p.archived):DB.patients.filter(p=>!p.archived));
    if(currentUser.role==='Doctor'){
      const allowed=new Set(appointmentRecords().filter(a=>a.doctorId===currentUser.id).map(a=>a.patientId));
      pts=pts.filter(p=>allowed.has(p.id));
    }
    if(college)pts=pts.filter(p=>p.college===college);
    const byCollege={};
    pts.forEach(p=>{byCollege[p.college||'Unknown']=(byCollege[p.college||'Unknown']||0)+1;});
    lastReportRows=pts.map(p=>({ID:p.dbPatientId||p.id,Name:p.fname+' '+p.lname,College:p.college||'',Type:p.personType||'',Age:p.age,Blood:p.blood||''}));
    lastReportTitle=`Patient Report ${TODAY}`;
    el.innerHTML=`<div class="card"><div class="card-header"><h3>Patient Report</h3></div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-val">${pts.length}</div><div class="stat-lbl">Total Patients</div></div>
        <div class="stat-card"><div class="stat-val">${pts.filter(p=>p.personType==='Student').length}</div><div class="stat-lbl">Students</div></div>
        <div class="stat-card"><div class="stat-val">${pts.filter(p=>p.personType==='Teaching Personnel').length}</div><div class="stat-lbl">Teaching</div></div>
        <div class="stat-card"><div class="stat-val">${pts.filter(p=>p.personType==='Non-Teaching Personnel').length}</div><div class="stat-lbl">Non-Teaching</div></div>
      </div>
      <div style="margin-bottom:.75rem"><strong style="font-size:.83rem">By College:</strong> ${Object.entries(byCollege).map(([k,v])=>`${collegeBadge(k)} ${v}`).join(' &nbsp; ')}</div>
      ${pts.length?`<div class="table-wrap"><table><thead><tr><th>Photo</th><th>Name</th><th>College</th><th>Type</th><th>Age</th><th>Blood</th></tr></thead><tbody>${pts.map(p=>`<tr><td>${patientAvatarHtml(p,30)}</td><td>${p.fname} ${p.lname}</td><td>${collegeBadge(p.college)}</td><td>${priorityBadge(p.personType)}</td><td>${p.age}</td><td>${p.blood}</td></tr>`).join('')}</tbody></table></div>`:''}
    </div>
    ${pts.length?vizCardHtml(type)+exportToolbarHtml():''}`;
  }
  const dataLen=lastReportRows.length;
  if(dataLen)setTimeout(renderReportChart,50);
}
