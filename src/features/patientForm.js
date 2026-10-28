// patientForm: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {getUserById} from './documentScanner.js';
import {hideAlert,showAlert,showConfirmDialog,toast,toastWithUndo} from './theme.js';
import {ageFromBirthDate,patientAction,patientDisplayId,patientMeasurementNumber,syncAdminDirectoryFromSupabase} from './patientService.js';
import {closeAllModals,openModal} from './modals.js';
import {campusDateFieldHtml} from './datePicker.js';
import {escapeHtml} from './issueReports.js';
import {openPrivacyNotice} from './loginLockout.js';
import {persistDB} from './persistence.js';
import {patientAvatarHtml,renderPatients} from './patientManagement.js';
import {syncRealTreatments,treatmentRecords} from './treatmentService.js';
import {appointmentRecords} from './appointmentService.js';
import {collegeBadge,fmtDate,fmtTime,priorityBadge,statusBadge} from './inputValidation.js';
import {docName} from './messaging.js';
import {downloadPatientFHIR,openClinicalCopilot,viewPatientFHIR} from './inventoryService.js';
import {openNewCertificateModal} from './certificateService.js';
import {bindAction,patientData} from '../dependencies.js';
import {normalizePhilippineMobile} from '../../supabase/functions/_shared/contact-validation.js';
import {PATIENT_FORM_SERVER_FIELDS,resetRegistrationFieldErrors,sanitizeInput,setRegistrationFieldError,validateRegistrationField,validateRegistrationForm} from './inputValidation.js';
import {handleRegistrationIdUpload,renderRegistrationIds,resetVerificationState,selectRegistrationIdSide,setVerificationScope,verificationState,verificationStepsHtml} from './idVerification.js';
import {openCamera} from '../app/optional-features.js';
import {fitnessRecords} from './fitnessAssessments.js';
// ── Patient Modal ──
// One form for clinic-assisted registration and record edits. Fields follow the public registration
// order and rules (person type first, then the matching college/department and ID format), show
// errors beside each field, and new accounts include a live selfie plus both sides of the ID.
const PATIENT_ID_RULES={Student:{label:'Student ID No.',length:7,example:'1350098'},Employee:{label:'Employee ID No.',length:5,example:'14982'}};
const idRule=type=>type==='Student'?PATIENT_ID_RULES.Student:PATIENT_ID_RULES.Employee;
function patientUnits(type){
  return type==='Non-Teaching Personnel'
    ? appState.documentScanner.REGISTRATION_NONTEACHING_DEPARTMENTS||[]
    : appState.documentScanner.REGISTRATION_ACADEMIC_UNITS||[];
}
// Keep the ID label, length, unit list and class-session field consistent with the person type.
export function syncPatientFormType(){
  const type=document.getElementById('pm-ptype')?.value||'Student';
  const rule=idRule(type);
  const idLabel=document.getElementById('pm-idno-label');
  if(idLabel)idLabel.innerHTML=`${rule.label} <span class="required">*</span>`;
  const idInput=document.getElementById('pm-idno');
  if(idInput){idInput.maxLength=rule.length;idInput.placeholder=`e.g. ${rule.example}`;idInput.value=idInput.value.replace(/\D/g,'').slice(0,rule.length);}
  const idHint=document.getElementById('pm-idno-help');
  if(idHint)idHint.textContent=`${rule.label.replace(' No.','')} numbers have exactly ${rule.length} digits.`;
  const unitLabel=document.getElementById('pm-college-label');
  if(unitLabel)unitLabel.innerHTML=`${type==='Non-Teaching Personnel'?'Department':'College'} <span class="required">*</span>`;
  const unit=document.getElementById('pm-college');
  if(unit){
    const previous=unit.value;
    unit.innerHTML='<option value="">Select</option>'+patientUnits(type).map(([value,label])=>`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
    if(patientUnits(type).some(([value])=>value===previous))unit.value=previous;
  }
  const session=document.getElementById('pm-session-group');
  if(session)session.hidden=type!=='Student';
  for(const id of ['pm-idno','pm-college','pm-class-session'])validateRegistrationField(id,false);
}

export function openPatientModal(id=null){
  const pt=id?appState.data.DB.patients.find(p=>p.id===id):null;
  const account=pt?.userId?getUserById(pt.userId):null;
  const realMode=Boolean(appState.auth.currentUser?._realSupabase);
  const editing=Boolean(pt);

  if(editing&&pt.archived){
    toast('Restore the patient record before editing it.','warning');
    return;
  }
  setVerificationScope('pm');
  if(!editing)resetVerificationState('pm');
  resetRegistrationFieldErrors('pm-');

  const height=patientMeasurementNumber(pt?.height);
  const weight=patientMeasurementNumber(pt?.weight);
  const type=pt?.personType||'Student';
  const field=(idName,label,control,{required=false,hint='',full=false}={})=>`<div class="form-group${full?' full':''}">
      <label for="${idName}" id="${idName}-label">${label}${required?' <span class="required">*</span>':''}</label>
      ${control}
      ${hint?`<p class="form-note field-hint" id="${idName}-help">${hint}</p>`:''}
      <p class="registration-field-error" id="${idName}-error" aria-live="polite" hidden></p>
    </div>`;
  const live=(sanitize='')=>`${bindAction('input',(event,element)=>{
    // ID numbers are digits only, up to the length the person type requires.
    if(sanitize==='digits')element.value=element.value.replace(/\D/g,'').slice(0,element.maxLength>0?element.maxLength:7);
    else if(sanitize)sanitizeInput(element,sanitize);
    validateRegistrationField(element.id,false);
  })} ${bindAction('blur',(event,element)=>{validateRegistrationField(element.id);})}`;
  const options=(values,selected,placeholder='')=>(placeholder?`<option value="">${placeholder}</option>`:'')+values.map(([v,label=v])=>`<option value="${escapeHtml(v)}" ${selected===v?'selected':''}>${escapeHtml(label)}</option>`).join('');

  openModal(`<div class="modal modal-lg patient-form" id="pm-form">
    <div class="modal-header"><h3>${editing?'Edit Patient Record':'Clinic-Assisted Patient Registration'}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      ${editing?`<div class="pt-banner pt-form-banner">${patientAvatarHtml(pt,44)}<div class="pt-banner-main"><h2>${escapeHtml(pt.lname)}, ${escapeHtml(pt.fname)}</h2><div class="pt-banner-ids">P-${patientDisplayId(pt)} · ${escapeHtml(account?.email||'No email on file')}${account?.username?` · @${escapeHtml(account.username)}`:''}</div></div></div>`:''}
      <div id="ptm-msg"></div>

      <fieldset class="registration-group">
        <legend>Personal information</legend>
        <div class="form-row">
          ${field('pm-fname','First Name',`<input id="pm-fname" maxlength="50" autocomplete="off" value="${escapeHtml(pt?.fname||'')}" ${live('name')}>`,{required:true})}
          ${field('pm-lname','Last Name',`<input id="pm-lname" maxlength="50" autocomplete="off" value="${escapeHtml(pt?.lname||'')}" ${live('name')}>`,{required:true})}
          ${field('pm-birth','Date of Birth',campusDateFieldHtml('pm-birth',pt?.birthDate||'','Date of Birth','',appState.clinicInformation.TODAY),{required:true,hint:'Must match the birth date on the patient\'s ID.'})}
          ${field('pm-gender','Sex',`<select id="pm-gender" ${live()}>${options([['Male'],['Female']],pt?.gender||'','Select')}</select>`,{required:true})}
        </div>
      </fieldset>

      <fieldset class="registration-group">
        <legend>School details</legend>
        <div class="form-row">
          ${field('pm-ptype','Person Type',`<select id="pm-ptype" ${bindAction('change',()=>syncPatientFormType())}>${options([['Student'],['Teaching Personnel'],['Non-Teaching Personnel']],type)}</select>`,{required:true})}
          ${field('pm-college','College',`<select id="pm-college" ${live()}></select>`,{required:true})}
          ${field('pm-idno','Student ID No.',`<input id="pm-idno" inputmode="numeric" autocomplete="off" value="${escapeHtml(pt?.idNo||'')}" ${pt?.idNo?`data-original="${escapeHtml(pt.idNo)}"`:''} ${live('digits')}>`,{required:true,hint:'Student ID numbers have exactly 7 digits.'})}
          <div class="form-group" id="pm-session-group">
            <label for="pm-class-session">Class Session <span class="required">*</span></label>
            <select id="pm-class-session" ${live()}>${options([['Morning'],['Evening']],['Morning','Evening'].includes(pt?.classSession)?pt.classSession:'','Select session')}</select>
            <p class="form-note field-hint" id="pm-class-session-help">The student's regular class schedule.</p>
            <p class="registration-field-error" id="pm-class-session-error" aria-live="polite" hidden></p>
          </div>
        </div>
      </fieldset>

      ${editing?'':`<fieldset class="registration-group">
        <legend>Account</legend>
        <div class="form-row">
          ${field('pm-email','Email',`<input id="pm-email" type="email" maxlength="150" autocomplete="off" autocapitalize="none" spellcheck="false" ${live('email')}>`,{required:true,hint:'A verification and password-setup link is sent here. The patient must open it before signing in.'})}
          ${field('pm-username','Username',`<input id="pm-username" maxlength="20" autocomplete="off" autocapitalize="none" spellcheck="false" ${live('username')}>`,{required:true,hint:'Use 4–20 letters or numbers. You may also use a period (.), underscore (_) or hyphen (-).'})}
        </div>
      </fieldset>`}

      <fieldset class="registration-group">
        <legend>Contact &amp; emergency</legend>
        <div class="form-row">
          ${field('pm-contact','Contact No.',`<input id="pm-contact" type="tel" inputmode="tel" maxlength="24" placeholder="09… or +63…" value="${escapeHtml(pt?.contact||'')}" ${live('phone')}>`,{hint:'Use 09XXXXXXXXX or +639XXXXXXXXX.'})}
          ${field('pm-addr','Address',`<input id="pm-addr" maxlength="300" value="${escapeHtml(pt?.address||'')}" ${live('text')}>`)}
          ${field('pm-ename','Emergency Contact Name',`<input id="pm-ename" maxlength="100" value="${escapeHtml(pt?.emergencyName||'')}" ${live('name')}>`)}
          ${field('pm-econtact','Emergency Contact No.',`<input id="pm-econtact" type="tel" inputmode="tel" maxlength="24" placeholder="09… or +63…" value="${escapeHtml(pt?.emergencyContact||'')}" ${live('phone')}>`)}
        </div>
      </fieldset>

      <fieldset class="registration-group">
        <legend>Clinical information</legend>
        <div class="form-row">
          ${field('pm-blood','Blood Type',`<select id="pm-blood">${options(['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'].map(v=>[v]),String(pt?.blood||'Unknown'))}</select>`)}
          ${field('pm-height','Height (cm)',`<input id="pm-height" type="number" inputmode="decimal" min="40" max="260" step=".1" value="${height}" ${live()}>`)}
          ${field('pm-weight','Weight (kg)',`<input id="pm-weight" type="number" inputmode="decimal" min="1" max="500" step=".1" value="${weight}" ${live()}>`)}
          ${field('pm-allergy','Allergies',`<input id="pm-allergy" maxlength="300" value="${escapeHtml(pt?.allergies||'')}" placeholder="e.g. Penicillin, or None" ${live('text')}>`,{full:true})}
          ${field('pm-history','Medical History',`<textarea id="pm-history" maxlength="5000" rows="3" ${bindAction('input',()=>{})}>${escapeHtml(pt?.medHistory||'')}</textarea>`,{full:true})}
        </div>
      </fieldset>

      ${editing?'':`<fieldset class="registration-group">
        <legend>Identity verification</legend>
        <p class="form-note registration-group-note">Confirm the patient in person, then capture the same evidence as online registration.</p>
        ${verificationStepsHtml('pm',{
          subject:'the patient',
          onSelfie:()=>{setVerificationScope('pm');openCamera('selfie');},
          onIdCamera:()=>{setVerificationScope('pm');openCamera('id-'+verificationState('pm').side);},
          onShow:side=>selectRegistrationIdSide(side,'pm'),
          onUpload:(input,side)=>{setVerificationScope('pm');handleRegistrationIdUpload(input,side,'pm');}
        })}
      </fieldset>
      <div class="privacy-agree">
        <input type="checkbox" id="pm-privacy-ack" ${bindAction('change',(event,element)=>validateRegistrationField(element.id))}>
        <label for="pm-privacy-ack">
          The patient has reviewed and acknowledges the
          <a ${bindAction('click',(event,element)=>{event.preventDefault();openPrivacyNotice()})}>CampusCare Privacy Notice</a>
          (version ${escapeHtml(appState.data.DB.settings?.privacyPolicyVersion||'1.0')}).
        </label>
      </div>
      <p class="registration-field-error" id="pm-privacy-ack-error" aria-live="polite" hidden></p>`}
      ${realMode&&editing?`<div class="tech-note">Changes are recorded in the activity log.</div>`:''}
    </div>

    <div class="modal-footer">
      <button class="btn btn-primary" id="pm-save-btn" ${bindAction('click',(event,element)=>{savePatient(id)})}>${editing?'Save Changes':'Create Patient Account'}</button>
    </div>
  </div>`);
  // The hidden date input reports changes so its error clears once a date is chosen.
  document.getElementById('pm-birth')?.setAttribute('data-action-change','registration-field-blur');
  syncPatientFormType();
  const college=document.getElementById('pm-college');
  if(college&&pt?.college)college.value=pt.college;
  if(!editing){renderRegistrationIds('pm');}
}

export async function savePatient(id){
  const editing=id!==null&&id!==undefined&&id!=='null';
  const value=elementId=>document.getElementById(elementId)?.value.trim()||'';
  const msg=document.getElementById('ptm-msg');
  const btn=document.getElementById('pm-save-btn');
  hideAlert(msg);

  // Same behaviour as public registration: every problem is shown beside its field at once.
  const invalid=validateRegistrationForm('pm-');
  if(invalid.length){
    const first=invalid[0];
    const target=document.getElementById(first)?.type==='hidden'
      ?document.getElementById(first).closest('.form-group')?.querySelector('.modern-date-btn')
      :first==='pm-selfie'?document.getElementById('pm-selfie-camera-button'):first==='pm-id'?document.getElementById('pm-id-camera-button'):document.getElementById(first);
    target?.scrollIntoView?.({block:'center',behavior:'smooth'});target?.focus?.({preventScroll:true});
    showAlert(msg,invalid.length===1?'Please fix the highlighted field.':`Please fix the ${invalid.length} highlighted fields.`);
    return;
  }

  const personType=value('pm-ptype')||'Student';
  const contact=value('pm-contact');
  const payload={
    first_name:value('pm-fname'),
    last_name:value('pm-lname'),
    contact_number:contact?normalizePhilippineMobile(contact):'',
    id_number:value('pm-idno'),
    birth_date:value('pm-birth'),
    sex:value('pm-gender'),
    blood_type:value('pm-blood')||'Unknown',
    college:value('pm-college'),
    person_type:personType,
    class_session:personType==='Student'?value('pm-class-session'):null,
    height_cm:value('pm-height')||null,
    weight_kg:value('pm-weight')||null,
    address:value('pm-addr'),
    allergies:value('pm-allergy'),
    medical_history:value('pm-history'),
    emergency_contact_name:value('pm-ename'),
    emergency_contact_number:value('pm-econtact')?normalizePhilippineMobile(value('pm-econtact')):''
  };
  const email=value('pm-email').toLowerCase(),username=value('pm-username');
  const evidence=verificationState('pm');

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent=editing?'Saving securely…':'Creating account…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      if(editing){
        const pt=appState.data.DB.patients.find(p=>p.id===Number(id));
        if(!pt?._realSupabase)throw new Error('The real patient record could not be identified.');
        await patientAction({action:'update',patient_id:pt.dbPatientId,...payload});
        await syncAdminDirectoryFromSupabase();
        toast('Patient record updated.','success');
      }else{
        const result=await patientAction({
          action:'create_assisted',
          email,username,
          selfie_data_url:evidence.selfie,
          id_front_data_url:evidence.ids.front?.dataUrl,
          id_back_data_url:evidence.ids.back?.dataUrl,
          privacy_acknowledged:true,
          ...payload
        });
        await syncAdminDirectoryFromSupabase();
        resetVerificationState('pm');
        toast(result.verification_email_sent
          ?'Patient account created. A verification and password-setup email was sent — the patient must open it before signing in.'
          :'Patient account created, but the verification email could not be sent. Ask the patient to use "Resend verification email" on the login page.',
          result.verification_email_sent?'success':'warning',8000);
      }
    }else{
      const age=ageFromBirthDate(payload.birth_date);
      const data={
        fname:payload.first_name,lname:payload.last_name,age,birthDate:payload.birth_date,
        gender:payload.sex,blood:payload.blood_type,
        contact:payload.contact_number,college:payload.college,
        personType,classSession:payload.class_session||'',
        height:payload.height_cm?`${payload.height_cm}cm`:'',
        weight:payload.weight_kg?`${payload.weight_kg}kg`:'',
        address:payload.address,allergies:payload.allergies,
        medHistory:payload.medical_history,
        emergencyName:payload.emergency_contact_name,
        emergencyContact:payload.emergency_contact_number,
        idNo:payload.id_number
      };
      if(editing){
        const idx=appState.data.DB.patients.findIndex(p=>p.id===Number(id));
        if(idx>=0)appState.data.DB.patients[idx]={...appState.data.DB.patients[idx],...data};
        toast('Patient updated.','success');
      }else{
        const newUserId=appState.data.DB.nextUserId++;
        appState.data.DB.users.push({
          id:newUserId,username,email,role:'Patient',fname:data.fname,lname:data.lname,
          contact:payload.contact_number,status:'Active',approved:true,
          verified:true,profilePhoto:'',idPhoto:evidence.ids.front?.dataUrl||'',
          createdAt:appState.clinicInformation.TODAY
        });
        appState.data.DB.patients.push({id:appState.data.DB.nextPatientId++,...data,userId:newUserId,createdAt:appState.clinicInformation.TODAY});
        persistDB();
        resetVerificationState('pm');
        toast('Patient added.','success');
      }
    }

    closeAllModals();
    if(appState.navigationRaceProtection.campusActivePageId==='patients')await renderPatients();
  }catch(e){
    // Server field problems (for example a taken username) appear beside the matching field.
    const fields=Object.entries(e?.fieldErrors||{}).filter(([key])=>PATIENT_FORM_SERVER_FIELDS[key]);
    fields.forEach(([key,message])=>setRegistrationFieldError(PATIENT_FORM_SERVER_FIELDS[key],String(message)));
    showAlert(msg,fields.length?'Please fix the highlighted fields.':e?.message||'Unable to save the patient record.');
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
  // Certificates are the issuing doctor's records; other roles do not see them here.
  const showCerts=appState.auth.currentUser.role==='Doctor';
  // Visit notes, diagnoses and prescriptions are shown to doctors only.
  const isDoctor=showCerts;
  const certs=(appState.data.DB.certRequests||[]).filter(c=>c.patientId===id&&c.doctorId===appState.auth.currentUser.id).sort((a,b)=>byNewest(a.issuedAt||a.requestedAt,b.issuedAt||b.requestedAt));
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
    ...(isDoctor?[['treatments',`Treatments (${treats.length})`,table(['Date','Diagnosis','Prescription','Doctor'],treats.map(t=>`<tr><td>${fmtDate(t.date)}</td><td>${val(t.diagnosis)}</td><td>${val(t.prescription)}</td><td>${doctor(t.doctorId)}</td></tr>`),'No treatments on record.')]]:[]),
    ['appointments',`Appointments (${appts.length})`,table(['Date','Time','Clinic','Service','Doctor','Status'],appts.map(a=>`<tr><td>${fmtDate(a.date)}</td><td>${a.time?fmtTime(a.time):'—'}</td><td>${val(a.clinic)}</td><td>${val(a.service)}</td><td>${doctor(a.doctorId)}</td><td>${statusBadge(a.status)}</td></tr>`),'No appointments on record.')],
    ...(showCerts?[['certificates',`Certificates (${certs.length})`,table(['Date','Purpose','Certificate No.','Status'],certs.map(c=>`<tr><td>${(c.issuedAt||c.requestedAt)?fmtDate(String(c.issuedAt||c.requestedAt).slice(0,10)):'—'}</td><td>${val(c.purpose)}</td><td>${val(c.certNo)}</td><td>${statusBadge(c.status)}</td></tr>`),'No certificates issued by you yet.')]]:[]),
    ...(showCerts?[['fitness',`Fitness (${fitness.length})`,table(['Requested','Sport / Event','Decision','Status'],fitness.map(f=>`<tr><td>${(f.requestedDate||f.date)?fmtDate(String(f.requestedDate||f.date).slice(0,10)):'—'}</td><td>${val(f.sport)}</td><td>${val(f.decision)}</td><td>${statusBadge(f.status)}</td></tr>`),'No fitness assessments.')]]:[])
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
        ${appState.auth.currentUser.role==='Doctor'?`<button class="btn btn-purple btn-sm" ${bindAction('click',(event,element)=>{openClinicalCopilot((id))})}><i class="bi bi-stars" aria-hidden="true"></i> Clinical Copilot</button>`:''}
        ${appState.auth.currentUser.role==='Doctor'&&!pt.archived?`<button class="btn btn-sm" ${bindAction('click',()=>{closeAllModals();openNewCertificateModal(id)})}><i class="bi bi-file-earmark-medical" aria-hidden="true"></i> Issue Certificate</button>`:''}
        ${isDoctor?`<button class="btn btn-info btn-sm" ${bindAction('click',(event,element)=>{viewPatientFHIR((id))})}>FHIR Preview</button>
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
        await setPatientArchived(p,true);
        toastWithUndo(`${p.fname} ${p.lname}'s record archived.`,()=>setPatientArchived(p,false),{undoneMessage:'Patient record restored.'});
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
        await setPatientArchived(p,false);
        toastWithUndo(`${p.fname} ${p.lname}'s record restored.`,()=>setPatientArchived(p,true),{undoneMessage:'Patient record archived again.'});
      }catch(e){
        toast(e?.message||'Unable to restore the patient record.','error');
      }
    }
  });
}

// Archive or restore, then refresh the list.
async function setPatientArchived(p,archived){
  if(p._realSupabase){
    await patientAction({action:archived?'archive':'restore',patient_id:p.dbPatientId});
    await syncAdminDirectoryFromSupabase();
  }else{
    p.archived=archived;
    p.archivedAt=archived?new Date().toLocaleString():null;
    if(archived)p.archivedBy=appState.auth.currentUser.id;
    persistDB();
  }
  if(appState.navigationRaceProtection.campusActivePageId==='patients')await renderPatients();
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
