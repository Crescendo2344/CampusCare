import {createFeatureSyncService} from '../services/feature-sync.js';
// approvalQueue: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {escapeHtml} from './issueReports.js';
import {applyNavBadges,refreshTaskBadges} from './topbarAndNavigation.js';
import {fmtDate,fmtDateTime,priorityBadge} from './inputValidation.js';
import {closeAllModals,openModal,showFilePreview} from './modals.js';
import {showConfirmDialog,toast} from './theme.js';
import {bindAction,workflowData} from '../dependencies.js';
// ================================================================
// APPROVALS
// ================================================================

export async function fetchRealPendingApprovals(){
  return createFeatureSyncService({getState:()=>appState,callbacks:{}}).fetchRealPendingApprovals();
}

export function realApprovalUiUser(u){return workflowData.realApprovalUiUser(u);}

export function syncRealPendingIntoDemoDB(rows){
  // Dashboard cards still read DB.users for now. Keep only the authoritative
  // Supabase pending registrations in that Pending Patient subset.
  appState.data.DB.users=(appState.data.DB.users||[]).filter(u=>!(u.role==='Patient'&&u.status==='Pending'));
  appState.data.DB.users.push(...rows.map(realApprovalUiUser));
}

export async function refreshRealApprovalQueue(renderPage=false){
  if(!['Administrator','Staff'].includes(appState.auth.currentUser?.role))return [];
  const rows=await fetchRealPendingApprovals();
  appState.approvalQueue.realPendingApprovals=rows;
  syncRealPendingIntoDemoDB(rows);
  if(renderPage&&document.getElementById('app-content'))renderApprovals(false);
  return rows;
}

export async function renderApprovals(loadRemote=true) {
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();

  if(loadRemote){
    showDatabaseSkeleton('table');
    try{
      await refreshRealApprovalQueue(false);
    }catch(e){
      if(!isCampusPageCurrent('approvals',pageToken))return;
      c.innerHTML=`<div class="card"><div class="card-header"><h3>Pending Registration Approvals</h3></div>
        <div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load pending registrations.')}</div></div>`;
      return;
    }
    if(!isCampusPageCurrent('approvals',pageToken))return;
  }

  const pending=appState.approvalQueue.realPendingApprovals.map(realApprovalUiUser);
  appState.topbarAndNavigation.navTaskCounts.approvals=pending.length;
  applyNavBadges();

  c.innerHTML=`
    <div class="card">
      <div class="card-header">
        <div>
          <h3>Pending Registration Approvals</h3>
          <div class="text-muted">Review the applicant's entered information beside the submitted verification document before making a decision.</div>
        </div>
        <div style="display:flex;gap:.45rem;align-items:center">
          <span class="badge badge-warning">${pending.length} pending</span>
          <button class="btn btn-xs" ${bindAction('click',(event,element)=>{renderApprovals(true)})}><i class="bi bi-arrow-clockwise"></i> Refresh</button>
        </div>
      </div>
      ${pending.length?`<div class="table-wrap"><table><thead><tr>
        <th>Applicant</th><th>Person Type</th><th>College / Department</th><th>ID No.</th><th>Submitted</th><th>Actions</th>
      </tr></thead><tbody>${
        pending.map(u=>{
          const initials=((u.fname?.[0]||'')+(u.lname?.[0]||'')).toUpperCase()||'P';
          return `<tr>
            <td>
              <div class="approval-applicant">
                ${u.profilePhoto
                  ?`<img src="${escapeHtml(u.profilePhoto)}" alt="" ${bindAction('error',(event,element)=>{element.outerHTML=("<span class=&quot;approval-applicant-avatar&quot;>"+String(initials)+"</span>")})}>`
                  :`<span class="approval-applicant-avatar">${initials}</span>`}
                <div><strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong><small>${escapeHtml(u.email||u.username||'')}</small></div>
              </div>
            </td>
            <td>${priorityBadge(u.personType||'Patient')}</td>
            <td>${escapeHtml(u.college||'—')}</td>
            <td><strong>${escapeHtml(u.idNo||'—')}</strong></td>
            <td>${u.createdAt?fmtDateTime(u.createdAt):'—'}</td>
            <td><div class="td-actions">
              <button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{reviewApproval((u.id))})}><i class="bi bi-eye"></i> Review</button>
              <button class="btn btn-xs btn-success" ${bindAction('click',(event,element)=>{approveUser((u.id))})}>Approve</button>
              <button class="btn btn-xs btn-danger" ${bindAction('click',(event,element)=>{rejectUser((u.id))})}>Reject</button>
            </div></td>
          </tr>`;
        }).join('')
      }</tbody></table></div>`:'<div class="empty-state"><p>No pending approvals.</p></div>'}
    </div>`;
}

