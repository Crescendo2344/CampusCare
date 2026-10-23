// Execute the real registration handler with fake Auth/Storage clients and no production records.
import {emailValidationError,normalizePhilippineMobile} from '../supabase/functions/_shared/contact-validation.js';
import {createMailDomainValidator} from '../supabase/functions/_shared/mail-domain.js';
import {registrationDetailErrors} from '../supabase/functions/_shared/registration-validation.js';
import {authRedirect} from '../supabase/functions/_shared/app-url.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
async function fixture({requireEmail=false,confirmationFailure=false,uploadFailure=false,captcha=false,env={},rateFailure=false,providerFailure=false,verdict={},mailResponse={Status:0,Answer:[{type:15,data:'10 mail.example.test.'}]}}={}){
  let handler;const creates=[],signups=[],uploads=[],updates=[],deletes=[],removes=[],limits=[],verifications=[],buckets=new Map(),usedTokens=new Set();
  const client={rpc:async(name,args)=>{
    assert.equal(name,'consume_registration_limit');limits.push(args);if(rateFailure)return {error:new Error('Unavailable')};
    const key=args.p_scope+args.p_subject_hash,count=(buckets.get(key)||0)+1;buckets.set(key,count);
    return {data:{allowed:count<=(args.p_scope==='ip'?30:5),retry_after:120}};
  },auth:{resend:async body=>{signups.push(body);return {error:confirmationFailure?new Error("Mail failed"):null};},admin:{createUser:async body=>{creates.push(body);return {data:{user:{id:'fixture'}}};},deleteUser:async id=>{deletes.push(id);return {};}}},
    from(table){return {select(){return this;},delete(){return this;},ilike(){return this;},limit:async()=>({data:[]}),update(body){updates.push(body);return this;},eq(){return this;},maybeSingle:async()=>({data:{user_id:1}}),insert:async()=>({error:null})};},
    storage:{from(bucket){return {upload:async(path,file)=>{uploads.push({bucket,path,size:file.size});return {error:uploadFailure&&uploads.length===2?new Error('Fixture upload failed'):null};},remove:async paths=>{removes.push(paths);return {};}};}}};
  globalThis.__registrationClient=()=>client;
  globalThis.__registrationContact={emailValidationError,normalizePhilippineMobile,createMailDomainValidator,registrationDetailErrors,authRedirect};
  const environment={SUPABASE_URL:'https://fixture.test',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture-private-key',CAMPUSCARE_REQUIRE_EMAIL_CONFIRMATION:String(requireEmail),...(captcha?{TURNSTILE_SITE_KEY:'0x4-fixture-site-key',TURNSTILE_SECRET_KEY:'fixture-secret'}:{}),...env};
  globalThis.Deno={env:{get:name=>environment[name]},serve:fn=>{handler=fn;}};
  globalThis.__registrationFetch=async(url,options)=>{
    if(['dns.google','cloudflare-dns.com'].includes(new URL(url).hostname))return Response.json(mailResponse);
    assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');verifications.push(options);
    if(providerFailure)throw new Error('Provider down');
    const token=options.body.get('response'),duplicate=usedTokens.has(token);usedTokens.add(token);
    return Response.json({success:!duplicate,hostname:'campuscare-brown-two.vercel.app',action:'campuscare_register',...verdict});
  };
  const source=readFileSync('supabase/functions/register-patient/index.ts','utf8').replace(/^import[^\n]+\n/gm,'');
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes('const {emailValidationError,normalizePhilippineMobile,createMailDomainValidator,registrationDetailErrors,authRedirect}=globalThis.__registrationContact;const createClient=globalThis.__registrationClient;const fetch=globalThis.__registrationFetch;\n'+source)+'\n// '+Math.random()).toString('base64'));
  const call=async({details={},source='camera',consent=true,back=true,same=false,type='image/png',documentType='Student ID',token='fixture-captcha',ip='198.51.100.1',xff='',email='fixture@example.test',contact='',id='1234567',size=null}={})=>{
    const form=new FormData();form.set('email',email);form.set('captcha_token',token);form.set('password',details.password||'Clinic-Pass1!');form.set('selfie_capture_source',source);
    form.set('metadata',JSON.stringify({first_name:'Ana',last_name:'Reyes',username:'fixture',college:'COE',date_of_birth:'2004-05-06',sex:'Female',...details,contact_no:contact,id_number:id,person_type:'Student',verification_document_type:documentType,privacy_consent:consent,role:'Administrator',registration_context:'internal'}));
    form.set('selfie',new File(['selfie'],'camera.jpg',{type:'image/jpeg'}));form.set('verification',new File(['document'],'id.png',{type}));if(back)form.set('verification_back',new File([same?'document':'back-document'],'id-back.png',{type:'image/png'}));
    return handler(new Request('https://fixture.test',{method:'POST',headers:{'cf-connecting-ip':ip,'x-forwarded-for':xff,...(size?{'content-length':String(size)}:{})},body:form}));
  };
  return {call,creates,signups,uploads,updates,deletes,removes,limits,verifications,request:handler,config:()=>handler(new Request('https://fixture.test'))};
}
test('public registration always requires confirmation and remains a Pending Patient with private evidence',async()=>{
  const f=await fixture();const r=await f.call();assert.equal(r.status,200);assert.equal((await r.json()).email_confirmation_required,true);
  assert.equal(f.signups.length,1);assert.equal(f.creates.length,1);assert.equal(f.creates[0].email_confirm,false);
  assert.equal(f.creates[0].user_metadata.role,'Patient');assert.equal(f.creates[0].user_metadata.registration_context,'public');
  assert(f.uploads.every(x=>x.bucket==='campuscare-verification'));assert(f.uploads[0].path.includes('selfie-verification'));assert.equal(f.uploads.length,3);assert.equal(f.updates[0].id_back_file_url,'fixture/id-back.png');
  assert.equal(f.updates[0].profile_image_url,null);assert.equal(f.updates[0].status,'Pending');assert.equal(f.updates[0].verified,false);assert.equal(f.updates[0].verification_selfie_url,'fixture/selfie-verification.jpg');
});
test('registration rejects missing camera-source evidence and consent before creating an account',async()=>{
  for(const options of [{source:'upload'},{source:''},{consent:false}]){
    const f=await fixture();assert.equal((await f.call(options)).status,400);assert.equal(f.creates.length,0);assert.equal(f.uploads.length,0);
  }
});
test('email confirmation uses a provider-managed link even when the old bypass flag is false',async()=>{
  const f=await fixture({requireEmail:true});const r=await f.call();assert.equal(r.status,200);assert.equal((await r.json()).email_confirmation_required,true);
  assert.equal(f.creates.length,1);assert.equal(f.creates[0].email_confirm,false);assert.equal(f.signups[0].options.emailRedirectTo,'https://campuscare-brown-two.vercel.app/?auth=confirmed');
});
test('partial verification upload failure removes evidence and the newly created account',async()=>{
  const f=await fixture({uploadFailure:true});assert.equal((await f.call()).status,500);assert.deepEqual(f.deletes,['fixture']);assert.deepEqual(f.removes,[['fixture/selfie-verification.jpg']]);
});

