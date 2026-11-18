// Clinic Calendar & Queue (Staff and Doctors).
// A month of the person's own clinic's bookings, and the selected day's queue in the order patients are
// seen. Medical Clinic people see only Medical bookings and Dental Clinic people only Dental ones; the
// database enforces the same rule (staff read their clinic's appointments, doctors their own).
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {appointmentDisplayId,appointmentRecords,syncAppointmentContext} from './appointmentService.js';
import {apptActionButtons,apptMenuHtml,appointmentAllowedActions,clinicNow} from './appointments.js';
import {viewAppt} from './appointmentDetails.js';
import {openBookApptModal} from './bookingForm.js';
import {escapeHtml} from './issueReports.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {patientAvatarHtml} from './patientManagement.js';
import {patientDisplayId} from './patientService.js';
import {viewPatient} from './patientForm.js';
import {clinicToday} from './scheduleAndDrafts.js';
import {fmtDate,fmtTime,priorityBadge,statusBadge} from './inputValidation.js';
import {triageVitalsChipHtml} from './triageVitals.js';
import {calendarClinicFor,calendarScope,dayCounts,dayQueue,monthGrid,nowServing,shiftMonth} from '../domain/clinic-calendar.js';
import {bindAction} from '../dependencies.js';

const st=()=>appState.clinicCalendar;
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export async function renderClinicCalendar(){
  const c=document.getElementById('app-content');
  const account=appState.auth.currentUser;
  const clinic=calendarClinicFor(account);
  if(!clinic){
    c.innerHTML=`<div class="empty-state"><i class="bi bi-calendar-x" aria-hidden="true" style="font-size:1.6rem"></i><p>${account?.role==='Staff'
      ?'Your account is not assigned to the Medical or Dental Clinic yet. Ask the administrator to set your clinic.'
      :'The Clinic Calendar & Queue is for Medical and Dental Clinic staff and doctors.'}</p></div>`;
    return;
  }
  const pageToken=captureCampusPageToken();
  if(account._realSupabase){
    if(!document.getElementById('cq-root'))showDatabaseSkeleton('table');
    try{await syncAppointmentContext();}
    catch(e){
      if(!isCampusPageCurrent('clinic-calendar',pageToken))return;
      console.error('Clinic calendar sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load the clinic calendar.')}</div><button class="btn btn-sm" ${bindAction('click',()=>renderClinicCalendar())}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('clinic-calendar',pageToken))return;
  }
  const s=st(),today=clinicToday();
  s.date=s.date||today;s.month=s.month||s.date.slice(0,7);
  const isDental=clinic==='Dental Clinic';
  c.innerHTML=`<div id="cq-root" class="cq-root">
    <div class="cq-head">
      <div><span class="badge ${isDental?'badge-info':'badge-success'} cq-clinic"><i class="bi ${isDental?'bi-emoji-smile':'bi-hospital'}" aria-hidden="true"></i> ${escapeHtml(clinic)}</span>
        <p class="text-muted cq-scope">${account.role==='Doctor'?'Your own bookings only.':`Bookings of the ${escapeHtml(clinic)} only.`}</p></div>
      <div class="cq-head-actions">
        <button class="btn btn-sm" ${bindAction('click',()=>{s.date=today;s.month=today.slice(0,7);paint();})}><i class="bi bi-calendar-event" aria-hidden="true"></i> Today</button>
        ${account.role==='Staff'?`<button class="btn btn-primary btn-sm" ${bindAction('click',()=>openBookApptModal())}>+ Book Appointment</button>`:''}
      </div>
    </div>
    <div class="cq-layout">
      <section class="card cq-calendar" aria-labelledby="cq-month-title"><div id="cq-month"></div></section>
      <section class="card cq-day" aria-labelledby="cq-day-title"><div id="cq-queue"></div></section>
    </div>
  </div>`;
  paint();
}

function scopedRows(){return calendarScope(appointmentRecords(),appState.auth.currentUser);}
function paint(){renderMonth();renderQueue();}
// Redraw from the records already loaded (no reload), e.g. after the selected day changes elsewhere.
export function repaintClinicCalendar(){if(document.getElementById('cq-root'))paint();}

