// ── Reusable CampusCare date picker ─────────────────────────────
// Replaces the browser's native date UI so every date field uses the
// same month/year navigation and visual style.
function campusDateFieldHtml(id,value,title,minDate='',maxDate='',onChange=''){
  const shown=value?fmtDate(value):'Select date';
  return `<input type="hidden" id="${id}" value="${value||''}">
    <div class="campus-date-field">
      <button type="button" class="modern-date-btn" onclick="openCampusDatePicker('${id}','${jsAttrSafe(title)}','${minDate||''}','${maxDate||''}','${onChange||''}')">
        <i class="bi bi-calendar3"></i><span id="${id}-label">${shown}</span>
      </button>
    </div>`;
}
let campusDatePickerTarget=null;
function openCampusDatePicker(inputId,title,minDate='',maxDate='',onChange=''){
  const input=document.getElementById(inputId);
  if(!input)return;
  campusDatePickerTarget={inputId,onChange};
  const selected=input.value||((minDate&&minDate>TODAY)?minDate:TODAY);
  openModal(`<div class="modal"><div class="modal-header"><div><h3>${escapeHtml(title||'Select Date')}</h3><div class="text-muted">Choose a month, year, and date.</div></div><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body"><div id="campus-single-date-calendar"></div></div>
    <div class="modal-footer"><button class="btn" onclick="closeAllModals()">Cancel</button></div></div>`);
  const isDob=/dob|birth/i.test(inputId);
  initModernCalendar(
    'campus-single-date-calendar',
    selected,
    minDate||'',
    'applyCampusDateSelection',
    {
      maxDate:maxDate||'',
      showAppointmentHints:!isDob,
      showTodayButton:!isDob
    }
  );
}
function applyCampusDateSelection(date){
  if(!campusDatePickerTarget)return;
  const {inputId,onChange}=campusDatePickerTarget;
  const input=document.getElementById(inputId),label=document.getElementById(inputId+'-label');
  if(input)input.value=date;
  if(label)label.textContent=fmtDate(date);
  const cb=onChange&&window[onChange];
  campusDatePickerTarget=null;
  closeAllModals();
  if(typeof cb==='function')cb();
}

