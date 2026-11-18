// Reports → Saturday Clinic Visit Log: everyone seen on Saturdays, printed one sheet per Saturday in the
// format of the clinic's paper log. Administrators choose a clinic; staff always get their own clinic.
import {state} from '../app/state.js';
import {buildSaturdayVisitLog,saturdayLogFilterError} from '../domain/saturday-visit-log.js';
import {staffClinicOf} from '../domain/clinic-scope.js';
import {bindAction} from '../ui/events.js';
import {escapeHtml as escapeText} from '../features/issueReports.js';
import {captureCampusPageToken,isCampusPageCurrent} from '../features/navigationRaceProtection.js';
import {letterheadUnit,printCtuDocument} from '../shared/ctu-letterhead.js';
import {SATURDAY_LOG_COLUMNS,SATURDAY_SHEET_CSS,saturdayCell as cell,saturdaySheetHtml as sheetHtml} from './saturday-sheet.js';
import {toast} from '../features/theme.js';
const esc=value=>escapeText(String(value??''));
const value=id=>document.getElementById(id)?.value||'';
export function saturdayFilterMarkup(){
  const clinic=staffClinicOf(state.auth.currentUser);
  const select=(id,label,options)=>`<div class="form-group"><label for="${id}">${label}</label><select id="${id}">${options.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div>`;
  return `<fieldset id="saturday-report-filters" hidden style="border:0;margin-top:1rem;padding:0"><legend>Saturday visit log</legend>
    <p class="form-note">Lists everyone seen on each Saturday in the date range above, one sheet per Saturday, in the clinic's log format. Completed appointments and walk-in treatments count; cancelled or missed bookings do not.</p>
    <div class="form-row">
      ${clinic?`<div class="form-group"><label>Clinic</label><div class="form-note" style="margin-top:.45rem"><strong>${esc(clinic)}</strong></div></div>`:select('rpt-sat-clinic','Clinic',[['Dental Clinic','Dental Clinic'],['Medical Clinic','Medical Clinic'],['','Both clinics']])}
      ${select('rpt-sat-people','Include',[['students','Students only'],['everyone','Students and personnel']])}
      ${select('rpt-sat-blank','Blank rows on each printed sheet',[['5','5 rows for walk-ins'],['10','10 rows'],['0','None']])}
    </div></fieldset>`;
}

export function readSaturdayFilters(){
  const clinic=staffClinicOf(state.auth.currentUser);
  return {from:value('rpt-from'),to:value('rpt-to'),clinic:clinic||value('rpt-sat-clinic'),college:value('rpt-college'),people:value('rpt-sat-people')||'students'};
}

// Demo accounts keep their records in the browser; shape them like the database rows.
function demoSaturdayData(){
  const db=state.data.DB;
  return {
    users:db.users.map(u=>({user_id:u.id,first_name:u.fname,last_name:u.lname,id_number:u.idNo,person_type:u.personType,college:u.college,contact_number:u.contact||u.contactNo,role:u.role,specialty:u.specialty})),
    patients:db.patients.map(p=>({patient_id:p.id,user_id:p.userId,birth_date:p.birthDate,sex:p.gender,course:p.course,major:p.major})),
    appointments:db.appointments.map(a=>({appointment_id:a.id,patient_id:a.patientId,clinic:a.clinic,service:a.service,appointment_date:a.date,appointment_time:a.time,status:a.status})),
    treatments:db.treatments.map(t=>({treatment_id:t.id,patient_id:t.patientId,doctor_id:t.doctorId,appointment_id:t.appointmentId,treatment_date:t.date,created_at:t.createdAt,archived_at:t.archived?'archived':null})),
    dentalRecords:db.treatments.filter(t=>t.dentalRecord).map(t=>({treatment_id:t.id,course_major:t.dentalRecord.courseMajor,year_section:t.dentalRecord.yearSection,accomplishment:t.dentalRecord.accomplishment}))
  };
}

export function printSaturdayLog(log,blankRows=5){
  if(!log?.days?.length){toast('There are no Saturday visits to print.','error');return;}
  toast('Opening print dialog — choose "Save as PDF" to keep a copy.','info');
  const unit=letterheadUnit(log.clinic);
  // The clinic name sits on the DATE line, as on the paper form, so the letterhead leaves it out.
  printCtuDocument({title:`Saturday clinic visit log ${log.from} to ${log.to}`,clinic:log.clinic,unit:false,css:SATURDAY_SHEET_CSS,
    pages:log.days.map(day=>sheetHtml(day,unit,blankRows))});
}

