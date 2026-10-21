// Retry unsupported constraints, but never hide a denied permission behind repeated prompts.
export async function requestCamera(mediaDevices,front){
 if(!mediaDevices?.getUserMedia)throw Object.assign(new Error('Camera unavailable'),{name:'NotSupportedError'});
 const attempts=[{facingMode:{ideal:front?'user':'environment'},width:{ideal:1280},height:{ideal:960}},{facingMode:{ideal:front?'user':'environment'}},true];
 for(let index=0;index<attempts.length;index++){
  try{return await mediaDevices.getUserMedia({video:attempts[index],audio:false});}
  catch(error){if(!['OverconstrainedError','ConstraintNotSatisfiedError','NotFoundError','NotReadableError','AbortError'].includes(error.name)||index===attempts.length-1)throw error;}
 }
}
export function cameraStartupMessage(error){
 if(['NotAllowedError','PermissionDeniedError','SecurityError'].includes(error?.name))return 'Camera access was blocked. Allow camera access in this site’s settings. If you opened CampusCare inside Messenger or Facebook, open it in Safari or Chrome and retry.';
 if(['NotReadableError','AbortError'].includes(error?.name))return 'The camera is busy. Close other camera apps or tabs, then retry.';
 if(['NotFoundError','NotSupportedError'].includes(error?.name))return 'No usable camera was found. Open CampusCare in Safari or Chrome on a device with a camera.';
 return 'The camera could not start. Close this window and retry, or open CampusCare directly in Safari or Chrome.';
}
