import test from 'node:test';
import assert from 'node:assert/strict';
import {findSelfieDocument} from '../src/domain/selfie-document.js';
const width=320,height=240,face={x:125,y:35,width:75,height:100};
function scene(card=false,text=false){
 const pixels=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const inside=card&&x>=220&&x<295&&y>=80&&y<195;
  const detail=text&&inside&&x>230&&x<285&&y>95&&y<175&&y%12<3;
  const value=inside?(detail?35:210):25,i=(y*width+x)*4;
  pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;
 }
 return pixels;
}
test('selfie needs a detailed document boundary beside the face',()=>{
 assert.equal(findSelfieDocument(scene(),width,height,face),null);
 assert.equal(findSelfieDocument(scene(true),width,height,face),null);
 const box=findSelfieDocument(scene(true,true),width,height,face);assert(box);assert(box.x>face.x+face.width);
 assert.equal(findSelfieDocument(scene(true,true),width,height,null),null);
});

test('with an ID guide, only a card inside the guide counts',()=>{
 assert(findSelfieDocument(scene(true,true),width,height,face,{x:210,y:70,width:95,height:135}));
 assert.equal(findSelfieDocument(scene(true,true),width,height,face,{x:5,y:70,width:95,height:135}),null);
});
