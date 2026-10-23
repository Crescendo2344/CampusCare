// Execute the real Edge Function handler with a synthetic client; no live records are written.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {buildStudentReport} from '../src/domain/student-report.js';
import {authRedirect} from '../supabase/functions/_shared/app-url.js';
import {registrationDetailErrors} from '../supabase/functions/_shared/registration-validation.js';
import {normalizePhilippineMobile} from '../supabase/functions/_shared/contact-validation.js';
async function endpoint(file,client){
  let handler;
  globalThis.__studentClient=()=>client;globalThis.__studentRules=buildStudentReport;globalThis.__authRedirect=authRedirect;globalThis.__registrationRules=registrationDetailErrors;globalThis.__phone=normalizePhilippineMobile;
  globalThis.Deno={env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}};
  let source=readFileSync(file,'utf8').replace(/import \{\s*createClient\s*\} from [^;]+;/,'const createClient=globalThis.__studentClient;').replace(/import \{buildStudentReport\} from [^;]+;/,'const buildStudentReport=globalThis.__studentRules;').replace(/import \{authRedirect\} from [^;]+;/,'const authRedirect=globalThis.__authRedirect;').replace(/import \{registrationDetailErrors\} from [^;]+;/,'const registrationDetailErrors=globalThis.__registrationRules;').replace(/import \{normalizePhilippineMobile\} from [^;]+;/,'const normalizePhilippineMobile=globalThis.__phone;');
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+'\n// '+Math.random()).toString('base64'));
  return handler;
}
const request=(body,auth=true)=>new Request('https://fixture.test',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});
const range={from:'2026-10-01',to:'2026-10-14'};
test('student endpoint rejects unauthenticated users and doctors; paginates beyond 1,000 accounts',async()=>{
 let role='Doctor',reads=0;
 const students=Array.from({length:1001},(_,i)=>({user_id:i+1,role:'Patient',person_type:'Student',status:'Active',college:'COE',created_at:'2026-09-01'}));
 const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from(table){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role,status:'Active'}}),order(){return this;},range:async(a,b)=>{reads++;return {data:table==='users'?students.slice(a,b+1):[]};}};}};
 const handler=await endpoint('supabase/functions/student-reports/index.ts',client);
 assert.equal((await handler(request(range,false))).status,401);assert.equal((await handler(request(range))).status,403);assert.equal(reads,0);
 role='Staff';const response=await handler(request(range));assert.equal(response.status,200);const result=await response.json();assert.equal(result.report.registered,1001);assert.equal(result.report.unknownCoverage,1001);assert(reads>=6);
});
test('student endpoint rejects invalid filters before roster reads and reports database errors',async()=>{
 let reads=0;
 const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role:'Administrator',status:'Active'}}),order(){return this;},range:async()=>{reads++;return {error:new Error('Fixture query failed')};}};}};
 const handler=await endpoint('supabase/functions/student-reports/index.ts',client);
 assert.equal((await handler(request({...range,classSession:'Invalid'}))).status,400);assert.equal(reads,0);
 assert.match((await (await handler(request(range))).json()).error,/Fixture query failed/);
});
test('patient endpoint validates class session and persists explicit values under existing staff authorization',async()=>{
 const updates=[];
 const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from(table){let lookup='';return {select(){return this;},neq(){return this;},eq(key){lookup=key;return this;},maybeSingle:async()=>({data:table==='patients'?{patient_id:9,user_id:5,archived_at:null}:lookup==='id_number'?null:lookup==='auth_user_id'?{user_id:1,role:'Staff',status:'Active'}:{user_id:5,auth_user_id:null,status:'Active'}}),update(value){updates.push({table,value});return this;},insert(){return this;},then(resolve){return Promise.resolve({error:null}).then(resolve);}};}};
 const handler=await endpoint('supabase/functions/patient-actions/index.ts',client);
 const body={action:'update',patient_id:9,first_name:'Fixture',last_name:'Student',birth_date:'2000-01-01',person_type:'Student',college:'CCICT',sex:'Male',id_number:'1234567',class_session:'Invalid'};
 assert.equal((await handler(request(body))).status,400);assert.equal(updates.length,0);
 assert.equal((await handler(request({...body,class_session:'Evening'}))).status,200);
 assert.equal(updates.find(x=>x.table==='patients').value.class_session,'Evening');
});
test('clinic-assisted registration validates fields, needs selfie and both ID sides, and leaves the email unverified',async()=>{
  const created=[],uploads=[],resets=[],userUpdates=[];
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const other=pixel.replace('kgAAAAB','kgAAAAC');
  const query=table=>{let lookup='';return {select(){return this;},eq(key){lookup=key;return this;},ilike(){return this;},order(){return this;},
    limit(){const chain=this;return {then:(resolve,reject)=>Promise.resolve({data:[]}).then(resolve,reject),maybeSingle:()=>chain.maybeSingle()};},
    maybeSingle:async()=>({data:table==='patients'?{patient_id:40}:table==='system_settings'?{privacy_policy_version:'2.0'}:lookup==='auth_user_id'&&created.length?{user_id:30}:{user_id:1,role:'Staff',status:'Active'}}),
    update(value){if(table==='users')userUpdates.push(value);return this;},insert:async()=>({error:null}),delete(){return this;},
    then(resolve){return Promise.resolve({error:null}).then(resolve);}};};
  const client={from:query,
    auth:{getUser:async()=>({data:{user:{id:'staff'}}}),resetPasswordForEmail:async(email,options)=>{resets.push({email,options});return {error:null};},
      admin:{createUser:async body=>{created.push(body);return {data:{user:{id:'new-auth'}}};},deleteUser:async()=>({})}},
    storage:{from:()=>({upload:async(path,bytes,options)=>{uploads.push({path,type:options.contentType});return {error:null};}})}};
  const handler=await endpoint('supabase/functions/patient-actions/index.ts',client);
  const valid={action:'create_assisted',first_name:'Ana',last_name:'Reyes',email:'ana.reyes@gmail.com',username:'ana.reyes',id_number:'1350098',person_type:'Student',college:'CCICT',class_session:'Morning',birth_date:'2004-05-06',sex:'Female',contact_number:'+639171234567',privacy_acknowledged:true,selfie_data_url:pixel,id_front_data_url:pixel,id_back_data_url:other};
  const bad=await handler(request({...valid,first_name:'4na',id_number:'135',class_session:'Mixed'}));
  assert.equal(bad.status,400);assert.deepEqual(Object.keys((await bad.json()).field_errors).sort(),['class_session','first_name','id_number']);
  assert.equal((await handler(request({...valid,id_back_data_url:''}))).status,400,'Both ID sides are required');
  assert.equal(created.length,0);
  const ok=await handler(request(valid));
  assert.equal(ok.status,200);assert.equal((await ok.json()).verification_email_sent,true);
  assert.equal(created[0].email_confirm,false,'Assisted accounts must verify their email like public sign-ups');
  assert.equal(created[0].user_metadata.registration_context,'public');
  assert.equal(created[0].user_metadata.contact_number,'09171234567');
  assert.deepEqual(uploads.map(u=>u.path),['new-auth/selfie-verification.png','new-auth/id-front.png','new-auth/id-back.png']);
  assert.equal(userUpdates[0].id_back_file_url,'new-auth/id-back.png');assert.equal(userUpdates[0].profile_image_url,null);
  assert.equal(resets[0].email,'ana.reyes@gmail.com');assert.match(resets[0].options.redirectTo,/\?auth=recovery$/);
});
