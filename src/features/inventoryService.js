// inventoryService: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {computeCampusHealthAnalytics,healthAnalyticsAnchorDate} from './predictiveAnalytics.js';
import {isoDateOffset} from './dashboardChartHelpers.js';
import {fmtDate} from './inputValidation.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {treatmentRecords} from './treatmentService.js';
import {appointmentRecords} from './appointmentService.js';
import {closeTopModal,openModal} from './modals.js';
import {joinSoapNote,splitSoapNote,summarizeFhirBundle} from '../domain/clinical-display.js';
import {patientDisplayId} from './patientService.js';
import {toast} from './theme.js';
import {databaseSkeletonHtml} from './loadingSkeletons.js';
import {bindAction,createInventoryService,inventoryData} from '../dependencies.js';
import {aiInsightsPanelHtml,mountAiInsights} from '../reports/ai-insights.js';
import {DEFAULT_HORIZON,FORECAST_PRESETS,MAX_HORIZON,MIN_HORIZON,clampHorizon,projectItem} from '../domain/inventory-projection.js';
import {csvDate,csvFileName,csvReadableDate,downloadCsv,toCsv} from '../shared/csv.js';
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

// ---------- Adjustable inventory forecast ----------
function forecastDays(){return clampHorizon(appState.inventoryList.forecastDays??DEFAULT_HORIZON);}
function horizonLabel(days){
  const preset=FORECAST_PRESETS.find(([d])=>d===days);
  return preset?preset[1]:`${days} days`;
}

// One projection per active consumable with usage history; items without history are counted, not guessed.
export function inventoryForecastProjections(days=forecastDays()){
  const start=appState.clinicInformation.TODAY;
  const items=inventoryRecords().filter(i=>!i.archived&&i.category!=='Equipment');
  const rows=[],missing=[];
  for(const item of items){
    const f=getInventoryForecast(item);
    if(!f.hasData){missing.push(item);continue;}
    const monthlyUsage={};
    if(appState.auth.currentUser?._realSupabase&&item._realSupabase){
      for(const r of inventoryForecastRecords().filter(x=>x.itemId===item.id))monthlyUsage[String(r.forecastMonth).slice(0,7)]=Number(r.predictedUsage||0);
    }
    rows.push({item,p:projectItem({qty:Number(item.qty??0),threshold:Number(item.threshold||0),start,days,dailyRate:f.adjustedDaily,monthlyUsage})});
  }
  // Items that need action soonest come first.
  rows.sort((a,b)=>(a.p.reorderBy||'9999').localeCompare(b.p.reorderBy||'9999')||a.item.name.localeCompare(b.item.name));
  return {rows,missing,days,start};
}

function forecastCellHtml(period,item){
  const unit=escapeHtml(item.unit||'');
  const after=period.stockAfter<0
    ?`<span class="fc-out">Short by ${Math.abs(period.stockAfter)} ${unit}</span>`
    :period.stockAfter<=Number(item.threshold||0)?`<span class="fc-low">${period.stockAfter} ${unit} left · below reorder level</span>`
    :`<span>${period.stockAfter} ${unit} left</span>`;
  return `<td><strong>${period.use} ${unit}</strong><small>used</small>${after}</td>`;
}

function forecastPlanHtml({item,p}){
  const unit=escapeHtml(item.unit||'');
  if(!p.reorderQty)return `<td class="fc-plan ok"><strong>Enough stock</strong><span>${p.stockAtEnd} ${unit} left on ${escapeHtml(fmtDate(p.end))}</span></td>`;
  return `<td class="fc-plan ${p.stockoutDate?'risk':'watch'}"><strong>Order ${p.reorderQty} ${unit}</strong><span>by ${escapeHtml(fmtDate(p.reorderBy))}${p.stockoutDate?` · runs out ${escapeHtml(fmtDate(p.stockoutDate))}`:''}</span></td>`;
}

