// notifications: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {renderNotifList} from './assistant.js';
import {applyNavBadges} from './topbarAndNavigation.js';
import {createNotificationService,notificationData} from '../dependencies.js';
// Existing UI handlers keep their names; this adapter owns notification state updates.
export function notificationRecords(){return notificationData.notificationRecords(appState.data.DB,appState.auth.currentUser);}
export function realNotificationToUi(n){return notificationData.realNotificationToUi(n,appState.auth.currentUser);}
export function notificationPageFor(n){return notificationData.notificationPageFor(n,appState.auth.currentUser);}
export function notificationTone(n){return notificationData.notificationTone(n);}
export function notificationService(){
  return createNotificationService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY});
}
export async function notificationCenterAction(payload){return notificationService().action(payload);}
export async function syncRealNotifications(){
  if(!appState.auth.currentUser?._realSupabase)return notificationRecords();
  const rows=await notificationService().load();
  appState.data.DB.notifications=notificationData.mergeNotificationRecords(appState.data.DB.notifications||[],rows,appState.auth.currentUser);
  return notificationRecords();
}

export function addNotif(userId,title,body,type='info'){
  // Legacy/demo fallback only. Real Supabase workflows create their
  // notifications on the server so they cannot be forged by the browser.
  if(appState.auth.currentUser?._realSupabase)return;
  appState.data.DB.notifications.push({id:appState.data.DB.nextNotifId++,userId,title,body,type,read:false,createdAt:new Date().toLocaleString()});
  if(appState.auth.currentUser&&appState.auth.currentUser.id===userId)updateNotifUI();
}

export async function updateNotifUI(){
  if(!appState.auth.currentUser)return;

  if(appState.auth.currentUser._realSupabase){
    try{await syncRealNotifications();}
    catch(e){console.error('Notification sync:',e);}
  }

  const unread=notificationData.unreadNotifications(notificationRecords(),appState.auth.currentUser);

  const count=document.getElementById('notif-count');
  if(count){
    if(unread.length>0){
      count.textContent=unread.length>99?'99+':String(unread.length);
      count.hidden=false;
      count.setAttribute('aria-label',`${unread.length} unread notification${unread.length===1?'':'s'}`);
    }else{
      count.textContent='';
      count.hidden=true;
      count.setAttribute('aria-label','No unread notifications');
    }
  }

  // The numeric badge replaces the old duplicate red dot.
  const dot=document.getElementById('notif-dot');
  if(dot)dot.style.display='none';

  renderNotifList();
  applyNavBadges();
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
