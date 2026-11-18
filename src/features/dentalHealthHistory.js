// Dental Health History Form (the clinic's paper form, online).
// Patients answer it after booking a dental appointment (or confirm nothing changed this semester); at check-in
// Dental Clinic staff hand the patient a device or record the paper form; dentists review the answers.
// Answers never reach staff or administrators: they only see whether it is done.
import {state as appState} from '../app/state.js';
import {appointmentRecords} from './appointmentService.js';
import {closeAllModals,closeTopModal,openModal as openBaseModal} from './modals.js';
import {escapeHtml} from './issueReports.js';
import {showConfirmDialog,toast} from './theme.js';
import {fmtDate,fmtTime} from './inputValidation.js';
import {printCtuDocument} from '../shared/ctu-letterhead.js';
import {bindAction} from '../dependencies.js';
import {DHH_DECLARATION,DHH_PHYSICIAN_FIELDS,DHH_SECTIONS,dhhAlerts,unansweredCount} from '../../supabase/functions/_shared/dental-health-history.js';

const OPEN_STATUSES=['Pending','Scheduled','Confirmed'];
// These dialogs open on top of the dialog they were opened from (such as the visit form) and close back to it.
const openModal=html=>openBaseModal(html,{preserveParent:Boolean(appState.clinicInformation.activeModal?.isConnected)});
// Status per appointment (UI id), refreshed whenever a list or detail view asks for it.
const statusCache=new Map();
const isDentalOpen=a=>a?.clinic==='Dental Clinic'&&OPEN_STATUSES.includes(a.status);
const viewer=()=>appState.auth.currentUser||{};
const isDentist=()=>viewer().role==='Doctor'&&viewer().specialty==='Dental';
const isDentalStaff=()=>viewer().role==='Staff'&&viewer().clinic==='Dental Clinic';
const findAppointment=id=>appointmentRecords().find(a=>a.id===Number(id));

