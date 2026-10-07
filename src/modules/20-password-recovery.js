// ================================================================
// FORGOT PASSWORD — real Supabase email recovery
// ================================================================
function openForgotPassword(recoveryMode=false){
  // Recovery links arrive on the public landing URL. Explicitly switch from
  // the landing page to the authentication card before showing the reset form.
  const landing=document.getElementById('landing-page');
  const authPage=document.getElementById('auth-page');
  if(landing)landing.style.display='none';
  if(authPage)authPage.style.display='block';
  setPublicNavbarMode(true);
  window.scrollTo(0,0);

  document.getElementById('login-section').style.display='none';
  document.getElementById('reg-section').style.display='none';
  document.getElementById('pending-section').style.display='none';
  document.getElementById('auth-tabs').style.display='none';
  document.getElementById('forgot-section').style.display='block';

  const identifier=document.getElementById('fp-identifier');
  if(identifier&&!recoveryMode)identifier.value=document.getElementById('li-user').value||'';

  hideAlert(document.getElementById('fp-err'));
  hideAlert(document.getElementById('fp-err3'));
  const resetDest=document.getElementById('fp-reset-destination');
  if(resetDest)resetDest.textContent='If a matching CampusCare account exists, a secure password-reset link has been sent.';
  showForgotStep(recoveryMode?3:1);

  const title=document.getElementById('forgot-title');
  const subtitle=document.getElementById('forgot-subtitle');
  if(recoveryMode){
    if(title)title.textContent='Create a New Password';
    if(subtitle)subtitle.textContent='Your secure recovery link has been verified.';
  }else{
    if(title)title.textContent='Reset Your Password';
    if(subtitle)subtitle.textContent='CampusCare will send a secure reset link to your registered email.';
  }
}


function resetAuthUiToLogin(){
  // Remove callback/query state left behind by email confirmation or recovery.
  cleanAuthCallbackUrl();

  // Always return to the normal Login view.
  const landing=document.getElementById('landing-page');
  const authPage=document.getElementById('auth-page');
  const authWrap=document.getElementById('auth-wrap');
  const app=document.getElementById('app');

  if(app)app.classList.remove('visible');
  if(landing)landing.style.display='none';
  if(authPage)authPage.style.display='block';
  setPublicNavbarMode(true);
  if(authWrap)authWrap.style.display='block';

  authTab('login');

  // Explicitly clear every recovery step so no previous recovery UI can
  // become visible when the auth container is shown again.
  const forgot=document.getElementById('forgot-section');
  if(forgot)forgot.style.display='none';
  [1,2,3].forEach(i=>{
    const el=document.getElementById('forgot-step'+i);
    if(el)el.style.display=i===1?'block':'none';
  });

  const fields=['fp-identifier','fp-newpass','fp-newpass2'];
  fields.forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.value='';
  });

  const updateBtn=document.getElementById('fp-update-btn');
  if(updateBtn)updateBtn.disabled=false;
  const newLinkBtn=document.getElementById('fp-new-link-btn');
  if(newLinkBtn)newLinkBtn.style.display='none';

  hideAlert(document.getElementById('fp-err'));
  hideAlert(document.getElementById('fp-err3'));
  hideAlert(document.getElementById('login-err'));

  const strength=document.getElementById('fp-strength');
  if(strength)strength.classList.remove('show');

  window.scrollTo(0,0);
}

function closeForgotPassword(){
  resetAuthUiToLogin();
}

function showForgotStep(n){
  [1,2,3].forEach(i=>{
    const el=document.getElementById('forgot-step'+i);
    if(el)el.style.display=(i===n?'block':'none');
  });
}


function maskPasswordResetEmail(identifier){
  const value=String(identifier||'').trim().toLowerCase();
  if(!value.includes('@'))return '';

  const [local,domain]=value.split('@');
  if(!local||!domain)return '';

  // The user already entered this address, so we can safely reflect a masked
  // version without revealing whether an account actually exists.
  let visible;
  if(local.length>=8)visible=local.slice(0,8);
  else if(local.length>=4)visible=local.slice(0,2);
  else visible=local.slice(0,1);

  return `${visible}*****@${domain}`;
}

function updatePasswordResetDestination(identifier){
  const el=document.getElementById('fp-reset-destination');
  if(!el)return;

  const masked=maskPasswordResetEmail(identifier);
  if(masked){
    el.innerHTML=`If a matching CampusCare account exists, a secure password-reset link has been sent to <strong>${escapeHtml(masked)}</strong>.`;
  }else{
    // Username-based requests stay generic to avoid exposing the email address
    // connected to a CampusCare account.
    el.textContent='If a matching CampusCare account exists, a secure password-reset link has been sent to the registered email address.';
  }
}

