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
  Object.assign(st(),{doctorId:null,days:[],date:'',draft:null,request:(st().request||0)+1});
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

function renderSmCalendar(){
  const from=clinicToday(),days=st().days||[];
  const selectable=days.filter(d=>(d.slots||[]).length).map(d=>d.date);
  initModernCalendar('sm-calendar',st().date,from,'chooseSlotManagerDate',{allowEmptySelection:!st().date,maxDate:addBookingDays(from,365),availableDates:selectable,viewMonth:(st().date||selectable[0]||from).slice(0,7),showAppointmentHints:false,showTodayButton:false});
}

export async function chooseSlotManagerDoctor(doctorId,keepDate=''){
  const doc=doctorId?getUserById(doctorId):null,request=++st().request;
  Object.assign(st(),{doctorId:doc?.id||null,days:[],date:keepDate,draft:null});
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
  const doc=getUserById(st().doctorId),day=(st().days||[]).find(d=>d.date===date);
  st().date=date;
  if(!doc||!day){st().draft=null;renderDayPanel();return;}
  const reopenedLunch=new Set(getSlotOverride(doc.id,date)?.availableTimes||[]);
  const slots=(day.slots||[]).map(s=>({
    time:s.time,kind:s.kind,label:s.label,
    editable:EDITABLE_SLOT_KINDS.includes(s.kind),
    lunch:s.kind==='lunch'||reopenedLunch.has(s.time)||(s.kind==='blocked'&&isDefaultLunchSlot(s.time,doc)),
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
      <button type="button" class="btn btn-xs" ${bindAction('click',()=>resetSlots())}>Undo changes</button></div></div>
    <div class="slot-manager-grid" id="slot-manager-grid" role="group" aria-label="Time slots"></div>
    <div class="slot-manager-legend"><span><i class="dot open"></i>Open</span><span><i class="dot closed"></i>Closed</span><span><i class="dot lunch"></i>Lunch break</span><span><i class="dot locked"></i>Booked or past</span></div>
    <div class="form-group" style="margin-top:.8rem"><label for="slot-manager-reason">Reason for closed times <span class="text-muted">(optional)</span></label><input id="slot-manager-reason" maxlength="120" placeholder="e.g. Doctor attending a meeting"></div>`;
  renderSlots();
}

function renderSlots(){
  const draft=st().draft,grid=document.getElementById('slot-manager-grid');
  if(!draft||!grid)return;
  grid.innerHTML=draft.slots.map((s,i)=>{
    const state=!s.editable?'locked':s.open?'open':s.lunch?'lunch':'closed';
    const caption=!s.editable?s.label:s.open?(s.lunch?'Open (lunch)':'Open'):s.lunch?'Lunch break':'Closed';
    const changed=s.editable&&s.open!==draft.initial[i];
    return `<button type="button" class="slot-toggle ${state} ${changed?'changed':''}" role="switch" aria-checked="${s.open}" ${s.editable?'':'disabled'} ${bindAction('click',()=>toggleSlot(i))}><strong>${fmtTime(s.time)}</strong><small>${escapeHtml(caption)}</small></button>`;
  }).join('');
  const open=draft.slots.filter(s=>s.editable&&s.open).length,closed=draft.slots.filter(s=>s.editable&&!s.open).length,locked=draft.slots.filter(s=>!s.editable).length;
  const changes=draft.slots.filter((s,i)=>s.editable&&s.open!==draft.initial[i]).length;
  const summary=document.getElementById('slot-manager-summary');
  if(summary)summary.textContent=`${open} open · ${closed} closed · ${locked} booked or past${changes?` · ${changes} unsaved change${changes===1?'':'s'}`:''}`;
  const save=document.getElementById('slot-manager-save');if(save)save.disabled=!changes;
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
    toast(`Time slots for ${fmtDate(draft.date)} updated.`,'success');
    // Stay on the same doctor and day so several days can be adjusted in a row.
    await chooseSlotManagerDoctor(draft.docId,draft.date);
  }catch(e){
    toast(e?.message||'Unable to update time slots.','error');
  }finally{
    if(button&&document.body.contains(button)){button.textContent='Save changes';renderSlots();}
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
