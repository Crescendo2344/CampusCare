import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {toCsv} from '../src/shared/csv.js';

// The reader lives beside DOM code, so load just its pure functions.
const src=fs.readFileSync('src/features/downloadFormats.js','utf8');
const pure=src.slice(src.indexOf('// A small CSV reader'),src.indexOf('const titleFrom'));
const {parseCsv,csvToObjects}=await import('data:text/javascript,'+encodeURIComponent(pure));

test('list exports are read back into rows for Excel, Word and PDF',()=>{
  const csv=toCsv([['Appointment No.','Patient: Last Name','Notes','Visit: Count'],['000012','Dela Cruz','Said "ok", then left\nearly',3],['000013','=Reyes','',0]]);
  assert.deepEqual(parseCsv(csv)[1],['000012','Dela Cruz','Said "ok", then left\nearly','3']);
  const rows=csvToObjects(csv);
  assert.equal(rows.length,2);
  assert.equal(rows[0]['Appointment No.'],'000012','Leading zeros are kept');
  assert.equal(rows[0]['Visit: Count'],3);
  assert.equal(rows[1]['Patient: Last Name'],'=Reyes','The formula guard apostrophe is not shown');
});
test('every list download goes through the format chooser, and reports put names first',()=>{
  for(const f of ['appointments','dentalSurvey','emailDelivery','inventory','inventoryService','patientManagement','treatmentList'])
    assert.doesNotMatch(fs.readFileSync(`src/features/${f}.js`,'utf8'),/downloadCsv\(/,f);
  assert.match(fs.readFileSync('src/reports/custom-report.js','utf8'),/detailOrder=\['patient','idNo'/);
});
