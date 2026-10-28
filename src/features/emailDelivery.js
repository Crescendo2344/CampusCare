// emailDelivery: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {showConfirmDialog,toast} from './theme.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {captureCampusPageToken,isCampusPageCurrent,navTo} from './navigationRaceProtection.js';
import {closeAllModals,openModal} from './modals.js';
import {AUDIT_CATEGORIES,auditCategory,auditDayLabel,auditDetailRows,auditSentence,auditStats,friendlyAuditAction,manilaDay,recordName,relativeTime} from '../domain/audit-events.js';
import {describeDevice} from '../domain/issue-queue.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {auditLog} from './auditAndBackups.js';
import {loadDB,persistDB} from './persistence.js';
import {bindAction,createOperationalService} from '../dependencies.js';
import {csvDate,csvFileName,csvTime,downloadCsv,toCsv} from '../shared/csv.js';
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

// The log reads as a timeline: who did what to which record, grouped by day, with details one click away.
const AUDIT_PAGES={appointments:'appointments',patients:'patients',treatments:'treatments',dental_records:'treatments',inventory_items:'inventory',inventory_transactions:'inventory',users:'users',workflow_requests:'users',doctor_leaves:'users',issue_reports:'feedback-issues',system_settings:'settings',audit_logs:'activity-log'};
const AUDIT_PAGE_SIZE=10;
const AUDIT_PERIODS=[['today','Today'],['24h','Last 24 hours'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['','All time'],['custom','Custom range']];
function auditUi(){
  const ui=appState.activityLog??={};
  ui.page??=1;ui.category??='';ui.period??='24h';ui.person??='';ui.role??='';ui.record??=null;
  return ui;
}
const categoryMeta=id=>AUDIT_CATEGORIES.find(([key])=>key===id)||AUDIT_CATEGORIES.at(-1);
const auditTime=value=>new Date(value).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'});
const auditDevice=x=>x.userAgent?describeDevice(x.userAgent):'';

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
        <button class="btn btn-sm" ${bindAction('click',()=>renderActivityLog())}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('activity-log',pageToken))return;
  }

  const ui=auditUi();
  ui.loadedAt=new Date();
  const logs=appState.data.DB.activityLogs||[];
  const stats=auditStats(logs);
  const people=[...new Map(logs.filter(x=>x.userName&&x.role!=='System').map(x=>[x.userName,x.role])).entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const roles=[...new Set(logs.map(x=>x.role))].filter(Boolean).sort();
  const stat=(label,value,sub='')=>`<div class="approval-stat"><span>${label}</span><strong>${value}</strong>${sub?`<small>${escapeHtml(sub)}</small>`:''}</div>`;
  c.innerHTML=`
    <div class="approval-summary audit-stats">
      ${stat('Events today',stats.today)}
      ${stat('Sign-ins in 24 hours',stats.signIns)}
      ${stat('Changes in 7 days',stats.changes)}
      ${stat('Most active this week',stats.mostActive?escapeHtml(stats.mostActive.name):'—',stats.mostActive?`${stats.mostActive.count} events`:'')}
    </div>
    <div class="card audit-card">
      <div class="card-header">
        <h3>Activity &amp; Audit Log</h3>
        <div class="audit-head-actions">
          <span class="text-muted" id="audit-updated">Updated ${escapeHtml(auditTime(ui.loadedAt))}</span>
          <button class="btn btn-sm" ${bindAction('click',()=>renderActivityLog())}><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Refresh</button>
          <button class="btn btn-sm" ${bindAction('click',()=>exportActivityLog())}><i class="bi bi-download" aria-hidden="true"></i> Export CSV</button>
        </div>
      </div>
      <div class="audit-chips" id="audit-chips" role="group" aria-label="Category"></div>
      <div class="audit-toolbar">
        <input id="audit-q" type="search" placeholder="Search people, actions, records or details" aria-label="Search the log" ${bindAction('input',()=>{ui.page=1;renderActivityLogTable();})}>
        <select id="audit-person" aria-label="Person" ${bindAction('change',(event,element)=>{ui.person=element.value;ui.page=1;renderActivityLogTable();})}>
          <option value="">Everyone</option>${people.map(([name,role])=>`<option value="${escapeHtml(name)}" ${ui.person===name?'selected':''}>${escapeHtml(name)} · ${escapeHtml(role)}</option>`).join('')}
        </select>
        <select id="audit-role" aria-label="Role" ${bindAction('change',(event,element)=>{ui.role=element.value;ui.page=1;renderActivityLogTable();})}>
          <option value="">All roles</option>${roles.map(r=>`<option ${ui.role===r?'selected':''}>${escapeHtml(r)}</option>`).join('')}
        </select>
        <select id="audit-period" aria-label="Period" ${bindAction('change',(event,element)=>{ui.period=element.value;ui.page=1;document.getElementById('audit-range').hidden=element.value!=='custom';renderActivityLogTable();})}>
          ${AUDIT_PERIODS.map(([v,l])=>`<option value="${v}" ${ui.period===v?'selected':''}>${l}</option>`).join('')}
        </select>
        <div class="audit-range" id="audit-range" ${ui.period==='custom'?'':'hidden'}>
          <input type="date" id="audit-from" aria-label="From" value="${ui.from||''}" max="${appState.clinicInformation.TODAY}" ${bindAction('change',(event,element)=>{ui.from=element.value;renderActivityLogTable();})}>
          <span>to</span>
          <input type="date" id="audit-to" aria-label="To" value="${ui.to||''}" max="${appState.clinicInformation.TODAY}" ${bindAction('change',(event,element)=>{ui.to=element.value;renderActivityLogTable();})}>
        </div>
      </div>
      <div id="audit-record-filter"></div>
      <p class="patient-filter-summary" id="audit-summary" role="status" aria-live="polite"></p>
      <div id="audit-table"></div>
    </div>`;
  renderActivityLogTable();
}

