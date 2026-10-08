// treatmentService: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {syncAppointmentContext,syncRealDoctorDirectory} from './appointmentService.js';
import {syncCurrentPatientFromSupabase} from './patientService.js';
import {createTreatmentService,treatmentData} from '../dependencies.js';
// Compatibility adapters retain treatment object identity and update application state.
export function treatmentRecords(){return treatmentData.treatmentRecords(appState.data.DB,appState.auth.currentUser);}
export function treatmentDisplayId(t){return treatmentData.treatmentDisplayId(t);}
export function realTreatmentToUi(t){return treatmentData.realTreatmentToUi(t);}
export function realDentalRecordToUi(r){return treatmentData.realDentalRecordToUi(r);}
export function treatmentService(){
  return createTreatmentService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY});
}
export async function treatmentAction(payload){return treatmentService().action(payload);}
export async function syncRealTreatments(){
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return treatmentRecords();
  const rows=await treatmentService().loadTreatments();
  if(appState.auth.currentUser!==account)return [];
  appState.data.DB.treatments=treatmentData.mergeTreatmentRecords(appState.data.DB.treatments||[],rows);
  return treatmentRecords();
}
export async function syncRealDentalRecords(){
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return [];
  const rows=await treatmentService().loadDentalRecords();
  if(appState.auth.currentUser!==account)return [];
  const map=treatmentData.indexDentalRecords(rows);
  for(const t of treatmentRecords()){
    if(t._realSupabase)t.dentalRecord=map.get(t.id)||null;
  }
  return [...map.values()];
}
export async function syncRealMedicationReminders(){
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return appState.data.DB.medReminders||[];
  const rows=await treatmentService().loadMedicationReminders();
  if(appState.auth.currentUser!==account)return [];
  appState.data.DB.medReminders=treatmentData.mergeMedicationReminders(appState.data.DB.medReminders||[],rows);
  return appState.data.DB.medReminders;
}

export async function syncTreatmentContext(){
  if(!appState.auth.currentUser?._realSupabase)return;

  if(['Administrator','Staff','Doctor'].includes(appState.auth.currentUser.role)){
    await syncAppointmentContext();
  }else if(appState.auth.currentUser.role==='Patient'){
    if(!appState.auth.currentPatient||!appState.auth.currentPatient._realSupabase)await syncCurrentPatientFromSupabase();
    await syncRealDoctorDirectory();
  }

  await Promise.all([
    syncRealTreatments(),
    syncRealMedicationReminders()
  ]);
  await syncRealDentalRecords();
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
