import {resolveCallback} from '../app/callbacks.js';
// calendar: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {fmtDate} from './inputValidation.js';
import {bindAction} from '../dependencies.js';
// ── Modern reusable calendar ──

export function initModernCalendar(id,selectedDate=appState.clinicInformation.TODAY,minDate='',callbackName='',options={}){
  const base=(selectedDate||appState.clinicInformation.TODAY);
  const selected=options.allowEmptySelection?(selectedDate||''):base;
  // The "dates with appointments" dots appear only on appointment calendars, which opt in.
  appState.calendar.modernCalendarState[id]={selected,minDate:minDate||'',callbackName,viewMonth:base.slice(0,7),...options,showAppointmentHints:options.showAppointmentHints===true};
  renderModernCalendar(id);
}
// Appointment calendars skip empty months without changing calendars used for birthdays or report ranges.
function resolveAvailableMonth(st,direction=1){
  if(!Array.isArray(st.availableDates)||!st.availableDates.length)return;
  const dates=st.availableDates.slice().sort();
  if(dates.some(date=>date.startsWith(st.viewMonth))){st.monthNote='';return;}
  const requested=st.viewMonth;
  const next=direction<0?(dates.filter(date=>date<requested+'-01').at(-1)||dates[0]):(dates.find(date=>date>=requested+'-01')||dates.at(-1));
  st.viewMonth=next.slice(0,7);
  st.monthNote='No openings in that month. Showing the closest available month.';
}
export function modernCalendarShift(id,delta){
  const st=appState.calendar.modernCalendarState[id]; if(!st)return;
  const [y,m]=st.viewMonth.split('-').map(Number);
  const d=new Date(y,m-1+delta,1,12);
  st.viewMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  resolveAvailableMonth(st,delta);
  renderModernCalendar(id);
}
export function modernCalendarSetMonth(id,month){
  const st=appState.calendar.modernCalendarState[id]; if(!st)return;
  const year=st.viewMonth.slice(0,4);
  st.viewMonth=`${year}-${String(month).padStart(2,'0')}`;
  resolveAvailableMonth(st);
  renderModernCalendar(id);
}
export function modernCalendarSetYear(id,year){
  const st=appState.calendar.modernCalendarState[id]; if(!st)return;
  const month=st.viewMonth.slice(5,7);
  st.viewMonth=`${year}-${month}`;
  resolveAvailableMonth(st);
  renderModernCalendar(id);
}
export function modernCalendarGoToday(id){
  const st=appState.calendar.modernCalendarState[id]; if(!st)return;
  const target=st.minDate&&appState.clinicInformation.TODAY<st.minDate?st.minDate:appState.clinicInformation.TODAY;
  st.viewMonth=target.slice(0,7);
  st.selected=target;
  if(st.callbackName&&typeof resolveCallback(st.callbackName)==='function')resolveCallback(st.callbackName)(target);
  renderModernCalendar(id);
}
export function modernCalendarSelect(id,date){
  const st=appState.calendar.modernCalendarState[id]; if(!st)return;
  if(st.minDate&&date<st.minDate)return;
  if(st.maxDate&&date>st.maxDate)return;
  if(Array.isArray(st.availableDates)&&!st.availableDates.includes(date))return;
  st.selected=date;
  st.viewMonth=date.slice(0,7);
  if(st.callbackName&&typeof resolveCallback(st.callbackName)==='function')resolveCallback(st.callbackName)(date);
  renderModernCalendar(id);
}
export function renderModernCalendar(id){
  const host=document.getElementById(id), st=appState.calendar.modernCalendarState[id];
  if(!host||!st)return;
  const [year,month]=st.viewMonth.split('-').map(Number);
  const first=new Date(year,month-1,1,12);
  const start=new Date(first); start.setDate(1-first.getDay());
  const monthLabel=first.toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  const apptDates=st.showAppointmentHints===false
    ? new Set()
    : new Set((appState.data.DB.appointments||[]).filter(a=>a.status!=='Cancelled').map(a=>a.date));
  let days='';
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const outside=d.getMonth()!==month-1;
    const disabled=!!(st.minDate&&date<st.minDate||st.maxDate&&date>st.maxDate||Array.isArray(st.availableDates)&&!st.availableDates.includes(date));
    const classes=['modern-calendar-day'];
    if(outside)classes.push('outside');
    if(Array.isArray(st.availableDates)&&!disabled)classes.push('available');
    if(date===appState.clinicInformation.TODAY)classes.push('today');
    if(st.rangeMode){
      if(st.rangeStart&&date===st.rangeStart)classes.push('range-start');
      if(st.rangeEnd&&date===st.rangeEnd)classes.push('range-end');
      if(st.rangeStart&&st.rangeEnd&&date>st.rangeStart&&date<st.rangeEnd)classes.push('in-range');
    }else if(date===st.selected)classes.push('selected');
    // Calendars that collect several dates (batch edits) mark each picked date.
    if(Array.isArray(st.markedDates)&&st.markedDates.includes(date))classes.push('marked');
    if(apptDates.has(date))classes.push('has-appt');
    days+=`<button type="button" class="${classes.join(' ')}" ${disabled?'disabled':''} ${bindAction('click',(event,element)=>{modernCalendarSelect((String(id)),(String(date)))})} aria-label="${fmtDate(date)}">${d.getDate()}</button>`;
  }
  const monthOptions=Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===month?'selected':''}>${new Date(2000,i,1).toLocaleDateString('en-PH',{month:'short'})}</option>`).join('');
  // Build a complete year list instead of limiting the dropdown to ±4 years.
  // DOB calendars can now scroll from the current year down to 1950.
  // Other calendars still receive a useful range based on their min/max dates.
  const currentYear=new Date().getFullYear();
  let minYear=st.minDate ? Number(st.minDate.slice(0,4)) : Math.min(1950,year);
  let maxYear=st.maxDate ? Number(st.maxDate.slice(0,4)) : Math.max(currentYear+10,year+10);

  // Never allow an invalid range if a date field has unusual constraints.
  if(!Number.isFinite(minYear)) minYear=1950;
  if(!Number.isFinite(maxYear)) maxYear=currentYear+10;
  if(minYear>maxYear){ const temp=minYear; minYear=maxYear; maxYear=temp; }

  let yearOptions='';
  for(let yy=minYear;yy<=maxYear;yy++){
    yearOptions+=`<option value="${yy}" ${yy===year?'selected':''}>${yy}</option>`;
  }
  host.innerHTML=`<div class="modern-calendar">
    <div class="modern-calendar-head"><button type="button" class="modern-calendar-nav" ${bindAction('click',(event,element)=>{modernCalendarShift((String(id)),-1)})} aria-label="Previous month">‹</button><div class="modern-calendar-title"><select aria-label="Month" ${bindAction('change',(event,element)=>{modernCalendarSetMonth((String(id)),element.value)})}>${monthOptions}</select><select class="modern-calendar-year-select" aria-label="Year" ${bindAction('change',(event,element)=>{modernCalendarSetYear((String(id)),element.value)})}>${yearOptions}</select></div><button type="button" class="modern-calendar-nav" ${bindAction('click',(event,element)=>{modernCalendarShift((String(id)),1)})} aria-label="Next month">›</button></div>
    ${st.monthNote?'<p class="booking-calendar-note" role="status">'+st.monthNote+'</p>':''}
    <div class="modern-calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="modern-calendar-days">${days}</div>
    ${(st.showAppointmentHints===false&&st.showTodayButton===false)?'':`<div class="modern-calendar-footer">${st.showAppointmentHints===false?'':`<span class="modern-calendar-hint"><span style="color:var(--primary)">●</span> Dates with appointments</span>`}${st.showTodayButton===false?'':`<button type="button" class="modern-calendar-today" ${bindAction('click',(event,element)=>{modernCalendarGoToday((String(id)))})}>Today</button>`}</div>`}
  </div>`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.calendar.modernCalendarState={};
}
