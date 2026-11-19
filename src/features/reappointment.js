// Return for reappointment: when a visit cannot push through, the doctor or the front desk apologizes and
// places the patient in an open time of the doctor's schedule over the next weeks (slots inside the
// patients' booking lead time are usable here). The patient accepts it or picks another time by a
// deadline, as after a doctor emergency. The clinic does not cancel appointments.
import {staffClinicOf,userClinic} from '../domain/clinic-scope.js';
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {closeAllModals,openModal} from './modals.js';
import {fmtDate,fmtTime} from './inputValidation.js';
import {getDoctors,getPatientById,getUserById} from './documentScanner.js';
import {appointmentAction,appointmentRecords,syncRealAppointments} from './appointmentService.js';
import {addBookingDays} from '../domain/booking-availability.js';
import {EMERGENCY_MAX_DAYS_AHEAD,EMERGENCY_REASONS,confirmationDeadline,emergencyReappointMessage,prettyDeadline} from '../domain/emergency-reappointment.js';
import {initModernCalendar} from './calendar.js';
import {appointmentHasStarted} from '../domain/appointment-list.js';
import {queueNumberIn} from '../domain/clinic-calendar.js';
import {fetchDoctorAvailability} from './bookingForm.js';
import {toast} from './theme.js';
import {bindAction} from '../dependencies.js';

const REASONS=['The doctor is unavailable at that time','The clinic has an emergency','The clinic is closed that day','The visit needs more time than the slot allows'];
const clinicToday=()=>appState.clinicInformation.TODAY;

// Queue number for the day, per doctor (the same numbering as the calendar's queue).
export function queueNumber(a,rows=appointmentRecords()){
  return queueNumberIn(rows,a);
}
export function queueLabel(a,rows){
  const hour=Number(String(a.time||'00').slice(0,2));
  return `${hour%12||12} ${hour<12?'AM':'PM'} · No. ${queueNumber(a,rows)}`;
}

// How far ahead the doctor can place the patient, and how soon: the patient needs time to answer.
export const REAPPOINT_SEARCH_DAYS=56;
export const REAPPOINT_MIN_NOTICE_HOURS=3;

export function openReappointModal(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  const pt=getPatientById(a.patientId),doc=getUserById(a.doctorId);
  const st=appState.reappointment={id:a.id,days:[],date:'',time:''};
  openModal(`<div class="modal reappoint-modal" role="dialog" aria-labelledby="ra-title">
    <div class="modal-header"><div><h3 id="ra-title">Reschedule: visit cannot push through</h3><div class="text-muted">Choose a new time in ${doc?`Dr. ${escapeHtml(doc.lname)}’s`:'the doctor’s'} schedule for ${escapeHtml(pt?`${pt.fname} ${pt.lname}`:'the patient')}. The patient accepts it or picks another time.</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div id="ra-msg"></div>
      <div class="ra-current"><i class="bi bi-calendar-x" aria-hidden="true"></i><div><strong>${escapeHtml(a.clinic)} · ${escapeHtml(a.service||'')}</strong><span>${fmtDate(a.date)}, ${fmtTime(a.time)}${doc?` · Dr. ${escapeHtml(doc.lname)}`:''}</span></div></div>
      <div class="form-group"><label for="ra-reason">Why it cannot push through <span class="required">*</span></label>
        <select id="ra-reason" ${bindAction('change',()=>syncReappointReason())}><option value="">Choose a reason</option>${REASONS.map(r=>`<option>${escapeHtml(r)}</option>`).join('')}<option value="other">Other reason</option></select>
        <input id="ra-reason-other" maxlength="200" placeholder="Type the reason" hidden>
      </div>
      <div class="form-group"><div class="ra-date-head"><label>New date <span class="required">*</span></label><button type="button" class="btn btn-xs" id="ra-earliest" disabled ${bindAction('click',()=>pickEarliestReappointTime())}><i class="bi bi-lightning-charge" aria-hidden="true"></i> Earliest open time</button></div>
        <p class="text-muted ra-hint" id="ra-date-note">Loading open dates in the next ${REAPPOINT_SEARCH_DAYS/7} weeks…</p>
        <div id="ra-calendar"></div></div>
      <div class="form-group"><label>New time <span class="required">*</span></label><div id="ra-slots" class="slot-grid"><span class="text-muted">Choose a date first.</span></div></div>
      <div class="ra-preview" aria-live="polite" id="ra-preview"><strong>The patient will read:</strong> “We apologize that your appointment will not push through.” They can accept the new time or pick another.</div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Back</button><button class="btn btn-primary" id="ra-send" disabled ${bindAction('click',()=>sendReappointment())}>Send new time to patient</button></div>
  </div>`);
  void loadReappointDates(a,doc);
}

