import {emailValidationError,normalizePhilippineMobile} from '../../supabase/functions/_shared/contact-validation.js';
import {createFeatureSyncService} from '../services/feature-sync.js';
// workflowRequests: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {hideAlert,showAlert,showConfirmDialog,toast,toastWithUndo} from './theme.js';
import {closeAllModals,openModal} from './modals.js';
import {canonicalSchedule,clinicToday,discardCampusDraft,scheduleConflicts,setScheduleDays,validateSchedule} from './scheduleAndDrafts.js';
import {campusDateFieldHtml} from './datePicker.js';
import {syncRealAppointments} from './appointmentService.js';
import {addNotif} from './notifications.js';
import {docName} from './displayNames.js';
import {fmtDate,sanitizeInput} from './inputValidation.js';
import {persistDB} from './persistence.js';
import {refreshTaskBadges} from './topbarAndNavigation.js';
import {getUserById} from './documentScanner.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {programChanged,readProgramFields,savePatientProgram} from './profileDetails.js';
import {renderUsers} from './userManagement.js';
import {renderMyAccount} from './accountSettings.js';
import {initializeSupabaseClient} from './supabaseClient.js';
import {escapeHtml} from './issueReports.js';
import {bindAction,createOperationalService,workflowData} from '../dependencies.js';
import {requestAttachmentFieldHtml,requestAttachmentLocal,requestAttachmentPayload} from './requestAttachments.js';
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
    <div class="modal-header"><div><h3 id="schedule-request-title">Request Schedule Change</h3></div><button class="close-btn" aria-label="Close schedule request" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div id="scr-msg" role="alert"></div>
      <div class="schedule-notice"><strong>This is a weekly schedule change.</strong><p>Selected days repeat every week. For just one day away, use <strong>Request Day Off</strong> in My Schedule.</p></div>
      <fieldset class="schedule-section"><legend><span>1</span> Choose your work days</legend>
        <div class="schedule-presets"><button type="button" class="btn btn-sm" ${bindAction('click',()=>setScheduleDays('weekdays'))}>Mon–Fri</button><button type="button" class="btn btn-sm" ${bindAction('click',()=>setScheduleDays('current'))}>Current pattern</button><button type="button" class="btn btn-sm" ${bindAction('click',()=>setScheduleDays('clear'))}>Clear</button></div>
        <div class="schedule-days">
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>`<label class="schedule-day"><input type="checkbox" class="scr-day" value="${d}" aria-label="${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}" ${(u.workDays||[]).includes(d)?'checked':''}><span>${d}<small class="schedule-day-on">Work</small><small class="schedule-day-off">Off</small></span></label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="schedule-section"><legend><span>2</span> Set hours and appointments</legend>
        <div class="schedule-fields">
          <div class="form-group"><label for="scr-start">Starts at</label><input type="time" id="scr-start" value="${escapeHtml(u.startTime||'08:00')}"></div>
          <div class="form-group"><label for="scr-end">Ends at</label><input type="time" id="scr-end" value="${escapeHtml(u.endTime||'17:00')}"></div>
          <div class="form-group"><label for="scr-slot">Appointment length</label><div class="schedule-unit"><input type="number" id="scr-slot" value="${Number(u.slotDuration)||60}" min="15" max="120" aria-describedby="schedule-slot-help"><span>minutes</span></div><p class="form-note" id="schedule-slot-help">15–120 minutes per slot</p></div>
          <div class="form-group"><label for="scr-max">Daily patient limit</label><input type="number" id="scr-max" value="${Number(u.maxPatients)||20}" min="1" max="500"><p class="form-note">Maximum patients per work day</p></div>
        </div>
      </fieldset>
      <fieldset class="schedule-section"><legend><span>3</span> Choose when and explain why</legend>
        <div class="form-group"><label for="scr-effective">Requested start date <span class="required">*</span></label>${campusDateFieldHtml('scr-effective',clinicToday(),'Choose start date',clinicToday())}</div>
        <div class="form-group"><label for="scr-reason">Reason for change <span class="required">*</span></label><textarea id="scr-reason" rows="3" placeholder="Explain why you need these new days or hours." required></textarea></div>
        ${requestAttachmentFieldHtml('scr-attach','e.g. memo, class load, or training schedule')}
      </fieldset>
      <section class="schedule-review" aria-labelledby="schedule-review-title"><h4 id="schedule-review-title">Review your change</h4>
        <div class="schedule-comparison"><div><strong>Current schedule</strong><p id="schedule-current-summary"></p></div><div><strong>Requested schedule</strong><p id="schedule-proposed-summary"></p></div></div>
        <p id="schedule-effective-summary" class="form-note"></p>
        <div id="schedule-preview" class="schedule-status" aria-live="polite"></div>
      </section>
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
        reason,
        ...requestAttachmentPayload('scr-attach')
      });
      await syncRealWorkflowRequests();
    }else{
      appState.data.DB.scheduleChangeRequests=appState.data.DB.scheduleChangeRequests||[];
      appState.data.DB.nextScheduleReqId=appState.data.DB.nextScheduleReqId||1;
      appState.data.DB.scheduleChangeRequests.push({
        id:appState.data.DB.nextScheduleReqId++,doctorId:u.id,
        currentSchedule:{startTime:u.startTime,endTime:u.endTime,slotDuration:u.slotDuration,maxPatients:u.maxPatients,workDays:u.workDays},
        requested:{startTime,endTime,slotDuration,maxPatients,workDays},
        effectiveDate,reason,status:'Pending',createdAt:appState.clinicInformation.TODAY,
        ...requestAttachmentLocal('scr-attach')
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

export function approveScheduleChange(reqId,note=''){
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
          await workflowAction({action:'decision',request_id:req.dbRequestId,decision:'Approve',admin_note:note});
          await Promise.all([syncAdminDirectoryFromSupabase(),syncRealWorkflowRequests()]);
          offerDecisionUndo(req,effDate<=appState.clinicInformation.TODAY?'Schedule change approved and applied.':`Approved — takes effect on ${fmtDate(effDate)}.`);
        }else{
          const before={...doc};
          if(effDate<=appState.clinicInformation.TODAY){
            Object.assign(doc,canonicalSchedule(req.requested));
            req.status='Approved';
            addNotif(doc.id,'Schedule Change Approved','Your requested work schedule change is now in effect.','success');
          }else{
            req.status='Approved-Pending';
            addNotif(doc.id,'Schedule Change Approved',`Your requested work schedule change has been approved and will take effect on ${fmtDate(effDate)}.`,'success');
          }
          persistDB();
          offerDecisionUndo(req,'Schedule change approved.',()=>Object.assign(doc,before));
        }
        if(appState.navigationRaceProtection.campusActivePageId==='users')await renderUsers();
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

export function rejectScheduleChange(reqId,note=''){
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
          await workflowAction({action:'decision',request_id:req.dbRequestId,decision:'Reject',admin_note:note});
          await syncRealWorkflowRequests();
        }else{
          req.status='Rejected';req.adminNote=note;
          if(doc)addNotif(doc.id,'Schedule Change Declined','Your requested work schedule change was declined by an administrator. Please reach out for more details.','warning');
          persistDB();
        }
        offerDecisionUndo(req,'Request rejected.',()=>{});
        if(appState.navigationRaceProtection.campusActivePageId==='users')await renderUsers();
      }catch(e){
        toast(e?.message||'Unable to reject the request.','error');
      }
    }
  });
}

// After approving or rejecting a request, offer Undo: the request goes back to Pending and whatever the
// approval applied (new name, schedule, day off) is reversed. revertLocal handles the offline demo.
export function offerDecisionUndo(req,message,revertLocal){
  toastWithUndo(message,async()=>{
    if(req._realSupabase){
      await workflowAction({action:'undo_decision',request_id:req.dbRequestId});
      await Promise.all([syncAdminDirectoryFromSupabase(),syncRealWorkflowRequests(),syncRealAppointments()]);
    }else{
      revertLocal();
      req.status='Pending';req.adminNote='';
      persistDB();
    }
    refreshTaskBadges(true);
    if(appState.navigationRaceProtection.campusActivePageId==='users')await renderUsers();
  },{undoneMessage:'Decision undone. The request is pending again.'});
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

  const contactRaw=document.getElementById('acc-contact').value.trim();
  const contact=normalizePhilippineMobile(contactRaw);

  // Apply the registration rules to profile edits without truncating an international number.
  if(contactRaw&&!contact){
    showAlert(msg,'Use a Philippine mobile number starting with 09 or +639.');
    return;
  }

  const contactChanged=contact!==String(u.contact||'');
  const program=readProgramFields();
  const programEdited=programChanged(program);
  if(!contactChanged&&!programEdited){
    showAlert(msg,'No changes to save.','info');
    return;
  }

  // Everyone, administrators included, saves their own contact number and program here. The sign-in
  // email has its own "Change email" step, confirmed by a code sent to the current address.
  const btn=document.getElementById('account-save-button');
  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    if(!u._realSupabase){
      if(contactChanged){u.contact=contact;u.contactNo=contact;}
      if(programEdited&&appState.auth.currentPatient)Object.assign(appState.auth.currentPatient,program);
      persistDB();
      toast('Profile updated.','success');
      renderMyAccount();
      return;
    }
    if(!initializeSupabaseClient())throw new Error('Unable to connect to CampusCare.');
    if(programEdited)await savePatientProgram(program);
    if(contactChanged)await profileAction({action:'update_contact',contact_number:contact});
    await refreshCurrentProfileContact();
    renderMyAccount();
    toast(contactChanged&&!programEdited?'Contact number updated.':'Profile updated.','success');
  }catch(e){
    showAlert(document.getElementById('acc-msg')||msg,e?.message||'Unable to update your profile.');
  }finally{
    if(btn&&document.body.contains(btn)){btn.disabled=false;btn.textContent=oldText||'Save Changes';}
  }
}

export async function profileAction(payload){
  const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');
  const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/profile-actions`,{
    method:'POST',
    headers:{'Content-Type':'application/json',apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify(payload)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'Your profile could not be saved.'),{retryAfter:Number(result.retry_after||0)});
  return result;
}

