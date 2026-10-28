// Activity & Audit Log presentation rules: categories, plain-language sentences, before/after changes and day groups.
export const AUDIT_CATEGORIES=[
  ['security','Sign-in & security','bi-shield-lock'],
  ['appointments','Appointments','bi-calendar-check'],
  ['records','Patients & records','bi-file-medical'],
  ['inventory','Inventory','bi-box-seam'],
  ['accounts','Accounts & requests','bi-people'],
  ['feedback','Feedback','bi-chat-square-text'],
  ['system','Settings & data','bi-gear']
];
const CATEGORY_IDS=new Set(AUDIT_CATEGORIES.map(([id])=>id));

export function auditCategory(action='',entity=''){
  const a=String(action).toUpperCase(),e=String(entity).toLowerCase();
  if(/^(LOGIN|LOGOUT)$|PASSWORD|SESSION|MFA|LOCKOUT|SIGN_?IN|SIGN_?OUT/.test(a)||e==='session')return 'security';
  if(e==='appointments'||a.startsWith('APPOINTMENT'))return 'appointments';
  if(['patients','treatments','dental_records','medical_certificates','fitness_assessments'].includes(e)||/^(PATIENT|TREATMENT|MEDICAL_CERTIFICATE|FITNESS|DENTAL)/.test(a))return 'records';
  if(e.startsWith('inventory')||a.startsWith('INVENTORY'))return 'inventory';
  if(['users','workflow_requests','doctor_leaves'].includes(e)||/^(USER|WORKFLOW|NAME_CHANGE|SCHEDULE|DAY_OFF|DOCTOR|REGISTRATION|ACCOUNT)/.test(a))return 'accounts';
  if(e==='issue_reports'||a.startsWith('ISSUE'))return 'feedback';
  return 'system';
}
export const isAuditCategory=id=>CATEGORY_IDS.has(id);

// "APPOINTMENT_CANCEL_UNDONE" → "Appointment cancel undone"
export function friendlyAuditAction(action=''){
  const text=String(action).toLowerCase().replace(/_/g,' ').trim();
  return text?text.charAt(0).toUpperCase()+text.slice(1):'';
}

const RECORD_NAMES={appointments:'appointment',patients:'patient record',treatments:'treatment',dental_records:'dental record',medical_certificates:'medical certificate',fitness_assessments:'fitness assessment',inventory_items:'inventory item',inventory_transactions:'stock movement',users:'account',workflow_requests:'request',doctor_leaves:'day off',issue_reports:'report',health_resources:'health article',audit_logs:'activity log',system_settings:'settings',session:'session'};
export const recordName=entity=>RECORD_NAMES[String(entity||'').toLowerCase()]||String(entity||'record').replace(/_/g,' ');

// A short sentence after the person's name: "cancelled appointment #42".
const VERBS=[
  [/^LOGIN$/,'signed in'],[/^LOGOUT$/,'signed out'],
  [/_UNDONE$/,'undid a change to'],[/_CANCEL(LED)?$/,'cancelled'],[/_CREATED$|_ADDED$|_REQUESTED$|_DRAFTED$/,'created'],
  [/_UPDATED$|_CHANGED$/,'updated'],[/_ARCHIVED$/,'archived'],[/_RESTORED$/,'restored'],[/_DELETED$|_DISCARDED$/,'deleted'],
  [/_APPROVED$/,'approved'],[/_REJECTED$/,'rejected'],[/_RESOLVED$/,'resolved'],[/_DISMISSED$/,'dismissed'],[/_REOPENED$/,'reopened'],
  [/_ISSUED$/,'issued'],[/_VOIDED$/,'voided'],[/_EXPORTED$/,'exported'],[/_SUSPENDED$/,'suspended'],[/_REACTIVATED$/,'reactivated'],
  [/_ASSIGNED$/,'assigned'],[/_SENT$/,'sent a reminder for'],[/_COMPLETED$/,'completed'],[/_NO_SHOW$/,'marked a no-show for'],
  [/_DISBURSEMENT$/,'disbursed stock from'],[/_STOCK_IN$/,'added stock to'],[/_EXPIRED$/,'recorded expired stock for']
];
export function auditSentence(event){
  const action=String(event.action||'').toUpperCase();
  if(action==='LOGIN'||action==='LOGOUT')return action==='LOGIN'?'signed in':'signed out';
  const verb=VERBS.find(([rx])=>rx.test(action))?.[1];
  const target=`${recordName(event.targetType)}${event.targetId!=null&&event.targetId!==''?` #${event.targetId}`:''}`;
  return verb?`${verb} ${target}`:`${friendlyAuditAction(action).toLowerCase()} · ${target}`;
}

