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
  if(node){node.textContent=visible?message:'';node.hidden=!visible;}
  // Photo steps highlight their whole panel; other fields mark the control a person interacts with.
  const group={'r-selfie':'r-selfie-group','r-id':'r-id-group'}[id];
  const control=group?null:document.getElementById(id==='r-dob'?'r-dob-button':id);
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
  'r-privacy-consent':()=>document.getElementById('r-privacy-consent')?.checked?'':'Please read and agree to the CampusCare Privacy Notice and Consent.'
};
const touchedFields=new Set();

// While typing, only correct an error already shown; a fresh field is checked when the person leaves it.
export function validateRegistrationField(id,showError=true){
  const rule=registrationFieldRules[id];
  if(!rule)return '';
  // An empty optional or untouched field should not turn red mid-typing.
  if(showError)touchedFields.add(id);
  const message=rule();
  setRegistrationFieldError(id,message,showError||touchedFields.has(id));
  return message;
}

// Check every field at once, show all problems and return the first invalid control for focus.
export function validateRegistrationForm(){
  const invalid=Object.keys(registrationFieldRules).filter(id=>validateRegistrationField(id));
  return invalid;
}

export function resetRegistrationFieldErrors(){
  touchedFields.clear();
  for(const id of Object.keys(registrationFieldRules))setRegistrationFieldError(id,'',false);
}

export function getSemester(...args){return formatters.getSemester(...args);}
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

export function resetSelfiePreview(){
  setVerificationChip('r-selfie-chip','todo','Required');
  const button=document.getElementById('selfie-camera-button');
  if(button)button.innerHTML='<i class="bi bi-camera" aria-hidden="true"></i> Take Verification Selfie';
  const wrap=document.getElementById('r-selfie-preview-wrap');
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
