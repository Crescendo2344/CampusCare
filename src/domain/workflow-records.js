// Pure workflow/fitness/message/issue/approval normalization accepts supplied records only.
export function formatBackupSize(bytes){
  const n=Number(bytes||0);
  if(!n)return '—';
  const units=['B','KB','MB','GB'];
  let value=n,idx=0;
  while(value>=1024&&idx<units.length-1){value/=1024;idx++;}
  return `${value.toFixed(idx===0?0:1)} ${units[idx]}`;
}

export function issueDisplayId(r){
  const id=Number(r?.dbIssueId??r?.id??0);
  return String(id).padStart(6,'0');
}

export function realIssueToUi(row,userMap,replyRows,screenshotUrl){
  const reporter=userMap.get(Number(row.reporter_id));
  return {
    id:1400000+Number(row.issue_id),
    dbIssueId:Number(row.issue_id),
    reporterId:100000+Number(row.reporter_id),
    dbReporterId:Number(row.reporter_id),
    reporterName:reporter?`${reporter.first_name||''} ${reporter.last_name||''}`.trim():'CampusCare user',
    reporterRole:reporter?.role||'User',
    type:row.issue_type||'Feedback',
    page:row.page_affected||'',
    description:row.description||'',
    photo:screenshotUrl||'',
    screenshotPath:row.screenshot_path||'',
    status:row.status||'Open',
    adminNote:row.admin_note||'',
    resolvedBy:row.resolved_by?100000+Number(row.resolved_by):null,
    resolvedAt:row.resolved_at||'',
    createdAt:row.created_at||'',
    updatedAt:row.updated_at||'',
    replies:replyRows
      .filter(r=>Number(r.issue_id)===Number(row.issue_id))
      .map(r=>{
        const author=userMap.get(Number(r.author_id));
        return {
          id:1450000+Number(r.reply_id),
          dbReplyId:Number(r.reply_id),
          authorId:100000+Number(r.author_id),
          dbAuthorId:Number(r.author_id),
          authorName:author?`${author.first_name||''} ${author.last_name||''}`.trim():'CampusCare user',
          authorRole:author?.role||'User',
          body:r.body||'',
          createdAt:r.created_at||''
        };
      }),
    _realSupabase:true
  };
}

export function realWorkflowToUi(r){
  const base={
    id:1500000+Number(r.request_id),
    dbRequestId:Number(r.request_id),
    type:r.request_type||'',
    userId:100000+Number(r.requester_id),
    doctorId:100000+Number(r.target_user_id),
    requesterId:100000+Number(r.requester_id),
    targetUserId:100000+Number(r.target_user_id),
    reason:r.reason||'',
    effectiveDate:r.effective_date||'',
    rawStatus:r.status||'Pending',
    adminNote:r.admin_note||'',
    reviewedAt:r.reviewed_at||'',
    appliedAt:r.applied_at||'',
    createdAt:r.created_at||'',
    payload:r.payload||{},
    _realSupabase:true
  };

  if(r.request_type==='Name Change'){
    return {
      ...base,
      currentFname:r.payload?.current?.firstName||'',
      currentLname:r.payload?.current?.lastName||'',
      requestedFname:r.payload?.requested?.firstName||'',
      requestedLname:r.payload?.requested?.lastName||'',
      status:r.status==='Applied'?'Approved':r.status
    };
  }

  if(r.request_type==='Schedule Change'){
    return {
      ...base,
      currentSchedule:r.payload?.current||{},
      requested:r.payload?.requested||{},
      status:r.status
    };
  }

  if(r.request_type==='Day Off'){
    return {
      ...base,
      date:r.effective_date||r.payload?.leaveDate||'',
      status:r.status==='Applied'?'Approved':r.status
    };
  }

  return base;
}

