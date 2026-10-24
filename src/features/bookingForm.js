// bookingForm: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {campusScheduleForDate,clinicToday,discardCampusDraft,validateCampusBooking} from './scheduleAndDrafts.js';
import {dayOfWeek,fmtDate,fmtTime} from './inputValidation.js';
import {appointmentAction,appointmentRecords,appointmentService,syncRealAppointments} from './appointmentService.js';
import {checkDentalQuota,getDentalDoctors,getMedDoctors,getPatientById,getUserById} from './documentScanner.js';
import {escapeHtml} from './issueReports.js';
import {docName} from './messaging.js';
import {closeAllModals,closeTopModal,openModal} from './modals.js';
import {filterBookPatients} from './datePicker.js';
import {initModernCalendar,renderModernCalendar} from './calendar.js';
import {hideAlert,showAlert,toast} from './theme.js';
import {persistDB} from './persistence.js';
import {refreshTaskBadges} from './topbarAndNavigation.js';
import {renderMyAppointments} from './patientAppointments.js';
import {renderAppointments} from './appointments.js';
import {addBookingDays,buildDoctorAvailability} from '../domain/booking-availability.js';
import {bindAction,scheduleRules} from '../dependencies.js';
// ── Book Appointment ──

export function doctorOpenSlotCount(doc,date){
  if(!doc||!date||date<clinicToday())return 0;
  doc=campusScheduleForDate(doc,date);
  if(appState.data.DB.doctorLeaves.some(l=>l.doctorId===doc.id&&l.date===date))return 0;

  const dayName=dayOfWeek(date);
  const workDays=doc.workDays||['Mon','Tue','Wed','Thu','Fri'];
  if(!workDays.includes(dayName))return 0;

  const taken=new Set(
    appointmentRecords()
      .filter(a=>
        a.id!==Number(appState.bookingForm.activeBookingEditId) &&
        a.doctorId===doc.id &&
        a.date===date &&
        a.status!=='Cancelled'
      )
      .map(a=>a.time)
  );

  const remaining=Math.max(0,Number(doc.maxPatients||20)-appointmentRecords().filter(a=>a.id!==Number(appState.bookingForm.activeBookingEditId)&&a.doctorId===doc.id&&a.date===date&&a.status!=='Cancelled').length);
  return Math.min(remaining,appointmentSlotBaseTimes(doc).filter(t=>{
    if(taken.has(t))return false;
    const state=slotAvailabilityState(doc,date,t);
    return !state.blocked;
  }).length);
}

// Keep the public adapter name for saved drafts; doctor selection now precedes the date.
export async function refreshAvailableDoctorsForDate(preferredDoctorId=null){
  const select=document.getElementById('b-doc');if(!select)return;
  if(preferredDoctorId)select.value=String(preferredDoctorId);
  await onBookingDoctorChange();
}

