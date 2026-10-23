// Accepted front/back images are separate from file inputs, so canceling a replacement keeps the old side.
// The same selfie + two-sided ID steps serve public registration (scope "r") and clinic-assisted
// registration (scope "pm"); each scope keeps its own photos and element ids.
import {state as appState} from '../app/state.js';
import {readFileAsDataURL,setRegistrationFieldError,setVerificationChip} from './inputValidation.js';
import {inspectIdPhoto} from '../verification/id-controller.js';
import {closeLayeredModal,openLayeredModal} from './modals.js';
import {toast} from './theme.js';
import {analyzeIdImage,clearRegistrationScan} from './documentScanner.js';
import {bindAction} from '../dependencies.js';

export function activeVerificationScope(){return appState.camera.verificationScope||'r';}
export function setVerificationScope(scope){appState.camera.verificationScope=scope==='pm'?'pm':'r';}

// Public registration keeps its original state fields; other scopes get their own container.
export function verificationState(scope=activeVerificationScope()){
  if(scope==='r'){
    const camera=appState.camera;
    return {
      get selfie(){return camera.capturedSelfieDataUrl||null;},set selfie(value){camera.capturedSelfieDataUrl=value;},
      get ids(){return camera.registrationIds||(camera.registrationIds={front:null,back:null});},set ids(value){camera.registrationIds=value;},
      get side(){return camera.registrationIdSide||'front';},set side(value){camera.registrationIdSide=value;}
    };
  }
  appState.camera.verificationScopes??={};
  return appState.camera.verificationScopes[scope]??={selfie:null,ids:{front:null,back:null},side:'front'};
}
export function resetVerificationState(scope){
  const state=verificationState(scope);
  state.selfie=null;state.ids={front:null,back:null};state.side='front';
}
const el=(scope,name)=>document.getElementById(`${scope}-${name}`);
export const selfieButtonId=scope=>scope==='r'?'selfie-camera-button':`${scope}-selfie-camera-button`;

export function registrationIdSides(scope=activeVerificationScope()){return verificationState(scope).ids;}
// Keep one preview and one set of controls, with saved sides available as small review buttons.
export function renderRegistrationIds(scope=activeVerificationScope()){
  const state=verificationState(scope),sides=state.ids,side=state.side,title=side==='front'?'Front':'Back';
  const preview=el(scope,'id-preview');
  if(!preview)return;
  if(sides[side]){const image=document.createElement('img');image.src=sides[side].dataUrl;image.alt='ID '+side;preview.replaceChildren(image);}
  else{const placeholder=document.createElement('span');placeholder.textContent=title+' of '+(scope==='r'?'your':'the')+' ID';preview.replaceChildren(placeholder);}
  el(scope,'id-step-title').textContent='Step '+(side==='front'?'1':'2')+' of 2 — '+title+' of ID';
  const count=Number(Boolean(sides.front))+Number(Boolean(sides.back));
  el(scope,'id-status').textContent=count===2?'2 of 2 saved — both sides ready for clinic review.':count===1?'1 of 2 saved — add the '+(sides.front?'back':'front')+' of the same ID.':'0 of 2 saved — start with the front.';
  const upload=el(scope,'id-upload-label');upload.htmlFor=`${scope}-${side==='front'?'id-file':'id-back-file'}`;upload.textContent=(sides[side]?'Replace ':'Upload ')+title;
  el(scope,'id-camera-button').textContent=(sides[side]?'Retake ':'Photograph ')+title;
  // Both side buttons stay visible so people can see which side is still missing.
  for(const value of ['front','back']){
    const button=el(scope,'id-show-'+value);
    button.dataset.saved=String(Boolean(sides[value]));
    button.setAttribute('aria-pressed',String(value===side));
    button.setAttribute('aria-label',(value==='front'?'Front':'Back')+' of ID — '+(sides[value]?'saved':'not added yet'));
  }
  setVerificationChip(`${scope}-id-chip`,count===2?'done':count?'partial':'todo',count===2?'Both sides ready':count+' of 2');
  if(count===2)setRegistrationFieldError(`${scope}-id`,'');
}
export function selectRegistrationIdSide(side,scope=activeVerificationScope()){
  if(!['front','back'].includes(side))return;
  verificationState(scope).side=side;renderRegistrationIds(scope);
}
export function resetRegistrationIds(scope=activeVerificationScope()){
  if(scope==='r')clearRegistrationScan();
  const state=verificationState(scope);
  state.ids={front:null,back:null};state.side='front';
  for(const name of ['id-file','id-back-file']){const input=el(scope,name);if(input)input.value='';}
  renderRegistrationIds(scope);
}
export function saveRegistrationId(side,dataUrl,file=null,scope=activeVerificationScope()){
  const sides=registrationIdSides(scope),other=side==='front'?'back':'front';
  if(sides[other]?.dataUrl===dataUrl){toast('Use a different photo for the front and back of '+(scope==='r'?'your':'the')+' ID.','error');return false;}
  sides[side]={dataUrl,file};
  // Saving a front always advances the compact panel to its back step.
  selectRegistrationIdSide(side==='front'?'back':side,scope);
  // Name matching against the typed registration details applies to public sign-ups only.
  if(side==='front'&&scope==='r')analyzeIdImage(dataUrl).catch(()=>{});
  return true;
}
export async function handleRegistrationIdUpload(input,side,scope=activeVerificationScope()){
  const file=input.files?.[0];input.value='';if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){toast('Upload an ID photo in JPG, PNG, or WebP format, up to 10 MB. COR and PDF files are not accepted.','error');return;}
  try{
    const dataUrl=await readFileAsDataURL(file),result=await inspectIdPhoto(dataUrl);
    openLayeredModal(`<div class="modal selfie-modal"><div class="modal-header"><h3>Review ID ${side==='front'?'Front':'Back'}</h3><button class="close-btn" ${bindAction('click',()=>closeLayeredModal())}>✕</button></div>
      <div class="modal-body"><img class="id-upload-review" src="${dataUrl}" alt="Uploaded ID ${side}"><p role="status" style="margin-top:.8rem;text-align:center">${result.ready?'The ID framing looks clear. Check the correct side and readable details before continuing.':result.message+'. Retake or choose a clearer photo if needed.'}</p><p class="form-note">Student or Employee ID only. Staff will check the actual document and both sides.</p></div>
      <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeLayeredModal())}>Choose another photo</button><button class="btn btn-primary" ${bindAction('click',()=>{if(saveRegistrationId(side,dataUrl,file,scope)){closeLayeredModal();if(side==='front')promptForUploadedBack(scope);else toast('Both ID sides saved for clinic review.','success');}})}>Use ${side==='front'?'Front':'Back'} Photo</button></div></div>`,scope!=='r');
  }catch(error){toast(error?.message||'Unable to read that ID photo.','error');}
}

