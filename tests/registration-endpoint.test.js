// Execute the real registration handler with fake Auth/Storage clients and no production records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
async function fixture({requireEmail=false,uploadFailure=false}={}){
  let handler;const creates=[],signups=[],uploads=[],updates=[],deletes=[],removes=[];
  const client={auth:{signUp:async body=>{signups.push(body);return {data:{user:{id:'fixture',identities:[{}]}}};},admin:{createUser:async body=>{creates.push(body);return {data:{user:{id:'fixture'}}};},deleteUser:async id=>{deletes.push(id);return {};}}},
    from(table){return {select(){return this;},ilike(){return this;},limit:async()=>({data:[]}),update(body){updates.push(body);return this;},eq(){return this;},maybeSingle:async()=>({data:{user_id:1}}),insert:async()=>({error:null})};},
    storage:{from(bucket){return {upload:async(path,file)=>{uploads.push({bucket,path,size:file.size});return {error:uploadFailure&&uploads.length===2?new Error('Fixture upload failed'):null};},remove:async paths=>{removes.push(paths);return {};}};}}};
  globalThis.__registrationClient=()=>client;
  globalThis.Deno={env:{get:name=>name==='CAMPUSCARE_REQUIRE_EMAIL_CONFIRMATION'?String(requireEmail):'fixture'},serve:fn=>{handler=fn;}};
  const source=readFileSync('supabase/functions/register-patient/index.ts','utf8').replace(/^import[^\n]+\n/gm,'');
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes('const createClient=globalThis.__registrationClient;\n'+source)+'\n// '+Math.random()).toString('base64'));
  const call=async({source='camera',consent=true,back=true,same=false,type='image/png',documentType='Student ID'}={})=>{
    const form=new FormData();form.set('email','fixture@example.test');form.set('password','Fixture-password1!');form.set('selfie_capture_source',source);
    form.set('metadata',JSON.stringify({username:'fixture',person_type:'Student',verification_document_type:documentType,privacy_consent:consent,role:'Administrator',registration_context:'internal'}));
    form.set('selfie',new File(['selfie'],'camera.jpg',{type:'image/jpeg'}));form.set('verification',new File(['document'],'id.png',{type}));if(back)form.set('verification_back',new File([same?'document':'back-document'],'id-back.png',{type:'image/png'}));
    return handler(new Request('https://fixture.test',{method:'POST',body:form}));
  };
  return {call,creates,signups,uploads,updates,deletes,removes};
}
test('temporary registration bypass sends no confirmation email and remains a Pending Patient with private evidence',async()=>{
  const f=await fixture();const r=await f.call();assert.equal(r.status,200);assert.equal((await r.json()).email_confirmation_required,false);
  assert.equal(f.signups.length,0);assert.equal(f.creates[0].email_confirm,true);assert.equal(f.creates[0].app_metadata.email_verification_skipped,true);
  assert.equal(f.creates[0].user_metadata.role,'Patient');assert.equal(f.creates[0].user_metadata.registration_context,'public');
  assert(f.uploads.every(x=>x.bucket==='campuscare-verification'));assert(f.uploads[0].path.includes('selfie-verification'));assert.equal(f.uploads.length,3);assert.equal(f.updates[0].id_back_file_url,'fixture/id-back.png');
  assert.equal(f.updates[0].profile_image_url,null);assert.equal(f.updates[0].status,'Pending');assert.equal(f.updates[0].verified,false);assert.equal(f.updates[0].verification_selfie_url,'fixture/selfie-verification.jpg');
});
test('registration rejects missing camera-source evidence and consent before creating an account',async()=>{
  for(const options of [{source:'upload'},{source:''},{consent:false}]){
    const f=await fixture();assert.equal((await f.call(options)).status,400);assert.equal(f.creates.length,0);assert.equal(f.uploads.length,0);
  }
});
test('future email confirmation switch restores signup flow with an expiring provider-managed link',async()=>{
  const f=await fixture({requireEmail:true});const r=await f.call();assert.equal(r.status,200);assert.equal((await r.json()).email_confirmation_required,true);
  assert.equal(f.creates.length,0);assert.equal(f.signups[0].options.emailRedirectTo,'https://campuscare-brown-two.vercel.app/?auth=confirmed');
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
