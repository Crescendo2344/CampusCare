// Optional hardware autofocus must preserve existing camera constraints and never break unsupported devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraFocus} from '../src/verification/camera-focus.js';
test('continuous autofocus is requested only when supported',async()=>{
 let sent;const track={getCapabilities:()=>({focusMode:['manual','continuous']}),getConstraints:()=>({width:{ideal:1280},facingMode:'environment'}),applyConstraints:async constraints=>sent=constraints};
 const focus=cameraFocus(track);assert.equal(focus.supported,true);assert.equal(await focus.refocus(),true);assert.equal(sent.facingMode,'environment');assert.deepEqual(sent.advanced,[{focusMode:'continuous'}]);
 assert.equal(await cameraFocus({}).refocus(),false);assert.equal(await cameraFocus({...track,applyConstraints:async()=>{throw Error('Unavailable');}}).refocus(),false);
});
