import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Patients who have not arrived one hour after their appointment time are marked No-show by a job.
test('the no-show job waits one hour and treats vitals, a visit record or check-in as arrival',()=>{
  const sql=fs.readFileSync('supabase/migrations/20261118215122_auto_no_show_after_one_hour.sql','utf8');
  assert.match(sql,/at time zone 'Asia\/Manila'\)\+interval '1 hour'<=now\(\)/);
  for(const arrival of ['appointment_vitals','treatments',"h.source='check-in'"])assert.ok(sql.includes(arrival),arrival);
  assert.match(sql,/coalesce\(a\.patient_response,''\)<>'Awaiting'/,'Proposed times waiting for the patient keep their own deadline');
  assert.match(sql,/status='No-show'/);
  assert.match(sql,/cron\.schedule\('campuscare-auto-no-show','\*\/10 \* \* \* \*'/);
  assert.match(sql,/revoke all on function private\.mark_overdue_no_shows\(\) from public, anon, authenticated/);
});
