// documentScanner: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {resetRegistrationIds} from './idVerification.js';
import {currentSemester,getSemester,resetSelfiePreview} from './inputValidation.js';
import {escapeHtml} from './issueReports.js';
import {applyNavBadges} from './topbarAndNavigation.js';
import {appointmentRecords} from './appointmentService.js';
import {inventoryRecords} from './inventoryService.js';
import {detectUnit,extractIdName,extractIdNumber,scanMatches} from '../domain/id-scan.js';
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
  Object.assign(appState.documentScanner,{lastOcrRawText:'',lastOcrBackText:'',lastOcrCleanText:'',lastOcrConfidence:0,lastOcrDocumentType:'',lastOcrDetectedId:'',scanSummary:null,lastFilled:[]});
  scannerStatus();
  const note=document.getElementById('r-id-scan-note');if(note)note.hidden=true;
}

// A clearer copy for OCR: at least 1600 px wide, greyscale, with the contrast stretched so faint
// print on a glossy card reads better. The original is used too if it reads better.
export async function enhanceIdImage(dataUrl){
  const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=dataUrl;});
  const scale=Math.min(2.5,Math.max(1,1600/Math.max(1,img.naturalWidth)));
  const w=Math.round(img.naturalWidth*scale),h=Math.round(img.naturalHeight*scale);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);
  const data=ctx.getImageData(0,0,w,h),px=data.data,hist=new Array(256).fill(0);
  for(let i=0;i<px.length;i+=4){const g=Math.round(.299*px[i]+.587*px[i+1]+.114*px[i+2]);px[i]=g;hist[g]++;}
  // Ignore the darkest and brightest 1% when stretching.
  const total=w*h;let lo=0,hi=255,acc=0;
  for(;lo<255&&(acc+=hist[lo])<total*.01;lo++);
  acc=0;for(;hi>0&&(acc+=hist[hi])<total*.01;hi--);
  const range=Math.max(1,hi-lo);
  for(let i=0;i<px.length;i+=4){const v=Math.max(0,Math.min(255,(px[i]-lo)*255/range));px[i]=px[i+1]=px[i+2]=v;}
  ctx.putImageData(data,0,0);
  return canvas.toDataURL('image/jpeg',.92);
}

