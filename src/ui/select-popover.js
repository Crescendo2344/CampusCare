// Long dropdowns open as a short, scrollable list instead of the browser's full-height list.
// The native <select> stays in place and keeps its value, events and keyboard behaviour; only the
// mouse-opened list is replaced, and only on pointer devices (phones keep their native picker).
const LIMIT=8;
let open=null;

const isLong=el=>el instanceof HTMLSelectElement&&!el.multiple&&el.size<=1&&!el.disabled&&el.options.length>LIMIT;

function close(focusSelect=false){
  if(!open)return;
  const {list,select,cleanup}=open;
  open=null;cleanup();list.remove();
  select.setAttribute('aria-expanded','false');
  if(focusSelect)select.focus({preventScroll:true});
}

function choose(select,index){
  if(select.selectedIndex!==index){
    select.selectedIndex=index;
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  close(true);
}

function place(list,select){
  const box=select.getBoundingClientRect(),gap=4,margin=8;
  const below=innerHeight-box.bottom-margin,above=box.top-margin;
  const upward=below<220&&above>below;
  const room=Math.max(140,Math.min(300,(upward?above:below)-gap));
  list.style.maxHeight=room+'px';
  list.style.minWidth=box.width+'px';
  list.style.left=Math.max(margin,Math.min(box.left,innerWidth-Math.max(box.width,list.offsetWidth)-margin))+'px';
  list.style.top=upward?'':(box.bottom+gap)+'px';
  list.style.bottom=upward?(innerHeight-box.top+gap)+'px':'';
}

function openList(select){
  close();
  const list=document.createElement('div');
  list.className='select-popover';list.setAttribute('role','listbox');list.tabIndex=-1;
  if(select.id)list.setAttribute('aria-labelledby',select.id);
  let active=Math.max(0,select.selectedIndex);
  const items=[];
  const addOption=(option,index)=>{
    const item=document.createElement('div');
    item.className='select-popover-option';item.setAttribute('role','option');
    item.textContent=option.textContent;item.dataset.index=String(index);
    if(option.disabled)item.setAttribute('aria-disabled','true');
    if(index===select.selectedIndex)item.setAttribute('aria-selected','true');
    if(option.parentElement?.tagName==='OPTGROUP')item.classList.add('grouped');
    items[index]=item;list.append(item);
  };
  let index=0;
  for(const child of select.children){
    if(child.tagName==='OPTGROUP'){
      const head=document.createElement('div');head.className='select-popover-group';head.textContent=child.label;head.setAttribute('role','presentation');list.append(head);
      for(const option of child.children)addOption(option,index++);
    }else addOption(child,index++);
  }
  const highlight=i=>{
    items[active]?.classList.remove('active');
    active=Math.max(0,Math.min(items.length-1,i));
    items[active]?.classList.add('active');
    items[active]?.scrollIntoView({block:'nearest'});
  };
  list.addEventListener('mousedown',event=>event.preventDefault());
  list.addEventListener('click',event=>{
    const item=event.target.closest('.select-popover-option');
    if(item&&item.getAttribute('aria-disabled')!=='true')choose(select,Number(item.dataset.index));
  });
  list.addEventListener('mousemove',event=>{const item=event.target.closest('.select-popover-option');if(item)highlight(Number(item.dataset.index));});
  let typed='',typedTimer=0;
  const onKey=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
    else if(event.key==='ArrowDown'){event.preventDefault();highlight(active+1);}
    else if(event.key==='ArrowUp'){event.preventDefault();highlight(active-1);}
    else if(event.key==='Home'){event.preventDefault();highlight(0);}
    else if(event.key==='End'){event.preventDefault();highlight(items.length-1);}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(select,active);}
    else if(event.key==='Tab')close();
    else if(event.key.length===1){
      typed+=event.key.toLowerCase();clearTimeout(typedTimer);typedTimer=setTimeout(()=>{typed='';},600);
      const found=items.findIndex(item=>item.textContent.trim().toLowerCase().startsWith(typed));
      if(found>=0)highlight(found);
    }
  };
  const outside=event=>{if(!list.contains(event.target)&&event.target!==select)close();};
  const reposition=event=>{if(event?.target&&list.contains(event.target))return;close();};
  document.addEventListener('keydown',onKey,true);
  document.addEventListener('mousedown',outside,true);
  addEventListener('resize',reposition);
  document.addEventListener('scroll',reposition,true);
  document.body.append(list);
  place(list,select);
  highlight(active);
  select.setAttribute('aria-expanded','true');
  open={list,select,cleanup:()=>{document.removeEventListener('keydown',onKey,true);document.removeEventListener('mousedown',outside,true);removeEventListener('resize',reposition);document.removeEventListener('scroll',reposition,true);}};
}

export function installSelectPopover(root=document){
  if(!matchMedia('(pointer: fine)').matches)return ()=>{};
  const onDown=event=>{
    const select=event.target;
    if(event.button!==0||!isLong(select))return;
    event.preventDefault();
    if(open?.select===select){close(true);return;}
    select.focus({preventScroll:true});
    openList(select);
  };
  root.addEventListener('mousedown',onDown,true);
  return ()=>{root.removeEventListener('mousedown',onDown,true);close();};
}
