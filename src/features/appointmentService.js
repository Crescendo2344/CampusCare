// appointmentService: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {viewAppt} from './appointmentDetails.js';
import {syncAdminDirectoryFromSupabase,syncCurrentPatientFromSupabase} from './patientService.js';
import {appointmentData,createAppointmentService} from '../dependencies.js';
// Page adapters own state updates and keep existing public handlers during migration.
export function appointmentDisplayId(a){return appointmentData.appointmentDisplayId(a);}
export function openAppointmentFromRow(id){viewAppt(Number(id));}
export function appointmentRecords(){return appointmentData.appointmentRecords(appState.data.DB,appState.auth.currentUser);}
export function realAppointmentToUi(a){return appointmentData.realAppointmentToUi(a,appState.data.DB);}
export function appointmentService(){
  return createAppointmentService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY});
}
export async function appointmentAction(payload){return appointmentService().action(payload);}
export async function syncRealDoctorDirectory(){
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return;
  if(['Administrator','Staff','Doctor'].includes(appState.auth.currentUser.role)){
    await syncAdminDirectoryFromSupabase();
    return;
  }
  if(appState.auth.currentUser!==account)return [];
  const doctors=await appointmentService().loadDoctorDirectory();
  if(appState.auth.currentUser!==account)return [];
  // Missing sessions previously left the directory unchanged.
  if(doctors===null)return;
  appState.data.DB.users=appointmentData.mergeDoctorDirectory(appState.data.DB.users||[],doctors);
}
export async function syncRealAppointments(){
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return [];
  const data=await appointmentService().load();
  if(appState.auth.currentUser!==account)return [];
  const snapshot=appointmentData.mergeAppointmentSnapshot(appState.data.DB,data);
  appState.data.DB.appointments=snapshot.appointments;
  appState.data.DB.settings.slotOverrides=snapshot.slotOverrides;
  appState.data.DB.doctorLeaves=snapshot.doctorLeaves;
  return appointmentRecords();
}

export async function syncAppointmentContext(){
  if(!appState.auth.currentUser?._realSupabase)return;
  if(['Administrator','Staff','Doctor'].includes(appState.auth.currentUser.role)){
    await syncAdminDirectoryFromSupabase();
  }else if(appState.auth.currentUser.role==='Patient'){
    if(!appState.auth.currentPatient||!appState.auth.currentPatient._realSupabase)await syncCurrentPatientFromSupabase();
    await syncRealDoctorDirectory();
  }
  await syncRealAppointments();
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
