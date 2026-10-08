// topbarAndNavigation: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml,issueReportRecords} from './issueReports.js';
import {navTo} from './navigationRaceProtection.js';
import {notificationCenterAction,notificationPageFor,notificationRecords} from './notifications.js';
import {messageRecords} from './messaging.js';
import {certificateRecords} from './certificateService.js';
import {fitnessRecords} from './fitnessAssessments.js';
import {inventoryRecords} from './inventoryService.js';
import {workflowRequestRecords} from './workflowRequests.js';
import {renderNotifList} from './assistant.js';
import {shouldShowNavItem} from './dentalSurvey.js';
import {bindAction,createOperationalService,notificationData} from '../dependencies.js';
// ================================================================
// TOP BAR — responsive date + role-aware navigation search
// ================================================================
export function updateTopDate(){
  const el=document.getElementById('top-date');
  if(!el)return;
  const now=new Date();
  // Mobile uses a short date (9/12/26) to preserve space for search.
  // Desktop keeps the full date for readability.
  el.textContent=window.innerWidth<=768
    ? now.toLocaleDateString('en-PH',{month:'numeric',day:'numeric',year:'2-digit'})
    : now.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
}

export function getTopSearchItems(){
  if(!appState.auth.currentUser)return[];
  return (appState.topbarAndNavigation.NAV_CONFIG[appState.auth.currentUser.role]||[])
    .filter(x=>x.id)
    .map(x=>({
      id:x.id,
      label:String(x.label||x.id).replace(/&amp;/g,'&'),
      aliases:appState.topbarAndNavigation.TOP_SEARCH_ALIASES[x.id]||[]
    }));
}

export function renderTopSearch(raw=''){
  const box=document.getElementById('top-search-results');
  if(!box)return;
  const q=String(raw||'').trim().toLowerCase();
  appState.topbarAndNavigation.topSearchIndex=-1;
  // Keep results hidden until the user actually types something.
  if(!q){box.innerHTML='';box.classList.remove('show');return;}

  const items=getTopSearchItems().filter(item=>{
    const hay=[item.label,item.id,...item.aliases].join(' ').toLowerCase();
    return hay.includes(q);
  }).slice(0,8);

  box.innerHTML=items.length
    ?items.map((item,i)=>`<button type="button" class="top-search-item" data-search-index="${i}" ${bindAction('click',(event,element)=>{openTopSearchResult((String(item.id)))})}>
        <i class="bi bi-search" aria-hidden="true"></i>
        <span><strong>${escapeHtml(item.label)}</strong><small>Open ${escapeHtml(item.label)}</small></span>
      </button>`).join('')
    :'<div class="text-muted" style="padding:.7rem .8rem">No matching page found.</div>';
  box.classList.add('show');
}

export function openTopSearchResult(id){
  const input=document.getElementById('top-search-input');
  const box=document.getElementById('top-search-results');
  if(input)input.value='';
  if(box){box.innerHTML='';box.classList.remove('show');}
  navTo(id);
}

export function handleTopSearchKey(e){
  const box=document.getElementById('top-search-results');
  if(!box||!box.classList.contains('show'))return;
  const items=[...box.querySelectorAll('.top-search-item')];
  if(!items.length)return;

  if(e.key==='ArrowDown'){
    e.preventDefault();
    appState.topbarAndNavigation.topSearchIndex=(appState.topbarAndNavigation.topSearchIndex+1)%items.length;
  }else if(e.key==='ArrowUp'){
    e.preventDefault();
    appState.topbarAndNavigation.topSearchIndex=(appState.topbarAndNavigation.topSearchIndex-1+items.length)%items.length;
  }else if(e.key==='Enter'){
    if(appState.topbarAndNavigation.topSearchIndex>=0&&items[appState.topbarAndNavigation.topSearchIndex]){
      e.preventDefault();items[appState.topbarAndNavigation.topSearchIndex].click();
    }
    return;
  }else if(e.key==='Escape'){
    box.classList.remove('show');return;
  }else return;

  items.forEach((el,i)=>el.classList.toggle('active',i===appState.topbarAndNavigation.topSearchIndex));
  items[appState.topbarAndNavigation.topSearchIndex]?.scrollIntoView({block:'nearest'});
}

