// Return for reappointment: when a visit cannot push through, the doctor or the front desk apologizes and
// proposes a new open time (slots inside the patients' booking lead time are usable here). The patient
// then accepts it or picks another time. The clinic does not cancel appointments.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {closeAllModals,openModal} from './modals.js';
import {fmtDate,fmtTime} from './inputValidation.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {appointmentAction,appointmentRecords,syncRealAppointments} from './appointmentService.js';
import {addBookingDays} from '../domain/booking-availability.js';
import {EMERGENCY_MAX_DAYS_AHEAD,EMERGENCY_REASONS,emergencyReappointMessage,prettyDeadline} from '../domain/emergency-reappointment.js';
import {appointmentHasStarted} from '../domain/appointment-list.js';
import {fetchDoctorAvailability} from './bookingForm.js';
import {toast} from './theme.js';
import {bindAction} from '../dependencies.js';

const REASONS=['The doctor is unavailable at that time','The clinic has an emergency','The clinic is closed that day','The visit needs more time than the slot allows'];
const clinicToday=()=>appState.clinicInformation.TODAY;

// Queue number within the hour: the first booking from 9:00 to 9:59 with a doctor is No. 1, the next No. 2.
export function queueNumber(a,rows=appointmentRecords()){
  const hour=String(a.time||'').slice(0,2);
  const same=rows.filter(x=>x.doctorId===a.doctorId&&x.date===a.date&&String(x.time||'').slice(0,2)===hour&&x.status!=='Cancelled')
    .sort((x,y)=>String(x.time).localeCompare(String(y.time))||String(x.createdAt||'').localeCompare(String(y.createdAt||''))||x.id-y.id);
  return Math.max(1,same.findIndex(x=>x.id===a.id)+1);
}
export function queueLabel(a,rows){
  const hour=Number(String(a.time||'00').slice(0,2));
  return `${hour%12||12} ${hour<12?'AM':'PM'} · No. ${queueNumber(a,rows)}`;
}

export function openReappointModal(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  const pt=getPatientById(a.patientId),doc=getUserById(a.doctorId);
  const st=appState.reappointment={id:a.id,days:[],date:'',time:''};
  openModal(`<div class="modal reappoint-modal" role="dialog" aria-labelledby="ra-title">
    <div class="modal-header"><div><h3 id="ra-title">Visit cannot push through</h3><div class="text-muted">Propose a new time for ${escapeHtml(pt?`${pt.fname} ${pt.lname}`:'the patient')}</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div id="ra-msg"></div>
      <div class="ra-current"><i class="bi bi-calendar-x" aria-hidden="true"></i><div><strong>${escapeHtml(a.clinic)} · ${escapeHtml(a.service||'')}</strong><span>${fmtDate(a.date)}, ${fmtTime(a.time)}${doc?` · Dr. ${escapeHtml(doc.lname)}`:''}</span></div></div>
      <div class="form-group"><label for="ra-reason">Why it cannot push through <span class="required">*</span></label>
        <select id="ra-reason" ${bindAction('change',()=>syncReappointReason())}><option value="">Choose a reason</option>${REASONS.map(r=>`<option>${escapeHtml(r)}</option>`).join('')}<option value="other">Other reason</option></select>
        <input id="ra-reason-other" maxlength="200" placeholder="Type the reason" hidden>
      </div>
      <div class="form-group"><label for="ra-date">New date <span class="required">*</span></label><select id="ra-date" disabled ${bindAction('change',(event,element)=>pickReappointDate(element.value))}><option>Loading open dates…</option></select></div>
      <div class="form-group"><label>New time <span class="required">*</span></label><div id="ra-slots" class="slot-grid"><span class="text-muted">Choose a date first.</span></div></div>
      <div class="ra-preview" aria-live="polite" id="ra-preview"><strong>The patient will read:</strong> “We apologize that your appointment will not push through.” They can accept the new time or pick another.</div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Back</button><button class="btn btn-primary" id="ra-send" disabled ${bindAction('click',()=>sendReappointment())}>Send new time to patient</button></div>
  </div>`);
  void loadReappointDates(a,doc);
}

