// appointments: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {appointmentAction,appointmentDisplayId,appointmentRecords,syncAppointmentContext,syncRealAppointments} from './appointmentService.js';
import {escapeHtml} from './issueReports.js';
import {openApptRangePicker} from './datePicker.js';
import {openBookApptModal,openRescheduleModal} from './bookingForm.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {viewAppt} from './appointmentDetails.js';
import {patientAvatarHtml,unitFilterOptionsHtml} from './patientManagement.js';
import {patientDisplayId} from './patientService.js';
import {clinicToday} from './scheduleAndDrafts.js';
import * as listData from '../domain/appointment-list.js';
import {viewPatient} from './patientForm.js';
import {fmtDate,fmtTime,priorityBadge,statusBadge} from './inputValidation.js';
import {openAddTreatmentModal} from './treatmentForm.js';
import {showConfirmDialog,toast} from './theme.js';
import {persistDB} from './persistence.js';
import {renderMyAppointments} from './patientAppointments.js';
import {closeAllModals,openModal} from './modals.js';
import {addNotif} from './notifications.js';
import {bindAction} from '../dependencies.js';
import {refreshTaskBadges} from './topbarAndNavigation.js';
import {canManageSlots,openSlotManager} from './slotManager.js';
// ================================================================
// APPOINTMENTS PAGE (Staff/Admin/Doctor)
// ================================================================
export async function renderAppointments(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncAppointmentContext();}
    catch(e){
      if(!isCampusPageCurrent('appointments',pageToken))return;
      console.error('Appointments sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load appointments.')}</div><button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderAppointments()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('appointments',pageToken))return;
  }
  const role=appState.auth.currentUser.role;
  const ui=appState.appointments??={};
  ui.view=ui.view||'upcoming';ui.page=1;
  const doctors=role==='Doctor'?[]:(appState.data.DB.users||[]).filter(u=>u.role==='Doctor'&&(!appState.auth.currentUser._realSupabase||u._realSupabase));
  c.innerHTML=`
    <div class="appt-head"><div class="appt-views" role="tablist" aria-label="Appointment lists" id="appt-views"></div>
      <div class="appt-head-actions">${canManageSlots()?`<button class="btn btn-sm" id="appt-manage-slots" ${bindAction('click',()=>openSlotManager())}><i class="bi bi-sliders" aria-hidden="true"></i> Manage time slots</button>`:''}
      ${role!=='Doctor'?`<button class="btn btn-primary btn-sm" ${bindAction('click',()=>{openBookApptModal()})}>+ Book Appointment</button>`:''}</div></div>
    <div class="toolbar appt-toolbar">
      <input type="search" placeholder="Search patient, ID, appointment #, doctor or service" aria-label="Search appointments" id="appt-search" ${bindAction('input',()=>{ui.page=1;renderApptTable()})}>
      <select id="appt-status" aria-label="Status" ${bindAction('change',()=>{ui.page=1;renderApptTable()})}>
        <option value="">All statuses</option>
        <option>Scheduled</option><option>Completed</option><option>Cancelled</option><option>No-show</option>
      </select>
      <select id="appt-college" aria-label="College or department" ${bindAction('change',()=>{ui.page=1;renderApptTable()})}>${unitFilterOptionsHtml('')}</select>
      <select id="appt-clinic" aria-label="Clinic" ${bindAction('change',()=>{ui.page=1;renderApptTable()})}>
        <option value="">All clinics</option>
        <option>Medical Clinic</option><option>Dental Clinic</option>
      </select>
      ${doctors.length?`<select id="appt-doctor" aria-label="Doctor" ${bindAction('change',()=>{ui.page=1;renderApptTable()})}><option value="">All doctors</option>${doctors.map(d=>`<option value="${d.id}">Dr. ${escapeHtml(d.fname+' '+d.lname)}</option>`).join('')}</select>`:''}
      <div class="appt-range-filter"><input type="hidden" id="appt-date-from"><input type="hidden" id="appt-date-to"><button type="button" class="modern-date-btn" aria-label="Filter by date range" ${bindAction('click',()=>{openApptRangePicker()})}><i class="bi bi-calendar3" aria-hidden="true"></i><span id="appt-range-label">All dates</span></button></div>
      <button class="btn btn-sm" ${bindAction('click',()=>exportAppointmentsCsv())}><i class="bi bi-download" aria-hidden="true"></i> Export CSV</button>
    </div>
    <p class="patient-filter-summary" id="appt-summary" role="status" aria-live="polite"></p>
    <div class="card"><div id="appt-table"></div></div>`;
  renderApptTable();
}

