// authSession: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {initializeSupabaseClient} from './supabaseClient.js';
import {normalizeSupabaseUser,syncAdminDirectoryFromSupabase,syncCurrentPatientFromSupabase} from './patientService.js';
import {initApp} from './appInitialization.js';
import {syncPublicSystemSettings} from './systemSettings.js';
import {syncRealMedicationReminders,syncRealTreatments} from './treatmentService.js';
import {syncRealMessages} from './messaging.js';
import {syncRealHealthResources} from './navigationRaceProtection.js';
import {syncRealIssueReports} from './issueReports.js';
import {syncRealWorkflowRequests} from './workflowRequests.js';
import {syncRealCertificates} from './certificateService.js';
import {syncRealFitnessAssessments} from './fitnessAssessments.js';
import {syncRealInventory} from './inventoryService.js';
import {refreshRealApprovalQueue} from './approvalQueue.js';
import {registrationToast,toast} from './theme.js';
import {syncRealAppointments,syncRealDoctorDirectory} from './appointmentService.js';
import {rebuildConditionalNavigation,syncClinicSurveys} from './dentalSurvey.js';
import {renderDashboard} from './dashboard.js';
import {renderPage} from './loadingSkeletons.js';
export async function hydrateCurrentUserProfilePhoto(profile){
  if(!profile?.profile_image_url)return profile;

  try{
    const {data,error}=await appState.supabaseClient.supabaseClient.storage
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

// Single-flight restoration prevents simultaneous login/auth events from initializing twice.
export async function syncCampusCareSessionUI(){
  if(appState.auth.sessionSyncPromise)return appState.auth.sessionSyncPromise;
  const pending=restoreAuthenticatedAccount();
  appState.auth.sessionSyncPromise=pending;
  try{return await pending;}
  finally{if(appState.auth.sessionSyncPromise===pending)appState.auth.sessionSyncPromise=null;}
}
async function restoreAuthenticatedAccount(){
  if(!initializeSupabaseClient())return false;
  try{
    const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
    if(!session?.user)return false;

    const {data:profile,error}=await appState.supabaseClient.supabaseClient
      .from('users').select('*')
      .eq('auth_user_id',session.user.id)
      .single();

    if(error||!profile){
      console.error('CampusCare profile load failed:',error);
      return false;
    }

    const hydratedProfile=await hydrateCurrentUserProfilePhoto(profile);
    appState.auth.currentUser=normalizeSupabaseUser(hydratedProfile);
    appState.auth.currentUser.lastLogin=session.user.last_sign_in_at||profile.last_login_at||appState.auth.currentUser.lastLogin||'';
    appState.auth.currentUser.emailConfirmedAt=session.user.email_confirmed_at||null;

    if(String(appState.auth.currentUser.status).toLowerCase()!=='active'){
      await appState.supabaseClient.supabaseClient.auth.signOut();
      appState.auth.currentUser=null;appState.auth.currentPatient=null;
      return false;
    }

    // Open CampusCare immediately once the authenticated profile is available.
    // Do not keep the whole page blocked while secondary directory data loads.
    initApp();

    if(['Administrator','Staff','Doctor'].includes(appState.auth.currentUser.role)){
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
          if(['Staff','Administrator'].includes(appState.auth.currentUser.role)&&typeof syncRealInventory==='function'){
            try{await syncRealInventory(true);}catch(err){console.error('Inventory sync:',err);}
          }
          if(appState.auth.currentUser.role==='Administrator'&&typeof refreshRealApprovalQueue==='function'){
            try{await refreshRealApprovalQueue(false);}catch(err){console.error('Approval sync:',err);}
          }
          refreshActivePageAfterSync();
        })
        .catch(err=>{
          console.error('Clinical directory background sync:',err);
          toast('Some database data could not be refreshed. Open the page again to retry.','warning');
        });
    }else if(appState.auth.currentUser.role==='Patient'){
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

// Normalize a real Supabase user so the existing CampusCare UI can display it
// without showing generic "User / email / Role" placeholders.

export function fetchWithTimeout(url,options={},timeoutMs=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(url,{...options,signal:controller.signal})
    .finally(()=>clearTimeout(timer));
}

export function getActiveNavPageId(){
  const active=document.querySelector('#sidebar nav [id^="nav-"].active');
  return active?.id?.replace(/^nav-/,'')||'dashboard';
}

export function refreshActivePageAfterSync(){
  if(!appState.auth.currentUser)return;
  const pageId=getActiveNavPageId();

  // Sidebar state is authoritative only when it still matches the active
  // navigation token. This avoids a background Supabase sync reviving an
  // older page while the user is clicking elsewhere.
  if(pageId!==appState.navigationRaceProtection.campusActivePageId)return;

  try{
    if(pageId==='dashboard')renderDashboard();
    else renderPage(pageId);
  }catch(err){
    console.error('Page refresh after database sync:',err);
  }
}

// Registration has its own toast position so validation messages do not appear
// as large inline alerts inside the registration form.

// Convert registration-specific inline alert calls to the dedicated toast.
// This leaves login, logout, dashboard and other CampusCare toasts unchanged.
export function routeRegistrationFeedbackToToast(){
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

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
