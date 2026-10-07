// ================================================================
// APP INIT
// ================================================================
function initApp(){
  /* Real deployments use the server-side scheduled backup. */
  applyDueScheduleChanges();
  configureSessionGuard(DB.settings?.sessionTimeoutMinutes||30);
  document.getElementById('auth-wrap').style.display='none';
  document.getElementById('app').classList.add('visible');
  document.getElementById('sb-name').textContent=`${currentUser.fname} ${currentUser.lname}`;
  document.getElementById('sb-email').textContent=currentUser.email;
  const initials=((currentUser.fname?.[0]||'')+(currentUser.lname?.[0]||'')).toUpperCase()||'U';
  const sbAvatarEl=document.getElementById('sb-avatar');
  if(sbAvatarEl){
    if(currentUser.profilePhoto){
      sbAvatarEl.innerHTML=`<img src="${escapeHtml(currentUser.profilePhoto)}"
        style="width:100%;height:100%;object-fit:cover;border-radius:50%"
        alt="${escapeHtml(currentUser.fname||'User')} profile photo"
        onerror="this.remove();this.parentElement.textContent='${initials}'">`;
    }else{
      sbAvatarEl.textContent=initials;
    }
  }
  const roleBadge=document.getElementById('sb-role-badge');
  roleBadge.textContent=currentUser.role;
  const rColors={Administrator:'badge-purple',Doctor:'badge-teal',Staff:'badge-warning',Patient:'badge-info'};
  roleBadge.className=`badge sb-role-badge ${rColors[currentUser.role]||'badge-gray'}`;
  updateTopDate();
  window.removeEventListener('resize',updateTopDate);
  window.addEventListener('resize',updateTopDate);
  buildNav();
  updateNotifUI();
  startTaskBadgeRefresh();
  const firstNav = NAV_CONFIG[currentUser.role]?.find(item => item.id);
  if(firstNav) navTo(firstNav.id);
}
