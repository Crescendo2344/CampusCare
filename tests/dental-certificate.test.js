import test from 'node:test';
import assert from 'node:assert/strict';
import {accomplishmentText,dentalHistorySummary} from '../src/domain/dental-certificate.js';

const visit=(id,date,dentalRecord,extra={})=>({id,date,dentalRecord,...extra});
test('no dental records gives an empty summary',()=>{
  const s=dentalHistorySummary([{id:1,date:'2026-01-01',dentalRecord:null}]);
  assert.equal(s.hasRecord,false);assert.deepEqual(s.operations,[]);
});
test('recent records override older marks and oral health, operations are combined',()=>{
  const s=dentalHistorySummary([
    visit(2,'2026-03-10',{odontogram:{46:'M'},oralHealth:{fair:true},accomplishment:[{tooth_no:'46',nature:'Extraction'}],workStatus:'Completed',recommendation:'Soft diet'}),
    visit(1,'2026-01-05',{odontogram:{46:'D',16:'F'},oralHealth:{poor:true},accomplishment:[{tooth_no:'16',nature:'Filling'}],workStatus:'In Progress'}),
    visit(3,'2026-04-01',{odontogram:{}},{archived:true})
  ]);
  assert.deepEqual(s.odontogram,{46:'M',16:'F'});
  assert.deepEqual(s.oral,{fair:true});
  assert.equal(s.workStatus,'Completed');assert.equal(s.recommendation,'Soft diet');
  assert.equal(accomplishmentText(s.operations),'16 – Filling; 46 – Extraction');
});
