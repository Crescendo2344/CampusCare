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
test('period comparison measures the selected range against the same-length period before it',async()=>{
  const {periodComparison,describeTrend}=await import('../src/domain/dashboard-metrics.js');
  const rows=['2026-10-18','2026-10-20','2026-10-24','2026-10-12','2026-10-17','2026-10-10'].map(date=>({date}));
  const week=periodComparison(rows,{from:'2026-10-18',to:'2026-10-24'});
  assert.deepEqual(week,{current:3,previous:2,delta:1,days:7},'Oct 11–17 is the previous week; Oct 10 is outside both');
  assert.deepEqual(describeTrend(week,{upIs:'good'}),{direction:'up',sentiment:'good',text:'1 (+50%) vs the previous 7 days'});
  assert.equal(describeTrend(week,{upIs:'bad'}).sentiment,'bad');
  assert.equal(describeTrend(periodComparison([{date:'2026-10-24'}],{from:'2026-10-24',to:'2026-10-24'})).text,'1 new · none in the previous day');
  assert.equal(describeTrend(periodComparison([],{from:'2026-10-18',to:'2026-10-24'})).text,'None in this or the previous 7 days');
  assert.equal(periodComparison(rows,{from:'2026-10-24',to:'2026-10-18'}),null);
});
test('trend lines can name what was counted',async()=>{
  const {describeTrend}=await import('../src/domain/dashboard-metrics.js');
  assert.equal(describeTrend({current:3,previous:2,delta:1,days:7},{unit:'new'}).text,'1 new (+50%) vs the previous 7 days');
  assert.equal(describeTrend({current:2,previous:0,delta:2,days:7},{unit:'new'}).text,'2 new · none in the previous 7 days');
});
test('unchanged counted trends still say what was counted',async()=>{
  const {describeTrend}=await import('../src/domain/dashboard-metrics.js');
  assert.equal(describeTrend({current:0,previous:0,delta:0,days:7},{unit:'new'}).text,'Nothing new in this or the previous 7 days');
  assert.equal(describeTrend({current:2,previous:2,delta:0,days:7},{unit:'new'}).text,'2 new, same as the previous 7 days');
});
