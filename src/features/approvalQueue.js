import {createFeatureSyncService} from '../services/feature-sync.js';
// approvalQueue: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {escapeHtml} from './issueReports.js';
import {applyNavBadges,refreshTaskBadges} from './topbarAndNavigation.js';
import {fmtDate,fmtDateTime,priorityBadge} from './inputValidation.js';
import {closeAllModals,closeTopModal,openModal,showFilePreview} from './modals.js';
import {syncUnitFilter,unitFilterOptionsHtml} from './patientManagement.js';
import * as queueData from '../domain/approval-queue.js';
import {toast} from './theme.js';
import {paginate,pagerHtml} from '../ui/pager.js';
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

// The queue lists applicants oldest first with automatic pre-checks. Decisions are made in the review
// dialog, after the evidence has been compared, as in identity-verification review tools.
const pendingApplicants=()=>appState.approvalQueue.realPendingApprovals.map(realApprovalUiUser);
function approvalFilters(){return appState.approvalQueue.filters??={query:'',personType:'',unit:'',order:'oldest'};}
function visibleApplicants(){
  const filters=approvalFilters();
  return queueData.sortApprovals(queueData.filterApprovals(pendingApplicants(),filters),filters.order);
}
const applicantInitials=u=>((u.fname?.[0]||'')+(u.lname?.[0]||'')).toUpperCase()||'P';
const flagChip=flag=>`<span class="approval-flag ${flag.tone}" title="${escapeHtml(flag.detail)}">${escapeHtml(flag.label)}</span>`;

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
      c.innerHTML=`<div class="card"><div class="card-header"><h3>Registration Approvals</h3></div>
        <div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load pending registrations.')}</div>
        <button class="btn btn-sm" ${bindAction('click',()=>renderApprovals(true))}>Retry</button></div>`;
      return;
    }
    if(!isCampusPageCurrent('approvals',pageToken))return;
  }

  const pending=pendingApplicants();
  appState.topbarAndNavigation.navTaskCounts.approvals=pending.length;
  applyNavBadges();
  const filters=approvalFilters();
  const now=Date.now();
  const overdue=pending.filter(u=>queueData.approvalWaitDays(u.createdAt,now)>=queueData.APPROVAL_OVERDUE_DAYS).length;
  const oldest=queueData.sortApprovals(pending)[0];
  const flagged=pending.filter(u=>queueData.approvalFlags(u,pending).length).length;

  c.innerHTML=`
    <div class="approval-summary">
      <div class="approval-stat"><span>Waiting for review</span><strong>${pending.length}</strong></div>
      <div class="approval-stat ${overdue?'warn':''}"><span>Waiting ${queueData.APPROVAL_OVERDUE_DAYS}+ days</span><strong>${overdue}</strong></div>
      <div class="approval-stat"><span>Oldest application</span><strong>${oldest?queueData.approvalWaitLabel(oldest.createdAt,now):'—'}</strong></div>
      <div class="approval-stat ${flagged?'warn':''}"><span>With pre-check notes</span><strong>${flagged}</strong></div>
    </div>
    <div class="toolbar approval-toolbar">
      <input type="search" id="ap-search" placeholder="Search name, email, username or ID number" aria-label="Search applicants" value="${escapeHtml(filters.query)}" ${bindAction('input',(event,element)=>{filters.query=element.value;renderApprovalTable();})}>
      <select id="ap-ptype" aria-label="Person type" ${bindAction('change',(event,element)=>{filters.personType=element.value;syncUnitFilter(document.getElementById('ap-unit'),element.value);filters.unit=document.getElementById('ap-unit').value;renderApprovalTable();})}>
        <option value="">All types</option>${['Student','Teaching Personnel','Non-Teaching Personnel'].map(type=>`<option ${filters.personType===type?'selected':''}>${type}</option>`).join('')}
      </select>
      <select id="ap-unit" aria-label="College or department" ${bindAction('change',(event,element)=>{filters.unit=element.value;renderApprovalTable();})}>${unitFilterOptionsHtml(filters.personType,filters.unit)}</select>
      <select id="ap-order" aria-label="Order" ${bindAction('change',(event,element)=>{filters.order=element.value;renderApprovalTable();})}>
        <option value="oldest" ${filters.order==='oldest'?'selected':''}>Oldest first</option><option value="newest" ${filters.order==='newest'?'selected':''}>Newest first</option>
      </select>
      <button class="btn btn-sm" ${bindAction('click',()=>renderApprovals(true))}><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Refresh</button>
    </div>
    <p class="patient-filter-summary" id="ap-summary" role="status" aria-live="polite"></p>
    <div class="card"><div id="ap-table"></div></div>`;
  renderApprovalTable();
}

