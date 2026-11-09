// doctorPatients: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {appointmentRecords,syncAppointmentContext} from './appointmentService.js';
import {escapeHtml} from './issueReports.js';
import {getPatientById} from './documentScanner.js';
import {viewPatient} from './patientForm.js';
import {patientAvatarHtml,unitFilterOptionsHtml} from './patientManagement.js';
import {collegeBadge,fmtDate,priorityBadge} from './inputValidation.js';
import {patientDisplayId} from './patientService.js';
import {paginate,pagerHtml} from '../ui/pager.js';
import {openAddTreatmentModalPt} from './treatmentForm.js';
import {bindAction,patientData} from '../dependencies.js';
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
  // Each patient this doctor has seen or will see, with their last and next visit with this doctor.
  const today=appState.clinicInformation.TODAY,visits=new Map();
  for(const a of appointmentRecords().filter(a=>a.doctorId===appState.auth.currentUser.id)){
    const v=visits.get(a.patientId)||{last:'',next:''};
    if(a.date<=today&&a.status==='Completed'&&a.date>v.last)v.last=a.date;
    if(a.date>=today&&['Scheduled','Confirmed'].includes(a.status)&&(!v.next||a.date<v.next))v.next=a.date;
    visits.set(a.patientId,v);
  }
  appState.doctorPatients.myPatients=[...visits.keys()].map(id=>{const p=getPatientById(id);return p&&{p,...visits.get(id)};}).filter(Boolean);
  c.innerHTML=`
    <div class="toolbar">
      <input type="search" placeholder="Search name, ID or patient no." id="mypt-search" aria-label="Search your patients" ${bindAction('input',()=>renderMyPatientsTable())}>
      <select id="mypt-college" aria-label="College or department" ${bindAction('change',()=>renderMyPatientsTable())}>${unitFilterOptionsHtml('')}</select>
    </div>
    <div class="card"><div id="mypt-table"></div></div>`;
  renderMyPatientsTable();
}

export function renderMyPatientsTable(){
  const q=((document.getElementById('mypt-search')||{}).value||'').trim().toLowerCase();
  const col=(document.getElementById('mypt-college')||{}).value||'';
  const all=(appState.doctorPatients.myPatients||[]).filter(({p})=>{
    const haystack=`${p.fname} ${p.lname} ${p.lname}, ${p.fname} ${p.idNo||''} P-${patientDisplayId(p)}`.toLowerCase();
    return (!q||haystack.includes(q))&&(!col||p.college===col);
  }).sort((a,b)=>(b.next?1:0)-(a.next?1:0)||String(a.next||'9').localeCompare(String(b.next||'9'))||String(b.last).localeCompare(String(a.last)));
  const el=document.getElementById('mypt-table');
  if(!el)return;
  if(!all.length){el.innerHTML=`<div class="empty-state"><p>${q||col?'No patients match these filters.':'No patients yet.'}</p></div>`;return;}
  const page=paginate('my-patients',all,{signature:q+'|'+col});
  el.innerHTML=`<div class="table-wrap"><table class="patient-records-table"><thead><tr><th>Patient</th><th>College / Dept.</th><th>Type</th><th>Blood</th><th>Last visit</th><th>Next visit</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${
    page.rows.map(({p,last,next})=>{
      const allergy=patientData.hasAllergyAlert(p.allergies);
      return `<tr style="cursor:pointer" ${bindAction('click',()=>viewPatient(p.id))} title="Open patient record">
      <td><div class="pt-identity">${patientAvatarHtml(p,34)}<div><strong>${escapeHtml(p.lname)}, ${escapeHtml(p.fname)}</strong>${allergy?' <span class="badge badge-danger pt-allergy-flag" title="Allergies: '+escapeHtml(p.allergies)+'">Allergy</span>':''}<div class="text-muted">P-${patientDisplayId(p)} · ${escapeHtml(p.idNo||'No ID no.')}</div></div></div></td>
      <td>${collegeBadge(p.college)}</td><td>${priorityBadge(p.personType)}</td><td>${escapeHtml(p.blood||'—')}</td>
      <td>${last?fmtDate(last):'<span class="text-muted">None yet</span>'}</td>
      <td>${next?fmtDate(next):'<span class="text-muted">—</span>'}</td>
      <td><div class="td-actions" ${bindAction('click',event=>event.stopPropagation())}>
        <button class="btn btn-xs" ${bindAction('click',()=>viewPatient(p.id))}>View</button>
        <button class="btn btn-xs btn-primary" ${bindAction('click',()=>openAddTreatmentModalPt(p.id))}>Add treatment</button>
      </div></td>
    </tr>`;}).join('')
  }</tbody></table></div>${pagerHtml(page,renderMyPatientsTable)}`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
