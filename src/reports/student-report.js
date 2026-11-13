// Student coverage is a separate report so cohort filters never silently change other analytics.
import {state} from '../app/state.js';
import {buildStudentReport,scopeStudentReport,studentReportFilterError} from '../domain/student-report.js';
import {staffClinicOf} from '../domain/clinic-scope.js';
import {bindAction} from '../ui/events.js';
import {escapeHtml as escapeText} from '../features/issueReports.js';
import {captureCampusPageToken,isCampusPageCurrent} from '../features/navigationRaceProtection.js';
import {csvFileName,toCsv} from '../shared/csv.js';
import {exportButtonsHtml} from '../features/reportCharts.js';
const escapeHtml=value=>escapeText(String(value??''));
const choices=(id,label,values)=>`<div class="form-group"><label for="${id}">${label}</label><select id="${id}">${values.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select></div>`;
export function studentFilterMarkup(){
  const clinic=staffClinicOf(state.auth.currentUser);
  return `<fieldset id="student-report-filters" hidden style="border:0;margin-top:1rem"><legend>Combine student filters</legend><div class="form-row">
    ${choices('rpt-session','Class session',[['','All sessions'],['Morning','Morning'],['Evening','Evening'],['Unknown','Not recorded']])}
    ${clinic==='Medical Clinic'?'':choices('rpt-dental','Dental care',[['','All students'],['used','Availed recorded dental care'],['not','No recorded dental care'],['unknown','No linked patient record']])}
    ${clinic==='Dental Clinic'?'':choices('rpt-medical','Medical care',[['','Any medical use'],['used','Availed recorded medical care'],['not','No recorded medical care']])}
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
  const clinic=staffClinicOf(account);
  const filterError=studentReportFilterError(filters,clinic);
  if(filterError)throw new Error(filterError);
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
  }else report=scopeStudentReport(buildStudentReport(demoStudentData(),filters),clinic);
  // An old report response must not overwrite a newer request, page or account.
  if(state.auth.currentUser!==account||!isCampusPageCurrent('reports',token)||requestToken!==state.reportCharts.studentReportToken)return;
  // Each column: screen header, grouped export header ("Visits: Dental"), value. Staff only get their clinic's columns.
  const showDental=report.clinic!=='Medical Clinic',showMedical=report.clinic!=='Dental Clinic';
  const columnDefs=[
    ['ID','Student: ID No.',r=>r.idNumber||r.userId],['Name','Student: Name',r=>r.name],['College','School: College/Department',r=>r.college],
    ['Class Session','School: Class Session',r=>r.classSession==='Unknown'?'Not recorded':r.classSession],['Sex','Profile: Sex',r=>r.sex],
    ['Age','Profile: Age',r=>r.age??'Not recorded'],['Status','Account: Status',r=>r.status],['Verified','Account: Verified',r=>r.verified?'Yes':'No'],
    ['Registered','Account: Registered',r=>r.registered||'Not recorded'],
    ...(showDental?[['Dental Visits','Visits: Dental',r=>r.dentalVisits]]:[]),
    ...(showMedical?[['Medical Visits','Visits: Medical',r=>r.medicalVisits]]:[]),
    ...(showDental?[['Last Dental','Visits: Last Dental',r=>r.lastDental||'']]:[]),
    ['Coverage','Coverage: Patient Record',r=>r.coverageKnown?'Recorded patient':'No linked patient record']
  ];
  const columns=columnDefs.map(([key])=>key);
  const screenRows=report.rows.map(r=>Object.fromEntries(columnDefs.map(([key,,get])=>[key,get(r)])));
  state.reportCharts.lastReportRows=screenRows.map(row=>Object.fromEntries(columnDefs.map(([key,header])=>[header,row[key]])));
  state.reportCharts.lastReportTitle=`Student Coverage ${filters.from} to ${filters.to}`;
  const collegeColumns=[['college','College/Department','College'],['registered','Students: Registered','Registered'],
    ...(showDental?[['dentalUsed','Dental Care: Used','Dental used'],['dentalNotUsed','Dental Care: Not Recorded','No dental recorded']]:[]),
    ['unknownCoverage','Coverage: No Linked Patient Record','Coverage unknown'],['morning','Class Session: Morning','Morning'],['evening','Class Session: Evening','Evening'],['unknownSession','Class Session: Not Recorded','Session unknown']];
  // The college summary downloads as CSV, Excel, Word or PDF.
  const summarySource=()=>({title:`Student college summary ${filters.from} to ${filters.to}`,
    rows:report.colleges.map(c=>Object.fromEntries(collegeColumns.map(([k,label])=>[label,c[k]]))),
    csv:()=>toCsv([collegeColumns.map(([,label])=>label),...report.colleges.map(c=>collegeColumns.map(([k])=>c[k]))]),
    csvName:csvFileName(`student college summary ${filters.from} to ${filters.to}`)});
  target.innerHTML=`<div class="card"><div class="card-header"><h3>Student Coverage &amp; Registration</h3></div>
    <p class="form-note">${escapeHtml(filters.history==='all'?'Service use: all recorded history through '+filters.to:'Service use: '+filters.from+' to '+filters.to)}. ${filters.registration==='range'?'New registrations in this range':'Accounts registered by the end date'}. College totals apply demographic filters before care-use filters.</p>
    <p class="form-note">Applied filters: ${escapeHtml(Object.entries(filters).filter(([,v])=>v!=='').map(([k,v])=>`${k}: ${v}`).join(' · '))}</p>
    <div class="stats-grid">${[['Registered students in cohort',report.registered],['Matching students',report.matched],...(showDental?[['Availed dental care',report.dentalUsed],['No recorded dental care',report.dentalNotUsed]]:[]),['Class session not recorded',report.unknownSession],['No linked patient record',report.unknownCoverage]].map(([label,count])=>`<div class="stat-card"><div class="stat-val">${count}</div><div class="stat-lbl">${label}</div></div>`).join('')}</div>
    <h4>Registered students by college</h4><div class="table-wrap"><table><thead><tr>${[...collegeColumns.map(([,,label])=>label),...(showDental?['Dental coverage']:[])].map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>${report.colleges.map(c=>`<tr>${collegeColumns.map(([k])=>`<td>${escapeHtml(c[k])}</td>`).join('')}${showDental?`<td>${c.registered?Math.round(c.dentalUsed/c.registered*100)+'%':'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>
    ${exportButtonsHtml(summarySource,{label:'Download college summary'})}
    <h4 style="margin-top:1rem">Matching student list</h4><div class="table-wrap"><table><thead><tr>${columns.map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>${screenRows.map(row=>`<tr>${columns.map(k=>`<td>${escapeHtml(row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${!report.matched?'<p>No students match these filters.</p>':''}</div>${report.matched?exportToolbar():''}`;
}
