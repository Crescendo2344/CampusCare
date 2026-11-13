// Execute the real administrator endpoint against synthetic Auth and database services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {buildUserEditPatch,canEditApprovedUser} from '../supabase/functions/_shared/admin-user-edit.js';
import {queueEmail} from '../supabase/functions/_shared/email-layout.js';
async function fixture({status='Active',actorRole='Administrator',actorStatus='Active',race=false,writeError=false,duplicate=false}={}){
  let handler;const writes=[],authUpdates=[],audits=[];
  const target={user_id:2,auth_user_id:'target-auth',first_name:'Original',last_name:'User',email:'original@example.test',contact_number:'09123456789',status,verified:status!=='Pending',role:'Staff'};
  const actor={user_id:1,auth_user_id:'actor-auth',role:actorRole,status:actorStatus};
  const client={auth:{getUser:async()=>({data:{user:{id:'actor-auth'}}}),admin:{updateUserById:async(id,patch)=>{authUpdates.push({id,patch});return {data:{user:{id}},error:null};}}},from(table){
    const filters={};let patch;
    const query={select(){return this;},eq(key,value){filters[key]=value;return this;},neq(){return this;},limit:async()=>({data:duplicate?[{user_id:3}]:[]}),
      update(value){patch=value;return this;},insert:async(value)=>{audits.push(value);return {error:null};},
      async maybeSingle(){
        if(!patch)return {data:filters.auth_user_id?actor:{...target}};
        writes.push(patch);if(writeError)return {error:new Error('Database unavailable')};
        if(race||filters.status&&filters.status!==target.status)return {data:null};Object.assign(target,patch);return {data:{...target}};
      },then(resolve,reject){return this.maybeSingle().then(resolve,reject);}};return query;
  }};
  globalThis.__adminEditClient=()=>client;globalThis.__adminEditPolicy=buildUserEditPatch;globalThis.__queueEmail=queueEmail;
  globalThis.Deno={env:{get:name=>name==='SUPABASE_URL'?'https://fixture.test':'fixture-server-key'},serve:fn=>handler=fn};
  const source=readFileSync('supabase/functions/admin-users/index.ts','utf8').replace(/^import[^\n]+\n/gm,'');
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes('const createClient=globalThis.__adminEditClient,buildUserEditPatch=globalThis.__adminEditPolicy,queueEmail=globalThis.__queueEmail;\n'+source)+'\n// fixture '+Math.random()).toString('base64'));
  const call=(body={})=>handler(new Request('https://fixture.test',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({action:'update',user_id:2,confirmed:true,reason:'Corrected per registrar records',...body})}));
  return {call,target,writes,authUpdates,audits};
}
test('editing is available only for approved Active or Suspended profiles',()=>{
  for(const status of ['Pending','Rejected','Archived',''])assert.equal(canEditApprovedUser({status}),false);
  assert(canEditApprovedUser({status:'Active'}));assert(canEditApprovedUser({status:'Suspended'}));assert(!canEditApprovedUser({status:'Active',archived:true}));
});
test('pending accounts cannot bypass approval through editing or reactivation',async()=>{
  for(const body of [{first_name:'Changed'},{action:'status',status:'Active'},{action:'status',status:'Suspended'},{action:'schedule'}]){
    const f=await fixture({status:'Pending'});const response=await f.call(body);assert.equal(response.status,409);assert.equal(f.writes.length,0);assert.equal(f.authUpdates.length,0);
  }
});
test('profile changes require active administrator authorization and explicit confirmation',async()=>{
  for(const opts of [{actorRole:'Staff'},{actorStatus:'Suspended'}])assert.equal((await (await fixture(opts)).call({first_name:'Changed'})).status,403);
  const f=await fixture();assert.equal((await f.call({first_name:'Changed',confirmed:false})).status,400);assert.equal(f.writes.length,0);
  for(const body of [{status:'Suspended'},{role:'Administrator'}])assert.equal((await f.call(body)).status,409);
});
test('confirmed edits save validated fields, read them back and audit without changing status',async()=>{
  const f=await fixture({status:'Suspended'});const response=await f.call({first_name:' Updated ',email:'changed@example.test',contact_number:'+639987654321'});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.user.first_name,'Updated');assert.equal(result.user.status,'Suspended');
  assert.equal(result.user.contact_number,'09987654321');assert.equal(f.target.email,'changed@example.test');assert.equal(f.authUpdates.length,1);assert.equal(f.audits[0].action,'USER_UPDATED');assert(!('status' in f.writes[0]));
  // The audit keeps before/after values and the reason; the user is told what changed.
  assert.equal(f.audits[0].details.previous_first_name,'Original');assert.equal(f.audits[0].details.new_first_name,'Updated');
  assert.equal(f.audits[0].details.reason,'Corrected per registrar records');
  assert.equal(f.audits[1].title,'Account details updated');assert.match(f.audits[1].message,/first name, email, mobile number/);
});
test('a reason is required for every account edit',async()=>{
  const f=await fixture();assert.equal((await f.call({first_name:'Changed',reason:'no'})).status,400);assert.equal(f.writes.length,0);
});
test('zero-row status races and failed writes do not report success and restore changed Auth email',async()=>{
  for(const options of [{race:true},{writeError:true}]){
    const f=await fixture(options);const response=await f.call({email:'changed@example.test'});assert.equal(response.status,409);assert.equal(f.authUpdates.length,2);assert.equal(f.authUpdates[1].patch.email,'original@example.test');assert.equal(f.audits.length,0);
  }
});
test('invalid, duplicate and unchanged updates do not write',async()=>{
  const f=await fixture();for(const body of [{first_name:''},{email:'user@gmal.com'},{contact_number:'12345'},{}])assert.notEqual((await f.call(body)).status,200);
  assert.equal(f.writes.length,0);const duplicate=await fixture({duplicate:true});assert.equal((await duplicate.call({email:'taken@example.test'})).status,409);assert.equal(duplicate.authUpdates.length,0);
});
test('staff and doctor employee numbers can be added or corrected: five digits and unique',async()=>{
  const staff={status:'Active',role:'Staff',id_number:''};
  assert.deepEqual(buildUserEditPatch({id_number:' 12345 '},staff).patch,{id_number:'12345'});
  assert.deepEqual(buildUserEditPatch({id_number:'12345'},{...staff,role:'Doctor'}).patch,{id_number:'12345'});
  assert.deepEqual(buildUserEditPatch({id_number:'12345'},{...staff,id_number:'12345'}).patch,{},'An unchanged number is not a change');
  for(const value of ['1234','123456','12a45',''])assert.match(buildUserEditPatch({id_number:value},{...staff,id_number:'11111'}).error,/5-digit/);
  assert.match(buildUserEditPatch({id_number:'12345'},{...staff,role:'Patient'}).error,/Only staff and doctor/,"A patient's ID comes from registration");
  const ok=await fixture();const saved=await ok.call({id_number:'54321'});
  assert.equal(saved.status,200);assert.equal(ok.writes.at(-1).id_number,'54321');
  assert.match(JSON.stringify(ok.audits),/previous_id_number/);
  const taken=await fixture({duplicate:true});const refused=await taken.call({id_number:'54321'});
  assert.equal(refused.status,409);assert.match((await refused.json()).error,/belongs to another account/);assert.equal(taken.writes.length,0);
});
test('suspending needs a reason and emails it to the person; reactivating emails them too',async()=>{
  let f=await fixture();
  for(const body of [{},{reason_category:'Policy violation',reason:'short'},{reason_category:'Made up',reason:'Repeated no-shows on booked visits'}]){
    const response=await f.call({action:'status',status:'Suspended',...body});assert.equal(response.status,400);
  }
  assert.equal(f.writes.length,0);
  const response=await f.call({action:'status',status:'Suspended',reason_category:'Misuse of appointments',reason:'Repeated no-shows on booked visits'});
  assert.equal(response.status,200);assert.equal((await response.json()).email_queued,true);
  const mail=f.audits.find(row=>row.recipient_email);
  assert.equal(mail.recipient_email,'original@example.test');assert.match(mail.subject,/suspended/);assert.match(mail.text_body,/Reason: Misuse of appointments — Repeated no-shows/);
  assert(f.audits.some(row=>row.action==='USER_SUSPENDED'&&row.details.reason_category==='Misuse of appointments'));
  f=await fixture({status:'Suspended'});
  assert.equal((await f.call({action:'status',status:'Active'})).status,400,'Reactivation needs a reason too');
  const back=await f.call({action:'status',status:'Active',reason_category:'Appeal approved',reason:'Appeal reviewed and accepted by the clinic'});assert.equal(back.status,200);
  const reactivated=f.audits.find(row=>row.recipient_email);
  assert.match(reactivated.subject,/reactivated/);assert.match(reactivated.html_body,/email-ctu-seal\.png/);assert.match(reactivated.text_body,/Appeal approved — Appeal reviewed/);
});
