// Accepted front/back images are separate from file inputs, so canceling a replacement keeps the old side.
import {state as appState} from '../app/state.js';
import {readFileAsDataURL} from './inputValidation.js';
import {inspectIdPhoto} from '../verification/id-controller.js';
import {closeAllModals,openModal} from './modals.js';
import {toast} from './theme.js';
import {analyzeIdImage,clearRegistrationScan} from './documentScanner.js';
import {bindAction} from '../dependencies.js';
export function registrationIdSides(){return appState.camera.registrationIds||(appState.camera.registrationIds={front:null,back:null});}
// Keep one preview and one set of controls, with saved sides available as small review buttons.
export function renderRegistrationIds(){
  const sides=registrationIdSides(),side=appState.camera.registrationIdSide||'front',title=side==='front'?'Front':'Back';
  const preview=document.getElementById('r-id-preview');
  if(!preview)return;
  if(sides[side]){const image=document.createElement('img');image.src=sides[side].dataUrl;image.alt='ID '+side;preview.replaceChildren(image);}
  else{const placeholder=document.createElement('span');placeholder.textContent=title+' of your ID';preview.replaceChildren(placeholder);}
  document.getElementById('r-id-step-title').textContent='Step '+(side==='front'?'1':'2')+' of 2 — '+title+' of ID';
  const count=Number(Boolean(sides.front))+Number(Boolean(sides.back));
  document.getElementById('r-id-status').textContent=count===2?'2 of 2 saved — both sides ready for clinic review.':count===1?'1 of 2 saved — add the '+(sides.front?'back':'front')+' of the same ID.':'0 of 2 saved — start with the front.';
  const upload=document.getElementById('r-id-upload-label');upload.htmlFor=side==='front'?'r-id-file':'r-id-back-file';upload.textContent=(sides[side]?'Replace ':'Upload ')+title;
  document.getElementById('r-id-camera-button').textContent=(sides[side]?'Retake ':'Photograph ')+title;
  for(const value of ['front','back']){const button=document.getElementById('r-id-show-'+value);button.hidden=!sides.front&&!sides.back;button.textContent=(value==='front'?'Front':'Back')+(sides[value]?' ✓':'');button.setAttribute('aria-pressed',String(value===side));}
}
export function selectRegistrationIdSide(side){
  if(!['front','back'].includes(side))return;
  appState.camera.registrationIdSide=side;renderRegistrationIds();
}
export function resetRegistrationIds(){
  clearRegistrationScan();
  appState.camera.registrationIds={front:null,back:null};appState.camera.registrationIdSide='front';
  for(const id of ['r-id-file','r-id-back-file']){const input=document.getElementById(id);if(input)input.value='';}
  renderRegistrationIds();
}
export function saveRegistrationId(side,dataUrl,file=null){
  const sides=registrationIdSides(),other=side==='front'?'back':'front';
  if(sides[other]?.dataUrl===dataUrl){toast('Use a different photo for the front and back of your ID.','error');return false;}
  sides[side]={dataUrl,file};
  // Saving a front always advances the compact panel to its back step.
  selectRegistrationIdSide(side==='front'?'back':side);
  if(side==='front')analyzeIdImage(dataUrl).catch(()=>{});
  return true;
}
export async function handleRegistrationIdUpload(input,side){
  const file=input.files?.[0];input.value='';if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){toast('Upload an ID photo in JPG, PNG, or WebP format, up to 10 MB. COR and PDF files are not accepted.','error');return;}
  try{
    const dataUrl=await readFileAsDataURL(file),result=await inspectIdPhoto(dataUrl);
    openModal(`<div class="modal selfie-modal"><div class="modal-header"><h3>Review ID ${side==='front'?'Front':'Back'}</h3><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
      <div class="modal-body"><img class="id-upload-review" src="${dataUrl}" alt="Uploaded ID ${side}"><p role="status" style="margin-top:.8rem;text-align:center">${result.ready?'The ID framing looks clear. Check the correct side and readable details before continuing.':result.message+'. Retake or choose a clearer photo if needed.'}</p><p class="form-note">Student or Employee ID only. Staff will check the actual document and both sides.</p></div>
      <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Choose another photo</button><button class="btn btn-primary" ${bindAction('click',()=>{if(saveRegistrationId(side,dataUrl,file)){closeAllModals();if(side==='front')promptForUploadedBack();else toast('Both ID sides saved for clinic review.','success');}})}>Use ${side==='front'?'Front':'Back'} Photo</button></div></div>`);
  }catch(error){toast(error?.message||'Unable to read that ID photo.','error');}
}

// Uploads follow the same front-then-back sequence as guided camera captures.
function promptForUploadedBack(){
  openModal(`<div class="modal selfie-modal"><div class="modal-header"><h3>Front saved — add the back</h3></div><div class="modal-body"><p>Now upload the back of the same Student or Employee ID. You can also photograph it from the registration panel.</p></div><div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Back to registration</button><button class="btn btn-primary" ${bindAction('click',()=>{closeAllModals();document.getElementById('r-id-back-file')?.click();})}>Upload Back</button></div></div>`);
}
