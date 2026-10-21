import {createCaptureReadiness} from './capture-readiness.js';
import {assessSelfieFrame} from '../domain/selfie-guidance.js';
// A controller owns both inference routes; neither may bypass required face/document evidence.
export function startSelfieGuidance({video,root,captureButton,manualButton,status,progress}){
  const readiness=createCaptureReadiness();
  let worker,mainDetector,disposed=false,busy=false,available=false,switching=false,lastCode='',lastTime=-1,lastResult=0,lastSent=0,slow;
  const setStatus=(code,message,ready=false)=>{
    root.dataset.guidance=code;
    if(lastCode!==message){status.textContent=message;lastCode=message;}
    captureButton.disabled=!ready;captureButton.textContent=ready?'Capture Selfie':'Follow the guide';
  };
  const unavailable=()=>{
    if(disposed)return;clearTimeout(slow);available=false;busy=false;
    root.dataset.detector='unavailable';progress.style.width='0%';
    setStatus('unavailable','Camera access is working, but photo checks could not load. Check your connection, then close and reopen the camera.');
  };
  const onResult=data=>{
    if(disposed)return;busy=false;const result=assessSelfieFrame(data),now=performance.now();lastResult=now;
    // Brief missed detections should not make the shutter flicker or restart a long countdown.
    const smoothed=readiness.update(result,now);
    progress.style.width=Math.round(smoothed.progress*100)+'%';
    setStatus(smoothed.ready?'ready':smoothed.feedback.code,smoothed.ready?'Good position — keep your document visible':result.ready?'Hold still for a moment…':smoothed.feedback.message,smoothed.ready);
  };
  const fallback=async()=>{
    if(disposed||switching)return;
    switching=true;clearTimeout(slow);worker?.terminate();worker=null;available=false;busy=false;
    setStatus('loading','Starting compatible photo checks…');root.dataset.detector='loading';
    slow=setTimeout(unavailable,20000);
    try{
      const {createMainThreadFaceDetector}=await import('./main-thread-face-detector.js');
      const detector=await createMainThreadFaceDetector();
      // A late initialization must release resources if the modal closed or the request timed out.
      if(disposed||root.dataset.detector==='unavailable'){detector.dispose();return;}
      clearTimeout(slow);mainDetector=detector;available=true;lastTime=-1;root.dataset.detector='ready';root.dataset.inference='main';
      setStatus('waiting','Place your face and ID in the guides');
    }catch{unavailable();}
  };
  // Fit the original camera aspect ratio within the visible modal without stretching either guide.
  const fitFrame=()=>{if(video.videoWidth&&video.videoHeight){root.style.aspectRatio=video.videoWidth+'/'+video.videoHeight;root.style.setProperty('--camera-aspect',video.videoWidth/video.videoHeight);}};
  video.addEventListener('loadedmetadata',fitFrame);fitFrame();if(manualButton)manualButton.hidden=true;
  setStatus('loading','Preparing on-device camera guidance…');slow=setTimeout(fallback,12000);
  try{
    worker=new Worker(new URL('./face-detector.worker.js',import.meta.url));
    worker.onerror=event=>{event.preventDefault();fallback();};
    worker.onmessage=({data})=>{
      if(disposed||switching)return;
      if(data.type==='ready'){clearTimeout(slow);available=true;root.dataset.detector='ready';root.dataset.inference='worker';setStatus('waiting','Place your face and ID in the guides');return;}
      if(data.type==='unavailable'){fallback();return;}
      if(data.type==='result')onResult(data);
    };
    worker.postMessage({type:'init',origin:location.origin});
  }catch{fallback();}
  const timer=setInterval(async()=>{
    if(disposed)return;
    const now=performance.now();
    if(now-lastResult>2000&&lastResult){setStatus('waiting','Camera paused — wait for the preview');}
    if(busy&&now-lastSent>5000){fallback();return;}
    if(!available||busy||video.readyState<2||!video.videoWidth||video.currentTime===lastTime)return;
    lastTime=video.currentTime;busy=true;lastSent=now;
    try{
      if(mainDetector){onResult(mainDetector.detect(video,now));return;}
      const bitmap=await createImageBitmap(video,{resizeWidth:640,resizeHeight:Math.round(640*video.videoHeight/video.videoWidth)});
      if(disposed||!worker){bitmap.close();busy=false;return;}
      worker.postMessage({type:'frame',bitmap,timestamp:performance.now()},[bitmap]);
    }catch{if(mainDetector){mainDetector.dispose();mainDetector=null;unavailable();}else fallback();}
  },350);
  return {canCapture:()=>!disposed&&available&&video.readyState>=2&&performance.now()-lastResult<2000&&readiness.canCapture(performance.now()),canUseManual:()=>false,
    dispose(){disposed=true;video.removeEventListener('loadedmetadata',fitFrame);clearInterval(timer);clearTimeout(slow);worker?.terminate();mainDetector?.dispose();}};
}
