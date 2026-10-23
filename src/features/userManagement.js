import {limitTableRows} from '../ui/table-scroll.js';
import {canEditApprovedUser} from '../../supabase/functions/_shared/admin-user-edit.js';
// userManagement: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {closeAllModals,openModal,showFilePreview} from './modals.js';
import {formatLastLogin} from './accountSettings.js';
import {openAddUserModal,openDoctorScheduleEdit,openEditUserModal} from './userForm.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {getDoctors,getUserById} from './documentScanner.js';
import {docName} from './messaging.js';
import {collegeBadge,fmtDate,fmtTime,statusBadge} from './inputValidation.js';
import {approveScheduleChange,rejectScheduleChange} from './workflowRequests.js';
import {approveLeaveRequest,rejectLeaveRequest,removeDoctorLeave} from './doctorSchedule.js';
import {approveNameChange,rejectNameChange} from './nameChangeRequests.js';
import {navTo} from './navigationRaceProtection.js';
import {showConfirmDialog,toast} from './theme.js';
import {bindAction,createOperationalService} from '../dependencies.js';
// ================================================================
// USERS
// ================================================================

export async function adminUserAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).adminUserAction(payload);}

export function userAvatarHtml(u,size=34){
  const initials=((u.fname?.[0]||'')+(u.lname?.[0]||'')).toUpperCase()||'U';
  const fallback=`<div class="sb-avatar avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.34)}px;flex-shrink:0">${initials}</div>`;
  if(u.profilePhoto){
    const src=escapeHtml(u.profilePhoto);
    return `<div style="width:${size}px;height:${size}px;position:relative;flex-shrink:0">
      <img src="${src}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;cursor:pointer;display:block"
        ${bindAction('click',(event,element)=>{event.stopPropagation();showFilePreview((String(u.fname)+" "+String(u.lname)+" - Photo"),(String(u.profilePhoto)))})}
        ${bindAction('error',(event,element)=>{element.style.display='none';element.nextElementSibling.style.display='flex'})}
        title="Click to view full size">
      <div class="sb-avatar" style="display:none;width:${size}px;height:${size}px;font-size:${Math.round(size*0.34)}px;position:absolute;inset:0">${initials}</div>
    </div>`;
  }
  return fallback;
}

export function userDetailField(label,value,wide=false){
  const raw=String(value??'').trim();
  return `<div class="user-detail-field ${wide?'wide':''}">
    <span>${escapeHtml(label)}</span>
    <strong>${raw?escapeHtml(raw):'<span class="text-muted">Not provided</span>'}</strong>
  </div>`;
}

export function userVerificationPreview(detail){
  const u=detail?.user||{};
  const url=u.verification_signed_url||'';
  if(!url)return '<div class="user-detail-preview-body"><span class="text-muted">No Student or Employee ID is stored for this account.</span></div>';
  const clean=String(u.id_file_url||'').split('?')[0].toLowerCase();
  const isPdf=/\.pdf$/i.test(clean);
  return isPdf
    ? `<div class="user-detail-preview-body"><iframe src="${escapeHtml(url)}" title="Submitted verification document"></iframe></div>`
    : `<div class="user-detail-preview-body"><img src="${escapeHtml(url)}" alt="Submitted verification document"></div>`;
}

