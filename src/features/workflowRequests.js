import {createFeatureSyncService} from '../services/feature-sync.js';
import {maskEmail,maskPhone} from '../shared/privacy-formatting.js';
// workflowRequests: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {hideAlert,showAlert,showConfirmDialog,toast} from './theme.js';
import {closeAllModals,openModal} from './modals.js';
import {canonicalSchedule,clinicToday,discardCampusDraft,scheduleConflicts,setScheduleDays,validateSchedule} from './scheduleAndDrafts.js';
import {campusDateFieldHtml} from './datePicker.js';
import {syncRealAppointments} from './appointmentService.js';
import {addNotif} from './notifications.js';
import {docName} from './messaging.js';
import {fmtDate,sanitizeInput} from './inputValidation.js';
import {persistDB} from './persistence.js';
import {refreshTaskBadges} from './topbarAndNavigation.js';
import {getUserById} from './documentScanner.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {adminUserAction,renderUsers} from './userManagement.js';
import {renderMyAccount} from './accountSettings.js';
import {initializeSupabaseClient} from './supabaseClient.js';
import {escapeHtml} from './issueReports.js';
import {bindAction,createOperationalService,workflowData} from '../dependencies.js';
// ================================================================
// REAL ACCOUNT / DOCTOR WORKFLOW REQUESTS
// ================================================================
export function workflowRequestRecords(){
  return appState.auth.currentUser?._realSupabase?(appState.data.DB.workflowRequests||[]):[
    ...(appState.data.DB.scheduleChangeRequests||[]).map(r=>({...r,type:'Schedule Change'})),
    ...(appState.data.DB.leaveRequests||[]).map(r=>({...r,type:'Day Off'})),
    ...(appState.data.DB.nameChangeRequests||[]).map(r=>({...r,type:'Name Change'}))
  ]; // Demo queues must use the same pending workflows as the live task service.
}

export async function workflowAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).workflowAction(payload);}

export function realWorkflowToUi(r){return workflowData.realWorkflowToUi(r);}

export function realDoctorLeaveToUi(l){return workflowData.realDoctorLeaveToUi(l);}

export async function syncRealWorkflowRequests(){
  return createFeatureSyncService({getState:()=>appState,callbacks:{workflowAction,realWorkflowToUi,realDoctorLeaveToUi}}).syncRealWorkflowRequests();
}

