import {detectIdBoundary} from './id-guidance.js';
// A local framing heuristic, not document recognition or an authenticity/identity decision.
// Search beside the main face so face edges and shirt collars cannot satisfy the ID requirement.
export function findSelfieDocument(pixels,width,height,face){
  if(!face)return null;
  const gap=Math.max(3,Math.round(width*.015));
  const regions=[{x:0,width:Math.floor(face.x-gap)},{x:Math.ceil(face.x+face.width+gap),width:width-Math.ceil(face.x+face.width+gap)}];
  for(const region of regions){
    if(region.width<width*.13)continue;
    const crop=new Uint8ClampedArray(region.width*height*4);
    for(let y=0;y<height;y++)crop.set(pixels.subarray((y*width+region.x)*4,(y*width+region.x+region.width)*4),y*region.width*4);
    const box=detectIdBoundary(crop,region.width,height);
    if(!box)continue;
    const ratio=box.width/box.height,area=box.width*box.height/(width*height);
    if(ratio<.48||ratio>2||area<.018||area>.26||box.y+box.height<face.y||box.y>face.y+face.height*1.8)continue;
    // Require interior detail as well as a boundary; a blank wall/paper rectangle is insufficient.
    let detail=0,count=0;
    const margin=Math.max(4,Math.round(Math.min(box.width,box.height)*.12));
    for(let y=box.y+margin;y<box.y+box.height-margin;y++)for(let x=box.x+margin;x<box.x+box.width-margin;x++){
      const i=(y*region.width+x)*4,j=i+4,k=i+region.width*4;
      if(Math.abs(crop[i]-crop[j])+Math.abs(crop[i+1]-crop[j+1])+Math.abs(crop[i+2]-crop[j+2])+Math.abs(crop[i]-crop[k])+Math.abs(crop[i+1]-crop[k+1])+Math.abs(crop[i+2]-crop[k+2])>75)detail++;
      count++;
    }
    if(count&&detail/count>=.025)return {...box,x:box.x+region.x};
  }
  return null;
}
