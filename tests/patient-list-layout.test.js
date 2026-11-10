// The patient list shows real last visits and never scrolls sideways.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync('src/features/patientManagement.js','utf8');
const css=fs.readFileSync('src/styles/workspace-polish.css','utf8');

test('Last Visit uses the visits themselves, including walk-in treatments',()=>{
  const load=src.slice(src.indexOf('export async function renderPatients'),src.indexOf('const canEdit'));
  assert.match(load,/syncRealAppointments\(\)/,'Appointments are loaded on this page');
  assert.match(load,/loadTreatmentVisitDates\(\)/,'Treatment dates are loaded for staff, who cannot read visit notes');
  assert.match(src,/readTreatmentFactPages\(/);
});

test('narrow screens fold columns under the name instead of scrolling',()=>{
  assert.doesNotMatch(src,/<th>Class Session<\/th>|<th>Blood<\/th>/,'Class session sits under Type; blood type is on the record');
  for(const width of [1180,1024,860])assert.match(css,new RegExp(`@media \\(max-width:${width}px\\)\\{\\.patient-records-table`));
  assert.match(src,/pt-fold-age[\s\S]*pt-fold-college[\s\S]*pt-fold-type/);
});
