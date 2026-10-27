// patientManagement: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {patientDisplayId,syncAdminDirectoryFromSupabase} from './patientService.js';
import {syncRealWorkflowRequests} from './workflowRequests.js';
import {escapeHtml} from './issueReports.js';
import {archivePatient,openPatientModal,restorePatient,viewPatient} from './patientForm.js';
import {getUserById} from './documentScanner.js';
import {showFilePreview} from './modals.js';
import {collegeBadge,fmtDate,priorityBadge} from './inputValidation.js';
import {bindAction,patientData} from '../dependencies.js';
import {appointmentRecords} from './appointmentService.js';
import {treatmentRecords} from './treatmentService.js';
// ================================================================
// PATIENTS PAGE (Staff/Admin)
// ================================================================
export async function renderPatients(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(appState.auth.currentUser?._realSupabase&&['Administrator','Staff'].includes(appState.auth.currentUser.role)){
    showDatabaseSkeleton('table');
    try{
      await Promise.all([
        syncAdminDirectoryFromSupabase(),
        syncRealWorkflowRequests()
      ]);
    }
    catch(e){
      if(!isCampusPageCurrent('patients',pageToken))return;
      console.error(e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load patient records.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderPatients()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('patients',pageToken))return;
  }
  const canEdit=appState.auth.currentUser.role==='Administrator'||appState.auth.currentUser.role==='Staff';
  c.innerHTML=`
    <div class="toolbar patient-records-toolbar">
      <input type="search" placeholder="Search name, ID, contact or email" aria-label="Search patients" id="pt-search" ${bindAction('input',(event,element)=>{appState.patientForm.patientPage=1;renderPatientTable()})}>
      <select id="pt-college" aria-label="College or department" ${bindAction('change',(event,element)=>{renderPatientTable()})}>${unitFilterOptionsHtml('')}</select>
      <select id="pt-ptype" aria-label="Patient type" ${bindAction('change',(event,element)=>{if(element.value&&element.value!=='Student')document.getElementById('pt-session').value='';syncUnitFilter(document.getElementById('pt-college'),element.value);renderPatientTable()})}>
        <option value="">All Types</option>
        <option>Student</option><option>Teaching Personnel</option><option>Non-Teaching Personnel</option>
      </select>
      <select id="pt-session" aria-label="Student class session" ${bindAction('change',(event,element)=>{if(element.value)document.getElementById('pt-ptype').value='Student';renderPatientTable()})}>
        <option value="">All Class Sessions</option><option value="Morning">Morning Students</option><option value="Evening">Evening Students</option>
      </select>
      <select id="pt-status" ${bindAction('change',(event,element)=>{renderPatientTable()})}>
        <option value="active">Active Records</option>
        <option value="archived">Archived Records</option>
        <option value="all">All Records</option>
      </select>
      <button class="btn btn-sm" ${bindAction('click',()=>exportPatientCsv())}><i class="bi bi-download" aria-hidden="true"></i> Export CSV</button>
      ${canEdit?`<button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{openPatientModal()})}>+ Add Patient</button>`:''}
    </div>
    <p class="patient-filter-summary" id="pt-filter-summary" role="status" aria-live="polite"></p>
    <div class="card"><div id="pt-table"></div></div>`;
  appState.patientForm.patientSort??={key:'name',direction:'asc'};
  appState.patientForm.patientPage=1;
  renderPatientTable();
}

// College/department filter options follow the person type, as on the registration form:
// students and teaching personnel belong to a college, non-teaching personnel to a department.
export function unitFilterOptionsHtml(personType,selected=''){
  const colleges=appState.documentScanner.REGISTRATION_ACADEMIC_UNITS||[];
  const departments=appState.documentScanner.REGISTRATION_NONTEACHING_DEPARTMENTS||[];
  const options=list=>list.map(([value,label])=>`<option value="${escapeHtml(value)}" ${value===selected?'selected':''}>${escapeHtml(label)}</option>`).join('');
  if(personType==='Non-Teaching Personnel')return `<option value="">All Departments</option>${options(departments)}`;
  if(personType)return `<option value="">All Colleges</option>${options(colleges)}`;
  return `<option value="">All Colleges &amp; Departments</option><optgroup label="Colleges">${options(colleges)}</optgroup><optgroup label="Departments">${options(departments)}</optgroup>`;
}
export function syncUnitFilter(select,personType){
  if(!select)return;
  const previous=select.value;
  select.innerHTML=unitFilterOptionsHtml(personType,previous);
  if(select.value!==previous)select.value='';
}

