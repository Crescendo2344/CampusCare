import test from 'node:test';
import assert from 'node:assert/strict';
import {expiryState,inventoryCsv,inventorySummary,stockState} from '../src/domain/inventory-status.js';

const today='2026-10-23';
test('stock states separate out-of-stock from low stock',()=>{
  assert.equal(stockState({qty:0,threshold:10}),'out');
  assert.equal(stockState({qty:10,threshold:10}),'low');
  assert.equal(stockState({qty:14,threshold:10}),'medium');
  assert.equal(stockState({qty:40,threshold:10}),'ok');
});
test('expiry is flagged 90 days ahead',()=>{
  assert.deepEqual(expiryState({expiryDate:'2026-10-22'},today),{state:'expired',days:-1});
  assert.deepEqual(expiryState({expiryDate:'2026-12-01'},today),{state:'soon',days:39});
  assert.equal(expiryState({expiryDate:'2027-06-01'},today).state,'ok');
  assert.equal(expiryState({},today).state,'');
});
test('summary and export',()=>{
  const items=[{id:1,name:'Paracetamol',category:'Medicine',qty:0,threshold:5,unit:'tabs',unitCost:2,expiryDate:'2026-11-01'},{id:2,name:'=Gauze',category:'Supplies',qty:20,threshold:5,unit:'pcs',unitCost:1.5},{id:3,name:'Old',qty:5,threshold:1,archived:true,unitCost:100}];
  assert.deepEqual(inventorySummary(items,today),{items:2,out:1,low:0,expired:0,expiringSoon:1,value:30});
  const csv=inventoryCsv(items.slice(0,2),today);
  assert.match(csv,/Out of stock/);assert.match(csv,/Expires in 9 days/);assert.match(csv,/"'=Gauze"/);
});
