import test from 'node:test';
import assert from 'node:assert/strict';
import {profileCompleteness} from '../src/domain/profile-completeness.js';

const user={role:'Patient',status:'Active',verified:true,contact:'09171234567',profilePhoto:'x.png',personType:'Student'};
const full={personType:'Student',birthDate:'2004-01-01',gender:'Female',course:'BSIT',classSession:'Evening',address:'Cebu City',
  emergencyName:'Ana Cruz',emergencyContact:'09181234567',blood:'O+',height:'160cm',weight:'55kg',allergies:'None'};

test('a complete student profile is fully verified',()=>{
  const r=profileCompleteness(user,full);
  assert.equal(r.percent,100);assert.equal(r.level.label,'Fully verified');assert.equal(r.missing.length,0);
});
test('missing details lower the level and say who completes them',()=>{
  const r=profileCompleteness({...user,profilePhoto:''},{...full,blood:'Unknown',emergencyContact:''});
  // The emergency contact is optional, so leaving it out does not lower the profile.
  assert.deepEqual(r.missing.map(s=>s.id),['photo','blood']);
  assert.equal(r.missing.find(s=>s.id==='blood').by,'patient');
  assert(!r.steps.some(s=>s.id==='emergency'),'The emergency contact is not a required step');
  assert.equal(r.level.label,'Almost there');
});
test('personnel are not asked for course or class session',()=>{
  const r=profileCompleteness({...user,personType:'Teaching Personnel'},{...full,personType:'Teaching Personnel',course:'',classSession:'',college:'CCICT'});
  assert(!r.steps.some(s=>['program','session'].includes(s.id)));assert.equal(r.percent,100);
});
test('teaching and non-teaching personnel each have their own work-place step',()=>{
  const teaching=profileCompleteness({...user,personType:'Teaching Personnel'},{...full,personType:'Teaching Personnel',college:''});
  assert.equal(teaching.steps.find(s=>s.id==='unit').label,'College where you teach');
  assert.deepEqual(teaching.missing.map(s=>s.id),['unit']);
  const staff=profileCompleteness({...user,personType:'Non-Teaching Personnel'},{...full,personType:'Non-Teaching Personnel',college:'Registrar'});
  assert.equal(staff.steps.find(s=>s.id==='unit').label,'Office or department');
  assert.equal(staff.percent,100);
  assert(!profileCompleteness(user,full).steps.some(s=>s.id==='unit'),'students are asked for their course instead');
});
