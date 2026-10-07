// Schedule rules are independent of the DOM, Supabase, and application globals.
// Callers provide current records and settings, so these rules can run in isolation.
export function dayOfWeek(dateStr){return new Date(dateStr+'T12:00:00').toLocaleDateString('en',{weekday:'short'});}
export function timeToMinutes(t){const [h,m]=String(t||'00:00').split(':').map(Number);return h*60+(m||0);}
export function appointmentSlotBaseTimes(doc){
  const start=timeToMinutes(doc.startTime||'08:00'),end=timeToMinutes(doc.endTime||'17:00'),dur=Math.max(15,doc.slotDuration||60),out=[];
  for(let mins=start;mins+dur<=end;mins+=dur)out.push(`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`);
  return out;
}
export function isDefaultLunchSlot(time,doc,settings={}){
  const slotStart=timeToMinutes(time),dur=Math.max(15,doc.slotDuration||60),slotEnd=slotStart+dur;
  const lunchStart=timeToMinutes(settings.lunchBreakStart||'12:00'),lunchEnd=timeToMinutes(settings.lunchBreakEnd||'13:00');
  return slotStart<lunchEnd&&slotEnd>lunchStart;
}
export function clinicToday(){
  // Clinic dates use Philippine time regardless of the visitor's device timezone.
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
export function canonicalSchedule(s){
  // Normalize both existing UI records and server payload field names.
  return {startTime:String(s.startTime??s.start_time??'').slice(0,5),endTime:String(s.endTime??s.end_time??'').slice(0,5),slotDuration:Number(s.slotDuration??s.slot_duration),maxPatients:Number(s.maxPatients??s.max_patients),workDays:s.workDays??s.work_days??[]};
}
export function scheduleConflicts(doc,proposal,effectiveDate,appointments=[]){
  const s=canonicalSchedule(proposal),slots=appointmentSlotBaseTimes(s);
  const appts=appointments.filter(a=>Number(a.doctorId)===Number(doc.id)&&a.date>=effectiveDate&&['Scheduled','Pending','Confirmed'].includes(a.status));
  const counts={};appts.forEach(a=>counts[a.date]=(counts[a.date]||0)+1);
  return appts.filter(a=>!s.workDays.includes(dayOfWeek(a.date))||!slots.includes(String(a.time).slice(0,5))||counts[a.date]>s.maxPatients);
}
export function validateSchedule(proposal,effectiveDate,doc,checkDuplicate=true,{today=clinicToday(),appointments=[],requests=[],settings={}}={}){
  const s=canonicalSchedule(proposal),days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||effectiveDate<today)return 'Choose today or a future effective date.';
  if(!Array.isArray(s.workDays)||!s.workDays.length||s.workDays.some(d=>!days.includes(d)))return 'Select at least one valid recurring work day.';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.endTime)||s.startTime>=s.endTime)return 'Enter valid hours with start before end. Overnight shifts are not supported.';
  if(!Number.isInteger(s.slotDuration)||s.slotDuration<15||s.slotDuration>120)return 'Slot duration must be a whole number from 15 to 120 minutes.';
  if(!Number.isInteger(s.maxPatients)||s.maxPatients<1||s.maxPatients>500)return 'Daily patient limit must be a whole number from 1 to 500.';
  const slots=appointmentSlotBaseTimes(s).filter(t=>!isDefaultLunchSlot(t,s,settings));
  if(!slots.length)return 'The work hours must fit at least one complete appointment outside the lunch break.';
  if(checkDuplicate&&requests.some(r=>r.doctorId===doc.id&&(r.status==='Pending'||r.status==='Approved-Pending'||(r._realSupabase&&r.status==='Approved'&&!r.appliedAt&&r.effectiveDate>=today))))return 'You already have an outstanding schedule change. Resolve it before submitting another.';
  if(checkDuplicate&&JSON.stringify(canonicalSchedule(doc))===JSON.stringify(s))return 'The proposed schedule matches your current schedule.';
  const conflicts=scheduleConflicts(doc,s,effectiveDate,appointments);
  if(conflicts.length)return `${conflicts.length} existing appointment(s) conflict with these days, hours, slot times or capacity. Arrange rescheduling before submitting.`;
  return '';
}
export function campusScheduleForDate(doc,date,requests=[]){
  // Approved future patterns affect bookings from their effective date;
  // pending proposals never affect availability.
  const r=requests.filter(r=>r.doctorId===doc.id&&r.effectiveDate<=date&&['Approved-Pending','Approved','Applied'].includes(r.status)).sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate))[0];
  return r?{...doc,...canonicalSchedule(r.requested)}:doc;
}