// Open slots with this doctor from a few hours from now up to eight weeks ahead. Slots inside the
// patients' booking lead time are usable: they are kept for exactly this.
async function loadReappointDates(a,doc){
  const note=document.getElementById('ra-date-note');if(!note)return;
  const st=appState.reappointment;
  try{
    const from=clinicToday(),to=addBookingDays(from,REAPPOINT_SEARCH_DAYS);
    const earliest=Date.now()+REAPPOINT_MIN_NOTICE_HOURS*3600*1000;
    const days=(await fetchDoctorAvailability(doc,from,to,a,a.service||'')).map(d=>{
      const slots=(d.slots||[]).map(s=>s.available&&Date.parse(`${d.date}T${s.time}:00+08:00`)<earliest?{...s,available:false}:s);
      return {...d,slots,openSlots:Math.min(d.openSlots,slots.filter(s=>s.available).length)};
    }).filter(d=>d.openSlots>0&&!(d.date===a.date&&d.slots.every(s=>!s.available||s.time===String(a.time).slice(0,5))));
    if(appState.reappointment!==st)return;
    st.days=days;
    note.textContent=days.length?`${days.length} day${days.length===1?'':'s'} with open times in the next ${REAPPOINT_SEARCH_DAYS/7} weeks. Choose a date, then a time.`:`No open times in the next ${REAPPOINT_SEARCH_DAYS/7} weeks. Open more times in Manage time slots, or ask the front desk.`;
    document.getElementById('ra-earliest').disabled=!days.length;
    initModernCalendar('ra-calendar','',from,'pickReappointDate',{allowEmptySelection:true,maxDate:to,availableDates:days.map(d=>d.date),viewMonth:(days[0]?.date||from).slice(0,7),showAppointmentHints:false,showTodayButton:false});
  }catch(error){
    note.textContent='Open dates could not be loaded.';
    document.getElementById('ra-msg').innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'Open dates could not be loaded.')}</div>`;
  }
}

export function pickReappointDate(date){
  const st=appState.reappointment;st.date=date;st.time='';
  const a=appointmentRecords().find(x=>x.id===st.id);
  const day=st.days.find(d=>d.date===date);
  const grid=document.getElementById('ra-slots');if(!grid)return;
  const open=day?day.slots.filter(s=>s.available&&!(date===a?.date&&s.time===String(a?.time).slice(0,5))):[];
  grid.innerHTML=open.length?open.map(s=>`<button type="button" class="slot available" data-time="${s.time}" aria-pressed="false" ${bindAction('click',(event,element)=>pickReappointTime(s.time,element))}>${fmtTime(s.time)}</button>`).join(''):'<span class="text-muted">Choose a date first.</span>';
  syncReappointReason();
}
function pickEarliestReappointTime(){
  const st=appState.reappointment,day=st.days[0];if(!day)return;
  initModernCalendar('ra-calendar',day.date,clinicToday(),'pickReappointDate',{maxDate:addBookingDays(clinicToday(),REAPPOINT_SEARCH_DAYS),availableDates:st.days.map(d=>d.date),viewMonth:day.date.slice(0,7),showAppointmentHints:false,showTodayButton:false});
  pickReappointDate(day.date);
  document.querySelector('#ra-slots .slot')?.click();
}
function pickReappointTime(time,button){
  appState.reappointment.time=time;
  document.querySelectorAll('#ra-slots .slot').forEach(b=>{const on=b===button;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});
  syncReappointReason();
}
function reappointReason(){
  const choice=document.getElementById('ra-reason')?.value||'';
  return choice==='other'?(document.getElementById('ra-reason-other')?.value||'').trim():choice;
}
function syncReappointReason(){
  const other=document.getElementById('ra-reason-other');
  if(other){other.hidden=document.getElementById('ra-reason')?.value!=='other';other.oninput=()=>syncReappointReason();}
  const st=appState.reappointment;
  const send=document.getElementById('ra-send');
  if(send)send.disabled=!(reappointReason().length>=3&&st.date&&st.time);
  const preview=document.getElementById('ra-preview');
  if(preview&&st.date&&st.time){
    const deadline=prettyDeadline(confirmationDeadline(Date.now(),st.date,st.time));
    preview.innerHTML=`<strong>The patient will read:</strong> “We apologize that your appointment will not push through. ${escapeHtml(reappointReason()||'…')}. The clinic proposes ${escapeHtml(fmtDate(st.date))}, ${escapeHtml(fmtTime(st.time))} instead. Please confirm by ${escapeHtml(deadline)}.” They can accept it or pick another time; if they do not answer by then, the time is released.`;
  }
}

async function sendReappointment(){
  const st=appState.reappointment,a=appointmentRecords().find(x=>x.id===st.id);
  const btn=document.getElementById('ra-send');btn.disabled=true;btn.textContent='Sending…';
  try{
    await appointmentAction({action:'reappoint',appointment_id:a.dbAppointmentId,appointment_date:st.date,appointment_time:st.time,reappoint_reason:reappointReason()});
    await syncRealAppointments();
    closeAllModals();
    toast('The patient was notified of the new time.','success');
    rerender();
  }catch(error){
    document.getElementById('ra-msg').innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'The new time could not be sent.')}</div>`;
    btn.disabled=false;btn.textContent='Send new time to patient';
  }
}

