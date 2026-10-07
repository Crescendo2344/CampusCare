// ================================================================
// SESSION SECURITY — INACTIVITY TIMEOUT
// ================================================================
const SESSION_ACTIVITY_KEY='campuscare_last_activity';
let sessionGuardTimeoutId=null;
let sessionGuardWarningId=null;
let sessionGuardMinutes=30;
let sessionGuardBound=false;
let lastActivityWrite=0;

function getCampusLastActivity(){
  const stored=Number(localStorage.getItem(SESSION_ACTIVITY_KEY)||0);
  return Number.isFinite(stored)&&stored>0?stored:Date.now();
}

function recordCampusActivity(force=false){
  if(!currentUser)return;
  const now=Date.now();

  // Avoid writing localStorage on every mouse/touch/scroll event.
  if(force||now-lastActivityWrite>10000){
    lastActivityWrite=now;
    try{localStorage.setItem(SESSION_ACTIVITY_KEY,String(now));}catch(_){}
  }
  scheduleCampusSessionGuard();
}

function clearCampusSessionGuard(){
  if(sessionGuardTimeoutId)clearTimeout(sessionGuardTimeoutId);
  if(sessionGuardWarningId)clearTimeout(sessionGuardWarningId);
  sessionGuardTimeoutId=null;
  sessionGuardWarningId=null;
}

function configureSessionGuard(minutes){
  sessionGuardMinutes=Math.max(10,Math.min(240,Number(minutes||30)));

  if(!sessionGuardBound){
    sessionGuardBound=true;
    ['pointerdown','keydown','touchstart','scroll'].forEach(evt=>{
      document.addEventListener(evt,()=>recordCampusActivity(false),{passive:true});
    });
    window.addEventListener('storage',e=>{
      if(e.key===SESSION_ACTIVITY_KEY&&currentUser)scheduleCampusSessionGuard();
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'&&currentUser)checkCampusSessionExpiry();
    });
  }

  recordCampusActivity(true);
}

function scheduleCampusSessionGuard(){
  clearCampusSessionGuard();
  if(!currentUser)return;

  const last=getCampusLastActivity();
  const totalMs=sessionGuardMinutes*60*1000;
  const warningMs=Math.max(0,totalMs-(2*60*1000));
  const elapsed=Math.max(0,Date.now()-last);

  const warnIn=warningMs-elapsed;
  const expireIn=totalMs-elapsed;

  if(expireIn<=0){
    campusAutoLogout();
    return;
  }

  if(warnIn>0){
    sessionGuardWarningId=setTimeout(()=>{
      if(!currentUser)return;
      toast('For security, your CampusCare session will sign out in about 2 minutes if there is no activity.','warning',7000);
    },warnIn);
  }

  sessionGuardTimeoutId=setTimeout(checkCampusSessionExpiry,expireIn);
}

function checkCampusSessionExpiry(){
  if(!currentUser)return;
  const elapsed=Date.now()-getCampusLastActivity();
  if(elapsed>=sessionGuardMinutes*60*1000){
    campusAutoLogout();
  }else{
    scheduleCampusSessionGuard();
  }
}

async function campusAutoLogout(){
  if(!currentUser)return;
  clearCampusSessionGuard();

  try{
    if(currentUser._realSupabase){
      try{await auditAction({action:'record_session',event:'LOGOUT'});}catch(e){console.error('Auto-logout audit:',e);}
      if(initializeSupabaseClient()){
        await supabaseClient.auth.signOut();
      }
    }else{
      auditLog('LOGOUT','Session expired after inactivity.','Session',currentUser.id);
      persistDB();
    }
  }catch(e){
    console.error('Automatic session sign-out:',e);
  }

  currentUser=null;
  currentPatient=null;
  sessionStorage.removeItem(SESSION_KEY);
  try{localStorage.removeItem(SESSION_ACTIVITY_KEY);}catch(_){}
  resetAuthUiToLogin();
  document.getElementById('back-to-top')?.classList.remove('show');
  toast('Your CampusCare session expired due to inactivity. Please sign in again.','warning',8000);
}
