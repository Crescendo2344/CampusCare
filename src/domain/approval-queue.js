// Registration review queue: automatic pre-checks, waiting time, filtering and ordering.
// Pre-checks point reviewers at likely problems; the decision stays with the person reviewing.
const DAY=864e5;

export function approvalWaitDays(createdAt,now=Date.now()){
  const time=new Date(createdAt).getTime();
  return Number.isNaN(time)?0:Math.max(0,Math.floor((now-time)/DAY));
}
export function approvalWaitLabel(createdAt,now=Date.now()){
  const time=new Date(createdAt).getTime();
  if(Number.isNaN(time))return '—';
  const hours=Math.max(0,Math.floor((now-time)/36e5));
  if(hours<1)return 'Just now';
  if(hours<24)return `${hours}h`;
  const days=Math.floor(hours/24);
  return `${days} day${days===1?'':'s'}`;
}
// Waiting two days or more is highlighted so the oldest applicants are not forgotten.
export const APPROVAL_OVERDUE_DAYS=2;

const norm=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
export function approvalFlags(applicant,pending=[]){
  const flags=[];
  const student=applicant.personType==='Student';
  if(!applicant.emailConfirmedAt&&!applicant.emailVerificationSkipped)flags.push({key:'email',tone:'warning',label:'Email not confirmed',detail:'The applicant has not opened the verification email yet, so they cannot sign in even after approval.'});
  if(!applicant.verificationSelfie)flags.push({key:'selfie',tone:'danger',label:'No selfie',detail:'No verification selfie was submitted.'});
  if(!applicant.idFileData)flags.push({key:'front',tone:'danger',label:'No ID front',detail:'The front of the ID is missing.'});
  if(!applicant.idBackData)flags.push({key:'back',tone:'warning',label:'No ID back',detail:'The back of the ID is missing (older registration).'});
  const id=String(applicant.idNo||'').trim();
  if(id&&!(student?/^\d{7}$/:/^\d{5}$/).test(id))flags.push({key:'idformat',tone:'warning',label:'Unusual ID number',detail:`${student?'Student IDs have 7 digits':'Employee IDs have 5 digits'}; this one is "${id}".`});
  const others=pending.filter(other=>other.id!==applicant.id);
  if(id&&others.some(other=>String(other.idNo||'').trim()===id))flags.push({key:'dupid',tone:'danger',label:'Duplicate ID number',detail:'Another pending applicant entered the same ID number.'});
  const name=norm(`${applicant.fname} ${applicant.lname}`);
  if(name.trim()&&others.some(other=>norm(`${other.fname} ${other.lname}`)===name))flags.push({key:'dupname',tone:'warning',label:'Same name pending',detail:'Another pending applicant has the same name. Check that this is not a duplicate sign-up.'});
  return flags;
}

export function filterApprovals(rows,{query='',personType='',unit=''}={}){
  const q=norm(query);
  return rows.filter(u=>{
    const haystack=norm(`${u.fname} ${u.lname} ${u.lname}, ${u.fname} ${u.email} ${u.username} ${u.idNo}`);
    return (!q||haystack.includes(q))&&(!personType||u.personType===personType)&&(!unit||u.college===unit);
  });
}
// Oldest first by default, as in a first-in, first-out review queue.
export function sortApprovals(rows,order='oldest'){
  const time=u=>new Date(u.createdAt).getTime()||0;
  return rows.slice().sort((a,b)=>order==='newest'?time(b)-time(a):time(a)-time(b));
}

export const REJECTION_REASONS=[
  'The ID photo is blurry, cropped or unreadable.',
  'The name on the ID does not match the registration details.',
  'The ID number does not match the registration details.',
  'The face in the selfie does not match the ID photo.',
  'The document is not a valid Student or Employee ID (for example, a COR).',
  'The front and back photos are not from the same ID.',
  'This person already has a CampusCare account.'
];
