import {createSelfieAnalyzer} from './selfie-frame.js';
// Some mobile WebKit versions cannot run the worker/OffscreenCanvas route despite camera permission.
// Use the same local model directly on an HTML video/canvas; frames still never leave the device.
export async function createMainThreadFaceDetector(){
  const {FaceDetector,FilesetResolver}=await import('@mediapipe/tasks-vision');
  const files=await FilesetResolver.forVisionTasks(location.origin+'/vision/1.1.1');
  const detector=await FaceDetector.createFromOptions(files,{baseOptions:{modelAssetPath:location.origin+'/models/blaze-face-short-range.tflite',delegate:'CPU'},runningMode:'VIDEO',minDetectionConfidence:.5});
  const analyze=createSelfieAnalyzer(()=>document.createElement('canvas'));
  return {detect(video,timestamp){return analyze(video,video.videoWidth,video.videoHeight,detector.detectForVideo(video,timestamp).detections);},dispose(){detector.close();}};
}
