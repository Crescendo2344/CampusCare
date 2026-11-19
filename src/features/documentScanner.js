// documentScanner: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {resetRegistrationIds} from './idVerification.js';
import {currentSemester,getSemester,resetSelfiePreview} from './inputValidation.js';
import {escapeHtml} from './issueReports.js';
import {applyNavBadges} from './topbarAndNavigation.js';
import {appointmentRecords} from './appointmentService.js';
import {inventoryRecords} from './inventoryService.js';
import {detectUnit,extractIdName,extractIdNumber,scanMatches,voteReadings} from '../domain/id-scan.js';
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
  Object.assign(appState.documentScanner,{lastOcrRawText:'',lastOcrAllText:'',lastOcrVote:null,lastOcrBackText:'',lastOcrCleanText:'',lastOcrConfidence:0,lastOcrDocumentType:'',lastOcrDetectedId:'',scanSummary:null,lastFilled:[]});
  scannerStatus();
  const note=document.getElementById('r-id-scan-note');if(note)note.hidden=true;
}

// The ID guide in the camera is an upright card shape in the middle of the frame (see
// .id-guide-rectangle). Reading only that area, enlarged, works far better than the whole webcam
// frame, where the card is small and the room around it adds noise.
const GUIDE_HEIGHT=.80,GUIDE_CENTER_Y=.44,CARD_RATIO=54/86;
const loadImage=dataUrl=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=dataUrl;});

/** Areas of the photo that may hold the card, best guess first: the detected card edges, the guide, the whole photo. */
export function idCropRegions(width,height,detected=null){
  const regions=[];
  if(detected&&detected.width>width*.15&&detected.height>height*.15){
    const padX=detected.width*.06,padY=detected.height*.06;
    const x=Math.max(0,detected.x-padX),y=Math.max(0,detected.y-padY);
    regions.push({x,y,width:Math.min(width-x,detected.width+padX*2),height:Math.min(height-y,detected.height+padY*2)});
  }
  if(width>height*.8){
    // Webcam frames are landscape; the guide is a portrait card centred in them. A little extra
    // room on every side allows for a card held slightly off the guide.
    const h=Math.min(height,height*GUIDE_HEIGHT*1.08),w=Math.min(width,h*CARD_RATIO*1.25);
    const y=Math.max(0,Math.min(height-h,height*GUIDE_CENTER_Y-h/2));
    regions.push({x:(width-w)/2,y,width:w,height:h});
  }
  regions.push({x:0,y:0,width,height});
  return regions;
}

// A clearer copy for OCR: the region enlarged so the card is about 1400 px tall, greyscale, with
// the contrast stretched so faint print on a glossy card reads better.
function idCanvas(img,region){
  const r=region||{x:0,y:0,width:img.naturalWidth,height:img.naturalHeight};
  const scale=Math.min(4,Math.max(1,1400/Math.max(1,Math.max(r.width,r.height))));
  const w=Math.round(r.width*scale),h=Math.round(r.height*scale);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingQuality='high';ctx.drawImage(img,r.x,r.y,r.width,r.height,0,0,w,h);
  const data=ctx.getImageData(0,0,w,h),px=data.data,hist=new Array(256).fill(0);
  for(let i=0;i<px.length;i+=4){const g=Math.round(.299*px[i]+.587*px[i+1]+.114*px[i+2]);px[i]=g;hist[g]++;}
  // Ignore the darkest and brightest 1% when stretching.
  const total=w*h;let lo=0,hi=255,acc=0;
  for(;lo<255&&(acc+=hist[lo])<total*.01;lo++);
  acc=0;for(;hi>0&&(acc+=hist[hi])<total*.01;hi--);
  const range=Math.max(1,hi-lo);
  for(let i=0;i<px.length;i+=4){const v=Math.max(0,Math.min(255,(px[i]-lo)*255/range));px[i]=px[i+1]=px[i+2]=v;}
  ctx.putImageData(data,0,0);
  return canvas;
}
export async function enhanceIdImage(dataUrl,region=null){
  const img=typeof dataUrl==='string'?await loadImage(dataUrl):dataUrl;
  return idCanvas(img,region).toDataURL('image/jpeg',.92);
}

// Black text on white, decided pixel by pixel against the brightness around it (Sauvola's method).
// ID cards have colour gradients, glare and shadows, so one threshold for the whole card fails;
// a local one keeps printed names readable.
export function adaptiveThreshold(source,windowSize,k=.2){
  const w=source.width,h=source.height;
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);
  const data=ctx.getImageData(0,0,w,h),px=data.data,W=w+1;
  // Running sums (integral images) give each window's mean and spread in constant time.
  const sum=new window.Float64Array(W*(h+1)),sq=new window.Float64Array(W*(h+1));
  for(let y=0;y<h;y++){let row=0,row2=0;for(let x=0;x<w;x++){const v=px[(y*w+x)*4];row+=v;row2+=v*v;sum[(y+1)*W+x+1]=sum[y*W+x+1]+row;sq[(y+1)*W+x+1]=sq[y*W+x+1]+row2;}}
  const r=windowSize>>1,out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
    for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1),n=(x1-x0)*(y1-y0);
      const s=sum[y1*W+x1]-sum[y0*W+x1]-sum[y1*W+x0]+sum[y0*W+x0],s2=sq[y1*W+x1]-sq[y0*W+x1]-sq[y1*W+x0]+sq[y0*W+x0];
      const mean=s/n,sd=Math.sqrt(Math.max(0,s2/n-mean*mean));
      out[y*w+x]=px[(y*w+x)*4]>mean*(1+k*(sd/128-1))?255:0;}}
  for(let i=0;i<out.length;i++){px[i*4]=px[i*4+1]=px[i*4+2]=out[i];}
  ctx.putImageData(data,0,0);
  return canvas.toDataURL('image/png');
}