export async function openUserDetails(id){
  const u=appState.data.DB.users.find(x=>x.id===Number(id));
  if(!u||appState.auth.currentUser?.role!=='Administrator')return;

  openModal(`<div class="modal modal-lg"><div class="modal-header"><h3>User Information</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body"><div class="db-skeleton-shimmer" style="height:340px;border-radius:14px"></div></div></div>`);

  try{
    let detail;
    if(u._realSupabase){
      detail=await adminUserAction({action:'detail',user_id:u.dbUserId});
    }else{
      const pt=appState.data.DB.patients.find(p=>p.userId===u.id)||null;
      detail={
        user:{
          first_name:u.fname,last_name:u.lname,username:u.username,email:u.email,contact_number:u.contact,
          role:u.role,status:u.status,verified:u.verified,person_type:u.personType,college:u.college,id_number:u.idNo,
          profile_signed_url:u.profilePhoto||'',verification_signed_url:u.idFileData||'',
          verification_document_type:u.personType==='Student'?'Student ID':u.role==='Patient'?'Employee ID':'Not required',
          specialty:u.specialty,last_sign_in_at:u.lastLogin,created_at:u.createdAt,email_confirmed_at:u.emailConfirmedAt||null,
          work_days:u.workDays,start_time:u.startTime,end_time:u.endTime,max_patients:u.maxPatients
        },
        patient:pt?{
          birth_date:pt.birthDate||'',sex:pt.gender||'',blood_type:pt.blood||'',address:pt.address||'',
          emergency_contact_name:pt.emergencyName||'',emergency_contact_number:pt.emergencyContact||'',
          medical_history:pt.medHistory||'',allergies:pt.allergies||''
        }:null
      };
    }

    const d=detail.user||{},p=detail.patient||{};
    const fullName=`${d.first_name||''} ${d.last_name||''}`.trim();
    const initials=((d.first_name?.[0]||'')+(d.last_name?.[0]||'')).toUpperCase()||'U';
    const documentTitle=d.verification_document_type||(
      d.person_type==='Student'?'Student ID':
      d.role==='Patient'?'Employee ID':'Verification Document'
    );
    const emailStatus=d.email_confirmed_at?'Confirmed':'Not confirmed';
    const roleSchedule=d.role==='Doctor'
      ? `${Array.isArray(d.work_days)?d.work_days.join(', '):'—'} · ${String(d.start_time||'').slice(0,5)||'—'}–${String(d.end_time||'').slice(0,5)||'—'}`
      : '';

    openModal(`<div class="modal modal-xl user-detail-modal">
      <div class="modal-header">
        <div><h3>${escapeHtml(fullName||'User Information')}</h3><div class="text-muted">${escapeHtml(d.role||'')} · ${escapeHtml(d.status||'')}</div></div>
        <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
      </div>
      <div class="modal-body">
        <div class="user-detail-grid">
          <div style="display:grid;gap:.75rem">
            <section class="user-detail-section">
              <h4>Account &amp; Registration Information</h4>
              <div class="user-detail-fields">
                ${userDetailField('First Name',d.first_name)}
                ${userDetailField('Last Name',d.last_name)}
                ${userDetailField('Username',d.username)}
                ${userDetailField('Email',d.email)}
                ${userDetailField('Email Verification',emailStatus)}
                ${userDetailField('Contact Number',d.contact_number)}
                ${userDetailField('Role',d.role)}
                ${userDetailField('Status',d.status)}
                ${userDetailField('Person Type',d.person_type)}
                ${userDetailField('College / Department',d.college)}
                ${userDetailField(d.person_type==='Student'?'Student ID No.':'Employee ID No.',d.id_number)}
                ${userDetailField('Verification Document',documentTitle)}
                ${userDetailField('Account Created',formatLastLogin(d.auth_created_at||d.created_at))}
                ${userDetailField('Last Login',formatLastLogin(d.last_sign_in_at||d.last_login_at))}
                ${d.role==='Doctor'?userDetailField('Doctor Specialty',d.specialty):''}
                ${d.role==='Doctor'?userDetailField('Work Schedule',roleSchedule,true):''}
              </div>
            </section>

            ${p&&Object.keys(p).length?`<section class="user-detail-section">
              <h4>Patient / Health Profile</h4>
              <div class="user-detail-fields">
                ${userDetailField('Date of Birth',p.birth_date)}
                ${userDetailField('Sex',p.sex)}
                ${userDetailField('Blood Type',p.blood_type)}
                ${userDetailField('Address',p.address,true)}
                ${userDetailField('Emergency Contact Name',p.emergency_contact_name)}
                ${userDetailField('Emergency Contact Number',p.emergency_contact_number)}
                ${userDetailField('Allergies',p.allergies)}
                ${userDetailField('Medical History',p.medical_history,true)}
              </div>
            </section>`:''}
          </div>

          <section class="user-detail-section">
            <h4>Submitted Identity Documents</h4>
            <div class="user-detail-docs">
              <div class="user-detail-preview selfie">
                <h5>Registration Selfie / Profile Photo</h5>
                <div class="user-detail-preview-body">
                  ${d.profile_signed_url
                    ?`<img src="${escapeHtml(d.profile_signed_url)}" alt="Registration selfie">`
                    :`<div class="approval-applicant-avatar" style="width:78px;height:78px">${initials}</div>`}
                </div>
              </div>
              <div class="user-detail-preview">
                <h5>${escapeHtml(documentTitle)}</h5>
                ${userVerificationPreview(detail)}
              </div>
            </div>
            <div style="display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.6rem">
              ${d.profile_signed_url?`<button class="btn btn-xs" ${bindAction('click',(event,element)=>{showFilePreview((String(fullName)+" - Registration Selfie"),(String(d.profile_signed_url)))})}><i class="bi bi-arrows-fullscreen"></i> Open Selfie</button>`:''}
              ${d.verification_signed_url?`<button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{showFilePreview((String(documentTitle)),(String(d.verification_signed_url)))})}><i class="bi bi-arrows-fullscreen"></i> Open Submitted Document</button>`:''}
            </div>
            <p class="form-note" style="margin-top:.55rem">Sensitive registration files use temporary signed links and remain in private CampusCare storage.</p>
          </section>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
        ${canEditApprovedUser({...u,status:d.status})?`<button class="btn btn-primary" ${bindAction('click',()=>openEditUserModal(u.id))}>Edit User</button>`:''}
      </div>
    </div>`);
  }catch(e){
    openModal(`<div class="modal modal-sm"><div class="modal-header"><h3>User Information</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
      <div class="modal-body"><div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load this user.')}</div></div>
      <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button></div></div>`);
  }
}

