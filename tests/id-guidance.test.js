// Synthetic ID-like rectangles exercise real boundary estimation without personal documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import {detectIdBoundary,assessIdFrame,analyzeIdPixels} from '../src/domain/id-guidance.js';
function image({x=60,y=56,w=200,h=128,card=200}={}){
 const width=320,height=240,pixels=new Uint8ClampedArray(width*height*4);
 for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
  const inside=xx>=x&&xx<x+w&&yy>=y&&yy<y+h,value=inside?card:20,i=(yy*width+xx)*4;
  pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;
 }
 return {pixels,width,height};
}
test('strong complete card boundaries are located in landscape and portrait frames',()=>{
 for(const geometry of [{},{x:110,y:35,w:100,h:170}]){
  const f=image(geometry),box=detectIdBoundary(f.pixels,f.width,f.height);assert(box);assert(Math.abs(box.x-(geometry.x??60))<4);assert(Math.abs(box.width-(geometry.w??200))<5);
  assert.equal(analyzeIdPixels(f.pixels,f.width,f.height).ready,true);
 }
});
test('a blank scene does not produce a ready ID, while distance and lighting give actionable guidance',()=>{
 const f=image({w:0,h:0});assert.equal(analyzeIdPixels(f.pixels,f.width,f.height).code,'missing');
 const check=changes=>assessIdFrame({box:{x:60,y:56,width:200,height:128},width:320,height:240,brightness:150,sharpness:100,...changes});
 assert.equal(check({box:{x:110,y:90,width:100,height:60}}).code,'far');
 assert.equal(check({box:{x:4,y:10,width:316,height:200}}).code,'close');
 assert.equal(check({box:{x:0,y:40,width:200,height:128}}).code,'cropped');
 assert.equal(check({box:{x:165,y:56,width:140,height:90}}).code,'center');
 assert.equal(check({brightness:20}).code,'dark');assert.equal(check({brightness:245}).code,'glare');assert.equal(check({sharpness:3}).code,'blur');
});

// Modest framing and softness are acceptable; severe defects still produce advice rather than false ready states.
test('smaller and moderately soft ID images can pass automatic guidance',()=>{
 assert.equal(assessIdFrame({box:{x:96,y:78,width:128,height:84},width:320,height:240,brightness:110,sharpness:12}).ready,true);
});

// Presence is distinct from visual quality: distant/soft cards work, empty camera frames do not.
test('ID evidence is required independently of quality prompts',()=>{
 const missing=image({w:0,h:0});assert.equal(analyzeIdPixels(missing.pixels,missing.width,missing.height).documentVisible,false);
 const far=image({x:110,y:90,w:100,h:60});const result=analyzeIdPixels(far.pixels,far.width,far.height);
 assert.equal(result.documentVisible,true);assert.equal(result.code,'far');
});
