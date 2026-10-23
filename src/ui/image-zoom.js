// Photo zoom for previews: mouse wheel zooms toward the cursor, drag pans, two-finger pinch zooms on
// touch screens, double-click/tap toggles, and buttons/keys (+, −, 0) work as alternatives.
const MIN_SCALE=1;

// Keep the picture centred while it is smaller than the viewport and never let an edge leave it.
export function clampOffset(offset,viewportSize,baseStart,baseSize,scale){
  const size=baseSize*scale;
  if(size<=viewportSize)return (viewportSize-size)/2-baseStart;
  return Math.min(-baseStart,Math.max(viewportSize-baseStart-size,offset));
}

// Zoom so the image point under (px,py) stays under the pointer.
export function zoomAtPoint(view,{px,py,scale,viewport,base,maxScale=6}){
  const next=Math.min(maxScale,Math.max(MIN_SCALE,scale));
  const u=(px-base.left-view.x)/view.scale,v=(py-base.top-view.y)/view.scale;
  return {
    scale:next,
    x:clampOffset(px-base.left-u*next,viewport.width,base.left,base.width,next),
    y:clampOffset(py-base.top-v*next,viewport.height,base.top,base.height,next)
  };
}

export function attachImageZoom(viewport,img,{maxScale=6,onChange=()=>{}}={}){
  let view={scale:1,x:0,y:0};
  const pointers=new Map();
  let gesture=null;
  img.style.transformOrigin='0 0';
  img.draggable=false;
  viewport.style.touchAction='none';
  viewport.tabIndex=0;

  const metrics=()=>{
    const v=viewport.getBoundingClientRect();
    return {v,viewport:{width:viewport.clientWidth,height:viewport.clientHeight},base:{left:img.offsetLeft,top:img.offsetTop,width:img.offsetWidth,height:img.offsetHeight}};
  };
  const apply=next=>{
    view=next;
    img.style.transform=view.scale===1?'':`translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    viewport.classList.toggle('is-zoomed',view.scale>1);
    onChange(view.scale);
  };
  const zoomTo=(scale,clientX,clientY)=>{
    const {v,viewport:size,base}=metrics();
    const px=clientX==null?size.width/2:clientX-v.left,py=clientY==null?size.height/2:clientY-v.top;
    const next=zoomAtPoint(view,{px,py,scale,viewport:size,base,maxScale});
    apply(next.scale===1?{scale:1,x:0,y:0}:next);
  };
  const panBy=(dx,dy)=>{
    if(view.scale===1)return;
    const {viewport:size,base}=metrics();
    apply({scale:view.scale,x:clampOffset(view.x+dx,size.width,base.left,base.width,view.scale),y:clampOffset(view.y+dy,size.height,base.top,base.height,view.scale)});
  };

  const onWheel=event=>{
    event.preventDefault();
    // Trackpads send small deltas and mouse wheels large ones; an exponential step suits both.
    zoomTo(view.scale*Math.exp(-event.deltaY*(event.deltaMode===1?0.05:0.0018)),event.clientX,event.clientY);
  };
  const pinchState=()=>{
    const [a,b]=[...pointers.values()];
    return {distance:Math.hypot(a.x-b.x,a.y-b.y)||1,x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  };
  let lastTap=null;
  const onDown=event=>{
    viewport.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    gesture=pointers.size===2?{type:'pinch',...pinchState(),scale:view.scale}:{type:'pan',x:event.clientX,y:event.clientY};
  };
  const onMove=event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(gesture?.type==='pinch'&&pointers.size===2){
      const now=pinchState();
      zoomTo(gesture.scale*now.distance/gesture.distance,now.x,now.y);
      panBy(now.x-gesture.x,now.y-gesture.y);
      gesture.x=now.x;gesture.y=now.y;
    }else if(gesture?.type==='pan'&&pointers.size===1){
      panBy(event.clientX-gesture.x,event.clientY-gesture.y);
      gesture.x=event.clientX;gesture.y=event.clientY;
    }
  };
  const onUp=event=>{
    // A quick second tap in the same place toggles zoom on touch screens.
    if(event.pointerType!=='mouse'&&pointers.size===1){
      const now=Date.now(),tap={time:now,x:event.clientX,y:event.clientY};
      if(lastTap&&now-lastTap.time<320&&Math.hypot(tap.x-lastTap.x,tap.y-lastTap.y)<30){onDouble(event);lastTap=null;}
      else lastTap=tap;
    }
    pointers.delete(event.pointerId);
    gesture=pointers.size===1?{type:'pan',...[...pointers.values()][0]}:null;
  };
  const onDouble=event=>zoomTo(view.scale>1?1:2.5,event.clientX,event.clientY);
  const onKey=event=>{
    if(event.key==='+'||event.key==='=')zoomTo(view.scale*1.25);
    else if(event.key==='-'||event.key==='_')zoomTo(view.scale/1.25);
    else if(event.key==='0')zoomTo(1);
    else return;
    event.preventDefault();
  };

  viewport.addEventListener('wheel',onWheel,{passive:false});
  viewport.addEventListener('pointerdown',onDown);
  viewport.addEventListener('pointermove',onMove);
  viewport.addEventListener('pointerup',onUp);
  viewport.addEventListener('pointercancel',onUp);
  viewport.addEventListener('dblclick',onDouble);
  viewport.addEventListener('keydown',onKey);
  const reset=()=>apply({scale:1,x:0,y:0});
  window.addEventListener('resize',reset);
  return {
    zoomIn:()=>zoomTo(view.scale*1.4),
    zoomOut:()=>zoomTo(view.scale/1.4),
    reset,
    get scale(){return view.scale;},
    dispose(){window.removeEventListener('resize',reset);}
  };
}
