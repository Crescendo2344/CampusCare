import {fetchAnalyticsSummary,analyticsMiniBars,analyticsVisitForecastHtml,analyticsMedicineForecastHtml,renderLiveAnalyticsCard} from './analyticsDisplay.js';
// reports: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
import {syncAdminDirectoryFromSupabase} from './patientService.js';
import {syncRealAppointments} from './appointmentService.js';
import {syncRealTreatments} from './treatmentService.js';
import {syncRealInventory} from './inventoryService.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {refreshHealthIntelligence,renderHealthIntelligenceCard} from './predictiveAnalytics.js';
import {generateReport,updateReportMetricOptions} from './reportCharts.js';
import {openReportDateRange} from './datePicker.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// REPORTS
// ================================================================

export async function syncReportsContext(){
  if(!appState.auth.currentUser?._realSupabase)return;

  if(['Administrator','Staff','Doctor'].includes(appState.auth.currentUser.role)){
    await syncAdminDirectoryFromSupabase();
  }

  await Promise.all([
    syncRealAppointments(),
    syncRealTreatments(),
    ['Administrator','Staff'].includes(appState.auth.currentUser.role)?syncRealInventory(false):Promise.resolve()
  ]);
}

export async function renderReports(){
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();
  const defaultFrom=appState.clinicInformation.TODAY.substring(0,7)+'-01';
  const defaultTo=appState.clinicInformation.TODAY;

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('dashboard');
    try{
      await syncReportsContext();
      if(!isCampusPageCurrent('reports',pageToken))return;
      appState.reports.currentAnalyticsSummary=await fetchAnalyticsSummary(defaultFrom,defaultTo,'');
    }catch(e){
      if(!isCampusPageCurrent('reports',pageToken))return;
      console.error('Reports sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load Reports & Analytics.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderReports()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('reports',pageToken))return;
  }else{
    appState.reports.currentAnalyticsSummary=null;
  }

  const reportTypeOptions=[
    '<option value="appointments">Appointments</option>',
    '<option value="treatments">Treatments</option>',
    ...(['Administrator','Staff'].includes(appState.auth.currentUser.role)?['<option value="inventory">Inventory</option>']:[]),
    '<option value="patients">Patients</option>'
  ].join('');

  c.innerHTML=`
    <div id="health-intelligence-wrap">
      ${appState.auth.currentUser?._realSupabase
        ? renderLiveAnalyticsCard(appState.reports.currentAnalyticsSummary)
        : renderHealthIntelligenceCard(defaultFrom,defaultTo)}
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3>Generate Detailed Report</h3>
          <div class="tech-note">Exportable operational records use the same synchronized Supabase data as the analytics above.</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Report Type</label>
          <select id="rpt-type" ${bindAction('change',(event,element)=>{updateReportMetricOptions()})}>${reportTypeOptions}</select>
        </div>
        <div class="form-group full"><label>Date Range</label>
          <input type="hidden" id="rpt-from" value="${defaultFrom}">
          <input type="hidden" id="rpt-to" value="${defaultTo}">
          <button type="button" class="modern-date-btn" ${bindAction('click',(event,element)=>{openReportDateRange()})} style="width:min(100%,420px);justify-content:flex-start">
            <i class="bi bi-calendar3"></i>
            <span id="rpt-range-label">${fmtDate(defaultFrom)} – ${fmtDate(defaultTo)}</span>
          </button>
          <p class="form-note">Use one calendar: first select Date From, then Date To.</p>
        </div>
        <div class="form-group"><label>College</label>
          <select id="rpt-college" ${bindAction('change',(event,element)=>{refreshHealthIntelligence()})}>
            <option value="">All Colleges</option>
            ${['CCICT','COE','COED','CME','CAS','COT'].map(c=>`<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{generateReport()})}>Generate Report</button>
    </div>
    <div id="rpt-result"></div>`;
}

// Run side effects only after every feature's function exports are available.
// State defaults are initialized by the application before this optional module loads.
