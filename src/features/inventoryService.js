// inventoryService: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {computeCampusHealthAnalytics,healthAnalyticsAnchorDate} from './predictiveAnalytics.js';
import {isoDateOffset} from './dashboardChartHelpers.js';
import {fmtDate} from './inputValidation.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {treatmentRecords} from './treatmentService.js';
import {appointmentRecords} from './appointmentService.js';
import {closeAllModals,openModal} from './modals.js';
import {toast} from './theme.js';
import {databaseSkeletonHtml} from './loadingSkeletons.js';
import {bindAction,createInventoryService,inventoryData} from '../dependencies.js';
// Compatibility adapters own application state; the data modules receive explicit dependencies.
export function inventoryRecords(){return inventoryData.inventoryRecords(appState.data.DB,appState.auth.currentUser);}
export function inventoryTransactionRecords(){return inventoryData.inventoryTransactionRecords(appState.data.DB,appState.auth.currentUser);}
export function inventoryForecastRecords(){return inventoryData.inventoryForecastRecords(appState.data.DB,appState.auth.currentUser);}
export function inventoryDisplayId(item){return inventoryData.inventoryDisplayId(item);}
export function realInventoryToUi(item){return inventoryData.realInventoryToUi(item);}
export function realInventoryTransactionToUi(tx){return inventoryData.realInventoryTransactionToUi(tx);}
export function realInventoryForecastToUi(forecast){return inventoryData.realInventoryForecastToUi(forecast);}
export function inventoryService(){
  return createInventoryService({getClient:()=>appState.supabaseClient.supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:appState.supabaseClient.SUPABASE_URL,publishableKey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
    reportForecastError:err=>console.error('Inventory forecast generation:',err)});
}
export async function inventoryAction(payload){return inventoryService().action(payload);}
export async function syncRealInventory(generateForecasts=false){
  const account=appState.auth.currentUser;
  if(!appState.auth.currentUser?._realSupabase)return inventoryRecords();
  if(!['Staff','Administrator'].includes(appState.auth.currentUser.role))return [];
  const snapshot=await inventoryService().load(generateForecasts);
  if(appState.auth.currentUser!==account)return [];
  Object.assign(appState.data.DB,inventoryData.mergeInventorySnapshot(appState.data.DB,snapshot));
  return inventoryRecords();
}

