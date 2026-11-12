// loadingSkeletons: imported feature APIs; state belongs to explicit application namespaces.
import {isStaleBuildError,reloadForNewBuild} from '../app/stale-build.js';
import {beginCampusNavigation,isCampusPageCurrent,renderHealthEducation} from './navigationRaceProtection.js';
import {renderDashboard} from './dashboard.js';
import {renderMyAppointments} from './patientAppointments.js';
import {renderMyRecords} from './patientRecords.js';
import {renderCertRequests} from './certificateService.js';
import {renderMyAccount} from './accountSettings.js';
import {renderPatients} from './patientManagement.js';
import {renderAppointments} from './appointments.js';
import {renderApprovals} from './approvalQueue.js';
import {renderTreatments} from './treatmentList.js';
import {renderInventory} from './inventory.js';
import {renderReports} from '../app/optional-features.js';
import {renderUsers} from './userManagement.js';
import {renderSettings} from './settingsAndCertificates.js';
import {renderDoctorSchedule} from './doctorSchedule.js';
import {renderMyPatients} from './doctorPatients.js';
import {escapeHtml,renderFeedbackIssues,renderReportIssue} from './issueReports.js';
import {renderFitnessAssessments} from './fitnessAssessments.js';
import {renderActivityLog} from './emailDelivery.js';
import {renderDentalSurvey,renderSurveyResults} from './dentalSurvey.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// DATABASE SKELETON LOADING
// ================================================================
export function databaseSkeletonHtml(type='table',rows=6){
  const shimmer=cls=>`<div class="db-skeleton-shimmer ${cls}"></div>`;

  if(type==='dashboard'){
    return `<div class="db-skeleton-wrap" role="status" aria-busy="true" aria-label="Loading dashboard data">
      <div class="db-skeleton-toolbar">
        ${shimmer('db-skeleton-pill')}
        ${shimmer('db-skeleton-pill sm')}
      </div>
      <div class="db-skeleton-stat-grid">
        ${Array.from({length:4},()=>shimmer('db-skeleton-stat')).join('')}
      </div>
      <div class="grid-2">
        ${shimmer('db-skeleton-chart')}
        ${shimmer('db-skeleton-chart')}
      </div>
    </div>`;
  }

  if(type==='form'){
    return `<div class="db-skeleton-wrap" role="status" aria-busy="true" aria-label="Loading data">
      <div class="db-skeleton-card">
        ${shimmer('db-skeleton-line sm')}
        <div class="db-skeleton-form-grid" style="margin-top:1rem">
          ${Array.from({length:8},()=>shimmer('db-skeleton-input')).join('')}
        </div>
      </div>
    </div>`;
  }

  if(type==='cards'){
    return `<div class="db-skeleton-wrap" role="status" aria-busy="true" aria-label="Loading data">
      <div class="stats-grid">
        ${Array.from({length:4},()=>`<div class="db-skeleton-card">
          ${shimmer('db-skeleton-line sm')}
          ${shimmer('db-skeleton-line md')}
          ${shimmer('db-skeleton-line full')}
        </div>`).join('')}
      </div>
    </div>`;
  }

  // Default: table/list skeleton.
  return `<div class="db-skeleton-wrap" role="status" aria-busy="true" aria-label="Loading records">
    <div class="db-skeleton-toolbar">
      ${shimmer('db-skeleton-pill')}
      ${shimmer('db-skeleton-pill sm')}
      ${shimmer('db-skeleton-pill sm')}
    </div>
    <div class="db-skeleton-card">
      ${Array.from({length:rows},()=>`<div class="db-skeleton-row">
        ${shimmer('db-skeleton-circle')}
        ${shimmer('db-skeleton-line lg')}
        ${shimmer('db-skeleton-line md')}
        ${shimmer('db-skeleton-line lg db-hide-mobile')}
        ${shimmer('db-skeleton-line sm db-hide-mobile')}
        ${shimmer('db-skeleton-line md db-hide-mobile')}
      </div>`).join('')}
    </div>
  </div>`;
}

