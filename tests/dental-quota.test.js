// The Dental Clinic semester limit counts only visits the dentist has completed, never a booking.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the patient dashboard counts only completed dental visits toward the semester limit',()=>{
  const dashboard=fs.readFileSync('src/features/dashboard.js','utf8');
  assert.match(dashboard,/const dental=dentalQuotaState\(pt\.id\)/,'The dashboard uses the same quota as booking');
  assert.match(dashboard,/`\$\{dental\.completed\}\/\$\{dental\.limit\}`/);
  assert.doesNotMatch(dashboard,/clinic==='Dental Clinic'&&a\.status!=='Cancelled'/,'A scheduled visit must not count as used');
  const quota=fs.readFileSync('src/features/documentScanner.js','utf8');
  assert.match(quota,/const completed=dental\.filter\(a=>a\.status==='Completed'&&getSemester\(a\.date\)===sem\)\.length/);
});
