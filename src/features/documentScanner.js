// documentScanner: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {resetRegistrationIds} from './idVerification.js';
import {currentSemester,getSemester,resetSelfiePreview} from './inputValidation.js';
import {escapeHtml} from './issueReports.js';
import {applyNavBadges} from './topbarAndNavigation.js';
import {appointmentRecords} from './appointmentService.js';
import {inventoryRecords} from './inventoryService.js';
// ================================================================
// REGISTRATION DOCUMENT SCANNER
// Reads Student and Employee ID front photos locally in the browser.
// OCR is assistive only: a low-confidence scan never blocks registration.
// ================================================================

export function scannerStatus(html='',tone='',progress=null){
  // Recognition remains internal; registration never displays OCR output or technical scores.
  return;
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





// Invalidate in-flight recognition when an ID is replaced or the person type changes.
export function clearRegistrationScan(){
  appState.documentScanner.scanVersion=(appState.documentScanner.scanVersion||0)+1;
  Object.assign(appState.documentScanner,{lastOcrRawText:'',lastOcrCleanText:'',lastOcrConfidence:0,lastOcrDocumentType:'',lastOcrDetectedId:''});
  scannerStatus();
}

export async function analyzeIdImage(dataUrl,fallbackDataUrl=''){
  clearRegistrationScan();
  const version=appState.documentScanner.scanVersion,current=()=>version===appState.documentScanner.scanVersion;
  scannerStatus('Scanning text and checking the document…','',18);
  try{
    const Tesseract=await loadTesseract();
    const run=async source=>{
      const result=await Tesseract.recognize(source,'eng',{
        logger:m=>{
          if(current()&&m.status==='recognizing text'&&Number.isFinite(m.progress)){
            scannerStatus('Scanning text and checking the document…','',20+Math.round(m.progress*68));
          }
        }
      });
      return result?.data||{};
    };

    let data=await run(dataUrl);
    if(!current())return;
    // One fallback OCR pass is used only when the enhanced image scored poorly.
    if((Number(data.confidence)||0)<42&&fallbackDataUrl){
      scannerStatus('Trying the original image for a clearer read…','',72);
      const fallback=await run(fallbackDataUrl);
      if((Number(fallback.confidence)||0)>(Number(data.confidence)||0))data=fallback;
    }

    if(!current())return;
    appState.documentScanner.lastOcrRawText=String(data.text||'').trim();
    appState.documentScanner.lastOcrConfidence=Math.round(Number(data.confidence)||0);
    appState.documentScanner.lastOcrCleanText=appState.documentScanner.lastOcrRawText
      .replace(/[^\p{L}\p{N}\s.'\-:/]/gu,' ')
      .replace(/\s+/g,' ')
      .trim();

    handleOcrResult();
  }catch(e){
    if(!current())return;
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
  if(/\b(certificate of registration|registration form|officially enrolled)\b/.test(t))return 'COR';
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

export function recheckNameMatch(){
  // Staff compare the submitted details and original evidence during account approval.
}

export function sanitizeRegistrationId(el){
  const pt=document.getElementById('r-ptype')?.value||'Student';
  const max=pt==='Student'?7:5;
  const clean=String(el.value||'').replace(/\D/g,'').slice(0,max);
  if(el.value!==clean)el.value=clean;
}

export function updateRegistrationIdentityFields(){
  const pt=document.getElementById('r-ptype')?.value||'Student';
  // Evidence collected for a different person type must not be reused silently.
  if(appState.camera.registrationPersonType&&appState.camera.registrationPersonType!==pt){
    resetRegistrationIds();appState.camera.capturedSelfieDataUrl=null;
    resetSelfiePreview();
    clearRegistrationScan();
  }
  appState.camera.registrationPersonType=pt;
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
    verificationLabel.innerHTML=(isStudent?'Student ID — Front and Back':'Employee ID — Front and Back')+' <span class="required">*</span>';
  }
  if(verificationHelp){
    verificationHelp.textContent=isStudent
      ? 'Click to upload Student ID'
      : 'Click to upload Employee ID';
  }

  if(appState.documentScanner.lastOcrRawText)handleOcrResult();
  else scannerStatus();
}

// The Dental Clinic limit counts completed visits only; cancelled, no-show and upcoming bookings do not use
// it up. One open dental booking at a time keeps the limit from being booked past.
export function dentalQuotaState(patientId,excludeId=null){
  const sem=currentSemester();
  const dental=appointmentRecords().filter(a=>a.patientId===patientId&&a.clinic==='Dental Clinic'&&a.id!==excludeId);
  const completed=dental.filter(a=>a.status==='Completed'&&getSemester(a.date)===sem).length;
  const open=dental.find(a=>['Scheduled','Confirmed'].includes(a.status))||null;
  const limit=appState.data.DB.settings.dentalLimitPerSemester;
  return {completed,limit,open,limitReached:completed>=limit,blocked:completed>=limit||Boolean(open)};
}
export function checkDentalQuota(patientId,excludeId=null){
  return dentalQuotaState(patientId,excludeId).blocked;
}

export function getLowStock(){return inventoryRecords().filter(i=>!i.archived&&i.qty<=i.threshold);}

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
