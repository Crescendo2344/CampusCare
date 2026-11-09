// Student coverage is a separate report so cohort filters never silently change other analytics.
import {state} from '../app/state.js';
import {buildStudentReport} from '../domain/student-report.js';
import {bindAction} from '../ui/events.js';
import {escapeHtml as escapeText} from '../features/issueReports.js';
import {captureCampusPageToken,isCampusPageCurrent} from '../features/navigationRaceProtection.js';
import {csvFileName,toCsv} from '../shared/csv.js';
const escapeHtml=value=>escapeText(String(value??''));
const choices=(id,label,values)=>`<div class="form-group"><label for="${id}">${label}</label><select id="${id}">${values.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select></div>`;
export function studentFilterMarkup(){
  return `<fieldset id="student-report-filters" hidden style="border:0;margin-top:1rem"><legend>Combine student filters</legend><div class="form-row">
    ${choices('rpt-session','Class session',[['','All sessions'],['Morning','Morning'],['Evening','Evening'],['Mixed','Mixed / both'],['Unknown','Not recorded']])}
    ${choices('rpt-dental','Dental care',[['','All students'],['used','Availed recorded dental care'],['not','No recorded dental care'],['unknown','No linked patient record']])}
    ${choices('rpt-medical','Medical care',[['','Any medical use'],['used','Availed recorded medical care'],['not','No recorded medical care']])}
    ${choices('rpt-history','Service-use period',[['range','Selected date range'],['all','All history through end date']])}
    ${choices('rpt-registration','Registration cohort',[['snapshot','Registered by end date'],['range','New registrations in date range']])}
    </div><details class="report-details"><summary>Additional student filters</summary><div class="form-row">
    ${choices('rpt-archive','Record scope',[['current','Non-archived students'],['all','Include archived students'],['archived','Archived students only']])}
    ${choices('rpt-sex','Sex',[['','All'],['Male','Male'],['Female','Female'],['Other','Other'],['Unknown','Not recorded']])}
    ${choices('rpt-status','Account status',[['','All statuses'],['Active','Active'],['Pending','Pending'],['Suspended','Suspended'],['Archived','Archived']])}
    ${choices('rpt-verified','Verification',[['','All'],['yes','Verified'],['no','Not verified']])}
    <div class="form-group"><label for="rpt-min-age">Minimum age at end date</label><input type="number" id="rpt-min-age" min="0" max="150"></div>
    <div class="form-group"><label for="rpt-max-age">Maximum age at end date</label><input type="number" id="rpt-max-age" min="0" max="150"></div>
    <div class="form-group"><label for="rpt-student-search">Student name or university ID</label><input id="rpt-student-search" type="search" maxlength="120"></div>
    </div></details></fieldset>`;
}
export function readStudentFilters(){
  const value=id=>document.getElementById(id)?.value||'';
  return {from:value('rpt-from'),to:value('rpt-to'),college:value('rpt-college'),classSession:value('rpt-session'),dental:value('rpt-dental'),medical:value('rpt-medical'),history:value('rpt-history'),registration:value('rpt-registration'),archive:value('rpt-archive'),sex:value('rpt-sex'),status:value('rpt-status'),verified:value('rpt-verified'),minAge:value('rpt-min-age'),maxAge:value('rpt-max-age'),search:value('rpt-student-search').trim()};
}
export function demoStudentData(){
  const db=state.data.DB;
  return {
    users:db.users.map(u=>({user_id:u.id,first_name:u.fname,last_name:u.lname,id_number:u.idNo,role:u.role,person_type:u.personType,college:u.college,status:u.status,verified:u.verified,created_at:u.createdAt})),
    patients:db.patients.map(p=>({patient_id:p.id,user_id:p.userId,sex:p.gender,birth_date:p.birthDate,class_session:p.classSession,archived_at:p.archived?'archived':null})),
    appointments:db.appointments.map(a=>({appointment_id:a.id,patient_id:a.patientId,clinic:a.clinic,appointment_date:a.date,status:a.status})),
    treatments:db.treatments.map(t=>({treatment_id:t.id,patient_id:t.patientId,appointment_id:t.appointmentId,treatment_date:t.date,status:t.status,archived_at:t.archived?'archived':null})),
    dentalRecords:db.treatments.filter(t=>t.dentalRecord).map(t=>({treatment_id:t.id,patient_id:t.patientId,record_date:t.date}))
  };
}
export async function generateStudentReport(exportToolbar,download){
  if(!['Administrator','Staff'].includes(state.auth.currentUser?.role))throw new Error('Administrator or staff reports access required.');
  const account=state.auth.currentUser,token=captureCampusPageToken(),filters=readStudentFilters();
  const requestToken=state.reportCharts.studentReportToken=(state.reportCharts.studentReportToken||0)+1;
  buildStudentReport({},filters);
  const target=document.getElementById('rpt-result');
  state.reportCharts.lastReportRows=[];
  target.innerHTML='<div class="card" role="status">Generating student coverage report…</div>';
  let report;
  if(account._realSupabase){
    const {data:{session}}=await state.supabaseClient.supabaseClient.auth.getSession();
    if(!session)throw new Error('Your session expired. Log in again.');
    const response=await fetch(state.supabaseClient.SUPABASE_URL+'/functions/v1/student-reports',{method:'POST',headers:{'Content-Type':'application/json',apikey:state.supabaseClient.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify(filters)});
    const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||'Unable to generate student coverage.');
    report=body.report;
  }else report=buildStudentReport(demoStudentData(),filters);
  // An old report response must not overwrite a newer request, page or account.
  if(state.auth.currentUser!==account||!isCampusPageCurrent('reports',token)||requestToken!==state.reportCharts.studentReportToken)return;
  const columns=['ID','Name','College','Class Session','Sex','Age','Status','Verified','Registered','Dental Visits','Medical Visits','Last Dental','Coverage'];
  // Exported with grouped headers ("Student: ID No.", "School: College", "Visits: Dental"); the screen keeps short ones.
  const exportHeaders=['Student: ID No.','Student: Name','School: College/Department','School: Class Session','Profile: Sex','Profile: Age','Account: Status','Account: Verified','Account: Registered','Visits: Dental','Visits: Medical','Visits: Last Dental','Coverage: Patient Record'];
  const screenRows=report.rows.map(r=>Object.fromEntries(columns.map((key,i)=>[key,[r.idNumber||r.userId,r.name,r.college,r.classSession==='Unknown'?'Not recorded':r.classSession,r.sex,r.age??'Not recorded',r.status,r.verified?'Yes':'No',r.registered||'Not recorded',r.dentalVisits,r.medicalVisits,r.lastDental||'',r.coverageKnown?'Recorded patient':'No linked patient record'][i]])));
  state.reportCharts.lastReportRows=screenRows.map(row=>Object.fromEntries(columns.map((key,i)=>[exportHeaders[i],row[key]])));
  state.reportCharts.lastReportTitle=`Student Coverage ${filters.from} to ${filters.to}`;
  const collegeColumns=[['college','College/Department'],['registered','Students: Registered'],['dentalUsed','Dental Care: Used'],['dentalNotUsed','Dental Care: Not Recorded'],['unknownCoverage','Dental Care: Coverage Unknown'],['morning','Class Session: Morning'],['evening','Class Session: Evening'],['mixed','Class Session: Mixed'],['unknownSession','Class Session: Not Recorded']];
  const summaryExport=()=>download(toCsv([collegeColumns.map(([,label])=>label),...report.colleges.map(c=>collegeColumns.map(([k])=>c[k]))]),csvFileName(`student college summary ${filters.from} to ${filters.to}`),'text/csv;charset=utf-8');
  target.innerHTML=`<div class="card"><div class="card-header"><h3>Student Coverage &amp; Registration</h3></div>
    <p class="form-note">${escapeHtml(filters.history==='all'?'Service use: all recorded history through '+filters.to:'Service use: '+filters.from+' to '+filters.to)}. ${filters.registration==='range'?'New registrations in this range':'Accounts registered by the end date'}. College totals apply demographic filters before dental/medical-use filters.</p>
    <p class="form-note">Applied filters: ${escapeHtml(Object.entries(filters).filter(([,v])=>v!=='').map(([k,v])=>`${k}: ${v}`).join(' · '))}</p>
    <div class="stats-grid">${[['Registered students in cohort',report.registered],['Matching students',report.matched],['Availed dental care',report.dentalUsed],['No recorded dental care',report.dentalNotUsed],['Class session not recorded',report.unknownSession],['No linked patient record',report.unknownCoverage]].map(([label,count])=>`<div class="stat-card"><div class="stat-val">${count}</div><div class="stat-lbl">${label}</div></div>`).join('')}</div>
    <h4>Registered students by college</h4><div class="table-wrap"><table><thead><tr>${['College','Registered','Dental used','No dental recorded','Coverage unknown','Morning','Evening','Mixed','Session unknown','Dental coverage'].map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>${report.colleges.map(c=>`<tr>${collegeColumns.map(k=>`<td>${escapeHtml(c[k])}</td>`).join('')}<td>${c.registered?Math.round(c.dentalUsed/c.registered*100)+'%':'—'}</td></tr>`).join('')}</tbody></table></div>
    <button class="btn btn-sm" ${bindAction('click',summaryExport)}>Export college summary CSV</button>
    <h4 style="margin-top:1rem">Matching student list</h4><div class="table-wrap"><table><thead><tr>${columns.map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>${screenRows.map(row=>`<tr>${columns.map(k=>`<td>${escapeHtml(row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${!report.matched?'<p>No students match these filters.</p>':''}</div>${report.matched?exportToolbar():''}`;
}
