// patientRecords: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {syncTreatmentContext,treatmentDisplayId,treatmentRecords} from './treatmentService.js';
import {escapeHtml} from './issueReports.js';
import {collegeBadge,fmtDate} from './inputValidation.js';
import {getUserById} from './documentScanner.js';
import {downloadTreatmentPDF,viewTreatment} from './treatmentForm.js';
import {docName} from './displayNames.js';
import {paginate,pagerHtml} from '../ui/pager.js';
import {bindAction} from '../dependencies.js';
import {patientAction,syncCurrentPatientFromSupabase} from './patientService.js';
import {toast} from './theme.js';
// ================================================================
// PATIENT – MY RECORDS
// ================================================================
export async function renderMyRecords(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncTreatmentContext();}
    catch(e){
      if(!isCampusPageCurrent('my-records',pageToken))return;
      console.error('My Records sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load your health records.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderMyRecords()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('my-records',pageToken))return;
  }

  const pt=appState.auth.currentPatient;
  if(!pt){c.innerHTML='<div class="alert alert-warning show">No patient record found.</div>';return;}
  const treats=treatmentRecords()
    .filter(t=>t.patientId===pt.id&&!t.archived)
    .slice()
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.id-a.id);

  const today=appState.clinicInformation.TODAY;
  const meds=(appState.data.DB.medReminders||[]).filter(r=>r.patientId===pt.id&&r.status==='active'&&r.endDate>=today).sort((a,b)=>String(a.endDate).localeCompare(String(b.endDate)));
  c.innerHTML=`
    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-header"><h3>Personal Information</h3></div>
        <div style="font-size:.83rem">
          <div class="info-row"><span class="info-label">Full Name</span><span class="info-val">${escapeHtml(pt.fname)} ${escapeHtml(pt.lname)}</span></div>
          <div class="info-row"><span class="info-label">Age</span><span class="info-val">${pt.age||'—'}</span></div>
          <div class="info-row"><span class="info-label">Gender</span><span class="info-val">${escapeHtml(pt.gender||'—')}</span></div>
          <div class="info-row"><span class="info-label">College</span><span class="info-val">${pt.college?collegeBadge(pt.college):'—'}</span></div>
          <div class="info-row"><span class="info-label">ID No.</span><span class="info-val">${escapeHtml(pt.idNo||'—')}</span></div>
        </div>
      </div>
      ${healthInfoCard(pt,false)}
    </div>
    <div class="card">
      <div class="card-header"><h3>Current Medications</h3></div>
      ${meds.length?`<div class="table-wrap"><table>
        <thead><tr><th>Medicine</th><th>How to take</th><th>From</th><th>Until</th></tr></thead>
        <tbody>${meds.map(r=>`<tr><td><strong>${escapeHtml(r.medicationName)}</strong></td><td>${escapeHtml(r.dosage||'As prescribed')}</td><td>${fmtDate(r.startDate)}</td><td>${fmtDate(r.endDate)}</td></tr>`).join('')}</tbody>
      </table></div>`:'<div class="empty-state"><p>No medicines to take right now.</p></div>'}
    </div>
    <div class="card">
      <div class="card-header"><h3>Visit History</h3></div>
      <div id="my-treat-list"></div>
    </div>`;
  appState.patientRecords.treatments=treats;
  renderMyTreatmentHistory();
}

const BLOOD_TYPES=['Unknown','A+','A-','B+','B-','AB+','AB-','O+','O-'];

