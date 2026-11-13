// userForm: imported feature APIs; state belongs to explicit application namespaces.
import {canEditApprovedUser,buildUserEditPatch} from '../../supabase/functions/_shared/admin-user-edit.js';
import {escapeHtml} from './issueReports.js';
import {state as appState} from '../app/state.js';
import {closeAllModals,openModal} from './modals.js';
import {showAlert,toast} from './theme.js';
import {resetRegistrationFieldErrors,setRegistrationFieldError,validateRegistrationField,validateRegistrationForm} from './inputValidation.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {normalizePhilippineMobile} from '../../supabase/functions/_shared/contact-validation.js';
import {adminUserAction,renderUsers,userAvatarHtml} from './userManagement.js';
import {bindAction} from '../dependencies.js';
import {openDoctorScheduleEditor} from './doctorSchedules.js';
import {CLINIC_SERVICES,SPECIALIZATIONS,clinicForSpecialization,defaultStartTimeForSpecialty} from '../../supabase/functions/_shared/clinic-services.js';
// ── Add User Modal ──
// Staff accounts follow the same field rules as public registration; patients register themselves
// or are added through Patient Records, where identity verification happens.
const ROLE_CHOICES=[
  ['Doctor','bi-heart-pulse','Sees patients, records treatments, certificates and fitness assessments. Gets a weekly clinic schedule.'],
  ['Staff','bi-person-workspace','Oversees bookings, keeps patient records and inventory, and releases certificates at the front desk.']
];
// Administrator accounts are not created here: an administrator only adds doctors and staff.
const specialties=()=>Object.keys(SPECIALIZATIONS);
const AU_SERVER_FIELDS={clinic:'au-clinic',first_name:'au-fname',last_name:'au-lname',username:'au-user',email:'au-email',contact_number:'au-contact',id_number:'au-empno',services_rendered:'au-services'};

function addUserState(){return appState.userManagement.addUser??={};}


const field=(id,label,input,{required=true,hint=''}={})=>`<div class="form-group">
  <label for="${id}">${label} ${required?'<span class="required">*</span>':'<span class="text-muted registration-optional">(optional)</span>'}</label>${input}
  ${hint?`<p class="form-note field-hint" id="${id}-help">${hint}</p>`:''}<p class="registration-field-error" id="${id}-error" aria-live="polite" hidden></p></div>`;
const live=id=>`${bindAction('blur',()=>validateRegistrationField(id))} ${bindAction('input',()=>validateRegistrationField(id,false))}`;

