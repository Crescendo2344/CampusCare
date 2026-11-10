// assistant: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {navTo} from './navigationRaceProtection.js';
import {notificationCenterAction,notificationPageFor,notificationRecords,notificationTone,updateNotifUI} from './notifications.js';
import {toast} from './theme.js';
import {bindAction,notificationData} from '../dependencies.js';
// ================================================================
// AI ASSISTANT — a built-in helper that answers from your live app
// data and can jump you to the right page. It's a rule-based/pattern-
// matching assistant (not a connected generative-AI model), which
// means it works fully offline and never sends your data anywhere.
// ================================================================









// Notification panel: All/Unread tabs, Today/Yesterday/Earlier sections, grouped repeats,
// relative times and a "show older" step, following common notification-centre behaviour.
const NOTIFICATION_PAGE_SIZE=15;
export function setNotificationFilter(filter){
  appState.assistant.notificationFilter=filter==='unread'?'unread':'all';
  appState.assistant.notificationLimit=NOTIFICATION_PAGE_SIZE;
  renderNotifList();
}

export function renderNotifList(){
  const list=document.getElementById('notif-list');
  if(!list||!appState.auth.currentUser)return;
  const filter=appState.assistant.notificationFilter||'all';
  const limit=appState.assistant.notificationLimit||NOTIFICATION_PAGE_SIZE;
  const mine=notificationRecords().filter(n=>n.userId===appState.auth.currentUser.id);
  const unreadCount=mine.filter(n=>!n.read).length;

  for(const [id,active] of [['notif-tab-all',filter==='all'],['notif-tab-unread',filter==='unread']]){
    const tab=document.getElementById(id);
    if(!tab)continue;
    tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));
  }
  const unreadTab=document.getElementById('notif-tab-unread');
  if(unreadTab)unreadTab.textContent=unreadCount?`Unread (${unreadCount>99?'99+':unreadCount})`:'Unread';
  const markAll=document.getElementById('notif-mark-all');
  if(markAll)markAll.disabled=!unreadCount;

  const sections=notificationData.groupNotifications(filter==='unread'?mine.filter(n=>!n.read):mine);
  if(!sections.length){
    list.innerHTML=`<div class="notif-empty"><i class="bi ${filter==='unread'?'bi-check2-circle':'bi-bell-slash'}" aria-hidden="true"></i><strong>${filter==='unread'?'You are all caught up':'No notifications yet'}</strong><span>${filter==='unread'?'New updates will appear here.':'Updates about your clinic activity will appear here.'}</span></div>`;
    return;
  }

  let shown=0,total=0;
  const html=sections.map(section=>{
    total+=section.groups.length;
    const groups=section.groups.slice(0,Math.max(0,limit-shown));
    shown+=groups.length;
    if(!groups.length)return '';
    return `<div class="notif-section">${section.name}</div>`+groups.map(group=>{
      const n=group.lead,extra=group.members.length-1;
      const tone=notificationTone(n),page=notificationPageFor(n);
      const ids=group.members.map(member=>member.id);
      const exact=n.createdAt?new Date(n.createdAt).toLocaleString('en-PH'):'';
      const expanded=expandedNotifs.has(n.id);
      // The toggle sits inside the item button as a role="button" span (real buttons cannot nest); it
      // stops the click so the item itself is not opened, and stays hidden until the body is clamped.
      return `<div class="notif-entry ${expanded?'expanded':''}">
      <button type="button" class="notif-item ${group.unread?'unread':''}" ${bindAction('click',()=>{readNotif(ids,page||null)})}>
        <span class="notif-icon ${tone}" aria-hidden="true"><i class="bi ${notificationData.notificationIcon(n)}"></i></span>
        <span class="notif-content">
          <span class="notif-item-title">${escapeHtml(n.title)}</span>
          <span class="notif-item-text">${escapeHtml(n.body)}</span>
          <span class="notif-meta">
            <span class="notif-item-time" title="${escapeHtml(exact)}">${escapeHtml(notificationData.relativeNotificationTime(n.createdAt))}${extra?` · +${extra} more`:''}</span>
            <span class="notif-expand" role="button" tabindex="0" hidden aria-expanded="${expanded}" ${bindAction('click',(event,el)=>{event.stopPropagation();toggleNotifExpanded(n.id,el)})} ${bindAction('keydown',(event,el)=>{if(event.key!=='Enter'&&event.key!==' ')return;event.preventDefault();event.stopPropagation();toggleNotifExpanded(n.id,el)})}>${expanded?'Show less':'Show more'}</span>
          </span>
        </span>
        ${group.unread?'<span class="notif-unread-dot" aria-label="Unread"></span>':''}
      </button>
      </div>`;
    }).join('');
  }).join('');
  const more=total>shown?`<button type="button" class="notif-more" ${bindAction('click',()=>{appState.assistant.notificationLimit=limit+NOTIFICATION_PAGE_SIZE;renderNotifList();})}>Show older notifications</button>`:'';
  list.innerHTML=html+more;
  markClampedNotifs(list);
}

