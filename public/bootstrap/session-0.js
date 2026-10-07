
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
function normalizeSupabaseUser(profile){
  if(!profile)return profile;
  const dbUserId=Number(profile.user_id??profile.dbUserId??profile.id);
  return {
    ...profile,
    // Keep real DB IDs separately; UI IDs are offset so they never collide
    // with the old demo records while modules are being migrated.
    id: Number.isFinite(dbUserId) ? 100000+dbUserId : profile.id,
    dbUserId,
    authUserId: profile.auth_user_id??profile.authUserId,
    fname: profile.first_name??profile.fname??'',
    lname: profile.last_name??profile.lname??'',
    username: profile.username??'',
    email: profile.email??'',
    role: profile.role??'Patient',
    status: profile.status??'Pending',
    archived:String(profile.status||'').toLowerCase()==='archived',
    verified: profile.verified??false,
    contact: profile.contact_number??profile.contact??'',
    contactNo: profile.contact_number??profile.contactNo??'',
    personType: profile.person_type??profile.personType??'',
    college: profile.college??'',
    idNo: profile.id_number??profile.idNo??'',
    profileImage: profile.profile_signed_url??profile.profileImage??'',
    profilePhoto: profile.profile_signed_url??profile.profilePhoto??'',
    specialty: profile.specialty??'',
    workDays: profile.work_days??profile.workDays??[],
    startTime: profile.start_time??profile.startTime??'',
    endTime: profile.end_time??profile.endTime??'',
    slotDuration: profile.slot_duration??profile.slotDuration??60,
    maxPatients: profile.max_patients??profile.maxPatients??20,
    createdAt: profile.created_at??profile.createdAt??'',
    lastLogin: profile.last_login_at??profile.lastLogin??'',
    passwordChangedAt: profile.password_changed_at??profile.passwordChangedAt??'',
    savedSignature: profile.saved_signature_data??profile.savedSignature??'',
    _realSupabase:true
  };
}


function fetchWithTimeout(url,options={},timeoutMs=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(url,{...options,signal:controller.signal})
    .finally(()=>clearTimeout(timer));
}

async function fetchAdminDirectory(){
  // Doctors and Staff also need the clinical directory so real
  // appointments can resolve their patient/doctor relationships.
  if(!['Administrator','Staff','Doctor'].includes(currentUser?.role))return [];

  // Administrator RLS policies already allow read access to users and patients,
  // so load the directory directly from Supabase instead of waiting on an Edge Function.
  const [{data:users,error:userErr},{data:patients,error:patientErr}]=await Promise.all([
    supabaseClient.from('users')
      .select('user_id,auth_user_id,first_name,last_name,username,email,contact_number,role,status,verified,person_type,college,id_number,profile_image_url,specialty,work_days,start_time,end_time,slot_duration,max_patients,created_at,last_login_at,password_changed_at,saved_signature_data')
      .order('user_id',{ascending:true}),
    supabaseClient.from('patients')
      .select('patient_id,user_id,birth_date,sex,blood_type,address,height_cm,weight_kg,emergency_contact_name,emergency_contact_number,medical_history,allergies,archived_at,updated_at')
      .order('patient_id',{ascending:true})
  ]);

  if(userErr)throw userErr;
  if(patientErr)throw patientErr;

  const patientByUser=new Map((patients||[]).map(p=>[Number(p.user_id),p]));
  const rows=[];

  for(const u of users||[]){
    let profileSignedUrl=null;
    if(u.profile_image_url){
      try{
        const {data:signed}=await supabaseClient.storage
          .from('campuscare-profiles')
          .createSignedUrl(u.profile_image_url,3600);
        profileSignedUrl=signed?.signedUrl||null;
      }catch(_){}
    }
    rows.push({
      ...u,
      patient:patientByUser.get(Number(u.user_id))||null,
      profile_signed_url:profileSignedUrl
    });
  }
  return rows;
}