async function sendPasswordResetEmail(){
  const identifier=document.getElementById('fp-identifier').value.trim();
  const err=document.getElementById('fp-err');
  const btn=document.getElementById('fp-send-btn');
  hideAlert(err);

  if(!identifier){
    showAlert(err,'Please enter your username or email.');
    return;
  }

  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Sending…';}

  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/request-password-reset`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:SUPABASE_PUBLISHABLE_KEY
      },
      body:JSON.stringify({identifier})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Unable to send the reset email.');

    // Keep account existence private. If the user typed an email address,
    // show only a masked reflection of what they entered.
    updatePasswordResetDestination(identifier);
    showForgotStep(2);
  }catch(e){
    showAlert(err,e?.message||'Unable to send the reset email. Please try again.');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=oldText||'Send Reset Link';}
  }
}

function cleanAuthCallbackUrl(){
  try{
    const clean=window.location.origin+window.location.pathname;
    window.history.replaceState({},document.title,clean);
  }catch(_){}
}


function showRecoveryPasswordChecklist(){
  document.getElementById('fp-strength')?.classList.add('show');
  updateRecoveryPasswordStrength();
}
function hideRecoveryPasswordChecklist(){
  document.getElementById('fp-strength')?.classList.remove('show');
}
function updateRecoveryPasswordStrength(){
  const input=document.getElementById('fp-newpass');
  const el=document.getElementById('fp-strength');
  const label=document.getElementById('fp-strength-label');
  if(!input||!el)return;

  const {checks,score,valid}=checkPasswordStrength(input.value);
  el.querySelectorAll('.password-check').forEach(item=>{
    item.classList.toggle('met',Boolean(checks[item.dataset.check]));
  });

  if(label){
    let strength='Weak password',cls='weak';
    if(valid&&score>=5){strength='Strong password';cls='strong';}
    else if(valid||score>=3){strength='Medium password';cls='medium';}
    label.textContent=strength;
    label.className='password-strength-label '+cls;
  }
}

async function getRecoverySession(){
  if(!initializeSupabaseClient())return null;

  // Supabase may still be consuming the URL hash when the page first loads,
  // so retry briefly before declaring the recovery link invalid.
  for(let attempt=0;attempt<5;attempt++){
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(session?.user)return session;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  return null;
}


async function getRecoveryCooldownState(session){
  if(!session?.user)return {locked:false,next:null,changedAt:null};

  try{
    const {data:profile,error}=await supabaseClient
      .from('users')
      .select('password_changed_at')
      .eq('auth_user_id',session.user.id)
      .maybeSingle();

    if(error||!profile?.password_changed_at){
      return {locked:false,next:null,changedAt:null};
    }

    const changedAt=new Date(profile.password_changed_at);
    if(Number.isNaN(changedAt.getTime())){
      return {locked:false,next:null,changedAt:null};
    }

    const next=new Date(changedAt.getTime()+7*24*60*60*1000);
    return {
      locked:Date.now()<next.getTime(),
      next,
      changedAt
    };
  }catch(err){
    console.error('Recovery cooldown check:',err);
    return {locked:false,next:null,changedAt:null};
  }
}

function applyRecoveryCooldownUi(state){
  const err=document.getElementById('fp-err3');
  const updateBtn=document.getElementById('fp-update-btn');
  const p1=document.getElementById('fp-newpass');
  const p2=document.getElementById('fp-newpass2');

  if(state?.locked&&state.next){
    const when=state.next.toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'});
    showAlert(
      err,
      `You recently changed your password. For account security, you can change or reset it again on ${when}.`,
      'warning'
    );
    if(updateBtn)updateBtn.disabled=true;
    if(p1)p1.disabled=true;
    if(p2)p2.disabled=true;
    return true;
  }

  if(updateBtn)updateBtn.disabled=false;
  if(p1)p1.disabled=false;
  if(p2)p2.disabled=false;
  return false;
}

async function submitNewPassword(){
  const p1=document.getElementById('fp-newpass').value;
  const p2=document.getElementById('fp-newpass2').value;
  const err=document.getElementById('fp-err3');
  const btn=document.getElementById('fp-update-btn');
  hideAlert(err);

  if(!p1||!checkPasswordStrength(p1).valid){
    showAlert(err,'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.');
    return;
  }
  if(p1!==p2){
    showAlert(err,'Passwords do not match.');
    return;
  }

  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Updating…';}

  try{
    if(!initializeSupabaseClient())throw new Error('Unable to connect to CampusCare.');
    const recoverySession=await getRecoverySession();
    if(!recoverySession){
      const newLinkBtn=document.getElementById('fp-new-link-btn');
      if(newLinkBtn)newLinkBtn.style.display='block';
      throw new Error('This password-reset link is invalid or has expired. Please request a new reset link.');
    }

    // Enforce the 7-day password-change rule on the server as well.
    // The backend also verifies that this access token came from a recovery link.
    const response=await fetch(`${SUPABASE_URL}/functions/v1/complete-password-recovery`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:SUPABASE_PUBLISHABLE_KEY,
        Authorization:`Bearer ${recoverySession.access_token}`
      },
      body:JSON.stringify({new_password:p1})
    });

    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok){
      if(result.next_allowed_at){
        const state={
          locked:true,
          next:new Date(result.next_allowed_at),
          changedAt:result.password_changed_at?new Date(result.password_changed_at):null
        };
        applyRecoveryCooldownUi(state);
      }
      throw new Error(result.error||'Unable to reset your password.');
    }

    // End the temporary recovery session so the user signs in normally afterward.
    await supabaseClient.auth.signOut();
    cleanAuthCallbackUrl();

    document.getElementById('fp-newpass').value='';
    document.getElementById('fp-newpass2').value='';
    resetAuthUiToLogin();
    toast('Password updated successfully. You can now log in with your new password.','success');
  }catch(e){
    showAlert(err,e?.message||'Unable to update your password. Please request a new recovery link.');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=oldText||'Update Password';}
  }
}

async function handleCampusCareAuthCallback(){
  const params=new URLSearchParams(window.location.search);
  const hashParams=new URLSearchParams((window.location.hash||'').replace(/^#/,''));
  const mode=params.get('auth');

  // Supabase can return callback errors in the query string or URL fragment.
  const callbackError=
    params.get('error_description')||
    hashParams.get('error_description')||
    params.get('error')||
    hashParams.get('error');

  if(callbackError){
    showAuthPage('login');
    cleanAuthCallbackUrl();
    toast(decodeURIComponent(callbackError).replace(/\+/g,' '),'error',7000);
    return 'auth-error';
  }

  if(mode==='recovery'){
    // Always move from the public landing page to the authentication card.
    openForgotPassword(true);

    const recoverySession=await getRecoverySession();
    const err=document.getElementById('fp-err3');
    const newLinkBtn=document.getElementById('fp-new-link-btn');

    if(!recoverySession){
      showAlert(err,'This password-reset link is invalid or has expired. Please request a new reset link.');
      if(newLinkBtn)newLinkBtn.style.display='block';
      const updateBtn=document.getElementById('fp-update-btn');
      if(updateBtn)updateBtn.disabled=true;
    }else{
      hideAlert(err);
      if(newLinkBtn)newLinkBtn.style.display='none';

      const cooldownState=await getRecoveryCooldownState(recoverySession);
      const locked=applyRecoveryCooldownUi(cooldownState);

      if(!locked){
        updateRecoveryPasswordStrength();
      }
    }
    return 'recovery';
  }

  if(mode==='confirmed'){
    const {data:{session}}=await supabaseClient.auth.getSession();

    if(session?.user){
      const {data:profile}=await supabaseClient
        .from('users')
        .select('status')
        .eq('auth_user_id',session.user.id)
        .maybeSingle();

      if(String(profile?.status||'').toLowerCase()==='pending'){
        await supabaseClient.auth.signOut();
        cleanAuthCallbackUrl();
        showAuthPage('login');
        toast('Email confirmed successfully. Your registration is still pending administrator approval.','success',6500);
        return 'confirmed-pending';
      }
    }

    cleanAuthCallbackUrl();
    showAuthPage('login');
    toast('Email address confirmed successfully. You can now continue with CampusCare.','success',6500);
    return 'confirmed';
  }

  return null;
}

function logout(){
  showConfirmDialog({
    title:'Log Out',
    message:'Are you sure you want to logout?',
    confirmLabel:'Logout',
    bypassSecondStep:true,
    onConfirm:async()=>{
      try{
        // Record the action before the authenticated session is destroyed.
        if(currentUser){
          if(currentUser._realSupabase){
            try{await auditAction({action:'record_session',event:'LOGOUT'});}catch(e){console.error('Logout audit:',e);}
          }else{
            auditLog('LOGOUT','User signed out of CampusCare.','Session',currentUser.id);
            persistDB();
          }
        }

        // IMPORTANT: CampusCare now uses Supabase Auth with a persisted browser
        // session. Clearing only currentUser/sessionStorage is not enough because
        // Supabase would restore that session on refresh or in another tab.
        if(initializeSupabaseClient()){
          const {error}=await supabaseClient.auth.signOut();
          if(error)throw error;
        }

        clearCampusSessionGuard();
        currentUser=null;
        currentPatient=null;
        sessionStorage.removeItem(SESSION_KEY);
        try{localStorage.removeItem(SESSION_ACTIVITY_KEY);}catch(_){}

        // Fully reset the auth UI so an earlier email-recovery screen cannot
        // reappear after logout.
        resetAuthUiToLogin();

        const userInput=document.getElementById('li-user');
        const passInput=document.getElementById('li-pass');
        if(userInput)userInput.value='';
        if(passInput)passInput.value='';

        document.getElementById('back-to-top')?.classList.remove('show');

        toast('Logged out successfully.','success');
      }catch(e){
        console.error('Supabase logout:',e);
        toast(e?.message||'Unable to log out. Please try again.','error');
      }
    }
  });
}

// Restore an active session (e.g. after a page refresh) so the person
// isn't logged out just for reloading the tab.
function tryRestoreSession(){
  const savedId=sessionStorage.getItem(SESSION_KEY);
  if(!savedId)return false;
  const user=DB.users.find(u=>u.id===parseInt(savedId));
  if(!user||user.status!=='Active'){sessionStorage.removeItem(SESSION_KEY);return false;}
  currentUser=user;
  if(user.role==='Patient')currentPatient=getPatientByUserId(user.id);
  checkReminders();
  initApp();
  return true;
}