// side: 'front' reads everything; 'back' only fills what the front did not give (usually the ID number).
export async function analyzeIdImage(dataUrl,{side='front'}={}){
  if(side==='front')clearRegistrationScan();
  const version=appState.documentScanner.scanVersion,current=()=>version===appState.documentScanner.scanVersion;
  showScanNote('Reading your ID…','busy');
  try{
    const Tesseract=await loadTesseract();
    const run=async source=>(await Tesseract.recognize(source,'eng'))?.data||{};
    let data={};
    try{data=await run(await enhanceIdImage(dataUrl));}catch{ /* fall back to the original below */ }
    if(!current())return;
    if((Number(data.confidence)||0)<60){
      const original=await run(dataUrl);
      if((Number(original.confidence)||0)>(Number(data.confidence)||0))data=original;
    }
    if(!current())return;
    const text=String(data.text||'').trim();
    if(side==='back'){
      appState.documentScanner.lastOcrBackText=text;
    }else{
      appState.documentScanner.lastOcrRawText=text;
      appState.documentScanner.lastOcrConfidence=Math.round(Number(data.confidence)||0);
      appState.documentScanner.lastOcrCleanText=text.replace(/[^\p{L}\p{N}\s.'\-:/]/gu,' ').replace(/\s+/g,' ').trim();
    }
    handleOcrResult(side);
  }catch(e){
    if(!current())return;
    showScanNote('Your ID could not be read automatically. That is fine: type your details yourself.','warn');
  }
}

export function normalizeOcrText(value=''){
  return String(value||'')
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
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

export function extractRegistrationId(rawText='',personType='Student'){return extractIdNumber(rawText,personType);}
export function extractOcrName(rawText=''){return extractIdName(rawText);}

export function capitalizeName(s){
  return String(s||'').split(/([ '-])/).map(part=>{
    if(/^[A-Za-zÀ-ÿ]/.test(part))return part.charAt(0).toUpperCase()+part.slice(1).toLowerCase();
    return part;
  }).join('');
}

// A short note under the ID photos: what was read and filled, or what does not match. Never the raw text.
function showScanNote(text,tone=''){
  let note=document.getElementById('r-id-scan-note');
  const anchor=document.getElementById('r-id-status');
  if(!note&&anchor){note=document.createElement('p');note.id='r-id-scan-note';note.setAttribute('aria-live','polite');anchor.after(note);}
  if(!note)return;
  note.className=`registration-scan-note ${tone}`;note.hidden=!text;
  note.innerHTML=text?`<i class="bi ${tone==='busy'?'bi-hourglass-split':tone==='warn'?'bi-exclamation-triangle':'bi-upc-scan'}" aria-hidden="true"></i> <span>${text}</span>`:'';
}
// Fill a field the applicant left empty, or one the scan filled before (a new photo replaces it).
function fillFromScan(input,value,key){
  if(!input||!value)return false;
  const filled=appState.documentScanner.autofilled??={};
  const current=input.value.trim();
  if(current&&current!==filled[key])return false;
  if(current===value)return false;
  input.value=value;filled[key]=value;
  input.classList.add('scan-filled');setTimeout(()=>input.classList.remove('scan-filled'),4000);
  input.dispatchEvent(new window.Event('input',{bubbles:true}));
  return true;
}

export function handleOcrResult(side='front'){
  const fnameInput=document.getElementById('r-fname');
  const lnameInput=document.getElementById('r-lname');
  const idInput=document.getElementById('r-idno');
  const collegeInput=document.getElementById('r-college');
  const pt=document.getElementById('r-ptype')?.value||'Student';
  const text=[appState.documentScanner.lastOcrRawText,appState.documentScanner.lastOcrBackText].filter(Boolean).join('\n');
  if(!fnameInput||!lnameInput||!idInput||!text){if(side==='front')showScanNote('Nothing readable was found on the ID photo. Type your details yourself, or retake a sharper photo.','warn');return;}

  appState.documentScanner.lastOcrDocumentType=detectRegistrationDocumentType(appState.documentScanner.lastOcrRawText||text);
  appState.documentScanner.lastOcrDetectedId=extractIdNumber(text,pt);
  const filled=[];
  const name=extractIdName(appState.documentScanner.lastOcrRawText||text);
  if(name){
    if(fillFromScan(fnameInput,name.first.slice(0,50),'first'))filled.push('first name');
    if(fillFromScan(lnameInput,name.last.slice(0,50),'last'))filled.push('last name');
  }
  if(fillFromScan(idInput,appState.documentScanner.lastOcrDetectedId,'id')){sanitizeRegistrationId(idInput);filled.push(pt==='Student'?'Student ID number':'Employee ID number');}
  const units=pt==='Non-Teaching Personnel'?appState.documentScanner.REGISTRATION_NONTEACHING_DEPARTMENTS:appState.documentScanner.REGISTRATION_ACADEMIC_UNITS;
  const unit=detectUnit(text,units||[]);
  if(collegeInput&&unit&&!collegeInput.value){collegeInput.value=unit;collegeInput.dispatchEvent(new window.Event('change',{bubbles:true}));filled.push(pt==='Non-Teaching Personnel'?'department':'college');}
  appState.documentScanner.lastFilled=filled;
  recheckNameMatch();
}

// Compares what the applicant typed with the ID text, keeps a summary for the registration, and says so.
export function recheckNameMatch(){
  const text=[appState.documentScanner.lastOcrRawText,appState.documentScanner.lastOcrBackText].filter(Boolean).join('\n');
  if(!text){appState.documentScanner.scanSummary=null;return;}
  const typed={first:document.getElementById('r-fname')?.value||'',last:document.getElementById('r-lname')?.value||'',idNo:document.getElementById('r-idno')?.value||''};
  const match=scanMatches(text,typed);
  appState.documentScanner.scanSummary={...match,confidence:appState.documentScanner.lastOcrConfidence||0,
    document_type:appState.documentScanner.lastOcrDocumentType||'',filled:appState.documentScanner.lastFilled||[]};
  const filled=appState.documentScanner.lastFilled||[];
  const problems=[typed.last&&!match.name_match&&'the name you typed',typed.idNo&&!match.id_match&&'the ID number you typed'].filter(Boolean);
  const lead=filled.length?`Filled from your ID: ${filled.join(', ')}. Please check them.`:'Your ID was read.';
  showScanNote(problems.length?`${lead} We could not find ${problems.join(' or ')} on the ID photo. Check the spelling, or retake a clearer photo.`:lead,problems.length?'warn':'ok');
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
  // Only students have a year level.
  const yearGroup=document.getElementById('r-year-group');
  if(yearGroup){yearGroup.hidden=!isStudent;if(!isStudent){const year=document.getElementById('r-year');if(year)year.value='';}}
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
