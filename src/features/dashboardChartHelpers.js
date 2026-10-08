// dashboardChartHelpers: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {renderDashboard} from './dashboard.js';
import {fmtDate} from './inputValidation.js';
import {closeAllModals,openModal} from './modals.js';
import {initModernCalendar} from './calendar.js';
import {hideAlert,showAlert} from './theme.js';
import {appointmentRecords} from './appointmentService.js';
import {escapeHtml} from './issueReports.js';
import {navTo} from './navigationRaceProtection.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// DASHBOARD
// ================================================================
// Small inline sparkline used inside the Dashboard A stat cards.
export function dashboardSparkline(values){
  const vals=(values||[]).map(Number).filter(Number.isFinite);
  if(!vals.length)return '';
  const w=180,h=26,p=2,min=Math.min(...vals),max=Math.max(...vals),span=(max-min)||1;
  const pts=vals.map((v,i)=>`${p+(i*(w-2*p)/Math.max(1,vals.length-1))},${h-p-((v-min)/span)*(h-2*p)}`).join(' ');
  return `<div class="das-spark"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/></svg></div>`;
}

// Dashboard filter state. A From/To range controls the dashboard and trend card.
export function isoDateOffset(base,days){const d=new Date(base+'T12:00:00');d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);}

 // First tap chooses From; second tap chooses To.