export function openScheduleChangeRequest(){
  if(appState.auth.currentUser?.role!=='Doctor'){toast('Doctor access required.','warning');return;}
  const u=appState.auth.currentUser;
  // Numbered sections explain the recurring pattern before asking for its details.
  openModal(`<div class="modal schedule-request" role="dialog" aria-modal="true" aria-labelledby="schedule-request-title">
    <div class="modal-header"><div><h3 id="schedule-request-title">Request Schedule Change</h3><p class="form-note">Update your regular weekly clinic hours</p></div><button class="close-btn" aria-label="Close schedule request" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div id="scr-msg" role="alert"></div>
      <div class="schedule-notice"><strong>This is a weekly schedule change.</strong><p>Selected days repeat every week. For just one day away, use <strong>Request Day Off</strong> in My Schedule.</p></div>
      <fieldset class="schedule-section"><legend><span>1</span> Choose your work days</legend>
        <p class="form-note" id="schedule-days-help">Select the days you will work. Unselected days are days off.</p>
        <div class="schedule-presets"><button type="button" class="btn btn-sm" ${bindAction('click',()=>setScheduleDays('weekdays'))}>Mon–Fri</button><button type="button" class="btn btn-sm" ${bindAction('click',()=>setScheduleDays('current'))}>Current pattern</button><button type="button" class="btn btn-sm" ${bindAction('click',()=>setScheduleDays('clear'))}>Clear</button></div>
        <div class="schedule-days" aria-describedby="schedule-days-help">
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>`<label class="schedule-day"><input type="checkbox" class="scr-day" value="${d}" aria-label="${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}" ${(u.workDays||[]).includes(d)?'checked':''}><span>${d}<small class="schedule-day-on">Work</small><small class="schedule-day-off">Off</small></span></label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="schedule-section"><legend><span>2</span> Set hours and appointments</legend>
        <p class="form-note">These hours apply to every selected day. Times are in Philippine time (UTC+8).</p>
        <div class="schedule-fields">
          <div class="form-group"><label for="scr-start">Starts at</label><input type="time" id="scr-start" value="${escapeHtml(u.startTime||'08:00')}"></div>
          <div class="form-group"><label for="scr-end">Ends at</label><input type="time" id="scr-end" value="${escapeHtml(u.endTime||'17:00')}"></div>
          <div class="form-group"><label for="scr-slot">Appointment length</label><div class="schedule-unit"><input type="number" id="scr-slot" value="${Number(u.slotDuration)||60}" min="15" max="120" aria-describedby="schedule-slot-help"><span>minutes</span></div><p class="form-note" id="schedule-slot-help">15–120 minutes per slot</p></div>
          <div class="form-group"><label for="scr-max">Daily patient limit</label><input type="number" id="scr-max" value="${Number(u.maxPatients)||20}" min="1" max="500"><p class="form-note">Maximum patients per work day</p></div>
        </div>
      </fieldset>
      <fieldset class="schedule-section"><legend><span>3</span> Choose when and explain why</legend>
        <div class="form-group"><label for="scr-effective">Requested start date <span class="required">*</span></label>${campusDateFieldHtml('scr-effective',clinicToday(),'Choose start date',clinicToday())}<p class="form-note">Repeats weekly from this date onward, once approved. Your current schedule stays active while this request is pending.</p></div>
        <div class="form-group"><label for="scr-reason">Reason for change <span class="required">*</span></label><textarea id="scr-reason" rows="3" placeholder="Explain why you need these new days or hours." required></textarea></div>
      </fieldset>
      <section class="schedule-review" aria-labelledby="schedule-review-title"><h4 id="schedule-review-title">Review your change</h4>
        <div class="schedule-comparison"><div><strong>Current schedule</strong><p id="schedule-current-summary"></p></div><div><strong>Requested schedule</strong><p id="schedule-proposed-summary"></p></div></div>
        <p id="schedule-effective-summary" class="form-note"></p>
        <div id="schedule-preview" class="schedule-status" aria-live="polite"></div>
      </section>
      <p class="form-note schedule-approval-note">Submitting sends a request to the administrator. It does not immediately change your schedule or cancel any appointments.</p>
    </div>
    <div class="modal-footer"><button type="button" class="btn" ${bindAction('click',()=>closeAllModals())}>Cancel</button><button type="button" class="btn btn-primary" ${bindAction('click',()=>submitScheduleChangeRequest())}>Send for Approval</button></div>
  </div>`);
}

export async function submitScheduleChangeRequest(){
  if(appState.workflowRequests.campusScheduleSubmitting)return;
  const u=appState.auth.currentUser;
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

  appState.workflowRequests.campusScheduleSubmitting=true;
  try{
    if(appState.auth.currentUser?._realSupabase){
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
      appState.data.DB.scheduleChangeRequests=appState.data.DB.scheduleChangeRequests||[];
      appState.data.DB.nextScheduleReqId=appState.data.DB.nextScheduleReqId||1;
      appState.data.DB.scheduleChangeRequests.push({
        id:appState.data.DB.nextScheduleReqId++,doctorId:u.id,
        currentSchedule:{startTime:u.startTime,endTime:u.endTime,slotDuration:u.slotDuration,maxPatients:u.maxPatients,workDays:u.workDays},
        requested:{startTime,endTime,slotDuration,maxPatients,workDays},
        effectiveDate,reason,status:'Pending',createdAt:appState.clinicInformation.TODAY
      });
      appState.data.DB.users.filter(a=>a.role==='Administrator').forEach(a=>addNotif(a.id,'Schedule Change Request',`${docName(u)} has requested a work schedule change effective ${fmtDate(effectiveDate)}.`,'info'));
      persistDB();
    }

    discardCampusDraft('schedule',false);
    void refreshTaskBadges(true);
    toast('Schedule change request submitted.','success');
    closeAllModals();
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit schedule change request.');
  }finally{appState.workflowRequests.campusScheduleSubmitting=false;}
}

export function approveScheduleChange(reqId){
  const req=(appState.data.DB.scheduleChangeRequests||[]).find(r=>r.id===Number(reqId));
  if(!req)return;
  const doc=getUserById(req.doctorId);
  if(!doc)return;
  if(appState.auth.currentUser?.role!=='Administrator'||req.status!=='Pending'){toast('Only administrators can review pending requests.','warning');return;}
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
          toast(effDate<=appState.clinicInformation.TODAY?'Schedule change approved and applied.':`Approved — will take effect automatically on ${fmtDate(effDate)}.`,'success');
        }else{
          if(effDate<=appState.clinicInformation.TODAY){
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
export function applyDueScheduleChanges(){
  if(appState.auth.currentUser?._realSupabase){
    // Real accounts are applied by the hourly PostgreSQL scheduler.
    return;
  }

  (appState.data.DB.scheduleChangeRequests||[]).filter(r=>r.status==='Approved-Pending'&&r.effectiveDate<=clinicToday()).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)).forEach(r=>{
    const doc=appState.data.DB.users.find(u=>u.id===r.doctorId);
    if(doc){
      Object.assign(doc,canonicalSchedule(r.requested));
      addNotif(doc.id,'Schedule Change Now Active','Your approved work schedule change is now in effect.','info');
    }
    r.status='Approved';
    persistDB();
  });
}

export function rejectScheduleChange(reqId){
  const req=(appState.data.DB.scheduleChangeRequests||[]).find(r=>r.id===Number(reqId));
  if(!req)return;
  const doc=getUserById(req.doctorId);
  if(appState.auth.currentUser?.role!=='Administrator'||req.status!=='Pending'){toast('Only administrators can review pending requests.','warning');return;}

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

export function normalizePhilippinePhoneForAuth(localPhone){
  const digits=String(localPhone||'').replace(/\D/g,'');
  if(/^09\d{9}$/.test(digits))return '+63'+digits.slice(1);
  if(/^639\d{9}$/.test(digits))return '+'+digits;
  if(/^\+639\d{9}$/.test(String(localPhone||'')))return String(localPhone);
  return '';
}

export async function refreshCurrentProfileContact(){
  if(!appState.auth.currentUser?._realSupabase)return;

  try{
    const {data:profile,error}=await appState.supabaseClient.supabaseClient
      .from('users')
      .select('email,contact_number')
      .eq('auth_user_id',appState.auth.currentUser.authUserId)
      .maybeSingle();

    if(error||!profile)return;

    appState.auth.currentUser.email=profile.email||appState.auth.currentUser.email;
    appState.auth.currentUser.contact=profile.contact_number||'';
    appState.auth.currentUser.contactNo=profile.contact_number||'';

    const synced=appState.data.DB.users.find(u=>u._realSupabase&&u.dbUserId===appState.auth.currentUser.dbUserId);
    if(synced){
      synced.email=appState.auth.currentUser.email;
      synced.contact=appState.auth.currentUser.contact;
      synced.contactNo=appState.auth.currentUser.contactNo;
    }
  }catch(err){
    console.error('Profile contact refresh:',err);
  }
}

export async function saveAccount(){
  const u=appState.auth.currentUser;
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
    const btn=document.getElementById('account-save-button');
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
        const fresh=appState.data.DB.users.find(x=>x._realSupabase&&x.dbUserId===u.dbUserId);
        if(fresh){
          appState.auth.currentUser.email=fresh.email;
          appState.auth.currentUser.contact=fresh.contact||fresh.contactNo||contact;
          appState.auth.currentUser.contactNo=appState.auth.currentUser.contact;
        }else{
          appState.auth.currentUser.email=email;
          appState.auth.currentUser.contact=contact;
          appState.auth.currentUser.contactNo=contact;
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

  appState.workflowRequests.pendingAccountUpdate={
    email:emailChanged?email:null,
    contact:contactChanged?contact:null,
    authPhone:contactChanged?normalizePhilippinePhoneForAuth(contact):null,
    emailChanged,
    contactChanged
  };

  if(contactChanged&&!appState.workflowRequests.pendingAccountUpdate.authPhone){
    showAlert(msg,'Please enter a valid Philippine mobile number.');
    appState.workflowRequests.pendingAccountUpdate=null;
    return;
  }

  await openAccountUpdateVerification();
}

export async function openAccountUpdateVerification(){
  const u=appState.auth.currentUser;
  const msg=document.getElementById('acc-msg');
  hideAlert(msg);

  if(!appState.workflowRequests.pendingAccountUpdate)return;

  try{
    if(!initializeSupabaseClient())throw new Error('Unable to connect to CampusCare.');

    // Supabase sends a real 6-digit reauthentication nonce to the user's
    // currently verified email address or Auth phone number.
    const {error}=await appState.supabaseClient.supabaseClient.auth.reauthenticate();
    if(error)throw error;

    const {data:{user}}=await appState.supabaseClient.supabaseClient.auth.getUser();
    const channel=user?.email?'email':'phone';
    const destination=user?.email?maskEmail(user.email):maskPhone(user?.phone||appState.auth.currentUser.contact);

    openModal(`<div class="modal modal-sm">
      <div class="modal-header">
        <h3>Verify It's You</h3>
        <button class="close-btn" ${bindAction('click',(event,element)=>{cancelAccountUpdate()})}>✕</button>
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
            ${bindAction('input',(event,element)=>{sanitizeInput(element,'code')})}>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" ${bindAction('click',(event,element)=>{cancelAccountUpdate()})}>Cancel</button>
        <button class="btn" ${bindAction('click',(event,element)=>{resendAccountVerificationCode()})}>Resend Code</button>
        <button class="btn btn-primary" id="acc-verify-btn" ${bindAction('click',(event,element)=>{confirmAccountUpdate()})}>Verify & Continue</button>
      </div>
    </div>`);
  }catch(e){
    appState.workflowRequests.pendingAccountUpdate=null;
    showAlert(msg,e?.message||'Unable to send the verification code.');
  }
}

export async function resendAccountVerificationCode(){
  const msg=document.getElementById('acc-verify-msg');
  hideAlert(msg);
  try{
    const {error}=await appState.supabaseClient.supabaseClient.auth.reauthenticate();
    if(error)throw error;
    showAlert(msg,'A new verification code was sent.','success');
  }catch(e){
    showAlert(msg,e?.message||'Unable to resend the code.');
  }
}

export async function confirmAccountUpdate(){
  const code=document.getElementById('acc-verify-code')?.value.trim()||'';
  const msg=document.getElementById('acc-verify-msg');
  const btn=document.getElementById('acc-verify-btn');
  hideAlert(msg);

  if(!/^\d{6}$/.test(code)){
    showAlert(msg,'Enter the 6-digit verification code.');
    return;
  }
  if(!appState.workflowRequests.pendingAccountUpdate){
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
    if(appState.workflowRequests.pendingAccountUpdate.emailChanged)changes.email=appState.workflowRequests.pendingAccountUpdate.email;
    if(appState.workflowRequests.pendingAccountUpdate.contactChanged)changes.phone=appState.workflowRequests.pendingAccountUpdate.authPhone;

    const {data,error}=await appState.supabaseClient.supabaseClient.auth.updateUser(changes);
    if(error)throw error;

    if(appState.workflowRequests.pendingAccountUpdate.contactChanged){
      openPhoneChangeVerification();
      return;
    }

    // Email-only change: Supabase sends its email-change verification message.
    // The database remains on the old email until the change is confirmed.
    const newEmail=appState.workflowRequests.pendingAccountUpdate.email;
    appState.workflowRequests.pendingAccountUpdate=null;
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

export function openPhoneChangeVerification(){
  const phone=appState.workflowRequests.pendingAccountUpdate?.contact||'';
  openModal(`<div class="modal modal-sm">
    <div class="modal-header">
      <h3>Verify New Contact Number</h3>
      <button class="close-btn" ${bindAction('click',(event,element)=>{cancelAccountUpdate()})}>✕</button>
    </div>
    <div class="modal-body">
      <div id="phone-change-msg"></div>
      <div class="alert alert-info show" style="font-size:.78rem">
        📱 Supabase sent a 6-digit SMS code to <strong>${escapeHtml(maskPhone(phone))}</strong>.
      </div>
      ${appState.workflowRequests.pendingAccountUpdate?.emailChanged
        ? `<p class="form-note">Your email change was also started. Check the verification message sent to <strong>${escapeHtml(appState.workflowRequests.pendingAccountUpdate.email)}</strong> to complete that change.</p>`
        : ''}
      <div class="form-group">
        <label>SMS Verification Code</label>
        <input id="phone-change-code" type="text" maxlength="6" inputmode="numeric"
          placeholder="6-digit code" style="letter-spacing:2px"
          ${bindAction('input',(event,element)=>{sanitizeInput(element,'code')})}>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{cancelAccountUpdate()})}>Cancel</button>
      <button class="btn" ${bindAction('click',(event,element)=>{resendPhoneChangeCode()})}>Resend SMS</button>
      <button class="btn btn-primary" id="phone-change-btn" ${bindAction('click',(event,element)=>{confirmPhoneChangeCode()})}>Verify Number</button>
    </div>
  </div>`);
}

export async function resendPhoneChangeCode(){
  const msg=document.getElementById('phone-change-msg');
  hideAlert(msg);
  try{
    const {error}=await appState.supabaseClient.supabaseClient.auth.resend({
      type:'phone_change',
      phone:appState.workflowRequests.pendingAccountUpdate.authPhone
    });
    if(error)throw error;
    showAlert(msg,'A new SMS verification code was sent.','success');
  }catch(e){
    showAlert(msg,e?.message||'Unable to resend the SMS code.');
  }
}

export async function confirmPhoneChangeCode(){
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
    const {error}=await appState.supabaseClient.supabaseClient.auth.verifyOtp({
      phone:appState.workflowRequests.pendingAccountUpdate.authPhone,
      token:code,
      type:'phone_change'
    });
    if(error)throw error;

    const emailWasChanged=Boolean(appState.workflowRequests.pendingAccountUpdate.emailChanged);
    const pendingEmail=appState.workflowRequests.pendingAccountUpdate.email;
    appState.workflowRequests.pendingAccountUpdate=null;

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

export function cancelAccountUpdate(){
  appState.workflowRequests.pendingAccountUpdate=null;
  closeAllModals();
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.workflowRequests.pendingAccountUpdate=null;
}
