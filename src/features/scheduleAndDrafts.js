// scheduleAndDrafts: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {appointmentRecords} from './appointmentService.js';
import {dayOfWeek} from './inputValidation.js';
import {appointmentSlotBaseTimes,onClinicChange,openBookApptModal,refreshAvailableDoctorsForDate,selectSlot,slotAvailabilityState} from './bookingForm.js';
import {toast} from './theme.js';
import {applyDueScheduleChanges,openScheduleChangeRequest} from './workflowRequests.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {createDraftStorage,scheduleRules} from '../dependencies.js';
// Compatibility adapters pass current application data to the independent schedule module.
// Existing forms and inline handlers keep their public names during the migration.
export function clinicToday(){return scheduleRules.clinicToday();}
export function canonicalSchedule(s){return scheduleRules.canonicalSchedule(s);}
export function scheduleConflicts(doc,proposal,effectiveDate){
  return scheduleRules.scheduleConflicts(doc,proposal,effectiveDate,appointmentRecords());
}
export function validateSchedule(proposal,effectiveDate,doc,checkDuplicate=true){
  return scheduleRules.validateSchedule(proposal,effectiveDate,doc,checkDuplicate,{
    today:clinicToday(),appointments:appointmentRecords(),
    requests:appState.data.DB.scheduleChangeRequests||[],settings:appState.data.DB.settings
  });
}
export function validateCampusBooking(doc,pt,date,time,editId,clinic){
  if(doc)doc=campusScheduleForDate(doc,date);
  if(!doc||doc.status!=='Active'||!pt)return 'Choose an active doctor and valid patient.';
  if(appState.auth.currentUser.role==='Patient'&&pt.id!==appState.auth.currentPatient?.id)return 'You may book only for your own patient record.';
  if(date<clinicToday())return 'Cannot book a past clinic date.';
  if((clinic==='Dental Clinic')!==(doc.specialty==='Dental'))return 'Choose a doctor for the selected clinic.';
  if(!(doc.workDays||[]).includes(dayOfWeek(date)))return 'The doctor does not work on this day.';
  if((appState.data.DB.doctorLeaves||[]).some(l=>l.doctorId===doc.id&&l.date===date))return 'The doctor is on leave on this date.';
  if(!appointmentSlotBaseTimes(doc).includes(time))return 'Choose a complete slot within the doctor’s work hours.';
  const active=appointmentRecords().filter(a=>a.id!==Number(editId)&&a.date===date&&!['Cancelled','Rejected'].includes(a.status));
  if(active.some(a=>a.doctorId===doc.id&&a.time===time))return 'This time has already been booked. Choose another slot.';
  if(active.some(a=>a.patientId===pt.id&&a.time===time))return 'The patient already has an appointment at this time.';
  if(active.filter(a=>a.doctorId===doc.id).length>=Number(doc.maxPatients||20))return 'The doctor’s daily patient limit has been reached.';
  return '';
}
export function setScheduleDays(preset){
  const days=preset==='weekdays'?['Mon','Tue','Wed','Thu','Fri']:preset==='current'?(appState.auth.currentUser.workDays||[]):[];
  document.querySelectorAll('.scr-day').forEach(el=>el.checked=days.includes(el.value));updateSchedulePreview();
}
export function updateSchedulePreview(){
  const el=document.getElementById('schedule-preview');if(!el)return;
  const days=[...document.querySelectorAll('.scr-day:checked')].map(e=>e.value);
  const s={workDays:days,startTime:document.getElementById('scr-start').value,endTime:document.getElementById('scr-end').value,slotDuration:Number(document.getElementById('scr-slot').value),maxPatients:Number(document.getElementById('scr-max').value)};
  const date=document.getElementById('scr-effective').value;
  const error=validateSchedule(s,date,appState.auth.currentUser);
  el.textContent=`Weekly: ${days.join(', ')||'no work days'} · ${s.startTime}–${s.endTime}. Off: ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].filter(d=>!days.includes(d)).join(', ')||'none'}. ${error||'Ready for administrator review. Existing appointments are preserved.'}`;
}
// Drafts are per account and stay only in this tab's session storage.
// Do not capture passwords, uploads, signatures or treatment-record forms.

