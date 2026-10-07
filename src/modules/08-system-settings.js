// ================================================================
// REAL SYSTEM SETTINGS
// ================================================================
async function settingsAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/settings-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Settings action failed.');
  return result;
}

async function syncPublicSystemSettings(){
  if(!currentUser?._realSupabase)return DB.settings;

  const {data,error}=await supabaseClient
    .from('system_settings')
    .select('clinic_name,address,contact_email,contact_number,semester_start,semester_end,semester2_start,semester2_end,dental_visit_limit_per_semester,appointment_reminder_days,privacy_policy_version,privacy_policy_updated,session_timeout_minutes')
    .order('settings_id',{ascending:true})
    .limit(1)
    .maybeSingle();

  if(error)throw error;
  if(!data)return DB.settings;

  Object.assign(DB.settings,{
    clinicName:data.clinic_name||CTU_CLINIC_INFO.name,
    address:data.address||CTU_CLINIC_INFO.address,
    contactEmail:data.contact_email||CTU_CLINIC_INFO.email,
    contactPhone:data.contact_number||CTU_CLINIC_INFO.phone,
    semesterStart:data.semester_start||DB.settings.semesterStart||'',
    semesterEnd:data.semester_end||DB.settings.semesterEnd||'',
    semester2Start:data.semester2_start||DB.settings.semester2Start||'',
    semester2End:data.semester2_end||DB.settings.semester2End||'',
    dentalLimitPerSemester:Number(data.dental_visit_limit_per_semester||1),
    appointmentReminderDays:Number(data.appointment_reminder_days??1),
    privacyPolicyVersion:data.privacy_policy_version||DB.settings.privacyPolicyVersion||'1.0',
    privacyPolicyUpdated:data.privacy_policy_updated||DB.settings.privacyPolicyUpdated||TODAY,
    sessionTimeoutMinutes:Number(data.session_timeout_minutes||DB.settings.sessionTimeoutMinutes||30)
  });
  if(currentUser)configureSessionGuard(DB.settings.sessionTimeoutMinutes);
  return DB.settings;
}

async function syncRealSystemSettings(){
  if(!currentUser?._realSupabase||currentUser.role!=='Administrator')return DB.settings;

  const result=await settingsAction({action:'get'});
  const s=result.settings;
  if(!s)return DB.settings;

  Object.assign(DB.settings,{
    clinicName:s.clinic_name||CTU_CLINIC_INFO.name,
    address:s.address||CTU_CLINIC_INFO.address,
    contactEmail:s.contact_email||CTU_CLINIC_INFO.email,
    contactPhone:s.contact_number||CTU_CLINIC_INFO.phone,
    semesterStart:s.semester_start||DB.settings.semesterStart||'',
    semesterEnd:s.semester_end||DB.settings.semesterEnd||'',
    semester2Start:s.semester2_start||DB.settings.semester2Start||'',
    semester2End:s.semester2_end||DB.settings.semester2End||'',
    dentalLimitPerSemester:Number(s.dental_visit_limit_per_semester||1),
    appointmentReminderDays:Number(s.appointment_reminder_days??1),
    privacyPolicyVersion:s.privacy_policy_version||DB.settings.privacyPolicyVersion||'1.0',
    privacyPolicyUpdated:s.privacy_policy_updated||DB.settings.privacyPolicyUpdated||TODAY
  });

  return DB.settings;
}

async function saveRealSystemSettings(){
  const s=DB.settings;
  const result=await settingsAction({
    action:'update',
    clinic_name:s.clinicName,
    address:s.address,
    contact_email:s.contactEmail,
    contact_number:s.contactPhone,
    semester_start:s.semesterStart||null,
    semester_end:s.semesterEnd||null,
    semester2_start:s.semester2Start||null,
    semester2_end:s.semester2End||null,
    dental_visit_limit_per_semester:Number(s.dentalLimitPerSemester||1),
    appointment_reminder_days:Number(s.appointmentReminderDays??1),
    privacy_policy_version:s.privacyPolicyVersion||'1.0',
    privacy_policy_updated:s.privacyPolicyUpdated||TODAY
  });

  if(result.settings)await syncRealSystemSettings();
  return result;
}
