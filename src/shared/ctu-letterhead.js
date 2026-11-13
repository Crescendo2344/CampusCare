// The official CTU Main Campus letterhead and footer used on every printed or downloaded document.
// Inline styles keep it correct inside print frames, pop-ups and PDF renders that do not load the app CSS.
export const CTU_LOGO_SRC='/assets/ctu-logo.png';
export const BAGONG_PILIPINAS_SRC='/assets/bagong-pilipinas.png';
export const CTU_FOOTER_SRC='/assets/dental-cert-footer.png';

// Print frames and pop-ups start at about:blank, so images use the full address.
const absolute=src=>{try{return new URL(src,globalThis.location?.href).href;}catch{return src;}};

// The clinic's own email and phone go in the letterhead (not the college's). System Settings updates them.
const DEFAULT_CONTACT={email:'ctumainmedclinic@gmail.com',phone:'(032) 402 4060 loc. 1142'};
let contact={...DEFAULT_CONTACT};
export function setLetterheadContact(settings={}){
  contact={email:String(settings.contactEmail||settings.contact_email||'').trim()||DEFAULT_CONTACT.email,
    phone:String(settings.contactPhone||settings.contact_number||'').trim()||DEFAULT_CONTACT.phone};
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The CTU Main Campus letterhead: university seal, address block and Bagong Pilipinas logo.
export function ctuHeaderHtml(){
  const line=(size,text,extra='')=>`<div style="font-size:${size}px;${extra}">${text}</div>`;
  // A table rather than flexbox, so Word documents keep the same layout as the browser and PDF.
  return `<table class="ctu-lh-head" data-ctu-letterhead="header" role="presentation" style="border-collapse:collapse;margin:0 auto 6px;font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.28"><tr>
    <td style="padding:0 14px 0 0;border:0;vertical-align:middle"><img data-ctu-cert-logo="1" src="${absolute(CTU_LOGO_SRC)}" alt="Cebu Technological University seal" width="80" height="80" style="width:80px;height:80px;object-fit:contain;display:block"></td>
    <td style="padding:0;border:0;text-align:center;vertical-align:middle">${line(12.5,'Republic of the Philippines')}${line(14,'CEBU TECHNOLOGICAL UNIVERSITY','font-weight:700;letter-spacing:.02em')}${line(12,'MAIN CAMPUS')}
      ${line(9.5,'M. J. Cuenco Avenue Cor. R. Palma Street, Cebu City, Philippines')}
      ${line(9.5,`Website: http://www.ctu.edu.ph &nbsp;E-mail: ${esc(contact.email)}`)}
      ${line(9.5,`Phone: ${esc(contact.phone)}`)}</td>
    <td style="padding:0 0 0 14px;border:0;vertical-align:middle"><img src="${absolute(BAGONG_PILIPINAS_SRC)}" alt="Bagong Pilipinas logo" width="74" height="70" style="width:74px;height:70px;object-fit:contain;display:block"></td>
  </tr></table>`;
}

export function ctuFooterHtml(){
  return `<div class="ctu-lh-foot" data-ctu-letterhead="footer" style="margin-top:18px;padding-top:6px"><img src="${absolute(CTU_FOOTER_SRC)}" alt="University rankings and accreditations" style="display:block;width:100%;height:auto"></div>`;
}

// A complete printable page. The header and footer sit in a table's thead/tfoot, which browsers
// repeat on every printed page, so long documents keep the letterhead on each page.
export function ctuPrintDocument({title='CampusCare document',body='',css='',head=''}={}){
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
