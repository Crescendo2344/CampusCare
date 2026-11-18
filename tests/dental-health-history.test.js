// Dental Health History: the shared rules and the real Edge Function with an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DHH_QUESTIONS,DHH_SECTIONS,cleanHealthHistory,dhhAlerts,healthHistoryStatus,semesterKey,unansweredCount} from '../supabase/functions/_shared/dental-health-history.js';

test('the form has the paper form\'s 48 questions in seven sections',()=>{
  assert.equal(DHH_QUESTIONS.length,48);
  assert.deepEqual(DHH_QUESTIONS.map(q=>q.n),Array.from({length:48},(_,i)=>i+1));
  assert.deepEqual(DHH_SECTIONS.map(s=>s.id),['I','II','III','IV','V','VI','VII']);
  assert.equal(DHH_QUESTIONS.filter(q=>q.women).map(q=>q.n).join(),'46,47');
});

test('answers are Yes, No or blank; follow-up lines only with a Yes; women-only questions follow the patient\'s sex',()=>{
  const raw={answers:{1:'Yes',3:'Yes',4:'No',43:'Yes',46:'Yes',99:'Yes',2:'maybe'},details:{hospitalized_why:'  Dengue  2025 ',physician_for:'should be dropped',medicines:'Aspirin',physician_name:'Dr. X'},height_cm:'158.44',weight_kg:'abc'};
  const male=cleanHealthHistory(raw,{female:false});
  assert.deepEqual(male.answers,{1:'Yes',3:'Yes',4:'No',43:'Yes'});
  assert.deepEqual(male.details,{hospitalized_why:'Dengue 2025',medicines:'Aspirin'});
  assert.equal(male.height_cm,158.4);assert.equal(male.weight_kg,null);
  assert.equal(cleanHealthHistory(raw).answers[46],'Yes');
  assert.equal(unansweredCount({1:'Yes'},{female:false}),45);assert.equal(unansweredCount({1:'Yes'}),47);
});

test('alerts: a Yes on items to check before treatment, or general health not good',()=>{
  assert.deepEqual(dhhAlerts({1:'No',12:'Yes',13:'Yes',43:'Yes',46:'No'}).map(a=>a.n),[1,12,43]);
  assert.deepEqual(dhhAlerts({1:'Yes'}),[]);
});

test('status per visit: done, confirm (answered this semester) or needed',()=>{
  const settings={semester_start:'2026-08-10',semester_end:'2026-12-18',semester2_start:'2027-01-11',semester2_end:'2027-05-28'};
  assert.equal(semesterKey('2026-11-20',settings),'2026-S1');assert.equal(semesterKey('2027-02-01',settings),'2026-S2');
  assert.equal(semesterKey('2026-07-01',{}),'2026-S1');assert.equal(semesterKey('2026-03-01',{}),'2025-S2');
  const appt={appointment_id:5,appointment_date:'2026-11-20'};
  assert.equal(healthHistoryStatus(appt,[{appointment_id:5,created_at:'2026-11-18T01:00:00Z',source:'paper'}],settings).status,'done');
  assert.equal(healthHistoryStatus(appt,[{appointment_id:2,created_at:'2026-09-01T01:00:00Z'}],settings).status,'confirm');
  assert.equal(healthHistoryStatus(appt,[{appointment_id:2,created_at:'2026-09-01T01:00:00Z',source:'paper'}],settings).status,'needed','a paper form has no answers to confirm');
  assert.equal(healthHistoryStatus({appointment_id:9,appointment_date:'2027-02-01'},[{appointment_id:2,created_at:'2026-09-01T01:00:00Z'}],settings).status,'needed','a new semester needs new answers');
});

test('browser and Edge Function share one copy of the rules',()=>{
  assert.match(readFileSync('supabase/functions/dental-health-history/index.ts','utf8'),/from '\.\.\/_shared\/dental-health-history\.js'/);
  assert.match(readFileSync('src/features/dentalHealthHistory.js','utf8'),/supabase\/functions\/_shared\/dental-health-history\.js/);
});