export function forecastSectionHtml(){
  const {rows,missing,days}=inventoryForecastProjections();
  const isPreset=FORECAST_PRESETS.some(([d])=>d===days);
  const controls=`<div class="fc-controls">
    <div class="fc-presets" role="group" aria-label="Forecast period">${FORECAST_PRESETS.map(([d,label])=>`<button type="button" class="fc-preset ${d===days?'active':''}" aria-pressed="${d===days}" ${bindAction('click',()=>setForecastDays(d))}>${label}</button>`).join('')}</div>
    <label class="fc-custom">Custom <input type="number" id="fc-days" min="${MIN_HORIZON}" max="${MAX_HORIZON}" value="${isPreset?'':days}" placeholder="${MIN_HORIZON}–${MAX_HORIZON}" aria-label="Custom forecast period in days" ${bindAction('change',(event,element)=>setForecastDays(element.value))} ${bindAction('keydown',(event,element)=>{if(event.key==='Enter'){event.preventDefault();setForecastDays(element.value);}})}> days</label>
    <button type="button" class="btn btn-sm" ${rows.length?'':'disabled'} ${bindAction('click',()=>openForecastCsvDialog())}><i class="bi bi-download" aria-hidden="true"></i> Download CSV</button>
  </div>`;
  if(!rows.length)return controls+'<div class="tech-note">Add inventory items and record disbursements to generate a forecast.</div>';
  const periods=rows[0].p.periods;
  return controls+aiInsightsPanelHtml('inv-forecast-ai','inventory')+`<div class="table-wrap"><table class="forecast-table">
    <thead><tr><th>Item</th>${periods.map(p=>`<th>${escapeHtml(p.label)}</th>`).join('')}<th>Plan for ${escapeHtml(horizonLabel(days))}</th></tr></thead>
    <tbody>${rows.map(({item,p})=>`<tr>
      <td class="fc-item"><strong>${escapeHtml(item.name)}</strong><span>${Number(item.qty??0)} ${escapeHtml(item.unit||'')} in stock · reorder at ${Number(item.threshold||0)}</span><span>About ${p.averageDaily.toFixed(1)} ${escapeHtml(item.unit||'')} a day</span></td>
      ${p.periods.map(period=>forecastCellHtml(period,item)).join('')}
      ${forecastPlanHtml({item,p})}
    </tr>`).join('')}</tbody>
  </table></div>${missing.length?`<p class="fc-missing">${missing.length} item${missing.length===1?'':'s'} not shown because there is no usage history yet: ${missing.slice(0,5).map(i=>escapeHtml(i.name)).join(', ')}${missing.length>5?' and more':''}.</p>`:''}`;
}

// The AI panel reads the same projection the table shows, limited to the items that need attention first.
export function mountInventoryForecastAi(){
  mountAiInsights('inv-forecast-ai','inventory',()=>{
    const {rows,missing,days,start}=inventoryForecastProjections();
    return {
      today:start,period:horizonLabel(days),days,
      items:rows.slice(0,60).map(({item,p})=>({
        item:item.name,category:item.category,unit:item.unit,on_hand:Number(item.qty??0),reorder_level:Number(item.threshold||0),
        average_daily_use:Math.round(p.averageDaily*10)/10,projected_use:p.totalUse,stock_at_end:p.stockAtEnd,
        runs_out:p.stockoutDate||null,suggested_order:p.reorderQty,order_by:p.reorderBy||null,expiry:item.expiryDate||null,
        periods:p.periods.map(x=>({period:x.label,use:x.use,left:x.stockAfter}))
      })),
      items_not_shown:Math.max(0,rows.length-60),
      items_without_usage_history:missing.length
    };
  });
}

