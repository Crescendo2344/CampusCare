// certificateService: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {syncAdminDirectoryFromSupabase,syncCurrentPatientFromSupabase} from './patientService.js';
import {syncRealDentalRecords,syncRealTreatments,treatmentRecords} from './treatmentService.js';
import {escapeHtml} from './issueReports.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {fmtDate} from './inputValidation.js';
import {closeAllModals,openModal} from './modals.js';
import {showConfirmDialog,toast,toastWithUndo} from './theme.js';
import {persistDB} from './persistence.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {TOOTH_SURFACES,viewPatient} from './patientForm.js';
import {openAddTreatmentModalPt} from './treatmentForm.js';
import {loadJsPDF} from './settingsAndCertificates.js';
import {paginate,pagerHtml} from '../ui/pager.js';
import {bindAction,certificateData,createCertificateService} from '../dependencies.js';
import * as purposeData from '../domain/certificate-purpose.js';
import {accomplishmentText,dentalHistorySummary} from '../domain/dental-certificate.js';
import {CTU_FOOTER_SRC,ctuHeaderHtml} from '../shared/ctu-letterhead.js';
import {certificateKindFor,certificateLabel} from '../domain/clinic-scope.js';
export {certificateKindFor,certificateLabel};
// A saved certificate keeps the format it was written in; older ones without the dental layout are medical.
const recordKind=r=>{
  const html=String(r?.documentHtml||'');
  if(html.includes('mc-doc'))return 'medical';
  if(html.includes('dc-doc'))return 'dental';
  if(html)return 'medical';
  return certificateKindFor(getUserById(r?.doctorId)||{role:'Doctor'});
};
// Preserve legacy handlers while certificate data access lives in independent modules.
// Drafts being discarded stay hidden while their Undo is on offer, and are deleted only after it closes.
const pendingDiscards=new Set();
export function certificateRecords(){return certificateData.certificateRecords(appState.data.DB,appState.auth.currentUser).filter(r=>!pendingDiscards.has(r.id));}
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
    // The tooth chart on a dental certificate comes from the patient's dental records.
    await syncRealDentalRecords();
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

// ---- DOCTOR WORKFLOW ----
// The examining doctor decides whether to issue a certificate, writes it from the visit notes and signs it.



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

// Layout follows the clinic's Dental_Certificate template (FDI numbering, permanent and primary dentition).
// Each tooth shows its latest condition code above/below its number and the marked surfaces on its picture.
const TOOTH_ROWS=[[[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]],
  [[55,54,53,52,51,61,62,63,64,65],[85,84,83,82,81,71,72,73,74,75]]];
