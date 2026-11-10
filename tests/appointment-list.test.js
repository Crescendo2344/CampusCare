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
  assert.deepEqual(appointmentActions(later,staff),{document:false,reschedule:true,cancel:false,reappoint:true,noShow:false,remind:true,vitals:true});
  assert.deepEqual(appointmentActions(earlier,staff),{document:false,reschedule:true,cancel:false,reappoint:true,noShow:true,remind:false,vitals:true});
  assert.deepEqual(appointmentActions(past,staff),{document:false,reschedule:false,cancel:false,reappoint:true,noShow:true,remind:false,vitals:true});
  // The clinic never cancels; a visit that cannot push through is returned for reappointment.
  assert.equal(appointmentActions({...later,doctorId:7},doctor).reappoint,true,'The appointment doctor can propose a new time');
  assert.equal(appointmentActions(later,{role:'Administrator',userId:1,today,now}).reappoint,false,'Administrators do not handle bookings');
  assert.equal(appointmentActions({...later,patientResponse:'Awaiting'},staff).remind,false,'No reminder while the patient decides on a new time');
  assert.equal(appointmentActions(past,doctor).document,true);
  assert.equal(appointmentActions({...later,doctorId:7},doctor).remind,false,'Doctors do not send reminders');
  assert.equal(appointmentActions(later,{...doctor,userId:8}).document,false);
  assert(Object.values(appointmentActions(done,staff)).every(v=>!v));
  // Triage vitals: the front desk takes them on the visit day and may correct them until it is completed.
  assert.equal(appointmentActions(appt(5,'2026-10-24','09:00'),staff).vitals,false,'Not before the visit day');
  assert.equal(appointmentActions(past,doctor).vitals,false,'Doctors read the triage vitals; the front desk records them');
  assert.equal(appointmentActions(later,{role:'Administrator',userId:1,today,now}).vitals,false);
  assert.equal(appointmentActions(done,staff).vitals,false,'Locked once the visit is completed');
});

test('day headings and CSV export',()=>{
  assert.equal(appointmentDayHeading('2026-10-23',today),'Today, Oct 23, 2026');
  assert.equal(appointmentDayHeading('2026-10-24',today),'Tomorrow, Oct 24, 2026');
  assert.equal(appointmentDayHeading('2026-10-22',today),'Yesterday, Oct 22, 2026');
  assert.equal(appointmentDayHeading('2026-12-16',today),'Wednesday, Dec 16, 2026');
  const csv=appointmentsCsv([appt(1,'2026-10-23','08:00')],a=>({no:a.id,date:a.date,time:a.time,status:a.status,priority:'Student',patientNo:'P-1',lastName:'Cruz',firstName:'Ana',college:'CCICT',clinic:'Medical Clinic',service:'Check-up',reason:'=cmd',doctor:'Dr. Reyes'}));
  assert.match(csv,/^\ufeffAppointment No\.,Appointment: Date,Appointment: Time \(PH\),Appointment: Status/,'Grouped "Group: Field" headers, identifier first');
  assert.match(csv,/Patient: Last Name,Patient: First Name/);
  assert.match(csv,/"'=cmd",Dr\. Reyes\r\n$/);
});