export function setForecastDays(value){
  const raw=Number(value);
  if(!Number.isFinite(raw)||raw<=0){toast(`Enter a forecast period between ${MIN_HORIZON} and ${MAX_HORIZON} days.`,'warning');return;}
  const days=clampHorizon(raw);
  if(days!==Math.round(raw))toast(`Forecasts cover ${MIN_HORIZON} to ${MAX_HORIZON} days, so ${days} days is shown.`,'info');
  appState.inventoryList.forecastDays=days;
  const host=document.getElementById('inv-forecast');if(host){host.innerHTML=forecastSectionHtml();mountInventoryForecastAi();}
  const badge=document.getElementById('inv-forecast-badge');if(badge)badge.textContent=`${horizonLabel(days)} forecast`;
}

// ---------- Forecast CSV with chosen layout, columns and date style ----------
const FORECAST_COLUMNS=[
  ['itemNo','Item #',true],['category','Category',true],['unit','Unit',true],['onHand','Quantity on hand',true],['reorderLevel','Reorder level',true],
  ['dailyUse','Average daily use',true],['totalUse','Projected use',true],['stockAtEnd','Stock at end of period',true],
  ['runsOut','Runs out on',true],['orderQty','Suggested order quantity',true],['orderBy','Order by',true]
];

export function openForecastCsvDialog(){
  const days=forecastDays();
  openModal(`<div class="modal modal-sm fc-csv" role="dialog" aria-labelledby="fc-csv-title">
    <div class="modal-header"><h3 id="fc-csv-title">Download forecast CSV</h3><button class="close-btn" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body">
      <fieldset class="fc-field"><legend>Layout</legend>
        <label><input type="radio" name="fc-layout" value="summary" checked> One row per item</label>
        <label><input type="radio" name="fc-layout" value="detailed"> One row per item for each ${days<=31?'week':'month'}</label></fieldset>
      <fieldset class="fc-field"><legend>Columns</legend><div class="fc-columns">${FORECAST_COLUMNS.map(([key,label,on])=>`<label><input type="checkbox" name="fc-col" value="${key}" ${on?'checked':''}> ${label}</label>`).join('')}</div></fieldset>
      <fieldset class="fc-field"><legend>Dates</legend>
        <label><input type="radio" name="fc-dates" value="iso" checked> 2026-10-27 (sorts correctly)</label>
        <label><input type="radio" name="fc-dates" value="readable"> Oct 27, 2026</label></fieldset>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" ${bindAction('click',()=>downloadForecastCsv())}><i class="bi bi-download" aria-hidden="true"></i> Download</button></div>
  </div>`,{preserveParent:Boolean(appState.clinicInformation.activeModal?.isConnected)});
}

export function downloadForecastCsv(){
  const {rows,days,start}=inventoryForecastProjections();
  const layout=document.querySelector('input[name="fc-layout"]:checked')?.value||'summary';
  const readable=document.querySelector('input[name="fc-dates"]:checked')?.value==='readable';
  const chosen=new Set([...document.querySelectorAll('input[name="fc-col"]:checked')].map(el=>el.value));
  const date=v=>v?(readable?csvReadableDate(v):csvDate(v)):'';
  const value={
    itemNo:({item})=>inventoryDisplayId(item),category:({item})=>item.category||'',unit:({item})=>item.unit||'',
    onHand:({item})=>Number(item.qty??0),reorderLevel:({item})=>Number(item.threshold||0),
    dailyUse:({p})=>p.averageDaily.toFixed(2),totalUse:({p})=>p.totalUse,stockAtEnd:({p})=>p.stockAtEnd,
    runsOut:({p})=>date(p.stockoutDate),orderQty:({p})=>p.reorderQty,orderBy:({p})=>date(p.reorderBy)
  };
  const columns=FORECAST_COLUMNS.filter(([key])=>chosen.has(key));
  let table;
  if(layout==='detailed'){
    // Per-period rows keep the item's identifying columns and add the period's own figures.
    const idCols=columns.filter(([key])=>['itemNo','category','unit','onHand','reorderLevel'].includes(key));
    table=[['Item',...idCols.map(([,label])=>label),'Period start','Period end','Projected use','Stock left at period end']];
    for(const r of rows)for(const period of r.p.periods)table.push([r.item.name,...idCols.map(([key])=>value[key](r)),date(period.start),date(period.end),period.use,period.stockAfter]);
  }else{
    table=[['Item',...columns.map(([,label])=>label)],...rows.map(r=>[r.item.name,...columns.map(([key])=>value[key](r))])];
  }
  downloadCsv(csvFileName(`inventory forecast ${days} days from ${start}`),toCsv(table));
  closeTopModal();
  toast('Forecast CSV downloaded.','success');
}

