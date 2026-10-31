// inputValidation: imported feature APIs; state belongs to explicit application namespaces.
import {emailValidationError} from '../../supabase/functions/_shared/contact-validation.js';
import {birthDateValidationError,confirmPasswordValidationError,contactValidationError,nameValidationError,passwordValidationError,schoolIdValidationError,usernameValidationError} from '../../supabase/functions/_shared/registration-validation.js';
import {state as appState} from '../app/state.js';
import {displayMarkup,formatters,sanitizeValue,scheduleRules} from '../dependencies.js';
// ================================================================
// LIVE INPUT SANITIZATION — keeps each field to characters that make
// sense for what it holds (phone = digits only, names = letters, etc).
// ================================================================
export function sanitizeInput(el,type){
  const start=el.selectionStart, before=el.value;
  const v=sanitizeValue(el.value,type);
  if(v!==before){
    el.value=v;
    // keep the cursor roughly where the person was typing instead of jumping to the end
    const diff=before.length-v.length;
    const pos=Math.max(0,(start||v.length)-Math.max(0,diff));
    try{el.setSelectionRange(pos,pos);}catch(e){}
  }
}

// Show actionable inline feedback after leaving a field; typing clears a stale error immediately.
export function validateRegistrationContact(el,showError=true){
  return validateRegistrationField(el.id,showError);
}

// Place a message under its field, mark the control invalid and keep native validity in step.
export function setRegistrationFieldError(id,message,showError=true){
  const visible=Boolean(showError&&message);
  const node=document.getElementById(id+'-error');
  if(node){
    const text=document.createElement('span');text.textContent=visible?message:'';
    node.replaceChildren(...(visible?[text]:[]));node.hidden=!visible;
    // A domain suggestion can be applied with one tap instead of retyping the address.
    const suggested=visible&&/(^|-)email$/.test(id)&&String(message).match(/Did you mean @([a-z0-9.-]+)\?/i)?.[1];
    if(suggested){
      const apply=document.createElement('button');
      apply.type='button';apply.className='registration-field-fix';apply.textContent='Use @'+suggested;
      apply.addEventListener('click',()=>{
        const input=document.getElementById(id);
        input.value=input.value.split('@')[0]+'@'+suggested;
        validateRegistrationField(id);input.focus();
      });
      node.append(apply);
    }
  }
  // Photo steps highlight their whole panel; other fields mark the control a person interacts with.
  const group=/-(selfie|id)$/.test(id)?`${id}-group`:'';
  const field=document.getElementById(id);
  // Date fields store their value in a hidden input; the visible picker button carries the error state.
  const control=group?null:field?.type==='hidden'?field.closest('.form-group')?.querySelector('.modern-date-btn'):field;
  control?.setAttribute('aria-invalid',String(visible));
  (group?document.getElementById(group):control?.closest('.form-group'))?.classList.toggle('has-error',visible);
  document.getElementById(id)?.setCustomValidity?.(message||'');
  return message;
}

