// profileDetails: what a person gave at registration, shown back on their profile, and the health and
// emergency details a patient fills in afterwards (registration does not ask for them).
import {clinicForSpecialization} from '../../supabase/functions/_shared/clinic-services.js';
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
import {userDetailField} from './userManagement.js';
import {patientAction,syncCurrentPatientFromSupabase} from './patientService.js';
import {toast} from './theme.js';
import {bindAction} from '../dependencies.js';
import {ageFromBirthDate} from '../domain/patient-records.js';

const idLabel=type=>type==='Student'?'Student ID No.':'Employee No.';
const numeric=v=>String(v||'').replace(/[^\d.]/g,'');
const unitLabel=type=>type==='Non-Teaching Personnel'?'Department':'College';

// Every answer from the registration form appears here, read-only (the clinic verified them).
export function registrationDetailsCard(u,pt){
  if(u.role==='Patient'){
    const type=u.personType||pt?.personType||'';
    const age=ageFromBirthDate(pt?.birthDate);
    return `<div class="card" id="acc-registration">
      <div class="card-header"><div><h3>Registration Details</h3><div class="tech-note">From your verified registration. Ask the clinic to correct anything that is wrong.</div></div></div>
      <div class="user-detail-fields">
        ${userDetailField('Username',u.username?'@'+u.username:'')}
        ${userDetailField('Patient type',type)}
        ${userDetailField(unitLabel(type),u.college||pt?.college)}
        ${userDetailField(idLabel(type),u.idNo||pt?.idNo)}
        ${userDetailField('Date of birth',pt?.birthDate?`${fmtDate(pt.birthDate)}${age!==''?` (${age} years old)`:''}`:'')}
        ${userDetailField('Sex',pt?.gender)}
      </div>
    </div>`;
  }
  const fields=[userDetailField('Username',u.username?'@'+u.username:''),userDetailField(u.role==='Staff'?'Employee No.':'ID No.',u.idNo)];
  if(u.role==='Staff')fields.push(userDetailField('Clinic',u.clinic||'Not set'));
  if(u.role==='Doctor'){
    fields.push(userDetailField('Clinic',clinicForSpecialization(u.specialty)));
    fields.push(userDetailField('Services rendered',(u.servicesRendered||[]).join(', '),true));
  }
  return `<div class="card" id="acc-registration">
    <div class="card-header"><h3>Work Details</h3></div>
    <div class="user-detail-fields">${fields.join('')}</div>
  </div>`;
}

export function healthDetailsCard(pt){
  if(!pt)return '';
  const val=v=>escapeHtml(v||'');
  const missing=!pt.emergencyName||!pt.emergencyContact||!pt.address;
  return `<div class="card" id="acc-health">
    <div class="card-header"><div><h3>Emergency Details</h3><div class="tech-note">Who the clinic should contact in an emergency. Keep them up to date.</div></div></div>
    ${missing?'<div class="alert alert-warning show" style="display:block">Please complete your address and emergency contact.</div>':''}
    <div id="acc-health-msg"></div>
    <div id="hd-view-fields">
      <div class="user-detail-fields">
        ${userDetailField('Home address',pt.address,true)}
        ${userDetailField('Emergency contact name',pt.emergencyName)}
        ${userDetailField('Emergency contact no.',pt.emergencyContact)}
      </div>
      <button class="btn btn-sm" style="margin-top:.8rem" ${bindAction('click',()=>setHealthEditing(true))}><i class="bi bi-pencil" aria-hidden="true"></i> Edit</button>
    </div>
    <div id="hd-edit-fields" hidden>
      <div class="form-row">
        <div class="form-group full"><label for="hd-address">Home address</label><input id="hd-address" maxlength="300" autocomplete="street-address" value="${val(pt.address)}" placeholder="House no., street, barangay, city"></div>
        <div class="form-group"><label for="hd-ename">Emergency contact name</label><input id="hd-ename" maxlength="100" value="${val(pt.emergencyName)}" placeholder="e.g. parent or guardian"></div>
        <div class="form-group"><label for="hd-econtact">Emergency contact no.</label><input id="hd-econtact" type="tel" inputmode="tel" maxlength="24" value="${val(pt.emergencyContact)}" placeholder="09XXXXXXXXX"></div>
      </div>
      <button class="btn btn-primary btn-sm" id="hd-save" ${bindAction('click',()=>saveHealthDetails())}>Save Changes</button>
      <button class="btn btn-sm" ${bindAction('click',()=>setHealthEditing(false))}>Cancel</button>
    </div>
  </div>`;
}