export function approvalDisplayValue(value,fallback='Not provided'){
  const v=String(value??'').trim();
  return v?escapeHtml(v):`<span class="text-muted">${escapeHtml(fallback)}</span>`;
}

export function approvalDataField(label,value,wide=false){
  return `<div class="approval-data-field ${wide?'wide':''}">
    <span>${escapeHtml(label)}</span>
    <strong>${approvalDisplayValue(value)}</strong>
  </div>`;
}

export function approvalDocumentPreview(u){
  if(!u.idFileData){
    return `<div class="approval-preview-body"><span class="text-muted">No verification document available.</span></div>`;
  }
  const isPdf=/\.pdf(?:$|\?)/i.test(String(u.idFile||''))||
    /application\/pdf/i.test(String(u.idFile||''));
  if(isPdf){
    return `<div class="approval-preview-body"><iframe src="${escapeHtml(u.idFileData)}" title="Submitted verification document"></iframe></div>`;
  }
  return `<div class="approval-preview-body"><img src="${escapeHtml(u.idFileData)}" alt="Submitted verification document"></div>`;
}

export function reviewApproval(id){
  const u=appState.approvalQueue.realPendingApprovals.map(realApprovalUiUser).find(x=>x.id===Number(id));
  if(!u)return;

  const initials=((u.fname?.[0]||'')+(u.lname?.[0]||'')).toUpperCase()||'P';
  const emailState=u.emailConfirmedAt?'Confirmed':'Not yet confirmed';
  const submitted=u.createdAt?fmtDateTime(u.createdAt):'—';

  openModal(`<div class="modal modal-xl approval-review-modal">
    <div class="modal-header">
      <div>
        <h3>Registration Review</h3>
        <div class="text-muted">${escapeHtml(u.fname)} ${escapeHtml(u.lname)} · submitted ${escapeHtml(submitted)}</div>
      </div>
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
    </div>

    <div class="modal-body">
      <div class="approval-review-banner">
        Compare the applicant's typed information with the selfie and <strong>${escapeHtml(u.verificationDocumentType)}</strong>.
        Approval confirms that clinic personnel reviewed the submitted identity evidence.
      </div>

      <div class="approval-review-grid">
        <div style="display:grid;gap:.8rem">
          <section class="approval-review-section">
            <h4>Registration Information</h4>
            <div class="approval-data-grid">
              ${approvalDataField('First Name',u.fname)}
              ${approvalDataField('Last Name',u.lname)}
              ${approvalDataField('Username',u.username)}
              ${approvalDataField('Email',u.email)}
              ${approvalDataField('Email Status',emailState)}
              ${approvalDataField('Contact Number',u.contact)}
              ${approvalDataField('Person Type',u.personType)}
              ${approvalDataField('College / Department',u.college)}
              ${approvalDataField(u.personType==='Student'?'Student ID No.':'Employee ID No.',u.idNo)}
              ${approvalDataField('Date of Birth',u.dob?fmtDate(u.dob):'')}
              ${approvalDataField('Sex',u.sex)}
              ${approvalDataField('Verification Document',u.verificationDocumentType)}
            </div>
          </section>

          <section class="approval-review-section">
            <h4>Additional Patient Information</h4>
            <div class="approval-data-grid">
              ${approvalDataField('Address',u.address,true)}
              ${approvalDataField('Emergency Contact Name',u.emergencyName)}
              ${approvalDataField('Emergency Contact Number',u.emergencyContact)}
              ${approvalDataField('Blood Type',u.bloodType)}
              ${approvalDataField('Allergies',u.allergies)}
              ${approvalDataField('Medical History',u.medicalHistory,true)}
            </div>
          </section>
        </div>

        <section class="approval-review-section">
          <h4>Identity Comparison</h4>
          <div class="approval-compare">
            <div class="approval-preview-card approval-selfie">
              <div class="approval-preview-title">Submitted Selfie</div>
              <div class="approval-preview-body">
                ${u.profilePhoto
                  ?`<img src="${escapeHtml(u.profilePhoto)}" alt="Applicant selfie">`
                  :`<span class="approval-applicant-avatar" style="width:72px;height:72px">${initials}</span>`}
              </div>
            </div>
            <div class="approval-preview-card">
              <div class="approval-preview-title">${escapeHtml(u.verificationDocumentType||u.idFile||'Verification Document')}</div>
              ${approvalDocumentPreview(u)}
            </div>
          </div>

          <div class="approval-doc-actions">
            ${u.profilePhoto?`<button class="btn btn-xs" ${bindAction('click',(event,element)=>{showFilePreview((String(u.fname)+" "+String(u.lname)+" - Selfie"),(String(u.profilePhoto)))})}><i class="bi bi-arrows-fullscreen"></i> Open Selfie</button>`:''}
            ${u.idFileData?`<button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{showFilePreview((String(u.idFile)),(String(u.idFileData)))})}><i class="bi bi-arrows-fullscreen"></i> Open Document</button>`:''}
          </div>

          <div class="alert alert-info show" style="margin-top:.8rem;font-size:.68rem">
            Verify the name, Student/Employee ID number, person type, and visible identity information before approval.
            If details do not match or the document is unclear, reject the registration and include a reason.
          </div>
        </section>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
      <button class="btn btn-danger" ${bindAction('click',(event,element)=>{closeAllModals();rejectUser((u.id))})}>Reject</button>
      <button class="btn btn-success" ${bindAction('click',(event,element)=>{closeAllModals();approveUser((u.id))})}><i class="bi bi-check2-circle"></i> Approve Registration</button>
    </div>
  </div>`);
}

