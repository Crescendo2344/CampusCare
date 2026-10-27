import {downloadBlob,rowsToCSV} from '../features/reportCharts.js';
import {state} from '../app/state.js';
import {bindAction} from '../dependencies.js';
import {escapeHtml} from '../features/issueReports.js';
import {buildForecast,offsetDay} from '../domain/report-analysis.js';
import {reportData} from './report-data.js';
import {reportSelect,reportBars} from './custom-report.js';
import {csvFileName} from '../shared/csv.js';
const esc=v=>escapeHtml(String(v??''));
const read=id=>document.getElementById(id)?.value||'';
export function forecastControls(){
  const today=state.clinicInformation.TODAY,medicines=reportData().consumption;
  return `<div class="card"><div class="card-header"><div><h3>Plan the coming weeks</h3><p class="form-note">Choose past dates to learn from, then estimate demand starting tomorrow.</p></div><span class="intel-badge">Planning estimate</span></div>
    <div class="report-control-grid">
      ${reportSelect('forecast-clinic','Clinic (visits only)',[['','All clinics'],...['Medical Clinic','Dental Clinic'].map(v=>[v,v])])}
      ${reportSelect('forecast-target','What to forecast',[['visits','Clinical visits'],...medicines.map(m=>['medicine:'+m.item.id,m.item.name+' usage ('+m.item.unit+')'])])}
      <div class="form-group"><label for="forecast-from">History from</label><input type="date" id="forecast-from" value="${offsetDay(today,-89)}" max="${today}"></div>
      <div class="form-group"><label for="forecast-to">History to</label><input type="date" id="forecast-to" value="${today}" max="${today}"></div>
      ${reportSelect('forecast-weeks','Forecast period',[['4','Next 4 weeks'],['8','Next 8 weeks'],['12','Next 12 weeks']])}
      ${reportSelect('forecast-method','Calculation',[['average','Daily average'],['weekday','Weekday pattern']])}
    </div><p class="form-note">Clinical visits use the selected college. Medicine usage uses campus inventory disbursements and is not filtered by college. A completed booking and its linked treatment count as one visit.</p>
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
    const f=buildForecast(events,{from:read('forecast-from'),to:read('forecast-to'),today:state.clinicInformation.TODAY,weeks:Number(read('forecast-weeks')),method:read('forecast-method')});
    const unit=medicine?medicine.item.unit:'visits',name=medicine?medicine.item.name:'Clinical visits';
    const stale=f.lastDate&&f.lastDate<offsetDay(state.clinicInformation.TODAY,-30);
    host.innerHTML=`<div class="card"><div class="card-header"><div><h3>${esc(name)} forecast</h3><p class="form-note">History: ${f.from} to ${f.to} · ${f.days} calendar days · ${medicine?'Campus inventory':esc((college||'All colleges')+' · '+(clinic||'All clinics'))}</p></div><span class="intel-badge">${esc(f.historyQuality||'Insufficient history')}</span></div>
      ${f.reason?`<div class="empty-state"><h4>More history needed</h4><p>${esc(f.reason)}</p><p>${f.records} events found in this range.</p></div>`:`
      <div class="intel-grid">
        <div class="intel-card"><div class="intel-kicker">Expected next ${f.weeks} weeks</div><div class="intel-value">≈ ${f.projected.toLocaleString()}</div><div class="intel-meta">${esc(unit)} · ${f.rows[0].start} to ${f.rows.at(-1).end}</div></div>
        <div class="intel-card"><div class="intel-kicker">Historical activity</div><div class="intel-value">${f.total.toLocaleString()}</div><div class="intel-meta">${esc(unit)} from ${f.records} recorded events</div></div>
        <div class="intel-card"><div class="intel-kicker">Average per week</div><div class="intel-value">${(f.dailyAverage*7).toFixed(1)}</div><div class="intel-meta">Includes days with no recorded activity</div></div>
        <div class="intel-card"><div class="intel-kicker">Most recent event used</div><div class="intel-value report-date-value">${f.lastDate||'—'}</div><div class="intel-meta">${f.method==='weekday'?'Average for each day of the week':'Total activity ÷ selected calendar days'}</div></div>
      </div>
      ${stale?'<p class="report-stale">The latest event used is over 30 days old. Check that this history still reflects current demand.</p>':''}
      <div class="report-forecast-key"><span><i></i> Recorded history (last 8 weeks of selected range)</span><span><i class="projected"></i> Estimated future demand</span></div>
      <div class="report-two-column"><div><h4>Recorded history</h4>${reportBars(f.history.map(r=>({label:r.start,value:r.amount})))}</div><div class="report-projection"><h4>Weekly estimate</h4>${reportBars(f.rows.map(r=>({label:r.start,value:r.amount})),{forecast:true})}</div></div>
      <details class="report-details"><summary>View weekly forecast table</summary><div class="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Estimated ${esc(unit)}</th></tr></thead><tbody>${f.rows.map(r=>`<tr><td>${r.start}</td><td>${r.end}</td><td>${r.amount}</td></tr>`).join('')}</tbody></table></div></details>
      <button type="button" class="btn btn-sm" ${bindAction('click',()=>downloadBlob(rowsToCSV(f.rows.map(r=>({'History from':f.from,'History to':f.to,'Target':name,'College':medicine?'Campus inventory':college||'All colleges','Clinic':medicine?'Not applicable':clinic||'All clinics','Method':f.method,'From':r.start,'To':r.end,'Estimated demand':r.amount,'Unit':unit}))),csvFileName(`forecast ${f.from} to ${f.to}`),'text/csv;charset=utf-8;'))}>Export forecast CSV</button>
      <p class="form-note">Estimates use only the selected history. They do not account for holidays, enrollment changes or unexpected events. These are planning estimates, not guaranteed totals or statistical confidence intervals.</p>`}
    </div>`;
  }catch(error){host.innerHTML=`<div class="alert alert-danger show" role="alert">${esc(error.message)}</div>`;}
}
export function markForecastStale(){
  const host=document.getElementById('forecast-result');if(host?.textContent)host.innerHTML='<p class="report-stale" role="status">Forecast settings changed. Select Update forecast to calculate again.</p>';
}
