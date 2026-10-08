// doctorSchedule: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent,navTo} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {appointmentRecords,syncAppointmentContext,syncRealAppointments} from './appointmentService.js';
import {escapeHtml} from './issueReports.js';
import {collegeBadge,dayOfWeek,fmtDate,fmtTime,priorityBadge,statusBadge} from './inputValidation.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {viewAppt} from './appointmentDetails.js';
import {openAddTreatmentModal} from './treatmentForm.js';
import {campusDateFieldHtml} from './datePicker.js';
import {hideAlert,showAlert,showConfirmDialog,toast} from './theme.js';
import {clinicToday} from './scheduleAndDrafts.js';
import {syncRealWorkflowRequests,workflowAction} from './workflowRequests.js';
import {addNotif} from './notifications.js';
import {docName} from './messaging.js';
import {persistDB} from './persistence.js';
import {renderUsers} from './userManagement.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// DOCTOR – SCHEDULE
// ================================================================
export async function renderDoctorSchedule(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncAppointmentContext();}
    catch(e){
      if(!isCampusPageCurrent('schedule',pageToken))return;
      console.error('Doctor schedule sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load your schedule.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderDoctorSchedule()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('schedule',pageToken))return;
  }
  const myAppts=appointmentRecords().filter(a=>a.doctorId===appState.auth.currentUser.id&&a.status!=='Cancelled');
  const upcoming=myAppts.filter(a=>a.date>=appState.clinicInformation.TODAY).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
  const today=myAppts.filter(a=>a.date===appState.clinicInformation.TODAY);
  c.innerHTML=`
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><h3>Today – ${fmtDate(appState.clinicInformation.TODAY)}</h3></div>
        ${today.length?`<div class="timeline">${today.sort((a,b)=>a.time.localeCompare(b.time)).map(a=>{const pt=getPatientById(a.patientId);return`<div class="tl-item" style="cursor:pointer" ${bindAction('click',(event,element)=>{viewAppt((a.id))})} title="Open appointment"><div class="tl-dot" style="background:${a.status==='Completed'?'#639922':'var(--primary)'}"></div><div class="tl-content"><div class="fw-500">${fmtTime(a.time)} – ${pt?pt.fname+' '+pt.lname:'Unknown'}</div><div class="text-muted">${a.service} ${collegeBadge(a.college)}</div></div></div>`;}).join('')}</div>`:
        '<div class="empty-state"><p>No patients today.</p></div>'}
      </div>
      <div class="card">
        <div class="card-header"><h3>My Work Schedule</h3></div>
        <div class="info-row"><span class="info-label">Days</span><span class="info-val">${(appState.auth.currentUser.workDays||[]).join(', ')}</span></div>
        <div class="info-row"><span class="info-label">Hours</span><span class="info-val">${fmtTime(appState.auth.currentUser.startTime||'08:00')} – ${fmtTime(appState.auth.currentUser.endTime||'17:00')}</span></div>
        <div class="info-row"><span class="info-label">Slot Duration</span><span class="info-val">${appState.auth.currentUser.slotDuration||60} minutes</span></div>
        <div class="info-row"><span class="info-label">Specialty</span><span class="info-val">${appState.auth.currentUser.specialty||'General'}</span></div>
        <div style="margin-top:.75rem"><button class="btn btn-sm btn-info" ${bindAction('click',(event,element)=>{navTo('my-account')})}>Edit Schedule</button></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Upcoming Appointments</h3></div>
      ${upcoming.length?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>College</th><th>Type</th><th>Service</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
        upcoming.map(a=>{const pt=getPatientById(a.patientId);return`<tr style="cursor:pointer" ${bindAction('click',(event,element)=>{viewAppt((a.id))})} title="Click to open appointment">
          <td>${fmtDate(a.date)}</td><td>${fmtTime(a.time)}</td>
          <td>${pt?pt.fname+' '+pt.lname:'Unknown'}</td>
          <td>${collegeBadge(a.college)}</td><td>${priorityBadge(a.priority)}</td>
          <td>${a.service}</td><td>${statusBadge(a.status)}</td>
          <td><div class="td-actions" ${bindAction('click',(event,element)=>{event.stopPropagation()})}>
            ${a.status==='Scheduled'&&a.date<=appState.clinicInformation.TODAY?`<button class="btn btn-xs btn-primary" ${bindAction('click',(event,element)=>{openAddTreatmentModal((a.id))})}>📝 Add Notes &amp; Complete</button>`:''}
          </div></td>
        </tr>`;}).join('')
      }</tbody></table></div>`:'<div class="empty-state"><p>No upcoming appointments.</p></div>'}
    </div>
    <div class="card">
      <div class="card-header"><h3>Time Off / Days on Leave</h3></div>
      <p class="form-note" style="margin:-.2rem 0 .8rem">Days off need administrator approval before they block bookings. Submit a request below.</p>
      <div id="leave-msg"></div>
      <div class="form-row" style="align-items:flex-end">
        <div class="form-group"><label>Date</label>${campusDateFieldHtml('leave-date','','Select Day Off',appState.clinicInformation.TODAY)}</div>
        <div class="form-group"><label>Reason (optional)</label><input type="text" id="leave-reason" placeholder="e.g. Conference, sick leave"></div>
      </div>
      <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{requestDoctorLeave()})}>Request Day Off</button>
      <div class="divider"></div>
      ${getDoctorLeaveRequests(appState.auth.currentUser.id).length?`<div class="section-label">Pending Requests</div><div class="table-wrap" style="margin-bottom:.8rem"><table><thead><tr><th>Date</th><th>Reason</th><th>Status</th></tr></thead><tbody>${
        getDoctorLeaveRequests(appState.auth.currentUser.id).map(l=>`<tr><td>${fmtDate(l.date)}</td><td>${l.reason?escapeHtml(l.reason):'<span class="text-muted">—</span>'}</td><td><span class="badge badge-warning">Pending</span></td></tr>`).join('')
      }</tbody></table></div>`:''}
      <div class="section-label">Approved Days Off</div>
      ${getDoctorLeaves(appState.auth.currentUser.id).length?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Reason</th></tr></thead><tbody>${
        getDoctorLeaves(appState.auth.currentUser.id).map(l=>`<tr><td>${fmtDate(l.date)}</td><td>${l.reason?escapeHtml(l.reason):'<span class="text-muted">—</span>'}</td></tr>`).join('')
      }</tbody></table></div>`:'<p class="text-muted">No upcoming days off on file. Patients can book any of your regular work days.</p>'}
    </div>`;
}

