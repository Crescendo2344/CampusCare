

// === CAMPUSCARE SUPABASE CLIENT ===
// Create one shared browser client used by login, registration, approvals, and session sync.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hgmvlklvobkqhyvjnzmx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_4R6yLx9j1l6M3JMlyjRITA_vEsSBGBu';
// Production redirect target for email confirmation and password recovery.
const CAMPUSCARE_APP_URL = import.meta.env.VITE_CAMPUSCARE_APP_URL || window.location.origin;

let supabaseClient = null;

function initializeSupabaseClient(){
  if(supabaseClient) return supabaseClient;

  // supabase-js exposes createClient through window.supabase when loaded from the CDN.
  if(!window.supabase || typeof window.supabase.createClient !== 'function'){
    console.error('Supabase library failed to load.');
    return null;
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true
      }
    }
  );
  return supabaseClient;
}

initializeSupabaseClient();
