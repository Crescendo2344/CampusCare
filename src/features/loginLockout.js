// loginLockout: imported feature APIs; state belongs to explicit application namespaces.
import {normalizePhilippineMobile} from '../../supabase/functions/_shared/contact-validation.js';
import {state as appState} from '../app/state.js';
import {initializeSupabaseClient} from './supabaseClient.js';
import {registrationToast,showAlert,toast} from './theme.js';
import {normalizeSupabaseUser} from './patientService.js';
import {auditAction} from './emailDelivery.js';
import {syncCampusCareSessionUI} from './authSession.js';
import {refreshRealApprovalQueue} from './approvalQueue.js';
import {syncPublicSystemSettings} from './systemSettings.js';
import {closeAllModals,openModal} from './modals.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate,resetRegistrationFieldErrors,resetSelfiePreview,setRegistrationFieldError,validateRegistrationForm} from './inputValidation.js';
import {updateRegistrationIdentityFields} from './documentScanner.js';
import {authTab} from './authentication.js';
import {registrationIdSides,resetRegistrationIds} from './idVerification.js';
import {registrationCaptchaToken,resetRegistrationCaptcha} from '../verification/registration-captcha.js';
import {bindAction,createOperationalService} from '../dependencies.js';
// ================================================================
// LOGIN ATTEMPT LOCKOUT — basic brute-force protection
// ================================================================

export function getLoginAttempts(){
  try{ return JSON.parse(localStorage.getItem(appState.loginLockout.LOGIN_ATTEMPTS_KEY)||'{}'); }catch(e){ return {}; }
}
export function setLoginAttempts(data){
  try{ localStorage.setItem(appState.loginLockout.LOGIN_ATTEMPTS_KEY,JSON.stringify(data)); }catch(e){}
}

