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
import {startSelfieGuidance} from '../verification/selfie-controller.js';
// ================================================================
// CAMERA CAPTURE (selfie + ID) — requests device camera permission
// ================================================================

export async function openCamera(target){
  if(target!=='selfie')return startCamera(target);
  // Preparation explains the evidence before asking for camera permission.
  openModal(`<div class="modal selfie-modal">
    <div class="modal-header"><h3>Selfie Verification</h3><button class="close-btn" aria-label="Close selfie instructions" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body selfie-intro">
      <h4>Get ready for your selfie</h4>
      <p>Keep your face and the same document you will upload clearly visible.</p>
      <div class="selfie-prep-grid">
        <div class="selfie-prep-card"><i class="bi bi-person-circle" aria-hidden="true"></i><strong>Face visible</strong><span>Remove face coverings and sunglasses.</span></div>
        <div class="selfie-prep-card"><i class="bi bi-brightness-high" aria-hidden="true"></i><strong>Even lighting</strong><span>Face a light source. Avoid glare and dark rooms.</span></div>
        <div class="selfie-prep-card"><i class="bi bi-person-vcard" aria-hidden="true"></i><strong>Hold your document</strong><span>Keep the ID or COR beside or below your face.</span></div>
      </div>
      <p class="selfie-privacy">Positioning guidance runs on your device. Clinic staff review the captured selfie and document.</p>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Cancel</button><button class="btn btn-primary" ${bindAction('click',()=>startCamera('selfie'))}>Start Camera</button></div>
  </div>`);
}

async function startCamera(target){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    toast(target==='selfie'?'A working camera is required for selfie verification. Open CampusCare in a browser with camera access.':'Your browser does not support camera capture. Please upload a photo instead.','error');
    return;
  }
  const isFrontFacing = target==='selfie'||target==='account'||target==='assisted-profile';
  try{
    // Preserve document detail for the verification selfie; ordinary avatar captures keep their own sizing.
    stopCamera();
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:isFrontFacing?'user':'environment',width:{ideal:1280},height:{ideal:960}},audio:false});
    appState.camera._cameraStream=stream;
    openModal(`<div class="modal ${target==='selfie'?'selfie-modal':'modal-sm'}">
      <div class="modal-header"><h3>${target==='selfie'?'Selfie Verification':target==='id'||target==='assisted-id'?'Photograph Your ID / COR':'Take a Photo'}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{stopCamera();closeAllModals()})}>✕</button></div>
      <div class="modal-body" style="text-align:center">
        ${target==='selfie'?`<div class="selfie-stage" id="selfie-stage"><video id="camera-video" autoplay playsinline muted></video><div class="selfie-guide-oval" aria-hidden="true"></div><div class="selfie-document-guide">Keep your matching document visible</div></div>
        <div class="selfie-feedback"><p id="selfie-status" role="status" aria-live="polite">Preparing camera…</p><div class="selfie-progress" aria-hidden="true"><span id="selfie-progress"></span></div></div>`:`<video id="camera-video" autoplay playsinline muted style="width:100%;border-radius:12px;background:#000;transform:${isFrontFacing?'scaleX(-1)':'none'}"></video>`}
        <canvas id="camera-canvas" style="display:none"></canvas>
        <p class="form-note" style="margin-top:.6rem">${target==='selfie'?'Hold the same document you will upload beside your face. Keep your full face, the document, and its text visible.':`Center your ${target==='id'||target==='assisted-id'?'ID / COR':'face'} in the frame, then capture.`}</p>
      </div>
      <div class="modal-footer"><button class="btn" ${bindAction('click',()=>{stopCamera();closeAllModals();})}>Cancel</button><button class="btn btn-primary" id="camera-capture-button" ${target==='selfie'?'disabled':''} ${bindAction('click',()=>captureCameraPhoto(target))}>${target==='selfie'?'Follow the guide':'📸 Capture'}</button></div>
      ${target==='selfie'?`<div style="padding:0 1rem 1rem;text-align:center"><button class="btn btn-sm selfie-manual" id="selfie-manual-button" hidden ${bindAction('click',()=>captureCameraPhoto('selfie',true))}>Having trouble? Capture for staff review</button><p class="selfie-privacy">The guide checks photo positioning only. Clinic staff verify your identity and document.</p></div>`:''}
    </div>`);
    const video=document.getElementById('camera-video');
    video.srcObject=stream;
    if(target==='selfie')appState.camera.selfieGuidance=startSelfieGuidance({video,root:document.getElementById('selfie-stage'),captureButton:document.getElementById('camera-capture-button'),manualButton:document.getElementById('selfie-manual-button'),status:document.getElementById('selfie-status'),progress:document.getElementById('selfie-progress')});
    // Close buttons, backdrop clicks, and other modal replacements all release the camera.
    const modal=document.getElementById('active-modal');
    const observer=new MutationObserver(()=>{if(!modal?.isConnected){stream.getTracks().forEach(track=>track.stop());if(appState.camera._cameraStream===stream){appState.camera._cameraStream=null;appState.camera.selfieGuidance?.dispose();appState.camera.selfieGuidance=null;}observer.disconnect();}});
    observer.observe(document.getElementById('modals'),{childList:true});
  }catch(e){
    stopCamera();
    toast(target==='selfie'?'Camera access is required. Allow camera permission, or open CampusCare in Chrome or Safari and try again.':'Camera access was denied or is unavailable. Please upload a photo instead.','error');
  }
}

export function stopCamera(){
  appState.camera.selfieGuidance?.dispose();appState.camera.selfieGuidance=null;
  if(appState.camera._cameraStream){ appState.camera._cameraStream.getTracks().forEach(t=>t.stop()); appState.camera._cameraStream=null; }
}

export function captureCameraPhoto(target,manual=false){
  // UI guidance is assistive; an explicit manual-review action is available only when offered.
  if(target==='selfie'&&!(manual?appState.camera.selfieGuidance?.canUseManual():appState.camera.selfieGuidance?.canCapture()))return;
  const video=document.getElementById('camera-video');
  const canvas=document.getElementById('camera-canvas');
  if(!video||!canvas)return;
  // Never accept a blank frame while permission or camera initialization is still pending.
  if(video.readyState<2||!video.videoWidth||!video.videoHeight){toast('Wait until the camera preview is visible, then capture.','warning');return;}
  const isFrontFacing = target==='selfie'||target==='account'||target==='assisted-profile';
  canvas.width=video.videoWidth||480;
  canvas.height=video.videoHeight||360;
  const ctx=canvas.getContext('2d');
  if(isFrontFacing&&target!=='selfie'){ ctx.translate(canvas.width,0); ctx.scale(-1,1); }
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const dataUrl=canvas.toDataURL('image/jpeg',0.9);
  stopCamera();
  closeAllModals();
  if(target==='selfie'){
    resizeImageDataUrl(dataUrl,1600,0.9).then(resized=>{
      appState.camera.capturedSelfieDataUrl=resized;
      const wrap=document.getElementById('r-selfie-preview-wrap');
      if(wrap)wrap.innerHTML=`<img src="${resized}" style="width:100%;height:100%;object-fit:contain">`;
      const button=document.getElementById('selfie-camera-button');
      if(button)button.textContent='Retake Verification Selfie';
      toast('Verification selfie captured. Check that your face and document are clear.','success');
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
