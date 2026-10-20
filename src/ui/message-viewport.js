// Size the whole messenger to the usable viewport, including in-app browsers and keyboards.
// The conversation scrolls internally; the composer stays in the final flex row.
export function fitMessageViewport(shell){
  const viewport=window.visualViewport;
  let frame=0,disposed=false;
  const update=()=>{
    frame=0;if(disposed)return;
    if(!shell.isConnected){dispose();return;}
    const bottom=(viewport?.offsetTop||0)+(viewport?.height||window.innerHeight);
    const height=Math.max(100,Math.floor(bottom-shell.getBoundingClientRect().top-10));
    if(shell.style.height!==height+'px')shell.style.height=height+'px';
  };
  const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(update);};
  const observer=new ResizeObserver(schedule);observer.observe(shell.parentElement);
  const removal=new MutationObserver(()=>{if(!shell.isConnected)dispose();else schedule();});
  removal.observe(shell.parentElement,{childList:true});
  removal.observe(shell,{attributes:true,attributeFilter:['class']});
  function dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();removal.disconnect();window.removeEventListener('resize',schedule);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);}
  window.addEventListener('resize',schedule);viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
  schedule();return dispose;
}