export async function doLogin(){
  // Ensure Supabase is ready before attempting authentication.
  if(!initializeSupabaseClient()){
    toast('Unable to connect to CampusCare right now. Please refresh and try again.','error');
    return;
  }

  // Supabase Auth signs in with email. For username login, the public Edge
  // Function resolves the CampusCare username to its associated email first.
  const identifier=document.getElementById('li-user').value.trim();
  const password=document.getElementById('li-pass').value;
  if(!identifier||!password){toast('Enter your username/email and password.','error');return;}
  const loginBtn=document.querySelector('#login-section .btn-primary');
  const loginBtnText=loginBtn?.textContent;
  if(loginBtn){loginBtn.disabled=true;loginBtn.textContent='Signing in…';}

  try{
    let email=identifier;
    if(!identifier.includes('@')){
      const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/resolve-login`,{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY},
        body:JSON.stringify({identifier})
      });
      const resolved=await response.json().catch(()=>({}));
      if(!response.ok||!resolved.email) throw new Error('Invalid username/email or password.');
      email=resolved.email;
    }

    const {data,error}=await appState.supabaseClient.supabaseClient.auth.signInWithPassword({email,password});
    if(error){if(error.code==='email_not_confirmed'||/email not confirmed/i.test(error.message||''))throw new Error('Verify your email before logging in. Check your inbox and spam folder, or use Resend verification email.');throw error;}

    // Also protect the UI if an Auth configuration is accidentally changed to allow unconfirmed sessions.
    if(!data.user?.email_confirmed_at){await appState.supabaseClient.supabaseClient.auth.signOut();throw new Error('Verify your email before logging in. Use Resend verification email if your link has expired.');}
    const {data:profile,error:profileError}=await appState.supabaseClient.supabaseClient
      .from('users').select('*').eq('auth_user_id',data.user.id).single();
    if(profileError||!profile){
      await appState.supabaseClient.supabaseClient.auth.signOut();
      throw new Error('CampusCare profile could not be loaded.');
    }
    if(profile.status==='Pending'){
      await appState.supabaseClient.supabaseClient.auth.signOut();
      throw new Error('Your registration is still pending administrator approval.');
    }
    if(profile.status==='Suspended'||profile.status==='Archived'){
      await appState.supabaseClient.supabaseClient.auth.signOut();
      throw new Error('This account is not currently active.');
    }

    appState.auth.currentUser=normalizeSupabaseUser(profile);
    appState.auth.currentUser.lastLogin=data.user?.last_sign_in_at||new Date().toISOString();
    appState.auth.currentUser.emailConfirmedAt=data.user?.email_confirmed_at||null;
    appState.auth.currentUser.emailVerificationSkipped=data.user?.app_metadata?.email_verification_skipped===true;
    try{await auditAction({action:'record_session',event:'LOGIN'});}catch(e){console.error('Login audit:',e);}
    await syncCampusCareSessionUI();
    if(profile.role==='Administrator' && typeof refreshRealApprovalQueue==='function'){
      setTimeout(refreshRealApprovalQueue,300);
    }
  }catch(e){
    toast(e?.message||'Invalid username/email or password.','error');
  }finally{
    if(loginBtn){loginBtn.disabled=false;loginBtn.textContent=loginBtnText||'Login';}
  }
}

export function checkPasswordStrength(pw){
  const checks={
    length: pw.length>=8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw)
  };
  const score=Object.values(checks).filter(Boolean).length;
  return {checks,score,valid:checks.length&&checks.upper&&checks.lower&&checks.number};
}

export function showPasswordChecklist(){
  // Only reveal the password guidance while the password field is active.
  const el=document.getElementById('r-pass-strength');
  if(el)el.classList.add('show');
  updatePasswordStrength();
}
export function hidePasswordChecklist(){
  // Hide the guidance after the user leaves the password field.
  const el=document.getElementById('r-pass-strength');
  if(el)el.classList.remove('show');
}
export function updatePasswordStrength(){
  const input=document.getElementById('r-pass');
  const el=document.getElementById('r-pass-strength');
  const label=document.getElementById('r-pass-strength-label');
  if(!input||!el)return;
  const pw=input.value;
  const {checks,score,valid}=checkPasswordStrength(pw);

  // Keep every checklist item live while the user types.
  el.querySelectorAll('.password-check').forEach(item=>{
    const key=item.dataset.check;
    item.classList.toggle('met',Boolean(checks[key]));
  });

  // Show an overall strength rating above the checklist as well.
  if(label){
    let strength='Weak password',cls='weak';
    if(valid&&score>=5){strength='Strong password';cls='strong';}
    else if(valid||score>=3){strength='Medium password';cls='medium';}
    label.textContent=strength;
    label.className='password-strength-label '+cls;
  }
}

export async function syncRegistrationPrivacyVersion(){
  try{
    const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/privacy-public`,{
      method:'GET',
      headers:{apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}
    });
    const result=await response.json().catch(()=>({}));
    if(response.ok&&result.ok){
      appState.data.DB.settings.privacyPolicyVersion=result.privacy_policy_version||appState.data.DB.settings.privacyPolicyVersion||'1.0';
      appState.data.DB.settings.privacyPolicyUpdated=result.privacy_policy_updated||appState.data.DB.settings.privacyPolicyUpdated||appState.clinicInformation.TODAY;
    }
  }catch(e){
    console.error('Public privacy version:',e);
  }
  return appState.data.DB.settings.privacyPolicyVersion||'1.0';
}

export async function privacyAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).privacyAction(payload);}

export async function syncPrivacyStatus(){
  if(!appState.auth.currentUser?._realSupabase)return null;
  const result=await privacyAction({action:'status'});
  appState.data.DB.privacyStatus=result;
  appState.data.DB.settings.privacyPolicyVersion=result.current_version||appState.data.DB.settings.privacyPolicyVersion||'1.0';
  appState.data.DB.settings.privacyPolicyUpdated=result.policy_updated||appState.data.DB.settings.privacyPolicyUpdated||appState.clinicInformation.TODAY;
  return result;
}

export async function syncPrivacyAdminSummary(){
  if(!appState.auth.currentUser?._realSupabase||appState.auth.currentUser.role!=='Administrator')return null;
  const result=await privacyAction({action:'admin_summary'});
  appState.data.DB.privacyAdminSummary=result;
  return result;
}

