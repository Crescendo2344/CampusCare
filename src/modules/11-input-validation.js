// ================================================================
// LIVE INPUT SANITIZATION — keeps each field to characters that make
// sense for what it holds (phone = digits only, names = letters, etc).
// ================================================================
function sanitizeInput(el,type){
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

function getSemester(...args){return formatters.getSemester(...args);}
function currentSemester(){return getSemester(TODAY);}

function fmtDate(...args){return formatters.fmtDate(...args);}
function fmtDateTime(...args){return formatters.fmtDateTime(...args);}
function fmtTime(...args){return formatters.fmtTime(...args);}
function dayOfWeek(dateStr){return scheduleRules.dayOfWeek(dateStr);}

function statusBadge(...args){return displayMarkup.statusBadge(...args);}
function collegeBadge(...args){return displayMarkup.collegeBadge(...args);}
function priorityBadge(...args){return displayMarkup.priorityBadge(...args);}

function genId(...args){return formatters.genId(...args);}

function svgIcon(...args){return displayMarkup.svgIcon(...args);}

function previewFile(input,previewId){
  const el=document.getElementById(previewId);
  if(el&&input.files[0])el.textContent='✓ '+input.files[0].name;
}

function previewSelfie(input){
  const wrap=document.getElementById('r-selfie-preview-wrap');
  const file=input.files&&input.files[0];
  if(!wrap||!file)return;
  capturedSelfieDataUrl=null; // a freshly-chosen file takes priority over any earlier camera capture
  const reader=new FileReader();
  reader.onload=e=>{ wrap.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`; };
  reader.readAsDataURL(file);
}

function resetSelfiePreview(){
  const wrap=document.getElementById('r-selfie-preview-wrap');
  if(wrap)wrap.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:26px;height:26px;color:var(--ink-muted)"><path stroke-linecap="round" stroke-linejoin="round" d="M15 8a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 20a7.5 7.5 0 0115 0"/></svg>`;
}

function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=e=>resolve(e.target.result);
    r.onerror=()=>reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// Downscale a data URL so profile photos stay small enough for localStorage.
function resizeImageDataUrl(dataUrl, maxDim=320, quality=0.82){
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
