// ================================================================
// REAL SUPABASE APPOINTMENTS
// ================================================================

function appointmentDisplayId(a){
  const id=Number(a?.dbAppointmentId??a?.id??0);
  return String(id).padStart(6,'0');
}

function openAppointmentFromRow(id){
  viewAppt(Number(id));
}

function appointmentRecords(){
  if(currentUser?._realSupabase)return (DB.appointments||[]).filter(a=>a._realSupabase);
  return DB.appointments||[];
}

async function appointmentAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/appointment-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Appointment action failed.');
  return result;
}

async function syncRealDoctorDirectory(){
  if(!currentUser?._realSupabase)return;

  // Admin/Staff/Doctor already have database permission to load the clinical directory.
  if(['Administrator','Staff','Doctor'].includes(currentUser.role)){
    await syncAdminDirectoryFromSupabase();
    return;
  }

  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)return;
  const response=await fetch(`${SUPABASE_URL}/functions/v1/doctor-directory`,{
    headers:{
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    }
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to load doctors.');

  DB.users=(DB.users||[]).filter(u=>!u._realDoctorDirectory);
  for(const d of result.doctors||[]){
    DB.users.push({
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
    });
  }
}

function realAppointmentToUi(a){
  const pt=(DB.patients||[]).find(p=>p._realSupabase&&Number(p.dbPatientId)===Number(a.patient_id));
  const doc=(DB.users||[]).find(u=>u._realSupabase&&Number(u.dbUserId)===Number(a.doctor_id));
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

async function syncRealAppointments(){
  if(!currentUser?._realSupabase)return [];

  const [apptRes,overrideRes,leaveRes]=await Promise.all([
    supabaseClient.from('appointments')
      .select('appointment_id,patient_id,doctor_id,clinic,service,appointment_date,appointment_time,status,priority,reason,notes,created_by,created_at,cancelled_at,cancellation_reason')
      .order('appointment_date',{ascending:false})
      .order('appointment_time',{ascending:false}),
    supabaseClient.from('appointment_slot_overrides')
      .select('doctor_id,override_date,slot_time,is_available,reason'),
    supabaseClient.from('doctor_leaves')
      .select('leave_id,doctor_id,leave_date,reason')
  ]);

  if(apptRes.error)throw apptRes.error;
  if(overrideRes.error)throw overrideRes.error;
  if(leaveRes.error)throw leaveRes.error;

  DB.appointments=(DB.appointments||[]).filter(a=>!a._realSupabase);
  DB.appointments.push(...(apptRes.data||[]).map(realAppointmentToUi));

  const grouped=new Map();
  for(const row of overrideRes.data||[]){
    const doctorId=100000+Number(row.doctor_id);
    const key=`${doctorId}|${row.override_date}`;
    if(!grouped.has(key))grouped.set(key,{doctorId,date:row.override_date,blockedTimes:[],availableTimes:[],_realSupabase:true});
    const entry=grouped.get(key);
    const time=String(row.slot_time||'').slice(0,5);
    if(row.is_available)entry.availableTimes.push(time);
    else entry.blockedTimes.push(time);
  }
  DB.settings.slotOverrides=[...grouped.values()];

  DB.doctorLeaves=(DB.doctorLeaves||[]).filter(l=>!l._realSupabase);
  DB.doctorLeaves.push(...(leaveRes.data||[]).map(l=>({
    id:400000+Number(l.leave_id),
    dbLeaveId:Number(l.leave_id),
    doctorId:100000+Number(l.doctor_id),
    date:l.leave_date,
    reason:l.reason||'',
    _realSupabase:true
  })));

  return appointmentRecords();
}

async function syncAppointmentContext(){
  if(!currentUser?._realSupabase)return;
  if(['Administrator','Staff','Doctor'].includes(currentUser.role)){
    await syncAdminDirectoryFromSupabase();
  }else if(currentUser.role==='Patient'){
    if(!currentPatient||!currentPatient._realSupabase)await syncCurrentPatientFromSupabase();
    await syncRealDoctorDirectory();
  }
  await syncRealAppointments();
}
