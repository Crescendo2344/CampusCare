// Camera inference may miss one frame; sustained absence must still close the capture window.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureReadiness} from '../src/verification/capture-readiness.js';
const good={ready:true,code:'ready',message:'Ready'},missing={ready:false,code:'missing',message:'Show ID'};
test('stable evidence survives brief jitter but expires after sustained absence',()=>{
 const gate=createCaptureReadiness();
 assert.equal(gate.update(missing,0).ready,false);
 assert.equal(gate.update(good,100).ready,false);
 assert.equal(gate.update(good,500).ready,true);
 assert.equal(gate.update(missing,800).ready,true);
 assert.equal(gate.canCapture(2100),true);
 assert.equal(gate.canCapture(2400),false);
 assert.equal(gate.update(missing,2500).ready,false);
 assert.equal(gate.update(good,2600).ready,false);
});
test('a single isolated positive frame cannot unlock capture',()=>{
 const gate=createCaptureReadiness();gate.update(good,0);gate.update(missing,200);
 assert.equal(gate.canCapture(400),false);
 assert.equal(gate.update(good,500).ready,false);
});
