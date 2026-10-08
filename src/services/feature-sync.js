// Backend synchronization has injected state and collaborators, with no DOM or UI imports.
export function createFeatureSyncService({getState,callbacks,request=fetch}){
async function fetchAnalyticsSummary(from,to,college=''){
  const appState=getState();
  const account=appState.auth.currentUser;
  const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/analytics-summary`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify({from,to,college})
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to generate analytics.');
  if(appState.auth.currentUser!==account)return null;
  appState.reports.currentAnalyticsSummary=result;
  return result;
}

async function fetchRealPendingApprovals(){
  const appState=getState();
  const account=appState.auth.currentUser;
  if(!['Administrator','Staff'].includes(appState.auth.currentUser?.role))return [];
  const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your approval-review session has expired.');

  const response=await request(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/admin-approvals`,{
    headers:{
      apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    }
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to load pending registrations.');
  if(appState.auth.currentUser!==account)return [];
  return result.users||[];
}

async function syncClinicSurveys(){
  const appState=getState();
  const {clinicSurveyRecords,surveyAction}=callbacks;
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return clinicSurveyRecords();
  const result=await surveyAction({action:'list'});
  if(appState.auth.currentUser!==account)return [];
  appState.data.DB.clinicSurveys=(result.surveys||[]).map(s=>({
    id:Number(s.survey_id),
    patientId:s.patient_id?200000+Number(s.patient_id):null,
    appointmentId:s.appointment_id?300000+Number(s.appointment_id):null,
    groupType:s.group_type||'',
    department:s.department||'',
    service:s.service_availed||'',
    visitFrequency:s.visit_frequency||'',
    heardFrom:s.heard_from||'',
    ratings:s.ratings||{},
    citizensCharter:s.citizens_charter||{},
    sqd:s.sqd||{},
    suggestions:s.suggestions||'',
    email:s.respondent_email||'',
    patient:s.patient||null,
    createdAt:s.created_at||'',
    _realSupabase:true
  }));
  return appState.data.DB.clinicSurveys;
}

async function syncRealFitnessAssessments(){
  const appState=getState();
  const {fitnessRecords,realFitnessToUi}=callbacks;
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return fitnessRecords();

  const {data,error}=await appState.supabaseClient.supabaseClient
    .from('fitness_assessments')
    .select('assessment_id,patient_id,doctor_id,sport_event,event_date,assessment_date,vitals,medical_history,cardio_respiratory_findings,examination_findings,decision,restrictions,status,request_notes,requested_at,completed_at,updated_at')
    .order('requested_at',{ascending:false})
    .order('assessment_id',{ascending:false});

  if(error)throw error;

  if(appState.auth.currentUser!==account)return [];
  appState.data.DB.fitnessAssessments=(appState.data.DB.fitnessAssessments||[]).filter(x=>!x._realSupabase);
  appState.data.DB.fitnessAssessments.push(...(data||[]).map(realFitnessToUi));
  return fitnessRecords();
}

async function syncRealIssueReports(){
  const appState=getState();
  const {issueReportRecords,realIssueToUi}=callbacks;
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return issueReportRecords();

  const {data:reports,error:reportErr}=await appState.supabaseClient.supabaseClient
    .from('issue_reports')
    .select('issue_id,reporter_id,issue_type,page_affected,description,screenshot_path,status,admin_note,resolved_by,resolved_at,created_at,updated_at')
    .order('created_at',{ascending:false});
  if(reportErr)throw reportErr;

  const issueIds=(reports||[]).map(r=>Number(r.issue_id));
  let replies=[];
  if(issueIds.length){
    const {data,error}=await appState.supabaseClient.supabaseClient
      .from('issue_replies')
      .select('reply_id,issue_id,author_id,body,created_at')
      .in('issue_id',issueIds)
      .order('created_at',{ascending:true});
    if(error)throw error;
    replies=data||[];
  }

  const userIds=[...new Set([
    ...(reports||[]).map(r=>Number(r.reporter_id)),
    ...replies.map(r=>Number(r.author_id))
  ].filter(Boolean))];

  const userMap=new Map();
  if(userIds.length){
    const {data:users,error:userErr}=await appState.supabaseClient.supabaseClient
      .from('users')
      .select('user_id,first_name,last_name,role')
      .in('user_id',userIds);
    if(userErr)throw userErr;
    (users||[]).forEach(u=>userMap.set(Number(u.user_id),u));
  }

  const signedUrls=new Map();
  await Promise.all((reports||[]).map(async row=>{
    if(!row.screenshot_path)return;
    const {data,error}=await appState.supabaseClient.supabaseClient.storage
      .from('campuscare-issue-screenshots')
      .createSignedUrl(row.screenshot_path,3600);
    if(!error&&data?.signedUrl)signedUrls.set(Number(row.issue_id),data.signedUrl);
  }));

  if(appState.auth.currentUser!==account)return [];
  appState.data.DB.issueReports=(appState.data.DB.issueReports||[]).filter(r=>!r._realSupabase);
  appState.data.DB.issueReports.push(...(reports||[]).map(row=>
    realIssueToUi(row,userMap,replies,signedUrls.get(Number(row.issue_id))||'')
  ));
  return issueReportRecords();
}

async function syncRealMessages(){
  const appState=getState();
  const {messageRecords,messageAction,mergeRealMessageContacts,realMessageToUi}=callbacks;
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return messageRecords();

  const result=await messageAction({action:'list'});

  // The backend returns both the user's messages and every contact the role
  // is allowed to message. This prevents an incoming Admin/Staff message from
  // disappearing simply because that sender was not loaded in another module.
  if(appState.auth.currentUser!==account)return [];
  mergeRealMessageContacts(result.contacts||[]);

  appState.data.DB.messages=(appState.data.DB.messages||[]).filter(m=>!m._realSupabase);
  appState.data.DB.messages.push(...(result.messages||[]).map(realMessageToUi));
  return messageRecords();
}

async function syncRealHealthResources(){
  const appState=getState();
  const {healthResourceRecords,healthResourceAction,realHealthResourceToUi}=callbacks;
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return healthResourceRecords();

  const result=await healthResourceAction({action:'list'});
  if(appState.auth.currentUser!==account)return [];
  appState.data.DB.healthResources=(appState.data.DB.healthResources||[]).filter(r=>!r._realSupabase);
  appState.data.DB.healthResources.push(...(result.resources||[]).map(realHealthResourceToUi));
  return healthResourceRecords();
}

async function syncPublicSystemSettings(){
  const appState=getState();
  const {configureSessionGuard}=callbacks;
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return appState.data.DB.settings;

  const {data,error}=await appState.supabaseClient.supabaseClient
    .from('system_settings')
    .select('clinic_name,address,contact_email,contact_number,semester_start,semester_end,semester2_start,semester2_end,dental_visit_limit_per_semester,appointment_reminder_days,privacy_policy_version,privacy_policy_updated,session_timeout_minutes')
    .order('settings_id',{ascending:true})
    .limit(1)
    .maybeSingle();

  if(error)throw error;
  if(!data)return appState.data.DB.settings;

  if(appState.auth.currentUser!==account)return appState.data.DB.settings;
  Object.assign(appState.data.DB.settings,{
    clinicName:data.clinic_name||appState.clinicInformation.CTU_CLINIC_INFO.name,
    address:data.address||appState.clinicInformation.CTU_CLINIC_INFO.address,
    contactEmail:data.contact_email||appState.clinicInformation.CTU_CLINIC_INFO.email,
    contactPhone:data.contact_number||appState.clinicInformation.CTU_CLINIC_INFO.phone,
    semesterStart:data.semester_start||appState.data.DB.settings.semesterStart||'',
    semesterEnd:data.semester_end||appState.data.DB.settings.semesterEnd||'',
    semester2Start:data.semester2_start||appState.data.DB.settings.semester2Start||'',
    semester2End:data.semester2_end||appState.data.DB.settings.semester2End||'',
    dentalLimitPerSemester:Number(data.dental_visit_limit_per_semester||1),
    appointmentReminderDays:Number(data.appointment_reminder_days??1),
    privacyPolicyVersion:data.privacy_policy_version||appState.data.DB.settings.privacyPolicyVersion||'1.0',
    privacyPolicyUpdated:data.privacy_policy_updated||appState.data.DB.settings.privacyPolicyUpdated||appState.clinicInformation.TODAY,
    sessionTimeoutMinutes:Number(data.session_timeout_minutes||appState.data.DB.settings.sessionTimeoutMinutes||30)
  });
  if(appState.auth.currentUser)configureSessionGuard(appState.data.DB.settings.sessionTimeoutMinutes);
  return appState.data.DB.settings;
}

async function syncRealSystemSettings(){
  const appState=getState();
  const {settingsAction}=callbacks;
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase||appState.auth.currentUser.role!=='Administrator')return appState.data.DB.settings;

  const result=await settingsAction({action:'get'});
  const s=result.settings;
  if(!s)return appState.data.DB.settings;

  if(appState.auth.currentUser!==account)return appState.data.DB.settings;
  Object.assign(appState.data.DB.settings,{
    clinicName:s.clinic_name||appState.clinicInformation.CTU_CLINIC_INFO.name,
    address:s.address||appState.clinicInformation.CTU_CLINIC_INFO.address,
    contactEmail:s.contact_email||appState.clinicInformation.CTU_CLINIC_INFO.email,
    contactPhone:s.contact_number||appState.clinicInformation.CTU_CLINIC_INFO.phone,
    semesterStart:s.semester_start||appState.data.DB.settings.semesterStart||'',
    semesterEnd:s.semester_end||appState.data.DB.settings.semesterEnd||'',
    semester2Start:s.semester2_start||appState.data.DB.settings.semester2Start||'',
    semester2End:s.semester2_end||appState.data.DB.settings.semester2End||'',
    dentalLimitPerSemester:Number(s.dental_visit_limit_per_semester||1),
    appointmentReminderDays:Number(s.appointment_reminder_days??1),
    privacyPolicyVersion:s.privacy_policy_version||appState.data.DB.settings.privacyPolicyVersion||'1.0',
    privacyPolicyUpdated:s.privacy_policy_updated||appState.data.DB.settings.privacyPolicyUpdated||appState.clinicInformation.TODAY
  });

  return appState.data.DB.settings;
}

async function syncRealWorkflowRequests(){
  const appState=getState();
  const {workflowAction,realWorkflowToUi,realDoctorLeaveToUi}=callbacks;
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return [];

  const result=await workflowAction({action:'list'});
  if(appState.auth.currentUser!==account)return [];
  appState.data.DB.workflowRequests=(result.requests||[]).map(realWorkflowToUi);

  appState.data.DB.nameChangeRequests=appState.data.DB.workflowRequests.filter(r=>r.type==='Name Change');
  appState.data.DB.scheduleChangeRequests=appState.data.DB.workflowRequests.filter(r=>r.type==='Schedule Change');
  appState.data.DB.leaveRequests=appState.data.DB.workflowRequests.filter(r=>r.type==='Day Off');

  appState.data.DB.doctorLeaves=(appState.data.DB.doctorLeaves||[]).filter(l=>!l._realSupabase);
  appState.data.DB.doctorLeaves.push(...(result.doctor_leaves||[]).map(realDoctorLeaveToUi));

  return appState.data.DB.workflowRequests;
}
return {syncPublicSystemSettings,syncRealSystemSettings,syncRealIssueReports,syncRealHealthResources,syncClinicSurveys,syncRealWorkflowRequests,syncRealMessages,syncRealFitnessAssessments,fetchRealPendingApprovals,fetchAnalyticsSummary};
}
