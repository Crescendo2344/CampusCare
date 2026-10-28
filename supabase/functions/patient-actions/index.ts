import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import {authRedirect} from "../_shared/app-url.js";
import {registrationDetailErrors} from "../_shared/registration-validation.js";
import {normalizePhilippineMobile} from "../_shared/contact-validation.js";

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

// "photo" is an identity image (selfie or ID side): JPG/PNG/WebP up to 10 MB, never a PDF.
function decodeDataUrl(dataUrl:string,kind:"profile"|"verification"|"photo"){
  const rx=kind!=="verification"
    ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
    : /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/;
  const m=dataUrl.match(rx);
  if(!m)throw new Error(kind==="profile"
    ?"Profile picture must be JPG, PNG, or WebP."
    :kind==="photo"?"Verification photos must be JPG, PNG, or WebP.":"Verification file must be JPG, PNG, WebP, or PDF.");
  const mime=m[1];
  const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));
  const limit=kind==="profile"?5*1024*1024:10*1024*1024;
  if(kind==="photo"&&bytes.byteLength>limit)throw new Error("Each verification photo must be 10 MB or smaller.");
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
      const first=clean(body.first_name,50);
      const last=clean(body.last_name,50);
      const email=clean(body.email,150).toLowerCase();
      const username=clean(body.username,20);
      const idNumber=clean(body.id_number,7);
      const contactRaw=clean(body.contact_number,24);
      const contact=contactRaw?normalizePhilippineMobile(contactRaw):"";
      const personType=clean(body.person_type,80);
      const college=clean(body.college,80);
      const birthDate=clean(body.birth_date,10);
      const sex=clean(body.sex,40);
      const blood=clean(body.blood_type,20)||"Unknown";
      const classSession=personType==="Student"?clean(body.class_session,20):"";
      const address=clean(body.address,3000);
      const emergencyName=clean(body.emergency_contact_name,255);
      const emergencyRaw=clean(body.emergency_contact_number,24);
      const emergencyContact=emergencyRaw?normalizePhilippineMobile(emergencyRaw):"";
      const medicalHistory=clean(body.medical_history,5000);
      const allergies=clean(body.allergies,3000);
      const privacyAcknowledged=body.privacy_acknowledged===true;

      // Same field rules as public registration, reported per field.
      const manilaToday=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Manila"});
      const fieldErrors:Record<string,string>=registrationDetailErrors({first_name:first,last_name:last,username,email,contact_number:contactRaw,person_type:personType,college,id_number:idNumber,birth_date:birthDate,sex},manilaToday);
      if(personType==="Student"&&!["Morning","Evening"].includes(classSession))fieldErrors.class_session="Select the student's class session.";
      if(emergencyRaw&&!emergencyContact)fieldErrors.emergency_contact_number="Use 09 followed by 9 digits, or +63 followed by 10 digits starting with 9.";
      if(Object.keys(fieldErrors).length)return json({error:Object.values(fieldErrors)[0],field_errors:fieldErrors},400);
      if(!allowedBlood.includes(blood))return json({error:"Choose a valid blood type."},400);
      if(!privacyAcknowledged)
        return json({error:"The patient must review and acknowledge the CampusCare Privacy Notice before assisted registration can be completed."},400);

      // Identity evidence matches online registration: a live selfie and both sides of the ID (images only).
      const selfieData=String(body.selfie_data_url||""),frontData=String(body.id_front_data_url||""),backData=String(body.id_back_data_url||"");
      if(!selfieData||!frontData||!backData)
        return json({error:"A verification selfie and the front and back of the patient's ID are required."},400);
      const selfie=decodeDataUrl(selfieData,"photo");
      const idFront=decodeDataUrl(frontData,"photo");
      const idBack=decodeDataUrl(backData,"photo");
      if(frontData===backData)return json({error:"Use different photos for the front and back of the ID."},400);

      const [{data:emailExists},{data:userExists},{data:idExists}]=await Promise.all([
        admin.from("users").select("user_id").ilike("email",email).limit(1),
        admin.from("users").select("user_id").ilike("username",username).limit(1),
        admin.from("users").select("user_id").eq("id_number",idNumber).limit(1)
      ]);
      const duplicates:Record<string,string>={};
      if(emailExists?.length)duplicates.email="An account with this email already exists.";
      if(userExists?.length)duplicates.username="This username is already taken. Choose another one.";
      if(idExists?.length)duplicates.id_number="This ID number is already registered to another patient.";
      if(Object.keys(duplicates).length)return json({error:Object.values(duplicates)[0],field_errors:duplicates},409);

      // The account stays unverified until the patient opens the emailed link, exactly like a
      // public sign-up; that link also lets them choose their password.
      const temporaryPassword="Cc!"+crypto.randomUUID()+"9aA";
      const {data:created,error:createErr}=await admin.auth.admin.createUser({
        email,
        password:temporaryPassword,
        email_confirm:false,
        user_metadata:{
          registration_context:"public",role:"Patient",
          first_name:first,last_name:last,username,
          contact_number:contact,person_type:personType,
          college,id_number:idNumber,birth_date:birthDate,
          sex,address,emergency_contact_name:emergencyName,
          emergency_contact_number:emergencyContact,
          medical_history:medicalHistory,allergies,
          verification_document_type:personType==="Student"?"Student ID":"Employee ID",
          privacy_consent:true
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

      const uploads:[string,{mime:string,bytes:Uint8Array,ext:string}][]=[
        [`${created.user.id}/selfie-verification.${selfie.ext}`,selfie],
        [`${created.user.id}/id-front.${idFront.ext}`,idFront],
        [`${created.user.id}/id-back.${idBack.ext}`,idBack]
      ];
      for(const [path,file] of uploads){
        const {error:uploadErr}=await admin.storage.from("campuscare-verification").upload(path,file.bytes,{contentType:file.mime,upsert:true});
        if(uploadErr)throw uploadErr;
      }

      const height=numberOrNull(body.height_cm,40,260);
      const weight=numberOrNull(body.weight_kg,1,500);

      // Staff verified the person in person, so the record is active; sign-in still waits for the email link.
      const {error:userUpdateErr}=await admin.from("users").update({
        first_name:first,last_name:last,username,email,
        contact_number:contact||null,person_type:personType,
        college:college||null,id_number:idNumber,
        profile_image_url:null,verification_selfie_url:uploads[0][0],id_file_url:uploads[1][0],id_back_file_url:uploads[2][0],
        status:"Active",verified:true
      }).eq("user_id",appUser.user_id);
      if(userUpdateErr)throw userUpdateErr;

      const {error:patientUpdateErr}=await admin.from("patients").update({
        birth_date:birthDate,sex:sex||null,blood_type:blood,
        class_session:personType==="Student"?classSession:null,
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

      // Opening this link verifies the email address and lets the patient set a password.
      let verificationEmailSent=false;
      try{
        const {error:resetErr}=await anon.auth.resetPasswordForEmail(email,{
          redirectTo:authRedirect("recovery",(name:string)=>Deno.env.get(name)||"")
        });
        verificationEmailSent=!resetErr;
      }catch(_){}

      cleanupAuthId=null;
      cleanupAppUserId=null;

      return json({
        ok:true,
        patient_id:patient.patient_id,
        user_id:appUser.user_id,
        verification_email_sent:verificationEmailSent,
        password_setup_email_sent:verificationEmailSent
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
      const contactRaw=clean(body.contact_number,24);
      const contact=contactRaw;
      const idNumber=clean(body.id_number,7);
      const personType=clean(body.person_type,80);
      const college=clean(body.college,80);
      const birthDate=clean(body.birth_date,10);
      const sex=clean(body.sex,40);
      const blood=clean(body.blood_type,20)||"Unknown";
      // Class session is recorded explicitly; omitted fields preserve existing clients.
      const classSession=body.class_session===undefined?undefined:clean(body.class_session,20)||null;
      if(classSession&&!["Morning","Evening","Mixed"].includes(classSession))return json({error:"Choose a valid class session."},400);

      // Record edits follow the registration rules for the fields they change.
      const manilaToday=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Manila"});
      const fieldErrors:Record<string,string>=registrationDetailErrors({first_name:first,last_name:last,username:"placeholder",email:"placeholder@gmail.com",contact_number:contact,person_type:personType||"Student",college,id_number:idNumber,birth_date:birthDate,sex},manilaToday);
      if(classSession&&!["Morning","Evening"].includes(classSession))fieldErrors.class_session="Select Morning or Evening.";
      if(personType==="Student"&&classSession===null)fieldErrors.class_session="Select the student's class session.";
      if(Object.keys(fieldErrors).length)return json({error:Object.values(fieldErrors)[0],field_errors:fieldErrors},400);
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
        contact_number:contact?normalizePhilippineMobile(contact):null,
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
