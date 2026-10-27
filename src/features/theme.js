// theme: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {persistDB} from './persistence.js';
import {closeAllModals,openModal} from './modals.js';
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
    if(!el)return;
    el.title=auto
      ? `Appearance follows local time (${dark?'Dark':'Light'} now). Click to switch to ${dark?'light':'dark'} mode.`
      : `${dark?'Dark':'Light'} mode is saved on this device. Click to switch to ${dark?'light':'dark'} mode.`;
    el.setAttribute('aria-label',`Switch to ${dark?'light':'dark'} mode`);
  });
}

// A theme chosen with the toggle is remembered on this device and survives reloads and sign-outs.
const THEME_KEY='campuscare-theme';
export function savedTheme(){
  try{const value=localStorage.getItem(THEME_KEY);return value==='dark'||value==='light'?value:null;}
  catch(_){return null;}
}
function saveTheme(value){
  try{localStorage.setItem(THEME_KEY,value);}catch(_){}
}

export function setTheme(mode,{manual=false}={}){
  const next=mode==='dark'?'dark':'light';
  if(next==='dark')document.documentElement.setAttribute('data-theme','dark');
  else document.documentElement.removeAttribute('data-theme');
  if(manual){appState.theme.campusThemeManualOverride=next;saveTheme(next);}
  applyThemeIcons();
}

// "auto" follows the time of day; "light" and "dark" are remembered on this device.
export function themePreference(){return savedTheme()||'auto';}
export function setThemePreference(preference){
  if(preference==='light'||preference==='dark'){setTheme(preference,{manual:true});return;}
  try{localStorage.removeItem(THEME_KEY);}catch(_){}
  appState.theme.campusThemeManualOverride=null;
  setTheme(automaticThemeForLocalTime());
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

const TOAST_KINDS={
  success:{icon:'M5 13l4 4L19 7'},
  error:{icon:'M12 8v5m0 3.5h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'},
  warning:{icon:'M12 9v4m0 3.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'},
  info:{icon:'M12 16v-4m0-3.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'}
};
const MAX_TOASTS=3;

// One toast component for every surface: icon, title, message, optional action, close and a timer bar.
// Reading time grows with the message; errors stay longer. Hovering or focusing its buttons pauses the timer.
export function showToast(wrap,msg,type='info',dur=3000,{title='',action=null}={}){
  const kind=type==='danger'?'error':TOAST_KINDS[type]?type:'info',meta=TOAST_KINDS[kind],text=String(msg??'');
  const existing=[...wrap.children].find(el=>el.dataset.message===text&&!el.classList.contains('leaving'));
  if(existing){existing.restartTimer?.();return existing;}
  const t=document.createElement('div');
  t.className=`toast ${kind}`;t.dataset.message=text;
  t.setAttribute('role',kind==='error'||kind==='warning'?'alert':'status');
  t.innerHTML=`<span class="toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${meta.icon}"/></svg></span>
    <div class="toast-body"><strong class="toast-title"></strong><span class="toast-msg"></span></div>
    <button type="button" class="toast-close" aria-label="Dismiss notification"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    <span class="toast-timer" aria-hidden="true"></span>`;
  // A title only when the caller has a specific one; otherwise the message is the headline.
  const heading=t.querySelector('.toast-title');
  if(title)heading.textContent=title;else{heading.remove();t.classList.add('toast-plain');}
  t.querySelector('.toast-msg').textContent=text;
  if(action){
    const btn=document.createElement('button');btn.type='button';btn.className='toast-action';btn.textContent=action.label;
    btn.addEventListener('click',()=>{action.onClick();dismiss();});
    t.querySelector('.toast-body').append(btn);
  }
  const ms=Math.min(10000,Math.max(dur,(kind==='error'?4500:2500)+text.length*45));
  let remaining=ms,started=0,timer=0;
  const bar=t.querySelector('.toast-timer');
  const dismiss=()=>{
    if(t.classList.contains('leaving'))return;
    clearTimeout(timer);t.classList.add('leaving');
    setTimeout(()=>t.remove(),220);
  };
  const run=()=>{started=Date.now();timer=setTimeout(dismiss,remaining);bar.style.animationDuration=ms+'ms';bar.style.animationPlayState='running';};
  const pause=()=>{if(!started)return;clearTimeout(timer);remaining-=Date.now()-started;started=0;bar.style.animationPlayState='paused';};
  t.restartTimer=()=>{clearTimeout(timer);remaining=ms;bar.style.animation='none';void bar.offsetWidth;bar.style.animation='';run();};
  t.addEventListener('pointerover',pause);t.addEventListener('pointerout',event=>{if(!t.contains(event.relatedTarget))run();});
  t.addEventListener('focusin',pause);t.addEventListener('focusout',()=>{if(!t.contains(document.activeElement))run();});
  t.querySelector('.toast-close').addEventListener('click',dismiss);
  // Newest first; only the most recent few stay on screen.
  wrap.prepend(t);
  [...wrap.children].filter(el=>!el.classList.contains('leaving')).slice(MAX_TOASTS).forEach(el=>{el.classList.add('leaving');setTimeout(()=>el.remove(),220);});
  run();
  return t;
}

// Clear notices that a new screen or result has made stale.
export function clearToasts(){
  for(const id of ['toast-wrap','registration-toast-wrap'])
    for(const el of document.getElementById(id)?.children||[]){el.classList.add('leaving');setTimeout(()=>el.remove(),220);}
}

export function toast(msg, type='info', dur=3000, options={}){
  persistDB();
  const w=document.getElementById('toast-wrap');
  if(!w)return;
  return showToast(w,msg,type,dur,options);
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
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals();if(onCancel)onCancel()})}>✕</button>
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
  const cancelButton=document.getElementById('cc-confirm-cancel-btn');
  if(cancelButton)cancelButton.onclick=()=>{
    closeAllModals();
    if(onCancel) onCancel();
  };
}

export function toastWithUndo(msg, undoFn, dur=6000){
  let undone=false;
  toast(msg,'warning',dur,{action:{label:'Undo',onClick:()=>{
    if(undone)return;
    undone=true;undoFn();toast('Action undone.','info');
  }}});
}

export function registrationToast(msg,type='error',dur=4500){
  const wrap=document.getElementById('registration-toast-wrap');
  if(!wrap)return toast(msg,type,dur);
  return showToast(wrap,msg,type,dur);
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
  appState.theme.campusThemeManualOverride=savedTheme();
  appState.theme.campusThemeClockTimer=null;
  if(appState.theme.campusThemeManualOverride)setTheme(appState.theme.campusThemeManualOverride);
  startAutomaticThemeClock();
}
