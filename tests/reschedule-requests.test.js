// A patient's reschedule is a request the doctor approves, and requests close 24 hours before the visit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patientRescheduleState,RESCHEDULE_CUTOFF_HOURS} from '../src/domain/reschedule-requests.js';

const now=Date.parse('2026-11-11T09:00:00+08:00');
const appt=(over={})=>({status:'Scheduled',date:'2026-11-13',time:'09:00',patientResponse:'',rescheduleRequest:null,...over});

test('requests are open until 24 hours before the appointment',()=>{
  assert.equal(RESCHEDULE_CUTOFF_HOURS,24);
  assert.equal(patientRescheduleState(appt(),now),'open');
  assert.equal(patientRescheduleState(appt({date:'2026-11-12',time:'09:00'}),now),'open','Exactly 24 hours is still allowed');
  assert.equal(patientRescheduleState(appt({date:'2026-11-12',time:'08:30'}),now),'closed');
  assert.equal(patientRescheduleState(appt({rescheduleRequest:{date:'2026-11-20',time:'10:00'}}),now),'pending');
  assert.equal(patientRescheduleState(appt({patientResponse:'Awaiting'}),now),'none','A clinic proposal keeps its own buttons');
  assert.equal(patientRescheduleState(appt({status:'Completed'}),now),'none');
});

const server=fs.readFileSync('supabase/functions/appointment-actions/index.ts','utf8');

test('the server keeps the appointment until the doctor approves',()=>{
  const request=server.slice(server.indexOf('if(rescheduleRequest){'),server.indexOf('const payload:any={'));
  assert.match(request,/reschedule_request_date:date,reschedule_request_time:time/);
  assert.doesNotMatch(request,/appointment_date:date/,'The request does not move the appointment');
  assert.match(server,/RESCHEDULE_CUTOFF_HOURS\*3600\*1000\)\s*\n\s*return json\(\{error:`Reschedule requests close/);
  assert.match(server,/A reschedule request keeps the same doctor and service/);
});

test('only the appointment doctor decides, and approval re-checks the slot',()=>{
  const decision=server.slice(server.indexOf('if(action==="reschedule_decision")'),server.indexOf('if(action==="withdraw_reschedule")'));
  assert.match(decision,/actor\.role!=="Doctor"\|\|appt\.doctor_id!==actor\.user_id/);
  for(const check of ['That time has been booked since the request','You are on leave that day','That time slot is now closed','The requested time has already passed'])assert.ok(decision.includes(check),check);
  assert.match(decision,/title:"Reschedule approved"/);
  assert.match(decision,/title:"Reschedule declined"/);
});

test('the doctor sees and counts pending requests; the patient can withdraw',()=>{
  assert.match(fs.readFileSync('src/features/doctorSchedule.js','utf8'),/Reschedule requests/);
  assert.match(fs.readFileSync('supabase/functions/task-badges/index.ts','utf8'),/set\("schedule",rescheduleRes\.data/);
  assert.match(fs.readFileSync('src/features/patientAppointments.js','utf8'),/action:'withdraw_reschedule'/);
});
