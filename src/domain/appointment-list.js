// Appointment list rules: which tab a booking belongs to, which actions are allowed, ordering and export.
// Everything works on supplied records and the clinic's current date/time (Asia/Manila).
const OPEN='Scheduled';

// Upcoming: still scheduled today or later. Needs outcome: still scheduled on a past day.
// History: completed, cancelled or no-show.
export function appointmentView(a,today){
  if(a.status!==OPEN)return 'history';
  return a.date>=today?'upcoming':'outcome';
}

export function appointmentHasStarted(a,{today,now}){
  return a.date<today||(a.date===today&&String(a.time||'00:00')<=String(now||'00:00'));
}

// Allowed actions per role; the server enforces the same status and timing rules.
export function appointmentActions(a,{role,userId,today,now}){
  const open=a.status===OPEN,manage=role==='Staff'||role==='Administrator';
  const ownDoctor=role==='Doctor'&&a.doctorId===userId;
  const started=appointmentHasStarted(a,{today,now});
  return {
    document:open&&ownDoctor&&a.date<=today,
    reschedule:open&&manage&&a.date>=today,
    cancel:open&&manage&&!started,
    noShow:open&&(manage||ownDoctor)&&started,
    remind:open&&(manage||ownDoctor)&&!started
  };
}

export function sortAppointments(rows,view){
  const key=a=>`${a.date} ${a.time||''}`;
  const sorted=rows.slice().sort((a,b)=>key(a).localeCompare(key(b))||a.id-b.id);
  return view==='upcoming'?sorted:sorted.reverse();
}

export function appointmentViewCounts(rows,today){
  const counts={upcoming:0,outcome:0,history:0,all:rows.length};
  for(const a of rows)counts[appointmentView(a,today)]+=1;
  return counts;
}

const addDays=(date,days)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
// Agenda-style day headings, as in calendar apps.
export function appointmentDayHeading(date,today){
  if(date===today)return 'Today';
  if(date===addDays(today,1))return 'Tomorrow';
  if(date===addDays(today,-1))return 'Yesterday';
  const d=new Date(date+'T12:00:00Z');
  return d.toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',...(date.slice(0,4)!==today.slice(0,4)?{year:'numeric'}:{}),timeZone:'UTC'});
}

const csvCell=value=>{const text=String(value??'');return /[",\n\r]/.test(text)||/^[=+\-@]/.test(text)?`"${(/^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')}"`:text;};
export function appointmentsCsv(rows,describe){
  const header=['Appointment #','Date','Time','Patient','Patient ID','College/Department','Clinic','Service','Doctor','Priority','Status','Reason'];
  return [header,...rows.map(describe)].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
