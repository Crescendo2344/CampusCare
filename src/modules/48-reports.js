// ================================================================
// REPORTS
// ================================================================

let currentAnalyticsSummary=null;

async function fetchAnalyticsSummary(from,to,college=''){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/analytics-summary`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify({from,to,college})
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to generate analytics.');
  currentAnalyticsSummary=result;
  return result;
}

function analyticsMiniBars(rows,valueKey='count'){
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

function analyticsVisitForecastHtml(summary){
  const rows=summary?.visitForecast||[];
  if(!rows.length)return '<div class="tech-note">No forecast is available yet.</div>';

  return `<div class="table-wrap"><table>
    <thead><tr><th>Month</th><th>Predicted Clinic Visits</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.label)}</td><td><strong>${Number(r.predictedVisits||0)}</strong></td></tr>`).join('')}</tbody>
  </table></div>
  <div class="tech-note" style="margin-top:.5rem">
    Method: ${escapeHtml(summary.forecastMeta?.method||'trend analysis')} ·
    Confidence: <strong>${escapeHtml(summary.forecastMeta?.confidence||'Limited')}</strong> ·
    ${Number(summary.forecastMeta?.historicalVisits||0)} historical visit${Number(summary.forecastMeta?.historicalVisits||0)===1?'':'s'} used.
  </div>`;
}

function analyticsMedicineForecastHtml(summary){
  const rows=summary?.medicineForecast||[];
  if(!rows.length){
    return '<div class="tech-note">Medicine consumption forecasting appears after Medicine inventory items and disbursement history are available.</div>';
  }

  const byItem={};
  rows.forEach(r=>{
    (byItem[r.itemName]??=[]).push(r);
  });

  return `<div class="table-wrap"><table>
    <thead><tr><th>Medicine</th><th>Month</th><th>Predicted Use</th><th>Projected Remaining</th><th>Recommended Reorder</th></tr></thead>
    <tbody>${Object.entries(byItem).flatMap(([name,items])=>
      items.map(r=>`<tr>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(r.label)}</td>
        <td>${Number(r.predictedUsage||0)} ${escapeHtml(r.unit||'')}</td>
        <td>${r.predictedRemainingStock==null?'—':`${Number(r.predictedRemainingStock)} ${escapeHtml(r.unit||'')}`}</td>
        <td>${Number(r.recommendedReorderQty||0)} ${escapeHtml(r.unit||'')}</td>
      </tr>`)
    ).join('')}</tbody>
  </table></div>`;
}

function renderLiveAnalyticsCard(summary){
  if(!summary)return `<div class="card"><div class="empty-state"><p>Analytics data is unavailable.</p></div></div>`;

  const s=summary.summary||{};
  const range=summary.range||{};
  const scopeText=summary.scope==='doctor'
    ? 'Your clinical records only'
    : (range.college?`Campus analytics filtered to ${range.college}`:'Campus-wide clinical analytics');

  return `<div class="card">
    <div class="card-header">
      <div>
        <h3>Campus Health Intelligence &amp; Data Mining</h3>
        <div class="tech-note">${escapeHtml(scopeText)} · ${fmtDate(range.from)} – ${fmtDate(range.to)}</div>
      </div>
      <span class="intel-badge">Live Supabase data</span>
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
        ? summary.alerts.map(a=>`<div class="intel-alert-item"><div class="intel-alert-icon">${a.severity==='high'?'⚠️':'📈'}</div><div class="intel-alert-copy"><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.detail)}</span></div></div>`).join('')
        : `<div class="intel-alert-item"><div class="intel-alert-icon">✓</div><div class="intel-alert-copy"><strong>No unusual increase detected</strong><span>No clinical trend met the review threshold for this selected range.</span></div></div>`}
    </div>

    <div class="grid-2" style="align-items:start;margin-top:1rem">
      <div>
        <div class="section-label">3-Month Clinic Visit Forecast</div>
        ${analyticsVisitForecastHtml(summary)}
      </div>
      <div>
        <div class="section-label">Medicine Consumption in Selected Range</div>
        ${(summary.medicineUsage||[]).length
          ? analyticsMiniBars(summary.medicineUsage.map(x=>({name:`${x.itemName} (${x.unit})`,count:x.used})))
          : '<div class="tech-note">Medicine consumption analytics are available to Staff and Administrators after inventory disbursements are recorded.</div>'}
      </div>
    </div>

    ${['Administrator','Staff'].includes(currentUser.role)?`
      <div class="section-label" style="margin-top:1rem">3-Month Medicine Consumption Forecast</div>
      ${analyticsMedicineForecastHtml(summary)}
    `:''}

    <div class="tech-note" style="margin-top:.75rem">
      Campus Health Intelligence identifies patterns for administrative and clinical review. It does not independently diagnose outbreaks or replace clinician judgment.
    </div>
  </div>`;
}

async function syncReportsContext(){
  if(!currentUser?._realSupabase)return;

  if(['Administrator','Staff','Doctor'].includes(currentUser.role)){
    await syncAdminDirectoryFromSupabase();
  }

  await Promise.all([
    syncRealAppointments(),
    syncRealTreatments(),
    ['Administrator','Staff'].includes(currentUser.role)?syncRealInventory(false):Promise.resolve()
  ]);
}

async function renderReports(){
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();
  const defaultFrom=TODAY.substring(0,7)+'-01';
  const defaultTo=TODAY;

  if(currentUser?._realSupabase){
    showDatabaseSkeleton('dashboard');
    try{
      await syncReportsContext();
      if(!isCampusPageCurrent('reports',pageToken))return;
      currentAnalyticsSummary=await fetchAnalyticsSummary(defaultFrom,defaultTo,'');
    }catch(e){
      if(!isCampusPageCurrent('reports',pageToken))return;
      console.error('Reports sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load Reports & Analytics.')}</div>
        <button class="btn btn-sm" onclick="renderReports()">Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('reports',pageToken))return;
  }else{
    currentAnalyticsSummary=null;
  }

  const reportTypeOptions=[
    '<option value="appointments">Appointments</option>',
    '<option value="treatments">Treatments</option>',
    ...(['Administrator','Staff'].includes(currentUser.role)?['<option value="inventory">Inventory</option>']:[]),
    '<option value="patients">Patients</option>'
  ].join('');

  c.innerHTML=`
    <div id="health-intelligence-wrap">
      ${currentUser?._realSupabase
        ? renderLiveAnalyticsCard(currentAnalyticsSummary)
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
          <select id="rpt-type" onchange="updateReportMetricOptions()">${reportTypeOptions}</select>
        </div>
        <div class="form-group full"><label>Date Range</label>
          <input type="hidden" id="rpt-from" value="${defaultFrom}">
          <input type="hidden" id="rpt-to" value="${defaultTo}">
          <button type="button" class="modern-date-btn" onclick="openReportDateRange()" style="width:min(100%,420px);justify-content:flex-start">
            <i class="bi bi-calendar3"></i>
            <span id="rpt-range-label">${fmtDate(defaultFrom)} – ${fmtDate(defaultTo)}</span>
          </button>
          <p class="form-note">Use one calendar: first select Date From, then Date To.</p>
        </div>
        <div class="form-group"><label>College</label>
          <select id="rpt-college" onchange="refreshHealthIntelligence()">
            <option value="">All Colleges</option>
            ${['CCICT','COE','COED','CME','CAS','COT'].map(c=>`<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="generateReport()">Generate Report</button>
    </div>
    <div id="rpt-result"></div>`;
}
