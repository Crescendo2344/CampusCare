// Client and HTTP dependencies are injected; this module never updates UI or shared state.
export function createAppointmentService({getClient,request,baseUrl,publishableKey}){
  async function action(payload){
    const {data:{session}}=await getClient().auth.getSession();
    if(!session)throw new Error('Your session has expired. Please log in again.');

    const response=await request(`${baseUrl}/functions/v1/appointment-actions`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:publishableKey,
        Authorization:`Bearer ${session.access_token}`
      },
      body:JSON.stringify(payload)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Appointment action failed.');
    return result;
  }

  async function loadDoctorDirectory(){
    const {data:{session}}=await getClient().auth.getSession();
    if(!session)return null;
    const response=await request(`${baseUrl}/functions/v1/doctor-directory`,{
      headers:{
        apikey:publishableKey,
        Authorization:`Bearer ${session.access_token}`
      }
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Unable to load doctors.');

    return result.doctors||[];
  }

  async function load(){
    const client=getClient();
    const [apptRes,overrideRes,leaveRes]=await Promise.all([
      client.from('appointments')
        .select('appointment_id,patient_id,doctor_id,clinic,service,appointment_date,appointment_time,status,priority,reason,notes,created_by,created_at,cancelled_at,cancellation_reason')
        .order('appointment_date',{ascending:false})
        .order('appointment_time',{ascending:false}),
      client.from('appointment_slot_overrides')
        .select('doctor_id,override_date,slot_time,is_available,reason'),
      client.from('doctor_leaves')
        .select('leave_id,doctor_id,leave_date,reason')
    ]);

    if(apptRes.error)throw apptRes.error;
    if(overrideRes.error)throw overrideRes.error;
    if(leaveRes.error)throw leaveRes.error;

    return {appointments:apptRes.data||[],overrides:overrideRes.data||[],leaves:leaveRes.data||[]};
  }
  return {action,loadDoctorDirectory,load};
}
