// Run inference off the UI thread when supported. Assets and camera frames stay on-device.
import {FaceDetector,FilesetResolver} from '@mediapipe/tasks-vision';
import {createSelfieAnalyzer} from './selfie-frame.js';
let detector,analyze;
self.onmessage=async({data})=>{
  if(data.type==='init'){
    try{
      analyze=createSelfieAnalyzer(()=>new OffscreenCanvas(1,1));
      const files=await FilesetResolver.forVisionTasks(data.origin+'/vision/1.1.1');
      detector=await FaceDetector.createFromOptions(files,{baseOptions:{modelAssetPath:data.origin+'/models/blaze-face-short-range.tflite',delegate:'CPU'},runningMode:'VIDEO',minDetectionConfidence:.5});
      self.postMessage({type:'ready'});
    }catch{self.postMessage({type:'unavailable'});}
    return;
  }
  if(data.type!=='frame')return;
  const bitmap=data.bitmap;
  try{self.postMessage({type:'result',...analyze(bitmap,bitmap.width,bitmap.height,detector.detectForVideo(bitmap,data.timestamp).detections)});}
  catch{self.postMessage({type:'unavailable'});}
  finally{bitmap.close();}
};