export function setDashboardChartType(value){
  appState.dashboardChartHelpers.dashboardChartType=value||'line';
  renderDashboard();
}
export function dashboardControlsHtml(){
  const label=`${fmtDate(appState.dashboardChartHelpers.dashboardDateFrom)} – ${fmtDate(appState.dashboardChartHelpers.dashboardDateTo)}`;
  return `<div class="dashboard-controls">
    <div class="dashboard-control"><label>Data range</label><button class="modern-date-btn" ${bindAction('click',(event,element)=>{openDashboardDatePicker()})}><i class="bi bi-calendar3"></i><span>${label}</span></button></div>
    <div class="dashboard-date-note">From – To</div>
  </div>`;
}
export function dashboardChartControlHtml(){
  return `<div class="dashboard-chart-picker"><label for="dashboard-chart-type">Graph</label><select id="dashboard-chart-type" ${bindAction('change',(event,element)=>{setDashboardChartType(element.value)})}>
    <option value="line" ${appState.dashboardChartHelpers.dashboardChartType==='line'?'selected':''}>Line</option>
    <option value="bar" ${appState.dashboardChartHelpers.dashboardChartType==='bar'?'selected':''}>Bar</option>
    <option value="pie" ${appState.dashboardChartHelpers.dashboardChartType==='pie'?'selected':''}>Pie</option>
    <option value="doughnut" ${appState.dashboardChartHelpers.dashboardChartType==='doughnut'?'selected':''}>Doughnut</option>
  </select></div>`;
}
export function openDashboardDatePicker(){
  appState.dashboardChartHelpers.dashboardPendingFrom=appState.dashboardChartHelpers.dashboardDateFrom;
  appState.dashboardChartHelpers.dashboardPendingTo='';
  appState.dashboardChartHelpers.dashboardRangeStage='from';
  openModal(`<div class="modal"><div class="modal-header"><div><h3>Select Dashboard Date Range</h3><div class="text-muted">Use one calendar: choose the From date first, then the To date.</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div><div class="modal-body"><div id="dashboard-range-msg"></div><div class="dashboard-range-picker"><div class="dashboard-range-summary"><div class="dashboard-range-value"><span>From</span><strong id="dashboard-range-from-label">Not selected</strong></div><div class="dashboard-range-arrow">→</div><div class="dashboard-range-value"><span>To</span><strong id="dashboard-range-to-label">Not selected</strong></div></div><div class="dashboard-range-step" id="dashboard-range-step">1. Select the From date</div><div id="dashboard-range-calendar"></div></div></div><div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{applyDashboardDateRange()})}>Apply Date Range</button></div></div>`);
  initModernCalendar('dashboard-range-calendar',appState.dashboardChartHelpers.dashboardDateFrom,'','chooseDashboardRangeDate',{rangeMode:true,rangeStart:'',rangeEnd:''});
  updateDashboardRangePickerUI();
}
export function chooseDashboardRangeDate(date){
  const msg=document.getElementById('dashboard-range-msg');
  if(appState.dashboardChartHelpers.dashboardRangeStage==='from'){
    appState.dashboardChartHelpers.dashboardPendingFrom=date;
    appState.dashboardChartHelpers.dashboardPendingTo='';
    appState.dashboardChartHelpers.dashboardRangeStage='to';
    if(msg)hideAlert(msg);
  }else{
    if(date<appState.dashboardChartHelpers.dashboardPendingFrom){
      if(msg)showAlert(msg,'Choose a To date on or after the From date.','warning');
      return;
    }
    appState.dashboardChartHelpers.dashboardPendingTo=date;
    appState.dashboardChartHelpers.dashboardRangeStage='done';
    if(msg)hideAlert(msg);
  }
  const st=appState.calendar.modernCalendarState['dashboard-range-calendar'];
  if(st){st.rangeStart=appState.dashboardChartHelpers.dashboardPendingFrom||'';st.rangeEnd=appState.dashboardChartHelpers.dashboardPendingTo||'';}
  updateDashboardRangePickerUI();
}
export function updateDashboardRangePickerUI(){
  const from=document.getElementById('dashboard-range-from-label');
  const to=document.getElementById('dashboard-range-to-label');
  const step=document.getElementById('dashboard-range-step');
  if(from)from.textContent=appState.dashboardChartHelpers.dashboardPendingFrom?fmtDate(appState.dashboardChartHelpers.dashboardPendingFrom):'Not selected';
  if(to)to.textContent=appState.dashboardChartHelpers.dashboardPendingTo?fmtDate(appState.dashboardChartHelpers.dashboardPendingTo):'Not selected';
  if(step)step.textContent=appState.dashboardChartHelpers.dashboardRangeStage==='from'?'1. Select the From date':appState.dashboardChartHelpers.dashboardRangeStage==='to'?'2. Now select the To date':'Range selected. You can Apply or tap another date to start again.';
  if(appState.dashboardChartHelpers.dashboardRangeStage==='done'){
    // A third tap starts a fresh range, keeping the interaction simple on mobile.
    appState.dashboardChartHelpers.dashboardRangeStage='from';
  }
}
export function applyDashboardDateRange(){
  const msg=document.getElementById('dashboard-range-msg');
  if(!appState.dashboardChartHelpers.dashboardPendingFrom||!appState.dashboardChartHelpers.dashboardPendingTo){showAlert(msg,'Please select both a From and To date.','warning');return;}
  if(appState.dashboardChartHelpers.dashboardPendingFrom>appState.dashboardChartHelpers.dashboardPendingTo){showAlert(msg,'The From date must be on or before the To date.','warning');return;}
  appState.dashboardChartHelpers.dashboardDateFrom=appState.dashboardChartHelpers.dashboardPendingFrom; appState.dashboardChartHelpers.dashboardDateTo=appState.dashboardChartHelpers.dashboardPendingTo;
  closeAllModals(); renderDashboard();
}
export function dashboardRangeLabel(){return `${fmtDate(appState.dashboardChartHelpers.dashboardDateFrom)} – ${fmtDate(appState.dashboardChartHelpers.dashboardDateTo)}`;}
export function dashboardInRange(date){return date>=appState.dashboardChartHelpers.dashboardDateFrom&&date<=appState.dashboardChartHelpers.dashboardDateTo;}

// Returns daily counts for short ranges and monthly counts for longer ranges.
export function dashboardRangeCounts(filterFn){
  const start=new Date(appState.dashboardChartHelpers.dashboardDateFrom+'T12:00:00'),end=new Date(appState.dashboardChartHelpers.dashboardDateTo+'T12:00:00');
  const span=Math.max(0,Math.round((end-start)/864e5));
  const points=[];
  if(span<=31){
    for(let i=0;i<=span;i++){
      const d=new Date(start); d.setDate(d.getDate()+i); const key=d.toISOString().slice(0,10);
      points.push({key,label:d.toLocaleDateString('en-PH',{month:'short',day:'numeric'}),value:appointmentRecords().filter(a=>a.date===key&&filterFn(a)).length});
    }
  }else{
    const cursor=new Date(start.getFullYear(),start.getMonth(),1,12);
    while(cursor<=end){
      const y=cursor.getFullYear(),m=cursor.getMonth();
      const key=`${y}-${String(m+1).padStart(2,'0')}`;
      points.push({key,label:cursor.toLocaleDateString('en-PH',{month:'short',year:'2-digit'}),value:appointmentRecords().filter(a=>a.date.startsWith(key)&&dashboardInRange(a.date)&&filterFn(a)).length});
      cursor.setMonth(cursor.getMonth()+1);
    }
  }
  return points;
}

