import test from 'node:test';
import assert from 'node:assert/strict';
import {csvColumn,templateCsv,csvCell,csvDate,csvFileName,csvMoney,csvReadableDate,csvTime,objectsToCsv,toCsv} from '../src/shared/csv.js';

test('cells are quoted only when needed and formulas stay literal',()=>{
  assert.equal(csvCell('Plain'),'Plain');
  assert.equal(csvCell('Dela Cruz, Juan'),'"Dela Cruz, Juan"');
  assert.equal(csvCell('He said "hi"'),'"He said ""hi"""');
  assert.equal(csvCell('=SUM(A1)'),`"'=SUM(A1)"`);
  assert.equal(csvCell(-5),'-5','Negative numbers are numbers, not formulas');
  assert.equal(csvCell(null),'');
});

test('files have a BOM, one header row and CRLF lines',()=>{
  const csv=toCsv([['Name','Qty'],['Gauze',3]]);
  assert(csv.startsWith('﻿Name,Qty\r\nGauze,3\r\n'));
  assert.equal(objectsToCsv([{Clinic:'Dental',Visits:4}]),'﻿Clinic,Visits\r\nDental,4\r\n');
});

test('dates, times and money use one consistent form in Philippine time',()=>{
  assert.equal(csvDate('2026-10-27'),'2026-10-27');
  assert.equal(csvDate('2026-10-26T17:30:00Z'),'2026-10-27');
  assert.equal(csvTime('2026-10-26T17:30:00Z'),'01:30');
  assert.equal(csvTime('09:05:00'),'09:05');
  assert.equal(csvReadableDate('2026-10-27'),'Oct 27, 2026');
  assert.equal(csvMoney(12.5),'12.50');
  assert.equal(csvFileName('Inventory forecast',"2026-10-27"),'campuscare-inventory-forecast-2026-10-27.csv');
});

test('every export uses the grouped "Group: Field" template with the identifier first',()=>{
  const csv=templateCsv([csvColumn('','Patient No.',r=>r.no),csvColumn('Name','Last',r=>r.last),csvColumn('Name','First',r=>r.first)],[{no:'P-1',last:'Reyes',first:'Ana'}]);
  assert.equal(csv,'﻿Patient No.,Name: Last,Name: First\r\nP-1,Reyes,Ana\r\n');
});
