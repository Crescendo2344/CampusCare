// certificateService: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {syncAdminDirectoryFromSupabase,syncCurrentPatientFromSupabase} from './patientService.js';
import {syncRealTreatments,treatmentRecords} from './treatmentService.js';
import {escapeHtml} from './issueReports.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {fmtDate,fmtDateTime} from './inputValidation.js';
import {closeAllModals,openModal} from './modals.js';
import {hideAlert,showAlert,showConfirmDialog,toast} from './theme.js';
import {persistDB} from './persistence.js';
import {getDoctors,getPatientById,getUserById} from './documentScanner.js';
import {viewPatient} from './patientForm.js';
import {docName} from './messaging.js';
import {loadJsPDF} from './settingsAndCertificates.js';
import {bindAction,certificateData,createCertificateService} from '../dependencies.js';
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

export function certStatusBadge(s){
  const m={Pending:'badge-warning','Awaiting Signature':'badge-purple',Issued:'badge-success',Declined:'badge-danger',Cancelled:'badge-gray'};
  return `<span class="badge ${m[s]||'badge-gray'}">${escapeHtml(s||'')}</span>`;
}

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
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderMyCertificates()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('my-certificates',pageToken))return;
  }

  const pt=appState.auth.currentPatient;
  if(!pt){
    c.innerHTML='<div class="alert alert-warning show">No patient record linked. Contact admin.</div>';
    return;
  }

  const reqs=certificateRecords()
    .filter(r=>r.patientId===pt.id)
    .slice()
    .sort((a,b)=>String(b.requestedAt).localeCompare(String(a.requestedAt))||b.id-a.id);

  c.innerHTML=`<div class="card">
    <div class="card-header">
      <h3>Medical Certificates</h3>
      <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{openCertRequestModal()})}>+ Request Certificate</button>
    </div>
    <p class="text-muted" style="font-size:.82rem;margin-bottom:.8rem">Staff prepares the certificate details, then the assigned doctor reviews and signs it before it becomes downloadable.</p>
    ${reqs.length?`<div class="cert-swipe-hint"><i class="fa-solid fa-arrows-left-right"></i> Swipe horizontally to view certificate status and actions.</div>
      <div class="table-wrap cert-table-wrap"><table>
        <thead><tr><th>#</th><th>Purpose</th><th>Requested</th><th>Status</th><th>Certificate No.</th><th>Actions</th></tr></thead>
        <tbody>${reqs.map(r=>`<tr>
          <td>#${certificateDisplayId(r)}</td>
          <td>${escapeHtml(r.purpose)}</td>
          <td>${fmtDateTime(r.requestedAt)}</td>
          <td>${certStatusBadge(r.status)}</td>
          <td>${escapeHtml(r.certNo||'—')}</td>
          <td><div class="td-actions">
            ${r.status==='Issued'?`<button class="btn btn-xs btn-primary" ${bindAction('click',(event,element)=>{downloadCertPdf((r.id))})}>⬇ Download PDF</button>`:''}
            ${r.status==='Pending'?`<button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{cancelCertRequest((r.id))})}>Cancel</button>`:''}
            ${r.status==='Declined'&&r.declineReason?`<button class="btn btn-xs" ${bindAction('click',(event,element)=>{viewCertDecline((r.id))})}>Reason</button>`:''}
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>`:'<div class="empty-state"><p>No certificate requests yet.</p></div>'}
  </div>`;
}

export function openCertRequestModal(){
  openModal(`<div class="modal">
    <div class="modal-header">
      <h3>Request Medical Certificate</h3>
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
    </div>
    <div class="modal-body">
      <div id="cert-request-msg"></div>
      <div class="form-group"><label>Purpose</label>
        <select id="cert-purpose" ${bindAction('change',(event,element)=>{updateCertificatePurposeGuidance()})}>${appState.certificateService.CERT_PURPOSES.map(p=>`<option>${escapeHtml(p)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Details (optional)</label>
        <textarea id="cert-details" rows="3" maxlength="1000" placeholder="e.g. dates of absence, requesting office"></textarea>
      </div>
      <div id="cert-purpose-guidance" class="alert alert-info" style="font-size:.77rem"></div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" id="cert-request-btn" ${bindAction('click',(event,element)=>{submitCertRequest()})}>Submit Request</button>
    </div>
  </div>`);
  updateCertificatePurposeGuidance();
}

