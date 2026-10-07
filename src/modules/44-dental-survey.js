// ================================================================
// DENTAL CLINIC PATIENT SURVEY / CLIENT SATISFACTION MEASUREMENT
// Based on the paper survey and CSM forms provided from the clinic.
// ================================================================
function clinicSurveyRecords(){
  if(!Array.isArray(DB.clinicSurveys))DB.clinicSurveys=[];
  return DB.clinicSurveys;
}

function completedDentalSurveyAppointments(){
  if(!currentUser||currentUser.role!=='Patient'||!currentPatient)return [];

  const surveyedAppointmentIds=new Set(
    clinicSurveyRecords()
      .filter(s=>s.patientId===currentPatient.id&&s.appointmentId)
      .map(s=>Number(s.appointmentId))
  );

  return appointmentRecords()
    .filter(a=>
      a.patientId===currentPatient.id &&
      a.clinic==='Dental Clinic' &&
      a.status==='Completed' &&
      !surveyedAppointmentIds.has(Number(a.id))
    )
    .sort((a,b)=>
      String(b.date).localeCompare(String(a.date)) ||
      String(b.time).localeCompare(String(a.time))
    );
}

function canShowDentalSurveyNav(){
  return currentUser?.role==='Patient' && completedDentalSurveyAppointments().length>0;
}

function shouldShowNavItem(item){
  if(!item?.id)return true;
  if(item.id==='dental-survey')return canShowDentalSurveyNav();
  return true;
}

function rebuildConditionalNavigation(){
  if(!currentUser)return;
  const active=campusActivePageId;
  buildNav();
  const btn=document.getElementById(`nav-${active}`);
  if(btn)btn.classList.add('active');
  applyNavBadges();
}

