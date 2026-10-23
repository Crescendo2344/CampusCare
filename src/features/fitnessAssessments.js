import {createFeatureSyncService} from '../services/feature-sync.js';
// fitnessAssessments: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {syncAdminDirectoryFromSupabase,syncCurrentPatientFromSupabase} from './patientService.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {getMedDoctors,getPatientById,getUserById} from './documentScanner.js';
import {fmtDate,fmtDateTime} from './inputValidation.js';
import {docName} from './messaging.js';
import {closeAllModals,openModal} from './modals.js';
import {campusDateFieldHtml} from './datePicker.js';
import {hideAlert,showAlert,showConfirmDialog,toast} from './theme.js';
import {auditLog} from './auditAndBackups.js';
import {persistDB} from './persistence.js';
import {bindAction,createOperationalService,workflowData} from '../dependencies.js';
import * as screening from '../domain/fitness-screening.js';
import {openNewCertificateModal} from './certificateService.js';
// ================================================================
// FITNESS-TO-COMPETE ASSESSMENT — REAL SUPABASE WORKFLOW
// ================================================================
export function fitnessRecords(){
  if(appState.auth.currentUser?._realSupabase)return (appState.data.DB.fitnessAssessments||[]).filter(x=>x._realSupabase);
  return appState.data.DB.fitnessAssessments||[];
}

export function fitnessDisplayId(x){return workflowData.fitnessDisplayId(x);}

export function fitnessDecisionBadge(d){
  const cls=d==='Fit to Compete'?'badge-success':d==='Fit with Restrictions'?'badge-warning':d==='Not Fit to Compete'?'badge-danger':'badge-gray';
  return `<span class="badge ${cls}">${escapeHtml(d||'Pending Assessment')}</span>`;
}

export function fitnessStatusBadge(s){
  const cls=s==='Completed'?'badge-success':s==='In Assessment'?'badge-info':s==='Cancelled'?'badge-gray':'badge-warning';
  return `<span class="badge ${cls}">${escapeHtml(s||'Requested')}</span>`;
}

export async function fitnessAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).fitnessAction(payload);}

export function realFitnessToUi(r){return workflowData.realFitnessToUi(r);}

export async function syncRealFitnessAssessments(){
  return createFeatureSyncService({getState:()=>appState,callbacks:{fitnessRecords,realFitnessToUi}}).syncRealFitnessAssessments();
}

export async function syncFitnessContext(){
  if(!appState.auth.currentUser?._realSupabase)return;

  if(['Administrator','Staff','Doctor'].includes(appState.auth.currentUser.role)){
    await syncAdminDirectoryFromSupabase();
  }else if(appState.auth.currentUser.role==='Patient'){
    if(!appState.auth.currentPatient||!appState.auth.currentPatient._realSupabase)await syncCurrentPatientFromSupabase();
  }

  await syncRealFitnessAssessments();
}

