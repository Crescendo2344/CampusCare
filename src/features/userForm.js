// userForm: imported feature APIs; state belongs to explicit application namespaces.
import {canEditApprovedUser,buildUserEditPatch} from '../../supabase/functions/_shared/admin-user-edit.js';
import {escapeHtml} from './issueReports.js';
import {state as appState} from '../app/state.js';
import {closeAllModals,openModal} from './modals.js';
import {showAlert,showConfirmDialog,toast} from './theme.js';
import {adminUserAction,renderUsers} from './userManagement.js';
import {clinicToday,setScheduleDays,validateSchedule} from './scheduleAndDrafts.js';
import {docName} from './messaging.js';
import {persistDB} from './persistence.js';
import {bindAction} from '../dependencies.js';
// ── Add User Modal ──
export function openAddUserModal(){
  openModal(`<div class="modal">
    <div class="modal-header"><h3>Add New User</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div id="adduser-msg"></div>
      <div class="form-row">
        <div class="form-group"><label>First Name <span class="required">*</span></label><input id="au-fname"></div>
        <div class="form-group"><label>Last Name <span class="required">*</span></label><input id="au-lname"></div>
        <div class="form-group"><label>Username <span class="required">*</span></label><input id="au-user"></div>
        <div class="form-group"><label>Email <span class="required">*</span></label><input id="au-email" type="email"></div>
        <div class="form-group"><label>Password <span class="required">*</span></label><input id="au-pass" type="password"></div>
        <div class="form-group"><label>Contact</label><input id="au-contact"></div>
        <div class="form-group"><label>Role <span class="required">*</span></label>
          <select id="au-role" ${bindAction('change',(event,element)=>{toggleUserFields()})}>
            <option>Doctor</option><option>Staff</option><option>Administrator</option>
          </select>
        </div>
        <div class="form-group" id="au-spec-group"><label>Specialty (Doctor)</label>
          <select id="au-spec"><option>General Medicine</option><option>Dental</option><option>Eye</option><option>Mental Health</option></select>
        </div>
        <div class="form-group" id="au-college-group" style="display:none"><label>College</label>
          <select id="au-college">${['CCICT','COE','COED','CME','CAS','COT'].map(c=>`<option value="${c}">${c}</option>`).join('')}</select>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" ${bindAction('click',(event,element)=>{saveNewUser()})}>Create User</button>
    </div>
  </div>`);
}

export function toggleUserFields(){
  const role=document.getElementById('au-role').value;
  document.getElementById('au-spec-group').style.display=role==='Doctor'?'':'none';
  const collegeGroup=document.getElementById('au-college-group');
  if(collegeGroup)collegeGroup.style.display='none';
}

export async function saveNewUser(){
  const fname=document.getElementById('au-fname').value.trim();
  const lname=document.getElementById('au-lname').value.trim();
  const uname=document.getElementById('au-user').value.trim();
  const email=document.getElementById('au-email').value.trim().toLowerCase();
  const pass=document.getElementById('au-pass').value;
  const role=document.getElementById('au-role').value;
  const contact=document.getElementById('au-contact').value.trim();
  const msg=document.getElementById('adduser-msg');

  if(!fname||!lname||!uname||!email||!pass){showAlert(msg,'All required fields must be filled.');return;}
  if(pass.length<8){showAlert(msg,'Password must be at least 8 characters.');return;}

  const btn=document.querySelector('.modal-footer .btn-primary');
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Creating…';}

  try{
    await adminUserAction({
      action:'create',
      first_name:fname,last_name:lname,username:uname,email,password:pass,
      contact_number:contact,role,
      specialty:role==='Doctor'?document.getElementById('au-spec').value:null,
      work_days:['Mon','Tue','Wed','Thu','Fri'],
      start_time:'08:00',end_time:'17:00',slot_duration:60,max_patients:20
    });
    toast(`${role} account created in CampusCare.`,'success');
    closeAllModals();
    await renderUsers();
  }catch(e){
    showAlert(msg,e?.message||'Unable to create user.');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=old||'Create User';}
  }
}

