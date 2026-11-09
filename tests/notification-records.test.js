// Notification panel ordering, grouping and timestamps follow common app conventions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {groupNotifications,notificationIcon,relativeNotificationTime,notificationSection} from '../src/domain/notification-records.js';
const now=new Date(2026,9,24,10,0,0);
const at=(day,hour,minute=0,second=0)=>new Date(2026,9,day,hour,minute,second).toISOString();
test('relative times read like other apps',()=>{
  assert.equal(relativeNotificationTime(at(24,9,59,30),now),'Just now');
  assert.equal(relativeNotificationTime(at(24,9,15),now),'45m ago');
  assert.equal(relativeNotificationTime(at(24,7),now),'3h ago');
  assert.equal(relativeNotificationTime(at(23,22),now),'Yesterday');
  assert.equal(relativeNotificationTime(at(20,8),now),'4d ago');
  assert.equal(relativeNotificationTime(at(1,8),now),'Oct 1');
  assert.equal(relativeNotificationTime('not a date',now),'');
  assert.equal(notificationSection(at(23,23,59),now),'Yesterday');
});
test('notifications are newest first, sectioned by day, and repeats about one record collapse',()=>{
  const rows=[
    {id:1,title:'New Reply on a CampusCare Report',referenceType:'issue_reports',referenceId:7,createdAt:at(24,8),read:true},
    {id:2,title:'New Reply on a CampusCare Report',referenceType:'issue_reports',referenceId:7,createdAt:at(24,9),read:false},
    {id:3,title:'New Bug Report',referenceType:'issue_reports',referenceId:8,createdAt:at(24,7),read:false},
    {id:4,title:'Appointment Confirmed',createdAt:at(22,9),read:true},
    {id:5,title:'Appointment Confirmed',createdAt:at(22,8),read:true}
  ];
  const sections=groupNotifications(rows,now);
  assert.deepEqual(sections.map(s=>s.name),['Today','Earlier']);
  const today=sections[0].groups;
  assert.equal(today.length,2);
  assert.equal(today[0].lead.id,2,'The newest member leads its group');
  assert.deepEqual(today[0].members.map(n=>n.id),[2,1]);
  assert.equal(today[0].unread,true);
  assert.equal(sections[1].groups.length,2,'Notifications without a reference are never merged');
});
test('icons follow the notification subject',()=>{
  assert.equal(notificationIcon({title:'New Reply on a CampusCare Report'}),'bi-chat-dots');
  assert.equal(notificationIcon({title:'Low Stock Alert'}),'bi-box-seam');
  assert.equal(notificationIcon({type:'Appointment',title:'Reminder'}),'bi-calendar-event');
  assert.equal(notificationIcon({title:'Hello'}),'bi-bell');
});
