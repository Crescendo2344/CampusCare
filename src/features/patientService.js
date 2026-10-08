// patientService: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {createPatientService,patientData} from '../dependencies.js';
// Adapters own state changes and keep the existing session/public handler names.
export function normalizeSupabaseUser(profile){return patientData.normalizeSupabaseUser(profile);}
export function ageFromBirthDate(date){return patientData.ageFromBirthDate(date);}
export function directoryRowToPatient(row){return patientData.directoryRowToPatient(row);}
export function patientDisplayId(pt){return patientData.patientDisplayId(pt);}
export function patientMeasurementNumber(value){return patientData.patientMeasurementNumber(value);}
export function patientService(){
  return createPatientService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY});
}
export async function patientAction(payload){return patientService().action(payload);}
export async function fetchAdminDirectory(){
  if(!['Administrator','Staff','Doctor'].includes(appState.auth.currentUser?.role))return [];
  return patientService().loadClinicalDirectory();
}
export async function syncAdminDirectoryFromSupabase(){
  const account=appState.auth.currentUser;
  if(!['Administrator','Staff','Doctor'].includes(appState.auth.currentUser?.role))return;
  const rows=await fetchAdminDirectory();
  if(appState.auth.currentUser!==account)return [];
  Object.assign(appState.data.DB,patientData.mergeClinicalDirectory(appState.data.DB,rows));
  for(const row of rows){
    if(row.auth_user_id===appState.auth.currentUser.authUserId)Object.assign(appState.auth.currentUser,normalizeSupabaseUser(row));
  }
}
export async function syncCurrentPatientFromSupabase(){
  const account=appState.auth.currentUser;
  if(appState.auth.currentUser?.role!=='Patient')return;
  try{
    const row=await patientService().loadCurrentPatient(appState.auth.currentUser.dbUserId);
    if(appState.auth.currentUser!==account)return [];
    if(!row)return;
    const realPatient=patientData.currentPatientToUi(row,appState.auth.currentUser);
    appState.data.DB.patients=(appState.data.DB.patients||[]).filter(p=>!p._realSupabase||p.userId!==appState.auth.currentUser.id);
    appState.data.DB.patients.push(realPatient);
    appState.auth.currentPatient=realPatient;
    if(appState.auth.currentUser.profilePhoto)appState.auth.currentPatient.profilePhoto=appState.auth.currentUser.profilePhoto;
  }catch(e){console.error('Patient sync:',e);}
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
