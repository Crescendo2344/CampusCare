import {clearAccountState} from '../app/session-state.js';
// sessionSecurity: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {toast} from './theme.js';
import {auditAction} from './emailDelivery.js';
import {initializeSupabaseClient} from './supabaseClient.js';
import {auditLog} from './auditAndBackups.js';
import {persistDB} from './persistence.js';
import {resetAuthUiToLogin} from './passwordRecovery.js';
// ================================================================
// SESSION SECURITY — INACTIVITY TIMEOUT
// ================================================================

export function getCampusLastActivity(){
  const stored=Number(localStorage.getItem(appState.sessionSecurity.SESSION_ACTIVITY_KEY)||0);
  return Number.isFinite(stored)&&stored>0?stored:Date.now();
}

export function recordCampusActivity(force=false){
  if(!appState.auth.currentUser)return;
  const now=Date.now();

  // Avoid writing localStorage on every mouse/touch/scroll event.
  if(force||now-appState.sessionSecurity.lastActivityWrite>10000){
    appState.sessionSecurity.lastActivityWrite=now;
    try{localStorage.setItem(appState.sessionSecurity.SESSION_ACTIVITY_KEY,String(now));}catch(_){}
  }
  scheduleCampusSessionGuard();
}

export function clearCampusSessionGuard(){
  if(appState.sessionSecurity.sessionGuardTimeoutId)clearTimeout(appState.sessionSecurity.sessionGuardTimeoutId);
  if(appState.sessionSecurity.sessionGuardWarningId)clearTimeout(appState.sessionSecurity.sessionGuardWarningId);
  appState.sessionSecurity.sessionGuardTimeoutId=null;
  appState.sessionSecurity.sessionGuardWarningId=null;
}

export function configureSessionGuard(minutes){
  appState.sessionSecurity.sessionGuardMinutes=Math.max(10,Math.min(240,Number(minutes||30)));

  if(!appState.sessionSecurity.sessionGuardBound){
    appState.sessionSecurity.sessionGuardBound=true;
    ['pointerdown','keydown','touchstart','scroll'].forEach(evt=>{
      document.addEventListener(evt,()=>recordCampusActivity(false),{passive:true});
    });
    window.addEventListener('storage',e=>{
      if(e.key===appState.sessionSecurity.SESSION_ACTIVITY_KEY&&appState.auth.currentUser)scheduleCampusSessionGuard();
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'&&appState.auth.currentUser)checkCampusSessionExpiry();
    });
  }

  recordCampusActivity(true);
}

export function scheduleCampusSessionGuard(){
  clearCampusSessionGuard();
  if(!appState.auth.currentUser)return;

  const last=getCampusLastActivity();
  const totalMs=appState.sessionSecurity.sessionGuardMinutes*60*1000;
  const warningMs=Math.max(0,totalMs-(2*60*1000));
  const elapsed=Math.max(0,Date.now()-last);

  const warnIn=warningMs-elapsed;
  const expireIn=totalMs-elapsed;

  if(expireIn<=0){
    campusAutoLogout();
    return;
  }

  if(warnIn>0){
    appState.sessionSecurity.sessionGuardWarningId=setTimeout(()=>{
      if(!appState.auth.currentUser)return;
      toast('For security, your CampusCare session will sign out in about 2 minutes if there is no activity.','warning',7000);
    },warnIn);
  }

  appState.sessionSecurity.sessionGuardTimeoutId=setTimeout(checkCampusSessionExpiry,expireIn);
}

export function checkCampusSessionExpiry(){
  if(!appState.auth.currentUser)return;
  const elapsed=Date.now()-getCampusLastActivity();
  if(elapsed>=appState.sessionSecurity.sessionGuardMinutes*60*1000){
    campusAutoLogout();
  }else{
    scheduleCampusSessionGuard();
  }
}

export async function campusAutoLogout(){
  if(!appState.auth.currentUser)return;
  clearCampusSessionGuard();

  try{
    if(appState.auth.currentUser._realSupabase){
      try{await auditAction({action:'record_session',event:'LOGOUT'});}catch(e){console.error('Auto-logout audit:',e);}
      if(initializeSupabaseClient()){
        await appState.supabaseClient.supabaseClient.auth.signOut();
      }
    }else{
      auditLog('LOGOUT','Session expired after inactivity.','Session',appState.auth.currentUser.id);
      persistDB();
    }
  }catch(e){
    console.error('Automatic session sign-out:',e);
  }

  clearAccountState();
  sessionStorage.removeItem(appState.persistence.SESSION_KEY);
  try{localStorage.removeItem(appState.sessionSecurity.SESSION_ACTIVITY_KEY);}catch(_){}
  resetAuthUiToLogin();
  document.getElementById('back-to-top')?.classList.remove('show');
  toast('Your CampusCare session expired due to inactivity. Please sign in again.','warning',8000);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.sessionSecurity.SESSION_ACTIVITY_KEY='campuscare_last_activity';
  appState.sessionSecurity.sessionGuardTimeoutId=null;
  appState.sessionSecurity.sessionGuardWarningId=null;
  appState.sessionSecurity.sessionGuardMinutes=30;
  appState.sessionSecurity.sessionGuardBound=false;
  appState.sessionSecurity.lastActivityWrite=0;
}
