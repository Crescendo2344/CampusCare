// Importing these modules requires no application startup or browser globals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeValue } from '../src/shared/input-values.js';
import { getSemester,fmtDate,fmtDateTime,fmtTime,genId } from '../src/shared/formatting.js';
import { statusBadge,collegeBadge,priorityBadge,svgIcon } from '../src/ui/display-markup.js';

test('input policies preserve supported names and normalize account/contact values',()=>{
  const cases=[
    ['name',"Jo  Sánchez42!",'Jo Sánchez'],
    ['username','jo name!_234','joname_234'],
    ['email',' JO@CTU.EDU.PH ','jo@ctu.edu.ph'],
    ['phone','+63 (905) 424-7230','63905424723'],
    ['password','a b\tc','abc'],
    ['idno','CTU 2026/123','CTU2026123'],
    ['identifier',' JO@ctu.edu.ph! ','JO@ctu.edu.ph'],
    ['code','12a345678','123456'],
    ['text','<Hello>','Hello'],
    ['unknown',' unchanged ',' unchanged '],
  ];
  for(const [type,value,expected] of cases)assert.equal(sanitizeValue(value,type),expected,type);
  for(const [type,limit] of [['name',50],['username',20],['email',150],['password',64],['idno',20],['identifier',60],['text',200]]){
    assert.equal(sanitizeValue('a'.repeat(250),type).length,limit,type);
  }
});

test('formatters preserve placeholders, calendar boundaries and clock labels',()=>{
  assert.equal(getSemester(null),null);
  assert.equal(getSemester('2026-06-15'), '2026-S1');
  assert.equal(getSemester('2026-07-15'), '2026-S2');
  assert.equal(fmtDate(''),'-');assert.equal(fmtDate('invalid'),'-');
  assert.equal(fmtDateTime(null),'-');assert.equal(fmtDateTime('invalid'),'-');
  assert.equal(fmtDate('2026-10-08'),new Date(2026,9,8).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}));
  for(const [value,label] of [['','-'],['00:00','12:00 AM'],['12:30','12:30 PM'],['17:15','5:15 PM']])assert.equal(fmtTime(value),label);
  assert.equal(genId('PT',7),'PT-0007');
});

test('display helpers preserve status classes, default classes and icon dimensions',()=>{
  assert.equal(statusBadge('Pending'),'<span class="badge badge-warning">Pending</span>');
  assert.equal(statusBadge('Other'),'<span class="badge badge-gray">Other</span>');
  assert.equal(collegeBadge(''),'');
  assert.equal(collegeBadge('COT'),'<span class="badge college-COT">COT</span>');
  assert.equal(priorityBadge('Student'),'<span class="badge badge-info">Student</span>');
  assert.equal(priorityBadge(null),'<span class="badge badge-gray">-</span>');
  assert.match(svgIcon('M1 2',20),/width:20px;height:20px/);
  assert.match(svgIcon('M1 2'),/d="M1 2"/);
});