export async function renderUsers(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(appState.auth.currentUser?.role==='Administrator'){
    showDatabaseSkeleton('table');
    try{await syncAdminDirectoryFromSupabase();}
    catch(e){
      if(!isCampusPageCurrent('users',pageToken))return;
      console.error(e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load user management data.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderUsers()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('users',pageToken))return;
  }
  const ui=appState.userManagement??={};ui.tab??='users';
  const pendingRequests=(appState.data.DB.nameChangeRequests||[]).filter(r=>r.status==='Pending').length
    +(appState.data.DB.scheduleChangeRequests||[]).filter(r=>r.status==='Pending').length
    +(appState.data.DB.leaveRequests||[]).filter(r=>r.status==='Pending').length;
  const tabs=[['users','Users',null],['requests','Requests',pendingRequests],['schedules','Doctor schedules',null]];
  const tabBar=`<div class="appt-head"><div class="appt-views" role="tablist" aria-label="User management sections">${tabs.map(([id,label,count])=>`<button type="button" role="tab" class="appt-view ${ui.tab===id?'active':''} ${count?'attention':''}" aria-selected="${ui.tab===id}" ${bindAction('click',()=>{ui.tab=id;renderUsers();})}>${label}${count!==null?`<span class="appt-view-count">${count}</span>`:''}</button>`).join('')}</div>
    ${ui.tab==='users'?`<button class="btn btn-primary btn-sm" ${bindAction('click',()=>openAddUserModal())}>+ Add User</button>`:''}</div>`;
  if(ui.tab==='requests'){
    c.innerHTML=tabBar+`
    <div class="card">
      <div class="card-header"><h3>Name change requests</h3></div>
      <div id="name-change-table"></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Schedule Change Requests</h3></div>
      ${(()=>{const reqs=(appState.data.DB.scheduleChangeRequests||[]).filter(r=>['Pending','Approved-Pending'].includes(r.status)).sort((a,b)=>b.id-a.id);
        if(!reqs.length)return '<p class="text-muted">No pending schedule change requests.</p>';
        return `<div class="table-wrap"><table><thead><tr><th>Doctor</th><th>Requested Hours</th><th>Work Days</th><th>Max/Day</th><th>Effective</th><th>Reason</th><th>Actions</th></tr></thead><tbody>${
          reqs.map(r=>{const doc=getUserById(r.doctorId);return `<tr>
            <td>${doc?docName(doc):'—'}</td>
            <td>${fmtTime(r.requested.startTime)} – ${fmtTime(r.requested.endTime)}</td>
            <td>${(r.requested.workDays||[]).join(', ')}</td>
            <td>${r.requested.maxPatients}</td>
            <td>${fmtDate(r.effectiveDate||r.createdAt)}</td>
            <td>${r.reason?escapeHtml(r.reason):'<span class="text-muted">—</span>'}</td>
            <td><div class="td-actions">
              ${r.status==='Pending'
                ? `<button class="btn btn-xs btn-success" ${bindAction('click',(event,element)=>{approveScheduleChange((r.id))})}>Approve</button>
                   <button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{rejectScheduleChange((r.id))})}>Reject</button>`
                : `<span class="badge badge-info">Approved · activates ${fmtDate(r.effectiveDate)}</span>`}
            </div></td>
          </tr>`;}).join('')
        }</tbody></table></div>`;
      })()}
    </div>
    <div class="card">
      <div class="card-header"><h3>Day Off Requests</h3></div>
      ${(()=>{const reqs=(appState.data.DB.leaveRequests||[]).filter(r=>r.status==='Pending').sort((a,b)=>a.date.localeCompare(b.date));
        if(!reqs.length)return '<p class="text-muted">No pending day off requests.</p>';
        return `<div class="table-wrap"><table><thead><tr><th>Doctor</th><th>Date</th><th>Reason</th><th>Actions</th></tr></thead><tbody>${
          reqs.map(r=>{const doc=getUserById(r.doctorId);return `<tr>
            <td>${doc?docName(doc):'—'}</td>
            <td>${fmtDate(r.date)}</td>
            <td>${r.reason?escapeHtml(r.reason):'<span class="text-muted">—</span>'}</td>
            <td><div class="td-actions">
              <button class="btn btn-xs btn-success" ${bindAction('click',(event,element)=>{approveLeaveRequest((r.id))})}>Approve</button>
              <button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{rejectLeaveRequest((r.id))})}>Reject</button>
            </div></td>
          </tr>`;}).join('')
        }</tbody></table></div>`;
      })()}
    </div>
`;
    renderNameChangeTable();
    return;
  }
  if(ui.tab==='schedules'){
    c.innerHTML=tabBar+`
    <div class="card">
      <div class="card-header"><h3>Doctor Work Schedules</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Doctor</th><th>Specialty</th><th>Work Days</th><th>Hours</th><th>Max Patients</th><th>Actions</th></tr></thead><tbody>${(appState.auth.currentUser?.role==='Administrator'?getDoctors().filter(d=>d._realSupabase):getDoctors()).map(d=>`<tr>
          <td>${docName(d)}</td>
          <td>${d.specialty||'General'}</td>
          <td>${(d.workDays||[]).join(', ')}</td>
          <td>${d.startTime||'08:00'} – ${d.endTime||'17:00'}</td>
          <td>${d.maxPatients||20}</td>
          <td><button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{openDoctorScheduleEdit((d.id))})}>Edit</button></td>
        </tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Upcoming Doctor Leave</h3></div>
      ${(()=>{const all=appState.data.DB.doctorLeaves.filter(l=>l.date>=appState.clinicInformation.TODAY).sort((a,b)=>a.date.localeCompare(b.date));
        if(!all.length)return '<p class="text-muted">No doctors have approved upcoming days off.</p>';
        return `<div class="table-wrap"><table><thead><tr><th>Doctor</th><th>Date</th><th>Reason</th><th></th></tr></thead><tbody>${
          all.map(l=>{const d=getUserById(l.doctorId);return `<tr><td>${d?docName(d):'—'}</td><td>${fmtDate(l.date)}</td><td>${l.reason?escapeHtml(l.reason):'<span class="text-muted">—</span>'}</td><td><button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{removeDoctorLeave((l.id))})}>Cancel</button></td></tr>`;}).join('')
        }</tbody></table></div>`;
      })()}
    </div>
