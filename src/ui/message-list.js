// Keep unchanged message nodes alive so refreshes do not interrupt reading, editing or playback.
export function messageVersion(message){
  const attachment=message.attachment?{...message.attachment,dataUrl:String(message.attachment.dataUrl||'').split('?')[0]}:null;
  return JSON.stringify([message.message,message.deleted,message.edited,message.forwarded,message.createdAt,attachment]);
}
// Remember whether the person scrolled up; late media/layout changes must not silently unpin the latest message.
const scrollControllers=new WeakMap();
export function watchMessageScroll(wrap){
  if(scrollControllers.has(wrap))return scrollControllers.get(wrap);
  const win=wrap.ownerDocument.defaultView;let following=true,intentUntil=0,frame,disposed=false;
  const bottom=()=>wrap.scrollHeight-wrap.clientHeight-wrap.scrollTop<70;
  const pin=()=>{if(following&&!disposed)wrap.scrollTop=wrap.scrollHeight;};
  const schedule=()=>{pin();if(win.requestAnimationFrame){win.cancelAnimationFrame(frame);frame=win.requestAnimationFrame(pin);}};
  const intent=()=>{intentUntil=Date.now()+1200;};
  const scroll=()=>{if(bottom())following=true;else if(Date.now()<intentUntil)following=false;};
  for(const event of ['wheel','touchstart','pointerdown','keydown'])wrap.addEventListener(event,intent,{passive:true});
  wrap.addEventListener('scroll',scroll,{passive:true});
  const observed=new Set(),resize=win.ResizeObserver?new win.ResizeObserver(schedule):null;
  resize?.observe(wrap);
  const cleanup=()=>{disposed=true;resize?.disconnect();detach?.disconnect();win.cancelAnimationFrame?.(frame);};
  const detach=win.MutationObserver?new win.MutationObserver(()=>{if(!wrap.isConnected)cleanup();}):null;
  detach?.observe(wrap.ownerDocument.body,{childList:true,subtree:true});
  const controller={get following(){return following;},follow(){following=true;schedule();},observe(){
    const current=new Set(wrap.children);for(const node of observed)if(!current.has(node)){resize?.unobserve(node);observed.delete(node);}
    for(const node of current)if(!observed.has(node)){resize?.observe(node);observed.add(node);}
  }};
  scrollControllers.set(wrap,controller);return controller;
}
export function reconcileMessages(wrap,messages,createRow,{force=false,scrollToEnd=false}={}){
  const initial=wrap.dataset.initialized!=='true',tracking=watchMessageScroll(wrap);
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
  tracking.observe();
  if(initial||nearBottom||scrollToEnd||tracking.following)tracking.follow();
  else{const kept=[...wrap.children].find(row=>row.dataset.msgId===anchorId);wrap.scrollTop=kept?wrap.scrollTop+kept.getBoundingClientRect().top-wrap.getBoundingClientRect().top-anchorOffset:top;}
}