// Step 1 of changing the sign-in email: type the new address twice, then request a code. The code goes to
// the current address, so only the account owner can move the sign-in email.
export function openChangeEmailModal(prefill=''){
  const current=String(appState.auth.currentUser?.email||'');
  openModal(`<div class="modal otp-modal" role="dialog" aria-labelledby="otp-title" aria-describedby="otp-desc">
    <button class="close-btn otp-close" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button>
    <div class="otp-icon" aria-hidden="true"><i class="bi bi-envelope-at"></i></div>
    <h3 id="otp-title">Change sign-in email</h3>
    <p id="otp-desc" class="otp-desc">Your current email is<br><strong>${escapeHtml(current)}</strong><br>We'll send a code there to confirm it's you.</p>
    <div class="otp-fields">
      <div class="form-group"><label for="ce-new">New email</label><input id="ce-new" type="email" autocomplete="email" maxlength="150" value="${escapeHtml(prefill)}"></div>
      <div class="form-group"><label for="ce-confirm">Confirm new email</label><input id="ce-confirm" type="email" autocomplete="off" maxlength="150" value="${escapeHtml(prefill)}"></div>
    </div>
    <p class="otp-status" id="otp-status" role="alert" aria-live="assertive"></p>
    <button class="btn btn-primary otp-verify" id="ce-request" ${bindAction('click',()=>requestEmailChangeCode())}>Request code</button>
  </div>`);
  for(const id of ['ce-new','ce-confirm'])document.getElementById(id)?.addEventListener('keydown',event=>{if(event.key==='Enter')requestEmailChangeCode();});
  for(const id of ['ce-new','ce-confirm'])document.getElementById(id)?.addEventListener('input',()=>setCodeStatus(''));
  setTimeout(()=>document.getElementById('ce-new')?.focus(),50);
}

