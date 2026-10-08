// Synthetic sync tests cover account switches and query failure atomicity without live writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureSyncService} from '../src/services/feature-sync.js';
import * as records from '../src/domain/workflow-records.js';
import {maskEmail,maskPhone} from '../src/shared/privacy-formatting.js';
function snapshot(){return {auth:{currentUser:{role:'Doctor',_realSupabase:true}},data:{DB:{workflowRequests:[],nameChangeRequests:[],scheduleChangeRequests:[],leaveRequests:[],doctorLeaves:[{id:1}],messages:[],fitnessAssessments:[]}},supabaseClient:{},clinicInformation:{},reports:{}};}

test('workflow refresh splits all queues and preserves demo leaves',async()=>{
 const state=snapshot();const service=createFeatureSyncService({getState:()=>state,callbacks:{...records,workflowAction:async()=>({requests:[{request_id:7,request_type:'Schedule Change',status:'Approved'},{request_id:8,request_type:'Name Change',status:'Applied'},{request_id:9,request_type:'Day Off',status:'Pending'}],doctor_leaves:[{leave_id:3,doctor_id:2}]})}});
 const rows=await service.syncRealWorkflowRequests();assert.equal(rows.length,3);assert.equal(state.data.DB.scheduleChangeRequests.length,1);assert.equal(state.data.DB.nameChangeRequests[0].status,'Approved');assert.equal(state.data.DB.leaveRequests[0].status,'Pending');assert.equal(state.data.DB.doctorLeaves.length,2);
});
test('responses from an earlier account do not populate the next account snapshot',async()=>{
 const state=snapshot();let resolve;const response=new Promise(r=>{resolve=r;});
 const service=createFeatureSyncService({getState:()=>state,callbacks:{...records,workflowAction:()=>response}});
 const pending=service.syncRealWorkflowRequests();state.auth.currentUser={role:'Patient',_realSupabase:true};resolve({requests:[{request_id:7}],doctor_leaves:[]});assert.deepEqual(await pending,[]);assert.deepEqual(state.data.DB.workflowRequests,[]);
});
test('messaging refresh rejects stale contacts as well as stale message rows',async()=>{
 const state=snapshot();let merges=0;
 const service=createFeatureSyncService({getState:()=>state,callbacks:{messageRecords:()=>state.data.DB.messages,realMessageToUi:records.realMessageToUi,mergeRealMessageContacts:()=>{merges++;},messageAction:async()=>{state.auth.currentUser=null;return {messages:[{message_id:1}],contacts:[{user_id:1}]};}}});
 assert.deepEqual(await service.syncRealMessages(),[]);assert.equal(merges,0);assert.deepEqual(state.data.DB.messages,[]);
});
test('fitness query errors retain the existing snapshot and query order',async()=>{
 const state=snapshot(),saved=[{id:1}];state.data.DB.fitnessAssessments=saved;const calls=[];
 state.supabaseClient.supabaseClient={from(table){calls.push(table);return {select(){return this;},order(column){calls.push(column);return this;},then(resolve,reject){return Promise.resolve({error:new Error('Fixture query failure')}).then(resolve,reject);}};}};
 const service=createFeatureSyncService({getState:()=>state,callbacks:{fitnessRecords:()=>saved,realFitnessToUi:records.realFitnessToUi}});
 await assert.rejects(service.syncRealFitnessAssessments(),/Fixture query failure/);assert.equal(state.data.DB.fitnessAssessments,saved);assert.deepEqual(calls,['fitness_assessments','requested_at','assessment_id']);
});
test('contact summary masking handles missing and malformed values',()=>{
 assert.equal(maskEmail('test@example.test'),'te••••@example.test');assert.equal(maskEmail('invalid'),'••••');assert.equal(maskEmail(''),'—');
 assert.equal(maskPhone('0917 111 2233'),'••••2233');assert.equal(maskPhone('123'),'••••');assert.equal(maskPhone(''),'—');
});
