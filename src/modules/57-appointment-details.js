// ── View Appointment ──
function viewAppt(id){
  const a=appointmentRecords().find(x=>x.id===Number(id));if(!a)return;
  const pt=getPatientById(a.patientId);
  const doc=getUserById(a.doctorId);
  const clinicalUser=['Doctor','Staff','Administrator'].includes(currentUser.role);
  const canTreat=currentUser.role==='Doctor'&&a.doctorId===currentUser.id&&a.status==='Scheduled'&&a.date<=TODAY;
  const canManage=['Staff','Administrator'].includes(currentUser.role)&&a.status==='Scheduled';

  openModal(`<div class="modal">
    <div class="modal-header">
      <h3>Appointment #${appointmentDisplayId(a)}</h3>
      <button class="close-btn" onclick="closeAllModals()">✕</button>
    </div>
    <div class="modal-body">
      <div class="info-row">
        <span class="info-label">Patient</span>
        <span class="info-val">${pt
          ? (clinicalUser
              ? `<button class="link-btn" onclick="closeAllModals();viewPatient(${pt.id})">${escapeHtml(pt.fname+' '+pt.lname)}</button>`
              : escapeHtml(pt.fname+' '+pt.lname))
          : 'Unknown'}</span>
      </div>
      <div class="info-row"><span class="info-label">College</span><span class="info-val">${collegeBadge(a.college||pt?.college||'')}</span></div>
      <div class="info-row"><span class="info-label">Priority</span><span class="info-val">${priorityBadge(a.priority||pt?.personType||'')}</span></div>
      <div class="info-row"><span class="info-label">Clinic</span><span class="info-val">${escapeHtml(a.clinic||'—')}</span></div>
      <div class="info-row"><span class="info-label">Service</span><span class="info-val">${escapeHtml(a.service||'—')}</span></div>
      <div class="info-row"><span class="info-label">Doctor</span><span class="info-val">${doc?`Dr. ${escapeHtml(doc.fname+' '+doc.lname)}${doc.specialty?` · ${escapeHtml(doc.specialty)}`:''}`:'Unknown'}</span></div>
      <div class="info-row"><span class="info-label">Date & Time</span><span class="info-val">${fmtDate(a.date)} at ${fmtTime(a.time)}</span></div>
      <div class="info-row"><span class="info-label">Reason</span><span class="info-val">${escapeHtml(a.reason||'—')}</span></div>
      <div class="info-row"><span class="info-label">Status</span><span class="info-val">${statusBadge(a.status)}</span></div>
      ${a.notes?`<div class="info-row"><span class="info-label">Notes</span><span class="info-val">${escapeHtml(a.notes)}</span></div>`:''}
    </div>
    <div class="modal-footer">
      ${clinicalUser&&pt?`<button class="btn" onclick="closeAllModals();viewPatient(${pt.id})">View Patient</button>`:''}
      ${canTreat?`<button class="btn btn-primary" onclick="closeAllModals();openAddTreatmentModal(${a.id})">📝 Add Notes & Complete</button>`:''}
      ${canManage?`<button class="btn btn-warning" onclick="closeAllModals();openRescheduleModal(${a.id})">Reschedule</button>`:''}
      <button class="btn" onclick="closeAllModals()">Close</button>
    </div>
  </div>`);
}