export function patientAvatarHtml(pt,size=36){
  const user=pt.userId?getUserById(pt.userId):null;
  const photo=(user&&user.profilePhoto)||pt.profilePhoto||'';
  const initials=((pt.fname?.[0]||'')+(pt.lname?.[0]||'')).toUpperCase()||'P';
  if(photo){
    return `<div style="width:${size}px;height:${size}px;position:relative;flex-shrink:0">
      <img src="${escapeHtml(photo)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;cursor:pointer;display:block"
        ${bindAction('click',(event,element)=>{event.stopPropagation();showFilePreview((String(pt.fname)+" "+String(pt.lname)+" - Photo"),(String(photo)))})}
        ${bindAction('error',(event,element)=>{element.style.display='none';element.nextElementSibling.style.display='flex'})}
        title="Click to view full size">
      <div class="sb-avatar" style="display:none;width:${size}px;height:${size}px;font-size:${Math.round(size*0.34)}px;position:absolute;inset:0;cursor:pointer"
        ${bindAction('click',(event,element)=>{event.stopPropagation();viewPatient((pt.id))})}>${initials}</div>
    </div>`;
  }
  return `<div class="sb-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.34)}px;flex-shrink:0;cursor:pointer"
    ${bindAction('click',(event,element)=>{event.stopPropagation();viewPatient((pt.id))})} title="No photo on file — click to view patient record">${initials}</div>`;
}

// Last completed visit for list columns, sorting and export.
function patientLastVisit(p){
  return patientData.patientVisitSummary(p.id,{appointments:appointmentRecords(),treatments:treatmentRecords(),today:appState.clinicInformation.TODAY}).lastVisit;
}

// Rows matching the toolbar filters, before sorting and paging.
function filteredPatients(){
  const q=((document.getElementById('pt-search')||{}).value||'').trim().toLowerCase();
  const col=(document.getElementById('pt-college')||{}).value||'';
  const ptype=(document.getElementById('pt-ptype')||{}).value||'';
  const session=document.getElementById('pt-session')?.value||'';
  const status=(document.getElementById('pt-status')||{}).value||'active';
  const sourcePatients=appState.auth.currentUser?._realSupabase
    ? appState.data.DB.patients.filter(p=>p._realSupabase)
    : appState.data.DB.patients;
  return sourcePatients.filter(p=>{
    const email=p.userId?getUserById(p.userId)?.email||'':'';
    const haystack=`${p.fname} ${p.lname} ${p.lname}, ${p.fname} ${p.idNo} P-${patientDisplayId(p)} ${p.contact||''} ${email}`.toLowerCase();
    const matchStatus=status==='all'||(status==='archived'?!!p.archived:!p.archived);
    return (!q||haystack.includes(q))&&(!col||p.college===col)&&(!ptype||p.personType===ptype)&&matchStatus&&(!session||(p.personType==='Student'&&p.classSession===session));
  });
}

