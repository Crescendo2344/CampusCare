import {resolveCallback} from '../app/callbacks.js';
// datePicker: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {fmtDate} from './inputValidation.js';
import {closeAllModals,openModal} from './modals.js';
import {escapeHtml} from './issueReports.js';
import {initModernCalendar,renderModernCalendar} from './calendar.js';
import {toast} from './theme.js';
import {refreshHealthIntelligence} from './predictiveAnalytics.js';
import {renderApptTable} from './appointments.js';
import {getPatientById} from './documentScanner.js';
import {checkDentalWarn} from './bookingForm.js';
import {openCamera} from '../app/optional-features.js';
import {bindAction} from '../dependencies.js';
// ── Reusable CampusCare date picker ─────────────────────────────
// Replaces the browser's native date UI so every date field uses the
// same month/year navigation and visual style.
export function campusDateFieldHtml(id,value,title,minDate='',maxDate='',onChange=''){
  const shown=value?fmtDate(value):'Select date';
  return `<input type="hidden" id="${id}" value="${value||''}">
    <div class="campus-date-field">
      <button type="button" class="modern-date-btn" ${bindAction('click',(event,element)=>{openCampusDatePicker((String(id)),(String(title)),(String(minDate||'')),(String(maxDate||'')),(String(onChange||'')))})}>
        <i class="bi bi-calendar3"></i><span id="${id}-label">${shown}</span>
      </button>
    </div>`;
}

