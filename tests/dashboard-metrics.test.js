// Independent source records must produce independent card trends, with honest handling of unknown dates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {metricSeries} from '../src/domain/dashboard-metrics.js';
const points=[{key:'2026-10-14'},{key:'2026-10-15'},{key:'2026-10-16'}];
test('patient registration cohorts and appointment activity have different series',()=>{
 const patients=metricSeries(points,[{date:'2026-10-01'},{date:'2026-10-15'}],{cumulative:true});
 const visits=metricSeries(points,[{date:'2026-10-15'},{date:'2026-10-15'}]);
 assert.deepEqual(patients.values,[1,2,2]);assert.deepEqual(visits.values,[0,2,0]);
 assert.deepEqual(metricSeries(points,[{date:''}]).values,[]);
});
test('monthly partial buckets exclude out-of-range events and count unique patients once',()=>{
 const rows=[{date:'2026-10-01',id:1},{date:'2026-10-15',id:1},{date:'2026-10-16',id:2},{date:'2026-10-28',id:3}];
 assert.deepEqual(metricSeries([{key:'2026-10'}],rows,{from:'2026-10-14',to:'2026-10-20'}).values,[2]);
 assert.deepEqual(metricSeries([{key:'2026-10'}],rows,{cumulative:true,to:'2026-10-20',unique:r=>r.id}).values,[2]);
});