export function realDoctorLeaveToUi(l){
  return {
    id:1600000+Number(l.leave_id),
    dbLeaveId:Number(l.leave_id),
    doctorId:100000+Number(l.doctor_id),
    date:l.leave_date||'',
    reason:l.reason||'',
    createdAt:l.created_at||'',
    _realSupabase:true
  };
}

export function fitnessDisplayId(x){
  const id=Number(x?.dbAssessmentId??x?.id??0);
  return String(id).padStart(6,'0');
}

export function realFitnessToUi(r){
  return {
    id:800000+Number(r.assessment_id),
    dbAssessmentId:Number(r.assessment_id),
    patientId:200000+Number(r.patient_id),
    dbPatientId:Number(r.patient_id),
    doctorId:r.doctor_id?100000+Number(r.doctor_id):null,
    dbDoctorId:r.doctor_id?Number(r.doctor_id):null,
    sport:r.sport_event||'',
    eventDate:r.event_date||'',
    date:r.assessment_date||'',
    vitals:r.vitals||{},
    history:r.medical_history||'',
    cardioResp:r.cardio_respiratory_findings||'',
    examFindings:r.examination_findings||'',
    decision:r.decision||'',
    restrictions:r.restrictions||'',
    notes:r.request_notes||'',
    status:r.status||'Requested',
    requestedDate:r.requested_at||'',
    completedAt:r.completed_at||'',
    updatedAt:r.updated_at||'',
    _realSupabase:true
  };
}

export function realApprovalUiUser(u){
  return {
    id:u.user_id,
    authUserId:u.auth_user_id,
    fname:u.first_name||'',
    lname:u.last_name||'',
    username:u.username||'',
    email:u.email||'',
    contact:u.contact_number||'',
    personType:u.person_type||'',
    college:u.college||'',
    idNo:u.id_number||'',
    dob:u.birth_date||'',
    sex:u.sex||'',
    bloodType:u.blood_type||'',
    address:u.address||'',
    emergencyName:u.emergency_contact_name||'',
    emergencyContact:u.emergency_contact_number||'',
    medicalHistory:u.medical_history||'',
    allergies:u.allergies||'',
    verificationDocumentType:u.verification_document_type||(
      u.person_type==='Student'?'School ID or COR':'Employee ID'
    ),
    registrationContext:u.registration_context||'public',
    emailConfirmedAt:u.email_confirmed_at||'',
    profilePhoto:u.profile_signed_url||'',
    idFileData:u.verification_signed_url||'',
    idFile:u.id_file_url?u.id_file_url.split('/').pop():'Verification document',
    createdAt:u.created_at,
    role:'Patient',
    status:'Pending',
    verified:false,
    _realSupabaseApproval:true
  };
}

export function realMessageToUi(m){
  return {
    id:1200000+Number(m.message_id),
    dbMessageId:Number(m.message_id),
    fromUserId:100000+Number(m.from_user_id),
    dbFromUserId:Number(m.from_user_id),
    toUserId:100000+Number(m.to_user_id),
    dbToUserId:Number(m.to_user_id),
    subject:m.subject||'',
    message:m.body||'',
    replyToId:m.reply_to_id?1200000+Number(m.reply_to_id):null,
    dbReplyToId:m.reply_to_id?Number(m.reply_to_id):null,
    isRead:Boolean(m.is_read),
    createdAt:m.created_at||'',
    edited:Boolean(m.edited_at),
    editedAt:m.edited_at||'',
    deleted:Boolean(m.deleted_for_everyone),
    deletedAt:m.deleted_at||'',
    forwarded:Boolean(m.forwarded_from_id),
    dbForwardedFromId:m.forwarded_from_id?Number(m.forwarded_from_id):null,
    attachment:m.attachment_url&&!m.deleted_for_everyone?{
      type:m.attachment_type||'file',
      name:m.attachment_name||'Attachment',
      dataUrl:m.attachment_url,
      mime:m.attachment_mime||'',
      size:Number(m.attachment_size||0),
      path:m.attachment_path||''
    }:null,
    _realSupabase:true
  };
}
