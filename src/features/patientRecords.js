// patientRecords: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {syncTreatmentContext,treatmentDisplayId,treatmentRecords} from './treatmentService.js';
import {escapeHtml} from './issueReports.js';
import {collegeBadge,fmtDate} from './inputValidation.js';
import {getUserById} from './documentScanner.js';
import {downloadTreatmentPDF,viewTreatment} from './treatmentForm.js';
import {docName} from './messaging.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// PATIENT – MY RECORDS
// ================================================================
export async function renderMyRecords(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncTreatmentContext();}
    catch(e){
      if(!isCampusPageCurrent('my-records',pageToken))return;
      console.error('My Records sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load your health records.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderMyRecords()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('my-records',pageToken))return;
  }

  const pt=appState.auth.currentPatient;
  if(!pt){c.innerHTML='<div class="alert alert-warning show">No patient record found.</div>';return;}
  const treats=treatmentRecords()
    .filter(t=>t.patientId===pt.id&&!t.archived)
    .slice()
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.id-a.id);

  c.innerHTML=`
    <div class="card">
      <div class="card-header"><h3>Personal Information</h3></div>
      <div class="grid-2" style="font-size:.83rem">
        <div class="info-row"><span class="info-label">Full Name</span><span class="info-val">${escapeHtml(pt.fname)} ${escapeHtml(pt.lname)}</span></div>
        <div class="info-row"><span class="info-label">Age</span><span class="info-val">${pt.age||'—'}</span></div>
        <div class="info-row"><span class="info-label">Gender</span><span class="info-val">${escapeHtml(pt.gender||'—')}</span></div>
        <div class="info-row"><span class="info-label">Blood Type</span><span class="info-val">${escapeHtml(pt.blood||'—')}</span></div>
        <div class="info-row"><span class="info-label">College</span><span class="info-val">${collegeBadge(pt.college)}</span></div>
        <div class="info-row"><span class="info-label">ID No.</span><span class="info-val">${escapeHtml(pt.idNo||'—')}</span></div>
        <div class="info-row full"><span class="info-label">Allergies</span><span class="info-val text-danger">${escapeHtml(pt.allergies||'None')}</span></div>
        <div class="info-row full"><span class="info-label">Medical History</span><span class="info-val">${escapeHtml(pt.medHistory||'None')}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Treatment History</h3></div>
      ${treats.length?`<div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Date</th><th>Diagnosis</th><th>Prescription</th><th>Doctor</th><th>Follow-up</th><th>Actions</th></tr></thead>
        <tbody>${treats.map(t=>{
          const doc=getUserById(t.doctorId);
          return `<tr style="cursor:pointer" ${bindAction('click',(event,element)=>{viewTreatment((t.id))})} title="Open treatment record">
            <td>#${treatmentDisplayId(t)}</td>
            <td>${fmtDate(t.date)}</td>
            <td>${escapeHtml(t.diagnosis)}${t.dentalRecord?'<br><span class="badge badge-info">Dental Record</span>':''}</td>
            <td style="max-width:180px">${escapeHtml(t.prescription||'—')}</td>
            <td>${doc?escapeHtml(docName(doc)):'Doctor'}</td>
            <td>${t.followupDate?fmtDate(t.followupDate):'—'}</td>
            <td><div class="td-actions" ${bindAction('click',(event,element)=>{event.stopPropagation()})}>
              <button class="btn btn-xs" ${bindAction('click',(event,element)=>{viewTreatment((t.id))})}>View</button>
              <button class="btn btn-xs btn-primary" ${bindAction('click',(event,element)=>{downloadTreatmentPDF((t.id))})}>Download PDF</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`:'<div class="empty-state"><p>No treatment records yet.</p></div>'}
    </div>`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
