// Notification mapping and routing depend on supplied records and account data.
export function notificationRecords(db,account){
  if(account?._realSupabase)return (db.notifications||[]).filter(n=>n._realSupabase);
  return db.notifications||[];
}

export function realNotificationToUi(n,account){
  return {
    id:1100000+Number(n.notification_id),
    dbNotificationId:Number(n.notification_id),
    userId:account?.id||null,
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

export function notificationPageFor(n,account){
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
  if(type.includes('appointment'))return account.role==='Patient'?'my-appointments':'appointments';
  if(type.includes('treatment'))return account.role==='Patient'?'my-records':'treatments';
  if(type.includes('certificate'))return account.role==='Patient'?'my-certificates':'cert-requests';
  if(type.includes('fitness'))return 'fitness';
  if(type.includes('inventory'))return 'inventory';
  return '';
}

export function notificationTone(n){
  const type=String(n.type||'').toLowerCase();
  const title=String(n.title||'').toLowerCase();
  if(type.includes('inventory')||title.includes('low stock')||title.includes('declined'))return 'warning';
  if(title.includes('ready')||title.includes('issued')||title.includes('completed')||title.includes('confirmed'))return 'success';
  if(title.includes('cancelled')||title.includes('suspended'))return 'danger';
  return 'info';
}

export function mergeNotificationRecords(existing,rows,account){
  return [...existing.filter(n=>!n._realSupabase),...rows.map(n=>realNotificationToUi(n,account))];
}

export function unreadNotifications(rows,account){
  if(!account)return [];
  return rows.filter(n=>n.userId===account.id&&!n.read);
}

export function notificationPageCounts(rows,account){
  const counts={};
  for(const n of unreadNotifications(rows,account)){
    const page=notificationPageFor(n,account);
    if(page)counts[page]=(counts[page]||0)+1;
  }
  return counts;
}
