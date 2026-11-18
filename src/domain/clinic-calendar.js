// Clinic Calendar & Queue: which bookings a person may see, the month grid with day counts, and the
// day's queue in the order patients are seen. Works only on supplied records (Asia/Manila dates).
import {userClinic} from './clinic-scope.js';

export const CALENDAR_ROLES=['Staff','Doctor'];

// The clinic whose calendar this person opens, or '' when they have none (administrators, patients,
// or staff not yet assigned to a clinic). Medical people see only Medical; dental people only Dental.
export function calendarClinicFor(account){
  return CALENDAR_ROLES.includes(account?.role)?userClinic(account):'';
}

// Staff see every booking of their clinic; a doctor sees their own bookings, which are all in their clinic.
// Anything else (the other clinic, another doctor's patients) is left out even if it was loaded.
export function calendarScope(rows,account){
  const clinic=calendarClinicFor(account);
  if(!clinic)return [];
  return (rows||[]).filter(a=>a.clinic===clinic&&(account.role!=='Doctor'||a.doctorId===account.id));
}

const pad=n=>String(n).padStart(2,'0');
export function shiftMonth(month,delta){
  const [y,m]=month.split('-').map(Number);
  const d=new Date(Date.UTC(y,m-1+delta,1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`;
}

// Six weeks starting on Sunday, covering the month.
export function monthGrid(month){
  const [y,m]=month.split('-').map(Number);
  const first=new Date(Date.UTC(y,m-1,1));
  const start=new Date(first);start.setUTCDate(1-first.getUTCDay());
  const days=[];
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setUTCDate(start.getUTCDate()+i);
    days.push({date:d.toISOString().slice(0,10),day:d.getUTCDate(),inMonth:d.getUTCMonth()===m-1,weekend:[0,6].includes(d.getUTCDay())});
  }
  return days;
}

// Per day: live bookings (not cancelled) split into waiting, completed and no-show, plus cancellations.
export function dayCounts(rows){
  const counts={};
  for(const a of rows||[]){
    const c=counts[a.date]??={total:0,waiting:0,completed:0,noShow:0,cancelled:0};
    if(a.status==='Cancelled'){c.cancelled++;continue;}
    c.total++;
    if(a.status==='Completed')c.completed++;
    else if(a.status==='No-show')c.noShow++;
    else c.waiting++;
  }
  return counts;
}

// Queue number within the hour, as on the Appointments page: the first booking from 9:00 to 9:59
// with a doctor is No. 1, the next No. 2. Cancelled bookings do not take a number.
export function queueNumberIn(rows,a){
  const hour=String(a.time||'').slice(0,2);
  const same=rows.filter(x=>x.doctorId===a.doctorId&&x.date===a.date&&String(x.time||'').slice(0,2)===hour&&x.status!=='Cancelled')
    .sort((x,y)=>String(x.time).localeCompare(String(y.time))||String(x.createdAt||'').localeCompare(String(y.createdAt||''))||x.id-y.id);
  return Math.max(1,same.findIndex(x=>x.id===a.id)+1);
}

// The day's queue: live bookings by time and queue number, then cancellations at the end.
export function dayQueue(rows,date){
  const day=(rows||[]).filter(a=>a.date===date);
  const live=day.filter(a=>a.status!=='Cancelled').map(a=>({...a,queueNo:queueNumberIn(day,a)}))
    .sort((x,y)=>String(x.time).localeCompare(String(y.time))||x.queueNo-y.queueNo||x.id-y.id);
  const cancelled=day.filter(a=>a.status==='Cancelled').sort((x,y)=>String(x.time).localeCompare(String(y.time))||x.id-y.id).map(a=>({...a,queueNo:null}));
  return {live,cancelled};
}

// "Now serving": on today's queue, the first patient still waiting whose hour has come (or the next one).
export function nowServing(live,{date,today,now}){
  if(date!==today)return null;
  const waiting=live.filter(a=>a.status==='Scheduled');
  return waiting.find(a=>String(a.time).slice(0,2)<=String(now).slice(0,2))||waiting[0]||null;
}