export function openEditUserModal(id){
  const u=appState.data.DB.users.find(x=>x.id===Number(id));if(!u)return;
  if(appState.auth.currentUser?.role!=='Administrator'){toast('Administrator access required.','warning');return;}
  if(!canEditApprovedUser(u)){toast('Approve this account before editing it. Archived accounts must be restored first.','warning');return;}
  openModal(`<div class="modal">
    <div class="modal-header"><h3>Edit User – ${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</h3><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body"><div id="edituser-msg"></div>
      <div class="form-row" id="edituser-fields">
        <div class="form-group"><label for="eu-fname">First Name</label><input id="eu-fname" maxlength="100" value="${escapeHtml(u.fname)}"></div>
        <div class="form-group"><label for="eu-lname">Last Name</label><input id="eu-lname" maxlength="100" value="${escapeHtml(u.lname)}"></div>
        <div class="form-group"><label for="eu-email">Email</label><input id="eu-email" type="email" maxlength="150" value="${escapeHtml(u.email)}"></div>
        <div class="form-group"><label for="eu-contact">Contact</label><input id="eu-contact" type="tel" placeholder="09 or +63" value="${escapeHtml(u.contact||'')}"></div>
        ${u.role==='Doctor'?`<div class="form-group"><label for="eu-spec">Specialty</label><select id="eu-spec">${['General Medicine','Dental','Eye','Mental Health'].map(value=>`<option ${u.specialty===value?'selected':''}>${value}</option>`).join('')}</select></div>`:''}
      </div><section id="edituser-review" hidden></section>
    </div><div class="modal-footer" id="edituser-actions"><button class="btn btn-primary" ${bindAction('click',()=>saveEditUser(u.id))}>Review Changes</button></div>
  </div>`);
}
export async function saveEditUser(id){
  const u=appState.data.DB.users.find(x=>x.id===Number(id));if(!u)return;
  const msg=document.getElementById('edituser-msg');
  if(appState.auth.currentUser?.role!=='Administrator'||!canEditApprovedUser(u)){showAlert(msg,'Only approved accounts can be edited by an administrator.');return;}
  if(!u._realSupabase){showAlert(msg,'This account has not been migrated to Supabase yet.','warning');return;}
  const original={...u,first_name:u.fname,last_name:u.lname,contact_number:u.contact||''};
  const result=buildUserEditPatch({first_name:document.getElementById('eu-fname').value,last_name:document.getElementById('eu-lname').value,email:document.getElementById('eu-email').value,contact_number:document.getElementById('eu-contact').value,...(u.role==='Doctor'?{specialty:document.getElementById('eu-spec').value}:{})},original);
  if(result.error){showAlert(msg,result.error);return;}
  const patch=result.patch;if(!Object.keys(patch).length){showAlert(msg,'No changes to save.','info');return;}
  const fields=document.getElementById('edituser-fields'),review=document.getElementById('edituser-review'),actions=document.getElementById('edituser-actions'),modal=document.getElementById('active-modal');
  const labels={first_name:'First Name',last_name:'Last Name',email:'Email',contact_number:'Contact',specialty:'Specialty'};
  // Freeze a reviewed snapshot; returning to editing preserves the original form and its unsaved values.
  fields.hidden=true;review.hidden=false;msg.innerHTML='';
  review.innerHTML=`<h4>Confirm user changes</h4><p>Are you sure you want to update <strong>${escapeHtml(u.username||u.email)}</strong>?</p><div class="table-wrap"><table><thead><tr><th>Field</th><th>Current</th><th>New</th></tr></thead><tbody>${Object.entries(patch).map(([key,value])=>`<tr><td>${labels[key]}</td><td>${escapeHtml(original[key]||'—')}</td><td>${escapeHtml(value||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  const back=()=>{fields.hidden=false;review.hidden=true;actions.innerHTML=`<button class="btn btn-primary" ${bindAction('click',()=>saveEditUser(u.id))}>Review Changes</button>`;};
  actions.innerHTML=`<button class="btn" ${bindAction('click',back)}>Back to Editing</button><button id="confirm-user-edit" class="btn btn-primary" ${bindAction('click',async()=>{
    if(!canEditApprovedUser(appState.data.DB.users.find(x=>x.id===u.id))){showAlert(msg,'This account is no longer available for editing.');return;}
    const buttons=[...actions.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
    try{
      const result=await adminUserAction({action:'update',user_id:u.dbUserId,...patch,confirmed:true});
      const saved=result.user;
      if(!saved)throw new Error('The update could not be verified. Reload the account before retrying.');
      Object.assign(u,{fname:saved.first_name,lname:saved.last_name,email:saved.email,contact:saved.contact_number||'',contactNo:saved.contact_number||'',specialty:saved.specialty||''});
      if(modal.isConnected)closeAllModals();toast('User changes saved.','success');
      if(appState.navigationRaceProtection.campusActivePageId==='users')await renderUsers();
    }catch(error){if(modal.isConnected)showAlert(msg,error?.message||'Unable to update user.');else toast(error?.message||'Unable to update user.','error');}
    finally{buttons.forEach(button=>button.disabled=false);}
  })}>Confirm Changes</button>`;
}

export function openDoctorScheduleEdit(docId){
  const doc=appState.data.DB.users.find(u=>u.id===docId);if(!doc)return;
  if(appState.auth.currentUser?.role!=='Administrator'||!canEditApprovedUser(doc)){toast('Approve or restore this account before editing its schedule.','warning');return;}
  openModal(`<div class="modal">
    <div class="modal-header"><h3>Edit Schedule – Dr. ${doc.fname} ${doc.lname}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label>Start Time</label><input type="time" id="ds-start" value="${doc.startTime||'08:00'}"></div>
        <div class="form-group"><label>End Time</label><input type="time" id="ds-end" value="${doc.endTime||'17:00'}"></div>
        <div class="form-group"><label>Slot Duration (min)</label><input type="number" id="ds-slot" value="${doc.slotDuration||60}" min="15" max="120"></div>
        <div class="form-group"><label>Max Patients/Day</label><input type="number" id="ds-max" value="${doc.maxPatients||20}" min="1"></div>
      </div>
      <div class="form-group"><label>Repeats every week on</label><div style="display:flex;gap:.5rem;margin-bottom:.6rem"><button class="btn btn-sm" ${bindAction('click',(event,element)=>{setScheduleDays('weekdays')})}>Mon–Fri</button><button class="btn btn-sm" ${bindAction('click',(event,element)=>{setScheduleDays('current')})}>Current pattern</button><button class="btn btn-sm" ${bindAction('click',(event,element)=>{setScheduleDays('clear')})}>Clear</button></div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<label style="display:flex;align-items:center;gap:.3rem;font-size:.82rem;cursor:pointer"><input type="checkbox" class="ds-day" value="${d}" ${(doc.workDays||[]).includes(d)?'checked':''}> ${d}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" ${bindAction('click',(event,element)=>{saveDoctorSched((docId))})}>Save</button>
    </div>
  </div>`);
}

export function saveDoctorSched(docId){
  const doc=appState.data.DB.users.find(u=>u.id===docId);if(!doc)return;
  const newVals={
    startTime:document.getElementById('ds-start').value,
    endTime:document.getElementById('ds-end').value,
    slotDuration:parseInt(document.getElementById('ds-slot').value)||60,
    maxPatients:parseInt(document.getElementById('ds-max').value)||20,
    workDays:Array.from(document.querySelectorAll('.ds-day:checked')).map(cb=>cb.value)
  };
  if(appState.auth.currentUser?.role!=='Administrator'){toast('Administrator access required.','warning');return;}
  const error=validateSchedule(newVals,clinicToday(),doc,false);
  if(error){toast(error,'warning');return;}
  showConfirmDialog({
    title:'Update Work Schedule',
    message:`Update <strong>${docName(doc)}</strong>'s work schedule? This changes their availability for new bookings immediately.`,
    confirmLabel:'Update Schedule',
    onConfirm:async()=>{
      if(doc._realSupabase){
        try{
          await adminUserAction({
            action:'schedule',
            user_id:doc.dbUserId,
            start_time:newVals.startTime,end_time:newVals.endTime,
            slot_duration:newVals.slotDuration,max_patients:newVals.maxPatients,
            work_days:newVals.workDays
          });
          toast('Schedule updated.','success');
          await renderUsers();
        }catch(e){toast(e?.message||'Unable to update schedule.','error');}
        return;
      }
      Object.assign(doc,newVals);
      persistDB();
      toast('Schedule updated.','success');
      if(document.getElementById('user-table'))renderUsers();
    }
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
