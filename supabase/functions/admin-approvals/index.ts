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
        .select("user_id,auth_user_id,first_name,last_name,username,email,contact_number,person_type,college,id_number,status,verified,profile_image_url,id_file_url,id_back_file_url,verification_selfie_url,created_at,patients(patient_id,birth_date,sex,blood_type,address,emergency_contact_name,emergency_contact_number,medical_history,allergies)")
        .eq("role","Patient")
        .eq("status","Pending")
        .order("created_at",{ascending:true});
      if(error) throw error;

      const rows=[];
      for(const r of data||[]){
        let profileUrl=null,verificationUrl=null,selfieUrl=null,backUrl=null;
        // Sign both private ID sides only after reviewer authorization above.
        if(r.id_back_file_url){const x=await admin.storage.from("campuscare-verification").createSignedUrl(r.id_back_file_url,900);backUrl=x.data?.signedUrl||null;}
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
            r.person_type==="Student"?"Student ID":"Employee ID"
          ),
          registration_context:authMeta?.registration_context||"public",
          email_confirmed_at:emailConfirmedAt,
          email_verification_skipped:emailVerificationSkipped,
          selfie_verification_signed_url:selfieUrl,
          patients:undefined,
          profile_signed_url:profileUrl,
          verification_signed_url:verificationUrl,
          verification_back_signed_url:backUrl
        });
      }
      return json({ok:true,users:rows});
    }

    if(req.method==="POST"){
      const body=await req.json();
      const targetId=Number(body.user_id);
      const action=String(body.action||"").toLowerCase();
      const reason=String(body.reason||"").trim().slice(0,500);
      const checks=Array.isArray(body.checks)?body.checks.map((c:unknown)=>String(c).slice(0,20)).slice(0,10):[];
      if(!targetId||!["approve","reject"].includes(action)) return json({error:"Invalid approval request."},400);
      // The applicant is told why, so a rejection always needs a reason they can act on.
      if(action==="reject"&&reason.length<10) return json({error:"Give the applicant a reason for the rejection (at least 10 characters)."},400);

      const {data:target,error:tErr}=await admin.from("users")
        .select("user_id,auth_user_id,status,role,email,first_name,last_name,id_number,person_type,profile_image_url,id_file_url,id_back_file_url,verification_selfie_url")
        .eq("user_id",targetId).maybeSingle();
      if(tErr||!target||target.role!=="Patient"||target.status!=="Pending"){
        return json({error:"This registration was already reviewed or no longer exists. Refresh the queue."},404);
      }

      if(action==="approve"){
        const {error:uErr}=await admin.from("users")
          .update({status:"Active",verified:true})
          .eq("user_id",targetId).eq("status","Pending");
        if(uErr) throw uErr;
        await admin.from("audit_logs").insert({
          user_id:actor.user_id,action:"USER_APPROVED",entity_type:"users",entity_id:targetId,
          details:{previous_status:"Pending",new_status:"Active",reviewer_checks:checks}
        });
        // The account is Active now, so the notification is also queued as an email.
        await admin.from("notifications").insert({
          user_id:targetId,
          title:"Account approved",
          message:"Your CampusCare account has been approved. You may now sign in.",
          type:"Account",channel:"In-app",delivery_status:"Created"
        });
        return json({ok:true,status:"Active"});
      }

      // Rejection: email the reason, then remove the pending account and its identity photos so the
      // applicant can register again with the same email and ID number. The audit log keeps the decision.
      const fullName=`${target.first_name||""} ${target.last_name||""}`.trim()||"CampusCare applicant";
      const esc=(v:string)=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const text=`Hello ${fullName},\n\nYour CampusCare registration was not approved.\n\nReason: ${reason}\n\nYou may register again at CampusCare with clear photos of your selfie and the front and back of your Student or Employee ID. Contact the clinic if you need help.\n\nCTU Main Medical & Dental Clinic\nGround Floor, Education Building, CTU Main Campus\nPhone: (032) 402 4060 loc. 1142`;
      const html=`<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#1f2937"><div style="max-width:620px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border-radius:16px;border:1px solid #e5e7eb;padding:26px"><p style="margin-top:0">Hello ${esc(fullName)},</p><h2 style="font-size:20px;margin:0 0 12px;color:#0b6b3a">Your CampusCare registration was not approved</h2><p style="font-size:15px;line-height:1.65"><strong>Reason:</strong> ${esc(reason)}</p><p style="font-size:15px;line-height:1.65">You may register again with clear photos of your selfie and the front and back of your Student or Employee ID. Contact the clinic if you need help.</p><div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:12px;font-size:13px;line-height:1.6;color:#475569"><strong>CTU Main Medical &amp; Dental Clinic</strong><br>Ground Floor, Education Building, CTU Main Campus<br>Phone: (032) 402 4060 loc. 1142</div></div></div></body></html>`;
      let emailQueued=false;
      if(target.email){
        const {error:mailErr}=await admin.from("email_outbox").insert({
          user_id:null,recipient_email:target.email,subject:"CampusCare — Registration not approved",
          html_body:html,text_body:text,template_key:"account",status:"Pending",scheduled_at:new Date().toISOString()
        });
        emailQueued=!mailErr;
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"USER_REJECTED",entity_type:"users",entity_id:targetId,
        details:{previous_status:"Pending",reason,name:fullName,id_number:target.id_number||null,person_type:target.person_type||null,email_queued:emailQueued}
      });

      let removed=false;
      try{
        const verification=[target.verification_selfie_url,target.id_file_url,target.id_back_file_url].filter(Boolean);
        if(verification.length)await admin.storage.from("campuscare-verification").remove(verification);
        if(target.profile_image_url)await admin.storage.from("campuscare-profiles").remove([target.profile_image_url]);
        for(const table of ["notifications","privacy_consents"]){
          const {error}=await admin.from(table).delete().eq("user_id",targetId);
          if(error)throw error;
        }
        const {error:pErr}=await admin.from("patients").delete().eq("user_id",targetId);
        if(pErr)throw pErr;
        const {error:dErr}=await admin.from("users").delete().eq("user_id",targetId);
        if(dErr)throw dErr;
        if(target.auth_user_id){
          const {error:aErr}=await admin.auth.admin.deleteUser(target.auth_user_id);
          if(aErr)throw aErr;
        }
        removed=true;
      }catch(_){
        // If linked records prevent removal, keep the account closed instead.
        await admin.from("users").update({status:"Archived",verified:false}).eq("user_id",targetId);
      }
      return json({ok:true,status:removed?"Removed":"Archived",removed,email_queued:emailQueued});
    }

    return json({error:"Method not allowed."},405);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unexpected error."},500);
  }
});
