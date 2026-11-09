import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWeekly,dayLimit,sameWeekly,shiftLabel,shortTime,weekDates,weeklyFromServer,weeklyFromSummary} from '../src/domain/doctor-coverage.js';

test('times read like a clinic timetable',()=>{
  assert.equal(shortTime('08:00:00'),'8 AM');
  assert.equal(shortTime('17:30'),'5:30 PM');
  assert.equal(shortTime('12:00'),'12 PM');
  assert.equal(shiftLabel({isWorking:true,startTime:'08:00:00',endTime:'17:00:00'}),'8 AM – 5 PM');
  assert.equal(shiftLabel({isWorking:false}),'Off');
});

test('weekly hours, capacity and the daily limit follow the server rules',()=>{
  const week=weeklyFromSummary({workDays:['Mon','Tue','Wed','Thu','Fri'],startTime:'08:00',endTime:'17:00'});
  const ok=assessWeekly(week,60,9);
  assert.deepEqual(ok.errors,[]);
  assert.equal(ok.weeklyHours,45);assert.equal(ok.weeklyCapacity,45);assert.equal(ok.minSlots,9);
  // A limit above the slots is not an error; each day is capped at its own slot count.
  const halfSat=[...week.slice(0,5),{day:'Sat',isWorking:true,startTime:'08:00',endTime:'12:00'},week[6]];
  const capped=assessWeekly(halfSat,60,9);
  assert.deepEqual(capped.errors,[]);assert.deepEqual(capped.cappedDays,['Sat']);assert.equal(capped.weeklyCapacity,49);
  assert.equal(dayLimit(halfSat[5],60,9),4);assert.equal(dayLimit(week[0],60,9),9);
  const short=week.map(d=>d.day==='Wed'?{...d,startTime:'08:00',endTime:'08:30'}:d);
  assert.match(assessWeekly(short,60,1).errors.join(' '),/Wednesday: the hours are shorter/);
  const backwards=week.map(d=>d.day==='Fri'?{...d,startTime:'17:00',endTime:'08:00'}:d);
  assert.match(assessWeekly(backwards,60,5).errors.join(' '),/Friday: the start time must be before/);
  assert.match(assessWeekly(week.map(d=>({...d,isWorking:false})),60,5).errors[0],/at least one work day/);
});

test('server rows keep per-day hours and changes are detected',()=>{
  const rows=[{day:'Mon',isWorking:true,startTime:'09:00',endTime:'12:00'},{day:'Sat',isWorking:true,startTime:'08:00',endTime:'10:00'}];
  const week=weeklyFromServer(rows);
  assert.equal(week.find(d=>d.day==='Mon').startTime,'09:00');
  assert.equal(week.find(d=>d.day==='Tue').isWorking,false);
  assert(sameWeekly(week,weeklyFromServer(rows)));
  assert(!sameWeekly(week,week.map(d=>d.day==='Mon'?{...d,endTime:'13:00'}:d)));
  // Hours on a day off are irrelevant to whether anything changed.
  assert(sameWeekly(week,week.map(d=>d.day==='Tue'?{...d,startTime:'07:00'}:d)));
});

test('the clinic week runs Monday to Sunday',()=>{
  assert.deepEqual(weekDates('2026-10-24'),['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
  assert.equal(weekDates('2026-10-19')[0],'2026-10-19');
});
