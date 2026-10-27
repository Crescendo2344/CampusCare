// shellActions: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {authTab,landingNavTo,showAuthPage,showLandingPage} from './authentication.js';
import {hideAlert,toggleTheme} from './theme.js';
import {sanitizeInput,setRegistrationFieldError,validateRegistrationContact,validateRegistrationField} from './inputValidation.js';
import {closePendingPanel,doLogin,doRegister,hidePasswordChecklist,openPrivacyNotice,openResendVerification,showPasswordChecklist,updatePasswordStrength} from './loginLockout.js';
import {closeForgotPassword,hideRecoveryPasswordChecklist,logout,openForgotPassword,sendPasswordResetEmail,showForgotStep,showRecoveryPasswordChecklist,submitNewPassword,updateRecoveryPasswordStrength} from './passwordRecovery.js';
import {recheckNameMatch,sanitizeRegistrationId,updateRegistrationIdentityFields} from './documentScanner.js';
import {openCampusDatePicker} from './datePicker.js';
import {openCamera} from '../app/optional-features.js';
import {handleTopSearchKey,renderTopSearch,toggleSidebar} from './topbarAndNavigation.js';
import {openProfileDetails} from './accountSettings.js';
import {markAllRead,setNotificationFilter,toggleNotifPanel} from './assistant.js';
import {navTo} from './navigationRaceProtection.js';
import {handleRegistrationIdUpload,selectRegistrationIdSide,setVerificationScope} from './idVerification.js';
import {registerNamedAction} from '../dependencies.js';
import {prepareRegistrationCaptcha,resetRegistrationCaptcha} from '../verification/registration-captcha.js';
// Shell controls use registered lexical callbacks, never HTML inline JavaScript.

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  // Native buttons cover mouse, touch, Enter and Space without separate key handlers.
  registerNamedAction('dashboard-home',()=>navTo('dashboard'));
  registerNamedAction('shell-0',(event,element)=>{landingNavTo('home')});
  registerNamedAction('shell-1',(event,element)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();landingNavTo('home')}});
  registerNamedAction('shell-2',(event,element)=>{landingNavTo('home')});
  registerNamedAction('shell-3',(event,element)=>{landingNavTo('services')});
  registerNamedAction('shell-4',(event,element)=>{landingNavTo('about')});
  registerNamedAction('shell-5',(event,element)=>{landingNavTo('contact')});
  registerNamedAction('shell-6',(event,element)=>{showAuthPage('reg')});
  registerNamedAction('landing-book-appointment',()=>showAuthPage('login'));
  registerNamedAction('registration-contact-blur',(event,element)=>validateRegistrationContact(element));
  // Fields report their own error after the person leaves them, then update live while being corrected.
  registerNamedAction('registration-field-blur',(event,element)=>{validateRegistrationField(element.id)});
  registerNamedAction('registration-confirm-input',(event,element)=>{sanitizeInput(element,'password');validateRegistrationField(element.id,false)});
  registerNamedAction('shell-7',(event,element)=>{document.querySelector('.landing-nav-links').classList.toggle('mobile-show')});
  registerNamedAction('shell-8',(event,element)=>{showAuthPage('login')});
  registerNamedAction('shell-9',(event,element)=>{showLandingPage()});
  registerNamedAction('shell-11',(event,element)=>{event.preventDefault();authTab('login')});
  registerNamedAction('shell-12',(event,element)=>{event.preventDefault();authTab('reg')});
  registerNamedAction('shell-13',(event,element)=>{sanitizeInput(element,'password');clearLoginFieldError(element)});
  registerNamedAction('login-field-input',(event,element)=>clearLoginFieldError(element));
  registerNamedAction('shell-14',(event,element)=>{if(event.key==='Enter')doLogin()});
  registerNamedAction('shell-16',(event,element)=>{openForgotPassword();return false;});
  registerNamedAction('shell-17',(event,element)=>{doLogin()});
  registerNamedAction('shell-18',(event,element)=>{sanitizeInput(element,'name');validateRegistrationField(element.id,false);recheckNameMatch()});
  registerNamedAction('shell-19',(event,element)=>{sanitizeInput(element,'name');validateRegistrationField(element.id,false);recheckNameMatch()});
  registerNamedAction('shell-20',(event,element)=>{sanitizeInput(element,'username');validateRegistrationField(element.id,false)});
  registerNamedAction('shell-21',(event,element)=>{sanitizeInput(element,'email');validateRegistrationContact(element,false)});
  registerNamedAction('shell-22',(event,element)=>{showPasswordChecklist()});
  registerNamedAction('shell-23',(event,element)=>{sanitizeInput(element,'password');updatePasswordStrength();validateRegistrationField(element.id,false);validateRegistrationField('r-pass2',false)});
  registerNamedAction('shell-24',(event,element)=>{hidePasswordChecklist();validateRegistrationField(element.id)});
  registerNamedAction('shell-25',(event,element)=>{sanitizeInput(element,'phone');validateRegistrationContact(element,false)});
  registerNamedAction('shell-26',(event,element)=>{updateRegistrationIdentityFields();validateRegistrationField('r-idno',false)});
  registerNamedAction('shell-27',(event,element)=>{sanitizeRegistrationId(element);validateRegistrationField(element.id,false)});
  registerNamedAction('shell-28',(event,element)=>{openCampusDatePicker('r-dob','Select Date of Birth','',appState.clinicInformation.TODAY,'')});
  // Each side has its own accepted file and guided camera capture.
  for(const side of ['front','back']){
    registerNamedAction('id-'+side+'-upload',(event,input)=>{setVerificationScope('r');handleRegistrationIdUpload(input,side,'r');});
    registerNamedAction('id-show-'+side,()=>selectRegistrationIdSide(side,'r'));
  }
  // Public registration photos belong to the "r" scope; the clinic-assisted form uses its own.
  registerNamedAction('id-current-camera',()=>{setVerificationScope('r');openCamera('id-'+(appState.camera.registrationIdSide||'front'));});
  registerNamedAction('shell-30',(event,element)=>{setVerificationScope('r');openCamera('selfie')});
  registerNamedAction('shell-35',(event,element)=>{event.preventDefault();openPrivacyNotice()});
  registerNamedAction('registration-security-retry',()=>{resetRegistrationCaptcha();prepareRegistrationCaptcha(appState.supabaseClient.SUPABASE_URL,appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,{refresh:true}).catch(()=>{});});
  // Submitting the form (button or Enter) always runs client checks before any network request.
  registerNamedAction('registration-submit',(event,element)=>{event.preventDefault();doRegister()});
  registerNamedAction('shell-38',(event,element)=>{closePendingPanel()});
  registerNamedAction('pending-resend',()=>openResendVerification(appState.loginLockout.pendingRegistrationEmail));
  registerNamedAction('shell-39',(event,element)=>{sendPasswordResetEmail()});
  registerNamedAction('shell-40',(event,element)=>{closeForgotPassword()});
  registerNamedAction('shell-41',(event,element)=>{closeForgotPassword()});
  registerNamedAction('shell-42',(event,element)=>{showRecoveryPasswordChecklist()});
  registerNamedAction('shell-43',(event,element)=>{sanitizeInput(element,'password');updateRecoveryPasswordStrength()});
  registerNamedAction('shell-44',(event,element)=>{hideRecoveryPasswordChecklist()});
  registerNamedAction('shell-45',(event,element)=>{sanitizeInput(element,'password')});
  registerNamedAction('shell-46',(event,element)=>{submitNewPassword()});
  registerNamedAction('shell-47',(event,element)=>{showForgotStep(1)});
  registerNamedAction('shell-48',(event,element)=>{toggleSidebar(false)});
  registerNamedAction('shell-49',(event,element)=>{openProfileDetails()});
  registerNamedAction('shell-50',(event,element)=>{logout()});
  registerNamedAction('shell-51',(event,element)=>{toggleTheme()});
  registerNamedAction('shell-52',(event,element)=>{toggleSidebar()});
  registerNamedAction('shell-53',(event,element)=>{renderTopSearch(element.value)});
  registerNamedAction('shell-54',(event,element)=>{handleTopSearchKey(event)});
  registerNamedAction('shell-55',(event,element)=>{renderTopSearch(element.value)});
  registerNamedAction('shell-56',(event,element)=>{toggleNotifPanel()});
  registerNamedAction('shell-57',(event,element)=>{markAllRead()});
  registerNamedAction('notif-filter-all',()=>setNotificationFilter('all'));
  registerNamedAction('notif-filter-unread',()=>setNotificationFilter('unread'));
}

// Typing in a login field clears that field's message and the sign-in banner.
function clearLoginFieldError(element){
  if(element.value)setRegistrationFieldError(element.id,'');
  hideAlert(document.getElementById('login-err'));
}
