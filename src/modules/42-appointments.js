// ================================================================
// APPOINTMENTS PAGE (Staff/Admin/Doctor)
// ================================================================
async function renderAppointments(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncAppointmentContext();}
    catch(e){
      if(!isCampusPageCurrent('appointments',pageToken))return;
      console.error('Appointments sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load appointments.')}</div><button class="btn btn-sm" onclick="renderAppointments()">Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('appointments',pageToken))return;
  }
  const role=currentUser.role;
  c.innerHTML=`
    <div class="toolbar">
      <input type="text" placeholder="Search patient, clinic..." id="appt-search" oninput="renderApptTable()">
      <select id="appt-status" onchange="renderApptTable()">
        <option value="">All Status</option>
        <option>Scheduled</option><option>Completed</option><option>Cancelled</option><option>No-show</option>
      </select>
      <select id="appt-college" onchange="renderApptTable()">
        <option value="">All Colleges</option>
        ${['CCICT','COE','COED','CME','CAS','COT'].map(col=>`<option value="${col}">${col}</option>`).join('')}
      </select>
      <select id="appt-clinic" onchange="renderApptTable()">
        <option value="">All Clinics</option>
        <option>Medical Clinic</option><option>Dental Clinic</option>
      </select>
      <div class="appt-range-filter"><input type="hidden" id="appt-date-from"><input type="hidden" id="appt-date-to"><button type="button" class="modern-date-btn" onclick="openApptRangePicker()"><i class="bi bi-calendar3"></i><span id="appt-range-label">All dates</span></button></div>
      ${role!=='Doctor'?`<button class="btn btn-primary btn-sm" onclick="openBookApptModal()">+ Book Appointment</button>`:''}
    </div>
    <div class="card"><div id="appt-table"></div></div>`;
  renderApptTable();
}

function renderApptTable(){
  const q=(document.getElementById('appt-search')||{}).value||'';
  const stat=(document.getElementById('appt-status')||{}).value||'';
  const col=(document.getElementById('appt-college')||{}).value||'';
  const clinic=(document.getElementById('appt-clinic')||{}).value||'';
  const dateFrom=(document.getElementById('appt-date-from')||{}).value||'';
  const dateTo=(document.getElementById('appt-date-to')||{}).value||'';
  const role=currentUser.role;
  let appts=appointmentRecords().filter(a=>{
    const pt=getPatientById(a.patientId);
    const name=pt?`${pt.fname} ${pt.lname}`.toLowerCase():'';
    const matchQ=!q||name.includes(q.toLowerCase())||a.clinic.toLowerCase().includes(q.toLowerCase());
    const matchS=!stat||a.status===stat;
    const matchC=!col||(a.college||pt?.college||'')===col;
    const matchCl=!clinic||a.clinic===clinic;
    const matchD=(!dateFrom||a.date>=dateFrom)&&(!dateTo||a.date<=dateTo);
    const matchDoc=role!=='Doctor'||a.doctorId===currentUser.id;
    return matchQ&&matchS&&matchC&&matchCl&&matchD&&matchDoc;
  });
  appts=appts.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  const el=document.getElementById('appt-table');
  if(!el)return;
  const canManage=role==='Staff'||role==='Administrator';
  const isDoc=role==='Doctor';
  if(!appts.length){el.innerHTML='<div class="empty-state"><p>No appointments found.</p></div>';return;}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>#</th><th>Photo</th><th>Patient</th><th>College</th><th>Priority</th><th>Clinic</th><th>Date & Time</th><th>Doctor</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
    appts.map(a=>{
      const pt=getPatientById(a.patientId);
      const doc=getUserById(a.doctorId);
      const canCancel=a.status==='Scheduled';
      return`<tr style="cursor:pointer" onclick="viewAppt(${a.id})" title="Click to open appointment">
        <td>#${appointmentDisplayId(a)}</td>
        <td>${pt?patientAvatarHtml(pt,30):'—'}</td>
        <td>${pt?`<button type="button" class="link-btn" onclick="event.stopPropagation();viewPatient(${pt.id})" title="Open patient record"><strong>${escapeHtml(pt.fname+' '+pt.lname)}</strong></button>`:'<strong>Unknown</strong>'}</td>
        <td>${collegeBadge(a.college)}</td><td>${priorityBadge(a.priority)}</td>
        <td>${a.clinic}</td>
        <td>${fmtDate(a.date)}<br><span class="text-muted">${fmtTime(a.time)}</span></td>
        <td>Dr. ${doc?doc.lname:'?'}</td>
        <td>${statusBadge(a.status)}</td>
        <td><div class="td-actions" onclick="event.stopPropagation()">
          <button class="btn btn-xs" onclick="viewAppt(${a.id})">View</button>
          ${canManage&&canCancel?`<button class="btn btn-xs btn-warning" onclick="openRescheduleModal(${a.id})">Reschedule</button>`:''}

          ${isDoc&&a.status==='Scheduled'&&a.date<=TODAY?`<button class="btn btn-xs btn-primary" onclick="openAddTreatmentModal(${a.id})">📝 Add Notes &amp; Complete</button>`:''}
          ${canManage&&canCancel?`<button class="btn btn-xs btn-danger" onclick="cancelAppt(${a.id})">Cancel</button>`:''}
          ${currentUser.role==='Administrator'&&a.status==='Scheduled'?`<button class="btn btn-xs" onclick="noShowAppt(${a.id})">No-show</button>`:''}
          ${(canManage||isDoc)&&a.status==='Scheduled'?`<button class="btn btn-xs btn-info" onclick="sendApptNotif(${a.id})">🔔 Notify</button>`:''}
        </div></td>
      </tr>`;
    }).join('')
  }</tbody></table></div>`;
}

function completeAppt(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  showConfirmDialog({
    title:'Complete Appointment',
    message:`Mark appointment #${a.dbAppointmentId||id} as completed?`,
    confirmLabel:'Mark Completed',
    onConfirm:async()=>{
      try{
        if(a._realSupabase){
          await appointmentAction({action:'status',appointment_id:a.dbAppointmentId,status:'Completed'});
          await syncRealAppointments();
        }else{
          a.status='Completed';persistDB();
        }
        toast('Appointment marked as completed.','success');
        if(currentUser.role==='Patient')await renderMyAppointments();else await renderAppointments();
      }catch(e){toast(e?.message||'Unable to complete appointment.','error');}
    }
  });
}

