// dashboard: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {dashboardAttentionItem,dashboardChartControlHtml,dashboardControlsHtml,dashboardInRange,dashboardMobileQuickLinks,dashboardRangeCounts,dashboardRangeLabel,dashboardStatCard,dashboardTrendSvg} from './dashboardChartHelpers.js';
import {appointmentRecords} from './appointmentService.js';
import {getDoctors,getLowStock,getPatientById,getUserById} from './documentScanner.js';
import {docName,messageRecords} from './messaging.js';
import {collegeBadge,currentSemester,fmtDate,fmtTime,getSemester,statusBadge} from './inputValidation.js';
import {escapeHtml} from './issueReports.js';
import {navTo} from './navigationRaceProtection.js';
import {toast} from './theme.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// DASHBOARD A — Priority + Trends for every CampusCare user role.
// ================================================================
export function renderDashboard(){
  const c=document.getElementById('app-content');
  const role=appState.auth.currentUser.role;
  const today=appState.dashboardChartHelpers.dashboardDateTo||appState.clinicInformation.TODAY;
  const rangeLabel=dashboardRangeLabel();
  const allToday=appointmentRecords().filter(a=>a.date===today&&a.status!=='Cancelled');
  const allRange=appointmentRecords().filter(a=>dashboardInRange(a.date)&&a.status!=='Cancelled');
  const globalTrend=dashboardRangeCounts(()=>true);
  const globalVals=globalTrend.map(p=>p.value);
  const lowStock=getLowStock();
  const pendingUsers=appState.data.DB.users.filter(u=>u.status==='Pending');
  const pendingCerts=(appState.data.DB.certRequests||[]).filter(r=>r.status==='Pending');
  const unreadMessages=messageRecords().filter(m=>m.toUserId===appState.auth.currentUser.id&&!m.isRead&&!m.deleted).length;
  const hour=new Date().getHours();
  const greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';

  // PATIENT DASHBOARD
  if(role==='Patient'){
    const pt=appState.auth.currentPatient;
    if(!pt){c.innerHTML='<div class="alert alert-warning show">No patient record linked. Please contact admin.</div>';return;}
    const mine=appointmentRecords().filter(a=>a.patientId===pt.id);
    const upcoming=mine.filter(a=>a.status==='Scheduled'&&a.date>=today).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    const completed=mine.filter(a=>a.status==='Completed');
    const rangeMine=mine.filter(a=>dashboardInRange(a.date)&&a.status!=='Cancelled');
    const reminders=appState.data.DB.medReminders.filter(r=>r.patientId===pt.id&&r.status==='active'&&r.endDate>=today);
    const dental=mine.filter(a=>a.clinic==='Dental Clinic'&&a.status!=='Cancelled'&&getSemester(a.date)===currentSemester());
    const myTrend=dashboardRangeCounts(a=>a.patientId===pt.id);
    const myVals=myTrend.map(p=>p.value);
    const myCerts=(appState.data.DB.certRequests||[]).filter(r=>r.patientId===pt.id);
    let attention='';
    if(upcoming[0])attention+=dashboardAttentionItem('Next appointment',`${fmtDate(upcoming[0].date)} at ${fmtTime(upcoming[0].time)} · ${upcoming[0].clinic}`,'success');
    if(reminders.length)attention+=dashboardAttentionItem(`${reminders.length} active medication reminder${reminders.length>1?'s':''}`,'Open your medication reminders and keep your schedule on track.','warn');
    const ready=myCerts.filter(r=>r.status==='Issued').length;
    if(ready)attention+=dashboardAttentionItem(`${ready} certificate${ready>1?'s are':' is'} ready`,'Download issued medical certificates from Medical Certificates.','success');
    if(unreadMessages)attention+=dashboardAttentionItem(`${unreadMessages} unread message${unreadMessages>1?'s':''}`,'You have new messages waiting in Chats.','warn');
    if(!attention)attention=dashboardAttentionItem('You are all caught up','No urgent items need your attention right now.','success');
    c.innerHTML=`<div class="dashboard-a">
      <div class="dashboard-a-head"><div><h3>${greeting}, ${escapeHtml(appState.auth.currentUser.fname)}.</h3><p>Here is your personal CampusCare health overview.</p></div><div style="display:flex;gap:.55rem;align-items:end;flex-wrap:wrap"><button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{navTo('my-appointments')})}>+ Book Appointment</button>${dashboardControlsHtml()}</div></div>
      <div class="dashboard-a-grid">
        ${dashboardStatCard('Upcoming appointments',upcoming.length,upcoming[0]?`Next: <strong>${fmtDate(upcoming[0].date)}</strong>`:'Nothing scheduled',myVals,'📅')}
        ${dashboardStatCard('Visits in range',rangeMine.length,`${rangeMine.filter(a=>a.status==='Completed').length} completed · ${rangeLabel}`,myVals,'✓')}
        ${dashboardStatCard('Dental visits',`${dental.length}/${appState.data.DB.settings.dentalLimitPerSemester}`,'Used this semester',myVals,'🦷',dental.length>=appState.data.DB.settings.dentalLimitPerSemester?'attention':'')}
        ${dashboardStatCard('Active reminders',reminders.length,unreadMessages?`<strong>${unreadMessages}</strong> unread chat message${unreadMessages>1?'s':''}`:'Medication & follow-up reminders',myVals,'💊',reminders.length?'attention':'')}
      </div>
      ${dashboardMobileQuickLinks(role)}
      <div class="dashboard-a-main">
        <div class="card dashboard-trend-card"><div class="card-header"><div><h3>My Clinic Activity</h3><div class="text-muted">${rangeLabel}</div></div>${dashboardChartControlHtml()}</div><div class="dashboard-trend-wrap">${dashboardTrendSvg(myTrend,'Appointments')}</div></div>
        <div class="card dashboard-attn-card"><div class="card-header"><h3>Needs Attention</h3></div><div class="dashboard-attn-list">${attention}</div></div>
      </div>
      ${upcoming.length?`<div class="card"><div class="card-header"><h3>Upcoming Appointments</h3><button class="btn btn-xs" ${bindAction('click',(event,element)=>{navTo('my-appointments')})}>View All</button></div>${upcoming.slice(0,4).map(a=>{const d=getUserById(a.doctorId);return `<div style="display:flex;align-items:center;gap:.7rem;padding:.55rem 0;border-bottom:1px solid var(--line-soft)"><div style="flex:1"><strong style="font-size:.8rem">${a.clinic} · ${a.service}</strong><div class="text-muted">${fmtDate(a.date)} at ${fmtTime(a.time)} · ${d?docName(d):'Doctor TBA'}</div></div>${statusBadge(a.status)}</div>`;}).join('')}</div>`:''}
    </div>`;
    return;
  }

  // DOCTOR DASHBOARD
  if(role==='Doctor'){
    const mine=appointmentRecords().filter(a=>a.doctorId===appState.auth.currentUser.id);
    const todayMine=mine.filter(a=>a.date===today&&a.status!=='Cancelled').sort((a,b)=>a.time.localeCompare(b.time));
    const rangeMine=mine.filter(a=>dashboardInRange(a.date)&&a.status!=='Cancelled');
    const completed=mine.filter(a=>a.status==='Completed');
    const scheduled=mine.filter(a=>a.status==='Scheduled'&&a.date>=today);
    const uniquePatients=new Set(mine.map(a=>a.patientId)).size;
    const trend=dashboardRangeCounts(a=>a.doctorId===appState.auth.currentUser.id);
    const vals=trend.map(p=>p.value);
    const next=todayMine.find(a=>a.status==='Scheduled');
    let attention='';
    if(next){const pt=getPatientById(next.patientId);attention+=dashboardAttentionItem('Next patient',`${fmtTime(next.time)} · ${pt?pt.fname+' '+pt.lname:'Patient'} · ${next.service}`,'success');}
    if(scheduled.length)attention+=dashboardAttentionItem(`${scheduled.length} scheduled appointment${scheduled.length>1?'s':''}`,'Review your upcoming schedule and patient list.','warn');
    if(unreadMessages)attention+=dashboardAttentionItem(`${unreadMessages} unread message${unreadMessages>1?'s':''}`,'Open Chats to respond to patients or clinic staff.','warn');
    if(!attention)attention=dashboardAttentionItem('Schedule is clear','No urgent items need your attention.','success');
    const todayCompleted=todayMine.filter(a=>a.status==='Completed').length;
    c.innerHTML=`<div class="dashboard-a">
      <div class="dashboard-a-head"><div><h3>${greeting}, Dr. ${escapeHtml(appState.auth.currentUser.lname)}.</h3><p>Your patient load and clinic activity at a glance.</p></div><div style="display:flex;gap:.55rem;align-items:end;flex-wrap:wrap"><button class="btn btn-sm" ${bindAction('click',(event,element)=>{navTo('schedule')})}>Full Schedule</button>${dashboardControlsHtml()}</div></div>
      <div class="dashboard-a-grid">
        ${dashboardStatCard('Appointments in range',rangeMine.length,`${rangeMine.filter(a=>a.status==='Completed').length} completed · ${rangeLabel}`,vals,'🩺')}
        ${dashboardStatCard('Upcoming',scheduled.length,'Scheduled from today onward',vals,'📅',scheduled.length>8?'attention':'')}
        ${dashboardStatCard('Total patients',uniquePatients,'Unique patients assigned to you',vals,'👥')}
        ${dashboardStatCard('Completed visits',completed.length,unreadMessages?`<strong>${unreadMessages}</strong> unread messages`:'All recorded consultations',vals,'✓')}
      </div>
      ${dashboardMobileQuickLinks(role)}
      <div class="dashboard-a-main">
        <div class="card dashboard-trend-card"><div class="card-header"><div><h3>Patient Visits</h3><div class="text-muted">${rangeLabel}</div></div>${dashboardChartControlHtml()}</div><div class="dashboard-trend-wrap">${dashboardTrendSvg(trend,'Appointments')}</div></div>
        <div class="card dashboard-attn-card"><div class="card-header"><h3>Needs Attention</h3></div><div class="dashboard-attn-list">${attention}</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Schedule · ${fmtDate(today)}</h3><button class="btn btn-xs" ${bindAction('click',(event,element)=>{navTo('my-patients')})}>My Patients</button></div>${todayMine.length?`<div class="table-wrap"><table><thead><tr><th>Time</th><th>Patient</th><th>College</th><th>Service</th><th>Status</th></tr></thead><tbody>${todayMine.map(a=>{const pt=getPatientById(a.patientId);return `<tr><td>${fmtTime(a.time)}</td><td>${pt?pt.fname+' '+pt.lname:'Unknown'}</td><td>${collegeBadge(a.college)}</td><td>${a.service}</td><td>${statusBadge(a.status)}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-state"><p>No appointments scheduled for today.</p></div>'}</div>
    </div>`;
    return;
  }

  // STAFF DASHBOARD
  if(role==='Staff'){
    const scheduled=appointmentRecords().filter(a=>a.status==='Scheduled');
    const todayCompleted=appointmentRecords().filter(a=>dashboardInRange(a.date)&&a.status==='Completed').length;
    let attention='';
    if(lowStock.length)attention+=dashboardAttentionItem(`${lowStock.length} low-stock item${lowStock.length>1?'s':''}`,`${lowStock.slice(0,2).map(i=>i.name).join(', ')}${lowStock.length>2?' and more':''}`,'danger');
    if(pendingCerts.length)attention+=dashboardAttentionItem(`${pendingCerts.length} certificate request${pendingCerts.length>1?'s':''}`, 'Patients are waiting for certificate review.','warn');
    if(unreadMessages)attention+=dashboardAttentionItem(`${unreadMessages} unread message${unreadMessages>1?'s':''}`,'Check Chats for new patient or staff messages.','warn');
    if(!attention)attention=dashboardAttentionItem('Operations look good','No urgent clinic items need attention.','success');
    c.innerHTML=`<div class="dashboard-a">
      <div class="dashboard-a-head"><div><h3>${greeting}, ${escapeHtml(appState.auth.currentUser.fname)}.</h3><p>Monitor clinic flow and operational tasks for the selected date.</p></div><div style="display:flex;gap:.55rem;align-items:end;flex-wrap:wrap"><button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{navTo('appointments')})}>Manage Appointments</button>${dashboardControlsHtml()}</div></div>
      <div class="dashboard-a-grid">
        ${dashboardStatCard('Appointments in range',allRange.length,`<strong>${todayCompleted}</strong> completed · ${rangeLabel}`,globalVals,'📅')}
        ${dashboardStatCard('Scheduled',scheduled.length,'Appointments still on the schedule',globalVals,'🕐')}
        ${dashboardStatCard('Certificate requests',pendingCerts.length,'Pending medical certificates',globalVals,'📄',pendingCerts.length?'attention':'')}
        ${dashboardStatCard('Low stock',lowStock.length,lowStock.length?'Inventory needs review':'Inventory levels healthy',globalVals,'⚠',lowStock.length?'critical':'')}
      </div>
      ${dashboardMobileQuickLinks(role)}
      <div class="dashboard-a-main">
        <div class="card dashboard-trend-card"><div class="card-header"><div><h3>Patient Visits</h3><div class="text-muted">${rangeLabel}</div></div>${dashboardChartControlHtml()}</div><div class="dashboard-trend-wrap">${dashboardTrendSvg(globalTrend,'Appointments')}</div></div>
        <div class="card dashboard-attn-card"><div class="card-header"><h3>Needs Attention</h3></div><div class="dashboard-attn-list">${attention}</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Today's Appointments</h3><button class="btn btn-xs" ${bindAction('click',(event,element)=>{navTo('appointments')})}>View All</button></div>${allToday.length?`<div class="table-wrap"><table><thead><tr><th>Time</th><th>Patient</th><th>Clinic</th><th>Doctor</th><th>Status</th></tr></thead><tbody>${allToday.slice(0,8).map(a=>{const pt=getPatientById(a.patientId),d=getUserById(a.doctorId);return `<tr><td>${fmtTime(a.time)}</td><td>${pt?pt.fname+' '+pt.lname:'Unknown'}</td><td>${a.clinic}</td><td>${d?docName(d):'Unknown'}</td><td>${statusBadge(a.status)}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-state"><p>No appointments today.</p></div>'}</div>
    </div>`;
    return;
  }

  // ADMINISTRATOR DASHBOARD
  const scheduled=appointmentRecords().filter(a=>a.status==='Scheduled');
  const activePatients=(appState.auth.currentUser?.role==='Administrator'?appState.data.DB.patients.filter(p=>p._realSupabase):appState.data.DB.patients).filter(p=>!p.archived).length;
  const completedToday=appointmentRecords().filter(a=>dashboardInRange(a.date)&&a.status==='Completed').length;
  let attention='';
  if(pendingUsers.length)attention+=dashboardAttentionItem(`${pendingUsers.length} pending user approval${pendingUsers.length>1?'s':''}`,'Review new CampusCare registrations.','warn');
  if(lowStock.length)attention+=dashboardAttentionItem(`${lowStock.length} low-stock item${lowStock.length>1?'s':''}`,`${lowStock.slice(0,2).map(i=>i.name).join(', ')}${lowStock.length>2?' and more':''}`,'danger');
  if(pendingCerts.length)attention+=dashboardAttentionItem(`${pendingCerts.length} certificate request${pendingCerts.length>1?'s':''}`,'Medical certificates are awaiting clinic action.','warn');
  if(unreadMessages)attention+=dashboardAttentionItem(`${unreadMessages} unread message${unreadMessages>1?'s':''}`,'Open Chats to review new messages.','warn');
  if(!attention)attention=dashboardAttentionItem('All systems normal','No urgent administrative items need attention.','success');
  const doctors=getDoctors();
  const doctorLoad=doctors.map(d=>({name:`Dr. ${d.lname}`,count:allToday.filter(a=>a.doctorId===d.id).length,max:d.maxPatients||20}));
  c.innerHTML=`<div class="dashboard-a">
    <div class="dashboard-a-head"><div><h3>${greeting}, ${escapeHtml(appState.auth.currentUser.fname)}.</h3><p>CampusCare clinic activity, priorities, and service load.</p></div><div style="display:flex;gap:.55rem;align-items:end;flex-wrap:wrap"><button class="btn btn-sm" ${bindAction('click',(event,element)=>{navTo('reports')})}>Open Reports & Analytics</button>${dashboardControlsHtml()}</div></div>
    <div class="dashboard-a-grid">
      ${dashboardStatCard('Active patients',activePatients,'Registered non-archived patients',globalVals,'👥')}
      ${dashboardStatCard('Appointments in range',allRange.length,`<strong>${completedToday}</strong> completed · ${rangeLabel}`,globalVals,'📅')}
      ${dashboardStatCard('Pending approvals',pendingUsers.length,pendingUsers.length?'Registration review required':'No registrations waiting',globalVals,'⏳',pendingUsers.length?'attention':'')}
      ${dashboardStatCard('Low stock',lowStock.length,lowStock.length?'Inventory action required':'Inventory levels healthy',globalVals,'⚠',lowStock.length?'critical':'')}
    </div>
    ${dashboardMobileQuickLinks(role)}
    <div class="dashboard-a-main">
      <div class="card dashboard-trend-card"><div class="card-header"><div><h3>Patient Visits</h3><div class="text-muted">${rangeLabel}</div></div><div style="display:flex;align-items:center;gap:.45rem">${dashboardChartControlHtml()}<button class="btn btn-xs" ${bindAction('click',(event,element)=>{navTo('reports')})}>Analyze</button></div></div><div class="dashboard-trend-wrap">${dashboardTrendSvg(globalTrend,'Appointments')}</div></div>
      <div class="card dashboard-attn-card"><div class="card-header"><h3>Needs Attention</h3></div><div class="dashboard-attn-list">${attention}</div></div>
    </div>
    <div class="dashboard-a-secondary">
      <div class="card"><div class="card-header"><h3>Today's Appointments</h3><button class="btn btn-xs" ${bindAction('click',(event,element)=>{navTo('appointments')})}>View All</button></div>${allToday.length?`<div class="table-wrap"><table><thead><tr><th>Time</th><th>Patient</th><th>Clinic</th><th>Doctor</th><th>Status</th></tr></thead><tbody>${allToday.slice(0,7).map(a=>{const pt=getPatientById(a.patientId),d=getUserById(a.doctorId);return `<tr><td>${fmtTime(a.time)}</td><td>${pt?pt.fname+' '+pt.lname:'Unknown'}</td><td>${a.clinic}</td><td>${d?docName(d):'Unknown'}</td><td>${statusBadge(a.status)}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-state"><p>No appointments today.</p></div>'}</div>
      <div class="card"><div class="card-header"><h3>Doctor Load · ${fmtDate(today)}</h3></div>${doctorLoad.length?doctorLoad.map(d=>{const pct=Math.min(100,Math.round(d.count/Math.max(1,d.max)*100));return `<div class="dashboard-progress-row"><span>${escapeHtml(d.name)}</span><div class="dashboard-progress-track"><div class="dashboard-progress-fill" style="width:${pct}%"></div></div><strong>${d.count}</strong></div>`;}).join(''):'<div class="empty-state"><p>No active doctors.</p></div>'}</div>
    </div>
  </div>`;
}

export function markReminderTaken(id) {
  const rem = appState.data.DB.medReminders.find(r => r.id === id);
  if (rem) {
    // For simplicity, just toast and optionally log. Could also create a taken log.
    toast(`Marked ${rem.medicationName} as taken.`, 'success');
    // Optionally disable for today and retrigger tomorrow? For demo, do nothing else.
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
