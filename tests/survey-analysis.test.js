import test from 'node:test';
import assert from 'node:assert/strict';
import {charterAwareness,countBy,filterSurveys,overallSatisfaction,satisfaction,surveysCsv} from '../src/domain/survey-analysis.js';

const rows=[
  {createdAt:'2026-10-01T02:00:00Z',groupType:'Student',service:'Cleaning',ratings:{overall:'5'},sqd:{sqd0:'5',sqd5:'N/A',sqd7:'4'},citizensCharter:{cc1:'Yes, I know and I saw this office’s CC'},suggestions:'More chairs',patient:{first_name:'Ana'}},
  {createdAt:'2026-09-01T02:00:00Z',groupType:'Personnel',service:'Extraction',ratings:{overall:'3'},sqd:{sqd0:'3',sqd7:'2'},citizensCharter:{cc1:'No, I do not know and I did not see one in this office'}}
];
test('satisfaction counts 4 and 5 and leaves out N/A',()=>{
  assert.deepEqual(satisfaction(rows,'sqd0'),{base:2,satisfied:1,pct:50});
  assert.deepEqual(satisfaction(rows,'sqd5'),{base:0,satisfied:0,pct:null});
  assert.deepEqual(overallSatisfaction(rows),{base:4,satisfied:2,pct:50});
  assert.deepEqual(charterAwareness(rows),{base:2,aware:1,pct:50});
});
test('filters, groups and anonymous export',()=>{
  assert.equal(filterSurveys(rows,{from:'2026-09-15'}).length,1);
  assert.equal(filterSurveys(rows,{group:'Personnel'}).length,1);
  assert.deepEqual(countBy(rows,r=>r.service),[['Cleaning',1],['Extraction',1]]);
  const csv=surveysCsv(rows);
  assert(!csv.includes('Ana'));assert.match(csv,/More chairs/);
});
