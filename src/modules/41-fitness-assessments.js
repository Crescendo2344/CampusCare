// ================================================================
// FITNESS-TO-COMPETE ASSESSMENT — REAL SUPABASE WORKFLOW
// ================================================================
function fitnessRecords(){
  if(currentUser?._realSupabase)return (DB.fitnessAssessments||[]).filter(x=>x._realSupabase);
  return DB.fitnessAssessments||[];
}

function fitnessDisplayId(x){
  const id=Number(x?.dbAssessmentId??x?.id??0);
  return String(id).padStart(6,'0');
}

function fitnessDecisionBadge(d){
  const cls=d==='Fit to Compete'?'badge-success':d==='Fit with Restrictions'?'badge-warning':d==='Not Fit to Compete'?'badge-danger':'badge-gray';
  return `<span class="badge ${cls}">${escapeHtml(d||'Pending Assessment')}</span>`;
}

function fitnessStatusBadge(s){
  const cls=s==='Completed'?'badge-success':s==='In Assessment'?'badge-info':s==='Cancelled'?'badge-gray':'badge-warning';
  return `<span class="badge ${cls}">${escapeHtml(s||'Requested')}</span>`;
}

async function fitnessAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/fitness-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Fitness assessment action failed.');
  return result;
}

function realFitnessToUi(r){
  return {
    id:800000+Number(r.assessment_id),
    dbAssessmentId:Number(r.assessment_id),
    patientId:200000+Number(r.patient_id),
    dbPatientId:Number(r.patient_id),
    doctorId:r.doctor_id?100000+Number(r.doctor_id):null,
    dbDoctorId:r.doctor_id?Number(r.doctor_id):null,
    sport:r.sport_event||'',
    eventDate:r.event_date||'',
    date:r.assessment_date||'',
    vitals:r.vitals||{},
    history:r.medical_history||'',
    cardioResp:r.cardio_respiratory_findings||'',
    examFindings:r.examination_findings||'',
    decision:r.decision||'',
    restrictions:r.restrictions||'',
    notes:r.request_notes||'',
    status:r.status||'Requested',
    requestedDate:r.requested_at||'',
    completedAt:r.completed_at||'',
    updatedAt:r.updated_at||'',
    _realSupabase:true
  };
}

async function syncRealFitnessAssessments(){
  if(!currentUser?._realSupabase)return fitnessRecords();

  const {data,error}=await supabaseClient
    .from('fitness_assessments')
    .select('assessment_id,patient_id,doctor_id,sport_event,event_date,assessment_date,vitals,medical_history,cardio_respiratory_findings,examination_findings,decision,restrictions,status,request_notes,requested_at,completed_at,updated_at')
    .order('requested_at',{ascending:false})
    .order('assessment_id',{ascending:false});

  if(error)throw error;

  DB.fitnessAssessments=(DB.fitnessAssessments||[]).filter(x=>!x._realSupabase);
  DB.fitnessAssessments.push(...(data||[]).map(realFitnessToUi));
  return fitnessRecords();
}

async function syncFitnessContext(){
  if(!currentUser?._realSupabase)return;

  if(['Administrator','Staff','Doctor'].includes(currentUser.role)){
    await syncAdminDirectoryFromSupabase();
  }else if(currentUser.role==='Patient'){
    if(!currentPatient||!currentPatient._realSupabase)await syncCurrentPatientFromSupabase();
  }

  await syncRealFitnessAssessments();
}

