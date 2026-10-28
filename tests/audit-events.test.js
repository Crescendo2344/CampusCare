import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCategory,auditDayLabel,auditDetailRows,auditSentence,auditStats,relativeTime} from '../src/domain/audit-events.js';

test('events fall into readable categories',()=>{
  assert.equal(auditCategory('LOGIN','session'),'security');
  assert.equal(auditCategory('APPOINTMENT_CANCELLED','appointments'),'appointments');
  assert.equal(auditCategory('MEDICAL_CERTIFICATE_VOIDED','medical_certificates'),'records');
  assert.equal(auditCategory('INVENTORY_CHANGE_UNDONE','inventory_items'),'inventory');
  assert.equal(auditCategory('WORKFLOW_REQUEST_APPROVED','workflow_requests'),'accounts');
  assert.equal(auditCategory('ISSUE_PRIORITY_CHANGED','issue_reports'),'feedback');
  assert.equal(auditCategory('SYSTEM_SETTINGS_UPDATED','system_settings'),'system');
});

test('each event reads as a sentence about its record',()=>{
  assert.equal(auditSentence({action:'APPOINTMENT_CANCELLED',targetType:'appointments',targetId:42}),'cancelled appointment #42');
  assert.equal(auditSentence({action:'LOGIN',targetType:'session',targetId:7}),'signed in');
  assert.equal(auditSentence({action:'INVENTORY_CHANGE_UNDONE',targetType:'inventory_items',targetId:3}),'undid a change to inventory item #3');
  assert.equal(auditSentence({action:'AUDIT_LOG_EXPORTED',targetType:'audit_logs',targetId:null}),'exported activity log');
});

test('before and after values pair up',()=>{
  const rows=auditDetailRows({previous_quantity:10,new_quantity:4,reason:'Damaged',previous_status:'Active',status:'Suspended',meta:{a:1}});
  assert.deepEqual(rows.slice(0,2),[{field:'Quantity',before:'10',after:'4'},{field:'Status',before:'Active',after:'Suspended'}]);
  assert.deepEqual(rows[2],{field:'Reason',value:'Damaged'});
  assert.equal(rows.at(-1).field,'Meta');
  assert.deepEqual(auditDetailRows(null),[]);
});

test('days are grouped in Philippine time and stats count the right windows',()=>{
  const now=new Date('2026-10-28T03:00:00Z');// 11:00 in Manila
  assert.equal(auditDayLabel('2026-10-27T17:00:00Z',now),'Today','01:00 Manila on the 28th');
  assert.equal(auditDayLabel('2026-10-27T10:00:00Z',now),'Yesterday');
  assert.equal(auditDayLabel('2026-10-20T10:00:00Z',now),'Tue, Oct 20, 2026');
  assert.equal(relativeTime('2026-10-28T02:30:00Z',now),'30 min ago');
  const events=[
    {action:'LOGIN',timestamp:'2026-10-28T01:00:00Z',userName:'Ana',role:'Administrator'},
    {action:'APPOINTMENT_CANCELLED',timestamp:'2026-10-27T01:00:00Z',userName:'Ana',role:'Administrator'},
    {action:'INVENTORY_DISBURSEMENT',timestamp:'2026-10-26T01:00:00Z',userName:'Ben',role:'Staff'}
  ];
  assert.deepEqual(auditStats(events,now),{today:1,signIns:1,changes:2,mostActive:{name:'Ana',count:2}});
});
