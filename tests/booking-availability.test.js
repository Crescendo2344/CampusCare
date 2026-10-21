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
test('long lunch-overlapping appointments and invalid ranges are blocked',()=>{
 const days=build({doctor:{...doctor,startTime:'11:30',endTime:'14:30',slotDuration:90}});
 assert.equal(days[0].slots[0].kind,'lunch');assert.equal(days[0].slots[1].available,true);
 assert.throws(()=>build({to:'2026-02-31'}));assert.throws(()=>build({to:'2028-01-01'}));
 assert.equal(addBookingDays('2026-12-31',1),'2027-01-01');
});
test('browser and authenticated server calculations stay identical',()=>{
 assert.equal(fs.readFileSync('src/domain/booking-availability.js','utf8'),fs.readFileSync('supabase/functions/_shared/booking-availability.js','utf8'));
});
