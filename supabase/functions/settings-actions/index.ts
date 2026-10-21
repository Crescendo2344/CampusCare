import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {academicYearFor,validateAcademicYear} from "../_shared/academic-year.js";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=1000)=>String(v??"").trim().slice(0,max);

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  try{
    const admin=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {auth:{persistSession:false,autoRefreshToken:false}}
    );

    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({error:"Authentication required."},401);

    const {data:{user},error:userErr}=await admin.auth.getUser(auth.slice(7));
    if(userErr||!user)return json({error:"Invalid session."},401);

    const {data:actor}=await admin.from("users")
      .select("user_id,role,status")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(!actor||actor.status!=="Active")return json({error:"Active CampusCare account required."},403);
    if(actor.role!=="Administrator")return json({error:"Administrator access required."},403);

    const body=await req.json();
    const action=String(body.action||"get").toLowerCase();

    const load=async()=>{
      const {data,error}=await admin.from("system_settings")
        .select("*")
        .order("settings_id",{ascending:true})
        .limit(1)
        .maybeSingle();
      if(error)throw error;
      return data;
    };

    if(action==="get"){
      return json({ok:true,settings:await load()});
    }

    if(action==="update"){
      const current=await load();
      if(!current)return json({error:"System settings record not found."},404);

      const reminderDays=Math.max(0,Math.min(14,Number(body.appointment_reminder_days??current.appointment_reminder_days??1)));
      const dentalLimit=Math.max(1,Math.min(5,Number(body.dental_visit_limit_per_semester??current.dental_visit_limit_per_semester??1)));
      const privacyVersion=clean(body.privacy_policy_version||current.privacy_policy_version||"1.0",40)||"1.0";
      const privacyUpdated=body.privacy_policy_updated||current.privacy_policy_updated||new Date().toISOString().slice(0,10);
      const scheduleNoticeDays=Math.max(0,Math.min(30,Number(body.schedule_change_notice_days??current.schedule_change_notice_days??3)));

      const patch={
        clinic_name:clean(body.clinic_name??current.clinic_name,255),
        address:clean(body.address??current.address,1500),
        contact_email:clean(body.contact_email??current.contact_email,320),
        contact_number:clean(body.contact_number??current.contact_number,100),
        semester_start:body.semester_start??current.semester_start??null,
        semester_end:body.semester_end??current.semester_end??null,
        semester2_start:body.semester2_start??current.semester2_start??null,
        semester2_end:body.semester2_end??current.semester2_end??null,
        dental_visit_limit_per_semester:dentalLimit,
        appointment_reminder_days:reminderDays,
        privacy_policy_version:privacyVersion,
        privacy_policy_updated:privacyUpdated,
        schedule_change_notice_days:scheduleNoticeDays,
        updated_by:actor.user_id,
        updated_at:new Date().toISOString()
      };

      // Critical changes must pass both the client review and this server boundary.
      const criticalKeys=["clinic_name","address","contact_email","contact_number","dental_visit_limit_per_semester","appointment_reminder_days","semester_start","semester_end","semester2_start","semester2_end"];
      const changed=criticalKeys.filter(key=>String(patch[key]??"")!==String(current[key]??""));
      if(changed.length&&body.critical_confirmation!==true)return json({error:"Review and confirm the critical settings changes before saving."},409);
      if(!patch.clinic_name||!Number.isInteger(reminderDays)||!Number.isInteger(dentalLimit))return json({error:"Enter valid clinic settings and whole-number limits."},400);
      const dates={semesterStart:patch.semester_start,semesterEnd:patch.semester_end,semester2Start:patch.semester2_start,semester2End:patch.semester2_end};
      // Existing calendar-year settings remain readable; a changed semester must use an academic year.
      if(changed.some(key=>key.startsWith("semester"))){
        const problem=validateAcademicYear(dates,body.academic_year);
        if(problem)return json({error:problem},400);
      }
      const {data,error}=await admin.from("system_settings")
        .update(patch)
        .eq("settings_id",current.settings_id)
        .select("*")
        .single();

      if(error)throw error;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"SYSTEM_SETTINGS_UPDATED",
        entity_type:"system_settings",
        entity_id:current.settings_id,
        details:{
          critical_fields_changed:changed,
          academic_year:academicYearFor(dates),
          appointment_reminder_days:reminderDays,
          dental_visit_limit_per_semester:dentalLimit,
          privacy_policy_version:privacyVersion,
          privacy_policy_updated:privacyUpdated,
          schedule_change_notice_days:scheduleNoticeDays
        }
      });

      return json({ok:true,settings:data});
    }

    return json({error:"Unsupported settings action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Settings action failed."},500);
  }
});
