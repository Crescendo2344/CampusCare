// Execute the real Edge Function handler with a synthetic client; no live records are written.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {buildStudentReport} from '../src/domain/student-report.js';
async function endpoint(file,client){
  let handler;
  globalThis.__studentClient=()=>client;globalThis.__studentRules=buildStudentReport;
  globalThis.Deno={env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}};
  let source=readFileSync(file,'utf8').replace(/import \{\s*createClient\s*\} from [^;]+;/,'const createClient=globalThis.__studentClient;').replace(/import \{buildStudentReport\} from [^;]+;/,'const buildStudentReport=globalThis.__studentRules;');
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
 const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from(table){let lookup='';return {select(){return this;},eq(key){lookup=key;return this;},maybeSingle:async()=>({data:table==='patients'?{patient_id:9,user_id:5,archived_at:null}:lookup==='auth_user_id'?{user_id:1,role:'Staff',status:'Active'}:{user_id:5,auth_user_id:null,status:'Active'}}),update(value){updates.push({table,value});return this;},insert(){return this;},then(resolve){return Promise.resolve({error:null}).then(resolve);}};}};
 const handler=await endpoint('supabase/functions/patient-actions/index.ts',client);
 const body={action:'update',patient_id:9,first_name:'Fixture',last_name:'Student',birth_date:'2000-01-01',person_type:'Student',class_session:'Invalid'};
 assert.equal((await handler(request(body))).status,400);assert.equal(updates.length,0);
 assert.equal((await handler(request({...body,class_session:'Evening'}))).status,200);
 assert.equal(updates.find(x=>x.table==='patients').value.class_session,'Evening');
});
