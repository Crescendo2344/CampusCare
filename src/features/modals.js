// modals: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {bindAction} from '../dependencies.js';
import {attachImageZoom} from '../ui/image-zoom.js';
// ================================================================
// MODALS
// ================================================================
// File previews keep the existing dialog DOM, including its scroll position and in-progress inputs.
const parentDialogs=()=>appState.clinicInformation.modalParents||(appState.clinicInformation.modalParents=[]);
export function openModal(html,{preserveParent=false}={}){
  const parent=appState.clinicInformation.activeModal;
  if(preserveParent&&parent?.isConnected){
    parentDialogs().push({element:parent,focus:document.activeElement,scrollTop:parent.scrollTop});
    parent.removeAttribute('id');parent.style.display='none';parent.inert=true;
  }else closeAllModals();
  const wrap=document.createElement('div');
  wrap.className='overlay show';
  wrap.id='active-modal';
  wrap.innerHTML=html;
  // A header close control is the sole dismissal action; substantive Cancel Appointment actions remain.
  for(const modal of wrap.querySelectorAll('.modal')){
    const close=modal.querySelector('.modal-header .close-btn');
    if(!close)continue;
    close.setAttribute('type','button');
    if(!close.hasAttribute('aria-label'))close.setAttribute('aria-label','Close '+(modal.querySelector('h3')?.textContent||'dialog'));
    for(const button of modal.querySelectorAll('.modal-footer button')){
      if(/^(cancel|close|exit)$/i.test(button.textContent.trim()))button.remove();
    }
    const footer=modal.querySelector('.modal-footer');
    if(footer&&!footer.textContent.trim()&&!footer.querySelector('button,a,input'))footer.remove();
  }
  const dismiss=()=>{const close=wrap.querySelector('.modal-header .close-btn');if(close)close.click();else closeAllModals();};
  // Route backdrop/Escape through the existing close callback, preserving camera and verification cleanup.
  wrap.addEventListener('click',event=>{if(event.target===wrap)dismiss();});
  wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss();}});
  wrap.setAttribute('role','dialog');wrap.setAttribute('aria-modal','true');wrap.tabIndex=-1;
  document.getElementById('modals').appendChild(wrap);wrap.focus();
  appState.clinicInformation.activeModal=wrap;
}
// Dismiss a preview back to the same parent rather than rebuilding a registration review.
export function closeTopModal(){
  appState.clinicInformation.activeModal?.remove();
  const previous=parentDialogs().pop();
  if(previous?.element.isConnected){
    const parent=previous.element;parent.id='active-modal';parent.style.display='';parent.inert=false;
    appState.clinicInformation.activeModal=parent;parent.scrollTop=previous.scrollTop;
    (previous.focus?.isConnected?previous.focus:parent).focus({preventScroll:true});
  }else appState.clinicInformation.activeModal=null;
}
// Verification steps opened from a form dialog (camera, photo review) sit on top of it and close back to it.
export function openLayeredModal(html,layered){
  if(!layered){openModal(html);return;}
  if(appState.clinicInformation.activeModal?.dataset.layer)closeTopModal();
  openModal(html,{preserveParent:true});
  appState.clinicInformation.activeModal.dataset.layer='1';
}
export function closeLayeredModal(){
  if(appState.clinicInformation.activeModal?.dataset.layer)closeTopModal();
  else closeAllModals();
}
export function closeAllModals(){
  // Navigation and logout clear all suspended dialogs so old records cannot reappear later.
  parentDialogs().length=0;
  document.getElementById('modals').innerHTML='';
  appState.clinicInformation.activeModal=null;
}

export function showFilePreview(fileName, fileDataUrl) {
  // Supabase private files are shown through short-lived signed HTTPS URLs.
  // Detect the underlying file type from the signed URL/path as well as data URLs.
  const src=String(fileDataUrl||'');
  const clean=src.split('?')[0].toLowerCase();
  const decoded=(()=>{try{return decodeURIComponent(clean)}catch{return clean}})();
  const isImage=src.startsWith('data:image/') ||
    /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(decoded);
  const isPdf=src.startsWith('data:application/pdf') || /\.pdf$/i.test(decoded);

  let preview='';
  if(isImage){
    preview=`<div class="zoom-viewport" id="preview-img-viewport" aria-label="${escapeHtml(fileName)} — scroll or pinch to zoom, drag to move"><img id="preview-img" src="${escapeHtml(src)}" alt="${escapeHtml(fileName)}"></div>`;
  }else if(isPdf){
    preview=`<iframe src="${escapeHtml(src)}" title="${escapeHtml(fileName)}"
      style="width:100%;height:58vh;border:0;border-radius:8px;background:#fff"></iframe>`;
  }else{
    preview=`<div class="alert alert-info show" style="display:block">
      Preview is not available for this file type.
      <div style="margin-top:.75rem">
        <a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">Open file</a>
      </div>
    </div>`;
  }

  openModal(`
    <div class="modal modal-lg file-preview-modal">
      <div class="modal-header">
        <h3>${escapeHtml(fileName)}</h3>
        <button class="close-btn" ${bindAction('click',(event,element)=>{closeTopModal()})}>✕</button>
      </div>
      <div class="modal-body file-preview-body" id="preview-img-wrap">
        ${preview}
      </div>
      ${isImage?`<div class="modal-footer zoom-toolbar">
        <span class="zoom-hint">Scroll or pinch to zoom · drag to move · double-click to toggle</span>
        <div class="zoom-controls">
          <button class="btn btn-sm" aria-label="Zoom out" ${bindAction('click',()=>previewZoom?.zoomOut())}><i class="bi bi-zoom-out" aria-hidden="true"></i></button>
          <button class="btn btn-sm zoom-level" id="preview-zoom-level" aria-label="Reset zoom" ${bindAction('click',()=>previewZoom?.reset())}>100%</button>
          <button class="btn btn-sm" aria-label="Zoom in" ${bindAction('click',()=>previewZoom?.zoomIn())}><i class="bi bi-zoom-in" aria-hidden="true"></i></button>
        </div>
      </div>`:''}
    </div>
  `,{preserveParent:true});
  previewZoom?.dispose();previewZoom=null;
  const viewport=document.getElementById('preview-img-viewport'),img=document.getElementById('preview-img');
  if(viewport&&img){
    previewZoom=attachImageZoom(viewport,img,{onChange:scale=>{const level=document.getElementById('preview-zoom-level');if(level)level.textContent=Math.round(scale*100)+'%';}});
    viewport.focus({preventScroll:true});
  }
}

let previewZoom=null;

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
