// The official CTU Main Campus letterhead and footer used on every printed or downloaded document.
// Inline styles keep it correct inside print frames, pop-ups and PDF renders that do not load the app CSS.
export const CTU_HEADER_SRC='/assets/dental-cert-header.png';
export const CTU_FOOTER_SRC='/assets/dental-cert-footer.png';

// Print frames and pop-ups start at about:blank, so images use the full address.
const absolute=src=>{try{return new URL(src,globalThis.location?.href).href;}catch{return src;}};

// The header image also carries a college line at the bottom; the crop (797×168 of 797×213) leaves it out.
export function ctuHeaderHtml(){
  return `<div class="ctu-lh-head" data-ctu-letterhead="header" style="overflow:hidden;aspect-ratio:797/168;width:74%;max-width:560px;margin:0 auto 6px"><img src="${absolute(CTU_HEADER_SRC)}" alt="Cebu Technological University – Main Campus letterhead" style="display:block;width:100%;height:auto"></div>`;
}

export function ctuFooterHtml(){
  return `<div class="ctu-lh-foot" data-ctu-letterhead="footer" style="margin-top:18px;padding-top:6px"><img src="${absolute(CTU_FOOTER_SRC)}" alt="University rankings and accreditations" style="display:block;width:100%;height:auto"></div>`;
}

// A complete printable page. The header and footer sit in a table's thead/tfoot, which browsers
// repeat on every printed page, so long documents keep the letterhead on each page.
export function ctuPrintDocument({title='CampusCare document',body='',css='',head=''}={}){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${head}<style>
    @page{size:A4;margin:10mm 12mm}
    body{margin:0;background:#fff;color:#111;font:12px/1.5 Arial,Helvetica,sans-serif}
    table.ctu-page{width:100%;border-collapse:collapse}
    table.ctu-page>thead>tr>td,table.ctu-page>tfoot>tr>td,table.ctu-page>tbody>tr>td{padding:0;border:0}
    .ctu-page-body{padding:4px 0}
    ${css}
  </style></head><body><table class="ctu-page"><thead><tr><td>${ctuHeaderHtml()}</td></tr></thead>
    <tfoot><tr><td>${ctuFooterHtml()}</td></tr></tfoot>
    <tbody><tr><td><div class="ctu-page-body">${body}</div></td></tr></tbody></table></body></html>`;
}

// Prints a document through a hidden frame once its images have loaded.
export function printCtuDocument(options){
  const frame=document.createElement('iframe');
  frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
  frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.append(frame);
  const doc=frame.contentDocument;
  doc.open();doc.write(ctuPrintDocument(options));doc.close();
  const run=()=>{frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>frame.remove(),1500);};
  const pending=[...doc.images].filter(img=>!img.complete);
  if(!pending.length){setTimeout(run,100);return;}
  let left=pending.length;const done=()=>{if(--left<=0)run();};
  for(const img of pending){img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true});}
  setTimeout(()=>{if(left>0){left=0;run();}},2500);
}
