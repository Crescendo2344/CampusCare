import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWarm,saveWarm} from '../src/services/warm-cache.js';

const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v))};};

test('warm cache returns fresh data and drops stale or unreadable entries',()=>{
  const storage=memory();
  saveWarm('settings',{clinicName:'CTU'},storage);
  assert.deepEqual(loadWarm('settings',1000,storage),{clinicName:'CTU'});
  assert.equal(loadWarm('settings',1000,storage,Date.now()+5000),null,'older than the allowed age');
  storage.setItem('campuscare-cache:broken','{not json');
  assert.equal(loadWarm('broken',1000,storage),null);
  assert.equal(loadWarm('missing',1000,storage),null);
});
