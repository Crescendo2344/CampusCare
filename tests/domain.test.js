// These checks run against real ES modules without a browser or live database.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/domain/schedule.js';
import { createDraftStorage } from '../src/services/draft-storage.js';

const doctor={id:1,startTime:'08:00',endTime:'17:00',slotDuration:60,maxPatients:20,workDays:['Mon','Tue','Wed','Thu','Fri']};
const today='2026-10-08';

test('slots fit entirely inside a shift and respect configurable lunch boundaries',()=>{
  assert.deepEqual(rules.appointmentSlotBaseTimes({...doctor,endTime:'09:15'}),['08:00']);
  assert.equal(rules.isDefaultLunchSlot('11:00',doctor),false);
  assert.equal(rules.isDefaultLunchSlot('12:00',doctor),true);
  assert.equal(rules.isDefaultLunchSlot('11:00',doctor,{lunchBreakStart:'11:30',lunchBreakEnd:'12:30'}),true);
});

test('conflicts consider recurring days, slot times, capacity, status and effective date',()=>{
  const appointments=[
    {id:1,doctorId:1,date:'2026-10-09',time:'08:00',status:'Confirmed'},
    {id:2,doctorId:1,date:'2026-10-09',time:'09:00',status:'Pending'},
    {id:3,doctorId:1,date:'2026-10-10',time:'08:00',status:'Scheduled'},
    {id:4,doctorId:1,date:'2026-10-10',time:'08:00',status:'Cancelled'},
    {id:5,doctorId:2,date:'2026-10-10',time:'08:00',status:'Scheduled'},
    {id:6,doctorId:1,date:'2026-10-07',time:'08:00',status:'Scheduled'},
  ];
  assert.deepEqual(rules.scheduleConflicts(doctor,doctor,today,appointments).map(a=>a.id),[3]);
  assert.deepEqual(rules.scheduleConflicts(doctor,{...doctor,maxPatients:1},today,appointments).map(a=>a.id),[1,2,3]);
  assert.deepEqual(rules.scheduleConflicts(doctor,{...doctor,startTime:'09:00'},today,appointments).map(a=>a.id),[1,3]);
});

test('schedule validation uses supplied context instead of application globals',()=>{
  const proposal={...doctor,endTime:'16:00'};
  assert.equal(rules.validateSchedule(proposal,today,doctor,true,{today}), '');
  assert.match(rules.validateSchedule(proposal,'2026-10-07',doctor,true,{today}),/future/);
  assert.match(rules.validateSchedule({...proposal,workDays:[]},today,doctor,true,{today}),/work day/);
  assert.match(rules.validateSchedule({...proposal,slotDuration:0},today,doctor,true,{today}),/Slot duration/);
  assert.match(rules.validateSchedule(proposal,today,doctor,true,{today,requests:[{doctorId:1,status:'Pending'}]}),/outstanding/);
  assert.equal(rules.validateSchedule(proposal,today,doctor,true,{today,requests:[{doctorId:2,status:'Pending'}]}),'');
  assert.match(rules.validateSchedule(doctor,today,doctor,true,{today}),/matches/);
});

test('future schedule selection ignores pending requests and keeps input records intact',()=>{
  const requests=[{doctorId:1,status:'Approved-Pending',effectiveDate:'2026-10-12',requested:{...doctor,workDays:['Mon']}},
    {doctorId:1,status:'Pending',effectiveDate:'2026-10-13',requested:{...doctor,workDays:['Tue']}}];
  const original=JSON.stringify({doctor,requests});
  assert.equal(rules.campusScheduleForDate(doctor,today,requests),doctor);
  assert.deepEqual(rules.campusScheduleForDate(doctor,'2026-10-14',requests).workDays,['Mon']);
  assert.equal(JSON.stringify({doctor,requests}),original);
});

test('draft storage keeps accounts and demo/live modes separate and handles broken storage',()=>{
  const rows=new Map();const storage={getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v)};
  let account={id:1};const drafts=createDraftStorage(storage,()=>account);
  drafts.write('drafts',{schedule:{days:['Mon']}});
  account={id:2};assert.deepEqual(drafts.read('drafts',{}),{});
  account={id:1,_realSupabase:true};assert.deepEqual(drafts.read('drafts',{}),{});
  account={id:1};assert.deepEqual(drafts.read('drafts',{}),{schedule:{days:['Mon']}});
  rows.set(drafts.key('drafts'),'invalid json');assert.deepEqual(drafts.read('drafts',{}),{});
  const blocked=createDraftStorage({getItem(){throw Error('blocked');},setItem(){throw Error('quota');}},()=>account);
  assert.deepEqual(blocked.read('drafts',{}),{});
  assert.throws(()=>blocked.write('drafts',{}),/quota/);
});
