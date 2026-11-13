// The patient's profile meter: a ring with the percentage, the level reached and what is left,
// with a "Finish verification" form that asks only for the missing details.
import {profileCompleteness} from '../domain/profile-completeness.js';
import {escapeHtml} from './issueReports.js';
import {bindAction} from '../dependencies.js';
import {navTo} from './navigationRaceProtection.js';
import {closeAllModals,openModal} from './modals.js';
import {state as appState} from '../app/state.js';
import {patientAction,syncCurrentPatientFromSupabase} from './patientService.js';
import {profileAction,refreshCurrentProfileContact} from './workflowRequests.js';
import {renderPage} from './loadingSkeletons.js';
import {toast} from './theme.js';
import {BLOOD_TYPES,allergiesValidationError,birthDateValidationError,emergencyContactNameError,emergencyContactNumberError,
  heightValidationError,weightValidationError,contactValidationError} from '../../supabase/functions/_shared/registration-validation.js';

const ring=(percent,tone)=>`<div class="ps-ring ps-${tone}" style="--ps:${percent}" role="img" aria-label="Profile ${percent}% complete"><span>${percent}%</span></div>`;
const stepHtml=s=>`<li class="ps-step ${s.done?'done':''}"><i class="bi ${s.done?'bi-check-circle-fill':'bi-circle'}" aria-hidden="true"></i><span>${escapeHtml(s.label)}</span></li>`;

// compact: the dashboard version, showing only the next few things to do.
export function profileStrengthCardHtml(user,pt,{compact=false}={}){
  if(!user||user.role!=='Patient'||!pt)return '';
  const {percent,level,steps,missing}=profileCompleteness(user,pt);
  const complete=!missing.length;
  const formItems=missing.filter(s=>s.section==='Finish verification');
  const list=compact?missing.slice(0,3):steps;
  return `<div class="card ps-card" id="profile-strength">
    <div class="ps-head">${ring(percent,level.tone)}
      <div class="ps-title"><h3>${complete?'<i class="bi bi-patch-check-fill" aria-hidden="true"></i> ':''}${escapeHtml(level.label)}</h3>
        <p>${complete?'Your profile has everything the clinic needs.':`${missing.length} of ${steps.length} details left to complete your profile.`}</p></div>
      ${formItems.length?`<button type="button" class="btn btn-primary btn-sm" ${bindAction('click',()=>openFinishVerification())}>Finish verification</button>`
        :missing.some(s=>s.id==='photo')?`<button type="button" class="btn btn-primary btn-sm" ${bindAction('click',()=>navTo('my-account'))}>Add profile photo</button>`:''}
    </div>
    ${complete&&compact?'':`<ul class="ps-steps">${list.map(stepHtml).join('')}</ul>`}
  </div>`;
}

const field=(id,label,control)=>`<div class="form-group"><label for="fv-${id}">${label}</label>${control}<p class="registration-field-error" id="fv-${id}-error" hidden></p></div>`;
const unit=v=>String(v||'').replace(/[^\d.]/g,'');

// One form for every missing detail; what is already on file is not asked again.
export function openFinishVerification(){
  const user=appState.auth.currentUser,pt=appState.auth.currentPatient;if(!user||!pt)return;
  const missing=new Set(profileCompleteness(user,pt).missing.map(s=>s.id));
  const today=appState.clinicInformation.TODAY;
  const sections=[
    missing.has('contact')&&field('contact','Mobile number',`<input id="fv-contact" type="tel" inputmode="tel" maxlength="13" placeholder="09XXXXXXXXX">`),
    missing.has('personal')&&`<div class="form-row">${!pt.birthDate?field('birth','Date of birth',`<input id="fv-birth" type="date" max="${today}">`):''}${!pt.gender?field('sex','Sex',`<select id="fv-sex"><option value="">Select</option><option>Male</option><option>Female</option></select>`):''}</div>`,
    missing.has('program')&&field('course','Course',`<input id="fv-course" maxlength="120" placeholder="e.g. BS Information Technology">`),
    missing.has('session')&&field('session','Class session',`<select id="fv-session"><option value="">Select</option><option value="Morning">Morning class</option><option value="Evening">Evening class</option></select>`),
    missing.has('address')&&field('address','Home address',`<input id="fv-address" maxlength="300" placeholder="House no., street, barangay, city">`),
    missing.has('emergency')&&`<div class="form-row">${field('ename','Emergency contact name',`<input id="fv-ename" maxlength="100" value="${escapeHtml(pt.emergencyName||'')}">`)}${field('econtact','Emergency contact number',`<input id="fv-econtact" type="tel" inputmode="tel" maxlength="13" placeholder="09XXXXXXXXX" value="${escapeHtml(pt.emergencyContact||'')}">`)}</div>`,
    missing.has('blood')&&field('blood','Blood type',`<select id="fv-blood"><option value="">Select</option>${BLOOD_TYPES.filter(b=>b!=='Unknown').map(b=>`<option>${b}</option>`).join('')}</select>`),
    missing.has('body')&&`<div class="form-row">${field('height','Height',`<div class="fv-unit"><input id="fv-height" type="number" min="1" max="250" step="0.1" value="${escapeHtml(unit(pt.height))}"><select id="fv-height-unit" aria-label="Height unit"><option value="cm">cm</option><option value="in">in</option></select></div>`)}${field('weight','Weight (kg)',`<input id="fv-weight" type="number" min="20" max="300" step="0.1" value="${escapeHtml(unit(pt.weight))}">`)}</div>`,
    missing.has('allergies')&&field('allergies','Allergies',`<input id="fv-allergies" maxlength="300" placeholder='List them, or type "None"'>`)
  ].filter(Boolean);
  if(!sections.length){if(missing.has('photo'))navTo('my-account');return;}
  openModal(`<div class="modal fv-modal" role="dialog" aria-labelledby="fv-title">
    <div class="modal-header"><div><h3 id="fv-title">Finish verification</h3><div class="text-muted">${sections.length} detail${sections.length===1?'':'s'} left</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">${sections.join('')}<div id="fv-msg"></div></div>
    <div class="modal-footer"><button type="button" class="btn" ${bindAction('click',()=>closeAllModals())}>Later</button><button type="button" class="btn btn-primary" id="fv-save" ${bindAction('click',()=>saveFinishVerification())}>Save</button></div>
  </div>`);
}

