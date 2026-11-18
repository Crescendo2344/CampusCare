// Saturday clinic visit log: everyone seen on a Saturday, one sheet per Saturday, laid out like the
// clinic's paper log (Time, Name, Course and year/Position, Age, Gender, Contact number, Treatment,
// Signature). The same file runs in the browser (demo data) and in the saturday-visit-log Edge Function.
// A visit is a completed appointment, or a treatment recorded without one (a walk-in); a treatment
// written for a completed appointment is the same visit and is not counted twice.
export const SATURDAY_LOG_CLINICS=['Dental Clinic','Medical Clinic'];
export const SATURDAY_LOG_MAX_DAYS=400;
const MONTHS=['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sep.','Oct.','Nov.','Dec.'];
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const day=value=>String(value||'').slice(0,10);
const validDay=value=>DAY.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const isSaturday=value=>validDay(value)&&new Date(value+'T00:00:00Z').getUTCDay()===6;

// "2026-11-14" → "Nov. 14, 2026 Saturday", as the clinic writes the date on its log sheet (plus the year).
export function saturdayLabel(value){
  const [y,m,d]=value.split('-').map(Number);
  return `${MONTHS[m-1]} ${d}, ${y} Saturday`;
}
// "09:30" → "9:30 AM".
export function clockTime(value){
  const match=/^(\d{1,2}):(\d{2})/.exec(String(value||''));
  if(!match)return '';
  const h=Number(match[1]),suffix=h<12?'AM':'PM';
  return `${h%12||12}:${match[2]} ${suffix}`;
}
// Age in whole years on the visit date.
export function ageOn(birthDate,visitDate){
  if(!validDay(day(birthDate))||!validDay(visitDate))return null;
  const [by,bm,bd]=day(birthDate).split('-').map(Number),[vy,vm,vd]=visitDate.split('-').map(Number);
  const age=vy-by-(vm<bm||(vm===bm&&vd<bd)?1:0);
  return age>=0&&age<150?age:null;
}
const gender=sex=>{const s=String(sex||'').trim();return /^m(ale)?$/i.test(s)?'M':/^f(emale)?$/i.test(s)?'F':s;};
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();

// The time a walk-in treatment was written down, in Philippine time, when it was written that same day.
function manilaClock(timestamp,visitDate){
  const date=new Date(timestamp||'');
  if(Number.isNaN(date.getTime()))return '';
  const local=new Date(date.getTime()+8*3600000).toISOString();
  return local.slice(0,10)===visitDate?local.slice(11,16):'';
}

export function saturdayLogFilterError(filters={},staffClinic=''){
  const {from,to}=filters;
  if(!validDay(from)||!validDay(to))return 'Choose a valid date range.';
  if(from>to)return 'The start date must be on or before the end date.';
  if((Date.parse(to)-Date.parse(from))/86400000>SATURDAY_LOG_MAX_DAYS)return 'Choose a date range of about one year or less.';
  if(filters.clinic&&!SATURDAY_LOG_CLINICS.includes(filters.clinic))return 'Choose a supported clinic.';
  if(staffClinic&&filters.clinic&&filters.clinic!==staffClinic)return 'You can only view your own clinic\'s visits.';
  if(filters.people&&!['students','everyone'].includes(filters.people))return 'Choose who to include.';
  return '';
}

/**
 * @param {{users?:any[],patients?:any[],appointments?:any[],treatments?:any[],dentalRecords?:any[]}} data database rows
 * @param {{from:string,to:string,clinic?:string,college?:string,people?:'students'|'everyone'}} filters
 */
