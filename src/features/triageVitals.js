// triageVitals: the front desk records blood pressure, temperature and SpO₂ when the patient arrives,
// and may correct them until the visit is completed. The doctor reads them before the consultation and
// they are copied into the visit record.
import {state as appState} from '../app/state.js';
import {appointmentAction,appointmentDisplayId,appointmentRecords,syncRealAppointments} from './appointmentService.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate,fmtTime} from './inputValidation.js';
import {closeAllModals,openModal} from './modals.js';
import {hideAlert,showAlert,toast} from './theme.js';
import {persistDB} from './persistence.js';
import {auditLog} from './auditAndBackups.js';
import {patientAvatarHtml} from './patientManagement.js';
import {appointmentAllowedActions,renderApptTable} from './appointments.js';
import {viewAppt} from './appointmentDetails.js';
import * as clinicalChecks from '../domain/clinical-validation.js';
import {TRIAGE_VITAL_FIELDS,cleanTriageVitals,hasTriageVitals,triageVitalErrors} from '../../supabase/functions/_shared/triage-vitals.js';
import {bindAction} from '../dependencies.js';

const UNITS={bp:' mmHg',temp:' °C',spo2:'%'};
const LABELS={bp:'BP',temp:'Temp',spo2:'SpO₂'};

function stamp(v){
  const when=v?.updatedAt||v?.recordedAt;if(!when)return '';
  const by=getUserById(v.updatedBy||v.recordedBy);
  const d=new Date(when),time=Number.isNaN(d.getTime())?'':d.toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return [v.updatedAt&&v.updatedAt!==v.recordedAt?'Updated':'Taken',time,by?`by ${by.fname} ${by.lname}`:''].filter(Boolean).join(' ');
}

// " · Taken Nov 10, 9:05 AM by Anna Cruz", for the doctor's visit form.
export function triageVitalsTakenBy(v){
  const text=stamp(v);
  return text?` · ${text.charAt(0).toLowerCase()}${text.slice(1)}`:'';
}

// Compact chips for the appointment list: "BP 120/80 · Temp 36.8 °C".
export function triageVitalsChipHtml(a){
  const v=a?.triageVitals;
  if(!hasTriageVitals(v))return '';
  const flags=clinicalChecks.vitalFlags(v);
  const parts=TRIAGE_VITAL_FIELDS.filter(([key])=>v[key]).map(([key])=>`<span class="triage-chip ${flags[key]?'flagged '+flags[key].level:''}">${LABELS[key]} ${escapeHtml(v[key])}${UNITS[key]}</span>`);
  return `<div class="triage-chips" title="Triage vital signs">${parts.join('')}</div>`;
}

// Read-only panel for the appointment details and the doctor's view.
export function triageVitalsPanelHtml(a,{onEdit=null}={}){
  const v=a?.triageVitals,flags=clinicalChecks.vitalFlags(v||{});
  const box=([key,label])=>`<div class="triage-box ${flags[key]?'flagged '+flags[key].level:''}"><span>${label}</span><strong>${v?.[key]?escapeHtml(v[key])+UNITS[key]:'—'}</strong>${flags[key]?`<small>${escapeHtml(flags[key].label)}</small>`:''}</div>`;
  const edit=onEdit?`<button class="btn btn-xs" ${bindAction('click',()=>onEdit())}><i class="bi bi-pencil" aria-hidden="true"></i> ${hasTriageVitals(v)?'Edit':'Record'}</button>`:'';
  return `<section class="triage-panel"><div class="triage-panel-head"><h4 class="appt-detail-section"><i class="bi bi-heart-pulse" aria-hidden="true"></i> Triage vital signs</h4>${edit}</div>
    ${hasTriageVitals(v)
      ?`<div class="triage-grid">${TRIAGE_VITAL_FIELDS.map(box).join('')}</div><p class="form-note">${escapeHtml(stamp(v))}</p>`
      :'<p class="text-muted">Not taken yet. The front desk records them when the patient arrives.</p>'}
  </section>`;
}

