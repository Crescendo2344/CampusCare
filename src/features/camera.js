// camera: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {toast} from './theme.js';
import {closeAllModals,openModal} from './modals.js';
import {resizeImageDataUrl} from './inputValidation.js';
import {dataUrlToProfileFile,uploadCurrentUserProfilePhoto} from './nameChangeRequests.js';
import {renderMyAccount} from './accountSettings.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {openPatientModal} from './patientForm.js';
import {analyzeIdImage} from './documentScanner.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// CAMERA CAPTURE (selfie + ID) — requests device camera permission
// ================================================================

export async function openCamera(target){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    toast('Your browser does not support camera capture. Please upload a photo instead.','error');
    return;
  }
  const isFrontFacing = target==='selfie'||target==='account'||target==='assisted-profile';
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:isFrontFacing?'user':'environment'},audio:false});
    appState.camera._cameraStream=stream;
    openModal(`<div class="modal modal-sm">
      <div class="modal-header"><h3>${target==='id'||target==='assisted-id'?'Photograph Your ID / COR':'Take a Photo'}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{stopCamera();closeAllModals()})}>✕</button></div>
      <div class="modal-body" style="text-align:center">
        <video id="camera-video" autoplay playsinline muted style="width:100%;border-radius:12px;background:#000;transform:${isFrontFacing?'scaleX(-1)':'none'}"></video>
        <canvas id="camera-canvas" style="display:none"></canvas>
        <p class="form-note" style="margin-top:.6rem">Center your ${target==='id'||target==='assisted-id'?'ID / COR':'face'} in the frame, then capture.</p>
      </div>
      <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{stopCamera();closeAllModals()})}>Cancel</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{captureCameraPhoto((String(target)))})}>📸 Capture</button></div>
    </div>`);
    const video=document.getElementById('camera-video');
    video.srcObject=stream;
  }catch(e){
    toast('Camera access was denied or is unavailable. Please upload a photo instead.','error');
  }
}

export function stopCamera(){
  if(appState.camera._cameraStream){ appState.camera._cameraStream.getTracks().forEach(t=>t.stop()); appState.camera._cameraStream=null; }
}

export function captureCameraPhoto(target){
  const video=document.getElementById('camera-video');
  const canvas=document.getElementById('camera-canvas');
  if(!video||!canvas)return;
  const isFrontFacing = target==='selfie'||target==='account'||target==='assisted-profile';
  canvas.width=video.videoWidth||480;
  canvas.height=video.videoHeight||360;
  const ctx=canvas.getContext('2d');
  if(isFrontFacing){ ctx.translate(canvas.width,0); ctx.scale(-1,1); }
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const dataUrl=canvas.toDataURL('image/jpeg',0.9);
  stopCamera();
  closeAllModals();
  if(target==='selfie'){
    resizeImageDataUrl(dataUrl).then(resized=>{
      appState.camera.capturedSelfieDataUrl=resized;
      const wrap=document.getElementById('r-selfie-preview-wrap');
      if(wrap)wrap.innerHTML=`<img src="${resized}" style="width:100%;height:100%;object-fit:cover">`;
      const fileInput=document.getElementById('r-selfie-file');
      if(fileInput)fileInput.value='';
      toast('Selfie captured.','success');
    });
  }else if(target==='account'){
    resizeImageDataUrl(dataUrl,700,0.88).then(async resized=>{
      try{
        const uploadFile=dataUrlToProfileFile(resized,'profile.jpg');
        await uploadCurrentUserProfilePhoto(uploadFile);
        toast('Profile photo updated.','success');
        if(document.getElementById('acc-photo-wrap'))renderMyAccount();
        if(appState.auth.currentUser.role==='Administrator'&&typeof syncAdminDirectoryFromSupabase==='function'){
          syncAdminDirectoryFromSupabase().catch(console.error);
        }
      }catch(e){
        console.error('Camera profile upload:',e);
        toast(e?.message||'Could not update your photo. Please try again.','error');
      }
    });
  }else if(target==='invitem'){
    resizeImageDataUrl(dataUrl,320,0.82).then(resized=>{
      appState.inventoryForms.capturedInvPhotoDataUrl=resized;
      const wrap=document.getElementById('im-photo-wrap');
      if(wrap)wrap.innerHTML=`<img src="${resized}" style="width:100%;height:100%;object-fit:cover">`;
      toast('Item photo captured.','success');
    });
  }else if(target==='article'){
    resizeImageDataUrl(dataUrl,900,0.82).then(resized=>{
      appState.issueReports.articlePhotoData=resized;
      const preview=document.getElementById('art-photo-preview');
      if(preview)preview.innerHTML=`<img src="${resized}" style="width:100%;height:100%;object-fit:cover">`;
      toast('Photo captured.','success');
    });
  }else if(target==='assisted-profile'){
    resizeImageDataUrl(dataUrl,500,0.86).then(resized=>{
      appState.datePicker.assistedProfile=resized;
      openPatientModal();
      toast('Profile photo captured.','success');
    });
  }else if(target==='assisted-id'){
    resizeImageDataUrl(dataUrl,1000,0.88).then(resized=>{
      appState.datePicker.assistedIdCor=resized;
      openPatientModal();
      toast('ID / COR photo captured.','success');
    });
  }else{
    appState.camera.capturedIdDataUrl=dataUrl;
    const fileInput=document.getElementById('r-id-file');
    if(fileInput)fileInput.value='';
    const preview=document.getElementById('r-file-preview');
    if(preview)preview.textContent='✓ Photo captured via camera';
    toast('ID photo captured.','success');
    analyzeIdImage(dataUrl);
  }
}

// Run side effects only after every feature's function exports are available.
// State defaults are initialized by the application before this optional module loads.