export function renderApprovalTable(){
  const el=document.getElementById('ap-table');
  if(!el)return;
  const pending=pendingApplicants(),rows=visibleApplicants(),now=Date.now();
  const summary=document.getElementById('ap-summary');
  if(summary)summary.textContent=rows.length===pending.length?`${rows.length} applicant${rows.length===1?'':'s'} waiting`:`${rows.length} of ${pending.length} applicants shown`;
  if(!rows.length){
    el.innerHTML=`<div class="empty-state"><i class="bi bi-person-check" aria-hidden="true" style="font-size:1.6rem"></i><p>${pending.length?'No applicants match these filters.':'All caught up. There are no registrations waiting for review.'}</p></div>`;
    return;
  }
  const page=paginate('approvals',rows,{signature:JSON.stringify(appState.approvalQueue.filters||{})});
  el.innerHTML=`<div class="table-wrap"><table class="approval-table"><thead><tr><th scope="col">Applicant</th><th scope="col">Type</th><th scope="col">College / Dept.</th><th scope="col">ID No.</th><th scope="col">Evidence</th><th scope="col">Waiting</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${
    page.rows.map(u=>{
      const flags=queueData.approvalFlags(u,pending);
      const days=queueData.approvalWaitDays(u.createdAt,now);
      const evidence=[['Selfie',u.verificationSelfie],['Front',u.idFileData],['Back',u.idBackData]];
      return `<tr class="approval-row" ${bindAction('click',()=>reviewApproval(u.id))}>
        <td data-label="Applicant"><div class="approval-applicant">
          ${u.profilePhoto?`<img src="${escapeHtml(u.profilePhoto)}" alt="" ${bindAction('error',(event,element)=>{element.outerHTML=`<span class="approval-applicant-avatar">${applicantInitials(u)}</span>`})}>`:`<span class="approval-applicant-avatar">${applicantInitials(u)}</span>`}
          <div><strong>${escapeHtml(u.lname)}, ${escapeHtml(u.fname)}</strong><small>${escapeHtml(u.email||u.username||'')}</small>${flags.length?`<div class="approval-flags">${flags.map(flagChip).join('')}</div>`:''}</div>
        </div></td>
        <td data-label="Type">${priorityBadge(u.personType||'Patient')}</td>
        <td data-label="College / Dept.">${escapeHtml(u.college||'—')}</td>
        <td data-label="ID No."><strong>${escapeHtml(u.idNo||'—')}</strong></td>
        <td data-label="Evidence"><div class="approval-evidence">${evidence.map(([label,value])=>`<span class="${value?'ok':'missing'}" title="${label} ${value?'submitted':'missing'}"><i class="bi ${value?'bi-check-circle-fill':'bi-x-circle'}" aria-hidden="true"></i>${label}</span>`).join('')}</div></td>
        <td data-label="Waiting"><span class="approval-wait ${days>=queueData.APPROVAL_OVERDUE_DAYS?'overdue':''}" title="Submitted ${u.createdAt?escapeHtml(fmtDateTime(u.createdAt)):'—'}">${queueData.approvalWaitLabel(u.createdAt,now)}</span></td>
        <td data-label="Actions"><div class="td-actions" ${bindAction('click',(event)=>event.stopPropagation())}><button class="btn btn-xs btn-primary" ${bindAction('click',()=>reviewApproval(u.id))}>Review</button></div></td>
      </tr>`;
    }).join('')
  }</tbody></table></div>${pagerHtml(page,renderApprovalTable)}`;
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

const REVIEW_CHECKS=[
  ['face','The face in the selfie matches the photo on the ID.'],
  ['name','The name on the ID matches the registration name.'],
  ['idno','The ID number on the card matches the one entered.'],
  ['document','Both photos show the same valid Student or Employee ID (not a COR).']
];

export function reviewApproval(id){
  const pending=pendingApplicants();
  const u=pending.find(x=>x.id===Number(id));
  if(!u)return;
  const queue=visibleApplicants();
  const index=queue.findIndex(x=>x.id===u.id);
  const prev=index>0?queue[index-1]:null,next=index>=0&&index<queue.length-1?queue[index+1]:null;
  const flags=queueData.approvalFlags(u,pending);
  const emailState=u.emailVerificationSkipped?'Temporarily skipped':u.emailConfirmedAt?'Confirmed':'Not yet confirmed';
  const submitted=u.createdAt?fmtDateTime(u.createdAt):'—';
  const idLabel=u.personType==='Student'?'Student ID No.':'Employee ID No.';
  const docLabel=u.verificationDocumentType||(u.personType==='Student'?'Student ID':'Employee ID');
  const evidence=(title,src,alt,openLabel,fileName,extra='')=>`<figure class="approval-preview-card ${extra}">
      <figcaption class="approval-preview-title">${escapeHtml(title)}</figcaption>
      <div class="approval-preview-body">${src
        ?`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" ${bindAction('click',()=>showFilePreview(fileName,src))}>`
        :`<span class="text-muted">Not submitted</span>`}</div>
      ${src?`<button class="btn btn-xs" ${bindAction('click',()=>showFilePreview(fileName,src))}><i class="bi bi-zoom-in" aria-hidden="true"></i> ${openLabel}</button>`:''}
    </figure>`;
  const name=`${u.fname} ${u.lname}`;

  openModal(`<div class="modal modal-xl approval-review-modal">
    <div class="modal-header">
      <div>
        <h3>Registration review</h3>
        <div class="text-muted">${[escapeHtml(name),u.createdAt&&`submitted ${escapeHtml(submitted)}`,u.createdAt&&`waiting ${escapeHtml(queueData.approvalWaitLabel(u.createdAt))}`,index>=0&&`${index+1} of ${queue.length}`].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button>
    </div>

    <div class="modal-body">
      ${flags.length?`<div class="approval-precheck" role="note"><strong><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> Pre-check notes</strong><ul>${flags.map(f=>`<li class="${f.tone}"><b>${escapeHtml(f.label)}.</b> ${escapeHtml(f.detail)}</li>`).join('')}</ul></div>`
        :'<div class="approval-precheck ok" role="note"><i class="bi bi-check-circle" aria-hidden="true"></i> Automatic pre-checks found nothing unusual. Still compare the evidence yourself.</div>'}

      <div class="approval-review-grid">
        <section class="approval-review-section" aria-labelledby="ap-evidence-title">
          <h4 id="ap-evidence-title">Identity evidence</h4>
          <div class="approval-compare">
            ${evidence('Selfie holding the ID',u.verificationSelfie,'Applicant holding their ID','Open Selfie',`${name} - Selfie`,'approval-selfie')}
            ${evidence(`${docLabel} — Front`,u.idFileData,'Submitted ID front','Open ID Front',u.idFile||'ID Front')}
            ${evidence(`${docLabel} — Back`,u.idBackData,'Submitted ID back','Open ID Back','ID Back')}
          </div>
        </section>

        <div style="display:grid;gap:.8rem;align-content:start">
          <section class="approval-review-section">
            <h4>Compare with the ID</h4>
            <div class="approval-data-grid approval-key-fields">
              ${approvalDataField('Full name',name,true)}
              ${approvalDataField(idLabel,u.idNo)}
              ${approvalDataField('Person type',u.personType)}
              ${approvalDataField(u.personType==='Non-Teaching Personnel'?'Department':'College',u.college)}
              ${approvalDataField('Date of birth',u.dob?fmtDate(u.dob):'')}
            </div>
          </section>
          <section class="approval-review-section">
            <h4>Account</h4>
            <div class="approval-data-grid">
              ${approvalDataField('Email',u.email,true)}
              ${approvalDataField('Email status',emailState)}
              ${approvalDataField('Username',u.username)}
              ${approvalDataField('Contact number',u.contact)}
              ${approvalDataField('Sex',u.sex)}
            </div>
          </section>
          <details class="approval-review-section approval-more">
            <summary>Health and emergency details</summary>
            <div class="approval-data-grid">
              ${approvalDataField('Address',u.address,true)}
              ${approvalDataField('Emergency contact',u.emergencyName)}
              ${approvalDataField('Emergency number',u.emergencyContact)}
              ${approvalDataField('Blood type',u.bloodType)}
              ${approvalDataField('Allergies',u.allergies)}
              ${approvalDataField('Medical history',u.medicalHistory,true)}
            </div>
          </details>
        </div>
      </div>

      <fieldset class="approval-checklist" id="ap-checklist">
        <legend>Before approving, confirm each point</legend>
        ${REVIEW_CHECKS.map(([key,label])=>`<label><input type="checkbox" data-check="${key}" ${bindAction('change',()=>syncApprovalChecklist())}> <span>${escapeHtml(label)}</span></label>`).join('')}
      </fieldset>
    </div>

    <div class="modal-footer approval-review-footer">
      <div class="approval-nav">
        <button class="btn btn-sm" ${prev?'':'disabled'} aria-label="Previous applicant" ${bindAction('click',()=>prev&&reviewApproval(prev.id))}>‹ Previous</button>
        <button class="btn btn-sm" ${next?'':'disabled'} aria-label="Next applicant" ${bindAction('click',()=>next&&reviewApproval(next.id))}>Next ›</button>
      </div>
      <div class="approval-decide">
        <button class="btn btn-danger" ${bindAction('click',()=>rejectUser(u.id))}>Reject…</button>
        <button class="btn btn-success" id="ap-approve" disabled title="Confirm every checklist point first" ${bindAction('click',()=>approveUser(u.id))}><i class="bi bi-check2-circle" aria-hidden="true"></i> Approve Registration</button>
      </div>
    </div>
  </div>`);
}

export function syncApprovalChecklist(){
  const boxes=[...document.querySelectorAll('#ap-checklist [data-check]')];
  const done=boxes.length&&boxes.every(box=>box.checked);
  const approve=document.getElementById('ap-approve');
  if(approve){approve.disabled=!done;approve.title=done?'':'Confirm every checklist point first';}
}

// After a decision, continue with the next applicant in the same filtered order.
async function continueQueue(decidedId){
  const order=visibleApplicants().map(u=>u.id);
  const position=order.indexOf(Number(decidedId));
  closeAllModals();
  await renderApprovals(true);
  await refreshTaskBadges(true);
  const remaining=visibleApplicants();
  if(!remaining.length)return;
  const nextId=order.slice(position+1).find(id=>remaining.some(u=>u.id===id))??remaining[0].id;
  reviewApproval(nextId);
}

export async function submitRealApprovalDecision(id,action,reason='',checks=[]){
  const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your approval-review session has expired.');
  const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/admin-approvals`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify({user_id:Number(id),action,reason,checks})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to update registration.');
  return result;
}

export async function approveUser(id){
  const u=pendingApplicants().find(x=>x.id===Number(id));
  if(!u)return;
  const checks=[...document.querySelectorAll('#ap-checklist [data-check]:checked')].map(box=>box.dataset.check);
  if(checks.length<REVIEW_CHECKS.length){toast('Confirm every checklist point before approving.','warning');return;}
  const button=document.getElementById('ap-approve');
  if(button){button.disabled=true;button.textContent='Approving…';}
  try{
    await submitRealApprovalDecision(id,'approve','',checks);
    toast(`${u.fname} ${u.lname} approved.${u.emailConfirmedAt||u.emailVerificationSkipped?' They can now sign in.':' They can sign in after confirming their email.'}`,'success');
    await continueQueue(id);
  }catch(e){
    toast(e?.message||'Approval failed.','error');
    if(button){button.disabled=false;button.innerHTML='<i class="bi bi-check2-circle" aria-hidden="true"></i> Approve Registration';}
  }
}

// A reason is required: the applicant receives it by email so they know what to fix before registering again.
export function rejectUser(id){
  const u=pendingApplicants().find(x=>x.id===Number(id));
  if(!u)return;
  openModal(`<div class="modal approval-reject-modal">
    <div class="modal-header"><h3>Reject registration</h3><button class="close-btn" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body">
      <p class="approval-reject-lead">Why can't <strong>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</strong> be approved? The reason is emailed to the applicant.</p>
      <fieldset class="approval-reasons" id="ap-reasons">
        <legend class="sr-only">Reason</legend>
        ${[...queueData.REJECTION_REASONS,'Other reason'].map((reason,i)=>`<label><input type="radio" name="ap-reason" value="${escapeHtml(reason)}" ${bindAction('change',()=>syncRejectForm())}> <span>${escapeHtml(reason)}</span></label>`).join('')}
      </fieldset>
      <div class="form-group"><label for="reject-reason-text">Note to the applicant <span class="text-muted" id="ap-note-hint">(optional)</span></label><textarea id="reject-reason-text" rows="2" maxlength="300" placeholder="e.g. Retake the photo of the back of your ID in better light." ${bindAction('input',()=>syncRejectForm())}></textarea></div>
      <p class="registration-field-error" id="ap-reason-error" aria-live="polite" hidden></p>
      <p class="form-note">The pending account and its photos are removed, so the applicant can register again with the same email and ID number.</p>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',()=>closeTopModal())}>Back to review</button>
      <button class="btn btn-danger" id="ap-reject-confirm" disabled ${bindAction('click',()=>confirmRejectUser(id))}>Reject registration</button>
    </div>
  </div>`,{preserveParent:true});
}

function rejectionReason(){
  const choice=document.querySelector('#ap-reasons input:checked')?.value||'';
  const note=(document.getElementById('reject-reason-text')?.value||'').trim();
  if(!choice)return {error:'Choose a reason.'};
  if(choice==='Other reason'&&note.length<10)return {error:'Describe the reason in at least 10 characters.'};
  return {reason:choice==='Other reason'?note:[choice,note].filter(Boolean).join(' ')};
}
export function syncRejectForm(){
  const result=rejectionReason();
  const other=document.querySelector('#ap-reasons input:checked')?.value==='Other reason';
  const hint=document.getElementById('ap-note-hint');if(hint)hint.textContent=other?'(required)':'(optional)';
  const confirm=document.getElementById('ap-reject-confirm');if(confirm)confirm.disabled=Boolean(result.error);
}

export async function confirmRejectUser(id){
  const u=pendingApplicants().find(x=>x.id===Number(id));
  if(!u)return;
  const result=rejectionReason();
  const error=document.getElementById('ap-reason-error');
  if(result.error){if(error){error.textContent=result.error;error.hidden=false;}return;}
  const button=document.getElementById('ap-reject-confirm');
  if(button){button.disabled=true;button.textContent='Rejecting…';}
  try{
    const response=await submitRealApprovalDecision(id,'reject',result.reason);
    toast(`${u.fname} ${u.lname}'s registration was rejected.${response.email_queued?' The reason was emailed to them.':''}`,'warning');
    await continueQueue(id);
  }catch(e){
    toast(e?.message||'Rejection failed.','error');
    if(button){button.disabled=false;button.textContent='Reject registration';}
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.approvalQueue.realPendingApprovals=[];
}
