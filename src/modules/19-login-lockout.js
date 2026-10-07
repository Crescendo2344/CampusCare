// ================================================================
// LOGIN ATTEMPT LOCKOUT — basic brute-force protection
// ================================================================
const LOGIN_ATTEMPTS_KEY='campuscare_login_attempts';
const MAX_LOGIN_ATTEMPTS=5;
const LOCKOUT_MS=30000;

function getLoginAttempts(){
  try{ return JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY)||'{}'); }catch(e){ return {}; }
}
function setLoginAttempts(data){
  try{ localStorage.setItem(LOGIN_ATTEMPTS_KEY,JSON.stringify(data)); }catch(e){}
}

async function doLogin(){
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
  const loginBtn=document.querySelector('#login-section button[onclick="doLogin()"],#login-section .btn-primary');
  const loginBtnText=loginBtn?.textContent;
  if(loginBtn){loginBtn.disabled=true;loginBtn.textContent='Signing in…';}


  try{
    let email=identifier;
    if(!identifier.includes('@')){
      const response=await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`,{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':SUPABASE_PUBLISHABLE_KEY},
        body:JSON.stringify({identifier})
      });
      const resolved=await response.json().catch(()=>({}));
      if(!response.ok||!resolved.email) throw new Error('Invalid username/email or password.');
      email=resolved.email;
    }

    const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
    if(error) throw error;

    const {data:profile,error:profileError}=await supabaseClient
      .from('users').select('*').eq('auth_user_id',data.user.id).single();
    if(profileError||!profile){
      await supabaseClient.auth.signOut();
      throw new Error('CampusCare profile could not be loaded.');
    }
    if(profile.status==='Pending'){
      await supabaseClient.auth.signOut();
      throw new Error('Your registration is still pending administrator approval.');
    }
    if(profile.status==='Suspended'||profile.status==='Archived'){
      await supabaseClient.auth.signOut();
      throw new Error('This account is not currently active.');
    }

    currentUser=normalizeSupabaseUser(profile);
    currentUser.lastLogin=data.user?.last_sign_in_at||new Date().toISOString();
    currentUser.emailConfirmedAt=data.user?.email_confirmed_at||null;
    try{await auditAction({action:'record_session',event:'LOGIN'});}catch(e){console.error('Login audit:',e);}
    await syncCampusCareSessionUI();
    if(profile.role==='Administrator' && typeof refreshRealApprovalQueue==='function'){
      setTimeout(refreshRealApprovalQueue,300);
    }
  }catch(e){
    toast(e?.message||'Invalid username/email or password.','error');
  }finally{
    if(loginBtn){loginBtn.disabled=false;loginBtn.textContent=loginBtnText||'Login to CampusCare';}
  }
}

function checkPasswordStrength(pw){
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

function showPasswordChecklist(){
  // Only reveal the password guidance while the password field is active.
  const el=document.getElementById('r-pass-strength');
  if(el)el.classList.add('show');
  updatePasswordStrength();
}
function hidePasswordChecklist(){
  // Hide the guidance after the user leaves the password field.
  const el=document.getElementById('r-pass-strength');
  if(el)el.classList.remove('show');
}
function updatePasswordStrength(){
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



async function syncRegistrationPrivacyVersion(){
  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/privacy-public`,{
      method:'GET',
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY}
    });
    const result=await response.json().catch(()=>({}));
    if(response.ok&&result.ok){
      DB.settings.privacyPolicyVersion=result.privacy_policy_version||DB.settings.privacyPolicyVersion||'1.0';
      DB.settings.privacyPolicyUpdated=result.privacy_policy_updated||DB.settings.privacyPolicyUpdated||TODAY;
    }
  }catch(e){
    console.error('Public privacy version:',e);
  }
  return DB.settings.privacyPolicyVersion||'1.0';
}

async function privacyAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/privacy-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Privacy action failed.');
  return result;
}

async function syncPrivacyStatus(){
  if(!currentUser?._realSupabase)return null;
  const result=await privacyAction({action:'status'});
  DB.privacyStatus=result;
  DB.settings.privacyPolicyVersion=result.current_version||DB.settings.privacyPolicyVersion||'1.0';
  DB.settings.privacyPolicyUpdated=result.policy_updated||DB.settings.privacyPolicyUpdated||TODAY;
  return result;
}

async function syncPrivacyAdminSummary(){
  if(!currentUser?._realSupabase||currentUser.role!=='Administrator')return null;
  const result=await privacyAction({action:'admin_summary'});
  DB.privacyAdminSummary=result;
  return result;
}

