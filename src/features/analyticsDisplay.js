import {createFeatureSyncService} from '../services/feature-sync.js';
// reports: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate} from './inputValidation.js';

export async function fetchAnalyticsSummary(from,to,college=''){
  return createFeatureSyncService({getState:()=>appState,callbacks:{}}).fetchAnalyticsSummary(from,to,college);
}

export function analyticsMiniBars(rows,valueKey='count'){
  if(!rows?.length)return '<div class="tech-note">No records in the selected date range.</div>';
  const max=Math.max(...rows.map(r=>Number(r[valueKey]||0)),1);
  return `<div class="intel-alert-list">${rows.slice(0,8).map(r=>{
    const val=Number(r[valueKey]||0);
    const name=r.name||r.itemName||r.label||'Item';
    return `<div class="intel-alert-item">
      <div class="intel-alert-copy" style="width:100%">
        <div style="display:flex;justify-content:space-between;gap:.75rem"><strong>${escapeHtml(String(name))}</strong><span>${val}</span></div>
        <div class="progress-bar" style="margin-top:.3rem"><div class="progress-fill" style="width:${Math.round(val/max*100)}%"></div></div>
      </div>
    </div>`;
  }).join('')}</div>`;
}



export function renderLiveAnalyticsCard(summary){
  if(!summary)return `<div class="card"><div class="empty-state"><p>Analytics data is unavailable.</p></div></div>`;

  const s=summary.summary||{};
  const range=summary.range||{};
  const doctor=summary.scope==='doctor'||appState.auth.currentUser?.role==='Doctor';
  const scopeText=doctor
    ? 'Your patients and visits'
    : (range.college?`Campus analytics filtered to ${range.college}`:'Campus-wide clinical analytics');

  return `<div class="card">
    <div class="card-header">
      <div>
        <h3>Clinic activity overview</h3>
        <div class="tech-note">${escapeHtml(scopeText)}${range.from&&range.to?` · ${fmtDate(range.from)} – ${fmtDate(range.to)}`:''}</div>
      </div>
      ${doctor?'':'<span class="intel-badge">Clinic records</span>'}
    </div>

    <div class="intel-grid">
      <div class="intel-card"><div class="intel-kicker">Clinical visits</div><div class="intel-value">${Number(s.clinicalVisits||0)}</div><div class="intel-meta">${s.visitGrowth>=0?'+':''}${Number(s.visitGrowth||0)}% vs previous equal period</div></div>
      <div class="intel-card"><div class="intel-kicker">Unique patients</div><div class="intel-value">${Number(s.uniquePatients||0)}</div><div class="intel-meta">${Number(s.completedAppointments||0)} completed appointment${Number(s.completedAppointments||0)===1?'':'s'}</div></div>
      <div class="intel-card"><div class="intel-kicker">Common diagnosis</div><div class="intel-value" style="font-size:.95rem">${s.topDiagnosis?escapeHtml(s.topDiagnosis.name):'No data'}</div><div class="intel-meta">${s.topDiagnosis?`${s.topDiagnosis.count} record${s.topDiagnosis.count===1?'':'s'}`:'Record treatments to populate'}</div></div>
      <div class="intel-card"><div class="intel-kicker">Common service / procedure</div><div class="intel-value" style="font-size:.95rem">${s.topService?escapeHtml(s.topService.name):'No data'}</div><div class="intel-meta">${s.topService?`${s.topService.count} completed visit${s.topService.count===1?'':'s'} · ${escapeHtml(s.topService.clinic||'')}`:'Complete appointments to populate'}</div></div>
    </div>

    <div class="grid-2" style="align-items:start;margin-top:1rem">
      <div>
        <div class="section-label">Common Diagnoses</div>
        ${analyticsMiniBars(summary.diagnoses||[])}
      </div>
      <div>
        <div class="section-label">Procedure / Service Frequencies</div>
        ${analyticsMiniBars(summary.services||[])}
      </div>
    </div>

    <div class="section-label" style="margin-top:1rem">Health Trend Alerts</div>
    <div class="intel-alert-list">
      ${(summary.alerts||[]).length
        ? summary.alerts.map(a=>`<div class="intel-alert-item"><div class="intel-alert-icon ${a.severity==='high'?'danger':'info'}">${a.severity==='high'?'<i class="bi bi-exclamation-triangle" aria-hidden="true"></i>':'<i class="bi bi-graph-up-arrow" aria-hidden="true"></i>'}</div><div class="intel-alert-copy"><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.detail)}</span></div></div>`).join('')
        : `<div class="intel-alert-item"><div class="intel-alert-icon success"><i class="bi bi-check2-circle" aria-hidden="true"></i></div><div class="intel-alert-copy"><strong>No unusual increase detected</strong><span>No clinical trend met the review threshold for this selected range.</span></div></div>`}
    </div>

    ${['Administrator','Staff'].includes(appState.auth.currentUser.role)?`<div class="section-label" style="margin-top:1rem">Medicine usage in selected range</div>
    ${analyticsMiniBars((summary.medicineUsage||[]).map(x=>({name:`${x.itemName} (${x.unit})`,count:x.used})))}`:''}
  </div>`;
}
