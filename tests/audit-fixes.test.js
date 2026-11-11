// Regression checks for the November security audit: who may read health data, and how usernames sign in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('username sign-in never returns the account email and is throttled',()=>{
  const fn=read('supabase/functions/resolve-login/index.ts');
  assert.doesNotMatch(fn,/json\(\{[^}]*email:/,'The email is never sent back');
  assert.match(fn,/grant_type=password/);
  assert.match(fn,/login_attempts/);
  assert.match(fn,/\.replace\(\/_\/g/,'Underscores are escaped so a username is not a wildcard pattern');
  const client=read('src/features/loginLockout.js');
  assert.match(client,/setSession/);
  assert.match(read('supabase/migrations/20261111090000_login_attempts.sql'),/revoke all on (table )?public\.login_attempts from anon, authenticated/i);
});

test('the clinical summary and FHIR export are for the patient\'s doctor only',()=>{
  const fn=read('supabase/functions/clinical-intelligence/index.ts');
  assert.match(fn,/if\(actor\.role!=="Doctor"\)/);
  assert.doesNotMatch(fn,/"Administrator"/);
  assert.doesNotMatch(fn,/"Staff"/);
  assert.match(fn,/not linked to your appointment or treatment history/);
});

test('administrators cannot read medical history or allergies',()=>{
  const sql=read('supabase/migrations/20261111091000_patient_health_fields_hidden_from_admins.sql');
  assert.match(sql,/revoke select on public\.patients from authenticated/);
  const grant=sql.slice(sql.indexOf('grant select ('),sql.indexOf(') on public.patients to authenticated'));
  assert.doesNotMatch(grant,/medical_history|allergies/);
  assert.match(sql,/has_role\(array\['Doctor','Staff'\]\)/);
  assert.doesNotMatch(sql,/'Administrator'/);
  for(const file of ['supabase/functions/admin-users/index.ts','supabase/functions/admin-approvals/index.ts'])
    assert.doesNotMatch(read(file).replace(/\/\/.*$/gm,''),/medical_history|allergies/,file);
  assert.doesNotMatch(read('src/features/userManagement.js'),/'Allergies'|'Medical History'/);
});

test('functions that are not used are gone from the repository list, and html_escape has a fixed search path',()=>{
  for(const name of ['admin-directory','uat-actions','security-integrity','registration-reset-once'])
    assert.equal(fs.existsSync(`supabase/functions/${name}`),false,name);
  for(const name of ['resolve-login','clinical-intelligence','privacy-public'])
    assert.ok(fs.existsSync(`supabase/functions/${name}/index.ts`),name);
  assert.match(read('supabase/migrations/20261111092000_html_escape_search_path.sql'),/set search_path = ''/);
});
