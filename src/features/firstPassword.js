// A new doctor or staff account signs in with a password that was emailed to them. Before anything else
// they choose their own; the only other way out of this step is signing out.
import {state as appState} from '../app/state.js';
import {openModal} from './modals.js';
import {bindAction} from '../dependencies.js';
import {escapeHtml} from './issueReports.js';
import {checkPasswordStrength} from './loginLockout.js';
import {logout} from './passwordRecovery.js';
import {toast} from './theme.js';

export async function enforceFirstPasswordChange(){
  const client=appState.supabaseClient?.supabaseClient;
  if(!client||!appState.auth.currentUser?._realSupabase)return;
  const {data:{session}}=await client.auth.getSession();
  if(session?.user?.app_metadata?.must_change_password!==true)return;
  openModal(`<div class="modal modal-sm" role="dialog" aria-labelledby="fp-title" aria-describedby="fp-intro">
    <div class="modal-header"><div><h3 id="fp-title">Choose your own password</h3></div><button class="close-btn" aria-label="Sign out instead" ${bindAction('click',()=>logout())}>✕</button></div>
    <div class="modal-body">
      <p class="form-note" id="fp-intro">You signed in with the password that was emailed to you. Replace it with one only you know to continue.</p>
      <div id="fp-msg"></div>
      <div class="form-group"><label for="fp-current">Emailed password</label><input id="fp-current" type="password" autocomplete="current-password"></div>
      <div class="form-group"><label for="fp-new">New password</label><input id="fp-new" type="password" autocomplete="new-password" maxlength="64" aria-describedby="fp-rules"><p class="form-note" id="fp-rules">8–64 characters with an uppercase letter, a lowercase letter and a number.</p></div>
      <div class="form-group"><label for="fp-confirm">Confirm new password</label><input id="fp-confirm" type="password" autocomplete="new-password" maxlength="64"></div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>logout())}>Sign out</button><button class="btn btn-primary" id="fp-save" ${bindAction('click',()=>saveFirstPassword())}>Save and continue</button></div>
  </div>`);
  document.getElementById('fp-current')?.focus();
}

async function saveFirstPassword(){
  const value=id=>document.getElementById(id)?.value||'';
  const msg=document.getElementById('fp-msg'),btn=document.getElementById('fp-save');
  const current=value('fp-current'),next=value('fp-new'),confirm=value('fp-confirm');
  const problem=!current?'Enter the password from the email.':!checkPasswordStrength(next).valid?'Use 8–64 characters with an uppercase letter, a lowercase letter and a number.':next===current?'Choose a password different from the emailed one.':next!==confirm?'The new passwords do not match.':'';
  if(problem){msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(problem)}</div>`;return;}
  btn.disabled=true;btn.textContent='Saving…';
  try{
    const client=appState.supabaseClient.supabaseClient;
    const {data:{session}}=await client.auth.getSession();
    if(!session)throw new Error('Your session has expired. Please sign in again.');
    const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/change-password`,{method:'POST',
      headers:{'Content-Type':'application/json',apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify({current_password:current,new_password:next})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Your password could not be changed.');
    toast('Password changed. Sign in again with your new password.','success',6000);
    await logout();
  }catch(error){
    msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'Your password could not be changed.')}</div>`;
    btn.disabled=false;btn.textContent='Save and continue';
  }
}
