// Synthetic fixtures verify the migrated boundary without reading patient information.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as records from '../src/domain/certificate-records.js';
import { createCertificateService } from '../src/services/certificates.js';

function fixture({session={access_token:'test-session'},request,data=[],error}={}){
  const queries=[];
  const client={auth:{getSession:async()=>({data:{session}})},from(table){
    const query={table,orders:[]};queries.push(query);
    return {select(columns){query.columns=columns;return this;},order(column,options){query.orders.push({column,...options});return this;},then(resolve,reject){return Promise.resolve({data,error}).then(resolve,reject);}};
  }};
  return {queries,service:createCertificateService({getClient:()=>client,request,baseUrl:'https://certificates.test',publishableKey:'test-public-key'})};
}

test('certificate records retain clinical links, signing information and document content',()=>{
  const raw={certificate_id:'7',patient_id:'4',doctor_id:'2',treatment_id:'3',prepared_by:'5',signed_by:'2',status:'Issued',certificate_no:'CTU-MC-2025-000007',document_content:'<p>Test document</p>',signature_url:'test-signature',examination_findings:'Test findings',remarks:'Test recommendations',prepared_at:'prepared',signed_at:'signed',requested_at:'requested'};
  const mapped=records.realCertificateToUi(raw);
  assert.equal(mapped.id,700007);assert.equal(mapped.patientId,200004);assert.equal(mapped.doctorId,100002);assert.equal(mapped.treatmentId,500003);
  assert.equal(mapped.preparedById,100005);assert.equal(mapped.signedById,100002);assert.equal(mapped.preparedAt,'prepared');assert.equal(mapped.signedAt,'signed');
  assert.equal(mapped.status,'Issued');assert.equal(mapped.findings,'Test findings');assert.equal(mapped.recommendations,'Test recommendations');
  assert.equal(mapped.documentHtml,raw.document_content);assert.equal(mapped.signatureData,'test-signature');assert.equal(mapped.requestedAt,'requested');
  assert.equal(records.certificateDisplayId(mapped),'000007');assert.equal(records.certificateNumberFor(mapped,new Date(2026,0,1)),raw.certificate_no);
});

test('optional certificate fields preserve defaults and local-year numbering',()=>{
  const mapped=records.realCertificateToUi({certificate_id:9,patient_id:4,created_at:'created'});
  assert.equal(mapped.status,'Pending');assert.equal(mapped.requestedAt,'created');assert.equal(mapped.doctorId,null);assert.equal(mapped.treatmentId,null);
  assert.equal(mapped.preparedById,null);assert.equal(mapped.signedById,null);assert.equal(mapped.documentHtml,'');assert.equal(mapped.declineReason,'');
  assert.equal(records.certificateNumberFor(mapped,new Date(2026,0,1)),'CTU-MC-2026-000009');
  assert.equal(records.certificateDisplayId({id:2}),'000002');
});

test('refresh replaces stale live records without changing demo data or input arrays',()=>{
  const demo={id:1},existing=[demo,{id:700008,_realSupabase:true}];const original=JSON.stringify(existing);
  const rows=records.mergeCertificateRecords(existing,[{certificate_id:9,patient_id:4}]);
  assert.deepEqual(rows.map(r=>r.id),[1,700009]);assert.equal(rows[0],demo);assert.equal(JSON.stringify(existing),original);
  assert.equal(records.certificateRecords({certRequests:rows},{_realSupabase:true}).length,1);
  assert.equal(records.certificateRecords({certRequests:rows},{}),rows);assert.deepEqual(records.certificateRecords({},{}),[]);
});

test('certificate actions preserve credentials, payload and backend failures',async()=>{
  let sent;const result={ok:true,certificate_id:7};
  const {service}=fixture({request:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>result};}});
  assert.equal(await service.action({action:'request',purpose:'Test purpose'}),result);
  assert.equal(sent.url,'https://certificates.test/functions/v1/certificate-actions');assert.equal(sent.options.method,'POST');
  assert.equal(sent.options.headers.Authorization,'Bearer test-session');assert.equal(sent.options.headers.apikey,'test-public-key');assert.equal(sent.options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(sent.options.body),{action:'request',purpose:'Test purpose'});
  let calls=0;await assert.rejects(fixture({session:null,request:async()=>{calls++;}}).service.action({}),/session has expired/);assert.equal(calls,0);
  for(const response of [{ok:false,json:async()=>({error:'Access denied'})},{ok:true,json:async()=>({ok:false,error:'Access denied'})}])await assert.rejects(fixture({request:async()=>response}).service.action({}),/Access denied/);
  await assert.rejects(fixture({request:async()=>({ok:false,json:async()=>{throw Error('Invalid JSON');}})}).service.action({}),/Certificate action failed/);
});

test('certificate loading preserves document fields, ordering and query failures',async()=>{
  const data=[{certificate_id:7}];const {service,queries}=fixture({data});assert.equal(await service.loadCertificates(),data);
  assert.equal(queries[0].table,'medical_certificates');
  assert.deepEqual(queries[0].orders,[{column:'requested_at',ascending:false},{column:'certificate_id',ascending:false}]);
  for(const field of ['diagnosis','document_content','signature_url','prepared_by','signed_by'])assert(queries[0].columns.split(',').includes(field));
  await assert.rejects(fixture({error:new Error('Query failed')}).service.loadCertificates(),/Query failed/);
  assert.deepEqual(await fixture({data:null}).service.loadCertificates(),[]);
});