async function loadReappointDates(a,doc){
  const select=document.getElementById('ra-date');if(!select)return;
  try{
    const from=clinicToday(),to=addBookingDays(from,30);
    const days=(await fetchDoctorAvailability(doc,from,to,a)).filter(d=>d.openSlots>0);
    appState.reappointment.days=days;
    select.innerHTML=days.length?`<option value="">Choose a date</option>${days.map(d=>`<option value="${d.date}">${fmtDate(d.date)} · ${d.openSlots} open</option>`).join('')}`:'<option value="">No open times in the next 30 days</option>';
    select.disabled=!days.length;
  }catch(error){
    select.innerHTML='<option value="">Open dates could not be loaded</option>';
    document.getElementById('ra-msg').innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'Open dates could not be loaded.')}</div>`;
  }
}

function pickReappointDate(date){
  const st=appState.reappointment;st.date=date;st.time='';
  const day=st.days.find(d=>d.date===date);
  const grid=document.getElementById('ra-slots');
  grid.innerHTML=day?day.slots.filter(s=>s.available).map(s=>`<button type="button" class="slot available" data-time="${s.time}" aria-pressed="false" ${bindAction('click',(event,element)=>pickReappointTime(s.time,element))}>${fmtTime(s.time)}</button>`).join(''):'<span class="text-muted">Choose a date first.</span>';
  syncReappointReason();
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
  if(preview&&st.date&&st.time)preview.innerHTML=`<strong>The patient will read:</strong> “We apologize that your appointment will not push through. ${escapeHtml(reappointReason()||'…')}. The clinic proposes ${escapeHtml(fmtDate(st.date))}, ${escapeHtml(fmtTime(st.time))} instead.” They can accept it or pick another time.`;
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

export function openEmergencyModal(){
  const doc=appState.auth.currentUser;if(!doc)return;
  const today=clinicToday();
  const dates=Array.from({length:EMERGENCY_MAX_DAYS_AHEAD+1},(_,i)=>addBookingDays(today,i));
  appState.reappointment={...(appState.reappointment||{}),emergencyDate:today};
  openModal(`<div class="modal emergency-modal" role="dialog" aria-labelledby="em-title">
    <div class="modal-header"><div><h3 id="em-title">Emergency: cannot see patients</h3><div class="text-muted">No administrator approval needed. Staff and administrators are notified.</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div id="em-msg"></div>
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
  const doc=appState.auth.currentUser,date=appState.reappointment.emergencyDate;
  const reason=document.getElementById('em-reason')?.value||'',note=(document.getElementById('em-note')?.value||'').trim();
  const rows=emergencyAffected(doc.id,date);
  const summary=document.getElementById('em-summary');
  if(summary){
    const sample=rows[0];
    // The preview uses a placeholder new time; the server picks the real earliest open slot for each patient.
    const preview=sample&&reason?emergencyReappointMessage({fromDate:sample.date,fromTime:sample.time,date:addBookingDays(sample.date,1),time:sample.time,deadline:new Date(Date.now()+24*3600*1000).toISOString(),reason,note,clinic:sample.clinic,doctorName:doc.lname}):'';
    summary.innerHTML=`<div class="em-count"><strong>${rows.length}</strong> appointment${rows.length===1?'':'s'} on ${escapeHtml(fmtDate(date))} will be returned for reappointment.</div>
      ${rows.length?`<ul class="em-list">${rows.map(a=>{const pt=getPatientById(a.patientId);return `<li>${escapeHtml(fmtTime(a.time))} · ${escapeHtml(pt?`${pt.fname} ${pt.lname}`:'Patient')} · ${escapeHtml(a.service||'')}</li>`;}).join('')}</ul>`:'<p class="text-muted">No remaining appointments that day. The rest of the day will still close to new bookings.</p>'}
      <p class="form-note">Each patient is offered the earliest open time with you on a day that is not fully booked (at least 12 hours from now). They can accept it or pick another open time, and must confirm within 24 hours (or 2 hours before the new time, whichever is earlier). If they do not, the time is released and they book again on their own.</p>
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
    const result=await appointmentAction({action:'emergency_reappoint',date,reason,note});
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
