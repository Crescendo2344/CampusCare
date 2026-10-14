import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=5000)=>String(v??"").trim().slice(0,max);
const allowedBlood=["A+","A-","B+","B-","AB+","AB-","O+","O-","Unknown"];
const allowedPerson=["Student","Teaching Personnel","Non-Teaching Personnel"];

function decodeDataUrl(dataUrl:string,kind:"profile"|"verification"){
  const rx=kind==="profile"
    ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
    : /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/;
  const m=dataUrl.match(rx);
  if(!m)throw new Error(kind==="profile"
    ?"Profile picture must be JPG, PNG, or WebP."
    :"Verification file must be JPG, PNG, WebP, or PDF.");
  const mime=m[1];
  const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));
  const limit=kind==="profile"?5*1024*1024:10*1024*1024;
  if(bytes.byteLength>limit)throw new Error(kind==="profile"
    ?"Profile picture must be 5 MB or smaller."
    :"Verification file must be 10 MB or smaller.");
  let ext="jpg";
  if(mime==="image/png")ext="png";
  else if(mime==="image/webp")ext="webp";
  else if(mime==="application/pdf")ext="pdf";
  return {mime,bytes,ext};
}
function numberOrNull(v:unknown,min:number,max:number){
  if(v===null||v===undefined||String(v).trim()==="")return null;
  const n=Number(v);
  if(!Number.isFinite(n)||n<min||n>max)throw new Error("A numeric patient measurement is outside the allowed range.");
  return n;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  let cleanupAuthId:string|null=null;
  let cleanupAppUserId:number|null=null;

  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({error:"Authentication required."},401);

    const {data:{user},error:userErr}=await admin.auth.getUser(auth.slice(7));
    if(userErr||!user)return json({error:"Invalid session."},401);

    const {data:actor}=await admin.from("users")
      .select("user_id,role,status")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(!actor||actor.status!=="Active")return json({error:"Active CampusCare account required."},403);
    if(!["Staff","Administrator"].includes(actor.role))
      return json({error:"Staff or Administrator access required."},403);

    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"update").toLowerCase();

    if(action==="create_assisted"){
      const first=clean(body.first_name,120);
      const last=clean(body.last_name,120);
      const email=clean(body.email,320).toLowerCase();
      const username=clean(body.username,120);
      const idNumber=clean(body.id_number,120);
      const contact=clean(body.contact_number,80);
      const personType=clean(body.person_type,80);
      const college=clean(body.college,80);
      const birthDate=clean(body.birth_date,10);
      const sex=clean(body.sex,40);
      const blood=clean(body.blood_type,20)||"Unknown";
      // Class session is recorded explicitly; omitted fields preserve existing clients.
      const classSession=body.class_session===undefined?undefined:clean(body.class_session,20)||null;
      if(classSession&&!["Morning","Evening","Mixed"].includes(classSession))return json({error:"Choose a valid class session."},400);
      const address=clean(body.address,3000);
      const emergencyName=clean(body.emergency_contact_name,255);
      const emergencyContact=clean(body.emergency_contact_number,100);
      const medicalHistory=clean(body.medical_history,5000);
      const allergies=clean(body.allergies,3000);
      const profileData=String(body.profile_data_url||"");
      const verificationData=String(body.verification_data_url||"");
      const privacyAcknowledged=body.privacy_acknowledged===true;

      if(!first||!last||!email||!username||!idNumber||!birthDate)
        return json({error:"First name, last name, email, username, university ID, and birth date are required."},400);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return json({error:"Enter a valid patient email address."},400);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate))
        return json({error:"Birth date is invalid."},400);
      if(new Date(birthDate+"T00:00:00Z").getTime()>Date.now())
        return json({error:"Birth date cannot be in the future."},400);
      if(!allowedPerson.includes(personType))
        return json({error:"Choose a valid person type."},400);
      if(!allowedBlood.includes(blood))
        return json({error:"Choose a valid blood type."},400);
      if(!profileData||!verificationData)
        return json({error:"Profile picture and valid ID/COR are required for assisted registration."},400);
      if(!privacyAcknowledged)
        return json({error:"The patient must review and acknowledge the CampusCare Privacy Notice before assisted registration can be completed."},400);

      const [{data:emailExists},{data:userExists},{data:idExists}]=await Promise.all([
        admin.from("users").select("user_id").ilike("email",email).maybeSingle(),
        admin.from("users").select("user_id").eq("username",username).maybeSingle(),
        admin.from("users").select("user_id").eq("id_number",idNumber).maybeSingle()
      ]);
      if(emailExists)return json({error:"That email address is already registered."},409);
      if(userExists)return json({error:"That username is already in use."},409);
      if(idExists)return json({error:"That university ID number is already registered."},409);

      const profile=decodeDataUrl(profileData,"profile");
      const verification=decodeDataUrl(verificationData,"verification");
      const temporaryPassword="Cc!"+crypto.randomUUID()+"9aA";

      const {data:created,error:createErr}=await admin.auth.admin.createUser({
        email,
        password:temporaryPassword,
        email_confirm:true,
        user_metadata:{
          first_name:first,last_name:last,username,
          contact_number:contact,person_type:personType,
          college,id_number:idNumber,birth_date:birthDate,
          sex,address,emergency_contact_name:emergencyName,
          emergency_contact_number:emergencyContact,
          medical_history:medicalHistory,allergies
        }
      });
      if(createErr||!created.user)throw createErr||new Error("Unable to create patient authentication account.");
      cleanupAuthId=created.user.id;

      const {data:appUser,error:appUserErr}=await admin.from("users")
        .select("user_id").eq("auth_user_id",created.user.id).maybeSingle();
      if(appUserErr||!appUser)throw appUserErr||new Error("CampusCare patient profile was not created.");
      cleanupAppUserId=Number(appUser.user_id);

      const {data:patient,error:patientErr}=await admin.from("patients")
        .select("patient_id").eq("user_id",appUser.user_id).maybeSingle();
      if(patientErr||!patient)throw patientErr||new Error("CampusCare patient record was not created.");

      const profilePath=`${created.user.id}/profile-${Date.now()}.${profile.ext}`;
      const verificationPath=`${created.user.id}/verification-${Date.now()}.${verification.ext}`;

      const {error:profileUploadErr}=await admin.storage
        .from("campuscare-profiles")
        .upload(profilePath,profile.bytes,{contentType:profile.mime,upsert:true});
      if(profileUploadErr)throw profileUploadErr;

      const {error:verificationUploadErr}=await admin.storage
        .from("campuscare-verification")
        .upload(verificationPath,verification.bytes,{contentType:verification.mime,upsert:true});
      if(verificationUploadErr)throw verificationUploadErr;

      const height=numberOrNull(body.height_cm,40,260);
      const weight=numberOrNull(body.weight_kg,1,500);

      const {error:userUpdateErr}=await admin.from("users").update({
        first_name:first,last_name:last,username,email,
        contact_number:contact||null,person_type:personType,
        college:college||null,id_number:idNumber,
        profile_image_url:profilePath,id_file_url:verificationPath,
        status:"Active",verified:true
      }).eq("user_id",appUser.user_id);
      if(userUpdateErr)throw userUpdateErr;

      const {error:patientUpdateErr}=await admin.from("patients").update({
        birth_date:birthDate,sex:sex||null,blood_type:blood,
        ...(classSession===undefined?{}:{class_session:personType==="Student"?classSession:null}),
        address:address||null,height_cm:height,weight_kg:weight,
        emergency_contact_name:emergencyName||null,
        emergency_contact_number:emergencyContact||null,
        medical_history:medicalHistory||null,allergies:allergies||null,
        updated_at:new Date().toISOString()
      }).eq("patient_id",patient.patient_id);
      if(patientUpdateErr)throw patientUpdateErr;

      const {data:privacySettings}=await admin.from("system_settings")
        .select("privacy_policy_version")
        .order("settings_id",{ascending:true})
        .limit(1)
        .maybeSingle();
      const privacyVersion=String(privacySettings?.privacy_policy_version||"1.0").slice(0,40);
      const forwarded=req.headers.get("x-forwarded-for")||req.headers.get("cf-connecting-ip")||"";
      const ip=forwarded.split(",")[0].trim()||null;

      const {error:privacyErr}=await admin.from("privacy_consents").insert({
        user_id:appUser.user_id,
        privacy_version:privacyVersion,
        consented:true,
        event_type:"Assisted Registration Acknowledgement",
        notes:"Privacy Notice acknowledged during clinic-assisted registration.",
        ip_address:ip,
        user_agent:req.headers.get("user-agent")
      });
      if(privacyErr)throw privacyErr;

      await admin.from("notifications").insert({
        user_id:appUser.user_id,
        title:"CampusCare Account Created",
        message:"Your patient account was created through clinic-assisted registration. You can review the Privacy Notice anytime in Account Settings.",
        type:"Account",channel:"In-app",delivery_status:"Created",
        reference_type:"users",reference_id:appUser.user_id,action_page:"my-account"
      });

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"ASSISTED_PATIENT_CREATED",
        entity_type:"patients",
        entity_id:patient.patient_id,
        details:{user_id:appUser.user_id,id_number:idNumber,email}
      });

      let passwordSetupEmailSent=false;
      try{
        const {error:resetErr}=await anon.auth.resetPasswordForEmail(email,{
          redirectTo:"https://crescendo2344.github.io/CampusCare/?auth=recovery"
        });
        passwordSetupEmailSent=!resetErr;
      }catch(_){}

      cleanupAuthId=null;
      cleanupAppUserId=null;

      return json({
        ok:true,
        patient_id:patient.patient_id,
        user_id:appUser.user_id,
        password_setup_email_sent:passwordSetupEmailSent
      });
    }

    const patientId=Number(body.patient_id||0);
    if(!patientId)return json({error:"Patient ID is required."},400);

    const {data:patient,error:patientErr}=await admin.from("patients")
      .select("patient_id,user_id,archived_at,archived_previous_user_status")
      .eq("patient_id",patientId).maybeSingle();
    if(patientErr||!patient)return json({error:"Patient record not found."},404);

    const {data:target,error:targetErr}=patient.user_id
      ? await admin.from("users")
          .select("user_id,auth_user_id,status,first_name,last_name")
          .eq("user_id",patient.user_id).maybeSingle()
      : {data:null,error:null};
    if(targetErr)throw targetErr;
    if(!target)return json({error:"Linked patient account was not found."},404);

    if(action==="update"){
      if(patient.archived_at)return json({error:"Restore the patient record before editing it."},400);

      const first=clean(body.first_name,120);
      const last=clean(body.last_name,120);
      const contact=clean(body.contact_number,80);
      const idNumber=clean(body.id_number,120);
      const personType=clean(body.person_type,80);
      const college=clean(body.college,80);
      const birthDate=clean(body.birth_date,10);
      const sex=clean(body.sex,40);
      const blood=clean(body.blood_type,20)||"Unknown";
      // Class session is recorded explicitly; omitted fields preserve existing clients.
      const classSession=body.class_session===undefined?undefined:clean(body.class_session,20)||null;
      if(classSession&&!["Morning","Evening","Mixed"].includes(classSession))return json({error:"Choose a valid class session."},400);

      if(!first||!last||!birthDate)
        return json({error:"First name, last name, and birth date are required."},400);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)||new Date(birthDate+"T00:00:00Z").getTime()>Date.now())
        return json({error:"Birth date is invalid."},400);
      if(personType&&!allowedPerson.includes(personType))
        return json({error:"Choose a valid person type."},400);
      if(!allowedBlood.includes(blood))
        return json({error:"Choose a valid blood type."},400);

      if(idNumber){
        const {data:duplicate}=await admin.from("users")
          .select("user_id").eq("id_number",idNumber).neq("user_id",target.user_id).maybeSingle();
        if(duplicate)return json({error:"That university ID number belongs to another account."},409);
      }

      const height=numberOrNull(body.height_cm,40,260);
      const weight=numberOrNull(body.weight_kg,1,500);

      const {error:userUpdateErr}=await admin.from("users").update({
        first_name:first,last_name:last,
        contact_number:contact||null,
        id_number:idNumber||null,
        person_type:personType||null,
        college:college||null
      }).eq("user_id",target.user_id);
      if(userUpdateErr)throw userUpdateErr;

      if(target.auth_user_id){
        await admin.auth.admin.updateUserById(target.auth_user_id,{
          user_metadata:{first_name:first,last_name:last}
        });
      }

      const {error:updateErr}=await admin.from("patients").update({
        birth_date:birthDate,sex:sex||null,blood_type:blood,
        ...(classSession===undefined?{}:{class_session:personType==="Student"?classSession:null}),
        address:clean(body.address,3000)||null,
        height_cm:height,weight_kg:weight,
        emergency_contact_name:clean(body.emergency_contact_name,255)||null,
        emergency_contact_number:clean(body.emergency_contact_number,100)||null,
        medical_history:clean(body.medical_history,5000)||null,
        allergies:clean(body.allergies,3000)||null,
        updated_at:new Date().toISOString()
      }).eq("patient_id",patientId);
      if(updateErr)throw updateErr;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"PATIENT_RECORD_UPDATED",
        entity_type:"patients",entity_id:patientId,
        details:{target_user_id:target.user_id}
      });

      return json({ok:true});
    }

    if(action==="archive"){
      if(actor.role!=="Administrator")return json({error:"Administrator access required to archive a patient record."},403);
      if(patient.archived_at)return json({ok:true,already_archived:true});

      const today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
      const {count}=await admin.from("appointments")
        .select("appointment_id",{count:"exact",head:true})
        .eq("patient_id",patientId)
        .gte("appointment_date",today)
        .in("status",["Scheduled","Confirmed"]);
      if((count||0)>0)
        return json({error:"This patient still has upcoming scheduled appointments. Cancel or complete those appointments before archiving the record."},409);

      await admin.from("patients").update({
        archived_at:new Date().toISOString(),
        archived_previous_user_status:target.status,
        updated_at:new Date().toISOString()
      }).eq("patient_id",patientId);

      await admin.from("users").update({status:"Archived"}).eq("user_id",target.user_id);

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"PATIENT_RECORD_ARCHIVED",
        entity_type:"patients",entity_id:patientId,
        details:{target_user_id:target.user_id,previous_status:target.status}
      });

      return json({ok:true});
    }

    if(action==="restore"){
      if(actor.role!=="Administrator")return json({error:"Administrator access required to restore a patient record."},403);
      if(!patient.archived_at)return json({ok:true,already_active:true});

      const previous=["Pending","Active","Suspended"].includes(String(patient.archived_previous_user_status))
        ? String(patient.archived_previous_user_status)
        : "Active";

      await admin.from("patients").update({
        archived_at:null,
        archived_previous_user_status:null,
        updated_at:new Date().toISOString()
      }).eq("patient_id",patientId);

      await admin.from("users").update({status:previous}).eq("user_id",target.user_id);

      await admin.from("notifications").insert({
        user_id:target.user_id,
        title:"Patient Record Restored",
        message:"Your CampusCare patient record has been restored by an administrator.",
        type:"Account",channel:"In-app",delivery_status:"Created",
        reference_type:"patients",reference_id:patientId,action_page:"my-records"
      });

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"PATIENT_RECORD_RESTORED",
        entity_type:"patients",entity_id:patientId,
        details:{target_user_id:target.user_id,restored_status:previous}
      });

      return json({ok:true,status:previous});
    }

    return json({error:"Unsupported patient action."},400);
  }catch(e){
    // Clean up a partially created assisted-registration account.
    if(cleanupAppUserId){
      try{await createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
        .from("patients").delete().eq("user_id",cleanupAppUserId);}catch(_){}
      try{await createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
        .from("users").delete().eq("user_id",cleanupAppUserId);}catch(_){}
    }
    if(cleanupAuthId){
      try{await createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
        .auth.admin.deleteUser(cleanupAuthId);}catch(_){}
    }
    return json({error:e instanceof Error?e.message:"Patient action failed."},500);
  }
});
