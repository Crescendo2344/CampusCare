// certificateService: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {syncAdminDirectoryFromSupabase,syncCurrentPatientFromSupabase} from './patientService.js';
import {syncRealTreatments,treatmentRecords} from './treatmentService.js';
import {escapeHtml} from './issueReports.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {fmtDate,fmtDateTime} from './inputValidation.js';
import {closeAllModals,openModal} from './modals.js';
import {showConfirmDialog,toast} from './theme.js';
import {persistDB} from './persistence.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {viewPatient} from './patientForm.js';
import {docName} from './messaging.js';
import {loadJsPDF} from './settingsAndCertificates.js';
import {bindAction,certificateData,createCertificateService} from '../dependencies.js';
import * as purposeData from '../domain/certificate-purpose.js';
// Preserve legacy handlers while certificate data access lives in independent modules.
export function certificateRecords(){return certificateData.certificateRecords(appState.data.DB,appState.auth.currentUser);}
export function certificateDisplayId(r){return certificateData.certificateDisplayId(r);}
export function certificateNumberFor(r){return certificateData.certificateNumberFor(r);}
export function realCertificateToUi(r){return certificateData.realCertificateToUi(r);}
export function certificateService(){
  return createCertificateService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY});
}
export async function certificateAction(payload){return certificateService().action(payload);}
export async function syncRealCertificates(){
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return certificateRecords();
  const rows=await certificateService().loadCertificates();
  if(appState.auth.currentUser!==account)return [];
  appState.data.DB.certRequests=certificateData.mergeCertificateRecords(appState.data.DB.certRequests||[],rows);
  return certificateRecords();
}

export async function syncCertificateContext(){
  if(!appState.auth.currentUser?._realSupabase)return;

  if(['Administrator','Staff','Doctor'].includes(appState.auth.currentUser.role)){
    await syncAdminDirectoryFromSupabase();
    if(typeof syncRealTreatments==='function')await syncRealTreatments();
  }else if(appState.auth.currentUser.role==='Patient'){
    if(!appState.auth.currentPatient||!appState.auth.currentPatient._realSupabase)await syncCurrentPatientFromSupabase();
  }

  await syncRealCertificates();
}

// Draft = "Awaiting Signature", Voided = "Cancelled"; older request statuses keep their names.
const STATUS_LABELS={'Awaiting Signature':'Draft',Cancelled:'Voided'};
export const certStatusLabel=s=>STATUS_LABELS[s]||s||'';
export function certStatusBadge(s){
  const m={Pending:'badge-warning','Awaiting Signature':'badge-purple',Issued:'badge-success',Declined:'badge-danger',Cancelled:'badge-gray'};
  return `<span class="badge ${m[s]||'badge-gray'}">${escapeHtml(certStatusLabel(s))}</span>`;
}

// Patients receive certificates their doctor issued; they cannot request or change them.
export async function renderMyCertificates(){
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncCertificateContext();}
    catch(e){
      if(!isCampusPageCurrent('my-certificates',pageToken))return;
      console.error('Certificate sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load medical certificates.')}</div>
        <button class="btn btn-sm" ${bindAction('click',()=>renderMyCertificates())}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('my-certificates',pageToken))return;
  }

  const pt=appState.auth.currentPatient;
  if(!pt){
    c.innerHTML='<div class="alert alert-warning show">No patient record linked. Contact admin.</div>';
    return;
  }

  const certs=certificateRecords()
    .filter(r=>r.patientId===pt.id&&(r.status==='Issued'||(r.status==='Cancelled'&&r.issuedAt)))
    .sort((a,b)=>String(b.issuedAt).localeCompare(String(a.issuedAt))||b.id-a.id);

  c.innerHTML=`<div class="card">
    <div class="card-header"><div><h3>Medical Certificates</h3><div class="text-muted">Certificates your clinic doctor issued to you. If you need one, ask the doctor during your consultation.</div></div></div>
    ${certs.length?`<div class="table-wrap"><table class="cert-list-table">
        <thead><tr><th scope="col">Certificate No.</th><th scope="col">Purpose</th><th scope="col">Issued</th><th scope="col">Doctor</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${certs.map(r=>{const doctor=getUserById(r.doctorId);return `<tr>
          <td data-label="Certificate No."><strong>${escapeHtml(r.certNo||'—')}</strong></td>
          <td data-label="Purpose">${escapeHtml(r.purpose)}${r.details?`<div class="text-muted">${escapeHtml(r.details)}</div>`:''}</td>
          <td data-label="Issued">${r.issuedAt?fmtDate(String(r.issuedAt).slice(0,10)):'—'}</td>
          <td data-label="Doctor">${doctor?escapeHtml(docName(doctor)):'—'}</td>
          <td data-label="Status">${certStatusBadge(r.status)}${r.status==='Cancelled'&&r.declineReason?`<div class="text-muted">${escapeHtml(r.declineReason)}</div>`:''}</td>
          <td data-label="Actions">${r.status==='Issued'?`<button class="btn btn-xs btn-primary" ${bindAction('click',()=>downloadCertPdf(r.id))}><i class="bi bi-download" aria-hidden="true"></i> Download PDF</button>`:''}</td>
        </tr>`;}).join('')}</tbody>
      </table></div>`:'<div class="empty-state"><i class="bi bi-file-earmark-medical" aria-hidden="true" style="font-size:1.6rem"></i><p>No medical certificates yet.</p></div>'}
  </div>`;
}

// ---- DOCTOR WORKFLOW ----
// The examining doctor decides whether to issue a certificate, writes it from the visit notes and signs it.

// Return the newest clinical record for this patient, preferring the selected doctor's own record.
export function getLatestTreatmentForCertificate(patientId,doctorId=null){
  const byDoctor=treatmentRecords().filter(t=>t.patientId===patientId&&!t.archived&&(!doctorId||t.doctorId===doctorId));
  const fallback=treatmentRecords().filter(t=>t.patientId===patientId&&!t.archived);
  const list=byDoctor.length?byDoctor:fallback;
  return list.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||b.id-a.id)[0]||null;
}