// One-calendar range selector for Reports & Analytics.
let reportRangeStage='from';
let reportRangeDraftFrom='';
let reportRangeDraftTo='';
function openReportDateRange(){
  const from=document.getElementById('rpt-from'),to=document.getElementById('rpt-to');
  if(!from||!to)return;
  reportRangeDraftFrom=from.value||TODAY.substring(0,7)+'-01';
  reportRangeDraftTo=to.value||TODAY;
  reportRangeStage='from';
  openModal(`<div class="modal"><div class="modal-header"><div><h3>Select Report Date Range</h3><div class="text-muted">First select Date From, then Date To using the same calendar.</div></div><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <div id="report-range-msg"></div>
      <div class="dashboard-range-picker">
        <div class="dashboard-range-summary">
          <div class="dashboard-range-value"><span>From</span><strong id="report-range-from-label">${fmtDate(reportRangeDraftFrom)}</strong></div>
          <div class="dashboard-range-arrow">→</div>
          <div class="dashboard-range-value"><span>To</span><strong id="report-range-to-label">${fmtDate(reportRangeDraftTo)}</strong></div>
        </div>
        <div class="dashboard-range-step" id="report-range-step">1. Select the From date</div>
        <div id="report-range-calendar"></div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeAllModals()">Cancel</button><button class="btn btn-primary" onclick="applyReportDateRange()">Apply Date Range</button></div></div>`);
  initModernCalendar('report-range-calendar',reportRangeDraftFrom,'','chooseReportRangeDate',{rangeMode:true,rangeStart:reportRangeDraftFrom,rangeEnd:reportRangeDraftTo});
}
function chooseReportRangeDate(date){
  if(reportRangeStage==='from'||reportRangeStage==='done'){
    reportRangeDraftFrom=date;
    reportRangeDraftTo='';
    reportRangeStage='to';
  }else{
    if(date<reportRangeDraftFrom){
      reportRangeDraftTo=reportRangeDraftFrom;
      reportRangeDraftFrom=date;
    }else reportRangeDraftTo=date;
    reportRangeStage='done';
  }
  const st=modernCalendarState['report-range-calendar'];
  if(st){
    st.rangeStart=reportRangeDraftFrom;
    st.rangeEnd=reportRangeDraftTo;
    st.selected=reportRangeDraftTo||reportRangeDraftFrom;
    st.viewMonth=date.slice(0,7);
    renderModernCalendar('report-range-calendar');
  }
  const f=document.getElementById('report-range-from-label'),t=document.getElementById('report-range-to-label'),step=document.getElementById('report-range-step');
  if(f)f.textContent=reportRangeDraftFrom?fmtDate(reportRangeDraftFrom):'Not selected';
  if(t)t.textContent=reportRangeDraftTo?fmtDate(reportRangeDraftTo):'Not selected';
  if(step)step.textContent=reportRangeStage==='to'?'2. Now select the To date':'Range selected. Apply it, or select another date to start again.';
}
function applyReportDateRange(){
  if(!reportRangeDraftFrom||!reportRangeDraftTo){toast('Please select both From and To dates.','warning');return;}
  const from=document.getElementById('rpt-from'),to=document.getElementById('rpt-to'),label=document.getElementById('rpt-range-label');
  if(from)from.value=reportRangeDraftFrom;
  if(to)to.value=reportRangeDraftTo;
  if(label)label.textContent=`${fmtDate(reportRangeDraftFrom)} – ${fmtDate(reportRangeDraftTo)}`;
  closeAllModals();
  refreshHealthIntelligence();
}



let apptFilterStage='from',apptFilterFrom='',apptFilterTo='';
function openApptRangePicker(){
  apptFilterFrom=document.getElementById('appt-date-from')?.value||TODAY;apptFilterTo=document.getElementById('appt-date-to')?.value||'';apptFilterStage='from';
  openModal(`<div class="modal"><div class="modal-header"><div><h3>Appointment Date Range</h3><div class="text-muted">Select Date From, then Date To.</div></div><button class="close-btn" onclick="closeAllModals()">✕</button></div><div class="modal-body"><div class="dashboard-range-summary"><div class="dashboard-range-value"><span>From</span><strong id="af-from">${fmtDate(apptFilterFrom)}</strong></div><div class="dashboard-range-arrow">→</div><div class="dashboard-range-value"><span>To</span><strong id="af-to">${apptFilterTo?fmtDate(apptFilterTo):'Select date'}</strong></div></div><div class="dashboard-range-step" id="af-step">1. Select Date From</div><div id="appt-filter-calendar"></div></div><div class="modal-footer" style="justify-content:space-between"><button class="btn btn-danger" onclick="clearApptRange(true)"><i class="bi bi-eraser"></i> Clear Range</button><div style="display:flex;gap:.5rem"><button class="btn" onclick="closeAllModals()">Cancel</button><button class="btn btn-primary" onclick="applyApptRange()">Apply</button></div></div></div>`);
  initModernCalendar('appt-filter-calendar',apptFilterFrom,'','selectApptFilterDate',{rangeMode:true,rangeStart:apptFilterFrom,rangeEnd:apptFilterTo});
}
function selectApptFilterDate(date){
  if(apptFilterStage==='from'||apptFilterStage==='done'){apptFilterFrom=date;apptFilterTo='';apptFilterStage='to';}else{if(date<apptFilterFrom){apptFilterTo=apptFilterFrom;apptFilterFrom=date}else apptFilterTo=date;apptFilterStage='done'}
  const st=modernCalendarState['appt-filter-calendar'];if(st){st.rangeStart=apptFilterFrom;st.rangeEnd=apptFilterTo;st.selected=date;st.viewMonth=date.slice(0,7);renderModernCalendar('appt-filter-calendar')}
  document.getElementById('af-from').textContent=fmtDate(apptFilterFrom);document.getElementById('af-to').textContent=apptFilterTo?fmtDate(apptFilterTo):'Select date';document.getElementById('af-step').textContent=apptFilterStage==='to'?'2. Select Date To':'Range ready to apply';
}
function applyApptRange(){if(!apptFilterFrom||!apptFilterTo){toast('Select both Date From and Date To.','warning');return}document.getElementById('appt-date-from').value=apptFilterFrom;document.getElementById('appt-date-to').value=apptFilterTo;document.getElementById('appt-range-label').textContent=`${fmtDate(apptFilterFrom)} – ${fmtDate(apptFilterTo)}`;closeAllModals();renderApptTable()}
function clearApptRange(closePicker=false){
 const f=document.getElementById('appt-date-from'),t=document.getElementById('appt-date-to'),label=document.getElementById('appt-range-label');
 if(f)f.value='';if(t)t.value='';if(label)label.textContent='All dates';
 apptFilterFrom='';apptFilterTo='';apptFilterStage='from';
 if(closePicker)closeAllModals();
 renderApptTable();
}

