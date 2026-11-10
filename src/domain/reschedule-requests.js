// A patient's reschedule is a request the doctor approves. Requests close 24 hours before the visit.
export const RESCHEDULE_CUTOFF_HOURS=24;

export function hoursUntil(appt,nowMs=Date.now()){
  return (Date.parse(`${appt.date}T${String(appt.time||'00:00').slice(0,5)}:00+08:00`)-nowMs)/3600000;
}

// What the patient may do with a scheduled appointment.
export function patientRescheduleState(appt,nowMs=Date.now()){
  if(!appt||!['Scheduled','Confirmed'].includes(appt.status))return 'none';
  if(appt.patientResponse==='Awaiting')return 'none';          // the clinic's proposal has its own buttons
  if(appt.rescheduleRequest)return 'pending';
  return hoursUntil(appt,nowMs)>=RESCHEDULE_CUTOFF_HOURS?'open':'closed';
}
