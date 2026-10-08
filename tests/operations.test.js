// Verify all migrated action transports with synthetic credentials and responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationalService} from '../src/services/operations.js';
import * as records from '../src/domain/workflow-records.js';
const endpoints={backupAction:'backup-actions',settingsAction:'settings-actions',emailDeliveryAction:'email-dispatch',auditAction:'audit-actions',privacyAction:'privacy-actions',healthResourceAction:'health-resource-actions',workflowAction:'workflow-actions',fitnessAction:'fitness-actions',surveyAction:'survey-actions',messageAction:'message-actions',adminUserAction:'admin-users',taskBadgeAction:'task-badges'};
function service(request,session={access_token:'fixture-token'}){return createOperationalService({getClient:()=>({auth:{getSession:async()=>({data:{session}})}}),request,baseUrl:'https://operations.test',publishableKey:'fixture-public-key'});}
for(const [name,endpoint] of Object.entries(endpoints))test(`${name} preserves its endpoint, session credentials and backend failures`,async()=>{
 let sent;const api=service(async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({ok:true,counts:{messages:2}})};});
 await api[name]({action:'list'});assert.equal(sent.url,`https://operations.test/functions/v1/${endpoint}`);assert.equal(sent.options.headers.Authorization,'Bearer fixture-token');assert.equal(sent.options.headers.apikey,'fixture-public-key');
 if(sent.options.body)assert.deepEqual(JSON.parse(sent.options.body),{action:'list'});
 await assert.rejects(service(async()=>({ok:false,json:async()=>({error:'Fixture denial'})}))[name]({}),/Fixture denial/);
 if(name!=='taskBadgeAction'){let calls=0;await assert.rejects(service(async()=>{calls++;},null)[name]({}),/expired/);assert.equal(calls,0);}
});

test('workflow types retain requested weekly patterns, effective dates and approval states',()=>{
 const schedule={workDays:['Mon','Wed'],startTime:'08:00',endTime:'12:00'};
 const mapped=records.realWorkflowToUi({request_id:9,requester_id:2,target_user_id:2,request_type:'Schedule Change',status:'Approved',effective_date:'2026-10-10',payload:{requested:schedule}});
 assert.equal(mapped.id,1500009);assert.equal(mapped.requested,schedule);assert.equal(mapped.effectiveDate,'2026-10-10');assert.equal(mapped.status,'Approved');
 assert.equal(records.realWorkflowToUi({request_type:'Name Change',status:'Applied'}).status,'Approved');
 assert.equal(records.realWorkflowToUi({request_type:'Day Off',status:'Applied',payload:{leaveDate:'2026-10-12'}}).date,'2026-10-12');
});
test('fitness and messaging records retain clinical links and attachment privacy',()=>{
 const fit=records.realFitnessToUi({assessment_id:8,patient_id:4,doctor_id:2,decision:'Fit with Restrictions',restrictions:'Fixture restriction'});
 assert.equal(fit.id,800008);assert.equal(fit.doctorId,100002);assert.equal(fit.restrictions,'Fixture restriction');assert.equal(fit.status,'Requested');
 const message=records.realMessageToUi({message_id:3,from_user_id:2,to_user_id:4,attachment_url:'fixture',deleted_for_everyone:true});
 assert.equal(message.attachment,null);assert.equal(message.deleted,true);assert.equal(message.fromUserId,100002);
});