// Details as readable rows; previous_x / new_x pairs (and x / previous_x) become one "before → after" row.
const label=key=>{const t=String(key).replace(/^(previous|new|old)_/,'').replace(/_/g,' ');return t.charAt(0).toUpperCase()+t.slice(1);};
const show=value=>value==null||value===''?'—':typeof value==='object'?JSON.stringify(value):String(value);
export function auditDetailRows(details){
  if(!details||typeof details!=='object')return details?[{field:'Details',value:String(details)}]:[];
  const keys=Object.keys(details),used=new Set(),rows=[];
  for(const key of keys){
    const m=key.match(/^(previous|old)_(.+)$/);
    if(!m)continue;
    const base=m[2],after=['new_'+base,base].find(k=>k in details&&k!==key);
    if(!after)continue;
    used.add(key);used.add(after);
    rows.push({field:label(base),before:show(details[key]),after:show(details[after])});
  }
  for(const key of keys)if(!used.has(key)&&details[key]!==null&&details[key]!==''&&typeof details[key]!=='object')rows.push({field:label(key),value:show(details[key])});
  for(const key of keys)if(!used.has(key)&&details[key]&&typeof details[key]==='object')rows.push({field:label(key),value:show(details[key])});
  return rows;
}

const dayKey=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':new Date(d.getTime()+8*36e5).toISOString().slice(0,10);};
export const manilaDay=dayKey;
// "Today", "Yesterday", then "Mon, Oct 26, 2026" in Philippine time.
export function auditDayLabel(value,now=new Date()){
  const day=dayKey(value),today=dayKey(now),yesterday=dayKey(now.getTime()-864e5);
  if(!day)return 'Unknown date';
  if(day===today)return 'Today';
  if(day===yesterday)return 'Yesterday';
  return new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}

export function relativeTime(value,now=new Date()){
  const ms=now-new Date(value);
  if(!Number.isFinite(ms))return '';
  const min=Math.round(ms/6e4);
  if(min<1)return 'just now';
  if(min<60)return `${min} min ago`;
  const h=Math.round(min/60);
  if(h<24)return `${h} h ago`;
  const d=Math.round(h/24);
  return d<30?`${d} d ago`:'';
}

export function auditStats(events,now=new Date()){
  const today=dayKey(now),dayAgo=now.getTime()-864e5,weekAgo=now.getTime()-7*864e5;
  const inLast=(e,since)=>new Date(e.timestamp).getTime()>=since;
  const counts=new Map();
  events.filter(e=>inLast(e,weekAgo)&&e.userName&&e.role!=='System').forEach(e=>counts.set(e.userName,(counts.get(e.userName)||0)+1));
  const top=[...counts].sort((a,b)=>b[1]-a[1])[0];
  return {
    today:events.filter(e=>dayKey(e.timestamp)===today).length,
    signIns:events.filter(e=>e.action==='LOGIN'&&inLast(e,dayAgo)).length,
    changes:events.filter(e=>inLast(e,weekAgo)&&!['LOGIN','LOGOUT'].includes(e.action)).length,
    mostActive:top?{name:top[0],count:top[1]}:null
  };
}