export function getDoctorLeaves(docId){
  return appState.data.DB.doctorLeaves.filter(l=>l.doctorId===docId&&l.date>=appState.clinicInformation.TODAY).sort((a,b)=>a.date.localeCompare(b.date));
}

export function getDoctorLeaveRequests(docId){
  return (appState.data.DB.leaveRequests||[]).filter(l=>l.doctorId===docId&&l.status==='Pending').sort((a,b)=>a.date.localeCompare(b.date));
}

export async function requestDoctorLeave(){
  const date=document.getElementById('leave-date').value;
  const reason=document.getElementById('leave-reason').value.trim();
  const msg=document.getElementById('leave-msg');

  hideAlert(msg);
  if(appState.auth.currentUser?.role!=='Doctor'){showAlert(msg,'Doctor access required.');return;}
  if(!date||date<clinicToday()){showAlert(msg,'Choose today or a future date.');return;}
  if(!appState.auth.currentUser.workDays?.includes(dayOfWeek(date))){showAlert(msg,'This date is already outside your regular work days.');return;}
  if(appointmentRecords().some(a=>a.doctorId===appState.auth.currentUser.id&&a.date===date&&['Scheduled','Pending','Confirmed'].includes(a.status))){showAlert(msg,'There are booked patients on this date. Arrange rescheduling before requesting a day off.');return;}
  if(appState.data.DB.doctorLeaves.some(l=>l.doctorId===appState.auth.currentUser.id&&l.date===date)){
    showAlert(msg,'That date is already approved as a day off.');
    return;
  }
  if((appState.data.DB.leaveRequests||[]).some(l=>l.doctorId===appState.auth.currentUser.id&&l.date===date&&l.status==='Pending')){
    showAlert(msg,'You already have a pending request for that date.');
    return;
  }

  try{
    if(appState.auth.currentUser?._realSupabase){
      await workflowAction({
        action:'create',
        request_type:'Day Off',
        leave_date:date,
        reason
      });
      await syncRealWorkflowRequests();
    }else{
      appState.data.DB.leaveRequests=appState.data.DB.leaveRequests||[];
      appState.data.DB.nextLeaveReqId=appState.data.DB.nextLeaveReqId||1;
      appState.data.DB.leaveRequests.push({
        id:appState.data.DB.nextLeaveReqId++,doctorId:appState.auth.currentUser.id,
        date,reason,status:'Pending',createdAt:appState.clinicInformation.TODAY
      });
      appState.data.DB.users.filter(a=>a.role==='Administrator').forEach(a=>
        addNotif(a.id,'Day Off Request',`${docName(appState.auth.currentUser)} requested ${fmtDate(date)} off.`,'info')
      );
      persistDB();
    }

    toast('Day off request submitted for admin approval.','success');
    document.getElementById('leave-date').value='';
    document.getElementById('leave-reason').value='';
    await renderDoctorSchedule();
  }catch(e){
    showAlert(msg,e?.message||'Unable to submit the day off request.');
  }
}