async function surveyAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');
  const response=await fetch(`${SUPABASE_URL}/functions/v1/survey-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Survey action failed.');
  return result;
}

async function syncClinicSurveys(){
  if(!currentUser?._realSupabase)return clinicSurveyRecords();
  const result=await surveyAction({action:'list'});
  DB.clinicSurveys=(result.surveys||[]).map(s=>({
    id:Number(s.survey_id),
    patientId:s.patient_id?200000+Number(s.patient_id):null,
    appointmentId:s.appointment_id?300000+Number(s.appointment_id):null,
    groupType:s.group_type||'',
    department:s.department||'',
    service:s.service_availed||'',
    visitFrequency:s.visit_frequency||'',
    heardFrom:s.heard_from||'',
    ratings:s.ratings||{},
    citizensCharter:s.citizens_charter||{},
    sqd:s.sqd||{},
    suggestions:s.suggestions||'',
    email:s.respondent_email||'',
    patient:s.patient||null,
    createdAt:s.created_at||'',
    _realSupabase:true
  }));
  return DB.clinicSurveys;
}

function surveySelect(id,label,options,value=''){
  return `<div class="form-group"><label>${escapeHtml(label)}</label><select id="${id}">
    <option value="">Select</option>
    ${options.map(o=>`<option value="${escapeHtml(o)}" ${o===value?'selected':''}>${escapeHtml(o)}</option>`).join('')}
  </select></div>`;
}

function surveyRatingHtml(key,label,allowNA=false){
  const values=[
    ['5','Excellent / Strongly Agree'],
    ['4','Very Good / Agree'],
    ['3','Good / Neither Agree nor Disagree'],
    ['2','Fair / Disagree'],
    ['1','Poor / Strongly Disagree']
  ];
  return `<div class="survey-question"><label>${escapeHtml(label)}</label>
    <div class="survey-scale">
      ${values.map(([v,t])=>`<label><input type="radio" name="${key}" value="${v}"><span>${escapeHtml(t)}</span></label>`).join('')}
      ${allowNA?`<label><input type="radio" name="${key}" value="NA"><span>N/A</span></label>`:''}
    </div>
  </div>`;
}

function selectedRadio(name){
  return document.querySelector(`input[name="${name}"]:checked`)?.value||'';
}

async function renderDentalSurvey(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();

  if(currentUser.role!=='Patient'){
    c.innerHTML='<div class="alert alert-warning show">The patient survey is available to Patient accounts.</div>';
    return;
  }

  if(currentUser?._realSupabase){
    showDatabaseSkeleton('card');
    try{
      await Promise.all([syncClinicSurveys(),syncRealAppointments()]);
    }catch(e){
      if(!isCampusPageCurrent('dental-survey',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load the survey.')}</div>`;
      return;
    }
    if(!isCampusPageCurrent('dental-survey',pageToken))return;
  }

  const pt=currentPatient;
  const surveys=clinicSurveyRecords().filter(s=>!pt||s.patientId===pt.id||!s.patientId);
  const dentalAppts=completedDentalSurveyAppointments();

  if(!dentalAppts.length){
    rebuildConditionalNavigation();
    c.innerHTML=`<div class="card"><div class="empty-state">
      <i class="bi bi-ui-checks-grid" style="font-size:1.6rem;color:var(--primary)"></i>
      <h3 style="margin:.6rem 0 .25rem">Survey becomes available after a completed dental service</h3>
      <p>CampusCare only opens the Dental Clinic Survey after the clinic marks a Dental Clinic appointment as Completed. Each completed appointment can be surveyed once.</p>
    </div></div>`;
    return;
  }

  const groupDefault=pt?.personType==='Student'?'Student':'Organic Personnel';

  c.innerHTML=`
    <div class="survey-layout">
      <div class="card">
        <div class="card-header"><div><h3>Dental Clinic Patient Survey</h3>
          <div class="text-muted">Digital version based on the clinic's Patient Survey Form and Client Satisfaction Measurement (CSM).</div></div></div>
        <div style="padding:.85rem">
          <div id="survey-msg"></div>
          <div class="alert alert-info show" style="font-size:.7rem">
            Your feedback is used for service improvement. Survey information is handled under the clinic's Data Privacy Statement and CampusCare privacy controls.
          </div>

          <div class="survey-section">
            <h4>Visit Information</h4>
            <div class="form-row">
              <div class="form-group"><label>Completed Dental Service <span class="required">*</span></label>
                <select id="survey-appt">
                  ${dentalAppts.map(a=>`<option value="${a.id}">${fmtDate(a.date)} · ${escapeHtml(a.service)} · ${fmtTime(a.time)}</option>`).join('')}
                </select>
                <p class="form-note">Only completed Dental Clinic appointments that have not already been surveyed are listed.</p>
              </div>
              ${surveySelect('survey-group','Which group do you belong to?',['Student','Organic Personnel','In-organic Personnel'],groupDefault)}
            </div>
            <div class="form-row">
              <div class="form-group"><label>Department / College</label><input id="survey-dept" maxlength="180" value="${escapeHtml(pt?.college||'')}" placeholder="e.g. CCICT"></div>
              ${surveySelect('survey-service','What service/s did you avail?',['Consultation','Restorative','Surgery','Oral Prophylaxis','Oral Examination'])}
            </div>
            <div class="form-row">
              ${surveySelect('survey-frequency','How often do you visit your dentist?',['At least once a year','Twice a year','As necessary','Do not visit'])}
              ${surveySelect('survey-heard','How did you hear about us?',['School','Teacher','Classmate / Schoolmate','Facebook Page'])}
            </div>
          </div>

          <div class="survey-section" style="margin-top:.7rem">
            <h4>Dental Clinic Rating</h4>
            ${surveyRatingHtml('rate-quality','Quality of dental treatment')}
            ${surveyRatingHtml('rate-accuracy','Accuracy and completeness in dental care')}
            ${surveyRatingHtml('rate-info','Clear dental health information')}
            ${surveyRatingHtml('rate-friendly','Friendly and courteous staff')}
            ${surveyRatingHtml('rate-services','Offers all services required for the treatment')}
            ${surveyRatingHtml('rate-overall','Overall Rating')}
          </div>

          <div class="survey-section" style="margin-top:.7rem">
            <h4>Citizen's Charter</h4>
            <div class="form-row">
              ${surveySelect('survey-cc1','CC1. Do you know about the Citizen’s Charter?',['Yes, I know and I saw this office’s CC','Yes, I know but I did NOT see this office’s CC','No, I only knew about it when I saw this office’s CC','No, I do not know and I did not see one in this office'])}
              ${surveySelect('survey-cc2','CC2. If yes, did you see this office’s Citizen’s Charter?',['Yes, it was easy to see','Yes, somewhat easy to see','No, it is difficult to see','No, it is not visible at all','N/A'])}
            </div>
            ${surveySelect('survey-cc3','CC3. If yes, how much did the Citizen’s Charter help in your transaction?',['Yes, it helped me very much','Yes, it somewhat helped','No, it did not help at all','N/A'])}
          </div>

          <div class="survey-section" style="margin-top:.7rem">
            <h4>Client Satisfaction Measurement</h4>
            ${surveyRatingHtml('sqd0','SQD0. I am satisfied with the service.')}
            ${surveyRatingHtml('sqd1','SQD1. I spent a reasonable amount of time for my transaction.')}
            ${surveyRatingHtml('sqd2','SQD2. The office followed the transaction’s requirements and steps based on the information provided.')}
            ${surveyRatingHtml('sqd3','SQD3. The steps I needed to do for my transaction were easy and simple.')}
            ${surveyRatingHtml('sqd4','SQD4. I easily found information about my transaction from the office or its website.')}
            ${surveyRatingHtml('sqd5','SQD5. I paid a reasonable amount of fees for my transaction.',true)}
            ${surveyRatingHtml('sqd6','SQD6. I feel the office was fair to all or had no favoritism.')}
            ${surveyRatingHtml('sqd7','SQD7. The staff treated me courteously and were helpful.')}
            ${surveyRatingHtml('sqd8','SQD8. I got what I needed from the office, or if denied, I was sufficiently provided an explanation.')}
          </div>

          <div class="survey-section" style="margin-top:.7rem">
            <h4>Suggestions</h4>
            <div class="form-group"><label>How can we serve you better?</label><textarea id="survey-suggestions" rows="3" maxlength="3000" placeholder="Optional"></textarea></div>
            <div class="form-group"><label>Email address</label><input id="survey-email" type="email" maxlength="255" value="${escapeHtml(currentUser.email||'')}"></div>
          </div>

          <div style="display:flex;justify-content:flex-end;margin-top:.75rem">
            <button class="btn btn-primary" onclick="submitDentalSurvey()"><i class="bi bi-send"></i> Submit Survey</button>
          </div>
        </div>
      </div>

      <div>
        <div class="card"><div class="card-header"><h3>Your Previous Surveys</h3></div><div style="padding:.75rem">
          ${surveys.length?surveys.map(s=>`<div class="survey-history-card">
            <strong>${escapeHtml(s.service||'Dental Clinic Survey')}</strong><br>
            <span>${s.createdAt?fmtDateTime(s.createdAt):'Submitted'}${s.ratings?.overall?` · Overall ${escapeHtml(String(s.ratings.overall))}/5`:''}</span>
          </div>`).join(''):'<div class="empty-state"><p>No survey submissions yet.</p></div>'}
        </div></div>
      </div>
    </div>`;
}

