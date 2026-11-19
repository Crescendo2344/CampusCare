// Saturday clinic visit log: the shared rules and the real Edge Function handler with a synthetic client.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {buildSaturdayVisitLog,saturdayLogFilterError,saturdayLabel,clockTime,ageOn,isSaturday} from '../src/domain/saturday-visit-log.js';

// 2026-11-14 and 2026-11-21 are Saturdays; 2026-11-16 is a Monday.
const data=()=>({
  users:[
    {user_id:1,first_name:'Cheika Mikaela',last_name:'Panot',person_type:'Student',college:'College of Technology',contact_number:'09175823461'},
    {user_id:2,first_name:'Juan',last_name:'Dela Cruz',person_type:'Student',college:'College of Engineering',contact_number:'09181112222'},
    {user_id:3,first_name:'Ana',last_name:'Reyes',person_type:'Teaching Personnel',college:'College of Education',contact_number:'09190000000'},
    {user_id:9,first_name:'Dent',last_name:'Ist',role:'Doctor',specialty:'Dental'},
    {user_id:10,first_name:'Med',last_name:'Doc',role:'Doctor',specialty:'General Medicine'}
  ],
  patients:[
    {patient_id:11,user_id:1,birth_date:'2004-11-15',sex:'Female',course:'BSIT'},
    {patient_id:12,user_id:2,birth_date:'2003-01-02',sex:'Male',course:'BSCE',major:'Structural'},
    {patient_id:13,user_id:3,birth_date:'1980-05-05',sex:'Female'}
  ],
  appointments:[
    {appointment_id:100,patient_id:11,clinic:'Dental Clinic',service:'Tooth Extraction',appointment_date:'2026-11-14',appointment_time:'09:30:00',status:'Completed'},
    {appointment_id:101,patient_id:12,clinic:'Dental Clinic',service:'Dental Checkup',appointment_date:'2026-11-14',appointment_time:'08:00:00',status:'Completed'},
    {appointment_id:102,patient_id:12,clinic:'Dental Clinic',service:'Oral Prophylaxis',appointment_date:'2026-11-14',appointment_time:'10:00:00',status:'Cancelled'},
    {appointment_id:103,patient_id:11,clinic:'Dental Clinic',service:'Dental Checkup',appointment_date:'2026-11-16',appointment_time:'09:00:00',status:'Completed'},
    {appointment_id:104,patient_id:13,clinic:'Medical Clinic',service:'Consultation',appointment_date:'2026-11-14',appointment_time:'13:15:00',status:'Completed'},
    {appointment_id:105,patient_id:12,clinic:'Medical Clinic',service:'General Checkup',appointment_date:'2026-11-21',appointment_time:'14:00:00',status:'Completed'}
  ],
  treatments:[
    // Written for appointment 100: same visit, adds what was done.
    {treatment_id:500,patient_id:11,doctor_id:9,appointment_id:100,treatment_date:'2026-11-14',created_at:'2026-11-14T02:00:00Z'},
    // A walk-in on Saturday 21 with no appointment, written at 10:05 Manila time.
    {treatment_id:501,patient_id:11,doctor_id:9,appointment_id:null,treatment_date:'2026-11-21',created_at:'2026-11-21T02:05:00Z'},
    // Archived walk-in: not counted.
    {treatment_id:502,patient_id:12,doctor_id:9,appointment_id:null,treatment_date:'2026-11-21',created_at:'2026-11-21T03:00:00Z',archived_at:'2026-11-22'},
    // Treatment for the cancelled booking: belongs to that appointment, not a walk-in.
    {treatment_id:503,patient_id:12,doctor_id:9,appointment_id:102,treatment_date:'2026-11-14',created_at:'2026-11-14T03:00:00Z'}
  ],
  dentalRecords:[
    {treatment_id:500,course_major:'BSIT',year_section:'3-A',accomplishment:[{nature:'Tooth extraction',tooth_no:'36'}]},
    {treatment_id:501,course_major:'',year_section:'',accomplishment:[{nature:'Oral prophylaxis',tooth_no:''}]}
  ]
});
const range={from:'2026-11-01',to:'2026-11-30'};

