import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});

    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer ")) return json({error:"Authentication required."},401);
    const token=auth.slice(7);
    const {data:{user},error:userErr}=await admin.auth.getUser(token);
    if(userErr||!user) return json({error:"Invalid session."},401);

    const {data:actor}=await admin.from("users")
      .select("user_id,role,status")
      .eq("auth_user_id",user.id)
      .maybeSingle();
    if(!actor||!["Administrator","Staff"].includes(actor.role)||actor.status!=="Active"){
      return json({error:"Administrator or Staff access required."},403);
    }

    if(req.method==="GET"){
      const {data,error}=await admin.from("users")
        .select("user_id,auth_user_id,first_name,last_name,username,email,contact_number,person_type,college,id_number,status,verified,profile_image_url,id_file_url,verification_selfie_url,created_at,patients(patient_id,birth_date,sex,blood_type,address,emergency_contact_name,emergency_contact_number,medical_history,allergies)")
        .eq("role","Patient")
        .eq("status","Pending")
        .order("created_at",{ascending:false});
      if(error) throw error;

      const rows=[];
      for(const r of data||[]){
        let profileUrl=null,verificationUrl=null,selfieUrl=null;
        // Verification selfies remain private and are signed only after the staff-role guard above.
        if(r.verification_selfie_url){
          const x=await admin.storage.from("campuscare-verification").createSignedUrl(r.verification_selfie_url,900);
          selfieUrl=x.data?.signedUrl||null;
        }
        if(r.profile_image_url){
          const x=await admin.storage.from("campuscare-profiles").createSignedUrl(r.profile_image_url,900);
          profileUrl=x.data?.signedUrl||null;
        }
        if(r.id_file_url){
          const x=await admin.storage.from("campuscare-verification").createSignedUrl(r.id_file_url,900);
          verificationUrl=x.data?.signedUrl||null;
        }
        const patient=Array.isArray(r.patients)?r.patients[0]:r.patients;
        let authMeta:any={};
        let emailConfirmedAt:string|null=null;
        let emailVerificationSkipped=false;
        if(r.auth_user_id){
          const {data:authRow}=await admin.auth.admin.getUserById(r.auth_user_id);
          authMeta=authRow?.user?.user_metadata||{};
          emailConfirmedAt=authRow?.user?.email_confirmed_at||null;
          emailVerificationSkipped=authRow?.user?.app_metadata?.email_verification_skipped===true;
        }
        rows.push({
          ...r,
          birth_date:patient?.birth_date||null,
          sex:patient?.sex||null,
          blood_type:patient?.blood_type||null,
          address:patient?.address||null,
          emergency_contact_name:patient?.emergency_contact_name||null,
          emergency_contact_number:patient?.emergency_contact_number||null,
          medical_history:patient?.medical_history||null,
          allergies:patient?.allergies||null,
          verification_document_type:authMeta?.verification_document_type||(
            r.person_type==="Student"?"School ID or COR":"Employee ID"
          ),
          registration_context:authMeta?.registration_context||"public",
          email_confirmed_at:emailConfirmedAt,
          email_verification_skipped:emailVerificationSkipped,
          selfie_verification_signed_url:selfieUrl,
          patients:undefined,
          profile_signed_url:profileUrl,
          verification_signed_url:verificationUrl
        });
      }
      return json({ok:true,users:rows});
    }

    if(req.method==="POST"){
      const body=await req.json();
      const targetId=Number(body.user_id);
      const action=String(body.action||"").toLowerCase();
      const reason=String(body.reason||"").trim();
      if(!targetId||!["approve","reject"].includes(action)) return json({error:"Invalid approval request."},400);

      const {data:target,error:tErr}=await admin.from("users")
        .select("user_id,auth_user_id,status,role")
        .eq("user_id",targetId).maybeSingle();
      if(tErr||!target||target.role!=="Patient"||target.status!=="Pending"){
        return json({error:"Pending patient account not found."},404);
      }

      const nextStatus=action==="approve"?"Active":"Archived";
      const {error:uErr}=await admin.from("users")
        .update({status:nextStatus,verified:action==="approve"})
        .eq("user_id",targetId);
      if(uErr) throw uErr;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:action==="approve"?"USER_APPROVED":"USER_REJECTED",
        entity_type:"users",
        entity_id:targetId,
        details:{previous_status:"Pending",new_status:nextStatus,reason:reason||null}
      });

      await admin.from("notifications").insert({
        user_id:targetId,
        title:action==="approve"?"Account approved":"Registration not approved",
        message:action==="approve"
          ?"Your CampusCare account has been approved. You may now sign in."
          :`Your CampusCare registration was not approved.${reason?" Reason: "+reason:" Please contact the clinic if you need assistance."}`,
        type:"Account",
        channel:"In-app",
        delivery_status:"Created"
      });
      return json({ok:true,status:nextStatus});
    }

    return json({error:"Method not allowed."},405);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unexpected error."},500);
  }
});
