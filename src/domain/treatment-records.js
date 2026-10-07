// Treatment record selection and mapping depend only on supplied records.
export function treatmentRecords(db,account){
  if(account?._realSupabase)return (db.treatments||[]).filter(t=>t._realSupabase);
  return db.treatments||[];
}

export function treatmentDisplayId(t){
  const id=Number(t?.dbTreatmentId??t?.id??0);
  return String(id).padStart(6,'0');
}

export function realTreatmentToUi(t){
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

export function realDentalRecordToUi(r){
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

export function realMedicationReminderToUi(r){
  return {
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
  };
}

export function mergeTreatmentRecords(existing,rows){
  return [...existing.filter(t=>!t._realSupabase),...rows.map(realTreatmentToUi)];
}

export function mergeMedicationReminders(existing,rows){
  return [...existing.filter(r=>!r._realSupabase),...rows.map(realMedicationReminderToUi)];
}

// Keep backend row ordering and the existing last-record-per-treatment association.
export function indexDentalRecords(rows){
  return new Map(rows.map(r=>[500000+Number(r.treatment_id),realDentalRecordToUi(r)]));
}
