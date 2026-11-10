// Triage vital signs: shared by the front-desk form and the appointment-actions function.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TRIAGE_VITAL_FIELDS,cleanTriageVitals,hasTriageVitals,triageVitalErrors} from '../supabase/functions/_shared/triage-vitals.js';
import {mergeAppointmentSnapshot} from '../src/domain/appointment-records.js';

test('triage keeps blood pressure, temperature and SpO2 only (no pulse, weight, height or BMI)',()=>{
  assert.deepEqual(TRIAGE_VITAL_FIELDS.map(([key])=>key),['bp','temp','spo2']);
  assert.deepEqual(cleanTriageVitals({bp:' 120 / 80 ',temp:'36.8',spo2:'98%',pulse:'72',weight:'60'}),{bp:'120/80',temp:'36.8',spo2:'98'});
});

test('triage readings are checked for typing slips',()=>{
  assert.deepEqual(triageVitalErrors({bp:'120/80',temp:'36.8',spo2:'98'}),{});
  assert.deepEqual(triageVitalErrors({bp:'120/80'}),{},'One reading is enough');
  assert.deepEqual(Object.keys(triageVitalErrors({bp:'120-80',temp:'368',spo2:'101'})),['bp','temp','spo2']);
  assert.ok(triageVitalErrors({bp:'80/120'}).bp,'Systolic must be higher');
  assert.ok(triageVitalErrors({}).form,'An empty form is not saved');
  assert.equal(hasTriageVitals({bp:'',temp:'',spo2:''}),false);
  assert.equal(hasTriageVitals({temp:'37'}),true);
});

test('triage vitals reach the matching appointment for staff and the doctor',()=>{
  const snapshot=mergeAppointmentSnapshot({patients:[],users:[]},{
    appointments:[{appointment_id:5,patient_id:1,doctor_id:2,appointment_date:'2026-11-10',appointment_time:'09:00:00',status:'Scheduled'},{appointment_id:6,patient_id:1,doctor_id:2,appointment_date:'2026-11-10',appointment_time:'09:30:00',status:'Scheduled'}],
    overrides:[],leaves:[],
    vitals:[{appointment_id:5,vitals:{bp:'130/85',temp:'37.9',spo2:'97'},recorded_by:9,recorded_at:'2026-11-10T01:00:00Z',updated_by:9,updated_at:'2026-11-10T01:00:00Z'}]
  });
  assert.deepEqual(snapshot.appointments[0].triageVitals,{bp:'130/85',temp:'37.9',spo2:'97',recordedBy:100009,recordedAt:'2026-11-10T01:00:00Z',updatedBy:100009,updatedAt:'2026-11-10T01:00:00Z'});
  assert.equal(snapshot.appointments[1].triageVitals,null);
});

test('only staff record triage vitals, only before the visit is completed',()=>{
  const src=fs.readFileSync('supabase/functions/appointment-actions/index.ts','utf8');
  const block=src.slice(src.indexOf('if(action==="vitals")'),src.indexOf('if(action==="manage_slots")'));
  assert.match(block,/if\(!canManageAll\)return json/);
  assert.match(block,/!OPEN\.includes\(appt\.status\)/);
  assert.match(block,/appointment_date>manilaNow\(\)\.date/);
  assert.match(block,/triageVitalErrors/);
  const sql=fs.readFileSync('supabase/migrations/20261110140000_triage_vitals.sql','utf8');
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke insert,update,delete on public\.appointment_vitals from anon, authenticated/);
  assert.doesNotMatch(sql,/Administrator/,'Administrators do not read clinical readings');
});

test('the visit record form no longer asks for pulse, weight, height or BMI',()=>{
  const src=fs.readFileSync('src/features/treatmentForm.js','utf8');
  for(const id of ['tm-pulse','tm-weight','tm-height','tm-bmi'])assert.ok(!src.includes(id),id);
  assert.match(src,/triageVitals/,'Triage readings are filled into the visit form');
});
