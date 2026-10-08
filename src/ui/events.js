// Delegated listeners support dynamically rendered pages without inline JavaScript or eval.
const callbacks=new Map();
let nextId=0;
export function registerNamedAction(id,callback){callbacks.set(id,{callback,persistent:true});}
export function bindAction(type,callback){
  const id=`action-${++nextId}`;
  callbacks.set(id,{callback,persistent:false,seen:false});
  return `data-action-${type}="${id}"`;
}
export function installActionEvents(root=document){
  const types=['click','dblclick','change','input','keydown','keyup','submit','focus','blur','error','load','mouseover','mouseout','mouseenter','mouseleave'];
  const cleanups=[];
  for(const type of types){
    const listener=event=>{
      const attribute=`data-action-${type}`;
      let element=event.target;
      while(element&&element!==root){
        const id=element.getAttribute?.(attribute),entry=id&&callbacks.get(id);
        if(entry){
          try{
            const result=entry.callback(event,element);
            if(result===false)event.preventDefault();
            if(result?.catch)result.catch(error=>console.error('CampusCare action failed:',error));
          }catch(error){console.error('CampusCare action failed:',error);}
        }
        if(event.cancelBubble)break;
        element=element.parentElement;
      }
    };
    root.addEventListener(type,listener,true);
    cleanups.push(()=>root.removeEventListener(type,listener,true));
  }
  // Release closures for discarded page markup. Persistent shell actions remain registered.
  let timer;
  const observer=new MutationObserver(()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{
      const present=new Set();
      for(const element of root.querySelectorAll('*'))for(const attribute of element.attributes)if(attribute.name.startsWith('data-action-'))present.add(attribute.value);
      for(const [id,entry]of callbacks){
        if(present.has(id))entry.seen=true;
        else if(!entry.persistent&&entry.seen)callbacks.delete(id);
      }
    },500);
  });
  observer.observe(root,{childList:true,subtree:true});
  return ()=>{clearTimeout(timer);observer.disconnect();cleanups.forEach(cleanup=>cleanup());};
}
