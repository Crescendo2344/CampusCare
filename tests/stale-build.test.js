// A tab opened before a deployment reloads once to pick up the new build instead of showing a broken page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isStaleBuildError,reloadForNewBuild} from '../src/app/stale-build.js';

const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};

test('missing page files from an older build are recognised in every browser wording',()=>{
  assert.ok(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/reports-ns5zwdRb.js')));
  assert.ok(isStaleBuildError(new TypeError('Importing a module script failed.')));
  assert.ok(isStaleBuildError(new TypeError('error loading dynamically imported module: https://x/assets/a.js')));
  assert.ok(!isStaleBuildError(new Error('Clinical reports access required.')));
});

test('the page reloads once, then shows the message instead of looping',()=>{
  const storage=memory();let reloads=0;const reload=()=>reloads++;
  assert.equal(reloadForNewBuild({storage,reload,now:1000}),true);
  assert.equal(reloadForNewBuild({storage,reload,now:5000}),false,'A second failure within a minute does not reload again');
  assert.equal(reloadForNewBuild({storage,reload,now:70000}),true,'A later deployment can reload again');
  assert.equal(reloads,2);
});

test('blocked storage still allows one reload',()=>{
  let reloads=0;const broken={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  assert.equal(reloadForNewBuild({storage:broken,reload:()=>reloads++,now:1000}),true);
  assert.equal(reloads,1);
});

test('missing build files return 404 instead of the app page',()=>{
  const rewrite=JSON.parse(fs.readFileSync('vercel.json','utf8')).rewrites[0];
  const pattern=new RegExp('^'+rewrite.source+'$');
  assert.ok(!pattern.test('/assets/reports-ns5zwdRb.js'),'Old asset paths are not rewritten to index.html');
  assert.ok(pattern.test('/reports'),'App routes still load the app');
});