test('formatting helpers match the paper log',()=>{
  assert.equal(saturdayLabel('2026-11-14'),'Nov. 14, 2026 Saturday');
  assert.equal(clockTime('09:30:00'),'9:30 AM');assert.equal(clockTime('13:05'),'1:05 PM');assert.equal(clockTime('00:15'),'12:15 AM');assert.equal(clockTime(''),'');
  assert.equal(ageOn('2004-11-15','2026-11-14'),21);assert.equal(ageOn('2004-11-14','2026-11-14'),22);assert.equal(ageOn('','2026-11-14'),null);
  assert(isSaturday('2026-11-14'));assert(!isSaturday('2026-11-16'));assert(!isSaturday('2026-02-30'));
});

test('lists completed Saturday visits and walk-ins once each, by Saturday and time',()=>{
  const log=buildSaturdayVisitLog(data(),{...range,clinic:'Dental Clinic'});
  assert.equal(log.saturdays,2);assert.equal(log.total,3);
  const [first,second]=log.days;
  assert.equal(first.label,'Nov. 14, 2026 Saturday');
  assert.deepEqual(first.rows.map(r=>r.time),['8:00 AM','9:30 AM']);
  const panot=first.rows[1];
  assert.equal(panot.name,'Panot, Cheika Mikaela');assert.equal(panot.course,'BSIT 3-A');assert.equal(panot.age,21);assert.equal(panot.gender,'F');
  assert.equal(panot.contact,'09175823461');assert.equal(panot.treatment,'Tooth extraction #36');
  assert.equal(first.rows[0].course,'BSCE – Structural');assert.equal(first.rows[0].treatment,'Dental Checkup');assert.equal(first.rows[0].gender,'M');
  assert.equal(second.date,'2026-11-21');assert.equal(second.rows.length,1);
  assert.equal(second.rows[0].time,'10:05 AM');assert.equal(second.rows[0].treatment,'Oral prophylaxis');assert.equal(second.rows[0].course,'BSIT');
});

test('clinic, people and college filters',()=>{
  const both=buildSaturdayVisitLog(data(),range);
  assert.equal(both.total,4,'personnel are left out by default');
  const everyone=buildSaturdayVisitLog(data(),{...range,people:'everyone'});
  assert.equal(everyone.total,5);
  const teacher=everyone.days[0].rows.find(r=>r.name==='Reyes, Ana');
  assert.equal(teacher.course,'Teaching Personnel');assert.equal(teacher.clinic,'Medical Clinic');
  const medical=buildSaturdayVisitLog(data(),{...range,clinic:'Medical Clinic'});
  assert.deepEqual(medical.days.map(d=>d.date),['2026-11-21']);
  assert.equal(buildSaturdayVisitLog(data(),{...range,college:'College of Engineering'}).total,2);
  assert.equal(buildSaturdayVisitLog(data(),{from:'2026-11-15',to:'2026-11-20'}).total,0);
});

test('filter validation',()=>{
  assert.match(saturdayLogFilterError({from:'2026-11-30',to:'2026-11-01'}),/start date/);
  assert.match(saturdayLogFilterError({from:'2026-02-30',to:'2026-03-01'}),/valid date/);
  assert.match(saturdayLogFilterError({from:'2024-01-01',to:'2026-01-01'}),/one year/);
  assert.match(saturdayLogFilterError({...range,clinic:'Pharmacy'}),/supported clinic/);
  assert.match(saturdayLogFilterError({...range,clinic:'Medical Clinic'},'Dental Clinic'),/own clinic/);
  assert.equal(saturdayLogFilterError({...range,clinic:'Dental Clinic'},'Dental Clinic'),'');
  assert.throws(()=>buildSaturdayVisitLog({},{from:'x',to:'y'}));
});

