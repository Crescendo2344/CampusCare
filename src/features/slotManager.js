// slotManager: open or close a doctor's bookable times for any date, from its own screen.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {closeAllModals,openModal} from './modals.js';
import {getDoctors,getUserById} from './documentScanner.js';
import {docName} from './messaging.js';
import {dayOfWeek,fmtDate,fmtTime} from './inputValidation.js';
import {clinicToday} from './scheduleAndDrafts.js';
import {initModernCalendar} from './calendar.js';
import {appointmentAction,syncRealAppointments} from './appointmentService.js';
import {fetchDoctorAvailability,getSlotOverride,isDefaultLunchSlot} from './bookingForm.js';
import {persistDB} from './persistence.js';
import {toast} from './theme.js';
import {addBookingDays} from '../domain/booking-availability.js';
import {bindAction} from '../dependencies.js';

const EDITABLE_SLOT_KINDS=['available','full','blocked','lunch'];
const st=()=>appState.slotManager;

export function canManageSlots(){return ['Staff','Administrator'].includes(appState.auth.currentUser?.role);}

export function openSlotManager(doctorId=null){
  if(!canManageSlots())return;
  const doctors=getDoctors();
  Object.assign(st(),{doctorId:null,days:[],date:'',draft:null,batch:null,request:(st().request||0)+1});
  openModal(`<div class="modal modal-lg slot-manager-modal" role="dialog" aria-labelledby="sm-title">
    <div class="modal-header"><h3 id="sm-title">Manage time slots</h3><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body sm-layout">
      <div class="sm-picker">
        <div class="form-group"><label for="sm-doc">Doctor</label>
          <select id="sm-doc" ${bindAction('change',(event,element)=>chooseSlotManagerDoctor(Number(element.value)||null))}><option value="">Choose a doctor</option>${doctors.map(d=>`<option value="${d.id}">${escapeHtml(docName(d))}${d.specialty?' · '+escapeHtml(d.specialty):''}</option>`).join('')}</select></div>
        <div id="sm-calendar" class="booking-calendar-wrap"></div>
      </div>
      <div class="sm-day" id="sm-day"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" id="slot-manager-save" disabled ${bindAction('click',()=>saveSlotManager())}>Save changes</button></div>
  </div>`);
  renderDayPanel();
  if(doctorId){document.getElementById('sm-doc').value=String(doctorId);chooseSlotManagerDoctor(doctorId);}
  else renderSmCalendar();
}

function workingDates(){return (st().days||[]).filter(d=>(d.slots||[]).length).map(d=>d.date);}

function renderSmCalendar(){
  const from=clinicToday(),selectable=workingDates(),view=appState.calendar.modernCalendarState['sm-calendar']?.viewMonth;
  initModernCalendar('sm-calendar',st().date,from,'chooseSlotManagerDate',{allowEmptySelection:!st().date,maxDate:addBookingDays(from,365),availableDates:selectable,markedDates:st().batch?[...st().batch]:[],viewMonth:(st().batch&&view)||(st().date||selectable[0]||from).slice(0,7),showAppointmentHints:false,showTodayButton:false});
}

export async function chooseSlotManagerDoctor(doctorId,keepDate=''){
  const doc=doctorId?getUserById(doctorId):null,request=++st().request;
  Object.assign(st(),{doctorId:doc?.id||null,days:[],date:keepDate,draft:null,batch:null});
  renderSmCalendar();renderDayPanel(doc?'loading':'');
  if(!doc)return;
  try{
    const from=clinicToday(),days=await fetchDoctorAvailability(doc,from,addBookingDays(from,365));
    if(request!==st().request||!document.getElementById('sm-day'))return;
    st().days=days;
    renderSmCalendar();
    if(keepDate)chooseSlotManagerDate(keepDate);else renderDayPanel();
  }catch(e){
    if(request!==st().request)return;
    renderDayPanel('error',e?.message||'Availability could not be loaded.');
  }
}

