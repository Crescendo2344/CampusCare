import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {academicYearFor,validateAcademicYear} from '../src/domain/academic-year.js';
import {requestCamera,cameraStartupMessage} from '../src/verification/camera-startup.js';
const dates={semesterStart:'2026-08-01',semesterEnd:'2026-12-20',semester2Start:'2027-01-10',semester2End:'2027-05-30'};
test('school years require real chronological dates across consecutive years',()=>{
 assert.equal(academicYearFor(dates),'2026-2027');assert.equal(validateAcademicYear(dates,'2026-2027'),'');
 for(const changes of [{semester2Start:'2026-11-01'},{semesterEnd:'2026-02-30'},{semester2End:'2026-12-30'}])assert(validateAcademicYear({...dates,...changes},'2026-2027'));
 assert(validateAcademicYear(dates,'2026-2028'));
 assert.equal(readFileSync('src/domain/academic-year.js','utf8'),readFileSync('supabase/functions/_shared/academic-year.js','utf8'));
});
test('camera falls back through unsupported constraints without repeating denied permissions',async()=>{
 const attempts=[];const stream={};assert.equal(await requestCamera({getUserMedia:async c=>{attempts.push(c);if(attempts.length<3)throw {name:'OverconstrainedError'};return stream;}},false),stream);
 assert.equal(attempts.length,3);assert.equal(attempts[2].video,true);assert(attempts.every(a=>a.audio===false));
 let calls=0;await assert.rejects(requestCamera({getUserMedia:async()=>{calls++;throw Object.assign(new Error(),{name:'NotAllowedError'});}},true));assert.equal(calls,1);
 assert.match(cameraStartupMessage({name:'NotAllowedError'}),/blocked/);assert.match(cameraStartupMessage({name:'NotReadableError'}),/busy/);
});
async function fixture(role='Administrator'){
 let handler,writes=0;const current={settings_id:1,clinic_name:'Clinic',address:'Campus',contact_email:'clinic@example.test',contact_number:'123',semester_start:'2026-01-01',semester_end:'2026-06-30',semester2_start:'2026-07-01',semester2_end:'2026-12-31',dental_visit_limit_per_semester:1,appointment_reminder_days:1};
 const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},from(table){let patch;const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},maybeSingle:async()=>({data:table==='users'?{user_id:1,status:'Active',role}:current}),update(value){patch=value;writes++;return q;},single:async()=>({data:{...current,...patch}}),insert:async()=>({})};return q;}};
 globalThis.__settingsClient=()=>client;globalThis.__academic={academicYearFor,validateAcademicYear};globalThis.Deno={env:{get:()=> 'fixture'},serve:fn=>handler=fn};
 const source=readFileSync('supabase/functions/settings-actions/index.ts','utf8').replace(/^import[^\n]+\n/gm,'');
 await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes('const createClient=globalThis.__settingsClient;const {academicYearFor,validateAcademicYear}=globalThis.__academic;\n'+source)+'\n//'+Math.random()).toString('base64'));
 return {get writes(){return writes;},call:(body={},auth=true)=>handler(new Request('https://fixture.test',{method:'POST',headers:auth?{Authorization:'Bearer fixture'}:{},body:JSON.stringify({action:'update',...body})}))};
}
test('critical settings enforce authorization and explicit confirmation before writing',async()=>{
 let f=await fixture();assert.equal((await f.call({},false)).status,401);assert.equal((await f.call({clinic_name:'Changed'})).status,409);assert.equal(f.writes,0);
 assert.equal((await f.call({clinic_name:'Changed',critical_confirmation:true})).status,200);assert.equal(f.writes,1);
 f=await fixture('Patient');assert.equal((await f.call({critical_confirmation:true})).status,403);assert.equal(f.writes,0);
});
test('semester updates validate the school year while unrelated privacy changes preserve old dates',async()=>{
 const f=await fixture();assert.equal((await f.call({privacy_policy_version:'2.0'})).status,200);
 const body={semester_start:dates.semesterStart,semester_end:dates.semesterEnd,semester2_start:dates.semester2Start,semester2_end:dates.semester2End,critical_confirmation:true};
 assert.equal((await f.call(body)).status,400);assert.equal(f.writes,1);
 const response=await f.call({...body,academic_year:'2026-2027'});assert.equal(response.status,200);assert.equal((await response.json()).settings.clinic_name,'Clinic');
});