const APPT_VIEWS=[
  ['upcoming','Upcoming','Scheduled for today or later'],
  ['outcome','Needs outcome','Past appointments still marked Scheduled'],
  ['history','History','Completed, cancelled and no-show'],
  ['all','All','Every appointment']
];
const APPT_PAGE_SIZE=25;
const clinicNow=()=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());

// Every filter except the tab, so tab counts show what each list would contain.
function filteredAppointments(){
  const value=id=>document.getElementById(id)?.value||'';
  const q=value('appt-search').trim().toLowerCase(),stat=value('appt-status'),unit=value('appt-college'),clinic=value('appt-clinic');
  const doctor=Number(value('appt-doctor'))||0,dateFrom=value('appt-date-from'),dateTo=value('appt-date-to');
  const account=appState.auth.currentUser;
  return appointmentRecords().filter(a=>{
    if(account.role==='Doctor'&&a.doctorId!==account.id)return false;
    const pt=getPatientById(a.patientId),doc=getUserById(a.doctorId);
    const haystack=[pt?`${pt.fname} ${pt.lname} ${pt.lname}, ${pt.fname} P-${patientDisplayId(pt)} ${pt.idNo||''}`:'',`#${appointmentDisplayId(a)} ${a.dbAppointmentId||a.id}`,doc?`Dr. ${doc.fname} ${doc.lname}`:'',a.clinic,a.service,a.reason].join(' ').toLowerCase();
    return (!q||haystack.includes(q))&&(!stat||a.status===stat)&&(!unit||(a.college||pt?.college||'')===unit)
      &&(!clinic||a.clinic===clinic)&&(!doctor||a.doctorId===doctor)&&(!dateFrom||a.date>=dateFrom)&&(!dateTo||a.date<=dateTo);
  });
}

