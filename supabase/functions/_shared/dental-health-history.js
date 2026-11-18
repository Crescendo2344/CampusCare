// The CTU Dental Clinic's Dental Health History Form: the same 48 questions, sections and follow-up lines
// as the paper form. Shared by the browser (form, review, print) and the dental-health-history Edge Function.
// Answers are "Yes", "No" or left blank ("leave blank if you do not understand the question").

export const DHH_SECTIONS=[
  {id:'I',title:'Encircle appropriate answer (leave blank if you do not understand the question)',questions:[
    [1,'Is your general health good?'],
    [2,'Has there been a change in your health within the last year?'],
    [3,'Have you been hospitalized or had a serious illness in the last three years?',{key:'hospitalized_why',label:'Why?'}],
    [4,'Are you being treated by a physician now?',{key:'physician_for',label:'For what?'}],
    [5,'Have you had problems with prior dental treatment?'],
    [6,'Are you in pain now?']
  ]},
  {id:'II',title:'Have you experienced?',questions:[
    [7,'Chest pain (angina)?'],[8,'Swollen ankles?'],[9,'Shortness of breath?'],[10,'Recent weight loss, fever, night sweats?'],
    [11,'Persistent cough, coughing of blood?'],[12,'Bleeding problems, bruising easily?'],[13,'Sinus problems?'],[14,'Difficulty swallowing?'],
    [15,'Seizures?'],[16,'Excessive thirst?'],[17,'Frequent urination?'],[18,'Dry mouth?'],[19,'Jaundice?']
  ]},
  {id:'III',title:'Do you have or have had?',questions:[
    [20,'Heart disease?'],[21,'Heart attack, heart defects?'],[22,'Heart murmurs?'],[23,'Rheumatic fever?'],[24,'Stroke, hardening of arteries?'],
    [25,'High blood pressure?'],[26,'TB, emphysema, other lung disease?'],[27,'Hepatitis, other liver disease, jaundice?'],[28,'Stomach problems, ulcers?'],
    [29,'Family history of diabetes, heart problems, tumors?'],[30,'AIDS?'],[31,'Tumors, cancer?'],[32,'VD (syphilis, gonorrhea, chlamydia)?'],[33,'Herpes?'],
    [34,'Kidney, bladder disease?'],[35,'Thyroid, adrenal disease?'],[36,'Diabetes?']
  ]},
  {id:'IV',title:'Do you have or have had?',questions:[
    [37,'Prosthetic heart valve?'],[38,'Artificial joint?'],[39,'Blood transfusions?'],[40,'Surgeries?'],[41,'Pacemaker?']
  ]},
  {id:'V',title:'Are you taking?',questions:[
    [42,'Recreational drugs?'],[43,'Drugs, medicine (inc. aspirin)?',{key:'medicines',label:'Please list:'}],[44,'Tobacco in any form?'],[45,'Alcohol?']
  ]},
  {id:'VI',title:'Women only',women:true,questions:[
    [46,'Are you or could you be pregnant or nursing?'],[47,'Taking birth control pills?']
  ]},
  {id:'VII',title:'All patients',questions:[
    [48,'Do you have or have had any other disease or medical problems NOT listed on this form?',{key:'other_explain',label:'If so, please explain:'}]
  ]}
];
export const DHH_QUESTIONS=DHH_SECTIONS.flatMap(section=>section.questions.map(([n,text,detail])=>({n,text,detail,section:section.id,women:Boolean(section.women)})));
// The physician's details asked under question 4 on the paper form.
export const DHH_PHYSICIAN_FIELDS=[['physician_name','Physician name'],['physician_address','Address'],['physician_phone','Telephone number']];
export const DHH_DECLARATION='To the best of my knowledge, I have answered every question completely and accurately. I will inform my dentist of any change in my health and / or medication.';