async function renderFitnessAssessments(){
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();
  const role=currentUser.role;

  if(currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncFitnessContext();}
    catch(e){
      if(!isCampusPageCurrent('fitness',pageToken))return;
      console.error('Fitness assessment sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load fitness assessments.')}</div>
        <button class="btn btn-sm" onclick="renderFitnessAssessments()">Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('fitness',pageToken))return;
  }

  let rows=fitnessRecords().slice().sort((a,b)=>String(b.requestedDate).localeCompare(String(a.requestedDate))||b.id-a.id);
  if(role==='Patient'&&currentPatient)rows=rows.filter(x=>x.patientId===currentPatient.id);
  if(role==='Doctor')rows=rows.filter(x=>!x.doctorId||x.doctorId===currentUser.id);

  const actionButton=role==='Patient'
    ? `<button class="btn btn-primary btn-sm" onclick="openFitnessRequestModal()">+ Request Assessment</button>`
    : (role==='Doctor'||role==='Administrator'
      ? `<button class="btn btn-primary btn-sm" onclick="openFitnessAssessmentModal()">+ New Assessment</button>`
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
        const canAssess=(role==='Doctor'&&(!x.doctorId||x.doctorId===currentUser.id)&&x.status!=='Cancelled')||
                        (role==='Administrator'&&x.status!=='Cancelled');
        return `<tr style="cursor:pointer" onclick="viewFitnessAssessment(${x.id})" title="Open fitness assessment">
          <td>#${fitnessDisplayId(x)}</td>
          <td>${p?escapeHtml(p.fname+' '+p.lname):'Unknown'}</td>
          <td>${escapeHtml(x.sport||'—')}</td>
          <td>${x.eventDate?fmtDate(x.eventDate):'—'}</td>
          <td>${x.date?fmtDate(x.date):'—'}</td>
          <td>${d?escapeHtml(docName(d)):'Pending assignment'}</td>
          <td>${fitnessStatusBadge(x.status)}</td>
          <td>${fitnessDecisionBadge(x.decision)}</td>
          <td><div class="td-actions" onclick="event.stopPropagation()">
            <button class="btn btn-xs" onclick="viewFitnessAssessment(${x.id})">View</button>
            ${canAssess?`<button class="btn btn-xs btn-info" onclick="openFitnessAssessmentModal(${x.id})">${x.decision?'Edit':'Assess'}</button>`:''}
            ${role==='Patient'&&x.status==='Requested'?`<button class="btn btn-xs btn-danger" onclick="cancelFitnessRequest(${x.id})">Cancel</button>`:''}
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`:'<div class="empty-state"><p>No fitness-to-compete assessments yet.</p></div>'}
  </div>`;
}

function openFitnessRequestModal(){
  if(!currentPatient)return;
  openModal(`<div class="modal">
    <div class="modal-header">
      <h3>Request Fitness-to-Compete Assessment</h3>
      <button class="close-btn" onclick="closeAllModals()">✕</button>
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
        ${campusDateFieldHtml('fit-event-date','','Event Date',TODAY)}
      </div>
      <div class="form-group">
        <label>Notes / Relevant Concern</label>
        <textarea id="fit-notes" rows="3" maxlength="1500" placeholder="Previous injury, symptoms, event details, or other information for the clinic"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeAllModals()">Cancel</button>
      <button class="btn btn-primary" id="fit-request-btn" onclick="saveFitnessRequest()">Submit Request</button>
    </div>
  </div>`);
}

async function saveFitnessRequest(){
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
    if(currentUser?._realSupabase){
      await fitnessAction({
        action:'create',
        patient_id:currentPatient.dbPatientId,
        sport_event:sport,
        event_date:eventDate||null,
        request_notes:notes
      });
      await syncRealFitnessAssessments();
    }else{
      const rec={
        id:DB.nextFitnessId++,
        patientId:currentPatient.id,
        doctorId:null,
        sport,eventDate,notes,
        requestedDate:TODAY,date:'',
        status:'Requested',decision:'',
        createdAt:new Date().toISOString()
      };
      DB.fitnessAssessments.push(rec);
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

function cancelFitnessRequest(id){
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

function openFitnessAssessmentModal(id=null){
  const x=id?fitnessRecords().find(r=>r.id===Number(id)):null;
  const realMode=Boolean(currentUser?._realSupabase);
  const patients=(realMode?DB.patients.filter(p=>p._realSupabase):DB.patients).filter(p=>!p.archived);
  const doctors=getMedDoctors();
  const patientId=x?.patientId||'';
  const doctorId=x?.doctorId||(currentUser.role==='Doctor'?currentUser.id:(doctors[0]?.id||''));

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
          oninput="filterFitnessPatients(this.value)"
          onfocus="if(this.value.trim())filterFitnessPatients(this.value)">
        <div id="fit-patient-results" class="patient-combobox-list"></div>
      </div>`;

  const doctorField=currentUser.role==='Administrator'
    ? `<select id="fit-doctor">${doctors.map(d=>`<option value="${d.id}" ${doctorId===d.id?'selected':''}>${escapeHtml(docName(d))} · ${escapeHtml(d.specialty||'General Medicine')}</option>`).join('')}</select>`
    : `<input type="hidden" id="fit-doctor" value="${currentUser.id}">
       <input value="${escapeHtml(docName(currentUser))} · ${escapeHtml(currentUser.specialty||'General Medicine')}" disabled>`;

  openModal(`<div class="modal modal-xl">
    <div class="modal-header">
      <h3>${x?`Fitness-to-Compete Assessment #${fitnessDisplayId(x)}`:'New Fitness-to-Compete Assessment'}</h3>
      <button class="close-btn" onclick="closeAllModals()">✕</button>
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
          ${campusDateFieldHtml('fit-event-date-a',x?.eventDate||'','Event Date',TODAY)}
        </div>
        <div class="form-group"><label>Assessment Date <span class="required">*</span></label>
          ${campusDateFieldHtml('fit-date',x?.date||TODAY,'Assessment Date','',TODAY)}
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
      <button class="btn" onclick="closeAllModals()">Cancel</button>
      <button class="btn btn-primary" id="fit-save-btn" onclick="saveFitnessAssessment(${id||'null'})">
        ${x?.decision?'Update Assessment':'Save Assessment'}
      </button>
    </div>
  </div>`);
}

function filterFitnessPatients(q=''){
  const box=document.getElementById('fit-patient-results');if(!box)return;
  const term=String(q||'').trim().toLowerCase();

  if(!term){
    box.innerHTML='';
    box.classList.remove('show');
    return;
  }

  const source=currentUser?._realSupabase?DB.patients.filter(p=>p._realSupabase):DB.patients;
  const matches=source
    .filter(p=>!p.archived)
    .filter(p=>`${p.fname} ${p.lname} ${p.idNo||''} ${p.college||''}`.toLowerCase().includes(term))
    .slice(0,15);

  box.innerHTML=matches.length
    ? matches.map(p=>`<button type="button" class="patient-combobox-option" onclick="selectFitnessPatient(${p.id})">
        <strong>${escapeHtml(p.fname+' '+p.lname)}</strong><br>
        <span class="text-muted">${escapeHtml(p.idNo||'No ID')} · ${escapeHtml(p.college||'No college')}</span>
      </button>`).join('')
    : `<div class="patient-combobox-option" style="cursor:default">No matching patients</div>`;

  box.classList.add('show');
}

function selectFitnessPatient(id){
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

async function saveFitnessAssessment(id){
  const patientId=parseInt(document.getElementById('fit-patient')?.value||'');
  const sport=document.getElementById('fit-sport-a').value.trim();
  const eventDate=document.getElementById('fit-event-date-a').value;
  const assessmentDate=document.getElementById('fit-date').value||TODAY;
  const doctorId=parseInt(document.getElementById('fit-doctor').value)||currentUser.id;
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
  if(assessmentDate>TODAY){
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
    if(currentUser?._realSupabase){
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
        id:DB.nextFitnessId++,
        requestedDate:TODAY,
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

      if(!existing)DB.fitnessAssessments.push(rec);
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

function viewFitnessAssessment(id){
  const x=fitnessRecords().find(r=>r.id===Number(id));if(!x)return;
  const p=getPatientById(x.patientId),d=getUserById(x.doctorId);

  openModal(`<div class="modal modal-lg">
    <div class="modal-header">
      <h3>Fitness-to-Compete Assessment #${fitnessDisplayId(x)}</h3>
      <button class="close-btn" onclick="closeAllModals()">✕</button>
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
      ${(currentUser.role==='Doctor'&&(!x.doctorId||x.doctorId===currentUser.id)&&x.status!=='Cancelled')||
         (currentUser.role==='Administrator'&&x.status!=='Cancelled')
        ? `<button class="btn btn-info" onclick="closeAllModals();openFitnessAssessmentModal(${x.id})">${x.decision?'Edit Assessment':'Assess Patient'}</button>`
        : ''}
      <button class="btn" onclick="closeAllModals()">Close</button>
    </div>
  </div>`);
}