// Close search results when clicking anywhere outside the search control.

export function taskBadgeSeenKey(){
  if(!appState.auth.currentUser)return 'campuscare-task-seen-anon';
  const uid=appState.auth.currentUser.dbUserId||appState.auth.currentUser.id||appState.auth.currentUser.email||'user';
  return `campuscare-task-seen-${uid}`;
}

export function loadTaskBadgeSeen(){
  try{
    const parsed=JSON.parse(localStorage.getItem(taskBadgeSeenKey())||'{}');
    appState.topbarAndNavigation.navTaskSeen=parsed&&typeof parsed==='object'?parsed:{};
  }catch(_){
    appState.topbarAndNavigation.navTaskSeen={};
  }
}

export function saveTaskBadgeSeen(){
  try{localStorage.setItem(taskBadgeSeenKey(),JSON.stringify(appState.topbarAndNavigation.navTaskSeen||{}));}
  catch(_){}
}

export function navNotificationCounts(){
  return notificationData.notificationPageCounts(notificationRecords(),appState.auth.currentUser);
}

export function demoTaskBadgeSnapshot(){
  if(!appState.auth.currentUser)return {counts:{},items:{}};
  const role=appState.auth.currentUser.role;
  const counts={},items={};
  const set=(page,rows,tokenFn)=>{
    items[page]=(rows||[]).map(tokenFn);
    counts[page]=items[page].length;
  };

  set('messages',
    messageRecords().filter(m=>m.toUserId===appState.auth.currentUser.id&&!m.isRead&&!m.deleted),
    m=>`message:${m.id}`
  );

  if(role==='Administrator'||role==='Staff'){
    set('approvals',
      (appState.data.DB.users||[]).filter(u=>u.role==='Patient'&&u.status==='Pending'),
      u=>`approval:${u.id}:${u.createdAt||''}`
    );
    set('cert-requests',
      certificateRecords().filter(r=>r.status==='Pending'),
      r=>`certificate:${r.id}:${r.updatedAt||r.requestedAt||''}`
    );
    set('fitness',
      fitnessRecords().filter(r=>r.status==='Requested'),
      r=>`fitness:${r.id}:${r.updatedAt||r.requestedAt||''}`
    );
    set('inventory',
      inventoryRecords().filter(i=>!i.archived&&Number(i.quantity??i.qty)<=Number(i.threshold)),
      i=>`inventory:${i.id}:${i.updatedAt||i.quantity||i.qty}`
    );
  }

  if(role==='Doctor'){
    set('cert-requests',
      certificateRecords().filter(r=>r.status==='Awaiting Signature'&&r.doctorId===appState.auth.currentUser.id),
      r=>`certificate:${r.id}:${r.updatedAt||r.requestedAt||''}`
    );
    set('fitness',
      fitnessRecords().filter(
        r=>(r.status==='Requested'&&!r.doctorId)||
          (r.status==='In Assessment'&&r.doctorId===appState.auth.currentUser.id)
      ),
      r=>`fitness:${r.id}:${r.updatedAt||r.requestedAt||''}`
    );
  }

  if(role==='Administrator'){
    set('feedback-issues',
      issueReportRecords().filter(r=>['Open','In Review'].includes(r.status)),
      r=>`issue:${r.id}:${r.updatedAt||r.createdAt||''}`
    );
    set('users',
      workflowRequestRecords().filter(r=>r.status==='Pending'),
      r=>`workflow:${r.id}:${r.updatedAt||r.createdAt||''}`
    );
  }

  return {counts,items};
}

export async function taskBadgeAction(){return createOperationalService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY}).taskBadgeAction();}

export function unseenTaskCount(id){
  const current=new Set(appState.topbarAndNavigation.navTaskItems[id]||[]);
  const seen=new Set(appState.topbarAndNavigation.navTaskSeen[id]||[]);
  let total=0;
  current.forEach(token=>{if(!seen.has(token))total+=1;});
  return total;
}

export function navBadgeCountFor(id,notificationCounts=null){
  const updates=Number((notificationCounts||navNotificationCounts())[id]||0);
  const unseenTasks=unseenTaskCount(id);
  // A workflow task often creates a notification too. Show the larger
  // attention count instead of counting the same event twice.
  return Math.max(unseenTasks,updates);
}

