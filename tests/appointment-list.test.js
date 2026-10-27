import test from 'node:test';
import assert from 'node:assert/strict';
import {appointmentActions,appointmentDayHeading,appointmentView,appointmentViewCounts,appointmentsCsv,sortAppointments} from '../src/domain/appointment-list.js';

const today='2026-10-23',now='10:00';
const appt=(id,date,time,status='Scheduled',doctorId=7)=>({id,date,time,status,doctorId});

test('appointments fall into upcoming, needs-outcome and history lists',()=>{
  const rows=[appt(1,'2026-10-23','08:00'),appt(2,'2026-10-24','09:00'),appt(3,'2026-10-20','09:00'),appt(4,'2026-10-25','09:00','Cancelled'),appt(5,'2026-10-01','09:00','Completed')];
  assert.deepEqual(rows.map(a=>appointmentView(a,today)),['upcoming','upcoming','outcome','history','history']);
  assert.deepEqual(appointmentViewCounts(rows,today),{upcoming:2,outcome:1,history:2,all:5});
  assert.deepEqual(sortAppointments(rows,'upcoming').map(a=>a.id),[5,3,1,2,4]);
  assert.deepEqual(sortAppointments(rows,'history').map(a=>a.id),[4,2,1,3,5]);
});

test('actions follow role, ownership, status and timing',()=>{
  const staff={role:'Staff',userId:1,today,now},doctor={role:'Doctor',userId:7,today,now};
  const later=appt(1,'2026-10-23','14:00'),earlier=appt(2,'2026-10-23','08:00'),past=appt(3,'2026-10-20','09:00'),done=appt(4,'2026-10-20','09:00','Completed');
  assert.deepEqual(appointmentActions(later,staff),{document:false,reschedule:true,cancel:true,noShow:false,remind:true});
  assert.deepEqual(appointmentActions(earlier,staff),{document:false,reschedule:true,cancel:false,noShow:true,remind:false});
  assert.deepEqual(appointmentActions(past,staff),{document:false,reschedule:false,cancel:false,noShow:true,remind:false});
  assert.equal(appointmentActions(past,doctor).document,true);
  assert.equal(appointmentActions(later,{...doctor,userId:8}).document,false);
  assert(Object.values(appointmentActions(done,staff)).every(v=>!v));
});

test('day headings and CSV export',()=>{
  assert.equal(appointmentDayHeading('2026-10-23',today),'Today, Oct 23, 2026');
  assert.equal(appointmentDayHeading('2026-10-24',today),'Tomorrow, Oct 24, 2026');
  assert.equal(appointmentDayHeading('2026-10-22',today),'Yesterday, Oct 22, 2026');
  assert.equal(appointmentDayHeading('2026-12-16',today),'Wednesday, Dec 16, 2026');
  const csv=appointmentsCsv([appt(1,'2026-10-23','08:00')],a=>[a.id,a.date,a.time,'Cruz, Ana','P-1','CCICT','Medical Clinic','Check-up','Dr. Reyes','Student',a.status,'=cmd']);
  assert.match(csv,/^\ufeffAppointment #,Date,Time \(PH\)/);
  assert.match(csv,/"'=cmd"\r\n$/);
});