export async function renderFitnessAssessments(){
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();
  const role=appState.auth.currentUser.role;

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncFitnessContext();}
    catch(e){
      if(!isCampusPageCurrent('fitness',pageToken))return;
      console.error('Fitness assessment sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load fitness assessments.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderFitnessAssessments()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('fitness',pageToken))return;
  }

  let rows=fitnessRecords().slice();
  if(role==='Patient'&&appState.auth.currentPatient)rows=rows.filter(x=>x.patientId===appState.auth.currentPatient.id);
  if(role==='Doctor')rows=rows.filter(x=>!x.doctorId||x.doctorId===appState.auth.currentUser.id);
  const ui=appState.fitnessList??={};
  ui.tab??=role==='Patient'?'all':'open';ui.query??='';
  const today=appState.clinicInformation.TODAY;
  const open=x=>x.status==='Requested'||x.status==='In Assessment';
  const tabs=[['open','To assess',rows.filter(open).length],['Completed','Completed',rows.filter(x=>x.status==='Completed').length],['Cancelled','Cancelled',rows.filter(x=>x.status==='Cancelled').length],['all','All',rows.length]];
  const q=ui.query.trim().toLowerCase();
  const list=rows
    .filter(x=>ui.tab==='all'||(ui.tab==='open'?open(x):x.status===ui.tab))
    .filter(x=>{const p=getPatientById(x.patientId);return !q||`${p?`${p.fname} ${p.lname} ${p.lname}, ${p.fname} ${p.idNo||''}`:''} ${x.sport||''} #${fitnessDisplayId(x)}`.toLowerCase().includes(q);})
    // Open requests oldest first (first come, first served); finished ones newest first.
    .sort((a,b)=>ui.tab==='open'?String(a.requestedDate).localeCompare(String(b.requestedDate))||a.id-b.id:String(b.date||b.requestedDate).localeCompare(String(a.date||a.requestedDate))||b.id-a.id);

  const actionButton=role==='Patient'
    ? `<button class="btn btn-primary btn-sm" ${bindAction('click',()=>openFitnessRequestModal())}>+ Request Assessment</button>`
    : (role==='Doctor'
      ? `<button class="btn btn-primary btn-sm" ${bindAction('click',()=>openFitnessAssessmentModal())}>+ New Assessment</button>`
      : '');
  const clearance=x=>{
    const state=screening.clearanceState(x,today);
    if(!state)return '<span class="text-muted">—</span>';
    const until=screening.clearanceValidUntil(x.date);
    return state==='expired'?`<span class="tr-due overdue" style="margin:0">Expired ${fmtDate(until)}</span>`:`Until ${fmtDate(until)}`;
  };

  c.innerHTML=`
    <div class="appt-head"><div class="appt-views" role="tablist" aria-label="Fitness assessment lists">${tabs.map(([id,label,count])=>`<button type="button" role="tab" class="appt-view ${ui.tab===id?'active':''} ${id==='open'&&count&&role!=='Patient'?'attention':''}" aria-selected="${ui.tab===id}" ${bindAction('click',()=>{ui.tab=id;renderFitnessAssessments();})}>${label}<span class="appt-view-count">${count}</span></button>`).join('')}</div>${actionButton}</div>
    ${role==='Patient'?`<div class="alert alert-info show" style="font-size:.78rem;display:block">
      <strong>Intramurals 2026–2027:</strong> get the Eligibility Form from your coach, fill in your details and sport, sign the Participant's Waiver and Release Agreement, collect the parent/guardian and coach signatures, then bring the form to the clinic at the <strong>Ground Floor, Education Building</strong>.
    </div>`:''}
    <div class="toolbar"><input type="search" id="fit-search" placeholder="Search patient, sport or assessment #" aria-label="Search fitness assessments" value="${escapeHtml(ui.query)}" ${bindAction('input',(event,element)=>{ui.query=element.value;clearTimeout(ui.timer);ui.timer=setTimeout(()=>renderFitnessAssessments().then(()=>{const input=document.getElementById('fit-search');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}),250);})}></div>
    <p class="patient-filter-summary">Pre-participation medical assessment for sports. The attending doctor makes the final clearance decision; a clearance is valid for one year.</p>
    <div class="card">${list.length?`<div class="table-wrap"><table class="treat-table">
      <thead><tr><th scope="col">Requested</th><th scope="col">Patient</th><th scope="col">Sport / Event</th><th scope="col">Event date</th><th scope="col">Doctor</th><th scope="col">Status</th><th scope="col">Decision</th><th scope="col">Clearance</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map(x=>{
        const p=getPatientById(x.patientId),d=getUserById(x.doctorId);
        const canAssess=role==='Doctor'&&(!x.doctorId||x.doctorId===appState.auth.currentUser.id)&&x.status!=='Cancelled';
        const eventSoon=x.eventDate&&open(x)&&x.eventDate>=today&&x.eventDate<=new Date(Date.parse(today+'T12:00:00Z')+7*864e5).toISOString().slice(0,10);
        return `<tr class="treat-row" ${bindAction('click',()=>viewFitnessAssessment(x.id))}>
          <td data-label="Requested"><strong>${x.requestedDate?fmtDate(String(x.requestedDate).slice(0,10)):'—'}</strong><div class="text-muted">#${fitnessDisplayId(x)}</div></td>
          <td data-label="Patient">${p?`<strong>${escapeHtml(p.lname+', '+p.fname)}</strong><div class="text-muted">${escapeHtml(p.idNo||'')}${p.college?' · '+escapeHtml(p.college):''}</div>`:'Unknown'}</td>
          <td data-label="Sport / Event">${escapeHtml(x.sport||'—')}</td>
          <td data-label="Event date">${x.eventDate?fmtDate(x.eventDate):'—'}${eventSoon?'<span class="tr-due today">This week</span>':''}</td>
          <td data-label="Doctor">${d?escapeHtml(docName(d)):'<span class="text-muted">Not yet assigned</span>'}</td>
          <td data-label="Status">${fitnessStatusBadge(x.status)}</td>
          <td data-label="Decision">${x.decision?fitnessDecisionBadge(x.decision):'<span class="text-muted">—</span>'}</td>
          <td data-label="Clearance">${clearance(x)}</td>
          <td data-label="Actions"><div class="td-actions" ${bindAction('click',(event)=>event.stopPropagation())}>
            ${canAssess?`<button class="btn btn-xs btn-primary" ${bindAction('click',()=>openFitnessAssessmentModal(x.id))}>${x.decision?'Edit':'Assess'}</button>`:`<button class="btn btn-xs" ${bindAction('click',()=>viewFitnessAssessment(x.id))}>View</button>`}
            ${role==='Patient'&&x.status==='Requested'?`<button class="btn btn-xs btn-danger" ${bindAction('click',()=>cancelFitnessRequest(x.id))}>Cancel</button>`:''}
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`:`<div class="empty-state"><i class="bi bi-heart-pulse" aria-hidden="true" style="font-size:1.6rem"></i><p>${q?'No assessments match your search.':ui.tab==='open'?'No requests waiting for assessment.':'No fitness-to-compete assessments here yet.'}</p></div>`}</div>`;
}

export function openFitnessRequestModal(){
  if(!appState.auth.currentPatient)return;
  openModal(`<div class="modal">
    <div class="modal-header">
      <h3>Request Fitness-to-Compete Assessment</h3>
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
    </div>
    <div class="modal-body">
      <div id="fit-request-msg"></div>
      <div class="alert alert-info show" style="font-size:.77rem">
        For Intramurals 2026–2027, bring your completed Eligibility Form from your coach, including the required waiver and signatures, when you report to the clinic.
      </div>
      <div class="form-group">
        <label>Sport / Event <span class="required">*</span></label>
        <input id="fit-sport" maxlength="255" placeholder="e.g. Basketball Intramurals">
      </div>
      <div class="form-group">
        <label>Competition / Event Date</label>
        ${campusDateFieldHtml('fit-event-date','','Event Date',appState.clinicInformation.TODAY)}
      </div>
      <div class="form-group">
        <label>Notes / Relevant Concern</label>
        <textarea id="fit-notes" rows="3" maxlength="1500" placeholder="Previous injury, symptoms, event details, or other information for the clinic"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" id="fit-request-btn" ${bindAction('click',(event,element)=>{saveFitnessRequest()})}>Submit Request</button>
    </div>
  </div>`);
}

export async function saveFitnessRequest(){
  const sport=document.getElementById('fit-sport').value.trim();
  const eventDate=document.getElementById('fit-event-date').value;
  const notes=document.getElementById('fit-notes').value.trim();
  const msg=document.getElementById('fit-request-msg');
  const btn=document.getElementById('fit-request-btn');
  hideAlert(msg);

  if(!sport){
    showAlert(msg,'Sport or event is required.');
    return;
  }

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Submitting…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      await fitnessAction({
        action:'create',
        patient_id:appState.auth.currentPatient.dbPatientId,
        sport_event:sport,
        event_date:eventDate||null,
        request_notes:notes
      });
      await syncRealFitnessAssessments();
    }else{
      const rec={
        id:appState.data.DB.nextFitnessId++,
        patientId:appState.auth.currentPatient.id,
        doctorId:null,
        sport,eventDate,notes,
        requestedDate:appState.clinicInformation.TODAY,date:'',
        status:'Requested',decision:'',
        createdAt:new Date().toISOString()
      };
      appState.data.DB.fitnessAssessments.push(rec);
      auditLog('FITNESS_REQUEST_SUBMITTED',`Requested fitness-to-compete assessment for ${sport}.`,'FitnessAssessment',rec.id);
      persistDB();
    }

    closeAllModals();
    toast('Fitness assessment request submitted.','success');
    await renderFitnessAssessments();
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit fitness assessment request.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||'Submit Request';
    }
  }
}

export function cancelFitnessRequest(id){
  const x=fitnessRecords().find(r=>r.id===Number(id));
  if(!x||x.status!=='Requested')return;

  showConfirmDialog({
    title:'Cancel Fitness Assessment Request',
    message:`Cancel fitness-to-compete request <strong>#${fitnessDisplayId(x)}</strong> for ${escapeHtml(x.sport||'this event')}?`,
    confirmLabel:'Cancel Request',
    danger:true,
    onConfirm:async()=>{
      try{
        if(x._realSupabase){
          await fitnessAction({action:'cancel',assessment_id:x.dbAssessmentId});
          await syncRealFitnessAssessments();
        }else{
          x.status='Cancelled';
          persistDB();
        }
        toast('Fitness assessment request cancelled.','info');
        await renderFitnessAssessments();
      }catch(e){
        toast(e?.message||'Unable to cancel fitness assessment request.','error');
      }
    }
  });
}