function describeAppointment(a){
  const pt=getPatientById(a.patientId),doc=getUserById(a.doctorId);
  return [appointmentDisplayId(a),a.date,a.time,pt?`${pt.lname}, ${pt.fname}`:'Unknown',pt?`P-${patientDisplayId(pt)}`:'',a.college||pt?.college||'',a.clinic,a.service||'',doc?`Dr. ${doc.fname} ${doc.lname}`:'',a.priority||pt?.personType||'',a.status,a.reason||''];
}
export function exportAppointmentsCsv(){
  const view=appState.appointments?.view||'upcoming',today=clinicToday();
  const rows=listData.sortAppointments(filteredAppointments().filter(a=>view==='all'||listData.appointmentView(a,today)===view),view);
  const url=URL.createObjectURL(new Blob(['﻿'+listData.appointmentsCsv(rows,describeAppointment)],{type:'text/csv;charset=utf-8'}));
  const link=Object.assign(document.createElement('a'),{href:url,download:`campuscare-appointments-${view}-${today}.csv`});
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function apptActionButtons(a,allowed,{compact=true}={}){
  const size=compact?'btn-xs':'btn-sm';
  const primary=allowed.document
    ?`<button class="btn ${size} btn-primary" ${bindAction('click',()=>{closeAllModals();openAddTreatmentModal(a.id)})}><i class="bi bi-journal-medical" aria-hidden="true"></i> Add notes &amp; complete</button>`
    :`<button class="btn ${size}" ${bindAction('click',()=>viewAppt(a.id))}>View</button>`;
  const more=[
    allowed.reschedule&&`<button type="button" role="menuitem" ${bindAction('click',()=>{closeAllModals();openRescheduleModal(a.id)})}><i class="bi bi-calendar2-week" aria-hidden="true"></i> Reschedule</button>`,
    allowed.remind&&`<button type="button" role="menuitem" ${bindAction('click',()=>sendApptNotif(a.id))}><i class="bi bi-bell" aria-hidden="true"></i> Send reminder</button>`,
    allowed.noShow&&`<button type="button" role="menuitem" ${bindAction('click',()=>noShowAppt(a.id))}><i class="bi bi-person-x" aria-hidden="true"></i> Mark no-show</button>`,
    allowed.cancel&&`<button type="button" role="menuitem" class="danger" ${bindAction('click',()=>cancelAppt(a.id))}><i class="bi bi-x-circle" aria-hidden="true"></i> Cancel appointment</button>`
  ].filter(Boolean);
  return {primary,more};
}
export function apptMenuHtml(more,label){
  if(!more.length)return '';
  return `<details class="row-menu" ${bindAction('toggle',(event,element)=>{if(element.open)for(const other of document.querySelectorAll('.row-menu[open]'))if(other!==element)other.open=false;})}>
    <summary class="btn btn-xs" aria-label="More actions for ${escapeHtml(label)}"><i class="bi bi-three-dots" aria-hidden="true"></i></summary>
    <div class="row-menu-list" role="menu" ${bindAction('click',(event,element)=>{if(event.target.closest('button'))element.closest('details').open=false;})}>${more.join('')}</div>
  </details>`;
}
export function appointmentAllowedActions(a){
  return listData.appointmentActions(a,{role:appState.auth.currentUser.role,userId:appState.auth.currentUser.id,today:clinicToday(),now:clinicNow()});
}

export function renderApptTable(){
  const el=document.getElementById('appt-table');
  if(!el)return;
  const ui=appState.appointments??={view:'upcoming',page:1};
  const today=clinicToday();
  const filtered=filteredAppointments();
  const counts=listData.appointmentViewCounts(filtered,today);
  const tabs=document.getElementById('appt-views');
  if(tabs)tabs.innerHTML=APPT_VIEWS.map(([id,label,hint])=>`<button type="button" role="tab" class="appt-view ${ui.view===id?'active':''} ${id==='outcome'&&counts.outcome?'attention':''}" aria-selected="${ui.view===id}" title="${hint}" ${bindAction('click',()=>{ui.view=id;ui.page=1;renderApptTable();})}>${label}<span class="appt-view-count">${counts[id]}</span></button>`).join('');
  const all=listData.sortAppointments(filtered.filter(a=>ui.view==='all'||listData.appointmentView(a,today)===ui.view),ui.view);
  const pages=Math.max(1,Math.ceil(all.length/APPT_PAGE_SIZE));
  const page=Math.min(Math.max(1,ui.page||1),pages);ui.page=page;
  const rows=all.slice((page-1)*APPT_PAGE_SIZE,page*APPT_PAGE_SIZE);
  const summary=document.getElementById('appt-summary');
  if(summary)summary.textContent=`${all.length} appointment${all.length===1?'':'s'} · ${APPT_VIEWS.find(([id])=>id===ui.view)[1]}`;
  if(!all.length){
    const empty={upcoming:'No upcoming appointments match these filters.',outcome:'Nothing to close out. Every past appointment has an outcome.',history:'No completed, cancelled or no-show appointments match these filters.',all:'No appointments match these filters.'}[ui.view];
    el.innerHTML=`<div class="empty-state"><i class="bi bi-calendar2-check" aria-hidden="true" style="font-size:1.6rem"></i><p>${empty}</p></div>`;
    return;
  }
  let lastDay='';
  const body=rows.map(a=>{
    const pt=getPatientById(a.patientId),doc=getUserById(a.doctorId);
    const name=pt?`${pt.lname}, ${pt.fname}`:'Unknown patient';
    const {primary,more}=apptActionButtons(a,appointmentAllowedActions(a));
    const heading=a.date!==lastDay?`<tr class="appt-day-row"><th colspan="7" scope="rowgroup">${escapeHtml(listData.appointmentDayHeading(a.date,today))}</th></tr>`:'';
    lastDay=a.date;
    const overdue=listData.appointmentView(a,today)==='outcome';
    return `${heading}<tr class="appt-row" ${bindAction('click',()=>viewAppt(a.id))}>
      <td data-label="Time"><strong class="appt-time">${fmtTime(a.time)}</strong><div class="text-muted">#${appointmentDisplayId(a)}</div></td>
      <td data-label="Patient"><div class="pt-identity">${pt?patientAvatarHtml(pt,32):''}<div>${pt?`<button type="button" class="link-btn" ${bindAction('click',(event)=>{event.stopPropagation();viewPatient(pt.id)})}><strong>${escapeHtml(name)}</strong></button>`:`<strong>${escapeHtml(name)}</strong>`}<div class="text-muted">${pt?`P-${patientDisplayId(pt)} · `:''}${escapeHtml(a.college||pt?.college||'—')}</div></div></div></td>
      <td data-label="Service"><strong>${escapeHtml(a.service||a.clinic||'—')}</strong><div class="text-muted">${escapeHtml(a.clinic||'')}</div></td>
      <td data-label="Doctor">${doc?`Dr. ${escapeHtml(doc.fname+' '+doc.lname)}`:'<span class="text-muted">Unassigned</span>'}</td>
      <td data-label="Priority">${priorityBadge(a.priority||pt?.personType||'')}</td>
      <td data-label="Status">${statusBadge(a.status)}${overdue?'<div class="appt-overdue">Outcome needed</div>':''}</td>
      <td data-label="Actions"><div class="td-actions" ${bindAction('click',(event)=>{event.stopPropagation()})}>${primary}${apptMenuHtml(more,`appointment #${appointmentDisplayId(a)}`)}</div></td>
    </tr>`;
  }).join('');
  const pager=pages>1?`<div class="pt-pager"><span>Showing ${(page-1)*APPT_PAGE_SIZE+1}–${(page-1)*APPT_PAGE_SIZE+rows.length} of ${all.length}</span>
    <div><button class="btn btn-xs" ${page===1?'disabled':''} ${bindAction('click',()=>{ui.page=page-1;renderApptTable();})}>‹ Previous</button>
    <button class="btn btn-xs" ${page===pages?'disabled':''} ${bindAction('click',()=>{ui.page=page+1;renderApptTable();})}>Next ›</button></div></div>`:'';
  el.innerHTML=`<div class="table-wrap"><table class="appt-table"><thead><tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col">Service</th><th scope="col">Doctor</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${body}</tbody></table></div>${pager}`;
}

export function completeAppt(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  showConfirmDialog({
    title:'Complete Appointment',
    message:`Mark appointment #${a.dbAppointmentId||id} as completed?`,
    confirmLabel:'Mark Completed',
    onConfirm:async()=>{
      try{
        if(a._realSupabase){
          await appointmentAction({action:'status',appointment_id:a.dbAppointmentId,status:'Completed'});
          await syncRealAppointments();
        }else{
          a.status='Completed';persistDB();
        }
        toast('Appointment marked as completed.','success');refreshTaskBadges(true);
        if(appState.auth.currentUser.role==='Patient')await renderMyAppointments();else await renderAppointments();
      }catch(e){toast(e?.message||'Unable to complete appointment.','error');}
    }
  });
}

export function noShowAppt(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  showConfirmDialog({
    title:'Mark as No-show',
    message:`Mark appointment #${a.dbAppointmentId||id} as a no-show?`,
    confirmLabel:'Mark No-show',danger:true,
    onConfirm:async()=>{
      try{
        if(a._realSupabase){
          await appointmentAction({action:'status',appointment_id:a.dbAppointmentId,status:'No-show'});
          await syncRealAppointments();
        }else{a.status='No-show';persistDB();}
        toast('Marked as no-show.','warning');refreshTaskBadges(true);
        closeAllModals();
        await renderAppointments();
      }catch(e){toast(e?.message||'Unable to update appointment.','error');}
    }
  });
}

const CANCEL_REASONS=['Doctor unavailable','Clinic closure or emergency','Patient asked to cancel','Booked by mistake or duplicate','Patient no longer needs the visit'];

export function cancelAppt(id,patient=false){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  // Patients cancel their own visit with one confirmation. Clinic staff cancel someone else's
  // visit, so they give a reason the patient will see and then confirm it deliberately.
  const clinicSide=!patient&&appState.auth.currentUser?.role!=='Patient';
  if(!clinicSide){
    openModal(`<div class="modal modal-sm">
      <div class="modal-header"><h3>Cancel Appointment</h3><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
      <div class="modal-body">
        <p style="font-size:.86rem;margin-bottom:.7rem">Are you sure you want to cancel this appointment?</p>
        <div class="form-group"><label>Reason (optional)</label><textarea id="cancel-appt-reason" rows="2" placeholder="Reason for cancellation"></textarea></div>
      </div>
      <div class="modal-footer">
        <button class="btn" ${bindAction('click',()=>closeAllModals())}>Go Back</button>
        <button class="btn btn-danger" ${bindAction('click',()=>confirmCancelAppt(id,patient))}>Cancel Appointment</button>
      </div>
    </div>`);
    return;
  }
  const pt=getPatientById(a.patientId),doc=getUserById(a.doctorId);
  const ptName=pt?`${pt.fname} ${pt.lname}`:'this patient';
  const summary=`<dl class="cancel-summary">
      <div><dt>Patient</dt><dd>${escapeHtml(ptName)}</dd></div>
      <div><dt>When</dt><dd>${escapeHtml(fmtDate(a.date))} · ${escapeHtml(fmtTime(a.time))}</dd></div>
      <div><dt>Where</dt><dd>${escapeHtml(a.clinic||'—')}${a.service?' · '+escapeHtml(a.service):''}</dd></div>
      ${doc?`<div><dt>Doctor</dt><dd>Dr. ${escapeHtml(doc.fname+' '+doc.lname)}</dd></div>`:''}
    </dl>`;
  openModal(`<div class="modal modal-sm cancel-flow">
    <div class="modal-header"><div><h3>Cancel appointment</h3><p class="form-note" id="cancel-step-label">Step 1 of 2 · Reason</p></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      ${summary}
      <section id="cancel-step-1">
        <div class="form-group"><label for="cancel-reason-choice">Reason <span class="required">*</span></label>
          <select id="cancel-reason-choice" ${bindAction('change',()=>updateCancelReason())}><option value="">Choose a reason</option>${CANCEL_REASONS.map(r=>`<option>${r}</option>`).join('')}<option value="other">Other</option></select></div>
        <div class="form-group"><label for="cancel-appt-reason">Details <span class="text-muted" id="cancel-details-optional">(optional)</span></label>
          <textarea id="cancel-appt-reason" rows="2" maxlength="400" placeholder="Anything the patient should know, e.g. how to rebook" ${bindAction('input',()=>updateCancelReason())}></textarea></div>
        <p class="form-note"><i class="bi bi-bell" aria-hidden="true"></i> ${escapeHtml(ptName)} is notified with this reason.</p>
      </section>
      <section id="cancel-step-2" hidden>
        <div class="cancel-warning"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div><strong>This can't be undone.</strong><span>The appointment is cancelled, the time slot opens to other patients, and ${escapeHtml(ptName)} is notified. To see them again, book a new appointment.</span></div></div>
        <p class="cancel-reason-preview" id="cancel-reason-preview"></p>
        <div class="form-group"><label for="cancel-confirm-text">Type <strong>CANCEL</strong> to confirm</label>
          <input id="cancel-confirm-text" autocomplete="off" autocapitalize="characters" spellcheck="false" ${bindAction('input',(event,element)=>{document.getElementById('cancel-final').disabled=element.value.trim().toUpperCase()!=='CANCEL';})}></div>
      </section>
    </div>
    <div class="modal-footer" id="cancel-actions">
      <button class="btn" ${bindAction('click',()=>closeAllModals())}>Keep appointment</button>
      <button class="btn btn-danger" id="cancel-next" disabled ${bindAction('click',()=>showCancelConfirmStep(id))}>Continue</button>
    </div>
  </div>`);
}

function cancelReasonText(){
  const choice=document.getElementById('cancel-reason-choice')?.value||'',details=(document.getElementById('cancel-appt-reason')?.value||'').trim();
  if(choice==='other')return details;
  return choice?(details?`${choice}. ${details}`:choice):'';
}

function updateCancelReason(){
  const other=document.getElementById('cancel-reason-choice').value==='other';
  document.getElementById('cancel-details-optional').textContent=other?'(required)':'(optional)';
  document.getElementById('cancel-next').disabled=!cancelReasonText()||(other&&(document.getElementById('cancel-appt-reason').value.trim().length<5));
}

function showCancelConfirmStep(id){
  const reason=cancelReasonText();
  if(!reason)return;
  document.getElementById('cancel-step-1').hidden=true;document.getElementById('cancel-step-2').hidden=false;
  document.getElementById('cancel-step-label').textContent='Step 2 of 2 · Confirm';
  document.getElementById('cancel-reason-preview').textContent='Reason sent to the patient: '+reason;
  document.getElementById('cancel-actions').innerHTML=`<button class="btn" ${bindAction('click',()=>{
      document.getElementById('cancel-step-1').hidden=false;document.getElementById('cancel-step-2').hidden=true;
      document.getElementById('cancel-step-label').textContent='Step 1 of 2 · Reason';
      document.getElementById('cancel-actions').innerHTML=`<button class="btn" ${bindAction('click',()=>closeAllModals())}>Keep appointment</button><button class="btn btn-danger" id="cancel-next" ${bindAction('click',()=>showCancelConfirmStep(id))}>Continue</button>`;
    })}>Back</button><button class="btn btn-danger" id="cancel-final" disabled ${bindAction('click',()=>confirmCancelAppt(id,false,reason))}>Cancel appointment</button>`;
  document.getElementById('cancel-confirm-text').focus();
}

export async function confirmCancelAppt(id,patient=false,givenReason=null){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  const reason=givenReason??(document.getElementById('cancel-appt-reason')?.value||'').trim();
  closeAllModals();
  try{
    if(a._realSupabase){
      await appointmentAction({action:'cancel',appointment_id:a.dbAppointmentId,reason});
      await syncRealAppointments();
    }else{
      a.status='Cancelled';a.cancellationReason=reason;persistDB();
    }
    toast('Appointment cancelled.','warning');refreshTaskBadges(true);
    if(patient||appState.auth.currentUser.role==='Patient')await renderMyAppointments();else await renderAppointments();
  }catch(e){toast(e?.message||'Unable to cancel appointment.','error');}
}

// Reminders are in-app notifications on the patient's account; the server allows one per appointment
// every 12 hours so a patient is not flooded.
export async function sendApptNotif(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));
  if(!a)return;
  const pt=getPatientById(a.patientId);
  if(!pt)return;
  const name=`${pt.fname} ${pt.lname}`;
  try{
    if(a._realSupabase){
      await appointmentAction({action:'remind',appointment_id:a.dbAppointmentId});
    }else{
      const u=appState.data.DB.users.find(x=>x.id===pt.userId);
      if(!u){toast(`${name} has no CampusCare account to notify.`,'warning');return;}
      addNotif(u.id,'Appointment reminder',`Reminder: ${a.clinic} appointment on ${fmtDate(a.date)} at ${fmtTime(a.time)}. Please bring your signed COR (Certificate of Registration) for this semester when you arrive at the clinic.`,'warning');
    }
    toast(`Reminder sent to ${name}. They will see it in their CampusCare notifications.`,'success');
  }catch(e){toast(e?.message||'Unable to send the reminder.','error');}
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  // Row action menus close on an outside click or Escape, like other menus.
  document.addEventListener('click',event=>{
    for(const menu of document.querySelectorAll('.row-menu[open]'))if(!menu.contains(event.target))menu.open=false;
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    const menu=document.querySelector('.row-menu[open]');
    if(menu){menu.open=false;menu.querySelector('summary')?.focus();}
  });
}
