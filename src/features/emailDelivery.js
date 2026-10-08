// emailDelivery: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {showConfirmDialog,toast} from './theme.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {auditLog} from './auditAndBackups.js';
import {loadDB,persistDB} from './persistence.js';
import {bindAction,createOperationalService} from '../dependencies.js';
// ================================================================
// OPERATIONAL EMAIL DELIVERY
// ================================================================
export async function emailDeliveryAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).emailDeliveryAction(payload);}

export async function syncEmailDeliveryStatus(){
  if(!appState.auth.currentUser?._realSupabase||appState.auth.currentUser.role!=='Administrator')return null;

  const result=await emailDeliveryAction({action:'list'});
  appState.data.DB.emailDeliveryStatus={
    configured:Boolean(result.configured),
    provider:result.provider||'Not configured',
    fromAddress:result.from_address||'',
    counts:result.counts||{pending:0,failed:0,sent:0},
    emails:(result.emails||[]).map(e=>({
      id:Number(e.email_id),
      userId:e.user_id?Number(e.user_id):null,
      notificationId:e.notification_id?Number(e.notification_id):null,
      recipient:e.recipient_email||'',
      subject:e.subject||'',
      template:e.template_key||'Operational',
      status:e.status||'Pending',
      attempts:Number(e.attempt_count||0),
      lastError:e.last_error||'',
      providerId:e.provider_message_id||'',
      scheduledAt:e.scheduled_at||'',
      sentAt:e.sent_at||'',
      createdAt:e.created_at||''
    }))
  };
  return appState.data.DB.emailDeliveryStatus;
}

export function emailStatusBadge(status){
  const cls=status==='Sent'?'badge-success':status==='Failed'?'badge-danger':status==='Sending'?'badge-info':'badge-warning';
  return `<span class="badge ${cls}">${escapeHtml(status||'Pending')}</span>`;
}

export function renderEmailQueueHtml(){
  const state=appState.data.DB.emailDeliveryStatus||{};
  const rows=state.emails||[];

  if(!rows.length){
    return '<div class="empty-state"><p>No operational emails are queued yet. New appointment, certificate, fitness, treatment, and inventory notifications will appear here automatically.</p></div>';
  }

  return `<div class="table-wrap"><table>
    <thead><tr><th>Created</th><th>Recipient</th><th>Template</th><th>Subject</th><th>Status</th><th>Attempts</th><th>Action</th></tr></thead>
    <tbody>${rows.slice(0,50).map(e=>`<tr>
      <td>${e.createdAt?new Date(e.createdAt).toLocaleString('en-PH'):'—'}</td>
      <td>${escapeHtml(e.recipient)}</td>
      <td><span class="badge badge-gray">${escapeHtml(e.template||'Operational')}</span></td>
      <td style="max-width:260px;white-space:normal">${escapeHtml(e.subject)}</td>
      <td>${emailStatusBadge(e.status)}${e.lastError?`<div class="text-danger" style="font-size:.68rem;max-width:260px;white-space:normal;margin-top:.25rem">${escapeHtml(e.lastError)}</div>`:''}</td>
      <td>${e.attempts}</td>
      <td>${e.status==='Failed'?`<button class="btn btn-xs" ${bindAction('click',(event,element)=>{retryOperationalEmail((e.id))})}>Retry</button>`:'—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

export function renderEmailDeliveryPanel(){
  const state=appState.data.DB.emailDeliveryStatus||{};
  const status=document.getElementById('email-provider-status');
  if(status){
    status.innerHTML=state.configured
      ? `<span class="badge badge-success">Configured</span> ${escapeHtml(state.provider||'Provider')} · ${escapeHtml(state.fromAddress||'')}`
      : `<span class="badge badge-warning">Provider setup required</span>`;
  }

  const counts=state.counts||{};
  const sent=document.getElementById('email-count-sent');
  const pending=document.getElementById('email-count-pending');
  const failed=document.getElementById('email-count-failed');
  if(sent)sent.textContent=String(counts.sent||0);
  if(pending)pending.textContent=String(counts.pending||0);
  if(failed)failed.textContent=String(counts.failed||0);

  const queue=document.getElementById('email-queue-list');
  if(queue)queue.innerHTML=renderEmailQueueHtml();
}

export async function dispatchOperationalEmails(){
  const btn=document.getElementById('email-dispatch-btn');
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Processing…';}

  try{
    const result=await emailDeliveryAction({action:'dispatch'});
    await syncEmailDeliveryStatus();
    renderEmailDeliveryPanel();

    if(!result.configured){
      toast('Emails are safely queued, but the external email provider is not configured yet.','warning',6500);
    }else{
      toast(`Email queue processed: ${Number(result.sent||0)} sent, ${Number(result.failed||0)} failed.`,'success');
    }
  }catch(e){
    toast(e?.message||'Unable to process the email queue.','error');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||'Process Queue Now';
    }
  }
}

export async function sendTestOperationalEmail(){
  const input=document.getElementById('email-test-recipient');
  const recipient=input?.value.trim()||appState.auth.currentUser?.email||'';
  if(!recipient||!recipient.includes('@')){
    toast('Enter a valid test recipient email address.','warning');
    return;
  }

  const btn=document.getElementById('email-test-btn');
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Testing…';}

  try{
    const result=await emailDeliveryAction({action:'test',recipient_email:recipient});
    await syncEmailDeliveryStatus();
    renderEmailDeliveryPanel();

    if(result.configured){
      toast(`Test email processed for ${recipient}.`,'success');
    }else{
      toast('Test email queued. Add the provider secrets in Supabase to enable external delivery.','warning',7000);
    }
  }catch(e){
    toast(e?.message||'Unable to queue the test email.','error');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||'Send Test';
    }
  }
}