// Patient side ------------------------------------------------------------------------------------
export function reappointmentNoticeHtml(a,{onPickAnother}={}){
  if(a.patientResponse!=='Awaiting')return '';
  // Emergency reappointments carry a deadline; after it the reserved time is released.
  const expired=a.reappointDeadline&&Date.parse(a.reappointDeadline)<=Date.now();
  if(expired)return `<div class="reappoint-notice" role="status">
    <i class="bi bi-calendar2-x" aria-hidden="true"></i>
    <div><strong>The time to confirm your rebooking has passed.</strong>
      <span>The reserved time on ${escapeHtml(fmtDate(a.date))}, ${escapeHtml(fmtTime(a.time))} is being released. Please book a new appointment.</span></div>
  </div>`;
  return `<div class="reappoint-notice" role="status">
    <i class="bi bi-calendar2-x" aria-hidden="true"></i>
    <div><strong>We apologize that your appointment${a.reappointFromDate?` on ${escapeHtml(fmtDate(a.reappointFromDate))}${a.reappointFromTime?`, ${escapeHtml(fmtTime(a.reappointFromTime))}`:''}`:''} will not push through.</strong>
      <span>${a.reappointReason?escapeHtml(a.reappointReason)+'. ':''}The clinic proposes <strong>${escapeHtml(fmtDate(a.date))}, ${escapeHtml(fmtTime(a.time))}</strong> instead.</span>
      ${a.reappointDeadline?`<span class="reappoint-deadline"><i class="bi bi-hourglass-split" aria-hidden="true"></i> Please confirm by <strong>${escapeHtml(prettyDeadline(a.reappointDeadline))}</strong>. If you do not accept or pick another time by then, this time is released and you will need to book a new appointment.</span>`:''}
      <div class="reappoint-actions"><button class="btn btn-primary btn-sm" ${bindAction('click',(event)=>{event.stopPropagation();acceptReappointment(a.id);})}>Accept new time</button>${onPickAnother?`<button class="btn btn-sm" ${bindAction('click',(event)=>{event.stopPropagation();onPickAnother(a.id);})}>Pick another time</button>`:''}</div>
    </div>
  </div>`;
}