export async function onBookingDoctorChange(){
  const select=document.getElementById('b-doc'),note=document.getElementById('b-doctor-note'),dateInput=document.getElementById('b-date');
  if(!select||!dateInput)return;
  const doctor=getUserById(Number(select.value)),owner=appState.auth.currentUser,requestId=(appState.bookingForm.availabilityRequest||0)+1;
  appState.bookingForm.availabilityRequest=requestId;
  appState.bookingForm.availabilityDays=[];appState.bookingForm.availabilityDoctorId=doctor?.id||null;
  dateInput.value='';document.getElementById('b-time').value='';document.getElementById('b-date-label').textContent='Choose an available date';
  const from=clinicToday(),to=addBookingDays(from,365);
  const renderCalendar=(days,selected='')=>{
    const available=days.filter(day=>day.openSlots>0).map(day=>day.date);
    initModernCalendar('booking-modern-calendar',selected,from,'chooseBookingDate',{allowEmptySelection:!selected,maxDate:to,availableDates:available,viewMonth:(selected||available[0]||from).slice(0,7),showAppointmentHints:false,showTodayButton:false});
  };
  renderCalendar([]);loadTimeSlots();
  if(!doctor){note.textContent='Choose your doctor first to see available dates.';return;}
  note.textContent='Checking this doctor’s available dates…';
  try{
    let days;
    if(owner?._realSupabase){
      const editing=appointmentRecords().find(a=>a.id===appState.bookingForm.activeBookingEditId);
      const result=await appointmentService().availability({doctor_id:doctor.dbUserId,from,to,...(editing?{appointment_id:editing.dbAppointmentId}:{})});
      if(!Array.isArray(result.days))throw new Error('Availability could not be loaded. Please retry.');
      days=result.days;
    }else{
      // Local demonstration records use the same slot rules without pretending to query live reservations.
      const now=new Date(),nowMinutes=(now.getUTCHours()*60+now.getUTCMinutes()+480)%1440;
      days=buildDoctorAvailability({doctor,from,to,today:from,nowMinutes,appointments:appointmentRecords().filter(a=>a.doctorId===doctor.id&&a.id!==appState.bookingForm.activeBookingEditId),leaves:(appState.data.DB.doctorLeaves||[]).filter(l=>l.doctorId===doctor.id),overrides:(appState.data.DB.settings.slotOverrides||[]).filter(o=>o.doctorId===doctor.id).flatMap(o=>[...(o.blockedTimes||[]).map(time=>({date:o.date,time,available:false})),...(o.availableTimes||[]).map(time=>({date:o.date,time,available:true}))]),settings:{lunchStart:appState.data.DB.settings.lunchBreakStart,lunchEnd:appState.data.DB.settings.lunchBreakEnd}});
    }
    // A late request must never overwrite a different doctor, closed form, or signed-out account.
    if(requestId!==appState.bookingForm.availabilityRequest||select!==document.getElementById('b-doc')||appState.auth.currentUser!==owner)return;
    appState.bookingForm.availabilityDays=days;
    const nearest=days.find(day=>day.openSlots>0);
    note.textContent=nearest?`Next opening: ${fmtDate(nearest.date)} · ${nearest.openSlots} available time${nearest.openSlots===1?'':'s'}. Select a highlighted date below.`:'No openings in the next 12 months. Please choose another doctor.';
    renderCalendar(days);loadTimeSlots();
  }catch(error){
    if(select!==document.getElementById('b-doc')||requestId!==appState.bookingForm.availabilityRequest)return;
    note.textContent=error?.message||'Availability could not be loaded.';
    document.getElementById('slot-grid').innerHTML=`<button type="button" class="btn btn-sm" ${bindAction('click',()=>onBookingDoctorChange())}>Retry availability</button>`;
  }
}

