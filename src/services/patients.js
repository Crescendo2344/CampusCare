// Explicit client and request dependencies keep directory and patient access out of the UI.
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
    if(!response.ok||!result.ok)throw new Error(result.error||'Patient action failed.');
    return result;
  }

  async function loadClinicalDirectory(){
    const client=getClient();
    const [{data:users,error:userErr},{data:patients,error:patientErr}]=await Promise.all([
      client.from('users')
        .select('user_id,auth_user_id,first_name,last_name,username,email,contact_number,role,status,verified,person_type,college,id_number,profile_image_url,specialty,work_days,start_time,end_time,slot_duration,max_patients,created_at,last_login_at,password_changed_at,saved_signature_data')
        .order('user_id',{ascending:true}),
      client.from('patients')
        .select('patient_id,user_id,birth_date,sex,blood_type,address,height_cm,weight_kg,emergency_contact_name,emergency_contact_number,medical_history,allergies,archived_at,updated_at')
        .order('patient_id',{ascending:true})
    ]);

    if(userErr)throw userErr;
    if(patientErr)throw patientErr;

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
      .select('*')
      .eq('user_id',userId)
      .maybeSingle();
    if(error||!row)return null;

    return row;
  }
  return {action,loadClinicalDirectory,loadCurrentPatient};
}
