// Treatment services run with injected fixtures and never access live patient records.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as records from '../src/domain/treatment-records.js';
import { createTreatmentService } from '../src/services/treatments.js';

function fixture({session={access_token:'test-session'},request,failureTable}={}){
  const queries=[];
  const raw={treatments:[{treatment_id:7,patient_id:4,doctor_id:2}],dental_records:[{dental_record_id:8,treatment_id:7}],medication_reminders:[{reminder_id:9,patient_id:4}]};
  const client={auth:{getSession:async()=>({data:{session}})},from(table){
    const entry={table,orders:[]};queries.push(entry);
    return {select(columns){entry.columns=columns;return this;},order(column,options){entry.orders.push({column,...options});return this;},
      then(resolve,reject){return Promise.resolve(table===failureTable?{error:new Error('Query failed')}:{data:raw[table]}).then(resolve,reject);}};
  }};
  return {queries,raw,service:createTreatmentService({getClient:()=>client,request,baseUrl:'https://treatments.test',publishableKey:'test-public-key'})};
}

test('treatment mapping preserves linked IDs, clinical fields and archived status',()=>{
  const raw={treatment_id:'7',patient_id:'4',doctor_id:'2',appointment_id:'3',examination_findings:'Recorded findings',clinical_notes:'Recorded notes',status:'ARCHIVED',archived_by:'5',vitals:{pulse:80}};
  const mapped=records.realTreatmentToUi(raw);
  assert.equal(mapped.id,500007);assert.equal(mapped.patientId,200004);assert.equal(mapped.doctorId,100002);
  assert.equal(mapped.appointmentId,300003);assert.equal(mapped.archivedBy,100005);
  assert.equal(mapped.archived,true);assert.equal(mapped.notes,'Recorded notes');assert.equal(mapped.findings,'Recorded findings');
  assert.equal(mapped.vitals,raw.vitals);assert.equal(mapped.dentalRecord,null);assert.equal(records.treatmentDisplayId(mapped),'000007');
  const empty=records.realTreatmentToUi({treatment_id:1,patient_id:2,doctor_id:3});
  assert.equal(empty.status,'Active');assert.equal(empty.archived,false);assert.equal(empty.appointmentId,null);assert.deepEqual(empty.vitals,{});
});

test('dental mapping preserves data and treatment association without accepting invalid arrays',()=>{
  const raw={dental_record_id:'8',treatment_id:'7',patient_id:'4',dentist_user_id:'2',accomplishment:'invalid',odontogram:{tooth:'recorded'},oral_health:{status:'recorded'}};
  const mapped=records.realDentalRecordToUi(raw);
  assert.equal(mapped.id,8);assert.equal(mapped.treatmentId,500007);assert.equal(mapped.patientId,200004);assert.equal(mapped.dentistUserId,100002);
  assert.equal(mapped.odontogram,raw.odontogram);assert.equal(mapped.oralHealth,raw.oral_health);assert.deepEqual(mapped.accomplishment,[]);
  const index=records.indexDentalRecords([raw,{...raw,dental_record_id:9,dentist_name_snapshot:'Test Dentist'}]);
  assert.equal(index.size,1);assert.equal(index.get(500007).id,9);assert.equal(index.get(500007).dentistName,'Test Dentist');
});

test('reminder mapping retains schedule arrays, dosage labels and active states',()=>{
  const raw={reminder_id:'9',patient_id:'4',medication:'Recorded medicine',dosage:'Recorded dose',frequency:'Daily',times_of_day:['08:00'],active:true};
  const mapped=records.realMedicationReminderToUi(raw);
  assert.equal(mapped.id,600009);assert.equal(mapped.patientId,200004);assert.equal(mapped.dosage,'Recorded dose · Daily');
  assert.equal(mapped.status,'active');assert.equal(mapped.timeOfDay,raw.times_of_day);assert.equal(mapped.lastSent,null);
  const empty=records.realMedicationReminderToUi({reminder_id:1,times_of_day:'invalid'});
  assert.equal(empty.status,'inactive');assert.deepEqual(empty.timeOfDay,[]);assert.equal(empty.dosage,'');
});

test('refresh retains demo records and does not mutate the input arrays',()=>{
  const treatments=[{id:1},{id:500001,_realSupabase:true}],reminders=[{id:2},{id:600001,_realSupabase:true}];
  const original=JSON.stringify({treatments,reminders});
  const refreshed=records.mergeTreatmentRecords(treatments,[{treatment_id:7}]);
  assert.deepEqual(refreshed.map(t=>t.id),[1,500007]);assert.equal(refreshed[0],treatments[0]);
  assert.deepEqual(records.mergeMedicationReminders(reminders,[{reminder_id:9}]).map(r=>r.id),[2,600009]);
  assert.equal(JSON.stringify({treatments,reminders}),original);
  assert.equal(records.treatmentRecords({treatments:refreshed},{_realSupabase:true}).length,1);
  assert.equal(records.treatmentRecords({treatments:refreshed},{}).length,2);
});

test('actions retain authentication, payload, endpoint and error behavior',async()=>{
  let sent;const {service}=fixture({request:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({ok:true})};}});
  await service.action({action:'archive',treatment_id:7});
  assert.equal(sent.url,'https://treatments.test/functions/v1/treatment-actions');assert.equal(sent.options.method,'POST');
  assert.equal(sent.options.headers.Authorization,'Bearer test-session');assert.equal(sent.options.headers.apikey,'test-public-key');
  assert.deepEqual(JSON.parse(sent.options.body),{action:'archive',treatment_id:7});
  let requests=0;await assert.rejects(fixture({session:null,request:async()=>{requests++;}}).service.action({}),/session has expired/);assert.equal(requests,0);
  await assert.rejects(fixture({request:async()=>({ok:false,json:async()=>({error:'Access denied'})})}).service.action({}),/Access denied/);
  await assert.rejects(fixture({request:async()=>({ok:true,json:async()=>{throw Error('Invalid JSON');}})}).service.action({}),/Treatment action failed/);
});

test('queries retain table fields and ordering and propagate every table failure',async()=>{
  const {service,queries,raw}=fixture();
  assert.equal(await service.loadTreatments(),raw.treatments);assert.equal(await service.loadDentalRecords(),raw.dental_records);
  assert.equal(await service.loadMedicationReminders(),raw.medication_reminders);
  assert.deepEqual(queries.map(q=>q.table),['treatments','dental_records','medication_reminders']);
  assert.deepEqual(queries[0].orders,[{column:'treatment_date',ascending:false},{column:'treatment_id',ascending:false}]);
  assert.deepEqual(queries[1].orders,[{column:'record_date',ascending:false}]);assert.deepEqual(queries[2].orders,[{column:'created_at',ascending:false}]);
  for(const [failureTable,method] of [['treatments','loadTreatments'],['dental_records','loadDentalRecords'],['medication_reminders','loadMedicationReminders']])await assert.rejects(fixture({failureTable}).service[method](),/Query failed/);
});
