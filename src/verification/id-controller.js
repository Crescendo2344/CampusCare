import {analyzeIdPixels} from '../domain/id-guidance.js';
// Low-resolution edge/lighting checks stay local; saved photos retain full resolution.
export function startIdGuidance({video,root,captureButton,manualButton,status,progress}){
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  let disposed=false,steady=0,lastTime=-1,anchor=null,evidence=false,lastResult=0;
  const update=(code,message)=>{root.dataset.guidance=code;if(status.textContent!==message)status.textContent=message;captureButton.disabled=!evidence||video.readyState<2||!video.videoWidth||!video.videoHeight;captureButton.textContent=evidence?'Capture ID':'Show your ID';};
  update('waiting','Place the ID inside the rectangle, with all four corners visible');
  // Require an ID-like boundary, but do not block softer or more distant cards on quality scores.
  if(manualButton)manualButton.hidden=true;
  const tick=()=>{
    if(disposed)return;
    const now=performance.now();
    if(video.readyState<2||now-lastResult>1500){evidence=false;update('waiting','Show your ID with all four corners visible');}
    if(video.readyState<2||video.currentTime===lastTime)return;lastTime=video.currentTime;

    try{
      root.style.aspectRatio=video.videoWidth+'/'+video.videoHeight;
      const scale=320/Math.max(video.videoWidth,video.videoHeight);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      context.drawImage(video,0,0,canvas.width,canvas.height);
      const result=analyzeIdPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
      evidence=result.documentVisible;lastResult=now;
      // Follow landscape or portrait cards without stretching the saved evidence.
      const outline=root.querySelector('.id-guide-rectangle');
      if(outline&&result.box){const ratio=result.box.width/result.box.height,w=Math.min(canvas.width*.8,canvas.height*.78*ratio),h=w/ratio;outline.style.width=(w/canvas.width*100)+'%';outline.style.height=(h/canvas.height*100)+'%';}
      if(result.ready){
        const box=result.box;
        if(!anchor||Math.max(Math.abs(box.x-anchor.x)/canvas.width,Math.abs(box.y-anchor.y)/canvas.height,Math.abs(box.width-anchor.width)/canvas.width,Math.abs(box.height-anchor.height)/canvas.height)>.04){steady=now;anchor=box;}
        if(!steady)steady=now;const amount=Math.min(1,(now-steady)/550);progress.style.width=Math.round(amount*100)+'%';update(amount===1?'ready':'steady',amount===1?result.message:'Hold the ID still for a moment…',amount===1);}
      else{steady=0;anchor=null;progress.style.width='0%';update(result.code,result.message);}
    }catch{evidence=false;update('unavailable','ID checks could not read this frame. Keep your ID visible and retry.');}
  };
  const timer=setInterval(tick,250);
  return {canCapture:()=>{
    if(disposed||!evidence||performance.now()-lastResult>1500||video.readyState<2)return false;
    // Recheck current pixels on click so removing the card after a good frame cannot save an empty scene.
    try{context.drawImage(video,0,0,canvas.width,canvas.height);evidence=analyzeIdPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height).documentVisible;}catch{evidence=false;}
    if(!evidence)update('missing','Show your ID with all four corners visible');return evidence;
  },canUseManual:()=>false,dispose(){disposed=true;clearInterval(timer);}};
}

export async function inspectIdPhoto(dataUrl){
  const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('The ID image could not be read.'));image.src=dataUrl;});
  const canvas=document.createElement('canvas'),scale=320/Math.max(image.naturalWidth,image.naturalHeight);canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
  return analyzeIdPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
}
