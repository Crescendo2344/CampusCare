// Inventory service tests use injected clients and requests; they never access live records.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as records from '../src/domain/inventory-records.js';
import { createInventoryService } from '../src/services/inventory.js';

function fixture({session={access_token:'test-session'},failureTable,request}={}){
  const queries=[];
  const raw={inventory_items:[{item_id:'4',item_name:'Gauze',quantity:'12'}],inventory_transactions:[],inventory_forecasts:[]};
  const client={auth:{getSession:async()=>({data:{session}})},from(table){
    const query={table};queries.push(query);
    return {select(columns){query.columns=columns;return this;},order(column,options){
      query.order={column,...options};
      return Promise.resolve(table===failureTable?{error:new Error('Query failed')}:{data:raw[table]});
    }};
  }};
  const errors=[];
  const service=createInventoryService({getClient:()=>client,request,baseUrl:'https://inventory.test',publishableKey:'test-public-key',reportForecastError:e=>errors.push(e)});
  return {service,queries,errors,raw};
}

test('record mapping preserves IDs, numeric fields, empty defaults and null forecasts',()=>{
  const item=records.realInventoryToUi({item_id:'4',quantity:'12',archived_by:'2'});
  assert.equal(item.id,900004);assert.equal(item.qty,12);assert.equal(item.category,'Supplies');
  assert.equal(item.archivedBy,100002);assert.equal(item._realSupabase,true);
  assert.equal(records.inventoryDisplayId(item),'000004');
  const tx=records.realInventoryTransactionToUi({transaction_id:'7',item_id:'4',transaction_date:'2026-10-08T08:00:00Z',created_by:'2'});
  assert.equal(tx.id,910007);assert.equal(tx.itemId,item.id);assert.equal(tx.date,'2026-10-08');
  assert.equal(tx.userId,100002);assert.equal(tx.type,'Adjustment');
  assert.equal(records.realInventoryForecastToUi({forecast_id:1,item_id:4}).predictedRemainingStock,null);
  assert.equal(records.realInventoryForecastToUi({forecast_id:1,item_id:4,predicted_remaining_stock:0}).predictedRemainingStock,0);
});

test('refresh replaces real rows, retains demo rows and preserves the input snapshot',()=>{
  const db={inventory:[{id:1},{id:900003,_realSupabase:true}],disbursements:[{id:2},{id:910003,_realSupabase:true}]};
  const before=JSON.stringify(db);
  const merged=records.mergeInventorySnapshot(db,{items:[{item_id:4}],transactions:[{transaction_id:5,item_id:4,transaction_type:'Disbursement'},{transaction_id:6,item_id:4,transaction_type:'Adjustment'}],forecasts:[]});
  assert.deepEqual(merged.inventory.map(i=>i.id),[1,900004]);
  assert.deepEqual(merged.disbursements.map(t=>t.id),[2,910005]);
  assert.equal(merged.inventoryTransactions.length,2);assert.equal(JSON.stringify(db),before);
  assert.deepEqual(records.inventoryRecords(merged,{_realSupabase:true}).map(i=>i.id),[900004]);
  assert.equal(records.inventoryRecords(merged,{}).length,2);
  assert.equal(records.inventoryTransactionRecords(merged,{_realSupabase:true}).length,2);
  assert.equal(records.inventoryTransactionRecords(merged,{})[0].type,'Disbursement');
  assert.deepEqual(records.inventoryForecastRecords({inventoryForecasts:[{id:1}]},{}),[]);
});

test('actions authenticate and preserve endpoint, payload and error behavior',async()=>{
  let sent;
  const {service}=fixture({request:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({ok:true})};}});
  assert.deepEqual(await service.action({action:'adjust',item_id:4}),{ok:true});
  assert.equal(sent.url,'https://inventory.test/functions/v1/inventory-actions');
  assert.equal(sent.options.method,'POST');assert.equal(sent.options.headers.Authorization,'Bearer test-session');
  assert.equal(sent.options.headers.apikey,'test-public-key');
  assert.deepEqual(JSON.parse(sent.options.body),{action:'adjust',item_id:4});
  let requests=0;
  await assert.rejects(fixture({session:null,request:async()=>{requests++;}}).service.action({}),/session has expired/);
  assert.equal(requests,0);
  await assert.rejects(fixture({request:async()=>({ok:false,json:async()=>({error:'Permission denied'})})}).service.action({}),/Permission denied/);
  await assert.rejects(fixture({request:async()=>({ok:true,json:async()=>{throw Error('invalid json');}})}).service.action({}),/Inventory action failed/);
});

test('loading returns raw records and retains table ordering',async()=>{
  const {service,queries,raw}=fixture();const result=await service.load();
  assert.equal(result.items,raw.inventory_items);assert.equal(result.transactions,raw.inventory_transactions);
  assert.deepEqual(queries.map(q=>[q.table,q.order.column,q.order.ascending]),[
    ['inventory_items','item_name',true],['inventory_transactions','transaction_date',false],['inventory_forecasts','forecast_month',true]
  ]);
});

test('each failed query rejects the refresh instead of returning partial data',async()=>{
  for(const failureTable of ['inventory_items','inventory_transactions','inventory_forecasts']){
    await assert.rejects(fixture({failureTable}).service.load(),/Query failed/);
  }
});

test('forecast generation failure does not prevent inventory loading',async()=>{
  const {service,errors,queries}=fixture({request:async()=>{throw Error('Forecast unavailable');}});
  const result=await service.load(true);
  assert.equal(result.items.length,1);assert.equal(queries.length,3);
  assert.match(errors[0].message,/Forecast unavailable/);
});
