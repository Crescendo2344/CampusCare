import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {buildUserEditPatch} from "../_shared/admin-user-edit.js";
import {emailValidationError,normalizePhilippineMobile} from "../_shared/contact-validation.js";
import {contactValidationError,nameValidationError,passwordValidationError,usernameValidationError} from "../_shared/registration-validation.js";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const allowedDays=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const dayIndex:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
const time5=(v:unknown)=>String(v??"").slice(0,5);
const mins=(v:unknown)=>{const [h,m]=time5(v).split(":").map(Number);return (h||0)*60+(m||0);};
const normalizeWeekly=(body:any,target:any)=>{
  const workDays=Array.isArray(body.work_days)?body.work_days:(Array.isArray(target.work_days)?target.work_days:[]);
  const sharedStart=time5(body.start_time||target.start_time||"08:00");
  const sharedEnd=time5(body.end_time||target.end_time||"17:00");
  const sharedSlot=Math.max(15,Math.min(120,Number(body.slot_duration||target.slot_duration||60)));
  const sharedMax=Math.max(1,Math.min(100,Number(body.max_patients||target.max_patients||20)));
  const raw=Array.isArray(body.weekly_schedule)&&body.weekly_schedule.length
    ? body.weekly_schedule
    : allowedDays.map(day=>({day,is_working:workDays.includes(day),start_time:sharedStart,end_time:sharedEnd,slot_duration:sharedSlot,max_patients:sharedMax}));
  const byDay=new Map<string,any>();
  for(const item of raw){
    const day=String(item?.day||item?.dayName||"");
    if(!allowedDays.includes(day))continue;
    const working=item?.is_working===undefined?true:!!item.is_working;
    const start=time5(item?.start_time||item?.startTime||sharedStart);
    const end=time5(item?.end_time||item?.endTime||sharedEnd);
    const slot=Math.max(15,Math.min(120,Number(item?.slot_duration||item?.slotDuration||sharedSlot)));
    const maxPatients=Math.max(1,Math.min(100,Number(item?.max_patients||item?.maxPatients||sharedMax)));
    if(working&&(!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||start>=end))
      throw new Error(day+" start time must be before end time.");
    byDay.set(day,{day,weekday:dayIndex[day],isWorking:working,startTime:start,endTime:end,slotDuration:slot,maxPatients});
  }
  const rows=allowedDays.map(day=>byDay.get(day)||({day,weekday:dayIndex[day],isWorking:false,startTime:sharedStart,endTime:sharedEnd,slotDuration:sharedSlot,maxPatients:sharedMax}));
  if(!rows.some(r=>r.isWorking))throw new Error("Select at least one work day.");
  return rows;
};
const scheduleSummary=(rows:any[])=>{
  const working=rows.filter(r=>r.isWorking);
  const starts=working.map(r=>r.startTime).sort();
  const ends=working.map(r=>r.endTime).sort();
  return {
    work_days:working.map(r=>r.day),
    start_time:starts[0]||"08:00",
    end_time:ends[ends.length-1]||"17:00",
    slot_duration:working[0]?.slotDuration||60,
    max_patients:Math.max(...working.map(r=>r.maxPatients||1),1)
  };
};
const scheduleConflicts=async(admin:any,doctorId:number,effective:string,weekly:any[])=>{
  const {data,error}=await admin.from("appointments")
    .select("appointment_id,appointment_date,appointment_time,status")
    .eq("doctor_id",doctorId)
    .gte("appointment_date",effective)
    .in("status",["Scheduled","Confirmed"])
    .order("appointment_date",{ascending:true});
  if(error)throw error;
  const conflicts:any[]=[];
  const counts=new Map<string,number>();
  for(const a of data||[]){
    const date=String(a.appointment_date);
    const weekday=new Date(date+"T00:00:00Z").getUTCDay();
    const cfg=weekly.find(r=>r.weekday===weekday);
    const t=mins(a.appointment_time),start=mins(cfg?.startTime),end=mins(cfg?.endTime);
    counts.set(date,(counts.get(date)||0)+1);
    let reason="";
    if(!cfg?.isWorking)reason="day would be unavailable";
    else if(t<start||t>=end)reason="time falls outside the new hours";
    else if((t-start)%Math.max(15,Number(cfg.slotDuration||60))!==0)reason="time no longer matches the appointment interval";
    if(reason)conflicts.push({appointment_id:a.appointment_id,date,time:time5(a.appointment_time),reason});
  }
  for(const [date,count] of counts){
    const weekday=new Date(date+"T00:00:00Z").getUTCDay();
    const cfg=weekly.find(r=>r.weekday===weekday);
    if(cfg?.isWorking&&count>Number(cfg.maxPatients||100))
      conflicts.push({appointment_id:null,date,time:null,reason:`existing bookings (${count}) exceed max patients (${cfg.maxPatients})`});
  }
  return conflicts.slice(0,25);
};
const insertPermanentRules=async(admin:any,doctorId:number,weekly:any[],effective:string,createdBy:number)=>{
  await admin.from("doctor_schedule_rules")
    .delete()
    .eq("doctor_id",doctorId)
    .eq("effective_from",effective)
    .eq("schedule_scope","Permanent");
  const rows=weekly.map(r=>({
    doctor_id:doctorId,weekday:r.weekday,is_working:r.isWorking,
    start_time:r.isWorking?r.startTime:null,end_time:r.isWorking?r.endTime:null,
    slot_duration:r.slotDuration,max_patients:r.maxPatients,
    effective_from:effective,effective_to:null,schedule_scope:"Permanent",
    source_request_id:null,created_by:createdBy,updated_at:new Date().toISOString()
  }));
  const {error}=await admin.from("doctor_schedule_rules").insert(rows);
  if(error)throw error;
};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Method not allowed."},405);

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
      .select("user_id,auth_user_id,role,status")
      .eq("auth_user_id",user.id).maybeSingle();
    if(!actor||actor.role!=="Administrator"||actor.status!=="Active")
      return json({error:"Administrator access required."},403);

    const body=await req.json();
    const action=String(body.action||"").toLowerCase();

    if(action==="create"){
      const firstName=String(body.first_name||"").trim();
      const lastName=String(body.last_name||"").trim();
      const username=String(body.username||"").trim();
      const email=String(body.email||"").trim().toLowerCase();
      const password=String(body.password||"");
      const role=String(body.role||"").trim();
      const contactRaw=String(body.contact_number||"").trim();
      const specialty=String(body.specialty||"General Medicine");
      if(!["Doctor","Staff","Administrator"].includes(role))return json({error:"Choose a valid staff role.",field_errors:{role:"Choose a valid staff role."}},400);
      // The same field rules as public registration, so both sign-up paths accept the same accounts.
      const fieldErrors=Object.fromEntries(Object.entries({
        first_name:nameValidationError(firstName,"First name"),
        last_name:nameValidationError(lastName,"Last name"),
        username:usernameValidationError(username),
        email:email?emailValidationError(email):"Enter an email address.",
        password:passwordValidationError(password,{username,email}),
        contact_number:contactValidationError(contactRaw),
        specialty:role==="Doctor"&&!["General Medicine","Dental"].includes(specialty)?"Choose a valid doctor specialty.":""
      }).filter(([,message])=>message));
      if(Object.keys(fieldErrors).length)return json({error:Object.values(fieldErrors)[0],field_errors:fieldErrors},400);
      const contactNumber=contactRaw?normalizePhilippineMobile(contactRaw):"";
      const literal=(v:string)=>v.replace(/[\\%_]/g,"\\$&");

      const {data:emailHit}=await admin.from("users").select("user_id").ilike("email",literal(email)).limit(1);
      if(emailHit?.length) return json({error:"This email address is already registered.",field_errors:{email:"This email address is already registered."}},409);
      const {data:userHit}=await admin.from("users").select("user_id").ilike("username",literal(username)).limit(1);
      if(userHit?.length) return json({error:"This username is already taken.",field_errors:{username:"This username is already taken."}},409);

      const metadata={
        first_name:firstName,last_name:lastName,username,
        contact_number:contactNumber,
        person_type:role==="Doctor"?"Clinic Personnel":"Staff"
      };
      const {data:created,error:createErr}=await admin.auth.admin.createUser({
        email,password,email_confirm:true,user_metadata:metadata
      });
      if(createErr||!created.user) return json({error:createErr?.message||"Unable to create account."},400);

      const uid=created.user.id;
      const patch:any={
        first_name:firstName,last_name:lastName,username,email,
        contact_number:contactNumber,
        role,status:"Active",verified:true,
        specialty:role==="Doctor"?specialty:null,
        work_days:role==="Doctor"?(body.work_days||["Mon","Tue","Wed","Thu","Fri"]):[],
        start_time:role==="Doctor"?String(body.start_time||"08:00"):null,
        end_time:role==="Doctor"?String(body.end_time||"17:00"):null,
        slot_duration:role==="Doctor"?Number(body.slot_duration||60):null,
        max_patients:role==="Doctor"?Number(body.max_patients||9):null
      };
      const {data:profile,error:profileErr}=await admin.from("users")
        .update(patch).eq("auth_user_id",uid).select("user_id").single();
      if(profileErr) return json({error:profileErr.message},500);

      // The generic auth trigger creates a patient shell. Staff roles should not keep one.
      await admin.from("patients").delete().eq("user_id",profile.user_id);

      if(role==="Doctor"){
        const weekly=normalizeWeekly(body,patch);
        await insertPermanentRules(
          admin,Number(profile.user_id),weekly,
          new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10),
          actor.user_id
        );
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"USER_CREATED",entity_type:"users",entity_id:profile.user_id,
        details:{role,email,username}
      });
      return json({ok:true,user_id:profile.user_id});
    }

    const targetId=Number(body.user_id);
    if(!targetId) return json({error:"User ID is required."},400);
    const {data:target}=await admin.from("users")
      .select("user_id,auth_user_id,first_name,last_name,username,role,status,email,contact_number,verified,person_type,college,id_number,profile_image_url,id_file_url,specialty,work_days,start_time,end_time,slot_duration,max_patients,created_at,last_login_at,password_changed_at")
      .eq("user_id",targetId).maybeSingle();
    if(!target) return json({error:"User not found."},404);

    if(action==="detail"){
      const {data:patient,error:patientErr}=await admin.from("patients")
        .select("patient_id,birth_date,sex,blood_type,address,height_cm,weight_kg,emergency_contact_name,emergency_contact_number,medical_history,allergies,archived_at,updated_at")
        .eq("user_id",targetId)
        .maybeSingle();
      if(patientErr)throw patientErr;

      let authUser:any=null;
      if(target.auth_user_id){
        const {data:authData,error:authDetailErr}=await admin.auth.admin.getUserById(target.auth_user_id);
        if(authDetailErr)throw authDetailErr;
        authUser=authData?.user||null;
      }

      const sign=async(bucket:string,path:string|null)=>{
        if(!path)return null;
        const {data,error}=await admin.storage.from(bucket).createSignedUrl(path,900);
        if(error)return null;
        return data?.signedUrl||null;
      };

      const [profileSigned,verificationSigned]=await Promise.all([
        sign("campuscare-profiles",target.profile_image_url||null),
        sign("campuscare-verification",target.id_file_url||null)
      ]);

      const meta=authUser?.user_metadata||{};
      return json({
        ok:true,
        user:{
          ...target,
          profile_signed_url:profileSigned,
          verification_signed_url:verificationSigned,
          verification_document_type:meta.verification_document_type||(
            target.person_type==="Student"?"School ID or COR":
            target.role==="Patient"?"Employee ID":"Not required"
          ),
          registration_context:meta.registration_context||null,
          email_confirmed_at:authUser?.email_confirmed_at||null,
          last_sign_in_at:authUser?.last_sign_in_at||target.last_login_at||null,
          auth_created_at:authUser?.created_at||null
        },
        patient:patient||null
      });
    }

    if(action==="update"){
      // Do not let a direct API request bypass approval, the explicit review, or dedicated status actions.
      const result=buildUserEditPatch(body,target);
      if(result.error)return json({error:result.error},409);
      if(body.confirmed!==true)return json({error:"Review and confirm the user changes before saving."},400);
      const patch:any=result.patch;
      if(!Object.keys(patch).length)return json({error:"No changes to save."},400);
      const reason=String(body.reason||"").trim().slice(0,300);
      if(reason.length<5)return json({error:"Give a short reason for this change."},400);
      let changedAuthEmail=false;
      if(patch.email){
        const {data:hit,error:lookupError}=await admin.from("users").select("user_id").eq("email",patch.email).neq("user_id",targetId).limit(1);
        if(lookupError)throw lookupError;
        if(hit?.length)return json({error:"This email address is already registered."},409);
        if(!target.auth_user_id)return json({error:"This account is not linked to a sign-in account."},409);
        const {error}=await admin.auth.admin.updateUserById(target.auth_user_id,{email:patch.email});
        if(error)return json({error:error.message},400);
        changedAuthEmail=true;
      }
      // Read the updated row back and condition on its approved status: never report a zero-row write as success.
      const {data:saved,error}=await admin.from("users").update(patch).eq("user_id",targetId).eq("status",target.status)
        .select("user_id,first_name,last_name,email,contact_number,specialty,status").maybeSingle();
      if(error||!saved){
        if(changedAuthEmail){
          const {error:rollbackError}=await admin.auth.admin.updateUserById(target.auth_user_id,{email:target.email});
          if(rollbackError)return json({error:"Profile update failed and the sign-in email could not be restored. Contact the administrator before retrying."},500);
        }
        return json({error:error?.message||"The account status changed while editing. Reload the account and try again."},409);
      }
      // Before/after pairs so the activity log can show exactly what changed, and why.
      const changes:Record<string,unknown>={};
      for(const key of Object.keys(patch)){changes["previous_"+key]=(target as any)[key]??null;changes["new_"+key]=patch[key];}
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"USER_UPDATED",entity_type:"users",entity_id:targetId,details:{...changes,reason}});
      if(body.notify!==false){
        const labels:Record<string,string>={first_name:"first name",last_name:"last name",email:"email",contact_number:"mobile number",specialty:"specialty"};
        await admin.from("notifications").insert({
          user_id:targetId,title:"Account details updated",
          message:`An administrator updated your ${Object.keys(patch).map(k=>labels[k]||k).join(", ")}. Reason: ${reason}`,
          type:"Account",channel:"In-app",delivery_status:"Created",action_page:"my-account"
        });
      }
      return json({ok:true,user:saved});
    }

    if(action==="status"){
      const nextStatus=String(body.status||"");
      if(!["Active","Suspended","Archived"].includes(nextStatus)) return json({error:"Invalid status."},400);
      if(nextStatus!=="Archived"&&(target.status==="Pending"||!target.verified))return json({error:"Approve this account through registration review before changing its status."},409);
      if(targetId===actor.user_id && nextStatus!=="Active") return json({error:"You cannot suspend or archive your own administrator account."},400);
      const {error}=await admin.from("users").update({status:nextStatus}).eq("user_id",targetId);
      if(error) throw error;
      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:nextStatus==="Suspended"?"USER_SUSPENDED":nextStatus==="Archived"?"USER_ARCHIVED":"USER_REACTIVATED",
        entity_type:"users",entity_id:targetId,details:{previous_status:target.status,new_status:nextStatus}
      });
      return json({ok:true,status:nextStatus});
    }

    if(action==="schedule"){
      if(!["Active","Suspended"].includes(target.status))return json({error:"Approve or restore this account before editing its schedule."},409);
      if(target.role!=="Doctor") return json({error:"Only Doctor accounts have clinic schedules."},400);

      const effective=String(body.effective_date||new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10));
      const today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(effective)||effective<today)
        return json({error:"Effective date cannot be in the past."},400);

      const weekly=normalizeWeekly(body,target);
      const conflicts=await scheduleConflicts(admin,targetId,effective,weekly);
      if(conflicts.length){
        return json({
          error:"This schedule would conflict with existing future appointments. Resolve those appointments first.",
          conflicts
        },409);
      }

      await insertPermanentRules(admin,targetId,weekly,effective,actor.user_id);
      const summary=scheduleSummary(weekly);

      if(effective<=today){
        const {error}=await admin.from("users").update(summary).eq("user_id",targetId);
        if(error)throw error;
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"DOCTOR_SCHEDULE_UPDATED",
        entity_type:"users",
        entity_id:targetId,
        details:{...summary,effective_date:effective,weekly_schedule:weekly}
      });

      await admin.from("notifications").insert({
        user_id:targetId,
        title:"Work Schedule Updated",
        message:effective<=today
          ?"Your weekly clinic schedule was updated by an administrator."
          :"Your weekly clinic schedule was updated and will take effect on "+effective+".",
        type:"Account",channel:"In-app",delivery_status:"Created",
        reference_type:"users",reference_id:targetId,action_page:"schedule"
      });

      return json({ok:true,effective_date:effective,weekly_schedule:weekly});
    }

    return json({error:"Unsupported action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unable to manage user."},500);
  }
});