export function openBookApptModal(apptId=null){
  appState.bookingForm.activeBookingEditId=apptId?Number(apptId):null;
  const editing=apptId?appointmentRecords().find(a=>a.id===Number(apptId)):null;
  const isPt=appState.auth.currentUser.role==='Patient';
  const pt=isPt?appState.auth.currentPatient:null;
  const selectedDate=editing?editing.date:'';

  openModal(`<div class="modal">
    <div class="modal-header"><h3>${editing?'Reschedule':'Book'} Appointment</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="book-msg"></div>
      <div id="dental-warn" class="alert alert-warning"></div>
      <p class="booking-steps">Choose a doctor → Pick an available date → Select a time</p>

      <div class="form-row">
        <div class="form-group ${isPt?'full':''}">
          <label>Patient <span class="required">*</span></label>
          ${isPt
            ?`<input type="hidden" id="b-pt" value="${pt?pt.id:''}">
              <div class="booking-readonly-patient">
                <span class="booking-patient-icon"><i class="bi bi-person-check"></i></span>
                <div><strong>${pt?escapeHtml(pt.fname+' '+pt.lname):'No patient record linked'}</strong><small>Your signed-in patient profile is used automatically.</small></div>
              </div>`
            :`<input type="hidden" id="b-pt" value="${editing?editing.patientId:''}">
              <div class="patient-combobox">
                <input type="search" id="b-pt-search" autocomplete="off" placeholder="Search patient by name, ID, or college…" value="${editing?(()=>{const p=getPatientById(editing.patientId);return p?escapeHtml(p.fname+' '+p.lname):''})():''}" ${bindAction('input',(event,element)=>{filterBookPatients(element.value)})}>
                <div class="patient-combobox-list" id="b-pt-results"></div>
              </div>`}
        </div>
        ${!isPt?`<div class="form-group"><label>Priority</label>
          <select id="b-priority"><option>Student</option><option>Teaching</option><option>Non-Teaching</option></select>
        </div>`:''}
      </div>

      <div class="form-row">
        <div class="form-group"><label>Clinic <span class="required">*</span></label>
          <select id="b-clinic" ${bindAction('change',(event,element)=>{onClinicChange()})}>
            <option value="Medical Clinic" ${editing&&editing.clinic==='Medical Clinic'?'selected':''}>Medical Clinic</option>
            <option value="Dental Clinic" ${editing&&editing.clinic==='Dental Clinic'?'selected':''}>Dental Clinic</option>
          </select>
        </div>
        <div class="form-group"><label>Service <span class="required">*</span></label>
          <select id="b-service"></select>
        </div>
      </div>

      <div class="form-group full">
        <label>Available Doctor <span class="required">*</span></label>
        <select id="b-doc" ${bindAction('change',(event,element)=>{onBookingDoctorChange()})}>
          <option value="">Choose a doctor</option>
        </select>
        <div class="booking-doctor-note" id="b-doctor-note">Choose your doctor first to see available dates.</div>
      </div>

      <div class="form-group full">
        <label>Selected Date <span class="required">*</span></label>
        <input type="hidden" id="b-date" value="${selectedDate}">
        <div class="modern-date-btn" style="cursor:default;justify-content:flex-start">
          <i class="bi bi-calendar3"></i>
          <span id="b-date-label">${selectedDate?fmtDate(selectedDate):'Select appointment date'}</span>
        </div>
      </div>

      <div class="form-group full">
        <label>Choose Appointment Date</label>
        <div class="booking-calendar-wrap"><div id="booking-modern-calendar"></div></div>
      </div>


      <div class="form-group">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
          <label>Available Time Slots</label>
          ${['Staff','Administrator'].includes(appState.auth.currentUser.role)?`<button type="button" class="btn btn-xs" id="b-manage-slots" disabled title="Pick a doctor and a date first" ${bindAction('click',()=>openManageDateSlots())}><i class="bi bi-sliders" aria-hidden="true"></i> Manage slots for this date</button>`:''}
        </div>
        <div id="slot-grid" class="slot-grid" style="min-height:40px"><span class="text-muted" style="font-size:.78rem">Select an appointment date to see available doctors and time slots.</span></div>
        <div class="form-note">Booked, past, lunch-break, and manually unavailable slots are clearly marked and cannot be selected.</div>
        <input type="hidden" id="b-time" value="${editing?editing.time:''}">
      </div>

      <div class="form-group full"><label>Reason / Chief Complaint</label>
        <textarea id="b-reason" rows="2">${editing?escapeHtml(editing.reason||''):''}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" ${bindAction('click',(event,element)=>{saveAppt(apptId)})}>Confirm Booking</button>
    </div>
  </div>`);

  // Populate the clinician selector before fetching the calendar for an existing reschedule.
  void onClinicChange(editing?.doctorId||null,editing);

  checkDentalWarn();
}

export function chooseBookingDate(date,preferredDoctorId=null){
  const day=(appState.bookingForm.availabilityDays||[]).find(day=>day.date===date);
  if(!day?.openSlots)return false;
  const input=document.getElementById('b-date'),label=document.getElementById('b-date-label');
  if(!input||!label)return false;
  input.value=date;label.textContent=fmtDate(date);document.getElementById('b-time').value='';
  const calendar=appState.calendar.modernCalendarState['booking-modern-calendar'];
  if(calendar){calendar.selected=date;calendar.viewMonth=date.slice(0,7);renderModernCalendar('booking-modern-calendar');}
  loadTimeSlots();return true;
}

