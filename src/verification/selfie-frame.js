import {findSelfieDocument} from '../domain/selfie-document.js';
import {faceImageQuality} from '../domain/selfie-guidance.js';
// Share identical frame checks between the worker and the HTML-canvas compatibility path.
export function createSelfieAnalyzer(makeCanvas){
  const frame=makeCanvas(),crop=makeCanvas();crop.width=128;crop.height=128;
  const frameContext=frame.getContext('2d',{willReadFrequently:true}),context=crop.getContext('2d',{willReadFrequently:true});
  return (source,width,height,detections)=>{
    const faces=detections.map(({boundingBox:b,keypoints})=>({x:b.originX,y:b.originY,width:b.width,height:b.height,keypoints}));
    const face=[...faces].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    let quality={brightness:null,sharpness:null};
    if(face){
      const x=Math.max(0,face.x),y=Math.max(0,face.y),w=Math.min(face.width,width-x),h=Math.min(face.height,height-y);
      if(w>0&&h>0){context.drawImage(source,x,y,w,h,0,0,128,128);quality=faceImageQuality(context.getImageData(0,0,128,128).data,128,128);}
    }
    const scale=320/width;frame.width=320;frame.height=Math.round(height*scale);frameContext.drawImage(source,0,0,frame.width,frame.height);
    const smallFace=face?{x:face.x*scale,y:face.y*scale,width:face.width*scale,height:face.height*scale}:null;
    const documentBox=findSelfieDocument(frameContext.getImageData(0,0,frame.width,frame.height).data,frame.width,frame.height,smallFace);
    let documentSharpness=null;
    if(documentBox){
      const box=documentBox,pixels=frameContext.getImageData(box.x,box.y,box.width,box.height);
      documentSharpness=faceImageQuality(pixels.data,pixels.width,pixels.height).sharpness;
    }
    return {faces,width,height,documentVisible:Boolean(documentBox),documentSharpness,...quality};
  };
}