// Build the default certificate text from findings, diagnosis, notes, treatment and follow-up data.
export function certificateAutofillFromTreatment(patientId,doctorId){
  const t=getLatestTreatmentForCertificate(patientId,doctorId);
  if(!t)return {findings:'',remarks:'',treatment:null};
  const findings=[t.findings,t.diagnosis?`Diagnosis: ${t.diagnosis}`:''].filter(Boolean).join(' — ');
  const remarks=[t.notes,t.prescription?`Prescription / Treatment: ${t.prescription}`:'',t.followupDate?`Follow-up: ${fmtDate(t.followupDate)}`:''].filter(Boolean).join(' ');
  return {findings,remarks,treatment:t};
}

// Ensures newly generated and previously saved medical certificates include
// the official CTU Main Campus logo. Older saved certificate HTML is upgraded
// when it is opened or exported.
export function ensureCertificateLogo(html=''){
  let value=String(html||'');
  if(!value)return value;
  if(value.includes('data-ctu-cert-logo="1"'))return value;
  const logo=`<img data-ctu-cert-logo="1" src="${appState.utilities.CTU_MAIN_LOGO_DATA}" alt="CTU Main Campus Logo" style="width:84px;height:84px;object-fit:contain;display:block;margin:0 auto 8px">`;
  if(value.includes('<div class="cert-center">'))return value.replace('<div class="cert-center">',`<div class="cert-center">${logo}`);
  return logo+value;
}

// Keep saved certificate HTML synchronized with its current issued metadata.
// This also repairs older saved documents that contained the literal text
// "Invalid Date" because issued_at is a full ISO timestamp.
export function normalizeCertificateDocumentMetadata(r,html=''){
  const value=ensureCertificateLogo(String(html||''));
  if(!value)return value;

  const shell=document.createElement('div');
  shell.innerHTML=value;

  const noEl=shell.querySelector('#cert-number-display');
  if(noEl)noEl.textContent=r?.certNo||certificateDisplayId(r);

  const dateEl=shell.querySelector('#cert-date-display');
  if(dateEl){
    const sourceDate=r?.issuedAt||r?.signedAt||r?.requestedAt||appState.clinicInformation.TODAY;
    dateEl.textContent=fmtDate(sourceDate);
  }

  return shell.innerHTML;
}

// Create the editable A4-like certificate document shown in the browser.
export function buildCertificateDocument(r,doctorId,findings,remarks,signature=''){
  const pt=getPatientById(r.patientId)||{};
  const u=getUserById(pt.userId)||{};
  const doctor=getUserById(doctorId)||{};
  const fullName=`${u.fname||pt.fname||''} ${u.lname||pt.lname||''}`.trim()||'Patient';
  const age=pt.age?`, ${pt.age} years old`:'';
  const gender=(pt.gender||pt.sex)?`, ${pt.gender||pt.sex}`:'';
  const college=(u.college||pt.college)?`, of ${u.college||pt.college}`:'';
  const idNo=(u.idNo||pt.idNo)?` (ID No. ${u.idNo||pt.idNo})`:'';
  const certNo=r.certNo||'To be assigned upon issue';
  const certDate=r.issuedAt||appState.clinicInformation.TODAY;
  const doctorName=`DR. ${((doctor.fname||'')+' '+(doctor.lname||'')).toUpperCase().trim()}`;
  return `<div class="cert-center"><img data-ctu-cert-logo="1" src="${appState.utilities.CTU_MAIN_LOGO_DATA}" alt="CTU Main Campus Logo" style="width:84px;height:84px;object-fit:contain;display:block;margin:0 auto 8px"><div style="font-size:14px">Republic of the Philippines</div><div style="font-size:19px;font-weight:700">CEBU TECHNOLOGICAL UNIVERSITY</div><div>Main Campus</div><div style="font-size:13px">M.J. Cuenco Ave. cor. R. Palma St., Cebu City</div><div style="font-weight:700;margin-top:4px">CTU MAIN MEDICAL CLINIC</div><div style="font-size:12px">Ground Floor, Education Building</div><div style="font-size:12px">Phone: (032) 402 4060 loc. 1142 · ctumainmedclinic@gmail.com</div></div>
    <hr class="cert-rule">
    <div class="cert-title">MEDICAL CERTIFICATE</div>
    <div class="cert-meta"><span>Certificate No.: <strong id="cert-number-display">${escapeHtml(certNo)}</strong></span><span>Date: <strong id="cert-date-display">${escapeHtml(fmtDate(certDate))}</strong></span></div>
    <p><strong>TO WHOM IT MAY CONCERN:</strong></p>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${escapeHtml(fullName)}</strong>${escapeHtml(age+gender+college+idNo)}, was seen and examined at the University Medical Clinic, Cebu Technological University – Main Campus.</p>
    <p><strong>FINDINGS / DIAGNOSIS:</strong> <span id="cert-findings-edit" data-cert-field="findings">${escapeHtml(findings||'')}</span></p>
    <p><strong>REMARKS / RECOMMENDATIONS:</strong> <span id="cert-remarks-edit" data-cert-field="remarks">${escapeHtml(remarks||'')}</span></p>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;The above-named patient <span data-cert-field="statement">${escapeHtml(r.statement||'')}</span></p>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued for <span data-cert-field="purpose">${escapeHtml((r.purpose||'').toLowerCase())}</span> purposes.</p>
    <div class="cert-signature-area" contenteditable="false">
      <img id="cert-signature-img" src="${signature||''}" style="${signature?'':'display:none'}" alt="Physician signature">
      <div class="cert-sign-line"><strong id="cert-doctor-name">${escapeHtml(doctorName)}</strong><br><span>Attending Physician</span><br><span style="font-size:13px">License No. _______________</span></div>
    </div>
    <p style="font-size:13px;font-style:italic;margin-top:42px">Not valid without the official clinic seal.</p>`;
}

