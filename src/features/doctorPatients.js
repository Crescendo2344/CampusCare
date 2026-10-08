// doctorPatients: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {appointmentRecords,syncAppointmentContext} from './appointmentService.js';
import {escapeHtml} from './issueReports.js';
import {getPatientById} from './documentScanner.js';
import {viewPatient} from './patientForm.js';
import {patientAvatarHtml} from './patientManagement.js';
import {collegeBadge,priorityBadge} from './inputValidation.js';
import {openAddTreatmentModalPt} from './treatmentForm.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// DOCTOR – MY PATIENTS
// ================================================================
export async function renderMyPatients(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncAppointmentContext();}
    catch(e){
      if(!isCampusPageCurrent('my-patients',pageToken))return;
      console.error('My Patients sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load your patients.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderMyPatients()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('my-patients',pageToken))return;
  }
  const myApptPatients=appointmentRecords().filter(a=>a.doctorId===appState.auth.currentUser.id).map(a=>a.patientId);
  const uniqueIds=[...new Set(myApptPatients)];
  const myPts=uniqueIds.map(id=>getPatientById(id)).filter(Boolean);
  c.innerHTML=`
    <div class="toolbar">
      <input type="text" placeholder="Search patients..." id="mypt-search" ${bindAction('input',(event,element)=>{renderMyPatientsTable()})}>
      <select id="mypt-college" ${bindAction('change',(event,element)=>{renderMyPatientsTable()})}>
        <option value="">All Colleges</option>
        ${['CCICT','COE','COED','CME','CAS','COT'].map(c=>`<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="card"><div id="mypt-table"></div></div>`;
  appState.doctorPatients.myPatients=myPts;
  renderMyPatientsTable();
}

export function renderMyPatientsTable(){
  const q=(document.getElementById('mypt-search')||{}).value||'';
  const col=(document.getElementById('mypt-college')||{}).value||'';
  let pts=(appState.doctorPatients.myPatients||[]).filter(p=>{
    const name=`${p.fname} ${p.lname}`.toLowerCase();
    return (!q||name.includes(q.toLowerCase()))&&(!col||p.college===col);
  });
  const el=document.getElementById('mypt-table');
  if(!el)return;
  if(!pts.length){el.innerHTML='<div class="empty-state"><p>No patients found.</p></div>';return;}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Photo</th><th>Patient</th><th>College</th><th>Type</th><th>Blood</th><th>Allergies</th><th>Actions</th></tr></thead><tbody>${
    pts.map(p=>`<tr style="cursor:pointer" ${bindAction('click',(event,element)=>{viewPatient((p.id))})} title="Click to open patient record">
      <td>${patientAvatarHtml(p,32)}</td>
      <td><strong>${p.fname} ${p.lname}</strong><br><span class="text-muted">${p.idNo}</span></td>
      <td>${collegeBadge(p.college)}</td><td>${priorityBadge(p.personType)}</td>
      <td>${p.blood||'-'}</td>
      <td class="${p.allergies&&p.allergies!=='None'?'text-danger':''}">${p.allergies||'None'}</td>
      <td><div class="td-actions" ${bindAction('click',(event,element)=>{event.stopPropagation()})}>
        <button class="btn btn-xs" ${bindAction('click',(event,element)=>{viewPatient((p.id))})}>View</button>
        <button class="btn btn-xs btn-primary" ${bindAction('click',(event,element)=>{openAddTreatmentModalPt((p.id))})}>Add Treatment</button>
      </div></td>
    </tr>`).join('')
  }</tbody></table></div>`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
