// ================================================================
// REAL ACCOUNT / DOCTOR WORKFLOW REQUESTS
// ================================================================
function workflowRequestRecords(){
  return currentUser?._realSupabase?(DB.workflowRequests||[]):[
    ...(DB.scheduleChangeRequests||[]).map(r=>({...r,type:'Schedule Change'})),
    ...(DB.leaveRequests||[]).map(r=>({...r,type:'Day Off'})),
    ...(DB.nameChangeRequests||[]).map(r=>({...r,type:'Name Change'}))
  ]; // Demo queues must use the same pending workflows as the live task service.
}

async function workflowAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/workflow-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Workflow action failed.');
  return result;
}

function realWorkflowToUi(r){
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

function realDoctorLeaveToUi(l){
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

async function syncRealWorkflowRequests(){
  if(!currentUser?._realSupabase)return [];

  const result=await workflowAction({action:'list'});
  DB.workflowRequests=(result.requests||[]).map(realWorkflowToUi);

  DB.nameChangeRequests=DB.workflowRequests.filter(r=>r.type==='Name Change');
  DB.scheduleChangeRequests=DB.workflowRequests.filter(r=>r.type==='Schedule Change');
  DB.leaveRequests=DB.workflowRequests.filter(r=>r.type==='Day Off');

  DB.doctorLeaves=(DB.doctorLeaves||[]).filter(l=>!l._realSupabase);
  DB.doctorLeaves.push(...(result.doctor_leaves||[]).map(realDoctorLeaveToUi));

  return DB.workflowRequests;
}

function openScheduleChangeRequest(){
  if(currentUser?.role!=='Doctor'){toast('Doctor access required.','warning');return;}
  const u=currentUser;
  openModal(`<div class="modal">
    <div class="modal-header"><h3>Request Schedule Change</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <div id="scr-msg"></div>
      <p class="form-note" style="margin-bottom:.8rem">Set your recurring weekly work pattern. The same hours apply to each selected work day. Unselected days are off. For a single date, use Request Day Off in My Schedule. Approval is required before this pattern becomes active.</p>
      <div class="form-row">
        <div class="form-group"><label>Start Time</label><input type="time" id="scr-start" value="${u.startTime||'08:00'}"></div>
        <div class="form-group"><label>End Time</label><input type="time" id="scr-end" value="${u.endTime||'17:00'}"></div>
        <div class="form-group"><label>Slot Duration (min)</label><input type="number" id="scr-slot" value="${u.slotDuration||60}" min="15" max="120"></div>
        <div class="form-group"><label>Max Patients/Day</label><input type="number" id="scr-max" value="${u.maxPatients||20}" min="1"></div>
      </div>
      <div class="form-group"><label>Repeats every week on</label><div style="display:flex;gap:.5rem;margin-bottom:.6rem"><button class="btn btn-sm" onclick="setScheduleDays('weekdays')">Mon–Fri</button><button class="btn btn-sm" onclick="setScheduleDays('current')">Current pattern</button><button class="btn btn-sm" onclick="setScheduleDays('clear')">Clear</button></div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<label style="display:flex;align-items:center;gap:.3rem;font-size:.82rem;cursor:pointer"><input type="checkbox" class="scr-day" value="${d}" ${(u.workDays||[]).includes(d)?'checked':''}> ${d}</label>`).join('')}
        </div>
      </div>
      <div class="form-group"><label>Effective Date <span class="required">*</span></label>${campusDateFieldHtml('scr-effective',TODAY,'Select Effective Date',TODAY)}<p class="form-note">The date your new schedule should start applying, once approved.</p></div>
      <div id="schedule-preview" class="alert alert-info show" aria-live="polite"></div><div class="form-group"><label>Reason <span class="required">*</span></label><textarea id="scr-reason" rows="2" placeholder="e.g. Requesting a later start time due to a morning clinic elsewhere"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeAllModals()">Cancel</button><button class="btn btn-primary" onclick="submitScheduleChangeRequest()">Submit Request</button></div>
  </div>`);
}

async function submitScheduleChangeRequest(){
  if(window.campusScheduleSubmitting)return;
  const u=currentUser;
  if(u?.role!=='Doctor')return;
  const msg=document.getElementById('scr-msg');
  const startTime=document.getElementById('scr-start').value;
  const endTime=document.getElementById('scr-end').value;
  const slotDuration=Number(document.getElementById('scr-slot').value);
  const maxPatients=Number(document.getElementById('scr-max').value);
  const workDays=Array.from(document.querySelectorAll('.scr-day:checked')).map(cb=>cb.value);
  const effectiveDate=document.getElementById('scr-effective').value;
  const reason=document.getElementById('scr-reason').value.trim();

  hideAlert(msg);
  if(!reason){showAlert(msg,'Please explain the schedule change.');return;}
  if(!workDays.length){showAlert(msg,'Please select at least one work day.');return;}
  if(startTime>=endTime){showAlert(msg,'Start time must be before end time.');return;}
  if(!effectiveDate){showAlert(msg,'Please choose an effective date.');return;}
  const validation=validateSchedule({startTime,endTime,slotDuration,maxPatients,workDays},effectiveDate,u);
  if(validation){showAlert(msg,validation);return;}

  window.campusScheduleSubmitting=true;
  try{
    if(currentUser?._realSupabase){
      await Promise.all([syncRealWorkflowRequests(),syncRealAppointments()]);
      const freshError=validateSchedule({startTime,endTime,slotDuration,maxPatients,workDays},effectiveDate,u);
      if(freshError)throw new Error(freshError);
      await workflowAction({
        action:'create',
        request_type:'Schedule Change',
        start_time:startTime,
        end_time:endTime,
        slot_duration:slotDuration,
        max_patients:maxPatients,
        work_days:workDays,
        effective_date:effectiveDate,
        reason
      });
      await syncRealWorkflowRequests();
    }else{
      DB.scheduleChangeRequests=DB.scheduleChangeRequests||[];
      DB.nextScheduleReqId=DB.nextScheduleReqId||1;
      DB.scheduleChangeRequests.push({
        id:DB.nextScheduleReqId++,doctorId:u.id,
        currentSchedule:{startTime:u.startTime,endTime:u.endTime,slotDuration:u.slotDuration,maxPatients:u.maxPatients,workDays:u.workDays},
        requested:{startTime,endTime,slotDuration,maxPatients,workDays},
        effectiveDate,reason,status:'Pending',createdAt:TODAY
      });
      DB.users.filter(a=>a.role==='Administrator').forEach(a=>addNotif(a.id,'Schedule Change Request',`${docName(u)} has requested a work schedule change effective ${fmtDate(effectiveDate)}.`,'info'));
      persistDB();
    }

    discardCampusDraft('schedule',false);
    void refreshTaskBadges(true);
    toast('Schedule change request submitted.','success');
    closeAllModals();
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit schedule change request.');
  }finally{window.campusScheduleSubmitting=false;}
}


function approveScheduleChange(reqId){
  const req=(DB.scheduleChangeRequests||[]).find(r=>r.id===Number(reqId));
  if(!req)return;
  const doc=getUserById(req.doctorId);
  if(!doc)return;
  if(currentUser?.role!=='Administrator'||req.status!=='Pending'){toast('Only administrators can review pending requests.','warning');return;}
  const effDate=req.effectiveDate||clinicToday();
  const conflict=scheduleConflicts(doc,req.requested,effDate);
  if(conflict.length){toast(`${conflict.length} booked appointments conflict. Reschedule them before approval.`,'warning');return;}

  showConfirmDialog({
    title:'Approve Schedule Change',
    message:`Approve the requested schedule change for <strong>${docName(doc)}</strong>, effective ${fmtDate(effDate)}?`,
    confirmLabel:'Approve',
    onConfirm:async()=>{
      try{
        if(req._realSupabase){
          await syncRealAppointments();
          if(scheduleConflicts(doc,req.requested,effDate).length)throw new Error('Bookings changed. Resolve schedule conflicts before approval.');
          await workflowAction({action:'decision',request_id:req.dbRequestId,decision:'Approve'});
          await Promise.all([syncAdminDirectoryFromSupabase(),syncRealWorkflowRequests()]);
          toast(effDate<=TODAY?'Schedule change approved and applied.':`Approved — will take effect automatically on ${fmtDate(effDate)}.`,'success');
        }else{
          if(effDate<=TODAY){
            Object.assign(doc,canonicalSchedule(req.requested));
            req.status='Approved';
            addNotif(doc.id,'Schedule Change Approved','Your requested work schedule change is now in effect.','success');
          }else{
            req.status='Approved-Pending';
            addNotif(doc.id,'Schedule Change Approved',`Your requested work schedule change has been approved and will take effect on ${fmtDate(effDate)}.`,'success');
          }
          persistDB();
          toast('Schedule change approved.','success');
        }
        if(document.getElementById('user-table'))await renderUsers();
      }catch(e){
        toast(e?.message||'Unable to approve the schedule change.','error');
      }
    }
  });
}


// Applies any admin-approved schedule changes whose effective date has
// arrived. Runs once per login/dashboard load, since there's no backend
// scheduler to do this continuously.
function applyDueScheduleChanges(){
  if(currentUser?._realSupabase){
    // Real accounts are applied by the hourly PostgreSQL scheduler.
    return;
  }

  (DB.scheduleChangeRequests||[]).filter(r=>r.status==='Approved-Pending'&&r.effectiveDate<=clinicToday()).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)).forEach(r=>{
    const doc=DB.users.find(u=>u.id===r.doctorId);
    if(doc){
      Object.assign(doc,canonicalSchedule(r.requested));
      addNotif(doc.id,'Schedule Change Now Active','Your approved work schedule change is now in effect.','info');
    }
    r.status='Approved';
    persistDB();
  });
}


function rejectScheduleChange(reqId){
  const req=(DB.scheduleChangeRequests||[]).find(r=>r.id===Number(reqId));
  if(!req)return;
  const doc=getUserById(req.doctorId);
  if(currentUser?.role!=='Administrator'||req.status!=='Pending'){toast('Only administrators can review pending requests.','warning');return;}

  showConfirmDialog({
    title:'Reject Schedule Change',
    message:`Reject this schedule change request${doc?' for <strong>'+docName(doc)+'</strong>':''}?`,
    confirmLabel:'Reject',
    danger:true,
    onConfirm:async()=>{
      try{
        if(req._realSupabase){
          await workflowAction({action:'decision',request_id:req.dbRequestId,decision:'Reject'});
          await syncRealWorkflowRequests();
        }else{
          req.status='Rejected';
          if(doc)addNotif(doc.id,'Schedule Change Declined','Your requested work schedule change was declined by an administrator. Please reach out for more details.','warning');
          persistDB();
        }
        toast('Request rejected.','success');
        if(document.getElementById('user-table'))await renderUsers();
      }catch(e){
        toast(e?.message||'Unable to reject the request.','error');
      }
    }
  });
}


let pendingAccountUpdate=null;

function normalizePhilippinePhoneForAuth(localPhone){
  const digits=String(localPhone||'').replace(/\D/g,'');
  if(/^09\d{9}$/.test(digits))return '+63'+digits.slice(1);
  if(/^639\d{9}$/.test(digits))return '+'+digits;
  if(/^\+639\d{9}$/.test(String(localPhone||'')))return String(localPhone);
  return '';
}

async function refreshCurrentProfileContact(){
  if(!currentUser?._realSupabase)return;

  try{
    const {data:profile,error}=await supabaseClient
      .from('users')
      .select('email,contact_number')
      .eq('auth_user_id',currentUser.authUserId)
      .maybeSingle();

    if(error||!profile)return;

    currentUser.email=profile.email||currentUser.email;
    currentUser.contact=profile.contact_number||'';
    currentUser.contactNo=profile.contact_number||'';

    const synced=DB.users.find(u=>u._realSupabase&&u.dbUserId===currentUser.dbUserId);
    if(synced){
      synced.email=currentUser.email;
      synced.contact=currentUser.contact;
      synced.contactNo=currentUser.contactNo;
    }
  }catch(err){
    console.error('Profile contact refresh:',err);
  }
}

async function saveAccount(){
  const u=currentUser;
  const msg=document.getElementById('acc-msg');
  hideAlert(msg);

  const email=document.getElementById('acc-email').value.trim().toLowerCase();
  const contact=document.getElementById('acc-contact').value.replace(/\D/g,'').slice(0,11);

  if(!email||!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)){
    showAlert(msg,'Please enter a valid email address.');
    return;
  }
  if(contact&&contact.length!==11){
    showAlert(msg,'Contact number must be exactly 11 digits (e.g. 09XXXXXXXXX).');
    return;
  }
  if(contact&&!/^09\d{9}$/.test(contact)){
    showAlert(msg,'Please enter a valid Philippine mobile number starting with 09.');
    return;
  }

  const emailChanged=email!==String(u.email||'').toLowerCase();
  const contactChanged=contact!==String(u.contact||'');
  if(!emailChanged&&!contactChanged){
    showAlert(msg,'No changes to save.','info');
    return;
  }

  // Administrators are explicitly exempt from verification.
  if(u.role==='Administrator'){
    const btn=document.querySelector('button[onclick="saveAccount()"]');
    const oldText=btn?.textContent;
    if(btn){btn.disabled=true;btn.textContent='Saving…';}

    try{
      if(u._realSupabase){
        await adminUserAction({
          action:'update',
          user_id:u.dbUserId,
          email,
          contact_number:contact
        });
        await syncAdminDirectoryFromSupabase();
        const fresh=DB.users.find(x=>x._realSupabase&&x.dbUserId===u.dbUserId);
        if(fresh){
          currentUser.email=fresh.email;
          currentUser.contact=fresh.contact||fresh.contactNo||contact;
          currentUser.contactNo=currentUser.contact;
        }else{
          currentUser.email=email;
          currentUser.contact=contact;
          currentUser.contactNo=contact;
        }
      }else{
        u.email=email;
        u.contact=contact;
        persistDB();
      }

      showAlert(msg,'Profile updated successfully.','success');
      toast('Contact information updated.','success');
      renderMyAccount();
    }catch(e){
      showAlert(msg,e?.message||'Unable to update your profile.');
    }finally{
      if(btn){btn.disabled=false;btn.textContent=oldText||'Save Changes';}
    }
    return;
  }

  pendingAccountUpdate={
    email:emailChanged?email:null,
    contact:contactChanged?contact:null,
    authPhone:contactChanged?normalizePhilippinePhoneForAuth(contact):null,
    emailChanged,
    contactChanged
  };

  if(contactChanged&&!pendingAccountUpdate.authPhone){
    showAlert(msg,'Please enter a valid Philippine mobile number.');
    pendingAccountUpdate=null;
    return;
  }

  await openAccountUpdateVerification();
}

async function openAccountUpdateVerification(){
  const u=currentUser;
  const msg=document.getElementById('acc-msg');
  hideAlert(msg);

  if(!pendingAccountUpdate)return;

  try{
    if(!initializeSupabaseClient())throw new Error('Unable to connect to CampusCare.');

    // Supabase sends a real 6-digit reauthentication nonce to the user's
    // currently verified email address or Auth phone number.
    const {error}=await supabaseClient.auth.reauthenticate();
    if(error)throw error;

    const {data:{user}}=await supabaseClient.auth.getUser();
    const channel=user?.email?'email':'phone';
    const destination=user?.email?maskEmail(user.email):maskPhone(user?.phone||currentUser.contact);

    openModal(`<div class="modal modal-sm">
      <div class="modal-header">
        <h3>Verify It's You</h3>
        <button class="close-btn" onclick="cancelAccountUpdate()">✕</button>
      </div>
      <div class="modal-body">
        <div id="acc-verify-msg"></div>
        <div class="alert alert-info show" style="font-size:.78rem">
          🔐 We sent a 6-digit verification code to your current verified ${channel}: <strong>${escapeHtml(destination)}</strong>.
        </div>
        <p class="form-note" style="margin:.65rem 0">
          Enter that code before CampusCare starts changing your account information.
        </p>
        <div class="form-group">
          <label>Verification Code</label>
          <input id="acc-verify-code" type="text" maxlength="6" inputmode="numeric"
            placeholder="6-digit code" style="letter-spacing:2px"
            oninput="sanitizeInput(this,'code')">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="cancelAccountUpdate()">Cancel</button>
        <button class="btn" onclick="resendAccountVerificationCode()">Resend Code</button>
        <button class="btn btn-primary" id="acc-verify-btn" onclick="confirmAccountUpdate()">Verify & Continue</button>
      </div>
    </div>`);
  }catch(e){
    pendingAccountUpdate=null;
    showAlert(msg,e?.message||'Unable to send the verification code.');
  }
}

async function resendAccountVerificationCode(){
  const msg=document.getElementById('acc-verify-msg');
  hideAlert(msg);
  try{
    const {error}=await supabaseClient.auth.reauthenticate();
    if(error)throw error;
    showAlert(msg,'A new verification code was sent.','success');
  }catch(e){
    showAlert(msg,e?.message||'Unable to resend the code.');
  }
}

async function confirmAccountUpdate(){
  const code=document.getElementById('acc-verify-code')?.value.trim()||'';
  const msg=document.getElementById('acc-verify-msg');
  const btn=document.getElementById('acc-verify-btn');
  hideAlert(msg);

  if(!/^\d{6}$/.test(code)){
    showAlert(msg,'Enter the 6-digit verification code.');
    return;
  }
  if(!pendingAccountUpdate){
    showAlert(msg,'This profile change request has expired. Please start again.');
    return;
  }

  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Verifying…';}

  try{
    const changes={nonce:code};

    // Supabase validates the reauthentication nonce before processing these
    // sensitive account changes. Email/phone ownership verification then
    // follows Supabase Auth's normal secure change flow.
    if(pendingAccountUpdate.emailChanged)changes.email=pendingAccountUpdate.email;
    if(pendingAccountUpdate.contactChanged)changes.phone=pendingAccountUpdate.authPhone;

    const {data,error}=await supabaseClient.auth.updateUser(changes);
    if(error)throw error;

    if(pendingAccountUpdate.contactChanged){
      openPhoneChangeVerification();
      return;
    }

    // Email-only change: Supabase sends its email-change verification message.
    // The database remains on the old email until the change is confirmed.
    const newEmail=pendingAccountUpdate.email;
    pendingAccountUpdate=null;
    closeAllModals();
    toast(`Identity verified. Confirm the email-change message sent by Supabase to ${newEmail} to finish updating your email.`,'success',7000);
    renderMyAccount();
  }catch(e){
    const message=String(e?.message||'Verification failed.');
    if(/nonce|reauth|otp|token/i.test(message)){
      showAlert(msg,'The verification code is incorrect or expired. Request a new code and try again.');
    }else if(/phone|sms|provider/i.test(message)){
      showAlert(msg,'CampusCare could not send the SMS verification. A Supabase SMS provider must be configured before phone-number changes can be completed.');
    }else{
      showAlert(msg,message);
    }
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=oldText||'Verify & Continue';
    }
  }
}

function openPhoneChangeVerification(){
  const phone=pendingAccountUpdate?.contact||'';
  openModal(`<div class="modal modal-sm">
    <div class="modal-header">
      <h3>Verify New Contact Number</h3>
      <button class="close-btn" onclick="cancelAccountUpdate()">✕</button>
    </div>
    <div class="modal-body">
      <div id="phone-change-msg"></div>
      <div class="alert alert-info show" style="font-size:.78rem">
        📱 Supabase sent a 6-digit SMS code to <strong>${escapeHtml(maskPhone(phone))}</strong>.
      </div>
      ${pendingAccountUpdate?.emailChanged
        ? `<p class="form-note">Your email change was also started. Check the verification message sent to <strong>${escapeHtml(pendingAccountUpdate.email)}</strong> to complete that change.</p>`
        : ''}
      <div class="form-group">
        <label>SMS Verification Code</label>
        <input id="phone-change-code" type="text" maxlength="6" inputmode="numeric"
          placeholder="6-digit code" style="letter-spacing:2px"
          oninput="sanitizeInput(this,'code')">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="cancelAccountUpdate()">Cancel</button>
      <button class="btn" onclick="resendPhoneChangeCode()">Resend SMS</button>
      <button class="btn btn-primary" id="phone-change-btn" onclick="confirmPhoneChangeCode()">Verify Number</button>
    </div>
  </div>`);
}

async function resendPhoneChangeCode(){
  const msg=document.getElementById('phone-change-msg');
  hideAlert(msg);
  try{
    const {error}=await supabaseClient.auth.resend({
      type:'phone_change',
      phone:pendingAccountUpdate.authPhone
    });
    if(error)throw error;
    showAlert(msg,'A new SMS verification code was sent.','success');
  }catch(e){
    showAlert(msg,e?.message||'Unable to resend the SMS code.');
  }
}

async function confirmPhoneChangeCode(){
  const code=document.getElementById('phone-change-code')?.value.trim()||'';
  const msg=document.getElementById('phone-change-msg');
  const btn=document.getElementById('phone-change-btn');
  hideAlert(msg);

  if(!/^\d{6}$/.test(code)){
    showAlert(msg,'Enter the 6-digit SMS code.');
    return;
  }

  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Verifying…';}

  try{
    const {error}=await supabaseClient.auth.verifyOtp({
      phone:pendingAccountUpdate.authPhone,
      token:code,
      type:'phone_change'
    });
    if(error)throw error;

    const emailWasChanged=Boolean(pendingAccountUpdate.emailChanged);
    const pendingEmail=pendingAccountUpdate.email;
    pendingAccountUpdate=null;

    // auth.users -> public.users is synchronized by the database trigger.
    await new Promise(resolve=>setTimeout(resolve,350));
    await refreshCurrentProfileContact();

    closeAllModals();
    renderMyAccount();

    if(emailWasChanged){
      toast(`Contact number verified and updated. Complete the email verification sent to ${pendingEmail} to finish the email change.`,'success',7500);
    }else{
      toast('Contact number verified and updated successfully.','success');
    }
  }catch(e){
    showAlert(msg,e?.message||'The SMS verification code is incorrect or expired.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=oldText||'Verify Number';
    }
  }
}

function cancelAccountUpdate(){
  pendingAccountUpdate=null;
  closeAllModals();
}
