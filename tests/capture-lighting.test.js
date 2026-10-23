// Verification captures brighten the scene without device brightness access and always restore it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {startCaptureLighting} from '../src/verification/capture-lighting.js';
function setup({facingMode,torch=false}){
  const dom=new JSDOM('<div id="controls"></div>');globalThis.document=dom.window.document;
  const constraints=[],released=[];
  const track={getSettings:()=>({facingMode}),getCapabilities:()=>(torch?{torch:true}:{}),applyConstraints:async value=>{constraints.push(value);}};
  const navigatorRef={wakeLock:{request:async()=>({release:async()=>{released.push(true);}})}};
  const controls=dom.window.document.getElementById('controls');
  return {track,controls,constraints,released,navigatorRef,root:dom.window.document.documentElement};
}
test('front cameras turn on the screen light and restore the page afterwards',async()=>{
  const f=setup({facingMode:'user'});
  const lighting=startCaptureLighting({track:f.track,controls:f.controls,documentElement:f.root,navigatorRef:f.navigatorRef});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert(f.root.classList.contains('capture-fill-light'));
  const toggle=f.controls.querySelector('button');assert.equal(toggle.textContent,'Screen light: On');
  toggle.click();assert(!f.root.classList.contains('capture-fill-light'));assert.equal(toggle.textContent,'Screen light: Off');
  toggle.click();lighting.dispose();
  assert(!f.root.classList.contains('capture-fill-light'));assert.equal(f.released.length,1,'Wake lock is released');
});
test('rear cameras offer the flashlight when supported and switch it off on dispose',()=>{
  const f=setup({facingMode:'environment',torch:true});
  const lighting=startCaptureLighting({track:f.track,controls:f.controls,documentElement:f.root,navigatorRef:f.navigatorRef});
  assert(!f.root.classList.contains('capture-fill-light'));
  const toggle=f.controls.querySelector('button');assert.equal(toggle.textContent,'Flashlight: Off');
  toggle.click();assert.deepEqual(f.constraints.at(-1),{advanced:[{torch:true}]});
  lighting.dispose();assert.deepEqual(f.constraints.at(-1),{advanced:[{torch:false}]});
});
