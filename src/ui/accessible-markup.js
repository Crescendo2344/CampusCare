// Small fixes applied to markup as it appears, so every screen gets them without per-form code.
// 1. Many forms write <label>Text</label><input> side by side inside a .form-group. Screen readers only
//    announce a label that is tied to its control, so each such label is linked to the first control in
//    its group. Labels that already wrap or point at a control are left alone.
// 2. Rows, cards and avatars that open something on click also become reachable with Tab and work with
//    Enter or Space, like a button.
const CONTROLS='input:not([type=hidden]),select,textarea';
const NATIVE='a[href],button,input,select,textarea,summary,label,[tabindex]';
let generated=0;
export function linkFormLabels(root=document){
  for(const label of root.querySelectorAll?.('.form-group label:not([for])')||[]){
    if(label.querySelector(CONTROLS))continue;
    const control=label.closest('.form-group')?.querySelector(CONTROLS);
    if(!control||control.closest('label'))continue;
    if(!control.id)control.id=`cc-field-${++generated}`;
    if(document.querySelectorAll(`[for="${CSS.escape(control.id)}"]`).length)continue;
    label.htmlFor=control.id;
  }
}
// Wrappers such as .td-actions only stop a row's click from firing behind their buttons.
const isClickTarget=el=>!el.matches(NATIVE)&&!el.closest('[aria-hidden="true"]')&&!el.closest('a[href],button,label')&&!el.classList.contains('td-actions');
export function focusClickables(root=document){
  const found=[...(root.querySelectorAll?.('[data-action-click]')||[])];
  if(root.matches?.('[data-action-click]'))found.push(root);
  for(const el of found)if(isClickTarget(el))el.tabIndex=0;
}
function activateWithKeyboard(event){
  if(event.key!=='Enter'&&event.key!==' ')return;
  const el=event.target;
  // Elements with their own key handling (cards, list items) already respond to Enter.
  if(!(el instanceof HTMLElement)||!el.hasAttribute('data-action-click')||el.hasAttribute('data-action-keydown'))return;
  if(el.matches('a,button,input,select,textarea,summary'))return;
  event.preventDefault();
  el.click();
}
export function enhanceMarkup(root=document.body){
  const apply=node=>{linkFormLabels(node);focusClickables(node);};
  apply(root);
  new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)apply(node.parentElement||node);
  }).observe(root,{childList:true,subtree:true});
  document.addEventListener('keydown',activateWithKeyboard);
}
