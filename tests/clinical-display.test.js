// Copilot drafts split into SOAP fields and FHIR bundles summarise into readable rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {joinSoapNote,splitSoapNote,summarizeFhirBundle} from '../src/domain/clinical-display.js';
test('SOAP drafts split into four sections and join back',()=>{
  const note='S: Headache for 2 days\nO: BP 120/80\nTemp 37.1\nA: Tension headache\nP: Paracetamol, rest';
  const parts=splitSoapNote(note);
  assert.deepEqual(parts,{S:'Headache for 2 days',O:'BP 120/80\nTemp 37.1',A:'Tension headache',P:'Paracetamol, rest'});
  assert.equal(joinSoapNote(parts),note);
  assert.equal(splitSoapNote('Free text summary without sections'),null);
});
test('FHIR bundles summarise into counts and readable rows',()=>{
  const bundle={entry:[
    {resource:{resourceType:'Patient',id:'patient-1',name:[{family:'Reyes',given:['Ana']}]}},
    {resource:{resourceType:'Condition',id:'condition-2',code:{text:'Tension headache'},recordedDate:'2026-10-20',clinicalStatus:{text:'active/recorded'}}},
    {resource:{resourceType:'Condition',id:'condition-3',code:{text:'Allergic rhinitis'},recordedDate:'2026-09-01'}},
    {resource:{resourceType:'Appointment',id:'appointment-4',status:'booked',serviceType:[{text:'Consultation'}],start:'2026-10-28T09:00:00+08:00'}}
  ]};
  const summary=summarizeFhirBundle(bundle);
  assert.equal(summary.total,4);
  assert.deepEqual(summary.counts,[{type:'Patient',count:1},{type:'Condition',count:2},{type:'Appointment',count:1}]);
  assert.deepEqual(summary.rows[0],{type:'Patient',id:'patient-1',detail:'Ana Reyes',status:'',date:''});
  assert.equal(summary.rows[3].date,'2026-10-28');assert.equal(summary.rows[3].detail,'Consultation');
  assert.equal(summarizeFhirBundle(null).total,0);
});
