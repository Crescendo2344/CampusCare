// ================================================================
// LIVE INPUT SANITIZATION — keeps each field to characters that make
// sense for what it holds (phone = digits only, names = letters, etc).
// ================================================================
function sanitizeInput(el,type){
  const start=el.selectionStart, before=el.value;
  let v=el.value;
  switch(type){
    case 'name':
      v=v.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s'.-]/g,'').replace(/\s{2,}/g,' ').slice(0,50);
      break;
    case 'username':
      v=v.replace(/[^A-Za-z0-9_.-]/g,'').slice(0,20);
      break;
    case 'email':
      v=v.replace(/\s/g,'').toLowerCase().replace(/[^a-z0-9@._+-]/g,'').slice(0,150);
      break;
    case 'phone':
      v=v.replace(/\D/g,'').slice(0,11);
      break;
    case 'password':
      v=v.replace(/\s/g,'').slice(0,64);
      break;
    case 'idno':
      v=v.replace(/[^A-Za-z0-9-]/g,'').slice(0,20);
      break;
    case 'identifier':
      v=v.replace(/\s/g,'').replace(/[^A-Za-z0-9@._-]/g,'').slice(0,60);
      break;
    case 'code':
      v=v.replace(/\D/g,'').slice(0,6);
      break;
    case 'text':
      v=v.replace(/[<>]/g,'').slice(0,200);
      break;
  }
  if(v!==before){
    el.value=v;
    // keep the cursor roughly where the person was typing instead of jumping to the end
    const diff=before.length-v.length;
    const pos=Math.max(0,(start||v.length)-Math.max(0,diff));
    try{el.setSelectionRange(pos,pos);}catch(e){}
  }
}

function getSemester(dateStr){
  if(!dateStr)return null;
  const d=new Date(dateStr);const yr=d.getFullYear();const mo=d.getMonth()+1;
  return mo<=6?`${yr}-S1`:`${yr}-S2`;
}
function currentSemester(){return getSemester(TODAY);}

function fmtDate(d){
  if(!d)return '-';
  const value=String(d).trim();
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value);
  const dt=new Date(dateOnly?`${value}T00:00:00`:value);
  if(Number.isNaN(dt.getTime()))return '-';
  return dt.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});
}
function fmtDateTime(d){
  if(!d)return '-';
  const dt=new Date(d);
  if(Number.isNaN(dt.getTime()))return '-';
  return dt.toLocaleString('en-PH',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtTime(t){if(!t)return'-';const [h,m]=t.split(':');const hr=parseInt(h);return `${hr===0?12:hr>12?hr-12:hr}:${m} ${hr<12?'AM':'PM'}`;}
function dayOfWeek(dateStr){return scheduleRules.dayOfWeek(dateStr);}

function statusBadge(s){
  const map={Scheduled:'info',Completed:'success',Cancelled:'danger','Pending':'warning','Active':'success','Suspended':'danger','No-show':'gray'};
  return `<span class="badge badge-${map[s]||'gray'}">${s}</span>`;
}
function collegeBadge(c){
  if(!c)return '';
  return `<span class="badge college-${c}">${c}</span>`;
}
function priorityBadge(p){
  const map={Student:'info',Teaching:'teal','Non-Teaching':'gray'};
  return `<span class="badge badge-${map[p]||'gray'}">${p||'-'}</span>`;
}

function genId(prefix,n){return`${prefix}-${String(n).padStart(4,'0')}`;}

function svgIcon(d,sz=14){return`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:${sz}px;height:${sz}px;vertical-align:middle"><path stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;}

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
