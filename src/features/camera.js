// camera: imported feature APIs; state belongs to explicit application namespaces.
import {requestCamera,cameraStartupMessage} from '../verification/camera-startup.js';
import {state as appState} from '../app/state.js';
import {toast} from './theme.js';
import {closeLayeredModal,openLayeredModal} from './modals.js';
import {resizeImageDataUrl,setRegistrationFieldError,setVerificationChip} from './inputValidation.js';
import {dataUrlToProfileFile,uploadCurrentUserProfilePhoto} from './nameChangeRequests.js';
import {renderMyAccount} from './accountSettings.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {openPatientModal} from './patientForm.js';
import {analyzeIdImage} from './documentScanner.js';
import {bindAction} from '../dependencies.js';
import {cameraFocus} from '../verification/camera-focus.js';
import {startIdGuidance} from '../verification/id-controller.js';
import {saveRegistrationId,selfieButtonId,verificationState} from './idVerification.js';
import {startSelfieGuidance} from '../verification/selfie-controller.js';
import {startCaptureLighting} from '../verification/capture-lighting.js';
// ================================================================
// CAMERA CAPTURE (selfie + ID) — requests device camera permission
// ================================================================

// Verification photos started from the clinic-assisted form open above it and return to it.
const verificationTargets=new Set(['selfie','id-front','id-back']);
function openVerificationModal(html,target){
  openLayeredModal(html,appState.camera.verificationScope==='pm'&&verificationTargets.has(target));
}
const closeVerificationModal=()=>closeLayeredModal();

export async function openCamera(target){
  if(target!=='selfie')return startCamera(target);
  // Preparation explains the evidence before asking for camera permission.
  openVerificationModal(`<div class="modal selfie-modal">
    <div class="modal-header"><h3>Selfie Verification</h3><button class="close-btn" aria-label="Close selfie instructions" ${bindAction('click',()=>closeVerificationModal())}>✕</button></div>
    <div class="modal-body selfie-intro">
      <div class="selfie-intro-art" aria-hidden="true">
        <svg viewBox="0 0 160 110" fill="none">
          <rect x="4" y="4" width="152" height="102" rx="16" class="art-frame"/>
          <ellipse cx="98" cy="48" rx="21" ry="26" class="art-face"/>
          <path d="M66 106c4-20 17-30 32-30s28 10 32 30" class="art-body"/>
          <rect x="22" y="38" width="38" height="26" rx="4" class="art-card"/>
          <circle cx="32" cy="49" r="5" class="art-card-photo"/>
          <path d="M41 46h13M41 52h10M27 58h27" class="art-card-text"/>
          <path d="M58 66c4 2 8 2 12 0" class="art-hand"/>
        </svg>
      </div>
      <h4>Get ready for your selfie</h4>
      <p>Take a live photo holding the front of the same ID you will upload.</p>
      <ol class="selfie-prep-grid">
        <li class="selfie-prep-card"><span class="selfie-prep-num">1</span><i class="bi bi-person-circle" aria-hidden="true"></i><strong>Face visible</strong><span>Remove face coverings, caps and sunglasses.</span></li>
        <li class="selfie-prep-card"><span class="selfie-prep-num">2</span><i class="bi bi-brightness-high" aria-hidden="true"></i><strong>Even lighting</strong><span>Face a light source. Avoid glare and dark rooms.</span></li>
        <li class="selfie-prep-card"><span class="selfie-prep-num">3</span><i class="bi bi-person-vcard" aria-hidden="true"></i><strong>Hold your ID</strong><span>Keep the front of your Student or Employee ID beside your face.</span></li>
      </ol>
      <p class="selfie-privacy"><i class="bi bi-shield-lock" aria-hidden="true"></i> Positioning guidance runs on your device. Only clinic staff review the captured selfie and ID.</p>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeVerificationModal())}>Cancel</button><button class="btn btn-primary" ${bindAction('click',()=>startCamera('selfie'))}><i class="bi bi-camera" aria-hidden="true"></i> Start Camera</button></div>
  </div>`,'selfie');
}

