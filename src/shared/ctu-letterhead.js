// The official CTU Main Campus letterhead and footer used on every printed or downloaded document.
// Inline styles keep it correct inside print frames, pop-ups and PDF renders that do not load the app CSS.
export const CTU_LOGO_SRC='/assets/ctu-logo.png';
export const BAGONG_PILIPINAS_SRC='/assets/bagong-pilipinas.png';
export const CTU_FOOTER_SRC='/assets/dental-cert-footer.png';

// Print frames and pop-ups start at about:blank, so images use the full address.
const absolute=src=>{try{return new URL(src,globalThis.location?.href).href;}catch{return src;}};

// The clinic's own email and phone go in the letterhead (not the college's). System Settings updates them.
// The Dental Clinic prints its own address, as on its paper forms.
const DEFAULT_CONTACT={email:'ctumainmedclinic@gmail.com',phone:'(032) 402 4060 loc. 1142'};
export const DENTAL_CLINIC_EMAIL='ctudentalclinic20@gmail.com';
let contact={...DEFAULT_CONTACT};
export function setLetterheadContact(settings={}){
  contact={email:String(settings.contactEmail||settings.contact_email||'').trim()||DEFAULT_CONTACT.email,
    phone:String(settings.contactPhone||settings.contact_number||'').trim()||DEFAULT_CONTACT.phone};
}
// The clinic a document belongs to when the caller does not say: the signed-in staff member's or doctor's.
let clinicSource=()=>'';
export function setLetterheadClinicSource(source){clinicSource=typeof source==='function'?source:()=>'';}
export const currentLetterheadClinic=()=>clinicSource();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The clinic forms print the trunk line in international form: "(032) 402 4060" becomes "+6332 402 4060".
export function letterheadPhone(phone){
  return String(phone||'').trim().replace(/^\(?0(\d{2})\)?[\s-]*/,'+63$1 ');
}
// "Dental Clinic" → DENTAL CLINIC; documents of both clinics (administrators) say MEDICAL AND DENTAL CLINIC.
export function letterheadUnit(clinic){
  return clinic==='Dental Clinic'?'DENTAL CLINIC':clinic==='Medical Clinic'?'MEDICAL CLINIC':'MEDICAL AND DENTAL CLINIC';
}
export function letterheadContact(clinic){
  return {email:clinic==='Dental Clinic'?DENTAL_CLINIC_EMAIL:contact.email,phone:letterheadPhone(contact.phone)};
}

// The fixed lines of the clinic forms' letterhead (the email and phone follow below them).
export const LETTERHEAD_LINES=['REPUBLIC OF THE PHILIPPINES','CEBU TECHNOLOGICAL UNIVERSITY','MAIN CAMPUS','M. J. Cuenco Avenue Cor. R. Palma Street, Cebu City, Philippines'];

// The CTU Main Campus letterhead, laid out like the clinic's paper forms: university seal, the
// university and campus address block, the clinic's email and phone, the Bagong Pilipinas logo,
// then the clinic name. `clinic` is 'Dental Clinic' or 'Medical Clinic' ('' for both clinics);
// `unit:false` leaves the clinic name out for documents that place it themselves.
export function ctuHeaderHtml({clinic,unit=true}={}){
  const which=clinic===undefined?clinicSource():clinic;
  const {email,phone}=letterheadContact(which);
  const line=(size,text,extra='')=>`<div style="font-size:${size}px;${extra}">${text}</div>`;
  // A table rather than flexbox, so Word documents keep the same layout as the browser and PDF.
  return `<table class="ctu-lh-head" data-ctu-letterhead="header" role="presentation" style="border-collapse:collapse;margin:0 auto 4px;font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.3"><tr>
    <td style="padding:0 16px 0 0;border:0;vertical-align:middle"><img data-ctu-cert-logo="1" src="${absolute(CTU_LOGO_SRC)}" alt="Cebu Technological University seal" width="84" height="84" style="width:84px;height:84px;object-fit:contain;display:block"></td>
    <td style="padding:0;border:0;text-align:center;vertical-align:middle">${line(11.5,LETTERHEAD_LINES[0])}${line(14,LETTERHEAD_LINES[1],'font-weight:700;letter-spacing:.03em')}${line(11.5,LETTERHEAD_LINES[2],'font-weight:700')}
      ${line(10.5,LETTERHEAD_LINES[3])}
      ${line(10.5,esc(email))}
      ${line(10.5,`Phone: ${esc(phone)}`)}</td>
    <td style="padding:0 0 0 16px;border:0;vertical-align:middle"><img src="${absolute(BAGONG_PILIPINAS_SRC)}" alt="Bagong Pilipinas logo" width="80" height="76" style="width:80px;height:76px;object-fit:contain;display:block"></td>
  </tr></table>${unit?`<div class="ctu-lh-unit" data-ctu-letterhead="unit" style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:.03em;color:#111;margin:2px 0 8px">${letterheadUnit(which)}</div>`:''}`;
}

// The footer strip is 1332×91; Word needs an explicit size, other documents scale it to the page width.
export function ctuFooterHtml({width=0}={}){
  const size=width?` width="${width}" height="${Math.round(width*91/1332)}"`:'';
  return `<div class="ctu-lh-foot" data-ctu-letterhead="footer" style="margin-top:18px;padding-top:6px"><img src="${absolute(CTU_FOOTER_SRC)}" alt="University rankings and accreditations"${size} style="display:block;${width?`width:${width}px;height:${Math.round(width*91/1332)}px`:'width:100%;height:auto'}"></div>`;
}

// A complete printable page. The header and footer sit in a table's thead/tfoot, which browsers
// repeat on every printed page, so long documents keep the letterhead on each page.
// A zero page margin keeps the browser from printing its own date, title and address lines; the page
// spacing comes from the side padding and the repeated header and footer cells instead.
// `pages` prints several documents in one job, each starting on a new sheet with its own letterhead.
export function ctuPrintDocument({title='CampusCare document',body='',pages=null,css='',head='',landscape=false,clinic,unit=true}={}){
  const page=content=>`<table class="ctu-page"><thead><tr><td>${ctuHeaderHtml({clinic,unit})}</td></tr></thead>
    <tfoot><tr><td>${ctuFooterHtml()}</td></tr></tfoot>
    <tbody><tr><td><div class="ctu-page-body">${content}</div></td></tr></tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${head}<style>
    @page{size:A4 ${landscape?'landscape':'portrait'};margin:0}
    body{margin:0;padding:0 12mm;background:#fff;color:#111;font:12px/1.5 Arial,Helvetica,sans-serif}
    table.ctu-page{width:100%;border-collapse:collapse}
    table.ctu-page>thead>tr>td,table.ctu-page>tfoot>tr>td,table.ctu-page>tbody>tr>td{padding:0;border:0}
    table.ctu-page>thead>tr>td{padding-top:10mm}
    table.ctu-page>tfoot>tr>td{padding-bottom:8mm}
    table.ctu-page+table.ctu-page{break-before:page;page-break-before:always}
    .ctu-page-body{padding:4px 0}
    ${css}
  </style></head><body>${(Array.isArray(pages)&&pages.length?pages:[body]).map(page).join('')}</body></html>`;
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