function setHealthEditing(editing){
  const pt=appState.auth.currentPatient;
  const card=document.getElementById('acc-health');
  if(!pt||!card)return;
  if(!editing){card.outerHTML=healthDetailsCard(pt);return;}
  document.getElementById('hd-view-fields').hidden=true;
  document.getElementById('hd-edit-fields').hidden=false;
  document.getElementById('hd-address')?.focus();
}

// Course and major live in the Profile Information card and save together with email and contact.
const isStudentRecord=pt=>pt?.personType==='Student';

export function programViewTiles(pt){
  return isStudentRecord(pt)?`${userDetailField('Course',pt.course)}${userDetailField('Major',pt.major)}`:'';
}

export function programEditFields(pt){
  if(!isStudentRecord(pt))return '';
  const val=v=>escapeHtml(v||'');
  return `<div class="form-group"><label for="hd-course">Course</label><input id="hd-course" maxlength="120" value="${val(pt.course)}" placeholder="e.g. BS Information Technology"></div>
    <div class="form-group"><label for="hd-major">Major</label><input id="hd-major" maxlength="120" value="${val(pt.major)}" placeholder="If any"></div>`;
}

// The course and major typed into the profile form, or null when the form has none (not a student).
export function readProgramFields(){
  const course=document.getElementById('hd-course'),major=document.getElementById('hd-major');
  return course&&major?{course:course.value.trim(),major:major.value.trim()}:null;
}

export function programChanged(program){
  const pt=appState.auth.currentPatient||{};
  return !!program&&(program.course!==String(pt.course||'')||program.major!==String(pt.major||''));
}

export async function savePatientProgram({course,major}){
  const pt=appState.auth.currentPatient||{};
  // self_update overwrites every field, so resend the health details unchanged.
  await patientAction({action:'self_update',address:pt.address||'',emergency_contact_name:pt.emergencyName||'',emergency_contact_number:pt.emergencyContact||'',
    blood_type:pt.blood||'Unknown',height_cm:numeric(pt.height),weight_kg:numeric(pt.weight),allergies:pt.allergies||'',
    medical_history:pt.medHistory||'',course,major});
  await syncCurrentPatientFromSupabase();
}

export async function saveHealthDetails(){
  const v=id=>document.getElementById(id)?.value?.trim()??'';
  const btn=document.getElementById('hd-save');
  const msg=document.getElementById('acc-health-msg');
  const pt=appState.auth.currentPatient||{};
  const phone=v('hd-econtact').replace(/[\s()-]/g,'');
  if(phone&&!/^(09\d{9}|\+639\d{9})$/.test(phone)){
    msg.innerHTML='<div class="alert alert-danger show">Enter the emergency contact number as 09XXXXXXXXX or +639XXXXXXXXX.</div>';
    document.getElementById('hd-econtact')?.focus();return;
  }
  msg.innerHTML='';
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await patientAction({action:'self_update',address:v('hd-address'),emergency_contact_name:v('hd-ename'),emergency_contact_number:phone,
      blood_type:pt.blood||'Unknown',height_cm:numeric(pt.height),weight_kg:numeric(pt.weight),allergies:pt.allergies||'',
      medical_history:pt.medHistory||'',course:pt.course||'',major:pt.major||''});
    await syncCurrentPatientFromSupabase();
    toast('Your details were saved.','success');
    setHealthEditing(false);
  }catch(error){
    msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'Your details could not be saved.')}</div>`;
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Save Changes';}
  }
}