export async function onClinicChange(preferredDoctorId=null,editing=null){
  const clinic=document.getElementById('b-clinic');
  const svc=document.getElementById('b-service');
  const doc=document.getElementById('b-doc');
  if(!clinic||!svc||!doc)return;

  const isDental=clinic.value==='Dental Clinic';
  const medSvcs=['General Checkup','Follow-up','Consultation','Physical Exam'];
  const dentSvcs=['Dental Checkup','Tooth Extraction','Dental Cleaning','Dental X-ray'];
  const svcs=isDental?dentSvcs:medSvcs;
  const previousService=svc.value;

  svc.innerHTML=svcs.map(s=>`<option>${s}</option>`).join('');
  if(svcs.includes(previousService))svc.value=previousService;

  checkDentalWarn();
  const doctors=isDental?getDentalDoctors():getMedDoctors();
  doc.innerHTML='<option value="">Choose a doctor</option>'+doctors.map(d=>`<option value="${d.id}">${escapeHtml(docName(d))} — ${escapeHtml(d.specialty||'General Medicine')}</option>`).join('');
  doc.disabled=!doctors.length;
  if(preferredDoctorId&&doctors.some(d=>d.id===Number(preferredDoctorId)))doc.value=String(preferredDoctorId);
  await onBookingDoctorChange();
  if(editing){
    if([...svc.options].some(o=>o.value===editing.service))svc.value=editing.service;
    if(chooseBookingDate(editing.date))selectSlot(editing.time);
  }
}

export function checkDentalWarn(){
  const clinicEl=document.getElementById('b-clinic');
  const ptEl=document.getElementById('b-pt');
  const warnEl=document.getElementById('dental-warn');
  if(!clinicEl||!ptEl||!warnEl)return;
  warnEl.classList.remove('show');
  if(clinicEl.value==='Dental Clinic'){
    const ptId=parseInt(ptEl.value);
    if(ptId&&checkDentalQuota(ptId)){
      warnEl.innerHTML='⚠️ This patient has already used their Dental Clinic quota for this semester. Booking will be blocked.';
      warnEl.classList.add('show');
    }
  }
}

export function timeToMinutes(t){return scheduleRules.timeToMinutes(t);}
export function appointmentSlotBaseTimes(doc){return scheduleRules.appointmentSlotBaseTimes(doc);}
export function getSlotOverride(docId,date){
  appState.data.DB.settings.slotOverrides=Array.isArray(appState.data.DB.settings.slotOverrides)?appState.data.DB.settings.slotOverrides:[];
  return appState.data.DB.settings.slotOverrides.find(o=>o.doctorId===docId&&o.date===date)||null;
}
export function isDefaultLunchSlot(time,doc){
  return scheduleRules.isDefaultLunchSlot(time,doc,appState.data.DB.settings);
}
export function slotAvailabilityState(doc,date,time){
  const override=getSlotOverride(doc.id,date),blocked=(override&&override.blockedTimes)||[],available=(override&&override.availableTimes)||[];
  if(blocked.includes(time))return {blocked:true,label:'Unavailable',kind:'blocked'};
  if(isDefaultLunchSlot(time,doc)&&!available.includes(time))return {blocked:true,label:'Lunch break',kind:'lunch'};
  if(date===clinicToday()){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()),nowMin=timeToMinutes(parts);if(timeToMinutes(time)<=nowMin)return {blocked:true,label:'Past time',kind:'past'};}
  return {blocked:false,label:'Available',kind:'available'};
}

