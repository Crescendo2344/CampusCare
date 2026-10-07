// Compatibility adapters retain treatment object identity and update application state.
function treatmentRecords(){return treatmentData.treatmentRecords(DB,currentUser);}
function treatmentDisplayId(t){return treatmentData.treatmentDisplayId(t);}
function realTreatmentToUi(t){return treatmentData.realTreatmentToUi(t);}
function realDentalRecordToUi(r){return treatmentData.realDentalRecordToUi(r);}
function treatmentService(){
  return createTreatmentService({getClient:()=>supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:SUPABASE_URL,publishableKey:SUPABASE_PUBLISHABLE_KEY});
}
async function treatmentAction(payload){return treatmentService().action(payload);}
async function syncRealTreatments(){
  if(!currentUser?._realSupabase)return treatmentRecords();
  const rows=await treatmentService().loadTreatments();
  DB.treatments=treatmentData.mergeTreatmentRecords(DB.treatments||[],rows);
  return treatmentRecords();
}
async function syncRealDentalRecords(){
  if(!currentUser?._realSupabase)return [];
  const rows=await treatmentService().loadDentalRecords();
  const map=treatmentData.indexDentalRecords(rows);
  for(const t of treatmentRecords()){
    if(t._realSupabase)t.dentalRecord=map.get(t.id)||null;
  }
  return [...map.values()];
}
async function syncRealMedicationReminders(){
  if(!currentUser?._realSupabase)return DB.medReminders||[];
  const rows=await treatmentService().loadMedicationReminders();
  DB.medReminders=treatmentData.mergeMedicationReminders(DB.medReminders||[],rows);
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
