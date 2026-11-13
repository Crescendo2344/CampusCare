// A General Medicine doctor issues medical certificates; a dental doctor issues dental certificates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {certificateKindFor,certificateLabel} from '../src/domain/clinic-scope.js';

test('certificate format follows the doctor or staff clinic',()=>{
  assert.equal(certificateKindFor({role:'Doctor',specialty:'General Medicine'}),'medical');
  assert.equal(certificateKindFor({role:'Doctor',specialty:'Dental'}),'dental');
  assert.equal(certificateKindFor({role:'Staff',clinic:'Dental Clinic'}),'dental');
  assert.equal(certificateKindFor({role:'Staff',clinic:'Medical Clinic'}),'medical');
  assert.equal(certificateLabel('medical',true),'Medical Certificates');
  assert.equal(certificateLabel('dental'),'Dental Certificate');
});

test('certificates need a fresh signature and use the CTU letterhead',()=>{
  const src=fs.readFileSync('src/features/certificateService.js','utf8');
  assert.match(src,/Sign in the signature box before issuing/);
  assert.doesNotMatch(src,/useSavedDoctorSignature\(\)\)/,'No "use saved signature" button');
  assert.match(src,/MEDICAL CERTIFICATE/);assert.match(src,/DENTAL CERTIFICATE/);
  for(const f of ['src/features/treatmentForm.js','src/features/patientForm.js','src/features/fitnessAssessments.js','src/features/stockOrders.js','src/features/reportCharts.js'])
    assert.match(fs.readFileSync(f,'utf8'),/ctu-letterhead\.js/,f);
});

test('fitness assessments no longer ask for a competition date',()=>{
  assert.doesNotMatch(fs.readFileSync('src/features/fitnessAssessments.js','utf8'),/Competition \/ Event Date|fit-event-date/);
});