// "APPOINTMENT_CREATED" reads as "Appointment created".
export function friendlyAction(action=''){return friendlyAuditAction(action);}

function filteredActivity({ignoreCategory=false}={}){
  const ui=auditUi();
  const q=(document.getElementById('audit-q')?.value||'').trim().toLowerCase();
  const now=Date.now();
  const since=ui.period==='today'?new Date(manilaDay(new Date())+'T00:00:00+08:00').getTime():ui.period==='24h'?now-864e5:ui.period&&ui.period!=='custom'?now-Number(ui.period)*864e5:0;
  const from=ui.period==='custom'&&ui.from?ui.from:'',to=ui.period==='custom'&&ui.to?ui.to:'';
  return (appState.data.DB.activityLogs||[])
    .filter(x=>{
      if(ui.person&&x.userName!==ui.person)return false;
      if(ui.role&&x.role!==ui.role)return false;
      if(!ignoreCategory&&ui.category&&auditCategory(x.action,x.targetType)!==ui.category)return false;
      if(ui.record&&(x.targetType!==ui.record.type||String(x.targetId)!==String(ui.record.id)))return false;
      const t=new Date(x.timestamp).getTime();
      if(since&&t<since)return false;
      if(from&&manilaDay(x.timestamp)<from)return false;
      if(to&&manilaDay(x.timestamp)>to)return false;
      return !q||`${x.userName} ${x.role} ${x.action} ${friendlyAuditAction(x.action)} ${auditSentence(x)} ${x.details} ${x.targetType} ${x.targetId??''} ${x.ipAddress||''}`.toLowerCase().includes(q);
    })
    .sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
}

function renderAuditChips(){
  const host=document.getElementById('audit-chips');if(!host)return;
  const ui=auditUi(),base=filteredActivity({ignoreCategory:true});
  const counts=new Map();base.forEach(x=>{const k=auditCategory(x.action,x.targetType);counts.set(k,(counts.get(k)||0)+1);});
  const chip=(id,label,icon,n)=>`<button type="button" class="audit-chip ${ui.category===id?'active':''}" aria-pressed="${ui.category===id}" ${bindAction('click',()=>{ui.category=id;ui.page=1;renderActivityLogTable();})}>${icon?`<i class="bi ${icon}" aria-hidden="true"></i>`:''}${label}<span>${n}</span></button>`;
  host.innerHTML=chip('','All','',base.length)+AUDIT_CATEGORIES.map(([id,label,icon])=>chip(id,label,icon,counts.get(id)||0)).join('');
}

