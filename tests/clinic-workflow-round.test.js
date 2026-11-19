import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('every booking keeps the clinic lead time, whoever books it; reappointments may use nearer slots',()=>{
  const form=read('src/features/bookingForm.js');
  assert.match(form,/export function applyBookingLead\(days,now=Date\.now\(\)\)/);
  assert.ok(!/role!=='Patient'\|\|!\(lead>0\)/.test(form),'staff bookings are no longer exempt');
  assert.ok(!form.includes("if(appState.auth.currentUser?.role==='Patient'){\n    const lead"),'the slot check applies to everyone');
  const server=read('supabase/functions/appointment-actions/index.ts');
  assert.match(server,/if\(!reappoint\)\{\n\s+const leadHours=/,'the server enforces it for every booking or move except a reappointment');
});

test('a visit that cannot push through is rescheduled with a confirmation deadline, like an emergency',()=>{
  const server=read('supabase/functions/appointment-actions/index.ts');
  assert.match(server,/const reappointDeadline=reappoint\?confirmationDeadline\(Date\.now\(\),date,time\):null;/);
  assert.match(server,/reappoint_deadline:reappointDeadline/);
  assert.match(server,/in CampusCare by \$\{prettyDeadline\(reappointDeadline\)\}/);
  const ui=read('src/features/reappointment.js');
  assert.match(ui,/export const REAPPOINT_SEARCH_DAYS=56;/,'the doctor chooses from the next eight weeks');
  assert.match(ui,/initModernCalendar\('ra-calendar'/,'on a calendar of open dates');
  assert.match(ui,/Earliest open time/);
});

test('patients get a dental visit summary, never the official dental record',()=>{
  const form=read('src/features/treatmentForm.js');
  assert.match(form,/if\(isPatientViewer\(\)&&isDentalTreatment\(t\)\)return viewDentalVisitSummary\(id\);/);
  for(const fn of ['printDentalRecord','downloadDentalRecordPDF','downloadDentalRecordWord','printTreatmentRecord','downloadTreatmentPDF']){
    const start=form.indexOf(`function ${fn}(`);
    assert.ok(start>0,fn);
    assert.ok(form.slice(start,start+220).includes('if(patientDentalBlocked(t))return;'),`${fn} is closed to patients for dental visits`);
  }
  const sql=read('supabase/migrations/20261119015542_dental_record_clinic_only.sql');
  assert.ok(!sql.includes('current_patient_id'),'patients no longer read dental_records');
});

test('the inactive-patient archive is listed in the backup history',()=>{
  const sql=read('supabase/migrations/20261119015817_inactive_archive_in_backup_history.sql');
  assert.match(sql,/values\('Inactive Patient Archive'/);
  assert.match(sql,/cron\.schedule\('campuscare-archive-inactive-patients','40 18 \* \* \*',\$job\$select private\.run_inactive_patient_archive\(5\);\$job\$\)/);
  const ui=read('src/features/serverBackups.js');
  assert.match(ui,/if\(b\.type===INACTIVE_ARCHIVE_TYPE\)return \{day,html:inactiveArchiveRowHtml\(b\)\};/);
});

test('the manual reminder is a visible button on scheduled appointments, not hidden in the menu',()=>{
  const page=read('src/features/appointments.js');
  assert.match(page,/const remind=allowed\.remind\?`<button class="btn \$\{size\} appt-remind"/);
  assert.match(page,/return \{primary:primary\+remind,more\};/);
  assert.ok(!page.includes('> Send reminder</button>`,'),'no longer only in the row menu');
});
