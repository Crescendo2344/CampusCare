// Only authorized clinic reviewers receive signed verification images; profile photos remain separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {realApprovalUiUser} from '../src/domain/workflow-records.js';
async function fixture(role='Staff'){
  let handler;const signed=[];
  const client={auth:{getUser:async()=>({data:{user:{id:'reviewer'}}}),admin:{getUserById:async()=>({data:{user:{email_confirmed_at:'2026-10-19',app_metadata:{email_verification_skipped:true}}}})}},from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role,status:'Active'}}),order:async()=>({data:[{user_id:1,auth_user_id:'applicant',verification_selfie_url:'applicant/selfie.jpg',id_file_url:'applicant/id.png',id_back_file_url:'applicant/back.png'}]})};},storage:{from(bucket){return {createSignedUrl:async(path,seconds)=>{signed.push({bucket,path,seconds});return {data:{signedUrl:'https://private.test/'+path}};}};}}};
  globalThis.__approvalClient=()=>client;globalThis.Deno={env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}};
  const source=readFileSync('supabase/functions/admin-approvals/index.ts','utf8').replace(/^import[^\n]+\n/gm,'');
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes('const createClient=globalThis.__approvalClient;\n'+source)+'\n// '+Math.random()).toString('base64'));
  const call=auth=>handler(new Request('https://fixture.test',{headers:auth?{Authorization:'Bearer fixture'}:{}}));
  return {call,signed};
}
test('clinic reviewers can compare private verification selfies and documents without promoting selfies to avatars',async()=>{
  const f=await fixture();const r=await f.call(true);assert.equal(r.status,200);const {users}=await r.json();
  assert.deepEqual(f.signed.map(x=>[x.bucket,x.seconds]),[['campuscare-verification',900],['campuscare-verification',900],['campuscare-verification',900]]);
  const mapped=realApprovalUiUser(users[0]);assert.equal(mapped.verificationSelfie,'https://private.test/applicant/selfie.jpg');assert.equal(mapped.profilePhoto,'');assert.equal(mapped.idBackData,'https://private.test/applicant/back.png');assert.equal(mapped.emailVerificationSkipped,true);
  assert.equal(realApprovalUiUser({profile_signed_url:'legacy-selfie'}).verificationSelfie,'legacy-selfie');
});
test('unauthenticated users and patients cannot request signed verification images',async()=>{
  const f=await fixture('Patient');assert.equal((await f.call(false)).status,401);assert.equal((await f.call(true)).status,403);assert.equal(f.signed.length,0);
});