function noShowAppt(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  showConfirmDialog({
    title:'Mark as No-show',
    message:`Mark appointment #${a.dbAppointmentId||id} as a no-show?`,
    confirmLabel:'Mark No-show',danger:true,
    onConfirm:async()=>{
      try{
        if(a._realSupabase){
          await appointmentAction({action:'status',appointment_id:a.dbAppointmentId,status:'No-show'});
          await syncRealAppointments();
        }else{a.status='No-show';persistDB();}
        toast('Marked as no-show.','warning');
        await renderAppointments();
      }catch(e){toast(e?.message||'Unable to update appointment.','error');}
    }
  });
}

function cancelAppt(id,patient=false){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Cancel Appointment</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <p style="font-size:.86rem;margin-bottom:.7rem">Are you sure you want to cancel this appointment?</p>
      <div class="form-group"><label>Reason (optional)</label><textarea id="cancel-appt-reason" rows="2" placeholder="Reason for cancellation"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeAllModals()">Go Back</button>
      <button class="btn btn-danger" onclick="confirmCancelAppt(${id},${patient?'true':'false'})">Cancel Appointment</button>
    </div>
  </div>`);
}

async function confirmCancelAppt(id,patient=false){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  const reason=(document.getElementById('cancel-appt-reason')?.value||'').trim();
  closeAllModals();
  try{
    if(a._realSupabase){
      await appointmentAction({action:'cancel',appointment_id:a.dbAppointmentId,reason});
      await syncRealAppointments();
    }else{
      a.status='Cancelled';a.cancellationReason=reason;persistDB();
    }
    toast('Appointment cancelled.','warning');
    if(patient||currentUser.role==='Patient')await renderMyAppointments();else await renderAppointments();
  }catch(e){toast(e?.message||'Unable to cancel appointment.','error');}
}

function sendApptNotif(id){
  const a=appointmentRecords().find(x=>x.id===id);
  if(!a)return;
  const pt=getPatientById(a.patientId);
  if(!pt)return;
  const u=DB.users.find(x=>x.id===pt.userId);
  if(u){addNotif(u.id,'Appointment Reminder',`Reminder: You have a ${a.clinic} appointment on ${fmtDate(a.date)} at ${fmtTime(a.time)}. Please bring your COR (Certificate of Registration) when you arrive at the clinic.`,'warning');}
  const channels=[];
  if(u&&u.email)channels.push(`email (${maskEmail(u.email)})`);
  if(u&&u.contact)channels.push(`SMS (${maskPhone(u.contact)})`);
  if(!channels.length){
    toast(`${pt.fname} ${pt.lname} has no email or phone number on file to notify.`,'warning');
    return;
  }
  toast(`Reminder sent to ${pt.fname} ${pt.lname} via ${channels.join(' and ')}.`,'success');
}
