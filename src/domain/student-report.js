// Shared reporting rules run identically in the browser fixtures and the authenticated endpoint.
export function buildStudentReport(data,filters={}){
  const from=String(filters.from||''),to=String(filters.to||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw new Error('Choose a valid report date range.');
  const actualDate=value=>{const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;};
  if(!actualDate(from)||!actualDate(to))throw new Error('Choose valid calendar dates.');
  for(const [key,values] of Object.entries({history:['','range','all'],registration:['','snapshot','range'],archive:['','current','all','archived'],dental:['','used','not','unknown'],medical:['','used','not'],verified:['','yes','no'],sex:['','Male','Female','Other','Unknown'],status:['','Active','Pending','Suspended','Archived']})){
    if(!values.includes(filters[key]||''))throw new Error('Invalid '+key+' filter.');
  }
  const valid=['','Morning','Evening','Mixed','Unknown'];
  if(!valid.includes(filters.classSession||''))throw new Error('Invalid class session.');
  const min=filters.minAge===''||filters.minAge==null?null:Number(filters.minAge);
  const max=filters.maxAge===''||filters.maxAge==null?null:Number(filters.maxAge);
  if([min,max].some(v=>v!==null&&(!Number.isInteger(v)||v<0||v>150))||(min!==null&&max!==null&&min>max))throw new Error('Enter a valid age range.');
  const patients=new Map((data.patients||[]).map(p=>[Number(p.user_id),p]));
  const treatments=new Map((data.treatments||[]).map(t=>[Number(t.treatment_id),t]));
  const dentalIds=new Set((data.dentalRecords||[]).map(d=>Number(d.treatment_id)));
  const appointments=new Map((data.appointments||[]).map(a=>[Number(a.appointment_id),a]));
  const visits=new Map();
  const inRange=date=>!!date&&date<=to&&(filters.history==='all'||date>=from);
  function record(patientId,clinic,date,key){
    if(!inRange(String(date||'').slice(0,10)))return;
    const row=visits.get(Number(patientId))||{dental:new Set(),medical:new Set(),lastDental:''};
    row[clinic].add(key);
    if(clinic==='dental'&&date>row.lastDental)row.lastDental=date;
    visits.set(Number(patientId),row);
  }
  // Pending, cancelled and no-show bookings never count as services availed.
  for(const a of appointments.values())if(a.status==='Completed')record(a.patient_id,a.clinic==='Dental Clinic'?'dental':'medical',a.appointment_date,'a'+a.appointment_id);
  for(const t of treatments.values())if(!t.archived_at&&!['Archived','Cancelled','Rejected'].includes(t.status)){
    const appointment=appointments.get(Number(t.appointment_id));
    const dental=dentalIds.has(Number(t.treatment_id))||appointment?.clinic==='Dental Clinic';
    record(t.patient_id,dental?'dental':'medical',t.treatment_date,t.appointment_id?'a'+t.appointment_id:'t'+t.treatment_id);
  }
  for(const d of data.dentalRecords||[]){
    const t=treatments.get(Number(d.treatment_id));
    if(t&&(t.archived_at||['Archived','Cancelled','Rejected'].includes(t.status)))continue;
    record(d.patient_id,'dental',d.record_date,t?.appointment_id?'a'+t.appointment_id:'t'+d.treatment_id);
  }
  const rows=[];
  for(const u of data.users||[]){
    if(u.person_type!=='Student'||u.role!=='Patient')continue;
    const p=patients.get(Number(u.user_id)),registered=String(u.created_at||'').slice(0,10);
    const archived=!!p?.archived_at||u.status==='Archived';
    if(registered&&registered>to)continue;
    if(filters.registration==='range'&&(!registered||registered<from))continue;
    if((filters.archive||'current')==='current'&&archived)continue;
    if(filters.archive==='archived'&&!archived)continue;
    const classSession=valid.includes(p?.class_session)&&p?.class_session?p.class_session:'Unknown';
    const college=u.college||'Unknown',sex=p?.sex||'Unknown';
    let age=null;
    if(p?.birth_date){
      const birth=new Date(p.birth_date+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');
      age=end.getUTCFullYear()-birth.getUTCFullYear();
      if(to.slice(5)<p.birth_date.slice(5))age--;
      if(!Number.isFinite(age)||age<0)age=null;
    }
    if(filters.college&&college!==filters.college)continue;
    if(filters.classSession&&classSession!==filters.classSession)continue;
    if(filters.sex&&sex!==filters.sex)continue;
    if(filters.status&&u.status!==filters.status)continue;
    if(filters.verified==='yes'&&!u.verified||filters.verified==='no'&&u.verified)continue;
    if(min!==null&&(age===null||age<min)||max!==null&&(age===null||age>max))continue;
    const name=[u.first_name,u.last_name].filter(Boolean).join(' ');
    if(filters.search&&!`${name} ${u.id_number||''}`.toLowerCase().includes(String(filters.search).toLowerCase().trim()))continue;
    const care=visits.get(Number(p?.patient_id))||{dental:new Set(),medical:new Set(),lastDental:''};
    rows.push({userId:Number(u.user_id),patientId:p?.patient_id||null,name,idNumber:u.id_number||'',college,classSession,sex,age,status:u.status,verified:!!u.verified,registered,archived,dentalVisits:care.dental.size,medicalVisits:care.medical.size,lastDental:care.lastDental,coverageKnown:!!p});
  }
  // Registration denominators use demographic filters, before dental/medical-use filters.
  const collegeMap=new Map((filters.college?[filters.college]:['CCICT','COE','COED','CME','CAS','COT']).map(college=>[college,{college,registered:0,dentalUsed:0,dentalNotUsed:0,unknownCoverage:0,morning:0,evening:0,mixed:0,unknownSession:0}]));
  for(const row of rows){
    const c=collegeMap.get(row.college)||{college:row.college,registered:0,dentalUsed:0,dentalNotUsed:0,unknownCoverage:0,morning:0,evening:0,mixed:0,unknownSession:0};
    c.registered++;if(!row.coverageKnown)c.unknownCoverage++;else if(row.dentalVisits)c.dentalUsed++;else c.dentalNotUsed++;
    c[{Morning:'morning',Evening:'evening',Mixed:'mixed',Unknown:'unknownSession'}[row.classSession]]++;
    collegeMap.set(row.college,c);
  }
  const filtered=rows.filter(row=>{
    if(filters.dental==='used'&&(!row.coverageKnown||!row.dentalVisits))return false;
    if(filters.dental==='not'&&(!row.coverageKnown||row.dentalVisits))return false;
    if(filters.dental==='unknown'&&row.coverageKnown)return false;
    if(filters.medical==='used'&&(!row.coverageKnown||!row.medicalVisits))return false;
    if(filters.medical==='not'&&(!row.coverageKnown||row.medicalVisits))return false;
    return true;
  }).sort((a,b)=>a.college.localeCompare(b.college)||a.name.localeCompare(b.name)||a.userId-b.userId);
  const colleges=[...collegeMap.values()].sort((a,b)=>a.college.localeCompare(b.college));
  return {rows:filtered,colleges,registered:rows.length,matched:filtered.length,dentalUsed:rows.filter(r=>r.coverageKnown&&r.dentalVisits).length,dentalNotUsed:rows.filter(r=>r.coverageKnown&&!r.dentalVisits).length,unknownCoverage:rows.filter(r=>!r.coverageKnown).length,unknownSession:rows.filter(r=>r.classSession==='Unknown').length,filters};
}