export function inventoryMonthlyUsageHtml(){
  const tx=inventoryTransactionRecords().filter(t=>t.type==='Disbursement');
  const items=inventoryRecords().filter(i=>!i.archived&&i.category!=='Equipment');

  if(!tx.length||!items.length){
    return '<div class="tech-note">Monthly usage analytics will appear after inventory disbursements are recorded.</div>';
  }

  const base=new Date(appState.clinicInformation.TODAY+'T12:00:00');
  const months=[];
  for(let offset=5;offset>=0;offset--){
    const d=new Date(base.getFullYear(),base.getMonth()-offset,1,12);
    months.push({
      key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label:d.toLocaleDateString('en-PH',{month:'short',year:'2-digit'})
    });
  }

  const active=items.map(item=>{
    const values=months.map(m=>tx
      .filter(t=>t.itemId===item.id&&String(t.date||'').startsWith(m.key))
      .reduce((s,t)=>s+Number(t.qty||0),0));
    return {item,values,total:values.reduce((a,b)=>a+b,0)};
  }).filter(x=>x.total>0).sort((a,b)=>b.total-a.total);

  if(!active.length){
    return '<div class="tech-note">No disbursement activity was recorded during the last six months.</div>';
  }

  return `<div class="table-wrap"><table>
    <thead><tr><th>Item</th>${months.map(m=>`<th>${escapeHtml(m.label)}</th>`).join('')}<th>6-Month Total</th></tr></thead>
    <tbody>${active.map(x=>`<tr>
      <td>${escapeHtml(x.item.name)}<div class="text-muted">${escapeHtml(x.item.unit)}</div></td>
      ${x.values.map(v=>`<td>${v}</td>`).join('')}
      <td><strong>${x.total}</strong></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------- Predictive Inventory ----------
export function inventoryUsageRecords(itemId,lookbackDays=90){
  const anchor=healthAnalyticsAnchorDate().date;
  const from=isoDateOffset(anchor,-lookbackDays);
  return inventoryTransactionRecords()
    .filter(d=>d.type==='Disbursement'&&d.itemId===itemId&&d.date>=from&&d.date<=anchor)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}

export function getInventoryForecast(item){
  const consumable=!['Equipment'].includes(item.category);
  const usage=inventoryUsageRecords(item.id,90);

  if(appState.auth.currentUser?._realSupabase&&item._realSupabase){
    const rows=inventoryForecastRecords()
      .filter(f=>f.itemId===item.id)
      .slice()
      .sort((a,b)=>String(a.forecastMonth).localeCompare(String(b.forecastMonth)));

    const hasUsage=usage.length>0&&rows.some(r=>r.predictedUsage>0);
    if(!consumable||!hasUsage){
      return {hasData:false,avgDaily:0,adjustedDaily:0,daysRemaining:null,stockoutDate:'',reorderQty:0,risk:'unknown',usageCount:usage.length,demandMultiplier:1,source:'database'};
    }

    const first=rows[0];
    const fm=new Date((first.forecastMonth||appState.clinicInformation.TODAY)+'T12:00:00');
    const days=new Date(fm.getFullYear(),fm.getMonth()+1,0).getDate();
    const adjustedDaily=days?Number(first.predictedUsage||0)/days:0;
    const daysRemaining=adjustedDaily>0?Math.floor(Number(item.qty||0)/adjustedDaily):null;
    const stockoutDate=first.predictedStockoutDate||(daysRemaining!==null?isoDateOffset(appState.clinicInformation.TODAY,daysRemaining):'');
    const reorderQty=Math.max(...rows.map(r=>Number(r.recommendedReorderQty||0)),0);
    const risk=daysRemaining!==null&&daysRemaining<=7?'high':daysRemaining!==null&&daysRemaining<=14?'medium':'low';

    return {
      hasData:true,
      avgDaily:adjustedDaily,
      adjustedDaily,
      daysRemaining,
      stockoutDate,
      reorderQty,
      risk,
      usageCount:usage.length,
      demandMultiplier:1,
      source:'database'
    };
  }

  // Legacy/demo forecast fallback.
  const a=computeCampusHealthAnalytics(14);
  if(!usage.length||!consumable){
    return {hasData:false,avgDaily:0,adjustedDaily:0,daysRemaining:null,stockoutDate:'',reorderQty:0,risk:'unknown',usageCount:usage.length,demandMultiplier:1};
  }

  const totalUsed=usage.reduce((s,d)=>s+Number(d.qty||0),0);
  const first=usage[0].date,last=usage[usage.length-1].date;
  const observedDays=Math.max(14,Math.min(90,Math.round((new Date(last+'T12:00:00')-new Date(first+'T12:00:00'))/86400000)+7));
  const avgDaily=totalUsed/observedDays;
  const demandMultiplier=Math.max(.85,Math.min(1.35,1+(a.visitGrowth/100)*.25));
  const adjustedDaily=avgDaily*demandMultiplier;
  const daysRemaining=adjustedDaily>0?Math.floor(item.qty/adjustedDaily):null;
  const stockoutDate=daysRemaining!==null?isoDateOffset(healthAnalyticsAnchorDate().date,daysRemaining):'';
  const target30=Math.ceil(adjustedDaily*30+item.threshold);
  const reorderQty=Math.max(0,target30-item.qty);
  const risk=daysRemaining!==null&&daysRemaining<=7?'high':daysRemaining!==null&&daysRemaining<=14?'medium':'low';

  return {hasData:true,avgDaily,adjustedDaily,daysRemaining,stockoutDate,reorderQty,risk,usageCount:usage.length,demandMultiplier};
}

export function inventoryForecastBadge(f){
  if(!f.hasData)return `<span class="badge badge-gray">Needs history</span>`;
  const cls=f.risk==='high'?'badge-danger':f.risk==='medium'?'badge-warning':'badge-success';
  return `<span class="badge ${cls}">${f.risk==='high'?'High risk':f.risk==='medium'?'Watch':'Stable'}</span>`;
}

export function getThreeMonthForecast(item){
  if(appState.auth.currentUser?._realSupabase&&item._realSupabase){
    return inventoryForecastRecords()
      .filter(f=>f.itemId===item.id)
      .slice()
      .sort((a,b)=>String(a.forecastMonth).localeCompare(String(b.forecastMonth)))
      .slice(0,3)
      .map(f=>{
        const d=new Date((f.forecastMonth||appState.clinicInformation.TODAY)+'T12:00:00');
        return {
          label:d.toLocaleDateString('en-PH',{month:'long',year:'numeric'}),
          projected:Number(f.predictedUsage||0),
          remaining:f.predictedRemainingStock,
          reorder:Number(f.recommendedReorderQty||0)
        };
      });
  }

  const f=getInventoryForecast(item);if(!f.hasData)return [];
  const base=new Date((healthAnalyticsAnchorDate().date||appState.clinicInformation.TODAY)+'T12:00:00');
  const rows=[];
  for(let i=1;i<=3;i++){
    const d=new Date(base.getFullYear(),base.getMonth()+i,1,12);
    const year=d.getFullYear(),month=d.getMonth();
    const days=new Date(year,month+1,0).getDate();
    const projected=Math.max(0,Math.round(f.adjustedDaily*days*Math.pow(1.02,i-1)));
    rows.push({label:d.toLocaleDateString('en-PH',{month:'long',year:'numeric'}),projected,remaining:null,reorder:f.reorderQty});
  }
  return rows;
}

export function threeMonthForecastTableHtml(){
  const items=inventoryRecords()
    .filter(i=>!i.archived&&i.category!=='Equipment')
    .map(i=>({i,rows:getThreeMonthForecast(i)}))
    .filter(x=>x.rows.length);

  if(!items.length)return '<div class="tech-note">Add inventory items and record disbursements to generate the 3-month forecast.</div>';

  return `<div class="table-wrap"><table class="forecast-table">
    <thead><tr><th>Item</th>${items[0].rows.map(r=>`<th>${escapeHtml(r.label)}</th>`).join('')}</tr></thead>
    <tbody>${items.map(x=>`<tr>
      <td>${escapeHtml(x.i.name)}<div class="text-muted">${escapeHtml(x.i.unit)}</div></td>
      ${x.rows.map(r=>`<td><strong>${r.projected}</strong><div class="text-muted">projected use${r.remaining!=null?` · ${r.remaining} left`:''}${r.reorder?` · reorder ${r.reorder}`:''}</div></td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

export function predictiveInventorySummaryHtml(){
  const items=inventoryRecords().filter(i=>!i.archived);
  const forecasts=items.map(item=>({item,f:getInventoryForecast(item)})).filter(x=>x.f.hasData);
  const atRisk=forecasts.filter(x=>x.f.daysRemaining<=14).sort((a,b)=>a.f.daysRemaining-b.f.daysRemaining);
  const soon=atRisk[0];

  return `<div class="card">
    <div class="card-header">
      <div><h3>Predictive Inventory</h3><div class="tech-note">The real backend uses recent disbursement history to maintain a rolling 3-month consumption forecast.</div></div>
      <span class="intel-badge">3-month forecast</span>
    </div>
    <div class="intel-grid">
      <div class="intel-card ${atRisk.length?'intel-risk-medium':'intel-risk-low'}"><div class="intel-kicker">At risk in 14 days</div><div class="intel-value">${atRisk.length}</div><div class="intel-meta">Consumable item${atRisk.length===1?'':'s'} projected to run low soon</div></div>
      <div class="intel-card"><div class="intel-kicker">Soonest projected depletion</div><div class="intel-value" style="font-size:.95rem">${soon?escapeHtml(soon.item.name):'No immediate risk'}</div><div class="intel-meta">${soon?`${soon.f.daysRemaining} days · ${fmtDate(soon.f.stockoutDate)}`:'Based on available history'}</div></div>
      <div class="intel-card"><div class="intel-kicker">Forecast coverage</div><div class="intel-value">${forecasts.length}/${items.length}</div><div class="intel-meta">Active items with usable demand history</div></div>
    </div>
    ${atRisk.length?`<div class="intel-alert-list">${atRisk.slice(0,4).map(({item,f})=>`<div class="intel-alert-item"><div class="intel-alert-icon">${f.risk==='high'?'⚠️':'📦'}</div><div class="intel-alert-copy"><strong>${escapeHtml(item.name)} — ${f.daysRemaining} days remaining</strong><span>Projected depletion ${fmtDate(f.stockoutDate)}. Suggested reorder: ${f.reorderQty} ${escapeHtml(item.unit)}. Current forecast usage ≈ ${f.adjustedDaily.toFixed(1)} ${escapeHtml(item.unit)}/day.</span></div></div>`).join('')}</div>`:`<div class="tech-note">No item with sufficient usage history is forecast to deplete within 14 days.</div>`}
    <div class="section-label" style="margin-top:1rem">3-Month Consumption Forecast</div>
    ${threeMonthForecastTableHtml()}
    <div class="section-label" style="margin-top:1rem">Monthly Usage Analytics</div>
    ${inventoryMonthlyUsageHtml()}
    <div class="tech-note" style="margin-top:.5rem">Forecasts are planning estimates based on recorded disbursements. They are not guaranteed future demand.</div>
  </div>`;
}
// ---------- Clinical Copilot / FHIR backend ----------
export async function clinicalIntelligenceAction(payload){
  const {data:{session}}=await appState.supabaseClient.supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${appState.supabaseClient.SUPABASE_URL}/functions/v1/clinical-intelligence`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:appState.supabaseClient.SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Clinical intelligence request failed.');
  return result;
}

// ---------- Clinical Copilot local fallback for demo/offline data ----------
export function buildClinicalCopilot(patientId){
  const pt=getPatientById(patientId);
  if(!pt)return null;
  const treatments=treatmentRecords().filter(t=>t.patientId===patientId&&!t.archived).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const appointments=appointmentRecords().filter(a=>a.patientId===patientId).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const latest=treatments[0]||null;

  const diagnosisCounts={};
  treatments.forEach(t=>{
    const d=(t.diagnosis||'Unspecified').trim();
    diagnosisCounts[d]=(diagnosisCounts[d]||0)+1;
  });
  const repeated=Object.entries(diagnosisCounts).filter(([,n])=>n>1).sort((a,b)=>b[1]-a[1]);

  const alerts=[];
  if(pt.allergies&&pt.allergies.toLowerCase()!=='none')alerts.push({type:'danger',title:'Recorded allergy',detail:pt.allergies});
  if(pt.medHistory&&pt.medHistory.toLowerCase()!=='none')alerts.push({type:'info',title:'Medical history',detail:pt.medHistory});
  if(latest?.followupDate&&latest.followupDate<appState.clinicInformation.TODAY)alerts.push({type:'warning',title:'Follow-up date has passed',detail:`Follow-up was recorded for ${fmtDate(latest.followupDate)}.`});
  if(repeated.length)alerts.push({type:'warning',title:'Repeated diagnosis pattern',detail:repeated.map(([d,n])=>`${d} (${n}×)`).join(', ')});

  const recent=treatments.slice(0,3);
  const summary=[
    `${pt.fname} ${pt.lname}, ${pt.age||'age not recorded'}${pt.gender?`, ${pt.gender}`:''}.`,
    `Blood type: ${pt.blood||'not recorded'}. Allergies: ${pt.allergies||'none recorded'}.`,
    treatments.length?`${treatments.length} treatment record${treatments.length===1?'':'s'} on file. Latest: ${latest.diagnosis||'unspecified'} on ${fmtDate(latest.date)}.`:'No treatment records on file.',
    appointments.length?`${appointments.length} appointment record${appointments.length===1?'':'s'}; latest status: ${appointments[0].status}.`:'No appointment records on file.'
  ].join(' ');

  const history=recent.length?recent.map(t=>`${fmtDate(t.date)} — ${t.diagnosis||'No diagnosis'}${t.prescription?`; treatment: ${t.prescription}`:''}`).join('\n'):'No recent treatment history.';

  const soap=latest?[
    `S: ${latest.notes||latest.findings||'Review patient-reported symptoms and current concerns.'}`,
    `O: ${latest.findings||'Enter current examination findings.'}${latest.vitals?` Vitals: BP ${latest.vitals.bp||'-'}, Temp ${latest.vitals.temp||'-'}, Pulse ${latest.vitals.pulse||'-'}, SpO₂ ${latest.vitals.spo2||'-'}.`:''}`,
    `A: Previous recorded diagnosis: ${latest.diagnosis||'not recorded'}. Reassess before using.`,
    `P: Previous treatment: ${latest.prescription||'not recorded'}. Confirm/update plan and follow-up.`
  ].join('\n'):'S: Enter current symptoms.\nO: Enter examination findings and vitals.\nA: Enter clinician assessment.\nP: Enter treatment and follow-up plan.';

  return {pt,treatments,appointments,latest,alerts,summary,history,soap};
}

export async function openClinicalCopilot(patientId){
  const pt=getPatientById(patientId);
  if(!pt)return;

  if(!appState.auth.currentUser?._realSupabase){
    const x=buildClinicalCopilot(patientId);if(!x)return;
    openModal(`<div class="modal modal-xl">
      <div class="modal-header"><h3>Clinical Copilot — ${escapeHtml(x.pt.fname+' '+x.pt.lname)}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
      <div class="modal-body">
        <div class="copilot-hero">
          <div><div class="copilot-title">✦ Clinical Copilot</div><div class="copilot-disclaimer">Demo fallback: this summarizes the local CampusCare record. It does not diagnose, prescribe, or replace clinical judgment. The clinician must verify all output before use.</div></div>
          <span class="intel-badge">Human review required</span>
        </div>
        <div class="copilot-section"><h4>Patient snapshot</h4><div class="copilot-summary">${escapeHtml(x.summary)}</div></div>
        <div class="copilot-section"><h4>Attention items</h4>
          <div class="intel-alert-list">${x.alerts.length?x.alerts.map(a=>`<div class="intel-alert-item"><div class="intel-alert-icon">${a.type==='danger'?'⚠️':a.type==='warning'?'⏱':'ℹ️'}</div><div class="intel-alert-copy"><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.detail)}</span></div></div>`).join(''):`<div class="intel-alert-item"><div class="intel-alert-icon">✓</div><div class="intel-alert-copy"><strong>No automatic warning generated</strong><span>Review the complete chart before making clinical decisions.</span></div></div>`}</div>
        </div>
        <div class="grid-2" style="margin-top:.85rem">
          <div class="copilot-section" style="margin-top:0"><h4>Recent clinical history</h4><div class="copilot-summary">${escapeHtml(x.history)}</div></div>
          <div class="copilot-section" style="margin-top:0"><h4>Draft structured note</h4><textarea id="copilot-soap" rows="10" style="width:100%;padding:.7rem;border-radius:11px;border:1px solid var(--line);background:var(--overlay);color:var(--ink)">${escapeHtml(x.soap)}</textarea></div>
        </div>
      </div>
      <div class="modal-footer" style="justify-content:space-between">
        <div class="fhir-toolbar">
          <button class="btn btn-info btn-sm" ${bindAction('click',(event,element)=>{viewPatientFHIR((patientId))})}>FHIR Preview</button>
          <button class="btn btn-sm" ${bindAction('click',(event,element)=>{downloadPatientFHIR((patientId))})}>Export FHIR JSON</button>
        </div>
        <div style="display:flex;gap:.45rem">
          <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
          <button class="btn btn-primary" ${bindAction('click',(event,element)=>{copyCopilotDraft()})}>Copy Draft Note</button>
        </div>
      </div>
    </div>`);
    return;
  }

  if(!pt.dbPatientId){
    toast('The real patient database record could not be identified.','error');
    return;
  }

  openModal(`<div class="modal modal-xl">
    <div class="modal-header"><h3>Clinical Copilot — ${escapeHtml(pt.fname+' '+pt.lname)}</h3><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body" id="clinical-copilot-content">
      <div class="copilot-hero">
        <div>
          <div class="copilot-title">✦ Clinical Copilot</div>
          <div class="copilot-disclaimer">Loading the authorized Supabase clinical record…</div>
        </div>
        <span class="intel-badge">Server-side</span>
      </div>
      ${databaseSkeletonHtml('cards',4)}
    </div>
  </div>`);

  try{
    const result=await clinicalIntelligenceAction({
      action:'copilot',
      patient_id:Number(pt.dbPatientId)
    });
    const x=result.copilot;
    const el=document.getElementById('clinical-copilot-content');
    if(!el||!x)return;

    const history=(x.recent_history||[]).length
      ? x.recent_history.join('\n')
      : 'No recent treatment history.';

    el.innerHTML=`
      <div class="copilot-hero">
        <div>
          <div class="copilot-title">✦ Clinical Copilot</div>
          <div class="copilot-disclaimer">
            This server-side assistant summarizes existing CampusCare records using transparent rules. It does not diagnose,
            prescribe, or replace clinical judgment. Verify the complete chart and the patient before using any draft.
          </div>
        </div>
        <span class="intel-badge">Human review required</span>
      </div>

      <div class="copilot-section"><h4>Patient snapshot</h4><div class="copilot-summary">${escapeHtml(x.summary||'')}</div></div>

      <div class="copilot-section"><h4>Attention items</h4>
        <div class="intel-alert-list">${(x.alerts||[]).length
          ? x.alerts.map(a=>`<div class="intel-alert-item">
              <div class="intel-alert-icon">${a.type==='danger'?'⚠️':a.type==='warning'?'⏱':'ℹ️'}</div>
              <div class="intel-alert-copy"><strong>${escapeHtml(a.title||'Attention')}</strong><span>${escapeHtml(a.detail||'')}</span></div>
            </div>`).join('')
          : `<div class="intel-alert-item"><div class="intel-alert-icon">✓</div><div class="intel-alert-copy"><strong>No automatic warning generated</strong><span>Review the complete chart before making clinical decisions.</span></div></div>`}
        </div>
      </div>

      <div class="grid-2" style="margin-top:.85rem">
        <div class="copilot-section" style="margin-top:0">
          <h4>Recent clinical history</h4>
          <div class="copilot-summary">${escapeHtml(history)}</div>
        </div>
        <div class="copilot-section" style="margin-top:0">
          <h4>Draft structured note</h4>
          <textarea id="copilot-soap" rows="10" style="width:100%;padding:.7rem;border-radius:11px;border:1px solid var(--line);background:var(--overlay);color:var(--ink)">${escapeHtml(x.draft_note||'')}</textarea>
        </div>
      </div>

      <div class="tech-note" style="margin-top:.8rem">
        Method: ${escapeHtml(x.method||'Explainable clinical-record summarization')} ·
        ${Number(x.record_counts?.treatments||0)} treatment record${Number(x.record_counts?.treatments||0)===1?'':'s'} ·
        ${Number(x.record_counts?.appointments||0)} appointment record${Number(x.record_counts?.appointments||0)===1?'':'s'}
      </div>
    `;

    const modal=el.closest('.modal');
    if(modal&&!modal.querySelector('.modal-footer')){
      modal.insertAdjacentHTML('beforeend',`
        <div class="modal-footer" style="justify-content:space-between">
          <div class="fhir-toolbar">
            <button class="btn btn-info btn-sm" ${bindAction('click',(event,element)=>{viewPatientFHIR((patientId))})}>FHIR Preview</button>
            <button class="btn btn-sm" ${bindAction('click',(event,element)=>{downloadPatientFHIR((patientId))})}>Export FHIR JSON</button>
          </div>
          <div style="display:flex;gap:.45rem">
            <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
            <button class="btn btn-primary" ${bindAction('click',(event,element)=>{copyCopilotDraft()})}>Copy Draft Note</button>
          </div>
        </div>`);
    }
  }catch(e){
    const el=document.getElementById('clinical-copilot-content');
    if(el)el.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load the Clinical Copilot.')}</div>`;
  }
}

export function copyCopilotDraft(){
  const text=document.getElementById('copilot-soap')?.value||'';
  if(!text)return;
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(()=>toast('Copilot draft copied. Review it before saving to the record.','success')).catch(()=>toast('Could not access clipboard.','warning'));
  }else toast('Clipboard is not available in this browser.','warning');
}