// Same tooth picture as the dental record form: rounded square, small inner octagon and four diagonals.
// The surfaces are clipped to the rounded outline so no square corners show outside it.
function toothIconSvg(surfaces=''){
  const on=new Set(String(surfaces).split(',').filter(Boolean));
  const parts=TOOTH_SURFACES.map(([q,,points])=>`<polygon points="${points}" fill="${on.has(q)&&q!=='O'?'#000':'#fff'}" stroke="#111" stroke-width="1" stroke-linejoin="round"/>`).join('');
  const check=on.has('O')?'<path d="M5 12.5 10 18 19.5 6" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>':'';
  return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><defs><clipPath id="dc-clip"><rect x="2" y="2" width="20" height="20" rx="6"/></clipPath></defs><g clip-path="url(#dc-clip)">${parts}</g><rect x="2" y="2" width="20" height="20" rx="6" fill="none" stroke="#111" stroke-width="1.4"/>${check}</svg>`;
}
// One block of the chart: code box and number above, the two rows of tooth pictures, then number and code box below.
function toothBlockHtml([upper,lower],odontogram={}){
  const cells=(nums,fn)=>nums.map(fn).join('');
  const code=n=>`<td class="dc-code" data-tooth="${n}">${escapeHtml(String(odontogram[n]||'').toUpperCase())}</td>`;
  const num=n=>`<td class="dc-num">${n}</td>`;
  const icon=n=>`<td class="dc-icon">${toothIconSvg(odontogram[n+'-surfaces'])}</td>`;
  const side=`<tr class="dc-sides"><td colspan="${upper.length/2}" style="text-align:left">LEFT</td><td colspan="${upper.length/2}" style="text-align:right">RIGHT</td></tr>`;
  return `<table class="dc-chart${upper.length<16?' dc-primary':''}" contenteditable="false"><tbody><tr>${cells(upper,code)}</tr><tr>${cells(upper,num)}</tr><tr class="dc-pics">${cells(upper,icon)}</tr><tr class="dc-pics">${cells(lower,icon)}</tr><tr>${cells(lower,num)}</tr><tr>${cells(lower,code)}</tr>${side}</tbody></table>`;
}
// Checkbox and circle glyphs are plain text so the saved document prints identically; clicking one toggles it.
const dcCheck=(label,checked=false)=>`<div class="dc-check-line"><span class="dc-check" contenteditable="false" data-dc-check>${checked?'☑':'☐'}</span> ${label}</div>`;
const dcCircle=(label,checked=false)=>`<span class="dc-circle-item">${label} <span class="dc-check" contenteditable="false" data-dc-check>${checked?'●':'○'}</span></span>`;
const CHECK_TOGGLE={'☐':'☑','☑':'☐','○':'●','●':'○'};

const certFill=(value,width,id='')=>`<span class="dc-fill"${id?` id="${id}"`:''} style="min-width:${width}px">${escapeHtml(value||'')}</span>`;
// The certificate is signed by hand after printing, like other clinics' certificates: the line is
// left for the wet signature, with the physician's licence number written beside it.
const certSignatureArea=(name,title,signature)=>`<div class="cert-signature-area" contenteditable="false">
      <img id="cert-signature-img" src="${signature||''}" style="${signature?'':'display:none'}" alt="Signature">
      <div class="cert-sign-line"><strong id="cert-doctor-name">${escapeHtml(name)}</strong><br><span>${escapeHtml(title)}</span><br><span class="cert-license">Lic. No.: ____________________</span></div>
    </div>`;
const letterheadTop=()=>ctuHeaderHtml();
const letterheadBottom=()=>`<div class="dc-foot"><img src="${CTU_FOOTER_SRC}" alt="University rankings and accreditations"></div>`;

// The details the doctor confirmed in step 1. Anything not given falls back to the patient's records.
function certificateFieldsFor(r,dental){
  const pt=getPatientById(r.patientId)||{},u=getUserById(pt.userId)||{};
  const oral=dental.oral||{};
  return {
    name:`${u.fname||pt.fname||''} ${u.lname||pt.lname||''}`.trim(),age:pt.age||'',sex:pt.gender||pt.sex||'',
    idNo:u.idNo||pt.idNo||'',address:pt.address||'',course:[pt.course,pt.major].filter(Boolean).join(' – ')||dental.courseMajor||'',
    yearSection:dental.yearSection||'',contact:pt.contact||u.contact||dental.cellNo||'',messenger:dental.messengerAccount||'',
    examDate:'',findings:'',remarks:'',workStatus:dental.workStatus||'',
    oralRating:oral.satisfactory?'Satisfactory':oral.fair?'Fair':oral.poor?'Poor':'',
    harelip:!!oral.harelip,defectiveGums:!!oral.defective_gums,cleftPalate:!!oral.cleft_palate,oralOthers:oral.others||'',
    ...(r.fields||{})
  };
}

// Dental certificate, laid out like the clinic's dental certificate template.
export function buildCertificateDocument(r,doctorId,findings,remarks,signature='',dental=dentalHistorySummary([])){
  const doctor=getUserById(doctorId)||{};
  const f={...certificateFieldsFor(r,dental),findings,remarks};
  const certDate=r.issuedAt||appState.clinicInformation.TODAY;
  const doctorName=`Dr. ${((doctor.fname||'')+' '+(doctor.lname||'')).trim()}`;
  return `<div class="dc-doc">${letterheadTop()}
    <div class="dc-title">DENTAL CERTIFICATE</div>
    <div class="dc-info"><div>Name: ${certFill(f.name,150)} Age: ${certFill(f.age,30)} Date: ${certFill(fmtDate(certDate),80,'cert-date-display')} </div><div>Course &amp; Major: ${certFill(f.course,100)} Yr. &amp; Section: ${certFill(f.yearSection,40)} Cel No.: ${certFill(f.contact,70)}</div><div>ID No.: ${certFill(f.idNo,100)} Messenger Account: ${certFill(f.messenger,200)}</div></div>
    ${toothBlockHtml(TOOTH_ROWS[0],dental.odontogram)}
    ${toothBlockHtml(TOOTH_ROWS[1],dental.odontogram)}
    <div class="dc-bottom"><div class="dc-oral"><div class="dc-label">ORAL HEALTH RECORD</div><div class="dc-gapline">Check:</div>
        <div class="dc-circles">${dcCircle('Satisfactory',f.oralRating==='Satisfactory')} ${dcCircle('Fair',f.oralRating==='Fair')} ${dcCircle('Poor',f.oralRating==='Poor')}</div>
        <div class="dc-circles">${dcCircle('Harelip',f.harelip)}</div><div class="dc-circles">${dcCircle('Defective Gums',f.defectiveGums)}</div><div class="dc-circles">${dcCircle('Cleft Palate',f.cleftPalate)}</div>
        <div class="dc-others">Others: ${certFill(f.oralOthers,150)}</div></div>
      <div class="dc-accomp"><div class="dc-label">ACCOMPLISHMENT</div><div class="dc-gapline">Tooth No. &nbsp; Nature of Operation</div>
        <div class="dc-ruled"><div id="cert-findings-edit" data-cert-field="findings">${escapeHtml(f.findings||'')}</div></div>
        <div class="dc-status">${dcCheck('All necessary dental work has been completed',f.workStatus==='Completed')}${dcCheck('Treatment is in progress',f.workStatus==='In Progress')}${dcCheck('No dental work is necessary',f.workStatus==='No Dental Work Necessary')}</div></div></div>
    <div class="dc-label dc-reco">RECOMMENDATION</div>
    <div class="dc-ruled"><div id="cert-remarks-edit" data-cert-field="remarks">${escapeHtml(f.remarks||'')}</div></div>
    ${certSignatureArea(doctorName,'Dentist II',signature)}
    ${letterheadBottom()}</div>`;
}

// Medical certificate, in the same CTU letterhead and footer as the dental certificate.
export function buildMedicalCertificateDocument(r,doctorId,findings,remarks,signature=''){
  const doctor=getUserById(doctorId)||{};
  const f={...certificateFieldsFor(r,{}),findings,remarks};
  const certDate=r.issuedAt||appState.clinicInformation.TODAY;
  const doctorName=`Dr. ${((doctor.fname||'')+' '+(doctor.lname||'')).trim()}`;
  const who=[f.age?`${f.age} years old`:'',f.sex,f.course,f.yearSection,f.idNo?`ID No. ${f.idNo}`:''].filter(Boolean).join(', ');
  return `<div class="dc-doc mc-doc">${letterheadTop()}
    <div class="dc-title mc-title">MEDICAL CERTIFICATE</div>
    <div class="mc-meta"><span>Certificate No.: <strong id="cert-number-display">${escapeHtml(r.certNo||'To be assigned upon issue')}</strong></span><span>Date: <strong id="cert-date-display">${escapeHtml(fmtDate(certDate))}</strong></span></div>
    <p class="mc-salute"><strong>TO WHOM IT MAY CONCERN:</strong></p>
    <p class="mc-indent">This is to certify that <strong>${escapeHtml(f.name||'')}</strong>${who?`, ${escapeHtml(who)},`:''} ${f.address?` of ${escapeHtml(f.address)},`:''} was seen and examined at the Medical Clinic of Cebu Technological University – Main Campus${f.examDate?` on <strong>${escapeHtml(fmtDate(f.examDate))}</strong>`:''}.</p>
    <p><strong>FINDINGS / DIAGNOSIS:</strong> <span id="cert-findings-edit" data-cert-field="findings">${escapeHtml(f.findings||'')}</span></p>
    <p><strong>REMARKS / RECOMMENDATIONS:</strong> <span id="cert-remarks-edit" data-cert-field="remarks">${escapeHtml(f.remarks||'')}</span></p>
    ${r.statement?`<p class="mc-indent">The above-named patient <span data-cert-field="statement">${escapeHtml(r.statement)}</span></p>`:''}
    <p class="mc-indent">This certification is issued upon the request of the above-named person for <span data-cert-field="purpose">${escapeHtml(String(r.purpose||''))}</span> purposes.</p>
    ${certSignatureArea(doctorName,'Attending Physician',signature)}
    <p class="mc-note">Not valid without the official clinic seal.</p>
    ${letterheadBottom()}</div>`;
}


const isDoctor=()=>appState.auth.currentUser?.role==='Doctor';
const CERT_TABS=[['Awaiting Signature','Drafts'],['Issued','Issued'],['Cancelled','Voided'],['all','All']];

export async function renderCertRequests(filter=null,{refresh=true}={}){
  const c=document.getElementById('app-content');
  if(!c)return;
  // Doctors prepare, sign, issue and void; front-desk staff release issued certificates (view, PDF, print).
  const releaseOnly=appState.auth.currentUser?.role==='Staff';
  if(!isDoctor()&&!releaseOnly){
    c.innerHTML='<div class="alert alert-warning show" style="display:block">Certificates are issued by clinic doctors only.</div>';
    return;
  }
  const pageToken=captureCampusPageToken();
  if(refresh&&appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncCertificateContext();}
    catch(e){
      if(!isCampusPageCurrent('cert-requests',pageToken))return;
      console.error('Certificate sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load certificates.')}</div>
        <button class="btn btn-sm" ${bindAction('click',()=>renderCertRequests(filter))}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('cert-requests',pageToken))return;
  }
  const ui=appState.certificateService;
  // Staff release only their own clinic's certificates: medical or dental.
  const staffKind=certificateKindFor(appState.auth.currentUser);
  const mine=releaseOnly?certificateRecords().filter(r=>['Issued','Cancelled'].includes(r.status)&&recordKind(r)===staffKind):certificateRecords().filter(r=>r.doctorId===appState.auth.currentUser.id);
  const tabs=releaseOnly?CERT_TABS.filter(([id])=>id!=='Awaiting Signature'):CERT_TABS;
  if(!filter||!tabs.some(([id])=>id===filter))filter=releaseOnly?'Issued':ui.certTab||(mine.some(r=>r.status==='Awaiting Signature')?'Awaiting Signature':'Issued');
  ui.certTab=filter;
  const q=String(ui.certQuery||'').trim().toLowerCase();
  const patientName=r=>{const pt=getPatientById(r.patientId);return pt?`${pt.lname}, ${pt.fname}`:'Unknown patient';};
  const counts=Object.fromEntries(tabs.map(([id])=>[id,id==='all'?mine.length:mine.filter(r=>r.status===id).length]));
  const list=mine
    .filter(r=>filter==='all'||r.status===filter)
    .filter(r=>!q||`${patientName(r)} ${r.certNo} ${r.purpose} ${r.details}`.toLowerCase().includes(q))
    .sort((a,b)=>String(b.issuedAt||b.preparedAt||b.requestedAt).localeCompare(String(a.issuedAt||a.preparedAt||a.requestedAt))||b.id-a.id);

  const page=paginate('cert-requests',list,{signature:filter+'|'+q});
  c.innerHTML=`<div class="appt-head"><div class="appt-views" role="tablist" aria-label="Certificate lists">${tabs.map(([id,label])=>`<button type="button" role="tab" class="appt-view ${filter===id?'active':''} ${id==='Awaiting Signature'&&counts[id]?'attention':''}" aria-selected="${filter===id}" ${bindAction('click',()=>renderCertRequests(id,{refresh:false}))}>${label}<span class="appt-view-count">${counts[id]}</span></button>`).join('')}</div>
      ${releaseOnly?'<span class="text-muted cert-release-note">Release issued certificates to patients. Only doctors can prepare, sign or void them.</span>':`<button class="btn btn-primary btn-sm" ${bindAction('click',()=>openNewCertificateModal())}>+ New Certificate</button>`}</div>
    <div class="toolbar"><input type="search" id="cert-search" placeholder="Search patient, certificate no. or purpose" aria-label="Search certificates" value="${escapeHtml(ui.certQuery||'')}" ${bindAction('input',(event,element)=>{ui.certQuery=element.value;clearTimeout(ui.certSearchTimer);ui.certSearchTimer=setTimeout(()=>renderCertRequests(filter,{refresh:false}).then(()=>{const input=document.getElementById('cert-search');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}),250);})}></div>
    <div class="card">${list.length?`<div class="table-wrap"><table class="cert-list-table"><thead><tr><th scope="col">Certificate</th><th scope="col">Patient</th><th scope="col">Purpose</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${page.rows.map(r=>{
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
          ${r.status==='Issued'?`<button class="btn btn-xs btn-primary" ${bindAction('click',()=>downloadCertPdf(r.id))}><i class="bi bi-download" aria-hidden="true"></i> PDF</button><button class="btn btn-xs" ${bindAction('click',()=>printCertificate(r.id))}><i class="bi bi-printer" aria-hidden="true"></i> Print</button>${releaseOnly?'':`<button class="btn btn-xs btn-danger" ${bindAction('click',()=>openVoidCertificateModal(r.id))}>Void</button>`}`:''}
        </div></td>
      </tr>`;}).join('')}</tbody></table></div>${pagerHtml(page,()=>renderCertRequests(filter,{refresh:false}))}`
      :`<div class="empty-state"><i class="bi bi-file-earmark-medical" aria-hidden="true" style="font-size:1.6rem"></i><p>${q?'No certificates match your search.':filter==='Awaiting Signature'?'No drafts. Start a new certificate after a consultation.':'No certificates here yet.'}</p></div>`}</div>`;
}

