// Availability combines schedule rules and reservations without exposing anyone's clinical records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildDoctorAvailability,addBookingDays} from '../src/domain/booking-availability.js';
const doctor={workDays:['Mon','Tue','Wed','Thu','Fri'],startTime:'08:00',endTime:'17:00',slotDuration:60,maxPatients:20};
const build=changes=>buildDoctorAvailability({doctor,from:'2026-10-21',to:'2026-10-28',today:'2026-10-21',nowMinutes:8*60,...changes});
test('leave, weekends, occupied slots, lunch and past times close only the affected openings',()=>{
 const days=build({appointments:[{date:'2026-10-22',time:'09:00',status:'Scheduled'},{date:'2026-10-22',time:'10:00',status:'Cancelled'}],leaves:[{date:'2026-10-23'}],overrides:[{date:'2026-10-22',time:'11:00',available:false},{date:'2026-10-22',time:'12:00',available:true}]});
 assert.equal(days[0].slots[0].kind,'past');
 assert.equal(days[1].slots.find(s=>s.time==='09:00').kind,'booked');
 assert.equal(days[1].slots.find(s=>s.time==='10:00').available,true);
 assert.equal(days[1].slots.find(s=>s.time==='11:00').available,false);
 assert.equal(days[1].slots.find(s=>s.time==='12:00').available,true);
 assert.equal(days[2].openSlots,0);assert.equal(days[3].openSlots,0);
 assert.equal(days.find(d=>d.date==='2026-10-26').openSlots,8);
 assert(!JSON.stringify(days).includes('patient_id'));
});
test('effective schedule changes and daily limits match each calendar day',()=>{
 const days=build({doctor:{...doctor,maxPatients:1},appointments:[{date:'2026-10-21',time:'09:00',status:'Scheduled'}],rules:[{weekday:4,is_working:true,start_time:'10:00',end_time:'12:00',slot_duration:30,max_patients:4,effective_from:'2026-10-22'}]});
 assert.equal(days[0].openSlots,0);
 assert.deepEqual(days[1].slots.map(s=>s.time),['10:00','10:30','11:00','11:30']);
 assert.equal(days[1].schedule.slotDuration,30);
});
test('missing schedule defaults dental appointments to 9 AM and medical appointments to 8 AM',()=>{
 const dental=build({doctor:{specialty:'Dental',workDays:['Wed'],endTime:'17:00',slotDuration:60,maxPatients:20}});
 const medical=build({doctor:{specialty:'General Medicine',workDays:['Wed'],endTime:'17:00',slotDuration:60,maxPatients:20}});
 assert.equal(dental[0].schedule.startTime,'09:00');
 assert.equal(dental[0].slots[0].time,'09:00');
 assert.equal(medical[0].schedule.startTime,'08:00');
 assert.equal(medical[0].slots[0].time,'08:00');
});
test('long lunch-overlapping appointments and invalid ranges are blocked',()=>{
 const days=build({doctor:{...doctor,startTime:'11:30',endTime:'14:30',slotDuration:90}});
 assert.equal(days[0].slots[0].kind,'lunch');assert.equal(days[0].slots[1].available,true);
 assert.throws(()=>build({to:'2026-02-31'}));assert.throws(()=>build({to:'2028-01-01'}));
 assert.equal(addBookingDays('2026-12-31',1),'2027-01-01');
});
test('browser and authenticated server calculations stay identical',()=>{
 assert.equal(fs.readFileSync('src/domain/booking-availability.js','utf8'),fs.readFileSync('supabase/functions/_shared/booking-availability.js','utf8'));
});

test('a custom time opened by staff is added to that day only, in time order',async()=>{
  const {buildDoctorAvailability}=await import('../src/domain/booking-availability.js');
  const doctor={workDays:['Mon','Tue','Wed','Thu','Fri'],startTime:'08:00',endTime:'12:00',slotDuration:60,maxPatients:9};
  const days=buildDoctorAvailability({doctor,from:'2026-11-02',to:'2026-11-03',today:'2026-11-01',overrides:[{date:'2026-11-02',time:'07:30',available:true},{date:'2026-11-02',time:'09:00',available:false}]});
  const monday=days[0].slots.map(s=>[s.time,s.kind,!!s.custom]);
  assert.deepEqual(monday[0],['07:30','available',true]);
  assert.deepEqual(monday.find(s=>s[0]==='09:00'),['09:00','blocked',false]);
  assert(!days[1].slots.some(s=>s.custom),'Other days keep the regular grid');
});

test('an extraction or filling takes 1 hr 30 min and moves the next time to when it ends',async()=>{
  const {daySlotStarts,slotFitProblem,serviceMinutes}=await import('../src/domain/booking-availability.js');
  const t=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  assert.equal(serviceMinutes('Tooth Extraction',60),90);assert.equal(serviceMinutes('Dental Checkup',60),60);
  // No long procedure: the regular hourly grid.
  assert.deepEqual(daySlotStarts({start:540,end:1020,duration:60}).map(t),['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00']);
  // Extraction at 9:00: the next time is 10:30, then 11:30 and so on.
  assert.deepEqual(daySlotStarts({start:540,end:1020,duration:60,booked:[{minute:540,length:90}]}).map(t).slice(0,4),['09:00','10:30','11:30','12:30']);
  // A visit already booked at 13:00 stays; the short gap before it is not offered, and the grid resumes after it.
  assert.deepEqual(daySlotStarts({start:540,end:1020,duration:60,booked:[{minute:540,length:90},{minute:780,length:60}]}).map(t),['09:00','10:30','11:30','13:00','14:00','15:00','16:00']);
  // A long procedure does not fit where another appointment starts before it would finish.
  assert.match(slotFitProblem({minute:600,length:90,end:1020,booked:[{minute:660,length:60}]}),/Another appointment/);
  assert.equal(slotFitProblem({minute:600,length:90,end:1020,booked:[]}),'');
  const doctor={workDays:['Mon'],specialty:'Dental',startTime:'09:00',endTime:'17:00',slotDuration:60,maxPatients:8};
  const day=service=>buildDoctorAvailability({doctor,from:'2026-11-16',to:'2026-11-16',today:'2026-11-15',service,
    appointments:[{date:'2026-11-16',time:'09:00',status:'Scheduled',service:'Tooth Extraction'},{date:'2026-11-16',time:'14:30',status:'Scheduled',service:'Dental Checkup'}]})[0].slots;
  assert.deepEqual(day('Dental Checkup').filter(s=>s.available).map(s=>s.time),['10:30','13:30','15:30']);
  // For a filling, 13:30 is too close to the 14:30 visit; 10:30 ends at noon and 15:30 ends at 17:00, so both fit.
  assert.deepEqual(day('Tooth Restoration').filter(s=>s.available).map(s=>s.time),['10:30','15:30']);
  assert.equal(day('Tooth Restoration').find(s=>s.time==='13:30').label,'Needs 1 hr 30 min');
});
