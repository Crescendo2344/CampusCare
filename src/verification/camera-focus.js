// Capability detection keeps unsupported focus controls from blocking capture on older cameras.
export function cameraFocus(track){
  let capabilities={};try{capabilities=track?.getCapabilities?.()||{};}catch{}
  const supported=Boolean(track?.applyConstraints&&capabilities.focusMode?.includes('continuous'));
  const refocus=async()=>{if(!supported)return false;try{await track.applyConstraints({...track.getConstraints?.(),advanced:[{focusMode:'continuous'}]});return true;}catch{return false;}};
  return {supported,refocus};
}
