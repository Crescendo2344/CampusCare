// profileDetails: what a person gave at registration, shown back on their profile, and the health and
// emergency details a patient fills in afterwards (registration does not ask for them).
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
import {userDetailField} from './userManagement.js';
import {patientAction,syncCurrentPatientFromSupabase} from './patientService.js';
import {toast} from './theme.js';
import {bindAction} from '../dependencies.js';
import {ageFromBirthDate} from '../domain/patient-records.js';

const idLabel=type=>type==='Student'?'Student ID No.':'Employee No.';
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
        ${type==='Student'?userDetailField('Class session',pt?.classSession):''}
      </div>
    </div>`;
  }
  const fields=[userDetailField('Username',u.username?'@'+u.username:''),userDetailField(u.role==='Staff'?'Employee No.':'ID No.',u.idNo)];
  if(u.role==='Staff')fields.push(userDetailField('Clinic',u.clinic||'Not set'));
  if(u.role==='Doctor'){
    fields.push(userDetailField('Specialization',u.specialty));
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
  const number=v=>String(v||'').replace(/[^\d.]/g,'');
  const isStudent=(pt.personType||appState.auth.currentUser?.personType)==='Student';
  const bloodTypes=['Unknown','A+','A-','B+','B-','AB+','AB-','O+','O-'];
  const missing=!pt.emergencyName||!pt.emergencyContact||!pt.address;
  return `<div class="card" id="acc-health">
    <div class="card-header"><div><h3>Health &amp; Emergency Details</h3><div class="tech-note">Doctors see these before your visit. Keep them up to date.</div></div></div>
    ${missing?'<div class="alert alert-warning show" style="display:block">Please complete your address and emergency contact.</div>':''}
    <div id="acc-health-msg"></div>
    <div class="form-row">
      <div class="form-group full"><label for="hd-address">Home address</label><input id="hd-address" maxlength="300" autocomplete="street-address" value="${val(pt.address)}" placeholder="House no., street, barangay, city"></div>
      <div class="form-group"><label for="hd-ename">Emergency contact name</label><input id="hd-ename" maxlength="100" value="${val(pt.emergencyName)}" placeholder="e.g. parent or guardian"></div>
      <div class="form-group"><label for="hd-econtact">Emergency contact no.</label><input id="hd-econtact" type="tel" inputmode="tel" maxlength="24" value="${val(pt.emergencyContact)}" placeholder="09XXXXXXXXX"></div>
      <div class="form-group"><label for="hd-blood">Blood type</label><select id="hd-blood">${bloodTypes.map(b=>`<option ${String(pt.blood||'Unknown')===b?'selected':''}>${b}</option>`).join('')}</select></div>
      <div class="form-group"><label for="hd-height">Height (cm)</label><input id="hd-height" type="number" inputmode="decimal" min="40" max="260" step=".1" value="${number(pt.height)}"></div>
      <div class="form-group"><label for="hd-weight">Weight (kg)</label><input id="hd-weight" type="number" inputmode="decimal" min="1" max="500" step=".1" value="${number(pt.weight)}"></div>
      <div class="form-group full"><label for="hd-allergies">Allergies</label><input id="hd-allergies" maxlength="300" value="${val(pt.allergies)}" placeholder="e.g. Penicillin, shrimp, or None"></div>
      <div class="form-group full"><label for="hd-history">Medical history</label><textarea id="hd-history" maxlength="5000" rows="3" placeholder="Past illnesses, surgeries, maintenance medicines">${val(pt.medHistory)}</textarea></div>
      ${isStudent?`<div class="form-group"><label for="hd-course">Course</label><input id="hd-course" maxlength="120" value="${val(pt.course)}" placeholder="e.g. BS Information Technology"></div>
      <div class="form-group"><label for="hd-major">Major</label><input id="hd-major" maxlength="120" value="${val(pt.major)}" placeholder="If any"></div>
      <p class="form-note full" style="margin-top:-.3rem">Shifted to another program? Update your course and major here.</p>`:''}
    </div>
    <button class="btn btn-primary btn-sm" id="hd-save" ${bindAction('click',()=>saveHealthDetails())}>Save Details</button>
  </div>`;
}

export async function saveHealthDetails(){
  const v=id=>document.getElementById(id)?.value?.trim()??'';
  const btn=document.getElementById('hd-save');
  const msg=document.getElementById('acc-health-msg');
  const phone=v('hd-econtact').replace(/[\s()-]/g,'');
  if(phone&&!/^(09\d{9}|\+639\d{9})$/.test(phone)){
    msg.innerHTML='<div class="alert alert-danger show">Enter the emergency contact number as 09XXXXXXXXX or +639XXXXXXXXX.</div>';
    document.getElementById('hd-econtact')?.focus();return;
  }
  msg.innerHTML='';
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await patientAction({action:'self_update',address:v('hd-address'),emergency_contact_name:v('hd-ename'),emergency_contact_number:phone,
      blood_type:v('hd-blood')||'Unknown',height_cm:v('hd-height'),weight_kg:v('hd-weight'),allergies:v('hd-allergies'),
      medical_history:v('hd-history'),course:v('hd-course'),major:v('hd-major')});
    await syncCurrentPatientFromSupabase();
    toast('Your details were saved.','success');
  }catch(error){
    msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'Your details could not be saved.')}</div>`;
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Save Details';}
  }
}
