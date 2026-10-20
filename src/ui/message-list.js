// Keep unchanged message nodes alive so refreshes do not interrupt reading, editing or playback.
export function messageVersion(message){
  const attachment=message.attachment?{...message.attachment,dataUrl:String(message.attachment.dataUrl||'').split('?')[0]}:null;
  return JSON.stringify([message.message,message.deleted,message.edited,message.forwarded,message.createdAt,attachment]);
}
export function reconcileMessages(wrap,messages,createRow,{force=false,scrollToEnd=false}={}){
  const initial=wrap.dataset.initialized!=='true';
  const top=wrap.scrollTop,nearBottom=wrap.scrollHeight-wrap.clientHeight-top<70;
  const anchor=[...wrap.children].find(row=>row.getBoundingClientRect().bottom>wrap.getBoundingClientRect().top);
  const anchorId=anchor?.dataset.msgId,anchorOffset=anchor?anchor.getBoundingClientRect().top-wrap.getBoundingClientRect().top:0;
  const existing=new Map([...wrap.children].map(row=>[row.dataset.msgId,row]));
  let cursor=wrap.firstElementChild;
  for(const message of messages){
    const id=String(message.id),version=messageVersion(message);
    let row=existing.get(id);existing.delete(id);
    // Read receipts are updated independently; they must not recreate an audio player.
    if(!row||force||(!row.querySelector('textarea')&&row.dataset.version!==version)){
      const next=createRow(message);next.dataset.msgId=id;next.dataset.version=version;
      if(row){row.querySelectorAll('audio').forEach(audio=>audio.pause());row.replaceWith(next);if(cursor===row)cursor=next;}
      row=next;
    }
    const audio=row.querySelector('audio');if(audio&&message.attachment?.dataUrl)audio.dataset.latestSrc=message.attachment.dataUrl;
    const time=row.querySelector('.msgr-bubble-time');
    if(time&&message._timeLabel!==undefined&&time.textContent!==message._timeLabel)time.textContent=message._timeLabel;
    if(row!==cursor)wrap.insertBefore(row,cursor);cursor=row.nextElementSibling;
  }
  for(const row of existing.values()){row.querySelectorAll('audio').forEach(audio=>audio.pause());row.remove();}
  wrap.dataset.initialized='true';
  // Follow new messages only when already at the bottom; otherwise preserve the visible reading anchor.
  if(initial||nearBottom||scrollToEnd)wrap.scrollTop=wrap.scrollHeight;
  else{const kept=[...wrap.children].find(row=>row.dataset.msgId===anchorId);wrap.scrollTop=kept?wrap.scrollTop+kept.getBoundingClientRect().top-wrap.getBoundingClientRect().top-anchorOffset:top;}
}