async function requestEmailChangeCode(){
  const email=String(document.getElementById('ce-new')?.value||'').trim().toLowerCase();
  const again=String(document.getElementById('ce-confirm')?.value||'').trim().toLowerCase();
  const current=String(appState.auth.currentUser?.email||'').toLowerCase();
  const problem=!email?'Enter your new email.':emailValidationError(email)||(email===current?'That is already your sign-in email.':email!==again?'The two emails do not match.':'');
  if(problem){setCodeStatus(problem,'error');return;}
  const button=document.getElementById('ce-request');
  if(button){button.disabled=true;button.textContent='Sending…';}
  try{
    const result=await profileAction({action:'request_email_change',email});
    openEmailCodeModal(email,result.sent_to||appState.auth.currentUser?.email||'');
  }catch(e){
    setCodeStatus(e.message,'error');
    if(button){button.disabled=false;button.textContent='Request code';}
  }
}

// Step 2: six boxes like most sign-in screens. Typing moves on, paste fills them all, Backspace steps
// back, and the code is checked as soon as the sixth digit is in.
export function openEmailCodeModal(email,sentTo){
  openModal(`<div class="modal otp-modal" role="dialog" aria-labelledby="otp-title" aria-describedby="otp-desc">
    <button class="close-btn otp-close" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button>
    <div class="otp-icon" aria-hidden="true"><i class="bi bi-envelope-check"></i></div>
    <h3 id="otp-title">Check your email</h3>
    <p id="otp-desc" class="otp-desc">Enter the 6-digit code we sent to your current email<br><strong>${escapeHtml(sentTo)}</strong><br>Your sign-in email will change to <strong>${escapeHtml(email)}</strong>.</p>
    <div class="otp-boxes" id="otp-boxes" role="group" aria-label="6-digit verification code">
      ${Array.from({length:6},(_,i)=>`<input class="otp-box" inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit ${i+1} of 6" ${i===0?'autocomplete="one-time-code"':'autocomplete="off"'}>`).join('')}
    </div>
    <p class="otp-status" id="otp-status" role="alert" aria-live="assertive"></p>
    <button class="btn btn-primary otp-verify" id="otp-verify" disabled ${bindAction('click',()=>confirmEmailCode(email))}>Verify</button>
    <p class="otp-resend">Didn't get it? <button type="button" class="link-btn" id="otp-resend" disabled ${bindAction('click',()=>resendEmailCode(email,sentTo))}>Resend code</button></p>
    <button type="button" class="link-btn otp-change" ${bindAction('click',()=>openChangeEmailModal(email))}>Use a different new email</button>
    <p class="otp-note">The code expires in 10 minutes. Check Spam or Promotions if it isn't in your inbox.</p>
  </div>`);
  wireCodeBoxes(()=>confirmEmailCode(email));
  startResendCountdown(60);
}

function codeBoxes(){return [...document.querySelectorAll('#otp-boxes .otp-box')];}
function enteredCode(){return codeBoxes().map(box=>box.value).join('');}
function setCodeStatus(text,kind=''){
  const status=document.getElementById('otp-status'),boxes=document.getElementById('otp-boxes');
  if(status){status.textContent=text;status.className=`otp-status ${kind}`;}
  boxes?.classList.toggle('error',kind==='error');
  if(kind==='error'){boxes?.classList.remove('shake');void boxes?.offsetWidth;boxes?.classList.add('shake');}
}

function wireCodeBoxes(onComplete){
  const boxes=codeBoxes();
  const refresh=()=>{
    const code=enteredCode();
    boxes.forEach(box=>box.classList.toggle('filled',Boolean(box.value)));
    const verify=document.getElementById('otp-verify');if(verify)verify.disabled=code.length!==6;
    if(code.length===6)onComplete();
  };
  const fill=(start,digits)=>{
    digits.slice(0,6-start).split('').forEach((d,i)=>{boxes[start+i].value=d;});
    boxes[Math.min(start+digits.length,5)].focus();
  };
  boxes.forEach((box,i)=>{
    box.addEventListener('input',()=>{
      const digits=box.value.replace(/\D/g,'');
      if(document.getElementById('otp-status')?.textContent)setCodeStatus('');
      if(digits.length>1)fill(i,digits);           // autofill or a phone keyboard suggestion
      else{box.value=digits;if(digits&&i<5)boxes[i+1].focus();}
      refresh();
    });
    box.addEventListener('keydown',event=>{
      if(event.key==='Backspace'&&!box.value&&i>0){boxes[i-1].value='';boxes[i-1].focus();refresh();event.preventDefault();}
      else if(event.key==='ArrowLeft'&&i>0){boxes[i-1].focus();event.preventDefault();}
      else if(event.key==='ArrowRight'&&i<5){boxes[i+1].focus();event.preventDefault();}
      else if(event.key==='Enter'&&enteredCode().length===6)onComplete();
    });
    box.addEventListener('focus',()=>box.select());
    box.addEventListener('paste',event=>{
      const digits=(event.clipboardData?.getData('text')||'').replace(/\D/g,'');
      if(!digits)return;
      event.preventDefault();fill(digits.length>=6?0:i,digits);refresh();
    });
  });
  setTimeout(()=>boxes[0]?.focus(),50);
}

function startResendCountdown(seconds){
  const button=document.getElementById('otp-resend');if(!button)return;
  clearTimeout(button._timer);
  let left=Math.max(0,Math.ceil(seconds));
  const tick=()=>{
    if(!document.body.contains(button))return;
    button.disabled=left>0;
    button.textContent=left>0?`Resend code in 0:${String(left).padStart(2,'0')}`:'Resend code';
    if(left-->0)button._timer=setTimeout(tick,1000);
  };
  tick();
}

async function resendEmailCode(email,sentTo){
  const button=document.getElementById('otp-resend');if(button)button.disabled=true;
  try{
    await profileAction({action:'request_email_change',email});
    codeBoxes().forEach(box=>{box.value='';box.classList.remove('filled');});
    setCodeStatus(`A new code was sent to ${sentTo}.`,'success');
    codeBoxes()[0]?.focus();
    startResendCountdown(60);
  }catch(e){
    setCodeStatus(e.message,'error');
    startResendCountdown(e.retryAfter||0);
  }
}

let checkingCode=false;
async function confirmEmailCode(email){
  if(checkingCode||enteredCode().length!==6)return;
  checkingCode=true;
  const button=document.getElementById('otp-verify');
  if(button){button.disabled=true;button.textContent='Verifying…';}
  codeBoxes().forEach(box=>{box.disabled=true;});
  try{
    await profileAction({action:'confirm_email_change',code:enteredCode()});
    document.getElementById('otp-boxes')?.classList.add('success');
    setCodeStatus('Verified','success');
    await new Promise(resolve=>setTimeout(resolve,600));
    closeAllModals();
    await refreshCurrentProfileContact();
    renderMyAccount();
    toast(`Your sign-in email is now ${email}.`,'success');
  }catch(e){
    codeBoxes().forEach(box=>{box.disabled=false;box.value='';box.classList.remove('filled');});
    setCodeStatus(e.message,'error');
    codeBoxes()[0]?.focus();
    if(button){button.textContent='Verify';button.disabled=true;}
  }finally{checkingCode=false;}
}

export function cancelAccountUpdate(){
  appState.workflowRequests.pendingAccountUpdate=null;
  closeAllModals();
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.workflowRequests.pendingAccountUpdate=null;
}
