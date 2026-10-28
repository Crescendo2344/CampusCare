// Shared table paging: each list keeps its own page, which resets when its filters change.
import {bindAction} from './events.js';

const state=new Map();

export function paginate(key,list,{size=10,signature=''}={}){
  let entry=state.get(key);
  if(!entry||entry.signature!==signature){entry={page:1,signature};state.set(key,entry);}
  const pages=Math.max(1,Math.ceil(list.length/size));
  entry.page=Math.min(Math.max(1,entry.page),pages);
  const first=(entry.page-1)*size;
  return {key,rows:list.slice(first,first+size),page:entry.page,pages,first,total:list.length,size};
}

export function pagerHtml(p,rerender){
  if(p.total<=p.size)return '';
  const go=step=>()=>{state.get(p.key).page+=step;rerender();};
  return `<div class="pt-pager"><span>Showing ${p.first+1}–${p.first+p.rows.length} of ${p.total}</span><div>
    <button type="button" class="btn btn-xs" ${p.page===1?'disabled':''} ${bindAction('click',go(-1))}>‹ Previous</button>
    <span class="audit-page">Page ${p.page} of ${p.pages}</span>
    <button type="button" class="btn btn-xs" ${p.page===p.pages?'disabled':''} ${bindAction('click',go(1))}>Next ›</button></div></div>`;
}