export function certEditorToolbarHtml(){
  return `<div class="cert-word-toolbar" aria-label="Document formatting toolbar">
    <button type="button" title="Bold" ${bindAction('mousedown',(event,element)=>{event.preventDefault();formatCertDocument('bold')})}><strong>B</strong></button>
    <button type="button" title="Italic" ${bindAction('mousedown',(event,element)=>{event.preventDefault();formatCertDocument('italic')})}><em>I</em></button>
    <button type="button" title="Underline" ${bindAction('mousedown',(event,element)=>{event.preventDefault();formatCertDocument('underline')})}><u>U</u></button>
    <span class="toolbar-sep"></span>
    <button type="button" title="Align left" ${bindAction('mousedown',(event,element)=>{event.preventDefault();formatCertDocument('justifyLeft')})}>☰</button>
    <button type="button" title="Center" ${bindAction('mousedown',(event,element)=>{event.preventDefault();formatCertDocument('justifyCenter')})}>≡</button>
    <button type="button" title="Align right" ${bindAction('mousedown',(event,element)=>{event.preventDefault();formatCertDocument('justifyRight')})}>☷</button>
    <span class="toolbar-sep"></span>
    <select ${bindAction('change',(event,element)=>{formatCertDocument('fontSize',element.value);element.value=''})} title="Text size"><option value="">Text size</option><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">Larger</option></select>
    <button type="button" title="Undo" ${bindAction('mousedown',(event,element)=>{event.preventDefault();formatCertDocument('undo')})}>↶</button>
    <button type="button" title="Redo" ${bindAction('mousedown',(event,element)=>{event.preventDefault();formatCertDocument('redo')})}>↷</button>
  </div>`;
}

const isDoctor=()=>appState.auth.currentUser?.role==='Doctor';
const CERT_TABS=[['Awaiting Signature','Drafts'],['Issued','Issued'],['Cancelled','Voided'],['all','All']];

export async function renderCertRequests(filter=null){
  const c=document.getElementById('app-content');
  if(!c)return;
  if(!isDoctor()){
    c.innerHTML='<div class="alert alert-warning show" style="display:block">Medical certificates are issued by clinic doctors only.</div>';
    return;
  }
  const pageToken=captureCampusPageToken();
  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncCertificateContext();}
    catch(e){
      if(!isCampusPageCurrent('cert-requests',pageToken))return;
      console.error('Certificate sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load medical certificates.')}</div>
        <button class="btn btn-sm" ${bindAction('click',()=>renderCertRequests(filter))}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('cert-requests',pageToken))return;
  }
  const ui=appState.certificateService;
  const mine=certificateRecords().filter(r=>r.doctorId===appState.auth.currentUser.id);
  if(!filter)filter=ui.certTab||(mine.some(r=>r.status==='Awaiting Signature')?'Awaiting Signature':'Issued');
  ui.certTab=filter;
  const q=String(ui.certQuery||'').trim().toLowerCase();
  const patientName=r=>{const pt=getPatientById(r.patientId);return pt?`${pt.lname}, ${pt.fname}`:'Unknown patient';};
  const counts=Object.fromEntries(CERT_TABS.map(([id])=>[id,id==='all'?mine.length:mine.filter(r=>r.status===id).length]));
  const list=mine
    .filter(r=>filter==='all'||r.status===filter)
    .filter(r=>!q||`${patientName(r)} ${r.certNo} ${r.purpose} ${r.details}`.toLowerCase().includes(q))
    .sort((a,b)=>String(b.issuedAt||b.preparedAt||b.requestedAt).localeCompare(String(a.issuedAt||a.preparedAt||a.requestedAt))||b.id-a.id);

  c.innerHTML=`<div class="appt-head"><div class="appt-views" role="tablist" aria-label="Certificate lists">${CERT_TABS.map(([id,label])=>`<button type="button" role="tab" class="appt-view ${filter===id?'active':''} ${id==='Awaiting Signature'&&counts[id]?'attention':''}" aria-selected="${filter===id}" ${bindAction('click',()=>renderCertRequests(id))}>${label}<span class="appt-view-count">${counts[id]}</span></button>`).join('')}</div>
      <button class="btn btn-primary btn-sm" ${bindAction('click',()=>openNewCertificateModal())}>+ New Certificate</button></div>
    <div class="toolbar"><input type="search" id="cert-search" placeholder="Search patient, certificate no. or purpose" aria-label="Search certificates" value="${escapeHtml(ui.certQuery||'')}" ${bindAction('input',(event,element)=>{ui.certQuery=element.value;clearTimeout(ui.certSearchTimer);ui.certSearchTimer=setTimeout(()=>renderCertRequests(filter).then(()=>{const input=document.getElementById('cert-search');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}),250);})}></div>
    <p class="patient-filter-summary">Only you can see and change the certificates you write. Patients can download a certificate once you sign and issue it.</p>
    <div class="card">${list.length?`<div class="table-wrap"><table class="cert-list-table"><thead><tr><th scope="col">Certificate</th><th scope="col">Patient</th><th scope="col">Purpose</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map(r=>{
      const pt=getPatientById(r.patientId);
      const date=r.status==='Issued'||r.issuedAt?r.issuedAt:r.preparedAt||r.requestedAt;
      return `<tr>
        <td data-label="Certificate"><strong>${escapeHtml(r.certNo||'Draft #'+certificateDisplayId(r))}</strong></td>
        <td data-label="Patient">${pt?`<button class="link-btn" ${bindAction('click',()=>viewPatient(pt.id))}>${escapeHtml(patientName(r))}</button>`:'Unknown patient'}</td>
        <td data-label="Purpose">${escapeHtml(r.purpose)}${r.details?`<div class="text-muted">${escapeHtml(r.details)}</div>`:''}</td>
        <td data-label="Date">${date?fmtDate(String(date).slice(0,10)):'—'}</td>
        <td data-label="Status">${certStatusBadge(r.status)}${r.status==='Cancelled'&&r.declineReason?`<div class="text-muted">${escapeHtml(r.declineReason)}</div>`:''}</td>
        <td data-label="Actions"><div class="td-actions">
          ${r.status==='Awaiting Signature'?`<button class="btn btn-xs btn-primary" ${bindAction('click',()=>openCertificateEditor(r.id))}>Continue</button><button class="btn btn-xs" ${bindAction('click',()=>discardCertificateDraft(r.id))}>Discard</button>`:''}
          ${r.status==='Issued'?`<button class="btn btn-xs btn-primary" ${bindAction('click',()=>downloadCertPdf(r.id))}><i class="bi bi-download" aria-hidden="true"></i> PDF</button><button class="btn btn-xs btn-danger" ${bindAction('click',()=>openVoidCertificateModal(r.id))}>Void</button>`:''}
        </div></td>
      </tr>`;}).join('')}</tbody></table></div>`
      :`<div class="empty-state"><i class="bi bi-file-earmark-medical" aria-hidden="true" style="font-size:1.6rem"></i><p>${q?'No certificates match your search.':filter==='Awaiting Signature'?'No drafts. Start a new certificate after a consultation.':'No certificates here yet.'}</p></div>`}</div>`;
}