export function openTriageVitalsModal(apptId,{returnToDetails=false}={}){
  const a=appointmentRecords().find(x=>x.id===Number(apptId));if(!a)return;
  if(!appointmentAllowedActions(a).vitals){
    toast(a.status!=='Scheduled'?'Vital signs can only be changed before the visit is completed.':'Vital signs are taken on the day of the visit.','warning');
    return;
  }
  const pt=getPatientById(a.patientId),doc=getUserById(a.doctorId),v=a.triageVitals||{};
  const field=([key,label,unit,placeholder,mode])=>`<div class="form-group tv-vital" data-vital="${key}"><label for="tv-${key}">${label} <span class="tv-unit">${unit}</span><span class="tv-flag" hidden></span></label><input id="tv-${key}" ${mode?`inputmode="${mode}"`:''} placeholder="${placeholder}" autocomplete="off" value="${escapeHtml(v[key]||'')}"><p class="registration-field-error" id="tv-${key}-error" aria-live="polite" hidden></p></div>`;
  openModal(`<div class="modal tv-modal">
    <div class="modal-header"><div><h3>Triage vital signs</h3>
      <span class="tv-meta">Appointment #${appointmentDisplayId(a)} · ${escapeHtml(fmtDate(a.date))} ${escapeHtml(fmtTime(a.time))}${doc?` · Dr. ${escapeHtml(doc.fname+' '+doc.lname)}`:''}</span></div>
      <button class="close-btn" ${bindAction('click',()=>closeAllModals())}>✕</button>
    </div>
    <div class="modal-body">
      <div id="tv-msg"></div>
      ${pt?`<div class="tv-patient">${patientAvatarHtml(pt,40)}<div class="tv-patient-main"><strong>${escapeHtml(pt.fname+' '+pt.lname)}</strong><span>${escapeHtml([pt.age!==''&&pt.age!=null?`${pt.age} yrs`:'',pt.gender||'',a.service||a.clinic||''].filter(Boolean).join(' · '))}</span></div></div>`:''}
      <p class="form-note tv-note">Taken when the patient arrives. The doctor sees them before the consultation. You can correct them until the visit is completed.</p>
      <div class="tv-vitals" ${bindAction('input',event=>{clearTriageError(event.target);updateTriageFlags();})}>${TRIAGE_VITAL_FIELDS.map(field).join('')}</div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',()=>{closeAllModals();if(returnToDetails)viewAppt(a.id);})}>Cancel</button>
      <button class="btn btn-primary" id="tv-save-btn" ${bindAction('click',()=>saveTriageVitals(a.id,{returnToDetails}))}>${hasTriageVitals(v)?'Save changes':'Save vital signs'}</button>
    </div>
  </div>`);
  updateTriageFlags();
}

// A corrected reading clears its own error message while typing.
function clearTriageError(input){
  if(!input?.id)return;
  input.removeAttribute('aria-invalid');
  const el=document.getElementById(input.id+'-error');if(el){el.hidden=true;el.textContent='';}
}

function updateTriageFlags(){
  const read=key=>document.getElementById('tv-'+key)?.value||'';
  const flags=clinicalChecks.vitalStatus(Object.fromEntries(TRIAGE_VITAL_FIELDS.map(([key])=>[key,read(key)])));
  for(const [key] of TRIAGE_VITAL_FIELDS){
    const wrap=document.querySelector(`.tv-vital[data-vital="${key}"]`),flag=wrap?.querySelector('.tv-flag');if(!flag)continue;
    const f=flags[key];flag.hidden=!f;flag.textContent=f?.label||'';flag.className='tv-flag '+(f?.level||'');
    wrap.classList.toggle('flagged',Boolean(f)&&f.level!=='normal');
  }
}

export async function saveTriageVitals(apptId,{returnToDetails=false}={}){
  const a=appointmentRecords().find(x=>x.id===Number(apptId));if(!a)return;
  const msg=document.getElementById('tv-msg'),btn=document.getElementById('tv-save-btn');
  hideAlert(msg);
  const input=Object.fromEntries(TRIAGE_VITAL_FIELDS.map(([key])=>[key,document.getElementById('tv-'+key)?.value||'']));
  const errors=triageVitalErrors(input);
  for(const [key] of TRIAGE_VITAL_FIELDS){const el=document.getElementById(`tv-${key}-error`);if(el){el.hidden=true;el.textContent='';}document.getElementById('tv-'+key)?.removeAttribute('aria-invalid');}
  if(Object.keys(errors).length){
    for(const [key,message] of Object.entries(errors)){
      const el=document.getElementById(`tv-${key}-error`);
      if(el){el.textContent=message;el.hidden=false;document.getElementById('tv-'+key)?.setAttribute('aria-invalid','true');}
      else showAlert(msg,message);
    }
    return;
  }
  const vitals=cleanTriageVitals(input),had=hasTriageVitals(a.triageVitals);
  const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    if(appState.auth.currentUser?._realSupabase){
      await appointmentAction({action:'vitals',appointment_id:a.dbAppointmentId,vitals});
      await syncRealAppointments();
    }else{
      const now=new Date().toISOString(),me=appState.auth.currentUser.id,prev=a.triageVitals||{};
      a.triageVitals={...vitals,recordedBy:prev.recordedBy||me,recordedAt:prev.recordedAt||now,updatedBy:me,updatedAt:now};
      auditLog(had?'APPOINTMENT_VITALS_UPDATED':'APPOINTMENT_VITALS_RECORDED',`Triage vital signs ${had?'updated':'recorded'} for appointment #${appointmentDisplayId(a)}.`,'Appointment',a.id);
      persistDB();
    }
    toast(had?'Vital signs updated.':'Vital signs saved. The doctor can see them now.','success');
    closeAllModals();
    if(document.getElementById('appt-table'))renderApptTable();
    if(returnToDetails)viewAppt(a.id);
  }catch(e){
    console.error('Triage vitals save:',e);
    showAlert(msg,e?.message||'Unable to save the vital signs.');
  }finally{
    if(btn&&document.body.contains(btn)){btn.disabled=false;btn.textContent=old||'Save vital signs';}
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
