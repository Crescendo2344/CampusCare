import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalFlags,approvalWaitLabel,approvalWaitDays,filterApprovals,sortApprovals} from '../src/domain/approval-queue.js';

const base={id:1,fname:'Ana',lname:'Cruz',email:'ana@gmail.com',username:'ana',personType:'Student',college:'CCICT',idNo:'1350098',emailConfirmedAt:'2026-10-20',verificationSelfie:'s',idFileData:'f',idBackData:'b',createdAt:'2026-10-20T08:00:00Z'};

test('a complete application has no flags',()=>{
  assert.deepEqual(approvalFlags(base,[base]),[]);
});

test('missing evidence, unconfirmed email, ID format and duplicates are flagged',()=>{
  const applicant={...base,emailConfirmedAt:'',idBackData:'',idNo:'12345'};
  assert.deepEqual(approvalFlags(applicant,[]).map(f=>f.key),['email','back','idformat']);
  const twin={...base,id:2};
  assert.deepEqual(approvalFlags(base,[base,twin]).map(f=>f.key),['dupid','dupname']);
  assert.deepEqual(approvalFlags({...base,personType:'Teaching Personnel',idNo:'14982'},[]),[]);
});

test('waiting time, filtering and oldest-first ordering',()=>{
  const now=Date.parse('2026-10-23T09:00:00Z');
  assert.equal(approvalWaitLabel('2026-10-23T08:30:00Z',now),'Just now');
  assert.equal(approvalWaitLabel('2026-10-23T04:00:00Z',now),'5h');
  assert.equal(approvalWaitLabel('2026-10-20T08:00:00Z',now),'3 days');
  assert.equal(approvalWaitDays('2026-10-20T08:00:00Z',now),3);
  const rows=[{...base,id:1,createdAt:'2026-10-22'},{...base,id:2,fname:'Ben',personType:'Non-Teaching Personnel',college:'Registrar',idNo:'11111',createdAt:'2026-10-19'}];
  assert.deepEqual(sortApprovals(rows).map(u=>u.id),[2,1]);
  assert.deepEqual(sortApprovals(rows,'newest').map(u=>u.id),[1,2]);
  assert.deepEqual(filterApprovals(rows,{query:'ben'}).map(u=>u.id),[2]);
  assert.deepEqual(filterApprovals(rows,{unit:'Registrar'}).map(u=>u.id),[2]);
  assert.deepEqual(filterApprovals(rows,{query:'1350098'}).map(u=>u.id),[1]);
});