// ---------- Edge Function ----------
function database(){
  const tables={
    users:[{user_id:1,auth_user_id:'patient',role:'Patient',status:'Active',first_name:'Ana',last_name:'Reyes'},{user_id:2,auth_user_id:'other',role:'Patient',status:'Active'},
      {user_id:3,auth_user_id:'dental-staff',role:'Staff',status:'Active',clinic:'Dental Clinic'},{user_id:4,auth_user_id:'medical-staff',role:'Staff',status:'Active',clinic:'Medical Clinic'},
      {user_id:5,auth_user_id:'dentist',role:'Doctor',status:'Active',specialty:'Dental'},{user_id:6,auth_user_id:'physician',role:'Doctor',status:'Active',specialty:'General Medicine'},
      {user_id:7,auth_user_id:'admin',role:'Administrator',status:'Active'}],
    patients:[{patient_id:10,user_id:1,birth_date:'2004-05-06',sex:'Male'},{patient_id:20,user_id:2,sex:'Female'}],
    appointments:[{appointment_id:100,patient_id:10,clinic:'Dental Clinic',appointment_date:'2026-11-20',appointment_time:'09:00',status:'Scheduled'},
      {appointment_id:101,patient_id:10,clinic:'Dental Clinic',appointment_date:'2026-11-27',appointment_time:'09:00',status:'Scheduled'},
      {appointment_id:102,patient_id:10,clinic:'Medical Clinic',appointment_date:'2026-11-20',appointment_time:'10:00',status:'Scheduled'},
      {appointment_id:200,patient_id:20,clinic:'Dental Clinic',appointment_date:'2026-11-20',appointment_time:'11:00',status:'Scheduled'}],
    dental_health_histories:[],audit_logs:[],
    system_settings:[{settings_id:1,semester_start:'2026-08-10',semester_end:'2026-12-18',semester2_start:'2027-01-11',semester2_end:'2027-05-28'}]
  };
  let nextId=1;
  const client={tables,auth:{getUser:async token=>({data:{user:tables.users.some(u=>u.auth_user_id===token)?{id:token}:null}})},
    from(table){
      const filters=[];let sort=null,limit=Infinity,op=null,payload=null;
      const rows=()=>{let list=tables[table].filter(r=>filters.every(f=>f(r)));if(sort)list=list.slice().sort(sort);return list.slice(0,limit);};
      const run=()=>{
        if(op==='insert'){const row={history_id:nextId++,created_at:new Date().toISOString(),answers:{},details:{},reviewed_at:null,...payload};tables[table].push(row);return {data:null,error:null};}
        if(op==='update'){for(const r of rows())Object.assign(r,payload);return {data:null,error:null};}
        return {data:rows(),error:null};
      };
      const q={select(){return q;},eq(c,v){filters.push(r=>r[c]===v);return q;},in(c,v){filters.push(r=>v.includes(r[c]));return q;},
        order(c,o={}){sort=(a,b)=>(o.ascending===false?-1:1)*String(a[c]).localeCompare(String(b[c]));return q;},limit(n){limit=n;return q;},
        maybeSingle:async()=>({data:rows()[0]||null,error:null}),
        insert(p){op='insert';payload=p;return q;},update(p){op='update';payload=p;return q;},
        then(resolve,reject){return Promise.resolve(run()).then(resolve,reject);}};
      return q;
    }};
  return client;
}
async function endpoint(client){
  let handler;
  const rules=await import('../supabase/functions/_shared/dental-health-history.js');
  globalThis.__dhhClient=()=>client;globalThis.__dhhRules=rules;
  globalThis.Deno={env:{get:()=>'fixture'},serve:fn=>{handler=fn;}};
  const source=readFileSync('supabase/functions/dental-health-history/index.ts','utf8')
    .replace(/import \{createClient\} from [^;]+;/,'const createClient=globalThis.__dhhClient;')
    .replace(/import \{cleanHealthHistory[^}]*\} from [^;]+;/,'const {cleanHealthHistory,dhhAlerts,healthHistoryStatus}=globalThis.__dhhRules;');
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+'\n// '+Math.random()).toString('base64'));
  return async(who,body)=>{const r=await handler(new Request('https://fixture.test',{method:'POST',headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who}:{})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
}
const answers={1:'Yes',12:'Yes',43:'Yes'};

test('patients answer for their own dental appointment; others cannot',async()=>{
  const db=database(),call=await endpoint(db);
  assert.equal((await call(null,{action:'status',appointment_ids:[100]})).status,401);
  assert.equal((await call('other',{action:'submit',appointment_id:100,answers,attested:true})).status,403);
  assert.equal((await call('patient',{action:'submit',appointment_id:102,answers,attested:true})).status,404,'medical visits have no dental form');
  assert.equal((await call('patient',{action:'submit',appointment_id:100,answers})).status,400,'the declaration is required');
  const ok=await call('patient',{action:'submit',appointment_id:100,answers:{...answers,46:'Yes'},details:{medicines:'Aspirin daily'},attested:true,height_cm:170});
  assert.equal(ok.status,200);
  const row=db.tables.dental_health_histories[0];
  assert.deepEqual(row.answers,answers,'women-only answers are dropped for a male patient');
  assert.equal(row.source,'online');assert.equal(row.details.medicines,'Aspirin daily');
  assert.equal(db.tables.patients[0].height_cm,170,'height keeps the patient record current');
  assert.equal(db.tables.audit_logs.at(-1).action,'DENTAL_HISTORY_SUBMITTED');
  assert.equal(JSON.stringify(db.tables.audit_logs).includes('Aspirin'),false,'audit entries never hold answers');
});

test('staff and administrators see only whether it is done; dentists see the answers',async()=>{
  const db=database(),call=await endpoint(db);
  await call('patient',{action:'submit',appointment_id:100,answers,attested:true});
  for(const who of ['dental-staff','admin']){
    const status=await call(who,{action:'status',appointment_ids:[100,101,102]});
    assert.equal(status.body.statuses[100].status,'done');assert.equal(status.body.statuses[101].status,'confirm');
    assert.equal(status.body.statuses[102],undefined,'medical visits are not listed');
    assert.equal(status.body.statuses[100].alerts,undefined);
    assert.equal((await call(who,{action:'get',appointment_id:100})).status,403);
  }
  assert.equal((await call('physician',{action:'get',appointment_id:100})).status,403);
  const dentist=await call('dentist',{action:'get',appointment_id:100});
  assert.deepEqual(dentist.body.alerts.map(a=>a.n),[12,43]);assert.deepEqual(dentist.body.history.answers,answers);
  assert.equal((await call('dentist',{action:'status',appointment_ids:[100]})).body.statuses[100].alerts,2);
  // The check-in form is only the header: never earlier answers.
  const form=await call('dental-staff',{action:'form',appointment_id:101});
  assert.equal(form.body.history,undefined);assert.equal(form.body.previous,undefined);assert.equal(form.body.patient.name,'Ana Reyes');
  assert.equal((await call('medical-staff',{action:'form',appointment_id:101})).status,403);
});

test('a later visit this semester is confirmed unchanged; check-in and paper fallbacks; dentist review',async()=>{
  const db=database(),call=await endpoint(db);
  await call('patient',{action:'submit',appointment_id:100,answers,attested:true});
  const get=await call('patient',{action:'get',appointment_id:101});
  assert.equal(get.body.status.status,'confirm');assert.deepEqual(get.body.previous.answers,answers);
  assert.equal((await call('patient',{action:'confirm',appointment_id:101,attested:true})).status,200);
  const copy=db.tables.dental_health_histories.find(h=>h.appointment_id===101);
  assert.equal(copy.confirmed_unchanged,true);assert.deepEqual(copy.answers,answers);
  // Check-in on the clinic's device, and the paper form.
  assert.equal((await call('patient',{action:'submit',mode:'check-in',appointment_id:100,answers,attested:true})).status,403);
  assert.equal((await call('dental-staff',{action:'submit',mode:'check-in',appointment_id:200,answers:{1:'No'},attested:true})).status,200);
  assert.equal(db.tables.dental_health_histories.find(h=>h.appointment_id===200).source,'check-in');
  assert.equal((await call('dental-staff',{action:'paper',appointment_id:200})).status,409,'already answered');
  assert.equal((await call('medical-staff',{action:'paper',appointment_id:101})).status,403);
  // Review.
  assert.equal((await call('dental-staff',{action:'review',appointment_id:100})).status,403);
  assert.equal((await call('dentist',{action:'review',appointment_id:100})).status,200);
  assert.equal(db.tables.dental_health_histories.find(h=>h.appointment_id===100).reviewed_by,5);
  // Updating answers clears the review so the dentist looks again.
  await call('patient',{action:'submit',appointment_id:100,answers:{1:'Yes'},attested:true});
  assert.equal(db.tables.dental_health_histories.find(h=>h.appointment_id===100).reviewed_at,null);
});