// Uploads follow the same front-then-back sequence as guided camera captures.
function promptForUploadedBack(scope){
  openLayeredModal(`<div class="modal selfie-modal"><div class="modal-header"><h3>Front saved — add the back</h3></div><div class="modal-body"><p>Now upload the back of the same Student or Employee ID. You can also photograph it from the ${scope==='r'?'registration':'patient'} form.</p></div><div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeLayeredModal())}>Back to ${scope==='r'?'registration':'the form'}</button><button class="btn btn-primary" ${bindAction('click',()=>{closeLayeredModal();el(scope,'id-back-file')?.click();})}>Upload Back</button></div></div>`,scope!=='r');
}

// Selfie + front/back ID steps for forms rendered from JavaScript (the static public form has the same markup).
export function verificationStepsHtml(scope,{subject='the patient',onSelfie,onIdCamera,onShow,onUpload}){
  return `<section class="verification-step" id="${scope}-selfie-group" aria-labelledby="${scope}-selfie-title">
      <div class="verification-step-head">
        <span class="verification-step-num" aria-hidden="true">1</span>
        <div class="verification-step-text"><h4 id="${scope}-selfie-title">Selfie holding the ID <span class="required">*</span></h4><p>Live camera photo of ${subject} with the front of the ID beside the face.</p></div>
        <span class="verification-chip" id="${scope}-selfie-chip" data-state="todo">Required</span>
      </div>
      <div class="verification-selfie-body">
        <div id="${scope}-selfie-preview-wrap" class="verification-selfie-preview"><i class="bi bi-person-bounding-box" style="font-size:1.6rem;color:var(--ink-muted)" aria-hidden="true"></i></div>
        <ul class="verification-tips"><li>Face fully visible, no mask or sunglasses</li><li>Front of the ID held beside the face</li><li>ID text readable, without glare</li></ul>
      </div>
      <button type="button" class="btn btn-sm btn-info verification-action" id="${selfieButtonId(scope)}" ${bindAction('click',onSelfie)}><i class="bi bi-camera" aria-hidden="true"></i> Take Verification Selfie</button>
      <p class="registration-field-error" id="${scope}-selfie-error" aria-live="polite" hidden></p>
    </section>
    <section class="verification-step registration-id-panel" id="${scope}-id-group" aria-labelledby="${scope}-verification-label">
      <div class="verification-step-head">
        <span class="verification-step-num" aria-hidden="true">2</span>
        <div class="verification-step-text"><h4 id="${scope}-verification-label">Student or Employee ID — Front and Back <span class="required">*</span></h4><p>Use the same original ID as the selfie. COR and PDF files are not accepted.</p></div>
        <span class="verification-chip" id="${scope}-id-chip" data-state="todo">0 of 2</span>
      </div>
      <div class="registration-id-switch" role="group" aria-label="Choose ID side">
        <button type="button" class="registration-id-side" id="${scope}-id-show-front" aria-pressed="true" ${bindAction('click',()=>onShow('front'))}><span class="registration-id-side-dot" aria-hidden="true"></span>Front</button>
        <button type="button" class="registration-id-side" id="${scope}-id-show-back" aria-pressed="false" ${bindAction('click',()=>onShow('back'))}><span class="registration-id-side-dot" aria-hidden="true"></span>Back</button>
      </div>
      <h5 class="registration-id-step-title" id="${scope}-id-step-title">Step 1 of 2 — Front of ID</h5>
      <div class="registration-id-preview" id="${scope}-id-preview"><span>Front of the ID</span></div>
      <p id="${scope}-id-status" aria-live="polite">0 of 2 saved — start with the front.</p>
      <div class="registration-id-actions">
        <button type="button" class="btn btn-sm btn-info" id="${scope}-id-camera-button" ${bindAction('click',onIdCamera)}>Photograph Front</button>
        <label class="btn btn-sm" id="${scope}-id-upload-label" for="${scope}-id-file">Upload Front</label>
      </div>
      <input type="file" id="${scope}-id-file" aria-label="Upload front of ID" accept="image/jpeg,image/png,image/webp" class="id-file-input" ${bindAction('change',(event,input)=>onUpload(input,'front'))}>
      <input type="file" id="${scope}-id-back-file" aria-label="Upload back of ID" accept="image/jpeg,image/png,image/webp" class="id-file-input" ${bindAction('change',(event,input)=>onUpload(input,'back'))}>
      <p class="registration-field-error" id="${scope}-id-error" aria-live="polite" hidden></p>
    </section>`;
}