`;
    return;
  }
  c.innerHTML=tabBar+`
    <div class="toolbar usr-toolbar">
      <input type="search" placeholder="Search name, username, email or ID number" aria-label="Search users" id="usr-search" ${bindAction('input',()=>renderUserTable())}>
      <select id="usr-role" aria-label="Role" ${bindAction('change',()=>renderUserTable())}>
        <option value="">All roles</option>
        <option>Administrator</option><option>Doctor</option><option>Staff</option><option>Patient</option>
      </select>
      <select id="usr-status" aria-label="Status" ${bindAction('change',()=>renderUserTable())}>
        <option value="">All statuses</option>
        <option>Active</option><option>Pending</option><option>Suspended</option>
        <option value="Archived">Archived</option>
      </select>
      <select id="usr-sort" aria-label="Sort" ${bindAction('change',()=>renderUserTable())}>
        <option value="name">Name A–Z</option><option value="login">Last login, most recent</option><option value="never">Never signed in first</option>
      </select>
    </div>
    <p class="patient-filter-summary" id="usr-summary" role="status" aria-live="polite"></p>
    <div class="card"><div id="user-table"></div></div>`;
  renderUserTable();
}

export function renderNameChangeTable(){
  const el=document.getElementById('name-change-table');
  if(!el)return;
  const reqs=(appState.data.DB.nameChangeRequests||[]).slice().sort((a,b)=>b.id-a.id);
  if(!reqs.length){el.innerHTML='<p class="text-muted">No name change requests yet.</p>';return;}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Current Name</th><th>Requested Name</th><th>Reason</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
    reqs.map(r=>`<tr>
      <td>${escapeHtml(r.currentFname)} ${escapeHtml(r.currentLname)}</td>
      <td><strong>${escapeHtml(r.requestedFname)} ${escapeHtml(r.requestedLname)}</strong></td>
      <td>${r.reason?escapeHtml(r.reason):'<span class="text-muted">—</span>'}</td>
      <td>${fmtDate(r.createdAt)}</td>
      <td>${r.status==='Pending'?'<span class="badge badge-warning">Pending</span>':r.status==='Approved'?'<span class="badge badge-success">Approved</span>':'<span class="badge badge-danger">Rejected</span>'}</td>
      <td><div class="td-actions">
        ${r.status==='Pending'?`<button class="btn btn-xs btn-success" ${bindAction('click',(event,element)=>{approveNameChange((r.id))})}>Approve</button><button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{rejectNameChange((r.id))})}>Reject</button>`:'<span class="text-muted">—</span>'}
      </div></td>
    </tr>`).join('')
  }</tbody></table></div>`;
}

