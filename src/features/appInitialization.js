// appInitialization: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {applyDueScheduleChanges} from './workflowRequests.js';
import {configureSessionGuard} from './sessionSecurity.js';
import {escapeHtml} from './issueReports.js';
import {buildNav,startTaskBadgeRefresh,updateTopDate} from './topbarAndNavigation.js';
import {updateNotifUI} from './notifications.js';
import {navTo} from './navigationRaceProtection.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// APP INIT
// ================================================================
export function initApp(){
  /* Real deployments use the server-side scheduled backup. */
  applyDueScheduleChanges();
  configureSessionGuard(appState.data.DB.settings?.sessionTimeoutMinutes||30);
  document.getElementById('auth-wrap').style.display='none';
  document.getElementById('app').classList.add('visible');
  document.getElementById('sb-name').textContent=`${appState.auth.currentUser.fname} ${appState.auth.currentUser.lname}`;
  document.getElementById('sb-email').textContent=appState.auth.currentUser.email;
  const initials=((appState.auth.currentUser.fname?.[0]||'')+(appState.auth.currentUser.lname?.[0]||'')).toUpperCase()||'U';
  const sbAvatarEl=document.getElementById('sb-avatar');
  if(sbAvatarEl){
    if(appState.auth.currentUser.profilePhoto){
      sbAvatarEl.innerHTML=`<img src="${escapeHtml(appState.auth.currentUser.profilePhoto)}"
        style="width:100%;height:100%;object-fit:cover;border-radius:50%"
        alt="${escapeHtml(appState.auth.currentUser.fname||'User')} profile photo"
        ${bindAction('error',(event,element)=>{element.remove();element.parentElement.textContent=(String(initials))})}>`;
    }else{
      sbAvatarEl.textContent=initials;
    }
  }
  const roleBadge=document.getElementById('sb-role-badge');
  roleBadge.textContent=appState.auth.currentUser.role;
  const rColors={Administrator:'badge-purple',Doctor:'badge-teal',Staff:'badge-warning',Patient:'badge-info'};
  roleBadge.className=`badge sb-role-badge ${rColors[appState.auth.currentUser.role]||'badge-gray'}`;
  updateTopDate();
  window.removeEventListener('resize',updateTopDate);
  window.addEventListener('resize',updateTopDate);
  buildNav();
  updateNotifUI();
  startTaskBadgeRefresh();
  const firstNav = appState.topbarAndNavigation.NAV_CONFIG[appState.auth.currentUser.role]?.find(item => item.id);
  if(firstNav) navTo(firstNav.id);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
