import {loadReportSnapshot} from '../services/report-snapshot.js';
import {customReportControls,markReportStale} from '../reports/custom-report.js';
import {forecastControls,runForecast,markForecastStale} from '../reports/forecast.js';
import {offsetDay} from '../domain/report-analysis.js';
import {studentFilterMarkup} from '../reports/student-report.js';
import {fetchAnalyticsSummary,renderLiveAnalyticsCard} from './analyticsDisplay.js';
// reports: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
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
  const account=appState.auth.currentUser;
  if(!account?._realSupabase)return;
  const snapshot=await loadReportSnapshot(appState.supabaseClient.supabaseClient,account.role);
  // A previous session must never populate a new account's reporting workspace.
  if(appState.auth.currentUser!==account)return;
  appState.reports.snapshot=snapshot;appState.reports.snapshotAccount=account;
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
    '<option value="patients">Patients</option>',
    ...(['Administrator','Staff'].includes(appState.auth.currentUser.role)?['<option value="students">Student Coverage &amp; Registration</option>']:[])
  ].join('');

  c.innerHTML=`<div class="reports-workspace">
    <div class="report-page-heading"><div><h2>Reports &amp; Analytics</h2><p>Understand clinic activity, explore records and plan ahead.</p></div><span class="intel-badge">${appState.auth.currentUser.role==='Doctor'?'Your clinical records':'Clinic records'}</span></div>
    <div class="card report-filter-card">
      <div class="report-control-grid">
        <div class="form-group"><label for="rpt-type">Report data source</label><select id="rpt-type" ${bindAction('change',updateReportMetricOptions)}>${reportTypeOptions}</select></div>
        <div class="form-group"><label>Activity date range</label>
          <input type="hidden" id="rpt-from" value="${defaultFrom}"><input type="hidden" id="rpt-to" value="${defaultTo}">
          <button type="button" class="modern-date-btn" ${bindAction('click',openReportDateRange)}><i class="bi bi-calendar3"></i><span id="rpt-range-label">${fmtDate(defaultFrom)} – ${fmtDate(defaultTo)}</span></button>
        </div>
        <div class="form-group"><label for="rpt-college">College</label><select id="rpt-college" ${bindAction('change',()=>{markReportStale();markForecastStale();refreshHealthIntelligence();})}><option value="">All Colleges</option>
          ${[...new Set(['CCICT','COE','COED','CME','CAS','COT','Unknown',...appState.data.DB.users.map(u=>u.college).filter(Boolean)])].sort().map(college=>`<option value="${escapeHtml(college)}">${escapeHtml(college)}</option>`).join('')}
        </select></div>
      </div>
      <div class="report-presets"><span>Quick dates</span>${[['Month to date','month'],['Last 30 days','30'],['Last 90 days','90'],['Year to date','year']].map(([label,key])=>`<button type="button" class="btn btn-sm" ${bindAction('click',()=>setReportPreset(key))}>${label}</button>`).join('')}</div>
      <p class="form-note">Activity dates and college apply to the overview and dated reports. Forecasts have their own history dates.</p>
    </div>
    <div class="report-tabs" role="tablist" aria-label="Analytics views">${[['overview','Overview','bi-grid'],['builder','Custom Reports','bi-sliders'],['forecast','Forecast','bi-graph-up-arrow']].map(([id,label,icon])=>`<button type="button" role="tab" id="report-tab-${id}" data-report-view="${id}" aria-controls="report-panel-${id}" aria-selected="${id==='overview'}" ${bindAction('click',()=>switchReportView(id))}><i class="bi ${icon}" aria-hidden="true"></i>${label}</button>`).join('')}</div>
    <section id="report-panel-overview" role="tabpanel" aria-labelledby="report-tab-overview">
      <div class="report-template-grid">${[['appointments','Appointments by clinic'],['treatments','Treatments by diagnosis'],...(['Administrator','Staff'].includes(appState.auth.currentUser.role)?[['students','Student service coverage'],['inventory','Stock by category']]:[])].map(([type,label])=>`<button type="button" class="report-template" ${bindAction('click',()=>{document.getElementById('rpt-type').value=type;updateReportMetricOptions();const group=document.getElementById('rpt-group');if(group)group.value=type==='appointments'?'clinic':type==='treatments'?'diagnosis':'category';})}><span>${label}</span><i class="bi bi-arrow-right" aria-hidden="true"></i></button>`).join('')}</div>
      <div id="health-intelligence-wrap">${appState.auth.currentUser?._realSupabase?renderLiveAnalyticsCard(appState.reports.currentAnalyticsSummary):renderHealthIntelligenceCard(defaultFrom,defaultTo)}</div>
    </section>
    <section id="report-panel-builder" role="tabpanel" aria-labelledby="report-tab-builder" hidden>
      <div class="card"><div class="card-header"><div><h3>Build a report</h3><p class="form-note">Choose a measure, combine filters and compare one or two breakdowns.</p></div></div>
        <div id="rpt-custom-controls"></div>${studentFilterMarkup()}
        <button class="btn btn-primary" ${bindAction('click',generateReport)}><i class="bi bi-bar-chart" aria-hidden="true"></i> Generate Report</button>
      </div><div id="rpt-result" aria-live="polite"></div>
    </section>
    <section id="report-panel-forecast" role="tabpanel" aria-labelledby="report-tab-forecast" hidden>${forecastControls()}</section>
  </div>`;
  customReportControls();
  document.getElementById('report-panel-builder').addEventListener('change',markReportStale);
  document.getElementById('report-panel-forecast').addEventListener('change',markForecastStale);
  // Arrow keys follow the tab order, including on compact touch/keyboard layouts.
  c.querySelector('.report-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...c.querySelectorAll('[data-report-view]')],index=tabs.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    event.preventDefault();tabs[next].click();tabs[next].focus();
  });
}
export function switchReportView(view){
  for(const tab of document.querySelectorAll('[data-report-view]')){
    const selected=tab.dataset.reportView===view;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
    document.getElementById('report-panel-'+tab.dataset.reportView).hidden=!selected;
  }
  if(view==='forecast'&&!document.getElementById('forecast-result').textContent)runForecast();
}
export function setReportPreset(preset){
  const today=appState.clinicInformation.TODAY;
  const from=preset==='month'?today.slice(0,7)+'-01':preset==='year'?today.slice(0,4)+'-01-01':offsetDay(today,-Number(preset)+1);
  document.getElementById('rpt-from').value=from;document.getElementById('rpt-to').value=today;
  document.getElementById('rpt-range-label').textContent=fmtDate(from)+' – '+fmtDate(today);
  markReportStale();refreshHealthIntelligence();
}
