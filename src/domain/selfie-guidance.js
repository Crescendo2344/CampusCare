// Position thresholds describe this document-holding frame, not biometric identity or liveness.
export function assessSelfieFrame({faces=[],width,height,brightness=null,sharpness=null}){
  const result=(code,message,ready=false)=>({code,message,ready});
  if(!width||!height)return result('waiting','Starting camera…');
  const sorted=faces.filter(face=>face.width>0&&face.height>0).sort((a,b)=>b.width*b.height-a.width*a.height);
  if(!sorted.length)return result('no-face','Position your face inside the oval');
  const face=sorted[0],area=face.width*face.height;
  // Ignore a small printed ID portrait; another similarly sized person still needs to leave the frame.
  if(sorted.slice(1).some(other=>other.width*other.height>area*.4))return result('multiple','Only one person should be in the frame');
  const w=face.width/width,h=face.height/height,x=(face.x+face.width/2)/width,y=(face.y+face.height/2)/height;
  if(w<.19||h<.24)return result('far','Move closer to the camera');
  if(w>.43||h>.62)return result('close','Move back a little');
  if(face.x<width*.015||face.y<height*.015||face.x+face.width>width*.985||face.y+face.height>height*.985)return result('cropped','Keep your whole face inside the frame');
  if(Math.abs(x-.5)>.12||Math.abs(y-.35)>.14)return result('center','Center your face inside the oval');
  if(brightness!==null&&brightness<48)return result('dark','Move to brighter, even lighting');
  if(brightness!==null&&brightness>225)return result('bright','Reduce strong light on your face');
  if(sharpness!==null&&sharpness<18)return result('blur','Hold still and clean the camera lens');
  if(face.keypoints?.length>=3){
    const [a,b,nose]=face.keypoints,eyeDistance=Math.abs(a.x-b.x);
    if(eyeDistance&&Math.abs(a.y-b.y)/eyeDistance>.28)return result('tilt','Keep your head upright');
    if(eyeDistance&&Math.abs(nose.x-(a.x+b.x)/2)/eyeDistance>.32)return result('forward','Look straight at the camera');
  }
  return result('ready','Good position — keep your document visible',true);
}

// Measure only the face crop so a bright wall cannot hide an underlit face.
export function faceImageQuality(pixels,width,height){
  const gray=new Float32Array(width*height);let sum=0;
  for(let i=0;i<gray.length;i++){gray[i]=.2126*pixels[i*4]+.7152*pixels[i*4+1]+.0722*pixels[i*4+2];sum+=gray[i];}
  let lapSum=0,lapSquared=0,count=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,value=gray[i-1]+gray[i+1]+gray[i-width]+gray[i+width]-4*gray[i];lapSum+=value;lapSquared+=value*value;count++;
  }
  return {brightness:sum/Math.max(1,gray.length),sharpness:count?Math.max(0,lapSquared/count-(lapSum/count)**2):0};
}
