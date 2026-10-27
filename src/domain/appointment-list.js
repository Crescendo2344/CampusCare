import {toCsv} from '../shared/csv.js';
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
// One date label, as in calendar apps: "Today, Oct 24, 2026" or "Wednesday, Dec 16, 2026".
export function appointmentRelativeDay(date,today){
  if(date===today)return 'Today';
  if(date===addDays(today,1))return 'Tomorrow';
  if(date===addDays(today,-1))return 'Yesterday';
  return '';
}
export function appointmentDayHeading(date,today){
  const d=new Date(date+'T12:00:00Z');
  const day=d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  return `${appointmentRelativeDay(date,today)||d.toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'})}, ${day}`;
}

export function appointmentsCsv(rows,describe){
  const header=['Appointment #','Date','Time (PH)','Patient','Patient ID','College/Department','Clinic','Service','Doctor','Priority','Status','Reason for visit'];
  return toCsv([header,...rows.map(describe)]);
}
