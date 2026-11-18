// Doctors' e-signatures. A doctor draws a signature once (Account Settings, or while issuing a
// certificate); it is kept on their account and placed on the certificates and dental records they issue.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {getUserById} from './documentScanner.js';
import {openModal,closeTopModal} from './modals.js';
import {toast} from './theme.js';
import {profileAction} from './workflowRequests.js';
import {bindAction} from '../dependencies.js';

// The saved signature of a doctor (UI user id), or '' when they have none.
export function signatureFor(userId){
  const me=appState.auth.currentUser;
  if(me&&Number(me.id)===Number(userId)&&me.savedSignature)return me.savedSignature;
  return getUserById(Number(userId))?.savedSignature||'';
}

// A drawing pad in its own dialog. `onSave(dataUrl)` receives a PNG of the drawing (white strokes are not
// used, so the image prints cleanly on paper).
export function openSignaturePad({title='Draw your signature',confirmLabel='Use signature',note='',onSave}={}){
  openModal(`<div class="modal sig-modal" role="dialog" aria-labelledby="sig-title">
    <div class="modal-header"><h3 id="sig-title">${escapeHtml(title)}</h3><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body">
      ${note?`<p class="text-muted sig-note">${escapeHtml(note)}</p>`:''}
      <div class="sig-pad"><canvas id="sig-canvas" width="900" height="300" aria-label="Signature drawing area. Draw with a mouse, pen or finger."></canvas><span class="sig-line" aria-hidden="true"></span></div>
      <div id="sig-msg"></div>
    </div>
    <div class="modal-footer"><button type="button" class="btn" ${bindAction('click',()=>clearPad())}>Clear</button><button type="button" class="btn btn-primary" id="sig-save" ${bindAction('click',async(event,element)=>{
      const canvas=document.getElementById('sig-canvas');
      if(!canvas||!canvas.dataset.drawn){document.getElementById('sig-msg').innerHTML='<div class="alert alert-warning show">Draw your signature first.</div>';return;}
      element.disabled=true;
      try{await onSave?.(trimmedSignature(canvas));closeTopModal();}
      catch(error){document.getElementById('sig-msg').innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'The signature could not be saved.')}</div>`;element.disabled=false;}
    })}>${escapeHtml(confirmLabel)}</button></div>
  </div>`,{preserveParent:Boolean(appState.clinicInformation.activeModal?.isConnected)});
  startPad(document.getElementById('sig-canvas'));
}

function startPad(canvas){
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#0b1f3a';
  let drawing=false,last=null;
  const point=event=>{const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};};
  canvas.addEventListener('pointerdown',event=>{drawing=true;last=point(event);canvas.setPointerCapture(event.pointerId);ctx.beginPath();ctx.arc(last.x,last.y,2.4,0,Math.PI*2);ctx.fillStyle=ctx.strokeStyle;ctx.fill();canvas.dataset.drawn='1';event.preventDefault();});
  canvas.addEventListener('pointermove',event=>{if(!drawing)return;const p=point(event);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;event.preventDefault();});
  const stop=()=>{drawing=false;};
  canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('pointerleave',stop);
}
function clearPad(){
  const canvas=document.getElementById('sig-canvas');if(!canvas)return;
  canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);delete canvas.dataset.drawn;
}
// Crops the drawing to its strokes (with a small margin) so the signature sits neatly on a document line.
function trimmedSignature(canvas){
  const ctx=canvas.getContext('2d'),{width,height}=canvas,data=ctx.getImageData(0,0,width,height).data;
  let minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>0){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
  if(maxX<0)return canvas.toDataURL('image/png');
  const pad=12,sx=Math.max(0,minX-pad),sy=Math.max(0,minY-pad),sw=Math.min(width,maxX+pad)-sx,sh=Math.min(height,maxY+pad)-sy;
  // Kept small (at most 420 px wide) so it fits inside the stored certificate document.
  const scale=Math.min(1,420/sw),out=document.createElement('canvas');
  out.width=Math.round(sw*scale);out.height=Math.round(sh*scale);
  out.getContext('2d').drawImage(canvas,sx,sy,sw,sh,0,0,out.width,out.height);
  return out.toDataURL('image/png');
}

// Saves (or, with '', removes) the signed-in doctor's e-signature on their account.
export async function saveMySignature(dataUrl){
  const me=appState.auth.currentUser;if(!me)return;
  if(me._realSupabase)await profileAction({action:'save_signature',signature_data:dataUrl||''});
  me.savedSignature=dataUrl||'';
  const listed=getUserById(me.id);if(listed&&listed!==me)listed.savedSignature=me.savedSignature;
}

// Account Settings card for doctors: see, draw again or remove the e-signature.
export function signatureCardHtml(){
  const me=appState.auth.currentUser;
  if(me?.role!=='Doctor')return '';
  const sig=me.savedSignature||'';
  return `<div class="card" id="acc-signature">
    <div class="card-header"><h3>E-signature</h3></div>
    <div class="sig-preview">${sig?`<img src="${escapeHtml(sig)}" alt="Your saved e-signature">`:'<span class="text-muted">No e-signature yet.</span>'}</div>
    <div class="td-actions" style="margin-top:.7rem">
      <button type="button" class="btn btn-sm btn-primary" ${bindAction('click',()=>openSignaturePad({title:'Draw your e-signature',confirmLabel:'Save e-signature',
        note:'It is placed above your name on the certificates and dental records you issue.',
        onSave:async data=>{await saveMySignature(data);refreshSignatureCard();toast('E-signature saved.','success');}}))}><i class="bi bi-pen" aria-hidden="true"></i> ${sig?'Draw again':'Draw e-signature'}</button>
      ${sig?`<button type="button" class="btn btn-sm" ${bindAction('click',async()=>{try{await saveMySignature('');refreshSignatureCard();toast('E-signature removed.','success');}catch(error){toast(error?.message||'The e-signature could not be removed.','error');}})}>Remove</button>`:''}
    </div>
  </div>`;
}
function refreshSignatureCard(){
  const card=document.getElementById('acc-signature');
  if(card)card.outerHTML=signatureCardHtml();
}

export function initializeFeature(){}
