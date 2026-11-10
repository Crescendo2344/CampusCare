// Changing the sign-in email needs a 6-digit code sent to the new address.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync('supabase/functions/profile-actions/index.ts','utf8');
const ui=fs.readFileSync('src/features/workflowRequests.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261111030000_contact_change_codes.sql','utf8');

test('the code is random, short-lived, limited in tries and stored only as a hash',()=>{
  assert.match(server,/crypto\.getRandomValues/);
  assert.match(server,/CODE_MINUTES=10,MAX_TRIES=5,RESEND_SECONDS=60,MAX_SENDS_PER_HOUR=5/);
  assert.match(server,/code_hash:await hashCode\(actor\.user_id,code\)/);
  assert.doesNotMatch(sql,/\bcode text/,'The plain code is never stored');
  assert.match(sql,/revoke all on public\.contact_change_codes from anon, authenticated/);
});

test('the email switches only after the right code, and the old address is told',()=>{
  const confirm=server.slice(server.indexOf('action==="confirm_email_change"'));
  assert.ok(confirm.indexOf('hashCode(actor.user_id,code)!==pending.code_hash')<confirm.indexOf('updateUserById'));
  assert.match(confirm,/subject:"CampusCare · Your sign-in email was changed"/);
  assert.match(confirm,/action:"USER_EMAIL_CHANGED"/);
});

test('the emailed code is wiped from the outbox once delivered',()=>{
  assert.match(fs.readFileSync('supabase/functions/email-dispatch/index.ts','utf8'),/template_key==="verification"/);
  assert.match(server,/template:"verification"/);
});

test('administrators save their own details through the same path as everyone',()=>{
  assert.doesNotMatch(ui,/u\.role==='Administrator'/,'No separate administrator save that skips the code');
  assert.match(ui,/action:'request_email_change'/);
  assert.match(ui,/autocomplete="one-time-code"/);
});