export async function acceptReappointment(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  try{
    await appointmentAction({action:'accept_reappointment',appointment_id:a.dbAppointmentId});
    await syncRealAppointments();
    toast(`See you on ${fmtDate(a.date)}, ${fmtTime(a.time)}.`,'success');
    closeAllModals();
    rerender();
  }catch(error){toast(error?.message||'Your answer could not be saved.','error');}
}

// Doctor emergency ---------------------------------------------------------------------------------
// The doctor cannot see patients for the rest of a day. No administrator approval: every visit that has
// not started is offered the earliest open slot with this doctor, the rest of the day closes to bookings,
// and staff and administrators are told afterwards. Patients confirm by a deadline or book again.
function emergencyAffected(doctorId,date){
  const now=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  return appointmentRecords().filter(a=>a.doctorId===doctorId&&a.date===date&&['Scheduled','Confirmed'].includes(a.status)&&!appointmentHasStarted(a,{today:clinicToday(),now}))
    .sort((a,b)=>a.time.localeCompare(b.time));
}

// Doctors declare their own emergency from My Schedule; the front desk (Staff) can declare one for any
// doctor from Appointments, e.g. when the doctor cannot reach the app.
export function canDeclareEmergency(){return ['Doctor','Staff'].includes(appState.auth.currentUser?.role);}
function emergencyDoctor(){
  const me=appState.auth.currentUser;
  return me?.role==='Doctor'?me:getUserById(appState.reappointment.emergencyDoctorId);
}

