// inputValidation: imported feature APIs; state belongs to explicit application namespaces.
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

export function previewSelfie(input){
  const wrap=document.getElementById('r-selfie-preview-wrap');
  const file=input.files&&input.files[0];
  if(!wrap||!file)return;
  appState.camera.capturedSelfieDataUrl=null; // a freshly-chosen file takes priority over any earlier camera capture
  const reader=new FileReader();
  reader.onload=e=>{ wrap.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`; };
  reader.readAsDataURL(file);
}

export function resetSelfiePreview(){
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