// A page that is already on screen keeps its content while it refreshes (dimmed and aria-busy) instead of
// flashing back to a full skeleton; the skeleton is for arriving on a page, not for re-rendering it.
function markRefreshing(target){
  target.setAttribute('aria-busy','true');target.classList.add('cc-refreshing');
  clearTimeout(target._refreshTimer);target._refreshTimer=setTimeout(()=>clearRefreshing(target),12000);
  if(!target._refreshObserver){
    target._refreshObserver=new MutationObserver(()=>clearRefreshing(target));
    target._refreshObserver.observe(target,{childList:true});
  }
}
function clearRefreshing(target){
  clearTimeout(target._refreshTimer);
  if(!target.classList.contains('cc-refreshing'))return;
  target.classList.remove('cc-refreshing');target.removeAttribute('aria-busy');
}

export function showDatabaseSkeleton(type='table',targetId='app-content'){
  const target=document.getElementById(targetId);
  if(!target)return;
  const onScreen=target.dataset.navFresh!=='1'&&target.childElementCount&&!target.querySelector(':scope>.db-skeleton-wrap');
  if(onScreen){markRefreshing(target);return;}
  target.innerHTML=databaseSkeletonHtml(type);
}

// Helper for future database-backed modules.
// Example: await withDatabaseSkeleton(()=>loadSomething(),'table');
export async function withDatabaseSkeleton(task,type='table',targetId='app-content'){
  showDatabaseSkeleton(type,targetId);
  try{return await task();}
  catch(error){throw error;}
}

export function renderPage(id){
  const c=document.getElementById('app-content');
  if(!c)return;
  // Content arriving in the next moment settles in (see #app-content.cc-page-enter).
  c.classList.remove('cc-page-enter');void c.offsetWidth;c.classList.add('cc-page-enter');
  clearTimeout(c._pageEnterTimer);c._pageEnterTimer=setTimeout(()=>c.classList.remove('cc-page-enter'),700);

  const renderToken=beginCampusNavigation(id);

  // Use lazy callbacks. A missing optional page renderer must never stop
  // Dashboard or other modules from loading.
  const renders={
    dashboard:()=>renderDashboard(),
    'my-appointments':()=>renderMyAppointments(),
    'my-records':()=>renderMyRecords(),
    'my-account':()=>renderMyAccount(),
    patients:()=>renderPatients(),
    appointments:()=>renderAppointments(),
    approvals:()=>renderApprovals(),
    'cert-requests':()=>renderCertRequests(),
    treatments:()=>renderTreatments(),
    inventory:()=>renderInventory(),
    reports:()=>renderReports(),
    users:()=>renderUsers(),
    settings:()=>renderSettings(),
    schedule:()=>renderDoctorSchedule(),
    'my-patients':()=>renderMyPatients(),
    'health_education':()=>renderHealthEducation(),
    'report-issue':()=>renderReportIssue(),
    'feedback-issues':()=>renderFeedbackIssues(),
    fitness:()=>renderFitnessAssessments(),
    'activity-log':()=>renderActivityLog(),
    'dental-survey':()=>renderDentalSurvey(),
    'survey-results':()=>renderSurveyResults(),
  };

  clearRefreshing(c);
  c.innerHTML='';
  // Arriving on a page shows its skeleton; once the first render settles, refreshes keep content visible.
  c.dataset.navFresh='1';
  const settle=()=>{if(isCampusPageCurrent(id,renderToken))delete c.dataset.navFresh;};
  const renderer=renders[id];
  if(!renderer){
    c.innerHTML=`<div class="empty-state"><p>Page "${escapeHtml(id)}" coming soon.</p></div>`;
    return;
  }

  try{
    const result=renderer();
    if(result&&typeof result.finally==='function')result.finally(settle).catch(()=>{});
    else settle();
    if(result&&typeof result.catch==='function'){
      result.catch(err=>{
        console.error(`CampusCare page "${id}" failed:`,err);

        // Ignore errors from a page the user has already left.
        if(!isCampusPageCurrent(id,renderToken))return;
        // A newer version was deployed since this tab opened: load it instead of showing an error.
        const stale=isStaleBuildError(err);
        if(stale&&reloadForNewBuild())return;

        c.innerHTML=`<div class="card">
          <div class="alert alert-danger show">${stale?'CampusCare was updated. Reload the page to continue.':'This page could not finish loading.'}</div>
          <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderPage((String(id)))})}>Retry</button>
        </div>`;
      });
    }
  }catch(err){
    console.error(`CampusCare page "${id}" failed:`,err);
    if(!isCampusPageCurrent(id,renderToken))return;
    c.innerHTML=`<div class="card">
      <div class="alert alert-danger show">${escapeHtml(err?.message||'This page could not load.')}</div>
      <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderPage((String(id)))})}>Retry</button>
    </div>`;
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