async function submitDentalSurvey(){
  const msg=document.getElementById('survey-msg');
  const ratings={
    quality:selectedRadio('rate-quality'),
    accuracy:selectedRadio('rate-accuracy'),
    information:selectedRadio('rate-info'),
    friendly:selectedRadio('rate-friendly'),
    services:selectedRadio('rate-services'),
    overall:selectedRadio('rate-overall')
  };
  const sqd={};
  for(let i=0;i<=8;i++)sqd[`sqd${i}`]=selectedRadio(`sqd${i}`);

  if(!ratings.overall){
    showAlert(msg,'Please provide an Overall Rating before submitting the survey.');
    return;
  }

  const apptId=Number(document.getElementById('survey-appt')?.value||0);
  const surveyAppt=apptId?completedDentalSurveyAppointments().find(a=>a.id===apptId):null;
  if(!surveyAppt){
    showAlert(msg,'This survey requires a completed Dental Clinic service that has not already been surveyed.');
    rebuildConditionalNavigation();
    return;
  }
  const payload={
    action:'submit',
    appointment_id:apptId?(surveyAppt?.dbAppointmentId||apptId):null,
    group_type:document.getElementById('survey-group')?.value||'',
    department:document.getElementById('survey-dept')?.value||'',
    service_availed:document.getElementById('survey-service')?.value||'',
    visit_frequency:document.getElementById('survey-frequency')?.value||'',
    heard_from:document.getElementById('survey-heard')?.value||'',
    ratings,
    citizens_charter:{
      cc1:document.getElementById('survey-cc1')?.value||'',
      cc2:document.getElementById('survey-cc2')?.value||'',
      cc3:document.getElementById('survey-cc3')?.value||''
    },
    sqd,
    suggestions:document.getElementById('survey-suggestions')?.value||'',
    respondent_email:document.getElementById('survey-email')?.value||''
  };

  try{
    if(currentUser?._realSupabase){
      await surveyAction(payload);
      await syncClinicSurveys();
    }else{
      const next=(clinicSurveyRecords().reduce((m,s)=>Math.max(m,Number(s.id)||0),0)+1);
      clinicSurveyRecords().push({
        id:next,
        patientId:currentPatient?.id||null,
        appointmentId:apptId||null,
        groupType:payload.group_type,
        department:payload.department,
        service:payload.service_availed,
        visitFrequency:payload.visit_frequency,
        heardFrom:payload.heard_from,
        ratings,
        citizensCharter:payload.citizens_charter,
        sqd,
        suggestions:payload.suggestions,
        email:payload.respondent_email,
        createdAt:new Date().toISOString()
      });
      persistDB();
    }
    toast('Thank you. Your dental clinic survey was submitted.','success');
    rebuildConditionalNavigation();
    if(completedDentalSurveyAppointments().length){
      await renderDentalSurvey();
    }else{
      navTo('dashboard');
    }
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit the survey.');
  }
}