async function dhhRequest(payload){
  const client=appState.supabaseClient.supabaseClient;
  const {data:{session}}=await client.auth.getSession();
  if(!session)throw new Error('Your session expired. Log in again.');
  const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/dental-health-history`,{method:'POST',
    headers:{'Content-Type':'application/json',apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(payload)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'The Dental Health History could not be loaded.');
  return result;
}

// ---------- Status badges and panels ----------
export async function loadHealthHistoryStatuses(appointments){
  if(!viewer()._realSupabase)return statusCache;
  const dental=appointments.filter(a=>a.clinic==='Dental Clinic'&&a.dbAppointmentId);
  if(!dental.length)return statusCache;
  const {statuses={}}=await dhhRequest({action:'status',appointment_ids:dental.map(a=>a.dbAppointmentId)});
  for(const a of dental)if(statuses[a.dbAppointmentId])statusCache.set(a.id,statuses[a.dbAppointmentId]);
  return statusCache;
}
// A placeholder filled in by fillHealthHistorySlots once the status is known.
export function healthHistorySlotHtml(a,kind='badge'){
  return a?.clinic==='Dental Clinic'&&viewer()._realSupabase?`<div class="dhh-slot dhh-slot-${kind}" data-dhh-appt="${a.id}" data-dhh-kind="${kind}"></div>`:'';
}
export async function fillHealthHistorySlots(root=document){
  const slots=[...root.querySelectorAll('.dhh-slot[data-dhh-appt]')];
  if(!slots.length)return;
  const appointments=[...new Set(slots.map(slot=>Number(slot.dataset.dhhAppt)))].map(findAppointment).filter(Boolean);
  try{await loadHealthHistoryStatuses(appointments);}catch(error){console.warn('Dental health history status:',error);return;}
  for(const slot of slots){
    const a=findAppointment(slot.dataset.dhhAppt),info=statusCache.get(Number(slot.dataset.dhhAppt));
    if(!a||!info||!slot.isConnected)continue;
    slot.innerHTML=slot.dataset.dhhKind==='panel'?panelHtml(a,info):badgeHtml(a,info);
  }
}
function badgeHtml(a,info){
  if(info.status==='done')return `<span class="badge badge-success dhh-badge"><i class="bi bi-clipboard2-check" aria-hidden="true"></i> Health history done</span>`;
  if(!isDentalOpen(a))return '';
  const label=info.status==='confirm'?'Confirm health history':'Answer health history';
  return viewer().role==='Patient'
    ?`<button class="btn btn-xs btn-warning dhh-badge" ${bindAction('click',event=>{event.stopPropagation();openPatientHealthHistory(a.id);})}><i class="bi bi-clipboard2-pulse" aria-hidden="true"></i> ${label}</button>`
    :`<span class="badge badge-warning dhh-badge">Health history not yet answered</span>`;
}
function panelHtml(a,info){
  const when=info.at?fmtDate(String(info.at).slice(0,10)):'';
  const how={online:'online',['check-in']:'at check-in',paper:'on the paper form'}[info.source]||'';
  const done=info.status==='done';
  const role=viewer().role;
  const text=done?`Answered ${how}${when?' on '+escapeHtml(when):''}${info.reviewed?' · reviewed by the dentist':''}.`
    :info.status==='confirm'?'Answered earlier this semester. The patient still needs to confirm nothing has changed.':'Not yet answered.';
  const actions=[];
  if(isDentist()&&(done||info.status==='confirm'))actions.push(`<button class="btn btn-sm btn-primary" ${bindAction('click',()=>openDentistHealthHistory(a.id))}><i class="bi bi-clipboard2-pulse" aria-hidden="true"></i> ${done&&info.source==='paper'?'Details':'Review answers'}${info.alerts?` <span class="badge badge-danger">${info.alerts}</span>`:''}</button>`);
  if(!done&&isDentalOpen(a)&&(isDentalStaff()||isDentist())){
    actions.push(`<button class="btn btn-sm" ${bindAction('click',()=>openHealthHistoryForm(a.id,{mode:'check-in'}))}><i class="bi bi-tablet" aria-hidden="true"></i> Patient answers on this device</button>`);
    actions.push(`<button class="btn btn-sm" ${bindAction('click',()=>recordPaperForm(a.id))}><i class="bi bi-file-earmark-text" aria-hidden="true"></i> Answered on paper</button>`);
  }
  if(role==='Patient'&&isDentalOpen(a))actions.push(`<button class="btn btn-sm ${done?'':'btn-primary'}" ${bindAction('click',()=>openPatientHealthHistory(a.id))}>${done?'View or update answers':info.status==='confirm'?'Confirm my health history':'Answer now'}</button>`);
  return `<section class="dhh-panel ${done?'done':'todo'}" aria-label="Dental Health History">
    <div class="dhh-panel-head"><i class="bi ${done?'bi-clipboard2-check':'bi-clipboard2-pulse'}" aria-hidden="true"></i><div><strong>Dental Health History</strong><p>${text}</p></div></div>
    ${actions.length?`<div class="dhh-panel-actions">${actions.join('')}</div>`:''}
  </section>`;
}
async function refreshAfterChange(id){
  statusCache.delete(Number(id));
  await fillHealthHistorySlots();
}

// ---------- Patient entry point ----------
export async function openPatientHealthHistory(id){
  const a=findAppointment(id);if(!a?.dbAppointmentId)return;
  try{
    const data=await dhhRequest({action:'get',appointment_id:a.dbAppointmentId});
    if(data.status.status==='confirm'&&data.previous)return showConfirmUnchanged(a,data);
    openHealthHistoryForm(id,{mode:'online',data,values:data.history||null});
  }catch(error){toast(error.message,'error');}
}
function showConfirmUnchanged(a,data){
  const prev=data.previous,alerts=dhhAlerts(prev.answers);
  openModal(`<div class="modal dhh-confirm" role="dialog" aria-labelledby="dhh-confirm-title">
    <div class="modal-header"><div><h3 id="dhh-confirm-title">Dental Health History</h3><div class="text-muted">${escapeHtml(fmtDate(a.date))} · ${escapeHtml(fmtTime(a.time))}</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body">
      <p>You answered the Dental Health History on <strong>${escapeHtml(fmtDate(String(prev.created_at).slice(0,10)))}</strong>. Has anything about your health or medicines changed since then?</p>
      ${alerts.length?`<p class="text-muted">You told us about: ${alerts.map(x=>escapeHtml(x.label)).join(', ')}.</p>`:''}
      <label class="dhh-declare"><input type="checkbox" id="dhh-confirm-attest"> <span>Nothing has changed. ${escapeHtml(DHH_DECLARATION)}</span></label>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',()=>{closeTopModal();void openHealthHistoryForm(a.id,{mode:'online',data,values:prev});})}>Something changed: update my answers</button>
      <button class="btn btn-primary" ${bindAction('click',async(event,element)=>{
        if(!document.getElementById('dhh-confirm-attest')?.checked){toast('Tick the box to confirm nothing has changed.','warning');return;}
        element.disabled=true;
        try{await dhhRequest({action:'confirm',appointment_id:a.dbAppointmentId,attested:true});closeTopModal();toast('Thank you. Your Dental Health History is confirmed for this visit.','success');await refreshAfterChange(a.id);}
        catch(error){toast(error.message,'error');element.disabled=false;}
      })}>Confirm nothing changed</button>
    </div></div>`);
}

// ---------- The form ----------
const ageOn=birth=>{if(!birth)return '';const b=new Date(birth+'T00:00:00'),t=new Date();let age=t.getFullYear()-b.getFullYear();if(t<new Date(t.getFullYear(),b.getMonth(),b.getDate()))age--;return age>=0?age:'';};
function questionHtml([n,text,detail],values){
  const answer=values?.answers?.[n]||'';
  const choice=v=>`<button type="button" class="dhh-choice ${answer===v?'on':''}" data-choice="${v}" aria-pressed="${answer===v}" ${bindAction('click',(event,element)=>chooseAnswer(element))}>${v}</button>`;
  const extra=detail?`<input class="dhh-detail" data-detail="${detail.key}" maxlength="500" placeholder="${escapeHtml(detail.label)}" aria-label="${escapeHtml(detail.label)}" value="${escapeHtml(values?.details?.[detail.key]||'')}" ${answer==='Yes'?'':'hidden'}>`:'';
  const physician=n===4?`<div class="dhh-physician" ${answer==='Yes'?'':'hidden'}>${DHH_PHYSICIAN_FIELDS.map(([key,label])=>`<input class="dhh-detail" data-detail="${key}" maxlength="200" placeholder="${label}" aria-label="${label}" value="${escapeHtml(values?.details?.[key]||'')}">`).join('')}</div>`:'';
  return `<div class="dhh-q" data-q="${n}" data-answer="${answer}"><span class="dhh-n">${n}.</span><div class="dhh-text"><span id="dhh-q-${n}">${escapeHtml(text)}</span>${extra}${physician}</div><div class="dhh-choices" role="group" aria-labelledby="dhh-q-${n}">${choice('Yes')}${choice('No')}</div></div>`;
}
// Click Yes or No; click the same answer again to leave the question blank.
function chooseAnswer(button){
  const row=button.closest('.dhh-q'),value=row.dataset.answer===button.dataset.choice?'':button.dataset.choice;
  row.dataset.answer=value;
  row.querySelectorAll('.dhh-choice').forEach(b=>{const on=b.dataset.choice===value;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
  // The follow-up line (and the physician's details for question 4) only apply to a Yes.
  row.querySelectorAll(':scope > .dhh-text > .dhh-detail, :scope > .dhh-text > .dhh-physician').forEach(el=>{el.hidden=value!=='Yes';});
}
export async function openHealthHistoryForm(id,{mode='online',data=null,values=null}={}){
  const a=findAppointment(id);if(!a?.dbAppointmentId)return;
  try{
    if(!data)data=await dhhRequest({action:mode==='check-in'?'form':'get',appointment_id:a.dbAppointmentId});
  }catch(error){toast(error.message,'error');return;}
  // At check-in the form always starts blank, so earlier answers are never shown on a staff device.
  if(mode==='check-in')values=null;
  const p=data.patient||{},female=p.female!==false;
  const sections=DHH_SECTIONS.filter(section=>female||!section.women);
  openModal(`<div class="modal modal-xl dhh-modal" role="dialog" aria-labelledby="dhh-title">
    <div class="modal-header"><div><h3 id="dhh-title">Dental Health History Form</h3><div class="text-muted">Dental Clinic · ${escapeHtml(fmtDate(a.date))} · ${escapeHtml(fmtTime(a.time))}</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body">
      ${mode==='check-in'?'<div class="alert alert-info show"><i class="bi bi-tablet" aria-hidden="true"></i> Please hand this device to the patient. Their answers go only to the dentist.</div>':'<p class="dhh-intro">Your answers help the dentist treat you safely. Only the dentists can see them. It takes about 5 minutes.</p>'}
      <div class="dhh-head">
        <div><span>Patient name</span><strong>${escapeHtml(p.name||'')}</strong></div>
        <div><span>Age</span><strong>${escapeHtml(String(ageOn(p.birth_date)))}</strong></div>
        <div><span>Birth date</span><strong>${p.birth_date?escapeHtml(fmtDate(p.birth_date)):'—'}</strong></div>
        <label><span>Height (cm)</span><input id="dhh-height" type="number" inputmode="decimal" min="50" max="250" step="0.1" value="${escapeHtml(values?.height_cm??p.height_cm??'')}"></label>
        <label><span>Weight (kg)</span><input id="dhh-weight" type="number" inputmode="decimal" min="20" max="300" step="0.1" value="${escapeHtml(values?.weight_kg??p.weight_kg??'')}"></label>
      </div>
      ${sections.map(section=>`<fieldset class="dhh-section"><legend>${section.id}. ${escapeHtml(section.title)}</legend>${section.questions.map(q=>questionHtml(q,values)).join('')}</fieldset>`).join('')}
      <label class="dhh-declare"><input type="checkbox" id="dhh-attest"> <span>${escapeHtml(DHH_DECLARATION)}</span></label>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeTopModal())}>${mode==='check-in'?'Cancel':'Later'}</button>
      <button class="btn btn-primary" id="dhh-submit" ${bindAction('click',()=>submitHealthHistory(a,mode,female))}>Submit</button></div>
  </div>`);
}
function collectForm(){
  const answers={},details={};
  document.querySelectorAll('.dhh-modal .dhh-q').forEach(row=>{if(row.dataset.answer)answers[row.dataset.q]=row.dataset.answer;});
  document.querySelectorAll('.dhh-modal .dhh-detail').forEach(input=>{if(input.value.trim())details[input.dataset.detail]=input.value.trim();});
  return {answers,details,height_cm:document.getElementById('dhh-height')?.value||'',weight_kg:document.getElementById('dhh-weight')?.value||''};
}
async function submitHealthHistory(a,mode,female){
  const form=collectForm();
  if(!Object.keys(form.answers).length){toast('Answer the questions before submitting.','warning');return;}
  if(!document.getElementById('dhh-attest')?.checked){toast('Tick the declaration at the end of the form.','warning');document.getElementById('dhh-attest')?.focus();return;}
  const send=async()=>{
    const button=document.getElementById('dhh-submit');if(button)button.disabled=true;
    try{
      await dhhRequest({action:'submit',mode,appointment_id:a.dbAppointmentId,attested:true,...form});
      // Back to the dialog it was opened from (the visit form or appointment), not closing everything.
      closeTopModal();
      toast(mode==='check-in'?'Thank you. The Dental Health History is saved for the dentist.':'Thank you. Your Dental Health History is saved for your visit.','success');
      await refreshAfterChange(a.id);
    }catch(error){toast(error.message,'error');if(button)button.disabled=false;}
  };
  const blank=unansweredCount(form.answers,{female});
  if(blank)showConfirmDialog({title:'Some questions are blank',message:`${blank} question${blank===1?' is':'s are'} left blank. Blank answers mean you did not understand the question; the dentist will ask you about them. Submit anyway?`,confirmLabel:'Submit',layered:true,onConfirm:send});
  else await send();
}

// ---------- Staff: the paper form was used ----------
function recordPaperForm(id){
  const a=findAppointment(id);if(!a?.dbAppointmentId)return;
  showConfirmDialog({title:'Answered on paper',message:'Record that the patient filled in the paper Dental Health History Form for this visit? Give the paper form to the dentist.',confirmLabel:'Record',layered:true,
    onConfirm:async()=>{try{await dhhRequest({action:'paper',appointment_id:a.dbAppointmentId});toast('Recorded: answered on the paper form.','success');await refreshAfterChange(a.id);}catch(error){toast(error.message,'error');}}});
}

// ---------- Dentist review ----------
export async function openDentistHealthHistory(id){
  const a=findAppointment(id);if(!a?.dbAppointmentId)return;
  let data;
  try{data=await dhhRequest({action:'get',appointment_id:a.dbAppointmentId});}catch(error){toast(error.message,'error');return;}
  const h=data.history,p=data.patient||{};
  if(!h){toast('The patient has not answered the Dental Health History yet.','info');return;}
  const forThisVisit=Number(h.appointment_id)===a.dbAppointmentId;
  const paper=h.source==='paper';
  const sections=DHH_SECTIONS.filter(section=>p.female!==false||!section.women);
  const alertSet=new Set(data.alerts.map(x=>x.n));
  const answerCell=n=>{const v=h.answers?.[n];return v?`<span class="dhh-ans ${v==='Yes'?'yes':'no'} ${alertSet.has(Number(n))?'alert':''}">${v}</span>`:'<span class="dhh-ans blank">—</span>';};
  const detail=key=>h.details?.[key]?`<div class="dhh-ans-detail">${escapeHtml(h.details[key])}</div>`:'';
  openModal(`<div class="modal modal-xl dhh-review" role="dialog" aria-labelledby="dhh-review-title">
    <div class="modal-header"><div><h3 id="dhh-review-title">Dental Health History · ${escapeHtml(p.name||'')}</h3><div class="text-muted">${paper?'Answered on the paper form':`${h.confirmed_unchanged?'Confirmed unchanged':'Answered'} ${h.source==='check-in'?'at check-in':'online'}`} on ${escapeHtml(fmtDate(String(h.created_at).slice(0,10)))}${forThisVisit?'':' · from an earlier visit'}${h.reviewed_at?` · reviewed ${escapeHtml(fmtDate(String(h.reviewed_at).slice(0,10)))}`:''}</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body">
      ${paper?'<p>The patient answered the paper Dental Health History Form. Review it before treatment.</p>':`
      ${data.alerts.length?`<div class="dhh-alerts" role="alert"><strong><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> Check before treatment</strong><ul>${data.alerts.map(x=>`<li><b>${x.n}.</b> ${escapeHtml(x.label)}</li>`).join('')}</ul></div>`:'<div class="dhh-alerts ok"><i class="bi bi-check-circle" aria-hidden="true"></i> No answers that need checking before treatment.</div>'}
      <div class="dhh-head"><div><span>Age</span><strong>${escapeHtml(String(ageOn(p.birth_date)))}</strong></div><div><span>Birth date</span><strong>${p.birth_date?escapeHtml(fmtDate(p.birth_date)):'—'}</strong></div><div><span>Height</span><strong>${h.height_cm?escapeHtml(h.height_cm)+' cm':'—'}</strong></div><div><span>Weight</span><strong>${h.weight_kg?escapeHtml(h.weight_kg)+' kg':'—'}</strong></div></div>
      ${sections.map(section=>`<fieldset class="dhh-section"><legend>${section.id}. ${escapeHtml(section.title)}</legend>${section.questions.map(([n,text,d])=>`<div class="dhh-q review ${alertSet.has(n)?'alert':''}"><span class="dhh-n">${n}.</span><div class="dhh-text">${escapeHtml(text)}${d?detail(d.key):''}${n===4?DHH_PHYSICIAN_FIELDS.map(([key,label])=>h.details?.[key]?`<div class="dhh-ans-detail">${label}: ${escapeHtml(h.details[key])}</div>`:'').join(''):''}</div>${answerCell(n)}</div>`).join('')}</fieldset>`).join('')}`}
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeTopModal())}>Close</button>
      ${paper?'':`<button class="btn btn-info" ${bindAction('click',()=>printHealthHistory(p,h))}><i class="bi bi-printer" aria-hidden="true"></i> Print for signature</button>`}
      ${forThisVisit&&!h.reviewed_at?`<button class="btn btn-primary" ${bindAction('click',async(event,element)=>{element.disabled=true;try{await dhhRequest({action:'review',appointment_id:a.dbAppointmentId});closeTopModal();toast('Marked as reviewed.','success');await refreshAfterChange(a.id);}catch(error){toast(error.message,'error');element.disabled=false;}})}><i class="bi bi-check2" aria-hidden="true"></i> Mark reviewed</button>`:''}
    </div></div>`);
}

// ---------- Print, laid out like the paper form ----------
// The paper form keeps its content in a centred block: patient lines, then each section's questions
// (two columns for II–V, filled top to bottom), with "Yes No" before each question and the chosen answer circled.
const PRINT_CSS=`.dhh-p{width:92%;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.28}
  .dhh-p-title{text-align:center;font-weight:700;font-size:14px;margin:0 0 9px}
  .dhh-p-line{display:flex;flex-wrap:wrap;gap:3px 16px;margin:3px 0;font-size:11px}
  .dhh-p .fill{display:inline-block;min-width:80px;border-bottom:1px solid #111;padding:0 4px;vertical-align:bottom}
  .dhh-p-sec{margin:8px 0 2px;font-size:11.5px;font-weight:700}
  .dhh-p-body{padding-left:18px}
  .dhh-p-cols{display:grid;grid-template-columns:1fr 1fr;column-gap:18px}
  .dhh-p-q{display:flex;gap:5px;align-items:baseline;font-size:10.5px;margin:1.5px 0;break-inside:avoid}
  .dhh-p-q .n{min-width:20px;text-align:right}
  .dhh-p-q .yn{white-space:nowrap;flex:none}
  .dhh-p-q .yn i{font-style:normal;display:inline-block;padding:0 3px;margin-right:2px;border:1px solid transparent;border-radius:50%}
  .dhh-p-q .yn i.on{border-color:#111}
  .dhh-p-sub{font-size:10.5px;margin:1px 0 2px 92px}
  .dhh-p-page2{width:92%;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111}
  .dhh-p-page2 .fill{display:inline-block;border-bottom:1px solid #111;padding:0 4px;min-width:360px}
  .dhh-p-declare{margin:6px 0 34px;line-height:1.5}
  .dhh-p-sign{display:flex;gap:40px;margin-top:10px}.dhh-p-sign .fill{min-width:220px}`;
export function healthHistoryPrintPages(p,h){
  const answers=h.answers||{},details=h.details||{};
  const fill=(value,width)=>`<span class="fill"${width?` style="min-width:${width}px"`:''}>${escapeHtml(value||'')}&nbsp;</span>`;
  const yn=n=>`<span class="yn"><i class="${answers[n]==='Yes'?'on':''}">Yes</i><i class="${answers[n]==='No'?'on':''}">No</i></span>`;
  const sub=html=>`<div class="dhh-p-sub">${html}</div>`;
  // Follow-up lines in the same places as on the paper form.
  const extras={
    3:sub(`Why? ${fill(details.hospitalized_why,300)}`),
    5:sub(`Physician Name: ${fill(details.physician_name,150)} &nbsp; Address: ${fill(details.physician_address,150)}`)+sub(`Telephone Number: ${fill(details.physician_phone,150)}`),
    43:sub(`Please list: ${fill(details.medicines,200)}`)
  };
  const q=([n,text])=>`<div class="dhh-p-q"><span class="n">${n}.</span>${yn(n)}<span>${escapeHtml(text)}${n===4?` For what? ${fill(details.physician_for,150)}`:''}</span></div>${extras[n]||''}`;
  const half=list=>[list.slice(0,Math.ceil(list.length/2)),list.slice(Math.ceil(list.length/2))];
  const twoColumns=new Set(['II','III','IV','V']);
  const section=s=>`<div class="dhh-p-sec">${s.id}. ${escapeHtml(s.id==='I'?'Encircle appropriate answer (leave blank if you do not understand question).':s.id==='VI'?'Women only:':s.id==='VII'?'All patients:':s.title)}</div>
    <div class="dhh-p-body">${twoColumns.has(s.id)?`<div class="dhh-p-cols">${half(s.questions).map(col=>`<div>${col.map(q).join('')}</div>`).join('')}</div>`:s.questions.map(q).join('')}</div>`;
  const signed=h.created_at?fmtDate(String(h.created_at).slice(0,10)):'';
  const page1=`<div class="dhh-p"><div class="dhh-p-title">Dental Health History Form</div>
    <div class="dhh-p-line"><span>Patient Name: ${fill(p.name,360)}</span></div>
    <div class="dhh-p-line"><span>Age: ${fill(String(ageOn(p.birth_date)),50)}</span><span>Height: ${fill(h.height_cm?`${h.height_cm} cm`:'',70)}</span><span>Weight: ${fill(h.weight_kg?`${h.weight_kg} kg`:'',70)}</span><span>Birth Date: ${fill(p.birth_date?fmtDate(p.birth_date):'',110)}</span></div>
    ${DHH_SECTIONS.map(section).join('')}</div>`;
  const page2=`<div class="dhh-p-page2">
    <p>If so, please explain: ${fill(details.other_explain)}</p>
    <div class="dhh-p-declare">${escapeHtml(DHH_DECLARATION)}</div>
    <div class="dhh-p-sign"><div>Patient's Signature: ${fill('')}</div><div>Date: ${fill(signed,150)}</div></div>
    ${signed?`<p style="font-size:10px;color:#555;margin-top:22px">Answered ${h.source==='check-in'?'at check-in':'online'} in CampusCare on ${escapeHtml(signed)}; the patient confirmed the declaration.</p>`:''}</div>`;
  return {css:PRINT_CSS,pages:[page1,page2]};
}
// The Dental Health History answered for a visit (database appointment id), for the dentist's printed
// dental record. Staff and other roles never receive the answers, so they get null.
export async function healthHistoryForAppointment(dbAppointmentId){
  if(!isDentist()||!viewer()._realSupabase||!dbAppointmentId)return null;
  try{
    const data=await dhhRequest({action:'get',appointment_id:dbAppointmentId});
    return data.history&&data.history.source!=='paper'?{patient:data.patient||{},history:data.history}:null;
  }catch(error){console.warn('Dental health history for the record:',error);return null;}
}
// The blank paper form (no answers), for the printed record when the answers are not available.
export function blankHealthHistoryPages(patientName=''){
  return healthHistoryPrintPages({name:patientName},{answers:{},details:{},created_at:''});
}
export function printHealthHistory(p,h){
  printCtuDocument({title:`Dental Health History ${p.name||''}`.trim(),clinic:'Dental Clinic',...healthHistoryPrintPages(p,h)});
}

// The booking confirmation's next step for a dental visit.
export function healthHistoryNextStepHtml(a){
  if(!a||a.clinic!=='Dental Clinic'||!viewer()._realSupabase)return '';
  return `<section class="dhh-next" aria-labelledby="dhh-next-title"><i class="bi bi-clipboard2-pulse" aria-hidden="true"></i>
    <div><h4 id="dhh-next-title">Next: your Dental Health History</h4><p>Answer the clinic's health questions before your visit (about 5 minutes). If you can't now, we'll remind you, or you can answer it at the clinic.</p>
    <button type="button" class="btn btn-primary btn-sm" ${bindAction('click',()=>{closeAllModals();openPatientHealthHistory(a.id);})}>Answer now</button></div></section>`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