// ---------- FHIR-ready Health Records ----------
// Local mapping remains as a demo fallback. Real Supabase accounts request
// a server-generated FHIR R4-style bundle with access checks and audit logs.
// The export must still be validated against the receiving implementation
// guide/profile before real interoperability.
export function fhirId(prefix,id){return `${prefix}-${id}`;}
export function fhirPatientResource(patientId){
  const p=getPatientById(patientId);if(!p)return null;
  const u=getUserById(p.userId)||{};
  const gender=String(p.gender||'unknown').toLowerCase();
  return {
    resourceType:'Patient',
    id:fhirId('patient',p.id),
    identifier:[{system:'urn:campuscare:university-id',value:p.idNo||u.idNo||String(p.id)}],
    active:!p.archived,
    name:[{use:'official',family:p.lname||u.lname||'',given:[p.fname||u.fname||'']}],
    telecom:[
      ...(u.contact?[{system:'phone',value:u.contact,use:'mobile'}]:[]),
      ...(u.email?[{system:'email',value:u.email}]:[])
    ],
    gender:['male','female','other','unknown'].includes(gender)?gender:'unknown',
    address:p.address?[{text:p.address}]:[],
    extension:[
      {url:'urn:campuscare:college',valueString:p.college||''},
      {url:'urn:campuscare:person-type',valueString:p.personType||''},
      {url:'urn:campuscare:blood-type',valueString:p.blood||''}
    ]
  };
}

