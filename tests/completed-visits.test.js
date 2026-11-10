// A "visit" is an appointment the doctor completed (or a recorded treatment). A booking, a no-show or a
// cancellation never counts as a visit, toward a limit, or as a patient seen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dashboard=fs.readFileSync('src/features/dashboard.js','utf8');

test('the patient dashboard counts only completed dental visits toward the semester limit',()=>{
  assert.match(dashboard,/const dental=dentalQuotaState\(pt\.id\)/,'The dashboard uses the same quota as booking');
  assert.match(dashboard,/`\$\{dental\.completed\}\/\$\{dental\.limit\}`/);
  assert.doesNotMatch(dashboard,/clinic==='Dental Clinic'&&a\.status!=='Cancelled'/,'A scheduled visit must not count as used');
  const quota=fs.readFileSync('src/features/documentScanner.js','utf8');
  assert.match(quota,/const completed=dental\.filter\(a=>a\.status==='Completed'&&getSemester\(a\.date\)===sem\)\.length/);
});

test('every Patient Visits chart plots completed visits, not bookings',()=>{
  assert.match(dashboard,/const globalTrend=dashboardRangeCounts\(a=>a\.status==='Completed'\)/);
  assert.match(dashboard,/const visitTrend=dashboardRangeCounts\(a=>a\.doctorId===appState\.auth\.currentUser\.id&&a\.status==='Completed'\)/);
  assert.doesNotMatch(dashboard,/dashboardTrendSvg\(\w+,'Appointments'\)/);
});

test("a doctor's patients are the ones they have seen",()=>{
  assert.match(dashboard,/const uniquePatients=new Set\(completed\.map\(a=>a\.patientId\)\)\.size/);
  assert.match(dashboard,/const firstVisits=\[\.\.\.\[\.\.\.completed\]/);
  assert.doesNotMatch(dashboard,/seen or booked/);
});

test('report analytics count unique patients from completed visits and treatments only',()=>{
  const fn=fs.readFileSync('supabase/functions/analytics-summary/index.ts','utf8');
  assert.match(fn,/currentAppts\.filter\(\(a:any\)=>a\.status==="Completed"\)\.forEach\(\(a:any\)=>uniquePatients\.add/);
  assert.doesNotMatch(fn,/currentAppts\.forEach\(\(a:any\)=>uniquePatients\.add/);
});