// Step 1: who, which visit and why. The certificate must rest on an examination by this doctor.
export function openNewCertificateModal(patientId=null,treatmentId=null,prefill={}){
  if(!isDoctor()){toast('Only doctors can issue medical certificates.','error');return;}
  const pt=patientId?getPatientById(patientId):null;
  appState.certificateService.certPrefill=prefill;
  openModal(`<div class="modal cert-new-modal">
    <div class="modal-header"><div><h3>New medical certificate</h3><div class="text-muted">Step 1 of 2 · Patient, visit and purpose</div></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label for="nc-pt-search">Patient <span class="required">*</span></label>
        <input type="hidden" id="nc-pt" value="${pt?pt.id:''}">
        <div class="patient-combobox"><input type="search" id="nc-pt-search" autocomplete="off" placeholder="Search by name or ID number" value="${pt?escapeHtml(pt.fname+' '+pt.lname):''}" ${bindAction('input',(event,element)=>filterCertificatePatients(element.value))}><div class="patient-combobox-list" id="nc-pt-results"></div></div>
        <p class="registration-field-error" id="nc-pt-error" hidden></p>
      </div>
      <div class="form-group"><label for="nc-visit">Based on visit</label>
        <select id="nc-visit" ${bindAction('change',()=>{})}></select>
        <p class="form-note" id="nc-visit-note">Choose the consultation where you examined the patient. Its findings fill in the certificate.</p>
        <p class="registration-field-error" id="nc-visit-error" hidden></p>
      </div>
      <div class="form-group"><label for="nc-purpose">Purpose <span class="required">*</span></label>
        <select id="nc-purpose" ${bindAction('change',()=>syncCertificatePurposeFields())}>${purposeData.CERTIFICATE_PURPOSES.map(p=>`<option ${p===prefill.purpose?'selected':''}>${escapeHtml(p)}</option>`).join('')}</select>
      </div>
      <div id="nc-purpose-fields"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" ${bindAction('click',()=>continueNewCertificate())}>Continue to document</button></div>
  </div>`);
  syncCertificatePurposeFields();
  for(const key of ['event','fitness','restrictions']){const el=document.getElementById('nc-'+key);if(el&&prefill[key])el.value=prefill[key];}
  const restrictionsGroup=document.getElementById('nc-restrictions-group');if(restrictionsGroup)restrictionsGroup.hidden=document.getElementById('nc-fitness')?.value!=='Fit with restrictions';
  if(pt)selectCertificatePatient(pt.id,treatmentId);else syncCertificateVisits(null);
}