// Builds the selected-range dashboard chart without depending on Chart.js.
export function dashboardTrendSvg(points,label='Visits',chartType=appState.dashboardChartHelpers.dashboardChartType){
  if(!points||!points.length)return '<div class="dashboard-trend-empty">No trend data available.</div>';
  const values=points.map(p=>Number(p.value)||0);
  const total=values.reduce((a,b)=>a+b,0);
  const esc=t=>escapeHtml(String(t));
  const palette=['#0a7ea8','#3aa8d8','#5b4fd6','#0b7d63','#c62828','#a15c00','#b0431e'];

  // Pie and doughnut views summarize how the selected-range total is distributed across periods.
  if(chartType==='pie'||chartType==='doughnut'){
    if(total===0)return '<div class="dashboard-trend-empty">No activity in this selected date range.</div>';
    let acc=0;
    const stops=values.map((v,i)=>{const a=acc/total*360;acc+=v;const b=acc/total*360;return `${palette[i%palette.length]} ${a}deg ${b}deg`;}).join(',');
    const hole=chartType==='doughnut'?`<div style="position:absolute;inset:27%;border-radius:50%;background:var(--glass-surface-strong);display:flex;align-items:center;justify-content:center;flex-direction:column"><strong style="font-size:1.15rem">${total}</strong><span class="text-muted">Total</span></div>`:'';
    return `<div style="height:100%;display:flex;align-items:center;justify-content:center;gap:1.4rem;flex-wrap:wrap"><div style="width:min(180px,48vw);aspect-ratio:1;border-radius:50%;background:conic-gradient(${stops});position:relative;box-shadow:var(--glass-shadow-sm)">${hole}</div><div style="display:grid;grid-template-columns:repeat(2,minmax(80px,1fr));gap:.4rem .8rem">${points.map((p,i)=>`<span style="font-size:.7rem;color:var(--ink-muted);display:flex;align-items:center;gap:.35rem"><i style="width:8px;height:8px;border-radius:50%;background:${palette[i%palette.length]};display:inline-block"></i>${esc(p.label)} <strong style="color:var(--ink)">${p.value}</strong></span>`).join('')}</div></div>`;
  }

  const w=720,h=220,pl=42,pr=18,pt=18,pb=34;
  const max=Math.max(1,...values);
  const y=v=>pt+(max-v)*(h-pt-pb)/max;
  const grid=[0,.25,.5,.75,1].map(r=>{const yy=pt+r*(h-pt-pb);const val=Math.round(max*(1-r));return `<line x1="${pl}" y1="${yy}" x2="${w-pr}" y2="${yy}" stroke="currentColor" opacity=".08"/><text x="${pl-8}" y="${yy+3}" text-anchor="end" font-size="10" fill="currentColor" opacity=".55">${val}</text>`;}).join('');
  let marks='';
  if(chartType==='bar'){
    const avail=w-pl-pr,gap=Math.max(2,Math.min(18,120/Math.max(1,points.length))),bw=Math.max(2,(avail-gap*(points.length+1))/points.length);
    marks=points.map((p,i)=>{const x=pl+gap+i*(bw+gap),yy=y(p.value),bh=h-pb-yy;return `<rect x="${x}" y="${yy}" width="${bw}" height="${Math.max(1,bh)}" rx="6" fill="var(--primary-mid)" opacity=".82"><title>${esc(p.label)}: ${p.value} ${esc(label.toLowerCase())}</title></rect><text x="${x+bw/2}" y="${h-10}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">${esc(p.label)}</text>`;}).join('');
  }else{
    const x=i=>pl+i*(w-pl-pr)/Math.max(1,points.length-1);
    const poly=points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' ');
    const area=`${pl},${h-pb} ${poly} ${x(points.length-1)},${h-pb}`;
    marks=`<polygon points="${area}" fill="var(--primary)" opacity=".08"/><polyline points="${poly}" fill="none" stroke="var(--primary-mid)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="3.5" fill="var(--primary-mid)"><title>${esc(p.label)}: ${p.value} ${esc(label.toLowerCase())}</title></circle>`).join('')}${points.map((p,i)=>`<text x="${x(i)}" y="${h-10}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">${esc(p.label)}</text>`).join('')}`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)} for ${esc(dashboardRangeLabel())}">${grid}${marks}</svg>`;
}

