// loginLockout: imported feature APIs; state belongs to explicit application namespaces.
import {normalizePhilippineMobile} from '../../supabase/functions/_shared/contact-validation.js';
import {state as appState} from '../app/state.js';
import {initializeSupabaseClient,setRememberSessionPreference,setRememberedLogin} from './supabaseClient.js';
import {clearToasts,registrationToast,showAlert,toast} from './theme.js';
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
  if(!identifier||!password){toast('Enter your username/email and password.','error');document.getElementById(identifier?'li-pass':'li-user')?.focus();return;}
  setRememberSessionPreference(Boolean(document.getElementById('li-remember')?.checked));
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

    // Only a successful sign-in updates the remembered username or email.
    setRememberedLogin(document.getElementById('li-remember')?.checked?identifier:'');
    appState.auth.currentUser=normalizeSupabaseUser(profile);
    appState.auth.currentUser.lastLogin=data.user?.last_sign_in_at||new Date().toISOString();
    appState.auth.currentUser.emailConfirmedAt=data.user?.email_confirmed_at||null;
    appState.auth.currentUser.emailVerificationSkipped=data.user?.app_metadata?.email_verification_skipped===true;
    try{await auditAction({action:'record_session',event:'LOGIN'});}catch(e){console.error('Login audit:',e);}
    clearToasts();
    await syncCampusCareSessionUI();
    if(profile.role==='Administrator' && typeof refreshRealApprovalQueue==='function'){
      setTimeout(refreshRealApprovalQueue,300);
    }
  }catch(e){
    // Auth's own wording ("Invalid login credentials") is replaced with the same message used everywhere else.
    const message=String(e?.message||'');
    toast(!message||/invalid login credentials/i.test(message)?'Invalid username/email or password.':message,'error');
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
  // Guidance shows only while the password field is focused.
  afterPointerRelease(()=>{if(document.activeElement?.id!=='r-pass')document.getElementById('r-pass-strength')?.classList.remove('show');});
}

// Collapsing a checklist while a mouse or finger is still pressed moves the controls below it,
// so the press ends on a different element and the click is lost. Wait for the release instead.
let pointerPressed=false;
if(typeof document!=='undefined'){
  document.addEventListener('pointerdown',()=>{pointerPressed=true;},true);
  document.addEventListener('pointerup',()=>{pointerPressed=false;},true);
  document.addEventListener('pointercancel',()=>{pointerPressed=false;},true);
}
export function afterPointerRelease(callback){
  if(!pointerPressed){callback();return;}
  const run=()=>{document.removeEventListener('click',run,true);document.removeEventListener('pointerup',later,true);setTimeout(callback,0);};
  const later=()=>setTimeout(run,0);
  document.addEventListener('click',run,true);
  document.addEventListener('pointerup',later,true);
}
export function updatePasswordStrength(){
  const input=document.getElementById('r-pass');
  const el=document.getElementById('r-pass-strength');
  const label=document.getElementById('r-pass-strength-label');
  if(!input||!el)return;
  const pw=input.value;
  const {checks}=checkPasswordStrength(pw);

  // Keep every checklist item live while the user types.
  el.querySelectorAll('.password-check').forEach(item=>{
    const key=item.dataset.check;
    item.classList.toggle('met',Boolean(checks[key]));
  });

  renderPasswordStrength(el,label,pw);
}