async function openPrivacyNotice(){
  if(!currentUser){
    await syncRegistrationPrivacyVersion();
  }else if(currentUser?._realSupabase){
    try{await syncPublicSystemSettings();}catch(_){}
  }

  const v=DB.settings?.privacyPolicyVersion||'1.0';
  openModal(`<div class="modal modal-lg">
    <div class="modal-header"><h3>CampusCare Privacy Notice &amp; Consent</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
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

      <div class="tech-note" style="margin-top:.7rem">Privacy Notice version ${escapeHtml(v)} · Updated ${fmtDate(DB.settings?.privacyPolicyUpdated||TODAY)}</div>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="closeAllModals()">Close</button></div>
  </div>`);
}

function dataUrlToRegistrationFile(dataUrl, filename='capture.jpg'){
  const parts=String(dataUrl||'').split(',');
  if(parts.length<2)throw new Error('Captured image is invalid.');
  const mime=(parts[0].match(/data:(.*?);/)||[])[1]||'image/jpeg';
  const binary=atob(parts[1]);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new File([bytes],filename,{type:mime});
}

async function doRegister() {
  if(!initializeSupabaseClient()){
    registrationToast('Unable to connect to CampusCare. Please try again.','error');
    return;
  }

  const dobInput=document.getElementById('r-dob');
  if(dobInput&&!dobInput.max)dobInput.max=TODAY;

  const fname=document.getElementById('r-fname').value.trim();
  const lname=document.getElementById('r-lname').value.trim();
  const uname=document.getElementById('r-user').value.trim();
  const email=document.getElementById('r-email').value.trim().toLowerCase();
  const pass=document.getElementById('r-pass').value;
  const contact=document.getElementById('r-contact').value.trim();
  const ptype=document.getElementById('r-ptype').value;
  const college=document.getElementById('r-college').value;
  const idNo=document.getElementById('r-idno').value.trim();
  const dob=document.getElementById('r-dob').value;
  const sex=document.getElementById('r-sex').value;
  const fileInput=document.getElementById('r-id-file');
  const selfieInput=document.getElementById('r-selfie-file');
  const privacyConsent=document.getElementById('r-privacy-consent');

  if(!privacyConsent?.checked){
    registrationToast('Please read and agree to the CampusCare Privacy Notice and Consent before registering.','error');
    return;
  }
  if(!fname||!lname||!uname||!email||!pass){
    registrationToast('Name, username, email and password are required.','error');
    return;
  }
  if(fname.length>50||lname.length>50){
    registrationToast('First and last name must not exceed 50 characters.','error');
    return;
  }
  if(!/^[A-Za-z0-9_.-]{4,20}$/.test(uname)){
    registrationToast('Username must be 4–20 characters using letters, numbers, periods, underscores, or hyphens.','error');
    return;
  }
  if(email.length>150){
    registrationToast('Email must not exceed 150 characters.','error');
    return;
  }
  if(pass.length>64){
    registrationToast('Password must not exceed 64 characters.','error');
    return;
  }
  if(contact&&!/^09\d{9}$/.test(contact)){
    registrationToast('Contact number must contain 11 digits and start with 09.','error');
    return;
  }
  const expectedIdLength=ptype==='Student'?7:5;
  if(!new RegExp(`^\\d{${expectedIdLength}}$`).test(idNo)){
    registrationToast(
      ptype==='Student'
        ? 'Student ID must contain exactly 7 digits, for example 1350098.'
        : 'Employee ID must contain exactly 5 digits, for example 14982.',
      'error'
    );
    return;
  }
  if(!college){
    registrationToast(ptype==='Non-Teaching Personnel'?'Please select your department.':'Please select your college.','error');
    return;
  }
  if(!dob){
    registrationToast('Please enter your date of birth.','error');
    return;
  }
  if(dob>TODAY){
    registrationToast('Date of birth cannot be in the future.','error');
    return;
  }
  const ageYears=Math.floor((new Date(TODAY)-new Date(dob))/(365.25*24*60*60*1000));
  if(ageYears<10||ageYears>100){
    registrationToast('Please double-check your date of birth.','error');
    return;
  }
  if(!sex){
    registrationToast('Please select your sex.','error');
    return;
  }
  if(!checkPasswordStrength(pass).valid){
    registrationToast('Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.','error');
    return;
  }
  if(!selfieInput.files.length&&!capturedSelfieDataUrl){
    registrationToast('Please upload or capture a selfie photo for verification.','error');
    return;
  }
  if(!fileInput.files.length&&!capturedIdDataUrl){
    registrationToast(
      ptype==='Student'
        ? 'Please upload or capture your School ID or COR.'
        : 'Please upload or capture your Employee ID.',
      'error'
    );
    return;
  }

  let selfieFile,verificationFile;
  try{
    selfieFile=selfieInput.files[0]||dataUrlToRegistrationFile(capturedSelfieDataUrl,'profile.jpg');
    verificationFile=fileInput.files[0]||dataUrlToRegistrationFile(capturedIdDataUrl,'verification.jpg');
  }catch(e){
    registrationToast(e?.message||'Could not prepare the uploaded files.','error');
    return;
  }

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
    verification_document_type:ptype==='Student'?'School ID or COR':'Employee ID',
    date_of_birth:dob,
    sex,
    privacy_consent:true,
    privacy_policy_version:DB.settings?.privacyPolicyVersion||'1.0',
    privacy_consent_at:new Date().toISOString()
  };

  const form=new FormData();
  form.append('email',email);
  form.append('password',pass);
  form.append('metadata',JSON.stringify(metadata));
  form.append('selfie',selfieFile,selfieFile.name||'profile.jpg');
  form.append('verification',verificationFile,verificationFile.name||'verification');

  const submitBtn=document.querySelector('#reg-section button[onclick="doRegister()"]');
  const oldText=submitBtn?.textContent;
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Submitting securely…';}

  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/register-patient`,{
      method:'POST',
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY},
      body:form
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok){
      throw new Error(result.error||'Registration failed. Please try again.');
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

    ['r-fname','r-lname','r-user','r-email','r-pass','r-contact','r-idno','r-dob','r-sex']
      .forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    fileInput.value='';selfieInput.value='';
    const preview=document.getElementById('r-file-preview');if(preview)preview.textContent='';
    const consent=document.getElementById('r-privacy-consent');if(consent)consent.checked=false;
    capturedSelfieDataUrl=null;capturedIdDataUrl=null;
    updateRegistrationIdentityFields();
  }catch(e){
    registrationToast(e?.message||'Registration failed. Please try again.','error',6000);
  }finally{
    if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=oldText||'Submit Registration';}
  }
}

let pendingRegistrationEmail='';

function showPendingPanel(user){
  pendingRegistrationEmail=String(user?.email||'').trim();
  document.getElementById('login-section').style.display='none';
  document.getElementById('reg-section').style.display='none';
  document.getElementById('auth-tabs').style.display='none';
  document.getElementById('pending-name').textContent = user?`${user.fname} ${user.lname}`:'there';
  document.getElementById('pending-section').style.display='block';
}

function closePendingPanel(){
  document.getElementById('pending-section').style.display='none';
  document.getElementById('auth-tabs').style.display='flex';
  document.getElementById('li-user').value='';
  document.getElementById('li-pass').value='';
  authTab('login');
}

function maskVerificationEmail(email){
  const raw=String(email||'').trim();
  const parts=raw.split('@');
  if(parts.length!==2)return raw;
  const local=parts[0];
  const visible=local.length<=2?local.slice(0,1):local.slice(0,2);
  return `${visible}${'*'.repeat(Math.max(2,local.length-visible.length))}@${parts[1]}`;
}

async function resolveCampusCareEmail(identifier){
  const raw=String(identifier||'').trim().toLowerCase();
  if(!raw)throw new Error('Enter your registered username or email.');
  if(raw.includes('@'))return raw;

  const response=await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`,{
    method:'POST',
    headers:{'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY},
    body:JSON.stringify({identifier:raw})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.email)throw new Error('Unable to find a matching CampusCare registration.');
  return result.email;
}

