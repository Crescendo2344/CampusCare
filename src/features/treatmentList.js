// treatmentList: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {syncTreatmentContext,treatmentDisplayId,treatmentRecords} from './treatmentService.js';
import {escapeHtml} from './issueReports.js';
import {archiveTreat,isDentalTreatment,openAddTreatmentModalPt,restoreTreat,viewTreatment} from './treatmentForm.js';
import {getDoctors,getPatientById,getUserById} from './documentScanner.js';
import {unitFilterOptionsHtml} from './patientManagement.js';
import {patientDisplayId} from './patientService.js';
import * as clinicalChecks from '../domain/clinical-validation.js';
import {viewPatient} from './patientForm.js';
import {fmtDate} from './inputValidation.js';
import {docName} from './messaging.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// TREATMENTS
// ================================================================
export async function renderTreatments(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncTreatmentContext();}
    catch(e){
      if(!isCampusPageCurrent('treatments',pageToken))return;
      console.error('Treatments sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load treatment records.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderTreatments()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('treatments',pageToken))return;
  }

  const role=appState.auth.currentUser.role;
  const canAdd=role==='Doctor'||role==='Administrator';
  const ui=appState.treatmentList??={};
  ui.page=1;
  const doctors=role==='Doctor'?[]:getDoctors();
  c.innerHTML=`
    ${role==='Doctor'?'<p class="patient-filter-summary" style="margin:0 0 .6rem">Your visit notes. Other doctors\' notes are in each patient\'s record.</p>':''}
    <div class="toolbar tr-toolbar">
      <input type="search" placeholder="Search patient, ID, diagnosis or record #" aria-label="Search treatment records" id="tr-search" ${bindAction('input',()=>{ui.page=1;renderTreatTable()})}>
      <select id="tr-type" aria-label="Clinic" ${bindAction('change',()=>{ui.page=1;renderTreatTable()})}><option value="">All clinics</option><option>Medical Clinic</option><option>Dental Clinic</option></select>
      <select id="tr-college" aria-label="College or department" ${bindAction('change',()=>{ui.page=1;renderTreatTable()})}>${unitFilterOptionsHtml('')}</select>
      ${doctors.length?`<select id="tr-doctor" aria-label="Doctor" ${bindAction('change',()=>{ui.page=1;renderTreatTable()})}><option value="">All doctors</option>${doctors.map(d=>`<option value="${d.id}">${escapeHtml(docName(d))}</option>`).join('')}</select>`:''}
      <select id="tr-period" aria-label="Visit date" ${bindAction('change',()=>{ui.page=1;renderTreatTable()})}><option value="">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="followup">Follow-up due</option></select>
      <select id="tr-status" aria-label="Record status" ${bindAction('change',()=>{ui.page=1;renderTreatTable()})}>
        <option value="active">Active records</option>
        <option value="archived">Archived records</option>
        <option value="all">All records</option>
      </select>
      <button class="btn btn-sm" ${bindAction('click',()=>exportTreatmentsCsv())}><i class="bi bi-download" aria-hidden="true"></i> Export CSV</button>
      ${canAdd?`<button class="btn btn-primary btn-sm" ${bindAction('click',()=>{openAddTreatmentModalPt(null)})}>+ Add Treatment</button>`:''}
    </div>
    <p class="patient-filter-summary" id="tr-summary" role="status" aria-live="polite"></p>
    <div class="card"><div id="treat-table"></div></div>`;
  renderTreatTable();
}

