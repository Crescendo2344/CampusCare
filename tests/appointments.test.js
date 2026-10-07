// Client and HTTP fixtures exercise the service without accessing live clinic data.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as records from '../src/domain/appointment-records.js';
import { createAppointmentService } from '../src/services/appointments.js';

function fixture({session={access_token:'test-session'},request,failureTable}={}){
  const queries=[];
  const raw={appointments:[{appointment_id:7,patient_id:4,doctor_id:2}],appointment_slot_overrides:[],doctor_leaves:[]};
  const client={auth:{getSession:async()=>({data:{session}})},from(table){
    const entry={table,orders:[]};queries.push(entry);
    return {select(columns){entry.columns=columns;return this;},order(column,options){entry.orders.push({column,...options});return this;},
      then(resolve,reject){return Promise.resolve(table===failureTable?{error:new Error('Query failed')}:{data:raw[table]}).then(resolve,reject);}};
  }};
  return {queries,raw,service:createAppointmentService({getClient:()=>client,request,baseUrl:'https://appointments.test',publishableKey:'test-public-key'})};
}

test('mapping preserves linked records, fallback IDs, clinic selection and status labels',()=>{
  const raw={appointment_id:'7',patient_id:'4',doctor_id:'2',service:'Dental cleaning',appointment_time:'08:30:00',status:'Confirmed',created_by:3};
  const db={patients:[{id:444,dbPatientId:4,college:'COT',_realSupabase:true}],users:[{id:222,dbUserId:2,_realSupabase:true}]};
  const mapped=records.realAppointmentToUi(raw,db);
  assert.equal(mapped.id,300007);assert.equal(mapped.patientId,444);assert.equal(mapped.doctorId,222);
  assert.equal(mapped.college,'COT');assert.equal(mapped.clinic,'Dental Clinic');assert.equal(mapped.time,'08:30');
  assert.equal(mapped.status,'Scheduled');assert.equal(mapped.createdBy,100003);assert.equal(records.appointmentDisplayId(mapped),'000007');
  const fallback=records.realAppointmentToUi({...raw,status:'Cancelled',clinic:'Medical Clinic'},{});
  assert.equal(fallback.patientId,200004);assert.equal(fallback.doctorId,100002);
  assert.equal(fallback.status,'Cancelled');assert.equal(fallback.clinic,'Medical Clinic');
});

test('doctor directory refresh retains other users and replaces directory entries',()=>{
  const users=[{id:1},{id:100002,_realDoctorDirectory:true}];const before=JSON.stringify(users);
  const merged=records.mergeDoctorDirectory(users,[{user_id:3,start_time:'09:00:00',work_days:['Tue']}]);
  assert.deepEqual(merged.map(u=>u.id),[1,100003]);assert.equal(merged[1].startTime,'09:00');
  assert.deepEqual(merged[1].workDays,['Tue']);assert.equal(merged[1].slotDuration,60);
  assert.equal(merged[1].role,'Doctor');assert.equal(merged[1]._realSupabase,true);
  assert.equal(JSON.stringify(users),before);
  assert.deepEqual(records.realDoctorDirectoryToUi({user_id:2}).workDays,['Mon','Tue','Wed','Thu','Fri']);
});

test('slot overrides group by doctor and date while retaining available and blocked slots',()=>{
  const rows=[
    {doctor_id:2,override_date:'2026-10-08',slot_time:'08:00:00',is_available:false},
    {doctor_id:2,override_date:'2026-10-08',slot_time:'12:00:00',is_available:true},
    {doctor_id:3,override_date:'2026-10-08',slot_time:'09:00:00',is_available:false},
    {doctor_id:2,override_date:'2026-10-09',slot_time:'10:00:00',is_available:false}
  ];
  const grouped=records.groupSlotOverrides(rows);assert.equal(grouped.length,3);
  assert.deepEqual(grouped[0],{doctorId:100002,date:'2026-10-08',blockedTimes:['08:00'],availableTimes:['12:00'],_realSupabase:true});
});

test('snapshot assembly preserves demo rows and input state while replacing live records',()=>{
  const db={appointments:[{id:1},{id:300001,_realSupabase:true}],doctorLeaves:[{id:2},{id:400001,_realSupabase:true}],settings:{slotOverrides:[{id:'old'}]}};
  const original=JSON.stringify(db);
  const snapshot=records.mergeAppointmentSnapshot(db,{appointments:[{appointment_id:7,patient_id:4,doctor_id:2}],overrides:[],leaves:[{leave_id:8,doctor_id:2,leave_date:'2026-10-09'}]});
  assert.deepEqual(snapshot.appointments.map(a=>a.id),[1,300007]);assert.deepEqual(snapshot.doctorLeaves.map(l=>l.id),[2,400008]);
  assert.equal(snapshot.doctorLeaves[1].doctorId,100002);assert.deepEqual(snapshot.slotOverrides,[]);
  assert.equal(JSON.stringify(db),original);
  assert.equal(records.appointmentRecords(snapshot,{_realSupabase:true}).length,1);
  assert.equal(records.appointmentRecords(snapshot,{}).length,2);
});

test('actions retain authentication, endpoint, payload and backend failure messages',async()=>{
  let sent;
  const {service}=fixture({request:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({ok:true})};}});
  await service.action({action:'cancel',appointment_id:7});
  assert.equal(sent.url,'https://appointments.test/functions/v1/appointment-actions');assert.equal(sent.options.method,'POST');
  assert.equal(sent.options.headers.Authorization,'Bearer test-session');assert.equal(sent.options.headers.apikey,'test-public-key');
  assert.deepEqual(JSON.parse(sent.options.body),{action:'cancel',appointment_id:7});
  let requests=0;
  await assert.rejects(fixture({session:null,request:async()=>{requests++;}}).service.action({}),/session has expired/);assert.equal(requests,0);
  await assert.rejects(fixture({request:async()=>({ok:false,json:async()=>({error:'Slot already booked'})})}).service.action({}),/Slot already booked/);
  await assert.rejects(fixture({request:async()=>({ok:true,json:async()=>{throw Error('Invalid JSON');}})}).service.action({}),/Appointment action failed/);
});

test('directory requests retain silent missing-session behavior and server errors',async()=>{
  let sent;
  const {service}=fixture({request:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({ok:true,doctors:[{user_id:2}]})};}});
  assert.deepEqual(await service.loadDoctorDirectory(),[{user_id:2}]);
  assert.equal(sent.url,'https://appointments.test/functions/v1/doctor-directory');assert.equal(sent.options.headers.Authorization,'Bearer test-session');
  assert.equal(await fixture({session:null,request:async()=>{throw Error('Unexpected request');}}).service.loadDoctorDirectory(),null);
  await assert.rejects(fixture({request:async()=>({ok:false,json:async()=>({error:'Directory unavailable'})})}).service.loadDoctorDirectory(),/Directory unavailable/);
});

test('queries preserve both appointment sort keys and reject every table failure',async()=>{
  const {service,queries,raw}=fixture();const data=await service.load();assert.equal(data.appointments,raw.appointments);
  assert.deepEqual(queries.map(q=>q.table),['appointments','appointment_slot_overrides','doctor_leaves']);
  assert.deepEqual(queries[0].orders,[{column:'appointment_date',ascending:false},{column:'appointment_time',ascending:false}]);
  for(const failureTable of ['appointments','appointment_slot_overrides','doctor_leaves'])await assert.rejects(fixture({failureTable}).service.load(),/Query failed/);
});
