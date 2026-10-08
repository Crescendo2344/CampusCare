// privacy: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {closeAllModals,openModal} from './modals.js';
import {showAlert,toast} from './theme.js';
import {privacyAction} from './loginLockout.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// PRIVACY NOTICE & DATA REQUESTS
// Privacy acknowledgement is collected during registration. Logged-in users
// can review the notice or submit a privacy/data request from Account Settings.
// ================================================================
export function openPrivacyRequestModal(){
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Privacy / Data Request</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="privacy-request-msg"></div>
      <div class="alert alert-info show" style="font-size:.76rem">
        Use this form to request review of access, correction, objection, withdrawal, deletion, or another privacy-related concern.
        Submitting a request does not automatically erase or disable medical/dental records that CTU may be required or otherwise lawfully permitted to retain.
      </div>
      <div class="form-group">
        <label>Request details <span class="required">*</span></label>
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
    await privacyAction({action:'withdraw_request',notes});
    closeAllModals();
    toast('Privacy/data request submitted for authorized review.','success');
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit the privacy/data request.');
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
