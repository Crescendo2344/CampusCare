// Exercise the deployed handler's guards with synthetic accounts and no real email delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountEmailHandler} from '../supabase/functions/_shared/account-email.js';
function fixture(action,overrides={}){
  const sent=[],lookups=[],queued=[],dispatched=[];
  const account={user_id:7,first_name:'Ana',auth_user_id:'fixture',email:'fixture@example.test',status:'Active',...overrides.account};
  const user={email:account.email,email_confirmed_at:action==='reset'?'2026-01-01':null,...overrides.user};
  const table=name=>{
    const q={select(){return q;},eq(){return q;},gte(){return q;},in(){return q;},
      ilike(...args){lookups.push(args);return q;},
      insert(row){queued.push(row);return Promise.resolve({error:overrides.queueError||null});},
      maybeSingle:async()=>name==='email_dispatch_config'?{data:{dispatch_key:'fixture-key'}}:{data:overrides.missing?null:account,error:overrides.lookupError},
      then(resolve){return Promise.resolve({count:overrides.recent||0,error:null}).then(resolve);}};
    return q;
  };
  const client={from:table,auth:{admin:{getUserById:async()=>({data:{user:overrides.noAuth?null:user}}),
    generateLink:async args=>{sent.push(args);return overrides.linkError?{data:null,error:overrides.linkError}:{data:{properties:{hashed_token:'fixture-hash'}},error:null};}},
    resend:async args=>{sent.push(args);return {error:overrides.sendError};}}};
  const handler=createAccountEmailHandler({createClient:()=>client,env:()=> 'fixture',action,fetcher:async(...args)=>{dispatched.push(args);return new Response('{}');}});
  const call=identifier=>handler(new Request('https://fixture.test',{method:'POST',body:JSON.stringify({identifier})}));
  return {call,sent,lookups,queued,dispatched};
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
test('eligible password resets send a CampusCare email whose link carries the one-time token',async()=>{
  const f=fixture('reset');assert.equal((await f.call('fixture')).status,200);
  assert.deepEqual(f.sent,[{type:'recovery',email:'fixture@example.test'}]);
  assert.equal(f.queued.length,1);
  const mail=f.queued[0];
  assert.equal(mail.recipient_email,'fixture@example.test');assert.equal(mail.subject,'CampusCare · Reset your password');
  // Stored copies of this template are wiped once delivered.
  assert.equal(mail.template_key,'verification');
  assert.ok(mail.html_body.includes('https://campuscare-brown-two.vercel.app/?auth=recovery&amp;type=recovery&amp;token_hash=fixture-hash'));
  assert.ok(mail.html_body.includes('cid:campuscare-logo')&&mail.html_body.includes('Hello Ana'));
  assert.equal(f.dispatched.length,1,'the email is sent right away');
  const pending=fixture('reset',{account:{status:'Pending'}});assert((await pending.call('fixture')).status>=400);assert.equal(pending.queued.length,0);
  // An active account the clinic created, whose first link expired, can still get a new one.
  const assisted=fixture('reset',{user:{email_confirmed_at:null}});assert.equal((await assisted.call('fixture')).status,200);assert.equal(assisted.queued.length,1);
  // A forgotten password is never on the 7-day cooldown, even right after a change.
  const recent=fixture('reset',{account:{password_changed_at:new Date().toISOString()}});
  assert.equal((await recent.call('fixture')).status,200);assert.equal(recent.queued.length,1);
});
test('a second reset request within a minute is refused, and failures never report success',async()=>{
  const again=fixture('reset',{recent:1});const r=await again.call('fixture');
  assert.equal(r.status,429);assert.equal(again.queued.length,0);assert.equal(again.sent.length,0);
  for(const options of [{linkError:{message:'down'}},{queueError:{message:'down'}}]){
    const f=fixture('reset',options);const res=await f.call('fixture');assert.equal(res.status,502);assert.equal((await res.json()).ok,undefined);
  }
  for(const [error,status] of [[{message:'Provider unavailable'},502],[{status:429,message:'Rate limited'},429]]){
    const f=fixture('resend',{sendError:error,account:{status:'Pending'}});const res=await f.call('fixture');assert.equal(res.status,status);assert.equal((await res.json()).ok,undefined);
  }
});

test('the clinic-assisted first-password email uses the CampusCare layout and its own subject',async()=>{
  const {queuePasswordEmail,SETUP_SUBJECT}=await import('../supabase/functions/_shared/password-email.js');
  const queued=[],links=[];
  const admin={auth:{admin:{generateLink:async args=>{links.push(args);return {data:{properties:{hashed_token:'setup-hash'}},error:null};}}},
    from:()=>{const q={select(){return q;},eq(){return q;},insert(row){queued.push(row);return Promise.resolve({error:null});},maybeSingle:async()=>({data:null})};return q;}};
  assert.equal(await queuePasswordEmail(admin,{email:'new@example.test',userId:3,firstName:'Ana',setup:true}),true);
  assert.deepEqual(links,[{type:'recovery',email:'new@example.test'}]);
  assert.equal(queued[0].subject,SETUP_SUBJECT);
  assert.ok(queued[0].html_body.includes('Set my password')&&queued[0].html_body.includes('token_hash=setup-hash'));
  assert.ok(!/supabase/i.test(queued[0].html_body));
});
