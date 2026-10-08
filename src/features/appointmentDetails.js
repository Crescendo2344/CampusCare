// appointmentDetails: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {appointmentDisplayId,appointmentRecords} from './appointmentService.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {closeAllModals,openModal} from './modals.js';
import {viewPatient} from './patientForm.js';
import {escapeHtml} from './issueReports.js';
import {collegeBadge,fmtDate,fmtTime,priorityBadge,statusBadge} from './inputValidation.js';
import {openAddTreatmentModal} from './treatmentForm.js';
import {openRescheduleModal} from './bookingForm.js';
import {bindAction} from '../dependencies.js';
// ── View Appointment ──
export function viewAppt(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  const pt=getPatientById(a.patientId);
  const doc=getUserById(a.doctorId);
  const clinicalUser=['Doctor','Staff','Administrator'].includes(appState.auth.currentUser.role);
  const canTreat=appState.auth.currentUser.role==='Doctor'&&a.doctorId===appState.auth.currentUser.id&&a.status==='Scheduled'&&a.date<=appState.clinicInformation.TODAY;
  const canManage=['Staff','Administrator'].includes(appState.auth.currentUser.role)&&a.status==='Scheduled';

  openModal(`<div class="modal">
    <div class="modal-header">
      <h3>Appointment #${appointmentDisplayId(a)}</h3>
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
    </div>
    <div class="modal-body">
      <div class="info-row">
        <span class="info-label">Patient</span>
        <span class="info-val">${pt
          ? (clinicalUser
              ? `<button class="link-btn" ${bindAction('click',(event,element)=>{closeAllModals();viewPatient((pt.id))})}>${escapeHtml(pt.fname+' '+pt.lname)}</button>`
              : escapeHtml(pt.fname+' '+pt.lname))
          : 'Unknown'}</span>
      </div>
      <div class="info-row"><span class="info-label">College</span><span class="info-val">${collegeBadge(a.college||pt?.college||'')}</span></div>
      <div class="info-row"><span class="info-label">Priority</span><span class="info-val">${priorityBadge(a.priority||pt?.personType||'')}</span></div>
      <div class="info-row"><span class="info-label">Clinic</span><span class="info-val">${escapeHtml(a.clinic||'—')}</span></div>
      <div class="info-row"><span class="info-label">Service</span><span class="info-val">${escapeHtml(a.service||'—')}</span></div>
      <div class="info-row"><span class="info-label">Doctor</span><span class="info-val">${doc?`Dr. ${escapeHtml(doc.fname+' '+doc.lname)}${doc.specialty?` · ${escapeHtml(doc.specialty)}`:''}`:'Unknown'}</span></div>
      <div class="info-row"><span class="info-label">Date & Time</span><span class="info-val">${fmtDate(a.date)} at ${fmtTime(a.time)}</span></div>
      <div class="info-row"><span class="info-label">Reason</span><span class="info-val">${escapeHtml(a.reason||'—')}</span></div>
      <div class="info-row"><span class="info-label">Status</span><span class="info-val">${statusBadge(a.status)}</span></div>
      ${a.notes?`<div class="info-row"><span class="info-label">Notes</span><span class="info-val">${escapeHtml(a.notes)}</span></div>`:''}
    </div>
    <div class="modal-footer">
      ${clinicalUser&&pt?`<button class="btn" ${bindAction('click',(event,element)=>{closeAllModals();viewPatient((pt.id))})}>View Patient</button>`:''}
      ${canTreat?`<button class="btn btn-primary" ${bindAction('click',(event,element)=>{closeAllModals();openAddTreatmentModal((a.id))})}>📝 Add Notes & Complete</button>`:''}
      ${canManage?`<button class="btn btn-warning" ${bindAction('click',(event,element)=>{closeAllModals();openRescheduleModal((a.id))})}>Reschedule</button>`:''}
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
    </div>
  </div>`);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