// Staff can open or close individual time slots for one doctor and date. The dialog sits on top of the
// booking form so nothing typed there is lost, and it works from the same availability the form shows.
const EDITABLE_SLOT_KINDS=['available','full','blocked','lunch'];
export function openManageDateSlots(){
  if(!['Staff','Administrator'].includes(appState.auth.currentUser.role))return;
  const docId=parseInt(document.getElementById('b-doc')?.value),date=document.getElementById('b-date')?.value;
  const doc=getUserById(docId),day=(appState.bookingForm.availabilityDays||[]).find(d=>d.date===date);
  if(!doc||!date||!day){toast('Pick a doctor and a date first.','warning');return;}
  const override=getSlotOverride(docId,date);
  const reopenedLunch=new Set(override?.availableTimes||[]);
  const slots=(day.slots||[]).map(s=>({
    time:s.time,kind:s.kind,label:s.label,
    editable:EDITABLE_SLOT_KINDS.includes(s.kind),
    lunch:s.kind==='lunch'||reopenedLunch.has(s.time)||(s.kind==='blocked'&&isDefaultLunchSlot(s.time,doc)),
    open:s.kind==='available'||s.kind==='full'
  }));
  appState.bookingForm.slotDraft={docId,date,slots,initial:slots.map(s=>s.open)};
  openModal(`<div class="modal modal-lg slot-manager-modal">
    <div class="modal-header"><div><h3>Manage time slots</h3><div class="text-muted">${escapeHtml(docName(doc))} · ${fmtDate(date)}</div></div><button class="close-btn" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body">
      <p class="form-note" style="margin:0 0 .6rem">Tap a time to open or close it for booking. Booked and past times can't be changed. Lunch-break times start closed; open one only when the doctor agrees.</p>
      <div class="slot-manager-tools">
        <span id="slot-manager-summary" role="status" aria-live="polite"></span>
        <div><button type="button" class="btn btn-xs" ${bindAction('click',()=>setAllManagedSlots(true))}>Open all</button>
        <button type="button" class="btn btn-xs" ${bindAction('click',()=>setAllManagedSlots(false))}>Close all</button>
        <button type="button" class="btn btn-xs" ${bindAction('click',()=>resetManagedSlots())}>Undo changes</button></div>
      </div>
      <div class="slot-manager-grid" id="slot-manager-grid" role="group" aria-label="Time slots"></div>
      <div class="slot-manager-legend"><span><i class="dot open"></i>Open</span><span><i class="dot closed"></i>Closed</span><span><i class="dot lunch"></i>Lunch break</span><span><i class="dot locked"></i>Booked or past</span></div>
      <div class="form-group" style="margin-top:.8rem"><label for="slot-manager-reason">Reason for closed times <span class="text-muted">(optional, shown to staff)</span></label><input id="slot-manager-reason" maxlength="120" placeholder="e.g. Doctor attending a meeting"></div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeTopModal())}>Back to booking</button><button class="btn btn-primary" id="slot-manager-save" ${bindAction('click',()=>saveManagedDateSlots())}>Save changes</button></div>
  </div>`,{preserveParent:true});
  renderManagedSlots();
}

function renderManagedSlots(){
  const draft=appState.bookingForm.slotDraft,grid=document.getElementById('slot-manager-grid');
  if(!draft||!grid)return;
  grid.innerHTML=draft.slots.map((s,i)=>{
    const state=!s.editable?'locked':s.open?'open':s.lunch?'lunch':'closed';
    const caption=!s.editable?s.label:s.open?(s.lunch?'Open (lunch)':'Open'):s.lunch?'Lunch break':'Closed';
    const changed=s.editable&&s.open!==draft.initial[i];
    return `<button type="button" class="slot-toggle ${state} ${changed?'changed':''}" role="switch" aria-checked="${s.open}" ${s.editable?'':'disabled'} ${bindAction('click',()=>toggleManagedSlot(i))}><strong>${fmtTime(s.time)}</strong><small>${escapeHtml(caption)}</small></button>`;
  }).join('');
  const open=draft.slots.filter(s=>s.editable&&s.open).length,closed=draft.slots.filter(s=>s.editable&&!s.open).length,locked=draft.slots.filter(s=>!s.editable).length;
  const changes=draft.slots.filter((s,i)=>s.editable&&s.open!==draft.initial[i]).length;
  const summary=document.getElementById('slot-manager-summary');
  if(summary)summary.textContent=`${open} open · ${closed} closed · ${locked} booked or past${changes?` · ${changes} unsaved change${changes===1?'':'s'}`:''}`;
  const save=document.getElementById('slot-manager-save');if(save)save.disabled=!changes;
}
export function toggleManagedSlot(index){
  const slot=appState.bookingForm.slotDraft?.slots[index];
  if(!slot?.editable)return;
  slot.open=!slot.open;renderManagedSlots();
}
export function setAllManagedSlots(open){
  for(const slot of appState.bookingForm.slotDraft?.slots||[])if(slot.editable)slot.open=open;
  renderManagedSlots();
}
export function resetManagedSlots(){
  const draft=appState.bookingForm.slotDraft;if(!draft)return;
  draft.slots.forEach((slot,i)=>{slot.open=draft.initial[i];});
  renderManagedSlots();
}