export async function openPrivacyNotice(){
  if(!appState.auth.currentUser){
    await syncRegistrationPrivacyVersion();
  }else if(appState.auth.currentUser?._realSupabase){
    try{await syncPublicSystemSettings();}catch(_){}
  }

  const v=appState.data.DB.settings?.privacyPolicyVersion||'1.0';
  openModal(`<div class="modal modal-lg privacy-notice">
    <div class="modal-header"><h3>CampusCare Privacy Notice &amp; Consent</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body" style="font-size:.8rem;line-height:1.65">
      <div class="alert alert-info show">CampusCare is designed to support responsible processing of personal and health information under the Data Privacy Act of 2012 (RA 10173). Actual institutional compliance also depends on CTU policies, personnel, security controls, and lawful records-management procedures.</div>
      <div class="alert alert-success show" style="margin-top:.55rem">
        <strong>Clinic-posted privacy statement:</strong> Personal and sensitive information provided during consultation is collected,
        stored, and processed by the CTU Medical/Dental Clinic for the purpose of providing medical or dental care. The posted notice
        states that information is kept confidential and is not shared with third parties except when required by law or to fulfill medical
        and legal obligations, and that patients may request access, correction, or deletion in accordance with the Data Privacy Act.
      </div>

      <h4 style="margin:.7rem 0 .25rem">Information collected</h4>
      <p>Identity and contact information, school or employee information, profile and verification images, appointment information, medical and dental records, consultation findings, diagnoses, prescriptions, procedures, certificates, secure clinic messages, consent records, and security or audit events relevant to clinic operations.</p>

      <h4 style="margin:.7rem 0 .25rem">Purpose of processing</h4>
      <p>Patient identification and verification, clinic registration, appointment scheduling, medical and dental care, treatment documentation, certificate processing, authorized clinic communication, operational reporting, patient safety, audit and accountability, inventory planning, system security, and service improvement.</p>

      <h4 style="margin:.7rem 0 .25rem">Access and protection</h4>
      <p>Access is role-based and should follow the minimum-necessary principle. CampusCare uses authenticated accounts, row-level access controls, private file storage for sensitive uploads, server-side audit logs, and protected database backups. Users should not send unnecessary confidential information through channels outside CampusCare.</p>

      <h4 style="margin:.7rem 0 .25rem">Retention and data-subject requests</h4>
      <p>Records may need to be retained according to applicable CTU clinic, medical-record, contractual, safety, or legal requirements. A request to withdraw consent does not automatically erase clinical records when another lawful basis or retention requirement applies. Appropriate access, correction, objection, or privacy requests should be reviewed by authorized CTU personnel.</p>

      <h4 style="margin:.7rem 0 .25rem">Consent and acknowledgement</h4>
      <p>By acknowledging the current notice, the user confirms that this information has been presented and agrees to processing that relies on consent. This acknowledgement does not waive rights provided by applicable privacy law.</p>

      <div class="tech-note" style="margin-top:.7rem">Privacy Notice version ${escapeHtml(v)} · Updated ${fmtDate(appState.data.DB.settings?.privacyPolicyUpdated||appState.clinicInformation.TODAY)}</div>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button></div>
  </div>`);
}

export function dataUrlToRegistrationFile(dataUrl, filename='capture.jpg'){
  const parts=String(dataUrl||'').split(',');
  if(parts.length<2)throw new Error('Captured image is invalid.');
  const mime=(parts[0].match(/data:(.*?);/)||[])[1]||'image/jpeg';
  const binary=atob(parts[1]);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new File([bytes],filename,{type:mime});
}

const REGISTRATION_SERVER_FIELDS={first_name:'r-fname',last_name:'r-lname',username:'r-user',email:'r-email',password:'r-pass',contact_number:'r-contact',college:'r-college',id_number:'r-idno',birth_date:'r-dob',sex:'r-sex'};

