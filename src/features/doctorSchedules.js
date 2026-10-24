// doctorSchedules: the administrator's weekly coverage board and the per-day schedule editor.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {closeAllModals,openModal} from './modals.js';
import {getDoctors,getUserById} from './documentScanner.js';
import {docName} from './messaging.js';
import {fmtDate} from './inputValidation.js';
import {clinicToday} from './scheduleAndDrafts.js';
import {campusDateFieldHtml} from './datePicker.js';
import {syncRealWorkflowRequests,workflowAction} from './workflowRequests.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {removeDoctorLeave} from './doctorSchedule.js';
import {renderUsers,userAvatarHtml} from './userManagement.js';
import {persistDB} from './persistence.js';
import {toast} from './theme.js';
import {bindAction} from '../dependencies.js';
import {WEEK_DAYS,WEEK_DAY_NAMES,assessWeekly,dayLimit,sameWeekly,shiftLabel,shortTime,weekDates,weeklyFromServer,weeklyFromSummary} from '../domain/doctor-coverage.js';

const SLOT_CHOICES=[15,20,30,45,60,90,120];
function ui(){
  const s=appState.userManagement;
  s.weekly??={};s.scheduleSearch??='';s.scheduleSpecialty??='';
  return s;
}
function boardDoctors(){
  return appState.auth.currentUser?.role==='Administrator'?getDoctors().filter(d=>d._realSupabase):getDoctors();
}
function weeklyOf(doc){return ui().weekly[doc.id]?.days||weeklyFromSummary(doc);}
function leavesOn(doc,date){return (appState.data.DB.doctorLeaves||[]).find(l=>l.doctorId===doc.id&&l.date===date);}
function activeChange(doc){
  return (appState.data.DB.scheduleChangeRequests||[]).find(r=>r.doctorId===doc.id&&['Pending','Approved-Pending'].includes(r.status));
}

// Per-day hours come from the effective schedule rules; the profile only stores a summary.
async function loadWeekly(doc,{force=false}={}){
  const cache=ui().weekly[doc.id];
  if(!force&&cache&&Date.now()-cache.at<60000)return cache;
  if(!doc._realSupabase){
    return ui().weekly[doc.id]={days:weeklyFromSummary(doc),activeRequest:null,at:Date.now()};
  }
  const r=await workflowAction({action:'schedule_context',doctor_id:doc.dbUserId});
  return ui().weekly[doc.id]={days:weeklyFromServer(r.current_weekly,doc),activeRequest:r.active_request||null,at:Date.now()};
}