const value=id=>String(document.getElementById(id)?.value||'');
// Each registration control maps to the shared rule the server also enforces.
const registrationFieldRules={
  'r-fname':()=>nameValidationError(value('r-fname'),'First name'),
  'r-lname':()=>nameValidationError(value('r-lname'),'Last name'),
  'r-user':()=>usernameValidationError(value('r-user')),
  'r-email':()=>value('r-email').trim()?emailValidationError(value('r-email')):'Enter your email address.',
  'r-pass':()=>passwordValidationError(value('r-pass'),{username:value('r-user'),email:value('r-email')}),
  'r-pass2':()=>confirmPasswordValidationError(value('r-pass'),value('r-pass2')),
  'r-contact':()=>contactValidationError(value('r-contact')),
  'r-college':()=>value('r-college')?'':'Select your college or department.',
  'r-idno':()=>schoolIdValidationError(value('r-idno').trim(),value('r-ptype')||'Student'),
  'r-dob':()=>birthDateValidationError(value('r-dob'),appState.clinicInformation.TODAY),
  'r-sex':()=>value('r-sex')?'':'Select your sex.',
  'r-selfie':()=>appState.camera.capturedSelfieDataUrl?'':'Use the camera to take a verification selfie while holding the ID you will upload.',
  'r-id':()=>{
    const sides=appState.camera.registrationIds||{};
    if(appState.documentScanner.lastOcrDocumentType==='COR')return 'COR is not accepted. Use the front and back of your Student or Employee ID.';
    return sides.front&&sides.back?'':'Provide the front and back of your Student or Employee ID.';
  },
  'r-privacy-consent':()=>document.getElementById('r-privacy-consent')?.checked?'':'Please read and agree to the Terms of Service and the Privacy Notice and Consent.',
  // Clinic-assisted registration and patient edits (pm-*) use the same rules; account-only fields
  // exist only while creating, and photo steps only while the verification panel is on screen.
  'pm-fname':()=>nameValidationError(value('pm-fname'),'First name'),
  'pm-lname':()=>nameValidationError(value('pm-lname'),'Last name'),
  'pm-email':()=>enabled('pm-email')?(value('pm-email').trim()?emailValidationError(value('pm-email')):'Enter the patient\'s email address.'):'',
  'pm-username':()=>enabled('pm-username')?usernameValidationError(value('pm-username')):'',
  'pm-college':()=>value('pm-college')?'':'Select the college or department.',
  'pm-idno':()=>schoolIdValidationError(value('pm-idno').trim(),value('pm-ptype')||'Student'),
  'pm-birth':()=>birthDateValidationError(value('pm-birth'),appState.clinicInformation.TODAY),
  'pm-gender':()=>value('pm-gender')?'':'Select the patient\'s sex.',
  'pm-class-session':()=>value('pm-ptype')==='Student'&&!value('pm-class-session')?'Select the student\'s class session.':'',
  'pm-contact':()=>contactValidationError(value('pm-contact')),
  'pm-height':()=>rangeError('pm-height',40,260,'Height must be between 40 and 260 cm.'),
  'pm-weight':()=>rangeError('pm-weight',1,500,'Weight must be between 1 and 500 kg.'),
  'pm-ename':()=>value('pm-ename').trim()?nameValidationError(value('pm-ename'),'Emergency contact name'):'',
  'pm-econtact':()=>contactValidationError(value('pm-econtact')),
  // Staff accounts added by an administrator (au-*) follow the public registration rules.
  'au-fname':()=>nameValidationError(value('au-fname'),'First name'),
  'au-lname':()=>nameValidationError(value('au-lname'),'Last name'),
  'au-user':()=>usernameValidationError(value('au-user')),
  'au-email':()=>value('au-email').trim()?emailValidationError(value('au-email')):'Enter an email address.',
  'au-contact':()=>contactValidationError(value('au-contact')),
  'au-pass':()=>enabled('au-pass')?passwordValidationError(value('au-pass'),{username:value('au-user'),email:value('au-email')}):'',
  'au-pass2':()=>enabled('au-pass2')?confirmPasswordValidationError(value('au-pass'),value('au-pass2')):'',
  'pm-selfie':()=>!document.getElementById('pm-selfie-group')||appState.camera.verificationScopes?.pm?.selfie?'':'Take a live verification selfie of the patient holding their ID.',
  'pm-id':()=>{
    if(!document.getElementById('pm-id-group'))return '';
    const sides=appState.camera.verificationScopes?.pm?.ids||{};
    return sides.front&&sides.back?'':'Provide the front and back of the patient\'s Student or Employee ID.';
  },
  'pm-privacy-ack':()=>!document.getElementById('pm-privacy-ack')||document.getElementById('pm-privacy-ack').checked?'':'Confirm that the patient reviewed and acknowledged the Privacy Notice.'
};
const enabled=id=>{const el=document.getElementById(id);return Boolean(el&&!el.disabled);};
const rangeError=(id,min,max,message)=>{
  const raw=value(id).trim();
  if(!raw)return '';
  const number=Number(raw);
  return Number.isFinite(number)&&number>=min&&number<=max?'':message;
};
const touchedFields=new Set();

// Server answers for "already taken", keyed by the normalized value so edits re-check automatically.
const availabilityFields={
  'r-user':{field:'username',normalize:v=>v.trim().toLowerCase(),message:'This username is already taken. Try another one.'},
  'r-email':{field:'email',normalize:v=>v.trim().toLowerCase(),message:'An account with this email already exists. Log in or reset your password.'},
  'r-idno':{field:'id_number',normalize:v=>v.trim(),message:'This ID number is already registered. Contact the clinic if this is a mistake.'},
  'pm-username':{field:'username',normalize:v=>v.trim().toLowerCase(),message:'This username is already taken. Choose another one.'},
  'pm-email':{field:'email',normalize:v=>v.trim().toLowerCase(),message:'An account with this email already exists.'},
  'pm-idno':{field:'id_number',normalize:v=>v.trim(),message:'This ID number is already registered to another patient.'},
  'au-user':{field:'username',normalize:v=>v.trim().toLowerCase(),message:'This username is already taken. Choose another one.'},
  'au-email':{field:'email',normalize:v=>v.trim().toLowerCase(),message:'An account with this email already exists.'}
};
// A patient's own saved ID number is never "taken" while their record is being edited.
const unchangedOriginal=id=>{const el=document.getElementById(id);return Boolean(el?.dataset.original)&&el.value.trim()===el.dataset.original;};
const availabilityCache=new Map();
const takenMessage=id=>{
  const config=availabilityFields[id];
  if(!config||!enabled(id)||unchangedOriginal(id))return '';
  return config&&availabilityCache.get(id+':'+config.normalize(value(id)))===false?config.message:'';
};