export function filterCertificatePatients(q=''){
  const box=document.getElementById('nc-pt-results');if(!box)return;
  document.getElementById('nc-pt').value='';syncCertificateVisits(null);
  const s=q.trim().toLowerCase();
  if(!s){box.innerHTML='';box.classList.remove('show');return;}
  const pts=appState.data.DB.patients.filter(p=>!p.archived&&(!appState.auth.currentUser._realSupabase||p._realSupabase)&&`${p.fname} ${p.lname} ${p.lname}, ${p.fname} ${p.idNo||''}`.toLowerCase().includes(s)).slice(0,12);
  box.innerHTML=pts.length?pts.map(p=>`<button type="button" class="patient-combobox-option" ${bindAction('click',()=>selectCertificatePatient(p.id))}><strong>${escapeHtml(p.lname+', '+p.fname)}</strong><span class="text-muted" style="display:block">${escapeHtml(p.idNo||'No ID')} · ${escapeHtml(p.college||'')}</span></button>`).join(''):'<div class="text-muted" style="padding:.65rem">No matching patient.</div>';
  box.classList.add('show');
}
export function selectCertificatePatient(id,treatmentId=null){
  const p=getPatientById(id);if(!p)return;
  document.getElementById('nc-pt').value=id;
  document.getElementById('nc-pt-search').value=`${p.fname} ${p.lname}`;
  document.getElementById('nc-pt-results')?.classList.remove('show');
  syncCertificateVisits(p.id,treatmentId);
}
function doctorVisits(patientId){
  return treatmentRecords().filter(t=>t.patientId===patientId&&!t.archived&&t.doctorId===appState.auth.currentUser.id)
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||b.id-a.id);
}
function syncCertificateVisits(patientId,selected=null){
  const select=document.getElementById('nc-visit');if(!select)return;
  if(!patientId){select.innerHTML='<option value="">Choose a patient first</option>';select.disabled=true;return;}
  const visits=doctorVisits(patientId);
  // Without a recorded visit (e.g. a fitness assessment), the doctor writes the findings directly.
  const none=appState.certificateService.certPrefill?.findings?'Not linked to a visit (uses the assessment findings)':'Not linked to a visit (write the findings yourself)';
  select.disabled=false;
  select.innerHTML=visits.map(t=>`<option value="${t.id}" ${t.id===Number(selected)?'selected':''}>${escapeHtml(fmtDate(t.date))} · ${escapeHtml(t.diagnosis||'No diagnosis recorded')}</option>`).join('')+`<option value="" ${!visits.length||appState.certificateService.certPrefill?.findings?'selected':''}>${none}</option>`;
}
export function syncCertificatePurposeFields(){
  const box=document.getElementById('nc-purpose-fields');if(!box)return;
  const purpose=document.getElementById('nc-purpose').value;
  const today=appState.clinicInformation.TODAY;
  const err=id=>`<p class="registration-field-error" id="nc-${id}-error" hidden></p>`;
  const fitness=`<div class="form-group"><label for="nc-fitness">Result <span class="required">*</span></label><select id="nc-fitness" ${bindAction('change',()=>{document.getElementById('nc-restrictions-group').hidden=document.getElementById('nc-fitness').value!=='Fit with restrictions';})}><option value="">Select</option>${purposeData.FITNESS_OPTIONS.map(o=>`<option>${o}</option>`).join('')}</select>${err('fitness')}<p class="form-note">If the patient is not fit, do not issue a certificate. Record the advice in the visit notes instead.</p></div>
    <div class="form-group" id="nc-restrictions-group" hidden><label for="nc-restrictions">Restrictions <span class="required">*</span></label><input id="nc-restrictions" maxlength="200" placeholder="e.g. No heavy lifting for 2 weeks">${err('restrictions')}</div>`;
  box.innerHTML=purpose==='Excused Absence'
    ?`<div class="form-row"><div class="form-group"><label for="nc-absentFrom">First day of absence <span class="required">*</span></label><input type="date" id="nc-absentFrom" max="${new Date(Date.parse(today+'T12:00:00Z')+7*864e5).toISOString().slice(0,10)}" value="${today}">${err('absentFrom')}</div>
      <div class="form-group"><label for="nc-absentTo">Last day of absence <span class="required">*</span></label><input type="date" id="nc-absentTo" value="${today}">${err('absentTo')}</div></div>`
    :purpose==='Sports / Athletics Participation'
      ?`<div class="form-group"><label for="nc-event">Sport or event <span class="required">*</span></label><input id="nc-event" maxlength="120" placeholder="e.g. Intramurals 2026 – Basketball">${err('event')}</div>${fitness}`
      :fitness;
}
function readCertificateFields(){
  const value=id=>document.getElementById('nc-'+id)?.value?.trim()||'';
  return {absentFrom:value('absentFrom'),absentTo:value('absentTo'),fitness:value('fitness'),restrictions:value('restrictions'),event:value('event')};
}
export function continueNewCertificate(){
  const patientId=Number(document.getElementById('nc-pt').value)||0;
  const treatmentId=Number(document.getElementById('nc-visit').value)||0;
  const purpose=document.getElementById('nc-purpose').value;
  const fields=readCertificateFields();
  const errors=purposeData.certificateDetailErrors(purpose,fields,appState.clinicInformation.TODAY);
  if(!patientId)errors.pt='Choose the patient from the list.';
  for(const el of document.querySelectorAll('.cert-new-modal .registration-field-error')){el.hidden=true;el.textContent='';}
  for(const [key,message] of Object.entries(errors)){const el=document.getElementById(`nc-${key}-error`);if(el){el.textContent=message;el.hidden=false;}}
  if(Object.keys(errors).length){document.querySelector('.cert-new-modal .registration-field-error:not([hidden])')?.scrollIntoView({block:'center'});return;}
  const {statement,summary}=purposeData.certificateStatement(purpose,fields);
  closeAllModals();
  openCertificateEditor(null,{patientId,treatmentId,purpose,statement,details:summary});
}

