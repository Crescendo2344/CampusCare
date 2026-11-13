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
  assert.deepEqual(r.missing.map(s=>s.id),['photo','emergency','blood']);
  assert.equal(r.missing.find(s=>s.id==='blood').by,'clinic');
  assert.equal(r.missing.find(s=>s.id==='emergency').by,'patient');
  assert.equal(r.level.label,'Almost there');
});
test('personnel are not asked for course or class session',()=>{
  const r=profileCompleteness({...user,personType:'Teaching Personnel'},{...full,personType:'Teaching Personnel',course:'',classSession:''});
  assert(!r.steps.some(s=>['program','session'].includes(s.id)));assert.equal(r.percent,100);
});
