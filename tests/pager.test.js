import test from 'node:test';
import assert from 'node:assert/strict';
import {paginate,pagerHtml} from '../src/ui/pager.js';

test('lists page in tens and reset to page 1 when filters change',()=>{
  const list=Array.from({length:23},(_,i)=>i);
  let p=paginate('t',list,{signature:'a'});
  assert.deepEqual([p.page,p.pages,p.rows.length,p.first],[1,3,10,0]);
  assert.match(pagerHtml(p,()=>{}),/Showing 1–10 of 23[\s\S]*Page 1 of 3/);
  assert.equal(pagerHtml(paginate('short',[1,2,3]),()=>{}),'','No pager for a single page');
  p=paginate('t',list.slice(0,5),{signature:'b'});
  assert.equal(p.page,1);assert.equal(p.rows.length,5);
});