export async function doRegister() {
  if(!initializeSupabaseClient()){
    registrationToast('Unable to connect to CampusCare. Please try again.','error');
    return;
  }

  const dobInput=document.getElementById('r-dob');
  if(dobInput&&!dobInput.max)dobInput.max=appState.clinicInformation.TODAY;

  const fname=document.getElementById('r-fname').value.trim();
  const lname=document.getElementById('r-lname').value.trim();
  const uname=document.getElementById('r-user').value.trim();
  const email=document.getElementById('r-email').value.trim().toLowerCase();
  const pass=document.getElementById('r-pass').value;
  const contactRaw=document.getElementById('r-contact').value.trim();
  const contact=normalizePhilippineMobile(contactRaw);
  const ptype=document.getElementById('r-ptype').value;
  const college=document.getElementById('r-college').value;
  const idNo=document.getElementById('r-idno').value.trim();
  const dob=document.getElementById('r-dob').value;
  const sex=document.getElementById('r-sex').value;
  const idSides=registrationIdSides();

  // Show every problem beside its field, like a standard sign-up form, then move to the first one.
  const invalid=validateRegistrationForm();
  if(invalid.length){
    const first=invalid[0];
    const target=first==='r-dob'?document.getElementById('r-dob-button'):first==='r-selfie'?document.getElementById('selfie-camera-button'):first==='r-id'?document.getElementById('r-id-camera-button'):document.getElementById(first);
    target?.scrollIntoView?.({block:'center',behavior:'smooth'});
    target?.focus?.({preventScroll:true});
    registrationToast(invalid.length===1?'Please fix the highlighted field.':`Please fix the ${invalid.length} highlighted fields.`,'error');
    return;
  }
  let captchaToken;
  try{captchaToken=await registrationCaptchaToken(appState.supabaseClient.SUPABASE_URL,appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY);}
  catch(error){registrationToast(error.message,'error');return;}
  let selfieFile,verificationFile,verificationBackFile;
  try{
    selfieFile=dataUrlToRegistrationFile(appState.camera.capturedSelfieDataUrl,'selfie-verification.jpg');
    verificationFile=idSides.front.file||dataUrlToRegistrationFile(idSides.front.dataUrl,'id-front.jpg');
    verificationBackFile=idSides.back.file||dataUrlToRegistrationFile(idSides.back.dataUrl,'id-back.jpg');
  }catch(error){registrationToast(error?.message||'Could not prepare the ID photos.','error');return;}


  await syncRegistrationPrivacyVersion();

  const metadata={
    first_name:fname,
    last_name:lname,
    username:uname,
    contact_no:contact,
    person_type:ptype,
    college,
    id_number:idNo,
    registration_context:'public',
    verification_document_type:ptype==='Student'?'Student ID':'Employee ID',
    date_of_birth:dob,
    sex,
    privacy_consent:true,
    privacy_policy_version:appState.data.DB.settings?.privacyPolicyVersion||'1.0',
    privacy_consent_at:new Date().toISOString()
  };

  const form=new FormData();
  // The server verifies this one-time token before creating an account.
  form.append('captcha_token',captchaToken);
  form.append('email',email);
  form.append('password',pass);
  form.append('metadata',JSON.stringify(metadata));
  form.append('selfie',selfieFile,'selfie-verification.jpg');
  // Registration selfies come only from the live camera flow, with staff checking the evidence.
  form.append('selfie_capture_source','camera');
  form.append('verification',verificationFile,verificationFile.name||'id-front');
  form.append('verification_back',verificationBackFile,verificationBackFile.name||'id-back');

  const submitBtn=document.getElementById('registration-submit-button');
  const oldText=submitBtn?.textContent;
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Submitting securely…';}

  try{
    const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/register-patient`,{
      method:'POST',
      headers:{apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY},
      body:form
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok){
      throw Object.assign(new Error(result.error||'Registration failed. Please try again.'),{fieldErrors:result.field_errors});
    }

    registrationToast(
      result.email_confirmation_required
        ? 'Registration submitted. Check your email, then wait for administrator approval.'
        : 'Registration submitted. Please wait for administrator approval.',
      'success',
      6500
    );

    // Show the existing pending-registration screen without storing the account locally.
    showPendingPanel({
      fname,lname,username:uname,email,personType:ptype,college,idNo,
      dob,sex,status:'Pending'
    });

    ['r-fname','r-lname','r-user','r-email','r-pass','r-pass2','r-contact','r-idno','r-dob','r-sex']
      .forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const dobLabel=document.getElementById('r-dob-label');if(dobLabel)dobLabel.textContent='Select date';
    resetRegistrationIds();
    resetSelfiePreview();
    resetRegistrationFieldErrors();
    const preview=document.getElementById('r-file-preview');if(preview)preview.textContent='';
    const consent=document.getElementById('r-privacy-consent');if(consent)consent.checked=false;
    appState.camera.capturedSelfieDataUrl=null;appState.camera.capturedIdDataUrl=null;
    updateRegistrationIdentityFields();
  }catch(e){
    // Server field problems (for example a taken username) appear beside the field, like client checks.
    const fields=Object.entries(e?.fieldErrors||{}).filter(([key])=>REGISTRATION_SERVER_FIELDS[key]);
    fields.forEach(([key,message])=>setRegistrationFieldError(REGISTRATION_SERVER_FIELDS[key],String(message)));
    if(fields.length)document.getElementById(REGISTRATION_SERVER_FIELDS[fields[0][0]])?.focus();
    registrationToast(fields.length?'Please fix the highlighted fields.':e?.message||'Registration failed. Please try again.','error',6000);
  }finally{
    // Tokens are one-time use, including failed submissions that reached verification.
    resetRegistrationCaptcha();
    if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=oldText||'Submit Registration';}
  }
}

export function showPendingPanel(user){
  appState.loginLockout.pendingRegistrationEmail=String(user?.email||'').trim();
  document.getElementById('login-section').style.display='none';
  document.getElementById('reg-section').style.display='none';
  document.getElementById('auth-tabs').style.display='none';
  document.getElementById('pending-name').textContent = user?`${user.fname} ${user.lname}`:'there';
  const pendingEmail=document.getElementById('pending-email');
  if(pendingEmail)pendingEmail.textContent=user?.email?maskVerificationEmail(user.email):'your email';
  document.getElementById('pending-section').style.display='block';
}

export function closePendingPanel(){
  document.getElementById('pending-section').style.display='none';
  document.getElementById('auth-tabs').style.display='';
  document.getElementById('li-user').value='';
  document.getElementById('li-pass').value='';
  authTab('login');
}

export function maskVerificationEmail(email){
  const raw=String(email||'').trim();
  const parts=raw.split('@');
  if(parts.length!==2)return raw;
  const local=parts[0];
  const visible=local.length<=2?local.slice(0,1):local.slice(0,2);
  return `${visible}${'*'.repeat(Math.max(2,local.length-visible.length))}@${parts[1]}`;
}

export function openResendVerification(prefill=''){
  const initial=String(prefill||document.getElementById('li-user')?.value||'').trim();
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><div><h3>Resend Verification Email</h3><div class="text-muted">For newly registered accounts whose confirmation link expired.</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="resend-verify-msg"></div>
      <div class="form-group"><label>Username or Email</label><input id="resend-verify-id" maxlength="150" autocomplete="username" value="${escapeHtml(initial)}" placeholder="Enter your username or registered email"></div>
      <div class="alert alert-info show" style="font-size:.7rem">
        This requests a new signup-verification message. It does not create another registration and does not reset your password.
      </div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-primary" id="resend-verify-btn" ${bindAction('click',(event,element)=>{sendVerificationEmailAgain()})}>Send New Verification Email</button></div>
  </div>`);
}

