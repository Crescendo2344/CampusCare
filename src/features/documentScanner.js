// documentScanner: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {currentSemester,getSemester,previewFile,readFileAsDataURL} from './inputValidation.js';
import {escapeHtml} from './issueReports.js';
import {applyNavBadges} from './topbarAndNavigation.js';
import {appointmentRecords} from './appointmentService.js';
import {inventoryRecords} from './inventoryService.js';
// ================================================================
// REGISTRATION DOCUMENT SCANNER
// Reads School ID, Employee ID, or COR uploads locally in the browser.
// OCR is assistive only: a low-confidence scan never blocks registration.
// ================================================================

export function scannerStatus(html='',tone='',progress=null){
  const el=document.getElementById('id-analyze-status');
  if(!el)return;
  if(!html){
    el.style.display='none';
    el.innerHTML='';
    el.className='registration-scanner-status';
    return;
  }
  el.style.display='block';
  el.className=`registration-scanner-status${tone?' '+tone:''}`;
  const progressHtml=Number.isFinite(progress)
    ? `<div class="scanner-progress"><i style="width:${Math.max(0,Math.min(100,progress))}%"></i></div>`
    : '';
  el.innerHTML=html+progressHtml;
}

export function handleIdFileChange(input){
  previewFile(input,'r-file-preview');
  appState.camera.capturedIdDataUrl=null;
  const file=input.files&&input.files[0];
  if(!file){scannerStatus();return;}

  scanRegistrationDocumentFile(file).catch(e=>{
    console.error('Registration document scan:',e);
    scannerStatus(
      `Automatic scanning could not finish. You may still continue if the uploaded document is clear. <strong>${escapeHtml(e?.message||'')}</strong>`,
      'warning'
    );
  });
}

export function loadTesseract(){
  return new Promise((resolve,reject)=>{
    if(window.Tesseract){resolve(window.Tesseract);return;}
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('OCR library failed to initialize'));
    s.onerror=()=>reject(new Error('Could not load the OCR library'));
    document.head.appendChild(s);
  });
}

export function loadPdfJs(){
  return new Promise((resolve,reject)=>{
    if(window.pdfjsLib){resolve(window.pdfjsLib);return;}
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload=()=>{
      if(!window.pdfjsLib){reject(new Error('PDF scanner failed to initialize'));return;}
      window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror=()=>reject(new Error('Could not load the PDF scanner'));
    document.head.appendChild(s);
  });
}

export async function fileToOcrDataUrl(file){
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name||'')){
    scannerStatus('Preparing the first page of your PDF for scanning…','',12);
    const pdfjs=await loadPdfJs();
    const data=await file.arrayBuffer();
    const pdf=await pdfjs.getDocument({data}).promise;
    const page=await pdf.getPage(1);
    const viewport=page.getViewport({scale:1.8});
    const canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);
    canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx,viewport}).promise;
    return canvas.toDataURL('image/jpeg',.94);
  }
  if(!file.type.startsWith('image/'))throw new Error('Please upload a clear image or PDF document.');
  return await readFileAsDataURL(file);
}

export function enhanceOcrImage(dataUrl){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const maxSide=1900;
      const scale=Math.min(1,maxSide/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
      const w=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
      const h=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
      const canvas=document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.fillStyle='#fff';
      ctx.fillRect(0,0,w,h);
      ctx.drawImage(img,0,0,w,h);

      const image=ctx.getImageData(0,0,w,h);
      const d=image.data;
      for(let i=0;i<d.length;i+=4){
        const gray=.299*d[i]+.587*d[i+1]+.114*d[i+2];
        // Moderate contrast enhancement keeps colored IDs readable while
        // making printed text clearer for OCR.
        const contrast=Math.max(0,Math.min(255,(gray-128)*1.42+128));
        d[i]=d[i+1]=d[i+2]=contrast;
        d[i+3]=255;
      }
      ctx.putImageData(image,0,0);
      resolve(canvas.toDataURL('image/jpeg',.93));
    };
    img.onerror=()=>reject(new Error('The uploaded image could not be read.'));
    img.src=dataUrl;
  });
}

export async function scanRegistrationDocumentFile(file){
  appState.documentScanner.lastOcrRawText='';
  appState.documentScanner.lastOcrCleanText='';
  appState.documentScanner.lastOcrConfidence=0;
  appState.documentScanner.lastOcrDocumentType='';
  appState.documentScanner.lastOcrDetectedId='';

  scannerStatus('Preparing your document…','',8);
  const original=await fileToOcrDataUrl(file);
  const enhanced=await enhanceOcrImage(original);
  appState.camera.capturedIdDataUrl=original;

  await analyzeIdImage(enhanced,original);
}