export function applyNavBadges(){
  if(!appState.auth.currentUser)return;
  const updates=navNotificationCounts();

  for(const item of (appState.topbarAndNavigation.NAV_CONFIG[appState.auth.currentUser.role]||[])){
    if(!item.id)continue;
    const btn=document.getElementById(`nav-${item.id}`);
    if(!btn)continue;

    const count=navBadgeCountFor(item.id,updates);
    let badge=btn.querySelector('.nav-badge');

    if(count>0){
      if(!badge){
        badge=document.createElement('span');
        badge.className='nav-badge nav-badge-new';
        btn.appendChild(badge);
      }
      badge.textContent=count>99?'99+':String(count);
      badge.title=`${count} new item${count===1?'':'s'} requiring attention`;
      badge.setAttribute('aria-label',badge.title);
    }else if(badge){
      badge.remove();
    }
  }
}

export async function acknowledgeNavAttention(id){
  if(!appState.auth.currentUser||!id)return;

  const current=appState.topbarAndNavigation.navTaskItems[id]||[];
  if(current.length){
    const seen=new Set(appState.topbarAndNavigation.navTaskSeen[id]||[]);
    current.forEach(token=>seen.add(token));
    appState.topbarAndNavigation.navTaskSeen[id]=[...seen].slice(-500);
    saveTaskBadgeSeen();
  }

  // Opening a page also acknowledges unread notifications that lead
  // to that page. Exact unresolved task counts remain visible inside
  // the page itself (for example on certificate status tabs).
  const related=notificationRecords().filter(
    n=>n.userId===appState.auth.currentUser.id&&!n.read&&notificationPageFor(n)===id
  );

  related.forEach(n=>{n.read=true;});
  applyNavBadges();
  renderNotifList();

  const count=document.getElementById('notif-count');
  const unread=notificationRecords().filter(n=>n.userId===appState.auth.currentUser.id&&!n.read);
  if(count){
    if(unread.length){
      count.textContent=unread.length>99?'99+':String(unread.length);
      count.hidden=false;
    }else{
      count.textContent='';
      count.hidden=true;
    }
  }

  if(appState.auth.currentUser._realSupabase&&related.length){
    Promise.allSettled(
      related
        .filter(n=>n.dbNotificationId)
        .map(n=>notificationCenterAction({action:'read',notification_id:n.dbNotificationId}))
    ).catch(()=>{});
  }
}

export async function refreshTaskBadges(force=false){
  appState.topbarAndNavigation.campusTaskRefreshError='';
  if(!appState.auth.currentUser)return;
  const now=Date.now();
  if(!force&&now-appState.topbarAndNavigation.navBadgeLastFetch<10000){
    applyNavBadges();
    return;
  }

  try{
    if(appState.auth.currentUser._realSupabase){
      const result=await taskBadgeAction();
      appState.topbarAndNavigation.navTaskCounts=result.counts||{};
      appState.topbarAndNavigation.navTaskItems=result.items||{};
    }else{
      const snapshot=demoTaskBadgeSnapshot();
      appState.topbarAndNavigation.navTaskCounts=snapshot.counts;
      appState.topbarAndNavigation.navTaskItems=snapshot.items;
    }
    appState.topbarAndNavigation.navBadgeLastFetch=Date.now();

    // If the user is already viewing a task page while the first/next
    // refresh arrives, those current items are considered seen. The
    // unresolved total remains visible inside the page itself.
    if(appState.navigationRaceProtection.campusActivePageId&&(appState.topbarAndNavigation.navTaskItems[appState.navigationRaceProtection.campusActivePageId]||[]).length){
      const seen=new Set(appState.topbarAndNavigation.navTaskSeen[appState.navigationRaceProtection.campusActivePageId]||[]);
      (appState.topbarAndNavigation.navTaskItems[appState.navigationRaceProtection.campusActivePageId]||[]).forEach(token=>seen.add(token));
      appState.topbarAndNavigation.navTaskSeen[appState.navigationRaceProtection.campusActivePageId]=[...seen].slice(-500);
      saveTaskBadgeSeen();
    }
  }catch(e){
    appState.topbarAndNavigation.campusTaskRefreshError=e?.message||'Unable to refresh tasks.';
    console.error('Task badge refresh:',e);
    if(!appState.auth.currentUser._realSupabase){
      const snapshot=demoTaskBadgeSnapshot();
      appState.topbarAndNavigation.navTaskCounts=snapshot.counts;
      appState.topbarAndNavigation.navTaskItems=snapshot.items;
    }
  }
  applyNavBadges();
}

