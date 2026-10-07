// Record selection, mapping and snapshot assembly use only supplied data.
export function appointmentDisplayId(a){
  const id=Number(a?.dbAppointmentId??a?.id??0);
  return String(id).padStart(6,'0');
}

export function appointmentRecords(db,account){
  if(account?._realSupabase)return (db.appointments||[]).filter(a=>a._realSupabase);
  return db.appointments||[];
}

export function realAppointmentToUi(a,db){
  const pt=(db.patients||[]).find(p=>p._realSupabase&&Number(p.dbPatientId)===Number(a.patient_id));
  const doc=(db.users||[]).find(u=>u._realSupabase&&Number(u.dbUserId)===Number(a.doctor_id));
  const service=String(a.service||'');
  const status=a.status==='Confirmed'?'Scheduled':a.status;
  return {
    id:300000+Number(a.appointment_id),
    dbAppointmentId:Number(a.appointment_id),
    patientId:pt?.id??(200000+Number(a.patient_id)),
    dbPatientId:Number(a.patient_id),
    doctorId:doc?.id??(100000+Number(a.doctor_id)),
    dbDoctorId:Number(a.doctor_id),
    clinic:a.clinic||(service.toLowerCase().includes('dental')?'Dental Clinic':'Medical Clinic'),
    service,
    date:a.appointment_date,
    time:String(a.appointment_time||'').slice(0,5),
    reason:a.reason||'',
    status:status||'Scheduled',
    priority:a.priority||'',
    college:pt?.college||'',
    createdBy:a.created_by?100000+Number(a.created_by):null,
    notes:a.notes||'',
    createdAt:a.created_at||'',
    cancelledAt:a.cancelled_at||'',
    cancellationReason:a.cancellation_reason||'',
    _realSupabase:true
  };
}

export function realDoctorDirectoryToUi(d){
  return {
    id:100000+Number(d.user_id),
    dbUserId:Number(d.user_id),
    fname:d.first_name||'',
    lname:d.last_name||'',
    role:'Doctor',
    status:'Active',
    verified:true,
    specialty:d.specialty||'General Medicine',
    workDays:Array.isArray(d.work_days)?d.work_days:['Mon','Tue','Wed','Thu','Fri'],
    startTime:String(d.start_time||'08:00').slice(0,5),
    endTime:String(d.end_time||'17:00').slice(0,5),
    slotDuration:Number(d.slot_duration||60),
    maxPatients:Number(d.max_patients||20),
    _realSupabase:true,
    _realDoctorDirectory:true
  };
}

export function mergeDoctorDirectory(users,doctors){
  return [...users.filter(u=>!u._realDoctorDirectory),...doctors.map(realDoctorDirectoryToUi)];
}

export function groupSlotOverrides(rows){
  const grouped=new Map();
  for(const row of rows){
    const doctorId=100000+Number(row.doctor_id);
    const key=`${doctorId}|${row.override_date}`;
    if(!grouped.has(key))grouped.set(key,{doctorId,date:row.override_date,blockedTimes:[],availableTimes:[],_realSupabase:true});
    const entry=grouped.get(key);
    const time=String(row.slot_time||'').slice(0,5);
    if(row.is_available)entry.availableTimes.push(time);
    else entry.blockedTimes.push(time);
  }
  return [...grouped.values()];
}

export function realDoctorLeaveToUi(l){
  return {
    id:400000+Number(l.leave_id),
    dbLeaveId:Number(l.leave_id),
    doctorId:100000+Number(l.doctor_id),
    date:l.leave_date,
    reason:l.reason||'',
    _realSupabase:true
  };
}

// Produce a new snapshot while preserving demo rows and the caller's patient/user records.
export function mergeAppointmentSnapshot(db,{appointments,overrides,leaves}){
  return {
    appointments:[...(db.appointments||[]).filter(a=>!a._realSupabase),...appointments.map(a=>realAppointmentToUi(a,db))],
    slotOverrides:groupSlotOverrides(overrides),
    doctorLeaves:[...(db.doctorLeaves||[]).filter(l=>!l._realSupabase),...leaves.map(realDoctorLeaveToUi)]
  };
}
