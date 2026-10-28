// userForm: imported feature APIs; state belongs to explicit application namespaces.
import {canEditApprovedUser,buildUserEditPatch} from '../../supabase/functions/_shared/admin-user-edit.js';
import {escapeHtml} from './issueReports.js';
import {state as appState} from '../app/state.js';
import {closeAllModals,openModal} from './modals.js';
import {showAlert,toast} from './theme.js';
import {navTo} from './navigationRaceProtection.js';
import {resetRegistrationFieldErrors,setRegistrationFieldError,validateRegistrationField,validateRegistrationForm} from './inputValidation.js';
import {checkPasswordStrength,renderPasswordStrength} from './loginLockout.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {passwordValidationError} from '../../supabase/functions/_shared/registration-validation.js';
import {normalizePhilippineMobile} from '../../supabase/functions/_shared/contact-validation.js';
import {adminUserAction,renderUsers,userAvatarHtml} from './userManagement.js';
import {bindAction} from '../dependencies.js';
import {openDoctorScheduleEditor} from './doctorSchedules.js';
// ── Add User Modal ──
// Staff accounts follow the same field rules as public registration; patients register themselves
// or are added through Patient Records, where identity verification happens.
const ROLE_CHOICES=[
  ['Doctor','bi-heart-pulse','Sees patients, records treatments, certificates and fitness assessments. Gets a weekly clinic schedule.'],
  ['Staff','bi-person-workspace','Handles appointments, patient records and inventory at the clinic desk.'],
  ['Administrator','bi-shield-lock','Full access, including user accounts, approvals, settings and backups.']
];
const SPECIALTIES=['General Medicine','Dental','Eye','Mental Health'];
const AU_SERVER_FIELDS={first_name:'au-fname',last_name:'au-lname',username:'au-user',email:'au-email',contact_number:'au-contact',password:'au-pass'};

function addUserState(){return appState.userManagement.addUser??={};}

