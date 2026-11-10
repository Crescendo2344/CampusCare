// Triage vital signs: taken by the front desk when the patient arrives, read by the doctor before
// the consultation. Shared by the browser form and the appointment-actions function so both apply the
// same rules. Ranges are wide on purpose: they catch typing slips (368 for 36.8 °C), not clinical extremes.
export const TRIAGE_VITAL_FIELDS=[
  ['bp','Blood pressure','mmHg','120/80',''],
  ['temp','Temperature','°C','36.8','decimal'],
  ['spo2','SpO₂','%','98','decimal']
];

const text=value=>String(value??'').trim();

// Only the triage fields, trimmed, with "%" dropped from SpO₂ and spaces removed from the pressure.
export function cleanTriageVitals(v={}){
  return {
    bp:text(v.bp).replace(/\s+/g,''),
    temp:text(v.temp),
    spo2:text(v.spo2).replace('%','').trim()
  };
}

export function triageVitalErrors(v={}){
  const c=cleanTriageVitals(v),errors={};
  if(c.bp){
    const m=c.bp.match(/^(\d{2,3})\/(\d{2,3})$/);
    if(!m)errors.bp='Use systolic/diastolic, e.g. 120/80.';
    else if(+m[1]<50||+m[1]>260||+m[2]<30||+m[2]>160||+m[2]>=+m[1])errors.bp='Check the reading. Systolic must be higher than diastolic.';
  }
  const range=(key,min,max,label)=>{
    if(!c[key])return;
    const n=Number(c[key]);
    if(!Number.isFinite(n)||n<min||n>max)errors[key]=`${label} must be between ${min} and ${max}.`;
  };
  range('temp',30,45,'Temperature (°C)');
  range('spo2',50,100,'SpO₂ (%)');
  if(!c.bp&&!c.temp&&!c.spo2)errors.form='Enter at least one vital sign.';
  return errors;
}

export const hasTriageVitals=v=>Boolean(v&&(text(v.bp)||text(v.temp)||text(v.spo2)));