export function renderUserTable(){
  const value=id=>document.getElementById(id)?.value||'';
  const q=value('usr-search').trim().toLowerCase(),role=value('usr-role'),stat=value('usr-status'),sort=value('usr-sort')||'name';
  const sourceUsers=appState.auth.currentUser?.role==='Administrator'
    ? appState.data.DB.users.filter(u=>u._realSupabase)
    : appState.data.DB.users;
  const users=sourceUsers.filter(u=>{
    const haystack=`${u.fname} ${u.lname} ${u.lname}, ${u.fname} ${u.username} ${u.email} ${u.idNo||''}`.toLowerCase();
    const matchStatus=stat?(stat==='Archived'?!!u.archived:(u.status===stat&&!u.archived)):true;
    return (!q||haystack.includes(q))&&(!role||u.role===role)&&matchStatus;
  }).sort((a,b)=>sort==='login'?String(b.lastLogin||'').localeCompare(String(a.lastLogin||''))
    :sort==='never'?Number(Boolean(a.lastLogin))-Number(Boolean(b.lastLogin))||`${a.lname} ${a.fname}`.localeCompare(`${b.lname} ${b.fname}`)
    :`${a.lname} ${a.fname}`.localeCompare(`${b.lname} ${b.fname}`));
  const el=document.getElementById('user-table');
  if(!el)return;
  const count=st=>sourceUsers.filter(u=>!u.archived&&u.status===st).length;
  const summary=document.getElementById('usr-summary');
  if(summary)summary.textContent=`${users.length} of ${sourceUsers.length} accounts · ${count('Active')} active · ${count('Pending')} pending · ${count('Suspended')} suspended`;
  if(!users.length){el.innerHTML='<div class="empty-state"><p>No accounts match these filters.</p></div>';return;}
  el.innerHTML=`<div class="table-wrap user-table-scroll" tabindex="0" role="region" aria-label="Users table, scroll for more users"><table class="treat-table"><thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Type / Dept.</th><th scope="col">Last login</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${
    users.map(u=>`<tr class="user-detail-row-click ${u.archived?'archived':''}" ${bindAction('click',()=>openUserDetails(u.id))} title="Open complete user information">
      <td data-label="User"><div class="pt-identity">${userAvatarHtml(u,32)}<div><strong>${escapeHtml(u.lname)}, ${escapeHtml(u.fname)}</strong>${u.id===appState.auth.currentUser.id?' <span class="badge badge-info">You</span>':''}<div class="text-muted">@${escapeHtml(u.username||'—')} · ${escapeHtml(u.email||'')}</div>${u.idNo?`<div class="text-muted">ID ${escapeHtml(u.idNo)}</div>`:''}</div></div></td>
      <td data-label="Role"><span class="badge badge-info">${escapeHtml(u.role)}</span></td>
      <td data-label="Type / Dept.">${escapeHtml(u.personType||u.specialty||u.department||'—')}${u.college?`<div class="text-muted">${escapeHtml(u.college)}</div>`:''}</td>
      <td data-label="Last login" class="text-muted">${u.lastLogin?formatLastLogin(u.lastLogin):'Never'}</td>
      <td data-label="Status">${u.archived?'<span class="badge badge-gray">Archived</span>':statusBadge(u.status)}</td>
      <td data-label="Actions"><div class="td-actions" ${bindAction('click',(event)=>event.stopPropagation())}>
        ${!u.archived&&u.status==='Pending'?`<button class="btn btn-xs btn-primary" ${bindAction('click',()=>navTo('approvals'))}>Review in Approval Queue</button>`:''}
        ${canEditApprovedUser(u)?`<button class="btn btn-xs" ${bindAction('click',()=>openEditUserModal(u.id))}>Edit</button>`:''}
        ${!u.archived&&u.status==='Active'&&u.id!==appState.auth.currentUser.id?`<button class="btn btn-xs btn-warning" ${bindAction('click',()=>suspendUser(u.id))}>Suspend</button>`:''}
        ${!u.archived&&u.status==='Suspended'?`<button class="btn btn-xs btn-success" ${bindAction('click',()=>reactivateUser(u.id))}>Reactivate</button>`:''}
        ${u.id!==appState.auth.currentUser.id&&u.status!=='Pending'?(u.archived?`<button class="btn btn-xs btn-success" ${bindAction('click',()=>restoreUser(u.id))}>Restore</button>`:`<button class="btn btn-xs" ${bindAction('click',()=>archiveUser(u.id))}>Archive</button>`):''}
      </div></td>
    </tr>`).join('')
  }</tbody></table></div>`;
  limitTableRows(el.querySelector('.user-table-scroll'),10);
}