export function generateTemporaryPassword(context={}){
  const sets=['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnpqrstuvwxyz','23456789','!@#$%&*?'],all=sets.join('');
  // Rejection sampling keeps every character equally likely.
  const pick=n=>{const limit=256-256%n,b=new Uint8Array(1);do crypto.getRandomValues(b);while(b[0]>=limit);return b[0]%n;};
  for(;;){
    const chars=sets.map(set=>set[pick(set.length)]);
    while(chars.length<14)chars.push(all[pick(all.length)]);
    for(let i=chars.length-1;i>0;i--){const j=pick(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}
    const password=chars.join('');
    if(!passwordValidationError(password,context))return password;
  }
}

const field=(id,label,input,{required=true,hint=''}={})=>`<div class="form-group">
  <label for="${id}">${label} ${required?'<span class="required">*</span>':'<span class="text-muted registration-optional">(optional)</span>'}</label>${input}
  ${hint?`<p class="form-note field-hint" id="${id}-help">${hint}</p>`:''}<p class="registration-field-error" id="${id}-error" aria-live="polite" hidden></p></div>`;
const live=id=>`${bindAction('blur',()=>validateRegistrationField(id))} ${bindAction('input',()=>{validateRegistrationField(id,false);if(id==='au-pass'){updateAddUserPassword();validateRegistrationField('au-pass2',false);}})}`;

export function openAddUserModal(){
  if(appState.auth.currentUser?.role!=='Administrator'){toast('Administrator access required.','warning');return;}
  const st=addUserState();
  Object.assign(st,{role:'Doctor',passwordMode:'generate',generated:generateTemporaryPassword(),created:null});
  resetRegistrationFieldErrors('au-');
  openModal(`<div class="modal au-modal" role="dialog" aria-labelledby="au-title">
    <div class="modal-header"><div><h3 id="au-title">Add staff account</h3></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body" id="au-body">
      <div id="adduser-msg"></div>
      <div id="au-form">
        <section class="au-section"><h4><span class="au-step">1</span> Role</h4>
          <div class="au-roles" role="radiogroup" aria-label="Role">${ROLE_CHOICES.map(([role,icon,text])=>`<label class="au-role"><input type="radio" name="au-role" value="${role}" ${role===st.role?'checked':''} ${bindAction('change',()=>setAddUserRole(role))}><span class="au-role-card"><i class="bi ${icon}" aria-hidden="true"></i><strong>${role}</strong><small>${text}</small></span></label>`).join('')}</div>
          <div id="au-doctor" class="au-doctor">
            <div class="form-row">${field('au-spec','Specialty',`<select id="au-spec">${SPECIALTIES.map(x=>`<option>${x}</option>`).join('')}</select>`)}</div>
            <p class="form-note au-note"><i class="bi bi-calendar-week" aria-hidden="true"></i> Starts with Mon–Fri, 8 AM – 5 PM, 60-minute appointments (up to 9 a day). You can change it after creating the account.</p>
          </div>
        </section>
        <section class="au-section"><h4><span class="au-step">2</span> Personal details</h4>
          <div class="form-row">
            ${field('au-fname','First name',`<input id="au-fname" maxlength="50" autocomplete="off" ${live('au-fname')} aria-describedby="au-fname-error">`)}
            ${field('au-lname','Last name',`<input id="au-lname" maxlength="50" autocomplete="off" ${live('au-lname')} aria-describedby="au-lname-error">`)}
          </div>
        </section>
        <section class="au-section"><h4><span class="au-step">3</span> Sign-in details</h4>
          <div class="form-row">
            ${field('au-user','Username',`<input id="au-user" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" ${live('au-user')} aria-describedby="au-user-help au-user-error">`,{hint:'4–20 letters, numbers, periods, underscores or hyphens.'})}
            ${field('au-email','Email',`<input id="au-email" type="email" maxlength="150" autocomplete="off" autocapitalize="off" spellcheck="false" ${live('au-email')} aria-describedby="au-email-help au-email-error">`,{hint:'They can sign in with this email or the username.'})}
            ${field('au-contact','Mobile number',`<input id="au-contact" type="tel" inputmode="tel" maxlength="24" placeholder="09… or +63…" ${live('au-contact')} aria-describedby="au-contact-help au-contact-error">`,{required:false,hint:'Use 09XXXXXXXXX or +639XXXXXXXXX.'})}
          </div>
        </section>
        <section class="au-section"><h4><span class="au-step">4</span> Password</h4>
          <div class="au-pw-modes" role="radiogroup" aria-label="Password">
            <label><input type="radio" name="au-pw-mode" value="generate" checked ${bindAction('change',()=>setPasswordMode('generate'))}><span><strong>Generate a temporary password</strong><small>Share it privately; they change it after signing in.</small></span></label>
            <label><input type="radio" name="au-pw-mode" value="manual" ${bindAction('change',()=>setPasswordMode('manual'))}><span><strong>Set a password</strong><small>Type one now, following the sign-up rules.</small></span></label>
          </div>
          <div id="au-pw-generate" class="au-generated"><code id="au-generated">${escapeHtml(st.generated)}</code>
            <button type="button" class="btn btn-sm" ${bindAction('click',()=>copyText(addUserState().generated,'Password copied.'))}><i class="bi bi-clipboard"></i> Copy</button>
            <button type="button" class="btn btn-sm" ${bindAction('click',()=>regeneratePassword())}><i class="bi bi-arrow-repeat"></i> New</button></div>
          <div id="au-pw-manual" hidden>
            <div class="form-row">
              ${field('au-pass','Password',`<div class="au-pw-wrap"><input id="au-pass" type="password" maxlength="64" autocomplete="new-password" disabled ${live('au-pass')} aria-describedby="au-pass-error"><button type="button" class="au-eye" aria-label="Show password" ${bindAction('click',(event,element)=>togglePasswordVisibility(element))}><i class="bi bi-eye"></i></button></div>`)}
              ${field('au-pass2','Confirm password',`<input id="au-pass2" type="password" maxlength="64" autocomplete="new-password" disabled ${live('au-pass2')} aria-describedby="au-pass2-error">`)}
            </div>
            <div id="au-pass-strength" class="password-checklist show" data-level="0" aria-live="polite">
              <div class="strength-bars" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
              <div id="au-pass-strength-label" class="password-strength-label weak">Password strength</div>
              <div class="password-check" data-check="length"><span class="pw-check-icon"></span><span>8–64 characters</span></div>
              <div class="password-check" data-check="upper"><span class="pw-check-icon"></span><span>One uppercase letter</span></div>
              <div class="password-check" data-check="lower"><span class="pw-check-icon"></span><span>One lowercase letter</span></div>
              <div class="password-check" data-check="number"><span class="pw-check-icon"></span><span>One number</span></div>
              <div class="password-check" data-check="special"><span class="pw-check-icon"></span><span>Special character <span class="text-muted">(recommended)</span></span></div>
            </div>
          </div>
        </section>
      </div>
      <section id="au-review" hidden></section>
    </div>
    <div class="modal-footer" id="au-actions"><button type="button" class="btn btn-primary" ${bindAction('click',()=>reviewNewUser())}>Review account</button></div>
  </div>`);
  setAddUserRole(st.role);
  document.getElementById('au-fname')?.focus();
}

function setAddUserRole(role){
  addUserState().role=role;
  const doctor=document.getElementById('au-doctor');
  if(doctor)doctor.hidden=role!=='Doctor';
}

function setPasswordMode(mode){
  addUserState().passwordMode=mode;
  const manual=mode==='manual';
  document.getElementById('au-pw-generate').hidden=manual;
  document.getElementById('au-pw-manual').hidden=!manual;
  for(const id of ['au-pass','au-pass2'])document.getElementById(id).disabled=!manual;
  if(manual)document.getElementById('au-pass').focus();
  else{resetRegistrationFieldErrors('au-pass');}
}

function regeneratePassword(){
  const st=addUserState();
  st.generated=generateTemporaryPassword({username:document.getElementById('au-user')?.value,email:document.getElementById('au-email')?.value});
  document.getElementById('au-generated').textContent=st.generated;
}

function togglePasswordVisibility(button){
  const show=document.getElementById('au-pass').type==='password';
  for(const id of ['au-pass','au-pass2'])document.getElementById(id).type=show?'text':'password';
  button.setAttribute('aria-label',show?'Hide password':'Show password');
  button.innerHTML=`<i class="bi ${show?'bi-eye-slash':'bi-eye'}"></i>`;
}

function updateAddUserPassword(){
  const pw=document.getElementById('au-pass')?.value||'',el=document.getElementById('au-pass-strength');
  if(!el)return;
  const {checks}=checkPasswordStrength(pw);
  el.querySelectorAll('.password-check').forEach(item=>item.classList.toggle('met',Boolean(checks[item.dataset.check])));
  renderPasswordStrength(el,document.getElementById('au-pass-strength-label'),pw);
}

async function copyText(text,message){
  try{await navigator.clipboard.writeText(text);toast(message,'success');}
  catch{toast('Copy is not available here. Select the text and copy it manually.','warning');}
}

function newUserValues(){
  const st=addUserState(),val=id=>document.getElementById(id)?.value||'';
  return {role:st.role,specialty:st.role==='Doctor'?val('au-spec'):null,first_name:val('au-fname').trim(),last_name:val('au-lname').trim(),
    username:val('au-user').trim(),email:val('au-email').trim().toLowerCase(),contact_number:normalizePhilippineMobile(val('au-contact'))||val('au-contact').trim(),
    password:st.passwordMode==='manual'?val('au-pass'):st.generated};
}

// Check everything, then show a read-only summary before anything is created.
export function reviewNewUser(){
  const msg=document.getElementById('adduser-msg');msg.innerHTML='';
  const invalid=validateRegistrationForm('au-');
  if(invalid.length){document.getElementById(invalid[0])?.focus();return;}
  const v=newUserValues(),st=addUserState();
  const row=(label,value)=>`<div class="info-row"><span class="info-label">${label}</span><span class="info-val">${value}</span></div>`;
  document.getElementById('au-form').hidden=true;
  const review=document.getElementById('au-review');review.hidden=false;
  review.innerHTML=`<h4 class="au-review-title">Check the new account</h4>
    ${row('Name',escapeHtml(v.first_name+' '+v.last_name))}
    ${row('Role',escapeHtml(v.role)+(v.specialty?' · '+escapeHtml(v.specialty):''))}
    ${row('Username','@'+escapeHtml(v.username))}${row('Email',escapeHtml(v.email))}
    ${row('Mobile',v.contact_number?escapeHtml(v.contact_number):'<span class="text-muted">Not provided</span>')}
    ${row('Password',st.passwordMode==='manual'?'Set by you':'Temporary, generated')}
    <p class="form-note au-note"><i class="bi bi-info-circle" aria-hidden="true"></i> The account is active right away and its email is marked as verified.</p>`;
  document.getElementById('au-actions').innerHTML=`<button type="button" class="btn" ${bindAction('click',()=>backToAddUserForm())}>Back</button><button type="button" class="btn btn-primary" id="au-create" ${bindAction('click',()=>saveNewUser())}>Create account</button>`;
}

function backToAddUserForm(){
  document.getElementById('au-form').hidden=false;document.getElementById('au-review').hidden=true;
  document.getElementById('au-actions').innerHTML=`<button type="button" class="btn btn-primary" ${bindAction('click',()=>reviewNewUser())}>Review account</button>`;
}

export async function saveNewUser(){
  const msg=document.getElementById('adduser-msg'),btn=document.getElementById('au-create'),v=newUserValues(),st=addUserState();
  if(btn){btn.disabled=true;btn.textContent='Creating…';}
  try{
    const result=await adminUserAction({action:'create',...v,
      ...(v.role==='Doctor'?{work_days:['Mon','Tue','Wed','Thu','Fri'],start_time:'08:00',end_time:'17:00',slot_duration:60,max_patients:9}:{})});
    st.created={...v,userId:result.user_id};
    showCreatedAccount();
    if(appState.navigationRaceProtection.campusActivePageId==='users')void renderUsers();
  }catch(e){
    // Send the person back to the exact field the server rejected.
    const fields=Object.entries(e?.fieldErrors||{}).filter(([key])=>AU_SERVER_FIELDS[key]);
    if(fields.length){
      backToAddUserForm();
      for(const [key,message] of fields)setRegistrationFieldError(AU_SERVER_FIELDS[key],message,true);
      document.getElementById(AU_SERVER_FIELDS[fields[0][0]])?.focus();
    }else{
      showAlert(msg,e?.message||'Unable to create the account.');
      if(btn){btn.disabled=false;btn.textContent='Create account';}
    }
  }
}

function showCreatedAccount(){
  const c=addUserState().created,manual=addUserState().passwordMode==='manual';
  const details=`Username: ${c.username}\nEmail: ${c.email}${manual?'':`\nTemporary password: ${c.password}`}`;
  document.getElementById('au-review').innerHTML=`<div class="au-done"><span class="au-done-icon" aria-hidden="true"><i class="bi bi-check-lg"></i></span>
    <h4>${escapeHtml(c.first_name+' '+c.last_name)} can now sign in</h4>
    <p class="form-note">${escapeHtml(c.role)} account created. Share the sign-in details privately${manual?'':' and ask them to change the password after signing in'}.</p>
    <dl class="au-creds"><div><dt>Username</dt><dd>@${escapeHtml(c.username)}</dd></div><div><dt>Email</dt><dd>${escapeHtml(c.email)}</dd></div>${manual?'':`<div><dt>Temporary password</dt><dd><code>${escapeHtml(c.password)}</code></dd></div>`}</dl>
    <button type="button" class="btn btn-sm" ${bindAction('click',()=>copyText(details,'Sign-in details copied.'))}><i class="bi bi-clipboard"></i> Copy sign-in details</button></div>`;
  document.getElementById('au-actions').innerHTML=`<button type="button" class="btn" ${bindAction('click',()=>openAddUserModal())}>Add another</button>
    ${c.role==='Doctor'?`<button type="button" class="btn" ${bindAction('click',()=>openCreatedDoctorSchedule())}>Set schedule</button>`:''}
    <button type="button" class="btn btn-primary" ${bindAction('click',()=>closeAllModals())}>Done</button>`;
}

async function openCreatedDoctorSchedule(){
  const c=addUserState().created;
  closeAllModals();
  await syncAdminDirectoryFromSupabase().catch(()=>{});
  const doc=appState.data.DB.users.find(u=>u._realSupabase&&Number(u.dbUserId)===Number(c.userId));
  if(doc)openDoctorScheduleEditor(doc.id);
  else toast('Open Doctor schedules to set their hours.','info');
}

// Editing an account is two deliberate steps, as in admin consoles such as Google Workspace and Okta:
// edit the details (changed fields are marked), then review every change with a reason and confirm by
// typing the account's username before anything is saved.
const EDIT_LABELS={first_name:'First name',last_name:'Last name',email:'Email',contact_number:'Mobile number',specialty:'Specialty'};
function editState(){return appState.userManagement.editUser??={};}
function editOriginal(u){return {...u,first_name:u.fname,last_name:u.lname,contact_number:u.contact||''};}
function editInputs(u){
  return {first_name:document.getElementById('eu-fname').value,last_name:document.getElementById('eu-lname').value,email:document.getElementById('eu-email').value,contact_number:document.getElementById('eu-contact').value,...(u.role==='Doctor'?{specialty:document.getElementById('eu-spec').value}:{})};
}
function confirmWord(u){return u.username||u.email;}

export function openEditUserModal(id){
  const u=appState.data.DB.users.find(x=>x.id===Number(id));if(!u)return;
  if(appState.auth.currentUser?.role!=='Administrator'){toast('Administrator access required.','warning');return;}
  if(!canEditApprovedUser(u)){toast('Approve this account before editing it. Archived accounts must be restored first.','warning');return;}
  editState().userId=u.id;
  const field=(id,key,label,input)=>`<div class="form-group eu-field" data-field="${key}"><label for="${id}">${label}<span class="eu-changed" hidden>Changed</span></label>${input}<p class="registration-field-error" id="${id}-error" hidden></p></div>`;
  openModal(`<div class="modal modal-lg eu-modal">
    <div class="modal-header"><div><h3>Edit user</h3><ol class="eu-steps" aria-label="Steps"><li class="active" id="eu-step-1">Edit details</li><li id="eu-step-2">Review &amp; confirm</li></ol></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body"><div id="edituser-msg"></div>
      <div class="eu-identity">${userAvatarHtml(u,44)}<div><strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong><span>@${escapeHtml(u.username||'—')} · ${escapeHtml(u.role)} · ${escapeHtml(u.status)}</span></div></div>
      <div id="edituser-fields" ${bindAction('input',()=>markEditChanges(u.id))} ${bindAction('change',()=>markEditChanges(u.id))}>
        <section class="eu-section"><h4>Profile</h4><div class="form-row">
          ${field('eu-fname','first_name','First name',`<input id="eu-fname" maxlength="100" autocomplete="off" value="${escapeHtml(u.fname)}">`)}
          ${field('eu-lname','last_name','Last name',`<input id="eu-lname" maxlength="100" autocomplete="off" value="${escapeHtml(u.lname)}">`)}
        </div></section>
        <section class="eu-section"><h4>Contact</h4><div class="form-row">
          ${field('eu-email','email','Email',`<input id="eu-email" type="email" maxlength="150" autocomplete="off" value="${escapeHtml(u.email)}">`)}
          ${field('eu-contact','contact_number','Mobile number',`<input id="eu-contact" type="tel" placeholder="09XXXXXXXXX" autocomplete="off" value="${escapeHtml(u.contact||'')}">`)}
        </div></section>
        ${u.role==='Doctor'?`<section class="eu-section"><h4>Professional</h4><div class="form-row">${field('eu-spec','specialty','Specialty',`<select id="eu-spec">${['General Medicine','Dental','Eye','Mental Health'].map(value=>`<option ${u.specialty===value?'selected':''}>${value}</option>`).join('')}</select>`)}</div></section>`:''}
        <dl class="eu-locked"><div><dt>Username</dt><dd>@${escapeHtml(u.username||'—')}</dd></div><div><dt>Role</dt><dd>${escapeHtml(u.role)}</dd></div><div><dt>Account status</dt><dd>${escapeHtml(u.status)}</dd></div></dl>
      </div>
      <section id="edituser-review" hidden></section>
    </div>
    <div class="modal-footer eu-footer" id="edituser-actions">${editFooterHtml(u)}</div>
  </div>`);
  markEditChanges(u.id);
}

function editFooterHtml(u){
  return `<span class="eu-count" id="eu-count">No changes yet</span>
    <button class="btn" id="eu-reset" disabled ${bindAction('click',()=>openEditUserModal(u.id))}>Reset</button>
    <button class="btn btn-primary" id="eu-next" disabled ${bindAction('click',()=>saveEditUser(u.id))}>Review changes</button>`;
}

// Marks changed fields and shows field-level problems as the admin types.
export function markEditChanges(id){
  const u=appState.data.DB.users.find(x=>x.id===Number(id));if(!u||!document.getElementById('eu-fname'))return;
  const original=editOriginal(u),inputs=editInputs(u);
  let changed=0;
  for(const [key,value] of Object.entries(inputs)){
    const before=String(original[key]||'').trim(),now=String(value||'').trim();
    const differs=key==='email'?now.toLowerCase()!==before.toLowerCase():key==='contact_number'?(normalizePhilippineMobile(now)||now)!==before:now!==before;
    const wrap=document.querySelector(`.eu-field[data-field="${key}"]`);
    if(wrap){wrap.classList.toggle('changed',differs);wrap.querySelector('.eu-changed').hidden=!differs;}
    if(differs)changed++;
  }
  const result=buildUserEditPatch(inputs,original);
  const count=document.getElementById('eu-count');if(count)count.textContent=changed?`${changed} change${changed===1?'':'s'}`:'No changes yet';
  const next=document.getElementById('eu-next');if(next)next.disabled=!changed||Boolean(result.error);
  const reset=document.getElementById('eu-reset');if(reset)reset.disabled=!changed;
  const msg=document.getElementById('edituser-msg');
  if(msg){if(result.error&&changed)showAlert(msg,result.error,'warning');else msg.innerHTML='';}
}

export async function saveEditUser(id){
  const u=appState.data.DB.users.find(x=>x.id===Number(id));if(!u)return;
  const msg=document.getElementById('edituser-msg');
  if(appState.auth.currentUser?.role!=='Administrator'||!canEditApprovedUser(u)){showAlert(msg,'Only approved accounts can be edited by an administrator.');return;}
  if(!u._realSupabase){showAlert(msg,'This account has not been migrated to Supabase yet.','warning');return;}
  const original=editOriginal(u);
  const result=buildUserEditPatch(editInputs(u),original);
  if(result.error){showAlert(msg,result.error);return;}
  const patch=result.patch;if(!Object.keys(patch).length){showAlert(msg,'No changes to save.','info');return;}
  const fields=document.getElementById('edituser-fields'),review=document.getElementById('edituser-review'),actions=document.getElementById('edituser-actions'),modal=document.getElementById('active-modal');
  const word=confirmWord(u);
  fields.hidden=true;review.hidden=false;msg.innerHTML='';
  document.getElementById('eu-step-1').classList.replace('active','done');document.getElementById('eu-step-2').classList.add('active');
  review.innerHTML=`<h4>Confirm user changes</h4>
    <div class="table-wrap"><table class="eu-diff"><thead><tr><th scope="col">Field</th><th scope="col">Current</th><th scope="col">New</th></tr></thead><tbody>${Object.entries(patch).map(([key,value])=>`<tr><th scope="row">${EDIT_LABELS[key]}</th><td><del>${escapeHtml(original[key]||'—')}</del></td><td><ins>${escapeHtml(value||'—')}</ins></td></tr>`).join('')}</tbody></table></div>
    ${patch.email?`<div class="eu-warning"><i class="bi bi-envelope-exclamation" aria-hidden="true"></i><span><strong>Sign-in email changes.</strong> ${escapeHtml(u.fname)} will sign in with ${escapeHtml(patch.email)} from now on.</span></div>`:''}
    <div class="form-group"><label for="eu-reason">Reason for this change <span class="required">*</span></label><input id="eu-reason" maxlength="300" placeholder="e.g. Corrected spelling per registrar records" autocomplete="off"></div>
    <label class="fi-check"><input type="checkbox" id="eu-notify" checked> Notify ${escapeHtml(u.fname)} about this change</label>
    <div class="form-group eu-confirm"><label for="eu-confirm-word">Type <strong>${escapeHtml(word)}</strong> to confirm</label><input id="eu-confirm-word" autocomplete="off" autocapitalize="off" spellcheck="false"></div>`;
  const ready=()=>{const reasonInput=document.getElementById('eu-reason'),wordInput=document.getElementById('eu-confirm-word');if(!reasonInput||!wordInput)return;const ok=reasonInput.value.trim().length>=5&&wordInput.value.trim().toLowerCase()===String(word).toLowerCase();const btn=document.getElementById('confirm-user-edit');if(btn)btn.disabled=!ok;};
  const back=()=>{fields.hidden=false;review.hidden=true;document.getElementById('eu-step-2').classList.remove('active');document.getElementById('eu-step-1').classList.replace('done','active');actions.innerHTML=editFooterHtml(u);markEditChanges(u.id);};
  actions.innerHTML=`<button class="btn" ${bindAction('click',back)}>Back to editing</button><button id="confirm-user-edit" class="btn btn-primary" disabled ${bindAction('click',async()=>{
    if(!canEditApprovedUser(appState.data.DB.users.find(x=>x.id===u.id))){showAlert(msg,'This account is no longer available for editing.');return;}
    const reason=document.getElementById('eu-reason').value.trim(),notify=document.getElementById('eu-notify').checked;
    const buttons=[...actions.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
    try{
      const result=await adminUserAction({action:'update',user_id:u.dbUserId,...patch,confirmed:true,reason,notify});
      const saved=result.user;
      if(!saved)throw new Error('The update could not be verified. Reload the account before retrying.');
      Object.assign(u,{fname:saved.first_name,lname:saved.last_name,email:saved.email,contact:saved.contact_number||'',contactNo:saved.contact_number||'',specialty:saved.specialty||''});
      if(modal.isConnected)closeAllModals();toast(`${saved.first_name} ${saved.last_name}'s account updated.`,'success');
      if(appState.navigationRaceProtection.campusActivePageId==='users')await renderUsers();
    }catch(error){if(modal.isConnected)showAlert(msg,error?.message||'Unable to update user.');else toast(error?.message||'Unable to update user.','error');}
    finally{buttons.forEach(button=>button.disabled=false);ready();}
  })}>Save changes</button>`;
  review.addEventListener('input',ready);
  document.getElementById('eu-reason').focus();
}

export function openDoctorScheduleEdit(docId){return openDoctorScheduleEditor(docId);}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
