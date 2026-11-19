import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectUnit,extractIdName,extractIdNumber,scanMatches,splitFullName} from '../src/domain/id-scan.js';

const CTU_ID=`REPUBLIC OF THE PHILIPPINES
CEBU TECHNOLOGICAL UNIVERSITY
MAIN CAMPUS
JUAN CARLO M. DELA CRUZ
BS Information Technology
CCICT
ID No. 23l0154
Signature`;

test('the holder name is read from uppercase lines, with middle initials and surname particles',()=>{
  assert.deepEqual(extractIdName(CTU_ID),{first:'Juan Carlo',last:'Dela Cruz'});
  assert.deepEqual(extractIdName('STUDENT ID\nREYES, ANGELICA MAE B.\n2310154'),{first:'Angelica Mae',last:'Reyes'});
  assert.deepEqual(extractIdName('Name: Maria Clara Santos'),{first:'Maria Clara',last:'Santos'});
  assert.deepEqual(splitFullName('PEDRO SAN JUAN'),{first:'Pedro',last:'San Juan'});
  assert.equal(extractIdName('CEBU TECHNOLOGICAL UNIVERSITY\nMAIN CAMPUS'),null,'institution lines are never taken as a name');
});

test('ID numbers survive common OCR slips and prefer the ID line',()=>{
  assert.equal(extractIdNumber(CTU_ID,'Student'),'2310154','l read as 1 inside a number');
  assert.equal(extractIdNumber('Employee No: 14 982\nTel 2554410','Teaching Personnel'),'14982');
  assert.equal(extractIdNumber('1111111','Student'),'','repeated digits are not an ID');
});

test('college codes on the ID are recognised, the most specific first',()=>{
  assert.equal(detectUnit(CTU_ID,[['CAS','CAS'],['CCICT','CCICT'],['COE','COE']]),'CCICT');
  assert.equal(detectUnit('Office of the Registrar',[['Registrar','Registrar'],['Library','Library']]),'Registrar');
});

test('the typed name and ID number are compared with the ID text',()=>{
  assert.deepEqual(scanMatches(CTU_ID,{first:'Juan Carlo',last:'Dela Cruz',idNo:'2310154'}),{name_match:true,id_match:false},'the l in the OCR text blocks the exact ID match');
  assert.deepEqual(scanMatches('JUAN DELA CRUZ 2310154',{first:'Juan',last:'Dela Cruz',idNo:'2310154'}),{name_match:true,id_match:true});
  assert.equal(scanMatches(CTU_ID,{first:'Pedro',last:'Reyes'}).name_match,false);
});

test('the scan summary goes with the registration and new patients are verified when they confirm their email',()=>{
  assert.match(fs.readFileSync('src/features/loginLockout.js','utf8'),/id_scan:\{\.\.\.appState\.documentScanner\.scanSummary/);
  const sql=fs.readFileSync('supabase/migrations/20261119131948_auto_verify_registrations.sql','utf8');
  assert.match(sql,/after update of email_confirmed_at on auth\.users/);
  assert.match(sql,/set status='Active',verified=true,auto_verified_at=now\(\)/);
  assert.match(sql,/u\.verification_selfie_url is not null and u\.id_file_url is not null and u\.id_back_file_url is not null/,'only a complete registration');
  assert.match(sql,/exception when others then/,'a failure never blocks the email confirmation');
  const fn=fs.readFileSync('supabase/functions/admin-approvals/index.ts','utf8');
  for(const action of ['set_auto_verify','confirm_auto','suspend_auto'])assert.ok(fn.includes(`"${action}"`),action);
  assert.match(fn,/view==="auto"/);
});
