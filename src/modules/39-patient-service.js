// Adapters own state changes and keep the existing session/public handler names.
function normalizeSupabaseUser(profile){return patientData.normalizeSupabaseUser(profile);}
function ageFromBirthDate(date){return patientData.ageFromBirthDate(date);}
function directoryRowToPatient(row){return patientData.directoryRowToPatient(row);}
function patientDisplayId(pt){return patientData.patientDisplayId(pt);}
function patientMeasurementNumber(value){return patientData.patientMeasurementNumber(value);}
function patientService(){
  return createPatientService({getClient:()=>supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:SUPABASE_URL,publishableKey:SUPABASE_PUBLISHABLE_KEY});
}
async function patientAction(payload){return patientService().action(payload);}
async function fetchAdminDirectory(){
  if(!['Administrator','Staff','Doctor'].includes(currentUser?.role))return [];
  return patientService().loadClinicalDirectory();
}
async function syncAdminDirectoryFromSupabase(){
  if(!['Administrator','Staff','Doctor'].includes(currentUser?.role))return;
  const rows=await fetchAdminDirectory();
  Object.assign(DB,patientData.mergeClinicalDirectory(DB,rows));
  for(const row of rows){
    if(row.auth_user_id===currentUser.authUserId)Object.assign(currentUser,normalizeSupabaseUser(row));
  }
}
async function syncCurrentPatientFromSupabase(){
  if(currentUser?.role!=='Patient')return;
  try{
    const row=await patientService().loadCurrentPatient(currentUser.dbUserId);
    if(!row)return;
    const realPatient=patientData.currentPatientToUi(row,currentUser);
    DB.patients=(DB.patients||[]).filter(p=>!p._realSupabase||p.userId!==currentUser.id);
    DB.patients.push(realPatient);
    currentPatient=realPatient;
    if(currentUser.profilePhoto)currentPatient.profilePhoto=currentUser.profilePhoto;
  }catch(e){console.error('Patient sync:',e);}
}
