// Availability contains dates and slot states only; never return patient identity or appointment details.
export function addBookingDays(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function validBookingDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
const minutes=time=>{const [h,m]=String(time||'').slice(0,5).split(':').map(Number);return h*60+m;};
const clock=minute=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');

// Tooth extraction and restoration (filling) take 1 hour 30 minutes instead of one regular slot.
export const LONG_SERVICES=['Tooth Extraction','Tooth Restoration'];
export const LONG_SERVICE_MINUTES=90;
export const serviceMinutes=(service,slotMinutes)=>LONG_SERVICES.includes(service)?Math.max(LONG_SERVICE_MINUTES,slotMinutes):slotMinutes;

// The day's slot start times. Normally every `duration` minutes from the start. After a long
// procedure the next slot starts when it ends (moved by 1 hr 30 min), and the times after it follow
// from there until they meet an appointment that was already booked.
// booked: [{minute,length}] for the day's appointments.
export function daySlotStarts({start,end,duration,booked=[]}){
  const at=new Map(booked.map(b=>[b.minute,b])),starts=[];
  for(let minute=start;Number.isFinite(minute)&&minute+duration<=end;){
    const here=at.get(minute);
    if(here){starts.push(minute);minute+=Math.max(duration,here.length||duration);continue;}
    // Off the regular grid (after a long procedure): a gap too short for a slot is skipped.
    const offGrid=(minute-start)%duration!==0;
    const next=offGrid?booked.map(b=>b.minute).filter(m=>m>minute&&m<minute+duration).sort((x,y)=>x-y)[0]:undefined;
    if(next!==undefined){minute=next;continue;}
    starts.push(minute);minute+=duration;
  }
  return starts;
}

// Why a service of `length` minutes cannot start at `minute`, or '' when it fits.
export function slotFitProblem({minute,length,end,booked=[],lunchStart,lunchEnd,ignoreLunch=false}){
  if(minute+length>end)return 'It would run past the end of the clinic day.';
  if(booked.some(b=>b.minute>minute&&b.minute<minute+length))return 'Another appointment starts before it would finish.';
  if(booked.some(b=>b.minute<minute&&b.minute+(b.length||0)>minute))return 'An earlier appointment is still in progress then.';
  if(!ignoreLunch&&Number.isFinite(lunchStart)&&minute<lunchEnd&&minute+length>lunchStart)return 'It would overlap the lunch break.';
  return '';
}

// `service`: the service being booked, so times a long procedure cannot fit into are marked.
export function buildDoctorAvailability({doctor,rules=[],appointments=[],leaves=[],overrides=[],settings={},from,to,today,nowMinutes=0,service=''}){
  if(!validBookingDate(from)||!validBookingDate(to)||to<from||to>addBookingDays(from,365))throw new Error('Choose a valid availability range of up to one year.');
  const occupied=new Map(),leaveDays=new Set(leaves.map(row=>row.date));
  for(const row of appointments){if(row.status==='Cancelled')continue;if(!occupied.has(row.date))occupied.set(row.date,[]);occupied.get(row.date).push({time:String(row.time).slice(0,5),service:row.service||''});}
  const byDate=new Map();for(const row of overrides){if(!byDate.has(row.date))byDate.set(row.date,new Map());byDate.get(row.date).set(String(row.time).slice(0,5),row);}
  const days=[];
  for(let date=from;date<=to;date=addBookingDays(date,1)){
    const weekday=new Date(date+'T12:00:00Z').getUTCDay();
    const rule=rules.filter(r=>r.weekday===weekday&&r.effective_from<=date&&(!r.effective_to||r.effective_to>=date)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
    const working=rule?Boolean(rule.is_working):(doctor.workDays||[]).includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekday]);
    if(date<today||!working||leaveDays.has(date)){days.push({date,openSlots:0,slots:[]});continue;}
    const defaultStart=doctor.specialty==='Dental'?'09:00':'08:00',start=minutes(rule?.start_time||doctor.startTime||defaultStart),end=minutes(rule?.end_time||doctor.endTime||'17:00');
    const duration=Math.max(15,Number(rule?.slot_duration||doctor.slotDuration||60)),capacity=Math.max(1,Number(rule?.max_patients||doctor.maxPatients||20));
    const dayBooked=occupied.get(date)||[],taken=dayBooked.map(b=>b.time),dailyFull=taken.length>=capacity,dayOverrides=byDate.get(date);
    const booked=dayBooked.map(b=>({minute:minutes(b.time),length:serviceMinutes(b.service,duration)}));
    const wanted=serviceMinutes(service,duration);
    const lunchStart=minutes(settings.lunchStart||'12:00'),lunchEnd=minutes(settings.lunchEnd||'13:00'),slots=[];
    for(const minute of daySlotStarts({start,end,duration,booked})){
      const time=clock(minute),override=dayOverrides?.get(time);
      let kind='available',label='Available';
      if(taken.includes(time)){kind='booked';label='Booked';}
      else if(dailyFull){kind='full';label='Daily limit reached';}
      else if(date===today&&minute<=nowMinutes){kind='past';label='Past time';}
      else if(override?.available===false){kind='blocked';label='Unavailable';}
      else if(minute<lunchEnd&&minute+duration>lunchStart&&override?.available!==true){kind='lunch';label='Lunch break';}
      else if(slotFitProblem({minute,length:Math.min(wanted,duration),end,booked,ignoreLunch:true})){kind='booked';label='Booked';}
      else if(wanted>duration&&slotFitProblem({minute,length:wanted,end,booked,lunchStart,lunchEnd})){kind='short';label='Needs 1 hr 30 min';}
      slots.push({time,kind,label,available:kind==='available'});
    }
    // Staff can add one-off times outside the regular grid; they behave like any other slot.
    const regular=new Set(slots.map(s=>s.time));
    for(const [time,override] of dayOverrides||[]){
      if(override?.available!==true||regular.has(time)||!/^\d{2}:\d{2}$/.test(time))continue;
      const minute=minutes(time);
      let kind='available',label='Custom time';
      if(taken.includes(time)){kind='booked';label='Booked';}
      else if(dailyFull){kind='full';label='Daily limit reached';}
      else if(date===today&&minute<=nowMinutes){kind='past';label='Past time';}
      slots.push({time,kind,label,available:kind==='available',custom:true});
    }
    slots.sort((a,b)=>a.time.localeCompare(b.time));
    days.push({date,openSlots:Math.min(Math.max(0,capacity-taken.length),slots.filter(s=>s.available).length),slots,schedule:{workDays:[['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekday]],startTime:String(rule?.start_time||doctor.startTime||defaultStart).slice(0,5),endTime:String(rule?.end_time||doctor.endTime||'17:00').slice(0,5),slotDuration:duration,maxPatients:capacity}});
  }
  return days;
}