export function openCampusDatePicker(inputId,title,minDate='',maxDate='',onChange=''){
  const input=document.getElementById(inputId);
  if(!input)return;
  appState.datePicker.campusDatePickerTarget={inputId,onChange};
  const selected=input.value||((minDate&&minDate>appState.clinicInformation.TODAY)?minDate:appState.clinicInformation.TODAY);
  openModal(`<div class="modal"><div class="modal-header"><div><h3>${escapeHtml(title||'Select Date')}</h3><div class="text-muted">Choose a month, year, and date.</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body"><div id="campus-single-date-calendar"></div></div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button></div></div>`);
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
export function applyCampusDateSelection(date){
  if(!appState.datePicker.campusDatePickerTarget)return;
  const {inputId,onChange}=appState.datePicker.campusDatePickerTarget;
  const input=document.getElementById(inputId),label=document.getElementById(inputId+'-label');
  if(input)input.value=date;
  if(label)label.textContent=fmtDate(date);
  const cb=onChange&&resolveCallback(onChange);
  appState.datePicker.campusDatePickerTarget=null;
  closeAllModals();
  if(typeof cb==='function')cb();
}

// One-calendar range selector for Reports & Analytics.

export function openReportDateRange(){
  const from=document.getElementById('rpt-from'),to=document.getElementById('rpt-to');
  if(!from||!to)return;
  appState.datePicker.reportRangeDraftFrom=from.value||appState.clinicInformation.TODAY.substring(0,7)+'-01';
  appState.datePicker.reportRangeDraftTo=to.value||appState.clinicInformation.TODAY;
  appState.datePicker.reportRangeStage='from';
  openModal(`<div class="modal"><div class="modal-header"><div><h3>Select Report Date Range</h3><div class="text-muted">First select Date From, then Date To using the same calendar.</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="report-range-msg"></div>
      <div class="dashboard-range-picker">
        <div class="dashboard-range-summary">
          <div class="dashboard-range-value"><span>From</span><strong id="report-range-from-label">${fmtDate(appState.datePicker.reportRangeDraftFrom)}</strong></div>
          <div class="dashboard-range-arrow">→</div>
          <div class="dashboard-range-value"><span>To</span><strong id="report-range-to-label">${fmtDate(appState.datePicker.reportRangeDraftTo)}</strong></div>
        </div>
        <div class="dashboard-range-step" id="report-range-step">1. Select the From date</div>
        <div id="report-range-calendar"></div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{applyReportDateRange()})}>Apply Date Range</button></div></div>`);
  initModernCalendar('report-range-calendar',appState.datePicker.reportRangeDraftFrom,'','chooseReportRangeDate',{rangeMode:true,rangeStart:appState.datePicker.reportRangeDraftFrom,rangeEnd:appState.datePicker.reportRangeDraftTo});
}
export function chooseReportRangeDate(date){
  if(appState.datePicker.reportRangeStage==='from'||appState.datePicker.reportRangeStage==='done'){
    appState.datePicker.reportRangeDraftFrom=date;
    appState.datePicker.reportRangeDraftTo='';
    appState.datePicker.reportRangeStage='to';
  }else{
    if(date<appState.datePicker.reportRangeDraftFrom){
      appState.datePicker.reportRangeDraftTo=appState.datePicker.reportRangeDraftFrom;
      appState.datePicker.reportRangeDraftFrom=date;
    }else appState.datePicker.reportRangeDraftTo=date;
    appState.datePicker.reportRangeStage='done';
  }
  const st=appState.calendar.modernCalendarState['report-range-calendar'];
  if(st){
    st.rangeStart=appState.datePicker.reportRangeDraftFrom;
    st.rangeEnd=appState.datePicker.reportRangeDraftTo;
    st.selected=appState.datePicker.reportRangeDraftTo||appState.datePicker.reportRangeDraftFrom;
    st.viewMonth=date.slice(0,7);
    renderModernCalendar('report-range-calendar');
  }
  const f=document.getElementById('report-range-from-label'),t=document.getElementById('report-range-to-label'),step=document.getElementById('report-range-step');
  if(f)f.textContent=appState.datePicker.reportRangeDraftFrom?fmtDate(appState.datePicker.reportRangeDraftFrom):'Not selected';
  if(t)t.textContent=appState.datePicker.reportRangeDraftTo?fmtDate(appState.datePicker.reportRangeDraftTo):'Not selected';
  if(step)step.textContent=appState.datePicker.reportRangeStage==='to'?'2. Now select the To date':'Range selected. Apply it, or select another date to start again.';
}
export function applyReportDateRange(){
  if(!appState.datePicker.reportRangeDraftFrom||!appState.datePicker.reportRangeDraftTo){toast('Please select both From and To dates.','warning');return;}
  const from=document.getElementById('rpt-from'),to=document.getElementById('rpt-to'),label=document.getElementById('rpt-range-label');
  if(from)from.value=appState.datePicker.reportRangeDraftFrom;
  if(to)to.value=appState.datePicker.reportRangeDraftTo;
  if(label)label.textContent=`${fmtDate(appState.datePicker.reportRangeDraftFrom)} – ${fmtDate(appState.datePicker.reportRangeDraftTo)}`;
  closeAllModals();
  refreshHealthIntelligence();
}

export function openApptRangePicker(){
  appState.datePicker.apptFilterFrom=document.getElementById('appt-date-from')?.value||appState.clinicInformation.TODAY;appState.datePicker.apptFilterTo=document.getElementById('appt-date-to')?.value||'';appState.datePicker.apptFilterStage='from';
  openModal(`<div class="modal"><div class="modal-header"><div><h3>Appointment Date Range</h3><div class="text-muted">Select Date From, then Date To.</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div><div class="modal-body"><div class="dashboard-range-summary"><div class="dashboard-range-value"><span>From</span><strong id="af-from">${fmtDate(appState.datePicker.apptFilterFrom)}</strong></div><div class="dashboard-range-arrow">→</div><div class="dashboard-range-value"><span>To</span><strong id="af-to">${appState.datePicker.apptFilterTo?fmtDate(appState.datePicker.apptFilterTo):'Select date'}</strong></div></div><div class="dashboard-range-step" id="af-step">1. Select Date From</div><div id="appt-filter-calendar"></div></div><div class="modal-footer" style="justify-content:space-between"><button class="btn btn-danger" ${bindAction('click',(event,element)=>{clearApptRange(true)})}><i class="bi bi-eraser"></i> Clear Range</button><div style="display:flex;gap:.5rem"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{applyApptRange()})}>Apply</button></div></div></div>`);
  initModernCalendar('appt-filter-calendar',appState.datePicker.apptFilterFrom,'','selectApptFilterDate',{rangeMode:true,rangeStart:appState.datePicker.apptFilterFrom,rangeEnd:appState.datePicker.apptFilterTo});
}
export function selectApptFilterDate(date){
  if(appState.datePicker.apptFilterStage==='from'||appState.datePicker.apptFilterStage==='done'){appState.datePicker.apptFilterFrom=date;appState.datePicker.apptFilterTo='';appState.datePicker.apptFilterStage='to';}else{if(date<appState.datePicker.apptFilterFrom){appState.datePicker.apptFilterTo=appState.datePicker.apptFilterFrom;appState.datePicker.apptFilterFrom=date}else appState.datePicker.apptFilterTo=date;appState.datePicker.apptFilterStage='done'}
  const st=appState.calendar.modernCalendarState['appt-filter-calendar'];if(st){st.rangeStart=appState.datePicker.apptFilterFrom;st.rangeEnd=appState.datePicker.apptFilterTo;st.selected=date;st.viewMonth=date.slice(0,7);renderModernCalendar('appt-filter-calendar')}
  document.getElementById('af-from').textContent=fmtDate(appState.datePicker.apptFilterFrom);document.getElementById('af-to').textContent=appState.datePicker.apptFilterTo?fmtDate(appState.datePicker.apptFilterTo):'Select date';document.getElementById('af-step').textContent=appState.datePicker.apptFilterStage==='to'?'2. Select Date To':'Range ready to apply';
}
export function applyApptRange(){if(!appState.datePicker.apptFilterFrom||!appState.datePicker.apptFilterTo){toast('Select both Date From and Date To.','warning');return}document.getElementById('appt-date-from').value=appState.datePicker.apptFilterFrom;document.getElementById('appt-date-to').value=appState.datePicker.apptFilterTo;document.getElementById('appt-range-label').textContent=`${fmtDate(appState.datePicker.apptFilterFrom)} – ${fmtDate(appState.datePicker.apptFilterTo)}`;closeAllModals();renderApptTable()}
export function clearApptRange(closePicker=false){
 const f=document.getElementById('appt-date-from'),t=document.getElementById('appt-date-to'),label=document.getElementById('appt-range-label');
 if(f)f.value='';if(t)t.value='';if(label)label.textContent='All dates';
 appState.datePicker.apptFilterFrom='';appState.datePicker.apptFilterTo='';appState.datePicker.apptFilterStage='from';
 if(closePicker)closeAllModals();
 renderApptTable();
}

export function filterBookPatients(q=''){
 const box=document.getElementById('b-pt-results');if(!box)return;
 const s=(q||'').trim().toLowerCase();
 // Keep the suggestion panel hidden until the staff/admin actually types.
 if(!s){box.innerHTML='';box.classList.remove('show');return;}
 const pts=appState.data.DB.patients.filter(p=>!p.archived&&`${p.fname} ${p.lname} ${p.idNo||''} ${p.college||''}`.toLowerCase().includes(s)).slice(0,15);
 box.innerHTML=pts.length?pts.map(p=>`<button type="button" class="patient-combobox-option" ${bindAction('click',(event,element)=>{selectBookPatient((p.id))})}><strong>${escapeHtml(p.fname+' '+p.lname)}</strong><span class="text-muted" style="display:block">${escapeHtml(p.idNo||'No ID')} · ${escapeHtml(p.college||'')}</span></button>`).join(''):'<div class="text-muted" style="padding:.65rem">No matching patient.</div>';
 box.classList.add('show');
}
export function selectBookPatient(id){const p=getPatientById(id);if(!p)return;document.getElementById('b-pt').value=id;document.getElementById('b-pt-search').value=`${p.fname} ${p.lname}`;document.getElementById('b-pt-results').classList.remove('show');checkDentalWarn()}

export function assistedFile(input,kind){
 const f=input.files?.[0];if(!f)return;const r=new FileReader();
 r.onload=e=>{if(kind==='profile'){appState.datePicker.assistedProfile=e.target.result;const im=document.getElementById('pm-profile-preview');if(im){im.src=appState.datePicker.assistedProfile;im.style.display='block'}}else{appState.datePicker.assistedIdCor=e.target.result;const x=document.getElementById('pm-id-preview');if(x)x.textContent='Selected: '+f.name}};
 r.readAsDataURL(f);
}
export function captureAssistedPatientDraft(){
 const ids=['pm-fname','pm-lname','pm-email','pm-username','pm-idno','pm-birth','pm-gender','pm-blood','pm-contact','pm-college','pm-ptype','pm-height','pm-weight','pm-addr','pm-allergy','pm-history','pm-ename','pm-econtact'];
 const d={};ids.forEach(id=>{const el=document.getElementById(id);if(el)d[id]=el.value});return d;
}
export function restoreAssistedPatientDraft(){
 if(!appState.datePicker.assistedPatientDraft)return;
 Object.entries(appState.datePicker.assistedPatientDraft).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.value=value});
 appState.datePicker.assistedPatientDraft=null;
}
export function openAssistedPatientCamera(kind){
 appState.datePicker.assistedPatientDraft=captureAssistedPatientDraft();
 openCamera(kind==='profile'?'assisted-profile':'assisted-id');
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.datePicker.campusDatePickerTarget=null;
  appState.datePicker.reportRangeStage='from';
  appState.datePicker.reportRangeDraftFrom='';
  appState.datePicker.reportRangeDraftTo='';
  appState.datePicker.apptFilterStage='from';
  appState.datePicker.apptFilterFrom='';
  appState.datePicker.apptFilterTo='';
  appState.datePicker.assistedProfile='';
  appState.datePicker.assistedIdCor='';
  appState.datePicker.assistedPatientDraft=null;
}