export function renderActivityLogTable(){
  const el=document.getElementById('audit-table');if(!el)return;
  const ui=auditUi();
  renderAuditChips();
  const recordHost=document.getElementById('audit-record-filter');
  if(recordHost)recordHost.innerHTML=ui.record?`<div class="audit-filter-pill"><i class="bi bi-funnel" aria-hidden="true"></i> Only ${escapeHtml(recordName(ui.record.type))} #${escapeHtml(String(ui.record.id))}<button type="button" aria-label="Remove record filter" ${bindAction('click',()=>{ui.record=null;renderActivityLogTable();})}>✕</button></div>`:'';
  const all=filteredActivity(),pages=Math.max(1,Math.ceil(all.length/AUDIT_PAGE_SIZE));
  ui.page=Math.min(Math.max(1,ui.page),pages);
  const first=(ui.page-1)*AUDIT_PAGE_SIZE,rows=all.slice(first,first+AUDIT_PAGE_SIZE);
  const summary=document.getElementById('audit-summary');
  if(summary)summary.textContent=`${all.length} event${all.length===1?'':'s'}`;
  if(!rows.length){el.innerHTML=`<div class="empty-state"><i class="bi bi-journal-x" aria-hidden="true" style="font-size:1.6rem"></i><p>No activity matches these filters${ui.period==='24h'?' in the last 24 hours':''}.</p></div>`;return;}
  el.innerHTML=`<div class="table-wrap"><table class="audit-table">
    <thead><tr><th scope="col">When</th><th scope="col">Person</th><th scope="col">What happened</th><th scope="col">Category</th><th scope="col">Device</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead>
    <tbody>${rows.map(x=>{
      const [cat,catLabel,icon]=categoryMeta(auditCategory(x.action,x.targetType));
      const ago=relativeTime(x.timestamp);
      return `<tr class="audit-row" tabindex="0" ${bindAction('click',()=>openAuditEntry(x.id))} ${bindAction('keydown',event=>{if(event.key==='Enter'){event.preventDefault();openAuditEntry(x.id);}})}>
        <td data-label="When"><time datetime="${escapeHtml(x.timestamp)}" title="${escapeHtml(new Date(x.timestamp).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}))}">${escapeHtml(auditDayLabel(x.timestamp)==='Today'?auditTime(x.timestamp):`${auditDayLabel(x.timestamp)}, ${auditTime(x.timestamp)}`)}</time>${ago?`<span class="text-muted">${escapeHtml(ago)}</span>`:''}</td>
        <td data-label="Person"><strong>${escapeHtml(x.userName)}</strong><span class="text-muted">${escapeHtml(x.role||'')}</span></td>
        <td data-label="What happened">${escapeHtml(auditSentence(x))}</td>
        <td data-label="Category"><span class="audit-cat ${cat}"><i class="bi ${icon}" aria-hidden="true"></i>${escapeHtml(catLabel)}</span></td>
        <td data-label="Device">${escapeHtml(auditDevice(x)||'—')}</td>
        <td class="audit-go-cell"><i class="bi bi-chevron-right" aria-hidden="true"></i></td>
      </tr>`;}).join('')}</tbody>
  </table></div>
  <div class="pt-pager"><span>Showing ${first+1}–${first+rows.length} of ${all.length}</span>${pages>1?`<div>
    <button class="btn btn-xs" ${ui.page===1?'disabled':''} ${bindAction('click',()=>{ui.page--;renderActivityLogTable();})}>‹ Previous</button>
    <span class="audit-page">Page ${ui.page} of ${pages}</span>
    <button class="btn btn-xs" ${ui.page===pages?'disabled':''} ${bindAction('click',()=>{ui.page++;renderActivityLogTable();})}>Next ›</button></div>`:''}</div>`;
}