export async function sendVerificationEmailAgain(){
  const msg=document.getElementById('resend-verify-msg');
  const btn=document.getElementById('resend-verify-btn');
  const identifier=document.getElementById('resend-verify-id')?.value||'';
  if(!initializeSupabaseClient()){
    showAlert(msg,'CampusCare could not connect to the authentication service.');
    return;
  }

  try{
    if(btn){btn.disabled=true;btn.textContent='Sending…';}
    // The server checks the CampusCare profile and Auth account before requesting any email.
    const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/resend-verification`,{
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY},
      body:JSON.stringify({identifier})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Unable to resend the verification email.');
    showAlert(
      msg,
      'A new verification email has been sent to your registered address. Open the newest CampusCare email to confirm your account.',
      'success'
    );
  }catch(e){
    const message=String(e?.message||'Unable to resend the verification email.');
    showAlert(
      msg,
      /rate|too many|seconds/i.test(message)
        ? 'Please wait a short time before requesting another verification email.'
        : message
    );
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Send New Verification Email';}
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.loginLockout.LOGIN_ATTEMPTS_KEY='campuscare_login_attempts';
  appState.loginLockout.MAX_LOGIN_ATTEMPTS=5;
  appState.loginLockout.LOCKOUT_MS=30000;
  appState.loginLockout.pendingRegistrationEmail='';
}