export function campusCareFHIRBundle(patientId){
  const p=getPatientById(patientId);if(!p)return null;
  const entries=[];
  const push=resource=>{if(resource)entries.push({fullUrl:`urn:uuid:${resource.id}`,resource});};
  push(fhirPatientResource(patientId));

  appointmentRecords().filter(a=>a.patientId===patientId).forEach(a=>{
    const doc=getUserById(a.doctorId)||{};
    push({
      resourceType:'Appointment',id:fhirId('appointment',a.id),
      status:a.status==='Completed'?'fulfilled':a.status==='Cancelled'?'cancelled':'booked',
      serviceType:[{text:a.service||a.clinic||'Campus clinic service'}],
      description:a.reason||a.notes||'CampusCare appointment',
      start:`${a.date}T${a.time||'00:00'}:00+08:00`,
      participant:[
        {actor:{reference:`Patient/${fhirId('patient',patientId)}`,display:`${p.fname} ${p.lname}`},status:'accepted'},
        {actor:{reference:`Practitioner/${fhirId('practitioner',a.doctorId)}`,display:doc.fname?`Dr. ${doc.fname} ${doc.lname}`:'Doctor'},status:'accepted'}
      ]
    });
  });

  treatmentRecords().filter(t=>t.patientId===patientId&&!t.archived).forEach(t=>{
    const encounterId=fhirId('encounter',t.id);
    push({
      resourceType:'Encounter',id:encounterId,status:'finished',
      class:{system:'http://terminology.hl7.org/CodeSystem/v3-ActCode',code:'AMB',display:'ambulatory'},
      subject:{reference:`Patient/${fhirId('patient',patientId)}`},
      period:{start:`${t.date}T00:00:00+08:00`,end:`${t.date}T23:59:59+08:00`}
    });
    push({
      resourceType:'Condition',id:fhirId('condition',t.id),
      clinicalStatus:{text:'active/recorded'},code:{text:t.diagnosis||'Unspecified'},
      subject:{reference:`Patient/${fhirId('patient',patientId)}`},
      encounter:{reference:`Encounter/${encounterId}`},recordedDate:t.date,
      note:[{text:t.findings||''},{text:t.notes||''}].filter(n=>n.text)
    });
    if(t.vitals){
      const vitals=[
        ['blood-pressure','Blood pressure',t.vitals.bp],
        ['body-temperature','Body temperature',t.vitals.temp],
        ['heart-rate','Pulse rate',t.vitals.pulse],
        ['oxygen-saturation','Oxygen saturation',t.vitals.spo2],
        ['body-weight','Body weight',t.vitals.weight]
      ];
      vitals.filter(v=>v[2]&&v[2]!=='-').forEach(([code,label,value],idx)=>push({
        resourceType:'Observation',id:fhirId(`obs-${t.id}`,idx+1),status:'final',
        code:{text:label},subject:{reference:`Patient/${fhirId('patient',patientId)}`},
        encounter:{reference:`Encounter/${encounterId}`},effectiveDateTime:`${t.date}T00:00:00+08:00`,
        valueString:String(value)
      }));
    }
    if(t.prescription)push({
      resourceType:'MedicationRequest',id:fhirId('medrequest',t.id),status:'active',intent:'order',
      medicationCodeableConcept:{text:t.prescription},
      subject:{reference:`Patient/${fhirId('patient',patientId)}`},
      encounter:{reference:`Encounter/${encounterId}`},authoredOn:t.date,
      note:[{text:'Free-text medication/treatment instruction from CampusCare clinical record.'}]
    });
  });

  (appState.data.DB.certRequests||[]).filter(r=>r.patientId===patientId&&r.status==='Issued').forEach(r=>push({
    resourceType:'DocumentReference',id:fhirId('document',r.id),status:'current',
    type:{text:'Medical Certificate'},subject:{reference:`Patient/${fhirId('patient',patientId)}`},
    date:r.issuedAt||r.date||appState.clinicInformation.TODAY,
    description:r.certNo?`CampusCare Medical Certificate ${r.certNo}`:'CampusCare Medical Certificate'
  }));

  return {
    resourceType:'Bundle',
    id:`campuscare-patient-${patientId}-${appState.clinicInformation.TODAY}`,
    type:'collection',
    timestamp:new Date().toISOString(),
    meta:{tag:[{system:'urn:campuscare:export',code:'fhir-ready-prototype',display:'CampusCare FHIR-ready export'}]},
    entry:entries
  };
}