export function chooseSlotManagerDate(date){
  // In batch mode the calendar collects extra dates; the day being edited stays the same.
  if(st().batch&&st().draft){
    if(date!==st().draft.date){if(st().batch.has(date))st().batch.delete(date);else st().batch.add(date);}
    st().date=st().draft.date;renderSmCalendar();renderBatch();renderSlots();return;
  }
  const doc=getUserById(st().doctorId),day=(st().days||[]).find(d=>d.date===date);
  st().date=date;
  if(!doc||!day){st().draft=null;renderDayPanel();return;}
  const reopenedLunch=new Set(getSlotOverride(doc.id,date)?.availableTimes||[]);
  const slots=(day.slots||[]).map(s=>({
    time:s.time,kind:s.kind,label:s.label,custom:Boolean(s.custom),
    editable:EDITABLE_SLOT_KINDS.includes(s.kind),
    lunch:!s.custom&&(s.kind==='lunch'||reopenedLunch.has(s.time)||(s.kind==='blocked'&&isDefaultLunchSlot(s.time,doc))),
    open:s.kind==='available'||s.kind==='full'
  }));
  st().draft={docId:doc.id,date,slots,initial:slots.map(s=>s.open)};
  renderDayPanel();
}

function renderDayPanel(stateName='',message=''){
  const panel=document.getElementById('sm-day');if(!panel)return;
  const draft=st().draft,doc=getUserById(st().doctorId);
  const save=document.getElementById('slot-manager-save');if(save)save.disabled=true;
  if(stateName==='loading'){panel.innerHTML='<div class="sm-empty"><span class="spinner" aria-hidden="true"></span>Loading this doctor\'s days…</div>';return;}
  if(stateName==='error'){panel.innerHTML=`<div class="sm-empty">${escapeHtml(message)}<button type="button" class="btn btn-sm" ${bindAction('click',()=>chooseSlotManagerDoctor(st().doctorId,st().date))}>Retry</button></div>`;return;}
  if(!doc){panel.innerHTML='<div class="sm-empty"><i class="bi bi-person-badge" aria-hidden="true"></i>Choose a doctor to see their working days.</div>';return;}
  if(!draft){panel.innerHTML='<div class="sm-empty"><i class="bi bi-calendar3" aria-hidden="true"></i>Pick a highlighted date on the calendar.</div>';return;}
  panel.innerHTML=`<div class="sm-day-head"><h4>${escapeHtml(dayOfWeek(draft.date))}, ${escapeHtml(fmtDate(draft.date))}</h4><span id="slot-manager-summary" role="status" aria-live="polite"></span></div>
    <div class="slot-manager-tools"><div>
      <button type="button" class="btn btn-xs" ${bindAction('click',()=>setAllSlots(true))}>Open all</button>
      <button type="button" class="btn btn-xs" ${bindAction('click',()=>setAllSlots(false))}>Close all</button>
      <button type="button" class="btn btn-xs" ${bindAction('click',()=>resetSlots())}>Undo changes</button></div>
      <button type="button" class="btn btn-xs" id="sm-batch-toggle" aria-pressed="false" ${bindAction('click',()=>toggleBatch())}><i class="bi bi-calendar2-range" aria-hidden="true"></i> Apply to more dates</button></div>
    <div id="sm-batch"></div>
    <div class="slot-manager-grid" id="slot-manager-grid" role="group" aria-label="Time slots"></div>
    <div class="sm-custom"><label for="sm-custom-time">Add a time</label><input type="time" id="sm-custom-time" step="300" ${bindAction('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addCustomTime();}})}><button type="button" class="btn btn-sm" ${bindAction('click',()=>addCustomTime())}><i class="bi bi-plus-lg" aria-hidden="true"></i> Add</button></div>
    <div class="slot-manager-legend"><span><i class="dot open"></i>Open</span><span><i class="dot custom"></i>Custom time</span><span><i class="dot closed"></i>Closed</span><span><i class="dot lunch"></i>Lunch break</span><span><i class="dot locked"></i>Booked or past</span></div>
    <div class="form-group" style="margin-top:.8rem"><label for="slot-manager-reason">Reason for closed times <span class="text-muted">(optional)</span></label><input id="slot-manager-reason" maxlength="120" placeholder="e.g. Doctor attending a meeting"></div>`;
  renderSlots();
}