// Step 2: the certificate document, editable like a page, with the doctor's signature.
export function openCertificateEditor(id,draft=null){
  if(!isDoctor())return;
  if(id)appState.certificateService.certPrefill={};
  const r=id?certificateRecords().find(x=>x.id===Number(id)):{id:null,status:'Awaiting Signature',doctorId:appState.auth.currentUser.id,...draft};
  if(!r||r.status!=='Awaiting Signature')return;
  if(id&&r.doctorId!==appState.auth.currentUser.id){toast('Only the doctor who wrote this draft can open it.','error');return;}
  const pt=getPatientById(r.patientId),doctor=appState.auth.currentUser;
  const visit=treatmentRecords().find(t=>t.id===r.treatmentId)||null;
  const prefill=appState.certificateService.certPrefill||{};
  const autofill=visit?certificateFromVisit(visit):{findings:prefill.findings||'',remarks:prefill.restrictions?`Restrictions: ${prefill.restrictions}`:'',treatment:null};
  const documentHtml=normalizeCertificateDocumentMetadata(r,r.documentHtml||buildCertificateDocument(r,doctor.id,r.findings||autofill.findings,r.recommendations||autofill.remarks,''));
  appState.certificateService.certEditing={id:r.id,patientId:r.patientId,treatmentId:r.treatmentId||null,purpose:r.purpose,details:r.details||''};
  appState.certificateService.certDraftSignature=doctor.savedSignature||'';
  openModal(`<div class="modal modal-xl" style="max-width:1180px">
    <div class="modal-header"><div><h3>${r.id?'Medical certificate draft':'New medical certificate'}</h3><div class="text-muted">Step 2 of 2 · ${pt?escapeHtml(pt.fname+' '+pt.lname):'Unknown patient'} · ${escapeHtml(r.purpose)}${visit?` · visit of ${escapeHtml(fmtDate(visit.date))}`:''}</div></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div class="alert alert-info show" style="font-size:.78rem">Check the wording, then sign and issue. The patient is notified and can download the PDF. Issued certificates cannot be edited; void and reissue if something is wrong.</div>
      <input id="ic-doctor" type="hidden" value="${doctor.id}">
      <div class="cert-editor-shell">
        <div>${certEditorToolbarHtml()}<div class="cert-page-wrap"><div class="cert-paper" id="cert-editor" contenteditable="true" spellcheck="true">${documentHtml}</div></div></div>
        <div class="cert-side-panel">
          <div class="card" style="margin:0"><div class="card-header"><h3>Physician signature</h3></div>
            <div class="cert-sign-pad"><canvas id="cert-sign-canvas" width="900" height="280" aria-label="Draw physician signature"></canvas></div>
            <div class="cert-sign-actions">
              <button class="btn btn-xs" type="button" ${bindAction('click',()=>clearCertSignature())}>Clear</button>
              <button class="btn btn-xs" type="button" ${bindAction('click',()=>document.getElementById('cert-sign-upload').click())}>Upload</button>
              <button class="btn btn-xs" type="button" ${bindAction('click',()=>pasteCertSignatureFromClipboard())}>Paste</button>
              <button class="btn btn-xs btn-info" type="button" ${bindAction('click',()=>useSavedDoctorSignature())} ${doctor.savedSignature?'':'disabled'}>Use saved</button>
              <input id="cert-sign-upload" type="file" accept="image/png,image/jpeg,image/webp" style="display:none" ${bindAction('change',(event,element)=>uploadCertSignature(element))}>
            </div>
            <div class="cert-sign-preview" style="margin-top:.55rem"><img id="cert-sign-preview-img" src="${appState.certificateService.certDraftSignature||''}" style="${appState.certificateService.certDraftSignature?'':'display:none'}" alt="Signature preview"><span id="cert-sign-empty" class="text-muted" style="${appState.certificateService.certDraftSignature?'display:none':''}">Draw, upload, paste, or use your saved signature.</span></div>
            <label style="display:flex;gap:.45rem;align-items:flex-start;margin-top:.6rem;font-size:.76rem;color:var(--ink-muted)"><input type="checkbox" id="cert-save-signature"> <span>Save this signature to my profile for future certificates.</span></label>
          </div>
          <div class="card" style="margin:0"><div class="card-header"><h3>Clinical source</h3></div><p class="cert-autofill-note" id="cert-autofill-note">${visit?`Findings come from your visit notes of ${fmtDate(visit.date)}.`:autofill.findings?'Findings come from the fitness-to-compete assessment.':'Not linked to a visit. Write the findings in the document.'}</p></div>
        </div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>saveCertificateDraft())}>Save draft</button><button class="btn btn-success" ${bindAction('click',()=>signCert())}>Sign &amp; issue</button></div>
  </div>`);
  setTimeout(()=>{initCertSignaturePad();setCertSignaturePreview(appState.certificateService.certDraftSignature);},0);
}

function certificateFromVisit(t){
  const findings=[t.findings,t.diagnosis?`Diagnosis: ${t.diagnosis}`:''].filter(Boolean).join(' — ');
  const remarks=[t.notes,t.prescription?`Prescription / Treatment: ${t.prescription}`:'',t.followupDate?`Follow-up: ${fmtDate(t.followupDate)}`:''].filter(Boolean).join(' ');
  return {findings,remarks,treatment:t};
}

// Creates or updates the doctor's draft and returns its record.
async function persistCertificateDraft(){
  const editing=appState.certificateService.certEditing;
  const editor=document.getElementById('cert-editor');
  const findings=readCertificateDocumentField('findings');
  const recommendations=readCertificateDocumentField('remarks');
  const documentHtml=ensureCertificateLogo(sanitizeCertHtml(editor.innerHTML));
  const pt=getPatientById(editing.patientId),visit=treatmentRecords().find(t=>t.id===editing.treatmentId)||null;
  if(appState.auth.currentUser._realSupabase){
    const result=await certificateAction({
      action:'draft',certificate_id:editing.id?certificateRecords().find(x=>x.id===editing.id)?.dbCertificateId:null,
      patient_id:pt?.dbPatientId,treatment_id:visit?.dbTreatmentId||null,purpose:editing.purpose,request_details:editing.details,
      examination_findings:findings,remarks:recommendations,document_content:documentHtml
    });
    await syncRealCertificates();
    const saved=certificateRecords().find(x=>x.dbCertificateId===Number(result.certificate_id));
    if(saved)editing.id=saved.id;
    return saved;
  }
  let r=editing.id?certificateRecords().find(x=>x.id===editing.id):null;
  if(!r){
    r={id:appState.data.DB.nextCertId++,patientId:editing.patientId,doctorId:appState.auth.currentUser.id,treatmentId:editing.treatmentId,purpose:editing.purpose,details:editing.details,status:'Awaiting Signature',requestedAt:new Date().toISOString(),certNo:'',issuedAt:'',declineReason:''};
    appState.data.DB.certRequests.push(r);editing.id=r.id;
  }
  Object.assign(r,{findings,recommendations,documentHtml,preparedById:appState.auth.currentUser.id,preparedAt:new Date().toISOString()});
  persistDB();
  return r;
}

export async function saveCertificateDraft(){
  if(!readCertificateDocumentField('findings')){toast('Write the findings or diagnosis before saving.','error');return;}
  try{
    await persistCertificateDraft();
    closeAllModals();
    toast('Certificate draft saved.','success');
    await renderCertRequests('Awaiting Signature');
  }catch(e){toast(e?.message||'Unable to save the draft.','error');}
}

export function discardCertificateDraft(id){
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r||r.status!=='Awaiting Signature')return;
  showConfirmDialog({title:'Discard draft',message:'Delete this certificate draft? This cannot be undone.',confirmLabel:'Discard',danger:true,onConfirm:async()=>{
    try{
      if(r._realSupabase){await certificateAction({action:'discard',certificate_id:r.dbCertificateId});await syncRealCertificates();}
      else{appState.data.DB.certRequests=appState.data.DB.certRequests.filter(x=>x.id!==r.id);persistDB();}
      toast('Draft discarded.','info');await renderCertRequests('Awaiting Signature');
    }catch(e){toast(e?.message||'Unable to discard the draft.','error');}
  }});
}

