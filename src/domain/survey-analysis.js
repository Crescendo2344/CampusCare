import {csvColumn,csvDate,templateCsv} from '../shared/csv.js';
// Client Satisfaction Measurement (CSM) reporting, as used for Philippine government offices:
// a response counts as satisfied when rated 4 (Agree) or 5 (Strongly agree); N/A and blank answers are
// left out of the base. The overall score pools SQD0–SQD8.
export const SQD_LABELS=[
  ['sqd0','Satisfied with the service'],
  ['sqd1','Reasonable time spent'],
  ['sqd2','Requirements and steps followed'],
  ['sqd3','Steps easy and simple'],
  ['sqd4','Information easy to find'],
  ['sqd5','Reasonable fees'],
  ['sqd6','Fair, no favoritism'],
  ['sqd7','Courteous, helpful staff'],
  ['sqd8','Got what was needed, or a clear explanation']
];
const rating=v=>{const n=Number(v);return Number.isInteger(n)&&n>=1&&n<=5?n:null;};

export function satisfaction(rows,key){
  let base=0,satisfied=0;
  for(const r of rows){const n=rating(r.sqd?.[key]);if(n===null)continue;base++;if(n>=4)satisfied++;}
  return {base,satisfied,pct:base?Math.round(satisfied/base*1000)/10:null};
}
export function overallSatisfaction(rows){
  let base=0,satisfied=0;
  for(const [key] of SQD_LABELS){const s=satisfaction(rows,key);base+=s.base;satisfied+=s.satisfied;}
  return {base,satisfied,pct:base?Math.round(satisfied/base*1000)/10:null};
}
// CC1 answers starting with "Yes" mean the client knew about the Citizen's Charter.
export function charterAwareness(rows){
  const answered=rows.filter(r=>r.citizensCharter?.cc1);
  const aware=answered.filter(r=>/^yes/i.test(r.citizensCharter.cc1));
  return {base:answered.length,aware:aware.length,pct:answered.length?Math.round(aware.length/answered.length*1000)/10:null};
}
export function averageRating(rows,pick){
  const values=rows.map(pick).map(rating).filter(n=>n!==null);
  return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100:null;
}
export function countBy(rows,pick){
  const counts=new Map();
  for(const r of rows){const key=pick(r)||'Not stated';counts.set(key,(counts.get(key)||0)+1);}
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]);
}
export function filterSurveys(rows,{from='',group='',service=''}={}){
  return rows.filter(r=>(!from||String(r.createdAt).slice(0,10)>=from)&&(!group||r.groupType===group)&&(!service||r.service===service));
}
// Export without names or email addresses: CSM responses are confidential.
export function surveysCsv(rows){
  // Citizen's Charter and SQD columns keep their official codes and say what each one asks.
  return templateCsv([
    csvColumn('Response','Date',r=>csvDate(r.createdAt)),
    csvColumn('Respondent','Client Type',r=>r.groupType),
    csvColumn('Respondent','Department',r=>r.department),
    csvColumn('Service','Availed',r=>r.service),
    csvColumn('Rating','Overall (1-5)',r=>r.ratings?.overall),
    csvColumn("Citizen's Charter","CC1 Aware of the Citizen's Charter",r=>r.citizensCharter?.cc1),
    csvColumn("Citizen's Charter","CC2 Saw the Citizen's Charter",r=>r.citizensCharter?.cc2),
    csvColumn("Citizen's Charter",'CC3 Charter helped',r=>r.citizensCharter?.cc3),
    ...SQD_LABELS.map(([k,label])=>csvColumn('Service Quality',`${k.toUpperCase()} ${label} (1-5)`,r=>r.sqd?.[k]??'')),
    csvColumn('Feedback','Suggestion',r=>r.suggestions)
  ],rows);
}