export function campusSessionKey(kind){return appState.scheduleAndDrafts.campusDraftStorage.key(kind);}
export function readCampusSession(kind,fallback){return appState.scheduleAndDrafts.campusDraftStorage.read(kind,fallback);}
export function writeCampusSession(kind,value){appState.scheduleAndDrafts.campusDraftStorage.write(kind,value);}
export function captureCampusDraft(kind){
  const root=document.getElementById('active-modal');if(!root||!appState.auth.currentUser)return;
  const fields={};root.querySelectorAll('input[id],select[id],textarea[id]').forEach(el=>{
    if(!el.id.startsWith(kind==='schedule'?'scr-':'b-')||['password','file'].includes(el.type))return;
    fields[el.id]={value:el.value,checked:el.checked};
  });
  try{
    const rows=readCampusSession('drafts',{});
    rows[kind]={kind,fields,days:[...root.querySelectorAll('.scr-day:checked')].map(e=>e.value),at:new Date().toISOString(),editId:kind==='booking'?appState.bookingForm.activeBookingEditId:null};
    writeCampusSession('drafts',rows);root.querySelector('[data-campus-draft]')?.remove();campusDraftControls(root);toast('Draft saved in this browser tab. It has not been submitted.','success');
  }catch(_){toast('Draft could not be saved. Browser storage may be full or disabled.','warning');}
}
export function discardCampusDraft(kind,notify=true){
  try{const rows=readCampusSession('drafts',{});delete rows[kind];writeCampusSession('drafts',rows);if(notify){toast('Draft discarded.','success');document.querySelectorAll('[data-campus-resume]').forEach(el=>el.remove());}}catch(_){toast('Could not discard this draft.','warning');}
}
export function restoreCampusDraft(kind){
  const d=readCampusSession('drafts',{})[kind];if(!d)return;
  if(kind==='schedule'){if(appState.auth.currentUser.role!=='Doctor')return;openScheduleChangeRequest();}
  else openBookApptModal(d.editId);
  // Clinic/date/doctor selectors depend on each other, so restore in their normal order.
  for(const id of ['b-pt','b-clinic','b-date']){const el=document.getElementById(id);if(el&&d.fields[id])el.value=d.fields[id].value;}
  if(kind==='booking'){onClinicChange();const el=document.getElementById('b-date');if(el&&d.fields['b-date'])el.value=d.fields['b-date'].value;refreshAvailableDoctorsForDate(Number(d.fields['b-doc']?.value));}
  for(const [id,state] of Object.entries(d.fields)){
    const el=document.getElementById(id);if(!el||['b-doc','b-time'].includes(id))continue;
    if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===state.value))continue;
    el.value=state.value;if(el.type==='checkbox')el.checked=state.checked;
  }
  if(kind==='schedule'){document.querySelectorAll('.scr-day').forEach(el=>el.checked=d.days.includes(el.value));updateSchedulePreview();}
  else {const time=d.fields['b-time']?.value,doc=getUserById(Number(document.getElementById('b-doc')?.value)),date=document.getElementById('b-date')?.value,pt=getPatientById(Number(document.getElementById('b-pt')?.value));if(time&&!validateCampusBooking(doc,pt,date,time,d.editId,document.getElementById('b-clinic').value)&&!slotAvailabilityState(doc,date,time).blocked)selectSlot(time);}
  toast('Draft restored. Check availability and details before submitting.','info');
}
export function campusDraftControls(root){
  if(!root||root.querySelector('[data-campus-draft]'))return;
  const kind=root.querySelector('#scr-start')?'schedule':root.querySelector('#b-pt')?'booking':null;
  if(!kind)return;
  const footer=root.querySelector('.modal-footer');if(!footer)return;
  const btn=document.createElement('button');btn.className='btn';btn.dataset.campusDraft=kind;btn.textContent='Save Draft';btn.onclick=()=>captureCampusDraft(kind);footer.prepend(btn);
  // Draft actions now live in their own form after the Task Center was removed.
  if(readCampusSession('drafts',{})[kind]&&!root.querySelector('[data-campus-resume]')){
    const resume=document.createElement('button');resume.className='btn';resume.dataset.campusResume=kind;
    resume.textContent='Restore Draft';resume.onclick=()=>restoreCampusDraft(kind);footer.prepend(resume);
    const discard=document.createElement('button');discard.className='btn';discard.dataset.campusResume=kind;
    discard.textContent='Discard Draft';discard.onclick=()=>discardCampusDraft(kind);footer.prepend(discard);
  }
  if(!root.querySelector('[data-campus-draft-note]')){
  const note=document.createElement('p');note.dataset.campusDraftNote='true';note.className='form-note';note.textContent='Drafts remain in this browser tab until it closes. They do not reserve slots or change your schedule.';root.querySelector('.modal-body')?.appendChild(note);
  }
  if(kind==='schedule'&&!root.dataset.campusPreviewBound){root.dataset.campusPreviewBound='true';root.addEventListener('input',updateSchedulePreview);root.addEventListener('change',updateSchedulePreview);updateSchedulePreview();}
}
// Observe modal creation without changing existing modal callers or sidebar badge handling.

export function campusScheduleForDate(doc,date){
  return scheduleRules.campusScheduleForDate(doc,date,appState.data.DB.scheduleChangeRequests||[]);
}
// Keep approved demo changes active even when a tab stays open overnight.

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.scheduleAndDrafts.campusDraftStorage=createDraftStorage(sessionStorage,()=>appState.auth.currentUser);
  new MutationObserver(()=>campusDraftControls(document.getElementById('active-modal'))).observe(document.getElementById('modals'),{childList:true});
  setInterval(()=>{if(appState.auth.currentUser&&!appState.auth.currentUser._realSupabase)applyDueScheduleChanges();},60000);
}
