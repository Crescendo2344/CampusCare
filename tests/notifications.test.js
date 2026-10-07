// Notification tests use synthetic records and injected HTTP/authentication fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as records from '../src/domain/notification-records.js';
import { createNotificationService } from '../src/services/notifications.js';

function service({session={access_token:'test-session'},request}={}){
  return createNotificationService({getClient:()=>({auth:{getSession:async()=>({data:{session}})}}),request,baseUrl:'https://notifications.test',publishableKey:'test-public-key'});
}

test('notification mapping preserves IDs, account assignment, reference values and defaults',()=>{
  const account={id:100002};
  const row=records.realNotificationToUi({notification_id:'7',user_id:'2',message:'Test notice',is_read:true,reference_id:0,action_page:'patient-messages'},account);
  assert.equal(row.id,1100007);assert.equal(row.dbNotificationId,7);assert.equal(row.userId,100002);
  assert.equal(row.dbUserId,2);assert.equal(row.body,'Test notice');assert.equal(row.read,true);assert.equal(row.referenceId,0);
  assert.equal(row.actionPage,'patient-messages');assert.equal(row.title,'Notification');assert.equal(row.channel,'In-app');
  const empty=records.realNotificationToUi({notification_id:1},null);assert.equal(empty.userId,null);assert.equal(empty.referenceId,null);assert.equal(empty.read,false);
});

test('refresh replaces live rows, preserves demo rows and leaves input records intact',()=>{
  const existing=[{id:1},{id:1100001,_realSupabase:true}];const before=JSON.stringify(existing);
  const merged=records.mergeNotificationRecords(existing,[{notification_id:7}],{id:100002});
  assert.deepEqual(merged.map(n=>n.id),[1,1100007]);assert.equal(JSON.stringify(existing),before);
  assert.equal(records.notificationRecords({notifications:merged},{_realSupabase:true}).length,1);
  assert.equal(records.notificationRecords({notifications:merged},{}).length,2);
});

test('routing preserves explicit aliases and role-specific fallback destinations',()=>{
  for(const [alias,page] of [['privacy-center','my-account'],['certificate-signatures','cert-requests'],['certificate-requests','cert-requests'],['patient-messages','messages'],['my-messages','messages']])assert.equal(records.notificationPageFor({actionPage:alias},{role:'Patient'}),page);
  assert.equal(records.notificationPageFor({actionPage:' inventory ',type:'appointment'},{role:'Patient'}),'inventory');
  for(const [type,patientPage,staffPage] of [['appointment','my-appointments','appointments'],['treatment','my-records','treatments'],['certificate','my-certificates','cert-requests'],['fitness','fitness','fitness'],['inventory','inventory','inventory']]){
    assert.equal(records.notificationPageFor({type},{role:'Patient'}),patientPage);
    assert.equal(records.notificationPageFor({type},{role:'Staff'}),staffPage);
  }
  assert.equal(records.notificationPageFor({type:'info'},{role:'Patient'}),'');
});

test('unread counts ignore other accounts, read records and notices without destinations',()=>{
  const account={id:1,role:'Patient'},rows=[
    {id:1,userId:1,type:'appointment',read:false},
    {id:2,userId:1,actionPage:'my-messages',read:false},
    {id:3,userId:1,actionPage:'patient-messages',read:false},
    {id:4,userId:2,type:'appointment',read:false},
    {id:5,userId:1,type:'appointment',read:true},
    {id:6,userId:1,type:'info',read:false}
  ];
  assert.equal(records.unreadNotifications(rows,account).length,4);
  assert.deepEqual(records.notificationPageCounts(rows,account),{'my-appointments':1,messages:2});
  assert.deepEqual(records.notificationPageCounts(rows,null),{});
  assert.deepEqual(records.unreadNotifications(rows,null),[]);
});

test('notification tones retain their existing precedence',()=>{
  assert.equal(records.notificationTone({type:'inventory',title:'Ready'}),'warning');
  assert.equal(records.notificationTone({title:'Appointment confirmed'}),'success');
  assert.equal(records.notificationTone({title:'Account suspended'}),'danger');
  assert.equal(records.notificationTone({title:'Notice'}),'info');
});

test('service forwards list/read/read-all requests with the existing authentication headers',async()=>{
  const calls=[];const api=service({request:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true,notifications:[{notification_id:7}]})};}});
  assert.deepEqual(await api.load(),[{notification_id:7}]);await api.action({action:'read',notification_id:7});await api.action({action:'read_all'});
  assert.deepEqual(calls.map(c=>JSON.parse(c.options.body)),[{action:'list'},{action:'read',notification_id:7},{action:'read_all'}]);
  for(const c of calls){assert.equal(c.url,'https://notifications.test/functions/v1/notification-center');assert.equal(c.options.method,'POST');assert.equal(c.options.headers.Authorization,'Bearer test-session');assert.equal(c.options.headers.apikey,'test-public-key');}
});

test('missing sessions and backend failures retain existing error handling',async()=>{
  let requests=0;await assert.rejects(service({session:null,request:async()=>{requests++;}}).load(),/session has expired/);assert.equal(requests,0);
  await assert.rejects(service({request:async()=>({ok:false,json:async()=>({error:'Access denied'})})}).action({}),/Access denied/);
  await assert.rejects(service({request:async()=>({ok:true,json:async()=>{throw Error('Invalid JSON');}})}).load(),/Notification action failed/);
  assert.deepEqual(await service({request:async()=>({ok:true,json:async()=>({ok:true})})}).load(),[]);
});
