// Run inference off the UI thread. All assets and frames stay on the current origin/device.
import {FaceDetector,FilesetResolver} from '@mediapipe/tasks-vision';
import {faceImageQuality} from '../domain/selfie-guidance.js';
let detector;
const crop=new OffscreenCanvas(128,128),context=crop.getContext('2d',{willReadFrequently:true});
self.onmessage=async({data})=>{
  if(data.type==='init'){
    try{
      const files=await FilesetResolver.forVisionTasks(data.origin+'/vision/1.1.1');
      detector=await FaceDetector.createFromOptions(files,{baseOptions:{modelAssetPath:data.origin+'/models/blaze-face-short-range.tflite',delegate:'CPU'},runningMode:'VIDEO',minDetectionConfidence:.65});
      self.postMessage({type:'ready'});
    }catch{self.postMessage({type:'unavailable'});}
    return;
  }
  if(data.type!=='frame')return;
  const bitmap=data.bitmap;
  try{
    const detections=detector.detectForVideo(bitmap,data.timestamp).detections;
    const faces=detections.map(({boundingBox:b,keypoints})=>({x:b.originX,y:b.originY,width:b.width,height:b.height,keypoints}));
    const face=[...faces].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    let quality={brightness:null,sharpness:null};
    if(face){
      const x=Math.max(0,face.x),y=Math.max(0,face.y),w=Math.min(face.width,bitmap.width-x),h=Math.min(face.height,bitmap.height-y);
      if(w>0&&h>0){context.drawImage(bitmap,x,y,w,h,0,0,128,128);quality=faceImageQuality(context.getImageData(0,0,128,128).data,128,128);}
    }
    self.postMessage({type:'result',faces,width:bitmap.width,height:bitmap.height,...quality});
  }catch{self.postMessage({type:'unavailable'});}
  finally{bitmap.close();}
};