export async function saveManagedDateSlots(){
  const draft=appState.bookingForm.slotDraft;if(!draft)return;
  const doc=getUserById(draft.docId);if(!doc)return;
  const reason=(document.getElementById('slot-manager-reason')?.value||'').trim().slice(0,120);
  // Only differences from the normal schedule are stored: closed regular times and reopened lunch times.
  const deviations=[];
  for(const slot of draft.slots){
    if(!slot.editable)continue;
    if(!slot.open&&!slot.lunch)deviations.push({time:slot.time,is_available:false,reason:reason||'Manually unavailable'});
    else if(slot.open&&slot.lunch)deviations.push({time:slot.time,is_available:true,reason:'Lunch slot reopened'});
  }
  const button=document.getElementById('slot-manager-save');
  if(button){button.disabled=true;button.textContent='Saving…';}
  try{
    if(appState.auth.currentUser?._realSupabase){
      if(!doc.dbUserId)throw new Error('This doctor record could not be matched. Refresh the page and try again.');
      await appointmentAction({action:'manage_slots',doctor_id:doc.dbUserId,date:draft.date,slots:deviations});
      await syncRealAppointments();
    }else{
      appState.data.DB.settings.slotOverrides=(Array.isArray(appState.data.DB.settings.slotOverrides)?appState.data.DB.settings.slotOverrides:[]).filter(o=>!(o.doctorId===draft.docId&&o.date===draft.date));
      appState.data.DB.settings.slotOverrides.push({doctorId:draft.docId,date:draft.date,blockedTimes:deviations.filter(x=>!x.is_available).map(x=>x.time),availableTimes:deviations.filter(x=>x.is_available).map(x=>x.time)});
      persistDB();
    }
    closeTopModal();
    appState.bookingForm.slotDraft=null;
    toast('Time slots updated.','success');
    // Reload this doctor's availability and return to the same date in the booking form.
    await onBookingDoctorChange();
    if(!chooseBookingDate(draft.date))toast('No times are open on that date now. Choose another date.','warning');
  }catch(e){
    toast(e?.message||'Unable to update time slots.','error');
    if(button&&document.body.contains(button)){button.disabled=false;button.textContent='Save changes';}
  }
}

export function loadTimeSlots(){
  const docId=parseInt((document.getElementById('b-doc')||{}).value);
  const date=(document.getElementById('b-date')||{}).value;
  const grid=document.getElementById('slot-grid');
  if(!grid)return;
  const manage=document.getElementById('b-manage-slots');
  if(manage){manage.disabled=!(docId&&date);manage.title=manage.disabled?'Pick a doctor and a date first':'';}
  if(!date){grid.innerHTML='<span class="text-muted" style="font-size:.78rem">'+(docId?'Choose a highlighted date to see times.':'Choose your doctor first.')+'</span>';return;}
  if(!docId){grid.innerHTML='<span class="text-muted" style="font-size:.78rem">No doctor is available for the selected date and clinic.</span>';return;}
  const day=(appState.bookingForm.availabilityDays||[]).find(day=>day.date===date);
  if(!day?.openSlots){grid.innerHTML='<p class="text-muted">No openings remain on this date. Choose another highlighted date.</p>';return;}
  const selectedTime=document.getElementById('b-time')?.value;
  // Native buttons provide pointer, keyboard, focus and disabled behavior with one actual function call.
  grid.innerHTML=day.slots.map(slot=>`<button type="button" data-time="${slot.time}" class="slot ${slot.kind} ${slot.available&&selectedTime===slot.time?'selected':''}" ${slot.available?'':'disabled'} aria-pressed="${slot.available&&selectedTime===slot.time}" ${bindAction('click',()=>selectSlot(slot.time))} title="${escapeHtml(slot.label)}">${fmtTime(slot.time)}<span class="slot-state">${escapeHtml(slot.label)}</span></button>`).join('');
}

