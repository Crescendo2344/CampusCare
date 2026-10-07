// ================================================================
// REAL PATIENT MANAGEMENT
// ================================================================
async function patientAction(payload){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await fetch(`${SUPABASE_URL}/functions/v1/patient-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Patient action failed.');
  return result;
}

function patientDisplayId(pt){
  const id=Number(pt?.dbPatientId??pt?.id??0);
  return String(id).padStart(6,'0');
}

function patientMeasurementNumber(value){
  const n=parseFloat(String(value??'').replace(/[^\d.]/g,''));
  return Number.isFinite(n)?n:'';
}