function renderSlots(){
  const draft=st().draft,grid=document.getElementById('slot-manager-grid');
  if(!draft||!grid)return;
  grid.innerHTML=draft.slots.map((s,i)=>{
    const state=!s.editable?'locked':s.custom?(s.open?'open custom':'closed'):s.open?'open':s.lunch?'lunch':'closed';
    const caption=!s.editable?(s.custom&&s.kind==='booked'?'Booked (custom)':s.label):s.custom?(s.open?'Custom time':'Removed'):s.open?(s.lunch?'Open (lunch)':'Open'):s.lunch?'Lunch break':'Closed';
    const changed=s.editable&&s.open!==draft.initial[i];
    return `<button type="button" class="slot-toggle ${state} ${changed?'changed':''}" role="switch" aria-checked="${s.open}" ${s.editable?'':'disabled'} ${bindAction('click',()=>toggleSlot(i))}><strong>${fmtTime(s.time)}</strong><small>${escapeHtml(caption)}</small></button>`;
  }).join('');
  const open=draft.slots.filter(s=>s.editable&&s.open).length,closed=draft.slots.filter(s=>s.editable&&!s.open).length,locked=draft.slots.filter(s=>!s.editable).length;
  const changes=draft.slots.filter((s,i)=>s.editable&&s.open!==draft.initial[i]).length,extra=st().batch?.size||0;
  const summary=document.getElementById('slot-manager-summary');
  if(summary)summary.textContent=`${open} open · ${closed} closed · ${locked} booked or past${changes?` · ${changes} unsaved change${changes===1?'':'s'}`:''}`;
  const save=document.getElementById('slot-manager-save');
  if(save){save.disabled=!changes&&!extra;save.textContent=extra?`Save to ${extra+1} dates`:'Save changes';}
}

// One-off times outside the doctor's regular grid, e.g. 7:30 AM before clinic opens.
export function addCustomTime(){
  const draft=st().draft,input=document.getElementById('sm-custom-time');
  if(!draft||!input)return;
  const time=String(input.value||'').slice(0,5);
  if(!/^\d{2}:\d{2}$/.test(time)){toast('Choose a time to add.','warning');input.focus();return;}
  if(draft.slots.some(s=>s.time===time)){toast(`${fmtTime(time)} is already on this day.`,'warning');return;}
  if(draft.date===clinicToday()){
    const now=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
    if(time<=now){toast('That time has already passed today.','warning');return;}
  }
  draft.slots.push({time,kind:'available',label:'Custom time',custom:true,editable:true,lunch:false,open:true});
  draft.initial.push(false);
  // Keep times in order, carrying each slot's original state with it.
  const order=draft.slots.map((slot,i)=>({slot,initial:draft.initial[i]})).sort((a,b)=>a.slot.time.localeCompare(b.slot.time));
  draft.slots=order.map(x=>x.slot);draft.initial=order.map(x=>x.initial);
  input.value='';renderSlots();
}

function toggleBatch(){
  if(!st().draft)return;
  st().batch=st().batch?null:new Set();
  renderSmCalendar();renderBatch();renderSlots();
}

function addSameWeekdays(){
  const draft=st().draft;if(!draft||!st().batch)return;
  const weekday=new Date(draft.date+'T12:00:00Z').getUTCDay();
  const next=workingDates().filter(d=>d>draft.date&&new Date(d+'T12:00:00Z').getUTCDay()===weekday).slice(0,4);
  next.forEach(d=>st().batch.add(d));
  if(!next.length)toast('No more working days on that weekday.','info');
  renderSmCalendar();renderBatch();renderSlots();
}

