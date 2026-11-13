import {setLetterheadContact} from '../shared/ctu-letterhead.js';
import {createFeatureSyncService} from '../services/feature-sync.js';
// systemSettings: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {saveWarm} from '../services/warm-cache.js';
import {configureSessionGuard} from './sessionSecurity.js';
import {createOperationalService} from '../dependencies.js';
// ================================================================
// REAL SYSTEM SETTINGS
// ================================================================
export async function settingsAction(payload){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).settingsAction(payload);}

export async function syncPublicSystemSettings(){
  const settings=await createFeatureSyncService({getState:()=>appState,callbacks:{configureSessionGuard}}).syncPublicSystemSettings();
  setLetterheadContact(appState.data.DB.settings);
  if(appState.auth.currentUser?._realSupabase&&settings)saveWarm('settings',settings);
  return settings;
}

export async function syncRealSystemSettings(){
  const result=await createFeatureSyncService({getState:()=>appState,callbacks:{settingsAction}}).syncRealSystemSettings();
  setLetterheadContact(appState.data.DB.settings);
  return result;
}

export async function saveRealSystemSettings(s=appState.data.DB.settings,confirmed=false){
  const result=await settingsAction({
    action:'update',
    critical_confirmation:confirmed,
    academic_year:s.academicYear,
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
    booking_lead_hours:Number(s.bookingLeadHours??24),
    session_timeout_minutes:Number(s.sessionTimeoutMinutes??30),
    lunch_start:s.lunchBreakStart||'12:00',
    lunch_end:s.lunchBreakEnd||'13:00',
    schedule_change_notice_days:Number(s.scheduleChangeNoticeDays??3),
    privacy_policy_version:s.privacyPolicyVersion||'1.0',
    privacy_policy_updated:s.privacyPolicyUpdated||appState.clinicInformation.TODAY
  });

  if(result.settings)await syncRealSystemSettings();
  return result;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  setLetterheadContact(appState.data.DB?.settings||{});

}