export function openAddUserModal(){
  if(appState.auth.currentUser?.role!=='Administrator'){toast('Administrator access required.','warning');return;}
  const st=addUserState();
  Object.assign(st,{role:'Doctor',created:null});
  resetRegistrationFieldErrors('au-');
  openModal(`<div class="modal au-modal" role="dialog" aria-labelledby="au-title">
    <div class="modal-header"><div><h3 id="au-title">Add staff account</h3></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body" id="au-body">
      <div id="adduser-msg"></div>
      <div id="au-form">
        <section class="au-section"><h4><span class="au-step">1</span> Role</h4>
          <div class="au-roles" role="radiogroup" aria-label="Role">${ROLE_CHOICES.map(([role,icon,text])=>`<label class="au-role"><input type="radio" name="au-role" value="${role}" ${role===st.role?'checked':''} ${bindAction('change',()=>setAddUserRole(role))}><span class="au-role-card"><i class="bi ${icon}" aria-hidden="true"></i><strong>${role}</strong><small>${text}</small></span></label>`).join('')}</div>
          <div id="au-staff" class="au-doctor" hidden>
            <div class="form-row">${field('au-clinic','Clinic',`<select id="au-clinic"><option value="">Choose a clinic</option><option>Medical Clinic</option><option>Dental Clinic</option></select>`,{hint:'Staff see and manage only this clinic\'s appointments, inventory and records.'})}</div>
          </div>
          <div id="au-doctor" class="au-doctor">
            <div class="form-row">${field('au-spec','Clinic',`<select id="au-spec">${specialties().map(x=>`<option value="${x}">${clinicForSpecialization(x)}</option>`).join('')}</select>`)}</div>
            <p class="form-note au-note"><i class="bi bi-calendar-week" aria-hidden="true"></i> Medical schedules start at 8 AM; dental schedules start at 9 AM for instrument sterilization. You can change the hours after creating the account.</p>
          </div>
        </section>
        <section class="au-section"><h4><span class="au-step">2</span> Personal details</h4>
          <div class="form-row">
            ${field('au-fname','First name',`<input id="au-fname" maxlength="50" autocomplete="off" ${live('au-fname')} aria-describedby="au-fname-error">`)}
            ${field('au-lname','Last name',`<input id="au-lname" maxlength="50" autocomplete="off" ${live('au-lname')} aria-describedby="au-lname-error">`)}
            ${field('au-empno','Employee ID No.',`<input id="au-empno" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="e.g. 14982" ${bindAction('input',(event,element)=>{element.value=element.value.replace(/\D/g,'').slice(0,5);setRegistrationFieldError('au-empno','',false);})} aria-describedby="au-empno-help au-empno-error">`,{hint:'The 5-digit CTU employee number.'})}
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
          <p class="form-note au-note"><i class="bi bi-envelope-lock" aria-hidden="true"></i> CampusCare generates a password and emails it straight to the new user. Nobody else sees it, including you. They must change it the first time they sign in.</p>
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
  const staff=document.getElementById('au-staff');
  if(staff)staff.hidden=role!=='Staff';
}






function newUserValues(){
  const st=addUserState(),val=id=>document.getElementById(id)?.value||'';
  // Every service of the doctor's clinic, by default.
  const services=CLINIC_SERVICES[clinicForSpecialization(val('au-spec'))]||[];
  return {role:st.role,specialty:st.role==='Doctor'?val('au-spec'):null,services_rendered:st.role==='Doctor'?services:[],clinic:st.role==='Staff'?val('au-clinic'):null,
    first_name:val('au-fname').trim(),last_name:val('au-lname').trim(),id_number:val('au-empno').trim(),
    username:val('au-user').trim(),email:val('au-email').trim().toLowerCase(),contact_number:normalizePhilippineMobile(val('au-contact'))||val('au-contact').trim()};
}

// Check everything, then show a read-only summary before anything is created.
export function reviewNewUser(){
  const msg=document.getElementById('adduser-msg');msg.innerHTML='';
  const invalid=validateRegistrationForm('au-');
  const v=newUserValues();
  if(!/^\d{5}$/.test(v.id_number)){setRegistrationFieldError('au-empno','Enter the 5-digit employee number.',true);invalid.push('au-empno');}
  if(v.role==='Staff'&&!v.clinic){setRegistrationFieldError('au-clinic','Choose the clinic this staff member works in.',true);invalid.unshift('au-clinic');}
  if(invalid.length){document.getElementById(invalid[0])?.focus();return;}
  const row=(label,value)=>`<div class="info-row"><span class="info-label">${label}</span><span class="info-val">${value}</span></div>`;
  document.getElementById('au-form').hidden=true;
  const review=document.getElementById('au-review');review.hidden=false;
  review.innerHTML=`<h4 class="au-review-title">Check the new account</h4>
    ${row('Name',escapeHtml(v.first_name+' '+v.last_name))}
    ${row('Role',escapeHtml(v.role)+(v.specialty?' · '+escapeHtml(clinicForSpecialization(v.specialty)):'')+(v.clinic?' · '+escapeHtml(v.clinic):''))}
    ${v.role==='Doctor'?row('Services rendered',escapeHtml(v.services_rendered.join(', '))):''}
    ${row('Employee ID No.',escapeHtml(v.id_number))}
    ${row('Username','@'+escapeHtml(v.username))}${row('Email',escapeHtml(v.email))}
    ${row('Mobile',v.contact_number?escapeHtml(v.contact_number):'<span class="text-muted">Not provided</span>')}
    ${row('Password','Generated and emailed to them only')}
    <p class="form-note au-note"><i class="bi bi-info-circle" aria-hidden="true"></i> The account is active right away. They must change the emailed password when they first sign in.</p>`;
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
      ...(v.role==='Doctor'?{work_days:['Mon','Tue','Wed','Thu','Fri'],start_time:defaultStartTimeForSpecialty(v.specialty),end_time:'17:00',...(v.specialty==='Dental'?{slot_duration:60,max_patients:8}:{slot_duration:30,max_patients:15})}:{})});
    st.created={...v,userId:result.user_id,emailStatus:result.email_status||'queued'};
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
  const c=addUserState().created;
  const status={sent:'The sign-in details were emailed to',queued:'The sign-in details are queued for',not_configured:'Email is not set up yet. The sign-in details will be sent once it is, to'}[c.emailStatus]||'The sign-in details are queued for';
  document.getElementById('au-review').innerHTML=`<div class="au-done"><span class="au-done-icon" aria-hidden="true"><i class="bi bi-check-lg"></i></span>
    <h4>${escapeHtml(c.first_name+' '+c.last_name)}'s account is ready</h4>
    <p class="form-note">${escapeHtml(status)} <strong>${escapeHtml(c.email)}</strong>. The password is not shown here; they change it when they first sign in.</p>
    <dl class="au-creds"><div><dt>Username</dt><dd>@${escapeHtml(c.username)}</dd></div><div><dt>Email</dt><dd>${escapeHtml(c.email)}</dd></div><div><dt>Employee No.</dt><dd>${escapeHtml(c.id_number)}</dd></div></dl></div>`;
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
const EDIT_LABELS={first_name:'First name',last_name:'Last name',email:'Email',contact_number:'Mobile number',specialty:'Clinic',services_rendered:'Services rendered',clinic:'Clinic',id_number:'Employee ID No.'};
function editState(){return appState.userManagement.editUser??={};}
function editOriginal(u){return {...u,first_name:u.fname,last_name:u.lname,contact_number:u.contact||'',services_rendered:u.servicesRendered||[],id_number:u.idNo||''};}
function editInputs(u){
  return {first_name:document.getElementById('eu-fname').value,last_name:document.getElementById('eu-lname').value,email:document.getElementById('eu-email').value,contact_number:document.getElementById('eu-contact').value,...(u.role==='Doctor'?{specialty:document.getElementById('eu-spec').value,services_rendered:[...document.querySelectorAll('#eu-services input:checked')].map(i=>i.value)}:{}),...(u.role==='Staff'?{clinic:document.getElementById('eu-clinic').value}:{}),...(['Staff','Doctor'].includes(u.role)?{id_number:document.getElementById('eu-empno').value}:{})};
}
// A doctor's services come from their clinic's list; an empty saved list means every service.
function editServicesHtml(specialization,current=[]){
  const all=CLINIC_SERVICES[clinicForSpecialization(specialization)];
  const ticked=current?.length?current:all;
  return all.map(service=>`<label class="au-service"><input type="checkbox" value="${escapeHtml(service)}" ${ticked.includes(service)?'checked':''}> <span>${escapeHtml(service)}</span></label>`).join('');
}
function renderEditServices(u){
  const host=document.getElementById('eu-services');
  const spec=document.getElementById('eu-spec')?.value;
  if(host)host.innerHTML=editServicesHtml(spec,spec===u.specialty?u.servicesRendered:[]);
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
        ${['Staff','Doctor'].includes(u.role)?`<section class="eu-section"><h4>Employee</h4><div class="form-row">${field('eu-empno','id_number','Employee ID No.',`<input id="eu-empno" inputmode="numeric" maxlength="5" pattern="\\d{5}" placeholder="5 digits" autocomplete="off" value="${escapeHtml(u.idNo||'')}">`)}</div></section>`:''}
        ${u.role==='Staff'?`<section class="eu-section"><h4>Clinic</h4><div class="form-row">${field('eu-clinic','clinic','Clinic',`<select id="eu-clinic">${['Medical Clinic','Dental Clinic'].map(value=>`<option ${u.clinic===value?'selected':''}>${value}</option>`).join('')}</select>`)}</div></section>`:''}
        ${u.role==='Doctor'?`<section class="eu-section"><h4>Professional</h4><div class="form-row">${field('eu-spec','specialty','Clinic',`<select id="eu-spec" ${bindAction('change',()=>renderEditServices(u))}>${specialties().map(value=>`<option value="${value}" ${u.specialty===value?'selected':''}>${clinicForSpecialization(value)}</option>`).join('')}</select>`)}</div>
          <fieldset class="au-services"><legend>Services rendered</legend><div id="eu-services">${editServicesHtml(u.specialty,u.servicesRendered)}</div></fieldset></section>`:''}
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
    <div class="table-wrap"><table class="eu-diff"><thead><tr><th scope="col">Field</th><th scope="col">Current</th><th scope="col">New</th></tr></thead><tbody>${Object.entries(patch).map(([key,value])=>`<tr><th scope="row">${EDIT_LABELS[key]}</th><td><del>${escapeHtml((key==='specialty'&&original[key]?clinicForSpecialization(original[key]):original[key])||'—')}</del></td><td><ins>${escapeHtml((key==='specialty'&&value?clinicForSpecialization(value):value)||'—')}</ins></td></tr>`).join('')}</tbody></table></div>
    ${patch.email?`<div class="eu-warning"><i class="bi bi-envelope-exclamation" aria-hidden="true"></i><span><strong>Sign-in email changes.</strong> ${escapeHtml(u.fname)} will sign in with ${escapeHtml(patch.email)} from now on.</span></div>`:''}
    <div class="form-group"><label for="eu-reason">Reason for this change <span class="required">*</span></label><input id="eu-reason" maxlength="300" placeholder="e.g. Corrected spelling per registrar records" autocomplete="off"></div>
    <label class="fi-check"><input type="checkbox" class="cc-switch" role="switch" id="eu-notify" checked> Notify ${escapeHtml(u.fname)} about this change</label>
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
      Object.assign(u,{fname:saved.first_name,lname:saved.last_name,email:saved.email,contact:saved.contact_number||'',contactNo:saved.contact_number||'',specialty:saved.specialty||'',servicesRendered:saved.services_rendered||u.servicesRendered||[],clinic:saved.clinic??u.clinic,idNo:saved.id_number??u.idNo});
      if(modal.isConnected)closeAllModals();toast(`${saved.first_name} ${saved.last_name}'s account updated.`,'success');
      if(appState.navigationRaceProtection.campusActivePageId==='users')await renderUsers();
    }catch(error){if(modal.isConnected)showAlert(msg,error?.message||'Unable to update user.');else toast(error?.message||'Unable to update user.','error');}
    finally{buttons.forEach(button=>button.disabled=false);ready();}
  })}>Save changes</button>`;
  review.addEventListener('input',ready);
  document.getElementById('eu-reason').focus();
}


// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
