// appointmentDetails: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {appointmentDisplayId,appointmentRecords} from './appointmentService.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {closeAllModals,openModal} from './modals.js';
import {viewPatient} from './patientForm.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate,fmtTime,priorityBadge,statusBadge} from './inputValidation.js';
import {appointmentAllowedActions,cancelAppt,noShowAppt,sendApptNotif} from './appointments.js';
import {patientAvatarHtml} from './patientManagement.js';
import {patientDisplayId} from './patientService.js';
import {clinicToday} from './scheduleAndDrafts.js';
import * as listData from '../domain/appointment-list.js';
import {openAddTreatmentModal} from './treatmentForm.js';
import {corChecklistHtml,openRescheduleModal} from './bookingForm.js';
import {bindAction} from '../dependencies.js';
// ── View Appointment ──
// Summary first (who, when, where), then the visit details and its history, with the same actions as the list.
export function viewAppt(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  const pt=getPatientById(a.patientId);
  const doc=getUserById(a.doctorId);
  const role=appState.auth.currentUser.role;
  const clinicalUser=['Doctor','Staff','Administrator'].includes(role);
  const allowed=appointmentAllowedActions(a);
  const today=clinicToday();
  const overdue=a.status==='Scheduled'&&a.date<today;
  const createdBy=a.createdBy?getUserById(a.createdBy):null;
  const row=(label,value)=>`<div class="info-row"><span class="info-label">${label}</span><span class="info-val">${value}</span></div>`;
  const name=pt?escapeHtml(pt.fname+' '+pt.lname):'Unknown patient';
  const history=[
    a.createdAt&&`Booked ${fmtDate(String(a.createdAt).slice(0,10))}${createdBy?` by ${escapeHtml(createdBy.fname+' '+createdBy.lname)}`:''}`,
    a.status==='Cancelled'&&`Cancelled${a.cancelledAt?' '+fmtDate(String(a.cancelledAt).slice(0,10)):''}${a.cancellationReason?` — ${escapeHtml(a.cancellationReason)}`:''}`,
    a.status==='Completed'&&'Visit completed and documented',
    a.status==='No-show'&&'Patient did not arrive (no-show)'
  ].filter(Boolean);

  openModal(`<div class="modal appt-detail">
    <div class="modal-header">
      <div><h3>Appointment #${appointmentDisplayId(a)}</h3><div class="copilot-subtitle">${listData.appointmentDayHeading(a.date,today)} at ${fmtTime(a.time)}</div></div>
      <button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button>
    </div>
    <div class="modal-body">
      <div class="appt-detail-head">
        ${pt?patientAvatarHtml(pt,44):''}
        <div class="appt-detail-who">
          ${pt&&clinicalUser?`<button class="link-btn" ${bindAction('click',()=>{closeAllModals();viewPatient(pt.id)})}><strong>${name}</strong></button>`:`<strong>${name}</strong>`}
          <span class="text-muted">${pt?`P-${patientDisplayId(pt)} · `:''}${escapeHtml(a.college||pt?.college||'—')}</span>
        </div>
        <div class="appt-detail-status">${statusBadge(a.status)}</div>
      </div>
      ${overdue?'<div class="alert alert-warning show" style="display:block">This appointment date has passed but it is still marked Scheduled. Record the outcome: the doctor adds visit notes, or mark it as a no-show.</div>':''}
      ${row('Clinic',escapeHtml(a.clinic||'—'))}
      ${row('Service',escapeHtml(a.service||'—'))}
      ${row('Doctor',doc?`Dr. ${escapeHtml(doc.fname+' '+doc.lname)}${doc.specialty?` · ${escapeHtml(doc.specialty)}`:''}`:'Unassigned')}
      ${row('Priority',priorityBadge(a.priority||pt?.personType||''))}
      ${row('Reason for visit',escapeHtml(a.reason||'—'))}
      ${a.notes?row('Notes',escapeHtml(a.notes)):''}
      ${role==='Patient'&&a.status==='Scheduled'&&a.date>=today?corChecklistHtml(a.date,pt?.personType):''}
      ${history.length?`<h4 class="appt-detail-section">History</h4><ul class="appt-history">${history.map(item=>`<li>${item}</li>`).join('')}</ul>`:''}
    </div>
    <div class="modal-footer appt-detail-actions">
      ${allowed.cancel?`<button class="btn btn-danger" ${bindAction('click',()=>cancelAppt(a.id))}>Cancel appointment</button>`:''}
      ${allowed.noShow?`<button class="btn" ${bindAction('click',()=>noShowAppt(a.id))}>Mark no-show</button>`:''}
      ${allowed.remind?`<button class="btn" ${bindAction('click',()=>sendApptNotif(a.id))}><i class="bi bi-bell" aria-hidden="true"></i> Send reminder</button>`:''}
      ${allowed.reschedule?`<button class="btn btn-warning" ${bindAction('click',()=>{closeAllModals();openRescheduleModal(a.id)})}>Reschedule</button>`:''}
      ${allowed.document?`<button class="btn btn-primary" ${bindAction('click',()=>{closeAllModals();openAddTreatmentModal(a.id)})}>Add notes &amp; complete</button>`:''}
    </div>
  </div>`);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
