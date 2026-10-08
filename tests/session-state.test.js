// Account cleanup preserves demo data but invalidates clinical caches and old navigation requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../src/app/state.js';
import {clearAccountState} from '../src/app/session-state.js';
test('sign-out clears account-owned data without deleting demo records',()=>{
 state.auth.currentUser={id:100001,_realSupabase:true};state.auth.currentPatient={id:200001};
 state.navigationRaceProtection.campusNavigationToken=4;
 state.data.DB={patients:[{id:1},{id:200001,_realSupabase:true}],users:[{id:1},{id:100001,_realSupabase:true}],realBackupLogs:[{id:1}],emailDeliveryStatus:{configured:true}};
 state.messaging.activeConversationId=100002;state.messaging.pendingAttachment={name:'Fixture file'};
 state.topbarAndNavigation.navTaskCounts={messages:3};state.approvalQueue.realPendingApprovals=[{user_id:2}];
 clearAccountState();
 assert.equal(state.auth.currentUser,null);assert.equal(state.auth.currentPatient,null);assert.equal(state.navigationRaceProtection.campusNavigationToken,5);
 assert.deepEqual(state.data.DB.patients,[{id:1}]);assert.deepEqual(state.data.DB.users,[{id:1}]);assert.equal(state.messaging.pendingAttachment,null);assert.equal(state.data.DB.realBackupLogs,undefined);assert.equal(state.data.DB.emailDeliveryStatus,undefined);
 assert.deepEqual(state.topbarAndNavigation.navTaskCounts,{});assert.deepEqual(state.approvalQueue.realPendingApprovals,[]);
});
