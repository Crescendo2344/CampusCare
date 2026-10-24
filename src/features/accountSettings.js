// accountSettings: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {closeAllModals,openModal,showFilePreview} from './modals.js';
import {collegeBadge,fmtTime,priorityBadge,sanitizeInput,statusBadge} from './inputValidation.js';
import {navTo} from './navigationRaceProtection.js';
import {openCamera} from '../app/optional-features.js';
import {changeAccountPassword,changeProfilePhoto,checkPasswordConfirmation,hideAccountPasswordChecklist,openNameChangeRequest,renderPasswordCooldownNotice,setPasswordFieldError,showAccountPasswordChecklist,updateAccountPasswordStrength} from './nameChangeRequests.js';
import {openScheduleChangeRequest,saveAccount} from './workflowRequests.js';
import {openPrivacyNotice} from './loginLockout.js';
import {openPrivacyRequestModal} from './privacy.js';
import {setThemePreference,showConfirmDialog,themePreference,toast} from './theme.js';
import {bindAction} from '../dependencies.js';
import {logout} from './passwordRecovery.js';
import {patientDisplayId} from './patientService.js';
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

// A quick account card: who you are, how the clinic identifies you, and the most common account actions.
export function openProfileDetails(){
  const u=appState.auth.currentUser;
  const pt=appState.auth.currentPatient;
  const initials=escapeHtml(`${u.fname?.[0]||''}${u.lname?.[0]||''}`);
  const photoHtml=u.profilePhoto
    ? `<button type="button" class="profile-card-photo" aria-label="View your photo" ${bindAction('click',()=>showFilePreview(`${u.fname} ${u.lname} - Photo`,String(u.profilePhoto)))}><img src="${escapeHtml(u.profilePhoto)}" alt=""></button>`
    : `<div class="sb-avatar profile-card-photo">${initials}</div>`;
  const row=(label,value,copy='')=>`<div class="info-row"><span class="info-label">${label}</span><span class="info-val">${value}${copy?` <button type="button" class="profile-copy" aria-label="Copy ${label.toLowerCase()}" title="Copy" ${bindAction('click',()=>copyProfileValue(copy,label))}><i class="bi bi-copy" aria-hidden="true"></i></button>`:''}</span></div>`;
  const verified=u.emailVerificationSkipped?'<span class="badge badge-info">Verification skipped</span>':u.emailConfirmedAt||u._realSupabase===false?'<span class="badge badge-success">Verified</span>':'<span class="badge badge-warning">Not verified</span>';
  const memberSince=u.createdAt?new Date(u.createdAt).toLocaleDateString('en-PH',{month:'long',year:'numeric'}):'';
  const section=(title,body)=>body?`<h4 class="profile-card-section">${title}</h4>${body}`:'';
  const clinic=pt?[
    row('Patient no.',`P-${escapeHtml(patientDisplayId(pt))}`),
    pt.idNo?row(pt.personType==='Student'?'Student ID':'Employee ID',escapeHtml(pt.idNo)):'',
    pt.college?row(pt.personType==='Non-Teaching Personnel'?'Department':'College',escapeHtml(pt.college)):'',
    pt.personType==='Student'&&pt.classSession?row('Class session',escapeHtml(pt.classSession)):'',
    row('Blood type',escapeHtml(pt.blood||'Unknown')),
    row('Allergies',pt.allergies?.trim()?`<span class="text-danger">${escapeHtml(pt.allergies)}</span>`:'None recorded')
  ].join(''):u.role==='Doctor'?[
    row('Specialty',escapeHtml(u.specialty||'General Medicine')),
    row('Work days',escapeHtml((u.workDays||[]).join(', ')||'—')),
    row('Hours',`${fmtTime(u.startTime||'08:00')} – ${fmtTime(u.endTime||'17:00')}`)
  ].join(''):'';
  openModal(`<div class="modal modal-sm profile-card">
    <div class="modal-header"><h3>Profile</h3><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div class="profile-card-head">
        ${photoHtml}
        <div>
          <strong class="profile-card-name">${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>
          <div class="profile-card-badges"><span class="badge badge-info">${escapeHtml(pt?.personType||u.role)}</span>${statusBadge(u.status)}</div>
          ${memberSince?`<div class="text-muted profile-card-since">Member since ${escapeHtml(memberSince)}</div>`:''}
        </div>
      </div>
      ${section('Account',[
        row('Username',`@${escapeHtml(u.username||'')}`,u.username||''),
        row('Email',`${escapeHtml(u.email||'—')} ${verified}`,u.email||''),
        row('Contact',u.contact?escapeHtml(u.contact):'<span class="text-muted">Not added</span>'),
        row('Last sign-in',escapeHtml(formatLastLogin(u.lastLogin)))
      ].join(''))}
      ${section(pt?'Clinic record':'Work',clinic)}
    </div>
    <div class="modal-footer profile-card-actions">
      <button class="btn btn-sm" ${bindAction('click',()=>{closeAllModals();logout();})}><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Log out</button>
      <button class="btn btn-sm" ${bindAction('click',()=>{closeAllModals();navTo('my-account');setTimeout(()=>{const el=document.getElementById('pw-cur');el?.scrollIntoView({block:'center',behavior:'smooth'});el?.focus({preventScroll:true});},150);})}><i class="bi bi-key" aria-hidden="true"></i> Change password</button>
      <button class="btn btn-sm btn-primary" ${bindAction('click',()=>{closeAllModals();navTo('my-account');})}>Account Settings</button>
    </div>
  </div>`);
}