let cameraRequest=0;
async function startCamera(target){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    toast(target==='selfie'?'A working camera is required for selfie verification. Open CampusCare in a browser with camera access.':'Your browser does not support camera capture. Please upload a photo instead.','error');
    return;
  }
  const isId=target==='id-front'||target==='id-back',guided=target==='selfie'||isId;
  const isFrontFacing = target==='selfie'||target==='account'||target==='assisted-profile';
  try{
    // Preserve document detail for the verification selfie; ordinary avatar captures keep their own sizing.
    stopCamera();
    const request=++cameraRequest;
    const requestedFrom=document.getElementById('active-modal');
    const stream=await requestCamera(navigator.mediaDevices,isFrontFacing);
    if(request!==cameraRequest||(requestedFrom&&!requestedFrom.isConnected)){stream.getTracks().forEach(track=>track.stop());return;}
    appState.camera._cameraStream=stream;
    openVerificationModal(`<div class="modal ${guided?'selfie-modal':'modal-sm'}">
      <div class="modal-header"><h3>${isId?'ID '+(target==='id-front'?'Front — Step 1 of 2':'Back — Step 2 of 2'):target==='selfie'?'Selfie Verification':target==='id'||target==='assisted-id'?'Photograph Your ID / COR':'Take a Photo'}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{stopCamera();closeVerificationModal()})}>✕</button></div>
      <div class="modal-body" style="text-align:center">
        ${guided?`<div class="selfie-stage" id="selfie-stage" data-camera="${isId?'id':'selfie'}" data-mirrored="${!isId}"><video id="camera-video" autoplay playsinline muted></video><div class="${isId?'id-guide-rectangle':'selfie-guide-square'}" aria-hidden="true"></div>${!isId?'<div class="selfie-id-guide" aria-hidden="true"><span>ID</span></div>':''}<div class="selfie-document-guide">${isId?'Keep all four ID corners visible':'Keep your matching ID visible'}</div></div>
        <div class="selfie-feedback"><p id="selfie-status" role="status" aria-live="polite">Preparing camera…</p><div class="selfie-progress" aria-hidden="true"><span id="selfie-progress"></span></div></div>`:`<video id="camera-video" autoplay playsinline muted style="width:100%;border-radius:12px;background:#000;transform:${isFrontFacing?'scaleX(-1)':'none'}"></video>`}
        ${target==='selfie'?`<label class="camera-mirror-control"><input id="camera-mirror-preview" type="checkbox" checked ${bindAction('change',(event,element)=>{document.getElementById('selfie-stage').dataset.mirrored=String(element.checked)})}> Mirror preview</label><p class="selfie-privacy">The saved photo is not mirrored, so your ID text stays readable.</p>`:''}
        ${isId?'<button type="button" id="camera-refocus" class="btn btn-sm" hidden>Refocus camera</button>':''}
        ${guided?'<div class="capture-light-controls" id="capture-light-controls"></div>':''}
        <canvas id="camera-canvas" style="display:none"></canvas>
        <p class="form-note" style="margin-top:.6rem">${isId?'Use the '+(target==='id-front'?'front':'back')+' of your Student or Employee ID. Keep the ID visible and hold it comfortably still.':target==='selfie'?'Hold the front of the same Student or Employee ID beside your face, with its text readable.':`Center your ${target==='id'||target==='assisted-id'?'ID / COR':'face'} in the frame, then capture.`}</p>
      </div>
      <div class="modal-footer"><button class="btn" ${bindAction('click',()=>{stopCamera();closeVerificationModal();})}>Cancel</button><button class="btn btn-primary" id="camera-capture-button" ${guided?'disabled':''} ${bindAction('click',()=>captureCameraPhoto(target))}>${guided?'Follow the guide':'<i class="bi bi-camera" aria-hidden="true"></i> Capture'}</button></div>
      ${guided?`<div style="padding:0 1rem 1rem;text-align:center">${!isId?`<button class="btn btn-sm selfie-manual" id="selfie-manual-button" hidden ${bindAction('click',()=>captureCameraPhoto(target,true))}>Having trouble? Capture for staff review</button>`:''}<p class="selfie-privacy">The guide checks photo positioning only. Clinic staff verify your identity and ID.</p></div>`:''}
    </div>`,target);
    const video=document.getElementById('camera-video');
    video.srcObject=stream;
    // Mobile browsers may require explicit playback despite autoplay and camera permission.
    video.muted=true;video.setAttribute('playsinline','');
    try{await video.play();}
    catch(error){
      // Camera permission can succeed while mobile autoplay still needs a tap.
      if(error?.name!=='NotAllowedError')throw error;
      video.controls=true;
      toast('Tap Play on the camera preview to start it. Camera permission is already allowed.','info');
    }
    if(isId){
      const focus=cameraFocus(stream.getVideoTracks()[0]),button=document.getElementById('camera-refocus');
      button.hidden=!focus.supported;button.onclick=async()=>{button.disabled=true;await focus.refocus();button.disabled=false;};
      focus.refocus();
    }
    // Brighten the scene for verification photos and restore everything when capture ends.
    if(guided)appState.camera.captureLighting=startCaptureLighting({track:stream.getVideoTracks()[0],controls:document.getElementById('capture-light-controls')});
    if(guided)appState.camera.selfieGuidance=(isId?startIdGuidance:startSelfieGuidance)({video,root:document.getElementById('selfie-stage'),captureButton:document.getElementById('camera-capture-button'),manualButton:document.getElementById('selfie-manual-button'),status:document.getElementById('selfie-status'),progress:document.getElementById('selfie-progress')});
    // Close buttons, backdrop clicks, and other modal replacements all release the camera.
    const modal=document.getElementById('active-modal');
    const observer=new MutationObserver(()=>{if(!modal?.isConnected){stream.getTracks().forEach(track=>track.stop());if(appState.camera._cameraStream===stream){appState.camera._cameraStream=null;appState.camera.selfieGuidance?.dispose();appState.camera.selfieGuidance=null;appState.camera.captureLighting?.dispose();appState.camera.captureLighting=null;}observer.disconnect();}});
    observer.observe(document.getElementById('modals'),{childList:true});
  }catch(e){
    stopCamera();
    toast(cameraStartupMessage(e),'error');
  }
}