async function checkRegistrationAvailability(id){
  const config=availabilityFields[id],normalized=config.normalize(value(id)),key=id+':'+normalized;
  if(!normalized||availabilityCache.has(key)||!enabled(id)||unchangedOriginal(id))return;
  try{
    const query=new URLSearchParams({check:'availability',field:config.field,value:normalized});
    const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/register-patient?${query}`,{headers:{apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}});
    const result=await response.json().catch(()=>({}));
    // Unknown answers (offline, rate-limited) are not cached; the server still checks on submit.
    if(typeof result.available!=='boolean')return;
    availabilityCache.set(key,result.available);
    if(config.normalize(value(id))===normalized)validateRegistrationField(id,false);
  }catch{ /* The submit request performs the authoritative duplicate check. */ }
}

// Fields left empty are only flagged when the form is submitted; leaving a filled-in field checks its format.
// Once an error is visible it updates live while the person corrects it.
const isEmptyField=id=>{
  const el=document.getElementById(id);
  if(!el)return false;
  return el.type==='checkbox'?!el.checked:!String(el.value||'').trim();
};
export function validateRegistrationField(id,showError=true,{submit=false}={}){
  const rule=registrationFieldRules[id];
  if(!rule)return '';
  if(submit||(showError&&!isEmptyField(id)))touchedFields.add(id);
  const message=rule()||takenMessage(id);
  setRegistrationFieldError(id,message,touchedFields.has(id));
  // Leaving a well-formed username, email or ID asks the server whether it is already registered.
  if(showError&&!submit&&!message&&availabilityFields[id])checkRegistrationAvailability(id);
  return message;
}

// Check every field at once, show all problems and return the invalid controls in page order.
export function validateRegistrationForm(prefix='r-'){
  return Object.keys(registrationFieldRules).filter(id=>id.startsWith(prefix)).filter(id=>validateRegistrationField(id,true,{submit:true}));
}

export function resetRegistrationFieldErrors(prefix='r-'){
  for(const id of Object.keys(registrationFieldRules).filter(id=>id.startsWith(prefix))){touchedFields.delete(id);setRegistrationFieldError(id,'',false);}
}

// Server field names (from field_errors) mapped to the patient form controls.
export const PATIENT_FORM_SERVER_FIELDS={first_name:'pm-fname',last_name:'pm-lname',username:'pm-username',email:'pm-email',contact_number:'pm-contact',college:'pm-college',id_number:'pm-idno',birth_date:'pm-birth',sex:'pm-gender',class_session:'pm-class-session'};

export function getSemester(date){return formatters.getSemester(date,appState.data.DB?.settings||{});}
export function currentSemester(){return getSemester(appState.clinicInformation.TODAY);}

export function fmtDate(...args){return formatters.fmtDate(...args);}
export function fmtDateTime(...args){return formatters.fmtDateTime(...args);}
export function fmtTime(...args){return formatters.fmtTime(...args);}
export function dayOfWeek(dateStr){return scheduleRules.dayOfWeek(dateStr);}

export function statusBadge(...args){return displayMarkup.statusBadge(...args);}
export function collegeBadge(...args){return displayMarkup.collegeBadge(...args);}
export function priorityBadge(...args){return displayMarkup.priorityBadge(...args);}

export function genId(...args){return formatters.genId(...args);}

export function svgIcon(...args){return displayMarkup.svgIcon(...args);}

export function previewFile(input,previewId){
  const el=document.getElementById(previewId);
  if(el&&input.files[0])el.textContent='✓ '+input.files[0].name;
}

export function setVerificationChip(id,state,text){
  const chip=document.getElementById(id);
  if(!chip)return;
  chip.dataset.state=state;chip.textContent=text;
}

export function resetSelfiePreview(scope='r'){
  setVerificationChip(`${scope}-selfie-chip`,'todo','Required');
  const button=document.getElementById(scope==='r'?'selfie-camera-button':`${scope}-selfie-camera-button`);
  if(button)button.innerHTML='<i class="bi bi-camera" aria-hidden="true"></i> Take Verification Selfie';
  const wrap=document.getElementById(`${scope}-selfie-preview-wrap`);
  if(wrap)wrap.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:26px;height:26px;color:var(--ink-muted)"><path stroke-linecap="round" stroke-linejoin="round" d="M15 8a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 20a7.5 7.5 0 0115 0"/></svg>`;
}

export function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=e=>resolve(e.target.result);
    r.onerror=()=>reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// Downscale a data URL so profile photos stay small enough for localStorage.
export function resizeImageDataUrl(dataUrl, maxDim=320, quality=0.82){
  return new Promise((resolve)=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.width,h=img.height;
      if(w>h){ if(w>maxDim){h=Math.round(h*maxDim/w);w=maxDim;} }
      else{ if(h>maxDim){w=Math.round(w*maxDim/h);h=maxDim;} }
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      resolve(canvas.toDataURL('image/jpeg',quality));
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
