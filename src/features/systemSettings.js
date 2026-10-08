import {createFeatureSyncService} from '../services/feature-sync.js';
// systemSettings: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {configureSessionGuard} from './sessionSecurity.js';
import {createOperationalService} from '../dependencies.js';
// ================================================================
// REAL SYSTEM SETTINGS
// ================================================================
export async function settingsAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).settingsAction(payload);}

export async function syncPublicSystemSettings(){
  return createFeatureSyncService({getState:()=>appState,callbacks:{configureSessionGuard}}).syncPublicSystemSettings();
}

export async function syncRealSystemSettings(){
  return createFeatureSyncService({getState:()=>appState,callbacks:{settingsAction}}).syncRealSystemSettings();
}

export async function saveRealSystemSettings(){
  const s=appState.data.DB.settings;
  const result=await settingsAction({
    action:'update',
    clinic_name:s.clinicName,
    address:s.address,
    contact_email:s.contactEmail,
    contact_number:s.contactPhone,
    semester_start:s.semesterStart||null,
    semester_end:s.semesterEnd||null,
    semester2_start:s.semester2Start||null,
    semester2_end:s.semester2End||null,
    dental_visit_limit_per_semester:Number(s.dentalLimitPerSemester||1),
    appointment_reminder_days:Number(s.appointmentReminderDays??1),
    privacy_policy_version:s.privacyPolicyVersion||'1.0',
    privacy_policy_updated:s.privacyPolicyUpdated||appState.clinicInformation.TODAY
  });

  if(result.settings)await syncRealSystemSettings();
  return result;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
