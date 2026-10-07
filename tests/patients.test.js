// Directory and patient fixtures are synthetic; no live profiles are read.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as records from '../src/domain/patient-records.js';
import { createPatientService } from '../src/services/patients.js';

function fixture({session={access_token:'test-session'},request,failureTable,photoFailure=false,currentError=false}={}){
  const queries=[],photos=[];
  const raw={users:[{user_id:2,profile_image_url:'test-photo'},{user_id:3,profile_image_url:'other-photo'}],patients:[{patient_id:4,user_id:2}]};
  const client={auth:{getSession:async()=>({data:{session}})},from(table){
    const entry={table};queries.push(entry);
    return {select(columns){entry.columns=columns;return this;},order(column,options){entry.order={column,...options};return this;},eq(column,value){entry.eq={column,value};return this;},
      maybeSingle:async()=>currentError?{error:new Error('Current query failed')}:{data:raw.patients[0]},
      then(resolve,reject){return Promise.resolve(table===failureTable?{error:new Error('Directory query failed')}:{data:raw[table]}).then(resolve,reject);}};
  },storage:{from(bucket){return {async createSignedUrl(path,expires){photos.push({bucket,path,expires});if(photoFailure)throw Error('Photo unavailable');return {data:{signedUrl:'https://photo.test/'+path}};}};}}};
  return {queries,photos,raw,service:createPatientService({getClient:()=>client,request,baseUrl:'https://patients.test',publishableKey:'test-public-key'})};
}

test('profile normalization retains fields, UI offsets and signed photos',()=>{
  const profile=records.normalizeSupabaseUser({user_id:'2',auth_user_id:'test-auth',first_name:'Test',last_name:'User',role:'Staff',status:'Archived',profile_signed_url:'https://photo.test/test',work_days:['Mon'],saved_signature_data:'test-signature'});
  assert.equal(profile.id,100002);assert.equal(profile.dbUserId,2);assert.equal(profile.authUserId,'test-auth');assert.equal(profile.fname,'Test');
  assert.equal(profile.archived,true);assert.equal(profile.profilePhoto,'https://photo.test/test');assert.deepEqual(profile.workDays,['Mon']);assert.equal(profile.savedSignature,'test-signature');
  assert.equal(records.normalizeSupabaseUser(null),null);
  const minimal=records.normalizeSupabaseUser({user_id:1});assert.equal(minimal.role,'Patient');assert.equal(minimal.status,'Pending');assert.equal(minimal.slotDuration,60);
});

test('patient mapping retains relationships, measurements, defaults and birthday boundaries',()=>{
  const now=new Date(2026,9,8);
  assert.equal(records.ageFromBirthDate('2000-10-09',now),25);assert.equal(records.ageFromBirthDate('2000-10-08',now),26);
  assert.equal(records.ageFromBirthDate('invalid',now),'');assert.equal(records.ageFromBirthDate('',now),'');
  const user={user_id:2,first_name:'Test',college:'COT',created_at:'2026-01-01',patient:{patient_id:4,birth_date:'2000-10-08',height_cm:160,weight_kg:50}};
  const directory=records.directoryRowToPatient(user,now);assert.equal(directory.id,200004);assert.equal(directory.userId,100002);
  assert.equal(directory.age,26);assert.equal(directory.height,'160cm');assert.equal(directory.weight,'50kg');assert.equal(directory.blood,'Unknown');assert.equal(directory.createdAt,'2026-01-01');
  assert.equal(records.directoryRowToPatient({user_id:2},now),null);
  const current=records.currentPatientToUi(user.patient,records.normalizeSupabaseUser(user),now);
  assert.equal(current.age,26);assert.equal(current.college,'COT');assert.equal(current.userId,100002);
  assert.equal(records.patientDisplayId(current),'000004');assert.equal(records.patientMeasurementNumber('160cm'),160);assert.equal(records.patientMeasurementNumber('unknown'),'');
});

test('directory merge replaces live users and patients while preserving input/demo records',()=>{
  const db={users:[{id:1},{id:100001,_realSupabase:true}],patients:[{id:2},{id:200001,_realSupabase:true}]};
  const before=JSON.stringify(db);
  const snapshot=records.mergeClinicalDirectory(db,[{user_id:3,patient:{patient_id:4}},{user_id:5}]);
  assert.deepEqual(snapshot.users.map(u=>u.id),[1,100003,100005]);assert.deepEqual(snapshot.patients.map(p=>p.id),[2,200004]);
  assert.equal(JSON.stringify(db),before);assert.equal(snapshot.users[0],db.users[0]);
});

test('clinical directory queries preserve ordering, relationships and photo signing',async()=>{
  const {service,queries,photos}=fixture();const rows=await service.loadClinicalDirectory();
  assert.equal(rows[0].patient.patient_id,4);assert.equal(rows[1].patient,null);assert.equal(rows[0].profile_signed_url,'https://photo.test/test-photo');
  assert.deepEqual(queries.map(q=>[q.table,q.order.column,q.order.ascending]),[['users','user_id',true],['patients','patient_id',true]]);
  assert.deepEqual(photos[0],{bucket:'campuscare-profiles',path:'test-photo',expires:3600});
  assert.equal((await fixture({photoFailure:true}).service.loadClinicalDirectory())[0].profile_signed_url,null);
  for(const failureTable of ['users','patients'])await assert.rejects(fixture({failureTable}).service.loadClinicalDirectory(),/Directory query failed/);
});

test('current patient query retains user filter and silent database-error behavior',async()=>{
  const {service,queries}=fixture();assert.equal((await service.loadCurrentPatient(2)).patient_id,4);
  assert.equal(queries[0].columns,'*');assert.deepEqual(queries[0].eq,{column:'user_id',value:2});
  assert.equal(await fixture({currentError:true}).service.loadCurrentPatient(2),null);
});

test('patient actions retain authentication, payload and backend error messages',async()=>{
  let sent;const {service}=fixture({request:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({ok:true})};}});
  await service.action({action:'archive',patient_id:4});assert.equal(sent.url,'https://patients.test/functions/v1/patient-actions');
  assert.equal(sent.options.method,'POST');assert.equal(sent.options.headers.Authorization,'Bearer test-session');assert.equal(sent.options.headers.apikey,'test-public-key');
  assert.deepEqual(JSON.parse(sent.options.body),{action:'archive',patient_id:4});
  let requests=0;await assert.rejects(fixture({session:null,request:async()=>{requests++;}}).service.action({}),/session has expired/);assert.equal(requests,0);
  await assert.rejects(fixture({request:async()=>({ok:false,json:async()=>({error:'Permission denied'})})}).service.action({}),/Permission denied/);
  await assert.rejects(fixture({request:async()=>({ok:true,json:async()=>{throw Error('Invalid JSON');}})}).service.action({}),/Patient action failed/);
});
