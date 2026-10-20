// Pure report calculations share one normalized row shape with charts and exports.
export const reportDefinitions={
  appointments:{label:'Appointments',groups:['month','week','date','clinic','status','college','personType','classSession','sex','doctor'],measures:['count','patients']},
  treatments:{label:'Treatments',groups:['month','week','date','clinic','diagnosis','college','personType','classSession','sex','doctor'],measures:['count','patients']},
  patients:{label:'Patients',groups:['college','personType','classSession','sex','blood'],measures:['count']},
  inventory:{label:'Inventory',groups:['category','stock','item'],measures:['count','value']}
};
export const reportLabels={month:'Month',week:'Week starting Monday',date:'Day',clinic:'Clinic',status:'Status',college:'College',personType:'Person type',classSession:'Class session',sex:'Sex',doctor:'Doctor',diagnosis:'Diagnosis',blood:'Blood type',category:'Category',stock:'Stock level',item:'Item',count:'Record count',patients:'Unique patients',value:'Stock value (₱)'};
export const isoDay=value=>String(value||'').slice(0,10);
export function validDay(day){return /^\d{4}-\d{2}-\d{2}$/.test(day)&&!Number.isNaN(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;}
export function offsetDay(day,amount){return new Date(Date.parse(day+'T00:00:00Z')+amount*86400000).toISOString().slice(0,10);}
export function validateRange(from,to){if(!validDay(from)||!validDay(to)||from>to)throw new Error('Choose a valid start date on or before the end date.');}
const label=value=>value==null||value===''?'Not recorded':String(value);
export function filterReportRows(rows,type,filters){
  validateRange(filters.from,filters.to);
  return rows.filter(row=>{
    if(!['patients','inventory'].includes(type)&&(row.date<filters.from||row.date>filters.to||!row.date))return false;
    return ['college','clinic','status','personType','classSession','sex','category','stock'].every(key=>!filters[key]||label(row[key])===filters[key])&&(!filters.search||Object.values(row).some(v=>String(v??'').toLowerCase().includes(filters.search.toLowerCase())));
  });
}
export function groupReportRows(rows,{group='month',split='',measure='count'}){
  const groups=new Map();
  const keyFor=(row,key)=>{
    if(key==='month')return row.date?.slice(0,7)||'Not recorded';
    if(key==='week'&&validDay(row.date))return offsetDay(row.date,-((new Date(row.date+'T00:00:00Z').getUTCDay()+6)%7));
    return label(row[key]);
  };
  for(const row of rows){
    const a=keyFor(row,group),b=split?keyFor(row,split):'';
    // Structured keys avoid collisions when data itself contains separators.
    const key=JSON.stringify([a,b]);
    if(!groups.has(key))groups.set(key,{group:a,split:b,value:0,patients:new Set()});
    const bucket=groups.get(key);
    if(measure==='patients'){if(row.patientId!=null)bucket.patients.add(row.patientId);bucket.value=bucket.patients.size;}
    else bucket.value+=measure==='value'?Number(row.value||0):1;
  }
  return [...groups.values()].map(({patients,...row})=>row).sort((a,b)=>a.group.localeCompare(b.group)||a.split.localeCompare(b.split));
}

// A completed booking and its linked treatment describe one clinical visit.
export function clinicalVisitEvents(appointments,treatments){
  const completed=appointments.filter(a=>a.status==='Completed'&&!a.archived);
  const linked=new Map(completed.map(a=>[a.id,a]));
  const used=new Set();
  const events=completed.map(a=>({...a,amount:1}));
  for(const t of treatments.filter(t=>!t.archived)){
    if(t.appointmentId&&linked.has(t.appointmentId))continue;
    const key=t.appointmentId?`appointment:${t.appointmentId}`:`treatment:${t.id}`;
    if(used.has(key))continue;
    used.add(key);events.push({...t,amount:1});
  }
  return events;
}
export function buildForecast(events,{from,to,today,weeks=4,method='average'}){
  validateRange(from,to);
  if(!validDay(today)||to>today)throw new Error('The history end date must be today or earlier.');
  if(![4,8,12].includes(Number(weeks))||!['average','weekday'].includes(method))throw new Error('Choose a supported forecast period and method.');
  const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  if(days>3660)throw new Error('Choose at most 10 years of history.');
  const selected=events.filter(e=>validDay(e.date)&&e.date>=from&&e.date<=to&&Number(e.amount)>0);
  const total=selected.reduce((sum,e)=>sum+Number(e.amount),0);
  const lastDate=selected.map(e=>e.date).sort().at(-1)||null;
  const base={from,to,days,total,records:selected.length,lastDate,weeks:Number(weeks),method,rows:[],history:[]};
  // Zero-activity dates stay in the denominator; missing history is never manufactured.
  const daily=new Map();selected.forEach(e=>daily.set(e.date,(daily.get(e.date)||0)+Number(e.amount)));
  const weekdays=Array.from({length:7},()=>({days:0,total:0}));
  for(let day=from;day<=to;day=offsetDay(day,1)){
    const w=new Date(day+'T00:00:00Z').getUTCDay();weekdays[w].days++;weekdays[w].total+=daily.get(day)||0;
  }
  for(let i=Math.max(0,days-56);i<days;i+=7){
    const start=offsetDay(from,i),end=offsetDay(from,Math.min(i+6,days-1));let amount=0;
    for(let day=start;day<=end;day=offsetDay(day,1))amount+=daily.get(day)||0;
    base.history.push({start,end,amount});
  }
  if(days<14||selected.length<3)return {...base,reason:'Choose at least 14 days of history with 3 or more recorded events.'};
  const rows=Array.from({length:Number(weeks)},(_,i)=>{
    const start=offsetDay(today,1+i*7),end=offsetDay(start,6);let amount=0;
    for(let j=0;j<7;j++){
      const w=new Date(offsetDay(start,j)+'T00:00:00Z').getUTCDay();
      amount+=method==='weekday'?weekdays[w].total/Math.max(1,weekdays[w].days):total/days;
    }
    return {start,end,amount:Math.round(amount*10)/10};
  });
  return {...base,rows,projected:Math.round(rows.reduce((s,r)=>s+r.amount,0)),dailyAverage:total/days,historyQuality:days>=56&&selected.length>=30?'More history available':'Limited history'};
}
