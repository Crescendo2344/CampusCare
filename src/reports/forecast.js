import {downloadBlob} from '../features/reportCharts.js';
import {state} from '../app/state.js';
import {bindAction} from '../dependencies.js';
import {escapeHtml} from '../features/issueReports.js';
import {FORECAST_HORIZONS,buildForecast,offsetDay} from '../domain/report-analysis.js';
import {chartTypeSwitchHtml,isChartType,reportChartHtml} from '../ui/report-chart.js';
import {aiInsightsPanelHtml,mountAiInsights} from './ai-insights.js';
import {reportData} from './report-data.js';
import {reportSelect} from './custom-report.js';
import {csvColumn,csvFileName,templateCsv} from '../shared/csv.js';
const esc=v=>escapeHtml(String(v??''));
const read=id=>document.getElementById(id)?.value||'';
// Same choices as the inventory planner: 3 months by default, presets or any 7–365 days.
const forecastUi=()=>{const r=state.reports;r.forecastDays??=90;r.forecastChart??='column';return r;};
function horizonPickerHtml(){
  const days=forecastUi().forecastDays,isPreset=FORECAST_HORIZONS.some(([d])=>d===days);
  return `<div class="fc-controls" id="forecast-horizon"><div class="fc-presets" role="group" aria-labelledby="forecast-period-label">${FORECAST_HORIZONS.map(([d,label])=>`<button type="button" class="fc-preset ${d===days?'active':''}" aria-pressed="${d===days}" ${bindAction('click',()=>setForecastHorizon(d))}>${label}</button>`).join('')}</div>
    <label class="fc-custom">Custom <input type="number" id="forecast-days" min="7" max="365" value="${isPreset?'':days}" placeholder="7–365" aria-label="Custom forecast period in days" ${bindAction('change',(event,element)=>setForecastHorizon(element.value))} ${bindAction('keydown',(event,element)=>{if(event.key==='Enter'){event.preventDefault();element.blur();}})}> days</label></div>`;
}
export function setForecastHorizon(value){
  const n=Math.round(Number(value));
  if(!Number.isFinite(n)||n<7||n>365){
    const field=document.getElementById('forecast-days');
    if(field){field.setCustomValidity('Enter 7 to 365 days.');field.reportValidity();setTimeout(()=>field.setCustomValidity(''),2500);}
    return;
  }
  forecastUi().forecastDays=n;
  // Update the picker in place: replacing it would remove the field while it still has focus.
  const host=document.getElementById('forecast-horizon');
  if(host){
    const preset=FORECAST_HORIZONS.some(([d])=>d===n);
    host.querySelectorAll('.fc-preset').forEach((button,i)=>{const on=FORECAST_HORIZONS[i][0]===n;button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));});
    const field=host.querySelector('#forecast-days');if(field&&document.activeElement!==field)field.value=preset?'':String(n);
  }
  runForecast();
}
export function setForecastChart(type){
  if(!isChartType(type))return;
  forecastUi().forecastChart=type;runForecast();
}
export function forecastControls(){
  const today=state.clinicInformation.TODAY,medicines=reportData().consumption;
  return `<div class="card"><div class="card-header"><div><h3>Plan ahead</h3></div><span class="intel-badge">Planning estimate</span></div>
    <div class="report-control-grid">
      ${reportSelect('forecast-clinic','Clinic (visits only)',[['','All clinics'],...['Medical Clinic','Dental Clinic'].map(v=>[v,v])])}
      ${reportSelect('forecast-target','What to forecast',[['visits','Clinical visits'],...medicines.map(m=>['medicine:'+m.item.id,m.item.name+' usage ('+m.item.unit+')'])])}
      <div class="form-group"><label for="forecast-from">History from</label><input type="date" id="forecast-from" value="${offsetDay(today,-89)}" max="${today}"></div>
      <div class="form-group"><label for="forecast-to">History to</label><input type="date" id="forecast-to" value="${today}" max="${today}"></div>
      ${reportSelect('forecast-method','Calculation',[['average','Daily average'],['weekday','Weekday pattern']])}
    </div>
    <div class="form-group"><span class="form-label-text" id="forecast-period-label">Forecast period</span>${horizonPickerHtml()}</div>
    <button class="btn btn-primary" ${bindAction('click',runForecast)}>Update forecast</button>
    </div><div id="forecast-result" aria-live="polite"></div>`;
}
export function runForecast(){
  const host=document.getElementById('forecast-result');if(!host)return;
  try{
    const data=reportData(),target=read('forecast-target'),college=read('rpt-college'),clinic=read('forecast-clinic');
    const medicine=target.startsWith('medicine:')?data.consumption.find(m=>'medicine:'+m.item.id===target):null;
    if(target!=='visits'&&!medicine)throw new Error('Choose an available forecast target.');
    const events=medicine?medicine.events:data.visits.filter(e=>(!college||e.college===college)&&(!clinic||e.clinic===clinic));
    const ui=forecastUi();
    const f=buildForecast(events,{from:read('forecast-from'),to:read('forecast-to'),today:state.clinicInformation.TODAY,days:ui.forecastDays,method:read('forecast-method')});
    const period=FORECAST_HORIZONS.find(([d])=>d===f.horizon)?.[1]||`${f.horizon} days`;
    const series=[...f.history.map(r=>({label:r.label,value:r.amount})),...f.rows.map(r=>({label:r.label,value:r.amount,projected:true}))];
    const unit=medicine?medicine.item.unit:'visits',name=medicine?medicine.item.name:'Clinical visits';
    const stale=f.lastDate&&f.lastDate<offsetDay(state.clinicInformation.TODAY,-30);
    host.innerHTML=`<div class="card"><div class="card-header"><div><h3>${esc(name)} forecast</h3><p class="form-note">History: ${f.from} to ${f.to} · ${f.days} calendar days · ${medicine?'Campus inventory':esc((college||'All colleges')+' · '+(clinic||'All clinics'))}</p></div><span class="intel-badge">${esc(f.historyQuality||'Insufficient history')}</span></div>
      ${f.reason?`<div class="empty-state"><h4>More history needed</h4><p>${esc(f.reason)}</p><p>${f.records} events found in this range.</p></div>`:`
      <div class="intel-grid">
        <div class="intel-card"><div class="intel-kicker">Expected in the next ${esc(period)}</div><div class="intel-value">≈ ${f.projected.toLocaleString()}</div><div class="intel-meta">${esc(unit)} · ${f.rows[0].start} to ${f.rows.at(-1).end}</div></div>
        <div class="intel-card"><div class="intel-kicker">Historical activity</div><div class="intel-value">${f.total.toLocaleString()}</div><div class="intel-meta">${esc(unit)} from ${f.records} recorded events</div></div>
        <div class="intel-card"><div class="intel-kicker">Average per week</div><div class="intel-value">${(f.dailyAverage*7).toFixed(1)}</div><div class="intel-meta">Includes days with no recorded activity</div></div>
        <div class="intel-card"><div class="intel-kicker">Most recent event used</div><div class="intel-value report-date-value">${f.lastDate||'—'}</div><div class="intel-meta">${f.method==='weekday'?'Average for each day of the week':'Total activity ÷ selected calendar days'}</div></div>
      </div>
      ${stale?'<p class="report-stale">The latest event used is over 30 days old. Check that this history still reflects current demand.</p>':''}
      ${aiInsightsPanelHtml('forecast-ai','reports')}
      <div class="report-chart-head">
        <div class="report-forecast-key"><span><i></i> Recorded history (last 8 weeks)</span><span><i class="projected"></i> Estimate, ${f.horizon<=92?'week':'month'} by ${f.horizon<=92?'week':'month'}</span></div>
        ${chartTypeSwitchHtml(ui.forecastChart,type=>bindAction('click',()=>setForecastChart(type)))}
      </div>
      <div class="report-forecast-chart">${reportChartHtml(['pie','doughnut'].includes(ui.forecastChart)?series.filter(r=>r.projected):series,{type:ui.forecastChart,label:`${name}: recorded history and estimate`,limit:30})}</div>
      <details class="report-details"><summary>View forecast table</summary><div class="table-wrap"><table><thead><tr><th>Period</th><th>From</th><th>To</th><th>Estimated ${esc(unit)}</th></tr></thead><tbody>${f.rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${r.start}</td><td>${r.end}</td><td>${r.amount}</td></tr>`).join('')}</tbody></table></div></details>
      <button type="button" class="btn btn-sm" ${bindAction('click',()=>downloadBlob(templateCsv([
        csvColumn('','Forecast For',()=>name),
        csvColumn('Period','Label',r=>r.label),csvColumn('Period','Start',r=>r.start),csvColumn('Period','End',r=>r.end),
        csvColumn('Estimate','Amount',r=>r.amount),csvColumn('Estimate','Unit',()=>unit),
        csvColumn('Scope','College/Department',()=>medicine?'Campus inventory':college||'All colleges'),csvColumn('Scope','Clinic',()=>medicine?'Not applicable':clinic||'All clinics'),
        csvColumn('Method','Calculation',()=>f.method==='weekday'?'Weekday pattern':'Daily average'),
        csvColumn('History','From',()=>f.from),csvColumn('History','To',()=>f.to)
      ],f.rows),csvFileName(`forecast ${f.from} to ${f.to}`),'text/csv;charset=utf-8;'))}><i class="bi bi-download" aria-hidden="true"></i> Download CSV</button>`}
    </div>`;
    if(!f.reason)mountAiInsights('forecast-ai','reports',()=>({
      forecast_of:name,unit,today:state.clinicInformation.TODAY,
      scope:medicine?'Campus inventory disbursements':`${college||'All colleges'} · ${clinic||'All clinics'}`,
      calculation:f.method==='weekday'?'Average for each day of the week':'Daily average over the history',
      history:{from:f.from,to:f.to,calendar_days:f.days,recorded_events:f.records,total:f.total,last_event:f.lastDate,quality:f.historyQuality,last_8_weeks:f.history.map(r=>({week:r.label,amount:r.amount}))},
      forecast:{period:period,days:f.horizon,total:f.projected,average_per_week:Math.round(f.dailyAverage*70)/10,periods:f.rows.map(r=>({period:r.label,from:r.start,to:r.end,amount:r.amount}))}
    }));
  }catch(error){host.innerHTML=`<div class="alert alert-danger show" role="alert">${esc(error.message)}</div>`;}
}
export function markForecastStale(event){
  // The period picker recalculates straight away, so its own changes never make the result stale.
  if(event?.target?.closest?.('#forecast-horizon'))return;
  const host=document.getElementById('forecast-result');if(host?.textContent)host.innerHTML='<p class="report-stale" role="status">Forecast settings changed. Select Update forecast to calculate again.</p>';
}
