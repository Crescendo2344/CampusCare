// Weekly doctor coverage: per-day hours, capacity and validation shared by the board and the editor.
export const WEEK_DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const WEEK_DAY_NAMES={Mon:'Monday',Tue:'Tuesday',Wed:'Wednesday',Thu:'Thursday',Fri:'Friday',Sat:'Saturday',Sun:'Sunday'};

const minutes=t=>{const [h,m]=String(t||'').slice(0,5).split(':').map(Number);return (h||0)*60+(m||0);};

// "08:00:00" → "8 AM", "17:30" → "5:30 PM".
export function shortTime(t){
  const total=minutes(t),h=Math.floor(total/60)%24,m=total%60;
  return `${h%12||12}${m?':'+String(m).padStart(2,'0'):''} ${h<12?'AM':'PM'}`;
}

export function shiftLabel(day){
  return day?.isWorking?`${shortTime(day.startTime)} – ${shortTime(day.endTime)}`:'Off';
}

// Every day carries its own hours; a doctor's summary fields cover profiles without per-day rules.
export function weeklyFromSummary(doc={}){
  const work=Array.isArray(doc.workDays)?doc.workDays:[];
  return WEEK_DAYS.map(day=>({day,isWorking:work.includes(day),startTime:String(doc.startTime||'08:00').slice(0,5),endTime:String(doc.endTime||'17:00').slice(0,5)}));
}

export function weeklyFromServer(rows,doc={}){
  if(!Array.isArray(rows)||!rows.length)return weeklyFromSummary(doc);
  const byDay=new Map(rows.map(r=>[r.day,r]));
  return WEEK_DAYS.map(day=>{const r=byDay.get(day);return r
    ?{day,isWorking:!!r.isWorking,startTime:String(r.startTime||'08:00').slice(0,5),endTime:String(r.endTime||'17:00').slice(0,5)}
    :{day,isWorking:false,startTime:'08:00',endTime:'17:00'};});
}

export function slotsForDay(day,slotDuration){
  if(!day?.isWorking)return 0;
  return Math.max(0,Math.floor((minutes(day.endTime)-minutes(day.startTime))/Math.max(15,Number(slotDuration)||60)));
}

// Server rules: start before end and at least one slot per working day.
export function assessWeekly(days,slotDuration,maxPatients){
  const slot=Number(slotDuration)||0,max=Number(maxPatients)||0,errors=[];
  const working=days.filter(d=>d.isWorking);
  if(!working.length)errors.push('Choose at least one work day.');
  if(slot<15||slot>120)errors.push('Appointment length must be 15–120 minutes.');
  const perDay={};let hours=0,capacity=0,minSlots=Infinity;
  for(const d of working){
    const span=minutes(d.endTime)-minutes(d.startTime);
    if(!/^\d{2}:\d{2}$/.test(String(d.startTime).slice(0,5))||!/^\d{2}:\d{2}$/.test(String(d.endTime).slice(0,5))||span<=0){errors.push(`${WEEK_DAY_NAMES[d.day]}: the start time must be before the end time.`);continue;}
    const n=slotsForDay(d,slot);perDay[d.day]=n;hours+=span/60;
    if(n<1)errors.push(`${WEEK_DAY_NAMES[d.day]}: the hours are shorter than one ${slot}-minute appointment.`);
    minSlots=Math.min(minSlots,n);capacity+=Math.min(n,max||n);
  }
  if(max<1)errors.push('Daily patient limit must be at least 1.');
  // A shorter day simply takes fewer patients: its limit is capped at its own slot count.
  const cappedDays=working.filter(d=>perDay[d.day]>0&&perDay[d.day]<max).map(d=>d.day);
  const maxSlots=Math.max(0,...Object.values(perDay));
  return {errors,perDay,cappedDays,maxSlots,weeklyHours:Math.round(hours*10)/10,weeklyCapacity:capacity,minSlots:Number.isFinite(minSlots)?minSlots:0,workingDays:working.length};
}

export function dayLimit(day,slotDuration,maxPatients){
  return Math.max(1,Math.min(Number(maxPatients)||1,slotsForDay(day,slotDuration)||1));
}

export function sameWeekly(a,b){
  const key=list=>JSON.stringify(list.map(d=>[d.day,!!d.isWorking,d.isWorking?String(d.startTime).slice(0,5):'',d.isWorking?String(d.endTime).slice(0,5):'']));
  return key(a)===key(b);
}

// Monday-first dates of the clinic week that contains `today`.
export function weekDates(today){
  const d=new Date(today+'T12:00:00Z'),offset=(d.getUTCDay()+6)%7;
  return WEEK_DAYS.map((_,i)=>{const x=new Date(d);x.setUTCDate(d.getUTCDate()-offset+i);return x.toISOString().slice(0,10);});
}
