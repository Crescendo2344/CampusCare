import test from 'node:test';
import assert from 'node:assert/strict';
import {CERTIFICATE_PURPOSES,certificateDetailErrors,certificateStatement} from '../src/domain/certificate-purpose.js';

const today='2026-10-23';
test('only the three purposes are allowed',()=>{
  assert.deepEqual(CERTIFICATE_PURPOSES,['OJT / Internship Requirement','Excused Absence','Sports / Athletics Participation']);
  assert(certificateDetailErrors('Employment Requirement',{},today).purpose);
});
test('excused absence needs a valid date range',()=>{
  assert.deepEqual(Object.keys(certificateDetailErrors('Excused Absence',{},today)),['absentFrom','absentTo']);
  assert(certificateDetailErrors('Excused Absence',{absentFrom:'2026-10-22',absentTo:'2026-10-20'},today).absentTo);
  assert(certificateDetailErrors('Excused Absence',{absentFrom:'2026-09-01',absentTo:'2026-10-15'},today).absentTo);
  assert.deepEqual(certificateDetailErrors('Excused Absence',{absentFrom:'2026-10-20',absentTo:'2026-10-22'},today),{});
  assert.match(certificateStatement('Excused Absence',{absentFrom:'2026-10-20',absentTo:'2026-10-22'}).statement,/from October 20, 2026 to October 22, 2026 \(3 days\)/);
  assert.match(certificateStatement('Excused Absence',{absentFrom:'2026-10-20',absentTo:'2026-10-20'}).statement,/on October 20, 2026 \(1 day\)/);
});
test('fitness purposes need a result, restrictions when given, and the sport',()=>{
  assert(certificateDetailErrors('OJT / Internship Requirement',{},today).fitness);
  assert(certificateDetailErrors('OJT / Internship Requirement',{fitness:'Fit with restrictions'},today).restrictions);
  assert(certificateDetailErrors('Sports / Athletics Participation',{fitness:'Fit'},today).event);
  assert.deepEqual(certificateDetailErrors('Sports / Athletics Participation',{fitness:'Fit',event:'Basketball'},today),{});
  assert.equal(certificateStatement('Sports / Athletics Participation',{fitness:'Fit with restrictions',restrictions:'no contact drills',event:'Basketball'}).statement,'is physically fit to participate in Basketball, with the following restrictions: no contact drills.');
});
