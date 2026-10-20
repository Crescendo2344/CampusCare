import {faceImageQuality as imageQuality} from './selfie-guidance.js';
// Find a strong rectangular boundary. This estimates framing, not document type or authenticity.
export function detectIdBoundary(pixels,width,height){
  const gray=new Float32Array(width*height),edge=new Uint8Array(width*height),mask=new Uint8Array(width*height);
  for(let i=0;i<gray.length;i++)gray[i]=.2126*pixels[i*4]+.7152*pixels[i*4+1]+.0722*pixels[i*4+2];
  let sum=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,g=Math.min(255,Math.abs(gray[i+1]-gray[i-1])+Math.abs(gray[i+width]-gray[i-width]));edge[i]=g;sum+=g;
  }
  const threshold=Math.max(22,sum/(width*height)*2.5);
  // Connect nearby edge fragments without joining unrelated text across the whole frame.
  for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++)if(edge[y*width+x]>threshold){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)mask[(y+dy)*width+x+dx]=1;}
  const queue=new Int32Array(width*height);let best=null,bestScore=0;
  for(let start=0;start<mask.length;start++){
    if(!mask[start])continue;let head=0,tail=1,minX=width,maxX=0,minY=height,maxY=0;queue[0]=start;mask[start]=0;
    while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const next of [x?i-1:-1,x<width-1?i+1:-1,y?i-width:-1,y<height-1?i+width:-1])if(next>=0&&mask[next]){mask[next]=0;queue[tail++]=next;}
    }
    const w=maxX-minX+1,h=maxY-minY+1,ratio=w/h;
    if(w<width*.12||h<height*.12||ratio<.45||ratio>2.2)continue;
    const support=(horizontal,pos,from,to)=>{let hits=0;for(let n=from;n<=to;n++){let found=false;for(let d=-3;d<=3;d++){const x=horizontal?n:pos+d,y=horizontal?pos+d:n;if(x>=0&&y>=0&&x<width&&y<height&&edge[y*width+x]>threshold)found=true;}if(found)hits++;}return hits/Math.max(1,to-from+1);};
    const sides=[support(true,minY,minX,maxX),support(true,maxY,minX,maxX),support(false,minX,minY,maxY),support(false,maxX,minY,maxY)];
    if(Math.min(...sides)<.3)continue;
    const coverage=sides.reduce((a,b)=>a+b,0)/4,score=coverage*Math.sqrt(w*h/(width*height));
    if(score>bestScore){bestScore=score;best={x:minX,y:minY,width:w,height:h};}
  }
  return best;
}

export function assessIdFrame({box,width,height,brightness=null,sharpness=null}){
  const result=(code,message,ready=false)=>({code,message,ready});
  if(!box)return result('missing','Place the ID inside the rectangle, with all four corners visible');
  const w=box.width/width,h=box.height/height,cx=(box.x+box.width/2)/width,cy=(box.y+box.height/2)/height;
  if(Math.max(w,h)<.55)return result('far','Move the ID closer to the camera');
  if(w>.94||h>.94)return result('close','Move the ID back a little');
  if(box.x<width*.025||box.y<height*.025||box.x+box.width>width*.975||box.y+box.height>height*.975)return result('cropped','Keep all four ID corners inside the frame');
  if(Math.abs(cx-.5)>.12||Math.abs(cy-.5)>.12)return result('center','Center the ID inside the rectangle');
  if(brightness!==null&&brightness<48)return result('dark','Improve the lighting on the ID');
  if(brightness!==null&&brightness>230)return result('glare','Reduce glare or strong light on the ID');
  if(sharpness!==null&&sharpness<18)return result('blur','Hold the ID still and clean the camera lens');
  return result('ready','Good framing — keep the ID still',true);
}

export function analyzeIdPixels(pixels,width,height){
  const box=detectIdBoundary(pixels,width,height);let quality={brightness:null,sharpness:null};
  if(box){
    const crop=new Uint8ClampedArray(box.width*box.height*4);
    for(let y=0;y<box.height;y++)crop.set(pixels.subarray(((box.y+y)*width+box.x)*4,((box.y+y)*width+box.x+box.width)*4),y*box.width*4);
    quality=imageQuality(crop,box.width,box.height);
  }
  return {box,width,height,...quality,...assessIdFrame({box,width,height,...quality})};
}
