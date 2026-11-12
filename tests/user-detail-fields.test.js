// User Management: patient-only fields (person type, college, identity documents) appear on patient
// accounts only. Clinic accounts keep their Employee ID.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('clinic accounts show their Employee ID but not patient-only fields',()=>{
  const src=fs.readFileSync('src/features/userManagement.js','utf8');
  assert.match(src,/const patientAccount=d\.role==='Patient'/);
  assert.match(src,/\$\{patientAccount\?userDetailField\('Person Type',d\.person_type\):''\}/);
  assert.match(src,/\$\{patientAccount\?userDetailField\('College \/ Department',d\.college\):''\}/);
  assert.match(src,/\$\{patientAccount\?userDetailField\('Verification Document',documentTitle\):''\}/);
  assert.match(src,/userDetailField\(patientAccount&&d\.person_type==='Student'\?'Student ID No\.':'Employee ID No\.',d\.id_number\)/,'Employee ID stays for everyone');
});