export async function viewPatientFHIR(patientId){
  const pt=getPatientById(patientId);if(!pt)return;

  if(!appState.auth.currentUser?._realSupabase){
    const bundle=campusCareFHIRBundle(patientId);if(!bundle)return;
    openModal(`<div class="modal modal-xl">
      <div class="modal-header"><div><h3>FHIR-ready Record Preview</h3><div class="tech-note">Demo FHIR R4-style mapping. Validate against your target implementation guide before real interoperability.</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
      <div class="modal-body"><pre class="fhir-preview">${escapeHtml(JSON.stringify(bundle,null,2))}</pre></div>
      <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{downloadPatientFHIR((patientId))})}>Download JSON</button></div>
    </div>`);
    return;
  }

  if(!pt.dbPatientId){
    toast('The real patient database record could not be identified.','error');
    return;
  }

  openModal(`<div class="modal modal-xl">
    <div class="modal-header"><div><h3>FHIR-ready Record Preview</h3><div class="tech-note">Generating an authorized server-side interoperability bundle…</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body" id="fhir-preview-body">${databaseSkeletonHtml('table')}</div>
  </div>`);

  try{
    const result=await clinicalIntelligenceAction({
      action:'fhir',
      patient_id:Number(pt.dbPatientId),
      mode:'preview'
    });
    const el=document.getElementById('fhir-preview-body');
    if(!el||!result.bundle)return;

    el.innerHTML=`
      <div class="alert alert-info show" style="font-size:.76rem">${escapeHtml(result.validation_note||'Validate this bundle against the receiving FHIR implementation guide before exchange.')}</div>
      <pre class="fhir-preview">${escapeHtml(JSON.stringify(result.bundle,null,2))}</pre>`;

    const modal=el.closest('.modal');
    if(modal&&!modal.querySelector('.modal-footer')){
      modal.insertAdjacentHTML('beforeend',`
        <div class="modal-footer">
          <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
          <button class="btn btn-primary" ${bindAction('click',(event,element)=>{downloadPatientFHIR((patientId))})}>Download JSON</button>
        </div>`);
    }
  }catch(e){
    const el=document.getElementById('fhir-preview-body');
    if(el)el.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to generate the FHIR preview.')}</div>`;
  }
}

export async function downloadPatientFHIR(patientId){
  const pt=getPatientById(patientId);if(!pt)return;

  try{
    let bundle=null;

    if(appState.auth.currentUser?._realSupabase){
      if(!pt.dbPatientId)throw new Error('The real patient database record could not be identified.');

      const result=await clinicalIntelligenceAction({
        action:'fhir',
        patient_id:Number(pt.dbPatientId),
        mode:'export'
      });
      bundle=result.bundle;
    }else{
      bundle=campusCareFHIRBundle(patientId);
    }

    if(!bundle)return;

    const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/fhir+json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`CampusCare_FHIR_${(pt.lname||'patient').replace(/\s+/g,'_')}_${pt.dbPatientId||patientId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);

    toast('FHIR-ready JSON exported. Validate it against the receiving FHIR profile before exchange.','success',6500);
  }catch(e){
    toast(e?.message||'Unable to export the FHIR record.','error',6500);
  }
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
