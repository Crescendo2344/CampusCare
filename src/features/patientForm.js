// patientForm: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {getUserById} from './documentScanner.js';
import {hideAlert,showAlert,showConfirmDialog,toast} from './theme.js';
import {ageFromBirthDate,patientAction,patientMeasurementNumber,syncAdminDirectoryFromSupabase} from './patientService.js';
import {closeAllModals,openModal} from './modals.js';
import {assistedFile,campusDateFieldHtml,openAssistedPatientCamera,restoreAssistedPatientDraft} from './datePicker.js';
import {escapeHtml} from './issueReports.js';
import {openPrivacyNotice} from './loginLockout.js';
import {persistDB} from './persistence.js';
import {patientAvatarHtml,renderPatients} from './patientManagement.js';
import {syncRealTreatments,treatmentRecords} from './treatmentService.js';
import {appointmentRecords} from './appointmentService.js';
import {collegeBadge,fmtDate,priorityBadge,statusBadge} from './inputValidation.js';
import {docName} from './messaging.js';
import {downloadPatientFHIR,openClinicalCopilot,viewPatientFHIR} from './inventoryService.js';
import {bindAction} from '../dependencies.js';
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
        <div class="form-group full"><label>Allergies</label><input id="pm-allergy" maxlength="3000" value="${escapeHtml(pt?.allergies||'')}" placeholder="None"></div>
        <div class="form-group full"><label>Medical History</label><textarea id="pm-history" maxlength="5000" rows="3">${escapeHtml(pt?.medHistory||'')}</textarea></div>
        <div class="form-group"><label>Emergency Contact Name</label><input id="pm-ename" maxlength="255" value="${escapeHtml(pt?.emergencyName||'')}"></div>
        <div class="form-group"><label>Emergency Contact No.</label><input id="pm-econtact" maxlength="100" value="${escapeHtml(pt?.emergencyContact||'')}"></div>
      </div>

      ${realMode&&editing?`<div class="tech-note">Changes to this real patient record are written to the CampusCare Activity/Audit Log.</div>`:''}

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
        personType:payload.person_type,
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

export async function viewPatient(id){
  const pt=appState.data.DB.patients.find(p=>p.id===id);if(!pt)return;
  if(appState.auth.currentUser?._realSupabase){
    try{await syncRealTreatments();}catch(e){console.error('Patient treatment sync:',e);}
  }
  const treats=treatmentRecords().filter(t=>t.patientId===id&&!t.archived);
  const appts=appointmentRecords().filter(a=>a.patientId===id).slice(-5);
  openModal(`<div class="modal modal-lg">
    <div class="modal-header"><h3 style="display:flex;align-items:center;gap:.6rem">${patientAvatarHtml(pt,32)} Patient: ${pt.fname} ${pt.lname}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div class="grid-2" style="margin-bottom:.75rem">
        <div>
          <div class="section-label">Personal Info</div>
          <div class="info-row"><span class="info-label">Name</span><span class="info-val">${pt.fname} ${pt.lname}</span></div>
          <div class="info-row"><span class="info-label">Age / Gender</span><span class="info-val">${pt.age} / ${pt.gender}</span></div>
          <div class="info-row"><span class="info-label">Blood Type</span><span class="info-val">${pt.blood}</span></div>
          <div class="info-row"><span class="info-label">College</span><span class="info-val">${collegeBadge(pt.college)}</span></div>
          <div class="info-row"><span class="info-label">Person Type</span><span class="info-val">${priorityBadge(pt.personType)}</span></div>
          <div class="info-row"><span class="info-label">ID No.</span><span class="info-val">${pt.idNo||'—'}</span></div>
        </div>
        <div>
          <div class="section-label">Medical Info</div>
          <div class="info-row"><span class="info-label">Height / Weight</span><span class="info-val">${pt.height||'—'} / ${pt.weight||'—'}</span></div>
          <div class="info-row"><span class="info-label">Allergies</span><span class="info-val ${pt.allergies&&pt.allergies!=='None'?'text-danger':''}">${pt.allergies||'None'}</span></div>
          <div class="info-row"><span class="info-label">Medical History</span><span class="info-val">${pt.medHistory||'None'}</span></div>
          <div class="info-row"><span class="info-label">Emergency Contact</span><span class="info-val">${pt.emergencyName||'—'} (${pt.emergencyContact||'—'})</span></div>
        </div>
      </div>
      <div class="section-label">Recent Treatments</div>
      ${treats.length?`<table style="margin-bottom:.75rem"><thead><tr><th>Date</th><th>Diagnosis</th><th>Prescription</th><th>Doctor</th></tr></thead><tbody>${treats.map(t=>{const doc=getUserById(t.doctorId);return`<tr><td>${fmtDate(t.date)}</td><td>${t.diagnosis}</td><td>${t.prescription||'-'}</td><td>${doc?docName(doc):'?'}</td></tr>`;}).join('')}</tbody></table>`:'<p class="text-muted" style="margin-bottom:.75rem">No treatments on record.</p>'}
      <div class="section-label">Recent Appointments</div>
      ${appts.length?`<table><thead><tr><th>Date</th><th>Clinic</th><th>Doctor</th><th>Status</th></tr></thead><tbody>${appts.map(a=>{const doc=getUserById(a.doctorId);return`<tr><td>${fmtDate(a.date)}</td><td>${a.clinic}</td><td>${doc?docName(doc):'?'}</td><td>${statusBadge(a.status)}</td></tr>`;}).join('')}</tbody></table>`:'<p class="text-muted">No appointments.</p>'}
    </div>
    <div class="modal-footer" style="justify-content:space-between;flex-wrap:wrap">
      <div class="fhir-toolbar">
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