export function updateCertificatePurposeGuidance(){
  const select=document.getElementById('cert-purpose');
  const box=document.getElementById('cert-purpose-guidance');
  if(!select||!box)return;

  const sports=select.value==='Sports / Athletics Participation';
  box.classList.toggle('show',sports);
  if(sports){
    box.innerHTML=`🏅 <strong>Intramurals 2026–2027:</strong> Secure the Eligibility Form from your coach, complete your personal information and sports event, sign the Participant's Waiver and Release Agreement, obtain the required parent/guardian and coach signatures, and bring the completed form to the clinic at the <strong>Ground Floor, Education Building</strong>.`;
  }else{
    box.innerHTML='';
  }
}

export async function submitCertRequest(){
  if(!appState.auth.currentPatient){toast('No patient record linked.','error');return;}
  const purpose=document.getElementById('cert-purpose').value;
  const details=document.getElementById('cert-details').value.trim().slice(0,1000);
  const msg=document.getElementById('cert-request-msg');
  const btn=document.getElementById('cert-request-btn');
  hideAlert(msg);

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Submitting…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      await certificateAction({
        action:'create',
        patient_id:appState.auth.currentPatient.dbPatientId,
        purpose,
        request_details:details
      });
      await syncRealCertificates();
    }else{
      appState.data.DB.certRequests.push({
        id:appState.data.DB.nextCertId++,
        patientId:appState.auth.currentPatient.id,
        purpose,details,status:'Pending',requestedAt:appState.clinicInformation.TODAY,
        certNo:'',issuedAt:'',issuedById:null,doctorId:null,
        findings:'',recommendations:'',declineReason:'',
        preparedById:null,preparedAt:'',signedById:null,signedAt:''
      });
      persistDB();
    }

    closeAllModals();
    toast('Certificate request submitted.','success');
    await renderMyCertificates();
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit certificate request.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||'Submit Request';
    }
  }
}

export function cancelCertRequest(id){
  const r=certificateRecords().find(x=>x.id===Number(id));
  if(!r||r.status!=='Pending')return;

  showConfirmDialog({
    title:'Cancel Certificate Request',
    message:`Cancel medical certificate request <strong>#${certificateDisplayId(r)}</strong>?`,
    confirmLabel:'Cancel Request',
    danger:true,
    onConfirm:async()=>{
      try{
        if(r._realSupabase){
          await certificateAction({action:'cancel',certificate_id:r.dbCertificateId});
          await syncRealCertificates();
        }else{
          appState.data.DB.certRequests=appState.data.DB.certRequests.filter(x=>x.id!==r.id);
          persistDB();
        }
        toast('Certificate request cancelled.','info');
        await renderMyCertificates();
      }catch(e){toast(e?.message||'Unable to cancel the request.','error');}
    }
  });
}

export function viewCertDecline(id){
  const r=certificateRecords().find(x=>x.id===Number(id)); if(!r)return;
  openModal(`<div class="modal"><div class="modal-header"><h3>Request Declined</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body"><p style="font-size:.85rem">${escapeHtml(r.declineReason||'No reason provided.')}</p></div></div>`);
}

// ---- STAFF / DOCTOR / ADMIN WORKFLOW ----
// Staff/Admin prepare the editable document. The assigned doctor reviews and signs it.

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
    <p>&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued upon the request of the above-named patient for <span data-cert-field="purpose">${escapeHtml((r.purpose||'').toLowerCase())}</span> purposes.</p>
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