const TREAT_PAGE_SIZE=25;
const clinicOf=t=>t.clinicType||(isDentalTreatment(t)?'Dental Clinic':'Medical Clinic');
const daysAgo=(today,n)=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);};
function filteredTreatments(){
  const value=id=>document.getElementById(id)?.value||'';
  const q=value('tr-search').trim().toLowerCase(),unit=value('tr-college'),type=value('tr-type'),period=value('tr-period'),status=value('tr-status')||'active';
  const doctor=Number(value('tr-doctor'))||0,role=appState.auth.currentUser.role,today=appState.clinicInformation.TODAY;
  return treatmentRecords().filter(t=>{
    const pt=getPatientById(t.patientId);
    const haystack=`${pt?`${pt.fname} ${pt.lname} ${pt.lname}, ${pt.fname} P-${patientDisplayId(pt)} ${pt.idNo||''}`:''} ${t.diagnosis||''} #${treatmentDisplayId(t)}`.toLowerCase();
    const clinic=clinicOf(t);
    const inPeriod=!period||(period==='followup'?Boolean(t.followupDate)&&t.followupDate<=today:t.date>=daysAgo(today,Number(period)));
    return (!q||haystack.includes(q))&&(!unit||pt?.college===unit)&&(!type||clinic===type)&&inPeriod
      &&(role!=='Doctor'||t.doctorId===appState.auth.currentUser.id)&&(!doctor||t.doctorId===doctor)
      &&(status==='all'||(status==='archived'?Boolean(t.archived):!t.archived));
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.id-a.id);
}

export function exportTreatmentsCsv(){
  const rows=filteredTreatments();
  const cell=v=>{const t=String(v??'');return /[",\n\r]/.test(t)||/^[=+\-@]/.test(t)?`"${(/^[=+\-@]/.test(t)?"'":'')+t.replace(/"/g,'""')}"`:t;};
  const lines=[['Record #','Visit date','Patient','Patient ID','College/Department','Clinic','Diagnosis','Doctor','Follow-up','Status']].concat(rows.map(t=>{
    const pt=getPatientById(t.patientId),doc=getUserById(t.doctorId);
    return [treatmentDisplayId(t),t.date,pt?`${pt.lname}, ${pt.fname}`:'',pt?`P-${patientDisplayId(pt)}`:'',pt?.college||'',clinicOf(t),t.diagnosis||'',doc?docName(doc):'',t.followupDate||'',t.archived?'Archived':'Active'];
  }));
  const url=URL.createObjectURL(new Blob(['﻿'+lines.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=Object.assign(document.createElement('a'),{href:url,download:`campuscare-treatments-${appState.clinicInformation.TODAY}.csv`});
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function renderTreatTable(){
  const el=document.getElementById('treat-table');
  if(!el)return;
  const ui=appState.treatmentList??={page:1};
  const all=filteredTreatments(),today=appState.clinicInformation.TODAY;
  const pages=Math.max(1,Math.ceil(all.length/TREAT_PAGE_SIZE));
  const page=Math.min(Math.max(1,ui.page||1),pages);ui.page=page;
  const rows=all.slice((page-1)*TREAT_PAGE_SIZE,page*TREAT_PAGE_SIZE);
  const due=all.filter(t=>!t.archived&&t.followupDate&&t.followupDate<=today).length;
  const summary=document.getElementById('tr-summary');
  if(summary)summary.textContent=`${all.length} record${all.length===1?'':'s'}${due?` · ${due} follow-up${due===1?'':'s'} due`:''}`;
  if(!all.length){
    el.innerHTML='<div class="empty-state"><i class="bi bi-journal-medical" aria-hidden="true" style="font-size:1.6rem"></i><p>No treatment records match these filters.</p></div>';
    return;
  }
  const followUp=t=>{
    if(!t.followupDate)return '<span class="text-muted">—</span>';
    const state=t.archived?'':clinicalChecks.followUpState(t.followupDate,today);
    const chip={overdue:'<span class="tr-due overdue">Overdue</span>',today:'<span class="tr-due today">Due today</span>'}[state]||'';
    return `${fmtDate(t.followupDate)}${chip}`;
  };
  const pager=pages>1?`<div class="pt-pager"><span>Showing ${(page-1)*TREAT_PAGE_SIZE+1}–${(page-1)*TREAT_PAGE_SIZE+rows.length} of ${all.length}</span>
    <div><button class="btn btn-xs" ${page===1?'disabled':''} ${bindAction('click',()=>{ui.page=page-1;renderTreatTable();})}>‹ Previous</button>
    <button class="btn btn-xs" ${page===pages?'disabled':''} ${bindAction('click',()=>{ui.page=page+1;renderTreatTable();})}>Next ›</button></div></div>`:'';
  el.innerHTML=`<div class="table-wrap"><table class="treat-table">
    <thead><tr><th scope="col">Visit</th><th scope="col">Patient</th><th scope="col">Diagnosis</th><th scope="col">Clinic</th><th scope="col">Doctor</th><th scope="col">Follow-up</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${rows.map(t=>{
      const pt=getPatientById(t.patientId);
      const doc=getUserById(t.doctorId);
      const clinic=clinicOf(t);
      return `<tr class="treat-row ${t.archived?'archived':''}" ${bindAction('click',()=>viewTreatment(t.id))}>
        <td data-label="Visit"><strong>${fmtDate(t.date)}</strong><div class="text-muted">#${treatmentDisplayId(t)}${t.archived?' · Archived':''}</div></td>
        <td data-label="Patient">${pt?`<button class="link-btn" ${bindAction('click',(event)=>{event.stopPropagation();viewPatient(pt.id)})}><strong>${escapeHtml(pt.lname+', '+pt.fname)}</strong></button><div class="text-muted">P-${patientDisplayId(pt)} · ${escapeHtml(pt.college||'—')}</div>`:'Unknown'}</td>
        <td data-label="Diagnosis">${escapeHtml(t.diagnosis||'—')}</td>
        <td data-label="Clinic">${escapeHtml(clinic)}</td>
        <td data-label="Doctor">${doc?escapeHtml(docName(doc)):'—'}</td>
        <td data-label="Follow-up">${followUp(t)}</td>
        <td data-label="Actions"><div class="td-actions" ${bindAction('click',(event)=>event.stopPropagation())}>
          <button class="btn btn-xs" ${bindAction('click',()=>viewTreatment(t.id))}>View</button>
          ${appState.auth.currentUser.role==='Administrator'
            ? (t.archived
              ? `<button class="btn btn-xs btn-success" ${bindAction('click',()=>restoreTreat(t.id))}>Restore</button>`
              : `<button class="btn btn-xs btn-warning" ${bindAction('click',()=>archiveTreat(t.id))}>Archive</button>`)
            : ''}
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>${pager}`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
