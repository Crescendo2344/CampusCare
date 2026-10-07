
(function(){
  try{
    var hour=(new Date()).getHours();
    var mode=(hour>=18||hour<6)?'dark':'light';
    if(mode==='dark')document.documentElement.setAttribute('data-theme','dark');
    else document.documentElement.removeAttribute('data-theme');
  }catch(e){
    // Default to light if local time cannot be read.
    document.documentElement.removeAttribute('data-theme');
  }
})();

// === LOGIN SESSION UI SYNC ===
// Prevents the user from needing to refresh after a successful Supabase login.
// It restores the signed-in profile and immediately switches from auth to the app.

async function hydrateCurrentUserProfilePhoto(profile){
  if(!profile?.profile_image_url)return profile;

  try{
    const {data,error}=await supabaseClient.storage
      .from('campuscare-profiles')
      .createSignedUrl(profile.profile_image_url,3600);

    if(!error&&data?.signedUrl){
      return {...profile,profile_signed_url:data.signedUrl};
    }
  }catch(err){
    console.error('Current user profile photo:',err);
  }

  // Keep login/session usable even if the photo cannot be signed.
  return profile;
}

async function syncCampusCareSessionUI(){
  if(!initializeSupabaseClient())return false;
  try{
    const {data:{session}}=await supabaseClient.auth.getSession();
    if(!session?.user)return false;

    const {data:profile,error}=await supabaseClient
      .from('users').select('*')
      .eq('auth_user_id',session.user.id)
      .single();

    if(error||!profile){
      console.error('CampusCare profile load failed:',error);
      return false;
    }

    const hydratedProfile=await hydrateCurrentUserProfilePhoto(profile);
    currentUser=normalizeSupabaseUser(hydratedProfile);
    currentUser.lastLogin=session.user.last_sign_in_at||profile.last_login_at||currentUser.lastLogin||'';
    currentUser.emailConfirmedAt=session.user.email_confirmed_at||null;

    if(String(currentUser.status).toLowerCase()!=='active'){
      await supabaseClient.auth.signOut();
      currentUser=null;currentPatient=null;
      return false;
    }

    // Open CampusCare immediately once the authenticated profile is available.
    // Do not keep the whole page blocked while secondary directory data loads.
    initApp();

    if(['Administrator','Staff','Doctor'].includes(currentUser.role)){
      // Keep the already-rendered page visible while clinical directory and
      // certificate data synchronize in the background.
      syncAdminDirectoryFromSupabase()
        .then(async()=>{
          if(typeof syncPublicSystemSettings==='function'){
            try{await syncPublicSystemSettings();}catch(err){console.error('Settings sync:',err);}
          }
          if(typeof syncRealTreatments==='function'){
            try{await syncRealTreatments();}catch(err){console.error('Treatment sync:',err);}
          }
          if(typeof syncRealMessages==='function'){
            try{await syncRealMessages();}catch(err){console.error('Message sync:',err);}
          }
          if(typeof syncRealHealthResources==='function'){
            try{await syncRealHealthResources();}catch(err){console.error('Health Education sync:',err);}
          }
          if(typeof syncRealIssueReports==='function'){
            try{await syncRealIssueReports();}catch(err){console.error('Issue report sync:',err);}
          }
          if(typeof syncRealWorkflowRequests==='function'){
            try{await syncRealWorkflowRequests();}catch(err){console.error('Workflow request sync:',err);}
          }
          if(typeof syncRealCertificates==='function'){
            try{await syncRealCertificates();}catch(err){console.error('Certificate sync:',err);}
          }
          if(typeof syncRealFitnessAssessments==='function'){
            try{await syncRealFitnessAssessments();}catch(err){console.error('Fitness sync:',err);}
          }
          if(['Staff','Administrator'].includes(currentUser.role)&&typeof syncRealInventory==='function'){
            try{await syncRealInventory(true);}catch(err){console.error('Inventory sync:',err);}
          }
          if(currentUser.role==='Administrator'&&typeof refreshRealApprovalQueue==='function'){
            try{await refreshRealApprovalQueue(false);}catch(err){console.error('Approval sync:',err);}
          }
          refreshActivePageAfterSync();
        })
        .catch(err=>{
          console.error('Clinical directory background sync:',err);
          toast('Some database data could not be refreshed. Open the page again to retry.','warning');
        });
    }else if(currentUser.role==='Patient'){
      syncCurrentPatientFromSupabase()
        .then(()=>syncPublicSystemSettings())
        .then(()=>syncRealDoctorDirectory())
        .then(()=>syncRealAppointments())
        .then(()=>syncClinicSurveys())
        .then(()=>{rebuildConditionalNavigation();})
        .then(()=>syncRealMessages())
        .then(()=>syncRealHealthResources())
        .then(()=>syncRealIssueReports())
        .then(()=>syncRealWorkflowRequests())
        .then(()=>syncRealMedicationReminders())
        .then(()=>syncRealCertificates())
        .then(()=>syncRealFitnessAssessments())
        .then(()=>refreshActivePageAfterSync())
        .catch(err=>console.error('Patient background sync:',err));
    }

    return true;
  }catch(err){
    console.error('CampusCare session UI sync:',err);
    return false;
  }
}
// Keep UI synchronized when Supabase changes authentication state.
document.addEventListener('DOMContentLoaded',()=>{
  if(window.supabaseClient?.auth){
    supabaseClient.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY' && new URLSearchParams(window.location.search).get('auth')==='recovery'){
        setTimeout(async()=>{
          openForgotPassword(true);
          const activeSession=session||await getRecoverySession();
          const cooldownState=await getRecoveryCooldownState(activeSession);
          if(!applyRecoveryCooldownUi(cooldownState)){
            updateRecoveryPasswordStrength();
          }
        },0);
        return;
      }
      if(event==='SIGNED_IN' && session) setTimeout(syncCampusCareSessionUI,0);
    });
  }
});