// All front/back requirements are enforced before any Auth or Storage mutation.
test('registration rejects missing, duplicate and PDF ID sides and declared COR documents',async()=>{
  for(const options of [{back:false},{same:true},{type:'application/pdf'},{documentType:'COR'}]){
    const f=await fixture();assert.equal((await f.call(options)).status,400);assert.equal(f.creates.length,0);assert.equal(f.uploads.length,0);
  }
});

// These tests run the production handler, including one-time provider verification and shared RPC calls.
test('registration configuration exposes only a public key and rejects half-configured or dummy production keys',async()=>{
  let f=await fixture();assert.deepEqual(await(await f.config()).json(),{captcha_required:false,site_key:null});
  f=await fixture({captcha:true});const result=await(await f.config()).json();assert.deepEqual(result,{captcha_required:true,site_key:'0x4-fixture-site-key'});assert(!JSON.stringify(result).includes('fixture-secret'));
  for(const env of [{TURNSTILE_SITE_KEY:'0x4-site'},{TURNSTILE_SECRET_KEY:'secret'},{TURNSTILE_SITE_KEY:'1x00000000000000000000AA',TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA'}]){
    f=await fixture({env});assert.equal((await f.config()).status,503);assert.equal((await f.call()).status,503);assert.equal(f.creates.length,0);
  }
});
test('CAPTCHA rejects missing, reused, wrong-host, wrong-action and failed-provider tokens before Auth or Storage',async()=>{
  for(const options of [{token:''},{token:'x'.repeat(2049)}]){const f=await fixture({captcha:true});assert.equal((await f.call(options)).status,403);assert.equal(f.verifications.length,0);assert.equal(f.creates.length,0);}
  for(const verdict of [{success:false},{hostname:'attacker.test'},{hostname:'localhost'},{action:'login'}]){const f=await fixture({captcha:true,verdict});assert.equal((await f.call()).status,403);assert.equal(f.creates.length,0);assert.equal(f.uploads.length,0);assert.equal(f.limits.length,1,'Rejected challenges must not consume someone else’s identity quota');}
  let f=await fixture({captcha:true,providerFailure:true});assert.equal((await f.call()).status,503);assert.equal(f.creates.length,0);
  f=await fixture({captcha:true});assert.equal((await f.call()).status,200);assert.equal((await f.call()).status,403);assert.equal(f.signups.length,1);
  assert.equal(f.verifications[0].body.get('secret'),'fixture-secret');assert(f.verifications[0].signal);
});
test('network and identity limits return Retry-After; forged forwarded headers cannot choose a new bucket',async()=>{
  let f=await fixture();for(let i=0;i<30;i++)assert.equal((await f.call({back:false,xff:'203.0.113.'+i})).status,400);
  let response=await f.call({back:false});assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'120');assert.equal((await response.json()).retry_after,120);assert.equal(f.creates.length,0);
  assert.equal(new Set(f.limits.map(x=>x.p_subject_hash)).size,1);assert(f.limits.every(x=>/^[a-f0-9]{64}$/.test(x.p_subject_hash)));
  for(const scope of ['email','id']){
    f=await fixture();for(let i=0;i<5;i++)assert.equal((await f.call({ip:'198.51.100.'+(i+1),...(scope==='id'?{email:'fixture'+i+'@example.test'}:{id:'123456'+i})})).status,200);
    response=await f.call({ip:'198.51.100.99'});assert.equal(response.status,429);assert.equal(f.signups.length,5);
  }
});
test('rate storage failure and oversized requests fail before account creation',async()=>{
  let f=await fixture({rateFailure:true});assert.equal((await f.call()).status,503);assert.equal(f.creates.length,0);
  f=await fixture();assert.equal((await f.call({size:27*1024*1024})).status,413);assert.equal(f.creates.length,0);
  // A raw stream exercises the byte ceiling without relying on a Content-Length header.
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(27*1024*1024));controller.close();}});
  const streamed=new Request('https://fixture.test',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=fixture'},body,duplex:'half'});
  assert.equal((await f.request(streamed)).status,413,'Missing Content-Length must not bypass the byte ceiling');
});