export function buildSaturdayVisitLog(data,filters){
  const error=saturdayLogFilterError(filters);
  if(error)throw new Error(error);
  const {from,to}=filters,clinic=filters.clinic||'',college=filters.college||'',studentsOnly=(filters.people||'students')==='students';
  const users=new Map((data.users||[]).map(u=>[Number(u.user_id),u]));
  const patients=new Map((data.patients||[]).map(p=>[Number(p.patient_id),p]));
  const appointments=new Map((data.appointments||[]).map(a=>[Number(a.appointment_id),a]));
  const dentalByTreatment=new Map((data.dentalRecords||[]).filter(d=>d.treatment_id!=null).map(d=>[Number(d.treatment_id),d]));
  const inRange=date=>isSaturday(date)&&date>=from&&date<=to;
  const clinicOfDoctor=id=>{const doctor=users.get(Number(id));return doctor?.specialty==='Dental'?'Dental Clinic':doctor?'Medical Clinic':'';};

  // One entry per visit: the appointment, with the treatment written for it when there is one.
  const visits=new Map();
  for(const a of data.appointments||[]){
    const date=day(a.appointment_date);
    if(a.status!=='Completed'||!inRange(date))continue;
    visits.set('a'+a.appointment_id,{date,patientId:a.patient_id,clinic:a.clinic||'',service:a.service||'',time:String(a.appointment_time||'').slice(0,5),treatment:null});
  }
  for(const t of data.treatments||[]){
    if(t.archived_at)continue;
    const linked=t.appointment_id!=null?visits.get('a'+t.appointment_id):null;
    const dental=dentalByTreatment.get(Number(t.treatment_id));
    if(linked){if(!linked.treatment)linked.treatment={...t,dental};continue;}
    // A treatment for an appointment that was not completed on a Saturday belongs to that appointment.
    if(t.appointment_id!=null&&appointments.has(Number(t.appointment_id)))continue;
    const date=day(t.treatment_date);
    if(!inRange(date))continue;
    visits.set('t'+t.treatment_id,{date,patientId:t.patient_id,clinic:dental?'Dental Clinic':clinicOfDoctor(t.doctor_id),service:'',
      time:manilaClock(t.created_at,date),treatment:{...t,dental}});
  }

  const days=new Map();
  for(const visit of visits.values()){
    if(clinic&&visit.clinic!==clinic)continue;
    const patient=patients.get(Number(visit.patientId))||{},user=users.get(Number(patient.user_id))||{};
    const personType=clean(user.person_type);
    if(studentsOnly&&personType!=='Student')continue;
    const userCollege=clean(user.college)||'Unknown';
    if(college&&userCollege!==college)continue;
    const dental=visit.treatment?.dental||null;
    // Students: course and year as the dental record took them, otherwise the patient's course.
    // Personnel: their position.
    const course=personType==='Student'
      ?(clean([clean(dental?.course_major)||clean([patient.course,patient.major].filter(Boolean).join(' – ')),clean(dental?.year_section)].filter(Boolean).join(' '))||clean(user.college))
      :personType;
    const done=(Array.isArray(dental?.accomplishment)?dental.accomplishment:[])
      .map(item=>clean([item?.nature,item?.tooth_no?`#${clean(item.tooth_no)}`:''].filter(Boolean).join(' '))).filter(Boolean);
    const treatment=done.length?[...new Set(done)].join(', '):clean(visit.service)||(visit.clinic==='Dental Clinic'?'Dental visit':'Medical consultation');
    const name=[clean(user.last_name),clean(user.first_name)].filter(Boolean).join(', ')||'Not recorded';
    const row={time:clockTime(visit.time),sortTime:visit.time||'99:99',name,course,age:ageOn(patient.birth_date,visit.date),gender:gender(patient.sex),
      contact:clean(user.contact_number),treatment,clinic:visit.clinic||'Not recorded',idNumber:clean(user.id_number)};
    if(!days.has(visit.date))days.set(visit.date,[]);
    days.get(visit.date).push(row);
  }
  const list=[...days.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>({
    date,label:saturdayLabel(date),
    rows:rows.sort((a,b)=>a.sortTime.localeCompare(b.sortTime)||a.name.localeCompare(b.name)).map(({sortTime,...row})=>row)
  }));
  return {from,to,clinic,college,people:studentsOnly?'students':'everyone',
    saturdays:list.length,total:list.reduce((sum,d)=>sum+d.rows.length,0),days:list};
}
