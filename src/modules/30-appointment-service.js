// Page adapters own state updates and keep existing public handlers during migration.
function appointmentDisplayId(a){return appointmentData.appointmentDisplayId(a);}
function openAppointmentFromRow(id){viewAppt(Number(id));}
function appointmentRecords(){return appointmentData.appointmentRecords(DB,currentUser);}
function realAppointmentToUi(a){return appointmentData.realAppointmentToUi(a,DB);}
function appointmentService(){
  return createAppointmentService({getClient:()=>supabaseClient,request:(...args)=>fetch(...args),
    baseUrl:SUPABASE_URL,publishableKey:SUPABASE_PUBLISHABLE_KEY});
}
async function appointmentAction(payload){return appointmentService().action(payload);}
async function syncRealDoctorDirectory(){
  if(!currentUser?._realSupabase)return;
  if(['Administrator','Staff','Doctor'].includes(currentUser.role)){
    await syncAdminDirectoryFromSupabase();
    return;
  }
  const doctors=await appointmentService().loadDoctorDirectory();
  // Missing sessions previously left the directory unchanged.
  if(doctors===null)return;
  DB.users=appointmentData.mergeDoctorDirectory(DB.users||[],doctors);
}
async function syncRealAppointments(){
  if(!currentUser?._realSupabase)return [];
  const data=await appointmentService().load();
  const snapshot=appointmentData.mergeAppointmentSnapshot(DB,data);
  DB.appointments=snapshot.appointments;
  DB.settings.slotOverrides=snapshot.slotOverrides;
  DB.doctorLeaves=snapshot.doctorLeaves;
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
