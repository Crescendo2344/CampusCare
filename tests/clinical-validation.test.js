import test from 'node:test';
import assert from 'node:assert/strict';
import {followUpState,treatmentFormErrors,vitalSignErrors} from '../src/domain/clinical-validation.js';

test('vital signs catch typing slips and accept normal readings',()=>{
  assert.deepEqual(vitalSignErrors({bp:'120/80',temp:'36.8',pulse:'72',spo2:'98%',weight:'60',height:'165'}),{});
  assert.deepEqual(Object.keys(vitalSignErrors({bp:'120-80',temp:'368',pulse:'7',spo2:'101',weight:'0',height:'1650'})),['bp','temp','pulse','spo2','weight','height']);
  assert(vitalSignErrors({bp:'80/120'}).bp);
  assert.deepEqual(vitalSignErrors({}),{});
});

test('visit notes need the essentials and a consistent reminder',()=>{
  const ok={patientId:1,findings:'Headache',diagnosis:'Tension headache',date:'2026-10-23',vitals:{}};
  assert.deepEqual(treatmentFormErrors(ok,'2026-10-23'),{});
  assert.deepEqual(Object.keys(treatmentFormErrors({vitals:{}},'2026-10-23')),['patient','findings','diagnosis','date']);
  assert(treatmentFormErrors({...ok,date:'2026-10-24'},'2026-10-23').date);
  assert(treatmentFormErrors({...ok,followup:'2026-10-23'},'2026-10-23').followup);
  assert.deepEqual(Object.keys(treatmentFormErrors({...ok,medName:'Paracetamol'},'2026-10-23')),['dosage','frequency','endDate']);
});

test('follow-up states',()=>{
  assert.equal(followUpState('2026-10-20','2026-10-23'),'overdue');
  assert.equal(followUpState('2026-10-23','2026-10-23'),'today');
  assert.equal(followUpState('2026-10-30','2026-10-23'),'upcoming');
  assert.equal(followUpState('','2026-10-23'),'');
});

test('BMI and out-of-range vital signs are flagged for the doctor',async()=>{
  const {bodyMassIndex,vitalFlags}=await import('../src/domain/clinical-validation.js');
  assert.deepEqual(bodyMassIndex('70','175'),{value:22.9,category:'Normal'});
  assert.equal(bodyMassIndex('','175'),null);
  assert.equal(bodyMassIndex('95','170').category,'Obese');
  assert.deepEqual(vitalFlags({bp:'150/95',temp:'38.2',pulse:'72',spo2:'93'}),{bp:{level:'high',label:'High'},temp:{level:'high',label:'Fever'},spo2:{level:'low',label:'Low'}});
  assert.deepEqual(vitalFlags({bp:'118/76',temp:'36.6',pulse:'',spo2:''}),{});
});
