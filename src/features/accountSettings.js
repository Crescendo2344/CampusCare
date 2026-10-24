// accountSettings: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {closeAllModals,openModal,showFilePreview} from './modals.js';
import {collegeBadge,fmtTime,priorityBadge,sanitizeInput,statusBadge} from './inputValidation.js';
import {navTo} from './navigationRaceProtection.js';
import {openCamera} from '../app/optional-features.js';
import {changeAccountPassword,changeProfilePhoto,hideAccountPasswordChecklist,openNameChangeRequest,renderPasswordCooldownNotice,showAccountPasswordChecklist,updateAccountPasswordStrength} from './nameChangeRequests.js';
import {openScheduleChangeRequest,saveAccount} from './workflowRequests.js';
import {openPrivacyNotice} from './loginLockout.js';
import {openPrivacyRequestModal} from './privacy.js';
import {setThemePreference,showConfirmDialog,themePreference,toast} from './theme.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// MY ACCOUNT
// ================================================================
export function formatLastLogin(value){
  if(!value)return 'Never';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return escapeHtml(String(value));
  return d.toLocaleString('en-PH',{
    year:'numeric',month:'short',day:'numeric',
    hour:'numeric',minute:'2-digit'
  });
}

export function openProfileDetails(){
  const u=appState.auth.currentUser;
  const pt=appState.auth.currentPatient;
  const photoHtml = u.profilePhoto
    ? `<img src="${u.profilePhoto}" style="width:84px;height:84px;border-radius:50%;object-fit:cover;cursor:pointer" ${bindAction('click',(event,element)=>{showFilePreview((String(u.fname)+" "+String(u.lname)+" - Photo"),(String(u.profilePhoto)))})} title="Click to view full size">`
    : `<div class="sb-avatar" style="width:84px;height:84px;font-size:1.8rem">${(u.fname[0]||'')}${(u.lname[0]||'')}</div>`;
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Profile Details</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div style="display:flex;flex-direction:column;align-items:center;gap:.6rem;margin-bottom:1rem">
        ${photoHtml}
        <div style="text-align:center">
          <strong style="font-size:1.05rem">${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>
          <div><span class="badge badge-info">${u.role}</span></div>
        </div>
      </div>
      <div class="info-row"><span class="info-label">Username</span><span class="info-val">${escapeHtml(u.username)}</span></div>
      <div class="info-row"><span class="info-label">Email</span><span class="info-val">${escapeHtml(u.email)}</span></div>
      <div class="info-row"><span class="info-label">Contact</span><span class="info-val">${u.contact?escapeHtml(u.contact):'—'}</span></div>
      ${pt?`<div class="info-row"><span class="info-label">College</span><span class="info-val">${collegeBadge(pt.college)}</span></div>
      <div class="info-row"><span class="info-label">Type</span><span class="info-val">${priorityBadge(pt.personType)}</span></div>`:''}
      <div class="info-row"><span class="info-label">Status</span><span class="info-val">${statusBadge(u.status)}</span></div>
      <div class="info-row"><span class="info-label">Last Login</span><span class="info-val">${formatLastLogin(u.lastLogin)}</span></div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
      <button class="btn btn-primary" ${bindAction('click',(event,element)=>{closeAllModals();navTo('my-account')})}>Go to Account Settings</button>
    </div>
  </div>`);
}

export function renderMyAccount(){
  const c=document.getElementById('app-content');
  const u=appState.auth.currentUser;
  const pt=appState.auth.currentPatient;
  c.innerHTML=`
    <div class="grid-2">
      <div>
        <div class="card">
          <div class="card-header"><h3>Profile Photo</h3></div>
          <div style="display:flex;align-items:center;gap:1rem">
            <div id="acc-photo-wrap" style="width:72px;height:72px;border-radius:50%;overflow:hidden;background:var(--overlay);border:1px solid var(--glass-border-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;font-size:1.1rem;color:var(--primary-dark)${u.profilePhoto?';cursor:pointer':''}" ${u.profilePhoto?`${bindAction('click',(event,element)=>{showFilePreview((String(u.fname)+" "+String(u.lname)+" - Photo"),(String(u.profilePhoto)))})} title="Click to view full size"`:''}>
              ${u.profilePhoto?`<img src="${escapeHtml(u.profilePhoto)}" alt="Your profile photo" style="width:100%;height:100%;object-fit:cover">`:escapeHtml(`${(u.fname[0]||'')}${(u.lname[0]||'')}`)}
            </div>
            <div>
              <button class="btn btn-sm" ${bindAction('click',(event,element)=>{document.getElementById('acc-photo-file').click()})}>Upload Photo</button>
              <button class="btn btn-sm btn-info" ${bindAction('click',(event,element)=>{openCamera('account')})}><i class="bi bi-camera" aria-hidden="true"></i> Use Camera</button>
              <input type="file" id="acc-photo-file" accept="image/*" style="display:none" ${bindAction('change',(event,element)=>{changeProfilePhoto(element)})}>
              <p class="form-note">Shown on your clinic records so staff can recognise you. JPG or PNG; square photos look best.</p>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Profile Information</h3></div>
          <div id="acc-msg"></div>
          <div class="form-row">
            <div class="form-group"><label>First Name</label><input id="acc-fname" value="${escapeHtml(u.fname)}" disabled></div>
            <div class="form-group"><label>Last Name</label><input id="acc-lname" value="${escapeHtml(u.lname)}" disabled></div>
          </div>
          <p class="form-note" style="margin:-.2rem 0 .8rem">${u.role==='Administrator'?'As an administrator, you can update your name directly from User Management.':`For security, your name can only be changed by an administrator. <a href="#" ${bindAction('click',(event,element)=>{openNameChangeRequest();return false;})} style="color:var(--primary);text-decoration:none">Request a name change →</a>`}</p>
          <div class="divider"></div>
          <div class="form-group"><label>Email</label><input id="acc-email" value="${escapeHtml(u.email||'')}" type="email" autocomplete="email" ${bindAction('input',(event,element)=>{sanitizeInput(element,'email')})}></div>
          <div class="form-group"><label>Contact No.</label><input id="acc-contact" value="${escapeHtml(u.contact||'')}" autocomplete="tel" type="tel" inputmode="tel" maxlength="24" placeholder="09XXXXXXXXX or +639XXXXXXXXX" ${bindAction('input',(event,element)=>{sanitizeInput(element,'phone')})}></div>
          ${u.role==='Administrator'
            ? '<p class="form-note">As an administrator, updating your email or contact applies immediately — no verification code needed.</p>'
            : '<p class="form-note">To change your email or contact number, you will confirm with a 6-digit code sent to your current email or phone. A new phone number also gets its own confirmation code.</p>'}
          <button class="btn btn-primary btn-sm" id="account-save-button" ${bindAction('click',(event,element)=>{saveAccount()})}>Save Changes</button>
        </div>
        <div class="card">
          <div class="card-header">
            <div>
              <h3>Change Password</h3>
              <div class="tech-note">For account security, a password can be changed only once every 7 days.</div>
            </div>
          </div>
          <div id="pw-msg"></div>
          <div id="pw-cooldown-note" class="alert alert-info show" style="font-size:.76rem"></div>
          <div class="form-group">
            <label>Current Password</label>
            <input id="pw-cur" type="password" autocomplete="current-password"
              ${bindAction('input',(event,element)=>{sanitizeInput(element,'password')})}>
          </div>
          <div class="form-group">
            <label>New Password</label>
            <input id="pw-new" type="password" autocomplete="new-password"
              ${bindAction('focus',(event,element)=>{showAccountPasswordChecklist()})}
              ${bindAction('input',(event,element)=>{sanitizeInput(element,'password');updateAccountPasswordStrength()})}
              ${bindAction('blur',(event,element)=>{hideAccountPasswordChecklist()})}>
          </div>
          <div id="pw-strength" class="password-checklist" aria-live="polite">
            <div id="pw-strength-label" class="password-strength-label weak">Weak password</div>
            <div class="password-check" data-check="length"><span class="pw-check-icon"></span><span>At least 8 characters</span></div>
            <div class="password-check" data-check="upper"><span class="pw-check-icon"></span><span>One uppercase letter</span></div>
            <div class="password-check" data-check="lower"><span class="pw-check-icon"></span><span>One lowercase letter</span></div>
            <div class="password-check" data-check="number"><span class="pw-check-icon"></span><span>One number</span></div>
            <div class="password-check" data-check="special"><span class="pw-check-icon"></span><span>Special character <span class="text-muted">(recommended)</span></span></div>
          </div>
          <div class="form-group">
            <label>Confirm New Password</label>
            <input id="pw-conf" type="password" autocomplete="new-password"
              ${bindAction('input',(event,element)=>{sanitizeInput(element,'password')})}>
          </div>
          <button class="btn btn-primary btn-sm" id="pw-change-btn" ${bindAction('click',(event,element)=>{changeAccountPassword()})}>Change Password</button>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-header"><h3>Account Information</h3></div>
          <div class="info-row"><span class="info-label">Username</span><span class="info-val">@${escapeHtml(u.username||'')}</span></div>
          <div class="info-row"><span class="info-label">Role</span><span class="info-val">${escapeHtml(u.role)}</span></div>
          <div class="info-row"><span class="info-label">Status</span><span class="info-val">${statusBadge(u.status)}</span></div>
          <div class="info-row"><span class="info-label">Email Verification</span><span class="info-val">${u.emailVerificationSkipped?'<span class="badge badge-info">Temporarily skipped</span>':u.emailConfirmedAt?'<span class="badge badge-success">Confirmed</span>':'<span class="badge badge-warning">Not confirmed</span>'}</span></div>
          <div class="info-row"><span class="info-label">Last Login</span><span class="info-val">${formatLastLogin(u.lastLogin)}</span></div>
          ${pt?`<div class="info-row"><span class="info-label">College</span><span class="info-val">${collegeBadge(pt.college)}</span></div>
          <div class="info-row"><span class="info-label">Person Type</span><span class="info-val">${priorityBadge(pt.personType)}</span></div>
          <div class="info-row"><span class="info-label">ID No.</span><span class="info-val">${escapeHtml(pt.idNo||'—')}</span></div>`:''}
        </div>
        <div class="card">
          <div class="card-header">
            <div>
              <h3>Privacy &amp; Personal Data</h3>
              <div class="tech-note">Privacy acknowledgement is collected during registration; repeated acknowledgement is not required during normal use.</div>
            </div>
          </div>
          <p class="text-muted" style="font-size:.78rem;line-height:1.6">
            You can review the current CampusCare Privacy Notice at any time or submit a privacy/data request for authorized CTU review.
          </p>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem">
            <button class="btn btn-sm" ${bindAction('click',(event,element)=>{openPrivacyNotice()})}>View Privacy Notice</button>
            <button class="btn btn-sm btn-warning" ${bindAction('click',(event,element)=>{openPrivacyRequestModal()})}>Submit Privacy / Data Request</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Appearance</h3></div>
          <div class="form-group"><label for="acc-theme">Theme</label>
            <select id="acc-theme" ${bindAction('change',(event,element)=>{setThemePreference(element.value);toast(element.value==='auto'?'Theme now follows the time of day.':`${element.value==='dark'?'Dark':'Light'} theme saved on this device.`,'success');})}>
              ${[['auto','Automatic (dark from 6 PM to 6 AM)'],['light','Light'],['dark','Dark']].map(([v,t])=>`<option value="${v}" ${themePreference()===v?'selected':''}>${t}</option>`).join('')}
            </select>
            <p class="form-note">Saved on this device. The moon/sun button in the top bar switches it too.</p>
          </div>
        </div>
        ${u._realSupabase?`<div class="card">
          <div class="card-header"><h3>Signed-in devices</h3></div>
          <p class="text-muted" style="font-size:.8rem;line-height:1.55">If you used CampusCare on a shared or lost device, sign out everywhere else. This device stays signed in.</p>
          <button class="btn btn-sm btn-warning" ${bindAction('click',()=>signOutOtherSessions())}><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Sign out of other devices</button>
        </div>`:''}
      </div>
    </div>`;
    if(u.role==='Doctor'){
      document.getElementById('app-content').insertAdjacentHTML('beforeend',`
        <div class="card">
          <div class="card-header"><h3>My Work Schedule</h3></div>
          <p class="form-note" style="margin:-.2rem 0 .8rem">For scheduling consistency, your work schedule can only be changed by an administrator. Submit a request below and we'll notify you once it's reviewed.</p>
          <div class="info-row"><span class="info-label">Hours</span><span class="info-val">${fmtTime(u.startTime||'08:00')} – ${fmtTime(u.endTime||'17:00')}</span></div>
          <div class="info-row"><span class="info-label">Slot Duration</span><span class="info-val">${u.slotDuration||60} minutes</span></div>
          <div class="info-row"><span class="info-label">Max Patients/Day</span><span class="info-val">${u.maxPatients||20}</span></div>
          <div class="info-row"><span class="info-label">Work Days</span><span class="info-val">${(u.workDays||[]).join(', ')||'—'}</span></div>
          <div style="margin-top:.8rem"><button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{openScheduleChangeRequest()})}>Request Schedule Change</button></div>
        </div>`);
    }

  // Initialize the live password-security UI after the account card is in the DOM.
  renderPasswordCooldownNotice();
  updateAccountPasswordStrength();
}

export function signOutOtherSessions(){
  showConfirmDialog({title:'Sign out of other devices',message:'End your CampusCare sessions on every other browser and device?',confirmLabel:'Sign out others',onConfirm:async()=>{
    try{
      const {error}=await appState.supabaseClient.supabaseClient.auth.signOut({scope:'others'});
      if(error)throw error;
      toast('Signed out of all other devices.','success');
    }catch(e){toast(e?.message||'Unable to sign out other devices.','error');}
  }});
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