export function selectSlot(time){
  const date=document.getElementById('b-date')?.value,day=(appState.bookingForm.availabilityDays||[]).find(day=>day.date===date);
  const slot=day?.slots.find(slot=>slot.time===time);
  if(!slot?.available)return false;
  const doc=getUserById(Number(document.getElementById('b-doc')?.value));
  if(!doc||slotAvailabilityState({...doc,...day?.schedule},date,time).blocked)return false;
  document.getElementById('b-time').value=time;
  // Keep keyboard focus on the chosen button instead of replacing the slot grid.
  document.querySelectorAll('#slot-grid button.slot').forEach(button=>{const selected=!button.disabled&&button.dataset.time===time;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
  return true;
}

export async function saveAppt(editId){
  const ptId=parseInt(document.getElementById('b-pt').value);
  const clinic=document.getElementById('b-clinic').value;
  const svc=document.getElementById('b-service').value;
  const docId=parseInt(document.getElementById('b-doc').value);
  const date=document.getElementById('b-date').value;
  const time=document.getElementById('b-time').value;
  const reason=document.getElementById('b-reason').value.trim();
  const msg=document.getElementById('book-msg');
  hideAlert(msg);

  if(!ptId||!clinic||!svc||!docId||!date){showAlert(msg,'All required fields must be filled.');return;}
  if(!time){showAlert(msg,'Please select a time slot.');return;}
  if(date<appState.clinicInformation.TODAY){showAlert(msg,'Cannot book in the past.');return;}

  const pt=getPatientById(ptId);
  const doc=getUserById(docId);
  if(appState.auth.currentUser?._realSupabase&&(!pt?._realSupabase||!doc?._realSupabase)){
    showAlert(msg,'Please select a real CampusCare patient and doctor.');return;
  }

  const selectedDay=(appState.bookingForm.availabilityDays||[]).find(day=>day.date===date);
  const bookingError=validateCampusBooking(doc,pt,date,time,editId,clinic,selectedDay?.schedule);
  if(bookingError){showAlert(msg,bookingError);return;}
  const slotState=doc?slotAvailabilityState({...doc,...selectedDay?.schedule},date,time):null;
  if(slotState&&slotState.blocked){showAlert(msg,`This slot is unavailable (${slotState.label}). Please choose another time.`);loadTimeSlots();return;}

  if(clinic==='Dental Clinic'&&checkDentalQuota(ptId,editId)){
    showAlert(msg,'Dental Clinic booking denied: Semester limit reached.');return;
  }

  const priority=pt?pt.personType==='Student'?'Student':pt.personType==='Teaching Personnel'?'Teaching':'Non-Teaching':'Student';
  const existing=editId?appointmentRecords().find(a=>a.id===Number(editId)):null;
  if(editId&&(!existing||existing.status!=='Scheduled'||(appState.auth.currentUser.role==='Patient'&&existing.patientId!==appState.auth.currentPatient?.id))){showAlert(msg,'Only an existing scheduled appointment you can access may be rescheduled.');return;}

  const btn=document.querySelector('.modal-footer .btn-primary');
  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent=existing?'Rescheduling…':'Booking…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      await appointmentAction({
        action:existing?'reschedule':'create',
        appointment_id:existing?.dbAppointmentId,
        patient_id:pt.dbPatientId,
        doctor_id:doc.dbUserId,
        clinic,
        service:svc,
        appointment_date:date,
        appointment_time:time,
        reason,
        priority
      });
      await syncRealAppointments();
      toast(existing?'Appointment rescheduled.':'Appointment booked. Please bring your COR when you arrive.','success');
    }else{
      // Legacy demo fallback.
      if(existing){
        Object.assign(existing,{clinic,service:svc,doctorId:docId,date,time,reason});
      }else{
        const newId=appState.data.DB.nextApptId++;
        appState.data.DB.appointments.push({id:newId,patientId:ptId,doctorId:docId,clinic,service:svc,date,time,reason,status:'Scheduled',priority,college:pt?pt.college:'',createdBy:appState.auth.currentUser.id,notes:'',createdAt:appState.clinicInformation.TODAY});
        persistDB();
      }
      toast(existing?'Appointment rescheduled.':'Appointment booked.','success');
    }

    persistDB();
    discardCampusDraft('booking',false);
    void refreshTaskBadges(true);
    closeAllModals();
    if(appState.auth.currentUser.role==='Patient')await renderMyAppointments();
    else await renderAppointments();
  }catch(e){
    showAlert(msg,e?.message||'Unable to save appointment.');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=oldText||'Confirm Booking';}
  }
}

export function openRescheduleModal(id){
  openBookApptModal(id);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.bookingForm.activeBookingEditId=null;
  appState.bookingForm.bookingDraftForSlotManager=null;
}