function renderBatch(){
  const host=document.getElementById('sm-batch'),toggle=document.getElementById('sm-batch-toggle');
  if(toggle){toggle.setAttribute('aria-pressed',String(Boolean(st().batch)));toggle.classList.toggle('active',Boolean(st().batch));}
  if(!host)return;
  if(!st().batch){host.innerHTML='';return;}
  const dates=[...st().batch].sort();
  host.innerHTML=`<div class="sm-batch">
    <div class="sm-batch-head"><strong>Also apply to</strong><button type="button" class="btn btn-xs" ${bindAction('click',()=>addSameWeekdays())}>+ Next 4 ${escapeHtml(dayOfWeek(st().draft.date))}s</button></div>
    ${dates.length?`<div class="sm-batch-chips">${dates.map(d=>`<span class="sm-chip">${escapeHtml(fmtDate(d))}<button type="button" aria-label="Remove ${escapeHtml(fmtDate(d))}" ${bindAction('click',()=>{st().batch.delete(d);renderSmCalendar();renderBatch();renderSlots();})}>×</button></span>`).join('')}</div>`:'<p class="sm-batch-empty">Pick dates on the calendar.</p>'}
  </div>`;
}
export function toggleSlot(index){
  const slot=st().draft?.slots[index];
  if(!slot?.editable)return;
  slot.open=!slot.open;renderSlots();
}
function setAllSlots(open){
  for(const slot of st().draft?.slots||[])if(slot.editable)slot.open=open;
  renderSlots();
}
function resetSlots(){
  const draft=st().draft;if(!draft)return;
  draft.slots.forEach((slot,i)=>{slot.open=draft.initial[i];});
  renderSlots();
}

export async function saveSlotManager(){
  const draft=st().draft;if(!draft)return;
  const doc=getUserById(draft.docId);if(!doc)return;
  const reason=(document.getElementById('slot-manager-reason')?.value||'').trim().slice(0,120);
  // Only differences from the normal schedule are stored: closed regular times, reopened lunch times
  // and custom times (kept even once booked, so the booking stays on a valid time).
  const deviations=[];
  for(const slot of draft.slots){
    if(slot.custom){if(slot.open||!slot.editable)deviations.push({time:slot.time,is_available:true,reason:'Custom time'});continue;}
    if(!slot.editable)continue;
    if(!slot.open&&!slot.lunch)deviations.push({time:slot.time,is_available:false,reason:reason||'Manually unavailable'});
    else if(slot.open&&slot.lunch)deviations.push({time:slot.time,is_available:true,reason:'Lunch slot reopened'});
  }
  const dates=[draft.date,...[...(st().batch||[])].sort()];
  const button=document.getElementById('slot-manager-save');
  if(button){button.disabled=true;button.textContent='Saving…';}
  const saved=[];
  try{
    for(const date of dates){
      // Other dates take the same pattern; booked custom times there are kept as they are.
      const keep=date===draft.date?[]:((st().days||[]).find(d=>d.date===date)?.slots||[]).filter(sl=>sl.custom&&sl.kind==='booked'&&!deviations.some(x=>x.time===sl.time)).map(sl=>({time:sl.time,is_available:true,reason:'Custom time'}));
      const rows=[...deviations,...keep];
      if(appState.auth.currentUser?._realSupabase){
        if(!doc.dbUserId)throw new Error('This doctor record could not be matched. Refresh the page and try again.');
        await appointmentAction({action:'manage_slots',doctor_id:doc.dbUserId,date,slots:rows});
      }else{
        appState.data.DB.settings.slotOverrides=(Array.isArray(appState.data.DB.settings.slotOverrides)?appState.data.DB.settings.slotOverrides:[]).filter(o=>!(o.doctorId===draft.docId&&o.date===date));
        appState.data.DB.settings.slotOverrides.push({doctorId:draft.docId,date,blockedTimes:rows.filter(x=>!x.is_available).map(x=>x.time),availableTimes:rows.filter(x=>x.is_available).map(x=>x.time)});
        persistDB();
      }
      saved.push(date);
    }
    if(appState.auth.currentUser?._realSupabase)await syncRealAppointments();
    toast(saved.length>1?`Time slots updated on ${saved.length} dates.`:`Time slots for ${fmtDate(draft.date)} updated.`,'success');
    // Stay on the same doctor and day so several days can be adjusted in a row.
    await chooseSlotManagerDoctor(draft.docId,draft.date);
  }catch(e){
    // Say exactly which dates were saved before the failure, so nothing is applied twice by guesswork.
    toast(saved.length?`Saved ${saved.length} of ${dates.length} dates; stopped at ${fmtDate(dates[saved.length])}: ${e?.message||'update failed'}`:(e?.message||'Unable to update time slots.'),'error');
  }finally{
    if(button&&document.body.contains(button)){button.textContent='Save changes';renderSlots();}
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
