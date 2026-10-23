// patientForm: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {getUserById} from './documentScanner.js';
import {hideAlert,showAlert,showConfirmDialog,toast} from './theme.js';
import {ageFromBirthDate,patientAction,patientDisplayId,patientMeasurementNumber,syncAdminDirectoryFromSupabase} from './patientService.js';
import {closeAllModals,openModal} from './modals.js';
import {assistedFile,campusDateFieldHtml,openAssistedPatientCamera,restoreAssistedPatientDraft} from './datePicker.js';
import {escapeHtml} from './issueReports.js';
import {openPrivacyNotice} from './loginLockout.js';
import {persistDB} from './persistence.js';
import {patientAvatarHtml,renderPatients} from './patientManagement.js';
import {syncRealTreatments,treatmentRecords} from './treatmentService.js';
import {appointmentRecords} from './appointmentService.js';
import {collegeBadge,fmtDate,fmtTime,priorityBadge,statusBadge} from './inputValidation.js';
import {docName} from './messaging.js';
import {downloadPatientFHIR,openClinicalCopilot,viewPatientFHIR} from './inventoryService.js';
import {bindAction,patientData} from '../dependencies.js';
import {fitnessRecords} from './fitnessAssessments.js';
// ── Patient Modal ──
export function openPatientModal(id=null){
  const pt=id?appState.data.DB.patients.find(p=>p.id===Number(id)):null;
  const account=pt?.userId?getUserById(pt.userId):null;
  const realMode=Boolean(appState.auth.currentUser?._realSupabase);
  const editing=Boolean(pt);

  if(editing&&pt.archived){
    toast('Restore the patient record before editing it.','warning');
    return;
  }

  if(!editing){
    appState.datePicker.assistedProfile='';
    appState.datePicker.assistedIdCor='';
  }

  const birthDate=pt?.birthDate||'';
  const height=patientMeasurementNumber(pt?.height);
  const weight=patientMeasurementNumber(pt?.weight);

  openModal(`<div class="modal modal-lg">
    <div class="modal-header"><h3>${editing?'Edit Patient Record':'Clinic-Assisted Patient Registration'}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="ptm-msg"></div>

      ${!editing?`<div class="alert alert-info show" style="font-size:.78rem">
        <strong>Assisted registration:</strong> Clinic staff verifies the patient's identity in person, presents the CampusCare Privacy Notice,
        records the patient's acknowledgement during registration, creates the active account, and sends a password-setup link to the patient's email.
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Profile Picture <span class="required">*</span></label>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <button type="button" class="btn btn-sm" ${bindAction('click',(event,element)=>{document.getElementById('pm-profile').click()})}><i class="bi bi-upload"></i> Upload Photo</button>
            <button type="button" class="btn btn-sm btn-info" ${bindAction('click',(event,element)=>{openAssistedPatientCamera('profile')})}><i class="bi bi-camera"></i> Use Camera</button>
          </div>
          <input type="file" id="pm-profile" accept="image/jpeg,image/png,image/webp" style="display:none" ${bindAction('change',(event,element)=>{assistedFile(element,'profile')})}>
          <img id="pm-profile-preview" src="${appState.datePicker.assistedProfile||''}" style="${appState.datePicker.assistedProfile?'':'display:none;'}width:72px;height:72px;border-radius:50%;object-fit:cover;margin-top:.35rem;border:1px solid var(--line)">
          <p class="form-note">JPG, PNG, or WebP · max 5 MB.</p>
        </div>

        <div class="form-group">
          <label>Valid ID / COR <span class="required">*</span></label>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <button type="button" class="btn btn-sm" ${bindAction('click',(event,element)=>{document.getElementById('pm-idcor').click()})}><i class="bi bi-upload"></i> Upload ID/COR</button>
            <button type="button" class="btn btn-sm btn-info" ${bindAction('click',(event,element)=>{openAssistedPatientCamera('id')})}><i class="bi bi-camera"></i> Use Camera</button>
          </div>
          <input type="file" id="pm-idcor" accept="image/jpeg,image/png,image/webp,application/pdf" style="display:none" ${bindAction('change',(event,element)=>{assistedFile(element,'id')})}>
          <div id="pm-id-preview" class="form-note">${appState.datePicker.assistedIdCor?'✓ Photo captured / file selected.':'No file selected.'}</div>
          <p class="form-note">JPG, PNG, WebP, or PDF · max 10 MB.</p>
        </div>
      </div>`:''}

      <div class="section-label">Identity &amp; Account</div>
      <div class="form-row">
        <div class="form-group"><label>First Name <span class="required">*</span></label><input id="pm-fname" maxlength="120" value="${escapeHtml(pt?.fname||'')}"></div>
        <div class="form-group"><label>Last Name <span class="required">*</span></label><input id="pm-lname" maxlength="120" value="${escapeHtml(pt?.lname||'')}"></div>

        ${!editing?`
          <div class="form-group"><label>Email <span class="required">*</span></label><input id="pm-email" type="email" maxlength="320" placeholder="patient@example.com"></div>
          <div class="form-group"><label>Username <span class="required">*</span></label><input id="pm-username" maxlength="120" placeholder="Choose a unique username"></div>
        `:`
          <div class="form-group"><label>Email</label><input id="pm-email" value="${escapeHtml(account?.email||'')}" disabled><p class="form-note">Authentication email changes are handled through Account Settings.</p></div>
          <div class="form-group"><label>Username</label><input id="pm-username" value="${escapeHtml(account?.username||'')}" disabled></div>
        `}

        <div class="form-group"><label>University ID No. ${!editing?'<span class="required">*</span>':''}</label><input id="pm-idno" maxlength="120" value="${escapeHtml(pt?.idNo||'')}"></div>
        <div class="form-group"><label>Date of Birth <span class="required">*</span></label>${campusDateFieldHtml('pm-birth',birthDate,'Date of Birth',null,appState.clinicInformation.TODAY)}</div>

        <div class="form-group"><label>Gender</label>
          <select id="pm-gender">${['Male','Female','Other'].map(v=>`<option ${pt?.gender===v?'selected':''}>${v}</option>`).join('')}</select>
        </div>

        <!-- Optional session is maintained from student information, never inferred from appointment time. -->
        <div class="form-group"><label for="pm-class-session">Student class session</label><select id="pm-class-session">${[['','Not recorded'],['Morning','Morning'],['Evening','Evening'],['Mixed','Mixed / both']].map(([v,label])=>`<option value="${v}" ${pt?.classSession===v?'selected':''}>${label}</option>`).join('')}</select><p class="form-note">For students only; leave unknown if not confirmed.</p></div>
        <div class="form-group"><label>Blood Type</label>
          <select id="pm-blood">${['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'].map(v=>`<option ${String(pt?.blood||'Unknown')===v?'selected':''}>${v}</option>`).join('')}</select>
        </div>

        <div class="form-group"><label>Contact Number</label><input id="pm-contact" maxlength="80" value="${escapeHtml(pt?.contact||'')}"></div>

        <div class="form-group"><label>College</label>
          <select id="pm-college">${['CCICT','COE','COED','CME','CAS','COT'].map(v=>`<option value="${v}" ${pt?.college===v?'selected':''}>${v}</option>`).join('')}</select>
        </div>

        <div class="form-group"><label>Person Type</label>
          <select id="pm-ptype">${['Student','Teaching Personnel','Non-Teaching Personnel'].map(v=>`<option ${pt?.personType===v?'selected':''}>${v}</option>`).join('')}</select>
        </div>
      </div>

      <div class="section-label" style="margin-top:.9rem">Patient Information</div>
      <div class="form-row">
        <div class="form-group"><label>Height (cm)</label><input id="pm-height" type="number" min="40" max="260" step=".1" value="${height}"></div>
        <div class="form-group"><label>Weight (kg)</label><input id="pm-weight" type="number" min="1" max="500" step=".1" value="${weight}"></div>
        <div class="form-group full"><label>Address</label><input id="pm-addr" maxlength="3000" value="${escapeHtml(pt?.address||'')}"></div>
        <div class="form-group full"><label>Allergies</label><input id="pm-allergy" maxlength="3000" value="${escapeHtml(pt?.allergies||'')}" placeholder="Enter known allergies"></div>
        <div class="form-group full"><label>Medical History</label><textarea id="pm-history" maxlength="5000" rows="3">${escapeHtml(pt?.medHistory||'')}</textarea></div>
        <div class="form-group"><label>Emergency Contact Name</label><input id="pm-ename" maxlength="255" value="${escapeHtml(pt?.emergencyName||'')}"></div>
        <div class="form-group"><label>Emergency Contact No.</label><input id="pm-econtact" maxlength="100" value="${escapeHtml(pt?.emergencyContact||'')}"></div>
      </div>

      ${realMode&&editing?`<div class="tech-note">Changes are recorded in the activity log.</div>`:''}

      ${!editing?`<div class="privacy-agree" style="margin-top:1rem">
        <input type="checkbox" id="pm-privacy-ack">
        <label for="pm-privacy-ack">
          The patient has reviewed and acknowledges the
          <a ${bindAction('click',(event,element)=>{event.preventDefault();openPrivacyNotice()})}>CampusCare Privacy Notice</a>
          (version ${escapeHtml(appState.data.DB.settings?.privacyPolicyVersion||'1.0')}) as part of this assisted registration.
        </label>
      </div>`:''}
    </div>

    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" id="pm-save-btn" ${bindAction('click',(event,element)=>{savePatient((id||'null'))})}>${editing?'Save Changes':'Create Patient Account'}</button>
    </div>
  </div>`);

  setTimeout(restoreAssistedPatientDraft,0);
}

