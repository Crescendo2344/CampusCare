import {clearAccountState} from '../app/session-state.js';
// startup: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {closeAllModals} from './modals.js';
import {getLowStock} from './documentScanner.js';
import {addNotif} from './notifications.js';
import {persistDB} from './persistence.js';
import {initializeLandingRouting} from './authentication.js';
import {initializeSupabaseClient} from './supabaseClient.js';
import {handleCampusCareAuthCallback,openForgotPassword,resetAuthUiToLogin,updateRecoveryPasswordStrength,getRecoverySession,getRecoveryCooldownState,applyRecoveryCooldownUi} from './passwordRecovery.js';
import {syncCampusCareSessionUI} from './authSession.js';
import {toast} from './theme.js';
// ── Keyboard ──

// Auto-check low stock on load (for demo)

// Show the "back to top" button once the person has scrolled down a bit.

// Restore the real Supabase session after refresh. Supabase persists the
// session in browser storage, so refreshing the page should not log the user out.

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAllModals();});
  setTimeout(()=>{
  const lowStock=getLowStock();
  if(lowStock.length&&appState.auth.currentUser&&!appState.auth.currentUser._realSupabase&&(appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator')){
    lowStock.forEach(i=>{
      if(!appState.data.DB.notifications.find(n=>n.title.includes(i.name)&&n.userId===appState.auth.currentUser.id)){
        addNotif(appState.auth.currentUser.id,'Low Stock Alert',`${i.name} is below threshold: ${i.qty} ${i.unit} remaining.`,'danger');
      }
    });
  }
},500);
  window.addEventListener('beforeunload',persistDB);
  window.addEventListener('scroll',()=>{
  const btn=document.getElementById('back-to-top');
  if(!btn)return;
  btn.classList.toggle('show',window.scrollY>400);
});
  queueMicrotask(async()=>{
  initializeLandingRouting();
  initializeSupabaseClient();
  const restoreSkeleton=document.getElementById('session-restore-skeleton');

  // Never allow the startup overlay to trap the whole website.
  const safetyTimer=setTimeout(()=>restoreSkeleton?.classList.remove('show'),4000);

  try{
    const callbackMode=await handleCampusCareAuthCallback();
    if(callbackMode==='recovery'||callbackMode==='confirmed-pending'){
      restoreSkeleton?.classList.remove('show');
      clearTimeout(safetyTimer);
      return;
    }

    const {data:{session:existingSession}}=await appState.supabaseClient.supabaseClient.auth.getSession();
    if(existingSession)restoreSkeleton?.classList.add('show');

    const restored=await Promise.race([
      syncCampusCareSessionUI(),
      new Promise(resolve=>setTimeout(()=>resolve(false),5000))
    ]);

    restoreSkeleton?.classList.remove('show');

    // Keep exactly one subscription, including after a controlled remount.
    appState.auth.subscription?.unsubscribe();
    const {data:{subscription}}=appState.supabaseClient.supabaseClient.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY' && new URLSearchParams(window.location.search).get('auth')==='recovery'){
        document.getElementById('app')?.classList.remove('visible');
        const auth=document.getElementById('auth-wrap');
        if(auth)auth.style.display='block';
        // Queue API calls outside the Supabase auth callback to avoid lock reentrancy.
        setTimeout(async()=>{
          openForgotPassword(true);
          const activeSession=session||await getRecoverySession();
          const cooldown=await getRecoveryCooldownState(activeSession);
          if(!applyRecoveryCooldownUi(cooldown))updateRecoveryPasswordStrength();
        },0);
        return;
      }
      if(event==='SIGNED_IN'&&session&&!appState.auth.currentUser){
        setTimeout(()=>syncCampusCareSessionUI(),0);
      }
      if(event==='SIGNED_OUT'){
        clearAccountState();
        sessionStorage.removeItem(appState.persistence.SESSION_KEY);
        resetAuthUiToLogin();
      }
    });

    appState.auth.subscription=subscription;

    if(!restored&&!existingSession){
      document.getElementById('app')?.classList.remove('visible');
      document.getElementById('auth-wrap').style.display='block';
    }else if(!restored&&existingSession){
      // A temporary database/network issue should not leave a blank page.
      document.getElementById('auth-wrap').style.display='block';
      document.getElementById('app')?.classList.remove('visible');
      toast('CampusCare took too long to load. Please try again.','warning');
    }
  }catch(err){
    console.error('CampusCare startup:',err);
    restoreSkeleton?.classList.remove('show');
    document.getElementById('auth-wrap').style.display='block';
    document.getElementById('app')?.classList.remove('visible');
  }finally{
    clearTimeout(safetyTimer);
    restoreSkeleton?.classList.remove('show');
  }
});
  console.log('CampusCare v69 loaded.');
}
