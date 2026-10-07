// ================================================================
// MY ACCOUNT
// ================================================================
function formatLastLogin(value){
  if(!value)return 'Never';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return escapeHtml(String(value));
  return d.toLocaleString('en-PH',{
    year:'numeric',month:'short',day:'numeric',
    hour:'numeric',minute:'2-digit'
  });
}

function openProfileDetails(){
  const u=currentUser;
  const pt=currentPatient;
  const photoHtml = u.profilePhoto
    ? `<img src="${u.profilePhoto}" style="width:84px;height:84px;border-radius:50%;object-fit:cover;cursor:pointer" onclick="showFilePreview('${jsAttrSafe(u.fname)} ${jsAttrSafe(u.lname)} - Photo','${u.profilePhoto}')" title="Click to view full size">`
    : `<div class="sb-avatar" style="width:84px;height:84px;font-size:1.8rem">${(u.fname[0]||'')}${(u.lname[0]||'')}</div>`;
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Profile Details</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
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
      <button class="btn" onclick="closeAllModals()">Close</button>
      <button class="btn btn-primary" onclick="closeAllModals();navTo('my-account')">Go to Account Settings</button>
    </div>
  </div>`);
}

function renderMyAccount(){
  const c=document.getElementById('app-content');
  const u=currentUser;
  const pt=currentPatient;
  c.innerHTML=`
    <div class="grid-2">
      <div>
        <div class="card">
          <div class="card-header"><h3>Profile Photo</h3></div>
          <div style="display:flex;align-items:center;gap:1rem">
            <div id="acc-photo-wrap" style="width:72px;height:72px;border-radius:50%;overflow:hidden;background:var(--overlay);border:1px solid var(--glass-border-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;font-size:1.1rem;color:var(--primary-dark)${u.profilePhoto?';cursor:pointer':''}" ${u.profilePhoto?`onclick="showFilePreview('${jsAttrSafe(u.fname)} ${jsAttrSafe(u.lname)} - Photo','${u.profilePhoto}')" title="Click to view full size"`:''}>
              ${u.profilePhoto?`<img src="${u.profilePhoto}" style="width:100%;height:100%;object-fit:cover">`:`${(u.fname[0]||'')}${(u.lname[0]||'')}`}
            </div>
            <div>
              <button class="btn btn-sm" onclick="document.getElementById('acc-photo-file').click()">Upload Photo</button>
              <button class="btn btn-sm btn-info" onclick="openCamera('account')"><i class="bi bi-camera" aria-hidden="true"></i> Use Camera</button>
              <input type="file" id="acc-photo-file" accept="image/*" style="display:none" onchange="changeProfilePhoto(this)">
              <p class="form-note">This was originally your verification selfie. JPG/PNG, square photos look best.</p>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Profile Information</h3></div>
          <div id="acc-msg"></div>
          <div class="form-row">
            <div class="form-group"><label>First Name</label><input id="acc-fname" value="${u.fname}" disabled></div>
            <div class="form-group"><label>Last Name</label><input id="acc-lname" value="${u.lname}" disabled></div>
          </div>
          <p class="form-note" style="margin:-.2rem 0 .8rem">${u.role==='Administrator'?'As an administrator, you can update your name directly from User Management.':'For security, your name can only be changed by an administrator. <a href="#" onclick="openNameChangeRequest();return false;" style="color:var(--primary);text-decoration:none">Request a name change →</a>'}</p>
          <div class="divider"></div>
          <div class="form-group"><label>Email</label><input id="acc-email" value="${u.email}" type="email" oninput="sanitizeInput(this,'email')"></div>
          <div class="form-group"><label>Contact No.</label><input id="acc-contact" value="${u.contact||''}" inputmode="numeric" placeholder="09XXXXXXXXX" oninput="sanitizeInput(this,'phone')"></div>
          ${u.role==='Administrator'
            ? '<p class="form-note">As an administrator, updating your email or contact applies immediately — no verification code needed.</p>'
            : '<p class="form-note">Changing your email or contact requires a 6-digit verification code sent to your current verified email or phone. If you change your phone number, Supabase also sends an SMS code to the new number before the change is completed.</p>'}
          <button class="btn btn-primary btn-sm" onclick="saveAccount()">Save Changes</button>
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
              oninput="sanitizeInput(this,'password')">
          </div>
          <div class="form-group">
            <label>New Password</label>
            <input id="pw-new" type="password" autocomplete="new-password"
              onfocus="showAccountPasswordChecklist()"
              oninput="sanitizeInput(this,'password');updateAccountPasswordStrength()"
              onblur="hideAccountPasswordChecklist()">
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
              oninput="sanitizeInput(this,'password')">
          </div>
          <button class="btn btn-primary btn-sm" id="pw-change-btn" onclick="changeAccountPassword()">Change Password</button>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-header"><h3>Account Information</h3></div>
          <div class="info-row"><span class="info-label">Username</span><span class="info-val">${u.username}</span></div>
          <div class="info-row"><span class="info-label">Role</span><span class="info-val">${u.role}</span></div>
          <div class="info-row"><span class="info-label">Status</span><span class="info-val">${statusBadge(u.status)}</span></div>
          <div class="info-row"><span class="info-label">Email Verification</span><span class="info-val">${u.emailConfirmedAt?'<span class="badge badge-success">Confirmed</span>':'<span class="badge badge-warning">Not confirmed</span>'}</span></div>
          <div class="info-row"><span class="info-label">Last Login</span><span class="info-val">${formatLastLogin(u.lastLogin)}</span></div>
          ${pt?`<div class="info-row"><span class="info-label">College</span><span class="info-val">${collegeBadge(pt.college)}</span></div>
          <div class="info-row"><span class="info-label">Person Type</span><span class="info-val">${priorityBadge(pt.personType)}</span></div>
          <div class="info-row"><span class="info-label">ID No.</span><span class="info-val">${pt.idNo}</span></div>`:''}
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
            <button class="btn btn-sm" onclick="openPrivacyNotice()">View Privacy Notice</button>
            <button class="btn btn-sm btn-warning" onclick="openPrivacyRequestModal()">Submit Privacy / Data Request</button>
          </div>
        </div>
        ${u.role==='Patient'?`<div class="card">
          <div class="card-header"><h3>Available Doctors</h3></div>
          ${getDoctors().map(d=>`<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--line)">
            <div class="sb-avatar" style="width:30px;height:30px;font-size:.72rem">${d.fname[0]}${d.lname[0]}</div>
            <div style="flex:1"><div class="fw-500" style="font-size:.83rem">Dr. ${d.fname} ${d.lname}</div>
            <div class="text-muted">${d.specialty} · ${(d.workDays||[]).join(', ')}</div></div>
          </div>`).join('')}
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
          <div style="margin-top:.8rem"><button class="btn btn-primary btn-sm" onclick="openScheduleChangeRequest()">Request Schedule Change</button></div>
        </div>`);
    }

  // Initialize the live password-security UI after the account card is in the DOM.
  renderPasswordCooldownNotice();
  updateAccountPasswordStrength();
}
