// Accepted front/back images are separate from file inputs, so canceling a replacement keeps the old side.
import {state as appState} from '../app/state.js';
import {readFileAsDataURL} from './inputValidation.js';
import {inspectIdPhoto} from '../verification/id-controller.js';
import {closeAllModals,openModal} from './modals.js';
import {toast} from './theme.js';
import {analyzeIdImage,clearRegistrationScan} from './documentScanner.js';
import {bindAction} from '../dependencies.js';
export function registrationIdSides(){return appState.camera.registrationIds||(appState.camera.registrationIds={front:null,back:null});}
export function resetRegistrationIds(){
  clearRegistrationScan();
  appState.camera.registrationIds={front:null,back:null};
  for(const side of ['front','back']){
    const preview=document.getElementById('r-id-'+side+'-preview');if(preview)preview.replaceChildren();
    const status=document.getElementById('r-id-'+side+'-status');if(status)status.textContent='Not provided';
  }
}
export function saveRegistrationId(side,dataUrl,file=null){
  const sides=registrationIdSides(),other=side==='front'?'back':'front';
  if(sides[other]?.dataUrl===dataUrl){toast('Use a different photo for the front and back of your ID.','error');return false;}
  sides[side]={dataUrl,file};
  const preview=document.getElementById('r-id-'+side+'-preview');if(preview){const image=document.createElement('img');image.src=dataUrl;image.alt=side==='front'?'ID front':'ID back';preview.replaceChildren(image);}
  const status=document.getElementById('r-id-'+side+'-status');if(status)status.textContent='Ready — '+(file?'uploaded':'camera photo');
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
      <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Choose another photo</button><button class="btn btn-primary" ${bindAction('click',()=>{if(saveRegistrationId(side,dataUrl,file)){closeAllModals();toast('ID '+side+' saved. '+(side==='front'?'Add the back of the same ID.':'Check that both sides belong to the same ID.'),'success');}})}>Use ${side==='front'?'Front':'Back'} Photo</button></div></div>`);
  }catch(error){toast(error?.message||'Unable to read that ID photo.','error');}
}
