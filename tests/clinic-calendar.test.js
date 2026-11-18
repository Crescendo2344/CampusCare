import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calendarClinicFor,calendarScope,dayCounts,dayQueue,monthGrid,nowServing,shiftMonth} from '../src/domain/clinic-calendar.js';

const appt=(id,clinic,doctorId,date,time,status='Scheduled')=>({id,clinic,doctorId,date,time,status});
const rows=[
  appt(1,'Medical Clinic',130,'2026-11-19','09:00'),
  appt(2,'Medical Clinic',130,'2026-11-19','09:30','Completed'),
  appt(3,'Dental Clinic',4,'2026-11-19','09:00'),
  appt(4,'Dental Clinic',4,'2026-11-19','10:00','Cancelled'),
  appt(5,'Medical Clinic',131,'2026-11-20','08:00','No-show')
];

test('each person opens only their own clinic',()=>{
  assert.equal(calendarClinicFor({role:'Staff',clinic:'Dental Clinic'}),'Dental Clinic');
  assert.equal(calendarClinicFor({role:'Staff',clinic:'Medical Clinic'}),'Medical Clinic');
  assert.equal(calendarClinicFor({role:'Doctor',specialty:'Dental'}),'Dental Clinic');
  assert.equal(calendarClinicFor({role:'Doctor',specialty:'General Medicine'}),'Medical Clinic');
  assert.equal(calendarClinicFor({role:'Staff',clinic:null}),'','Unassigned staff get no clinic');
  assert.equal(calendarClinicFor({role:'Administrator'}),'');
  assert.equal(calendarClinicFor({role:'Patient'}),'');
});

test('medical people never see dental bookings and the reverse',()=>{
  assert.deepEqual(calendarScope(rows,{role:'Staff',clinic:'Medical Clinic'}).map(a=>a.id),[1,2,5]);
  assert.deepEqual(calendarScope(rows,{role:'Staff',clinic:'Dental Clinic'}).map(a=>a.id),[3,4]);
  // A doctor sees only their own bookings, even within the same clinic.
  assert.deepEqual(calendarScope(rows,{role:'Doctor',specialty:'General Medicine',id:130}).map(a=>a.id),[1,2]);
  assert.deepEqual(calendarScope(rows,{role:'Doctor',specialty:'Dental',id:130}),[],'A dentist cannot see medical bookings');
  assert.deepEqual(calendarScope(rows,{role:'Administrator'}),[]);
  assert.deepEqual(calendarScope(rows,{role:'Patient'}),[]);
});

test('month grid has six weeks from Sunday and day counts split by outcome',()=>{
  const grid=monthGrid('2026-11');
  assert.equal(grid.length,42);
  assert.equal(grid[0].date,'2026-11-01');
  assert.equal(grid.filter(d=>d.inMonth).length,30);
  assert.equal(grid.find(d=>d.date==='2026-11-21').weekend,true);
  assert.equal(shiftMonth('2026-12',1),'2027-01');
  assert.equal(shiftMonth('2026-01',-1),'2025-12');
  const c=dayCounts(rows);
  assert.deepEqual(c['2026-11-19'],{total:3,waiting:2,completed:1,noShow:0,cancelled:1});
  assert.deepEqual(c['2026-11-20'],{total:1,waiting:0,completed:0,noShow:1,cancelled:0});
});

test('the day queue is in time order with numbers per doctor and hour; cancelled come last unnumbered',()=>{
  const day=[
    appt(10,'Medical Clinic',130,'2026-11-19','10:00'),
    appt(11,'Medical Clinic',130,'2026-11-19','09:00'),
    appt(12,'Medical Clinic',130,'2026-11-19','09:20'),
    appt(13,'Medical Clinic',130,'2026-11-19','09:10','Cancelled')
  ];
  const {live,cancelled}=dayQueue(day,'2026-11-19');
  assert.deepEqual(live.map(a=>[a.id,a.queueNo]),[[11,1],[12,2],[10,1]]);
  assert.deepEqual(cancelled.map(a=>[a.id,a.queueNo]),[[13,null]]);
  assert.equal(nowServing(live,{date:'2026-11-19',today:'2026-11-19',now:'09:40'}).id,11);
  assert.equal(nowServing(live.map(a=>a.id===11?{...a,status:'Completed'}:a),{date:'2026-11-19',today:'2026-11-19',now:'09:40'}).id,12);
  assert.equal(nowServing(live,{date:'2026-11-20',today:'2026-11-19',now:'09:40'}),null,'Only today has a now-serving patient');
});

test('the page is in the staff and doctor menus only',()=>{
  const nav=fs.readFileSync('src/features/topbarAndNavigation.js','utf8');
  const section=role=>nav.slice(nav.indexOf(`  ${role}:[`),nav.indexOf('],',nav.indexOf(`  ${role}:[`)));
  assert(section('Staff').includes("'clinic-calendar'"));
  assert(section('Doctor').includes("'clinic-calendar'"));
  assert(!section('Patient').includes("'clinic-calendar'"));
  assert(!section('Administrator').includes("'clinic-calendar'"));
});