export async function renderCertRequests(filter=null){
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncCertificateContext();}
    catch(e){
      if(!isCampusPageCurrent('cert-requests',pageToken))return;
      console.error('Certificate requests sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load certificate requests.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderCertRequests((String(filter)))})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('cert-requests',pageToken))return;
  }

  const canPrepare=appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator';
  const canSign=appState.auth.currentUser.role==='Doctor';

  if(!filter)filter=appState.auth.currentUser.role==='Doctor'?'Awaiting Signature':'Pending';

  let all=certificateRecords().slice().sort((a,b)=>String(b.requestedAt).localeCompare(String(a.requestedAt))||b.id-a.id);
  if(appState.auth.currentUser.role==='Doctor')all=all.filter(r=>r.doctorId===appState.auth.currentUser.id);

  const list=filter==='all'?all:all.filter(r=>r.status===filter);
  const tabs=['Pending','Awaiting Signature','Issued','Declined','Cancelled','all'];
  const tabCounts={};
  for(const t of tabs){
    tabCounts[t]=t==='all'?all.length:all.filter(r=>r.status===t).length;
  }
  const actionableStatus=appState.auth.currentUser.role==='Doctor'?'Awaiting Signature':'Pending';

  c.innerHTML=`<div class="card">
    <div class="card-header"><div><h3>Medical Certificate Requests</h3><div class="text-muted">${appState.auth.currentUser.role==='Doctor'?'Review the prepared document and add your signature.':appState.auth.currentUser.role==='Staff'?'Prepare the certificate document and send it to the assigned doctor.':'Prepare certificates and monitor doctor signatures.'}</div></div></div>
    <div class="tabs">${tabs.map(t=>{
      const count=tabCounts[t]||0;
      const badge=count?`<span class="tab-task-count ${t===actionableStatus?'attention':''}">${count>99?'99+':count}</span>`:'';
      return `<button class="tab ${t===filter?'active':''}" ${bindAction('click',(event,element)=>{renderCertRequests((String(t)))})}>${t==='all'?'All':t}${badge}</button>`;
    }).join('')}</div>
    ${list.length?`<div class="table-wrap"><table><thead><tr><th>#</th><th>Patient</th><th>Purpose</th><th>Physician</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map(r=>{
      const pt=getPatientById(r.patientId),u=pt?getUserById(pt.userId):null,physician=getUserById(r.doctorId);
      const prepareBtn=canPrepare&&(r.status==='Pending'||r.status==='Awaiting Signature'||r.status==='Issued')?`<button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{openEditCertModal((r.id))})}>${r.status==='Issued'?'Edit / Re-sign':'✎ Prepare / Edit'}</button>`:'';
      const signBtn=canSign&&r.status==='Awaiting Signature'&&r.doctorId===appState.auth.currentUser.id?`<button class="btn btn-xs btn-success" ${bindAction('click',(event,element)=>{openSignCertModal((r.id))})}>✍ Review & Sign</button>`:'';
      const declineBtn=canPrepare&&r.status!=='Issued'&&r.status!=='Declined'&&r.status!=='Cancelled'?`<button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{openDeclineCertModal((r.id))})}>Decline</button>`:'';
      return `<tr>
        <td>#${certificateDisplayId(r)}</td>
        <td>${u?`<button class="link-btn" ${bindAction('click',(event,element)=>{viewPatient((pt.id))})}>${escapeHtml(u.fname+' '+u.lname)}</button>`:'Unknown'}</td>
        <td>${escapeHtml(r.purpose)}${r.details?`<div class="text-muted" style="font-size:.72rem">${escapeHtml(r.details)}</div>`:''}</td>
        <td>${physician?escapeHtml(docName(physician)):'Not assigned'}</td>
        <td>${fmtDateTime(r.requestedAt)}</td>
        <td>${certStatusBadge(r.status)}</td>
        <td><div class="td-actions">${prepareBtn}${signBtn}${declineBtn}${r.status==='Issued'?`<button class="btn btn-xs btn-primary" ${bindAction('click',(event,element)=>{downloadCertPdf((r.id))})}>⬇ PDF</button>`:''}</div></td>
      </tr>`;
    }).join('')}</tbody></table></div>`:'<div class="empty-state"><p>No requests found.</p></div>'}
  </div>`;
}

