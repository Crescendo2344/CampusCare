// theme: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {persistDB} from './persistence.js';
import {closeAllModals,openModal} from './modals.js';
import {escapeHtml} from './issueReports.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// THEME (light / dark)
// ================================================================

export function automaticThemeForLocalTime(date=new Date()){
  try{
    const hour=date.getHours();
    return (hour>=18||hour<6)?'dark':'light';
  }catch(_){
    return 'light';
  }
}

export function currentThemeOverride(){
  return appState.theme.campusThemeManualOverride;
}

export function applyThemeIcons(){
  const dark=document.documentElement.getAttribute('data-theme')==='dark';
  ['theme-icon-moon','auth-theme-icon-moon'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=dark?'none':'';
  });
  ['theme-icon-sun','auth-theme-icon-sun'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=dark?'':'none';
  });

  const auto=!currentThemeOverride();
  ['theme-toggle-btn','auth-theme-toggle-btn'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.title=auto
      ? `Appearance follows local time (${dark?'Dark':'Light'} now). Click to temporarily override.`
      : `Temporary ${dark?'Dark':'Light'} override. Reload CampusCare to return to automatic appearance.`;
  });
}

export function setTheme(mode,{manual=false}={}){
  const next=mode==='dark'?'dark':'light';
  if(next==='dark')document.documentElement.setAttribute('data-theme','dark');
  else document.documentElement.removeAttribute('data-theme');
  if(manual)appState.theme.campusThemeManualOverride=next;
  applyThemeIcons();
}

export function applyAutomaticTheme(){
  if(currentThemeOverride())return;
  setTheme(automaticThemeForLocalTime(),{manual:false});
}

export function toggleTheme(){
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  setTheme(isDark?'light':'dark',{manual:true});
}

export function startAutomaticThemeClock(){
  applyAutomaticTheme();
  if(appState.theme.campusThemeClockTimer)clearInterval(appState.theme.campusThemeClockTimer);
  appState.theme.campusThemeClockTimer=setInterval(applyAutomaticTheme,60000);
}

export function toast(msg, type='info', dur=3000){
  persistDB();
  const w=document.getElementById('toast-wrap');
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  t.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" d="${type==='success'?'M5 13l4 4L19 7':type==='error'?'M6 18L18 6M6 6l12 12':'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}"/></svg>${msg}`;
  w.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),300)},dur);
}

// Second layer of safety for reversible-but-sensitive actions: shows a
// toast with an "Undo" button for a short window before it's final.
// In-app confirmation dialog — replaces the native browser confirm()
// popup with a styled modal that matches the rest of the app.
export function showConfirmDialog(opts){
  // One clear confirmation is enough. Sensitive actions still require the user
  // to explicitly press the confirmation button, but there is no redundant
  // second "Final Confirmation" screen.
  const {
    title='Please Confirm',
    message,
    confirmLabel='Confirm',
    cancelLabel='Cancel',
    danger=false,
    onConfirm,
    onCancel
  }=opts;

  openModal(`<div class="modal modal-sm">
    <div class="modal-header">
      <h3>${danger?'⚠️ ':''}${title}</h3>
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
    </div>
    <div class="modal-body">
      <p style="font-size:.87rem;line-height:1.55;color:var(--ink)">${message}</p>
    </div>
    <div class="modal-footer">
      <button class="btn" id="cc-confirm-cancel-btn">${cancelLabel}</button>
      <button class="btn ${danger?'btn-danger':'btn-primary'}" id="cc-confirm-ok-btn">${confirmLabel}</button>
    </div>
  </div>`);

  document.getElementById('cc-confirm-ok-btn').onclick=()=>{
    closeAllModals();
    if(onConfirm) onConfirm();
  };
  document.getElementById('cc-confirm-cancel-btn').onclick=()=>{
    closeAllModals();
    if(onCancel) onCancel();
  };
}

export function toastWithUndo(msg, undoFn, dur=6000){
  persistDB();
  const w=document.getElementById('toast-wrap');
  const t=document.createElement('div');
  t.className='toast warning';
  t.style.gap='.6rem';
  const label=document.createElement('span');
  label.textContent=msg;
  const btn=document.createElement('button');
  btn.textContent='Undo';
  btn.style.cssText='margin-left:auto;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.3);color:#fff;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:.76rem;font-weight:600;flex-shrink:0';
  let undone=false;
  btn.onclick=()=>{
    if(undone)return;
    undone=true;
    undoFn();
    t.remove();
    toast('Action undone.','info');
  };
  t.appendChild(label);
  t.appendChild(btn);
  w.appendChild(t);
  setTimeout(()=>{
    if(!t.isConnected)return;
    t.style.opacity='0';t.style.transition='opacity .3s';
    setTimeout(()=>t.remove(),300);
  },dur);
}

export function registrationToast(msg,type='error',dur=4500){
  const wrap=document.getElementById('registration-toast-wrap');
  if(!wrap)return toast(msg,type,dur);

  const normalizedType=type==='danger'?'error':type;
  const t=document.createElement('div');
  t.className=`toast ${normalizedType}`;
  t.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0">
    <path stroke-linecap="round" stroke-linejoin="round" d="${normalizedType==='success'?'M5 13l4 4L19 7':normalizedType==='error'?'M6 18L18 6M6 6l12 12':'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}"/>
  </svg><span>${escapeHtml(String(msg||''))}</span>`;
  wrap.appendChild(t);

  setTimeout(()=>{
    t.style.opacity='0';
    t.style.transition='opacity .3s';
    setTimeout(()=>t.remove(),300);
  },dur);
}

export function showAlert(el,msg,type='danger'){
  if(!el)return;

  // Registration validation/success feedback should float outside the form.
  // The informational notice at the top of Register remains inline.
  if(el.id==='reg-err'||el.id==='reg-ok'){
    hideAlert(el);
    registrationToast(msg,type==='success'?'success':type==='warning'?'warning':'error');
    return;
  }

  el.className=`alert alert-${type} show`;
  el.innerHTML=msg;
  if(el._autoHideTimer)clearTimeout(el._autoHideTimer);
  el._autoHideTimer=setTimeout(()=>hideAlert(el),10000);
}
export function hideAlert(el){
  if(!el)return;
  if(el._autoHideTimer){clearTimeout(el._autoHideTimer);el._autoHideTimer=null;}
  el.classList.remove('show');el.innerHTML='';
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.theme.campusThemeManualOverride=null;
  appState.theme.campusThemeClockTimer=null;
  startAutomaticThemeClock();
}
