// ================================================================
// MODALS
// ================================================================
function openModal(html){
  closeAllModals();
  const wrap=document.createElement('div');
  wrap.className='overlay show';
  wrap.id='active-modal';
  wrap.innerHTML=html;
  wrap.addEventListener('click',e=>{if(e.target===wrap)closeAllModals();});
  document.getElementById('modals').appendChild(wrap);
  activeModal=wrap;
}
function closeAllModals(){
  document.getElementById('modals').innerHTML='';
  activeModal=null;
}

function showFilePreview(fileName, fileDataUrl) {
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
    preview=`<img id="preview-img" src="${escapeHtml(src)}"
      style="max-width:100%;max-height:58vh;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.12);cursor:zoom-in;transition:width .15s"
      onclick="toggleImageZoom(this)" alt="${escapeHtml(fileName)}">`;
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
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3>${escapeHtml(fileName)}</h3>
        <button class="close-btn" onclick="closeAllModals()">✕</button>
      </div>
      <div class="modal-body" style="text-align:center;max-height:68vh;overflow:auto;background:rgba(0,0,0,.04);border-radius:10px" id="preview-img-wrap">
        ${preview}
      </div>
      ${isImage?`<p class="form-note no-print" style="text-align:center;margin-top:.4rem">Click the photo to zoom in, click again to zoom out.</p>`:''}
      <div class="modal-footer">
        ${isImage?`<button class="btn btn-sm" onclick="zoomImageStep(-1)">➖ Zoom Out</button><button class="btn btn-sm" onclick="zoomImageStep(1)">➕ Zoom In</button>`:''}
        <button class="btn" onclick="closeAllModals()">Close</button>
      </div>
    </div>
  `);
}

function toggleImageZoom(img){
  const zoomed=img.classList.toggle('zoomed');
  img.style.maxWidth=zoomed?'none':'100%';
  img.style.width=zoomed?'220%':'auto';
  img.style.cursor=zoomed?'zoom-out':'zoom-in';
}

function zoomImageStep(delta){
  const img=document.getElementById('preview-img');
  if(!img)return;
  let pct=parseInt(img.dataset.zoomPct||'100');
  pct=Math.min(400,Math.max(50,pct+delta*40));
  img.dataset.zoomPct=pct;
  img.style.maxWidth=pct>100?'none':'100%';
  img.style.width=pct+'%';
  img.style.cursor=pct>100?'zoom-out':'zoom-in';
  img.classList.toggle('zoomed',pct>100);
}