export function dashboardTarget(text=''){
  const s=String(text).toLowerCase(),r=appState.auth.currentUser?.role;
  if(s.includes('message')||s.includes('chat'))return 'messages';
  if(s.includes('certificate'))return r==='Patient'?'my-certificates':'cert-requests';
  if(s.includes('approval')||s.includes('registration'))return 'approvals';
  if(s.includes('stock')||s.includes('inventory'))return 'inventory';
  if(s.includes('patient'))return r==='Doctor'?'my-patients':'patients';
  if(s.includes('appointment')||s.includes('scheduled')||s.includes('visit')||s.includes('dental'))return r==='Patient'?'my-appointments':'appointments';
  if(s.includes('reminder'))return r==='Patient'?'my-records':'treatments';
  return '';
}
export function dashboardStatCard(label,value,meta,values,icon='•',tone=''){
  const target=dashboardTarget(label+' '+(meta||''));return `<div class="dashboard-a-stat ${tone} ${target?'clickable':''}" ${target?`role="button" tabindex="0" ${bindAction('click',(event,element)=>{navTo((String(target)))})} ${bindAction('keydown',(event,element)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();navTo((String(target)))}})}`:''}><div class="das-top"><div class="das-label">${label}</div><div class="das-icon">${icon}</div></div><div class="das-value">${value}</div><div class="das-meta">${meta||'&nbsp;'}</div>${dashboardSparkline(values)}</div>`;
}
export function dashboardAttentionItem(title,detail,tone=''){
  const target=dashboardTarget(title+' '+detail);return `<div class="dashboard-attn-item ${target?'clickable':''}" ${target?`role="button" tabindex="0" ${bindAction('click',(event,element)=>{navTo((String(target)))})} ${bindAction('keydown',(event,element)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();navTo((String(target)))}})}`:''}><span class="dashboard-attn-dot ${tone}"></span><div class="dashboard-attn-copy"><strong>${title}</strong><span>${detail}</span></div></div>`;
}

// Mobile-only dashboard shortcuts. Each role gets the pages it is most likely to need.
export function dashboardMobileQuickLinks(role){
  const links={
    Patient:[
      ['my-appointments','fa-calendar-plus','Appointments'],
      ['my-records','fa-notes-medical','Health Records'],
      ['my-certificates','fa-file-medical','Certificates'],
      ['messages','fa-comments','Messages'],
      ['health_education','fa-book-medical','Health Tips'],
      ['my-account','fa-user-gear','Account']
    ],
    Doctor:[
      ['schedule','fa-calendar-days','Schedule'],
      ['my-patients','fa-hospital-user','My Patients'],
      ['appointments','fa-stethoscope','Appointments'],
      ['messages','fa-comments','Messages'],
      ['cert-requests','fa-file-circle-check','Certificates'],
      ['my-account','fa-user-gear','Account']
    ],
    Staff:[
      ['patients','fa-hospital-user','Patients'],
      ['appointments','fa-calendar-check','Appointments'],
      ['cert-requests','fa-file-medical','Certificates'],
      ['inventory','fa-boxes-stacked','Inventory'],
      ['messages','fa-comments','Messages'],
      ['my-account','fa-user-gear','Account']
    ],
    Administrator:[
      ['patients','fa-hospital-user','Patients'],
      ['appointments','fa-calendar-check','Appointments'],
      ['approvals','fa-user-check','Approvals'],
      ['reports','fa-chart-line','Reports'],
      ['messages','fa-comments','Messages'],
      ['settings','fa-gears','Settings']
    ]
  };
  const items=links[role]||[];
  return `<div class="card dashboard-mobile-quick"><div class="card-header"><h3>Quick Links</h3></div><div class="dashboard-mobile-quick-grid">${items.map(([id,icon,label])=>`<button class="dashboard-mobile-quick-btn" ${bindAction('click',(event,element)=>{navTo((String(id)))})}><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join('')}</div></div>`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.dashboardChartHelpers.dashboardDateFrom=isoDateOffset(appState.clinicInformation.TODAY,-6);
  appState.dashboardChartHelpers.dashboardDateTo=appState.clinicInformation.TODAY;
  appState.dashboardChartHelpers.dashboardPendingFrom=appState.dashboardChartHelpers.dashboardDateFrom;
  appState.dashboardChartHelpers.dashboardPendingTo=appState.dashboardChartHelpers.dashboardDateTo;
  appState.dashboardChartHelpers.dashboardRangeStage='from';
  appState.dashboardChartHelpers.dashboardChartType='line';
}
