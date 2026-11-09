// Availability contains dates and slot states only; never return patient identity or appointment details.
export function addBookingDays(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function validBookingDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
const minutes=time=>{const [h,m]=String(time||'').slice(0,5).split(':').map(Number);return h*60+m;};
export function buildDoctorAvailability({doctor,rules=[],appointments=[],leaves=[],overrides=[],settings={},from,to,today,nowMinutes=0}){
  if(!validBookingDate(from)||!validBookingDate(to)||to<from||to>addBookingDays(from,365))throw new Error('Choose a valid availability range of up to one year.');
  const occupied=new Map(),leaveDays=new Set(leaves.map(row=>row.date));
  for(const row of appointments){if(row.status==='Cancelled')continue;if(!occupied.has(row.date))occupied.set(row.date,[]);occupied.get(row.date).push(String(row.time).slice(0,5));}
  const byDate=new Map();for(const row of overrides){if(!byDate.has(row.date))byDate.set(row.date,new Map());byDate.get(row.date).set(String(row.time).slice(0,5),row);}
  const days=[];
  for(let date=from;date<=to;date=addBookingDays(date,1)){
    const weekday=new Date(date+'T12:00:00Z').getUTCDay();
    const rule=rules.filter(r=>r.weekday===weekday&&r.effective_from<=date&&(!r.effective_to||r.effective_to>=date)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
    const working=rule?Boolean(rule.is_working):(doctor.workDays||[]).includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekday]);
    if(date<today||!working||leaveDays.has(date)){days.push({date,openSlots:0,slots:[]});continue;}
    const start=minutes(rule?.start_time||doctor.startTime||'08:00'),end=minutes(rule?.end_time||doctor.endTime||'17:00');
    const duration=Math.max(15,Number(rule?.slot_duration||doctor.slotDuration||60)),capacity=Math.max(1,Number(rule?.max_patients||doctor.maxPatients||20));
    const taken=occupied.get(date)||[],dailyFull=taken.length>=capacity,dayOverrides=byDate.get(date);
    const lunchStart=minutes(settings.lunchStart||'12:00'),lunchEnd=minutes(settings.lunchEnd||'13:00'),slots=[];
    for(let minute=start;Number.isFinite(minute)&&minute+duration<=end;minute+=duration){
      const time=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'),override=dayOverrides?.get(time);
      let kind='available',label='Available';
      if(taken.includes(time)){kind='booked';label='Booked';}
      else if(dailyFull){kind='full';label='Daily limit reached';}
      else if(date===today&&minute<=nowMinutes){kind='past';label='Past time';}
      else if(override?.available===false){kind='blocked';label='Unavailable';}
      else if(minute<lunchEnd&&minute+duration>lunchStart&&override?.available!==true){kind='lunch';label='Lunch break';}
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
    days.push({date,openSlots:Math.min(Math.max(0,capacity-taken.length),slots.filter(s=>s.available).length),slots,schedule:{workDays:[['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekday]],startTime:String(rule?.start_time||doctor.startTime||'08:00').slice(0,5),endTime:String(rule?.end_time||doctor.endTime||'17:00').slice(0,5),slotDuration:duration,maxPatients:capacity}});
  }
  return days;
}