export function suspendUser(id){
  if(appState.data.DB.users.find(x=>x.id===id)?.status!=='Active')return;
  const u=appState.data.DB.users.find(x=>x.id===id);if(!u)return;
  if(appState.auth.currentUser?.role==='Administrator'&&id===appState.auth.currentUser.id&&'Suspended'!=='Active'){
    toast('You cannot suspend or archive your own administrator account.','warning');return;
  }
  showConfirmDialog({
    title:'Suspend Account',
    message:`Are you sure you want to suspend <strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>'s account?`,
    confirmLabel:'Suspend',danger:true,
    onConfirm:async()=>{
      if(u._realSupabase){
        try{
          await adminUserAction({action:'status',user_id:u.dbUserId,status:'Suspended'});
          toast(`${u.fname} ${u.lname} suspended.`,'success');
          await renderUsers();
        }catch(e){toast(e?.message||'Unable to update account.','error');}
        return;
      }
      u.status='Suspended';
      u.archived='Suspended'==='Archived';
      toast(`${u.fname} ${u.lname} suspended.`,'success');
      renderUserTable();
    }
  });
}

export function reactivateUser(id){
  if(appState.data.DB.users.find(x=>x.id===id)?.status!=='Suspended')return;
  const u=appState.data.DB.users.find(x=>x.id===id);if(!u)return;
  if(appState.auth.currentUser?.role==='Administrator'&&id===appState.auth.currentUser.id&&'Active'!=='Active'){
    toast('You cannot suspend or archive your own administrator account.','warning');return;
  }
  showConfirmDialog({
    title:'Reactivate Account',
    message:`Are you sure you want to reactivate <strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>'s account?`,
    confirmLabel:'Reactivate',danger:false,
    onConfirm:async()=>{
      if(u._realSupabase){
        try{
          await adminUserAction({action:'status',user_id:u.dbUserId,status:'Active'});
          toast(`${u.fname} ${u.lname} reactivated.`,'success');
          await renderUsers();
        }catch(e){toast(e?.message||'Unable to update account.','error');}
        return;
      }
      u.status='Active';
      u.archived='Active'==='Archived';
      toast(`${u.fname} ${u.lname} reactivated.`,'success');
      renderUserTable();
    }
  });
}