async function saveFinishVerification(){
  const user=appState.auth.currentUser,pt=appState.auth.currentPatient||{};
  const v=id=>document.getElementById('fv-'+id)?.value?.trim();
  const has=id=>!!document.getElementById('fv-'+id);
  const errors={};
  // Anything can be left for later; only what is filled in is checked and saved.
  const given=id=>has(id)&&!!v(id);
  const heightCm=given('height')?(document.getElementById('fv-height-unit')?.value==='in'?Math.round(Number(v('height'))*2.54*10)/10:Number(v('height'))):null;
  if(given('contact'))errors.contact=contactValidationError(v('contact'));
  if(given('birth'))errors.birth=birthDateValidationError(v('birth'),appState.clinicInformation.TODAY);
  if(given('ename')||given('econtact')){
    errors.ename=emergencyContactNameError(v('ename'));
    errors.econtact=emergencyContactNumberError(v('econtact'),v('contact')||user.contact);
  }
  if(given('height'))errors.height=heightValidationError(heightCm);
  if(given('weight'))errors.weight=weightValidationError(v('weight'));
  if(given('allergies'))errors.allergies=allergiesValidationError(v('allergies'));
  const anything=['contact','birth','sex','course','session','address','ename','econtact','blood','height','weight','allergies'].some(given);
  if(!anything){const box=document.getElementById('fv-msg');if(box)box.innerHTML='<div class="alert alert-warning show">Fill in at least one detail to save.</div>';return;}
  for(const el of document.querySelectorAll('.fv-modal .registration-field-error')){el.hidden=true;el.textContent='';}
  const problems=Object.entries(errors).filter(([,m])=>m);
  for(const [id,message] of problems){const el=document.getElementById(`fv-${id}-error`);if(el){el.textContent=message;el.hidden=false;}}
  if(problems.length){document.getElementById('fv-'+problems[0][0])?.focus();return;}
  const btn=document.getElementById('fv-save');if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    // self_update replaces every health field, so values already on file are sent back unchanged.
    await patientAction({action:'self_update',
      address:given('address')?v('address'):pt.address||'',
      emergency_contact_name:given('ename')?v('ename'):pt.emergencyName||'',emergency_contact_number:given('econtact')?v('econtact'):pt.emergencyContact||'',
      blood_type:given('blood')?v('blood'):pt.blood||'Unknown',
      height_cm:heightCm??unit(pt.height),weight_kg:given('weight')?v('weight'):unit(pt.weight),
      allergies:given('allergies')?v('allergies'):pt.allergies||'',medical_history:pt.medHistory||'',
      course:given('course')?v('course'):pt.course||'',major:pt.major||'',
      ...(given('session')?{class_session:v('session')}:{}),...(given('birth')?{birth_date:v('birth')}:{}),...(given('sex')?{sex:v('sex')}:{})});
    if(given('contact')){await profileAction({action:'update_contact',contact_number:v('contact')});await refreshCurrentProfileContact();}
    await syncCurrentPatientFromSupabase();
    closeAllModals();
    toast('Saved. You can finish the rest any time.','success');
    renderPage(appState.navigationRaceProtection.campusActivePageId||'dashboard');
  }catch(e){
    const box=document.getElementById('fv-msg');
    if(box)box.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Your details could not be saved.')}</div>`;
    if(btn){btn.disabled=false;btn.textContent='Save';}
  }
}