export function doctorSchedulesHtml(){
  const today=appState.clinicInformation.TODAY,dates=weekDates(today),todayDay=WEEK_DAYS[dates.indexOf(today)];
  const doctors=boardDoctors();
  const onLeaveToday=doctors.filter(d=>leavesOn(d,today));
  const onDuty=doctors.filter(d=>!leavesOn(d,today)&&weeklyOf(d).find(x=>x.day===todayDay)?.isWorking);
  const pending=(appState.data.DB.scheduleChangeRequests||[]).filter(r=>r.status==='Pending').length;
  const horizon=new Date(today+'T12:00:00Z');horizon.setUTCDate(horizon.getUTCDate()+30);
  const leaveSoon=(appState.data.DB.doctorLeaves||[]).filter(l=>l.date>=today&&l.date<=horizon.toISOString().slice(0,10)).length;
  const specialties=[...new Set(doctors.map(d=>d.specialty||'General'))].sort();
  const s=ui();
  return `<div class="dsb-stats">
      <div class="dsb-stat"><span>On duty today</span><strong>${onDuty.length}<small>/ ${doctors.length}</small></strong><em>${escapeHtml(fmtDate(today))}</em></div>
      <div class="dsb-stat ${onLeaveToday.length?'warn':''}"><span>On leave today</span><strong>${onLeaveToday.length}</strong><em>${onLeaveToday.length?onLeaveToday.map(d=>escapeHtml(docName(d))).join(', '):'Everyone is in'}</em></div>
      <button type="button" class="dsb-stat ${pending?'attention':''}" ${bindAction('click',()=>{ui().tab='requests';renderUsers();})}><span>Schedule requests</span><strong>${pending}</strong><em>${pending?'Waiting for review →':'None waiting'}</em></button>
      <div class="dsb-stat"><span>Leave in next 30 days</span><strong>${leaveSoon}</strong><em>Approved days off</em></div>
    </div>
    <div class="card">
      <div class="card-header dsb-head"><div><h3>Weekly coverage</h3><p class="form-note">Week of ${escapeHtml(fmtDate(dates[0]))} · click a doctor to edit their hours</p></div>
        <div class="dsb-tools"><input type="search" id="dsb-search" placeholder="Search doctor" aria-label="Search doctor" value="${escapeHtml(s.scheduleSearch)}" ${bindAction('input',(event,element)=>{ui().scheduleSearch=element.value;renderDoctorScheduleRows();})}>
        <select id="dsb-specialty" aria-label="Specialty" ${bindAction('change',(event,element)=>{ui().scheduleSpecialty=element.value;renderDoctorScheduleRows();})}><option value="">All specialties</option>${specialties.map(x=>`<option ${x===s.scheduleSpecialty?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select></div></div>
      <div class="table-wrap"><table class="dsb-table"><thead><tr><th>Doctor</th>${WEEK_DAYS.map((day,i)=>`<th class="${dates[i]===today?'dsb-today':''}">${day}<small>${Number(dates[i].slice(8))}</small></th>`).join('')}<th>Bookings</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody id="dsb-rows"></tbody></table></div>
      <div class="dsb-legend"><span><i class="dsb-dot work"></i>Working hours</span><span><i class="dsb-dot leave"></i>Approved leave</span><span><i class="dsb-dot off"></i>Not scheduled</span><span><i class="dsb-dot today"></i>Today</span></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Upcoming doctor leave</h3></div>
      <div id="dsb-leave">${upcomingLeaveHtml(today)}</div>
    </div>`;
}

function upcomingLeaveHtml(today){
  const all=(appState.data.DB.doctorLeaves||[]).filter(l=>l.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
  if(!all.length)return '<p class="text-muted">No approved upcoming days off. Doctors request them from My Schedule.</p>';
  const days=date=>Math.round((new Date(date+'T12:00:00Z')-new Date(today+'T12:00:00Z'))/86400000);
  return `<ul class="dsb-leave-list">${all.map(l=>{const d=getUserById(l.doctorId),n=days(l.date),dt=new Date(l.date+'T12:00:00Z');
    return `<li><div class="dsb-date" aria-hidden="true"><span>${dt.toLocaleDateString('en',{month:'short',timeZone:'UTC'})}</span><strong>${dt.getUTCDate()}</strong></div>
      <div class="dsb-leave-main"><strong>${d?escapeHtml(docName(d)):'Unknown doctor'}</strong><span>${escapeHtml(fmtDate(l.date))} · ${n===0?'Today':n===1?'Tomorrow':`In ${n} days`}${l.reason?' · '+escapeHtml(l.reason):''}</span></div>
      <button class="btn btn-xs btn-danger" ${bindAction('click',()=>removeDoctorLeave(l.id))}>Cancel leave</button></li>`;}).join('')}</ul>`;
}

export function renderDoctorScheduleRows(){
  const body=document.getElementById('dsb-rows');if(!body)return;
  const s=ui(),q=s.scheduleSearch.trim().toLowerCase(),today=appState.clinicInformation.TODAY,dates=weekDates(today);
  const doctors=boardDoctors().filter(d=>(!q||docName(d).toLowerCase().includes(q))&&(!s.scheduleSpecialty||(d.specialty||'General')===s.scheduleSpecialty));
  if(!doctors.length){body.innerHTML=`<tr><td colspan="10"><p class="text-muted" style="margin:.5rem 0">No doctors match these filters.</p></td></tr>`;return;}
  body.innerHTML=doctors.map(d=>{
    const week=weeklyOf(d),stats=assessWeekly(week,d.slotDuration||60,d.maxPatients||20),change=activeChange(d);
    const cells=week.map((x,i)=>{
      const leave=leavesOn(d,dates[i]),isToday=dates[i]===today;
      const content=leave?`<span class="dsb-cell leave" title="${escapeHtml(leave.reason||'Approved leave')}">On leave</span>`
        :x.isWorking?`<span class="dsb-cell work">${escapeHtml(shiftLabel(x))}</span>`:'<span class="dsb-cell off">Off</span>';
      return `<td class="dsb-daycell ${isToday?'dsb-today':''}" data-label="${x.day}">${content}</td>`;
    }).join('');
    return `<tr class="dsb-row" tabindex="0" ${bindAction('click',()=>openDoctorScheduleEditor(d.id))} ${bindAction('keydown',event=>{if(event.key==='Enter'){event.preventDefault();openDoctorScheduleEditor(d.id);}})}>
      <td><div class="dsb-doc">${userAvatarHtml(d,32)}<div><strong>${escapeHtml(docName(d))}</strong><span>${escapeHtml(d.specialty||'General')}</span>${change?`<span class="badge ${change.status==='Pending'?'badge-warning':'badge-info'}">${change.status==='Pending'?'Change requested':'Changes '+escapeHtml(fmtDate(change.effectiveDate))}</span>`:''}</div></div></td>
      ${cells}
      <td class="dsb-cap" data-label="Bookings"><strong>${d.slotDuration||60} min</strong><span>${Math.min(d.maxPatients||20,stats.maxSlots||d.maxPatients||20)}/day · ${stats.weeklyHours} h/wk</span></td>
      <td><button class="btn btn-xs btn-info" ${bindAction('click',event=>{event.stopPropagation();openDoctorScheduleEditor(d.id);})}>Edit</button></td>
    </tr>`;
  }).join('');
}

// Fill per-day hours for every doctor in the background, then redraw the board once.
export function needsDoctorScheduleHydration(){
  return boardDoctors().some(d=>{const c=ui().weekly[d.id];return !c||Date.now()-c.at>60000;});
}
export async function hydrateDoctorSchedules(){
  const doctors=boardDoctors();
  const results=await Promise.allSettled(doctors.map(d=>loadWeekly(d)));
  // A failed load keeps the summary for a minute instead of retrying on every redraw.
  results.forEach((r,i)=>{if(r.status==='rejected'){console.error('Doctor schedule load:',r.reason);ui().weekly[doctors[i].id]={days:weeklyFromSummary(doctors[i]),activeRequest:null,at:Date.now()};}});
  if(appState.navigationRaceProtection.campusActivePageId==='users'&&ui().tab==='schedules'&&document.getElementById('dsb-rows')){
    const search=document.activeElement?.id==='dsb-search';
    renderUsers();
    if(search)document.getElementById('dsb-search')?.focus();
  }
}

// ---------------------------------------------------------------- editor
function draft(){return ui().scheduleDraft;}

export async function openDoctorScheduleEditor(docId){
  const doc=getUserById(docId);if(!doc)return;
  if(appState.auth.currentUser?.role!=='Administrator'){toast('Administrator access required.','warning');return;}
  let context;
  try{context=await loadWeekly(doc,{force:true});}
  catch(e){toast((e?.message||'Unable to load the current schedule.')+' Showing the saved summary instead.','warning');context={days:weeklyFromSummary(doc),activeRequest:null};}
  const slot=SLOT_CHOICES.includes(Number(doc.slotDuration))?Number(doc.slotDuration):60;
  const original=context.days.map(x=>({...x}));
  let max=Number(doc.maxPatients)||20;
  const fit=assessWeekly(original,slot,max);
  const capped=fit.maxSlots>0&&max>fit.maxSlots;
  if(capped)max=fit.maxSlots;
  ui().scheduleDraft={docId,original,originalSlot:Number(doc.slotDuration)||60,originalMax:Number(doc.maxPatients)||20,days:original.map(x=>({...x})),slot,max,scope:'Permanent',stage:'edit'};
  const blocked=context.activeRequest;
  openModal(`<div class="modal dse-modal" role="dialog" aria-labelledby="dse-title">
    <div class="modal-header"><div class="dse-headline">${userAvatarHtml(doc,40)}<div><h3 id="dse-title">Edit work schedule</h3><p class="form-note">${escapeHtml(docName(doc))} · ${escapeHtml(doc.specialty||'General')}</p></div></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body" ${bindAction('input',()=>refreshEditor())} ${bindAction('change',()=>refreshEditor())}>
      <div id="dse-msg"></div>
      ${blocked?`<div class="alert alert-warning show">${escapeHtml(docName(doc))} has a schedule change request ${blocked.status==='Pending'?'waiting for review':'approved for '+escapeHtml(fmtDate(blocked.effective_date))}. Resolve it in <button type="button" class="link-btn" ${bindAction('click',()=>{closeAllModals();ui().tab='requests';renderUsers();})}>Requests</button> before changing the schedule here.</div>`:''}
      ${capped?`<div class="alert alert-info show">The daily patient limit was lowered from ${Number(doc.maxPatients)} to ${max} to fit the available appointment slots.</div>`:''}
      <section class="dse-section"><div class="dse-section-head"><h4>Weekly hours</h4><div class="dse-presets">
        <button type="button" class="btn btn-xs" ${bindAction('click',()=>applyPreset('weekdays'))}>Mon–Fri, 8 AM – 5 PM</button>
        <button type="button" class="btn btn-xs" ${bindAction('click',()=>applyPreset('copy'))}>Copy first day to all</button>
        <button type="button" class="btn btn-xs" ${bindAction('click',()=>applyPreset('reset'))}>Undo changes</button></div></div>
        <div class="dse-days">${WEEK_DAYS.map(day=>`<div class="dse-day" data-day="${day}">
          <label class="dse-switch"><input type="checkbox" class="dse-on" data-day="${day}"><span class="dse-toggle" aria-hidden="true"></span><span class="dse-dayname">${WEEK_DAY_NAMES[day]}</span></label>
          <div class="dse-hours"><input type="time" class="dse-start" data-day="${day}" aria-label="${WEEK_DAY_NAMES[day]} start"><span>to</span><input type="time" class="dse-end" data-day="${day}" aria-label="${WEEK_DAY_NAMES[day]} end"></div>
          <span class="dse-off-label">Not working</span><small class="dse-slots" data-day="${day}"></small></div>`).join('')}</div>
      </section>
      <section class="dse-section"><h4>Appointments</h4><div class="form-row">
        <div class="form-group"><label for="dse-slot">Appointment length</label><select id="dse-slot">${SLOT_CHOICES.map(n=>`<option value="${n}" ${n===slot?'selected':''}>${n} minutes</option>`).join('')}</select></div>
        <div class="form-group"><label for="dse-max">Daily patient limit</label><input type="number" id="dse-max" min="1" max="100" value="${max}"><p class="form-note" id="dse-max-hint"></p></div>
      </div></section>
      <section class="dse-section"><h4>When it applies</h4>
        <div class="dse-scope" role="radiogroup" aria-label="Schedule type">
          <label><input type="radio" name="dse-scope" value="Permanent" checked><span><strong>From a date onward</strong><small>Replaces the regular weekly schedule</small></span></label>
          <label><input type="radio" name="dse-scope" value="Temporary"><span><strong>For a date range</strong><small>e.g. exam week or a training period</small></span></label>
        </div>
        <div class="form-row"><div class="form-group"><label>Starts on</label>${campusDateFieldHtml('dse-effective',clinicToday(),'Schedule starts on',clinicToday())}</div>
          <div class="form-group" id="dse-end-wrap" hidden><label>Ends on</label>${campusDateFieldHtml('dse-effective-end','','Schedule ends on',clinicToday())}</div></div>
        <div class="form-group"><label for="dse-reason">Reason <span class="required">*</span></label><textarea id="dse-reason" rows="2" maxlength="2000" placeholder="Shown to the doctor and kept in the activity log"></textarea></div>
      </section>
      <div class="dse-summary" id="dse-summary" aria-live="polite"></div>
      <div id="dse-conflicts"></div>
    </div>
    <div class="modal-footer dse-footer" id="dse-footer"><button type="button" class="btn btn-primary" disabled>Review &amp; save</button></div>
  </div>`);
  writeDaysToDom();refreshEditor();
  if(blocked)document.querySelectorAll('.dse-modal .modal-body input,.dse-modal .modal-body select,.dse-modal .modal-body textarea').forEach(el=>el.disabled=true);
}

function writeDaysToDom(){
  for(const d of draft().days){
    const on=document.querySelector(`.dse-on[data-day="${d.day}"]`);if(!on)continue;
    on.checked=d.isWorking;
    document.querySelector(`.dse-start[data-day="${d.day}"]`).value=d.startTime;
    document.querySelector(`.dse-end[data-day="${d.day}"]`).value=d.endTime;
  }
}

function readDom(){
  const d=draft();
  d.days=WEEK_DAYS.map(day=>({day,isWorking:document.querySelector(`.dse-on[data-day="${day}"]`).checked,
    startTime:document.querySelector(`.dse-start[data-day="${day}"]`).value||'08:00',endTime:document.querySelector(`.dse-end[data-day="${day}"]`).value||'17:00'}));
  d.slot=Number(document.getElementById('dse-slot').value);
  d.max=Number(document.getElementById('dse-max').value);
  d.scope=document.querySelector('input[name="dse-scope"]:checked')?.value||'Permanent';
  d.effective=document.getElementById('dse-effective').value;
  d.effectiveEnd=document.getElementById('dse-effective-end').value;
  d.reason=document.getElementById('dse-reason').value.trim();
}

function applyPreset(kind){
  const d=draft();
  if(kind==='weekdays')d.days=WEEK_DAYS.map(day=>({day,isWorking:!['Sat','Sun'].includes(day),startTime:'08:00',endTime:'17:00'}));
  if(kind==='copy'){const first=d.days.find(x=>x.isWorking);if(!first){toast('Turn on at least one day first.','warning');return;}d.days=d.days.map(x=>x.isWorking?{...x,startTime:first.startTime,endTime:first.endTime}:x);}
  if(kind==='reset')d.days=d.original.map(x=>({...x}));
  writeDaysToDom();
  if(d.stage!=='edit')d.stage='edit';
  refreshEditor(false);
}

function editorProblems(d,stats){
  const problems=[...stats.errors];
  if(!d.effective)problems.push('Choose when the schedule starts.');
  if(d.scope==='Temporary'&&(!d.effectiveEnd||d.effectiveEnd<d.effective))problems.push('Choose an end date on or after the start date.');
  if(d.reason.length<5)problems.push('Add a short reason (at least 5 characters).');
  return problems;
}

function refreshEditor(fromDom=true){
  const d=draft();if(!d||!document.querySelector('.dse-modal'))return;
  if(fromDom)readDom();
  if(d.stage==='confirm')d.stage='edit';
  document.getElementById('dse-conflicts').innerHTML='';
  document.getElementById('dse-end-wrap').hidden=d.scope!=='Temporary';
  const stats=assessWeekly(d.days,d.slot,d.max);
  for(const x of d.days){
    const row=document.querySelector(`.dse-day[data-day="${x.day}"]`);
    row.classList.toggle('off',!x.isWorking);
    const n=stats.perDay[x.day]??0;
    row.querySelector('.dse-slots').textContent=x.isWorking?`${n} slots${n>0&&n<d.max?` · ${n} patients max`:''}`:'';
  }
  document.getElementById('dse-max-hint').textContent=stats.cappedDays.length?`Shorter days take fewer: ${stats.cappedDays.map(day=>`${day} ${stats.perDay[day]}`).join(', ')}`:stats.maxSlots?`Up to ${stats.maxSlots} fit in the longest day`:'';
  const unchanged=sameWeekly(d.days,d.original)&&d.slot===d.originalSlot&&d.max===d.originalMax;
  const problems=editorProblems(d,stats);
  document.getElementById('dse-summary').innerHTML=`<div class="dse-totals"><span><strong>${stats.workingDays}</strong> work days</span><span><strong>${stats.weeklyHours}</strong> hours a week</span><span>up to <strong>${stats.weeklyCapacity}</strong> appointments a week</span></div>
    ${unchanged?'<p class="form-note">No changes yet.</p>':problems.length?`<ul class="dse-problems">${problems.map(p=>`<li>${escapeHtml(p)}</li>`).join('')}</ul>`:''}`;
  renderFooter(unchanged||problems.length>0);
}

function renderFooter(disabled){
  const d=draft(),footer=document.getElementById('dse-footer');if(!footer)return;
  const blocked=document.querySelector('.dse-modal .alert-warning');
  footer.innerHTML=d.stage==='confirm'
    ?`<p class="dse-confirm">Apply this schedule ${d.scope==='Temporary'?`from ${escapeHtml(fmtDate(d.effective))} to ${escapeHtml(fmtDate(d.effectiveEnd))}`:`from ${escapeHtml(fmtDate(d.effective))} onward`}? New bookings will follow it and the doctor is notified.</p>
      <div class="dse-footer-actions"><button type="button" class="btn" ${bindAction('click',()=>{d.stage='edit';refreshEditor(false);})}>Back</button><button type="button" class="btn btn-primary" id="dse-apply" ${bindAction('click',()=>applySchedule())}>Apply schedule</button></div>`
    :`<button type="button" class="btn btn-primary" id="dse-save" ${disabled||blocked?'disabled':''} ${bindAction('click',()=>checkSchedule())}>Review &amp; save</button>`;
}

function payload(d,doc){
  return {doctor_id:doc.dbUserId,effective_date:d.effective,schedule_scope:d.scope,effective_end:d.scope==='Temporary'?d.effectiveEnd:'',
    slot_duration:d.slot,max_patients:d.max,
    weekly_schedule:d.days.map(x=>({day:x.day,is_working:x.isWorking,start_time:x.startTime,end_time:x.endTime,slot_duration:d.slot,max_patients:x.isWorking?dayLimit(x,d.slot,d.max):d.max}))};
}

// Check bookings first, so the admin sees what would break before anything is saved.
async function checkSchedule(){
  const d=draft(),doc=getUserById(d.docId),msg=document.getElementById('dse-msg'),button=document.getElementById('dse-save');
  msg.innerHTML='';
  if(button){button.disabled=true;button.textContent='Checking bookings…';}
  try{
    if(doc._realSupabase){
      const r=await workflowAction({action:'preview_schedule',...payload(d,doc)});
      if(r.conflicts?.length){
        document.getElementById('dse-conflicts').innerHTML=`<div class="alert alert-warning show"><strong>${r.conflicts.length} booked appointment${r.conflicts.length===1?'':'s'} would conflict.</strong> Reschedule ${r.conflicts.length===1?'it':'them'} first, or choose a later start date.<ul>${r.conflicts.slice(0,8).map(c=>`<li>${escapeHtml(fmtDate(c.date))}${c.time?' · '+escapeHtml(shortTime(c.time)):''} — ${escapeHtml(c.reason)}</li>`).join('')}</ul></div>`;
        renderFooter(true);return;
      }
    }
    d.stage='confirm';renderFooter(false);
  }catch(e){
    msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to check this schedule.')}</div>`;renderFooter(false);
  }
}

