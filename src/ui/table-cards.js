// On phones, page tables become cards instead of scrolling sideways:
// Rank   – the first column is the card's title;
// Slot   – a status badge sits in the card's top-right corner;
// Label  – every other value is labelled with its column header;
// Stack  – action buttons sit together at the bottom of the card;
// Reveal – wide tables show their first few fields, the rest behind "More details";
// Breakpoint – CSS switches the layout on at 640px, so desktop tables are unchanged.
const SHOWN_FIELDS=4;
const SKIP='.dsb-table,[data-cards="off"]';

export function cardifyTable(table){
  if(!table.closest('#app-content')||table.matches(SKIP)||!table.tHead)return;
  const headers=[...table.tHead.querySelectorAll('th')].map(th=>th.textContent.trim());
  if(headers.length<3)return;
  table.classList.add('cc-cards');
  const statusCol=headers.findIndex(h=>/^status$/i.test(h));
  const wide=headers.length-1>SHOWN_FIELDS+1;
  for(const row of table.tBodies[0]?.rows||[]){
    if(row.dataset.cardified==='1'||row.cells.length<2)continue;
    row.dataset.cardified='1';
    let shown=0,hasExtra=false;
    [...row.cells].forEach((cell,i)=>{
      const label=headers[i]||'';
      if(label&&!cell.hasAttribute('data-label'))cell.setAttribute('data-label',label);
      if(i===0){cell.classList.add('cc-cell-title');return;}
      if(cell.querySelector('button,.td-actions,a.btn')&&!cell.querySelector('.badge')){cell.classList.add('cc-cell-actions');return;}
      if((i===statusCol||(statusCol<0&&cell.querySelector('.badge')))&&!row.querySelector('.cc-cell-slot')){cell.classList.add('cc-cell-slot');return;}
      if(!label)return;
      shown++;
      if(wide&&shown>SHOWN_FIELDS){cell.classList.add('cc-cell-extra');hasExtra=true;}
    });
    if(hasExtra){
      const more=row.insertCell(-1);more.className='cc-cell-more';
      const btn=document.createElement('button');btn.type='button';btn.className='btn btn-xs';btn.textContent='More details';
      btn.setAttribute('aria-expanded','false');
      btn.addEventListener('click',event=>{
        event.stopPropagation();
        const open=row.classList.toggle('cc-open');
        btn.textContent=open?'Fewer details':'More details';btn.setAttribute('aria-expanded',String(open));
      });
      more.append(btn);
    }
  }
}
