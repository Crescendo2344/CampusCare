// dashboard: imported feature APIs; state belongs to explicit application namespaces.
import {describeTrend,periodComparison} from '../domain/dashboard-metrics.js';
import {state as appState} from '../app/state.js';
import {followTodayIfDefaultRange,dashboardAttentionItem,dashboardChartControlHtml,dashboardControlsHtml,dashboardInRange,dashboardMobileQuickLinks,dashboardRangeCounts,dashboardRangeLabel,dashboardStatCard,dashboardTrendSvg} from './dashboardChartHelpers.js';
import {appointmentRecords} from './appointmentService.js';
import {getDoctors,getLowStock,getPatientById,getUserById} from './documentScanner.js';
import {docName} from './messaging.js';
import {collegeBadge,currentSemester,fmtDate,fmtTime,getSemester,statusBadge} from './inputValidation.js';
import {escapeHtml} from './issueReports.js';
import {articleCategoryColor,captureCampusPageToken,healthResourceRecords,isCampusPageCurrent,navTo,viewArticle} from './navigationRaceProtection.js';
import {ensureCurrentPatient} from './patientService.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {treatmentRecords} from './treatmentService.js';
import {viewTreatment} from './treatmentForm.js';
import {viewAppt} from './appointmentDetails.js';
import {toast} from './theme.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// DASHBOARD A — Priority + Trends for every CampusCare user role.
// ================================================================
export function renderDashboard(){
  const c=document.getElementById('app-content');
  const role=appState.auth.currentUser.role;
  followTodayIfDefaultRange();
  const today=appState.clinicInformation.TODAY;
  const rangeLabel=dashboardRangeLabel();
  const allToday=appointmentRecords().filter(a=>a.date===today&&a.status!=='Cancelled');
  const allRange=appointmentRecords().filter(a=>dashboardInRange(a.date)&&a.status!=='Cancelled');
  const globalTrend=dashboardRangeCounts(a=>a.status!=='Cancelled');
  // Each card compares the chosen range with the same-length period before it.
  const trend=(rows,upIs='neutral',date=r=>r.date,unit='')=>describeTrend(periodComparison(rows,{date,from:appState.dashboardChartHelpers.dashboardDateFrom,to:today}),{upIs,unit});
  // Counts without dated history (stock, queues) state what they are instead of inventing a trend.
  const note=text=>({direction:'info',sentiment:'neutral',text});
  const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
  const lowStock=getLowStock();
  const pendingUsers=appState.data.DB.users.filter(u=>u.status==='Pending');
  const hour=new Date().getHours();
  const greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';

  // PATIENT DASHBOARD
  // A personal page: what is coming up, what to do next and the latest from the clinic, with no date range or chart.
  if(role==='Patient'){
    const pt=appState.auth.currentPatient;
    if(!pt){
      // Right after sign-in the patient record may still be loading; only a finished lookup with no record is an error.
      if(appState.auth.currentUser._realSupabase&&appState.dashboard.patientLookupFailedFor!==appState.auth.currentUser.id){
        const pageToken=captureCampusPageToken();showDatabaseSkeleton('dashboard');
        ensureCurrentPatient().then(found=>{
          if(!isCampusPageCurrent('dashboard',pageToken))return;
          if(!found)appState.dashboard.patientLookupFailedFor=appState.auth.currentUser?.id;
          renderDashboard();
        });
        return;
      }
      c.innerHTML='<div class="alert alert-warning show">No patient record linked. Please contact admin.</div>';return;
    }
    const mine=appointmentRecords().filter(a=>a.patientId===pt.id);
    const upcoming=mine.filter(a=>a.status==='Scheduled'&&a.date>=today).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    const semester=currentSemester();
    const semesterVisits=mine.filter(a=>a.status==='Completed'&&getSemester(a.date)===semester);
    const reminders=appState.data.DB.medReminders.filter(r=>r.patientId===pt.id&&r.status==='active'&&r.endDate>=today);
    const dental=mine.filter(a=>a.clinic==='Dental Clinic'&&a.status!=='Cancelled'&&getSemester(a.date)===semester);
    const dentalLimit=appState.data.DB.settings.dentalLimitPerSemester;
    const visits=treatmentRecords().filter(t=>t.patientId===pt.id&&!t.archived).sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.id-a.id);
    const followUp=visits.map(t=>t.followupDate).filter(d=>d&&d>=today).sort()[0];
    const articles=healthResourceRecords().filter(r=>r.published).sort((a,b)=>String(b.publishedAt||b.createdAt).localeCompare(String(a.publishedAt||a.createdAt))).slice(0,3);
    const next=upcoming[0];
    let attention='';
    if(next)attention+=dashboardAttentionItem('Next appointment',`${fmtDate(next.date)} at ${fmtTime(next.time)} · ${escapeHtml(next.clinic)}`,'success');
    if(followUp&&!upcoming.some(a=>a.date>=followUp))attention+=dashboardAttentionItem('Follow-up visit due',`Your doctor asked to see you again on ${fmtDate(followUp)}. Book an appointment for that day.`,'warn');
    if(reminders.length)attention+=dashboardAttentionItem(`${plural(reminders.length,'medication')} to take`,reminders.slice(0,2).map(r=>escapeHtml(r.medicationName)).join(', ')+' · see My Health Records','warn');
    if(!attention)attention=dashboardAttentionItem('You are all caught up','No urgent items need your attention right now.','success');
    const dateTile=d=>{const [y,m,day]=String(d).split('-');return `<span class="pd-date"><small>${new Date(Number(y),Number(m)-1,Number(day)).toLocaleString('en-US',{month:'short'})}</small>${Number(day)}</span>`;};
    c.innerHTML=`<div class="dashboard-a">
      <div class="dashboard-a-head"><div><h3>${greeting}, ${escapeHtml(appState.auth.currentUser.fname)}.</h3><p>Your appointments, visits and health reminders in one place.</p></div></div>
      <div class="dashboard-a-grid">
        ${dashboardStatCard('Next appointment',next?fmtDate(next.date):'None',next?`${fmtTime(next.time)} · ${escapeHtml(next.clinic)}`:'Nothing scheduled',note(upcoming.length>1?`${plural(upcoming.length-1,'more appointment')} after this`:next?'Arrive 10 minutes early':'Book a visit whenever you need one'),'bi-calendar-event')}
        ${dashboardStatCard('Visits this semester',semesterVisits.length,'Completed clinic visits',note(visits[0]?`Last visit ${fmtDate(visits[0].date)}`:'No visits recorded yet'),'bi-check2-circle')}
        ${dashboardStatCard('Dental visits',`${dental.length}/${dentalLimit}`,'Used this semester',note(dental.length>=dentalLimit?'Semester limit reached':`${dentalLimit-dental.length} remaining this semester`),'bi-emoji-smile',dental.length>=dentalLimit?'attention':'')}
        ${dashboardStatCard('Current medications',reminders.length,reminders.length?'Prescribed by your doctor':'Nothing to take right now',note(reminders.length?`Until ${fmtDate(reminders.map(r=>r.endDate).sort().pop())}`:'From your clinic visits'),'bi-capsule',reminders.length?'attention':'')}
      </div>
      ${dashboardMobileQuickLinks(role)}
      <div class="dashboard-a-main">
        <div class="card pd-card"><div class="card-header"><h3>Upcoming appointments</h3><button class="btn btn-xs" ${bindAction('click',()=>navTo('my-appointments'))}>View all</button></div>
          ${upcoming.length?`<div class="pd-list">${upcoming.slice(0,3).map(a=>{const d=getUserById(a.doctorId);return `<button type="button" class="pd-item" ${bindAction('click',()=>viewAppt(a.id))}>${dateTile(a.date)}<span class="pd-text"><strong>${escapeHtml(a.service)}</strong><small>${fmtTime(a.time)} · ${escapeHtml(a.clinic)} · ${d?escapeHtml(docName(d)):'Doctor to be assigned'}</small></span>${statusBadge(a.status)}</button>`;}).join('')}</div>`
            :`<div class="empty-state"><i class="bi bi-calendar-plus" aria-hidden="true" style="font-size:1.5rem"></i><p>No upcoming appointments.</p><button class="btn btn-primary btn-sm" ${bindAction('click',()=>{navTo('my-appointments');import('./bookingForm.js').then(m=>m.openBookApptModal());})}>Book a visit</button></div>`}
        </div>
        <div class="card dashboard-attn-card"><div class="card-header"><h3>Needs Attention</h3></div><div class="dashboard-attn-list">${attention}</div></div>
      </div>
      <div class="pd-row">
        <div class="card pd-card"><div class="card-header"><h3>Recent visits</h3><button class="btn btn-xs" ${bindAction('click',()=>navTo('my-records'))}>My Health Records</button></div>
          ${visits.length?`<div class="pd-list">${visits.slice(0,3).map(t=>{const d=getUserById(t.doctorId);return `<button type="button" class="pd-item" ${bindAction('click',()=>viewTreatment(t.id))}>${dateTile(t.date)}<span class="pd-text"><strong>${escapeHtml(t.diagnosis||'Clinic visit')}</strong><small>${d?escapeHtml(docName(d)):'Clinic doctor'}${t.followupDate?` · Follow-up ${fmtDate(t.followupDate)}`:''}</small></span><i class="bi bi-chevron-right" aria-hidden="true"></i></button>`;}).join('')}</div>`:'<div class="empty-state"><p>Your visit summaries will appear here after a consultation.</p></div>'}
        </div>
        <div class="card pd-card"><div class="card-header"><h3>Health tips</h3><button class="btn btn-xs" ${bindAction('click',()=>navTo('health_education'))}>Health Education</button></div>
          ${articles.length?`<div class="pd-list">${articles.map(r=>`<button type="button" class="pd-item" ${bindAction('click',()=>viewArticle(r.id))}><span class="pd-dot" style="--cat:${articleCategoryColor(r.category)[1]}" aria-hidden="true"></span><span class="pd-text"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.category)}</small></span><i class="bi bi-chevron-right" aria-hidden="true"></i></button>`).join('')}</div>`:'<div class="empty-state"><p>No health articles yet.</p></div>'}
        </div>
      </div>
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
    const visitTrend=dashboardRangeCounts(a=>a.doctorId===appState.auth.currentUser.id&&a.status!=='Cancelled');
    const next=todayMine.find(a=>a.status==='Scheduled');
    let attention='';
    if(next){const pt=getPatientById(next.patientId);attention+=dashboardAttentionItem('Next patient',`${fmtTime(next.time)} · ${pt?pt.fname+' '+pt.lname:'Patient'} · ${next.service}`,'success');}
    if(scheduled.length)attention+=dashboardAttentionItem(`${scheduled.length} scheduled appointment${scheduled.length>1?'s':''}`,'Review your upcoming schedule and patient list.','warn');
    const certDrafts=(appState.data.DB.certRequests||[]).filter(r=>r.status==='Awaiting Signature'&&r.doctorId===appState.auth.currentUser.id).length;
    if(certDrafts)attention+=dashboardAttentionItem(`${certDrafts} certificate draft${certDrafts>1?'s':''}`,'Finish, sign and issue, or discard them.','warn');
    if(!attention)attention=dashboardAttentionItem('Schedule is clear','No urgent items need your attention.','success');
    const todayCompleted=todayMine.filter(a=>a.status==='Completed').length;
    // A patient's first booking with this doctor marks when they joined the doctor's list.
    const firstVisits=[...mine.filter(a=>a.status!=='Cancelled').sort((a,b)=>a.date.localeCompare(b.date)).reduce((first,a)=>first.has(a.patientId)?first:first.set(a.patientId,a),new Map()).values()];
    c.innerHTML=`<div class="dashboard-a">
      <div class="dashboard-a-head"><div><h3>${greeting}, Dr. ${escapeHtml(appState.auth.currentUser.lname)}.</h3><p>Your patient load and clinic activity at a glance.</p></div><div style="display:flex;gap:.55rem;align-items:end;flex-wrap:wrap"><button class="btn btn-sm" ${bindAction('click',(event,element)=>{navTo('schedule')})}>Full Schedule</button>${dashboardControlsHtml()}</div></div>
      <div class="dashboard-a-grid">
        ${dashboardStatCard("Today's patients",todayMine.length,`${todayCompleted} seen · ${todayMine.filter(a=>a.status==='Scheduled').length} waiting`,note(next?`Next at ${fmtTime(next.time)}`:'No one waiting right now'),'bi-clipboard2-pulse')}
        ${dashboardStatCard('Upcoming appointments',scheduled.length,'Scheduled from today onward',note(scheduled.length?`${plural(todayMine.filter(a=>a.status==='Scheduled').length,'appointment')} left today`:'Schedule is clear'),'bi-calendar-event',scheduled.length>8?'attention':'')}
        ${dashboardStatCard('Consultations completed',rangeMine.filter(a=>a.status==='Completed').length,rangeLabel,trend(completed,'good'),'bi-check2-circle')}
        ${dashboardStatCard('Patients under your care',uniquePatients,'Unique patients you have seen or booked',trend(firstVisits,'neutral',r=>r.date,'new'),'bi-people')}
      </div>
      ${dashboardMobileQuickLinks(role)}
      <div class="dashboard-a-main">
        <div class="card dashboard-trend-card"><div class="card-header"><div><h3>Patient Visits</h3><div class="text-muted">${rangeLabel}</div></div>${dashboardChartControlHtml()}</div><div class="dashboard-trend-wrap">${dashboardTrendSvg(visitTrend,'Appointments')}</div></div>
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
    if(pendingUsers.length)attention+=dashboardAttentionItem(`${pendingUsers.length} registration${pendingUsers.length>1?'s':''} to review`,'New patients are waiting in the Approval Queue.','warn');
    if(!attention)attention=dashboardAttentionItem('Operations look good','No urgent clinic items need attention.','success');
    c.innerHTML=`<div class="dashboard-a">
      <div class="dashboard-a-head"><div><h3>${greeting}, ${escapeHtml(appState.auth.currentUser.fname)}.</h3><p>Monitor clinic flow and operational tasks for the selected date.</p></div><div style="display:flex;gap:.55rem;align-items:end;flex-wrap:wrap"><button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{navTo('appointments')})}>Manage Appointments</button>${dashboardControlsHtml()}</div></div>
      <div class="dashboard-a-grid">
        ${dashboardStatCard("Today's appointments",allToday.length,`${allToday.filter(a=>a.status==='Completed').length} completed · ${allToday.filter(a=>a.status==='Scheduled').length} remaining`,note('Across all clinics today'),'bi-clock')}
        ${dashboardStatCard('Appointments in range',allRange.length,`<strong>${todayCompleted}</strong> completed · ${rangeLabel}`,trend(appointmentRecords().filter(a=>a.status!=='Cancelled')),'bi-calendar-event')}
        ${dashboardStatCard('Pending approvals',pendingUsers.length,pendingUsers.length?'Registrations awaiting review':'No registrations waiting',trend(pendingUsers,'bad',r=>r.createdAt,'new'),'bi-hourglass-split',pendingUsers.length?'attention':'')}
        ${dashboardStatCard('Low stock',lowStock.length,lowStock.length?'Inventory needs review':'Inventory levels healthy',note(lowStock.length?`${lowStock.slice(0,2).map(i=>i.name).join(', ')}${lowStock.length>2?' and more':''}`:'All items above their thresholds'),'bi-exclamation-triangle',lowStock.length?'critical':'')}
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
  const patientCohort=(appState.auth.currentUser?.role==='Administrator'?appState.data.DB.patients.filter(p=>p._realSupabase):appState.data.DB.patients).filter(p=>!p.archived);
  const activePatients=patientCohort.length;
  const completedToday=appointmentRecords().filter(a=>dashboardInRange(a.date)&&a.status==='Completed').length;
  let attention='';
  if(pendingUsers.length)attention+=dashboardAttentionItem(`${pendingUsers.length} pending user approval${pendingUsers.length>1?'s':''}`,'Review new CampusCare registrations.','warn');
  if(lowStock.length)attention+=dashboardAttentionItem(`${lowStock.length} low-stock item${lowStock.length>1?'s':''}`,`${lowStock.slice(0,2).map(i=>i.name).join(', ')}${lowStock.length>2?' and more':''}`,'danger');
  if(!attention)attention=dashboardAttentionItem('All systems normal','No urgent administrative items need attention.','success');
  const doctors=getDoctors();
  const doctorLoad=doctors.map(d=>({name:`Dr. ${d.lname}`,count:allToday.filter(a=>a.doctorId===d.id).length,max:d.maxPatients||20}));
  c.innerHTML=`<div class="dashboard-a">
    <div class="dashboard-a-head"><div><h3>${greeting}, ${escapeHtml(appState.auth.currentUser.fname)}.</h3><p>CampusCare clinic activity, priorities, and service load.</p></div><div style="display:flex;gap:.55rem;align-items:end;flex-wrap:wrap"><button class="btn btn-sm" ${bindAction('click',(event,element)=>{navTo('reports')})}>Open Reports & Analytics</button>${dashboardControlsHtml()}</div></div>
    <div class="dashboard-a-grid">
      ${dashboardStatCard('Appointments in range',allRange.length,`<strong>${completedToday}</strong> completed · ${rangeLabel}`,trend(appointmentRecords().filter(a=>a.status!=='Cancelled'),'good'),'bi-calendar-event')}
      ${dashboardStatCard('Active patients',activePatients,'Registered, not archived',trend(patientCohort,'good',r=>r.createdAt,'new'),'bi-people')}
      ${dashboardStatCard('Pending approvals',pendingUsers.length,pendingUsers.length?'Registrations awaiting review':'No registrations waiting',trend(pendingUsers,'bad',r=>r.createdAt,'new'),'bi-hourglass-split',pendingUsers.length?'attention':'')}
      ${dashboardStatCard('Low stock',lowStock.length,lowStock.length?'Inventory action required':'Inventory levels healthy',note(lowStock.length?`${lowStock.slice(0,2).map(i=>i.name).join(', ')}${lowStock.length>2?' and more':''}`:'All items above their thresholds'),'bi-exclamation-triangle',lowStock.length?'critical':'')}
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