// Voiding keeps the record and tells the patient why; a corrected certificate can then be issued.
export function openVoidCertificateModal(id){
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r||r.status!=='Issued')return;
  openModal(`<div class="modal modal-sm"><div class="modal-header"><h3>Void certificate ${escapeHtml(r.certNo)}</h3><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body"><p style="font-size:.85rem;margin:0 0 .6rem">The certificate stops being valid and the patient can no longer download it. They are told the reason.</p>
      <div class="form-group"><label for="void-reason">Reason <span class="required">*</span></label><textarea id="void-reason" rows="3" maxlength="500" placeholder="e.g. Wrong dates of absence; a corrected certificate will be issued."></textarea></div></div>
    <div class="modal-footer"><button class="btn btn-danger" ${bindAction('click',()=>voidCertificate(r.id))}>Void certificate</button></div></div>`);
}
export async function voidCertificate(id){
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r)return;
  const reason=(document.getElementById('void-reason')?.value||'').trim();
  if(reason.length<5){toast('Give a reason for voiding (at least 5 characters).','error');return;}
  try{
    if(r._realSupabase){await certificateAction({action:'void',certificate_id:r.dbCertificateId,reason});await syncRealCertificates();}
    else{r.status='Cancelled';r.declineReason=reason;persistDB();}
    closeAllModals();toast(`Certificate ${r.certNo} voided.`,'warning');await renderCertRequests('Cancelled');
  }catch(e){toast(e?.message||'Unable to void the certificate.','error');}
}

// Read certificate fields robustly from the visible editable document.
// Browsers can sometimes place text beside an empty field <span> inside a
// contenteditable page. In that case, fall back to the text after the label
// in the same paragraph instead of incorrectly treating the field as blank.
export function cleanCertificateFieldText(value=''){
  return String(value||'')
    .replace(/\u200B/g,' ')
    .replace(/\u00A0/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function readCertificateDocumentField(field){
  const editor=document.getElementById('cert-editor');
  if(!editor)return '';

  const marked=editor.querySelector(`[data-cert-field="${field}"]`);
  const direct=cleanCertificateFieldText(marked?.textContent||'');
  if(direct)return direct;

  const labels={
    findings:'FINDINGS / DIAGNOSIS:',
    remarks:'REMARKS / RECOMMENDATIONS:'
  };
  const label=labels[field];
  if(!label)return '';

  for(const p of editor.querySelectorAll('p')){
    const full=cleanCertificateFieldText(p.textContent||'');
    const upper=full.toUpperCase();
    const at=upper.indexOf(label);
    if(at<0)continue;

    const value=cleanCertificateFieldText(full.slice(at+label.length));
    if(value)return value;
  }

  return '';
}

// Lightweight document formatting commands for the editable certificate page.
export function formatCertDocument(command,value=null){
  const editor=document.getElementById('cert-editor');if(editor)editor.focus();
  document.execCommand(command,false,value);
}

// Canvas pointer events support mouse, trackpad, touchscreen and stylus input.
export function initCertSignaturePad(){
  const canvas=document.getElementById('cert-sign-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#111';
  const point=e=>{const box=canvas.getBoundingClientRect();return{x:(e.clientX-box.left)*(canvas.width/box.width),y:(e.clientY-box.top)*(canvas.height/box.height)}};
  canvas.addEventListener('pointerdown',e=>{appState.certificateService.certSignatureDrawing=true;appState.certificateService.certSignatureLastPoint=point(e);canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{if(!appState.certificateService.certSignatureDrawing)return;const p=point(e);ctx.beginPath();ctx.moveTo(appState.certificateService.certSignatureLastPoint.x,appState.certificateService.certSignatureLastPoint.y);ctx.lineTo(p.x,p.y);ctx.stroke();appState.certificateService.certSignatureLastPoint=p});
  const finish=()=>{if(!appState.certificateService.certSignatureDrawing)return;appState.certificateService.certSignatureDrawing=false;setCertSignaturePreview(canvas.toDataURL('image/png'))};
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);canvas.addEventListener('pointerleave',finish);
}

export function setCertSignaturePreview(data){
  appState.certificateService.certDraftSignature=data||'';
  const preview=document.getElementById('cert-sign-preview-img'),empty=document.getElementById('cert-sign-empty'),docImg=document.getElementById('cert-signature-img');
  if(preview){preview.src=appState.certificateService.certDraftSignature;preview.style.display=appState.certificateService.certDraftSignature?'block':'none'}
  if(empty)empty.style.display=appState.certificateService.certDraftSignature?'none':'inline';
  if(docImg){docImg.src=appState.certificateService.certDraftSignature;docImg.style.display=appState.certificateService.certDraftSignature?'block':'none'}
}
export function clearCertSignature(){const c=document.getElementById('cert-sign-canvas');if(c)c.getContext('2d').clearRect(0,0,c.width,c.height);setCertSignaturePreview('')}
export function uploadCertSignature(input){const file=input.files&&input.files[0];if(!file)return;if(!file.type.startsWith('image/')){toast('Please choose an image file for the signature.','error');return}const reader=new FileReader();reader.onload=()=>setCertSignaturePreview(reader.result);reader.readAsDataURL(file)}
export async function pasteCertSignatureFromClipboard(){try{if(!navigator.clipboard||!navigator.clipboard.read)throw new Error('Clipboard image access unavailable');const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(!type)continue;const blob=await item.getType(type);const reader=new FileReader();reader.onload=()=>setCertSignaturePreview(reader.result);reader.readAsDataURL(blob);return}toast('No image was found in the clipboard.','warning')}catch(e){toast('Clipboard image access was blocked. Use Upload instead.','warning')}}
export function useSavedDoctorSignature(){const doctor=getUserById(parseInt(document.getElementById('ic-doctor').value));if(!doctor||!doctor.savedSignature){toast('You do not have a saved signature yet.','warning');return}setCertSignaturePreview(doctor.savedSignature)}

// Remove executable HTML before saving the editable document into local data.
export function sanitizeCertHtml(html){
  const box=document.createElement('div');box.innerHTML=html;
  box.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove());
  box.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{if(/^on/i.test(a.name))el.removeAttribute(a.name)}));
  return box.innerHTML;
}

