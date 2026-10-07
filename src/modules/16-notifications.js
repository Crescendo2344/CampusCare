// ================================================================
// NOTIFICATIONS — REAL SUPABASE CENTER
// ================================================================
function notificationRecords(){
  if(currentUser?._realSupabase)return (DB.notifications||[]).filter(n=>n._realSupabase);
  return DB.notifications||[];
}

function realNotificationToUi(n){
  return {
    id:1100000+Number(n.notification_id),
    dbNotificationId:Number(n.notification_id),
    userId:currentUser?.id||null,
    dbUserId:Number(n.user_id),
    title:n.title||'Notification',
    body:n.message||'',
    type:n.type||'info',
    channel:n.channel||'In-app',
    read:Boolean(n.is_read),
    scheduledAt:n.scheduled_at||'',
    sentAt:n.sent_at||'',
    deliveryStatus:n.delivery_status||'',
    referenceType:n.reference_type||'',
    referenceId:n.reference_id==null?null:Number(n.reference_id),
    actionPage:n.action_page||'',
    notificationKey:n.notification_key||'',
    createdAt:n.created_at||'',
    _realSupabase:true
  };
}

async function notificationCenterAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/notification-center`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Notification action failed.');
  return result;
}

async function syncRealNotifications(){
  if(!currentUser?._realSupabase)return notificationRecords();

  const result=await notificationCenterAction({action:'list'});
  DB.notifications=(DB.notifications||[]).filter(n=>!n._realSupabase);
  DB.notifications.push(...(result.notifications||[]).map(realNotificationToUi));
  return notificationRecords();
}

function notificationPageFor(n){
  const action=String(n.actionPage||'').trim();
  const aliases={
    'privacy-center':'my-account',
    'certificate-signatures':'cert-requests',
    'certificate-requests':'cert-requests',
    'patient-messages':'messages',
    'my-messages':'messages'
  };
  if(action)return aliases[action]||action;

  const type=String(n.type||'').toLowerCase();
  if(type.includes('appointment'))return currentUser.role==='Patient'?'my-appointments':'appointments';
  if(type.includes('treatment'))return currentUser.role==='Patient'?'my-records':'treatments';
  if(type.includes('certificate'))return currentUser.role==='Patient'?'my-certificates':'cert-requests';
  if(type.includes('fitness'))return 'fitness';
  if(type.includes('inventory'))return 'inventory';
  return '';
}

function notificationTone(n){
  const type=String(n.type||'').toLowerCase();
  const title=String(n.title||'').toLowerCase();
  if(type.includes('inventory')||title.includes('low stock')||title.includes('declined'))return 'warning';
  if(title.includes('ready')||title.includes('issued')||title.includes('completed')||title.includes('confirmed'))return 'success';
  if(title.includes('cancelled')||title.includes('suspended'))return 'danger';
  return 'info';
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

  const unread=notificationRecords().filter(n=>n.userId===currentUser.id&&!n.read);

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