export async function savePatient(id){
  const editing=Boolean(id);
  const fname=document.getElementById('pm-fname')?.value.trim()||'';
  const lname=document.getElementById('pm-lname')?.value.trim()||'';
  const email=document.getElementById('pm-email')?.value.trim()||'';
  const username=document.getElementById('pm-username')?.value.trim()||'';
  const idNo=document.getElementById('pm-idno')?.value.trim()||'';
  const birthDate=document.getElementById('pm-birth')?.value||'';
  const msg=document.getElementById('ptm-msg');
  const btn=document.getElementById('pm-save-btn');

  hideAlert(msg);
  if(!fname||!lname||!birthDate){
    showAlert(msg,'First name, last name, and date of birth are required.');
    return;
  }
  if(birthDate>appState.clinicInformation.TODAY){
    showAlert(msg,'Date of birth cannot be in the future.');
    return;
  }
  if(!editing&&(!email||!username||!idNo)){
    showAlert(msg,'Email, username, and university ID number are required for assisted registration.');
    return;
  }
  if(!editing&&(!appState.datePicker.assistedProfile||!appState.datePicker.assistedIdCor)){
    showAlert(msg,'Profile picture and valid ID/COR are required for assisted registration.');
    return;
  }
  if(!editing&&!document.getElementById('pm-privacy-ack')?.checked){
    showAlert(msg,'Please confirm that the patient reviewed and acknowledged the CampusCare Privacy Notice during registration.');
    return;
  }

  const payload={
    first_name:fname,
    last_name:lname,
    contact_number:document.getElementById('pm-contact')?.value.trim()||'',
    id_number:idNo,
    birth_date:birthDate,
    sex:document.getElementById('pm-gender')?.value||'',
    blood_type:document.getElementById('pm-blood')?.value||'Unknown',
    college:document.getElementById('pm-college')?.value||'',
    person_type:document.getElementById('pm-ptype')?.value||'Student',
    class_session:document.getElementById('pm-ptype')?.value==='Student'?(document.getElementById('pm-class-session')?.value||null):null,
    height_cm:document.getElementById('pm-height')?.value||null,
    weight_kg:document.getElementById('pm-weight')?.value||null,
    address:document.getElementById('pm-addr')?.value.trim()||'',
    allergies:document.getElementById('pm-allergy')?.value.trim()||'',
    medical_history:document.getElementById('pm-history')?.value.trim()||'',
    emergency_contact_name:document.getElementById('pm-ename')?.value.trim()||'',
    emergency_contact_number:document.getElementById('pm-econtact')?.value.trim()||''
  };

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent=editing?'Saving securely…':'Creating account…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      if(editing){
        const pt=appState.data.DB.patients.find(p=>p.id===Number(id));
        if(!pt?._realSupabase)throw new Error('The real patient record could not be identified.');

        await patientAction({
          action:'update',
          patient_id:pt.dbPatientId,
          ...payload
        });

        await syncAdminDirectoryFromSupabase();
        toast('Patient record updated.','success');
      }else{
        const result=await patientAction({
          action:'create_assisted',
          email,
          username,
          profile_data_url:appState.datePicker.assistedProfile,
          verification_data_url:appState.datePicker.assistedIdCor,
          privacy_acknowledged:true,
          ...payload
        });

        await syncAdminDirectoryFromSupabase();
        appState.datePicker.assistedProfile='';
        appState.datePicker.assistedIdCor='';
        appState.datePicker.assistedPatientDraft=null;

        if(result.password_setup_email_sent){
          toast('Patient account created and privacy acknowledgement recorded. A password-setup email was sent to the patient.','success',7000);
        }else{
          toast('Patient account created and privacy acknowledgement recorded. Ask the patient to use Forgot Password to set their password.','warning',7500);
        }
      }
    }else{
      const age=ageFromBirthDate(birthDate);
      const data={
        fname,lname,age,birthDate,
        gender:payload.sex,blood:payload.blood_type,
        contact:payload.contact_number,college:payload.college,
        personType:payload.person_type,classSession:payload.class_session||'',
        height:payload.height_cm?`${payload.height_cm}cm`:'',
        weight:payload.weight_kg?`${payload.weight_kg}kg`:'',
        address:payload.address,allergies:payload.allergies,
        medHistory:payload.medical_history,
        emergencyName:payload.emergency_contact_name,
        emergencyContact:payload.emergency_contact_number,
        idNo
      };

      if(editing){
        const idx=appState.data.DB.patients.findIndex(p=>p.id===Number(id));
        if(idx>=0)appState.data.DB.patients[idx]={...appState.data.DB.patients[idx],...data};
        toast('Patient updated.','success');
      }else{
        const newUserId=appState.data.DB.nextUserId++;
        appState.data.DB.users.push({
          id:newUserId,username,email,role:'Patient',fname,lname,
          contact:payload.contact_number,status:'Active',approved:true,
          verified:true,profilePhoto:appState.datePicker.assistedProfile,idPhoto:appState.datePicker.assistedIdCor,
          createdAt:appState.clinicInformation.TODAY
        });
        appState.data.DB.patients.push({
          id:appState.data.DB.nextPatientId++,...data,userId:newUserId,createdAt:appState.clinicInformation.TODAY
        });
        persistDB();
        appState.datePicker.assistedProfile='';
        appState.datePicker.assistedIdCor='';
        toast('Patient added.','success');
      }
    }

    closeAllModals();
    if(appState.navigationRaceProtection.campusActivePageId==='patients')await renderPatients();
  }catch(e){
    showAlert(msg,e?.message||'Unable to save the patient record.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||(editing?'Save Changes':'Create Patient Account');
    }
  }
}