function openResendVerification(prefill=''){
  const initial=String(prefill||document.getElementById('li-user')?.value||'').trim();
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><div><h3>Resend Verification Email</h3><div class="text-muted">For newly registered accounts whose confirmation link expired.</div></div><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <div id="resend-verify-msg"></div>
      <div class="form-group"><label>Username or Email</label><input id="resend-verify-id" maxlength="150" autocomplete="username" value="${escapeHtml(initial)}" placeholder="Enter your username or registered email"></div>
      <div class="alert alert-info show" style="font-size:.7rem">
        This requests a new signup-verification message. It does not create another registration and does not reset your password.
      </div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeAllModals()">Cancel</button><button class="btn btn-primary" id="resend-verify-btn" onclick="sendVerificationEmailAgain()">Send New Verification Email</button></div>
  </div>`);
}

async function sendVerificationEmailAgain(){
  const msg=document.getElementById('resend-verify-msg');
  const btn=document.getElementById('resend-verify-btn');
  const identifier=document.getElementById('resend-verify-id')?.value||'';
  if(!initializeSupabaseClient()){
    showAlert(msg,'CampusCare could not connect to the authentication service.');
    return;
  }

  try{
    if(btn){btn.disabled=true;btn.textContent='Sending…';}
    const email=await resolveCampusCareEmail(identifier);
    const {error}=await supabaseClient.auth.resend({
      type:'signup',
      email,
      options:{emailRedirectTo:`${CAMPUSCARE_APP_URL}?auth=confirmed`}
    });
    if(error)throw error;
    showAlert(
      msg,
      `A new verification message was requested for ${maskVerificationEmail(email)}. Open the newest CampusCare email and use that link; older expired links can be ignored.`,
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
