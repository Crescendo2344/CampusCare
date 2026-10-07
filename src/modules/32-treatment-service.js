// ================================================================
// REAL SUPABASE TREATMENT RECORDS
// ================================================================
function treatmentRecords(){
  if(currentUser?._realSupabase)return (DB.treatments||[]).filter(t=>t._realSupabase);
  return DB.treatments||[];
}

function treatmentDisplayId(t){
  const id=Number(t?.dbTreatmentId??t?.id??0);
  return String(id).padStart(6,'0');
}

async function treatmentAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/treatment-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Treatment action failed.');
  return result;
}

function realTreatmentToUi(t){
  return {
    id:500000+Number(t.treatment_id),
    dbTreatmentId:Number(t.treatment_id),
    patientId:200000+Number(t.patient_id),
    dbPatientId:Number(t.patient_id),
    doctorId:100000+Number(t.doctor_id),
    dbDoctorId:Number(t.doctor_id),
    appointmentId:t.appointment_id?300000+Number(t.appointment_id):null,
    dbAppointmentId:t.appointment_id?Number(t.appointment_id):null,
    findings:t.examination_findings||'',
    diagnosis:t.diagnosis||'',
    prescription:t.prescription||'',
    notes:t.clinical_notes||'',
    vitals:t.vitals||{},
    xray:t.imaging_notes||'',
    date:t.treatment_date||'',
    followupDate:t.follow_up_date||'',
    status:t.status||'Active',
    archived:String(t.status||'').toLowerCase()==='archived',
    archivedAt:t.archived_at||'',
    archivedBy:t.archived_by?100000+Number(t.archived_by):null,
    createdAt:t.created_at||'',
    dentalRecord:null,
    _realSupabase:true
  };
}

async function syncRealTreatments(){
  if(!currentUser?._realSupabase)return treatmentRecords();

  const {data,error}=await supabaseClient
    .from('treatments')
    .select('treatment_id,patient_id,doctor_id,appointment_id,examination_findings,diagnosis,prescription,clinical_notes,vitals,imaging_notes,treatment_date,follow_up_date,status,archived_at,archived_by,created_at')
    .order('treatment_date',{ascending:false})
    .order('treatment_id',{ascending:false});

  if(error)throw error;

  DB.treatments=(DB.treatments||[]).filter(t=>!t._realSupabase);
  DB.treatments.push(...(data||[]).map(realTreatmentToUi));
  return treatmentRecords();
}


function realDentalRecordToUi(r){
  return {
    id:Number(r.dental_record_id),
    treatmentId:500000+Number(r.treatment_id),
    dbTreatmentId:Number(r.treatment_id),
    patientId:200000+Number(r.patient_id),
    dentistUserId:100000+Number(r.dentist_user_id),
    dentistName:r.dentist_name_snapshot||'',
    recordDate:r.record_date||'',
    courseMajor:r.course_major||'',
    yearSection:r.year_section||'',
    messengerAccount:r.messenger_account||'',
    cellNo:r.cell_no||'',
    odontogram:r.odontogram||{},
    oralHealth:r.oral_health||{},
    accomplishment:Array.isArray(r.accomplishment)?r.accomplishment:[],
    workStatus:r.work_status||'',
    recommendation:r.recommendation||'',
    createdAt:r.created_at||'',
    updatedAt:r.updated_at||'',
    _realSupabase:true
  };
}

async function syncRealDentalRecords(){
  if(!currentUser?._realSupabase)return [];
  const {data,error}=await supabaseClient
    .from('dental_records')
    .select('dental_record_id,treatment_id,patient_id,dentist_user_id,dentist_name_snapshot,record_date,course_major,year_section,messenger_account,cell_no,odontogram,oral_health,accomplishment,work_status,recommendation,created_at,updated_at')
    .order('record_date',{ascending:false});
  if(error)throw error;

  const map=new Map((data||[]).map(r=>[500000+Number(r.treatment_id),realDentalRecordToUi(r)]));
  for(const t of treatmentRecords()){
    if(t._realSupabase)t.dentalRecord=map.get(t.id)||null;
  }
  return [...map.values()];
}

async function syncRealMedicationReminders(){
  if(!currentUser?._realSupabase)return DB.medReminders||[];

  const {data,error}=await supabaseClient
    .from('medication_reminders')
    .select('reminder_id,patient_id,medication,dosage,frequency,times_of_day,start_date,end_date,active,created_at')
    .order('created_at',{ascending:false});

  if(error)throw error;

  DB.medReminders=(DB.medReminders||[]).filter(r=>!r._realSupabase);
  DB.medReminders.push(...(data||[]).map(r=>({
    id:600000+Number(r.reminder_id),
    dbReminderId:Number(r.reminder_id),
    patientId:200000+Number(r.patient_id),
    medicationName:r.medication||'',
    dosage:[r.dosage,r.frequency].filter(Boolean).join(' · '),
    startDate:r.start_date||'',
    endDate:r.end_date||'',
    timeOfDay:Array.isArray(r.times_of_day)?r.times_of_day:[],
    lastSent:null,
    status:r.active?'active':'inactive',
    _realSupabase:true
  })));
  return DB.medReminders;
}

async function syncTreatmentContext(){
  if(!currentUser?._realSupabase)return;

  if(['Administrator','Staff','Doctor'].includes(currentUser.role)){
    await syncAppointmentContext();
  }else if(currentUser.role==='Patient'){
    if(!currentPatient||!currentPatient._realSupabase)await syncCurrentPatientFromSupabase();
    await syncRealDoctorDirectory();
  }

  await Promise.all([
    syncRealTreatments(),
    syncRealMedicationReminders()
  ]);
  await syncRealDentalRecords();
}
