// Helpdesk rules for Feedback & Issues: priorities, who owes a reply, response times and queue order.
export const ISSUE_PRIORITIES=['Urgent','High','Normal','Low'];
export const ISSUE_STATUSES=['Open','In Review','Resolved','Dismissed'];
const OPEN=['Open','In Review'];

export const isOpenIssue=r=>OPEN.includes(r?.status);
const publicReplies=r=>(r?.replies||[]).filter(rp=>!rp.internal);

// The reporter is waiting on the clinic when the report is open and the latest visible message is not an administrator's.
export function awaitingReply(r){
  return isOpenIssue(r)&&publicReplies(r).at(-1)?.authorRole!=='Administrator';
}

// Hours from submission to the first administrator reply the reporter could see; null if none yet.
export function firstResponseHours(r){
  const first=publicReplies(r).find(rp=>rp.authorRole==='Administrator');
  if(!first)return null;
  const ms=new Date(first.createdAt)-new Date(r.createdAt);
  return Number.isFinite(ms)?Math.max(0,ms/36e5):null;
}

export function median(values){
  const list=values.filter(v=>Number.isFinite(v)).sort((a,b)=>a-b);
  if(!list.length)return null;
  const mid=Math.floor(list.length/2);
  return list.length%2?list[mid]:(list[mid-1]+list[mid])/2;
}

export function formatHours(hours){
  if(hours==null)return '—';
  if(hours<1)return `${Math.max(1,Math.round(hours*60))} min`;
  if(hours<48)return `${Math.round(hours)} h`;
  return `${Math.round(hours/24)} d`;
}

export function queueStats(reports,now=new Date()){
  const weekAgo=new Date(now.getTime()-7*864e5);
  return {
    needsReply:reports.filter(awaitingReply).length,
    open:reports.filter(isOpenIssue).length,
    urgent:reports.filter(r=>isOpenIssue(r)&&['Urgent','High'].includes(r.priority||'Normal')).length,
    resolvedThisWeek:reports.filter(r=>r.status==='Resolved'&&r.resolvedAt&&new Date(r.resolvedAt)>=weekAgo).length,
    medianFirstResponse:median(reports.map(firstResponseHours))
  };
}

const priorityRank=r=>{const i=ISSUE_PRIORITIES.indexOf(r.priority||'Normal');return i<0?2:i;};
const newest=(a,b)=>String(b.createdAt).localeCompare(String(a.createdAt));
const oldest=(a,b)=>String(a.createdAt).localeCompare(String(b.createdAt));

export function sortIssues(list,order='priority'){
  const copy=[...list];
  if(order==='oldest')return copy.sort(oldest);
  if(order==='newest')return copy.sort(newest);
  if(order==='waiting')return copy.sort((a,b)=>Number(awaitingReply(b))-Number(awaitingReply(a))||oldest(a,b));
  // Default: most urgent first, then the longest-waiting.
  return copy.sort((a,b)=>Number(isOpenIssue(b))-Number(isOpenIssue(a))||priorityRank(a)-priorityRank(b)||Number(awaitingReply(b))-Number(awaitingReply(a))||oldest(a,b));
}

// A short browser / system / screen description attached to a report so a bug can be reproduced.
export function describeDevice(userAgent='',width=0,height=0){
  const ua=String(userAgent);
  const version=rx=>ua.match(rx)?.[1];
  const browser=version(/Edg\/(\d+)/)?`Edge ${version(/Edg\/(\d+)/)}`
    :version(/OPR\/(\d+)/)?`Opera ${version(/OPR\/(\d+)/)}`
    :version(/Firefox\/(\d+)/)?`Firefox ${version(/Firefox\/(\d+)/)}`
    :version(/Chrome\/(\d+)/)?`Chrome ${version(/Chrome\/(\d+)/)}`
    :version(/Version\/(\d+)[\d.]* .*Safari/)?`Safari ${version(/Version\/(\d+)[\d.]* .*Safari/)}`:'Unknown browser';
  const system=/Android/.test(ua)?'Android':/iPhone|iPad|iPod/.test(ua)?'iOS':/Windows/.test(ua)?'Windows':/Mac OS X/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'Unknown system';
  return [browser,system,width&&height?`${width}×${height}`:''].filter(Boolean).join(' · ');
}

// Saved replies administrators can drop into the composer and edit before sending.
export const QUICK_REPLIES=[
  ['Looking into it','Thank you for reporting this. We are looking into it and will update you here.'],
  ['Need more details','Thanks for the report. Could you tell us the steps that led to this and, if possible, attach a screenshot?'],
  ['Fixed','This has been fixed. Please refresh the page and let us know if it happens again.'],
  ['Suggestion noted','Thank you for the suggestion. We have added it to our list of improvements to consider.'],
  ['Cannot reproduce','We could not reproduce this on our side. If it happens again, please reply with the time it happened and what you were doing.']
];
