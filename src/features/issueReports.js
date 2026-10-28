import {createFeatureSyncService} from '../services/feature-sync.js';
// issueReports: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,healthResourceAction,healthResourceRecords,isCampusPageCurrent,renderHealthEducation,syncRealHealthResources} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {fmtDate,readFileAsDataURL,resizeImageDataUrl} from './inputValidation.js';
import {hideAlert,showAlert,showConfirmDialog,toast,toastWithUndo} from './theme.js';
import {addNotif,updateNotifUI} from './notifications.js';
import {persistDB} from './persistence.js';
import {closeAllModals,closeTopModal,openModal,showFilePreview} from './modals.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {getUserById} from './documentScanner.js';
import {userAvatarHtml} from './userManagement.js';
import {docName,fmtShortTime} from './messaging.js';
import {openCamera} from '../app/optional-features.js';
import {bindAction,workflowData} from '../dependencies.js';
import {ARTICLE_ICONS,articleIconName,biIcon} from '../ui/app-icons.js';
import {ISSUE_PRIORITIES,ISSUE_STATUSES,QUICK_REPLIES,awaitingReply,describeDevice,formatHours,isOpenIssue,queueStats,sortIssues} from '../domain/issue-queue.js';
// ================================================================
// REPORT AN ISSUE / FEEDBACK — REAL SUPABASE TRACKING
// ================================================================

export function issueReportRecords(){
  if(appState.auth.currentUser?._realSupabase)return (appState.data.DB.issueReports||[]).filter(r=>r._realSupabase);
  return appState.data.DB.issueReports||[];
}

export function issueDisplayId(r){return workflowData.issueDisplayId(r);}

export function issueTypeBadge(type){
  const map={Bug:'badge-danger',Suggestion:'badge-info',Feedback:'badge-purple'};
  return `<span class="badge ${map[type]||'badge-gray'}">${escapeHtml(type||'Report')}</span>`;
}

export function issueStatusBadge(status){
  const map={Open:'badge-warning','In Review':'badge-info',Resolved:'badge-success',Dismissed:'badge-gray'};
  return `<span class="badge ${map[status]||'badge-gray'}">${escapeHtml(status||'Open')}</span>`;
}

export function realIssueToUi(row,userMap,replyRows,screenshotUrl){return workflowData.realIssueToUi(row,userMap,replyRows,screenshotUrl);}

export async function syncRealIssueReports(){
  return createFeatureSyncService({getState:()=>appState,callbacks:{issueReportRecords,realIssueToUi}}).syncRealIssueReports();
}

// Reporters file a report and follow it as a conversation; administrators work the queue like a helpdesk.
const issueClient=()=>appState.supabaseClient.supabaseClient;
const PRIORITY_TONE={Urgent:'danger',High:'warning',Normal:'info',Low:'gray'};
export function issuePriorityBadge(priority){
  const p=priority||'Normal';
  return `<span class="fi-priority ${PRIORITY_TONE[p]||'info'}"><i class="bi ${p==='Urgent'?'bi-exclamation-octagon':p==='High'?'bi-arrow-up':p==='Low'?'bi-arrow-down':'bi-dash'}" aria-hidden="true"></i>${escapeHtml(p)}</span>`;
}
const issueSubject=r=>{const line=String(r.description||'').split('\n')[0].trim();return line.length>90?line.slice(0,88)+'…':line||'Untitled report';};
const ageLabel=date=>{const days=Math.floor((Date.now()-new Date(date).getTime())/864e5);return Number.isNaN(days)?'':days<1?'today':days===1?'1 day ago':`${days} days ago`;};
const when=date=>date?new Date(date).toLocaleString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const activeAdmins=()=>(appState.data.DB.users||[]).filter(u=>u.role==='Administrator'&&u.status==='Active'&&(!appState.auth.currentUser?._realSupabase||u._realSupabase));
const meAsAssignee=()=>({id:appState.auth.currentUser.id,db:Number(appState.auth.currentUser.dbUserId)||null});

export async function renderReportIssue(){
  const c=document.getElementById('app-content');if(!c)return;
  const pageToken=captureCampusPageToken();
  appState.issueReports.reportIssuePhotoData=null;

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncRealIssueReports();}
    catch(e){
      if(!isCampusPageCurrent('report-issue',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load your reports.')}</div>
        <button class="btn btn-sm" ${bindAction('click',()=>renderReportIssue())}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('report-issue',pageToken))return;
  }

  const myReports=issueReportRecords()
    .filter(r=>r.reporterId===appState.auth.currentUser.id)
    .sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
  const toConfirm=myReports.filter(r=>r.status==='Resolved'&&r.reporterRating==null);

  c.innerHTML=`
    <div class="fi-report-layout">
      <div class="card">
        <div class="card-header"><h3><i class="bi bi-chat-square-text" aria-hidden="true"></i> Report an issue or share feedback</h3></div>
        <div id="ri-msg"></div>
        <div class="form-group"><span class="form-label-text" id="ri-type-label">What kind of report?</span>
          <div class="fi-type-pick" role="radiogroup" aria-labelledby="ri-type-label">
            ${[['Bug','bi-bug','Something is broken'],['Suggestion','bi-lightbulb','An idea or improvement'],['Feedback','bi-chat-heart','General feedback']].map(([value,icon,label],i)=>`<label class="fi-type-choice"><input type="radio" name="ri-type" value="${value}" ${i===0?'checked':''}><span><i class="bi ${icon}" aria-hidden="true"></i><strong>${value}</strong><small>${label}</small></span></label>`).join('')}
          </div>
        </div>
        <div class="form-group"><label for="ri-page">Page or feature</label><input id="ri-page" maxlength="160" placeholder="e.g. Appointments, Messages"></div>
        <div class="form-group"><label for="ri-desc">What happened? <span class="required">*</span></label><textarea id="ri-desc" maxlength="6000" rows="5" placeholder="The first line becomes the title. Add the steps that led to it and what you expected instead."></textarea></div>
        <div class="form-group">
          <span class="form-label-text">Screenshot</span>
          <div class="upload-area" role="button" tabindex="0" ${bindAction('click',()=>document.getElementById('ri-photo-file').click())} ${bindAction('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('ri-photo-file').click();}})}>
            <input type="file" id="ri-photo-file" accept="image/jpeg,image/png,image/webp" style="display:none" ${bindAction('change',(event,element)=>handleReportPhotoChange(element))}>
            <i class="bi bi-image" aria-hidden="true" style="font-size:1.3rem;display:block;margin-bottom:.3rem"></i>
            <p>Attach a screenshot (JPG, PNG or WebP, up to 5 MB)</p>
          </div>
          <div id="ri-photo-preview" style="margin-top:.5rem"></div>
        </div>
        <label class="fi-check"><input type="checkbox" id="ri-device" checked> Include my browser and screen details</label>
        <div class="fi-form-actions"><button class="btn btn-primary" id="ri-submit-btn" ${bindAction('click',()=>submitIssueReport())}>Send report</button></div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Your reports</h3><span class="text-muted" style="font-size:.78rem">${myReports.length} total</span></div>
        ${toConfirm.length?`<div class="fi-confirm-banner"><i class="bi bi-patch-check" aria-hidden="true"></i><span>${toConfirm.length===1?'One of your reports was':`${toConfirm.length} of your reports were`} marked resolved. Open ${toConfirm.length===1?'it':'them'} to confirm the fix.</span></div>`:''}
        ${myReports.length?`<div class="fi-list">${myReports.map(r=>{
          const replies=(r.replies||[]).filter(rp=>!rp.internal).length;
          const confirm=r.status==='Resolved'&&r.reporterRating==null;
          return `<button type="button" class="fi-row fi-open" ${bindAction('click',()=>viewIssueThread(r.id))}>
            <span class="fi-main">
              <span class="fi-title"><strong>${escapeHtml(issueSubject(r))}</strong></span>
              <span class="text-muted">#${issueDisplayId(r)}${r.page?' · '+escapeHtml(r.page):''} · ${ageLabel(r.createdAt)}${replies?` · ${replies} repl${replies===1?'y':'ies'}`:''}</span>
            </span>
            <span class="fi-badges">${confirm?'<span class="tr-due today" style="margin:0">Confirm fix</span>':''}${issueTypeBadge(r.type)}${issueStatusBadge(r.status)}</span>
          </button>`;}).join('')}</div>`:'<div class="empty-state"><i class="bi bi-inbox" aria-hidden="true" style="font-size:1.6rem"></i><p>You haven\'t sent any reports yet.</p></div>'}
      </div>
    </div>`;
}