export function openFitnessAssessmentModal(id=null){
  const x=id?fitnessRecords().find(r=>r.id===Number(id)):null;
  const realMode=Boolean(appState.auth.currentUser?._realSupabase);
  const patients=(realMode?appState.data.DB.patients.filter(p=>p._realSupabase):appState.data.DB.patients).filter(p=>!p.archived);
  const doctors=getMedDoctors();
  const patientId=x?.patientId||'';
  const doctorId=x?.doctorId||(appState.auth.currentUser.role==='Doctor'?appState.auth.currentUser.id:(doctors[0]?.id||''));

  if(id&&!x){
    toast('Fitness assessment could not be loaded.','error');
    return;
  }

  if(!id&&!patients.length){
    toast('No active patient records are available.','warning');
    return;
  }

  const patientField=x
    ? `<input type="hidden" id="fit-patient" value="${patientId}">
       <input value="${escapeHtml((getPatientById(patientId)||{}).fname||'')} ${escapeHtml((getPatientById(patientId)||{}).lname||'')}" disabled>`
    : `<div class="patient-combobox">
        <input type="hidden" id="fit-patient" value="">
        <input id="fit-patient-search" type="search" autocomplete="off"
          placeholder="Search patient by name, ID, or college..."
          ${bindAction('input',(event,element)=>{filterFitnessPatients(element.value)})}
          ${bindAction('focus',(event,element)=>{if(element.value.trim())filterFitnessPatients(element.value)})}>
        <div id="fit-patient-results" class="patient-combobox-list"></div>
      </div>`;

  const saved=screening.decodeScreening(x?.cardioResp||'');
  const doctorField=`<input type="hidden" id="fit-doctor" value="${appState.auth.currentUser.id}">
       <input value="${escapeHtml(docName(appState.auth.currentUser))} · ${escapeHtml(appState.auth.currentUser.specialty||'General Medicine')}" disabled>`;

  openModal(`<div class="modal modal-xl">
    <div class="modal-header">
      <h3>${x?`Fitness-to-Compete Assessment #${fitnessDisplayId(x)}`:'New Fitness-to-Compete Assessment'}</h3>
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
    </div>
    <div class="modal-body">
      <div id="fit-assess-msg"></div>

      ${x?.notes?`<div class="alert alert-info show" style="font-size:.78rem">
        <strong>Patient request notes:</strong> ${escapeHtml(x.notes)}
      </div>`:''}

      <div class="form-row">
        <div class="form-group"><label>Patient <span class="required">*</span></label>${patientField}<p class="registration-field-error" id="fit-patient-error" aria-live="polite" hidden></p></div>
        <div class="form-group"><label>Sport / Event <span class="required">*</span></label>
          <input id="fit-sport-a" maxlength="255" value="${escapeHtml(x?.sport||'')}"><p class="registration-field-error" id="fit-sport-a-error" aria-live="polite" hidden></p>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Competition / Event Date</label>
          ${campusDateFieldHtml('fit-event-date-a',x?.eventDate||'','Event Date',appState.clinicInformation.TODAY)}<p class="registration-field-error" id="fit-event-date-a-error" aria-live="polite" hidden></p>
        </div>
        <div class="form-group"><label>Assessment Date <span class="required">*</span></label>
          ${campusDateFieldHtml('fit-date',x?.date||appState.clinicInformation.TODAY,'Assessment Date','',appState.clinicInformation.TODAY)}<p class="registration-field-error" id="fit-date-error" aria-live="polite" hidden></p>
        </div>
        <div class="form-group"><label>Attending Doctor <span class="required">*</span></label>${doctorField}</div>
      </div>

      <div class="section-label">Vitals</div>
      <div class="form-row">
        <div class="form-group"><label>Blood Pressure</label><input id="fit-bp" value="${escapeHtml(x?.vitals?.bp||'')}" placeholder="e.g. 120/80"><p class="registration-field-error" id="fit-bp-error" aria-live="polite" hidden></p></div>
        <div class="form-group"><label>Heart rate (bpm)</label><input id="fit-hr" inputmode="numeric" value="${escapeHtml(x?.vitals?.hr||'')}" placeholder="bpm"><p class="registration-field-error" id="fit-hr-error" aria-live="polite" hidden></p></div>
        <div class="form-group"><label>Height (cm)</label><input id="fit-height" inputmode="decimal" value="${escapeHtml(x?.vitals?.height||'')}" placeholder="cm"><p class="registration-field-error" id="fit-height-error" aria-live="polite" hidden></p></div>
        <div class="form-group"><label>Weight (kg)</label><input id="fit-weight" inputmode="decimal" value="${escapeHtml(x?.vitals?.weight||'')}" placeholder="kg"><p class="registration-field-error" id="fit-weight-error" aria-live="polite" hidden></p></div>
      </div>

      <div class="section-label">Screening questions</div>
      <p class="form-note" style="margin:0 0 .5rem">Ask the patient each question. Any "Yes" needs further evaluation before clearance.</p>
      <div class="fit-screening" id="fit-screening">${screening.SCREENING_QUESTIONS.map(([key,label])=>`<div class="fit-screen-row" role="radiogroup" aria-label="${escapeHtml(label)}"><span>${escapeHtml(label)}</span>
        <label><input type="radio" name="fit-q-${key}" value="no" ${saved.answers[key]==='no'?'checked':''} ${bindAction('change',()=>syncFitnessScreening())}> No</label>
        <label><input type="radio" name="fit-q-${key}" value="yes" ${saved.answers[key]==='yes'?'checked':''} ${bindAction('change',()=>syncFitnessScreening())}> Yes</label></div>`).join('')}</div>
      <div class="pt-allergy-alert" id="fit-screen-warning" role="alert" hidden></div><p class="registration-field-error" id="fit-screening-error" aria-live="polite" hidden></p>
      <div class="section-label">History and examination</div>
      <div class="form-row">
        <div class="form-group"><label>Medical History / Previous Injury</label>
          <textarea id="fit-history" rows="3">${escapeHtml(x?.history||'')}</textarea>
        </div>
        <div class="form-group"><label>Heart and lung findings</label>
          <textarea id="fit-cardio" rows="3" placeholder="Details for any Yes answer, auscultation, etc.">${escapeHtml(saved.notes)}</textarea>
        </div>
      </div>

      <div class="form-group"><label>Musculoskeletal / Physical Examination Findings</label>
        <textarea id="fit-exam" rows="3">${escapeHtml(x?.examFindings||'')}</textarea><p class="registration-field-error" id="fit-exam-error" aria-live="polite" hidden></p>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Decision</label>
          <select id="fit-decision" ${bindAction('change',()=>syncFitnessScreening())}>
            <option value="">No decision yet (save as in progress)</option>
            ${['Fit to Compete','Fit with Restrictions','Not Fit to Compete'].map(v=>`<option value="${v}" ${x?.decision===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Restrictions / Recommendations</label>
          <textarea id="fit-restrict" rows="3" placeholder="Required for Fit with Restrictions and Not Fit; for warning signs, note the further evaluation">${escapeHtml(x?.restrictions||'')}</textarea><p class="registration-field-error" id="fit-restrict-error" aria-live="polite" hidden></p>
        </div>
      </div>

      <p class="form-note">The attending doctor is responsible for the final clearance. A clearance is valid for one year from the assessment date.</p>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" id="fit-save-btn" ${bindAction('click',(event,element)=>{saveFitnessAssessment((id||'null'))})}>
        ${x?.decision?'Update Assessment':'Save Assessment'}
      </button>
    </div>
  </div>`);
  syncFitnessScreening();
}

function screeningAnswers(){
  return Object.fromEntries(screening.SCREENING_QUESTIONS.map(([key])=>[key,document.querySelector(`input[name="fit-q-${key}"]:checked`)?.value||'']));
}
export function syncFitnessScreening(){
  const warning=document.getElementById('fit-screen-warning');if(!warning)return;
  const positive=screening.positiveScreening(screeningAnswers());
  warning.hidden=!positive.length;
  warning.innerHTML=positive.length?`<i class="bi bi-exclamation-octagon" aria-hidden="true"></i> <strong>Warning signs:</strong> ${positive.map(escapeHtml).join('; ')}. Evaluate further (e.g. ECG or referral) before clearing.`:'';
}

export function filterFitnessPatients(q=''){
  const box=document.getElementById('fit-patient-results');if(!box)return;
  const term=String(q||'').trim().toLowerCase();

  if(!term){
    box.innerHTML='';
    box.classList.remove('show');
    return;
  }

  const source=appState.auth.currentUser?._realSupabase?appState.data.DB.patients.filter(p=>p._realSupabase):appState.data.DB.patients;
  const matches=source
    .filter(p=>!p.archived)
    .filter(p=>`${p.fname} ${p.lname} ${p.idNo||''} ${p.college||''}`.toLowerCase().includes(term))
    .slice(0,15);

  box.innerHTML=matches.length
    ? matches.map(p=>`<button type="button" class="patient-combobox-option" ${bindAction('click',(event,element)=>{selectFitnessPatient((p.id))})}>
        <strong>${escapeHtml(p.fname+' '+p.lname)}</strong><br>
        <span class="text-muted">${escapeHtml(p.idNo||'No ID')} · ${escapeHtml(p.college||'No college')}</span>
      </button>`).join('')
    : `<div class="patient-combobox-option" style="cursor:default">No matching patients</div>`;

  box.classList.add('show');
}

export function selectFitnessPatient(id){
  const p=getPatientById(id);
  const hidden=document.getElementById('fit-patient');
  const search=document.getElementById('fit-patient-search');
  const box=document.getElementById('fit-patient-results');
  if(!p)return;

  if(hidden)hidden.value=String(id);
  if(search)search.value=`${p.fname} ${p.lname} · ${p.idNo||'No ID'} · ${p.college||''}`;
  if(box){
    box.innerHTML='';
    box.classList.remove('show');
  }
}

export async function saveFitnessAssessment(id){
  const patientId=parseInt(document.getElementById('fit-patient')?.value||'');
  const sport=document.getElementById('fit-sport-a').value.trim();
  const eventDate=document.getElementById('fit-event-date-a').value;
  const assessmentDate=document.getElementById('fit-date').value||appState.clinicInformation.TODAY;
  const doctorId=parseInt(document.getElementById('fit-doctor').value)||appState.auth.currentUser.id;
  const decision=document.getElementById('fit-decision').value;
  const restrictions=document.getElementById('fit-restrict').value.trim();
  const msg=document.getElementById('fit-assess-msg');
  const btn=document.getElementById('fit-save-btn');
  hideAlert(msg);

  const vitals={
    bp:document.getElementById('fit-bp').value.trim(),
    hr:document.getElementById('fit-hr').value.trim(),
    height:document.getElementById('fit-height').value.trim(),
    weight:document.getElementById('fit-weight').value.trim()
  };
  const answers=screeningAnswers();
  const examFindings=document.getElementById('fit-exam').value.trim();
  const errors=screening.fitnessAssessmentErrors({patientId,sport,eventDate,assessmentDate,decision,restrictions,examFindings,answers,vitals},appState.clinicInformation.TODAY);
  const fieldIds={patient:'fit-patient',sport:'fit-sport-a',eventDate:'fit-event-date-a',date:'fit-date',bp:'fit-bp',hr:'fit-hr',height:'fit-height',weight:'fit-weight',screening:'fit-screening',exam:'fit-exam',restrictions:'fit-restrict'};
  for(const id of Object.values(fieldIds)){const el=document.getElementById(id+'-error');if(el){el.hidden=true;el.textContent='';}}
  if(Object.keys(errors).length){
    for(const [key,message] of Object.entries(errors)){const el=document.getElementById(fieldIds[key]+'-error');if(el){el.textContent=message;el.hidden=false;}}
    document.querySelector('.modal .registration-field-error:not([hidden])')?.scrollIntoView({block:'center',behavior:'smooth'});
    return;
  }
  const cardioResp=screening.encodeScreening(answers,document.getElementById('fit-cardio').value);

  const pt=getPatientById(patientId);
  const doc=getUserById(doctorId);
  if(!pt||!doc){
    showAlert(msg,'Patient or attending doctor could not be loaded.');
    return;
  }

  const existing=id?fitnessRecords().find(x=>x.id===Number(id)):null;
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving securely…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      if(!pt._realSupabase||!doc._realSupabase)
        throw new Error('Select real CampusCare patient and doctor records.');

      await fitnessAction({
        action:'assess',
        assessment_id:existing?.dbAssessmentId||null,
        patient_id:pt.dbPatientId,
        doctor_id:doc.dbUserId,
        sport_event:sport,
        event_date:eventDate||null,
        assessment_date:assessmentDate,
        vitals,
        medical_history:document.getElementById('fit-history').value.trim(),
        cardio_respiratory_findings:cardioResp,
        examination_findings:document.getElementById('fit-exam').value.trim(),
        decision:decision||'',
        restrictions,
        request_notes:existing?.notes||''
      });

      await syncRealFitnessAssessments();
    }else{
      const rec=existing||{
        id:appState.data.DB.nextFitnessId++,
        requestedDate:appState.clinicInformation.TODAY,
        createdAt:new Date().toISOString()
      };

      rec.patientId=patientId;
      rec.sport=sport;
      rec.eventDate=eventDate;
      rec.date=assessmentDate;
      rec.doctorId=doctorId;
      rec.vitals=vitals;
      rec.history=document.getElementById('fit-history').value.trim();
      rec.cardioResp=cardioResp;
      rec.examFindings=document.getElementById('fit-exam').value.trim();
      rec.decision=decision;
      rec.restrictions=restrictions;
      rec.status=decision?'Completed':'In Assessment';
      rec.updatedAt=new Date().toISOString();

      if(!existing)appState.data.DB.fitnessAssessments.push(rec);
      auditLog(existing?'FITNESS_ASSESSMENT_UPDATED':'FITNESS_ASSESSMENT_CREATED',
        `${rec.sport||'Sports'} assessment · ${rec.decision||'pending decision'}.`,
        'FitnessAssessment',rec.id);
      persistDB();
    }

    closeAllModals();
    toast(decision?'Fitness assessment completed.':'Fitness assessment saved as in progress.','success');
    await renderFitnessAssessments();
  }catch(e){
    showAlert(msg,e?.message||'Unable to save fitness assessment.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||'Save Assessment';
    }
  }
}

