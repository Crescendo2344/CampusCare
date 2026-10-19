// Exercise the deployed handler's guards with synthetic accounts and no real email delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountEmailHandler} from '../supabase/functions/_shared/account-email.js';
function fixture(action,overrides={}){
  const sent=[],lookups=[];
  const account={auth_user_id:'fixture',email:'fixture@example.test',status:'Active',...overrides.account};
  const user={email:account.email,email_confirmed_at:action==='reset'?'2026-01-01':null,...overrides.user};
  const client={from(){return {select(){return this;},ilike(...args){lookups.push(args);return this;},maybeSingle:async()=>({data:overrides.missing?null:account,error:overrides.lookupError})};},auth:{admin:{getUserById:async()=>({data:{user:overrides.noAuth?null:user}})},resend:async args=>{sent.push(args);return {error:overrides.sendError};},resetPasswordForEmail:async(...args)=>{sent.push(args);return {error:overrides.sendError};}}};
  const handler=createAccountEmailHandler({createClient:()=>client,env:()=> 'fixture',action});
  const call=identifier=>handler(new Request('https://fixture.test',{method:'POST',body:JSON.stringify({identifier})}));
  return {call,sent,lookups};
}
test('unknown accounts cannot trigger either email flow; literal username wildcards are escaped',async()=>{
  for(const action of ['reset','resend']){
    const f=fixture(action,{missing:true});
    assert.equal((await f.call('Not_Registered%')).status,404);assert.equal(f.sent.length,0);
    assert.deepEqual(f.lookups[0],['username','not\\_registered\\%']);
    assert.equal((await f.call('')).status,400);assert.equal(f.lookups.length,1);
  }
});
test('existing pending registrations can resend expired confirmations to the live login callback',async()=>{
  const f=fixture('resend',{account:{status:'Pending'}});
  assert.equal((await f.call(' FIXTURE@EXAMPLE.TEST ')).status,200);
  assert.deepEqual(f.lookups[0],['email','fixture@example.test']);
  assert.deepEqual(f.sent,[{type:'signup',email:'fixture@example.test',options:{emailRedirectTo:'https://campuscare-brown-two.vercel.app/?auth=confirmed'}}]);
});
test('confirmed, missing Auth, suspended and changed-email accounts cannot request verification',async()=>{
  for(const options of [{user:{email_confirmed_at:'2026-01-01'}},{noAuth:true},{account:{status:'Suspended'}},{user:{email:'different@example.test'}}]){
    const f=fixture('resend',options);assert((await f.call('fixture@example.test')).status>=400);assert.equal(f.sent.length,0);
  }
});
test('eligible password resets use the recovery callback while pending/unconfirmed/cooldown accounts are blocked',async()=>{
  const f=fixture('reset');assert.equal((await f.call('fixture')).status,200);
  assert.deepEqual(f.sent,[['fixture@example.test',{redirectTo:'https://campuscare-brown-two.vercel.app/?auth=recovery'}]]);
  for(const options of [{account:{status:'Pending'}},{user:{email_confirmed_at:null}},{account:{password_changed_at:new Date().toISOString()}}]){
    const blocked=fixture('reset',options);assert((await blocked.call('fixture')).status>=400);assert.equal(blocked.sent.length,0);
  }
});
test('delivery failures and provider rate limits never report successful email delivery',async()=>{
  for(const action of ['reset','resend'])for(const [error,status] of [[{message:'Provider unavailable'},502],[{status:429,message:'Rate limited'},429]]){
    const f=fixture(action,{sendError:error});const r=await f.call('fixture');assert.equal(r.status,status);assert.equal((await r.json()).ok,undefined);
  }
});