function filterBookPatients(q=''){
 const box=document.getElementById('b-pt-results');if(!box)return;
 const s=(q||'').trim().toLowerCase();
 // Keep the suggestion panel hidden until the staff/admin actually types.
 if(!s){box.innerHTML='';box.classList.remove('show');return;}
 const pts=DB.patients.filter(p=>!p.archived&&`${p.fname} ${p.lname} ${p.idNo||''} ${p.college||''}`.toLowerCase().includes(s)).slice(0,15);
 box.innerHTML=pts.length?pts.map(p=>`<button type="button" class="patient-combobox-option" onclick="selectBookPatient(${p.id})"><strong>${escapeHtml(p.fname+' '+p.lname)}</strong><span class="text-muted" style="display:block">${escapeHtml(p.idNo||'No ID')} · ${escapeHtml(p.college||'')}</span></button>`).join(''):'<div class="text-muted" style="padding:.65rem">No matching patient.</div>';
 box.classList.add('show');
}
function selectBookPatient(id){const p=getPatientById(id);if(!p)return;document.getElementById('b-pt').value=id;document.getElementById('b-pt-search').value=`${p.fname} ${p.lname}`;document.getElementById('b-pt-results').classList.remove('show');checkDentalWarn()}

let assistedProfile='',assistedIdCor='',assistedPatientDraft=null;
function assistedFile(input,kind){
 const f=input.files?.[0];if(!f)return;const r=new FileReader();
 r.onload=e=>{if(kind==='profile'){assistedProfile=e.target.result;const im=document.getElementById('pm-profile-preview');if(im){im.src=assistedProfile;im.style.display='block'}}else{assistedIdCor=e.target.result;const x=document.getElementById('pm-id-preview');if(x)x.textContent='Selected: '+f.name}};
 r.readAsDataURL(f);
}
function captureAssistedPatientDraft(){
 const ids=['pm-fname','pm-lname','pm-email','pm-username','pm-idno','pm-birth','pm-gender','pm-blood','pm-contact','pm-college','pm-ptype','pm-height','pm-weight','pm-addr','pm-allergy','pm-history','pm-ename','pm-econtact'];
 const d={};ids.forEach(id=>{const el=document.getElementById(id);if(el)d[id]=el.value});return d;
}
function restoreAssistedPatientDraft(){
 if(!assistedPatientDraft)return;
 Object.entries(assistedPatientDraft).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.value=value});
 assistedPatientDraft=null;
}
function openAssistedPatientCamera(kind){
 assistedPatientDraft=captureAssistedPatientDraft();
 openCamera(kind==='profile'?'assisted-profile':'assisted-id');
}