export async function retryOperationalEmail(emailId){
  try{
    await emailDeliveryAction({action:'retry',email_id:Number(emailId)});
    const result=await emailDeliveryAction({action:'dispatch'});
    await syncEmailDeliveryStatus();
    renderEmailDeliveryPanel();

    if(result.configured)toast('Email retry processed.','success');
    else toast('Email returned to the queue and will send after provider setup.','warning');
  }catch(e){
    toast(e?.message||'Unable to retry the email.','error');
  }
}

export async function auditAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).auditAction(payload);}

export function auditDetailsText(details){
  if(details==null)return '';
  if(typeof details==='string')return details;
  try{
    return Object.entries(details)
      .map(([k,v])=>`${k.replace(/_/g,' ')}: ${typeof v==='object'?JSON.stringify(v):v}`)
      .join(' · ');
  }catch(_){
    return String(details);
  }
}

export async function syncRealActivityLogs(){
  if(!appState.auth.currentUser?._realSupabase||appState.auth.currentUser.role!=='Administrator')return [];

  await syncAdminDirectoryFromSupabase();

  const {data,error}=await appState.supabaseClient.supabaseClient
    .from('audit_logs')
    .select('audit_id,user_id,action,entity_type,entity_id,details,ip_address,user_agent,created_at')
    .order('created_at',{ascending:false})
    .limit(1000);

  if(error)throw error;

  appState.data.DB.activityLogs=(data||[]).map(row=>{
    const actor=(appState.data.DB.users||[]).find(u=>u._realSupabase&&Number(u.dbUserId)===Number(row.user_id));
    return {
      id:1000000+Number(row.audit_id),
      dbAuditId:Number(row.audit_id),
      timestamp:row.created_at,
      userId:actor?.id||null,
      dbUserId:row.user_id?Number(row.user_id):null,
      userName:actor?`${actor.fname} ${actor.lname}`:'System / Unknown',
      role:actor?.role||'System',
      action:row.action||'',
      details:auditDetailsText(row.details),
      rawDetails:row.details||{},
      targetType:row.entity_type||'',
      targetId:row.entity_id||null,
      ipAddress:row.ip_address||'',
      userAgent:row.user_agent||'',
      _realSupabase:true
    };
  });

  return appState.data.DB.activityLogs;
}

export async function renderActivityLog(){
  const c=document.getElementById('app-content');
  if(appState.auth.currentUser.role!=='Administrator'){
    c.innerHTML='<div class="alert alert-danger show">Administrator access required.</div>';
    return;
  }

  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncRealActivityLogs();}
    catch(e){
      if(!isCampusPageCurrent('activity-log',pageToken))return;
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load activity logs.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderActivityLog()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('activity-log',pageToken))return;
  }

  const roles=[...new Set((appState.data.DB.activityLogs||[]).map(x=>x.role))].filter(Boolean).sort();
  c.innerHTML=`<div class="card">
    <div class="card-header">
      <div>
        <h3>Activity &amp; Audit Log</h3>
        <div class="tech-note">Real server-side audit events for accountability, security review, and Data Privacy Act compliance.</div>
      </div>
      <button class="btn btn-sm" ${bindAction('click',(event,element)=>{exportActivityLog()})}>Export CSV</button>
    </div>

    <div class="audit-toolbar">
      <input id="audit-q" type="search" placeholder="Search user, action, details..." ${bindAction('input',(event,element)=>{renderActivityLogTable()})}>
      <select id="audit-role" ${bindAction('change',(event,element)=>{renderActivityLogTable()})}>
        <option value="">All roles</option>
        ${roles.map(r=>`<option>${escapeHtml(r)}</option>`).join('')}
      </select>
      <select id="audit-action" ${bindAction('change',(event,element)=>{renderActivityLogTable()})}>
        <option value="">All actions</option>
        ${[...new Set((appState.data.DB.activityLogs||[]).map(x=>x.action))].filter(Boolean).sort().map(a=>`<option>${escapeHtml(a)}</option>`).join('')}
      </select>
    </div>
    <div id="audit-table"></div>
  </div>`;
  renderActivityLogTable();
}