export function predictiveInventorySummaryHtml(){
  const items=inventoryRecords().filter(i=>!i.archived);
  const forecasts=items.map(item=>({item,f:getInventoryForecast(item)})).filter(x=>x.f.hasData);
  const atRisk=forecasts.filter(x=>x.f.daysRemaining<=14).sort((a,b)=>a.f.daysRemaining-b.f.daysRemaining);
  const soon=atRisk[0];

  return `<div class="card">
    <div class="card-header">
      <div><h3>Predictive Inventory</h3><div class="tech-note">Projected use and stock from recorded disbursements.</div></div>
      <span class="intel-badge" id="inv-forecast-badge">${escapeHtml(horizonLabel(forecastDays()))} forecast</span>
    </div>
    <div class="intel-grid">
      <div class="intel-card ${atRisk.length?'intel-risk-medium':'intel-risk-low'}"><div class="intel-kicker">At risk in 14 days</div><div class="intel-value">${atRisk.length}</div><div class="intel-meta">Consumable item${atRisk.length===1?'':'s'} projected to run low soon</div></div>
      <div class="intel-card"><div class="intel-kicker">Soonest projected depletion</div><div class="intel-value" style="font-size:.95rem">${soon?escapeHtml(soon.item.name):'No immediate risk'}</div><div class="intel-meta">${soon?`${soon.f.daysRemaining} days · ${fmtDate(soon.f.stockoutDate)}`:'Based on available history'}</div></div>
      <div class="intel-card"><div class="intel-kicker">Forecast coverage</div><div class="intel-value">${forecasts.length}/${items.length}</div><div class="intel-meta">Active items with usable demand history</div></div>
    </div>
    ${atRisk.length?`<div class="intel-alert-list">${atRisk.slice(0,4).map(({item,f})=>`<div class="intel-alert-item"><div class="intel-alert-icon ${f.risk==='high'?'danger':'warning'}">${f.risk==='high'?'<i class="bi bi-exclamation-triangle" aria-hidden="true"></i>':'<i class="bi bi-box-seam" aria-hidden="true"></i>'}</div><div class="intel-alert-copy"><strong>${escapeHtml(item.name)} — ${f.daysRemaining} days remaining</strong><span>Projected depletion ${fmtDate(f.stockoutDate)}. Suggested reorder: ${f.reorderQty} ${escapeHtml(item.unit)}. Current forecast usage ≈ ${f.adjustedDaily.toFixed(1)} ${escapeHtml(item.unit)}/day.</span></div></div>`).join('')}</div>`:`<div class="tech-note">No item with sufficient usage history is forecast to deplete within 14 days.</div>`}
    <div class="section-label" style="margin-top:1rem">Consumption forecast</div>
    <div id="inv-forecast">${forecastSectionHtml()}</div>
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

// Copilot and FHIR dialogs open above the patient chart and close back to it.
const openOverChart=html=>openModal(html,{preserveParent:Boolean(appState.clinicInformation.activeModal?.isConnected)});
const alertIcon=type=>type==='danger'?'bi-exclamation-octagon-fill':type==='warning'?'bi-clock-history':'bi-info-circle-fill';

function copilotShell(pt,body){
  return `<div class="modal modal-xl copilot-modal">
    <div class="modal-header"><div><h3><i class="bi bi-stars" aria-hidden="true"></i> Clinical Copilot</h3><div class="copilot-subtitle">${escapeHtml(pt.lname)}, ${escapeHtml(pt.fname)} · P-${patientDisplayId(pt)}</div></div><button class="close-btn" aria-label="Close Clinical Copilot" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body" id="clinical-copilot-content">${body}</div>
  </div>`;
}

// Normalised copilot view: snapshot facts, attention cards, history timeline and an editable SOAP draft.
function renderCopilot(pt,patientId,x){
  const el=document.getElementById('clinical-copilot-content');
  if(!el)return;
  const allergy=pt.allergies&&!/^(none|n\/a|na|nkda)$/i.test(pt.allergies.trim());
  const facts=[
    ['Age / Sex',`${pt.age===''||pt.age==null?'—':pt.age} · ${pt.gender||'—'}`],
    ['Blood type',pt.blood||'—'],
    ['Allergies',pt.allergies||'None recorded',allergy],
    ['Records',`${x.counts.treatments} treatment${x.counts.treatments===1?'':'s'} · ${x.counts.appointments} appointment${x.counts.appointments===1?'':'s'}`]
  ];
  const soap=splitSoapNote(x.draft);
  const soapLabels={S:'Subjective — symptoms and concerns',O:'Objective — findings and vitals',A:'Assessment',P:'Plan — treatment and follow-up'};
  el.innerHTML=`
    <div class="copilot-banner"><i class="bi bi-shield-check" aria-hidden="true"></i><span>Summarises existing CampusCare records only. It does not diagnose or prescribe — review the full chart and confirm everything with the patient before using any draft.</span></div>
    <div class="copilot-layout">
      <div class="copilot-column">
        <section class="copilot-card">
          <h4>Patient snapshot</h4>
          <dl class="copilot-facts">${facts.map(([label,value,warn])=>`<div><dt>${label}</dt><dd class="${warn?'text-danger':''}">${escapeHtml(value)}</dd></div>`).join('')}</dl>
          <p class="copilot-summary">${escapeHtml(x.summary||'')}</p>
        </section>
        <section class="copilot-card">
          <h4>Needs attention <span class="copilot-count">${x.alerts.length}</span></h4>
          ${x.alerts.length?`<ul class="copilot-alerts">${x.alerts.map(a=>`<li class="copilot-alert ${escapeHtml(a.type||'info')}"><i class="bi ${alertIcon(a.type)}" aria-hidden="true"></i><div><strong>${escapeHtml(a.title||'Attention')}</strong><span>${escapeHtml(a.detail||'')}</span></div></li>`).join('')}</ul>`
            :'<p class="copilot-empty"><i class="bi bi-check-circle" aria-hidden="true"></i> No automatic warnings. Still review the complete chart.</p>'}
        </section>
        <section class="copilot-card">
          <h4>Recent clinical history</h4>
          ${x.history.length?`<ol class="copilot-timeline">${x.history.map(item=>`<li><span class="copilot-time">${escapeHtml(item.date||'')}</span><strong>${escapeHtml(item.title)}</strong>${item.detail?`<span>${escapeHtml(item.detail)}</span>`:''}</li>`).join('')}</ol>`:'<p class="copilot-empty">No recent treatment history.</p>'}
        </section>
      </div>
      <section class="copilot-card copilot-note">
        <div class="copilot-note-head"><h4>Draft visit note</h4><span class="intel-badge">Human review required</span></div>
        ${soap?Object.entries(soapLabels).map(([key,label])=>`<label class="copilot-soap-field"><span><b>${key}</b> ${label}</span><textarea data-soap="${key}" rows="${key==='O'?4:3}">${escapeHtml(soap[key])}</textarea></label>`).join('')
          :`<textarea id="copilot-soap" rows="14">${escapeHtml(x.draft||'')}</textarea>`}
        <div class="copilot-note-actions">
          <button class="btn btn-sm" ${bindAction('click',()=>renderCopilot(pt,patientId,x))}><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Reset draft</button>
          <button class="btn btn-primary btn-sm" ${bindAction('click',()=>copyCopilotDraft())}><i class="bi bi-clipboard" aria-hidden="true"></i> Copy note</button>
        </div>
      </section>
    </div>
    <div class="copilot-footer">
      <span class="tech-note">${escapeHtml(x.method)}</span>
      <div class="fhir-toolbar">
        <button class="btn btn-sm" ${bindAction('click',()=>viewPatientFHIR(patientId))}><i class="bi bi-filetype-json" aria-hidden="true"></i> FHIR Preview</button>
        <button class="btn btn-sm" ${bindAction('click',()=>downloadPatientFHIR(patientId))}><i class="bi bi-download" aria-hidden="true"></i> Export FHIR</button>
      </div>
    </div>`;
}

// "2026-10-20 — Diagnosis; treatment: …" history lines become timeline entries.
const historyItem=line=>{
  if(line&&typeof line==='object')return {date:line.date?fmtDate(line.date):'',title:line.diagnosis||line.title||'Visit',detail:line.prescription?`Treatment: ${line.prescription}`:line.detail||''};
  const [date,rest='']=String(line).split(/\s+—\s+/);
  const [title,...detail]=(rest||date).split(/;\s*/);
  return {date:rest?date:'',title:title||'Visit',detail:detail.join('; ').replace(/^treatment:\s*/i,'Treatment: ')};
};

export async function openClinicalCopilot(patientId){
  const pt=getPatientById(patientId);
  if(!pt)return;

  if(!appState.auth.currentUser?._realSupabase){
    const x=buildClinicalCopilot(patientId);if(!x)return;
    openOverChart(copilotShell(pt,''));
    renderCopilot(pt,patientId,{
      summary:x.summary,alerts:x.alerts,draft:x.soap,
      history:x.treatments.slice(0,5).map(t=>({date:fmtDate(t.date),title:t.diagnosis||'No diagnosis recorded',detail:t.prescription?`Treatment: ${t.prescription}`:''})),
      counts:{treatments:x.treatments.length,appointments:x.appointments.length},
      method:'Local record summary (offline demo data)'
    });
    return;
  }

  if(!pt.dbPatientId){
    toast('The real patient database record could not be identified.','error');
    return;
  }
  openOverChart(copilotShell(pt,`<p class="tech-note">Loading clinical records…</p>${databaseSkeletonHtml('cards',4)}`));
  try{
    const result=await clinicalIntelligenceAction({action:'copilot',patient_id:Number(pt.dbPatientId)});
    const x=result.copilot;
    if(!x)throw new Error('The Clinical Copilot returned no summary for this patient. Try again later.');
    renderCopilot(pt,patientId,{
      summary:x.summary||'',alerts:x.alerts||[],draft:x.draft_note||'',
      history:(x.recent_history||[]).map(historyItem),
      counts:{treatments:Number(x.record_counts?.treatments||0),appointments:Number(x.record_counts?.appointments||0)},
      method:`Method: ${x.method||'Explainable clinical-record summarization'}`
    });
  }catch(e){
    const el=document.getElementById('clinical-copilot-content');
    if(el)el.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load the Clinical Copilot.')}</div>`;
  }
}