// Four bars plus a word rating, shared by registration and password reset.
const STRENGTH_WORDS=['','Weak','Fair','Good','Excellent'];
export function renderPasswordStrength(container,label,pw){
  const {score,valid}=checkPasswordStrength(pw);
  const level=!pw?0:valid&&score>=5?4:valid?3:score>=3?2:1;
  container.dataset.level=String(level);
  if(label){
    label.textContent=level?'Password strength: '+STRENGTH_WORDS[level]:'Password strength';
    label.className='password-strength-label '+(level>=4?'strong':level>=3?'medium':'weak');
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
  const updated=fmtDate(appState.data.DB.settings?.privacyPolicyUpdated||appState.clinicInformation.TODAY);
  const sections=[
    ['collect','bi-clipboard2-data','Information we collect',`<ul class="pn-list">
      <li><strong>Identity &amp; contact</strong> — name, username, email, mobile number, birth date and sex.</li>
      <li><strong>School or work details</strong> — college or department, ID number, class session.</li>
      <li><strong>Verification images</strong> — profile photo, selfie and Student/Employee ID photos.</li>
      <li><strong>Health records</strong> — appointments, consultation findings, diagnoses, prescriptions, procedures, dental records and certificates.</li>
      <li><strong>Communication &amp; security</strong> — secure clinic messages, consent records, sign-in and audit events.</li></ul>`],
    ['purpose','bi-bullseye','Why we use it',`<p>To identify and verify patients, register clinic accounts, schedule appointments, provide medical and dental care, document treatment, process certificates, send authorized clinic notices, and keep patients safe. It is also used for audit and accountability, operational reports, inventory planning, system security and service improvement.</p>`],
    ['protect','bi-lock','Who can see it and how it is protected',`<p>Access is role-based and limited to what each person needs for their work. CampusCare uses:</p>
      <div class="pn-chips"><span><i class="bi bi-person-check"></i> Authenticated accounts</span><span><i class="bi bi-diagram-3"></i> Row-level access rules</span><span><i class="bi bi-folder-lock"></i> Private file storage</span><span><i class="bi bi-journal-check"></i> Server-side audit logs</span><span><i class="bi bi-hdd-stack"></i> Protected backups</span></div>
      <p class="pn-muted">Please avoid sending confidential details through channels outside CampusCare.</p>`],
    ['retention','bi-archive','How long records are kept',`<p>Records are kept as required by CTU clinic, medical-record, safety and legal rules. Withdrawing consent does not automatically erase clinical records when another lawful basis or retention requirement applies.</p>`],
    ['rights','bi-person-badge','Your rights under the Data Privacy Act',`<div class="pn-rights">
      <div><i class="bi bi-info-circle"></i><strong>Be informed</strong><span>Know how your data is used.</span></div>
      <div><i class="bi bi-eye"></i><strong>Access</strong><span>Request a copy of your records.</span></div>
      <div><i class="bi bi-pencil-square"></i><strong>Correct</strong><span>Fix inaccurate details.</span></div>
      <div><i class="bi bi-hand-thumbs-down"></i><strong>Object</strong><span>Object to processing based on consent.</span></div>
      <div><i class="bi bi-eraser"></i><strong>Erase or block</strong><span>Where no lawful basis remains.</span></div>
      <div><i class="bi bi-box-arrow-up-right"></i><strong>Data portability</strong><span>Get your data in a usable format.</span></div>
      <div><i class="bi bi-cash-coin"></i><strong>Damages</strong><span>Claim for misuse of your data.</span></div>
      <div><i class="bi bi-megaphone"></i><strong>File a complaint</strong><span>With the National Privacy Commission.</span></div></div>
      <p class="pn-muted">Requests are reviewed by authorized CTU personnel. Contact the CTU Medical/Dental Clinic to make one.</p>`],
    ['consent','bi-check2-circle','Consent and acknowledgement',`<p>Acknowledging this notice confirms it was shown to you and that you agree to processing that relies on consent. It does not waive any right you have under privacy law.</p>`]
  ];
  openModal(`<div class="modal modal-lg privacy-notice" aria-labelledby="pn-title">
    <div class="modal-header pn-header"><div class="pn-title"><span class="pn-badge" aria-hidden="true"><i class="bi bi-shield-lock"></i></span><div><h3 id="pn-title">Privacy Notice &amp; Consent</h3><p>Version ${escapeHtml(v)} · Updated ${escapeHtml(updated)} · Republic Act 10173</p></div></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body pn-body">
      <div class="pn-glance" role="list" aria-label="At a glance">
        <div role="listitem"><i class="bi bi-clipboard2-data"></i><strong>What</strong><span>Identity, school and health records</span></div>
        <div role="listitem"><i class="bi bi-bullseye"></i><strong>Why</strong><span>To provide and document your clinic care</span></div>
        <div role="listitem"><i class="bi bi-lock"></i><strong>Who</strong><span>Only authorized clinic personnel</span></div>
        <div role="listitem"><i class="bi bi-person-badge"></i><strong>Your rights</strong><span>Access, correct, object and more</span></div>
      </div>
      <blockquote class="pn-statement"><span class="pn-statement-label"><i class="bi bi-hospital"></i> Posted at the CTU Medical/Dental Clinic</span>
        Personal and sensitive information provided during consultation is collected, stored, and processed by the CTU Medical/Dental Clinic to provide medical or dental care. It is kept confidential and is not shared with third parties except when required by law or to fulfill medical and legal obligations. Patients may request access, correction, or deletion in accordance with the Data Privacy Act.</blockquote>
      <nav class="pn-toc" aria-label="Sections">${sections.map(([id,,title],i)=>`<button type="button" ${bindAction('click',()=>document.getElementById('pn-'+id)?.scrollIntoView({behavior:'smooth',block:'start'}))}>${i+1}. ${title}</button>`).join('')}</nav>
      ${sections.map(([id,icon,title,body],i)=>`<section class="pn-section" id="pn-${id}"><h4><span class="pn-num">${i+1}</span><i class="bi ${icon}" aria-hidden="true"></i>${title}</h4>${body}</section>`).join('')}
      <p class="pn-disclaimer"><i class="bi bi-info-circle"></i> CampusCare supports responsible processing of personal and health information under the Data Privacy Act of 2012. Actual institutional compliance also depends on CTU policies, personnel, security controls and lawful records-management procedures.</p>
    </div>
    <div class="modal-footer pn-footer"><button type="button" class="btn" ${bindAction('click',()=>printPrivacyNotice())}><i class="bi bi-printer"></i> Print</button><button type="button" class="btn btn-primary" ${bindAction('click',()=>closeAllModals())}>I understand</button></div>
  </div>`);
}

function printPrivacyNotice(){
  const body=document.querySelector('.privacy-notice .pn-body');
  if(!body)return;
  const win=window.open('','_blank','noopener=no,width=820,height=900');
  if(!win){toast('Allow pop-ups to print the privacy notice.','warning');return;}
  const title=document.querySelector('.privacy-notice .pn-title')?.innerText||'Privacy Notice';
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>CampusCare Privacy Notice</title><style>body{font:14px/1.6 system-ui,sans-serif;color:#111;max-width:720px;margin:2rem auto;padding:0 1rem}h4{margin:1.2rem 0 .3rem}.pn-toc,i{display:none}.pn-glance,.pn-rights{display:grid;grid-template-columns:repeat(2,1fr);gap:.4rem}.pn-glance div,.pn-rights div{border:1px solid #ccc;border-radius:6px;padding:.4rem .6rem;display:flex;flex-direction:column}.pn-chips span{display:inline-block;border:1px solid #ccc;border-radius:99px;padding:.1rem .5rem;margin:.15rem}blockquote{border-left:3px solid #2a7;margin:1rem 0;padding:.3rem .9rem;background:#f4faf6}.pn-num{font-weight:700;margin-right:.4rem}</style></head><body><h2>${escapeHtml(title)}</h2>${body.innerHTML}</body></html>`);
  win.document.close();win.focus();win.print();
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

    // The pending screen itself confirms the submission and lists the next steps.
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
  clearToasts();
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