// Read-only by default; the Edit button swaps the values for form fields.
function healthInfoCard(pt,editing){
  const blood=pt.blood&&pt.blood!=='Unknown'?pt.blood:'';
  if(!editing){
    return `<div class="card" id="mr-health-card">
        <div class="card-header"><h3>Health Information</h3>
          <button class="btn btn-sm" ${bindAction('click',()=>toggleHealthEdit(true))}>Edit</button></div>
        <div id="mr-health-msg"></div>
        <div style="font-size:.83rem">
          <div class="info-row"><span class="info-label">Blood Type</span><span class="info-val">${escapeHtml(blood||'—')}</span></div>
          <div class="info-row"><span class="info-label">Height</span><span class="info-val">${pt.height?`${escapeHtml(String(pt.height).replace(/[^\d.]/g,''))} cm`:'—'}</span></div>
          <div class="info-row"><span class="info-label">Weight</span><span class="info-val">${pt.weight?`${escapeHtml(String(pt.weight).replace(/[^\d.]/g,''))} kg`:'—'}</span></div>
          <div class="info-row"><span class="info-label">Allergies</span><span class="info-val text-danger">${escapeHtml(pt.allergies?.trim()||'—')}</span></div>
          <div class="info-row"><span class="info-label">Medical History</span><span class="info-val">${escapeHtml(pt.medHistory?.trim()||'—')}</span></div>
        </div>
      </div>`;
  }
  return `<div class="card" id="mr-health-card">
        <div class="card-header"><h3>Health Information</h3></div>
        <div id="mr-health-msg"></div>
        <div class="form-group"><label for="mr-blood">Blood Type</label><select id="mr-blood">${BLOOD_TYPES.map(b=>`<option ${String(pt.blood||'Unknown')===b?'selected':''}>${b}</option>`).join('')}</select></div>
        <div class="form-row">
          <div class="form-group"><label for="mr-height">Height (cm)</label><input id="mr-height" type="number" inputmode="decimal" min="40" max="260" step=".1" value="${escapeHtml(String(pt.height||'').replace(/[^\d.]/g,''))}"></div>
          <div class="form-group"><label for="mr-weight">Weight (kg)</label><input id="mr-weight" type="number" inputmode="decimal" min="1" max="500" step=".1" value="${escapeHtml(String(pt.weight||'').replace(/[^\d.]/g,''))}"></div>
        </div>
        <div class="form-group"><label for="mr-allergies">Allergies</label><input id="mr-allergies" maxlength="300" value="${escapeHtml(pt.allergies?.trim()||'')}" placeholder="e.g. Penicillin, shrimp, or None"></div>
        <div class="form-group"><label for="mr-history">Medical History</label><textarea id="mr-history" maxlength="5000" rows="4" placeholder="Past illnesses, surgeries, maintenance medicines">${escapeHtml(pt.medHistory?.trim()||'')}</textarea></div>
        <div class="td-actions">
          <button class="btn btn-primary btn-sm" id="mr-health-save" ${bindAction('click',()=>saveMyHealthInfo())}>Save Changes</button>
          <button class="btn btn-sm" ${bindAction('click',()=>toggleHealthEdit(false))}>Cancel</button>
        </div>
      </div>`;
}

function toggleHealthEdit(editing){
  const pt=appState.auth.currentPatient;
  const card=document.getElementById('mr-health-card');
  if(pt&&card)card.outerHTML=healthInfoCard(pt,editing);
}

// The self_update endpoint replaces every field, so unchanged values are sent back as they are.
async function saveMyHealthInfo(){
  const pt=appState.auth.currentPatient;if(!pt)return;
  const btn=document.getElementById('mr-health-save');
  const msg=document.getElementById('mr-health-msg');
  const num=v=>String(v||'').replace(/[^\d.]/g,'');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    await patientAction({action:'self_update',address:pt.address||'',emergency_contact_name:pt.emergencyName||'',
      emergency_contact_number:pt.emergencyContact||'',blood_type:document.getElementById('mr-blood').value||'Unknown',height_cm:num(document.getElementById('mr-height').value),weight_kg:num(document.getElementById('mr-weight').value),
      allergies:document.getElementById('mr-allergies').value.trim(),medical_history:document.getElementById('mr-history').value.trim(),
      course:pt.course||'',major:pt.major||''});
    await syncCurrentPatientFromSupabase();
    toast('Your health information was saved.','success');
    renderMyRecords();
  }catch(error){
    if(msg)msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(error?.message||'Your health information could not be saved.')}</div>`;
    if(btn){btn.disabled=false;btn.textContent='Save Changes';}
  }
}

// Visit history is paged like the clinic lists.
function renderMyTreatmentHistory(){
  const el=document.getElementById('my-treat-list');if(!el)return;
  const treats=appState.patientRecords.treatments||[];
  const page=paginate('my-records',treats);
  el.innerHTML=treats.length?`<div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Date</th><th>Diagnosis</th><th>Prescription</th><th>Doctor</th><th>Follow-up</th><th>Actions</th></tr></thead>
        <tbody>${page.rows.map(t=>{
          const doc=getUserById(t.doctorId);
          return `<tr style="cursor:pointer" ${bindAction('click',(event,element)=>{viewTreatment((t.id))})} title="Open visit record">
            <td>#${treatmentDisplayId(t)}</td>
            <td>${fmtDate(t.date)}</td>
            <td>${escapeHtml(t.diagnosis)}${t.dentalRecord?'<br><span class="badge badge-info">Dental Record</span>':''}</td>
            <td style="max-width:180px">${escapeHtml(t.prescription||'—')}</td>
            <td>${doc?escapeHtml(docName(doc)):'Doctor'}</td>
            <td>${t.followupDate?fmtDate(t.followupDate):'—'}</td>
            <td><div class="td-actions" ${bindAction('click',(event,element)=>{event.stopPropagation()})}>
              <button class="btn btn-xs" ${bindAction('click',(event,element)=>{viewTreatment((t.id))})}>View</button>
              <button class="btn btn-xs btn-primary" ${bindAction('click',(event,element)=>{downloadTreatmentPDF((t.id))})}>Download PDF</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>${pagerHtml(page,renderMyTreatmentHistory)}`:'<div class="empty-state"><p>No visits recorded yet.</p></div>';
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
