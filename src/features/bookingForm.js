// bookingForm: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {campusScheduleForDate,clinicToday,discardCampusDraft,validateCampusBooking} from './scheduleAndDrafts.js';
import {dayOfWeek,fmtDate,fmtTime} from './inputValidation.js';
import {appointmentAction,appointmentRecords,appointmentService,syncRealAppointments} from './appointmentService.js';
import {checkDentalQuota,getDentalDoctors,getMedDoctors,getPatientById,getUserById} from './documentScanner.js';
import {escapeHtml} from './issueReports.js';
import {docName} from './messaging.js';
import {closeAllModals,openModal} from './modals.js';
import {filterBookPatients} from './datePicker.js';
import {initModernCalendar,renderModernCalendar} from './calendar.js';
import {clearToasts,hideAlert,showAlert,toast} from './theme.js';
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

// Day-by-day openings for one doctor. `editing` leaves that appointment's own time selectable.
export async function fetchDoctorAvailability(doctor,from,to,editing=null){
  if(appState.auth.currentUser?._realSupabase){
    const result=await appointmentService().availability({doctor_id:doctor.dbUserId,from,to,...(editing?{appointment_id:editing.dbAppointmentId}:{})});
    if(!Array.isArray(result.days))throw new Error('Availability could not be loaded. Please retry.');
    return result.days;
  }
  // Local demonstration records use the same slot rules without pretending to query live reservations.
  const now=new Date(),nowMinutes=(now.getUTCHours()*60+now.getUTCMinutes()+480)%1440;
  return buildDoctorAvailability({doctor,from,to,today:from,nowMinutes,appointments:appointmentRecords().filter(a=>a.doctorId===doctor.id&&a.id!==editing?.id),leaves:(appState.data.DB.doctorLeaves||[]).filter(l=>l.doctorId===doctor.id),overrides:(appState.data.DB.settings.slotOverrides||[]).filter(o=>o.doctorId===doctor.id).flatMap(o=>[...(o.blockedTimes||[]).map(time=>({date:o.date,time,available:false})),...(o.availableTimes||[]).map(time=>({date:o.date,time,available:true}))]),settings:{lunchStart:appState.data.DB.settings.lunchBreakStart,lunchEnd:appState.data.DB.settings.lunchBreakEnd}});
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
    const editing=appointmentRecords().find(a=>a.id===appState.bookingForm.activeBookingEditId);
    const days=await fetchDoctorAvailability(doctor,from,to,editing);
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
        ${!isPt?`<div class="form-group"><label for="b-priority">Priority</label>
          <div class="booking-locked-field"><input id="b-priority" readonly aria-readonly="true" tabindex="-1" placeholder="Choose a patient first" value="${escapeHtml(editing?patientPriority(getPatientById(editing.patientId))||'':'')}"><i class="bi bi-lock" aria-hidden="true"></i></div>
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
        <label>Available Time Slots</label>
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
export function loadTimeSlots(){
  const docId=parseInt((document.getElementById('b-doc')||{}).value);
  const date=(document.getElementById('b-date')||{}).value;
  const grid=document.getElementById('slot-grid');
  if(!grid)return;
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

  const priority=patientPriority(pt)||'Student';
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
    }else{
      // Legacy demo fallback.
      if(existing){
        Object.assign(existing,{clinic,service:svc,doctorId:docId,date,time,reason});
      }else{
        const newId=appState.data.DB.nextApptId++;
        appState.data.DB.appointments.push({id:newId,patientId:ptId,doctorId:docId,clinic,service:svc,date,time,reason,status:'Scheduled',priority,college:pt?pt.college:'',createdBy:appState.auth.currentUser.id,notes:'',createdAt:appState.clinicInformation.TODAY});
        persistDB();
      }
    }

    persistDB();
    discardCampusDraft('booking',false);
    void refreshTaskBadges(true);
    closeAllModals();
    const forSelf=appState.auth.currentUser.role==='Patient';
    if(forSelf)await renderMyAppointments();
    else await renderAppointments();
    // Patients get a confirmation that spells out what to bring; staff get a reminder to pass on.
    if(forSelf)showBookingConfirmation({rescheduled:Boolean(existing),clinic,service:svc,doctor:doc,date,time,patient:pt});
    else toast(existing?`Rescheduled for ${fmtDate(date)} at ${fmtTime(time)}. Remind the patient to bring a signed COR.`:`Booked for ${fmtDate(date)} at ${fmtTime(time)}. Remind the patient to bring a signed COR.`,'success',6000,{title:existing?'Appointment rescheduled':'Appointment booked'});
  }catch(e){
    showAlert(msg,e?.message||'Unable to save appointment.');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=oldText||'Confirm Booking';}
  }
}

// Booking priority comes from who the patient is, never from a choice at booking time.
export function patientPriority(pt){
  if(!pt)return '';
  return pt.personType==='Teaching Personnel'?'Teaching':pt.personType==='Non-Teaching Personnel'?'Non-Teaching':'Student';
}

// Name the term the visit falls in so the patient brings the right Certificate of Registration.
function registrationTermLabel(date){
  const st=appState.data.DB.settings||{};
  const within=(from,to)=>from&&to&&date>=from&&date<=to;
  const term=within(st.semester2Start,st.semester2End)?'2nd Semester':within(st.semesterStart,st.semesterEnd)?'1st Semester':'';
  if(!term)return 'the current semester';
  const year=Number(String(st.semesterStart||date).slice(0,4));
  return `${term}, SY ${year}–${year+1}`;
}

export function corChecklistHtml(date,personType='Student'){
  const student=personType!=='Teaching Personnel'&&personType!=='Non-Teaching Personnel';
  return `<section class="cor-reminder" aria-labelledby="cor-reminder-title">
    <div class="cor-reminder-head"><span class="cor-badge" aria-hidden="true"><svg viewBox="0 0 64 76" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="56" height="70" rx="5"/><circle cx="15" cy="13" r="5"/><path d="M25 11h24M25 16h16"/><path d="M11 27h42M11 34h42M11 41h42M11 48h30"/><path d="M11 63c3-5 6 1 9-3s5 2 8-1" class="cor-sign"/><path d="M38 64h15" class="cor-sign"/></svg></span>
      <div><h4 id="cor-reminder-title">Bring this when you arrive</h4><p>${student?`Your <strong>signed</strong> Certificate of Registration (COR) for ${escapeHtml(registrationTermLabel(date))}.`:'Your Employee ID so the clinic can confirm your record.'}</p></div></div>
    ${student?`<ul class="cor-checklist">
      <li><span aria-hidden="true">✓</span><div><strong>Signed on the Student Signature line</strong><small>Sign your COR before you come. An unsigned COR may not be accepted.</small></div></li>
      <li><span aria-hidden="true">✓</span><div><strong>Current semester, with the Registrar's signature</strong><small>Your ID number and name must match your CampusCare account.</small></div></li>
      <li><span aria-hidden="true">✓</span><div><strong>Printed copy or a clear photo on your phone</strong><small>Bring your Student ID too.</small></div></li>
    </ul>`:''}
  </section>`;
}

export function showBookingConfirmation({rescheduled,clinic,service,doctor,date,time,patient}){
  clearToasts();
  openModal(`<div class="modal booking-done" role="dialog" aria-labelledby="booking-done-title">
    <div class="modal-body">
      <div class="booking-done-head"><span class="booking-done-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span>
        <h3 id="booking-done-title">${rescheduled?'Appointment rescheduled':'Appointment booked'}</h3>
        <p>We'll remind you before your visit.</p></div>
      <dl class="booking-done-summary">
        <div><dt>When</dt><dd>${escapeHtml(dayOfWeek(date))}, ${escapeHtml(fmtDate(date))} · ${escapeHtml(fmtTime(time))}</dd></div>
        <div><dt>Where</dt><dd>${escapeHtml(clinic)}${service?' · '+escapeHtml(service):''}</dd></div>
        ${doctor?`<div><dt>With</dt><dd>${escapeHtml(docName(doctor))}</dd></div>`:''}
      </dl>
      ${corChecklistHtml(date,patient?.personType)}
    </div>
    <div class="modal-footer booking-done-actions"><button type="button" class="btn btn-primary" ${bindAction('click',()=>closeAllModals())}>Got it</button></div>
  </div>`);
}

export function openRescheduleModal(id){
  openBookApptModal(id);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.bookingForm.activeBookingEditId=null;
}
