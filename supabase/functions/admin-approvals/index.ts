import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import {queueEmail} from "../_shared/email-layout.js";

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
    if(!actor||actor.role!=="Administrator"||actor.status!=="Active"){
      return json({error:"Administrator access required."},403);
    }

    // The automatic-verification switch; if it cannot be read, the default (on) is shown.
    let settingsRow:any=null;
    try{({data:settingsRow}=await admin.from("system_settings").select("settings_id,auto_verify_registrations").order("settings_id",{ascending:true}).limit(1).maybeSingle());}catch{settingsRow=null;}
    const autoVerify=settingsRow?.auto_verify_registrations!==false;
    const signed=async(bucket:string,path:string|null)=>{
      if(!path)return null;
      const x=await admin.storage.from(bucket).createSignedUrl(path,900);return x.data?.signedUrl||null;
    };
    // Evidence is signed only after the administrator check above, and expires in 15 minutes.
    const reviewRow=async(r:any)=>{
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
      return {
        ...r,
        birth_date:patient?.birth_date||null,
        sex:patient?.sex||null,
        blood_type:patient?.blood_type||null,
        address:patient?.address||null,
        emergency_contact_name:patient?.emergency_contact_name||null,
        emergency_contact_number:patient?.emergency_contact_number||null,
        verification_document_type:authMeta?.verification_document_type||(
          r.person_type==="Student"?"Student ID":"Employee ID"
        ),
        registration_context:authMeta?.registration_context||"public",
        // What the registration form read from the ID photo (advisory; filled in by the applicant's browser).
        id_scan:authMeta?.id_scan&&typeof authMeta.id_scan==="object"?authMeta.id_scan:null,
        email_confirmed_at:emailConfirmedAt,
        email_verification_skipped:emailVerificationSkipped,
        selfie_verification_signed_url:await signed("campuscare-verification",r.verification_selfie_url),
        patients:undefined,
        profile_signed_url:await signed("campuscare-profiles",r.profile_image_url),
        verification_signed_url:await signed("campuscare-verification",r.id_file_url),
        verification_back_signed_url:await signed("campuscare-verification",r.id_back_file_url)
      };
    };
    const REVIEW_COLUMNS="user_id,auth_user_id,first_name,last_name,username,email,contact_number,person_type,college,id_number,status,verified,profile_image_url,id_file_url,id_back_file_url,verification_selfie_url,created_at,auto_verified_at,auto_verify_reviewed_at,patients(patient_id,birth_date,sex,blood_type,address,emergency_contact_name,emergency_contact_number)";

    if(req.method==="GET"){
      // ?view=auto lists accounts verified automatically in the last 30 days, not yet confirmed by an
      // administrator first. The default view is the registrations waiting for review.
      const view=new URL(req.url).searchParams.get("view");
      const query=view==="auto"
        ? admin.from("users").select(REVIEW_COLUMNS).eq("role","Patient").not("auto_verified_at","is",null)
            .gte("auto_verified_at",new Date(Date.now()-30*86400000).toISOString())
            .order("auto_verify_reviewed_at",{ascending:false,nullsFirst:true}).order("auto_verified_at",{ascending:false})
        : admin.from("users").select(REVIEW_COLUMNS).eq("role","Patient").eq("status","Pending").order("created_at",{ascending:true});
      const {data,error}=await query;
      if(error) throw error;
      const rows=[];
      for(const r of data||[])rows.push(await reviewRow(r));
      return json({ok:true,users:rows,auto_verify:autoVerify});
    }

    if(req.method==="POST"){
      const body=await req.json();
      const targetId=Number(body.user_id);
      const action=String(body.action||"").toLowerCase();
      const reason=String(body.reason||"").trim().slice(0,500);
      const checks=Array.isArray(body.checks)?body.checks.map((c:unknown)=>String(c).slice(0,20)).slice(0,10):[];

      // Turn automatic verification on or off. Off: new registrations wait for review again.
      if(action==="set_auto_verify"){
        const enabled=body.enabled===true;
        if(!settingsRow?.settings_id)return json({error:"System settings are missing."},500);
        const {error}=await admin.from("system_settings").update({auto_verify_registrations:enabled,updated_by:actor.user_id,updated_at:new Date().toISOString()}).eq("settings_id",settingsRow.settings_id);
        if(error)throw error;
        await admin.from("audit_logs").insert({user_id:actor.user_id,action:"AUTO_VERIFICATION_"+(enabled?"ENABLED":"DISABLED"),entity_type:"system_settings",entity_id:settingsRow.settings_id,details:{auto_verify_registrations:enabled}});
        return json({ok:true,auto_verify:enabled});
      }

      // An auto-verified account the administrator checked: confirm it, or suspend it.
      if(action==="confirm_auto"||action==="suspend_auto"){
        const {data:target,error:tErr}=await admin.from("users").select("user_id,role,status,email,first_name,auto_verified_at").eq("user_id",targetId).maybeSingle();
        if(tErr||!target||target.role!=="Patient"||!target.auto_verified_at)return json({error:"This account was not verified automatically. Refresh the list."},404);
        const now=new Date().toISOString();
        if(action==="confirm_auto"){
          const {error}=await admin.from("users").update({auto_verify_reviewed_at:now,auto_verify_reviewed_by:actor.user_id}).eq("user_id",targetId);
          if(error)throw error;
          await admin.from("audit_logs").insert({user_id:actor.user_id,action:"AUTO_VERIFICATION_CONFIRMED",entity_type:"users",entity_id:targetId,details:{reviewer_checks:checks}});
          return json({ok:true});
        }
        if(reason.length<10)return json({error:"Give the patient a reason for the suspension (at least 10 characters)."},400);
        if(target.status!=="Active")return json({error:`This account is already ${String(target.status).toLowerCase()}.`},409);
        const {error}=await admin.from("users").update({status:"Suspended",auto_verify_reviewed_at:now,auto_verify_reviewed_by:actor.user_id}).eq("user_id",targetId);
        if(error)throw error;
        await admin.from("audit_logs").insert({user_id:actor.user_id,action:"AUTO_VERIFICATION_REVOKED",entity_type:"users",entity_id:targetId,details:{previous_status:"Active",new_status:"Suspended",reason}});
        const emailQueued=await queueEmail(admin,{to:target.email,userId:targetId,subject:"CampusCare · Your account has been suspended",
          title:"Your account has been suspended",label:"Account review",tone:"danger",name:target.first_name||"there",
          paragraphs:["The clinic checked the ID photos and selfie of your CampusCare registration and suspended your account for now."],reason,
          note:"Visit the clinic with your Student or Employee ID so staff can verify you and reactivate your account.",button:null});
        return json({ok:true,status:"Suspended",email_queued:emailQueued});
      }

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
      const emailQueued=await queueEmail(admin,{to:target.email,subject:"CampusCare · Registration not approved",
        title:"Your registration was not approved",label:"Registration",tone:"danger",name:target.first_name||"there",
        paragraphs:["The clinic reviewed your CampusCare registration and could not approve it."],reason,
        note:"You may register again with clear photos of your selfie and the front and back of your Student or Employee ID. Contact the clinic if you need help.",
        button:{label:"Register again"}});

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
