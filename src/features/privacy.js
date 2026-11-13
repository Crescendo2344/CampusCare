// privacy: imported feature APIs; state belongs to explicit application namespaces.
import {closeAllModals,openModal} from './modals.js';
import {showAlert,toast} from './theme.js';
import {openPrivacyNotice,privacyAction} from './loginLockout.js';
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// PRIVACY NOTICE & DATA REQUESTS
// Privacy acknowledgement is collected during registration. Logged-in users
// can review the notice or submit a privacy/data request from Account Settings.
// ================================================================
// The same request types the clinic resolves in System Settings → Privacy.
export const PRIVACY_REQUEST_TYPES=['Copy of my data','Correct my data','Delete my data','Withdraw consent','Other'];
export function openPrivacyRequestModal(){
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Privacy / Data Request</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="privacy-request-msg"></div>
      <div class="form-group">
        <label for="privacy-request-type">What do you need?</label>
        <select id="privacy-request-type">${PRIVACY_REQUEST_TYPES.map(t=>`<option>${t}</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <label for="privacy-request-notes">Request details <span class="required">*</span></label>
        <textarea id="privacy-request-notes" rows="4" maxlength="1200" placeholder="Briefly describe the privacy or personal-data request you want authorized CTU personnel to review."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-warning" ${bindAction('click',(event,element)=>{submitPrivacyRequest()})}>Submit Request</button>
    </div>
  </div>`);
}

export async function submitPrivacyRequest(){
  const notes=document.getElementById('privacy-request-notes')?.value.trim()||'';
  const msg=document.getElementById('privacy-request-msg');
  if(!notes){showAlert(msg,'Please describe your privacy or data request.');return;}

  try{
    await privacyAction({action:'withdraw_request',notes,request_type:document.getElementById('privacy-request-type')?.value||'Other'});
    closeAllModals();
    toast('Privacy/data request submitted for authorized review.','success');
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit the privacy/data request.');
  }
}

// After a new notice version is published, each user acknowledges it once at their next sign-in,
// unless they have an open privacy request of their own. Waits for any open dialog to close first.
export async function promptPrivacyAcknowledgement({tries=0}={}){
  const account=appState.auth.currentUser;
  if(!account?._realSupabase)return;
  if(document.getElementById('active-modal')){
    if(tries<150)setTimeout(()=>promptPrivacyAcknowledgement({tries:tries+1}),2000);
    return;
  }
  let status;
  try{status=await privacyAction({action:'status'});}catch(e){console.error('Privacy status:',e);return;}
  if(appState.auth.currentUser!==account||!status?.needs_acknowledgement)return;
  openModal(`<div class="modal modal-sm" role="dialog" aria-labelledby="pa-title">
    <div class="modal-header"><div><h3 id="pa-title">Updated Privacy Notice</h3><div class="text-muted">Version ${escapeHtml(status.current_version)}${status.policy_updated?` · ${escapeHtml(fmtDate(String(status.policy_updated).slice(0,10)))}`:''}</div></div></div>
    <div class="modal-body"><p>CampusCare's Privacy Notice was updated. Please read it and acknowledge it to continue.</p><div id="pa-msg"></div></div>
    <div class="modal-footer">
      <button type="button" class="btn" ${bindAction('click',()=>openPrivacyNotice())}>Read the notice</button>
      <button type="button" class="btn" ${bindAction('click',()=>openPrivacyRequestModal())}>I have a concern</button>
      <button type="button" class="btn btn-primary" id="pa-ack" ${bindAction('click',async(event,element)=>{
        element.disabled=true;
        try{await privacyAction({action:'acknowledge'});closeAllModals();toast('Thank you. Your acknowledgement was recorded.','success');}
        catch(e){showAlert(document.getElementById('pa-msg'),e?.message||'Could not record your acknowledgement.');element.disabled=false;}
      })}>I acknowledge</button>
    </div>
  </div>`);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
