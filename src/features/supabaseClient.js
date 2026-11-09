// supabaseClient: imported feature APIs; state belongs to explicit application namespaces.
import {createClient} from '@supabase/supabase-js';
import {state as appState} from '../app/state.js';

// === CAMPUSCARE SUPABASE CLIENT ===
// Create one shared browser client used by login, registration, approvals, and session sync.

// Production redirect target for email confirmation and password recovery.

// "Remember me" keeps the session in localStorage; otherwise it lives only until the browser closes.
const REMEMBER_KEY='campuscare-remember-session';
export function rememberSessionPreference(){
  try{return localStorage.getItem(REMEMBER_KEY)!=='0';}catch{return true;}
}
// The checkbox starts ticked only for someone who chose it last time.
export function rememberSessionChosen(){
  try{return localStorage.getItem(REMEMBER_KEY)==='1';}catch{return false;}
}
export function setRememberSessionPreference(remember){
  try{localStorage.setItem(REMEMBER_KEY,remember?'1':'0');}catch{ /* Storage may be blocked in private modes. */ }
}
// "Remember me" also fills in the username or email on this device next time. Passwords are
// never stored by CampusCare; the browser's own password manager handles those.
const REMEMBERED_LOGIN_KEY='campuscare-remembered-login';
export function rememberedLogin(){
  try{return localStorage.getItem(REMEMBERED_LOGIN_KEY)||'';}catch{return '';}
}
export function setRememberedLogin(identifier){
  try{
    if(identifier)localStorage.setItem(REMEMBERED_LOGIN_KEY,String(identifier).slice(0,150));
    else localStorage.removeItem(REMEMBERED_LOGIN_KEY);
  }catch{ /* Storage may be blocked in private modes. */ }
}
const rememberAwareStorage={
  getItem(key){try{return sessionStorage.getItem(key)??localStorage.getItem(key);}catch{return null;}},
  setItem(key,value){
    try{
      const keep=rememberSessionPreference();
      (keep?localStorage:sessionStorage).setItem(key,value);
      (keep?sessionStorage:localStorage).removeItem(key);
    }catch{ /* Without storage the session simply is not persisted. */ }
  },
  removeItem(key){try{localStorage.removeItem(key);sessionStorage.removeItem(key);}catch{ /* Nothing stored. */ }}
};

export function initializeSupabaseClient(){
  if(appState.supabaseClient.supabaseClient) return appState.supabaseClient.supabaseClient;

  // The pinned SDK is bundled with the application instead of relying on a CDN global.
  appState.supabaseClient.supabaseClient = createClient(
    appState.supabaseClient.SUPABASE_URL,
    appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
    {
      auth:{
        persistSession:true,
        storage:rememberAwareStorage,
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