// Signing saves the draft, assigns the certificate number and releases it to the patient.
export async function signCert(){
  if(!isDoctor())return;
  const findings=readCertificateDocumentField('findings');
  if(!findings){toast('Write the findings or diagnosis before issuing the certificate.','error');return;}
  if(!appState.certificateService.certDraftSignature){toast('Add your signature before issuing the certificate.','error');return;}
  const saveSignature=Boolean(document.getElementById('cert-save-signature')?.checked);
  try{
    const r=await persistCertificateDraft();
    if(!r)throw new Error('The draft could not be saved.');
    const certNo=certificateNumberFor(r),issuedAt=new Date().toISOString();
    const noEl=document.getElementById('cert-number-display');if(noEl)noEl.textContent=certNo;
    const dateEl=document.getElementById('cert-date-display');if(dateEl)dateEl.textContent=fmtDate(issuedAt);
    const finalHtml=ensureCertificateLogo(sanitizeCertHtml(document.getElementById('cert-editor').innerHTML));
    const recommendations=readCertificateDocumentField('remarks');
    let issuedNo=certNo;
    if(r._realSupabase){
      const result=await certificateAction({action:'sign',certificate_id:r.dbCertificateId,examination_findings:findings,remarks:recommendations,document_content:finalHtml,signature_data:appState.certificateService.certDraftSignature,save_signature:saveSignature});
      issuedNo=result.certificate_no||certNo;
      await syncRealCertificates();
    }else{
      Object.assign(r,{certNo,issuedAt,findings,recommendations,signatureData:appState.certificateService.certDraftSignature,documentHtml:finalHtml,status:'Issued',issuedById:appState.auth.currentUser.id,signedById:appState.auth.currentUser.id,signedAt:issuedAt});
      persistDB();
    }
    if(saveSignature)appState.auth.currentUser.savedSignature=appState.certificateService.certDraftSignature;
    closeAllModals();
    toast(`Certificate ${issuedNo} signed and issued. The patient can now download it.`,'success');
    await renderCertRequests('Issued');
  }catch(e){toast(e?.message||'Unable to sign and issue the certificate.','error');}
}

export function loadHtml2Canvas(){return new Promise((resolve,reject)=>{if(window.html2canvas){resolve(window.html2canvas);return}const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';script.onload=()=>window.html2canvas?resolve(window.html2canvas):reject(new Error('html2canvas failed'));script.onerror=()=>reject(new Error('Could not load html2canvas'));document.head.appendChild(script)})}

// Export the exact saved document styling and signature to PDF.
export async function downloadCertPdf(id){
  const r=certificateRecords().find(x=>x.id===Number(id));
  if(!r||r.status!=='Issued'){
    toast('Certificate not available.','error');
    return;
  }

  let jsPDF,html2canvas;
  try{
    jsPDF=await loadJsPDF();
    html2canvas=await loadHtml2Canvas();
  }catch(e){
    toast('Could not load the PDF generator. Check your connection.','error');
    return;
  }

  if(!r.documentHtml){
    toast('This older certificate needs to be prepared again before using the redesigned PDF.','warning');
    return;
  }

  const certHtml=normalizeCertificateDocumentMetadata(r,r.documentHtml);
  const stage=document.createElement('div');

  // 794 × 1122 px is the 96-DPI A4 ratio closely enough to avoid the
  // ~0.02 mm overflow that previously generated a blank second page.
  stage.style.cssText='position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1;pointer-events:none;';
  stage.innerHTML=`<div class="cert-paper" style="width:794px;min-height:1122px;box-shadow:none;margin:0">${certHtml}</div>`;
  document.body.appendChild(stage);

  try{
    await Promise.all(
      [...stage.querySelectorAll('img')].map(img=>
        img.complete
          ? Promise.resolve()
          : new Promise(res=>{img.onload=img.onerror=res;})
      )
    );

    const paper=stage.firstElementChild;
    const canvas=await html2canvas(paper,{
      scale:2,
      backgroundColor:'#ffffff',
      useCORS:true,
      logging:false
    });

    const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'});
    const imgData=canvas.toDataURL('image/jpeg',.96);
    const pageW=210;
    const pageH=297;
    const imgH=canvas.height*pageW/canvas.width;

    // A normal medical certificate is a single A4 page. Allow a small
    // tolerance for browser/html2canvas rounding instead of treating a
    // fraction of a millimeter as a second page.
    if(imgH<=pageH+3){
      pdf.addImage(imgData,'JPEG',0,0,pageW,pageH,'FAST');
    }else{
      let remaining=imgH;
      let pos=0;

      pdf.addImage(imgData,'JPEG',0,pos,pageW,imgH,'FAST');
      remaining-=pageH;

      // Only add another page when meaningful content actually remains.
      while(remaining>3){
        pos=remaining-imgH;
        pdf.addPage();
        pdf.addImage(imgData,'JPEG',0,pos,pageW,imgH,'FAST');
        remaining-=pageH;
      }
    }

    pdf.save(`Medical_Certificate_${r.certNo||certificateDisplayId(r)}.pdf`);
    toast('Certificate downloaded.','success');
  }finally{
    stage.remove();
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.certificateService.CERT_PURPOSES=purposeData.CERTIFICATE_PURPOSES;
  appState.certificateService.certDraftSignature='';
  appState.certificateService.certSignatureDrawing=false;
  appState.certificateService.certSignatureLastPoint=null;
}