test('browser and Edge Function use the same rules',()=>{
  assert.equal(readFileSync('src/domain/saturday-visit-log.js','utf8'),readFileSync('supabase/functions/saturday-visit-log/saturday-visit-log.js','utf8'));
});

async function endpoint(client){
  let handler;
  globalThis.__satClient=()=>client;globalThis.__satRules={buildSaturdayVisitLog,saturdayLogFilterError};
  globalThis.Deno={env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}};
  const source=readFileSync('supabase/functions/saturday-visit-log/index.ts','utf8')
    .replace(/import \{createClient\} from [^;]+;/,'const createClient=globalThis.__satClient;')
    .replace(/import \{buildSaturdayVisitLog[^}]*\} from [^;]+;/,'const {buildSaturdayVisitLog,saturdayLogFilterError}=globalThis.__satRules;');
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+'\n// '+Math.random()).toString('base64'));
  return handler;
}
function fixtureClient(actor,tables){
  const audits=[];let reads=0;
  const tableName={dentalRecords:'dental_records'};
  const rows=Object.fromEntries(Object.entries(tables).map(([k,v])=>[tableName[k]||k,v]));
  return {audits,get reads(){return reads;},auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},
    from(table){
      const filters=[];
      const run=()=>{reads++;return {data:(rows[table]||[]).filter(r=>filters.every(f=>f(r)))};};
      const q={select(){return q;},order(){return q;},eq(){return q;},maybeSingle:async()=>({data:actor}),
        gte(col,v){filters.push(r=>String(r[col])>=v);return q;},lte(col,v){filters.push(r=>String(r[col])<=v);return q;},
        in(col,list){filters.push(r=>list.map(String).includes(String(r[col])));return Promise.resolve(run());},
        range:async(a)=>a?{data:[]}:run(),insert:async row=>{audits.push(row);return {};}};
      return q;
    }};
}
const request=(body,auth=true)=>new Request('https://fixture.test',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});

test('endpoint: sign-in and role required; staff are held to their clinic',async()=>{
  let actor={user_id:7,role:'Doctor',status:'Active'};
  const client=fixtureClient(null,data());client.from=((from)=>table=>{const q=from.call(client,table);q.maybeSingle=async()=>({data:actor});return q;})(client.from);
  const handler=await endpoint(client);
  assert.equal((await handler(request(range,false))).status,401);
  assert.equal((await handler(request(range))).status,403);
  actor={user_id:7,role:'Staff',status:'Active',clinic:null};
  assert.equal((await handler(request(range))).status,403);
  actor={user_id:7,role:'Staff',status:'Active',clinic:'Medical Clinic'};
  // A staff member asking for the other clinic still only gets their own.
  let body=await (await handler(request({...range,clinic:'Dental Clinic'}))).json();
  assert(body.ok);assert.equal(body.log.clinic,'Medical Clinic');assert.equal(body.log.total,1);
  actor={user_id:7,role:'Administrator',status:'Active'};
  body=await (await handler(request({...range,clinic:'Dental Clinic'}))).json();
  assert.equal(body.log.total,3);assert.equal(body.log.days[0].rows[1].treatment,'Tooth extraction #36');
  assert.equal(client.audits.at(-1).action,'REPORT_SATURDAY_VISIT_LOG');
  assert.equal((await handler(request({from:'2026-11-30',to:'2026-11-01'}))).status,400);
});

test('endpoint reports database errors without details',async()=>{
  const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from(){const q={select(){return q;},eq(){return q;},order(){return q;},gte(){return q;},lte(){return q;},
    maybeSingle:async()=>({data:{user_id:1,role:'Administrator',status:'Active'}}),range:async()=>({error:new Error('secret table detail')})};return q;}};
  const handler=await endpoint(client);
  const response=await handler(request(range));
  assert.equal(response.status,500);assert.doesNotMatch((await response.json()).error,/secret/);
});
