// Plausibility checks for visit notes, so typing slips (e.g. 368 instead of 36.8 °C) are caught
// before they enter the record. Ranges are wide on purpose: they catch typos, not clinical extremes.
const num=value=>{const n=Number(String(value??'').replace('%','').trim());return Number.isFinite(n)?n:NaN;};
const blank=value=>String(value??'').trim()==='';

export function vitalSignErrors(v={}){
  const errors={};
  if(!blank(v.bp)){
    const m=String(v.bp).trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if(!m)errors.bp='Use systolic/diastolic, e.g. 120/80.';
    else if(+m[1]<50||+m[1]>260||+m[2]<30||+m[2]>160||+m[2]>=+m[1])errors.bp='Check the reading. Systolic must be higher than diastolic.';
  }
  const range=(key,min,max,label)=>{if(blank(v[key]))return;const n=num(v[key]);if(Number.isNaN(n)||n<min||n>max)errors[key]=`${label} must be between ${min} and ${max}.`;};
  range('temp',30,45,'Temperature (°C)');
  range('pulse',20,250,'Pulse (bpm)');
  range('spo2',50,100,'SpO₂ (%)');
  range('weight',2,350,'Weight (kg)');
  range('height',40,250,'Height (cm)');
  return errors;
}

export function treatmentFormErrors(f,today){
  const errors={...vitalSignErrors(f.vitals)};
  if(!f.patientId)errors.patient='Choose the patient.';
  if(String(f.findings||'').trim().length<3)errors.findings='Describe the chief complaint and findings.';
  if(String(f.diagnosis||'').trim().length<3)errors.diagnosis='Enter the diagnosis or clinical impression.';
  if(!f.date)errors.date='Enter the visit date.';
  else if(f.date>today)errors.date='The visit date cannot be in the future.';
  if(f.followup&&f.date&&f.followup<=f.date)errors.followup='The follow-up must be after the visit date.';
  if(String(f.prescription||'').length>600)errors.prescription='Keep the prescription under 600 characters.';
  if(!blank(f.medName)){
    if(blank(f.dosage))errors.dosage='Enter the dosage for the reminder.';
    if(blank(f.frequency))errors.frequency='Enter how often to take it.';
    if(!f.endDate)errors.endDate='Enter when the reminder should stop.';
    else if(f.date&&f.endDate<f.date)errors.endDate='The reminder cannot end before the visit date.';
  }
  return errors;
}

// Follow-up status shown in lists: overdue, due today, or upcoming.
export function followUpState(followupDate,today){
  if(!followupDate)return '';
  if(followupDate<today)return 'overdue';
  if(followupDate===today)return 'today';
  return 'upcoming';
}
