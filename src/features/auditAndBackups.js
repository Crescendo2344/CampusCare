// auditAndBackups: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {persistDB} from './persistence.js';
import {showConfirmDialog} from './theme.js';
import {escapeHtml} from './issueReports.js';
// ================================================================
// ACTIVITY LOGGING + LOCAL BACKUP FALLBACK (demo/offline only)
// ================================================================

export function auditLog(action,details='',targetType='',targetId=null,userOverride=null){
  try{
    appState.data.DB.activityLogs=Array.isArray(appState.data.DB.activityLogs)?appState.data.DB.activityLogs:[];
    appState.data.DB.nextActivityLogId=appState.data.DB.nextActivityLogId||1;
    const actor=userOverride||appState.auth.currentUser;
    appState.data.DB.activityLogs.push({
      id:appState.data.DB.nextActivityLogId++,timestamp:new Date().toISOString(),
      userId:actor?.id||null,userName:actor?`${actor.fname} ${actor.lname}`:'System / Guest',
      role:actor?.role||'Guest',action,details,targetType,targetId
    });
    if(appState.data.DB.activityLogs.length>2000)appState.data.DB.activityLogs=appState.data.DB.activityLogs.slice(-2000);
  }catch(e){console.warn('Audit log failed',e);}
}

export function getDailyBackups(){
  try{return JSON.parse(localStorage.getItem(appState.auditAndBackups.BACKUP_STORAGE_KEY)||'[]');}catch(e){return[];}
}
export function createDailyBackup(force=false){
  try{
    const backups=getDailyBackups();
    const day=new Date().toISOString().slice(0,10);
    if(!force&&backups.some(b=>b.day===day))return false;
    const snapshot=JSON.parse(JSON.stringify(appState.data.DB));
    // Keep browser demo backups within storage limits.
    (snapshot.users||[]).forEach(u=>{if(u.idFileData&&u.idFileData.length>250000)u.idFileData='[large attachment omitted from local backup]';if(u.profilePhoto&&u.profilePhoto.length>250000)u.profilePhoto='[large photo omitted from local backup]';});
    const item={id:`backup-${Date.now()}`,day,createdAt:new Date().toISOString(),snapshot};
    backups.unshift(item);
    const retention=Math.max(1,Math.min(30,appState.data.DB.settings?.backupRetentionDays||7));
    localStorage.setItem(appState.auditAndBackups.BACKUP_STORAGE_KEY,JSON.stringify(backups.slice(0,retention)));
    if(force)auditLog('BACKUP_CREATED','Manual browser backup snapshot created.','System',null);
    return true;
  }catch(e){console.warn('Daily backup could not be created',e);return false;}
}
export function runAutomatedDailyBackup(){createDailyBackup(false);}
export function downloadBackup(id){
  const b=getDailyBackups().find(x=>x.id===id);if(!b)return;
  const blob=new Blob([JSON.stringify(b.snapshot,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`CampusCare_Backup_${b.day}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  auditLog('BACKUP_EXPORTED',`Backup ${b.day} downloaded.`,'System',null);persistDB();
}
export function restoreBackup(id){
  const b=getDailyBackups().find(x=>x.id===id);if(!b)return;
  showConfirmDialog({title:'Restore Backup',message:`Restore the local CampusCare snapshot from <strong>${escapeHtml(b.day)}</strong>? Current browser data will be replaced.`,confirmLabel:'Restore',danger:true,onConfirm:()=>{
    localStorage.setItem(appState.persistence.DB_STORAGE_KEY,JSON.stringify(b.snapshot));sessionStorage.removeItem(appState.persistence.SESSION_KEY);location.reload();
  }});
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.auditAndBackups.BACKUP_STORAGE_KEY='campuscare_daily_backups_v1';
}