export function openEmergencyModal(){
  const me=appState.auth.currentUser;if(!canDeclareEmergency())return;
  const ownClinic=staffClinicOf(me);
  const staff=me.role==='Staff',doctors=staff?getDoctors().filter(d=>!ownClinic||userClinic(d)===ownClinic):[];
  if(staff&&!doctors.length){toast('There are no active doctors.','warning');return;}
  const today=clinicToday();
  const dates=Array.from({length:EMERGENCY_MAX_DAYS_AHEAD+1},(_,i)=>addBookingDays(today,i));
  appState.reappointment={...(appState.reappointment||{}),emergencyDate:today,emergencyDoctorId:staff?doctors[0].id:me.id};
  openModal(`<div class="modal emergency-modal" role="dialog" aria-labelledby="em-title">
    <div class="modal-header"><div><h3 id="em-title">Emergency: cannot see patients</h3><div class="text-muted">${staff?'For a doctor who cannot see patients. The doctor, other staff and administrators are notified.':'No administrator approval needed. Staff and administrators are notified.'}</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div id="em-msg"></div>
      ${staff?`<div class="form-group"><label for="em-doctor">Doctor <span class="required">*</span></label>
        <select id="em-doctor" ${bindAction('change',(event,element)=>{appState.reappointment.emergencyDoctorId=Number(element.value);syncEmergencyModal();})}>${doctors.map(d=>`<option value="${d.id}">Dr. ${escapeHtml(`${d.fname||''} ${d.lname||''}`.trim())}${d.specialty?' · '+escapeHtml(d.specialty):''}</option>`).join('')}</select></div>`:''}
      <div class="form-row">
        <div class="form-group"><label for="em-date">Day</label>
          <select id="em-date" ${bindAction('change',(event,element)=>{appState.reappointment.emergencyDate=element.value;syncEmergencyModal();})}>${dates.map((d,i)=>`<option value="${d}">${i===0?'Today · ':''}${escapeHtml(fmtDate(d))}</option>`).join('')}</select></div>
        <div class="form-group"><label for="em-reason">Reason <span class="required">*</span></label>
          <select id="em-reason" ${bindAction('change',()=>syncEmergencyModal())}><option value="">Choose a reason</option>${EMERGENCY_REASONS.map(r=>`<option>${escapeHtml(r)}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label for="em-note">Note to patients <span class="text-muted">(optional)</span></label>
        <input id="em-note" maxlength="300" placeholder="e.g. The doctor was called to an urgent case." ${bindAction('input',()=>syncEmergencyModal())}></div>
      <div id="em-summary" aria-live="polite"></div>
      <label class="checkbox-row"><input type="checkbox" id="em-confirm" ${bindAction('change',()=>syncEmergencyModal())}> I understand the patients listed above are notified right away and the rest of this day closes to bookings.</label>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Back</button><button class="btn btn-danger" id="em-send" disabled ${bindAction('click',()=>sendEmergency())}>Return appointments &amp; close the day</button></div>
  </div>`);
  syncEmergencyModal();
}

function syncEmergencyModal(){
  const doc=emergencyDoctor(),date=appState.reappointment.emergencyDate;if(!doc)return;
  const reason=document.getElementById('em-reason')?.value||'',note=(document.getElementById('em-note')?.value||'').trim();
  const rows=emergencyAffected(doc.id,date);
  const summary=document.getElementById('em-summary');
  if(summary){
    const sample=rows[0];
    // The preview uses a placeholder new time; the server picks the real earliest open slot for each patient.
    const preview=sample&&reason?emergencyReappointMessage({fromDate:sample.date,fromTime:sample.time,date:addBookingDays(sample.date,1),time:sample.time,deadline:new Date(Date.now()+24*3600*1000).toISOString(),reason,note,clinic:sample.clinic,doctorName:doc.lname}):'';
    summary.innerHTML=`<div class="em-count"><strong>${rows.length}</strong> appointment${rows.length===1?'':'s'} ${appState.auth.currentUser.role==='Staff'?` with Dr. ${escapeHtml(doc.lname||'')}`:''} on ${escapeHtml(fmtDate(date))} will be returned for reappointment.</div>
      ${rows.length?`<ul class="em-list">${rows.map(a=>{const pt=getPatientById(a.patientId);return `<li>${escapeHtml(fmtTime(a.time))} · ${escapeHtml(pt?`${pt.fname} ${pt.lname}`:'Patient')} · ${escapeHtml(a.service||'')}</li>`;}).join('')}</ul>`:'<p class="text-muted">No remaining appointments that day. The rest of the day will still close to new bookings.</p>'}
      <p class="form-note">Each patient is offered the earliest open time with ${appState.auth.currentUser.role==='Staff'?'this doctor':'you'} on a day that is not fully booked (at least 12 hours from now). They can accept it or pick another open time, and must confirm within 24 hours (or 2 hours before the new time, whichever is earlier). If they do not, the time is released and they book again on their own.</p>
      ${preview?`<div class="ra-preview"><strong>The patient will read (example):</strong><div style="white-space:pre-line;margin-top:.35rem">${escapeHtml(preview)}</div></div>`:''}`;
  }
  const send=document.getElementById('em-send');
  if(send)send.disabled=!(reason&&document.getElementById('em-confirm')?.checked);
}

async function sendEmergency(){
  const date=appState.reappointment.emergencyDate;
  const reason=document.getElementById('em-reason').value,note=(document.getElementById('em-note').value||'').trim();
  const btn=document.getElementById('em-send');btn.disabled=true;btn.textContent='Sending…';
  try{
    const doc=emergencyDoctor();
    const result=await appointmentAction({action:'emergency_reappoint',date,reason,note,...(appState.auth.currentUser.role==='Staff'?{doctor_id:doc.dbUserId||doc.id-100000}:{})});
    await syncRealAppointments();
    closeAllModals();
    const moved=result.moved?.length||0,unplaced=result.unplaced?.length||0;
    toast(`${moved} patient${moved===1?' was':'s were'} sent a new time. ${fmtDate(date)} is closed to bookings.${unplaced?` ${unplaced} could not be placed; the front desk was asked to handle them.`:''}`,unplaced?'warning':'success',8000);
    rerender();
  }catch(error){
    document.getElementById('em-msg').innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'The emergency could not be sent.')}</div>`;
    btn.disabled=false;btn.innerHTML='Return appointments &amp; close the day';
  }
}

function rerender(){
  const page=appState.navigationRaceProtection.campusActivePageId;
  import('./navigationRaceProtection.js').then(({navTo})=>{if(page)navTo(page,{historyMode:'replace'});});
}
