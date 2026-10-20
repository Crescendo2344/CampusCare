import {assessSelfieFrame} from '../domain/selfie-guidance.js';
// A per-modal controller owns the worker and timers so retakes cannot leak camera processing.
export function startSelfieGuidance({video,root,captureButton,manualButton,status,progress}){
  let worker,disposed=false,busy=false,available=false,steadySince=0,readyUntil=0,lastCode='',lastTime=-1,lastResult=0,lastSent=0;
  const setStatus=(code,message,ready=false)=>{
    root.dataset.guidance=code;
    if(lastCode!==message){status.textContent=message;lastCode=message;}
    captureButton.disabled=!ready;captureButton.textContent=ready?'Capture Selfie':'Follow the guide';
  };
  const fallback=()=>{
    if(disposed)return;available=false;readyUntil=0;steadySince=0;root.dataset.detector='unavailable';
    setStatus('manual','Automatic guidance is unavailable. Use the outline and capture for clinic review.');
    manualButton.hidden=false;progress.style.width='0%';worker?.terminate();worker=null;busy=false;
  };
  // Match the guide to the actual camera aspect ratio, including portrait phone cameras.
  const fitFrame=()=>{if(video.videoWidth&&video.videoHeight)root.style.aspectRatio=video.videoWidth+'/'+video.videoHeight;};
  video.addEventListener('loadedmetadata',fitFrame);fitFrame();
  setStatus('loading','Preparing on-device camera guidance…');
  const slow=setTimeout(fallback,12000);
  // Manual clinic review remains available for devices or accessibility needs the guide cannot assess.
  const help=setTimeout(()=>{if(!disposed)manualButton.hidden=false;},20000);
  try{
    worker=new Worker(new URL('./face-detector.worker.js',import.meta.url));
    worker.onerror=event=>{event.preventDefault();fallback();};
    worker.onmessage=({data})=>{
      if(disposed)return;
      if(data.type==='ready'){clearTimeout(slow);available=true;root.dataset.detector='ready';setStatus('waiting','Position your face inside the oval');return;}
      if(data.type==='unavailable'){clearTimeout(slow);fallback();return;}
      if(data.type!=='result')return;
      busy=false;const result=assessSelfieFrame(data),now=performance.now();lastResult=now;
      if(result.ready){
        if(!steadySince)steadySince=now;
        const fraction=Math.min(1,(now-steadySince)/1000);progress.style.width=Math.round(fraction*100)+'%';
        const ready=fraction>=1;readyUntil=ready?now+1000:0;
        setStatus(ready?'ready':'steady',ready?result.message:'Hold still for a moment…',ready);
      }else{steadySince=0;readyUntil=0;progress.style.width='0%';setStatus(result.code,result.message);}
    };
    worker.postMessage({type:'init',origin:location.origin});
  }catch{clearTimeout(slow);fallback();}
  const timer=setInterval(async()=>{
    if(disposed)return;
    const now=performance.now();
    // Invalidate an old ready state if the camera pauses or the worker stops responding.
    if(readyUntil&&now-lastResult>1500){readyUntil=0;steadySince=0;setStatus('waiting','Camera paused — wait for the preview');}
    if(busy&&now-lastSent>5000){fallback();return;}
    if(!available||busy||video.readyState<2||video.currentTime===lastTime)return;
    lastTime=video.currentTime;busy=true;lastSent=now;
    try{
      // Limit inference resolution and frame rate; the saved evidence keeps full camera resolution.
      const bitmap=await createImageBitmap(video,{resizeWidth:640,resizeHeight:Math.round(640*video.videoHeight/video.videoWidth)});
      if(disposed||!worker){bitmap.close();busy=false;return;}
      worker.postMessage({type:'frame',bitmap,timestamp:performance.now()},[bitmap]);
    }catch{fallback();}
  },250);
  return {
    canCapture:()=>!disposed&&available&&performance.now()<readyUntil,
    canUseManual:()=>!disposed&&!manualButton.hidden,
    dispose(){disposed=true;video.removeEventListener('loadedmetadata',fitFrame);clearInterval(timer);clearTimeout(slow);clearTimeout(help);worker?.terminate();}
  };
}
