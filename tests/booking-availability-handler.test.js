// Execute the deployed handler against synthetic queries: no real reservations or identities are written.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import * as rules from '../src/domain/booking-availability.js';
async function fixture({status='Active',owns=true,failure=false,count=0}={}){
 let handler,reads=0;const queries=[];
 const today=new Date(Date.now()+480*60000).toISOString().slice(0,10),date=rules.addBookingDays(today,1);
 const rows=Array.from({length:count},()=>({appointment_date:date,appointment_time:'09:00',status:'Scheduled'}));
 const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from(table){
  const filters={};const q={select(){return q;},eq(key,value){filters[key]=value;return q;},neq(key,value){queries.push({table,key,value});return q;},gte(){return q;},lte(){return q;},order(){return q;},limit(){return q;},
   async maybeSingle(){return {data:table==='users'?filters.auth_user_id?{user_id:1,role:'Patient',status}:{user_id:2,role:'Doctor',status:'Active',work_days:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],start_time:'08:00',end_time:'17:00',slot_duration:60,max_patients:20}:table==='appointments'?{appointment_id:9,patient_id:4}:table==='patients'?{user_id:owns?1:99}:{lunch_start:'12:00',lunch_end:'13:00'}};},
   async range(a,b){if(table!=='appointments')return {data:[]};reads++;return failure?{error:new Error('Private database failure')}:{data:rows.slice(a,b+1)};},then(resolve,reject){return Promise.resolve({data:[]}).then(resolve,reject);}
  };return q;
 }};
 globalThis.__availabilityClient=()=>client;globalThis.__availabilityRules=rules;globalThis.Deno={env:{get:()=> 'fixture'},serve:fn=>handler=fn};
 const source=readFileSync('supabase/functions/booking-availability/index.ts','utf8').replace(/^import[^\n]+\n/gm,'');
 await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes('const createClient=globalThis.__availabilityClient;const {addBookingDays,buildDoctorAvailability,validBookingDate}=globalThis.__availabilityRules;\n'+source)+'\n// '+Math.random()).toString('base64'));
 return {queries,get reads(){return reads;},call:(body={},auth=true)=>handler(new Request('https://fixture.test',{method:'POST',headers:auth?{Authorization:'Bearer fixture'}:{},body:JSON.stringify({doctor_id:2,from:today,to:rules.addBookingDays(today,14),...body})}))};
}
test('anonymous and inactive accounts cannot inspect availability; invalid ranges stop before reservations',async()=>{
 const f=await fixture();assert.equal((await f.call({},false)).status,401);assert.equal((await f.call({to:'2026-02-31'})).status,400);assert.equal(f.reads,0);
 assert.equal((await (await fixture({status:'Pending'})).call()).status,403);
});
test('reservations paginate beyond one API page and responses exclude patient and appointment identifiers',async()=>{
 const f=await fixture({count:1001}),response=await f.call();assert.equal(response.status,200);assert.equal(f.reads,2);
 const result=await response.json();assert(result.days.some(day=>day.openSlots===0));
 assert(!/patient_id|appointment_id|reason|user_id/.test(JSON.stringify(result)));
});
test('reschedule exclusion requires ownership and database errors fail closed',async()=>{
 const denied=await fixture({owns:false});assert.equal((await denied.call({appointment_id:9})).status,403);assert.equal(denied.reads,0);
 const own=await fixture();assert.equal((await own.call({appointment_id:9})).status,200);assert(own.queries.some(q=>q.table==='appointments'&&q.key==='appointment_id'&&q.value===9));
 const failure=await fixture({failure:true});const response=await failure.call();assert.equal(response.status,500);assert(!JSON.stringify(await response.json()).includes('Private database'));
});