async function applySchedule(){
  const d=draft(),doc=getUserById(d.docId),button=document.getElementById('dse-apply');
  if(button){button.disabled=true;button.textContent='Saving…';}
  try{
    if(doc._realSupabase){
      await workflowAction({action:'admin_schedule_update',reason:d.reason,...payload(d,doc)});
      delete ui().weekly[doc.id];
      await Promise.all([syncAdminDirectoryFromSupabase(),syncRealWorkflowRequests()]);
    }else{
      const working=d.days.filter(x=>x.isWorking);
      Object.assign(doc,{workDays:working.map(x=>x.day),startTime:working.map(x=>x.startTime).sort()[0],endTime:working.map(x=>x.endTime).sort().at(-1),slotDuration:d.slot,maxPatients:d.max});
      ui().weekly[doc.id]={days:d.days.map(x=>({...x})),activeRequest:null,at:Date.now()};
      persistDB();
    }
    closeAllModals();
    toast(d.effective<=clinicToday()&&d.scope==='Permanent'?'Schedule updated.':`Schedule saved — takes effect ${fmtDate(d.effective)}.`,'success');
    if(appState.navigationRaceProtection.campusActivePageId==='users')await renderUsers();
  }catch(e){
    d.stage='edit';
    document.getElementById('dse-msg').innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to save the schedule.')}</div>`;
    refreshEditor(false);
  }
}
