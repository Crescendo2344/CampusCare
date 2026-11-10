// Emergency reappointment: a doctor returns a whole day's remaining visits without admin approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildDoctorAvailability} from '../src/domain/booking-availability.js';
import {confirmationDeadline,emergencyBlockedTimes,emergencyReappointMessage,planEmergencyReappointments,prettyDeadline,slotStartMs} from '../src/domain/emergency-reappointment.js';

const doctor={workDays:['Mon','Tue','Wed','Thu','Fri'],startTime:'08:00',endTime:'12:00',slotDuration:60,maxPatients:4};
// Tuesday 2026-11-10, 07:00 in Manila.
const nowMs=Date.parse('2026-11-10T07:00:00+08:00');
const calendar=(appointments=[],extra={})=>buildDoctorAvailability({doctor,appointments,leaves:[],overrides:[],settings:{lunchStart:'12:00',lunchEnd:'13:00'},from:'2026-11-10',to:'2026-11-20',today:'2026-11-10',nowMinutes:7*60,...extra});

test('the browser and the server plan emergencies with the same code',()=>{
  assert.equal(fs.readFileSync('src/domain/emergency-reappointment.js','utf8'),fs.readFileSync('supabase/functions/_shared/emergency-reappointment.js','utf8'));
});

test('a full emergency day fills the earliest open slots on days that are not fully booked',()=>{
  const today=['08:00','09:00','10:00','11:00'].map(time=>({date:'2026-11-10',time,status:'Scheduled'}));
  // Wednesday has only 10:00 left; Thursday is fully booked; Friday is empty.
  const wed=['08:00','09:00','11:00'].map(time=>({date:'2026-11-11',time,status:'Scheduled'}));
  const thu=['08:00','09:00','10:00','11:00'].map(time=>({date:'2026-11-12',time,status:'Scheduled'}));
  const days=calendar([...today,...wed,...thu]);
  const plan=planEmergencyReappointments({appointments:[{id:4,time:'11:00'},{id:1,time:'08:00'},{id:2,time:'09:00'},{id:3,time:'10:00'}],days,emergencyDate:'2026-11-10',nowMs});
  assert.deepEqual(plan.map(p=>[p.id,p.date,p.time]),[
    [1,'2026-11-11','10:00'],
    [2,'2026-11-13','08:00'],
    [3,'2026-11-13','09:00'],
    [4,'2026-11-13','10:00']
  ]);
});

test('proposals leave at least 12 hours of notice and never use the emergency day',()=>{
  const lateNow=Date.parse('2026-11-10T21:00:00+08:00');
  const plan=planEmergencyReappointments({appointments:[{id:1,time:'08:00'}],days:calendar(),emergencyDate:'2026-11-10',nowMs:lateNow});
  // 08:00 Wednesday is only 11 hours away, so 09:00 is the first offer.
  assert.equal(plan[0].date,'2026-11-11');assert.equal(plan[0].time,'09:00');
});

test('visits with no open slot in range are reported, not dropped',()=>{
  const days=calendar([],{leaves:Array.from({length:10},(_,i)=>({date:`2026-11-${String(11+i).padStart(2,'0')}`}))});
  const plan=planEmergencyReappointments({appointments:[{id:9,time:'08:00'}],days,emergencyDate:'2026-11-10',nowMs});
  assert.deepEqual(plan,[{id:9,date:null,time:null,deadline:null}]);
});

test('the deadline is 24 hours, or 2 hours before the new time when that is sooner',()=>{
  assert.equal(confirmationDeadline(nowMs,'2026-11-20','08:00'),new Date(nowMs+24*3600e3).toISOString());
  assert.equal(confirmationDeadline(nowMs,'2026-11-11','08:00'),new Date(slotStartMs('2026-11-11','08:00')-2*3600e3).toISOString());
  assert.equal(prettyDeadline('2026-11-11T00:00:00.000Z'),'Wed, Nov 11, 2026 at 8:00 AM');
});

test('every slot that has not started on the emergency day is closed to bookings',()=>{
  const days=calendar([],{nowMinutes:9*60+30});
  assert.deepEqual(emergencyBlockedTimes(days.find(d=>d.date==='2026-11-10')),['10:00','11:00']);
});

test('the patient message apologizes, offers the new time, and states the deadline and its consequence',()=>{
  const text=emergencyReappointMessage({fromDate:'2026-11-10',fromTime:'09:00',date:'2026-11-13',time:'10:00',deadline:'2026-11-11T00:00:00.000Z',reason:'Urgent meeting',note:'',clinic:'Medical Clinic',doctorName:'Villareal'});
  assert.match(text,/^We sincerely apologize\. Due to an urgent meeting, Dr\. Villareal is unable to see patients on Tue, Nov 10, 2026, so your appointment at 9:00 AM will not push through\./);
  assert.match(text,/Medical Clinic · Fri, Nov 13, 2026 at 10:00 AM/);
  assert.match(text,/pick another date and time from the open slots/);
  assert.match(text,/confirm by Wed, Nov 11, 2026 at 8:00 AM/);
  assert.match(text,/released and you will need to book a new appointment on your own/);
  assert.doesNotMatch(text,/Note from the clinic/);
  assert.match(emergencyReappointMessage({fromDate:'2026-11-10',fromTime:'09:00',date:'2026-11-13',time:'10:00',deadline:'2026-11-11T00:00:00.000Z',reason:'Medical emergency',note:'Called to a hospital case.'}),/Note from the clinic: Called to a hospital case\./);
});

test('the server lets doctors act without approval and enforces the confirmation deadline',()=>{
  const src=fs.readFileSync('supabase/functions/appointment-actions/index.ts','utf8');
  const block=src.slice(src.indexOf('if(action==="emergency_reappoint")'),src.indexOf('if(action==="manage_slots")'));
  assert.match(block,/actor\.role==="Doctor"\|\|canManageAll/);
  assert.match(block,/actor\.role==="Doctor"\?actor\.user_id/,'A doctor can only declare an emergency for themselves');
  assert.match(block,/title:"Appointment Will Not Push Through"/,'The email uses the apology template');
  assert.match(block,/\["Staff","Administrator"\]/,'Staff and administrators are told afterwards');
  assert.match(block,/appointment_slot_overrides/,'The rest of the day closes to bookings');
  assert.match(src,/deadlinePassed\(appt\)\)return json\(\{error:"The time to confirm this rebooking has passed/);
  assert.match(src,/action==="reschedule"&&deadlinePassed\(existing\)/);
  const sql=fs.readFileSync('supabase/migrations/20261110120000_emergency_reappointment.sql','utf8');
  assert.match(sql,/release_unconfirmed_reappointments/);
  assert.match(sql,/where status<>'Cancelled'/,'Cancelled visits no longer hold their slot');
  assert.match(sql,/Reason: it was not confirmed by/);
});

test('doctors declare from My Schedule and the front desk declares for any doctor from Appointments',()=>{
  const ui=fs.readFileSync('src/features/reappointment.js','utf8');
  assert.match(ui,/canDeclareEmergency\(\)\{return \['Doctor','Staff'\]\.includes/,'Administrators handle accounts, not bookings');
  assert.match(ui,/id="em-doctor"/,'Staff choose the doctor');
  assert.match(ui,/role==='Staff'\?\{doctor_id:/,'Only staff send a doctor; the server uses the doctor themselves otherwise');
  assert.match(fs.readFileSync('src/features/doctorSchedule.js','utf8'),/openEmergencyModal\(\)/);
  assert.match(fs.readFileSync('src/features/appointments.js','utf8'),/role==='Staff'&&canDeclareEmergency\(\)/);
});