export async function analyzeIdImage(dataUrl,fallbackDataUrl=''){
  scannerStatus('Scanning text and checking the document…','',18);
  try{
    const Tesseract=await loadTesseract();
    const run=async source=>{
      const result=await Tesseract.recognize(source,'eng',{
        logger:m=>{
          if(m.status==='recognizing text'&&Number.isFinite(m.progress)){
            scannerStatus('Scanning text and checking the document…','',20+Math.round(m.progress*68));
          }
        }
      });
      return result?.data||{};
    };

    let data=await run(dataUrl);
    // One fallback OCR pass is used only when the enhanced image scored poorly.
    if((Number(data.confidence)||0)<42&&fallbackDataUrl){
      scannerStatus('Trying the original image for a clearer read…','',72);
      const fallback=await run(fallbackDataUrl);
      if((Number(fallback.confidence)||0)>(Number(data.confidence)||0))data=fallback;
    }

    appState.documentScanner.lastOcrRawText=String(data.text||'').trim();
    appState.documentScanner.lastOcrConfidence=Math.round(Number(data.confidence)||0);
    appState.documentScanner.lastOcrCleanText=appState.documentScanner.lastOcrRawText
      .replace(/[^\p{L}\p{N}\s.'\-:/]/gu,' ')
      .replace(/\s+/g,' ')
      .trim();

    handleOcrResult();
  }catch(e){
    appState.documentScanner.lastOcrRawText='';
    appState.documentScanner.lastOcrCleanText='';
    scannerStatus(
      `Automatic scanning was unavailable or the document was too unclear. Your upload is still accepted; please double-check the typed details yourself.`,
      'warning'
    );
  }
}

export function normalizeOcrText(value=''){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function detectRegistrationDocumentType(rawText=''){
  const t=normalizeOcrText(rawText);
  if(/\b(certificate of registration|registration form|officially enrolled|semester|school year)\b/.test(t))return 'COR';
  if(/\b(employee id|employee no|faculty|personnel|staff id)\b/.test(t))return 'Employee ID';
  if(/\b(student id|student no|student number|college|university)\b/.test(t))return 'School ID';
  return 'Document';
}

export function extractRegistrationId(rawText='',personType='Student'){
  const expected=personType==='Student'?7:5;
  const normalized=String(rawText||'').replace(/[Oo]/g,'0');

  // Allow OCR spaces/hyphens between digits, then normalize.
  const flexible=new RegExp(`(?:\\d[\\s\\-:]*){${expected}}`,'g');
  const candidates=(normalized.match(flexible)||[])
    .map(v=>v.replace(/\D/g,''))
    .filter(v=>v.length===expected);

  const unique=[...new Set(candidates)];
  if(!unique.length)return '';

  // Prefer a candidate near ID-related wording.
  const lines=normalized.split(/\r?\n/);
  for(const line of lines){
    if(!/\b(id|student|employee|number|no\.?)\b/i.test(line))continue;
    for(const id of unique){
      if(line.replace(/\D/g,'').includes(id))return id;
    }
  }
  return unique[0];
}

export function extractOcrName(rawText=''){
  const lines=String(rawText||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  for(const line of lines){
    const m=line.match(/(?:student\s+name|employee\s+name|name)\s*[:\-]\s*([A-Za-zÀ-ÿ.'\- ]{4,80})/i);
    if(m){
      const cleaned=m[1].replace(/\s+/g,' ').trim();
      const parts=cleaned.split(' ').filter(Boolean);
      if(parts.length>=2)return {first:parts[0],last:parts[parts.length-1]};
    }
  }
  return null;
}

export function capitalizeName(s){
  return String(s||'').split(/([ '-])/).map(part=>{
    if(/^[A-Za-zÀ-ÿ]/.test(part))return part.charAt(0).toUpperCase()+part.slice(1).toLowerCase();
    return part;
  }).join('');
  applyNavBadges();
}

export function handleOcrResult(){
  const fnameInput=document.getElementById('r-fname');
  const lnameInput=document.getElementById('r-lname');
  const idInput=document.getElementById('r-idno');
  const pt=document.getElementById('r-ptype')?.value||'Student';
  if(!fnameInput||!lnameInput||!idInput||!appState.documentScanner.lastOcrRawText)return;

  appState.documentScanner.lastOcrDocumentType=detectRegistrationDocumentType(appState.documentScanner.lastOcrRawText);
  appState.documentScanner.lastOcrDetectedId=extractRegistrationId(appState.documentScanner.lastOcrRawText,pt);

  const name=extractOcrName(appState.documentScanner.lastOcrRawText);
  let autoFilledName=false;
  let autoFilledId=false;

  if(name&&!fnameInput.value.trim()&&!lnameInput.value.trim()){
    fnameInput.value=capitalizeName(name.first).slice(0,50);
    lnameInput.value=capitalizeName(name.last).slice(0,50);
    autoFilledName=true;
  }

  if(appState.documentScanner.lastOcrDetectedId&&!idInput.value.trim()){
    idInput.value=appState.documentScanner.lastOcrDetectedId;
    sanitizeRegistrationId(idInput);
    autoFilledId=true;
  }

  recheckNameMatch(autoFilledName||autoFilledId);
}

export function recheckNameMatch(justAutoFilled=false){
  const fnameInput=document.getElementById('r-fname');
  const lnameInput=document.getElementById('r-lname');
  const idInput=document.getElementById('r-idno');
  const pt=document.getElementById('r-ptype')?.value||'Student';
  if(!fnameInput||!lnameInput||!idInput||!appState.documentScanner.lastOcrRawText)return;

  const typedFirst=normalizeOcrText(fnameInput.value);
  const typedLast=normalizeOcrText(lnameInput.value);
  const scanned=normalizeOcrText(appState.documentScanner.lastOcrRawText);
  const typedId=String(idInput.value||'').replace(/\D/g,'');

  const firstMatch=typedFirst?scanned.includes(typedFirst):null;
  const lastMatch=typedLast?scanned.includes(typedLast):null;
  const idMatch=appState.documentScanner.lastOcrDetectedId&&typedId?appState.documentScanner.lastOcrDetectedId===typedId:null;

  const expectedDocs=pt==='Student'?['School ID','COR']:['Employee ID'];
  const docOkay=appState.documentScanner.lastOcrDocumentType==='Document'||expectedDocs.includes(appState.documentScanner.lastOcrDocumentType);

  const findings=[];
  findings.push(`<span><strong>Document:</strong> ${escapeHtml(appState.documentScanner.lastOcrDocumentType||'Document')}</span>`);
  findings.push(`<span><strong>OCR quality:</strong> ${appState.documentScanner.lastOcrConfidence}%</span>`);
  if(appState.documentScanner.lastOcrDetectedId)findings.push(`<span><strong>Detected ID:</strong> ${escapeHtml(appState.documentScanner.lastOcrDetectedId)}</span>`);

  let tone='';
  let headline='Document scanned. Please confirm the detected details.';
  if(!docOkay){
    tone='warning';
    headline=pt==='Student'
      ? `This looks like ${escapeHtml(appState.documentScanner.lastOcrDocumentType)}, while Student registration expects a School ID or COR.`
      : `This looks like ${escapeHtml(appState.documentScanner.lastOcrDocumentType)}, while personnel registration expects an Employee ID.`;
  }else if(typedFirst&&typedLast&&firstMatch&&lastMatch&&(idMatch!==false)){
    tone='success';
    headline=justAutoFilled
      ? 'Details were detected and filled from the document. Please verify them before submitting.'
      : 'The typed name and detected document details are consistent.';
  }else if((typedFirst&&typedLast)&&(!firstMatch||!lastMatch)){
    tone='warning';
    headline='The scanner could not confidently match the typed first and last name. Check the spelling or use a clearer image.';
  }else if(idMatch===false){
    tone='warning';
    headline='The typed ID number does not match the number detected on the uploaded document.';
  }

  scannerStatus(
    `<strong>${headline}</strong><div class="scanner-result-grid">${findings.join('')}</div>
     <div style="margin-top:.42rem">Scanning is assistive only; clinic staff will still verify the actual uploaded document.</div>`,
    tone
  );
}

export function sanitizeRegistrationId(el){
  const pt=document.getElementById('r-ptype')?.value||'Student';
  const max=pt==='Student'?7:5;
  const clean=String(el.value||'').replace(/\D/g,'').slice(0,max);
  if(el.value!==clean)el.value=clean;
}

export function updateRegistrationIdentityFields(){
  const pt=document.getElementById('r-ptype')?.value||'Student';
  const unitLabel=document.getElementById('r-unit-label');
  const unitSelect=document.getElementById('r-college');
  const idLabel=document.getElementById('r-idno-label');
  const idInput=document.getElementById('r-idno');
  const idNote=document.getElementById('r-idno-note');
  const verificationLabel=document.getElementById('r-verification-label');
  const verificationHelp=document.getElementById('r-verification-help');

  const isStudent=pt==='Student';
  const isTeaching=pt==='Teaching Personnel';
  const units=isStudent||isTeaching
    ? appState.documentScanner.REGISTRATION_ACADEMIC_UNITS
    : appState.documentScanner.REGISTRATION_NONTEACHING_DEPARTMENTS;

  if(unitLabel){
    unitLabel.innerHTML='College / Department <span class="required">*</span>';
  }

  if(unitSelect){
    const previous=unitSelect.value;
    unitSelect.innerHTML=units
      .map(([value,label])=>`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
      .join('');
    if(units.some(([value])=>value===previous))unitSelect.value=previous;
  }

  if(idLabel){
    idLabel.innerHTML=(isStudent?'Student ID No.':'Employee ID No.')+' <span class="required">*</span>';
  }

  if(idInput){
    const max=isStudent?7:5;
    idInput.maxLength=max;
    idInput.placeholder=isStudent?'e.g. 1350098':'e.g. 14982';
    sanitizeRegistrationId(idInput);
  }

  if(idNote){
    idNote.textContent=isStudent
      ? 'Student ID must contain exactly 7 digits.'
      : 'Employee ID must contain exactly 5 digits.';
  }

  if(verificationLabel){
    verificationLabel.innerHTML=(isStudent?'Upload School ID or COR':'Upload Employee ID')+' <span class="required">*</span>';
  }
  if(verificationHelp){
    verificationHelp.textContent=isStudent
      ? 'Click to upload School ID or COR'
      : 'Click to upload Employee ID';
  }

  if(appState.documentScanner.lastOcrRawText)handleOcrResult();
  else scannerStatus();
}

export function checkDentalQuota(patientId,excludeId=null){
  const sem=currentSemester();
  return appointmentRecords().filter(a=>
    a.patientId===patientId&&
    a.clinic==='Dental Clinic'&&
    a.status!=='Cancelled'&&
    getSemester(a.date)===sem&&
    a.id!==excludeId
  ).length>=appState.data.DB.settings.dentalLimitPerSemester;
}

export function getLowStock(){return inventoryRecords().filter(i=>!i.archived&&i.qty<=i.threshold);}

export function getPatientByUserId(uid){return appState.data.DB.patients.find(p=>p.userId===uid)||null;}
export function getUserById(id){return appState.data.DB.users.find(u=>u.id===id);}
export function getPatientById(id){return appState.data.DB.patients.find(p=>p.id===id);}

export function getDoctors(){const all=appState.data.DB.users.filter(u=>u.role==='Doctor'&&u.status==='Active');return appState.auth.currentUser?._realSupabase?all.filter(u=>u._realSupabase):all;}
export function getDentalDoctors(){return getDoctors().filter(d=>d.specialty==='Dental');}
export function getMedDoctors(){return getDoctors().filter(d=>d.specialty!=='Dental');}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.documentScanner.lastOcrRawText='';
  appState.documentScanner.lastOcrCleanText='';
  appState.documentScanner.lastOcrConfidence=0;
  appState.documentScanner.lastOcrDocumentType='';
  appState.documentScanner.lastOcrDetectedId='';
  appState.documentScanner.REGISTRATION_ACADEMIC_UNITS=[
  ['CAS','CAS'],
  ['CCICT','CCICT'],
  ['COE','COE'],
  ['COED','COED'],
  ['CME','CME'],
  ['COT','COT']
];
  appState.documentScanner.REGISTRATION_NONTEACHING_DEPARTMENTS=[
  ['Administration','Administration'],
  ['Registrar','Registrar'],
  ['Finance / Accounting','Finance / Accounting'],
  ['Human Resources','Human Resources'],
  ['Procurement / Supply','Procurement / Supply'],
  ['Library','Library'],
  ['ICT / MIS','ICT / MIS'],
  ['Student Affairs','Student Affairs'],
  ['Guidance Services','Guidance Services'],
  ['Research / Extension','Research / Extension'],
  ['Facilities / Maintenance','Facilities / Maintenance'],
  ['Security Services','Security Services'],
  ['Janitorial / Cleaning Services','Janitorial / Cleaning'],
  ['Clinic / Health Services','Clinic / Health Services']
];
}