export function openAuditEntry(id){
  const x=(appState.data.DB.activityLogs||[]).find(e=>e.id===id);if(!x)return;
  const ui=auditUi();
  const [cat,catLabel,icon]=categoryMeta(auditCategory(x.action,x.targetType));
  const rows=auditDetailRows(x.rawDetails&&typeof x.rawDetails==='object'&&Object.keys(x.rawDetails).length?x.rawDetails:x.details);
  const changes=rows.filter(r=>'before' in r),other=rows.filter(r=>!('before' in r));
  const page=AUDIT_PAGES[String(x.targetType||'').toLowerCase()];
  const raw=JSON.stringify({id:x.dbAuditId??x.id,action:x.action,record_type:x.targetType||null,record_id:x.targetId??null,user_id:x.dbUserId??x.userId??null,created_at:x.timestamp,ip_address:x.ipAddress||null,user_agent:x.userAgent||null,details:x.rawDetails||x.details||null},null,2);
  const when=new Date(x.timestamp);
  openModal(`<div class="modal modal-lg audit-entry">
    <div class="modal-header"><div class="audit-entry-head"><span class="audit-icon ${cat}"><i class="bi ${icon}" aria-hidden="true"></i></span><div><h3>${escapeHtml(x.userName)} ${escapeHtml(auditSentence(x))}</h3><span class="text-muted">${escapeHtml(catLabel)} · ${escapeHtml(friendlyAuditAction(x.action))}</span></div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body">
      <dl class="audit-facts">
        <div><dt>When</dt><dd>${escapeHtml(when.toLocaleString('en-PH',{dateStyle:'full',timeStyle:'medium',timeZone:'Asia/Manila'}))}<span>${escapeHtml(when.toISOString())} (UTC)</span></dd></div>
        <div><dt>Who</dt><dd>${escapeHtml(x.userName)}<span>${escapeHtml(x.role||'System')}</span></dd></div>
        <div><dt>Record</dt><dd>${escapeHtml(recordName(x.targetType))}${x.targetId!=null?` #${escapeHtml(String(x.targetId))}`:''}${page&&page!=='activity-log'?`<button type="button" class="btn btn-xs" ${bindAction('click',()=>{closeAllModals();navTo(page);})}>Open ${escapeHtml(recordName(x.targetType))}s</button>`:''}</dd></div>
        <div><dt>Action code</dt><dd><code>${escapeHtml(x.action)}</code></dd></div>
        ${x.ipAddress?`<div><dt>IP address</dt><dd>${escapeHtml(x.ipAddress)}</dd></div>`:''}
        ${x.userAgent?`<div><dt>Device</dt><dd>${escapeHtml(auditDevice(x))}<span>${escapeHtml(x.userAgent)}</span></dd></div>`:''}
      </dl>
      ${changes.length?`<h4 class="audit-section-title">Changes</h4><div class="table-wrap"><table class="audit-changes"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${changes.map(r=>`<tr><th scope="row">${escapeHtml(r.field)}</th><td><del>${escapeHtml(r.before)}</del></td><td><ins>${escapeHtml(r.after)}</ins></td></tr>`).join('')}</tbody></table></div>`:''}
      ${other.length?`<h4 class="audit-section-title">Details</h4><dl class="audit-details">${other.map(r=>`<div><dt>${escapeHtml(r.field)}</dt><dd>${escapeHtml(r.value)}</dd></div>`).join('')}</dl>`:''}
      <details class="audit-raw"><summary>Raw event</summary><pre>${escapeHtml(raw)}</pre><button type="button" class="btn btn-xs" ${bindAction('click',async()=>{try{await navigator.clipboard.writeText(raw);toast('Event copied.','success');}catch(_){toast('Copy is not available in this browser.','error');}})}><i class="bi bi-clipboard" aria-hidden="true"></i> Copy</button></details>
    </div>
    <div class="modal-footer audit-entry-actions">
      ${x.role!=='System'?`<button class="btn btn-sm" ${bindAction('click',()=>{ui.person=x.userName;ui.category='';ui.record=null;ui.period='';closeAllModals();renderActivityLog();})}><i class="bi bi-person" aria-hidden="true"></i> All activity by ${escapeHtml(x.userName)}</button>`:''}
      ${x.targetId!=null&&x.targetType?`<button class="btn btn-sm" ${bindAction('click',()=>{ui.record={type:x.targetType,id:x.targetId};ui.person='';ui.category='';ui.period='';closeAllModals();renderActivityLog();})}><i class="bi bi-clock-history" aria-hidden="true"></i> History of this ${escapeHtml(recordName(x.targetType))}</button>`:''}
    </div>
  </div>`);
}

// Exports what the filters show, with date and time (Philippine time) in their own columns.
export async function exportActivityLog(){
  const rows=[['Date','Time (PH)','Person','Role','Category','What happened','Action code','Record type','Record #','Details','IP address','Device'],
    ...filteredActivity().map(x=>[
      csvDate(x.timestamp),csvTime(x.timestamp),x.userName,x.role,categoryMeta(auditCategory(x.action,x.targetType))[1],
      `${x.userName} ${auditSentence(x)}`,x.action,recordName(x.targetType),x.targetId??'',x.details||'',x.ipAddress||'',auditDevice(x)
    ])];
  downloadCsv(csvFileName('activity log',appState.clinicInformation.TODAY),toCsv(rows));

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
