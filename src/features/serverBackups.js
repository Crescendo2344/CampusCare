// serverBackups: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {showConfirmDialog,toast} from './theme.js';
import {escapeHtml} from './issueReports.js';
import {downloadBackup,getDailyBackups,restoreBackup} from './auditAndBackups.js';
import {bindAction,createOperationalService,workflowData} from '../dependencies.js';
// ================================================================
// REAL AUTOMATED BACKUPS — SUPABASE DATABASE SNAPSHOTS
// ================================================================
export async function backupAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).backupAction(payload);}

export function formatBackupSize(bytes){return workflowData.formatBackupSize(bytes);}

export async function syncRealBackupStatus(){
  if(!appState.auth.currentUser?._realSupabase||appState.auth.currentUser.role!=='Administrator')return null;

  const result=await backupAction({action:'list'});
  appState.data.DB.realBackupLogs=(result.backups||[]).map(b=>({
    id:Number(b.backup_id),
    type:b.backup_type||'Backup',
    location:b.storage_location||'',
    status:b.status||'Unknown',
    startedAt:b.started_at||'',
    completedAt:b.completed_at||'',
    fileSize:Number(b.file_size||0),
    errorMessage:b.error_message||''
  }));
  appState.data.DB.realBackupRetentionDays=Number(result.retention_days||30);
  appState.data.DB.realBackupSchedule=result.schedule||null;
  return result;
}

export async function runRealBackupNow(){
  const btn=document.getElementById('backup-now-btn');
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Creating backup…';}

  try{
    await backupAction({action:'run'});
    await syncRealBackupStatus();
    toast('Manual database backup completed successfully.','success');
    if(document.getElementById('backup-list'))renderBackupPanel();
  }catch(e){
    toast(e?.message||'Unable to create the backup.','error');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||'Back Up Now';
    }
  }
}

export async function downloadServerBackup(backupId){
  try{
    const result=await backupAction({action:'download',backup_id:Number(backupId)});
    if(!result.url)throw new Error('Backup download link was not created.');

    // Open the short-lived signed URL. It expires automatically after 5 minutes.
    window.open(result.url,'_blank','noopener');
    toast('Secure backup download link created.','success');
    await syncRealBackupStatus();
    if(document.getElementById('backup-list'))renderBackupPanel();
  }catch(e){
    toast(e?.message||'Unable to download the backup.','error');
  }
}

export function changeBackupRetention(){
  const select=document.getElementById('backup-retention');
  if(!select)return;
  const days=parseInt(select.value,10)||30;

  showConfirmDialog({
    title:'Change Backup Retention',
    message:`Keep CampusCare database snapshots for <strong>${days} days</strong>? Older snapshots will be removed automatically.`,
    confirmLabel:'Update Retention',
    onConfirm:async()=>{
      try{
        await backupAction({action:'set_retention',days});
        appState.data.DB.realBackupRetentionDays=days;
        toast(`Backup retention updated to ${days} days.`,'success');
        await syncRealBackupStatus();
        renderBackupPanel();
      }catch(e){
        toast(e?.message||'Unable to update backup retention.','error');
      }
    }
  });
}

export function renderBackupListHtml(){
  if(appState.auth.currentUser?._realSupabase){
    const bs=appState.data.DB.realBackupLogs||[];
    if(!bs.length)return '<div class="empty-state"><p>No server backup has been created yet.</p></div>';

    return bs.map(b=>{
      const completed=b.completedAt?new Date(b.completedAt).toLocaleString('en-PH'):'—';
      const started=b.startedAt?new Date(b.startedAt).toLocaleString('en-PH'):'—';
      const statusClass=b.status==='Completed'?'badge-success':b.status==='Failed'?'badge-danger':'badge-warning';

      return `<div class="backup-row">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">
            <strong style="font-size:.82rem">${escapeHtml(b.type)}</strong>
            <span class="badge ${statusClass}">${escapeHtml(b.status)}</span>
          </div>
          <div class="text-muted">Backup #${b.id} · Started ${escapeHtml(started)}</div>
          <div class="text-muted">Completed ${escapeHtml(completed)} · ${formatBackupSize(b.fileSize)}</div>
          ${b.errorMessage?`<div class="text-danger" style="font-size:.72rem">${escapeHtml(b.errorMessage)}</div>`:''}
        </div>
        <div style="display:flex;gap:.35rem;flex-wrap:wrap">
          ${b.status==='Completed'?`<button class="btn btn-xs" ${bindAction('click',(event,element)=>{downloadServerBackup((b.id))})}>Download JSON</button>`:''}
        </div>
      </div>`;
    }).join('');
  }

  // Demo/local fallback.
  const bs=getDailyBackups();
  if(!bs.length)return '<div class="empty-state"><p>No local backup snapshot yet.</p></div>';
  return bs.map(b=>`<div class="backup-row">
    <div><strong style="font-size:.8rem">${escapeHtml(b.day)}</strong>
      <div class="text-muted">${new Date(b.createdAt).toLocaleString('en-PH')}</div>
    </div>
    <div style="display:flex;gap:.35rem">
      <button class="btn btn-xs" ${bindAction('click',(event,element)=>{downloadBackup((String(b.id)))})}>Download</button>
      <button class="btn btn-xs btn-warning" ${bindAction('click',(event,element)=>{restoreBackup((String(b.id)))})}>Restore</button>
    </div>
  </div>`).join('');
}

export function renderBackupPanel(){
  const list=document.getElementById('backup-list');
  if(list)list.innerHTML=renderBackupListHtml();

  const schedule=document.getElementById('backup-schedule-text');
  if(schedule){
    schedule.textContent=appState.auth.currentUser?._realSupabase
      ? 'Automatic database snapshot: every day at 2:00 AM (Asia/Manila)'
      : 'Local demo backup';
  }

  const retention=document.getElementById('backup-retention');
  if(retention&&appState.data.DB.realBackupRetentionDays){
    retention.value=String(appState.data.DB.realBackupRetentionDays);
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
