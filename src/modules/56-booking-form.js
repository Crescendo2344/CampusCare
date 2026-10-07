// ── Book Appointment ──
let activeBookingEditId=null;

function doctorOpenSlotCount(doc,date){
  if(!doc||!date||date<clinicToday())return 0;
  doc=campusScheduleForDate(doc,date);
  if(DB.doctorLeaves.some(l=>l.doctorId===doc.id&&l.date===date))return 0;

  const dayName=dayOfWeek(date);
  const workDays=doc.workDays||['Mon','Tue','Wed','Thu','Fri'];
  if(!workDays.includes(dayName))return 0;

  const taken=new Set(
    appointmentRecords()
      .filter(a=>
        a.id!==Number(activeBookingEditId) &&
        a.doctorId===doc.id &&
        a.date===date &&
        a.status!=='Cancelled'
      )
      .map(a=>a.time)
  );

  const remaining=Math.max(0,Number(doc.maxPatients||20)-appointmentRecords().filter(a=>a.id!==Number(activeBookingEditId)&&a.doctorId===doc.id&&a.date===date&&a.status!=='Cancelled').length);
  return Math.min(remaining,appointmentSlotBaseTimes(doc).filter(t=>{
    if(taken.has(t))return false;
    const state=slotAvailabilityState(doc,date,t);
    return !state.blocked;
  }).length);
}

function refreshAvailableDoctorsForDate(preferredDoctorId=null){
  const date=(document.getElementById('b-date')||{}).value||'';
  const clinic=(document.getElementById('b-clinic')||{}).value||'Medical Clinic';
  const docSelect=document.getElementById('b-doc');
  const note=document.getElementById('b-doctor-note');
  const time=document.getElementById('b-time');
  if(!docSelect)return;

  if(time)time.value='';

  if(!date){
    docSelect.innerHTML='<option value="">Select an appointment date first</option>';
    docSelect.disabled=true;
    if(note)note.textContent='Choose a date to see doctors who are actually available that day.';
    loadTimeSlots();
    return;
  }

  const baseDoctors=clinic==='Dental Clinic'?getDentalDoctors():getMedDoctors();
  const available=baseDoctors
    .map(d=>({doctor:d,slots:doctorOpenSlotCount(d,date)}))
    .filter(x=>x.slots>0);

  if(!available.length){
    docSelect.innerHTML='<option value="">No doctors available on this date</option>';
    docSelect.disabled=true;
    if(note)note.textContent=`No ${clinic==='Dental Clinic'?'dental':'medical'} doctor has an open appointment slot on ${fmtDate(date)}. Please choose another date.`;
    loadTimeSlots();
    return;
  }

  docSelect.disabled=false;
  docSelect.innerHTML=available.map(({doctor,slots})=>
    `<option value="${doctor.id}">${escapeHtml(docName(doctor))} — ${escapeHtml(doctor.specialty||'General Medicine')} · ${slots} open slot${slots===1?'':'s'}</option>`
  ).join('');

  const preferred=Number(preferredDoctorId||0);
  if(preferred&&available.some(x=>x.doctor.id===preferred))docSelect.value=String(preferred);
  else docSelect.value=String(available[0].doctor.id);

  if(note){
    note.textContent=available.length===1
      ? `${docName(available[0].doctor)} is available on ${fmtDate(date)}.`
      : `${available.length} doctors have open slots on ${fmtDate(date)}. Choose the doctor you prefer.`;
  }

  loadTimeSlots();
}