export async function submitRealApprovalDecision(id,action,reason=''){
  const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your approval-review session has expired.');
  const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/admin-approvals`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify({user_id:Number(id),action,reason})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to update registration.');
  return result;
}

export function approveUser(id){
  const u=appState.approvalQueue.realPendingApprovals.map(realApprovalUiUser).find(x=>x.id===Number(id));
  if(!u)return;
  showConfirmDialog({
    title:'Approve Registration',
    message:`Approve <strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>'s registration? They will be able to log in after approval.`,
    confirmLabel:'Approve',
    onConfirm:async()=>{
      try{
        await submitRealApprovalDecision(id,'approve');
        toast(`${u.fname} ${u.lname} approved.`,'success');
        await renderApprovals(true);
        await refreshTaskBadges(true);
      }catch(e){toast(e?.message||'Approval failed.','error');}
    }
  });
}

export function rejectUser(id){
  const u=appState.approvalQueue.realPendingApprovals.map(realApprovalUiUser).find(x=>x.id===Number(id));
  if(!u)return;
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>⚠️ Reject Registration</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body">
      <p style="font-size:.87rem;margin-bottom:.7rem">Reject <strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong>'s registration?</p>
      <div class="form-group"><label>Reason (optional)</label><textarea id="reject-reason-text" rows="2" placeholder="Reason for rejection"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-danger" ${bindAction('click',(event,element)=>{confirmRejectUser((id))})}>Reject Registration</button>
    </div>
  </div>`);
}

export async function confirmRejectUser(id){
  const u=appState.approvalQueue.realPendingApprovals.map(realApprovalUiUser).find(x=>x.id===Number(id));
  if(!u)return;
  const reason=(document.getElementById('reject-reason-text')?.value||'').trim();
  closeAllModals();
  try{
    await submitRealApprovalDecision(id,'reject',reason);
    toast(`${u.fname} ${u.lname} rejected.`,'warning');
    await renderApprovals(true);
    await refreshTaskBadges(true);
  }catch(e){toast(e?.message||'Rejection failed.','error');}
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.approvalQueue.realPendingApprovals=[];
}
