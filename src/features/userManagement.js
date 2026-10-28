import {canEditApprovedUser} from '../../supabase/functions/_shared/admin-user-edit.js';
// userManagement: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {closeAllModals,openModal,showFilePreview} from './modals.js';
import {formatLastLogin} from './accountSettings.js';
import {openAddUserModal,openEditUserModal} from './userForm.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {getUserById} from './documentScanner.js';
import {docName} from './messaging.js';
import {collegeBadge,fmtDate,fmtTime,statusBadge} from './inputValidation.js';
import {approveScheduleChange,rejectScheduleChange} from './workflowRequests.js';
import {approveLeaveRequest,rejectLeaveRequest} from './doctorSchedule.js';
import {approveNameChange,rejectNameChange} from './nameChangeRequests.js';
import {navTo} from './navigationRaceProtection.js';
import {showConfirmDialog,toast,toastWithUndo} from './theme.js';
import {bindAction,createOperationalService} from '../dependencies.js';
import {requestAttachmentBadge,requestAttachmentViewHtml} from './requestAttachments.js';
import {appointmentRecords} from './appointmentService.js';
import {doctorSchedulesHtml,hydrateDoctorSchedules,needsDoctorScheduleHydration,renderDoctorScheduleRows} from './doctorSchedules.js';
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
          reqs.map(r=>{const doc=getUserById(r.doctorId);return `<tr class="req-row" tabindex="0" title="Open request" ${reviewRowActions('Schedule Change',r.id)}>
            <td>${doc?docName(doc):'—'} ${requestAttachmentBadge(r)}</td>
            <td>${fmtTime(r.requested.startTime)} – ${fmtTime(r.requested.endTime)}</td>
            <td>${(r.requested.workDays||[]).join(', ')}</td>
            <td>${r.requested.maxPatients}</td>
            <td>${fmtDate(r.effectiveDate||r.createdAt)}</td>
            <td class="req-reason-cell">${r.reason?escapeHtml(r.reason):'<span class="text-muted">—</span>'}</td>
            <td><div class="td-actions" ${stopRowClick()}>
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
          reqs.map(r=>{const doc=getUserById(r.doctorId);return `<tr class="req-row" tabindex="0" title="Open request" ${reviewRowActions('Day Off',r.id)}>
            <td>${doc?docName(doc):'—'} ${requestAttachmentBadge(r)}</td>
            <td>${fmtDate(r.date)}</td>
            <td class="req-reason-cell">${r.reason?escapeHtml(r.reason):'<span class="text-muted">—</span>'}</td>
            <td><div class="td-actions" ${stopRowClick()}>
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
    c.innerHTML=tabBar+doctorSchedulesHtml();
    renderDoctorScheduleRows();
    if(needsDoctorScheduleHydration())void hydrateDoctorSchedules();
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

function reviewRowActions(type,id){
  return bindAction('click',()=>openWorkflowRequestReview(type,id))+' '+
    bindAction('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openWorkflowRequestReview(type,id);}});
}
function stopRowClick(){return bindAction('click',event=>event.stopPropagation())+' '+bindAction('keydown',event=>event.stopPropagation());}

const REVIEW_SOURCES={
  'Name Change':{list:()=>appState.data.DB.nameChangeRequests,approve:approveNameChange,reject:rejectNameChange,icon:'<i class="bi bi-person-vcard" aria-hidden="true"></i>'},
  'Schedule Change':{list:()=>appState.data.DB.scheduleChangeRequests,approve:approveScheduleChange,reject:rejectScheduleChange,icon:'<i class="bi bi-calendar-week" aria-hidden="true"></i>'},
  'Day Off':{list:()=>appState.data.DB.leaveRequests,approve:approveLeaveRequest,reject:rejectLeaveRequest,icon:'<i class="bi bi-calendar2-x" aria-hidden="true"></i>'}
};

function scheduleSummaryHtml(s){
  if(!s||!Object.keys(s).length)return '<span class="text-muted">Not recorded</span>';
  return `<dl class="req-sched">
    <div><dt>Days</dt><dd>${escapeHtml((s.workDays||[]).join(', ')||'—')}</dd></div>
    <div><dt>Hours</dt><dd>${s.startTime?fmtTime(s.startTime)+' – '+fmtTime(s.endTime):'—'}</dd></div>
    <div><dt>Slot</dt><dd>${Number(s.slotDuration)||'—'} min</dd></div>
    <div><dt>Max / day</dt><dd>${Number(s.maxPatients)||'—'}</dd></div>
  </dl>`;
}

function requestStatusLabel(status){
  return status==='Approved-Pending'?'<span class="badge badge-info">Approved · not yet active</span>':statusBadge(status==='Applied'?'Approved':status);
}

// One review surface for every staff request: who asked, what changes, why, and the evidence.
export function openWorkflowRequestReview(type,id){
  const source=REVIEW_SOURCES[type];
  const r=(source?.list()||[]).find(x=>x.id===Number(id));
  if(!r){toast('That request is no longer available. Refresh and try again.','warning');return;}
  const requester=getUserById(r.userId||r.doctorId);
  const isAdmin=appState.auth.currentUser?.role==='Administrator';
  const reviewable=isAdmin&&r.status==='Pending';
  let details='';
  if(type==='Name Change'){
    details=`<div class="req-compare"><div><span>Current name</span><strong>${escapeHtml(r.currentFname)} ${escapeHtml(r.currentLname)}</strong></div><div class="req-compare-arrow" aria-hidden="true">→</div><div class="req-compare-new"><span>Requested name</span><strong>${escapeHtml(r.requestedFname)} ${escapeHtml(r.requestedLname)}</strong></div></div>`;
  }else if(type==='Schedule Change'){
    const req=r.requested||{},conflicts=r.payload?.conflictPreview||[];
    details=`<div class="req-compare req-compare-sched"><div><span>Current schedule</span>${scheduleSummaryHtml(r.currentSchedule)}</div><div class="req-compare-arrow" aria-hidden="true">→</div><div class="req-compare-new"><span>Requested schedule</span>${scheduleSummaryHtml(req)}</div></div>
      <div class="req-facts"><div><span>Effective</span><strong>${fmtDate(r.effectiveDate||r.createdAt)}</strong></div><div><span>Type</span><strong>${req.scheduleScope==='Temporary'?'Temporary · until '+fmtDate(req.effectiveEnd):'Permanent'}</strong></div></div>
      ${conflicts.length?`<div class="alert alert-warning show req-conflicts"><strong>${conflicts.length} booked appointment${conflicts.length===1?'':'s'} conflict${conflicts.length===1?'s':''}</strong> with the requested hours. Reschedule them before approving.<ul>${conflicts.slice(0,5).map(c=>`<li>${fmtDate(c.date)}${c.time?' · '+fmtTime(c.time):''} — ${escapeHtml(c.reason)}</li>`).join('')}</ul></div>`:''}`;
  }else{
    const booked=appointmentRecords().filter(a=>a.doctorId===r.doctorId&&a.date===r.date&&['Scheduled','Pending','Confirmed'].includes(a.status)).length;
    details=`<div class="req-facts"><div><span>Day off</span><strong>${fmtDate(r.date)}</strong></div><div><span>Booked patients that day</span><strong>${booked}</strong></div></div>
      ${booked?`<div class="alert alert-warning show">This doctor still has ${booked} booked appointment${booked===1?'':'s'} on that date. Reschedule them before approving.</div>`:''}`;
  }
  const decide=(fn)=>{const note=document.getElementById('req-review-note')?.value.trim()||'';fn(r.id,note);};
  openModal(`<div class="modal req-review" role="dialog" aria-labelledby="req-review-title">
    <div class="modal-header"><div><h3 id="req-review-title">${source.icon} ${escapeHtml(type)} request</h3><p class="form-note">Submitted ${fmtDate(r.createdAt)} · ${requestStatusLabel(r.status)}</p></div><button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div class="req-person">${requester?userAvatarHtml(requester,42):''}<div><strong>${requester?(requester.role==='Doctor'?docName(requester):escapeHtml(requester.fname+' '+requester.lname)):'Unknown user'}</strong><span>${escapeHtml(requester?.role||'')}${requester?.email?' · '+escapeHtml(requester.email):''}</span></div></div>
      <section class="req-section"><h4>What's requested</h4>${details}</section>
      <section class="req-section"><h4>Reason</h4>${r.reason?`<p class="req-reason">${escapeHtml(r.reason)}</p>`:'<p class="text-muted">No reason given.</p>'}</section>
      <section class="req-section"><h4>Supporting file</h4>${requestAttachmentViewHtml(r)}</section>
      ${r.adminNote&&!reviewable?`<section class="req-section"><h4>Administrator note</h4><p class="req-reason">${escapeHtml(r.adminNote)}</p></section>`:''}
      ${reviewable?`<section class="req-section"><label for="req-review-note"><h4>Note to requester <span class="text-muted">(optional)</span></h4></label><textarea id="req-review-note" rows="2" maxlength="2000" placeholder="Shown to the requester with your decision"></textarea></section>`:''}
    </div>
    ${reviewable?`<div class="modal-footer"><button class="btn btn-danger" ${bindAction('click',()=>decide(source.reject))}>Reject</button><button class="btn btn-success" ${bindAction('click',()=>decide(source.approve))}>Approve</button></div>`:''}
  </div>`);
}

export function renderNameChangeTable(){
  const el=document.getElementById('name-change-table');
  if(!el)return;
  const reqs=(appState.data.DB.nameChangeRequests||[]).slice().sort((a,b)=>b.id-a.id);
  if(!reqs.length){el.innerHTML='<p class="text-muted">No name change requests yet.</p>';return;}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Current Name</th><th>Requested Name</th><th>Reason</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
    reqs.map(r=>`<tr class="req-row" tabindex="0" title="Open request" ${reviewRowActions('Name Change',r.id)}>
      <td>${escapeHtml(r.currentFname)} ${escapeHtml(r.currentLname)} ${requestAttachmentBadge(r)}</td>
      <td><strong>${escapeHtml(r.requestedFname)} ${escapeHtml(r.requestedLname)}</strong></td>
      <td class="req-reason-cell">${r.reason?escapeHtml(r.reason):'<span class="text-muted">—</span>'}</td>
      <td>${fmtDate(r.createdAt)}</td>
      <td>${r.status==='Pending'?'<span class="badge badge-warning">Pending</span>':r.status==='Approved'?'<span class="badge badge-success">Approved</span>':'<span class="badge badge-danger">Rejected</span>'}</td>
      <td><div class="td-actions" ${stopRowClick()}>
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
  // Ten accounts per page with a pager, like the other record tables.
  const ui=appState.userManagement;
  const key=[q,role,stat,sort].join('|');if(ui.tableKey!==key){ui.tableKey=key;ui.tablePage=1;}
  const pages=Math.max(1,Math.ceil(users.length/USER_PAGE_SIZE));
  ui.tablePage=Math.min(Math.max(1,ui.tablePage||1),pages);
  const first=(ui.tablePage-1)*USER_PAGE_SIZE,pageUsers=users.slice(first,first+USER_PAGE_SIZE);
  el.innerHTML=`<div class="table-wrap"><table class="treat-table"><thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Type / Dept.</th><th scope="col">Last login</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${
    pageUsers.map(u=>`<tr class="user-detail-row-click ${u.archived?'archived':''}" ${bindAction('click',()=>openUserDetails(u.id))} title="Open complete user information">
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
  }</tbody></table></div>
  <div class="pt-pager"><span>Showing ${first+1}–${first+pageUsers.length} of ${users.length}</span>${pages>1?`<div>
    <button class="btn btn-xs" ${ui.tablePage===1?'disabled':''} ${bindAction('click',()=>{ui.tablePage--;renderUserTable();})}>‹ Previous</button>
    <span class="audit-page">Page ${ui.tablePage} of ${pages}</span>
    <button class="btn btn-xs" ${ui.tablePage===pages?'disabled':''} ${bindAction('click',()=>{ui.tablePage++;renderUserTable();})}>Next ›</button></div>`:''}</div>`;
}
const USER_PAGE_SIZE=10;

// Status changes share one flow: confirm, save, then offer Undo back to the previous status.
const STATUS_CHANGES={
  Suspended:{title:'Suspend Account',verb:'suspend',done:'suspended',danger:true},
  Reactivate:{title:'Reactivate Account',verb:'reactivate',done:'reactivated',status:'Active'},
  Archived:{title:'Archive Account',verb:'archive',done:'archived',danger:true},
  Restore:{title:'Restore Account',verb:'restore',done:'restored',status:'Active'}
};
async function saveUserStatus(u,status){
  if(u._realSupabase){
    await adminUserAction({action:'status',user_id:u.dbUserId,status});
    await renderUsers();
    return;
  }
  u.status=status;
  u.archived=status==='Archived';
  renderUserTable();
}
function changeUserStatus(id,change){
  const u=appState.data.DB.users.find(x=>x.id===id);if(!u)return;
  const meta=STATUS_CHANGES[change],next=meta.status||change,previous=u.status;
  if(appState.auth.currentUser?.role==='Administrator'&&id===appState.auth.currentUser.id&&next!=='Active'){
    toast('You cannot suspend or archive your own administrator account.','warning');return;
  }
  showConfirmDialog({
    title:meta.title,
    message:`Are you sure you want to ${meta.verb} <strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>'s account?`,
    confirmLabel:meta.title.split(' ')[0],danger:!!meta.danger,
    onConfirm:async()=>{
      try{await saveUserStatus(u,next);}
      catch(e){toast(e?.message||'Unable to update account.','error');return;}
      toastWithUndo(`${u.fname} ${u.lname} ${meta.done}.`,()=>saveUserStatus(u,previous),{undoneMessage:`${u.fname} ${u.lname} is ${previous.toLowerCase()} again.`});
    }
  });
}

export function suspendUser(id){
  if(appState.data.DB.users.find(x=>x.id===id)?.status!=='Active')return;
  changeUserStatus(id,'Suspended');
}

export function reactivateUser(id){
  if(appState.data.DB.users.find(x=>x.id===id)?.status!=='Suspended')return;
  changeUserStatus(id,'Reactivate');
}

export function archiveUser(id){changeUserStatus(id,'Archived');}

export function restoreUser(id){changeUserStatus(id,'Restore');}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