export async function handleReportPhotoChange(input){
  const file=input.files&&input.files[0];
  const preview=document.getElementById('ri-photo-preview');
  if(!file){
    appState.issueReports.reportIssuePhotoData=null;
    if(preview)preview.innerHTML='';
    return;
  }
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
    toast('Screenshot must be JPG, PNG, or WebP.','error');
    input.value='';
    return;
  }
  if(file.size>5*1024*1024){
    toast('Screenshot must be 5 MB or smaller.','error');
    input.value='';
    return;
  }

  try{
    const raw=await readFileAsDataURL(file);
    appState.issueReports.reportIssuePhotoData=await resizeImageDataUrl(raw,1200,0.82);
    if(preview)preview.innerHTML=`<div class="fi-shot-preview"><img src="${appState.issueReports.reportIssuePhotoData}" alt="Screenshot to attach"><button type="button" class="btn btn-xs" ${bindAction('click',()=>{appState.issueReports.reportIssuePhotoData=null;input.value='';preview.innerHTML='';})}>Remove</button></div>`;
  }catch(e){
    toast('Could not attach that photo. Please try again.','error');
  }
}

export async function submitIssueReport(){
  const type=document.querySelector('input[name="ri-type"]:checked')?.value||'Bug';
  const page=document.getElementById('ri-page').value.trim();
  const description=document.getElementById('ri-desc').value.trim();
  const deviceInfo=document.getElementById('ri-device')?.checked?describeDevice(navigator.userAgent,window.screen?.width,window.screen?.height):'';
  const msg=document.getElementById('ri-msg');
  const btn=document.getElementById('ri-submit-btn');

  hideAlert(msg);
  if(description.length<5){
    showAlert(msg,'Describe the issue, suggestion, or feedback before sending.');
    return;
  }

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Sending…';}

  let uploadedPath='';
  try{
    if(appState.auth.currentUser?._realSupabase){
      const dbUserId=Number(appState.auth.currentUser.dbUserId);
      if(!dbUserId)throw new Error('Your CampusCare user record could not be identified.');

      if(appState.issueReports.reportIssuePhotoData){
        const response=await fetch(appState.issueReports.reportIssuePhotoData);
        const blob=await response.blob();
        const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
        uploadedPath=`${dbUserId}/${crypto.randomUUID()}.${ext}`;

        const {error:uploadErr}=await issueClient().storage
          .from('campuscare-issue-screenshots')
          .upload(uploadedPath,blob,{contentType:blob.type,upsert:false});
        if(uploadErr)throw uploadErr;
      }

      const {error}=await issueClient().from('issue_reports').insert({
        reporter_id:dbUserId,
        issue_type:type,
        page_affected:page||null,
        description,
        screenshot_path:uploadedPath||null,
        device_info:deviceInfo||null,
        status:'Open'
      });
      if(error)throw error;

      await syncRealIssueReports();
      await updateNotifUI();
    }else{
      appState.data.DB.issueReports=appState.data.DB.issueReports||[];
      appState.data.DB.nextIssueId=appState.data.DB.nextIssueId||1;
      appState.data.DB.issueReports.push({
        id:appState.data.DB.nextIssueId++,reporterId:appState.auth.currentUser.id,
        reporterName:`${appState.auth.currentUser.fname} ${appState.auth.currentUser.lname}`,reporterRole:appState.auth.currentUser.role,
        type,page,description,deviceInfo,priority:'Normal',
        photo:appState.issueReports.reportIssuePhotoData,status:'Open',adminNote:'',replies:[],createdAt:new Date().toISOString()
      });
      appState.data.DB.users.filter(a=>a.role==='Administrator').forEach(a=>
        addNotif(a.id,`New ${type} Report`,`${appState.auth.currentUser.fname} ${appState.auth.currentUser.lname} submitted a ${type.toLowerCase()} report.`,'info')
      );
      persistDB();
    }

    await renderReportIssue();
    toast(`Thanks! Your ${type.toLowerCase()} report was sent. Replies will appear under Your reports.`,'success');
  }catch(e){
    if(uploadedPath){
      try{await issueClient().storage.from('campuscare-issue-screenshots').remove([uploadedPath]);}catch(_){}
    }
    showAlert(msg,e?.message||'Unable to send your report.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||'Send report';
    }
  }
}