export function startTaskBadgeRefresh(){
  if(appState.topbarAndNavigation.navBadgeTimer)clearInterval(appState.topbarAndNavigation.navBadgeTimer);
  loadTaskBadgeSeen();
  refreshTaskBadges(true);
  appState.topbarAndNavigation.navBadgeTimer=setInterval(()=>{
    if(appState.auth.currentUser)refreshTaskBadges(true);
  },60000);
}

export function buildNav(){
  const nav=document.getElementById('sidebar-nav');
  const source=appState.topbarAndNavigation.NAV_CONFIG[appState.auth.currentUser.role]||[];
  const items=[];

  for(let i=0;i<source.length;i++){
    const item=source[i];
    if(item.section){
      let hasVisibleItem=false;
      for(let j=i+1;j<source.length&&!source[j].section;j++){
        if(shouldShowNavItem(source[j])){hasVisibleItem=true;break;}
      }
      if(hasVisibleItem)items.push(item);
      continue;
    }
    if(shouldShowNavItem(item))items.push(item);
  }

  nav.innerHTML=items.map(item=>{
    if(item.section)return`<div class="sb-section">${item.section}</div>`;
    const icon=appState.topbarAndNavigation.NAV_UI_ICONS[item.id]||appState.topbarAndNavigation.NAV_UI_ICONS.dashboard;
    const badge=item.badge?`<span class="nav-badge">${item.badge}</span>`:'';
    return`<button class="nav-item-btn" id="nav-${item.id}" ${bindAction('click',(event,element)=>{navTo((String(item.id)))})}>
      <i class="bi ${icon}" aria-hidden="true"></i>
      ${item.label}${badge}
    </button>`;
  }).join('');
}

