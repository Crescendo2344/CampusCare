import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultStartTimeForSpecialty} from '../supabase/functions/_shared/clinic-services.js';

test('default doctor start time follows clinic specialty',()=>{
  assert.equal(defaultStartTimeForSpecialty('Dental'),'09:00');
  assert.equal(defaultStartTimeForSpecialty('General Medicine'),'08:00');
});
