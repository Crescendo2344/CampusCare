import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Medical certificates are written, signed and issued by the examining doctor only.
// Patients collect the printed certificate at the clinic; nobody else can request, prepare or change them.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=5000)=>String(v??"").trim().slice(0,max);
const PURPOSES=["OJT / Internship Requirement","Excused Absence","Sports / Athletics Participation"];

function stripHtml(value:string){
  return value
    .replace(/<br\s*\/?>/gi," ")
    .replace(/<[^>]*>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#39;/gi,"'")
    .replace(/&quot;/gi,'"')
    .replace(/​/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function extractCertificateField(html:string,field:"findings"|"remarks"){
  if(!html)return "";
  const attr=new RegExp(
    '<[^>]*data-cert-field=["\\\']'+field+'["\\\'][^>]*>([\\s\\S]*?)<\\/[^>]+>',
    'i'
  );
  const direct=html.match(attr);
  if(direct){
    const value=stripHtml(direct[1]||"");
    if(value)return value;
  }
  const label=field==="findings"
    ? "FINDINGS \/ DIAGNOSIS:"
    : "REMARKS \/ RECOMMENDATIONS:";
  const paragraph=new RegExp(
    '<p[^>]*>[\\s\\S]*?'+label+'([\\s\\S]*?)<\\/p>',
    'i'
  );
  const fallback=html.match(paragraph);
  return fallback?stripHtml(fallback[1]||""):"";
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({error:"Authentication required."},401);

    const {data:{user},error:userErr}=await admin.auth.getUser(auth.slice(7));
    if(userErr||!user)return json({error:"Invalid session."},401);

    const {data:actor,error:actorErr}=await admin.from("users")
      .select("user_id,role,status,first_name,last_name")
      .eq("auth_user_id",user.id).maybeSingle();

    if(actorErr||!actor||actor.status!=="Active")
      return json({error:"Active CampusCare account required."},403);
    if(actor.role!=="Doctor")
      return json({error:"Medical certificates are issued by clinic doctors only."},403);

    const body=await req.json();
    const action=String(body.action||"").toLowerCase();

    const getPatientUser=async(patientId:number)=>{
      const {data}=await admin.from("patients")
        .select("patient_id,user_id")
        .eq("patient_id",patientId).maybeSingle();
      return data||null;
    };
    const loadOwn=async(certificateId:number)=>{
      const {data}=await admin.from("medical_certificates")
        .select("certificate_id,patient_id,doctor_id,status,certificate_no,purpose")
        .eq("certificate_id",certificateId).maybeSingle();
      if(!data||data.doctor_id!==actor.user_id)return null;
      return data;
    };

    // Create or update the doctor's own draft.
    if(action==="draft"){
      const certificateId=Number(body.certificate_id||0);
      const purpose=clean(body.purpose,255);
      const details=clean(body.request_details,1000);
      const documentContent=clean(body.document_content,90000);
      const findings=clean(body.examination_findings,5000)||extractCertificateField(documentContent,"findings");
      const remarks=clean(body.remarks,5000)||extractCertificateField(documentContent,"remarks");
      const treatmentId=Number(body.treatment_id||0);

      if(!PURPOSES.includes(purpose))return json({error:"Choose one of the three certificate purposes."},400);
      if(!findings||!documentContent)return json({error:"Findings and the certificate document are required."},400);

      let patientId=Number(body.patient_id||0);
      if(certificateId){
        const existing=await loadOwn(certificateId);
        if(!existing)return json({error:"Certificate draft not found."},404);
        if(existing.status!=="Awaiting Signature")return json({error:"Only drafts can be edited. Void an issued certificate and write a new one."},409);
        patientId=existing.patient_id;
      }
      if(!patientId)return json({error:"Patient is required."},400);
      if(!await getPatientUser(patientId))return json({error:"Patient record not found."},404);
      // Linking a visit is optional (the doctor may base it on a fitness assessment), but a linked
      // visit must be this doctor's consultation with this patient.
      if(treatmentId){
        const {data:treatment}=await admin.from("treatments")
          .select("treatment_id,patient_id,doctor_id")
          .eq("treatment_id",treatmentId).maybeSingle();
        if(!treatment||treatment.patient_id!==patientId)
          return json({error:"The selected visit does not belong to this patient."},400);
        if(treatment.doctor_id!==actor.user_id)
          return json({error:"A certificate can only be based on your own consultation."},403);
      }

      const fields={
        patient_id:patientId,doctor_id:actor.user_id,treatment_id:treatmentId||null,purpose,
        request_details:details||null,examination_findings:findings,remarks:remarks||null,
        document_content:documentContent,status:"Awaiting Signature",
        prepared_by:actor.user_id,prepared_at:new Date().toISOString(),updated_at:new Date().toISOString()
      };
      const query=certificateId
        ? admin.from("medical_certificates").update(fields).eq("certificate_id",certificateId).select("certificate_id").single()
        : admin.from("medical_certificates").insert(fields).select("certificate_id").single();
      const {data:row,error}=await query;
      if(error)throw error;
      if(!certificateId){
        await admin.from("audit_logs").insert({
          user_id:actor.user_id,action:"MEDICAL_CERTIFICATE_DRAFTED",entity_type:"medical_certificates",
          entity_id:row.certificate_id,details:{patient_id:patientId,purpose,treatment_id:treatmentId}
        });
      }
      return json({ok:true,certificate_id:row.certificate_id});
    }

    if(action==="discard"){
      const certificateId=Number(body.certificate_id||0);
      const existing=await loadOwn(certificateId);
      if(!existing)return json({error:"Certificate draft not found."},404);
      if(existing.status!=="Awaiting Signature")return json({error:"Only drafts can be discarded."},409);
      const {error}=await admin.from("medical_certificates").delete().eq("certificate_id",certificateId);
      if(error)throw error;
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"MEDICAL_CERTIFICATE_DRAFT_DISCARDED",entity_type:"medical_certificates",entity_id:certificateId,details:{}});
      return json({ok:true});
    }

    if(action==="sign"){
      const certificateId=Number(body.certificate_id||0);
      const documentContent=clean(body.document_content,90000);
      const findings=clean(body.examination_findings,5000)||extractCertificateField(documentContent,"findings");
      const remarks=clean(body.remarks,5000)||extractCertificateField(documentContent,"remarks");
      const signatureData=clean(body.signature_data,180000);
      const saveSignature=Boolean(body.save_signature);

      if(!certificateId||!findings||!documentContent||!signatureData)
        return json({error:"Findings, document content, and physician signature are required."},400);

      const existing=await loadOwn(certificateId);
      if(!existing)return json({error:"Certificate draft not found."},404);
      if(existing.status!=="Awaiting Signature")
        return json({error:"This certificate is not a draft."},409);
      if(!PURPOSES.includes(existing.purpose))
        return json({error:"Choose one of the three certificate purposes."},400);

      const certNo=existing.certificate_no||
        `CTU-MC-${new Date().getFullYear()}-${String(certificateId).padStart(6,"0")}`;
      const now=new Date().toISOString();

      const {error}=await admin.from("medical_certificates")
        .update({
          certificate_no:certNo,examination_findings:findings,remarks:remarks||null,
          document_content:documentContent,signature_url:signatureData,status:"Issued",
          issued_at:now,signed_by:actor.user_id,signed_at:now,updated_at:now
        })
        .eq("certificate_id",certificateId);
      if(error)throw error;

      if(saveSignature){
        await admin.from("users").update({saved_signature_data:signatureData}).eq("user_id",actor.user_id);
      }

      const patient=await getPatientUser(existing.patient_id);
      if(patient){
        await admin.from("notifications").insert({
          user_id:patient.user_id,
          title:"Medical Certificate Ready",
          message:`Your medical certificate (${certNo}) has been signed and issued. You may collect the printed copy at the clinic.`,
          type:"Certificate",channel:"In-app",delivery_status:"Created",action_page:null
        });
      }
      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"MEDICAL_CERTIFICATE_ISSUED",entity_type:"medical_certificates",
        entity_id:certificateId,details:{certificate_no:certNo}
      });
      return json({ok:true,certificate_no:certNo,issued_at:now});
    }

    // Voiding keeps the record for audit and tells the patient why.
    if(action==="void"){
      const certificateId=Number(body.certificate_id||0);
      const reason=clean(body.reason,500);
      if(reason.length<5)return json({error:"Give a reason for voiding the certificate."},400);
      const existing=await loadOwn(certificateId);
      if(!existing)return json({error:"Certificate not found."},404);
      if(existing.status!=="Issued")return json({error:"Only issued certificates can be voided."},409);
      const {error}=await admin.from("medical_certificates")
        .update({status:"Cancelled",decline_reason:reason,updated_at:new Date().toISOString()})
        .eq("certificate_id",certificateId);
      if(error)throw error;
      const patient=await getPatientUser(existing.patient_id);
      if(patient){
        await admin.from("notifications").insert({
          user_id:patient.user_id,
          title:"Medical Certificate Voided",
          message:`Certificate ${existing.certificate_no} is no longer valid. Reason: ${reason}`,
          type:"Certificate",channel:"In-app",delivery_status:"Created",action_page:null
        });
      }
      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"MEDICAL_CERTIFICATE_VOIDED",entity_type:"medical_certificates",
        entity_id:certificateId,details:{certificate_no:existing.certificate_no,reason}
      });
      return json({ok:true});
    }

    // Reinstate a certificate voided moments ago by the same doctor.
    if(action==="unvoid"){
      const certificateId=Number(body.certificate_id||0);
      const existing=await loadOwn(certificateId);
      if(!existing)return json({error:"Certificate not found."},404);
      if(existing.status!=="Cancelled")return json({error:"This certificate is not voided."},409);
      const {data:log}=await admin.from("audit_logs").select("user_id,created_at")
        .eq("action","MEDICAL_CERTIFICATE_VOIDED").eq("entity_type","medical_certificates").eq("entity_id",certificateId)
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(!log||Number(log.user_id)!==Number(actor.user_id)||Date.now()-new Date(log.created_at).getTime()>15*60*1000)
        return json({error:"This certificate can no longer be reinstated. Issue a new one instead."},409);
      const {error}=await admin.from("medical_certificates")
        .update({status:"Issued",decline_reason:null,updated_at:new Date().toISOString()})
        .eq("certificate_id",certificateId);
      if(error)throw error;
      const patient=await getPatientUser(existing.patient_id);
      if(patient){
        await admin.from("notifications").delete()
          .eq("user_id",patient.user_id).eq("title","Medical Certificate Voided")
          .like("message",`Certificate ${existing.certificate_no} %`)
          .gte("created_at",new Date(new Date(log.created_at).getTime()-60000).toISOString());
      }
      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"MEDICAL_CERTIFICATE_VOID_UNDONE",entity_type:"medical_certificates",
        entity_id:certificateId,details:{certificate_no:existing.certificate_no}
      });
      return json({ok:true});
    }

    return json({error:"Unsupported certificate action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Certificate action failed."},500);
  }
});
