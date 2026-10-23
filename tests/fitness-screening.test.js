import test from 'node:test';
import assert from 'node:assert/strict';
import {SCREENING_QUESTIONS,clearanceState,clearanceValidUntil,decodeScreening,encodeScreening,fitnessAssessmentErrors,positiveScreening} from '../src/domain/fitness-screening.js';

const allNo=Object.fromEntries(SCREENING_QUESTIONS.map(([key])=>[key,'no']));
const today='2026-10-23';
const base={patientId:1,sport:'Basketball',assessmentDate:today,vitals:{},answers:allNo,examFindings:'Normal exam'};

test('screening answers survive a round trip through the notes field',()=>{
  const text=encodeScreening({...allNo,chest:'yes'},'Mild wheeze on exertion');
  const decoded=decodeScreening(text);
  assert.equal(decoded.answers.chest,'yes');assert.equal(decoded.answers.family,'no');
  assert.equal(decoded.notes,'Mild wheeze on exertion');
  assert.deepEqual(decodeScreening('Old free text'),{answers:{},notes:'Old free text'});
  assert.deepEqual(positiveScreening({chest:'yes'}),['Chest pain, pressure or discomfort during exercise']);
});

test('a decision needs full screening, exam findings and reasons',()=>{
  assert.deepEqual(fitnessAssessmentErrors({...base,decision:''},today),{});
  assert.deepEqual(fitnessAssessmentErrors({...base,decision:'Fit to Compete'},today),{});
  assert(fitnessAssessmentErrors({...base,answers:{},decision:'Fit to Compete'},today).screening);
  assert(fitnessAssessmentErrors({...base,examFindings:'',decision:'Fit to Compete'},today).exam);
  assert(fitnessAssessmentErrors({...base,decision:'Not Fit to Compete'},today).restrictions);
  assert(fitnessAssessmentErrors({...base,answers:{...allNo,syncope:'yes'},decision:'Fit to Compete'},today).restrictions);
  assert(fitnessAssessmentErrors({...base,eventDate:'2026-10-01'},today).eventDate);
  assert(fitnessAssessmentErrors({...base,vitals:{hr:'7'}},today).hr);
});

test('clearance is valid for one year',()=>{
  assert.equal(clearanceValidUntil('2026-10-23'),'2027-10-22');
  assert.equal(clearanceState({decision:'Fit to Compete',date:'2025-10-01'},today),'expired');
  assert.equal(clearanceState({decision:'Fit with Restrictions',date:'2026-01-01'},today),'valid');
  assert.equal(clearanceState({decision:'Not Fit to Compete',date:'2026-01-01'},today),'');
});
