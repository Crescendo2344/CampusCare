import test from 'node:test';
import assert from 'node:assert/strict';
import {clampHorizon,projectItem,projectionPeriods} from '../src/domain/inventory-projection.js';

test('the horizon stays between 7 days and 1 year, 3 months by default',()=>{
  assert.equal(clampHorizon(3),7);assert.equal(clampHorizon(900),365);assert.equal(clampHorizon(''),90);assert.equal(clampHorizon(45),45);
});

test('short horizons use weeks, longer ones calendar months',()=>{
  const weeks=projectionPeriods('2026-10-27',30);
  assert.equal(weeks.length,5);assert.equal(weeks[0].label,'Oct 27 – Nov 2');assert.equal(weeks.at(-1).end,'2026-11-25');
  const months=projectionPeriods('2026-10-27',90);
  assert.deepEqual(months.map(p=>p.label),['Oct 27 – Oct 31','Nov 2026','Dec 2026','Jan 1 – Jan 24']);
  assert.equal(projectionPeriods('2026-10-27',365).length,13);
});

test('use, remaining stock, run-out date and order quantity follow the daily rate',()=>{
  const p=projectItem({qty:100,threshold:20,start:'2026-11-01',days:30,dailyRate:5});
  assert.equal(p.totalUse,150);assert.equal(p.stockAtEnd,-50);
  assert.equal(p.reorderBy,'2026-11-16','Stock reaches the reorder level after 16 days');
  assert.equal(p.stockoutDate,'2026-11-21','Runs out on day 21');
  assert.equal(p.reorderQty,70,'Covers the horizon and keeps the reorder level');
  const fine=projectItem({qty:500,threshold:20,start:'2026-11-01',days:30,dailyRate:1});
  assert.equal(fine.stockoutDate,'');assert.equal(fine.reorderBy,'');assert.equal(fine.reorderQty,0);
});

test('a stored monthly forecast overrides the daily rate for that month',()=>{
  const p=projectItem({qty:1000,threshold:0,start:'2026-11-01',days:61,dailyRate:1,monthlyUsage:{'2026-11':300}});
  assert.equal(p.periods[0].use,300);assert.equal(p.periods[1].use,31);
});
