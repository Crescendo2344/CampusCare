// ================================================================
// PATIENT – MY APPOINTMENTS
// ================================================================
async function renderMyAppointments(){
  const c=document.getElementById('app-content');
  const pageToken=captureCampusPageToken();
  if(currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{
      await syncAppointmentContext();
      await syncRealWorkflowRequests();
    }
    catch(e){
      if(!isCampusPageCurrent('my-appointments',pageToken))return;
      console.error('My appointments sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load appointments.')}</div><button class="btn btn-sm" onclick="renderMyAppointments()">Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('my-appointments',pageToken))return;
  }
  const pt=currentPatient;
  if(!pt){c.innerHTML='<div class="alert alert-warning show">No patient record linked. Contact admin.</div>';return;}
  const appts=appointmentRecords().filter(a=>a.patientId===pt.id);
  const sem=currentSemester();
  const dentalUsed=checkDentalQuota(pt.id);

  c.innerHTML=`
    <div class="card" style="${dentalUsed?'border-left:3px solid var(--warning)':''}">
      <div class="card-header"><h3>Dental Clinic Quota</h3></div>
      <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <div><span class="badge ${dentalUsed?'badge-danger':'badge-success'}">${dentalUsed?'Limit Reached':'Available'}</span></div>
        <div class="text-muted">You may avail the Dental Clinic <strong>${DB.settings.dentalLimitPerSemester}x</strong> per semester. Medical services are unlimited.</div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <h3>My Appointments</h3>
        <button class="btn btn-primary btn-sm" onclick="openBookApptModal()">+ Book Appointment</button>
      </div>
      <div class="tabs">
        <button class="tab active" onclick="filterMyAppts('all',this)">All</button>
        <button class="tab" onclick="filterMyAppts('Scheduled',this)">Scheduled</button>
        <button class="tab" onclick="filterMyAppts('Completed',this)">Completed</button>
        <button class="tab" onclick="filterMyAppts('Cancelled',this)">Cancelled</button>
      </div>
      <div id="my-appts-list"></div>
    </div>`;
  renderMyApptsList(appts,'all');
}

function filterMyAppts(f,el){
  document.querySelectorAll('#app-content .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  const pt=currentPatient;
  const appts=appointmentRecords().filter(a=>a.patientId===pt.id);
  renderMyApptsList(appts,f);
}

function renderMyApptsList(appts,filter){
  const el=document.getElementById('my-appts-list');
  if(!el)return;
  let list=appts;
  if(filter!=='all')list=appts.filter(a=>a.status===filter);
  list=list.slice().sort((a,b)=>b.date.localeCompare(a.date));
  if(!list.length){el.innerHTML='<div class="empty-state"><p>No appointments found.</p></div>';return;}
  el.innerHTML=`<div class="table-wrap"><table><thead><tr><th>#</th><th>Clinic</th><th>Service</th><th>Date</th><th>Time</th><th>Doctor</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
    list.map(a=>{
      const doc=getUserById(a.doctorId);
      const canCancel=a.status==='Scheduled'&&a.date>=TODAY;
      const canReschedule=a.status==='Scheduled'&&a.date>TODAY;
      return`<tr style="cursor:pointer" onclick="viewAppt(${a.id})" title="Click to open appointment">
        <td>#${appointmentDisplayId(a)}</td><td>${a.clinic}</td><td>${a.service}</td>
        <td>${fmtDate(a.date)}</td><td>${fmtTime(a.time)}</td>
        <td>Dr. ${doc?doc.lname:'Unknown'}</td>
        <td>${statusBadge(a.status)}</td>
        <td><div class="td-actions" onclick="event.stopPropagation()">
          ${canReschedule?`<button class="btn btn-xs btn-info" onclick="openRescheduleModal(${a.id})">Reschedule</button>`:''}
          ${canCancel?`<button class="btn btn-xs btn-danger" onclick="cancelAppt(${a.id},true)">Cancel</button>`:''}
          ${a.status==='Completed'?`<button class="btn btn-xs" onclick="viewTreatmentForAppt(${a.id})">View Notes</button>`:''}
        </div></td>
      </tr>`;
    }).join('')
  }</tbody></table></div>`;
}