export function viewFitnessAssessment(id){
  const x=fitnessRecords().find(r=>r.id===Number(id));if(!x)return;
  const p=getPatientById(x.patientId),d=getUserById(x.doctorId);

  openModal(`<div class="modal modal-lg">
    <div class="modal-header">
      <h3>Fitness-to-Compete Assessment #${fitnessDisplayId(x)}</h3>
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
    </div>
    <div class="modal-body">
      <div class="info-row"><div class="info-label">Patient</div><div class="info-val">${p?escapeHtml(p.fname+' '+p.lname):'—'}</div></div>
      <div class="info-row"><div class="info-label">Sport / Event</div><div class="info-val">${escapeHtml(x.sport||'—')}</div></div>
      <div class="info-row"><div class="info-label">Event Date</div><div class="info-val">${x.eventDate?fmtDate(x.eventDate):'—'}</div></div>
      <div class="info-row"><div class="info-label">Requested</div><div class="info-val">${x.requestedDate?fmtDateTime(x.requestedDate):'—'}</div></div>
      <div class="info-row"><div class="info-label">Assessment Date</div><div class="info-val">${x.date?fmtDate(x.date):'—'}</div></div>
      <div class="info-row"><div class="info-label">Doctor</div><div class="info-val">${d?escapeHtml(docName(d)):'Pending assignment'}</div></div>
      <div class="info-row"><div class="info-label">Status</div><div class="info-val">${fitnessStatusBadge(x.status)}</div></div>
      <div class="info-row"><div class="info-label">Decision</div><div class="info-val">${fitnessDecisionBadge(x.decision)}</div></div>

      ${x.notes?`<hr class="divider"><div class="section-label">Patient Request Notes</div><p style="font-size:.8rem;line-height:1.55">${escapeHtml(x.notes)}</p>`:''}

      <hr class="divider">
      <div class="section-label">Vitals</div>
      <p class="text-muted">
        BP: ${escapeHtml(x.vitals?.bp||'—')} ·
        Heart rate: ${escapeHtml(x.vitals?.hr||'—')} ·
        Height: ${escapeHtml(x.vitals?.height||'—')} ·
        Weight: ${escapeHtml(x.vitals?.weight||'—')}
      </p>
      ${(()=>{const s=screening.decodeScreening(x.cardioResp||''),answered=Object.keys(s.answers).length,positive=screening.positiveScreening(s.answers);
        return `<div class="section-label" style="margin-top:.7rem">Screening</div>
        <p style="font-size:.8rem;line-height:1.55">${answered?(positive.length?`<span class="text-danger"><strong>Warning signs:</strong> ${positive.map(escapeHtml).join('; ')}</span>`:'No warning signs reported.'):'Not recorded.'}</p>
        <div class="section-label" style="margin-top:.7rem">Medical history and heart/lung findings</div>
        <p style="font-size:.8rem;line-height:1.55">${escapeHtml(x.history||'—')}${s.notes?`<br>${escapeHtml(s.notes)}`:''}</p>`;})()}

      <div class="section-label" style="margin-top:.7rem">Physical Examination</div>
      <p style="font-size:.8rem;line-height:1.55">${escapeHtml(x.examFindings||'—')}</p>

      <div class="section-label" style="margin-top:.7rem">Restrictions / Recommendations</div>
      <p style="font-size:.8rem;line-height:1.55">${escapeHtml(x.restrictions||'None recorded.')}</p>
      ${screening.clearanceState(x,appState.clinicInformation.TODAY)?`<div class="section-label" style="margin-top:.7rem">Clearance</div><p style="font-size:.8rem">${screening.clearanceState(x,appState.clinicInformation.TODAY)==='expired'?'<span class="text-danger">Expired</span>':'Valid'} until ${fmtDate(screening.clearanceValidUntil(x.date))}</p>`:''}
    </div>
    <div class="modal-footer">
      ${appState.auth.currentUser.role==='Doctor'&&(!x.doctorId||x.doctorId===appState.auth.currentUser.id)&&x.status!=='Cancelled'
        ? `<button class="btn btn-info" ${bindAction('click',(event,element)=>{closeAllModals();openFitnessAssessmentModal((x.id))})}>${x.decision?'Edit Assessment':'Assess Patient'}</button>`
        : ''}
      ${appState.auth.currentUser.role==='Doctor'&&x.doctorId===appState.auth.currentUser.id&&['Fit to Compete','Fit with Restrictions'].includes(x.decision)&&screening.clearanceState(x,appState.clinicInformation.TODAY)==='valid'
        ? `<button class="btn" ${bindAction('click',()=>{closeAllModals();openNewCertificateModal(x.patientId,null,{purpose:'Sports / Athletics Participation',event:x.sport,fitness:x.decision==='Fit to Compete'?'Fit':'Fit with restrictions',restrictions:x.restrictions,findings:[x.examFindings,`Fitness-to-compete assessment of ${fmtDate(x.date)}: ${x.decision}.`].filter(Boolean).join(' ')})})}><i class="bi bi-file-earmark-medical" aria-hidden="true"></i> Issue Certificate</button>`
        : ''}
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
    </div>
  </div>`);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