export function exportPatientCsv(){
  const sort=appState.patientForm.patientSort||{key:'name',direction:'asc'};
  const rows=patientData.sortPatients(filteredPatients(),sort.key,sort.direction,patientLastVisit);
  const url=URL.createObjectURL(new Blob(['\ufeff'+patientData.patientsCsv(rows,patientLastVisit)],{type:'text/csv;charset=utf-8'}));
  const link=Object.assign(document.createElement('a'),{href:url,download:`campuscare-patients-${appState.clinicInformation.TODAY}.csv`});
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

const PATIENT_PAGE_SIZE=25;
export function sortPatientTable(key){
  const sort=appState.patientForm.patientSort||{key:'name',direction:'asc'};
  appState.patientForm.patientSort={key,direction:sort.key===key&&sort.direction==='asc'?'desc':'asc'};
  appState.patientForm.patientPage=1;
  renderPatientTable();
}

export function renderPatientTable(){
  const ptype=(document.getElementById('pt-ptype')||{}).value||'';
  const session=document.getElementById('pt-session')?.value||'';
  const sessionSelect=document.getElementById('pt-session');
  if(sessionSelect)sessionSelect.disabled=Boolean(ptype&&ptype!=='Student');
  const sort=appState.patientForm.patientSort||{key:'name',direction:'asc'};
  const all=patientData.sortPatients(filteredPatients(),sort.key,sort.direction,patientLastVisit);
  const pages=Math.max(1,Math.ceil(all.length/PATIENT_PAGE_SIZE));
  const page=Math.min(Math.max(1,appState.patientForm.patientPage||1),pages);
  appState.patientForm.patientPage=page;
  const pts=all.slice((page-1)*PATIENT_PAGE_SIZE,page*PATIENT_PAGE_SIZE);
  const el=document.getElementById('pt-table');
  if(!el)return;
  const summary=document.getElementById('pt-filter-summary');
  if(summary)summary.textContent=`${all.length} patient record${all.length===1?'':'s'}${session?' · '+session+' students':''}`;
  const canEdit=appState.auth.currentUser.role==='Administrator'||appState.auth.currentUser.role==='Staff';
  if(!all.length){el.innerHTML='<div class="empty-state"><p>No patients match these filters.</p></div>';return;}
  const header=(key,label)=>{
    const active=sort.key===key;
    return `<th aria-sort="${active?(sort.direction==='asc'?'ascending':'descending'):'none'}"><button type="button" class="th-sort ${active?'active':''}" ${bindAction('click',()=>sortPatientTable(key))}>${label}<span aria-hidden="true">${active?(sort.direction==='asc'?' <i class="bi bi-caret-up-fill" aria-hidden="true"></i>':' <i class="bi bi-caret-down-fill" aria-hidden="true"></i>'):' <i class="bi bi-arrow-down-up" aria-hidden="true"></i>'}</span></button></th>`;
  };
  const pager=pages>1?`<div class="pt-pager"><span>Showing ${(page-1)*PATIENT_PAGE_SIZE+1}–${(page-1)*PATIENT_PAGE_SIZE+pts.length} of ${all.length}</span>
    <div><button class="btn btn-xs" ${page===1?'disabled':''} ${bindAction('click',()=>{appState.patientForm.patientPage=page-1;renderPatientTable();})}>‹ Previous</button>
    <button class="btn btn-xs" ${page===pages?'disabled':''} ${bindAction('click',()=>{appState.patientForm.patientPage=page+1;renderPatientTable();})}>Next ›</button></div></div>`:'';
  el.innerHTML=`<div class="table-wrap"><table class="patient-records-table"><thead><tr>${header('name','Patient')}${header('age','Age / Sex')}${header('college','College / Dept.')}<th>Type</th><th>Class Session</th><th>Blood</th>${header('lastVisit','Last Visit')}<th>Contact</th><th>Actions</th></tr></thead><tbody>${
    pts.map(p=>{
      const last=patientLastVisit(p);
      const allergy=patientData.hasAllergyAlert(p.allergies);
      return `<tr ${p.archived?'style="opacity:.6;cursor:pointer"':'style="cursor:pointer"'} ${bindAction('click',(event,element)=>{viewPatient((p.id))})} title="Click to view patient record">
      <td><div class="pt-identity">${patientAvatarHtml(p,34)}<div><strong>${escapeHtml(p.lname)}, ${escapeHtml(p.fname)}</strong>${allergy?' <span class="badge badge-danger pt-allergy-flag" title="Allergies: '+escapeHtml(p.allergies)+'">Allergy</span>':''}${p.archived?' <span class="badge badge-gray">Archived</span>':''}<div class="text-muted">P-${patientDisplayId(p)} · ${escapeHtml(p.idNo||'No ID no.')}</div></div></div></td>
      <td>${p.age===''||p.age==null?'—':escapeHtml(String(p.age))}${p.gender?' · '+escapeHtml(p.gender.charAt(0)):''}</td><td>${collegeBadge(p.college)}</td>
      <td>${priorityBadge(p.personType)}</td><td>${p.personType==='Student'?escapeHtml(p.classSession||'—'):'—'}</td><td>${escapeHtml(p.blood||'—')}</td>
      <td>${last?fmtDate(last):'<span class="text-muted">No visits</span>'}</td><td>${escapeHtml(p.contact||'—')}</td>
      <td><div class="td-actions" ${bindAction('click',(event,element)=>{event.stopPropagation()})}>
        <button class="btn btn-xs" ${bindAction('click',(event,element)=>{viewPatient((p.id))})}>View</button>
        ${canEdit&&!p.archived?`<button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{openPatientModal((p.id))})}>Edit</button>`:''}
        ${appState.auth.currentUser.role==='Administrator'?(p.archived?`<button class="btn btn-xs btn-success" ${bindAction('click',(event,element)=>{restorePatient((p.id))})}>Restore</button>`:`<button class="btn btn-xs btn-warning" ${bindAction('click',(event,element)=>{archivePatient((p.id))})}><i class="bi bi-archive" aria-hidden="true"></i> Archive</button>`):''}
      </div></td>
    </tr>`;}).join('')
  }</tbody></table></div>${pager}`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
