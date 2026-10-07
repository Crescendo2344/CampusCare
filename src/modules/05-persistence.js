// ================================================================
// PERSISTENCE — keeps every change across page reloads/browser tabs
// so the demo behaves like a real, stateful application.
// ================================================================
const DB_STORAGE_KEY='campuscare_db_v1';
const SESSION_KEY='campuscare_session_v1';
function persistDB(){
  try{
    const copy=JSON.parse(JSON.stringify(DB));
    // Large PDF uploads (rare — most IDs are photographed as images and
    // already downsized) are dropped from storage so we stay well under
    // the localStorage quota; images are kept since they're compressed.
    (copy.users||[]).forEach(u=>{ if(u.idFileData&&u.idFileData.length>900000&&!u.idFileData.startsWith('data:image')) u.idFileData=undefined; });
    localStorage.setItem(DB_STORAGE_KEY,JSON.stringify(copy));
  }catch(e){ console.warn('CampusCare: could not save local data.',e); }
}
function loadDB(){
  try{
    const raw=localStorage.getItem(DB_STORAGE_KEY);
    if(!raw)return false;
    const saved=JSON.parse(raw);
    if(!saved||typeof saved!=='object')return false;
    const arrayKeys=['users','patients','appointments','treatments','inventory','certRequests','disbursements','messages','notifications','articles','doctorLeaves','nameChangeRequests','fitnessAssessments','activityLogs'];
    Object.keys(saved).forEach(k=>{
      // Guard against corrupted/incompatible cached data from an older
      // version of the app silently breaking everything on load.
      if(arrayKeys.includes(k)){
        if(Array.isArray(saved[k])) DB[k]=saved[k];
        return;
      }
      if(k==='settings'){
        if(saved[k]&&typeof saved[k]==='object') DB[k]=saved[k];
        return;
      }
      DB[k]=saved[k];
    });
    if(!Array.isArray(DB.users)||!DB.users.length){
      console.warn('CampusCare: cached data looked invalid, falling back to demo data.');
      return false;
    }
    return true;
  }catch(e){ console.warn('CampusCare: could not load local data.',e); return false; }
}