// Normalize a real Supabase user so the existing CampusCare UI can display it
// without showing generic "User / email / Role" placeholders.



function fetchWithTimeout(url,options={},timeoutMs=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(url,{...options,signal:controller.signal})
    .finally(()=>clearTimeout(timer));
}








function getActiveNavPageId(){
  const active=document.querySelector('#sidebar nav [id^="nav-"].active');
  return active?.id?.replace(/^nav-/,'')||'dashboard';
}

function refreshActivePageAfterSync(){
  const pageId=getActiveNavPageId();

  // Sidebar state is authoritative only when it still matches the active
  // navigation token. This avoids a background Supabase sync reviving an
  // older page while the user is clicking elsewhere.
  if(pageId!==campusActivePageId)return;

  try{
    if(pageId==='dashboard')renderDashboard();
    else renderPage(pageId);
  }catch(err){
    console.error('Page refresh after database sync:',err);
  }
}








// Registration has its own toast position so validation messages do not appear
// as large inline alerts inside the registration form.
function registrationToast(msg,type='info'){
  let container=document.getElementById('registration-toast-container');
  if(!container){
    container=document.createElement('div');
    container.id='registration-toast-container';
    container.setAttribute('aria-live','polite');
    document.body.appendChild(container);
  }
  container.innerHTML='';
  const tone=['success','error','warning','info'].includes(type)?type:'info';
  const el=document.createElement('div');
  el.className=`toast toast-${tone}`;
  el.setAttribute('role',tone==='error'?'alert':'status');

  const message=document.createElement('span');
  message.textContent=String(msg||'');

  const close=document.createElement('button');
  close.type='button';
  close.className='toast-close';
  close.setAttribute('aria-label','Dismiss notification');
  close.textContent='×';
  close.onclick=()=>el.remove();

  el.append(message,close);
  container.appendChild(el);
  setTimeout(()=>{ if(el.isConnected) el.remove(); },tone==='error'?6000:4200);
}

// Convert registration-specific inline alert calls to the dedicated toast.
// This leaves login, logout, dashboard and other CampusCare toasts unchanged.
function routeRegistrationFeedbackToToast(){
  const reg=document.getElementById('reg-section');
  if(!reg) return;
  reg.querySelectorAll('.alert').forEach(a=>{
    if(a.textContent.trim()){
      const type=a.classList.contains('alert-error')?'error':
                 a.classList.contains('alert-success')?'success':'info';
      registrationToast(a.textContent.trim(),type);
      a.style.display='none';
    }
  });
}