export function renderActivityLogTable(){
  const el=document.getElementById('audit-table');if(!el)return;

  const q=(document.getElementById('audit-q')?.value||'').toLowerCase();
  const role=document.getElementById('audit-role')?.value||'';
  const action=document.getElementById('audit-action')?.value||'';

  const rows=(appState.data.DB.activityLogs||[])
    .filter(x=>
      (!role||x.role===role)&&
      (!action||x.action===action)&&
      (!q||`${x.userName} ${x.action} ${x.details} ${x.targetType} ${x.targetId||''}`.toLowerCase().includes(q))
    )
    .slice(0,500);

  el.innerHTML=rows.length?`<div class="table-wrap"><table>
    <thead><tr><th>Date / Time</th><th>User</th><th>Role</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
    <tbody>${rows.map(x=>`<tr>
      <td>${new Date(x.timestamp).toLocaleString('en-PH')}</td>
      <td>${escapeHtml(x.userName)}</td>
      <td>${escapeHtml(x.role)}</td>
      <td><span class="badge badge-info">${escapeHtml(x.action)}</span></td>
      <td>${escapeHtml(x.targetType||'—')}${x.targetId!=null?` #${escapeHtml(String(x.targetId))}`:''}</td>
      <td style="max-width:360px;white-space:normal">${escapeHtml(x.details||'—')}</td>
      <td>${escapeHtml(x.ipAddress||'—')}</td>
    </tr>`).join('')}</tbody>
  </table></div>`:'<div class="empty-state"><p>No activity matches the selected filters.</p></div>';
}

export async function exportActivityLog(){
  const rows=[['Timestamp','User','Role','Action','Target Type','Target ID','Details','IP Address'],
    ...(appState.data.DB.activityLogs||[]).map(x=>[
      x.timestamp,x.userName,x.role,x.action,x.targetType||'',x.targetId??'',x.details||'',x.ipAddress||''
    ])];

  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.href=url;
  a.download=`CampusCare_Activity_Log_${appState.clinicInformation.TODAY}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);

  if(appState.auth.currentUser?._realSupabase){
    try{
      await auditAction({action:'record_export'});
      await syncRealActivityLogs();
      renderActivityLogTable();
    }catch(e){
      console.error('Audit export logging:',e);
    }
  }else{
    auditLog('AUDIT_LOG_EXPORTED','Administrator exported activity log.','Audit',null);
    persistDB();
  }

  toast('Activity log exported as CSV.','success');
}

export function resetDemoData(){
  showConfirmDialog({
    title:'Reset to Demo Data',
    message:'This erases every local change (accounts, appointments, records, inventory) and restores the original demo data. This cannot be undone. Continue?',
    confirmLabel:'Reset Everything',danger:true,
    onConfirm:()=>{
      localStorage.removeItem(appState.persistence.DB_STORAGE_KEY);
      sessionStorage.removeItem(appState.persistence.SESSION_KEY);
      location.reload();
    }
  });
}

// Bring older cached CampusCare builds forward to the current on-site
// clinic location/contact information without overwriting later manual edits.

/* Real deployments use the server-side scheduled backup. */

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  loadDB();
  (function migrateOfficialClinicInformation(){
  appState.data.DB.settings=appState.data.DB.settings||{};
  const oldAddresses=[
    'Corner M.J. Cuenco Ave. & R. Palma St., Cebu City, Philippines, 6000.',
    'Ground Floor, Administration Building, CTU Main Campus, Cebu City',
    'Ground Floor, Administration Building, M.J. Cuenco Ave. cor. R. Palma St., Cebu City'
  ];
  if(!appState.data.DB.settings.address||oldAddresses.includes(appState.data.DB.settings.address)){
    appState.data.DB.settings.address=appState.clinicInformation.CTU_CLINIC_INFO.address;
  }
  if(!appState.data.DB.settings.clinicName||appState.data.DB.settings.clinicName==='CampusCare'){
    appState.data.DB.settings.clinicName=appState.clinicInformation.CTU_CLINIC_INFO.name;
  }
  if(!appState.data.DB.settings.contactEmail||['campus.care@ctu.edu.ph','clinic@ctu.edu.ph'].includes(appState.data.DB.settings.contactEmail)){
    appState.data.DB.settings.contactEmail=appState.clinicInformation.CTU_CLINIC_INFO.email;
  }
  if(!appState.data.DB.settings.contactPhone){
    appState.data.DB.settings.contactPhone=appState.clinicInformation.CTU_CLINIC_INFO.phone;
  }
  persistDB();
})();
}
