import test from 'node:test';
import assert from 'node:assert/strict';
import {awaitingReply,describeDevice,firstResponseHours,formatHours,queueStats,sortIssues} from '../src/domain/issue-queue.js';

const report=(over={})=>({id:1,status:'Open',priority:'Normal',createdAt:'2026-10-20T00:00:00Z',replies:[],...over});
const admin=(at,internal=false)=>({authorRole:'Administrator',createdAt:at,internal});
const user=at=>({authorRole:'Patient',createdAt:at});

test('a report awaits a reply until an administrator answers in public',()=>{
  assert.equal(awaitingReply(report()),true);
  assert.equal(awaitingReply(report({replies:[admin('2026-10-20T02:00:00Z',true)]})),true,'Internal notes do not count');
  assert.equal(awaitingReply(report({replies:[admin('2026-10-20T02:00:00Z')]})),false);
  assert.equal(awaitingReply(report({replies:[admin('2026-10-20T02:00:00Z'),user('2026-10-20T03:00:00Z')]})),true);
  assert.equal(awaitingReply(report({status:'Resolved'})),false);
});

test('first response time skips internal notes',()=>{
  const r=report({replies:[admin('2026-10-20T01:00:00Z',true),admin('2026-10-20T05:00:00Z')]});
  assert.equal(firstResponseHours(r),5);
  assert.equal(firstResponseHours(report()),null);
  assert.equal(formatHours(0.25),'15 min');assert.equal(formatHours(5),'5 h');assert.equal(formatHours(72),'3 d');assert.equal(formatHours(null),'—');
});

test('queue stats and default order put urgent, waiting reports first',()=>{
  const list=[
    report({id:1,priority:'Low'}),
    report({id:2,priority:'Urgent',createdAt:'2026-10-21T00:00:00Z'}),
    report({id:3,priority:'High',replies:[admin('2026-10-20T04:00:00Z')]}),
    report({id:4,status:'Resolved',resolvedAt:'2026-10-26T00:00:00Z',replies:[admin('2026-10-20T02:00:00Z')]})
  ];
  const stats=queueStats(list,new Date('2026-10-27T00:00:00Z'));
  assert.deepEqual({...stats,medianFirstResponse:Math.round(stats.medianFirstResponse)},{needsReply:2,open:3,urgent:2,resolvedThisWeek:1,medianFirstResponse:3});
  assert.deepEqual(sortIssues(list).map(r=>r.id),[2,3,1,4]);
  assert.deepEqual(sortIssues(list,'newest').map(r=>r.id)[0],2);
});

test('device details name the browser, system and screen',()=>{
  const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  assert.equal(describeDevice(ua,1920,1080),'Chrome 130 · Windows · 1920×1080');
  assert.equal(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),'Safari 17 · iOS');
});