function queueUi(){
  const ui=appState.issueReports.queue??={};
  ui.tab??='active';ui.order??='priority';ui.selected??=new Set();
  return ui;
}

export async function renderFeedbackIssues(){
  const c=document.getElementById('app-content');if(!c)return;
  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser.role!=='Administrator'){
    c.innerHTML='<div class="alert alert-danger show">Administrator access required.</div>';
    return;
  }

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{
      await Promise.all([syncAdminDirectoryFromSupabase(),syncRealIssueReports()]);
    }catch(e){
      if(!isCampusPageCurrent('feedback-issues',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load feedback and issue reports.')}</div>
        <button class="btn btn-sm" ${bindAction('click',()=>renderFeedbackIssues())}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('feedback-issues',pageToken))return;
  }

  const ui=queueUi();
  ui.selected.clear();
  const all=issueReportRecords();
  const stats=queueStats(all);
  const count=fn=>all.filter(fn).length;
  const tabs=[['active','Needs action',count(isOpenIssue)],['mine','Assigned to me',count(r=>isOpenIssue(r)&&r.assignedTo===appState.auth.currentUser.id)],['Open','Open',count(r=>r.status==='Open')],['In Review','In review',count(r=>r.status==='In Review')],['Resolved','Resolved',count(r=>r.status==='Resolved')],['Dismissed','Dismissed',count(r=>r.status==='Dismissed')],['all','All',all.length]];
  const stat=(label,value,tone='',hint='')=>`<div class="approval-stat ${tone}" ${hint?`title="${escapeHtml(hint)}"`:''}><span>${label}</span><strong>${value}</strong></div>`;
  c.innerHTML=`
    <div class="approval-summary fi-stats">
      ${stat('Waiting for your reply',stats.needsReply,stats.needsReply?'warn':'')}
      ${stat('Open reports',stats.open)}
      ${stat('Urgent or high',stats.urgent,stats.urgent?'danger':'')}
      ${stat('Resolved in 7 days',stats.resolvedThisWeek)}
      ${stat('Typical first reply',formatHours(stats.medianFirstResponse),'','Median time from a report to the first administrator reply')}
    </div>
    <div class="appt-head"><div class="appt-views" role="tablist" aria-label="Report status">${tabs.map(([id,label,n])=>`<button type="button" role="tab" class="appt-view ${ui.tab===id?'active':''} ${id==='active'&&n?'attention':''}" aria-selected="${ui.tab===id}" ${bindAction('click',()=>{ui.tab=id;renderFeedbackIssues();})}>${label}<span class="appt-view-count">${n}</span></button>`).join('')}</div></div>
    <div class="toolbar fi-toolbar">
      <input id="fi-search" type="search" placeholder="Search title, reporter, page or #" aria-label="Search reports" ${bindAction('input',()=>renderFeedbackIssuesList())}>
      <select id="fi-type" aria-label="Type" ${bindAction('change',()=>renderFeedbackIssuesList())}>
        <option value="">All types</option><option>Bug</option><option>Suggestion</option><option>Feedback</option>
      </select>
      <select id="fi-priority" aria-label="Priority" ${bindAction('change',()=>renderFeedbackIssuesList())}>
        <option value="">Any priority</option>${ISSUE_PRIORITIES.map(p=>`<option>${p}</option>`).join('')}
      </select>
      <select id="fi-assignee" aria-label="Assignee" ${bindAction('change',()=>renderFeedbackIssuesList())}>
        <option value="">Anyone</option><option value="unassigned">Unassigned</option>${activeAdmins().map(a=>`<option value="${a.id}">${escapeHtml(a.id===appState.auth.currentUser.id?'Me':`${a.fname} ${a.lname}`)}</option>`).join('')}
      </select>
      <select id="fi-order" aria-label="Order" ${bindAction('change',(event,element)=>{ui.order=element.value;renderFeedbackIssuesList();})}>
        ${[['priority','Priority first'],['waiting','Waiting longest'],['newest','Newest first'],['oldest','Oldest first']].map(([v,l])=>`<option value="${v}" ${ui.order===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="fi-bulk" id="fi-bulk" hidden></div>
    <p class="patient-filter-summary" id="fi-summary" role="status" aria-live="polite"></p>
    <div id="fi-list"></div>`;
  renderFeedbackIssuesList();
}

function visibleQueue(){
  const ui=queueUi();
  const q=(document.getElementById('fi-search')?.value||'').trim().toLowerCase();
  const type=document.getElementById('fi-type')?.value||'';
  const priority=document.getElementById('fi-priority')?.value||'';
  const assignee=document.getElementById('fi-assignee')?.value||'';
  let reports=issueReportRecords().filter(r=>ui.tab==='all'||(ui.tab==='active'?isOpenIssue(r):ui.tab==='mine'?isOpenIssue(r)&&r.assignedTo===appState.auth.currentUser.id:r.status===ui.tab));
  if(type)reports=reports.filter(r=>r.type===type);
  if(priority)reports=reports.filter(r=>(r.priority||'Normal')===priority);
  if(assignee)reports=reports.filter(r=>assignee==='unassigned'?!r.assignedTo:r.assignedTo===Number(assignee));
  if(q)reports=reports.filter(r=>`${r.reporterName||''} ${r.page||''} ${r.description||''} ${r.type||''} #${issueDisplayId(r)}`.toLowerCase().includes(q));
  return sortIssues(reports,ui.order);
}

export function renderFeedbackIssuesList(){
  const el=document.getElementById('fi-list');if(!el)return;
  const ui=queueUi();
  const reports=visibleQueue();
  const ids=new Set(reports.map(r=>r.id));
  for(const id of [...ui.selected])if(!ids.has(id))ui.selected.delete(id);
  const summary=document.getElementById('fi-summary');
  if(summary)summary.textContent=`${reports.length} report${reports.length===1?'':'s'} · ${reports.filter(awaitingReply).length} waiting for a reply`;
  renderBulkBar();
  if(!reports.length){
    el.innerHTML='<div class="empty-state"><i class="bi bi-inbox" aria-hidden="true" style="font-size:1.6rem"></i><p>No reports here.</p></div>';
    return;
  }
  const allChecked=reports.every(r=>ui.selected.has(r.id));
  el.innerHTML=`<div class="card fi-card"><div class="fi-list-head"><label class="fi-check"><input type="checkbox" ${allChecked?'checked':''} aria-label="Select all reports shown" ${bindAction('change',(event,element)=>{reports.forEach(r=>element.checked?ui.selected.add(r.id):ui.selected.delete(r.id));renderFeedbackIssuesList();})}> Select all</label></div><div class="fi-list">${reports.map(r=>{
    const user=getUserById(r.reporterId);
    const replyCount=(r.replies||[]).filter(rp=>!rp.internal).length;
    return `<div class="fi-row ${ui.selected.has(r.id)?'selected':''}">
      <input type="checkbox" class="fi-select" aria-label="Select report #${issueDisplayId(r)}" ${ui.selected.has(r.id)?'checked':''} ${bindAction('change',(event,element)=>{element.checked?ui.selected.add(r.id):ui.selected.delete(r.id);element.closest('.fi-row').classList.toggle('selected',element.checked);renderBulkBar();})}>
      <button type="button" class="fi-open" ${bindAction('click',()=>viewIssueThread(r.id))}>
        ${user?userAvatarHtml(user,32):'<div class="sb-avatar" style="width:32px;height:32px;font-size:.7rem">?</div>'}
        <span class="fi-main">
          <span class="fi-title"><strong>${escapeHtml(issueSubject(r))}</strong></span>
          <span class="text-muted">#${issueDisplayId(r)} · ${escapeHtml(r.reporterName||'CampusCare user')}${r.page?' · '+escapeHtml(r.page):''} · ${ageLabel(r.createdAt)}${replyCount?` · ${replyCount} repl${replyCount===1?'y':'ies'}`:''}${r.photo?' · <i class="bi bi-image" aria-label="has screenshot"></i>':''}</span>
        </span>
        <span class="fi-badges">${awaitingReply(r)?'<span class="tr-due today" style="margin:0">Awaiting reply</span>':''}${r.reporterRating===-1&&isOpenIssue(r)?'<span class="tr-due overdue" style="margin:0">Reopened</span>':''}${issuePriorityBadge(r.priority)}${issueTypeBadge(r.type)}${issueStatusBadge(r.status)}${r.assignedTo?`<span class="fi-assignee" title="Assigned to ${escapeHtml(r.assigneeName||'')}">${escapeHtml(initials(r.assigneeName||getUserName(r.assignedTo)))}</span>`:''}</span>
      </button>
    </div>`;
  }).join('')}</div></div>`;
}
const initials=name=>String(name||'').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';

function renderBulkBar(){
  const bar=document.getElementById('fi-bulk');if(!bar)return;
  const ui=queueUi(),n=ui.selected.size;
  bar.hidden=!n;
  if(!n){bar.innerHTML='';return;}
  bar.innerHTML=`<strong>${n} selected</strong>
    <button class="btn btn-xs" ${bindAction('click',()=>bulkUpdate({assign:'me'}))}><i class="bi bi-person-check" aria-hidden="true"></i> Assign to me</button>
    <select aria-label="Set priority for selected" ${bindAction('change',(event,element)=>{if(element.value)bulkUpdate({priority:element.value});})}><option value="">Set priority…</option>${ISSUE_PRIORITIES.map(p=>`<option>${p}</option>`).join('')}</select>
    <button class="btn btn-xs btn-success" ${bindAction('click',()=>bulkUpdate({status:'Resolved'}))}>Mark resolved</button>
    <button class="btn btn-xs btn-warning" ${bindAction('click',()=>bulkUpdate({status:'Dismissed'}))}>Dismiss</button>
    <button class="btn btn-xs" ${bindAction('click',()=>{ui.selected.clear();renderFeedbackIssuesList();})}>Clear</button>`;
}

// Apply a change to reports, then offer Undo that puts each one back as it was.
// change: {status, note, priority, assign:'me'|null|adminId}
async function saveIssueChange(reports,change){
  const now=new Date().toISOString();
  const me=meAsAssignee();
  const snapshot=reports.map(r=>({r,status:r.status,adminNote:r.adminNote||'',priority:r.priority||'Normal',assignedTo:r.assignedTo||null,dbAssignedTo:r.dbAssignedTo||null,resolvedAt:r.resolvedAt||null,resolvedBy:r.resolvedBy||null}));
  const assignee=change.assign==='me'?me:change.assign===undefined?undefined:change.assign===null?{id:null,db:null}:(()=>{const u=getUserById(Number(change.assign));return {id:u?.id||null,db:u?.dbUserId?Number(u.dbUserId):null};})();
  const closing=['Resolved','Dismissed'].includes(change.status);
  await writeIssues(reports,{
    ...(change.status?{status:change.status}:{}),
    ...(change.note!==undefined?{admin_note:change.note||null}:{}),
    ...(change.priority?{priority:change.priority}:{}),
    ...(assignee!==undefined?{assigned_to:assignee.db}:{}),
    ...(change.status?(closing?{resolved_by:me.db,resolved_at:now}:{resolved_by:null,resolved_at:null}):{})
  },r=>{
    if(change.status){r.status=change.status;r.resolvedAt=closing?now:'';r.resolvedBy=closing?me.id:null;}
    if(change.note!==undefined)r.adminNote=change.note;
    if(change.priority)r.priority=change.priority;
    if(assignee!==undefined){r.assignedTo=assignee.id;r.dbAssignedTo=assignee.db;}
  });
  return snapshot;
}

async function writeIssues(reports,dbPatch,applyLocal){
  const real=reports.filter(r=>r._realSupabase);
  if(real.length){
    const {error}=await issueClient().from('issue_reports')
      .update({...dbPatch,updated_at:new Date().toISOString()})
      .in('issue_id',real.map(r=>r.dbIssueId));
    if(error)throw error;
  }
  reports.filter(r=>!r._realSupabase).forEach(applyLocal);
  if(real.length){await syncRealIssueReports();await updateNotifUI();}
  else persistDB();
}

async function restoreIssues(snapshot){
  for(const s of snapshot){
    await writeIssues([s.r],{status:s.status,admin_note:s.adminNote||null,priority:s.priority,assigned_to:s.dbAssignedTo,resolved_at:s.resolvedAt||null,resolved_by:s.resolvedBy?Number(getUserById(s.resolvedBy)?.dbUserId)||null:null},r=>{
      Object.assign(r,{status:s.status,adminNote:s.adminNote,priority:s.priority,assignedTo:s.assignedTo,dbAssignedTo:s.dbAssignedTo,resolvedAt:s.resolvedAt,resolvedBy:s.resolvedBy});
    });
  }
}

const refreshIssueViews=id=>{
  if(document.getElementById('fi-list'))renderFeedbackIssuesList();
  if(id&&document.getElementById('issue-thread'))viewIssueThread(id);
};

async function bulkUpdate(change){
  const ui=queueUi();
  const reports=issueReportRecords().filter(r=>ui.selected.has(r.id));
  if(!reports.length)return;
  if(change.status){
    const verb=change.status==='Resolved'?'Mark':'Dismiss';
    showConfirmDialog({
      title:`${verb} ${reports.length} report${reports.length===1?'':'s'}`,
      message:`${change.status==='Resolved'?'Mark':'Dismiss'} ${reports.length} report${reports.length===1?'':'s'}${change.status==='Resolved'?' as resolved':''}? Each reporter is notified.`,
      confirmLabel:change.status==='Resolved'?'Mark resolved':'Dismiss',danger:change.status==='Dismissed',
      onConfirm:()=>runBulk(reports,change)
    });
    return;
  }
  await runBulk(reports,change);
}

async function runBulk(reports,change){
  const ui=queueUi();
  try{
    const snapshot=await saveIssueChange(reports,change);
    ui.selected.clear();
    refreshIssueViews();
    const what=change.status?(change.status==='Resolved'?'marked resolved':'dismissed'):change.priority?`set to ${change.priority}`:'assigned to you';
    toastWithUndo(`${reports.length} report${reports.length===1?'':'s'} ${what}.`,async()=>{await restoreIssues(snapshot);refreshIssueViews();},{undoneMessage:'Reports restored.'});
  }catch(e){toast(e?.message||'Unable to update the reports.','error');}
}

export function viewIssueThread(id){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const isAdmin=appState.auth.currentUser.role==='Administrator';
  const reporter=getUserById(r.reporterId);
  const replies=(r.replies||[]).filter(rp=>isAdmin||!rp.internal);
  const closed=['Resolved','Dismissed'].includes(r.status);
  const canReply=isAdmin||!closed;
  const others=isAdmin?issueReportRecords().filter(x=>x.reporterId===r.reporterId&&x.id!==r.id).length:0;
  const avatar=(u,size=30)=>u?userAvatarHtml(u,size):`<div class="sb-avatar" style="width:${size}px;height:${size}px;font-size:.68rem">?</div>`;

  const timeline=[
    ...replies.map(rp=>({at:rp.createdAt,html:`<div class="fi-msg ${rp.internal?'internal':rp.authorRole==='Administrator'?'staff':'reporter'}">
      ${avatar(getUserById(rp.authorId),28)}
      <div class="fi-msg-body">
        <div class="fi-msg-meta"><strong>${escapeHtml(rp.authorName||'CampusCare user')}</strong>${rp.authorRole==='Administrator'?'<span class="badge badge-gray">Admin</span>':''}${rp.internal?'<span class="fi-internal-tag"><i class="bi bi-lock" aria-hidden="true"></i> Internal note</span>':''}<time>${escapeHtml(when(rp.createdAt))}</time></div>
        <p>${escapeHtml(rp.body)}</p>
      </div>
    </div>`})),
    ...(closed&&r.resolvedAt?[{at:r.resolvedAt,html:`<div class="fi-event"><i class="bi ${r.status==='Resolved'?'bi-check2-circle':'bi-x-circle'}" aria-hidden="true"></i><span><strong>${r.status==='Resolved'?'Marked resolved':'Dismissed'}</strong>${r.resolvedByName?` by ${escapeHtml(r.resolvedByName)}`:''} · ${escapeHtml(when(r.resolvedAt))}${r.adminNote?`<br><span class="fi-event-note">${escapeHtml(r.adminNote)}</span>`:''}</span></div>`}]:[])
  ].sort((a,b)=>String(a.at).localeCompare(String(b.at)));

  const confirmBox=!isAdmin&&r.status==='Resolved'?(r.reporterRating==null?`<div class="fi-confirm" id="fi-confirm">
      <strong>Did this fix it?</strong>
      <div class="fi-confirm-actions"><button class="btn btn-sm btn-success" ${bindAction('click',()=>respondToResolution(r.id,true))}><i class="bi bi-hand-thumbs-up" aria-hidden="true"></i> Yes, it's fixed</button><button class="btn btn-sm" ${bindAction('click',()=>{document.getElementById('fi-reopen').hidden=false;document.getElementById('fi-reopen-text').focus();})}><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> No, still a problem</button></div>
      <div id="fi-reopen" hidden><textarea id="fi-reopen-text" rows="2" maxlength="3000" placeholder="What is still not working?"></textarea><button class="btn btn-sm btn-primary" ${bindAction('click',()=>respondToResolution(r.id,false))}>Reopen report</button></div>
    </div>`:`<div class="fi-event"><i class="bi ${r.reporterRating>0?'bi-hand-thumbs-up':'bi-arrow-counterclockwise'}" aria-hidden="true"></i><span>${r.reporterRating>0?'You confirmed the fix. Thank you!':'You reopened this report.'}</span></div>`):'';

  const composer=canReply?`<div class="fi-composer ${isAdmin?'admin':''}" id="fi-composer" data-mode="reply">
      ${isAdmin?`<div class="fi-composer-head">
        <div class="seg" role="tablist" aria-label="Message type">
          <button type="button" role="tab" class="active" aria-selected="true" data-mode="reply" ${bindAction('click',(event,element)=>setComposerMode(element,'reply'))}>Reply to reporter</button>
          <button type="button" role="tab" aria-selected="false" data-mode="internal" ${bindAction('click',(event,element)=>setComposerMode(element,'internal'))}><i class="bi bi-lock" aria-hidden="true"></i> Internal note</button>
        </div>
        <select aria-label="Insert a saved reply" ${bindAction('change',(event,element)=>{const reply=QUICK_REPLIES.find(([label])=>label===element.value);if(reply){const box=document.getElementById('issue-reply-text');box.value=(box.value?box.value.trimEnd()+'\n\n':'')+reply[1];box.focus();}element.value='';})}><option value="">Saved replies…</option>${QUICK_REPLIES.map(([label])=>`<option>${escapeHtml(label)}</option>`).join('')}</select>
      </div>`:''}
      <textarea id="issue-reply-text" maxlength="3000" rows="3" placeholder="${isAdmin?'Write a reply the reporter will see…':'Write a reply to the administrators…'}"></textarea>
      <div class="fi-composer-actions">
        ${isAdmin&&!closed?`<button class="btn btn-sm btn-success" id="issue-reply-resolve-btn" ${bindAction('click',()=>sendIssueReply(r.id,{resolve:true}))}>Send &amp; resolve</button>`:''}
        <button class="btn btn-sm btn-primary" id="issue-reply-btn" ${bindAction('click',()=>sendIssueReply(r.id))}>${isAdmin?'Send reply':'Send'}</button>
      </div>
    </div>`:'<div class="fi-event"><i class="bi bi-lock" aria-hidden="true"></i><span>This report is closed. Its history stays here for reference.</span></div>';

  const side=isAdmin?`<aside class="fi-side" aria-label="Report details">
      <div class="form-group"><label for="fi-status">Status</label><select id="fi-status" ${bindAction('change',(event,element)=>changeIssueStatus(r.id,element.value,element))}>${ISSUE_STATUSES.map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="form-group"><label for="fi-prio">Priority</label><select id="fi-prio" ${bindAction('change',(event,element)=>changeIssueField(r.id,{priority:element.value}))}>${ISSUE_PRIORITIES.map(p=>`<option ${(r.priority||'Normal')===p?'selected':''}>${p}</option>`).join('')}</select></div>
      <div class="form-group"><label for="fi-assign">Assignee</label><select id="fi-assign" ${bindAction('change',(event,element)=>changeIssueField(r.id,{assign:element.value?Number(element.value):null}))}><option value="">Unassigned</option>${activeAdmins().map(a=>`<option value="${a.id}" ${r.assignedTo===a.id?'selected':''}>${escapeHtml(a.id===appState.auth.currentUser.id?`${a.fname} ${a.lname} (me)`:`${a.fname} ${a.lname}`)}</option>`).join('')}</select></div>
      <dl class="fi-facts">
        <div><dt>Reporter</dt><dd>${escapeHtml(r.reporterName||'CampusCare user')}<span>${escapeHtml(r.reporterRole||'User')}${others?` · ${others} other report${others===1?'':'s'}`:''}</span></dd></div>
        <div><dt>Submitted</dt><dd>${escapeHtml(when(r.createdAt))}</dd></div>
        ${r.page?`<div><dt>Page</dt><dd>${escapeHtml(r.page)}</dd></div>`:''}
        ${r.deviceInfo?`<div><dt>Device</dt><dd>${escapeHtml(r.deviceInfo)}</dd></div>`:''}
        ${r.reporterRating!=null?`<div><dt>Reporter feedback</dt><dd>${r.reporterRating>0?'<i class="bi bi-hand-thumbs-up" aria-hidden="true"></i> Confirmed fixed':'<i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Said it was not fixed'}</dd></div>`:''}
      </dl>
    </aside>`:'';

  openModal(`<div class="modal ${isAdmin?'modal-xl':'modal-lg'} fi-thread-modal" id="issue-thread">
    <div class="modal-header"><div><div class="fi-head-meta">${issueTypeBadge(r.type)}<span>#${issueDisplayId(r)}</span>${issueStatusBadge(r.status)}${isAdmin?issuePriorityBadge(r.priority):''}</div><h3>${escapeHtml(issueSubject(r))}</h3></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <div class="fi-thread ${isAdmin?'with-side':''}">
        <div class="fi-convo">
          <div class="fi-msg reporter original">
            ${avatar(reporter,32)}
            <div class="fi-msg-body">
              <div class="fi-msg-meta"><strong>${escapeHtml(r.reporterName||'CampusCare user')}</strong><time>${escapeHtml(when(r.createdAt))}</time></div>
              <p>${escapeHtml(r.description)}</p>
              ${r.photo?`<button type="button" class="fi-shot" ${bindAction('click',()=>showFilePreview('Issue Screenshot',String(r.photo)))}><img src="${r.photo}" alt="Attached screenshot"></button>`:''}
              ${!isAdmin&&r.page?`<span class="fi-msg-foot">Page: ${escapeHtml(r.page)}</span>`:''}
            </div>
          </div>
          <div class="fi-timeline" id="issue-thread-replies">${timeline.map(x=>x.html).join('')||''}</div>
          ${confirmBox}
          ${composer}
        </div>
        ${side}
      </div>
    </div>
  </div>`);
}

function setComposerMode(button,mode){
  const box=document.getElementById('fi-composer');if(!box)return;
  box.dataset.mode=mode;
  box.querySelectorAll('.seg button').forEach(b=>{const on=b.dataset.mode===mode;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
  const text=document.getElementById('issue-reply-text');
  text.placeholder=mode==='internal'?'Only administrators see internal notes…':'Write a reply the reporter will see…';
  const send=document.getElementById('issue-reply-btn');if(send)send.textContent=mode==='internal'?'Add note':'Send reply';
  const resolve=document.getElementById('issue-reply-resolve-btn');if(resolve)resolve.hidden=mode==='internal';
  text.focus();
}

export async function sendIssueReply(id,{resolve=false}={}){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const input=document.getElementById('issue-reply-text');
  const body=input?.value.trim()||'';
  const internal=document.getElementById('fi-composer')?.dataset.mode==='internal';
  const btn=document.getElementById(resolve?'issue-reply-resolve-btn':'issue-reply-btn');
  if(!body){toast(internal?'Write the note first.':'Write a reply first.','error');return;}

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Sending…';}

  try{
    if(r._realSupabase){
      const {error}=await issueClient().from('issue_replies').insert({
        issue_id:r.dbIssueId,
        author_id:Number(appState.auth.currentUser.dbUserId),
        body,
        is_internal:internal
      });
      if(error)throw error;
      if(!resolve){await syncRealIssueReports();await updateNotifUI();}
    }else{
      r.replies=r.replies||[];
      r.replies.push({
        authorId:appState.auth.currentUser.id,
        authorName:docName(appState.auth.currentUser),
        authorRole:appState.auth.currentUser.role,
        body,internal,
        createdAt:new Date().toISOString()
      });
      if(!internal&&appState.auth.currentUser.role==='Administrator'&&r.status==='Open')r.status='In Review';
      persistDB();
    }

    if(resolve){
      const snapshot=await saveIssueChange([r],{status:'Resolved'});
      refreshIssueViews(id);
      toastWithUndo('Reply sent and report resolved.',async()=>{await restoreIssues(snapshot);refreshIssueViews(id);},{undoneMessage:'Report reopened. Your reply was kept.'});
      return;
    }
    toast(internal?'Internal note added.':'Reply sent.','success');
    refreshIssueViews(id);
  }catch(e){
    toast(e?.message||'Unable to send the reply.','error');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||'Send reply';
    }
  }
}

async function changeIssueField(id,change){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  try{
    await saveIssueChange([r],change);
    refreshIssueViews(id);
    toast(change.priority?`Priority set to ${change.priority}.`:change.assign?'Assignee updated.':'Report unassigned.','success');
  }catch(e){toast(e?.message||'Unable to update the report.','error');refreshIssueViews(id);}
}

function changeIssueStatus(id,status,select){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r||r.status===status)return;
  if(['Resolved','Dismissed'].includes(status)){
    select.value=r.status;
    openIssueDecisionModal(id,status);
    return;
  }
  (async()=>{
    try{
      const snapshot=await saveIssueChange([r],{status});
      refreshIssueViews(id);
      toastWithUndo(`Report set to ${status}.`,async()=>{await restoreIssues(snapshot);refreshIssueViews(id);},{undoneMessage:'Status restored.'});
    }catch(e){toast(e?.message||'Unable to update the report.','error');refreshIssueViews(id);}
  })();
}

// Reporter's answer to "Did this fix it?"; "No" reopens the report with their explanation.
async function respondToResolution(id,fixed){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const message=document.getElementById('fi-reopen-text')?.value.trim()||'';
  if(!fixed&&message.length<3){toast('Tell the administrators what is still wrong.','error');return;}
  try{
    if(r._realSupabase){
      const {error}=await issueClient().rpc('respond_to_issue_resolution',{p_issue_id:r.dbIssueId,p_fixed:fixed,p_message:fixed?null:message});
      if(error)throw error;
      await syncRealIssueReports();
    }else{
      r.reporterRating=fixed?1:-1;
      if(!fixed){
        r.status='Open';r.resolvedAt='';
        (r.replies||=[]).push({authorId:appState.auth.currentUser.id,authorName:docName(appState.auth.currentUser),authorRole:appState.auth.currentUser.role,body:message,createdAt:new Date().toISOString()});
      }
      persistDB();
    }
    toast(fixed?'Thanks for confirming!':'Report reopened. The administrators have been notified.','success');
    viewIssueThread(id);
    if(appState.navigationRaceProtection.campusActivePageId==='report-issue')renderReportIssue();
  }catch(e){toast(e?.message||'Unable to send your answer.','error');}
}

export function resolveIssueReport(id){
  openIssueDecisionModal(id,'Resolved');
}

export function dismissIssueReport(id){
  openIssueDecisionModal(id,'Dismissed');
}

export function openIssueDecisionModal(id,decision){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const isResolve=decision==='Resolved';

  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>${isResolve?'Mark as resolved':'Dismiss report'}</h3><button class="close-btn" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body">
      <p style="font-size:.87rem;margin-bottom:.7rem">${isResolve?'Mark this report as resolved?':'Dismiss this report?'} The reporter is notified${isResolve?' and asked to confirm the fix':''}.</p>
      <div class="form-group"><label for="issue-decision-note">Note for the reporter</label><textarea id="issue-decision-note" maxlength="3000" rows="2" placeholder="${isResolve?'e.g. Fixed in the latest update.':'e.g. This works as intended because…'}"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',()=>closeTopModal())}>Cancel</button>
      <button class="btn ${isResolve?'btn-success':'btn-danger'}" id="issue-decision-btn" ${bindAction('click',()=>confirmIssueDecision(id,String(decision)))}>${isResolve?'Mark resolved':'Dismiss'}</button>
    </div>
  </div>`,{preserveParent:true});
}

export async function confirmIssueDecision(id,decision){
  const r=issueReportRecords().find(x=>x.id===Number(id));if(!r)return;
  const note=document.getElementById('issue-decision-note')?.value.trim()||'';
  const btn=document.getElementById('issue-decision-btn');
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving…';}

  try{
    const snapshot=await saveIssueChange([r],{status:decision,note});
    closeTopModal();
    refreshIssueViews(id);
    toastWithUndo(decision==='Resolved'?'Marked as resolved.':'Report dismissed.',async()=>{await restoreIssues(snapshot);refreshIssueViews(id);},{undoneMessage:'Report reopened.'});
  }catch(e){
    toast(e?.message||'Unable to update the report.','error');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||(decision==='Resolved'?'Mark resolved':'Dismiss');
    }
  }
}

export function openArticleModal(id=null) {
  const art=id?healthResourceRecords().find(r=>r.id===Number(id)):null;
  appState.issueReports.articlePhotoData=null;
  appState.issueReports.articlePhotoRemove=false;
  appState.issueReports.articlePhotoExistingUrl=art?.photo||'';

  const existingCategories=[...new Set(healthResourceRecords().map(r=>r.category).filter(Boolean))].sort();

  openModal(`
    <div class="modal modal-lg">
      <div class="modal-header"><h3>${art?'Edit':'Add'} Health Article</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
      <div class="modal-body">
        <div id="art-msg"></div>

        <div class="form-group"><label>Title <span class="required">*</span></label><input id="art-title" maxlength="255" value="${art?escapeHtml(art.title):''}" placeholder="A clear, headline-style title"></div>

        <div class="form-row">
          <div class="form-group">
            <label>Category <span class="required">*</span></label>
            <input id="art-category" maxlength="120" list="art-category-list" value="${art?escapeHtml(art.category||''):''}" placeholder="Type or pick a category">
            <datalist id="art-category-list">${existingCategories.map(cat=>`<option value="${escapeHtml(cat)}">`).join('')}</datalist>
          </div>
          <div class="form-group"><span class="form-label-text" id="art-icon-label">Icon (used if no photo)</span>
            <div class="art-icon-grid" role="radiogroup" aria-labelledby="art-icon-label">${ARTICLE_ICONS.map(([name,label])=>`<label class="art-icon-choice" title="${label}"><input type="radio" name="art-icon" value="${name}" ${articleIconName(art?.icon)===name?'checked':''}><span>${biIcon(name)}<span class="sr-only">${label}</span></span></label>`).join('')}</div>
          </div>
        </div>

        <div class="form-group">
          <label>Banner Photo</label>
          <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
            <div id="art-photo-preview" style="width:120px;height:70px;border-radius:8px;overflow:hidden;background:var(--overlay);border:1px solid var(--glass-border-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              ${appState.issueReports.articlePhotoExistingUrl?`<img src="${appState.issueReports.articlePhotoExistingUrl}" style="width:100%;height:100%;object-fit:cover">`:'<span class="text-muted" style="font-size:.7rem">No photo</span>'}
            </div>
            <button type="button" class="btn btn-sm" ${bindAction('click',(event,element)=>{document.getElementById('art-photo-file').click()})}>Upload Photo</button>
            <button type="button" class="btn btn-sm btn-info" ${bindAction('click',(event,element)=>{openCamera('article')})}><i class="bi bi-camera" aria-hidden="true"></i> Use Camera</button>
            ${(appState.issueReports.articlePhotoExistingUrl||appState.issueReports.articlePhotoData)?`<button type="button" class="btn btn-sm btn-danger" ${bindAction('click',(event,element)=>{clearArticlePhoto()})}>Remove</button>`:''}
            <input type="file" id="art-photo-file" accept="image/jpeg,image/png,image/webp" style="display:none" ${bindAction('change',(event,element)=>{handleArticlePhotoChange(element)})}>
          </div>
        </div>

        <div class="form-group"><label>Teaser</label><input id="art-teaser" maxlength="1200" value="${art?escapeHtml(art.teaser||''):''}" placeholder="A short summary shown on the article card"></div>
        <div class="form-group"><label>Full Content <span class="required">*</span></label><textarea id="art-content" maxlength="20000" rows="8">${art?escapeHtml(art.content):''}</textarea></div>

        <div class="form-row">
          <div class="form-group"><label>Source Name (optional)</label><input id="art-source-name" maxlength="255" value="${art?escapeHtml(art.sourceName||''):''}" placeholder="e.g. WHO, DOH, U.S. CDC"></div>
          <div class="form-group"><label>Source URL (optional)</label><input id="art-source-url" maxlength="1500" value="${art?escapeHtml(art.sourceUrl||''):''}" placeholder="https://..."></div>
        </div>

        <div class="form-group"><label><input type="checkbox" id="art-published" ${art?(art.published?'checked':''):'checked'}> Publish immediately</label></div>
      </div>

      <div class="modal-footer">
        <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
        <button class="btn btn-primary" id="art-save-btn" ${bindAction('click',(event,element)=>{saveArticle((id||'null'))})}>Save Article</button>
      </div>
    </div>`);
}

export async function handleArticlePhotoChange(input){
  const file=input.files?.[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
    toast('Article photo must be JPG, PNG, or WebP.','error');
    return;
  }
  if(file.size>5*1024*1024){
    toast('Article photo must be 5 MB or smaller.','error');
    return;
  }

  try{
    const raw=await readFileAsDataURL(file);
    appState.issueReports.articlePhotoData=await resizeImageDataUrl(raw,1200,0.82);
    appState.issueReports.articlePhotoRemove=false;
    const preview=document.getElementById('art-photo-preview');
    if(preview)preview.innerHTML=`<img src="${appState.issueReports.articlePhotoData}" style="width:100%;height:100%;object-fit:cover">`;
  }catch(e){
    toast('Could not attach that photo. Please try again.','error');
  }
}

export function clearArticlePhoto(){
  appState.issueReports.articlePhotoData=null;
  appState.issueReports.articlePhotoExistingUrl='';
  appState.issueReports.articlePhotoRemove=true;
  const preview=document.getElementById('art-photo-preview');
  if(preview)preview.innerHTML='<span class="text-muted" style="font-size:.7rem">No photo</span>';
}

export async function saveArticle(id){
  const title=document.getElementById('art-title').value.trim();
  const category=document.getElementById('art-category').value.trim();
  const icon=document.querySelector('input[name="art-icon"]:checked')?.value||'bi-newspaper';
  const teaser=document.getElementById('art-teaser').value.trim();
  const content=document.getElementById('art-content').value.trim();
  const sourceName=document.getElementById('art-source-name').value.trim();
  let sourceUrl=document.getElementById('art-source-url').value.trim();
  const published=document.getElementById('art-published').checked;
  const msg=document.getElementById('art-msg');
  const btn=document.getElementById('art-save-btn');

  hideAlert(msg);
  if(!title||!content){showAlert(msg,'Title and content are required.');return;}
  if(!category){showAlert(msg,'Please enter a category.');return;}
  if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))sourceUrl='https://'+sourceUrl;

  const art=id?healthResourceRecords().find(r=>r.id===Number(id)):null;
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving securely…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      const result=await healthResourceAction({
        action:art?'update':'create',
        resource_id:art?.dbResourceId||null,
        title,category,icon,teaser,content,
        source_name:sourceName,
        source_url:sourceUrl,
        published,
        image_data_url:appState.issueReports.articlePhotoData||null,
        remove_image:appState.issueReports.articlePhotoRemove
      });

      await syncRealHealthResources();
    }else if(art){
      Object.assign(art,{
        title,category,icon,teaser,content,sourceName,sourceUrl,published,
        photo:appState.issueReports.articlePhotoRemove?'':(appState.issueReports.articlePhotoData||art.photo||'')
      });
      persistDB();
    }else{
      appState.data.DB.healthResources.push({
        id:appState.data.DB.nextResourceId++,
        title,category,icon,teaser,content,sourceName,sourceUrl,
        photo:appState.issueReports.articlePhotoData||'',
        authorId:appState.auth.currentUser.id,
        createdAt:appState.clinicInformation.TODAY,
        published
      });
      persistDB();
    }

    closeAllModals();
    toast(art?'Article updated.':'Article added.','success');
    await renderHealthEducation();
  }catch(e){
    showAlert(msg,e?.message||'Unable to save the article.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;btn.textContent=old||'Save Article';
    }
  }
}

// Helper to escape HTML (prevent XSS)
// Safely embed user-supplied text as a single-quoted JS string literal
// inside an onclick="..." HTML attribute (prevents both breaking out of
// the string and breaking out of the attribute).
export function jsAttrSafe(s){
  return String(s==null?'':s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\n/g,' ');
}

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
    return c;
  });
}
export function getUserName(id) {
  const u = appState.data.DB.users.find(u => u.id === id);
  return u ? `${u.fname} ${u.lname}` : 'System';
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.issueReports.reportIssuePhotoData=null;
  appState.issueReports.articlePhotoData=null;
  appState.issueReports.articlePhotoRemove=false;
  appState.issueReports.articlePhotoExistingUrl='';
}