// Step 1: who, which visit and why. The certificate must rest on an examination by this doctor.
export function openNewCertificateModal(patientId=null,treatmentId=null,prefill={}){
  if(!isDoctor()){toast('Only doctors can issue certificates.','error');return;}
  const pt=patientId?getPatientById(patientId):null;
  appState.certificateService.certPrefill=prefill;
  const kind=certificateKindFor(appState.auth.currentUser);
  openModal(`<div class="modal cert-new-modal">
    <div class="modal-header"><div><h3>New ${certificateLabel(kind).toLowerCase()}</h3><div class="text-muted">Step 1 of 2 · Patient and purpose</div></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label for="nc-pt-search">Patient <span class="required">*</span></label>
        <input type="hidden" id="nc-pt" value="${pt?pt.id:''}">
        <div class="patient-combobox"><input type="search" id="nc-pt-search" autocomplete="off" placeholder="Search by name or ID number" value="${pt?escapeHtml(pt.fname+' '+pt.lname):''}" ${bindAction('input',(event,element)=>filterCertificatePatients(element.value))}><div class="patient-combobox-list" id="nc-pt-results"></div></div>
        <p class="registration-field-error" id="nc-pt-error" hidden></p>
      </div>
      <input type="hidden" id="nc-visit" value="">
      <div id="nc-visit-card" class="nc-visit-card" aria-live="polite"></div>
      <p class="registration-field-error" id="nc-visit-error" hidden></p>
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

// Every detail on the certificate comes from the patient's records and the chosen visit, so the
// document opens complete; the doctor can still correct anything directly on the page.
function autofillCertificateDetails(patientId,visit,kind){
  const prefill=appState.certificateService.certPrefill||{};
  const dental=dentalHistorySummary(treatmentRecords().filter(t=>t.patientId===patientId));
  const visitFill=visit?certificateFromVisit(visit):{findings:prefill.findings||'',remarks:prefill.restrictions?`Restrictions: ${prefill.restrictions}`:''};
  const fill=kind==='dental'?dentalAutofill(dental,visitFill):visitFill;
  return {...certificateFieldsFor({patientId},kind==='dental'?dental:{}),examDate:visit?.date||appState.clinicInformation.TODAY,findings:fill.findings||'',remarks:fill.remarks||''};
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
// A certificate rests on a recorded visit with this doctor: the latest one is used. A patient seen
// without an appointment gets a consultation recorded first; an assessment brings its own findings.
function syncCertificateVisits(patientId,selected=null){
  const input=document.getElementById('nc-visit'),card=document.getElementById('nc-visit-card');if(!input||!card)return;
  input.value='';
  if(!patientId){card.innerHTML='';return;}
  const visits=doctorVisits(patientId);
  const visit=visits.find(t=>t.id===Number(selected))||visits[0];
  if(visit){
    input.value=String(visit.id);
    card.innerHTML=`<div class="nc-visit-row"><i class="bi bi-clipboard2-pulse" aria-hidden="true"></i><div><span>Recorded visit</span><strong>${escapeHtml(fmtDate(visit.date))} · ${escapeHtml(visit.diagnosis||'No diagnosis recorded')}</strong>${visit.findings?`<small>${escapeHtml(String(visit.findings).slice(0,140))}</small>`:''}</div></div>`;
    return;
  }
  if(appState.certificateService.certPrefill?.findings){
    card.innerHTML='<div class="nc-visit-row"><i class="bi bi-clipboard2-check" aria-hidden="true"></i><div><span>Based on</span><strong>The fitness assessment findings</strong></div></div>';
    return;
  }
  card.innerHTML=`<div class="nc-visit-row nc-visit-missing"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><div><span>No recorded visit with you</span><strong>Record a consultation first, then issue the certificate from it.</strong></div>
    <button type="button" class="btn btn-sm btn-primary" ${bindAction('click',()=>{closeAllModals();openAddTreatmentModalPt(patientId);})}>Record consultation</button></div>`;
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
export async function continueNewCertificate(){
  const patientId=Number(document.getElementById('nc-pt').value)||0;
  const treatmentId=Number(document.getElementById('nc-visit').value)||0;
  const purpose=document.getElementById('nc-purpose').value;
  const fields=readCertificateFields();
  const errors=purposeData.certificateDetailErrors(purpose,fields,appState.clinicInformation.TODAY);
  if(!patientId)errors.pt='Choose the patient from the list.';
  else if(!treatmentId&&!appState.certificateService.certPrefill?.findings)errors.visit='Record a consultation with this patient before issuing a certificate.';
  for(const el of document.querySelectorAll('.cert-new-modal .registration-field-error')){el.hidden=true;el.textContent='';}
  for(const [key,message] of Object.entries(errors)){const el=document.getElementById(`nc-${key}-error`);if(el){el.textContent=message;el.hidden=false;}}
  if(Object.keys(errors).length){document.querySelector('.cert-new-modal .registration-field-error:not([hidden])')?.scrollIntoView({block:'center'});return;}
  const {statement,summary}=purposeData.certificateStatement(purpose,fields);
  // Dental records may not be loaded yet on this screen; the chart is filled from them.
  try{await syncRealDentalRecords();}catch(e){console.error('Dental records sync:',e);}
  closeAllModals();
  const visit=treatmentRecords().find(t=>t.id===treatmentId)||null;
  const details=autofillCertificateDetails(patientId,visit,certificateKindFor(appState.auth.currentUser));
  openCertificateEditor(null,{patientId,treatmentId,purpose,statement,details:summary,fields:details});
}

// Step 2: review the certificate document, then issue and print it.
export function openCertificateEditor(id,draft=null){
  if(!isDoctor())return;
  if(id)appState.certificateService.certPrefill={};
  const r=id?certificateRecords().find(x=>x.id===Number(id)):{id:null,status:'Awaiting Signature',doctorId:appState.auth.currentUser.id,...draft};
  if(!r||r.status!=='Awaiting Signature')return;
  if(id&&r.doctorId!==appState.auth.currentUser.id){toast('Only the doctor who wrote this draft can open it.','error');return;}
  const pt=getPatientById(r.patientId),doctor=appState.auth.currentUser;
  const visit=treatmentRecords().find(t=>t.id===r.treatmentId)||null;
  const prefill=appState.certificateService.certPrefill||{};
  const visitFill=visit?certificateFromVisit(visit):{findings:prefill.findings||'',remarks:prefill.restrictions?`Restrictions: ${prefill.restrictions}`:'',treatment:null};
  // The patient's recent dental history fills the chart; it is shown whether or not there are dental issues.
  const dental=dentalHistorySummary(treatmentRecords().filter(t=>t.patientId===r.patientId));
  const kind=r.documentHtml?(r.documentHtml.includes('mc-doc')||!r.documentHtml.includes('dc-doc')?'medical':'dental'):certificateKindFor(doctor);
  const autofill=kind==='dental'?dentalAutofill(dental,visitFill):visitFill;
  // Step 1 already confirmed the findings and remarks; a saved draft keeps its own document.
  const findings=r.fields?.findings||r.findings||autofill.findings,remarks=r.fields?r.fields.remarks:(r.recommendations||autofill.remarks);
  const documentHtml=normalizeCertificateDocumentMetadata(r,r.documentHtml||(kind==='dental'
    ?buildCertificateDocument(r,doctor.id,findings,remarks,'',dental)
    :buildMedicalCertificateDocument(r,doctor.id,findings,remarks,'')));
  appState.certificateService.certEditing={id:r.id,patientId:r.patientId,treatmentId:r.treatmentId||null,purpose:r.purpose,details:r.details||''};
  // The document comes from the recorded visit and is reviewed, not edited: a correction is made in
  // the visit record. It is signed by hand after printing, so there is no e-signature.
  appState.certificateService.certDraftSignature='';
  openModal(`<div class="modal modal-xl" style="max-width:980px">
    <div class="modal-header"><div><h3>${r.id?`${certificateLabel(kind)} draft`:`Review ${certificateLabel(kind).toLowerCase()}`}</h3><div class="text-muted">Step 2 of 2 · ${pt?escapeHtml(pt.fname+' '+pt.lname):'Unknown patient'} · ${escapeHtml(r.purpose)}${visit?` · visit of ${escapeHtml(fmtDate(visit.date))}`:''}</div></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <input id="ic-doctor" type="hidden" value="${doctor.id}">
      <div class="cert-page-wrap"><div class="cert-paper cert-review" id="cert-editor" aria-label="Certificate preview">${documentHtml}</div></div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>saveCertificateDraft())}>Save draft</button><button class="btn btn-success" ${bindAction('click',()=>signCert())}><i class="bi bi-printer" aria-hidden="true"></i> Issue &amp; print</button></div>
  </div>`);
}

// Dental records take priority for the Accomplishment and Recommendation; a record with no operations still reads as a finding.
function dentalAutofill(dental,visitFill){
  if(!dental.hasRecord)return visitFill;
  const done=accomplishmentText(dental.operations);
  return {...visitFill,findings:done||visitFill.findings||'No dental work performed.',remarks:dental.recommendation||visitFill.remarks};
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
  showConfirmDialog({title:'Discard draft',message:'Delete this certificate draft?',confirmLabel:'Discard',danger:true,onConfirm:async()=>{
    pendingDiscards.add(r.id);
    await renderCertRequests('Awaiting Signature');
    const entry=toastWithUndo('Draft discarded.',async()=>{
      pendingDiscards.delete(r.id);
      await renderCertRequests('Awaiting Signature');
    },{undoneMessage:'Draft kept.'});
    // Delete for real once the Undo toast has gone without being used.
    const commit=async()=>{
      if(entry.used)return;
      if(entry.toast?.isConnected){setTimeout(commit,500);return;}
      entry.used=true;
      try{
        if(r._realSupabase){await certificateAction({action:'discard',certificate_id:r.dbCertificateId});await syncRealCertificates();}
        else{appState.data.DB.certRequests=appState.data.DB.certRequests.filter(x=>x.id!==r.id);persistDB();}
      }catch(e){toast(e?.message||'Unable to discard the draft.','error');}
      finally{pendingDiscards.delete(r.id);}
    };
    setTimeout(commit,500);
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
    closeAllModals();await renderCertRequests('Cancelled');
  }catch(e){toast(e?.message||'Unable to void the certificate.','error');return;}
  toastWithUndo(`Certificate ${r.certNo} voided.`,async()=>{
    if(r._realSupabase){await certificateAction({action:'unvoid',certificate_id:r.dbCertificateId});await syncRealCertificates();}
    else{r.status='Issued';r.declineReason='';persistDB();}
    await renderCertRequests('Issued');
  },{undoneMessage:`Certificate ${r.certNo} is valid again.`});
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


// Remove executable HTML before saving the editable document into local data.
export function sanitizeCertHtml(html){
  const box=document.createElement('div');box.innerHTML=html;
  box.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove());
  box.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{if(/^on/i.test(a.name))el.removeAttribute(a.name)}));
  return box.innerHTML;
}

// Issuing saves the draft, assigns the certificate number and prints it for the wet signature.
export async function signCert(){
  if(!isDoctor())return;
  const findings=readCertificateDocumentField('findings');
  if(!findings){toast('Write the findings or diagnosis before issuing the certificate.','error');return;}
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
      const result=await certificateAction({action:'sign',certificate_id:r.dbCertificateId,examination_findings:findings,remarks:recommendations,document_content:finalHtml});
      issuedNo=result.certificate_no||certNo;
      await syncRealCertificates();
    }else{
      Object.assign(r,{certNo,issuedAt,findings,recommendations,documentHtml:finalHtml,status:'Issued',issuedById:appState.auth.currentUser.id,signedById:appState.auth.currentUser.id,signedAt:issuedAt});
      persistDB();
    }
    closeAllModals();
    toast(`Certificate ${issuedNo} issued. Sign the printed copy before releasing it.`,'success');
    await renderCertRequests('Issued');
    const issued=certificateRecords().find(x=>x.id===r.id||(r.dbCertificateId&&x.dbCertificateId===r.dbCertificateId));
    if(issued)printCertificate(issued.id);
  }catch(e){toast(e?.message||'Unable to issue the certificate.','error');}
}

export function loadHtml2Canvas(){return new Promise((resolve,reject)=>{if(window.html2canvas){resolve(window.html2canvas);return}const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';script.onload=()=>window.html2canvas?resolve(window.html2canvas):reject(new Error('html2canvas failed'));script.onerror=()=>reject(new Error('Could not load html2canvas'));document.head.appendChild(script)})}

// Export the exact saved document styling and signature to PDF.
// Printing uses the same signed document as the PDF, in a hidden frame with the app's certificate styles.
export function printCertificate(id){
  const r=certificateRecords().find(x=>x.id===Number(id));
  if(!r||r.status!=='Issued'||!r.documentHtml){toast('Only issued certificates can be printed.','error');return;}
  const frame=document.createElement('iframe');
  frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
  frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.append(frame);
  const styles=[...document.querySelectorAll('link[rel="stylesheet"],style')].map(node=>node.outerHTML).join('');
  const doc=frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.certNo||certificateLabel(recordKind(r)))}</title>${styles}<style>@page{size:A4;margin:0}body{margin:0;background:#fff}.cert-paper{box-shadow:none!important;margin:0 auto!important}</style></head><body><div class="cert-paper">${normalizeCertificateDocumentMetadata(r,r.documentHtml)}</div></body></html>`);
  doc.close();
  const run=()=>{frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>frame.remove(),1000);};
  const images=[...doc.images].filter(img=>!img.complete);
  if(images.length)Promise.all(images.map(img=>new Promise(res=>{img.onload=img.onerror=res;}))).then(run);else setTimeout(run,150);
}

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

    pdf.save(`${certificateLabel(recordKind(r)).replace(/ /g,'_')}_${r.certNo||certificateDisplayId(r)}.pdf`);
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
