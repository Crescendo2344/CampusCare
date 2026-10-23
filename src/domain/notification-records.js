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

// Short, familiar timestamps: "Just now", "5m ago", "3h ago", "Yesterday", "4d ago", then the date.
export function relativeNotificationTime(value,now=new Date()){
  const time=new Date(value);
  if(Number.isNaN(time.getTime()))return '';
  const seconds=Math.max(0,Math.round((now-time)/1000));
  if(seconds<60)return 'Just now';
  if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;
  const section=notificationSection(value,now);
  if(section==='Today')return `${Math.floor(seconds/3600)}h ago`;
  if(section==='Yesterday')return 'Yesterday';
  const days=Math.round((startOfDay(now)-startOfDay(time))/864e5);
  if(days<7)return `${days}d ago`;
  return time.toLocaleDateString('en-PH',{month:'short',day:'numeric',...(time.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})});
}
const startOfDay=date=>new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
export function notificationSection(value,now=new Date()){
  const time=new Date(value);
  if(Number.isNaN(time.getTime()))return 'Earlier';
  const days=Math.round((startOfDay(now)-startOfDay(time))/864e5);
  return days<=0?'Today':days===1?'Yesterday':'Earlier';
}

// Newest first, split into Today / Yesterday / Earlier. Repeats about the same record
// (same title and reference) collapse into one entry, like replies on one thread.
export function groupNotifications(rows,now=new Date()){
  const sorted=[...rows].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const sections=new Map();
  for(const n of sorted){
    const section=notificationSection(n.createdAt,now);
    if(!sections.has(section))sections.set(section,new Map());
    const groups=sections.get(section);
    const key=n.referenceId!=null&&n.referenceType?`${n.title}|${n.referenceType}|${n.referenceId}`:`id:${n.id}`;
    const group=groups.get(key);
    if(group){group.members.push(n);group.unread=group.unread||!n.read;}
    else groups.set(key,{key,lead:n,members:[n],unread:!n.read});
  }
  return ['Today','Yesterday','Earlier'].filter(name=>sections.has(name)).map(name=>({name,groups:[...sections.get(name).values()]}));
}

// Icon and colour family for a notification, from its type and title.
export function notificationIcon(n){
  const text=`${n.type||''} ${n.title||''}`.toLowerCase();
  if(text.includes('appointment')||text.includes('reminder'))return 'bi-calendar-event';
  if(text.includes('certificate'))return 'bi-file-earmark-medical';
  if(text.includes('stock')||text.includes('inventory'))return 'bi-box-seam';
  if(text.includes('message')||text.includes('reply'))return 'bi-chat-dots';
  if(text.includes('report')||text.includes('feedback')||text.includes('bug'))return 'bi-flag';
  if(text.includes('treatment')||text.includes('fitness'))return 'bi-heart-pulse';
  if(text.includes('account')||text.includes('approv')||text.includes('registration'))return 'bi-person-check';
  return 'bi-bell';
}