function openBookApptModal(apptId=null){
  activeBookingEditId=apptId?Number(apptId):null;
  const editing=apptId?appointmentRecords().find(a=>a.id===Number(apptId)):null;
  const isPt=currentUser.role==='Patient';
  const pt=isPt?currentPatient:null;
  const selectedDate=editing?editing.date:'';

  openModal(`<div class="modal">
    <div class="modal-header"><h3>${editing?'Reschedule':'Book'} Appointment</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <div id="book-msg"></div>
      <div id="dental-warn" class="alert alert-warning"></div>
      <div class="alert alert-info show" style="font-size:.77rem">
        📍 <strong>Clinic location:</strong> Ground Floor, Education Building, CTU Main Campus.<br>
        🕗 <strong>Posted Medical Clinic hours:</strong> Mon–Fri 8:00 AM–5:00 PM; extended Mon–Fri 5:00 PM–9:00 PM; Sat 8:00 AM–9:00 PM; Sun 8:00 AM–5:00 PM.<br>
        Select an appointment date first. CampusCare will then show only doctors with open slots on that day.
      </div>

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
                <input type="search" id="b-pt-search" autocomplete="off" placeholder="Search patient by name, ID, or college…" value="${editing?(()=>{const p=getPatientById(editing.patientId);return p?escapeHtml(p.fname+' '+p.lname):''})():''}" oninput="filterBookPatients(this.value)">
                <div class="patient-combobox-list" id="b-pt-results"></div>
              </div>`}
        </div>
        ${!isPt?`<div class="form-group"><label>Priority</label>
          <select id="b-priority"><option>Student</option><option>Teaching</option><option>Non-Teaching</option></select>
        </div>`:''}
      </div>

      <div class="form-row">
        <div class="form-group"><label>Clinic <span class="required">*</span></label>
          <select id="b-clinic" onchange="onClinicChange()">
            <option value="Medical Clinic" ${editing&&editing.clinic==='Medical Clinic'?'selected':''}>Medical Clinic</option>
            <option value="Dental Clinic" ${editing&&editing.clinic==='Dental Clinic'?'selected':''}>Dental Clinic</option>
          </select>
        </div>
        <div class="form-group"><label>Service <span class="required">*</span></label>
          <select id="b-service"></select>
        </div>
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

      <div class="form-group full">
        <label>Available Doctor <span class="required">*</span></label>
        <select id="b-doc" onchange="loadTimeSlots()" disabled>
          <option value="">Select an appointment date first</option>
        </select>
        <div class="booking-doctor-note" id="b-doctor-note">Choose a date to see doctors who are actually available that day.</div>
      </div>

      <div class="form-group">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
          <label>Available Time Slots</label>
          ${['Staff','Administrator'].includes(currentUser.role)?`<button type="button" class="btn btn-xs" onclick="openManageDateSlots()"><i class="bi bi-clock"></i> Manage slots for this date</button>`:''}
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
      <button class="btn" onclick="closeAllModals()">Cancel</button>
      <button class="btn btn-primary" onclick="saveAppt(${apptId||'null'})">Confirm Booking</button>
    </div>
  </div>`);

  initModernCalendar(
    'booking-modern-calendar',
    selectedDate,
    TODAY,
    'chooseBookingDate',
    {allowEmptySelection:!selectedDate}
  );

  onClinicChange(editing?.doctorId||null);

  if(editing){
    const service=document.getElementById('b-service');
    if(service&&Array.from(service.options).some(o=>o.value===editing.service||o.text===editing.service)){
      service.value=editing.service;
    }
    refreshAvailableDoctorsForDate(editing.doctorId);
    const time=document.getElementById('b-time');
    if(time)time.value=editing.time||'';
    loadTimeSlots();
  }

  checkDentalWarn();
}

function chooseBookingDate(date,preferredDoctorId=null){
  const input=document.getElementById('b-date');
  const label=document.getElementById('b-date-label');
  const time=document.getElementById('b-time');

  if(input)input.value=date;
  if(label)label.textContent=fmtDate(date);
  if(time)time.value='';

  refreshAvailableDoctorsForDate(preferredDoctorId);
}

function onClinicChange(preferredDoctorId=null){
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
  refreshAvailableDoctorsForDate(preferredDoctorId);
}

function checkDentalWarn(){
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

function timeToMinutes(t){return scheduleRules.timeToMinutes(t);}
function appointmentSlotBaseTimes(doc){return scheduleRules.appointmentSlotBaseTimes(doc);}
function getSlotOverride(docId,date){
  DB.settings.slotOverrides=Array.isArray(DB.settings.slotOverrides)?DB.settings.slotOverrides:[];
  return DB.settings.slotOverrides.find(o=>o.doctorId===docId&&o.date===date)||null;
}
function isDefaultLunchSlot(time,doc){
  return scheduleRules.isDefaultLunchSlot(time,doc,DB.settings);
}
function slotAvailabilityState(doc,date,time){
  const override=getSlotOverride(doc.id,date),blocked=(override&&override.blockedTimes)||[],available=(override&&override.availableTimes)||[];
  if(blocked.includes(time))return {blocked:true,label:'Unavailable',kind:'blocked'};
  if(isDefaultLunchSlot(time,doc)&&!available.includes(time))return {blocked:true,label:'Lunch break',kind:'lunch'};
  if(date===clinicToday()){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()),nowMin=timeToMinutes(parts);if(timeToMinutes(time)<=nowMin)return {blocked:true,label:'Past time',kind:'past'};}
  return {blocked:false,label:'Available',kind:'available'};
}
let bookingDraftForSlotManager=null;
function openManageDateSlots(){
  if(!['Staff','Administrator'].includes(currentUser.role))return;
  const docId=parseInt((document.getElementById('b-doc')||{}).value),date=(document.getElementById('b-date')||{}).value;
  const doc=getUserById(docId); if(!doc||!date){toast('Choose a doctor and date first.','warning');return;}
  bookingDraftForSlotManager={
    patientId:(document.getElementById('b-pt')||{}).value||'',
    clinic:(document.getElementById('b-clinic')||{}).value||'Medical Clinic',
    service:(document.getElementById('b-service')||{}).value||'',
    doctorId:String(docId),date,
    reason:(document.getElementById('b-reason')||{}).value||''
  };
  const slots=appointmentSlotBaseTimes(doc),taken=new Set(appointmentRecords().filter(a=>a.doctorId===docId&&a.date===date&&a.status!=='Cancelled').map(a=>a.time));
  const override=getSlotOverride(docId,date),blocked=new Set((override&&override.blockedTimes)||[]),available=new Set((override&&override.availableTimes)||[]);
  openModal(`<div class="modal modal-lg"><div class="modal-header"><div><h3>Manage Available Time Slots</h3><div class="text-muted">${escapeHtml(docName(doc))} · ${fmtDate(date)} · Lunch is ${fmtTime(DB.settings.lunchBreakStart||'12:00')}–${fmtTime(DB.settings.lunchBreakEnd||'13:00')}</div></div><button class="close-btn" onclick="closeAllModals()">✕</button></div><div class="modal-body"><div class="alert alert-info show">Checked slots are available for booking. Booked slots cannot be changed. You can reopen a lunch-break slot for a specific date if needed.</div><div class="slot-manager-grid">${slots.map(t=>{const isLunch=isDefaultLunchSlot(t,doc),isTaken=taken.has(t),checked=isTaken||(!blocked.has(t)&&(!isLunch||available.has(t)));return `<label class="slot-manager-item ${isTaken?'booked':''}"><input type="checkbox" class="slot-manager-check" value="${t}" ${checked?'checked':''} ${isTaken?'disabled':''}><span><strong>${fmtTime(t)}</strong><small style="display:block;color:var(--ink-muted)">${isTaken?'Booked':isLunch?'Lunch break':'Regular slot'}</small></span></label>`;}).join('')}</div></div><div class="modal-footer"><button class="btn" onclick="closeAllModals()">Cancel</button><button class="btn btn-primary" onclick="saveManagedDateSlots(${docId},'${date}')">Save Availability</button></div></div>`);
}
async function saveManagedDateSlots(docId,date){
  const doc=getUserById(docId);if(!doc)return;
  const slots=appointmentSlotBaseTimes(doc);
  const checked=new Set(Array.from(document.querySelectorAll('.slot-manager-check:checked')).map(x=>x.value));
  const taken=new Set(appointmentRecords().filter(a=>a.doctorId===docId&&a.date===date&&a.status!=='Cancelled').map(a=>a.time));
  const deviations=[];

  slots.forEach(t=>{
    if(taken.has(t))return;
    const lunch=isDefaultLunchSlot(t,doc);
    if(!checked.has(t))deviations.push({time:t,is_available:false,reason:lunch?'Lunch break':'Manually unavailable'});
    else if(lunch)deviations.push({time:t,is_available:true,reason:'Lunch slot reopened'});
  });

  try{
    if(currentUser?._realSupabase){
      await appointmentAction({action:'manage_slots',doctor_id:doc.dbUserId,date,slots:deviations});
      await syncRealAppointments();
    }else{
      const blockedTimes=deviations.filter(x=>!x.is_available).map(x=>x.time);
      const availableTimes=deviations.filter(x=>x.is_available).map(x=>x.time);
      DB.settings.slotOverrides=Array.isArray(DB.settings.slotOverrides)?DB.settings.slotOverrides:[];
      DB.settings.slotOverrides=DB.settings.slotOverrides.filter(o=>!(o.doctorId===docId&&o.date===date));
      DB.settings.slotOverrides.push({doctorId:docId,date,blockedTimes,availableTimes});
      persistDB();
    }
    closeAllModals();
    toast('Time-slot availability updated.','success');

    const draft=bookingDraftForSlotManager;bookingDraftForSlotManager=null;
    openBookApptModal();
    setTimeout(()=>{
      if(!draft)return;
      const pt=document.getElementById('b-pt'),clinic=document.getElementById('b-clinic'),docEl=document.getElementById('b-doc'),reason=document.getElementById('b-reason');
      if(pt&&!pt.disabled)pt.value=draft.patientId;
      if(clinic){clinic.value=draft.clinic;onClinicChange();}
      chooseBookingDate(draft.date,Number(draft.doctorId));
      const svc=document.getElementById('b-service');
      if(svc&&Array.from(svc.options).some(o=>o.value===draft.service||o.text===draft.service))svc.value=draft.service;
      if(reason)reason.value=draft.reason;
      loadTimeSlots();
    },0);
  }catch(e){
    toast(e?.message||'Unable to update time slots.','error');
  }
}

function loadTimeSlots(){
  const docId=parseInt((document.getElementById('b-doc')||{}).value);
  const date=(document.getElementById('b-date')||{}).value;
  const grid=document.getElementById('slot-grid');
  if(!grid)return;
  if(!date){grid.innerHTML='<span class="text-muted" style="font-size:.78rem">Select an appointment date first.</span>';return;}
  if(!docId){grid.innerHTML='<span class="text-muted" style="font-size:.78rem">No doctor is available for the selected date and clinic.</span>';return;}
  let doc=getUserById(docId); if(!doc)return;
  doc=campusScheduleForDate(doc,date);
  const leave=DB.doctorLeaves.find(l=>l.doctorId===docId&&l.date===date);
  if(leave){grid.innerHTML=`<span class="text-muted" style="font-size:.78rem">Dr. ${doc.lname} is on leave on ${fmtDate(date)}${leave.reason?' ('+escapeHtml(leave.reason)+')':''}. Please pick another date.</span>`;return;}
  const dayName=dayOfWeek(date),workDays=doc.workDays||['Mon','Tue','Wed','Thu','Fri'];
  if(!workDays.includes(dayName)){grid.innerHTML=`<span class="text-muted" style="font-size:.78rem">Dr. ${doc.lname} does not work on ${dayName}s.</span>`;return;}
  const slots=appointmentSlotBaseTimes(doc);
  const dailyFull=appointmentRecords().filter(a=>a.id!==Number(activeBookingEditId)&&a.doctorId===docId&&a.date===date&&a.status!=='Cancelled').length>=Number(doc.maxPatients||20);
  const takenSlots=new Set(
    appointmentRecords()
      .filter(a=>
        a.id!==Number(activeBookingEditId) &&
        a.doctorId===docId &&
        a.date===date &&
        a.status!=='Cancelled'
      )
      .map(a=>a.time)
  );
  const selectedTime=(document.getElementById('b-time')||{}).value;
  grid.innerHTML=slots.map(t=>{
    const taken=takenSlots.has(t),state=slotAvailabilityState(doc,date,t),disabled=taken||state.blocked||dailyFull;
    const cls=taken?'booked':state.kind;
    const label=taken?'Booked':dailyFull?'Daily limit reached':state.label;
    return `<div class="slot ${cls} ${!disabled&&selectedTime===t?'selected':''}" onclick="${disabled?'':'selectSlot(\''+t+'\',event)'}" title="${label}">${fmtTime(t)}<span class="slot-state">${label}</span></div>`;
  }).join('');
}

function selectSlot(t,ev){
  const input=document.getElementById('b-time');
  if(input){input.value=t;}
  document.querySelectorAll('.slot:not(.booked)').forEach(s=>s.classList.remove('selected'));
  if(ev&&ev.currentTarget)ev.currentTarget.classList.add('selected');
}

async function saveAppt(editId){
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
  if(date<TODAY){showAlert(msg,'Cannot book in the past.');return;}

  const pt=getPatientById(ptId);
  const doc=getUserById(docId);
  if(currentUser?._realSupabase&&(!pt?._realSupabase||!doc?._realSupabase)){
    showAlert(msg,'Please select a real CampusCare patient and doctor.');return;
  }

  const bookingError=validateCampusBooking(doc,pt,date,time,editId,clinic);
  if(bookingError){showAlert(msg,bookingError);return;}
  const slotState=doc?slotAvailabilityState(doc,date,time):null;
  if(slotState&&slotState.blocked){showAlert(msg,`This slot is unavailable (${slotState.label}). Please choose another time.`);loadTimeSlots();return;}

  if(clinic==='Dental Clinic'&&checkDentalQuota(ptId,editId)){
    showAlert(msg,'Dental Clinic booking denied: Semester limit reached.');return;
  }

  const priority=pt?pt.personType==='Student'?'Student':pt.personType==='Teaching Personnel'?'Teaching':'Non-Teaching':'Student';
  const existing=editId?appointmentRecords().find(a=>a.id===Number(editId)):null;
  if(editId&&(!existing||existing.status!=='Scheduled'||(currentUser.role==='Patient'&&existing.patientId!==currentPatient?.id))){showAlert(msg,'Only an existing scheduled appointment you can access may be rescheduled.');return;}

  const btn=document.querySelector('.modal-footer .btn-primary');
  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent=existing?'Rescheduling…':'Booking…';}

  try{
    if(currentUser?._realSupabase){
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
        const newId=DB.nextApptId++;
        DB.appointments.push({id:newId,patientId:ptId,doctorId:docId,clinic,service:svc,date,time,reason,status:'Scheduled',priority,college:pt?pt.college:'',createdBy:currentUser.id,notes:'',createdAt:TODAY});
        persistDB();
      }
      toast(existing?'Appointment rescheduled.':'Appointment booked.','success');
    }

    persistDB();
    discardCampusDraft('booking',false);
    void refreshTaskBadges(true);
    closeAllModals();
    if(currentUser.role==='Patient')await renderMyAppointments();
    else await renderAppointments();
  }catch(e){
    showAlert(msg,e?.message||'Unable to save appointment.');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=oldText||'Confirm Booking';}
  }
}

function openRescheduleModal(id){
  openBookApptModal(id);
}