// A "Yes" the dentist should see before treating (bleeding, heart, infection, medicines, pregnancy…).
// Question 1 is the other way round: "No" (general health not good) is the alert.
export const DHH_ALERTS={1:'General health not good',4:'Under a physician\'s care',6:'In pain now',7:'Chest pain',9:'Shortness of breath',11:'Persistent cough',12:'Bleeding problems',
  15:'Seizures',20:'Heart disease',21:'Heart attack / defects',22:'Heart murmur',23:'Rheumatic fever',24:'Stroke',25:'High blood pressure',26:'TB / lung disease',
  27:'Hepatitis / liver disease',30:'AIDS',32:'VD',34:'Kidney disease',36:'Diabetes',37:'Prosthetic heart valve',38:'Artificial joint',39:'Blood transfusions',
  41:'Pacemaker',42:'Recreational drugs',43:'Taking medicines (incl. aspirin)',46:'Pregnant or nursing'};
export function dhhAlerts(answers={}){
  return DHH_QUESTIONS.filter(q=>DHH_ALERTS[q.n]&&(q.n===1?answers[q.n]==='No':answers[q.n]==='Yes')).map(q=>({n:q.n,label:DHH_ALERTS[q.n]}));
}

const clean=(value,max)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
// Keeps only real questions with Yes/No, and the follow-up text a Yes calls for.
export function cleanHealthHistory(raw={},{female=true}={}){
  const answers={},details={};
  for(const q of DHH_QUESTIONS){
    if(q.women&&!female)continue;
    const value=raw?.answers?.[q.n];
    if(value==='Yes'||value==='No')answers[q.n]=value;
  }
  for(const q of DHH_QUESTIONS.filter(q=>q.detail))if(answers[q.n]==='Yes'){const text=clean(raw?.details?.[q.detail.key],500);if(text)details[q.detail.key]=text;}
  if(answers[4]==='Yes')for(const [key] of DHH_PHYSICIAN_FIELDS){const text=clean(raw?.details?.[key],200);if(text)details[key]=text;}
  const number=(value,min,max)=>{const n=Number(value);return value!==''&&value!=null&&Number.isFinite(n)&&n>=min&&n<=max?Math.round(n*10)/10:null;};
  return {answers,details,height_cm:number(raw?.height_cm,50,250),weight_kg:number(raw?.weight_kg,20,300)};
}
export const unansweredCount=(answers={},{female=true}={})=>DHH_QUESTIONS.filter(q=>(female||!q.women)&&!answers[q.n]).length;

// "2026-S1"-style key of the semester a day falls in, from the clinic's semester dates
// (July–December is the 1st Semester when the dates are not set). Settings use the database column names.
export function semesterKey(day,s={}){
  const d=String(day||'').slice(0,10);
  const within=(a,b)=>a&&b&&d>=a&&d<=b;
  if(within(s.semester_start,s.semester_end))return `${String(s.semester_start).slice(0,4)}-S1`;
  if(within(s.semester2_start,s.semester2_end))return `${s.semester_start?String(s.semester_start).slice(0,4):Number(String(s.semester2_start).slice(0,4))-1}-S2`;
  const y=Number(d.slice(0,4)),m=Number(d.slice(5,7));
  return m>=7?`${y}-S1`:`${y-1}-S2`;
}

/**
 * Where an appointment stands: "done" (answered or confirmed for this visit), "confirm" (answered earlier
 * this semester, so the patient only confirms nothing changed) or "needed" (no answers this semester).
 * @param {{appointment_id:number,appointment_date:string}} appointment
 * @param {{appointment_id?:number|null,created_at:string,source?:string}[]} histories the patient's, newest first
 */
export function healthHistoryStatus(appointment,histories,settings={}){
  const own=histories.find(h=>Number(h.appointment_id)===Number(appointment.appointment_id));
  if(own)return {status:'done',source:own.source||'online',at:own.created_at};
  const semester=semesterKey(appointment.appointment_date,settings);
  const recent=histories.find(h=>h.source!=='paper'&&semesterKey(String(h.created_at).slice(0,10),settings)===semester);
  return recent?{status:'confirm',at:recent.created_at}:{status:'needed'};
}