export function approveLeaveRequest(reqId){
  const req=(appState.data.DB.leaveRequests||[]).find(r=>r.id===Number(reqId));
  if(!req)return;
  const doc=getUserById(req.doctorId);

  if(appState.auth.currentUser?.role!=='Administrator'||req.status!=='Pending'){toast('Only administrators can review pending requests.','warning');return;}
  if(appointmentRecords().some(a=>a.doctorId===req.doctorId&&a.date===req.date&&['Scheduled','Pending','Confirmed'].includes(a.status))){toast('Reschedule booked patients before approving this day off.','warning');return;}
  showConfirmDialog({
    title:'Approve Day Off',
    message:`Approve ${doc?'<strong>'+docName(doc)+'</strong>':'this doctor'}'s day off on ${fmtDate(req.date)}?`,
    confirmLabel:'Approve',
    onConfirm:async()=>{
      try{
        if(req._realSupabase){
          await workflowAction({action:'decision',request_id:req.dbRequestId,decision:'Approve'});
          await Promise.all([syncRealWorkflowRequests(),syncRealAppointments()]);
        }else{
          appState.data.DB.doctorLeaves=appState.data.DB.doctorLeaves||[];
          appState.data.DB.nextLeaveId=appState.data.DB.nextLeaveId||1;
          appState.data.DB.doctorLeaves.push({id:appState.data.DB.nextLeaveId++,doctorId:req.doctorId,date:req.date,reason:req.reason});
          req.status='Approved';
          if(doc)addNotif(doc.id,'Day Off Approved',`Your day off on ${fmtDate(req.date)} has been approved.`,'success');
          persistDB();
        }

        toast('Day off approved.','success');
        if(document.getElementById('user-table'))await renderUsers();
      }catch(e){
        toast(e?.message||'Unable to approve the day off.','error',6500);
      }
    }
  });
}

export function rejectLeaveRequest(reqId){
  const req=(appState.data.DB.leaveRequests||[]).find(r=>r.id===Number(reqId));
  if(!req)return;
  const doc=getUserById(req.doctorId);

  if(appState.auth.currentUser?.role!=='Administrator'||req.status!=='Pending'){toast('Only administrators can review pending requests.','warning');return;}
  showConfirmDialog({
    title:'Reject Day Off Request',
    message:`Reject this day off request${doc?' for <strong>'+docName(doc)+'</strong>':''}?`,
    confirmLabel:'Reject',
    danger:true,
    onConfirm:async()=>{
      try{
        if(req._realSupabase){
          await workflowAction({action:'decision',request_id:req.dbRequestId,decision:'Reject'});
          await syncRealWorkflowRequests();
        }else{
          req.status='Rejected';
          if(doc)addNotif(doc.id,'Day Off Request Declined',`Your day off request for ${fmtDate(req.date)} was declined.`,'warning');
          persistDB();
        }

        toast('Request rejected.','success');
        if(document.getElementById('user-table'))await renderUsers();
      }catch(e){
        toast(e?.message||'Unable to reject the request.','error');
      }
    }
  });
}

export function removeDoctorLeave(id){
  const l=appState.data.DB.doctorLeaves.find(x=>x.id===Number(id));
  if(!l)return;
  const doc=getUserById(l.doctorId);

  showConfirmDialog({
    title:'Cancel Approved Day Off',
    message:`Cancel this approved day off${doc?' for <strong>'+docName(doc)+'</strong>':''} on ${fmtDate(l.date)}? Booking availability for that date will reopen.`,
    confirmLabel:'Cancel Day Off',
    danger:true,
    onConfirm:async()=>{
      try{
        if(l._realSupabase){
          await workflowAction({action:'cancel_leave',leave_id:l.dbLeaveId});
          await syncRealWorkflowRequests();
        }else{
          appState.data.DB.doctorLeaves=appState.data.DB.doctorLeaves.filter(x=>x.id!==id);
          if(doc)addNotif(doc.id,'Day Off Cancelled',`Your approved day off on ${fmtDate(l.date)} was cancelled by an administrator.`,'warning');
          persistDB();
        }

        toast('Day off cancelled.','warning');
        if(document.getElementById('user-table'))await renderUsers();
      }catch(e){
        toast(e?.message||'Unable to cancel the approved day off.','error');
      }
    }
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
