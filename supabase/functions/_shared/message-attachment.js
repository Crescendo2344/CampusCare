// FileReader preserves codec parameters on mobile recordings; storage needs the base MIME type.
export function parseMessageDataUrl(value){
  const text=String(value||'');
  if(text.length>Math.ceil(5*1024*1024/3)*4+512)throw new Error('Attachment exceeds the 5 MB limit.');
  const match=text.match(/^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)((?:;[a-z0-9_-]+=(?:[a-z0-9_.+\/-]+|"[a-z0-9_.+, /-]+"))*);base64,([A-Za-z0-9+/]*={0,2})$/i);
  if(!match||!match[3])throw new Error('Invalid attachment data.');
  let binary;try{binary=atob(match[3]);}catch{throw new Error('Invalid attachment data.');}
  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
  if(bytes.byteLength>5*1024*1024)throw new Error('Attachment exceeds the 5 MB limit.');
  return {mime:match[1].toLowerCase(),bytes};
}