export function archiveUser(id){
  const u=appState.data.DB.users.find(x=>x.id===id);if(!u)return;
  if(appState.auth.currentUser?.role==='Administrator'&&id===appState.auth.currentUser.id&&'Archived'!=='Active'){
    toast('You cannot suspend or archive your own administrator account.','warning');return;
  }
  showConfirmDialog({
    title:'Archive Account',
    message:`Are you sure you want to archive <strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>'s account?`,
    confirmLabel:'Archive',danger:true,
    onConfirm:async()=>{
      if(u._realSupabase){
        try{
          await adminUserAction({action:'status',user_id:u.dbUserId,status:'Archived'});
          toast(`${u.fname} ${u.lname} archived.`,'success');
          await renderUsers();
        }catch(e){toast(e?.message||'Unable to update account.','error');}
        return;
      }
      u.status='Archived';
      u.archived='Archived'==='Archived';
      toast(`${u.fname} ${u.lname} archived.`,'success');
      renderUserTable();
    }
  });
}

export function restoreUser(id){
  const u=appState.data.DB.users.find(x=>x.id===id);if(!u)return;
  if(appState.auth.currentUser?.role==='Administrator'&&id===appState.auth.currentUser.id&&'Active'!=='Active'){
    toast('You cannot suspend or archive your own administrator account.','warning');return;
  }
  showConfirmDialog({
    title:'Restore Account',
    message:`Are you sure you want to restore <strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>'s account?`,
    confirmLabel:'Restore',danger:false,
    onConfirm:async()=>{
      if(u._realSupabase){
        try{
          await adminUserAction({action:'status',user_id:u.dbUserId,status:'Active'});
          toast(`${u.fname} ${u.lname} restored.`,'success');
          await renderUsers();
        }catch(e){toast(e?.message||'Unable to update account.','error');}
        return;
      }
      u.status='Active';
      u.archived='Active'==='Archived';
      toast(`${u.fname} ${u.lname} restored.`,'success');
      renderUserTable();
    }
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