export function toggleSidebar(force){
  const sb=document.getElementById('sidebar');
  const bd=document.getElementById('sidebar-backdrop');
  const open = typeof force==='boolean' ? force : !sb.classList.contains('open');
  sb.classList.toggle('open',open);
  bd.classList.toggle('show',open);
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){
  appState.topbarAndNavigation.TOP_SEARCH_ALIASES={
  dashboard:['home','overview'],
  appointments:['appointment','book','booking','schedule patient'],
  'my-appointments':['appointment','book','booking'],
  patients:['patient','records','add patient','FHIR','clinical copilot'],
  'my-patients':['patient','records','FHIR','clinical copilot'],
  approvals:['approval','registration','pending account'],
  'cert-requests':['certificate','medical certificate','signature'],
  'my-certificates':['certificate','medical certificate'],
  treatments:['treatment','diagnosis','medical notes'],
  inventory:['stock','medicine','supplies','predictive inventory','stock forecast','reorder prediction'],
  messages:['message','chat','conversation'],
  reports:['report','analytics','statistics','campus health intelligence','predictive health','health trends'],
  users:['user','account','management'],
  settings:['settings','configuration'],
  schedule:['doctor schedule','leave','time off'],
  health_education:['health education','article','health tips'],
  'my-records':['health record','medical record'],
  'my-account':['account','profile','password'],
  'report-issue':['issue','feedback','support'],
  'feedback-issues':['feedback','issues','support'],
  fitness:['fitness','fit to compete','sports clearance','athletics assessment'],
  'activity-log':['activity','audit','audit trail','logs']
};
  appState.topbarAndNavigation.topSearchIndex=-1;
  document.addEventListener('click',e=>{
  const wrap=document.getElementById('top-search-wrap');
  const box=document.getElementById('top-search-results');
  if(wrap&&box&&!wrap.contains(e.target))box.classList.remove('show');
});
  appState.topbarAndNavigation.NAV_UI_ICONS={
  dashboard:'bi-house',
  'my-appointments':'bi-calendar3',
  'my-records':'bi-file-earmark-medical',
  certificates:'bi-file-earmark-check',
  'cert-requests':'bi-file-earmark-check',
  messages:'bi-chat-dots',
  'my-account':'bi-person',
  patients:'bi-people',
  appointments:'bi-calendar3',
  treatments:'bi-activity',
  inventory:'bi-box-seam',
  reports:'bi-bar-chart-line',
  health_education:'bi-book',
  users:'bi-people',
  schedule:'bi-calendar-day',
  'my-patients':'bi-person-check',
  settings:'bi-gear',
  approvals:'bi-person-check',
  'report-issue':'bi-bug',
  'feedback-issues':'bi-chat-dots',
  fitness:'bi-heart-pulse',
  'activity-log':'bi-clock-history',
  'dental-survey':'bi-ui-checks-grid',
  'survey-results':'bi-clipboard-data'
};
  appState.topbarAndNavigation.NAV_CONFIG={
  Patient:[
    {section:'Patient Portal'},
    {id:'dashboard',label:'Dashboard'},
    {id:'my-appointments',label:'My Appointments'},
    {id:'my-records',label:'My Health Records'},
    {id:'my-certificates',label:'Medical Certificates'},
    {id:'fitness',label:'Fitness to Compete'},
    {id: 'health_education', label: 'Health Education' },
    {id:'dental-survey',label:'Dental Clinic Survey'},
    { id: 'messages', label: 'Messages' },
    {section:'Account'},
    {id:'my-account',label:'Account Settings'},
    {id:'report-issue',label:'Report an Issue'},
  ],
  Doctor:[
    {section:'Doctor Panel'},
    {id:'dashboard',label:'Dashboard'},
    {id:'schedule',label:'My Schedule'},
    {id:'my-patients',label:'My Patients'},
    {id:'appointments',label:'Appointments'},
    {id:'treatments',label:'Treatments'},
    {id:'fitness',label:'Fitness Assessments'},
    {id:'cert-requests',label:'Certificate Signatures'},
    { id: 'messages', label: 'Patient Messages' },
    {section:'Reports'},
    {id:'reports',label:'Reports'},
    {section:'Account'},
    {id:'my-account',label:'Account Settings'},
    {id:'report-issue',label:'Report an Issue'},
  ],
  Staff:[
    {section:'Staff Panel'},
    {id:'dashboard',label:'Dashboard'},
    {id:'patients',label:'Patient Records'},
    {id:'appointments',label:'Appointments'},
    {id:'approvals',label:'Approval Queue'},
    {id:'cert-requests',label:'Certificate Requests'},
    {id:'fitness',label:'Fitness Assessments'},
    {id:'inventory',label:'Inventory'},
    {id:'health_education',label:'Health Education'},
    {section:'Communication'},
    {id:'messages',label:'Messages'},
    {id:'survey-results',label:'Survey Results'},
    {id:'reports',label:'Reports'},
    {section:'Account'},
    {id:'my-account',label:'Account Settings'},
    {id:'report-issue',label:'Report an Issue'},
  ],
  Administrator:[
    {section:'Administration'},
    {id:'dashboard',label:'Dashboard'},
    {id:'patients',label:'Patient Records'},
    {id:'appointments',label:'Appointments'},
    {id:'approvals',label:'Approval Queue'},
    {id:'cert-requests',label:'Certificate Requests'},
    {id:'treatments',label:'Treatments'},
    {id:'fitness',label:'Fitness Assessments'},
    {id:'inventory',label:'Inventory'},
    {section:'Communication'},
    {id:'messages',label:'Messages'},
    {section:'Management'},
    {id:'users',label:'User Management'},
    {id:'survey-results',label:'Survey Results'},
    {id:'reports',label:'Reports & Analytics'},
    {id:'feedback-issues',label:'Feedback &amp; Issues'},
    {id:'settings',label:'System Settings'},
    {id:'activity-log',label:'Activity Log'},
    {section:'Account'},
    {id:'my-account',label:'Account Settings'},
  ],
};
  appState.topbarAndNavigation.navTaskCounts={};
  appState.topbarAndNavigation.navTaskItems={};
  appState.topbarAndNavigation.navTaskSeen={};
  appState.topbarAndNavigation.navBadgeTimer=null;
  appState.topbarAndNavigation.navBadgeLastFetch=0;
}