export function copyCopilotDraft(){
  const fields=[...document.querySelectorAll('#clinical-copilot-content [data-soap]')];
  const text=fields.length?joinSoapNote(Object.fromEntries(fields.map(field=>[field.dataset.soap,field.value]))):document.getElementById('copilot-soap')?.value||'';
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

// FHIR export preview: what the bundle contains in plain terms first, raw JSON on its own tab.
function fhirShell(pt,body){
  return `<div class="modal modal-xl fhir-modal">
    <div class="modal-header"><div><h3><i class="bi bi-filetype-json" aria-hidden="true"></i> FHIR Record Export</h3><div class="copilot-subtitle">${escapeHtml(pt.lname)}, ${escapeHtml(pt.fname)} · P-${patientDisplayId(pt)} · FHIR R4 collection bundle</div></div><button class="close-btn" aria-label="Close FHIR preview" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body" id="fhir-preview-body">${body}</div>
  </div>`;
}
function renderFhirPreview(patientId,bundle,note){
  const el=document.getElementById('fhir-preview-body');
  if(!el)return;
  const summary=summarizeFhirBundle(bundle);
  const json=JSON.stringify(bundle,null,2);
  const show=tab=>{
    el.querySelectorAll('[data-fhir-tab]').forEach(button=>{const on=button.dataset.fhirTab===tab;button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));});
    el.querySelectorAll('[data-fhir-panel]').forEach(panel=>{panel.hidden=panel.dataset.fhirPanel!==tab;});
  };
  el.innerHTML=`
    <div class="fhir-counts">${summary.counts.map(c=>`<span class="fhir-count"><strong>${c.count}</strong> ${escapeHtml(c.type)}</span>`).join('')}<span class="fhir-count total"><strong>${summary.total}</strong> resources</span></div>
    <p class="fhir-note"><i class="bi bi-info-circle" aria-hidden="true"></i> ${escapeHtml(note)}</p>
    <div class="pt-tabs" role="tablist">
      <button type="button" role="tab" class="pt-tab active" data-fhir-tab="summary" aria-selected="true" ${bindAction('click',()=>show('summary'))}>Summary</button>
      <button type="button" role="tab" class="pt-tab" data-fhir-tab="json" aria-selected="false" ${bindAction('click',()=>show('json'))}>JSON</button>
    </div>
    <div data-fhir-panel="summary"><div class="table-wrap"><table><thead><tr><th>Resource</th><th>Details</th><th>Date</th><th>Status</th><th>ID</th></tr></thead><tbody>${summary.rows.map(r=>`<tr><td><span class="badge badge-info">${escapeHtml(r.type)}</span></td><td>${escapeHtml(r.detail)}</td><td>${r.date?fmtDate(r.date):'—'}</td><td>${escapeHtml(r.status||'—')}</td><td class="text-muted"><code>${escapeHtml(r.id)}</code></td></tr>`).join('')}</tbody></table></div></div>
    <div data-fhir-panel="json" hidden><pre class="fhir-preview">${escapeHtml(json)}</pre></div>
    <div class="copilot-footer">
      <span class="tech-note">Generated ${escapeHtml(new Date(bundle.timestamp||Date.now()).toLocaleString('en-PH'))}</span>
      <div class="fhir-toolbar">
        <button class="btn btn-sm" ${bindAction('click',()=>{navigator.clipboard?.writeText(json).then(()=>toast('FHIR JSON copied.','success')).catch(()=>toast('Could not access the clipboard.','warning'));})}><i class="bi bi-clipboard" aria-hidden="true"></i> Copy JSON</button>
        <button class="btn btn-primary btn-sm" ${bindAction('click',()=>downloadPatientFHIR(patientId))}><i class="bi bi-download" aria-hidden="true"></i> Download JSON</button>
      </div>
    </div>`;
}

export async function viewPatientFHIR(patientId){
  const pt=getPatientById(patientId);if(!pt)return;
  const note='Validate this bundle against the receiving system\'s FHIR implementation guide before sharing it.';
  if(!appState.auth.currentUser?._realSupabase){
    const bundle=campusCareFHIRBundle(patientId);if(!bundle)return;
    openOverChart(fhirShell(pt,''));
    renderFhirPreview(patientId,bundle,note);
    return;
  }
  if(!pt.dbPatientId){
    toast('The real patient database record could not be identified.','error');
    return;
  }
  openOverChart(fhirShell(pt,`<p class="tech-note">Preparing the record export…</p>${databaseSkeletonHtml('table')}`));
  try{
    const result=await clinicalIntelligenceAction({action:'fhir',patient_id:Number(pt.dbPatientId),mode:'preview'});
    if(!result.bundle)throw new Error('No FHIR bundle was returned for this patient. Try again later.');
    renderFhirPreview(patientId,result.bundle,result.validation_note||note);
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
