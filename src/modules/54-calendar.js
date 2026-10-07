// ── Modern reusable calendar ──
const modernCalendarState={};
function initModernCalendar(id,selectedDate=TODAY,minDate='',callbackName='',options={}){
  const base=(selectedDate||TODAY);
  const selected=options.allowEmptySelection?(selectedDate||''):base;
  modernCalendarState[id]={selected,minDate:minDate||'',callbackName,viewMonth:base.slice(0,7),...options};
  renderModernCalendar(id);
}
function modernCalendarShift(id,delta){
  const st=modernCalendarState[id]; if(!st)return;
  const [y,m]=st.viewMonth.split('-').map(Number);
  const d=new Date(y,m-1+delta,1,12);
  st.viewMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  renderModernCalendar(id);
}
function modernCalendarSetMonth(id,month){
  const st=modernCalendarState[id]; if(!st)return;
  const year=st.viewMonth.slice(0,4);
  st.viewMonth=`${year}-${String(month).padStart(2,'0')}`;
  renderModernCalendar(id);
}
function modernCalendarSetYear(id,year){
  const st=modernCalendarState[id]; if(!st)return;
  const month=st.viewMonth.slice(5,7);
  st.viewMonth=`${year}-${month}`;
  renderModernCalendar(id);
}
function modernCalendarGoToday(id){
  const st=modernCalendarState[id]; if(!st)return;
  const target=st.minDate&&TODAY<st.minDate?st.minDate:TODAY;
  st.viewMonth=target.slice(0,7);
  st.selected=target;
  if(st.callbackName&&typeof window[st.callbackName]==='function')window[st.callbackName](target);
  renderModernCalendar(id);
}
function modernCalendarSelect(id,date){
  const st=modernCalendarState[id]; if(!st)return;
  if(st.minDate&&date<st.minDate)return;
  if(st.maxDate&&date>st.maxDate)return;
  st.selected=date;
  st.viewMonth=date.slice(0,7);
  if(st.callbackName&&typeof window[st.callbackName]==='function')window[st.callbackName](date);
  renderModernCalendar(id);
}
function renderModernCalendar(id){
  const host=document.getElementById(id), st=modernCalendarState[id];
  if(!host||!st)return;
  const [year,month]=st.viewMonth.split('-').map(Number);
  const first=new Date(year,month-1,1,12);
  const start=new Date(first); start.setDate(1-first.getDay());
  const monthLabel=first.toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  const apptDates=st.showAppointmentHints===false
    ? new Set()
    : new Set((DB.appointments||[]).filter(a=>a.status!=='Cancelled').map(a=>a.date));
  let days='';
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const outside=d.getMonth()!==month-1;
    const disabled=!!(st.minDate&&date<st.minDate);
    const classes=['modern-calendar-day'];
    if(outside)classes.push('outside');
    if(date===TODAY)classes.push('today');
    if(st.rangeMode){
      if(st.rangeStart&&date===st.rangeStart)classes.push('range-start');
      if(st.rangeEnd&&date===st.rangeEnd)classes.push('range-end');
      if(st.rangeStart&&st.rangeEnd&&date>st.rangeStart&&date<st.rangeEnd)classes.push('in-range');
    }else if(date===st.selected)classes.push('selected');
    if(apptDates.has(date))classes.push('has-appt');
    days+=`<button type="button" class="${classes.join(' ')}" ${disabled?'disabled':''} onclick="modernCalendarSelect('${id}','${date}')" aria-label="${fmtDate(date)}">${d.getDate()}</button>`;
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
    <div class="modern-calendar-head"><button type="button" class="modern-calendar-nav" onclick="modernCalendarShift('${id}',-1)" aria-label="Previous month">‹</button><div class="modern-calendar-title"><select aria-label="Month" onchange="modernCalendarSetMonth('${id}',this.value)">${monthOptions}</select><select class="modern-calendar-year-select" aria-label="Year" onchange="modernCalendarSetYear('${id}',this.value)">${yearOptions}</select></div><button type="button" class="modern-calendar-nav" onclick="modernCalendarShift('${id}',1)" aria-label="Next month">›</button></div>
    <div class="modern-calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="modern-calendar-days">${days}</div>
    ${(st.showAppointmentHints===false&&st.showTodayButton===false)?'':`<div class="modern-calendar-footer">${st.showAppointmentHints===false?'':`<span class="modern-calendar-hint"><span style="color:var(--primary)">●</span> Dates with appointments</span>`}${st.showTodayButton===false?'':`<button type="button" class="modern-calendar-today" onclick="modernCalendarGoToday('${id}')">Today</button>`}</div>`}
  </div>`;
}
