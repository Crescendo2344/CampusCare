// Small motion helpers that make feedback feel physical. All respect prefers-reduced-motion through CSS.
const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A field shakes "no" after a wrong password or another rejected value.
export function shake(el){
  if(!el)return;
  el.classList.remove('cc-shake');void el.offsetWidth;el.classList.add('cc-shake');
  el.addEventListener('animationend',()=>el.classList.remove('cc-shake'),{once:true});
}

// A quick pop on something that just succeeded.
export function pop(el){
  if(!el)return;
  el.classList.remove('cc-pop');void el.offsetWidth;el.classList.add('cc-pop');
  el.addEventListener('animationend',()=>el.classList.remove('cc-pop'),{once:true});
}

// Removing an item: it fades, then the gap closes smoothly before `done` runs (for example a re-render).
export function collapseOut(el,done=()=>{}){
  if(!el||reduced()){el?.remove();done();return;}
  el.style.maxHeight=el.offsetHeight+'px';void el.offsetWidth;
  el.classList.add('cc-collapse');
  let finished=false;
  const finish=()=>{if(finished)return;finished=true;el.remove();done();};
  el.addEventListener('transitionend',event=>{if(event.propertyName==='max-height')finish();});
  setTimeout(finish,520);
}

// Segmented tabs: a pill slides from the old choice to the new one, even when the tabs are re-rendered.
const PILL_HOSTS='.appt-views,.he-status,.audit-chips';
const lastPill=new Map();
const pillKey=host=>host.id||`${host.className.replace(/\s*cc-pill-host/,'')}:${[...document.querySelectorAll(PILL_HOSTS)].indexOf(host)}`;
function placePill(host){
  let pill=host.querySelector(':scope>.cc-pill');
  const fresh=!pill;
  if(fresh){pill=document.createElement('span');pill.className='cc-pill';pill.setAttribute('aria-hidden','true');host.prepend(pill);host.classList.add('cc-pill-host');}
  const active=host.querySelector(':scope>.active,:scope>[aria-selected="true"]');
  if(!active||!active.offsetWidth){pill.style.opacity='0';return;}
  const next={x:active.offsetLeft,y:active.offsetTop,w:active.offsetWidth,h:active.offsetHeight,r:getComputedStyle(active).borderTopLeftRadius};
  const key=pillKey(host),prev=lastPill.get(key);
  const apply=p=>{pill.style.width=p.w+'px';pill.style.height=p.h+'px';pill.style.transform=`translate(${p.x}px,${p.y}px)`;pill.style.borderRadius=p.r;pill.style.opacity='1';};
  if(fresh&&prev&&!reduced()){
    pill.style.transition='none';apply(prev);void pill.offsetWidth;pill.style.transition='';
    requestAnimationFrame(()=>apply(next));
  }else apply(next);
  lastPill.set(key,next);
}
function refreshPills(){for(const host of document.querySelectorAll(PILL_HOSTS))placePill(host);}

export function enableMotion(root=document.body){
  refreshPills();
  let queued=false;
  new MutationObserver(records=>{
    // Ignore the pill's own insertion and style changes.
    if(records.every(r=>[...r.addedNodes].every(n=>n.classList?.contains('cc-pill'))&&r.type==='childList'&&!r.removedNodes.length))return;
    if(queued)return;queued=true;
    requestAnimationFrame(()=>{queued=false;refreshPills();});
  }).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-selected']});
  window.addEventListener('resize',refreshPills);
}
