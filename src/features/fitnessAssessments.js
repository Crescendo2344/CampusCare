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

  let rows=fitnessRecords().slice().sort((a,b)=>String(b.requestedDate).localeCompare(String(a.requestedDate))||b.id-a.id);
  if(role==='Patient'&&appState.auth.currentPatient)rows=rows.filter(x=>x.patientId===appState.auth.currentPatient.id);
  if(role==='Doctor')rows=rows.filter(x=>!x.doctorId||x.doctorId===appState.auth.currentUser.id);

  const actionButton=role==='Patient'
    ? `<button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{openFitnessRequestModal()})}>+ Request Assessment</button>`
    : (role==='Doctor'||role==='Administrator'
      ? `<button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{openFitnessAssessmentModal()})}>+ New Assessment</button>`
      : '');

  c.innerHTML=`<div class="card">
    <div class="card-header">
      <div>
        <h3>Fitness-to-Compete Assessments</h3>
        <div class="tech-note">Pre-participation medical assessment for sports and athletic activities. Final medical clearance is determined by the attending doctor.</div>
      </div>
      ${actionButton}
    </div>
    <div class="alert alert-info show" style="font-size:.78rem">
      🏅 <strong>Intramurals 2026–2027 clinic reminder:</strong>
      Secure your Eligibility Form from your coach, complete your personal information and sports event,
      sign the Participant's Waiver and Release Agreement, obtain the required parent/guardian and coach signatures,
      then bring the completed form to the clinic at the <strong>Ground Floor, Education Building</strong>.
      The posted clinic reminder states that students must have submitted their enrollment medical requirements to be eligible for a medical certificate.
    </div>

    ${rows.length?`<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Patient</th><th>Sport / Event</th><th>Event Date</th><th>Assessment Date</th><th>Doctor</th><th>Status</th><th>Decision</th><th>Actions</th></tr></thead>
      <tbody>${rows.map(x=>{
        const p=getPatientById(x.patientId),d=getUserById(x.doctorId);
        const canAssess=(role==='Doctor'&&(!x.doctorId||x.doctorId===appState.auth.currentUser.id)&&x.status!=='Cancelled')||
                        (role==='Administrator'&&x.status!=='Cancelled');
        return `<tr style="cursor:pointer" ${bindAction('click',(event,element)=>{viewFitnessAssessment((x.id))})} title="Open fitness assessment">
          <td>#${fitnessDisplayId(x)}</td>
          <td>${p?escapeHtml(p.fname+' '+p.lname):'Unknown'}</td>
          <td>${escapeHtml(x.sport||'—')}</td>
          <td>${x.eventDate?fmtDate(x.eventDate):'—'}</td>
          <td>${x.date?fmtDate(x.date):'—'}</td>
          <td>${d?escapeHtml(docName(d)):'Pending assignment'}</td>
          <td>${fitnessStatusBadge(x.status)}</td>
          <td>${fitnessDecisionBadge(x.decision)}</td>
          <td><div class="td-actions" ${bindAction('click',(event,element)=>{event.stopPropagation()})}>
            <button class="btn btn-xs" ${bindAction('click',(event,element)=>{viewFitnessAssessment((x.id))})}>View</button>
            ${canAssess?`<button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{openFitnessAssessmentModal((x.id))})}>${x.decision?'Edit':'Assess'}</button>`:''}
            ${role==='Patient'&&x.status==='Requested'?`<button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{cancelFitnessRequest((x.id))})}>Cancel</button>`:''}
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`:'<div class="empty-state"><p>No fitness-to-compete assessments yet.</p></div>'}
  </div>`;
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

  const doctorField=appState.auth.currentUser.role==='Administrator'
    ? `<select id="fit-doctor">${doctors.map(d=>`<option value="${d.id}" ${doctorId===d.id?'selected':''}>${escapeHtml(docName(d))} · ${escapeHtml(d.specialty||'General Medicine')}</option>`).join('')}</select>`
    : `<input type="hidden" id="fit-doctor" value="${appState.auth.currentUser.id}">
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
        <div class="form-group"><label>Patient <span class="required">*</span></label>${patientField}</div>
        <div class="form-group"><label>Sport / Event <span class="required">*</span></label>
          <input id="fit-sport-a" maxlength="255" value="${escapeHtml(x?.sport||'')}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Competition / Event Date</label>
          ${campusDateFieldHtml('fit-event-date-a',x?.eventDate||'','Event Date',appState.clinicInformation.TODAY)}
        </div>
        <div class="form-group"><label>Assessment Date <span class="required">*</span></label>
          ${campusDateFieldHtml('fit-date',x?.date||appState.clinicInformation.TODAY,'Assessment Date','',appState.clinicInformation.TODAY)}
        </div>
        <div class="form-group"><label>Attending Doctor <span class="required">*</span></label>${doctorField}</div>
      </div>

      <div class="section-label">Vitals</div>
      <div class="form-row">
        <div class="form-group"><label>Blood Pressure</label><input id="fit-bp" value="${escapeHtml(x?.vitals?.bp||'')}" placeholder="e.g. 120/80"></div>
        <div class="form-group"><label>Heart Rate</label><input id="fit-hr" value="${escapeHtml(x?.vitals?.hr||'')}" placeholder="bpm"></div>
        <div class="form-group"><label>Height</label><input id="fit-height" value="${escapeHtml(x?.vitals?.height||'')}" placeholder="cm"></div>
        <div class="form-group"><label>Weight</label><input id="fit-weight" value="${escapeHtml(x?.vitals?.weight||'')}" placeholder="kg"></div>
      </div>

      <div class="section-label">Pre-participation Review</div>
      <div class="form-row">
        <div class="form-group"><label>Medical History / Previous Injury</label>
          <textarea id="fit-history" rows="3">${escapeHtml(x?.history||'')}</textarea>
        </div>
        <div class="form-group"><label>Cardiovascular / Respiratory Symptoms</label>
          <textarea id="fit-cardio" rows="3">${escapeHtml(x?.cardioResp||'')}</textarea>
        </div>
      </div>

      <div class="form-group"><label>Musculoskeletal / Physical Examination Findings</label>
        <textarea id="fit-exam" rows="3">${escapeHtml(x?.examFindings||'')}</textarea>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Decision</label>
          <select id="fit-decision">
            <option value="">Pending Assessment</option>
            ${['Fit to Compete','Fit with Restrictions','Not Fit to Compete'].map(v=>`<option value="${v}" ${x?.decision===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Restrictions / Recommendations</label>
          <textarea id="fit-restrict" rows="3" placeholder="Required when decision is Fit with Restrictions">${escapeHtml(x?.restrictions||'')}</textarea>
        </div>
      </div>

      <div class="alert alert-info show">
        This assessment supports clinic documentation. The attending doctor remains responsible for the final medical clearance decision.
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" id="fit-save-btn" ${bindAction('click',(event,element)=>{saveFitnessAssessment((id||'null'))})}>
        ${x?.decision?'Update Assessment':'Save Assessment'}
      </button>
    </div>
  </div>`);
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

  if(!patientId){
    showAlert(msg,'Please search for and select a patient.');
    return;
  }
  if(!sport){
    showAlert(msg,'Sport or event is required.');
    return;
  }
  if(!assessmentDate){
    showAlert(msg,'Assessment date is required.');
    return;
  }
  if(assessmentDate>appState.clinicInformation.TODAY){
    showAlert(msg,'Assessment date cannot be in the future.');
    return;
  }
  if(decision==='Fit with Restrictions'&&!restrictions){
    showAlert(msg,'Enter the restrictions or recommendations for a patient who is fit with restrictions.');
    return;
  }

  const pt=getPatientById(patientId);
  const doc=getUserById(doctorId);
  if(!pt||!doc){
    showAlert(msg,'Patient or attending doctor could not be loaded.');
    return;
  }

  const vitals={
    bp:document.getElementById('fit-bp').value.trim(),
    hr:document.getElementById('fit-hr').value.trim(),
    height:document.getElementById('fit-height').value.trim(),
    weight:document.getElementById('fit-weight').value.trim()
  };

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
        cardio_respiratory_findings:document.getElementById('fit-cardio').value.trim(),
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
      rec.cardioResp=document.getElementById('fit-cardio').value.trim();
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

      <div class="section-label" style="margin-top:.7rem">Medical History / Symptoms</div>
      <p style="font-size:.8rem;line-height:1.55">${escapeHtml(x.history||'—')}<br>${escapeHtml(x.cardioResp||'')}</p>

      <div class="section-label" style="margin-top:.7rem">Physical Examination</div>
      <p style="font-size:.8rem;line-height:1.55">${escapeHtml(x.examFindings||'—')}</p>

      <div class="section-label" style="margin-top:.7rem">Restrictions / Recommendations</div>
      <p style="font-size:.8rem;line-height:1.55">${escapeHtml(x.restrictions||'None recorded.')}</p>
    </div>
    <div class="modal-footer">
      ${(appState.auth.currentUser.role==='Doctor'&&(!x.doctorId||x.doctorId===appState.auth.currentUser.id)&&x.status!=='Cancelled')||
         (appState.auth.currentUser.role==='Administrator'&&x.status!=='Cancelled')
        ? `<button class="btn btn-info" ${bindAction('click',(event,element)=>{closeAllModals();openFitnessAssessmentModal((x.id))})}>${x.decision?'Edit Assessment':'Assess Patient'}</button>`
        : ''}
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
    </div>
  </div>`);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
