// ================================================================
// ACTIVITY LOGGING + LOCAL BACKUP FALLBACK (demo/offline only)
// ================================================================
const BACKUP_STORAGE_KEY='campuscare_daily_backups_v1';

function auditLog(action,details='',targetType='',targetId=null,userOverride=null){
  try{
    DB.activityLogs=Array.isArray(DB.activityLogs)?DB.activityLogs:[];
    DB.nextActivityLogId=DB.nextActivityLogId||1;
    const actor=userOverride||currentUser;
    DB.activityLogs.push({
      id:DB.nextActivityLogId++,timestamp:new Date().toISOString(),
      userId:actor?.id||null,userName:actor?`${actor.fname} ${actor.lname}`:'System / Guest',
      role:actor?.role||'Guest',action,details,targetType,targetId
    });
    if(DB.activityLogs.length>2000)DB.activityLogs=DB.activityLogs.slice(-2000);
  }catch(e){console.warn('Audit log failed',e);}
}

function getDailyBackups(){
  try{return JSON.parse(localStorage.getItem(BACKUP_STORAGE_KEY)||'[]');}catch(e){return[];}
}
function createDailyBackup(force=false){
  try{
    const backups=getDailyBackups();
    const day=new Date().toISOString().slice(0,10);
    if(!force&&backups.some(b=>b.day===day))return false;
    const snapshot=JSON.parse(JSON.stringify(DB));
    // Keep browser demo backups within storage limits.
    (snapshot.users||[]).forEach(u=>{if(u.idFileData&&u.idFileData.length>250000)u.idFileData='[large attachment omitted from local backup]';if(u.profilePhoto&&u.profilePhoto.length>250000)u.profilePhoto='[large photo omitted from local backup]';});
    const item={id:`backup-${Date.now()}`,day,createdAt:new Date().toISOString(),snapshot};
    backups.unshift(item);
    const retention=Math.max(1,Math.min(30,DB.settings?.backupRetentionDays||7));
    localStorage.setItem(BACKUP_STORAGE_KEY,JSON.stringify(backups.slice(0,retention)));
    if(force)auditLog('BACKUP_CREATED','Manual browser backup snapshot created.','System',null);
    return true;
  }catch(e){console.warn('Daily backup could not be created',e);return false;}
}
function runAutomatedDailyBackup(){createDailyBackup(false);}
function downloadBackup(id){
  const b=getDailyBackups().find(x=>x.id===id);if(!b)return;
  const blob=new Blob([JSON.stringify(b.snapshot,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`CampusCare_Backup_${b.day}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  auditLog('BACKUP_EXPORTED',`Backup ${b.day} downloaded.`,'System',null);persistDB();
}
function restoreBackup(id){
  const b=getDailyBackups().find(x=>x.id===id);if(!b)return;
  showConfirmDialog({title:'Restore Backup',message:`Restore the local CampusCare snapshot from <strong>${escapeHtml(b.day)}</strong>? Current browser data will be replaced.`,confirmLabel:'Restore',danger:true,onConfirm:()=>{
    localStorage.setItem(DB_STORAGE_KEY,JSON.stringify(b.snapshot));sessionStorage.removeItem(SESSION_KEY);location.reload();
  }});
}