// Patient chart: identity banner, allergy alert, then Overview / Treatments / Appointments /
// Certificates / Fitness tabs, following the layout of common clinic record systems.
export async function viewPatient(id){
  const pt=appState.data.DB.patients.find(p=>p.id===id);if(!pt)return;
  if(appState.auth.currentUser?._realSupabase){
    try{await syncRealTreatments();}catch(e){console.error('Patient treatment sync:',e);}
  }
  const today=appState.clinicInformation.TODAY;
  const byNewest=(a,b)=>String(b).localeCompare(String(a));
  const treats=treatmentRecords().filter(t=>t.patientId===id&&!t.archived).sort((a,b)=>byNewest(a.date,b.date));
  const appts=appointmentRecords().filter(a=>a.patientId===id).sort((a,b)=>byNewest(a.date+(a.time||''),b.date+(b.time||'')));
  const certs=(appState.data.DB.certRequests||[]).filter(c=>c.patientId===id).sort((a,b)=>byNewest(a.requestedAt,b.requestedAt));
  const fitness=fitnessRecords().filter(f=>f.patientId===id).sort((a,b)=>byNewest(a.requestedDate||a.date,b.requestedDate||b.date));
  const {lastVisit,nextAppointment}=patientData.patientVisitSummary(id,{appointments:appointmentRecords(),treatments:treatmentRecords(),today});
  const bmi=patientData.bodyMassIndex(pt.height,pt.weight);
  const allergy=patientData.hasAllergyAlert(pt.allergies);
  const email=pt.userId?getUserById(pt.userId)?.email||'':'';
  const val=v=>escapeHtml(String(v??'').trim()||'—');
  const row=(label,value)=>`<div class="info-row"><span class="info-label">${label}</span><span class="info-val">${value}</span></div>`;
  const doctor=d=>{const doc=getUserById(d);return doc?escapeHtml(docName(doc)):'—';};
  const table=(cols,rows,empty)=>rows.length?`<div class="table-wrap"><table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<p class="text-muted pt-tab-empty">${empty}</p>`;
  const tabs=[
    ['overview','Overview',`<div class="pt-overview">
      <section><h4>Contact</h4>${row('Phone',val(pt.contact))}${row('Email',val(email))}${row('Address',val(pt.address))}</section>
      <section><h4>Emergency contact</h4>${row('Name',val(pt.emergencyName))}${row('Phone',val(pt.emergencyContact))}</section>
      <section><h4>Clinical summary</h4>${row('Height',val(pt.height))}${row('Weight',val(pt.weight))}${row('BMI',bmi?`${bmi.value} <span class="text-muted">(${bmi.category})</span>`:'—')}${row('Blood Type',val(pt.blood))}</section>
      <section><h4>History</h4><div class="info-row"><span class="info-label">Allergies</span><span class="info-val ${allergy?'text-danger':''}">${val(pt.allergies)}</span></div>${row('Medical History',val(pt.medHistory))}</section>
      <section><h4>Visits</h4>${row('Last visit',lastVisit?fmtDate(lastVisit):'—')}${row('Next appointment',nextAppointment?`${fmtDate(nextAppointment.date)}${nextAppointment.time?' · '+fmtTime(nextAppointment.time):''} · ${escapeHtml(nextAppointment.clinic||'')}`:'—')}${row('Registered',pt.createdAt?fmtDate(String(pt.createdAt).slice(0,10)):'—')}</section>
    </div>`],
    ['treatments',`Treatments (${treats.length})`,table(['Date','Diagnosis','Prescription','Doctor'],treats.map(t=>`<tr><td>${fmtDate(t.date)}</td><td>${val(t.diagnosis)}</td><td>${val(t.prescription)}</td><td>${doctor(t.doctorId)}</td></tr>`),'No treatments on record.')],
    ['appointments',`Appointments (${appts.length})`,table(['Date','Time','Clinic','Service','Doctor','Status'],appts.map(a=>`<tr><td>${fmtDate(a.date)}</td><td>${a.time?fmtTime(a.time):'—'}</td><td>${val(a.clinic)}</td><td>${val(a.service)}</td><td>${doctor(a.doctorId)}</td><td>${statusBadge(a.status)}</td></tr>`),'No appointments on record.')],
    ['certificates',`Certificates (${certs.length})`,table(['Requested','Purpose','Certificate No.','Status'],certs.map(c=>`<tr><td>${c.requestedAt?fmtDate(String(c.requestedAt).slice(0,10)):'—'}</td><td>${val(c.purpose)}</td><td>${val(c.certNo)}</td><td>${statusBadge(c.status)}</td></tr>`),'No certificate requests.')],
    ['fitness',`Fitness (${fitness.length})`,table(['Requested','Sport / Event','Decision','Status'],fitness.map(f=>`<tr><td>${(f.requestedDate||f.date)?fmtDate(String(f.requestedDate||f.date).slice(0,10)):'—'}</td><td>${val(f.sport)}</td><td>${val(f.decision)}</td><td>${statusBadge(f.status)}</td></tr>`),'No fitness assessments.')]
  ];
  const showTab=key=>{
    document.querySelectorAll('#pt-chart [data-pt-tab]').forEach(btn=>{const on=btn.dataset.ptTab===key;btn.classList.toggle('active',on);btn.setAttribute('aria-selected',String(on));btn.tabIndex=on?0:-1;});
    document.querySelectorAll('#pt-chart [data-pt-panel]').forEach(panel=>{panel.hidden=panel.dataset.ptPanel!==key;});
  };
  openModal(`<div class="modal modal-lg patient-chart" id="pt-chart">
    <div class="modal-header"><h3>Patient Record</h3><button class="close-btn" aria-label="Close patient record" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div class="pt-banner">
        ${patientAvatarHtml(pt,56)}
        <div class="pt-banner-main">
          <h2>${escapeHtml(pt.lname)}, ${escapeHtml(pt.fname)}${pt.archived?' <span class="badge badge-gray">Archived</span>':''}</h2>
          <div class="pt-banner-ids">P-${patientDisplayId(pt)} · ID No. ${val(pt.idNo)}</div>
          <div class="pt-banner-facts">
            <span><strong>${val(pt.age)}</strong> yrs · ${val(pt.gender)}</span>
            <span>DOB <strong>${pt.birthDate?fmtDate(pt.birthDate):'—'}</strong></span>
            <span>Blood <strong>${val(pt.blood)}</strong></span>
            <span>${priorityBadge(pt.personType)} ${collegeBadge(pt.college)}</span>
            ${pt.personType==='Student'?`<span>Class session <strong>${val(pt.classSession||'Not recorded')}</strong></span>`:''}
          </div>
        </div>
      </div>
      ${allergy?`<div class="pt-allergy-alert" role="alert"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i><div><strong>Allergies</strong><span>${escapeHtml(pt.allergies)}</span></div></div>`:''}
      <div class="pt-tabs" role="tablist" aria-label="Patient record sections">
        ${tabs.map(([key,label],i)=>`<button type="button" role="tab" class="pt-tab ${i?'':'active'}" data-pt-tab="${key}" aria-selected="${!i}" tabindex="${i?-1:0}" ${bindAction('click',()=>showTab(key))}>${label}</button>`).join('')}
      </div>
      ${tabs.map(([key,,html],i)=>`<div class="pt-panel" role="tabpanel" data-pt-panel="${key}" ${i?'hidden':''}>${html}</div>`).join('')}
    </div>
    <div class="modal-footer" style="justify-content:space-between;flex-wrap:wrap">
      <div class="fhir-toolbar">
        <button class="btn btn-sm" ${bindAction('click',()=>printPatientSummary(id))}><i class="bi bi-printer" aria-hidden="true"></i> Print summary</button>
        ${appState.auth.currentUser.role==='Doctor'||appState.auth.currentUser.role==='Administrator'?`<button class="btn btn-purple btn-sm" ${bindAction('click',(event,element)=>{openClinicalCopilot((id))})}>✦ Clinical Copilot</button>`:''}
        ${appState.auth.currentUser.role!=='Patient'?`<button class="btn btn-info btn-sm" ${bindAction('click',(event,element)=>{viewPatientFHIR((id))})}>FHIR Preview</button>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{downloadPatientFHIR((id))})}>Export FHIR</button>`:''}
      </div>
      <div style="display:flex;gap:.45rem">
        <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
        ${['Staff','Administrator'].includes(appState.auth.currentUser.role)&&!pt.archived?`<button class="btn btn-info btn-sm" ${bindAction('click',(event,element)=>{closeAllModals();openPatientModal((id))})}>Edit Record</button>`:''}
      </div>
    </div>
  </div>`);
  // Arrow keys move between tabs, as in standard tab widgets.
  document.querySelector('#pt-chart .pt-tabs')?.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
    const keys=tabs.map(([key])=>key),current=keys.indexOf(document.querySelector('#pt-chart .pt-tab.active')?.dataset.ptTab);
    const next=keys[(current+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length];
    showTab(next);document.querySelector(`#pt-chart [data-pt-tab="${next}"]`)?.focus();
  });
}

