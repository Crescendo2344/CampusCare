import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The patients table is read through a column-level grant so medical history and allergies stay
// hidden. A column the app selects without a grant makes PostgREST refuse the whole query
// ("permission denied for table patients"), so every selected column must be granted.
test('every patient column the app reads is granted to signed-in users',()=>{
  const source=fs.readFileSync('src/services/patients.js','utf8');
  const selected=source.match(/PATIENT_COLUMNS='([^']+)'/)[1].split(',');
  const granted=new Set();
  for(const file of fs.readdirSync('supabase/migrations')){
    const sql=fs.readFileSync('supabase/migrations/'+file,'utf8');
    for(const m of sql.matchAll(/grant select \(([^)]+)\) on public\.patients to authenticated/gi))
      for(const column of m[1].split(','))granted.add(column.trim());
  }
  assert.deepEqual(selected.filter(column=>!granted.has(column)),[]);
  for(const hidden of ['medical_history','allergies'])assert(!granted.has(hidden),`${hidden} stays hidden`);
});
