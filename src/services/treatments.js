// Injected client and HTTP dependencies keep treatment data access independent of pages.
export function createTreatmentService({getClient,request,baseUrl,publishableKey}){
  async function action(payload){
    const {data:{session}}=await getClient().auth.getSession();
    if(!session)throw new Error('Your session has expired. Please log in again.');

    const response=await request(`${baseUrl}/functions/v1/treatment-actions`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:publishableKey,
        Authorization:`Bearer ${session.access_token}`
      },
      body:JSON.stringify(payload)
    });

    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Treatment action failed.');
    return result;
  }

  async function loadTreatments(){
    const {data,error}=await getClient()
      .from('treatments')
      .select('treatment_id,patient_id,doctor_id,appointment_id,examination_findings,diagnosis,prescription,clinical_notes,vitals,imaging_notes,treatment_date,follow_up_date,status,archived_at,archived_by,created_at')
      .order('treatment_date',{ascending:false})
      .order('treatment_id',{ascending:false});

    if(error)throw error;
    return data||[];
  }

  async function loadDentalRecords(){
    const {data,error}=await getClient()
      .from('dental_records')
      .select('dental_record_id,treatment_id,patient_id,dentist_user_id,dentist_name_snapshot,record_date,course_major,year_section,messenger_account,cell_no,odontogram,oral_health,accomplishment,work_status,recommendation,created_at,updated_at')
      .order('record_date',{ascending:false});
    if(error)throw error;
    return data||[];
  }

  async function loadMedicationReminders(){
    const {data,error}=await getClient()
      .from('medication_reminders')
      .select('reminder_id,patient_id,medication,dosage,frequency,times_of_day,start_date,end_date,active,created_at')
      .order('created_at',{ascending:false});

    if(error)throw error;
    return data||[];
  }
  return {action,loadTreatments,loadDentalRecords,loadMedicationReminders};
}
