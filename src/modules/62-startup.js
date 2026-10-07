// ── Keyboard ──
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAllModals();});

// Auto-check low stock on load (for demo)
setTimeout(()=>{
  const lowStock=getLowStock();
  if(lowStock.length&&currentUser&&!currentUser._realSupabase&&(currentUser.role==='Staff'||currentUser.role==='Administrator')){
    lowStock.forEach(i=>{
      if(!DB.notifications.find(n=>n.title.includes(i.name)&&n.userId===currentUser.id)){
        addNotif(currentUser.id,'Low Stock Alert',`${i.name} is below threshold: ${i.qty} ${i.unit} remaining.`,'danger');
      }
    });
  }
},500);

window.addEventListener('beforeunload',persistDB);

// Show the "back to top" button once the person has scrolled down a bit.
window.addEventListener('scroll',()=>{
  const btn=document.getElementById('back-to-top');
  if(!btn)return;
  btn.classList.toggle('show',window.scrollY>400);
});

// Restore the real Supabase session after refresh. Supabase persists the
// session in browser storage, so refreshing the page should not log the user out.
document.addEventListener('DOMContentLoaded',async()=>{
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

    const {data:{session:existingSession}}=await supabaseClient.auth.getSession();
    if(existingSession)restoreSkeleton?.classList.add('show');

    const restored=await Promise.race([
      syncCampusCareSessionUI(),
      new Promise(resolve=>setTimeout(()=>resolve(false),5000))
    ]);

    restoreSkeleton?.classList.remove('show');

    supabaseClient.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY' && new URLSearchParams(window.location.search).get('auth')==='recovery'){
        document.getElementById('app')?.classList.remove('visible');
        const auth=document.getElementById('auth-wrap');
        if(auth)auth.style.display='block';
        openForgotPassword(true);
        updateRecoveryPasswordStrength();
        return;
      }
      if(event==='SIGNED_IN'&&session&&!currentUser){
        setTimeout(()=>syncCampusCareSessionUI(),0);
      }
      if(event==='SIGNED_OUT'){
        currentUser=null;
        currentPatient=null;
        sessionStorage.removeItem(SESSION_KEY);
        resetAuthUiToLogin();
      }
    });

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
