// Inject dependencies so certificate transport can be exercised without live records.
export function createCertificateService({getClient,request,baseUrl,publishableKey}){
  async function action(payload){
    const {data:{session}}=await getClient().auth.getSession();
    if(!session)throw new Error('Your session has expired. Please log in again.');

    const response=await request(`${baseUrl}/functions/v1/certificate-actions`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:publishableKey,
        Authorization:`Bearer ${session.access_token}`
      },
      body:JSON.stringify(payload)
    });

    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Certificate action failed.');
    return result;
  }


  async function loadCertificates(){
    const {data,error}=await getClient()
      .from('medical_certificates')
      .select('certificate_id,patient_id,doctor_id,treatment_id,purpose,request_details,examination_findings,diagnosis,remarks,document_content,signature_url,status,requested_at,issued_at,certificate_no,decline_reason,prepared_by,prepared_at,signed_by,signed_at,created_at,updated_at')
      .order('requested_at',{ascending:false})
      .order('certificate_id',{ascending:false});

    if(error)throw error;

    return data||[];
  }
  return {action,loadCertificates};
}
