// Explicit client and request dependencies keep directory and patient access out of the UI.
const PATIENT_COLUMNS='patient_id,user_id,class_session,course,major,birth_date,sex,blood_type,address,height_cm,weight_kg,emergency_contact_name,emergency_contact_number,archived_at,updated_at,created_at';

export function createPatientService({getClient,request,baseUrl,publishableKey}){
  async function action(payload){
    const {data:{session}}=await getClient().auth.getSession();
    if(!session)throw new Error('Your session has expired. Please log in again.');

    const response=await request(`${baseUrl}/functions/v1/patient-actions`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:publishableKey,
        Authorization:`Bearer ${session.access_token}`
      },
      body:JSON.stringify(payload)
    });

    const result=await response.json().catch(()=>({}));
    // Field-level problems travel with the error so forms can show them beside each control.
    if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'Patient action failed.'),{fieldErrors:result.field_errors||null});
    return result;
  }

  // Medical history and allergies are not column-readable: the database hands them only to the
  // patient themself and to doctors and clinic staff. Administrators get blanks.
  async function attachHealthNotes(client,rows){
    for(const r of rows){r.medical_history='';r.allergies='';}
    if(!rows.length)return;
    const {data,error}=await client.rpc('patient_health_notes',{p_patient_ids:rows.map(r=>r.patient_id)});
    if(error)throw error;
    const byId=new Map((data||[]).map(h=>[Number(h.patient_id),h]));
    for(const r of rows){
      const h=byId.get(Number(r.patient_id));
      if(h){r.medical_history=h.medical_history||'';r.allergies=h.allergies||'';}
    }
  }

  async function loadClinicalDirectory(){
    const client=getClient();
    const [{data:users,error:userErr},{data:patients,error:patientErr}]=await Promise.all([
      client.from('users')
        .select('user_id,auth_user_id,first_name,last_name,username,email,contact_number,role,status,verified,person_type,college,id_number,profile_image_url,specialty,services_rendered,clinic,work_days,start_time,end_time,slot_duration,max_patients,created_at,last_login_at,password_changed_at,saved_signature_data')
        .order('user_id',{ascending:true}),
      client.from('patients')
        .select(PATIENT_COLUMNS)
        .order('patient_id',{ascending:true})
    ]);

    if(userErr)throw userErr;
    if(patientErr)throw patientErr;
    await attachHealthNotes(client,patients||[]);

    const patientByUser=new Map((patients||[]).map(p=>[Number(p.user_id),p]));
    const rows=[];

    for(const u of users||[]){
      let profileSignedUrl=null;
      if(u.profile_image_url){
        try{
          const {data:signed}=await client.storage
            .from('campuscare-profiles')
            .createSignedUrl(u.profile_image_url,3600);
          profileSignedUrl=signed?.signedUrl||null;
        }catch(_){}
      }
      rows.push({
        ...u,
        patient:patientByUser.get(Number(u.user_id))||null,
        profile_signed_url:profileSignedUrl
      });
    }
    return rows;
  }

  async function loadCurrentPatient(userId){
    const {data:row,error}=await getClient()
      .from('patients')
      .select(PATIENT_COLUMNS)
      .eq('user_id',userId)
      .maybeSingle();
    if(error||!row)return null;
    await attachHealthNotes(getClient(),[row]);

    return row;
  }
  return {action,loadClinicalDirectory,loadCurrentPatient};
}