// Staff/Admin use this Word-like screen to prepare or revise the document before doctor signing.
export function openEditCertModal(id){
  if(!(appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator')){toast('Only staff or administrators can prepare certificates.','error');return;}
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r||r.status==='Declined')return;
  const pt=getPatientById(r.patientId),u=pt?getUserById(pt.userId):null;
  const latest=getLatestTreatmentForCertificate(r.patientId,r.doctorId||null);
  const defaultDoctor=r.doctorId||(latest&&latest.doctorId)||(getDoctors()[0]||{}).id;
  const autofill=certificateAutofillFromTreatment(r.patientId,defaultDoctor);
  const findings=r.findings||autofill.findings;
  const remarks=r.recommendations||autofill.remarks;
  const documentHtml=normalizeCertificateDocumentMetadata(
    r,
    r.documentHtml||buildCertificateDocument(r,defaultDoctor,findings,remarks,'')
  );
  openModal(`<div class="modal modal-xl" style="max-width:1180px">
    <div class="modal-header"><div><h3>${r.status==='Issued'?'Edit Medical Certificate':'Prepare Medical Certificate'}</h3><div class="text-muted">Request #${certificateDisplayId(r)} · ${u?escapeHtml(u.fname+' '+u.lname):'Unknown patient'}</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div class="alert alert-info show" style="font-size:.78rem">Edit the certificate like a document. Findings and remarks are automatically filled from the selected doctor's latest clinical notes when available.</div>
      <div class="cert-editor-shell">
        <div>${certEditorToolbarHtml()}<div class="cert-page-wrap"><div class="cert-paper" id="cert-editor" contenteditable="true" spellcheck="true">${documentHtml}</div></div></div>
        <div class="cert-side-panel">
          <div class="card" style="margin:0"><div class="card-header"><h3>Certificate Details</h3></div>
            <div class="form-group"><label>Purpose</label><select id="ec-purpose" ${bindAction('change',(event,element)=>{updateCertPurposeText()})}>${appState.certificateService.CERT_PURPOSES.map(p=>`<option ${p===r.purpose?'selected':''}>${p}</option>`).join('')}</select></div>
            <div class="form-group"><label>Attending Physician <span class="required">*</span></label><select id="ec-doctor" ${bindAction('change',(event,element)=>{onCertPrepareDoctorChange((id))})}><option value="">Select physician</option>${getDoctors().map(d=>`<option value="${d.id}" ${d.id===defaultDoctor?'selected':''}>${escapeHtml(docName(d))} — ${escapeHtml(d.specialty||'General Medicine')}</option>`).join('')}</select></div>
            <div class="form-group"><label>Request Details</label><textarea id="ec-details" rows="2">${escapeHtml(r.details||'')}</textarea></div>
            <p class="cert-autofill-note" id="cert-autofill-note">${autofill.treatment?`Autofilled from clinical notes dated ${fmtDate(autofill.treatment.date)}.`:'No clinical notes were found. The document can be completed manually.'}</p>
            <button class="btn btn-sm" type="button" ${bindAction('click',(event,element)=>{refreshCertAutofill((id))})}>↻ Refill from Clinical Notes</button>
          </div>
          <div class="card" style="margin:0"><div class="card-header"><h3>Workflow</h3></div><p class="cert-autofill-note">Saving sends this prepared document to the assigned doctor. Only the assigned doctor can add the final signature and issue it.</p></div>
        </div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{saveCertDraft((id))})}>Save &amp; Send for Signature</button></div>
  </div>`);
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

// Save the editable document exactly as prepared and route it to the assigned doctor.
export async function saveCertDraft(id){
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r)return;
  if(!(appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator'))return;

  const doctorId=parseInt(document.getElementById('ec-doctor').value);
  const doctor=getUserById(doctorId);
  const editor=document.getElementById('cert-editor');
  const findings=readCertificateDocumentField('findings');
  const recommendations=readCertificateDocumentField('remarks');

  if(!doctorId||!doctor){toast('Please select the attending physician.','error');return;}
  if(!findings){toast('Please enter findings or a diagnosis in the FINDINGS / DIAGNOSIS line before sending for signature.','error');return;}

  const purpose=document.getElementById('ec-purpose').value;
  const details=document.getElementById('ec-details').value.trim().slice(0,1000);
  const documentHtml=ensureCertificateLogo(sanitizeCertHtml(editor.innerHTML));
  const source=certificateAutofillFromTreatment(r.patientId,doctorId).treatment;

  try{
    if(r._realSupabase){
      if(!doctor._realSupabase)throw new Error('Select a real CampusCare doctor.');
      await certificateAction({
        action:'prepare',
        certificate_id:r.dbCertificateId,
        doctor_id:doctor.dbUserId,
        treatment_id:source?.dbTreatmentId||null,
        purpose,
        request_details:details,
        examination_findings:findings,
        remarks:recommendations,
        document_content:documentHtml
      });
      await syncRealCertificates();
    }else{
      r.purpose=purpose;
      r.details=details;
      r.doctorId=doctorId;
      r.findings=findings;
      r.recommendations=recommendations;
      r.documentHtml=documentHtml;
      r.signatureData='';
      r.status='Awaiting Signature';
      r.preparedById=appState.auth.currentUser.id;
      r.preparedAt=new Date().toISOString();
      persistDB();
    }

    closeAllModals();
    toast('Certificate saved and sent for doctor signature.','success');
    await renderCertRequests('Awaiting Signature');
  }catch(e){
    toast(e?.message||'Unable to prepare certificate.','error');
  }
}

// The assigned doctor reviews the same Word-like document and can make final wording edits before signing.
export function openSignCertModal(id){
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r||r.status!=='Awaiting Signature')return;
  if(appState.auth.currentUser.role!=='Doctor'||r.doctorId!==appState.auth.currentUser.id){toast('Only the assigned doctor can sign this certificate.','error');return;}
  const pt=getPatientById(r.patientId),u=pt?getUserById(pt.userId):null,doctor=appState.auth.currentUser;
  const autofill=certificateAutofillFromTreatment(r.patientId,doctor.id);
  const documentHtml=normalizeCertificateDocumentMetadata(
    r,
    r.documentHtml||buildCertificateDocument(r,doctor.id,r.findings||autofill.findings,r.recommendations||autofill.remarks,'')
  );
  appState.certificateService.certDraftSignature=r.signatureData||doctor.savedSignature||'';
  openModal(`<div class="modal modal-xl" style="max-width:1180px">
    <div class="modal-header"><div><h3>Review &amp; Sign Medical Certificate</h3><div class="text-muted">Request #${certificateDisplayId(r)} · ${u?escapeHtml(u.fname+' '+u.lname):'Unknown patient'}</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div class="alert alert-info show" style="font-size:.78rem">Review the document, make any final wording changes, then sign using your mouse, trackpad, touchscreen, uploaded image, pasted image, or saved signature.</div>
      <input id="ic-doctor" type="hidden" value="${doctor.id}">
      <div class="cert-editor-shell">
        <div>${certEditorToolbarHtml()}<div class="cert-page-wrap"><div class="cert-paper" id="cert-editor" contenteditable="true" spellcheck="true">${documentHtml}</div></div></div>
        <div class="cert-side-panel">
          <div class="card" style="margin:0"><div class="card-header"><h3>Physician Signature</h3></div>
            <div class="cert-sign-pad"><canvas id="cert-sign-canvas" width="900" height="280" aria-label="Draw physician signature"></canvas></div>
            <div class="cert-sign-actions">
              <button class="btn btn-xs" type="button" ${bindAction('click',(event,element)=>{clearCertSignature()})}>Clear</button>
              <button class="btn btn-xs" type="button" ${bindAction('click',(event,element)=>{document.getElementById('cert-sign-upload').click()})}>Upload</button>
              <button class="btn btn-xs" type="button" ${bindAction('click',(event,element)=>{pasteCertSignatureFromClipboard()})}>Paste</button>
              <button class="btn btn-xs btn-info" type="button" ${bindAction('click',(event,element)=>{useSavedDoctorSignature()})} ${doctor.savedSignature?'':'disabled'}>Use Saved</button>
              <input id="cert-sign-upload" type="file" accept="image/png,image/jpeg,image/webp" style="display:none" ${bindAction('change',(event,element)=>{uploadCertSignature(element)})}>
            </div>
            <div class="cert-sign-preview" style="margin-top:.55rem"><img id="cert-sign-preview-img" src="${appState.certificateService.certDraftSignature||''}" style="${appState.certificateService.certDraftSignature?'':'display:none'}" alt="Signature preview"><span id="cert-sign-empty" class="text-muted" style="${appState.certificateService.certDraftSignature?'display:none':''}">Draw, upload, paste, or use your saved signature.</span></div>
            <label style="display:flex;gap:.45rem;align-items:flex-start;margin-top:.6rem;font-size:.76rem;color:var(--ink-muted)"><input type="checkbox" id="cert-save-signature"> <span>Save this signature to my doctor profile for future document signing.</span></label>
          </div>
          <div class="card" style="margin:0"><div class="card-header"><h3>Clinical Source</h3></div><p class="cert-autofill-note">${autofill.treatment?`Latest matching clinical note: ${fmtDate(autofill.treatment.date)}.`:'No matching clinical note found.'}</p><button class="btn btn-sm" type="button" ${bindAction('click',(event,element)=>{refreshCertAutofill((id))})}>↻ Refill from My Clinical Notes</button></div>
        </div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-success" ${bindAction('click',(event,element)=>{signCert((id))})}>✍ Sign &amp; Issue</button></div>
  </div>`);
  setTimeout(()=>{initCertSignaturePad();setCertSignaturePreview(appState.certificateService.certDraftSignature);},0);
}

// Lightweight document formatting commands for the editable certificate page.
export function formatCertDocument(command,value=null){
  const editor=document.getElementById('cert-editor');if(editor)editor.focus();
  document.execCommand(command,false,value);
}

export function updateCertPurposeText(){
  const purpose=document.getElementById('ec-purpose')?.value||'';
  const el=document.querySelector('[data-cert-field="purpose"]');if(el)el.textContent=purpose.toLowerCase();
}

// Refill only the clinical fields so manually edited header/body formatting is preserved.
export function refreshCertAutofill(id){
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r)return;
  const doctorId=parseInt((document.getElementById('ec-doctor')||document.getElementById('ic-doctor')).value);
  const data=certificateAutofillFromTreatment(r.patientId,doctorId);
  const f=document.getElementById('cert-findings-edit'),m=document.getElementById('cert-remarks-edit');
  if(f)f.textContent=data.findings||'';if(m)m.textContent=data.remarks||'';
  const note=document.getElementById('cert-autofill-note');if(note)note.textContent=data.treatment?`Autofilled from clinical notes dated ${fmtDate(data.treatment.date)}.`:'No matching clinical notes were found for this patient and doctor.';
}

export function onCertPrepareDoctorChange(id){
  const doctorId=parseInt(document.getElementById('ec-doctor').value);const doctor=getUserById(doctorId)||{};
  const name=document.getElementById('cert-doctor-name');if(name)name.textContent=`DR. ${((doctor.fname||'')+' '+(doctor.lname||'')).toUpperCase().trim()}`;
  refreshCertAutofill(id);
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

// Final doctor signing stores the document and optional reusable signature, then releases it to the patient.
export async function signCert(id){
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r||r.status!=='Awaiting Signature')return;
  if(appState.auth.currentUser.role!=='Doctor'||r.doctorId!==appState.auth.currentUser.id){
    toast('Only the assigned doctor can sign this certificate.','error');
    return;
  }

  const editor=document.getElementById('cert-editor');
  const findings=readCertificateDocumentField('findings');
  const recommendations=readCertificateDocumentField('remarks');

  if(!findings){toast('Please enter findings or a diagnosis in the FINDINGS / DIAGNOSIS line before issuing the certificate.','error');return;}
  if(!appState.certificateService.certDraftSignature){toast('Please add your signature before issuing the certificate.','error');return;}

  const certNo=certificateNumberFor(r);
  const issuedAt=new Date().toISOString();
  const noEl=document.getElementById('cert-number-display');if(noEl)noEl.textContent=certNo;
  const dateEl=document.getElementById('cert-date-display');if(dateEl)dateEl.textContent=fmtDate(issuedAt);

  const finalHtml=ensureCertificateLogo(sanitizeCertHtml(editor.innerHTML));
  const saveSignature=Boolean(document.getElementById('cert-save-signature')?.checked);

  try{
    if(r._realSupabase){
      const result=await certificateAction({
        action:'sign',
        certificate_id:r.dbCertificateId,
        examination_findings:findings,
        remarks:recommendations,
        document_content:finalHtml,
        signature_data:appState.certificateService.certDraftSignature,
        save_signature:saveSignature
      });

      if(saveSignature)appState.auth.currentUser.savedSignature=appState.certificateService.certDraftSignature;
      await syncRealCertificates();

      const refreshed=certificateRecords().find(x=>x.dbCertificateId===r.dbCertificateId);
      closeAllModals();
      toast(`Certificate ${refreshed?.certNo||result.certificate_no||certNo} signed and issued.`,'success');
      await renderCertRequests('Issued');
    }else{
      r.certNo=certNo;
      r.issuedAt=issuedAt;
      r.findings=findings;
      r.recommendations=recommendations;
      r.signatureData=appState.certificateService.certDraftSignature;
      r.documentHtml=finalHtml;
      r.status='Issued';
      r.issuedById=appState.auth.currentUser.id;
      r.signedById=appState.auth.currentUser.id;
      r.signedAt=issuedAt;
      r.updatedAt=new Date().toLocaleString();
      if(saveSignature)appState.auth.currentUser.savedSignature=appState.certificateService.certDraftSignature;
      persistDB();
      closeAllModals();
      toast(`Certificate ${certNo} signed and issued.`,'success');
      renderCertRequests('Issued');
    }
  }catch(e){
    toast(e?.message||'Unable to sign and issue certificate.','error');
  }
}

export function openDeclineCertModal(id){
  if(!(appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator')){toast('Only staff or administrators can decline requests.','error');return;}
  openModal(`<div class="modal"><div class="modal-header"><h3>Decline Request</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div><div class="modal-body"><div class="form-group"><label>Reason (shown to the patient)</label><textarea id="dc-reason" rows="3" placeholder="e.g. No clinic consultation on record for the stated dates."></textarea></div><button class="btn btn-danger" style="width:100%" ${bindAction('click',(event,element)=>{declineCert((id))})}>Decline Request</button></div></div>`);
}
export async function declineCert(id){
  const r=certificateRecords().find(x=>x.id===Number(id));if(!r)return;
  if(!(appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator'))return;

  const reason=document.getElementById('dc-reason').value.trim();
  if(!reason){toast('Please provide a reason.','error');return;}

  try{
    if(r._realSupabase){
      await certificateAction({action:'decline',certificate_id:r.dbCertificateId,reason});
      await syncRealCertificates();
    }else{
      r.status='Declined';
      r.declineReason=reason;
      persistDB();
    }
    closeAllModals();
    toast('Request declined.','info');
    await renderCertRequests('Pending');
  }catch(e){toast(e?.message||'Unable to decline request.','error');}
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
  appState.certificateService.CERT_PURPOSES=[
  'OJT / Internship Requirement',
  'Excused Absence',
  'Sports / Athletics Participation',
  'Enrollment Requirement',
  'Employment Requirement',
  'Scholarship Requirement',
  'Other'
];
  appState.certificateService.certDraftSignature='';
  appState.certificateService.certSignatureDrawing=false;
  appState.certificateService.certSignatureLastPoint=null;
}
