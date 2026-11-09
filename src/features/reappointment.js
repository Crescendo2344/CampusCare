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
  return `<div class="reappoint-notice" role="status">
    <i class="bi bi-calendar2-x" aria-hidden="true"></i>
    <div><strong>We apologize that your appointment${a.reappointFromDate?` on ${escapeHtml(fmtDate(a.reappointFromDate))}${a.reappointFromTime?`, ${escapeHtml(fmtTime(a.reappointFromTime))}`:''}`:''} will not push through.</strong>
      <span>${a.reappointReason?escapeHtml(a.reappointReason)+'. ':''}The clinic proposes <strong>${escapeHtml(fmtDate(a.date))}, ${escapeHtml(fmtTime(a.time))}</strong> instead.</span>
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

function rerender(){
  const page=appState.navigationRaceProtection.campusActivePageId;
  import('./navigationRaceProtection.js').then(({navTo})=>{if(page)navTo(page,{historyMode:'replace'});});
}
