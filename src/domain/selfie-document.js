import {detectIdBoundary} from './id-guidance.js';
// A local framing heuristic, not document recognition or an authenticity/identity decision.
// Search beside the main face so face edges and shirt collars cannot satisfy the ID requirement.
// With an on-screen ID guide (`zone`, in frame pixels) only a card held inside that guide counts.
export function findSelfieDocument(pixels,width,height,face,zone=null){
  if(!face)return null;
  const gap=-Math.round(face.width*.18);
  let regions=[{x:0,width:Math.floor(face.x-gap)},{x:Math.ceil(face.x+face.width+gap),width:width-Math.ceil(face.x+face.width+gap)}];
  if(zone){
    const left=Math.max(0,Math.floor(zone.x-zone.width*.2)),right=Math.min(width,Math.ceil(zone.x+zone.width*1.2));
    regions=[{x:left,width:right-left}];
  }
  for(const region of regions){
    if(region.width<width*.13)continue;
    const crop=new Uint8ClampedArray(region.width*height*4);
    for(let y=0;y<height;y++)crop.set(pixels.subarray((y*width+region.x)*4,(y*width+region.x+region.width)*4),y*region.width*4);
    // Filter each candidate before ranking it: a large bed/window must not hide the smaller held card.
    const box=detectIdBoundary(crop,region.width,height,{connect:0,minimumSides:3,acceptBox:box=>{
      const ratio=box.width/box.height,area=box.width*box.height/(width*height);
      const overlap=Math.max(0,Math.min(box.y+box.height,face.y+face.height)-Math.max(box.y,face.y));
      if(ratio<.45||ratio>2.1||area<.008||area>.26||box.height>face.height*1.55||box.width*box.height>face.width*face.height*1.7)return false;
      if(zone){
        // The card must sit in the ID guide, fill a fair part of it, and stay clear of the face.
        const cx=box.x+region.x+box.width/2,cy=box.y+box.height/2;
        if(cx<zone.x||cx>zone.x+zone.width||cy<zone.y||cy>zone.y+zone.height)return false;
        if(box.width*box.height<zone.width*zone.height*.2)return false;
        const fx=Math.max(0,Math.min(box.x+region.x+box.width,face.x+face.width)-Math.max(box.x+region.x,face.x));
        if(fx*overlap>box.width*box.height*.2)return false;
      }else if(overlap<Math.min(face.height,box.height)*.3)return false;
      // Interior print/detail is still required; blank paper or a plain wall cannot unlock capture.
      let detail=0,count=0;
      const margin=Math.max(3,Math.round(Math.min(box.width,box.height)*.12));
      for(let y=box.y+margin;y<box.y+box.height-margin;y++)for(let x=box.x+margin;x<box.x+box.width-margin;x++){
        const i=(y*region.width+x)*4,j=i+4,k=i+region.width*4;
        if(Math.abs(crop[i]-crop[j])+Math.abs(crop[i+1]-crop[j+1])+Math.abs(crop[i+2]-crop[j+2])+Math.abs(crop[i]-crop[k])+Math.abs(crop[i+1]-crop[k+1])+Math.abs(crop[i+2]-crop[k+2])>40)detail++;
        count++;
      }
      return count>0&&detail/count>=(zone?.02:.012);
    }});
    if(box)return {...box,x:box.x+region.x};
  }
  return null;
}
