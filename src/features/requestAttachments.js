// requestAttachments: optional supporting file for name, schedule and day-off requests.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {showFilePreview} from './modals.js';
import {readFileAsDataURL} from './inputValidation.js';
import {toast} from './theme.js';
import {appIcon} from '../ui/app-icons.js';
import {bindAction} from '../dependencies.js';

const ACCEPTED_TYPES=['image/jpeg','image/png','image/webp','application/pdf'];
export const MAX_REQUEST_ATTACHMENT_BYTES=5*1024*1024;

function pending(){return appState.requestAttachments??={};}

export function formatFileSize(bytes){
  const n=Number(bytes)||0;
  if(n<1024)return n+' B';
  if(n<1024*1024)return Math.round(n/1024)+' KB';
  return (n/1024/1024).toFixed(1)+' MB';
}

export function requestAttachmentFieldHtml(key,hint='e.g. medical certificate, memo, or government ID'){
  delete pending()[key];
  return `<div class="form-group req-attach" data-attach-key="${key}">
    <label for="${key}-file">Supporting file <span class="text-muted">(optional)</span></label>
    <input type="file" id="${key}-file" class="req-attach-input" accept="${ACCEPTED_TYPES.join(',')}" ${bindAction('change',(event,element)=>pickRequestAttachment(key,element))}>
    <label for="${key}-file" class="req-attach-drop" id="${key}-drop">${appIcon('paperclip',18)}<span><strong>Attach a file</strong><small>JPG, PNG, WebP or PDF · up to 5 MB · ${escapeHtml(hint)}</small></span></label>
    <div class="req-attach-chosen" id="${key}-chosen" hidden></div>
  </div>`;
}

export async function pickRequestAttachment(key,input){
  const file=input.files?.[0];
  input.value='';
  if(!file)return;
  if(!ACCEPTED_TYPES.includes(file.type)){toast('Attach a JPG, PNG, WebP image or a PDF.','warning');return;}
  if(file.size>MAX_REQUEST_ATTACHMENT_BYTES){toast('Supporting file is too large. Maximum size is 5 MB.','warning');return;}
  try{
    const dataUrl=await readFileAsDataURL(file);
    pending()[key]={dataUrl,name:file.name,mime:file.type,size:file.size};
    renderChosen(key);
  }catch{toast('The file could not be read. Try another file.','error');}
}

export function clearRequestAttachment(key){
  delete pending()[key];
  renderChosen(key);
}

function renderChosen(key){
  const chosen=document.getElementById(key+'-chosen'),drop=document.getElementById(key+'-drop');
  if(!chosen||!drop)return;
  const file=pending()[key];
  drop.hidden=!!file;chosen.hidden=!file;
  if(!file){chosen.innerHTML='';return;}
  const thumb=file.mime.startsWith('image/')
    ?`<img src="${file.dataUrl}" alt="">`
    :`<span class="req-attach-icon">PDF</span>`;
  chosen.innerHTML=`<button type="button" class="req-attach-file" title="Preview" ${bindAction('click',()=>showFilePreview(file.name,file.dataUrl))}>${thumb}<span><strong>${escapeHtml(file.name)}</strong><small>${formatFileSize(file.size)} · tap to preview</small></span></button>
    <button type="button" class="btn btn-xs" aria-label="Remove supporting file" ${bindAction('click',()=>clearRequestAttachment(key))}>Remove</button>`;
}

// Fields for workflowAction; empty when nothing was attached.
export function requestAttachmentPayload(key){
  const file=pending()[key];
  return file?{attachment_data_url:file.dataUrl,attachment_name:file.name}:{};
}

// Local (demo) records keep the file inline so the review modal can show it.
export function requestAttachmentLocal(key){
  const file=pending()[key];
  return file?{attachmentUrl:file.dataUrl,attachmentName:file.name,attachmentMime:file.mime,attachmentSize:file.size}:{};
}

export function hasRequestAttachment(r){return !!(r?.attachmentUrl||r?.attachmentName);}

export function requestAttachmentBadge(r){
  return hasRequestAttachment(r)?`<span class="req-attach-badge" title="Has a supporting file">${appIcon('paperclip',13)}</span>`:'';
}

export function requestAttachmentViewHtml(r){
  if(!hasRequestAttachment(r))return '<p class="text-muted req-attach-none">No supporting file was attached.</p>';
  const name=r.attachmentName||'Supporting file';
  if(!r.attachmentUrl)return `<p class="text-muted">${escapeHtml(name)} — the file link expired. Reopen this request to refresh it.</p>`;
  const isImage=String(r.attachmentMime||'').startsWith('image/')||/\.(jpe?g|png|webp)(\?|$)/i.test(r.attachmentUrl)||r.attachmentUrl.startsWith('data:image/');
  return `<button type="button" class="req-attach-file req-attach-view" ${bindAction('click',()=>showFilePreview(name,r.attachmentUrl))}>
    ${isImage?`<img src="${escapeHtml(r.attachmentUrl)}" alt="">`:'<span class="req-attach-icon">PDF</span>'}
    <span><strong>${escapeHtml(name)}</strong><small>${r.attachmentSize?formatFileSize(r.attachmentSize)+' · ':''}Open preview</small></span>
  </button>`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
