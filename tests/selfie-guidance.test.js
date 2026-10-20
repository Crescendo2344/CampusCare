// Exercise camera feedback with frame-relative positions, including a small portrait on a held ID.
import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSelfieFrame,faceImageQuality} from '../src/domain/selfie-guidance.js';
const face={x:365,y:130,width:270,height:300,keypoints:[{x:.45,y:.3},{x:.55,y:.3},{x:.5,y:.35}]};
const check=changes=>assessSelfieFrame({faces:[face],width:1000,height:800,brightness:120,sharpness:80,documentVisible:true,...changes});
test('distance and frame-relative centering guide the person before capture',()=>{
 assert.equal(check({faces:[]}).code,'no-face');
 assert.equal(check({faces:[{...face,width:100,height:110}]}).code,'far');
 assert.equal(check({faces:[{...face,width:500,height:530}]}).code,'close');
 assert.equal(check({faces:[{...face,x:0}]}).code,'cropped');
 assert.equal(check({faces:[{...face,x:600}]}).code,'center');
 assert.equal(check({}).ready,true);
});
test('poor light, blur, and head alignment cannot produce ready feedback',()=>{
 assert.equal(check({brightness:25}).code,'dark');assert.equal(check({brightness:245}).code,'bright');assert.equal(check({sharpness:4}).code,'blur');
 assert.equal(check({faces:[{...face,keypoints:[{x:.45,y:.3},{x:.55,y:.4},{x:.5,y:.35}]}]}).code,'tilt');
 assert.equal(check({faces:[{...face,keypoints:[{x:.45,y:.3},{x:.55,y:.3},{x:.55,y:.35}]}]}).code,'forward');
});
test('a printed ID portrait does not count as another person, but two large faces do',()=>{
 assert.equal(check({faces:[{x:50,y:500,width:60,height:75},face]}).ready,true);
 assert.equal(check({faces:[{...face,x:10},face]}).code,'multiple');
});
test('brightness and sharpness come from actual face pixels',()=>{
 const pixels=new Uint8ClampedArray(8*8*4);
 for(let i=0;i<64;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=120;pixels[i*4+3]=255;}
 assert.deepEqual(faceImageQuality(pixels,8,8),{brightness:120,sharpness:0});
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let c=0;c<3;c++)pixels[(y*8+x)*4+c]=(x+y)%2?220:20;
 const result=faceImageQuality(pixels,8,8);assert.equal(result.brightness,120);assert(result.sharpness>100);
});

// A physically identical oval must accept a naturally larger frame-relative face on portrait cameras.
test('portrait selfie framing follows the same square guide framing',()=>{
 assert.equal(assessSelfieFrame({faces:[{x:120,y:65,width:240,height:300}],width:480,height:640,brightness:120,sharpness:80,documentVisible:true}).ready,true);
});

test('a good face alone cannot pass the document-holding selfie check',()=>{
 assert.equal(check({documentVisible:false}).code,'document');
 assert.equal(check({documentVisible:undefined}).ready,false);
});
