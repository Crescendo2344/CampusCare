import {createCaptureReadiness} from './capture-readiness.js';
import {analyzeIdPixels} from '../domain/id-guidance.js';
// Low-resolution edge/lighting checks stay local; saved photos retain full resolution.
export function startIdGuidance({video,root,captureButton,manualButton,status,progress}){
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  const readiness=createCaptureReadiness({settleMs:250,graceMs:2000});
  let disposed=false,lastTime=-1,lastResult=0;
  const update=(code,message,ready=false)=>{root.dataset.guidance=code;if(status.textContent!==message)status.textContent=message;captureButton.disabled=!ready;captureButton.textContent=ready?'Capture ID':'Show your ID';};
  update('waiting','Keep your ID visible inside the guide');
  if(manualButton)manualButton.hidden=true;
  const tick=()=>{
    if(disposed)return;
    const now=performance.now();
    if(video.readyState<2||!video.videoWidth||now-lastResult>2200)update('waiting','Keep your ID visible inside the guide');
    if(video.readyState<2||!video.videoWidth||!video.videoHeight||video.currentTime===lastTime)return;
    lastTime=video.currentTime;
    try{
      root.style.aspectRatio=video.videoWidth+'/'+video.videoHeight;
      root.style.setProperty('--camera-aspect',video.videoWidth/video.videoHeight);
      const scale=320/Math.max(video.videoWidth,video.videoHeight);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      context.drawImage(video,0,0,canvas.width,canvas.height);
      const result=analyzeIdPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
      lastResult=now;
      // Fixed guides do not jump between card edges, text, fingers or the background.
      const usable=result.documentVisible&&result.brightness>=28&&result.brightness<=247&&result.sharpness>=4;
      const smoothed=readiness.update({...result,ready:usable},now);
      progress.style.width=Math.round(smoothed.progress*100)+'%';
      update(smoothed.ready?'ready':smoothed.feedback.code,smoothed.ready?'ID visible — ready to capture':smoothed.feedback.message,smoothed.ready);
    }catch{update('unavailable','Keep the ID visible and wait for the camera preview.');}
  };
  const timer=setInterval(tick,250);
  // Use the recent stable evidence window rather than a noisy one-frame recheck on click.
  return {canCapture:()=>!disposed&&video.readyState>=2&&performance.now()-lastResult<2200&&readiness.canCapture(performance.now()),canUseManual:()=>false,dispose(){disposed=true;clearInterval(timer);}};
}

export async function inspectIdPhoto(dataUrl){
  const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('The ID image could not be read.'));image.src=dataUrl;});
  const canvas=document.createElement('canvas'),scale=320/Math.max(image.naturalWidth,image.naturalHeight);canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
  return analyzeIdPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
}