// Excel and Word downloads: one row per visit, with the Saturday it belongs to.
export function saturdayExportRows(log){
  return log.days.flatMap(day=>day.rows.map(row=>({Date:day.label,
    ...Object.fromEntries(SATURDAY_LOG_COLUMNS.map(([key,label])=>[label,cell(row,key)])),
    ...(log.clinic?{}:{Clinic:row.clinic})})));
}

export async function generateSaturdayReport(){
  // Claim the request first, so an error below is still shown for this request.
  const requestToken=state.reportCharts.studentReportToken=(state.reportCharts.studentReportToken||0)+1;
  const account=state.auth.currentUser;
  if(!['Administrator','Staff'].includes(account?.role))throw new Error('Administrator or staff reports access required.');
  const token=captureCampusPageToken(),filters=readSaturdayFilters(),blankRows=Number(value('rpt-sat-blank')||5);
  const staffClinic=staffClinicOf(account);
  const filterError=saturdayLogFilterError(filters,staffClinic);
  if(filterError)throw new Error(filterError);
  const target=document.getElementById('rpt-result');
  state.reportCharts.lastReportRows=[];
  target.innerHTML='<div class="card" role="status">Generating the Saturday visit log…</div>';
  let log;
  if(account._realSupabase){
    const {data:{session}}=await state.supabaseClient.supabaseClient.auth.getSession();
    if(!session)throw new Error('Your session expired. Log in again.');
    const response=await fetch(state.supabaseClient.SUPABASE_URL+'/functions/v1/saturday-visit-log',{method:'POST',
      headers:{'Content-Type':'application/json',apikey:state.supabaseClient.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify(filters)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok||!body.ok)throw new Error(body.error||'Unable to generate the Saturday visit log.');
    log=body.log;
  }else log=buildSaturdayVisitLog(demoSaturdayData(),filters);
  // A slow response must not replace a newer report, page or account.
  if(state.auth.currentUser!==account||!isCampusPageCurrent('reports',token)||requestToken!==state.reportCharts.studentReportToken)return;

  const title=`Saturday clinic visit log ${log.from} to ${log.to}`;
  const rows=saturdayExportRows(log);
  state.reportCharts.lastReportRows=rows;state.reportCharts.lastReportTitle=title;
  const download=format=>async()=>{const {exportTable}=await import('../features/reportCharts.js');exportTable({title,rows,format});};
  const scope=[log.clinic||'Both clinics',log.people==='students'?'Students only':'Students and personnel',log.college?`College: ${log.college}`:''].filter(Boolean).join(' · ');
  target.innerHTML=`<div class="card"><div class="card-header"><div><h3>Saturday Clinic Visit Log</h3><p class="form-note">${esc(log.from)} to ${esc(log.to)} · ${esc(scope)}</p></div><span class="intel-badge">${log.total} visit${log.total===1?'':'s'}</span></div>
    <div class="stats-grid">${[['Saturdays with visits',log.saturdays],['Visits on Saturdays',log.total]].map(([label,count])=>`<div class="stat-card"><div class="stat-val">${count}</div><div class="stat-lbl">${label}</div></div>`).join('')}</div>
    ${log.days.length?`<div class="report-export-buttons" role="group" aria-label="Print or download" style="margin:.75rem 0">
      <button type="button" class="btn btn-sm btn-primary" ${bindAction('click',()=>printSaturdayLog(log,blankRows))}><i class="bi bi-printer" aria-hidden="true"></i> Print log sheets / Save as PDF</button>
      <button type="button" class="btn btn-sm" ${bindAction('click',download('xlsx'))}><i class="bi bi-file-earmark-excel" aria-hidden="true"></i> Excel</button>
      <button type="button" class="btn btn-sm" ${bindAction('click',download('doc'))}><i class="bi bi-file-earmark-word" aria-hidden="true"></i> Word</button></div>`
      :'<p>No completed visits were recorded on a Saturday in this date range.</p>'}
    ${log.days.map(day=>`<h4 style="margin-top:1rem">DATE: ${esc(day.label)} <span class="text-muted" style="font-weight:400">· ${day.rows.length} visit${day.rows.length===1?'':'s'}</span></h4>
      <div class="table-wrap report-table-scroll"><table><thead><tr>${SATURDAY_LOG_COLUMNS.filter(([key])=>key!=='signature').map(([,label])=>`<th>${esc(label)}</th>`).join('')}${log.clinic?'':'<th>Clinic</th>'}</tr></thead>
      <tbody>${day.rows.map(row=>`<tr>${SATURDAY_LOG_COLUMNS.filter(([key])=>key!=='signature').map(([key])=>`<td>${esc(cell(row,key))}</td>`).join('')}${log.clinic?'':`<td>${esc(row.clinic)}</td>`}</tr>`).join('')}</tbody></table></div>`).join('')}
  </div>`;
}
