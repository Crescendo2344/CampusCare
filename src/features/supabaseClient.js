// supabaseClient: imported feature APIs; state belongs to explicit application namespaces.
import {createClient} from '@supabase/supabase-js';
import {state as appState} from '../app/state.js';

// === CAMPUSCARE SUPABASE CLIENT ===
// Create one shared browser client used by login, registration, approvals, and session sync.

// Production redirect target for email confirmation and password recovery.

export function initializeSupabaseClient(){
  if(appState.supabaseClient.supabaseClient) return appState.supabaseClient.supabaseClient;

  // The pinned SDK is bundled with the application instead of relying on a CDN global.
  appState.supabaseClient.supabaseClient = createClient(
    appState.supabaseClient.SUPABASE_URL,
    appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
    {
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true
      }
    }
  );
  return appState.supabaseClient.supabaseClient;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.supabaseClient.SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL || 'https://hgmvlklvobkqhyvjnzmx.supabase.co';
  appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_4R6yLx9j1l6M3JMlyjRITA_vEsSBGBu';
  appState.supabaseClient.CAMPUSCARE_APP_URL=import.meta.env.VITE_CAMPUSCARE_APP_URL || window.location.origin;
  appState.supabaseClient.supabaseClient=null;
  initializeSupabaseClient();
}