function ageFromBirthDate(date){
  if(!date)return '';
  const d=new Date(`${date}T00:00:00`);
  if(Number.isNaN(d.getTime()))return '';
  const now=new Date();
  let age=now.getFullYear()-d.getFullYear();
  const md=now.getMonth()-d.getMonth();
  if(md<0||(md===0&&now.getDate()<d.getDate()))age--;
  return age;
}

function directoryRowToPatient(u){
  const p=u.patient;
  if(!p)return null;
  const uiUser=normalizeSupabaseUser(u);
  return {
    id:200000+Number(p.patient_id),
    dbPatientId:Number(p.patient_id),
    userId:uiUser.id,
    dbUserId:uiUser.dbUserId,
    fname:uiUser.fname,
    lname:uiUser.lname,
    age:ageFromBirthDate(p.birth_date),
    birthDate:p.birth_date||'',
    gender:p.sex||'',
    blood:p.blood_type||'Unknown',
    address:p.address||'',
    college:uiUser.college||'',
    personType:uiUser.personType||'',
    idNo:uiUser.idNo||'',
    height:p.height_cm?`${p.height_cm}cm`:'',
    weight:p.weight_kg?`${p.weight_kg}kg`:'',
    contact:uiUser.contact||'',
    emergencyName:p.emergency_contact_name||'',
    emergencyContact:p.emergency_contact_number||'',
    medHistory:p.medical_history||'',
    allergies:p.allergies||'',
    archived:!!p.archived_at,
    profilePhoto:uiUser.profilePhoto||'',
    createdAt:uiUser.createdAt||'',
    _realSupabase:true
  };
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

async function syncAdminDirectoryFromSupabase(){
  if(!['Administrator','Staff','Doctor'].includes(currentUser?.role))return;
  const rows=await fetchAdminDirectory();

  // Remove prior synced real records, then insert fresh authoritative copies.
  DB.users=(DB.users||[]).filter(u=>!u._realSupabase);
  DB.patients=(DB.patients||[]).filter(p=>!p._realSupabase);

  for(const row of rows){
    const user=normalizeSupabaseUser(row);
    DB.users.push(user);
    const patient=directoryRowToPatient(row);
    if(patient)DB.patients.push(patient);

    // Keep the signed profile URL on the currently logged-in administrator too.
    if(row.auth_user_id===currentUser.authUserId){
      Object.assign(currentUser,user);
    }
  }
}

async function syncCurrentPatientFromSupabase(){
  if(currentUser?.role!=='Patient')return;
  try{
    const {data:row,error}=await supabaseClient
      .from('patients')
      .select('*')
      .eq('user_id',currentUser.dbUserId)
      .maybeSingle();
    if(error||!row)return;

    const realPatient={
      id:200000+Number(row.patient_id),
      dbPatientId:Number(row.patient_id),
      userId:currentUser.id,
      dbUserId:currentUser.dbUserId,
      fname:currentUser.fname,
      lname:currentUser.lname,
      age:ageFromBirthDate(row.birth_date),
      birthDate:row.birth_date||'',
      gender:row.sex||'',
      blood:row.blood_type||'Unknown',
      address:row.address||'',
      college:currentUser.college||'',
      personType:currentUser.personType||'',
      idNo:currentUser.idNo||'',
      height:row.height_cm?`${row.height_cm}cm`:'',
      weight:row.weight_kg?`${row.weight_kg}kg`:'',
      contact:currentUser.contact||'',
      emergencyName:row.emergency_contact_name||'',
      emergencyContact:row.emergency_contact_number||'',
      medHistory:row.medical_history||'',
      allergies:row.allergies||'',
      archived:!!row.archived_at,
      profilePhoto:currentUser.profilePhoto||'',
      _realSupabase:true
    };
    DB.patients=(DB.patients||[]).filter(p=>!p._realSupabase||p.userId!==currentUser.id);
    DB.patients.push(realPatient);
    currentPatient=realPatient;
    if(currentUser.profilePhoto){
      currentPatient.profilePhoto=currentUser.profilePhoto;
    }
  }catch(e){console.error('Patient sync:',e);}
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
