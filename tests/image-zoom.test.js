// Zoom math keeps the point under the cursor fixed and the picture inside its frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {clampOffset,zoomAtPoint} from '../src/ui/image-zoom.js';
const viewport={width:400,height:300},base={left:50,top:0,width:300,height:300};
test('zooming toward a point keeps that image point under the pointer',()=>{
  const view=zoomAtPoint({scale:1,x:0,y:0},{px:200,py:150,scale:2,viewport,base});
  assert.equal(view.scale,2);
  // Image point under (200,150) was (150,150); after zooming it sits at base.left + x + 150*2.
  assert.equal(base.left+view.x+150*2,200);
  assert.equal(base.top+view.y+150*2,150);
});
test('scale is limited and a zoomed-out picture recentres',()=>{
  assert.equal(zoomAtPoint({scale:1,x:0,y:0},{px:10,py:10,scale:40,viewport,base,maxScale:6}).scale,6);
  assert.equal(zoomAtPoint({scale:2,x:-100,y:-100},{px:10,py:10,scale:.2,viewport,base}).scale,1);
  assert.equal(clampOffset(500,400,50,300,1),0,'Smaller than the frame: stays centred');
});
test('panning stops at the picture edges',()=>{
  assert.equal(clampOffset(400,400,50,300,2),-50,'Left edge cannot move right of the frame');
  assert.equal(clampOffset(-900,400,50,300,2),400-50-600,'Right edge cannot move left of the frame');
});
