// Position thresholds describe this document-holding frame, not biometric identity or liveness.
export function assessSelfieFrame({faces=[],width,height,brightness=null,sharpness=null,documentVisible=false,documentSharpness=null,guide=null}){
  const result=(code,message,ready=false)=>({code,message,ready});
  if(!width||!height)return result('waiting','Starting camera…');
  const sorted=faces.filter(face=>face.width>0&&face.height>0).sort((a,b)=>b.width*b.height-a.width*a.height);
  if(!sorted.length)return result('no-face','Position your face inside the face guide');
  const face=sorted[0],area=face.width*face.height;
  // Ignore a small printed ID portrait; another similarly sized person still needs to leave the frame.
  if(sorted.slice(1).some(other=>other.width*other.height>area*.4))return result('multiple','Only one person should be in the frame');
  const w=face.width/width,h=face.height/height,x=(face.x+face.width/2)/width,y=(face.y+face.height/2)/height;
  // Leave room beside the face for the held ID on landscape and portrait cameras.
  const oval=guide?.face;
  if(oval?.w>0&&oval?.h>0){
    // Judge against the oval actually drawn on screen, so a face in a corner never passes.
    if(w<oval.w*.42)return result('far','Move closer so your face fills the oval');
    if(w>oval.w*1.15||h>oval.h*1.1)return result('close','Move back a little so your face fits the oval');
    if(face.x<width*.015||face.y<height*.015||face.x+face.width>width*.985||face.y+face.height>height*.985)return result('cropped','Keep your whole face inside the frame');
    // The detector's box spans eyes to mouth, which sits slightly below the middle of a framed head.
    const dx=(x-(oval.x+oval.w/2))/(oval.w/2),dy=(y-(oval.y+oval.h*.55))/(oval.h/2);
    if(dx*dx+dy*dy>.35*.35)return result('center','Move your face into the oval');
  }else{
    if(w<.12||h<.18)return result('far','Move closer to the camera');
    if(w>.72||h>.78)return result('close','Move back a little');
    if(face.x<width*.015||face.y<height*.015||face.x+face.width>width*.985||face.y+face.height>height*.985)return result('cropped','Keep your whole face inside the frame');
    if(Math.abs(x-.5)>.32||Math.abs(y-.48)>.32)return result('center','Center your face inside the face guide');
  }
  if(brightness!==null&&brightness<32)return result('dark','Move to brighter, even lighting');
  if(brightness!==null&&brightness>240)return result('bright','Reduce strong light on your face');
  if(sharpness!==null&&sharpness<7)return result('blur','Hold still and clean the camera lens');
  if(!documentVisible)return result('document',guide?.document?'Hold the front of your ID inside the ID box, with all corners visible':'Hold the front of your ID beside your face, with all corners visible');
  if(documentSharpness!==null&&documentSharpness<4)return result('document-blur','Hold your ID still so its details are visible');
  return result('ready','Good position — keep your ID visible',true);
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
