// A blank allergy field is not the same as "no known allergies".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {allergyStatus} from '../src/domain/patient-records.js';

test('blank, none and listed allergies are told apart',()=>{
  for(const blank of ['',null,undefined,'   '])assert.equal(allergyStatus(blank),'unrecorded');
  for(const none of ['None','N/A','NKA','No known allergies.','no'])assert.equal(allergyStatus(none),'none');
  assert.equal(allergyStatus('Penicillin'),'alert');
});

test('the visit record card asks the doctor to check when allergies are not recorded',()=>{
  const card=fs.readFileSync('src/features/treatmentForm.js','utf8');
  assert.match(card,/unrecorded:.*Allergies not recorded · ask the patient/);
  assert.match(card,/\[patientData\.allergyStatus\(pt\.allergies\)\]/);
});