export async function copyProfileValue(value,label){
  try{await navigator.clipboard.writeText(value);toast(`${label} copied.`,'success');}
  catch{toast('Copying is not available in this browser.','warning');}
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
          <div id="pw-cooldown-note" hidden></div>
          <div class="form-group">
            <label>Current Password</label>
            <input id="pw-cur" type="password" autocomplete="current-password"
              ${bindAction('input',(event,element)=>{sanitizeInput(element,'password');setPasswordFieldError('pw-cur','')})}><p class="registration-field-error" id="pw-cur-error" aria-live="polite" hidden></p>
          </div>
          <div class="form-group">
            <label>New Password</label>
            <input id="pw-new" type="password" autocomplete="new-password"
              ${bindAction('focus',(event,element)=>{showAccountPasswordChecklist()})}
              ${bindAction('input',(event,element)=>{sanitizeInput(element,'password');updateAccountPasswordStrength();setPasswordFieldError('pw-new','');checkPasswordConfirmation(false)})}
              ${bindAction('blur',(event,element)=>{hideAccountPasswordChecklist()})}><p class="registration-field-error" id="pw-new-error" aria-live="polite" hidden></p>
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
              ${bindAction('input',(event,element)=>{sanitizeInput(element,'password');checkPasswordConfirmation(false)})}
              ${bindAction('blur',()=>checkPasswordConfirmation(true))}>
            <p class="pw-match" id="pw-conf-match" aria-live="polite" hidden></p><p class="registration-field-error" id="pw-conf-error" aria-live="polite" hidden></p>
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
          <div class="card-header"><h3>Signed-in devices</h3><button class="btn btn-xs" ${bindAction('click',()=>renderSignedInDevices())}><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Refresh</button></div>
          <p class="text-muted" style="font-size:.8rem;line-height:1.55;margin:0 0 .6rem">Sign out any device you don't recognise or no longer use. A signed-out device loses access within an hour at most.</p>
          <div id="acc-devices"><div class="db-skeleton-shimmer" style="height:90px;border-radius:12px"></div></div>
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
  if(u._realSupabase)renderSignedInDevices().catch(()=>{});
}

// "Mozilla/5.0 (Windows NT 10.0…) Chrome/…" reads as "Chrome on Windows".
export function describeUserAgent(agent=''){
  const ua=String(agent);
  const browser=/Edg\//.test(ua)?'Edge':/OPR\/|Opera/.test(ua)?'Opera':/SamsungBrowser/.test(ua)?'Samsung Internet':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Browser';
  const os=/iPhone|iPad|iPod/.test(ua)?'iOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac OS X|Macintosh/.test(ua)?'macOS':/CrOS/.test(ua)?'ChromeOS':/Linux/.test(ua)?'Linux':'Unknown system';
  const mobile=/Mobile|iPhone|Android/.test(ua);
  return {label:`${browser} on ${os}`,icon:mobile?'bi-phone':'bi-laptop'};
}

export async function renderSignedInDevices(){
  const box=document.getElementById('acc-devices');if(!box)return;
  const client=appState.supabaseClient.supabaseClient;
  const {data,error}=await client.rpc('list_my_sessions');
  if(!document.getElementById('acc-devices'))return;
  if(error||!Array.isArray(data)){
    // Older databases without the session functions still offer the all-devices action.
    box.innerHTML=`<p class="form-note">The device list isn't available yet.</p><button class="btn btn-sm btn-warning" ${bindAction('click',()=>signOutOtherSessions())}><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Sign out of all other devices</button>`;
    return;
  }
  const rows=data;
  const others=rows.filter(r=>!r.current);
  const when=v=>v?new Date(v).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}):'—';
  box.innerHTML=`<ul class="device-list">${rows.map(r=>{const d=describeUserAgent(r.user_agent);return `<li class="device-row">
      <i class="bi ${d.icon}" aria-hidden="true"></i>
      <div class="device-info"><strong>${escapeHtml(d.label)}</strong>${r.current?' <span class="badge badge-success">This device</span>':''}
        <span class="text-muted">${r.ip?`IP ${escapeHtml(r.ip)} · `:''}Last active ${escapeHtml(when(r.last_active_at))} · Signed in ${escapeHtml(when(r.created_at))}</span></div>
      ${r.current?'':`<button class="btn btn-xs btn-warning" ${bindAction('click',()=>revokeDevice(r.id,d.label))}>Sign out</button>`}
    </li>`;}).join('')||'<li class="text-muted">No active sessions found.</li>'}</ul>
    ${others.length>1?`<button class="btn btn-sm btn-warning" style="margin-top:.6rem" ${bindAction('click',()=>signOutOtherSessions())}>Sign out of all other devices (${others.length})</button>`:''}`;
}

export function revokeDevice(id,label){
  showConfirmDialog({title:'Sign out device',message:`Sign out <strong>${escapeHtml(label)}</strong>? Anyone using CampusCare on it will need to log in again.`,confirmLabel:'Sign out',onConfirm:async()=>{
    try{
      const {error}=await appState.supabaseClient.supabaseClient.rpc('revoke_my_session',{target:id});
      if(error)throw error;
      toast(`${label} signed out.`,'success');
      await renderSignedInDevices();
    }catch(e){toast(e?.message||'Unable to sign out that device.','error');}
  }});
}

export function signOutOtherSessions(){
  showConfirmDialog({title:'Sign out of other devices',message:'End your CampusCare sessions on every other browser and device?',confirmLabel:'Sign out others',onConfirm:async()=>{
    try{
      const {error}=await appState.supabaseClient.supabaseClient.auth.signOut({scope:'others'});
      if(error)throw error;
      toast('Signed out of all other devices.','success');
      await renderSignedInDevices();
    }catch(e){toast(e?.message||'Unable to sign out other devices.','error');}
  }});
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