function renderMonth(){
  const el=document.getElementById('cq-month');if(!el)return;
  const s=st(),today=clinicToday(),counts=dayCounts(scopedRows());
  const label=new Date(s.month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
  const monthTotal=Object.entries(counts).filter(([d])=>d.startsWith(s.month)).reduce((n,[,v])=>n+v.total,0);
  const cells=monthGrid(s.month).map(d=>{
    const n=counts[d.date],classes=['cq-cell'];
    if(!d.inMonth)classes.push('outside');if(d.weekend)classes.push('weekend');
    if(d.date===today)classes.push('today');if(d.date===s.date)classes.push('selected');
    if(n?.waiting&&d.date<today)classes.push('attention');
    const longDate=fmtDate(d.date);
    const aria=`${longDate}: ${n?`${n.total} booking${n.total===1?'':'s'}${n.waiting?`, ${n.waiting} waiting`:''}`:'no bookings'}`;
    return `<button type="button" class="${classes.join(' ')}" aria-label="${escapeHtml(aria)}" aria-pressed="${d.date===s.date}" ${bindAction('click',()=>{s.date=d.date;if(!d.inMonth)s.month=d.date.slice(0,7);paint();})}>
      <span class="cq-num">${d.day}</span>
      ${n?.total?`<span class="cq-count">${n.total}</span><span class="cq-bar" aria-hidden="true">${n.completed?`<i class="done" style="flex:${n.completed}"></i>`:''}${n.noShow?`<i class="noshow" style="flex:${n.noShow}"></i>`:''}${n.waiting?`<i class="waiting" style="flex:${n.waiting}"></i>`:''}</span>`:''}
    </button>`;
  }).join('');
  el.innerHTML=`<div class="cq-month-head">
      <button type="button" class="btn btn-xs" aria-label="Previous month" ${bindAction('click',()=>{s.month=shiftMonth(s.month,-1);renderMonth();})}><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
      <h3 id="cq-month-title">${escapeHtml(label)}</h3>
      <button type="button" class="btn btn-xs" aria-label="Next month" ${bindAction('click',()=>{s.month=shiftMonth(s.month,1);renderMonth();})}><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
    </div>
    <p class="text-muted cq-month-total">${monthTotal} booking${monthTotal===1?'':'s'} this month</p>
    <div class="cq-grid" role="group" aria-label="Days of ${escapeHtml(label)}">${WEEKDAYS.map(w=>`<span class="cq-weekday" aria-hidden="true">${w}</span>`).join('')}${cells}</div>
    <div class="cq-legend"><span><i class="waiting"></i> Waiting</span><span><i class="done"></i> Completed</span><span><i class="noshow"></i> No-show</span></div>`;
}

function renderQueue(){
  const el=document.getElementById('cq-queue');if(!el)return;
  const s=st(),today=clinicToday(),account=appState.auth.currentUser,doctorView=account.role==='Doctor';
  const {live,cancelled}=dayQueue(scopedRows(),s.date);
  const serving=nowServing(live,{date:s.date,today,now:clinicNow()});
  const waiting=live.filter(a=>a.status==='Scheduled').length,done=live.filter(a=>a.status==='Completed').length,noShow=live.filter(a=>a.status==='No-show').length;
  const rel=s.date===today?'Today · ':'';
  const row=a=>{
    const pt=getPatientById(a.patientId),doc=getUserById(a.doctorId);
    const name=pt?`${pt.lname}, ${pt.fname}`:'Unknown patient';
    const {primary,more}=apptActionButtons(a,appointmentAllowedActions(a));
    const cls=['cq-item',a.status==='Scheduled'?'waiting':a.status==='Completed'?'done':a.status==='No-show'?'noshow':'cancelled',serving?.id===a.id?'serving':''].filter(Boolean).join(' ');
    return `<li class="${cls}">
      <div class="cq-no" aria-label="${a.queueNo?`Queue number ${a.queueNo}`:'Cancelled'}">${a.queueNo?`No. ${a.queueNo}`:'—'}</div>
      <div class="cq-main" ${bindAction('click',()=>viewAppt(a.id))}>
        <div class="cq-time"><strong>${fmtTime(a.time)}</strong> <span class="text-muted">#${appointmentDisplayId(a)}</span>${serving?.id===a.id?' <span class="badge badge-warning">Now serving</span>':''}</div>
        <div class="pt-identity">${pt?patientAvatarHtml(pt,32):''}<div>${pt?`<button type="button" class="link-btn" ${bindAction('click',(event)=>{event.stopPropagation();viewPatient(pt.id)})}><strong>${escapeHtml(name)}</strong></button>`:`<strong>${escapeHtml(name)}</strong>`}
          <div class="text-muted">${pt?`P-${patientDisplayId(pt)} · `:''}${escapeHtml(a.college||pt?.college||'—')}</div></div></div>
        <div class="cq-meta"><span>${escapeHtml(a.service||'—')}</span>${doctorView?'':`<span>${doc?`Dr. ${escapeHtml(doc.fname+' '+doc.lname)}`:'Unassigned'}</span>`}${priorityBadge(a.priority||pt?.personType||'')}</div>
      </div>
      <div class="cq-side">${statusBadge(a.status)}${triageVitalsChipHtml(a)}<div class="td-actions">${primary}${apptMenuHtml(more,`appointment #${appointmentDisplayId(a)}`)}</div></div>
    </li>`;
  };
  el.innerHTML=`<div class="cq-day-head"><div><h3 id="cq-day-title">${rel}${escapeHtml(fmtDate(s.date))}</h3>
      <p class="text-muted">${live.length} in queue · ${waiting} waiting · ${done} completed · ${noShow} no-show${cancelled.length?` · ${cancelled.length} cancelled`:''}</p></div></div>
    ${live.length||cancelled.length?`<ol class="cq-list" aria-label="Queue for ${escapeHtml(fmtDate(s.date))}">${live.map(row).join('')}</ol>
      ${cancelled.length?`<details class="cq-cancelled"><summary>${cancelled.length} cancelled</summary><ol class="cq-list">${cancelled.map(row).join('')}</ol></details>`:''}`
      :`<div class="empty-state"><i class="bi bi-calendar2" aria-hidden="true" style="font-size:1.5rem"></i><p>No bookings on this day.</p></div>`}`;
}

export function initializeFeature(){appState.clinicCalendar??={};}
