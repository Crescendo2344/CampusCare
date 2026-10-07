// Existing UI handlers keep their names; this adapter owns notification state updates.
function notificationRecords(){return notificationData.notificationRecords(DB,currentUser);}
function realNotificationToUi(n){return notificationData.realNotificationToUi(n,currentUser);}
function notificationPageFor(n){return notificationData.notificationPageFor(n,currentUser);}
function notificationTone(n){return notificationData.notificationTone(n);}
function notificationService(){
  return createNotificationService({getClient:()=>supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:SUPABASE_URL,publishableKey:SUPABASE_PUBLISHABLE_KEY});
}
async function notificationCenterAction(payload){return notificationService().action(payload);}
async function syncRealNotifications(){
  if(!currentUser?._realSupabase)return notificationRecords();
  const rows=await notificationService().load();
  DB.notifications=notificationData.mergeNotificationRecords(DB.notifications||[],rows,currentUser);
  return notificationRecords();
}

function addNotif(userId,title,body,type='info'){
  // Legacy/demo fallback only. Real Supabase workflows create their
  // notifications on the server so they cannot be forged by the browser.
  if(currentUser?._realSupabase)return;
  DB.notifications.push({id:DB.nextNotifId++,userId,title,body,type,read:false,createdAt:new Date().toLocaleString()});
  if(currentUser&&currentUser.id===userId)updateNotifUI();
}

async function updateNotifUI(){
  if(!currentUser)return;

  if(currentUser._realSupabase){
    try{await syncRealNotifications();}
    catch(e){console.error('Notification sync:',e);}
  }

  const unread=notificationData.unreadNotifications(notificationRecords(),currentUser);

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
