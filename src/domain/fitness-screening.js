// Pre-participation screening for fitness-to-compete, following the common sports pre-participation
// physical evaluation: a short yes/no history focused on heart and injury warning signs, a clearance
// decision with reasons, and a clearance that is valid for one year.
import {vitalSignErrors} from './clinical-validation.js';

export const SCREENING_QUESTIONS=[
  ['chest','Chest pain, pressure or discomfort during exercise'],
  ['syncope','Fainted or nearly fainted during or right after exercise'],
  ['breath','Unusual shortness of breath or tiredness with exercise'],
  ['palpitations','Racing, skipped or irregular heartbeat'],
  ['heart','Known heart condition, high blood pressure or heart murmur'],
  ['family','A family member died suddenly of a heart problem before age 50'],
  ['concussion','Previous head injury or concussion'],
  ['injury','Bone, joint or muscle injury that still limits activity'],
  ['asthma','Asthma or breathing problems that need medicine']
];
export const FITNESS_DECISIONS=['Fit to Compete','Fit with Restrictions','Not Fit to Compete'];
const PREFIX='Screening: ';

// Answers are stored at the start of the cardio-respiratory notes so no schema change is needed.
export function encodeScreening(answers={},notes=''){
  const line=PREFIX+SCREENING_QUESTIONS.map(([key])=>`${key}=${answers[key]==='yes'?'yes':answers[key]==='no'?'no':'?'}`).join('; ');
  return [line,String(notes||'').trim()].filter(Boolean).join('\n');
}
export function decodeScreening(text=''){
  const value=String(text||'');
  if(!value.startsWith(PREFIX))return {answers:{},notes:value};
  const [first,...rest]=value.split('\n');
  const answers={};
  for(const part of first.slice(PREFIX.length).split(';')){const [key,answer]=part.trim().split('=');if(answer==='yes'||answer==='no')answers[key]=answer;}
  return {answers,notes:rest.join('\n').trim()};
}
export function positiveScreening(answers={}){
  return SCREENING_QUESTIONS.filter(([key])=>answers[key]==='yes').map(([,label])=>label);
}

export function fitnessAssessmentErrors(f,today){
  const errors={};
  const vitals=vitalSignErrors({bp:f.vitals?.bp,pulse:f.vitals?.hr,height:f.vitals?.height,weight:f.vitals?.weight});
  for(const [key,message] of Object.entries(vitals))errors[key==='pulse'?'hr':key]=message.replace('Pulse (bpm)','Heart rate (bpm)');
  if(!f.patientId)errors.patient='Search for and choose the patient.';
  if(String(f.sport||'').trim().length<2)errors.sport='Enter the sport or event.';
  if(!f.assessmentDate)errors.date='Enter the assessment date.';
  else if(f.assessmentDate>today)errors.date='The assessment date cannot be in the future.';
  if(f.eventDate&&f.assessmentDate&&f.eventDate<f.assessmentDate)errors.eventDate='The event date cannot be before the assessment.';
  if(f.decision){
    const unanswered=SCREENING_QUESTIONS.filter(([key])=>!['yes','no'].includes(f.answers?.[key]));
    if(unanswered.length)errors.screening=`Answer all screening questions before deciding (${unanswered.length} left).`;
    if(String(f.examFindings||'').trim().length<3)errors.exam='Record the examination findings before deciding.';
    if(f.decision!=='Fit to Compete'&&String(f.restrictions||'').trim().length<3)
      errors.restrictions=f.decision==='Not Fit to Compete'?'Explain why and what the patient should do next.':'List the restrictions.';
    if(f.decision==='Fit to Compete'&&positiveScreening(f.answers).length&&String(f.restrictions||'').trim().length<3)
      errors.restrictions='Screening has warning signs. Note the further evaluation done before clearing the patient.';
  }
  return errors;
}

// A clearance lasts one year from the assessment date.
export function clearanceValidUntil(date){
  if(!date)return '';
  const d=new Date(date+'T12:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+1);d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}
export function clearanceState(record,today){
  if(!record?.decision||record.decision==='Not Fit to Compete'||!record.date)return '';
  return clearanceValidUntil(record.date)<today?'expired':'valid';
}