// Notification ids the user expanded in place; survives the periodic re-render.
const expandedNotifs=new Set();

// Reveal the toggle only on entries whose body is cut off (or already expanded, so it can collapse).
function markClampedNotifs(list){
  for(const entry of list.querySelectorAll('.notif-entry')){
    const text=entry.querySelector('.notif-item-text'),toggle=entry.querySelector('.notif-expand');
    toggle.hidden=!entry.classList.contains('expanded')&&text.scrollHeight<=text.clientHeight+1;
  }
}

function toggleNotifExpanded(id,toggle){
  const entry=toggle.closest('.notif-entry');
  const expanded=!entry.classList.contains('expanded');
  if(expanded)expandedNotifs.add(id);else expandedNotifs.delete(id);
  entry.classList.toggle('expanded',expanded);
  toggle.setAttribute('aria-expanded',String(expanded));
  toggle.textContent=expanded?'Show less':'Show more';
}

// Opening a notification marks it (and any grouped repeats) read, then goes to its page.
export async function readNotif(ids,page=null){
  const wanted=new Set((Array.isArray(ids)?ids:[ids]).map(Number));
  const targets=notificationRecords().filter(x=>wanted.has(x.id)&&!x.read);
  await Promise.all(targets.map(async n=>{
    if(!n._realSupabase){n.read=true;return;}
    try{await notificationCenterAction({action:'read',notification_id:n.dbNotificationId});n.read=true;}
    catch(e){console.error('Read notification:',e);}
  }));

  document.getElementById('notif-panel')?.classList.remove('show');
  document.getElementById('notif-btn')?.setAttribute('aria-expanded','false');
  await updateNotifUI();
  if(page&&typeof navTo==='function')navTo(page);
}

export async function markAllRead(){
  if(!appState.auth.currentUser)return;

  if(appState.auth.currentUser._realSupabase){
    try{
      await notificationCenterAction({action:'read_all'});
      notificationRecords().filter(n=>n.userId===appState.auth.currentUser.id).forEach(n=>n.read=true);
    }catch(e){
      toast(e?.message||'Unable to mark notifications as read.','error');
      return;
    }
  }else{
    notificationRecords().filter(n=>n.userId===appState.auth.currentUser.id).forEach(n=>n.read=true);
  }

  await updateNotifUI();
}

export function toggleNotifPanel(){
  const p=document.getElementById('notif-panel');
  if(!p)return;
  const open=p.classList.toggle('show');
  document.getElementById('notif-btn')?.setAttribute('aria-expanded',String(open));
  if(open){appState.assistant.notificationLimit=NOTIFICATION_PAGE_SIZE;renderNotifList();updateNotifUI();}
}


// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.assistant.assistantHistory=[];
  appState.assistant.notificationFilter='all';
  appState.assistant.notificationLimit=NOTIFICATION_PAGE_SIZE;
  const closePanel=()=>{
    const p=document.getElementById('notif-panel');
    if(!p?.classList.contains('show'))return;
    p.classList.remove('show');
    document.getElementById('notif-btn')?.setAttribute('aria-expanded','false');
  };
  // Clicking elsewhere or pressing Escape closes the panel, as in other apps.
  document.addEventListener('click',e=>{
    const p=document.getElementById('notif-panel');
    const btn=document.getElementById('notif-btn');
    // The click path still includes the panel when a tab or "show older" re-renders its target.
    const path=e.composedPath?.()||[e.target];
    if(p&&btn&&!path.includes(p)&&!path.includes(btn))closePanel();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closePanel();});
}