// How useful one reading is: a name and an ID number matter more than Tesseract's own confidence.
function readingScore(text,confidence){
  const ptype=document.getElementById('r-ptype')?.value||'Student';
  return (extractIdName(text)?2:0)+(extractIdNumber(text,ptype)?2:0)+(Number(confidence)||0)/100;
}

// side: 'front' reads everything; 'back' only fills what the front did not give (usually the ID number).
export async function analyzeIdImage(dataUrl,{side='front'}={}){
  if(side==='front')clearRegistrationScan();
  const version=appState.documentScanner.scanVersion,current=()=>version===appState.documentScanner.scanVersion;
  showScanNote('Reading your ID…','busy');
  let worker=null;
  try{
    const Tesseract=await loadTesseract();
    const image=await loadImage(dataUrl);
    let detected=null;
    try{
      const {inspectIdPhoto}=await import('../verification/id-controller.js');
      const found=await inspectIdPhoto(dataUrl);
      // inspectIdPhoto works on a copy whose longer side is 320 px.
      if(found?.box){const k=Math.max(image.naturalWidth,image.naturalHeight)/320;detected={x:found.box.x*k,y:found.box.y*k,width:found.box.width*k,height:found.box.height*k};}
    }catch{ /* the guide area is tried anyway */ }
    // Sparse-text mode suits ID cards: short lines scattered around a photo and logos.
    worker=await Tesseract.createWorker('eng');
    await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
    const ptype=document.getElementById('r-ptype')?.value||'Student';
    const readings=[];
    regions:for(const region of idCropRegions(image.naturalWidth,image.naturalHeight,detected)){
      const base=idCanvas(image,region);
      // Two local thresholds (fine and coarse print) and the plain greyscale copy.
      for(const make of [()=>adaptiveThreshold(base,Math.round(base.height/27)|1),()=>adaptiveThreshold(base,Math.round(base.height/18)|1,.12),()=>base.toDataURL('image/jpeg',.92)]){
        if(!current())return;
        const {data}=await worker.recognize(make());
        const text=String(data?.text||'').trim();
        readings.push({text,confidence:Number(data?.confidence)||0,score:readingScore(text,data?.confidence)});
        // Two readings agree on both the name and the ID number: enough.
        const vote=voteReadings(readings.map(r=>r.text),ptype);
        if(vote.nameVotes>=2&&vote.idVotes>=2)break regions;
      }
    }
    if(!current())return;
    // A digits-only pass on the best area: the ID number is the hardest part to read, and letters
    // such as I, O and S are no longer possible answers.
    const digitTexts=[];
    if(voteReadings(readings.map(r=>r.text),ptype).idVotes<2){
      const region=idCropRegions(image.naturalWidth,image.naturalHeight,detected)[0];
      const base=idCanvas(image,region);
      await worker.setParameters({tessedit_char_whitelist:'0123456789'});
      for(const source of [adaptiveThreshold(base,Math.round(base.height/27)|1),adaptiveThreshold(base,Math.round(base.height/18)|1,.12),base.toDataURL('image/jpeg',.92)]){
        if(!current())return;
        digitTexts.push(String((await worker.recognize(source))?.data?.text||''));
      }
    }
    const vote=voteReadings(readings.map(r=>r.text),ptype,digitTexts);
    readings.sort((a,b)=>b.score-a.score);
    const best=readings[0]||{text:'',confidence:0};
    // Matching what the applicant typed looks at every reading, so one good reading is enough.
    const allText=readings.map(r=>r.text).join('\n');
    if(side==='back'){
      appState.documentScanner.lastOcrBackText=allText;
    }else{
      appState.documentScanner.lastOcrRawText=best.text;
      appState.documentScanner.lastOcrVote=vote;
      appState.documentScanner.lastOcrAllText=allText;
      appState.documentScanner.lastOcrConfidence=Math.round(best.confidence);
      appState.documentScanner.lastOcrCleanText=best.text.replace(/[^\p{L}\p{N}\s.'\-:/]/gu,' ').replace(/\s+/g,' ').trim();
    }
    handleOcrResult(side);
  }catch(e){
    console.warn('ID scan failed',e);
    if(!current())return;
    showScanNote('Your ID could not be read automatically. That is fine: type your details yourself.','warn');
  }finally{
    try{await worker?.terminate();}catch{ /* already stopped */ }
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
  const vote=appState.documentScanner.lastOcrVote;
  appState.documentScanner.lastOcrDetectedId=vote?.idNumber||extractIdNumber(text,pt);
  const filled=[];
  const name=vote?(vote.nameVotes>=2||vote.readings===1?vote.name:null):extractIdName(appState.documentScanner.lastOcrRawText||text);
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
  const text=[appState.documentScanner.lastOcrAllText||appState.documentScanner.lastOcrRawText,appState.documentScanner.lastOcrBackText].filter(Boolean).join('\n');
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