// One-page printable summary of the chart overview and recent history.
export function printPatientSummary(id){
  const chart=document.getElementById('pt-chart');
  if(!chart)return;
  const frame=document.createElement('iframe');
  frame.style.cssText='position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(frame);
  const panels=[...chart.querySelectorAll('[data-pt-panel]')].map(panel=>{
    const title=chart.querySelector(`[data-pt-tab="${panel.dataset.ptPanel}"]`)?.textContent||'';
    return `<h3>${escapeHtml(title)}</h3>${panel.innerHTML}`;
  }).join('');
  const doc=frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Patient summary</title><style>
    body{font:12px/1.5 Arial,Helvetica,sans-serif;color:#111;margin:24px}h2{margin:0 0 4px}h3{margin:18px 0 6px;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:3px}
    h4{margin:10px 0 4px;font-size:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
    .info-row{display:flex;gap:8px}.info-label{width:140px;color:#555}.pt-banner img,.pt-banner .sb-avatar{display:none}.badge{border:1px solid #999;border-radius:8px;padding:0 5px}
    .pt-allergy-alert{border:2px solid #b00;padding:6px 8px;margin:8px 0;color:#b00}.bi{display:none}
  </style></head><body><p>CampusCare · CTU Main Medical &amp; Dental Clinic · Printed ${escapeHtml(new Date().toLocaleString('en-PH'))}</p>
  ${chart.querySelector('.pt-banner')?.outerHTML||''}${chart.querySelector('.pt-allergy-alert')?.outerHTML||''}${panels}
  <p style="margin-top:18px;color:#555">Confidential medical information. Handle according to the CampusCare Privacy Notice.</p></body></html>`);
  doc.close();
  frame.contentWindow.focus();frame.contentWindow.print();
  setTimeout(()=>frame.remove(),2000);
}

export function archivePatient(id){
  const p=appState.data.DB.patients.find(x=>x.id===Number(id));
  if(!p)return;

  showConfirmDialog({
    title:'Archive Patient Record',
    message:`Archive <strong>${escapeHtml(p.fname)} ${escapeHtml(p.lname)}</strong>'s patient record? The linked account will also be disabled. Upcoming scheduled appointments must be cleared first.`,
    confirmLabel:'Archive',
    danger:true,
    onConfirm:async()=>{
      try{
        if(p._realSupabase){
          await patientAction({action:'archive',patient_id:p.dbPatientId});
          await syncAdminDirectoryFromSupabase();
        }else{
          p.archived=true;
          p.archivedAt=new Date().toLocaleString();
          p.archivedBy=appState.auth.currentUser.id;
          persistDB();
        }

        toast('Patient record archived.','success');
        if(appState.navigationRaceProtection.campusActivePageId==='patients')await renderPatients();
      }catch(e){
        toast(e?.message||'Unable to archive the patient record.','error',7000);
      }
    }
  });
}

export function restorePatient(id){
  const p=appState.data.DB.patients.find(x=>x.id===Number(id));
  if(!p)return;

  showConfirmDialog({
    title:'Restore Patient Record',
    message:`Restore <strong>${escapeHtml(p.fname)} ${escapeHtml(p.lname)}</strong>'s patient record and linked account status?`,
    confirmLabel:'Restore',
    onConfirm:async()=>{
      try{
        if(p._realSupabase){
          await patientAction({action:'restore',patient_id:p.dbPatientId});
          await syncAdminDirectoryFromSupabase();
        }else{
          p.archived=false;
          p.archivedAt=null;
          persistDB();
        }

        toast('Patient record restored.','success');
        if(appState.navigationRaceProtection.campusActivePageId==='patients')await renderPatients();
      }catch(e){
        toast(e?.message||'Unable to restore the patient record.','error');
      }
    }
  });
}

export function dentalToothInputsHtml(numbers,values={},primary=false){
  return `<div class="dental-odontogram-grid ${primary?'primary':''}">
    ${numbers.map(n=>`<label class="dental-tooth"><strong>${n}</strong><input class="tm-dental-tooth" data-tooth="${n}" maxlength="12" value="${escapeHtml(values?.[n]||'')}" placeholder="—"></label>`).join('')}
  </div>`;
}

export function dentalRecordFormHtml(existing={},pt=null,defaultDate=appState.clinicInformation.TODAY){
  const oral=existing?.oralHealth||{};
  const operations=Array.isArray(existing?.accomplishment)?existing.accomplishment:[];
  const opRows=[0,1,2].map(i=>({
    tooth:operations[i]?.tooth_no||'',
    nature:operations[i]?.nature||''
  }));

  return `<div class="dental-record-section" id="tm-dental-section">
    <h4>Dental Record</h4>
    <p class="form-note">Digital version of the CTU Dental Clinic record form. Patient identity, age, date, and ID are drawn from the CampusCare record.</p>

    <div class="form-row">
      <div class="form-group"><label>Course &amp; Major</label><input id="tm-dental-course" maxlength="180" value="${escapeHtml(existing?.courseMajor||pt?.college||'')}"></div>
      <div class="form-group"><label>Year &amp; Section</label><input id="tm-dental-year" maxlength="120" value="${escapeHtml(existing?.yearSection||'')}"></div>
      <div class="form-group"><label>Cell No.</label><input id="tm-dental-cell" maxlength="80" value="${escapeHtml(existing?.cellNo||pt?.contact||'')}"></div>
      <div class="form-group"><label>Messenger Account</label><input id="tm-dental-messenger" maxlength="180" value="${escapeHtml(existing?.messengerAccount||'')}"></div>
    </div>

    <div class="dental-odontogram-group">
      <div class="dental-odontogram-title">Permanent Teeth — Upper</div>
      ${dentalToothInputsHtml(appState.patientForm.DENTAL_PERMANENT_UPPER,existing?.odontogram||{})}
    </div>
    <div class="dental-odontogram-group">
      <div class="dental-odontogram-title">Permanent Teeth — Lower</div>
      ${dentalToothInputsHtml(appState.patientForm.DENTAL_PERMANENT_LOWER,existing?.odontogram||{})}
    </div>
    <div class="dental-odontogram-group">
      <div class="dental-odontogram-title">Primary Teeth — Upper</div>
      ${dentalToothInputsHtml(appState.patientForm.DENTAL_PRIMARY_UPPER,existing?.odontogram||{},true)}
    </div>
    <div class="dental-odontogram-group">
      <div class="dental-odontogram-title">Primary Teeth — Lower</div>
      ${dentalToothInputsHtml(appState.patientForm.DENTAL_PRIMARY_LOWER,existing?.odontogram||{},true)}
    </div>
    <p class="form-note">Enter the dentist's short notation or finding for each tooth. CampusCare stores the notation without interpreting it.</p>

    <div class="section-label">Oral Health Record</div>
    <div class="dental-check-grid">
      ${['Satisfactory','Fair','Poor','Harelip','Defective Gums','Cleft Palate'].map(v=>{
        const key=v.toLowerCase().replace(/\s+/g,'_');
        return `<label><input type="checkbox" class="tm-dental-oral" value="${escapeHtml(v)}" ${oral?.[key]?'checked':''}> ${escapeHtml(v)}</label>`;
      }).join('')}
    </div>
    <div class="form-group" style="margin-top:.5rem"><label>Others</label><input id="tm-dental-oral-other" maxlength="255" value="${escapeHtml(oral?.others||'')}"></div>

    <div class="section-label">Accomplishment</div>
    <div class="dental-operation-grid">
      <strong>Tooth No.</strong><strong>Nature of Operation</strong>
      ${opRows.map((r,i)=>`<input class="tm-dental-op-tooth" maxlength="20" value="${escapeHtml(r.tooth)}" placeholder="e.g. 16"><input class="tm-dental-op-nature" maxlength="255" value="${escapeHtml(r.nature)}" placeholder="Treatment / operation performed">`).join('')}
    </div>

    <div class="form-row" style="margin-top:.6rem">
      <div class="form-group"><label>Dental Work Status</label>
        <select id="tm-dental-status">
          <option value="">Select</option>
          ${['Completed','In Progress','No Dental Work Necessary'].map(v=>`<option ${existing?.workStatus===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Dental Record Date</label><input type="date" id="tm-dental-date" value="${escapeHtml(existing?.recordDate||defaultDate)}" max="${appState.clinicInformation.TODAY}"></div>
    </div>

    <div class="form-group"><label>Recommendation</label><textarea id="tm-dental-recommendation" rows="3" maxlength="5000">${escapeHtml(existing?.recommendation||'')}</textarea></div>
  </div>`;
}

export function collectDentalRecordForm(){
  const section=document.getElementById('tm-dental-section');
  if(!section||section.hidden)return null;

  const odontogram={};
  document.querySelectorAll('.tm-dental-tooth').forEach(input=>{
    const v=String(input.value||'').trim();
    if(v)odontogram[input.dataset.tooth]=v;
  });

  const oralHealth={};
  document.querySelectorAll('.tm-dental-oral').forEach(cb=>{
    const key=String(cb.value||'').toLowerCase().replace(/\s+/g,'_');
    oralHealth[key]=Boolean(cb.checked);
  });
  oralHealth.others=document.getElementById('tm-dental-oral-other')?.value.trim()||'';

  const teeth=[...document.querySelectorAll('.tm-dental-op-tooth')];
  const nature=[...document.querySelectorAll('.tm-dental-op-nature')];
  const accomplishment=teeth.map((el,i)=>({
    tooth_no:String(el.value||'').trim(),
    nature:String(nature[i]?.value||'').trim()
  })).filter(r=>r.tooth_no||r.nature);

  return {
    record_date:document.getElementById('tm-dental-date')?.value||document.getElementById('tm-date')?.value||appState.clinicInformation.TODAY,
    course_major:document.getElementById('tm-dental-course')?.value.trim()||'',
    year_section:document.getElementById('tm-dental-year')?.value.trim()||'',
    cell_no:document.getElementById('tm-dental-cell')?.value.trim()||'',
    messenger_account:document.getElementById('tm-dental-messenger')?.value.trim()||'',
    odontogram,
    oral_health:oralHealth,
    accomplishment,
    work_status:document.getElementById('tm-dental-status')?.value||'',
    recommendation:document.getElementById('tm-dental-recommendation')?.value.trim()||''
  };
}

export function toggleDentalRecordSection(){
  const section=document.getElementById('tm-dental-section');
  const type=document.getElementById('tm-record-type')?.value||'Medical Clinic';
  if(section)section.hidden=type!=='Dental Clinic';
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.patientForm.DENTAL_PERMANENT_UPPER=['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28'];
  appState.patientForm.DENTAL_PERMANENT_LOWER=['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38'];
  appState.patientForm.DENTAL_PRIMARY_UPPER=['55','54','53','52','51','61','62','63','64','65'];
  appState.patientForm.DENTAL_PRIMARY_LOWER=['85','84','83','82','81','71','72','73','74','75'];
}