// Direct API calls cannot bypass typo and Philippine-number checks.
test('registration rejects mistyped domains and normalizes international contact numbers before Auth',async()=>{
  for(const email of ['jo@gmal.com','jo@gmial.com','jo@ctu.edu.p','jo..s@gmail.com']){
    const f=await fixture();assert.equal((await f.call({email})).status,400);assert.equal(f.creates.length,0);
  }
  let f=await fixture();assert.equal((await f.call({contact:'08123456789'})).status,400);assert.equal(f.creates.length,0);
  f=await fixture();assert.equal((await f.call({contact:'+63 917 123 4567'})).status,200);assert.equal(f.creates[0].user_metadata.contact_number,'09171234567');
});

test('unroutable mail domains and DNS outages cannot create accounts',async()=>{
  for(const [mailResponse,status] of [[{Status:3},400],[{Status:0,Answer:[{type:15,data:'0 .'}]},400],[{Status:2},503]]){
    const f=await fixture({mailResponse});assert.equal((await f.call()).status,status);assert.equal(f.creates.length,0);assert.equal(f.uploads.length,0);
  }
});

// A delivery failure must not leave an email or username blocked for the next attempt.
test('failed confirmation delivery rolls back the unconfirmed account and private uploads',async()=>{
 const f=await fixture({confirmationFailure:true});assert.equal((await f.call()).status,500);assert.deepEqual(f.deletes,['fixture']);assert.equal(f.removes[0].length,3);
});
test('registration rejects invalid personal details with field-level errors before creating an account',async()=>{
  const f=await fixture();
  const r=await f.call({details:{first_name:'4na',username:'_x',sex:'Other',date_of_birth:'2030-01-01'}});
  assert.equal(r.status,400);const body=await r.json();
  assert.deepEqual(Object.keys(body.field_errors).sort(),['birth_date','first_name','sex','username']);
  assert.equal(f.creates.length,0);
  const weak=await f.call({details:{password:'password'}});assert.equal(weak.status,400);assert(( await weak.json()).field_errors.password);
});