function averageNumeric(values){
  const nums=values.map(Number).filter(n=>Number.isFinite(n)&&n>0);
  return nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:0;
}

async function renderSurveyResults(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(!['Staff','Administrator'].includes(currentUser.role)){
    c.innerHTML='<div class="alert alert-warning show">Survey results are available to Staff and Administrators.</div>';
    return;
  }

  if(currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncClinicSurveys();}
    catch(e){
      if(!isCampusPageCurrent('survey-results',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load survey results.')}</div>`;
      return;
    }
    if(!isCampusPageCurrent('survey-results',pageToken))return;
  }

  const rows=clinicSurveyRecords().slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const avgOverall=averageNumeric(rows.map(r=>r.ratings?.overall));
  const avgSatisfaction=averageNumeric(rows.map(r=>r.sqd?.sqd0));
  const services={};
  rows.forEach(r=>{if(r.service)services[r.service]=(services[r.service]||0)+1;});
  const topService=Object.entries(services).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';

  c.innerHTML=`
    <div class="survey-stats">
      <div class="survey-stat"><strong>${rows.length}</strong><span>Total Survey Responses</span></div>
      <div class="survey-stat"><strong>${avgOverall?avgOverall.toFixed(2):'—'}</strong><span>Average Dental Rating / 5</span></div>
      <div class="survey-stat"><strong>${avgSatisfaction?avgSatisfaction.toFixed(2):'—'}</strong><span>Average SQD0 Satisfaction / 5</span></div>
    </div>

    <div class="card">
      <div class="card-header"><div><h3>Dental Clinic Survey Results</h3><div class="text-muted">Top service: ${escapeHtml(topService)}</div></div>
        <button class="btn btn-sm" onclick="renderSurveyResults()"><i class="bi bi-arrow-clockwise"></i> Refresh</button></div>
      ${rows.length?`<div class="table-wrap"><table><thead><tr>
        <th>Date</th><th>Respondent</th><th>Group</th><th>Service</th><th>Overall</th><th>SQD0</th><th>Suggestion</th>
      </tr></thead><tbody>${rows.map(r=>{
        const patient=r.patient;
        const name=patient?`${patient.first_name||''} ${patient.last_name||''}`.trim():'Patient';
        return `<tr><td>${r.createdAt?fmtDateTime(r.createdAt):'—'}</td><td>${escapeHtml(name||'Patient')}</td>
          <td>${escapeHtml(r.groupType||'—')}</td><td>${escapeHtml(r.service||'—')}</td>
          <td>${escapeHtml(String(r.ratings?.overall||'—'))}</td><td>${escapeHtml(String(r.sqd?.sqd0||'—'))}</td>
          <td>${escapeHtml(r.suggestions||'—')}</td></tr>`;
      }).join('')}</tbody></table></div>`:'<div class="empty-state"><p>No survey responses yet.</p></div>'}
    </div>

    ${rows.some(r=>r.suggestions)?`<div class="card" style="margin-top:.8rem"><div class="card-header"><h3>Recent Suggestions</h3></div><div style="padding:.75rem">${rows.filter(r=>r.suggestions).slice(0,8).map(r=>`<div class="survey-comment">${escapeHtml(r.suggestions)}</div>`).join('')}</div></div>`:''}`;
}
