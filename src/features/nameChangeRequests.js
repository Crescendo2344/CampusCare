// nameChangeRequests: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {closeAllModals,openModal} from './modals.js';
import {readFileAsDataURL,resizeImageDataUrl,sanitizeInput} from './inputValidation.js';
import {hideAlert,showAlert,showConfirmDialog,toast} from './theme.js';
import {syncRealWorkflowRequests,workflowAction} from './workflowRequests.js';
import {addNotif} from './notifications.js';
import {persistDB} from './persistence.js';
import {escapeHtml} from './issueReports.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {renderUsers} from './userManagement.js';
import {initializeSupabaseClient} from './supabaseClient.js';
import {renderMyAccount} from './accountSettings.js';
import {checkPasswordStrength} from './loginLockout.js';
import {authTab} from './authentication.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// NAME CHANGE REQUESTS — names can't be self-edited; must go through admin
// ================================================================
export function openNameChangeRequest(){
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Request Name Change</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="ncr-msg"></div>
      <p class="form-note" style="margin-bottom:.7rem">For security, name changes must be reviewed by an administrator. We'll notify you by email once it's approved.</p>
      <div class="form-row">
        <div class="form-group"><label>Requested First Name</label><input id="ncr-fname" value="${appState.auth.currentUser.fname}" ${bindAction('input',(event,element)=>{sanitizeInput(element,'name')})}></div>
        <div class="form-group"><label>Requested Last Name</label><input id="ncr-lname" value="${appState.auth.currentUser.lname}" ${bindAction('input',(event,element)=>{sanitizeInput(element,'name')})}></div>
      </div>
      <div class="form-group"><label>Reason</label><textarea id="ncr-reason" rows="3" placeholder="e.g. legal name change, misspelling on record"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{submitNameChangeRequest()})}>Submit Request</button></div>
  </div>`);
}

export async function submitNameChangeRequest(){
  const fname=document.getElementById('ncr-fname').value.trim();
  const lname=document.getElementById('ncr-lname').value.trim();
  const reason=document.getElementById('ncr-reason').value.trim();
  const msg=document.getElementById('ncr-msg');

  hideAlert(msg);
  if(!fname||!lname){showAlert(msg,'Please fill in both name fields.');return;}
  if(fname===appState.auth.currentUser.fname&&lname===appState.auth.currentUser.lname){
    showAlert(msg,'This matches your current name — nothing to change.');
    return;
  }

  try{
    if(appState.auth.currentUser?._realSupabase){
      await workflowAction({
        action:'create',
        request_type:'Name Change',
        requested_first_name:fname,
        requested_last_name:lname,
        reason
      });
      await syncRealWorkflowRequests();
    }else{
      appState.data.DB.nameChangeRequests=appState.data.DB.nameChangeRequests||[];
      appState.data.DB.nextNameReqId=appState.data.DB.nextNameReqId||1;
      appState.data.DB.nameChangeRequests.push({
        id:appState.data.DB.nextNameReqId++,userId:appState.auth.currentUser.id,
        currentFname:appState.auth.currentUser.fname,currentLname:appState.auth.currentUser.lname,
        requestedFname:fname,requestedLname:lname,reason,status:'Pending',createdAt:appState.clinicInformation.TODAY
      });
      appState.data.DB.users.filter(a=>a.role==='Administrator').forEach(a=>
        addNotif(a.id,'Name Change Request',`${appState.auth.currentUser.fname} ${appState.auth.currentUser.lname} requests to change their name to "${fname} ${lname}".`,'info')
      );
      persistDB();
    }

    toast('Request submitted. An admin will review it and you will be notified.','success');
    closeAllModals();
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit the name change request.');
  }
}

export function approveNameChange(reqId){
  const req=(appState.data.DB.nameChangeRequests||[]).find(r=>r.id===Number(reqId));
  if(!req)return;

  showConfirmDialog({
    title:'Approve Name Change',
    message:`Approve changing "<strong>${escapeHtml(req.currentFname)} ${escapeHtml(req.currentLname)}</strong>" to "<strong>${escapeHtml(req.requestedFname)} ${escapeHtml(req.requestedLname)}</strong>"?`,
    confirmLabel:'Approve',
    onConfirm:async()=>{
      try{
        if(req._realSupabase){
          await workflowAction({action:'decision',request_id:req.dbRequestId,decision:'Approve'});
          await Promise.all([syncAdminDirectoryFromSupabase(),syncRealWorkflowRequests()]);
        }else{
          const user=appState.data.DB.users.find(u=>u.id===req.userId);
          if(user){user.fname=req.requestedFname;user.lname=req.requestedLname;}
          req.status='Approved';
          if(user)addNotif(user.id,'Name Change Approved',`Your name has been updated to "${req.requestedFname} ${req.requestedLname}".`,'success');
          persistDB();
        }

        toast('Name change approved.','success');
        if(document.getElementById('user-table'))await renderUsers();
      }catch(e){
        toast(e?.message||'Unable to approve the name change.','error');
      }
    }
  });
}

export function rejectNameChange(reqId){
  const req=(appState.data.DB.nameChangeRequests||[]).find(r=>r.id===Number(reqId));
  if(!req)return;

  showConfirmDialog({
    title:'Reject Name Change',
    message:`Reject this name change request for "<strong>${escapeHtml(req.currentFname)} ${escapeHtml(req.currentLname)}</strong>"?`,
    confirmLabel:'Reject',
    danger:true,
    onConfirm:async()=>{
      try{
        if(req._realSupabase){
          await workflowAction({action:'decision',request_id:req.dbRequestId,decision:'Reject'});
          await syncRealWorkflowRequests();
        }else{
          req.status='Rejected';
          const user=appState.data.DB.users.find(u=>u.id===req.userId);
          if(user)addNotif(user.id,'Name Change Request Declined','Your name change request was declined by an administrator. Please contact the clinic office for more information.','warning');
          persistDB();
        }

        toast('Request rejected.','success');
        if(document.getElementById('user-table'))await renderUsers();
      }catch(e){
        toast(e?.message||'Unable to reject the name change.','error');
      }
    }
  });
}

export async function uploadCurrentUserProfilePhoto(file){
  if(!file)throw new Error('Profile photo is required.');
  if(!initializeSupabaseClient())throw new Error('Unable to connect to CampusCare.');

  const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const form=new FormData();
  form.append('photo',file,file.name||'profile.jpg');

  const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/account-profile-photo`,{
    method:'POST',
    headers:{
      apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:form
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to update profile photo.');

  // Update the currently logged-in UI immediately.
  appState.auth.currentUser.profilePhoto=result.signed_url||'';
  appState.auth.currentUser.profileImage=result.signed_url||'';

  // Keep the synchronized real-user copy current too.
  const synced=appState.data.DB.users.find(u=>u._realSupabase&&u.dbUserId===appState.auth.currentUser.dbUserId);
  if(synced){
    synced.profilePhoto=appState.auth.currentUser.profilePhoto;
    synced.profileImage=appState.auth.currentUser.profileImage;
  }

  // If this user also has a patient record, update its visible photo reference.
  const patient=appState.data.DB.patients.find(p=>p._realSupabase&&p.dbUserId===appState.auth.currentUser.dbUserId);
  if(patient)patient.profilePhoto=appState.auth.currentUser.profilePhoto;

  const sbAvatarEl=document.getElementById('sb-avatar');
  if(sbAvatarEl){
    sbAvatarEl.innerHTML=appState.auth.currentUser.profilePhoto
      ? `<img src="${escapeHtml(appState.auth.currentUser.profilePhoto)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : `${(appState.auth.currentUser.fname?.[0]||'')}${(appState.auth.currentUser.lname?.[0]||'')}`;
  }

  return result;
}

export function dataUrlToProfileFile(dataUrl,filename='profile.jpg'){
  const parts=String(dataUrl||'').split(',');
  if(parts.length<2)throw new Error('Captured image is invalid.');
  const mime=(parts[0].match(/data:(.*?);/)||[])[1]||'image/jpeg';
  const binary=atob(parts[1]);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new File([bytes],filename,{type:mime});
}

export async function changeProfilePhoto(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  if(!file.type.startsWith('image/')){
    toast('Please choose an image file.','error');
    input.value='';
    return;
  }

  const btn=document.querySelector('button[onclick*="acc-photo-file"]');
  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Uploading…';}

  try{
    // Resize before upload to keep Storage usage and load time reasonable.
    const raw=await readFileAsDataURL(file);
    const resized=await resizeImageDataUrl(raw,700,0.88);
    const uploadFile=dataUrlToProfileFile(resized,'profile.jpg');

    await uploadCurrentUserProfilePhoto(uploadFile);

    toast('Profile photo updated.','success');
    renderMyAccount();

    // If Administrator opens User Management next, the real Supabase image
    // will also be refreshed from the database and signed Storage URL.
    if(appState.auth.currentUser.role==='Administrator'&&typeof syncAdminDirectoryFromSupabase==='function'){
      syncAdminDirectoryFromSupabase().catch(console.error);
    }
  }catch(e){
    console.error('Profile photo upload:',e);
    toast(e?.message||'Could not update your photo. Please try a different image.','error');
  }finally{
    input.value='';
    if(btn){btn.disabled=false;btn.textContent=oldText||'Upload Photo';}
  }
}

export function accountPasswordCooldownState(){
  const raw=appState.auth.currentUser?.passwordChangedAt||appState.auth.currentUser?.password_changed_at||'';
  if(!raw)return {locked:false,next:null};
  const changed=new Date(raw);
  if(Number.isNaN(changed.getTime()))return {locked:false,next:null};
  const next=new Date(changed.getTime()+7*24*60*60*1000);
  return {locked:Date.now()<next.getTime(),next};
}

export function renderPasswordCooldownNotice(){
  const note=document.getElementById('pw-cooldown-note');
  const btn=document.getElementById('pw-change-btn');
  if(!note)return;

  const state=accountPasswordCooldownState();
  if(state.locked&&state.next){
    note.className='alert alert-warning show';
    note.innerHTML=`🔒 Your password was changed recently. You can change it again on <strong>${state.next.toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}</strong>.`;
    if(btn)btn.disabled=true;
  }else{
    note.className='alert alert-info show';
    note.textContent='🔐 Enter your current password, then choose a new password that meets the security requirements below.';
    if(btn)btn.disabled=false;
  }
}

export function showAccountPasswordChecklist(){
  const el=document.getElementById('pw-strength');
  if(el)el.classList.add('show');
  updateAccountPasswordStrength();
}

export function hideAccountPasswordChecklist(){
  const el=document.getElementById('pw-strength');
  if(el)el.classList.remove('show');
}

export function updateAccountPasswordStrength(){
  const input=document.getElementById('pw-new');
  const el=document.getElementById('pw-strength');
  const label=document.getElementById('pw-strength-label');
  if(!input||!el)return;

  const {checks,score,valid}=checkPasswordStrength(input.value);
  el.querySelectorAll('.password-check').forEach(item=>{
    item.classList.toggle('met',Boolean(checks[item.dataset.check]));
  });

  if(label){
    let strength='Weak password',cls='weak';
    if(valid&&score>=5){strength='Strong password';cls='strong';}
    else if(valid||score>=3){strength='Medium password';cls='medium';}
    label.textContent=strength;
    label.className='password-strength-label '+cls;
  }
}

export async function changeAccountPassword(){
  const cur=document.getElementById('pw-cur')?.value||'';
  const nw=document.getElementById('pw-new')?.value||'';
  const conf=document.getElementById('pw-conf')?.value||'';
  const msg=document.getElementById('pw-msg');
  const btn=document.getElementById('pw-change-btn');
  hideAlert(msg);

  const cooldown=accountPasswordCooldownState();
  if(cooldown.locked&&cooldown.next){
    showAlert(msg,`You can change your password again on ${cooldown.next.toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}.`,'warning');
    return;
  }

  if(!cur){
    showAlert(msg,'Enter your current password.');
    return;
  }
  if(!nw||!checkPasswordStrength(nw).valid){
    showAlert(msg,'New password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.');
    showAccountPasswordChecklist();
    return;
  }
  if(nw!==conf){
    showAlert(msg,'Passwords do not match.');
    return;
  }
  if(cur===nw){
    showAlert(msg,'Your new password must be different from your current password.');
    return;
  }

  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Changing…';}

  try{
    const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
    if(!session)throw new Error('Your session has expired. Please log in again.');

    const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/change-password`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
        Authorization:`Bearer ${session.access_token}`
      },
      body:JSON.stringify({
        current_password:cur,
        new_password:nw
      })
    });

    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok){
      if(result.next_allowed_at){
        appState.auth.currentUser.passwordChangedAt=result.next_allowed_at
          ? new Date(new Date(result.next_allowed_at).getTime()-7*24*60*60*1000).toISOString()
          : appState.auth.currentUser.passwordChangedAt;
        renderPasswordCooldownNotice();
      }
      throw new Error(result.error||'Unable to change password.');
    }

    appState.auth.currentUser.passwordChangedAt=result.password_changed_at||new Date().toISOString();

    // Sign out after a credential change so the new password is used for the next session.
    await appState.supabaseClient.supabaseClient.auth.signOut();
    appState.auth.currentUser=null;
    appState.auth.currentPatient=null;
    sessionStorage.removeItem(appState.persistence.SESSION_KEY);

    document.getElementById('app')?.classList.remove('visible');
    const auth=document.getElementById('auth-wrap');
    if(auth)auth.style.display='block';
    authTab('login');

    toast('Password changed successfully. Please log in again with your new password.','success',6500);
  }catch(e){
    showAlert(msg,e?.message||'Unable to change password.');
    if(btn){btn.disabled=false;btn.textContent=oldText||'Change Password';}
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
