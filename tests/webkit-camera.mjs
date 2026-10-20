// Run the real local MediaPipe model in WebKit with an HTML canvas, without using anyone's camera.
import assert from 'node:assert/strict';
import {webkit} from 'playwright';
import {createServer} from 'vite';
// Serve a minimal fixture page so no application auth/network work can interfere with camera checks.
const server=await createServer({plugins:[{name:'camera-fixture',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url==='/__camera_test'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');}else next();});}}],server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const origin=server.resolvedUrls.local[0],browser=await webkit.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort());
 // An empty canvas reproduces a live frame without a face or ID; permission cannot affect this check.
 await page.goto(origin+'__camera_test');await page.evaluate(async()=>{
  const {startSelfieGuidance}=await import('/src/verification/selfie-controller.js');
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
  Object.defineProperties(canvas,{videoWidth:{value:320},videoHeight:{value:240},readyState:{value:2},currentTime:{get:()=>performance.now()/1000}});
  canvas.getContext('2d').fillRect(0,0,320,240);
  const root=document.createElement('section'),status=document.createElement('p'),progress=document.createElement('span'),button=document.createElement('button'),manual=document.createElement('button');
  root.id='webkit-camera';root.append(canvas,status,progress,button,manual);document.body.replaceChildren(root);
  window.Worker=class {constructor(){throw new Error('Fixture: worker route unavailable');}};
  window.__camera=startSelfieGuidance({video:canvas,root,captureButton:button,manualButton:manual,status,progress});
 });
 await page.waitForFunction(()=>document.getElementById('webkit-camera')?.dataset.inference==='main',null,{timeout:40000});
 await page.waitForFunction(()=>document.getElementById('webkit-camera')?.dataset.guidance==='no-face');
 assert.equal(await page.evaluate(()=>window.__camera.canCapture()),false);
 assert.equal(await page.evaluate(()=>window.__camera.canUseManual()),false);
 assert(await page.locator('#webkit-camera button').first().isDisabled());
 await page.evaluate(()=>window.__camera.dispose());
 console.log('PASS: real MediaPipe HTML-canvas compatibility checks run in WebKit and block missing face/ID evidence');
}finally{await browser.close();await server.close();}
