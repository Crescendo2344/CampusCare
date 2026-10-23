import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const time5=(v:string)=>String(v||"").slice(0,5);
const dayName=(date:string)=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(date+"T00:00:00").getDay()];
const mins=(t:string)=>{const [h,m]=time5(t).split(":").map(Number);return h*60+(m||0)};
// Clinic date and time in Asia/Manila (UTC+8, no daylight saving).
const manilaNow=()=>{
  const shifted=new Date(Date.now()+8*60*60*1000);
  return {date:shifted.toISOString().slice(0,10),minutes:shifted.getUTCHours()*60+shifted.getUTCMinutes()};
};
const OPEN=["Scheduled","Confirmed"];
const hasStarted=(appt:any)=>{
  const now=manilaNow();
  return appt.appointment_date<now.date||(appt.appointment_date===now.date&&mins(appt.appointment_time)<=now.minutes);
};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});

    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({error:"Authentication required."},401);
    const {data:{user},error:userErr}=await admin.auth.getUser(auth.slice(7));
    if(userErr||!user)return json({error:"Invalid session."},401);

    const {data:actor}=await admin.from("users")
      .select("user_id,role,status")
      .eq("auth_user_id",user.id).maybeSingle();
    if(!actor||actor.status!=="Active")return json({error:"Active CampusCare account required."},403);

    const body=await req.json();
    const action=String(body.action||"").toLowerCase();

    const loadAppointment=async(id:number)=>{
      const {data}=await admin.from("appointments").select("*").eq("appointment_id",id).maybeSingle();
      return data;
    };
    const actorPatientId=async()=>{
      const {data}=await admin.from("patients").select("patient_id").eq("user_id",actor.user_id).maybeSingle();
      return data?.patient_id||null;
    };
    const canManageAll=["Staff","Administrator"].includes(actor.role);

    if(action==="create"||action==="reschedule"){
      const appointmentId=Number(body.appointment_id||0);
      const existing=action==="reschedule"?await loadAppointment(appointmentId):null;
      if(action==="reschedule"&&!existing)return json({error:"Appointment not found."},404);
      if(action==="reschedule"&&!OPEN.includes(existing.status))return json({error:"Only scheduled appointments can be rescheduled."},409);

      let patientId=Number(body.patient_id||existing?.patient_id||0);
      if(actor.role==="Patient"){
        const own=await actorPatientId();
        if(!own)return json({error:"Patient record not found."},400);
        if(action==="reschedule"&&existing?.patient_id!==own)return json({error:"You may only reschedule your own appointment."},403);
        patientId=own;
      }else if(!canManageAll){
        return json({error:"Only Patients, Staff, or Administrators may book/reschedule appointments."},403);
      }

      const doctorId=Number(body.doctor_id||0);
      const clinic=String(body.clinic||"Medical Clinic");
      const serviceName=String(body.service||"").trim();
      const date=String(body.appointment_date||"");
      const time=time5(String(body.appointment_time||""));
      const reason=String(body.reason||"").trim().slice(0,1000);
      const priority=String(body.priority||"").trim().slice(0,30);

      if(!patientId||!doctorId||!serviceName||!date||!time)return json({error:"Patient, doctor, service, date, and time are required."},400);

      const today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
      if(date<today)return json({error:"Appointments cannot be booked in the past."},400);
      if(date===today){
        const now=new Date();
        const nowMin=now.getUTCHours()*60+now.getUTCMinutes()+8*60;
        const phMin=((nowMin%1440)+1440)%1440;
        if(mins(time)<=phMin)return json({error:"That time has already passed."},400);
      }

      const {data:doctor}=await admin.from("users")
        .select("user_id,role,status,work_days,start_time,end_time,slot_duration,specialty")
        .eq("user_id",doctorId).maybeSingle();
      if(!doctor||doctor.role!=="Doctor"||doctor.status!=="Active")return json({error:"Selected doctor is unavailable."},400);

      const weekday=new Date(date+"T00:00:00Z").getUTCDay();
      const {data:ruleRows,error:ruleErr}=await admin.from("doctor_schedule_rules")
        .select("is_working,start_time,end_time,slot_duration,max_patients,effective_from,effective_to")
        .eq("doctor_id",doctorId)
        .eq("weekday",weekday)
        .lte("effective_from",date)
        .or("effective_to.is.null,effective_to.gte."+date)
        .order("effective_from",{ascending:false})
        .limit(1);
      if(ruleErr)throw ruleErr;

      const rule=ruleRows?.[0]||null;
      const workDays=Array.isArray(doctor.work_days)?doctor.work_days:["Mon","Tue","Wed","Thu","Fri"];
      const working=rule?!!rule.is_working:workDays.includes(dayName(date));
      if(!working)return json({error:"The selected doctor does not work on that day."},400);

      const scheduleStart=time5(rule?.start_time||doctor.start_time||"08:00");
      const scheduleEnd=time5(rule?.end_time||doctor.end_time||"17:00");
      const slotDuration=Math.max(15,Number(rule?.slot_duration||doctor.slot_duration||60));
      const maxPatients=Math.max(1,Number(rule?.max_patients||20));
      const start=mins(scheduleStart),end=mins(scheduleEnd),t=mins(time);

      if(t<start||t+slotDuration>end)return json({error:"Selected appointment would extend outside the doctor's work schedule."},400);
      if((t-start)%slotDuration!==0)return json({error:"Selected time does not align with this doctor's appointment interval."},400);

      const {data:leave}=await admin.from("doctor_leaves").select("leave_id").eq("doctor_id",doctorId).eq("leave_date",date).maybeSingle();
      if(leave)return json({error:"The selected doctor is on leave on that date."},400);

      const {count:dailyCount,error:dailyErr}=await admin.from("appointments")
        .select("appointment_id",{count:"exact",head:true})
        .eq("doctor_id",doctorId)
        .eq("appointment_date",date)
        .neq("status","Cancelled")
        .neq("appointment_id",appointmentId||-1);
      if(dailyErr)throw dailyErr;
      if((dailyCount||0)>=maxPatients)return json({error:"The selected doctor has reached the maximum patient capacity for that date."},409);

      const {data:override}=await admin.from("appointment_slot_overrides")
        .select("is_available,reason").eq("doctor_id",doctorId).eq("override_date",date).eq("slot_time",time).maybeSingle();
      if(override&&override.is_available===false)
        return json({error:override.reason||"That time slot is unavailable."},409);

      const {data:settings}=await admin.from("system_settings")
        .select("lunch_start,lunch_end")
        .order("settings_id",{ascending:true})
        .limit(1)
        .maybeSingle();
      if(settings?.lunch_start&&settings?.lunch_end){
        const lunchStart=mins(settings.lunch_start),lunchEnd=mins(settings.lunch_end);
        // Staff/Admin may explicitly reopen a lunch-period slot for a specific
        // doctor/date. Without that positive override, lunch remains blocked.
        if(t<lunchEnd&&t+slotDuration>lunchStart&&override?.is_available!==true)
          return json({error:"That appointment overlaps the clinic lunch break."},400);
      }

      const {data:conflict}=await admin.from("appointments")
        .select("appointment_id")
        .eq("doctor_id",doctorId).eq("appointment_date",date).eq("appointment_time",time)
        .neq("status","Cancelled")
        .maybeSingle();
      if(conflict&&conflict.appointment_id!==appointmentId)return json({error:"That time slot is already booked."},409);

      const payload={
        patient_id:patientId,doctor_id:doctorId,clinic,service:serviceName,
        appointment_date:date,appointment_time:time,status:"Scheduled",
        priority:priority||null,reason:reason||null,
        created_by:existing?.created_by||actor.user_id
      };

      let saved:any,error:any;
      if(action==="create"){
        ({data:saved,error}=await admin.from("appointments").insert(payload).select("*").single());
      }else{
        ({data:saved,error}=await admin.from("appointments").update(payload).eq("appointment_id",appointmentId).select("*").single());
      }
      if(error)return json({error:error.code==="23505"?"That time slot is already booked.":error.message},409);

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:action==="create"?"APPOINTMENT_CREATED":"APPOINTMENT_RESCHEDULED",
        entity_type:"appointments",entity_id:saved.appointment_id,
        details:{patient_id:patientId,doctor_id:doctorId,date,time,clinic,service:serviceName}
      });
      await admin.from("notifications").insert({
        user_id:(await admin.from("patients").select("user_id").eq("patient_id",patientId).single()).data?.user_id,
        title:action==="create"?"Appointment confirmed":"Appointment rescheduled",
        message:`${clinic} appointment on ${date} at ${time}. Please bring your COR when you arrive at the clinic.`,
        type:"Appointment",
        channel:"In-app",
        delivery_status:"Created",
        reference_type:"appointments",
        reference_id:saved.appointment_id,
        action_page:"my-appointments"
      });

      return json({ok:true,appointment:saved});
    }

    if(action==="cancel"){
      const id=Number(body.appointment_id||0);
      const appt=await loadAppointment(id);
      if(!appt)return json({error:"Appointment not found."},404);
      let allowed=canManageAll;
      if(actor.role==="Patient")allowed=appt.patient_id===await actorPatientId();
      if(!allowed)return json({error:"You cannot cancel this appointment."},403);
      if(!OPEN.includes(appt.status))return json({error:`This appointment is already ${String(appt.status).toLowerCase()}.`},409);
      if(hasStarted(appt))return json({error:"This appointment time has passed. Record the outcome instead of cancelling it."},409);

      const reason=String(body.reason||"").trim().slice(0,500);
      const {error}=await admin.from("appointments").update({
        status:"Cancelled",cancelled_at:new Date().toISOString(),cancellation_reason:reason||null
      }).eq("appointment_id",id);
      if(error)throw error;
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"APPOINTMENT_CANCELLED",entity_type:"appointments",entity_id:id,details:{reason:reason||null}});

      const {data:patientUser}=await admin.from("patients")
        .select("user_id").eq("patient_id",appt.patient_id).maybeSingle();
      if(patientUser?.user_id){
        await admin.from("notifications").insert({
          user_id:patientUser.user_id,
          title:"Appointment cancelled",
          message:`${appt.clinic||"Clinic"} appointment on ${appt.appointment_date} at ${time5(appt.appointment_time)} was cancelled.${reason?" Reason: "+reason:""}`,
          type:"Appointment",
          channel:"In-app",
          delivery_status:"Created",
          reference_type:"appointments",
          reference_id:id,
          action_page:"my-appointments"
        });
      }

      return json({ok:true});
    }

    if(action==="status"){
      const id=Number(body.appointment_id||0);
      const status=String(body.status||"");
      if(!["Completed","No-show","Scheduled"].includes(status))return json({error:"Invalid appointment status."},400);
      const appt=await loadAppointment(id);
      if(!appt)return json({error:"Appointment not found."},404);
      const allowed=canManageAll||(actor.role==="Doctor"&&appt.doctor_id===actor.user_id);
      if(!allowed)return json({error:"You cannot update this appointment."},403);
      // Outcomes apply to open bookings only. A visit can be completed from its day onward (patients may
      // arrive early); a no-show only once the appointment time has passed.
      if(status!=="Scheduled"){
        if(!OPEN.includes(appt.status))return json({error:`This appointment is already ${String(appt.status).toLowerCase()}.`},409);
        if(status==="Completed"&&appt.appointment_date>manilaNow().date)return json({error:"A future appointment cannot be completed yet."},409);
        if(status==="No-show"&&!hasStarted(appt))return json({error:"A no-show can be recorded once the appointment time has passed."},409);
      }
      const {error}=await admin.from("appointments").update({status}).eq("appointment_id",id);
      if(error)throw error;
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:`APPOINTMENT_${status.toUpperCase().replace("-","_")}`,entity_type:"appointments",entity_id:id,details:{}});
      return json({ok:true});
    }

    // In-app reminder to the patient, at most once per appointment every 12 hours.
    if(action==="remind"){
      const id=Number(body.appointment_id||0);
      const appt=await loadAppointment(id);
      if(!appt)return json({error:"Appointment not found."},404);
      const allowed=canManageAll||(actor.role==="Doctor"&&appt.doctor_id===actor.user_id);
      if(!allowed)return json({error:"You cannot send reminders for this appointment."},403);
      if(!OPEN.includes(appt.status)||hasStarted(appt))return json({error:"Reminders can only be sent for upcoming scheduled appointments."},409);

      const {data:patientUser}=await admin.from("patients").select("user_id").eq("patient_id",appt.patient_id).maybeSingle();
      if(!patientUser?.user_id)return json({error:"This patient has no CampusCare account to notify."},400);

      const since=new Date(Date.now()-12*60*60*1000).toISOString();
      const {count:recent,error:recentErr}=await admin.from("notifications")
        .select("notification_id",{count:"exact",head:true})
        .eq("user_id",patientUser.user_id)
        .eq("reference_type","appointments").eq("reference_id",id)
        .eq("title","Appointment reminder")
        .gte("created_at",since);
      if(recentErr)throw recentErr;
      if((recent||0)>0)return json({error:"A reminder for this appointment was already sent in the last 12 hours."},429);

      const {error:notifyErr}=await admin.from("notifications").insert({
        user_id:patientUser.user_id,
        title:"Appointment reminder",
        message:`Reminder: ${appt.clinic||"Clinic"} appointment on ${appt.appointment_date} at ${time5(appt.appointment_time)}. Please bring your COR when you arrive at the clinic.`,
        type:"Appointment",
        channel:"In-app",
        delivery_status:"Created",
        reference_type:"appointments",
        reference_id:id,
        action_page:"my-appointments"
      });
      if(notifyErr)throw notifyErr;
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"APPOINTMENT_REMINDER_SENT",entity_type:"appointments",entity_id:id,details:{}});
      return json({ok:true});
    }

    if(action==="manage_slots"){
      if(!canManageAll)return json({error:"Staff or Administrator access required."},403);
      const doctorId=Number(body.doctor_id||0);
      const date=String(body.date||"");
      const slots=Array.isArray(body.slots)?body.slots:[];
      if(!doctorId||!date)return json({error:"Doctor and date are required."},400);

      await admin.from("appointment_slot_overrides").delete().eq("doctor_id",doctorId).eq("override_date",date);
      if(slots.length){
        const rows=slots.map((s:any)=>({
          doctor_id:doctorId,override_date:date,slot_time:time5(String(s.time||"")),
          is_available:!!s.is_available,reason:String(s.reason||"").slice(0,255)||null,modified_by:actor.user_id
        })).filter((r:any)=>r.slot_time);
        if(rows.length){
          const {error}=await admin.from("appointment_slot_overrides").insert(rows);
          if(error)throw error;
        }
      }
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"APPOINTMENT_SLOTS_UPDATED",entity_type:"users",entity_id:doctorId,details:{date,count:slots.length}});
      return json({ok:true});
    }

    return json({error:"Unsupported appointment action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Appointment action failed."},500);
  }
});
