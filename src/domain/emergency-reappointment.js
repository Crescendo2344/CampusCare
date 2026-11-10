// Emergency reappointment: the doctor cannot see patients for the rest of a day (an emergency or an
// urgent meeting). Every remaining visit that day is returned for reappointment at once, without waiting
// for an administrator. Each patient is offered the earliest open slot with the same doctor on a day that
// is not fully booked, and may accept it or pick another open time. A patient who does not confirm by the
// deadline loses the reserved time and books a new appointment on their own; there is no second offer.
// This file is mirrored in supabase/functions/_shared so the browser and the server plan the same way.
import {addBookingDays} from './booking-availability.js';

export const EMERGENCY_CONFIRM_HOURS=24;   // time the patient has to accept or pick another time
export const EMERGENCY_MIN_NOTICE_HOURS=12; // never propose a slot sooner than this after the emergency
export const EMERGENCY_DEADLINE_BUFFER_HOURS=2; // the deadline falls at least this long before the new slot
export const EMERGENCY_SEARCH_DAYS=60;      // how far ahead open slots are searched
export const EMERGENCY_MAX_DAYS_AHEAD=14;   // how far ahead a doctor may declare an emergency day
export const EMERGENCY_REASONS=['Medical emergency','Urgent meeting','Personal emergency','Clinic emergency'];

const HOUR=3600*1000;
// Clinic times are Asia/Manila (UTC+8, no daylight saving).
export function slotStartMs(date,time){return Date.parse(`${date}T${String(time).slice(0,5)}:00+08:00`);}

export function confirmationDeadline(nowMs,date,time){
  const byWindow=nowMs+EMERGENCY_CONFIRM_HOURS*HOUR;
  const bySlot=slotStartMs(date,time)-EMERGENCY_DEADLINE_BUFFER_HOURS*HOUR;
  return new Date(Math.min(byWindow,bySlot)).toISOString();
}

// days: output of buildDoctorAvailability covering at least the days after emergencyDate.
// appointments: the visits to move, [{id,time}]. Earlier visits get the earlier open slots.
// Returns one entry per appointment: {id,date,time,deadline} or {id,date:null} when nothing is open.
export function planEmergencyReappointments({appointments,days,emergencyDate,nowMs}){
  const earliest=nowMs+EMERGENCY_MIN_NOTICE_HOURS*HOUR;
  const open=[];
  for(const day of [...days].sort((a,b)=>a.date.localeCompare(b.date))){
    if(day.date<=emergencyDate)continue;
    let room=Math.max(0,Number(day.openSlots)||0);
    for(const slot of day.slots||[]){
      if(!room)break;
      if(!slot.available||slotStartMs(day.date,slot.time)<earliest)continue;
      open.push({date:day.date,time:slot.time});room--;
    }
  }
  return [...appointments]
    .sort((a,b)=>String(a.time).localeCompare(String(b.time))||Number(a.id)-Number(b.id))
    .map((a,i)=>{
      const slot=open[i];
      return slot?{id:a.id,date:slot.date,time:slot.time,deadline:confirmationDeadline(nowMs,slot.date,slot.time)}:{id:a.id,date:null,time:null,deadline:null};
    });
}

// Slots on the emergency day that should stop taking bookings: every slot that has not started yet.
export function emergencyBlockedTimes(day){
  return (day?.slots||[]).filter(s=>s.kind!=='past').map(s=>s.time);
}

export function emergencySearchEnd(emergencyDate){return addBookingDays(emergencyDate,EMERGENCY_SEARCH_DAYS);}

const prettyDate=d=>new Date(d+'T00:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const prettyTime=t=>{const [h,m]=String(t).slice(0,5).split(':').map(Number);return `${h%12||12}:${String(m||0).padStart(2,'0')} ${h<12?'AM':'PM'}`;};
export function prettyDeadline(iso){
  const ms=Date.parse(iso)+8*HOUR,d=new Date(ms).toISOString();
  return `${prettyDate(d.slice(0,10))} at ${prettyTime(d.slice(11,16))}`;
}

// What the doctor's choice of reason says to the patient.
function reasonPhrase(reason){
  return {
    'Medical emergency':'an emergency',
    'Urgent meeting':'an urgent meeting',
    'Personal emergency':'an emergency',
    'Clinic emergency':'an emergency at the clinic'
  }[reason]||'an emergency';
}

// The in-app notice and the email body (the email shows the new date and time in its details card).
export function emergencyReappointMessage({fromDate,fromTime,date,time,deadline,reason,note,clinic,doctorName}){
  const who=doctorName?`Dr. ${doctorName}`:'your doctor';
  const lines=[
    `We sincerely apologize. Due to ${reasonPhrase(reason)}, ${who} is unable to see patients on ${prettyDate(fromDate)}, so your appointment at ${prettyTime(fromTime)} will not push through.`,
    note?`Note from the clinic: ${String(note).trim().replace(/[.\s]*$/,'')}.`:'',
    `We have reserved a new time for you: ${clinic||'Clinic'} · ${prettyDate(date)} at ${prettyTime(time)}. If this does not suit you, you may pick another date and time from the open slots in CampusCare.`,
    `Please confirm by ${prettyDeadline(deadline)} by accepting the new time or choosing another one. If we do not hear from you by then, this reserved time will be released and you will need to book a new appointment on your own.`,
    'Thank you for your understanding.'
  ];
  return lines.filter(Boolean).join('\n\n');
}