export function stopCamera(){
  cameraRequest++;
  appState.camera.selfieGuidance?.dispose();appState.camera.selfieGuidance=null;
  appState.camera.captureLighting?.dispose();appState.camera.captureLighting=null;
  if(appState.camera._cameraStream){ appState.camera._cameraStream.getTracks().forEach(t=>t.stop()); appState.camera._cameraStream=null; }
}

export function captureCameraPhoto(target,manual=false){
  // UI guidance is assistive; an explicit manual-review action is available only when offered.
  if((target==='selfie'||target==='id-front'||target==='id-back')&&!(manual?appState.camera.selfieGuidance?.canUseManual():appState.camera.selfieGuidance?.canCapture()))return;
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
  closeVerificationModal();
  if(target==='id-front'||target==='id-back'){
    const side=target==='id-front'?'front':'back';
    if(saveRegistrationId(side,dataUrl)){
      if(side==='front')openVerificationModal(`<div class="modal selfie-modal"><div class="modal-header"><h3>Front saved — flip your ID</h3></div><div class="modal-body selfie-intro"><div class="id-flip-art" aria-hidden="true"><i class="bi bi-arrow-repeat"></i></div><p>Now photograph the back of the same Student or Employee ID.</p></div><div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeVerificationModal())}>Back to registration</button><button class="btn btn-primary" ${bindAction('click',()=>startCamera('id-back'))}>Photograph Back</button></div></div>`,'id-back');
      else toast('Back saved. Both ID sides are ready for clinic review.','success');
    }
  }else if(target==='selfie'){
    resizeImageDataUrl(dataUrl,1600,0.9).then(resized=>{
      const scope=appState.camera.verificationScope||'r';
      verificationState(scope).selfie=resized;
      const wrap=document.getElementById(`${scope}-selfie-preview-wrap`);
      if(wrap)wrap.innerHTML=`<img src="${resized}" alt="Verification selfie" style="width:100%;height:100%;object-fit:contain">`;
      const button=document.getElementById(selfieButtonId(scope));
      if(button)button.innerHTML='<i class="bi bi-arrow-repeat" aria-hidden="true"></i> Retake Verification Selfie';
      setVerificationChip(`${scope}-selfie-chip`,'done','Captured');
      setRegistrationFieldError(`${scope}-selfie`,'');
      toast('Verification selfie captured. Check that your face and ID are clear.','success');
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
