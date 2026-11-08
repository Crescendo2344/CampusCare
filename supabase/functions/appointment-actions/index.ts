import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {CLINIC_SERVICES,clinicForSpecialization,doctorRendersService} from "../_shared/clinic-services.js";

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
// Notification wording is shared with the email template and the automatic reminder job.
const prettyDate=(d:string)=>new Date(d+"T00:00:00Z").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
const prettyTime=(t:string)=>{const [h,m]=time5(t).split(":").map(Number);return `${h%12||12}:${String(m||0).padStart(2,"0")} ${h<12?"AM":"PM"}`;};
// "1st Semester, SY 2026–2027" from the clinic's semester dates; July–December is the 1st Semester otherwise.
const semesterLabel=(day:string,s:any)=>{
  const within=(a:string,b:string)=>a&&b&&day>=a&&day<=b;
  if(within(s?.semester_start,s?.semester_end)){const y=Number(String(s.semester_start).slice(0,4));return `1st Semester, SY ${y}–${y+1}`;}
  if(within(s?.semester2_start,s?.semester2_end)){const y=s?.semester_start?Number(String(s.semester_start).slice(0,4)):Number(String(s.semester2_start).slice(0,4))-1;return `2nd Semester, SY ${y}–${y+1}`;}
  const y=Number(day.slice(0,4)),m=Number(day.slice(5,7));
  return m>=7?`1st Semester, SY ${y}–${y+1}`:`2nd Semester, SY ${y-1}–${y}`;
};
const PERSONNEL=["Teaching Personnel","Non-Teaching Personnel"];
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
    // Staff oversee every booking; administrators handle accounts only.
    const canManageAll=actor.role==="Staff";
    // The patient's account and what they should bring: a signed COR for students, an Employee ID for personnel.
    const patientAccount=async(patientId:number)=>{
      const {data:p}=await admin.from("patients").select("user_id").eq("patient_id",patientId).maybeSingle();
      if(!p?.user_id)return null;
      const {data:u}=await admin.from("users").select("user_id,person_type").eq("user_id",p.user_id).maybeSingle();
      return u||null;
    };
    const bringLine=async(personType:string|null,date:string)=>{
      if(PERSONNEL.includes(String(personType||"")))return "Bring your Employee ID.";
      const {data:s}=await admin.from("system_settings").select("semester_start,semester_end,semester2_start,semester2_end").order("settings_id",{ascending:true}).limit(1).maybeSingle();
      return `Bring your signed COR for ${semesterLabel(date,s)} and your Student ID.`;
    };
    const visitLine=(clinic:string,date:string,time:string)=>`${clinic||"Clinic"} · ${prettyDate(date)} at ${prettyTime(time)}`;

    // create: a new booking. reschedule: the patient or front desk moves it. reappoint: the visit cannot
    // push through, so the doctor or front desk proposes a new time and the patient accepts or picks another.
    if(action==="create"||action==="reschedule"||action==="reappoint"){
      const appointmentId=Number(body.appointment_id||0);
      const existing=action!=="create"?await loadAppointment(appointmentId):null;
      if(action!=="create"&&!existing)return json({error:"Appointment not found."},404);
      if(action!=="create"&&!OPEN.includes(existing.status))return json({error:"Only scheduled appointments can be moved."},409);
      const reappoint=action==="reappoint";
      if(reappoint&&!(actor.role==="Staff"||(actor.role==="Doctor"&&existing.doctor_id===actor.user_id)))
        return json({error:"Only the doctor of this appointment or the front desk can propose a new time."},403);

      let patientId=Number(body.patient_id||existing?.patient_id||0);
      if(reappoint){
        patientId=existing.patient_id;
      }else if(actor.role==="Patient"){
        const own=await actorPatientId();
        if(!own)return json({error:"Patient record not found."},400);
        if(action==="reschedule"&&existing?.patient_id!==own)return json({error:"You may only reschedule your own appointment."},403);
        patientId=own;
      }else if(!canManageAll){
        return json({error:"Only patients and clinic staff may book or reschedule appointments."},403);
      }

      // A doctor proposing a new time keeps the visit with themselves.
      const doctorId=reappoint&&actor.role==="Doctor"?existing.doctor_id:Number(body.doctor_id||existing?.doctor_id||0);
      const clinic=String(body.clinic||existing?.clinic||"Medical Clinic");
      const serviceName=String(body.service||existing?.service||"").trim();
      const date=String(body.appointment_date||"");
      const time=time5(String(body.appointment_time||""));
      // The chief complaint is part of the booking; moving a booking keeps the one already given.
      const reason=(String(body.reason||"").trim()||String(existing?.reason||"")).slice(0,1000);
      const priority=String(body.priority||existing?.priority||"").trim().slice(0,30);
      const apology=String(body.reappoint_reason||"").trim().slice(0,500);

      if(!patientId||!doctorId||!serviceName||!date||!time)return json({error:"Patient, doctor, service, date, and time are required."},400);
      if(reason.length<3)return json({error:"Describe the complaint or reason for the visit.",field_errors:{reason:"Describe the complaint or reason for the visit."}},400);
      if(reappoint&&apology.length<3)return json({error:"Tell the patient briefly why the visit cannot push through."},400);
      if(reappoint&&date===existing.appointment_date&&time5(existing.appointment_time)===time)return json({error:"Choose a different date or time."},400);

      const today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
      if(date<today)return json({error:"Appointments cannot be booked in the past."},400);
      if(date===today){
        const now=new Date();
        const nowMin=now.getUTCHours()*60+now.getUTCMinutes()+8*60;
        const phMin=((nowMin%1440)+1440)%1440;
        if(mins(time)<=phMin)return json({error:"That time has already passed."},400);
      }

      const {data:clinicSettings}=await admin.from("system_settings")
        .select("booking_lead_hours,dental_visit_limit_per_semester,semester_start,semester_end,semester2_start,semester2_end")
        .order("settings_id",{ascending:true}).limit(1).maybeSingle();
      // Patients book ahead by the clinic's lead time; slots inside it stay open for reappointments.
      if(actor.role==="Patient"){
        const leadHours=Math.max(0,Number(clinicSettings?.booking_lead_hours??24));
        const slotStart=new Date(`${date}T${time}:00+08:00`).getTime();
        if(slotStart<Date.now()+leadHours*3600*1000)
          return json({error:`Book at least ${leadHours} hour${leadHours===1?"":"s"} ahead. Earlier slots are kept for clinic reappointments.`},409);
      }
      // Dental Clinic: a semester allows a set number of completed visits, and one open dental booking at a time.
      // Only completed visits count; cancelled, no-show and upcoming bookings do not use up the limit.
      if(clinic==="Dental Clinic"&&!reappoint){
        const semester=[[clinicSettings?.semester_start,clinicSettings?.semester_end],[clinicSettings?.semester2_start,clinicSettings?.semester2_end]].find(([a,b])=>a&&b&&date>=a&&date<=b);
        if(semester){
          const {count:completed}=await admin.from("appointments").select("appointment_id",{count:"exact",head:true})
            .eq("patient_id",patientId).eq("clinic","Dental Clinic").eq("status","Completed")
            .gte("appointment_date",semester[0]).lte("appointment_date",semester[1]);
          const limit=Math.max(1,Number(clinicSettings?.dental_visit_limit_per_semester||1));
          if((completed||0)>=limit)return json({error:`The Dental Clinic limit of ${limit} completed visit${limit===1?"":"s"} this semester has been reached.`},409);
        }
        const {data:openDental}=await admin.from("appointments").select("appointment_id")
          .eq("patient_id",patientId).eq("clinic","Dental Clinic").in("status",OPEN)
          .neq("appointment_id",appointmentId||-1).limit(1);
        if(openDental?.length)return json({error:"There is already an upcoming Dental Clinic appointment. Finish or cancel it first."},409);
      }

      const {data:doctor}=await admin.from("users")
        .select("user_id,role,status,work_days,start_time,end_time,slot_duration,specialty,services_rendered")
        .eq("user_id",doctorId).maybeSingle();
      if(!doctor||doctor.role!=="Doctor"||doctor.status!=="Active")return json({error:"Selected doctor is unavailable."},400);
      if(clinicForSpecialization(doctor.specialty||"General Medicine")!==clinic)return json({error:"That doctor works in the other clinic."},400);
      if(!(CLINIC_SERVICES[clinic]||[]).includes(serviceName))return json({error:"Choose a service offered by this clinic."},400);
      if(!doctorRendersService(doctor,serviceName))return json({error:"The selected doctor does not render that service. Choose another doctor or service."},400);

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

      const {data:override}=await admin.from("appointment_slot_overrides")
        .select("is_available,reason").eq("doctor_id",doctorId).eq("override_date",date).eq("slot_time",time).maybeSingle();
      if(override&&override.is_available===false)
        return json({error:override.reason||"That time slot is unavailable."},409);
      // A time staff explicitly opened for this date (a custom time) is valid even off the regular grid.
      const openedByStaff=override?.is_available===true;
      if(!openedByStaff&&(t<start||t+slotDuration>end))return json({error:"Selected appointment would extend outside the doctor's work schedule."},400);
      if(!openedByStaff&&(t-start)%slotDuration!==0)return json({error:"Selected time does not align with this doctor's appointment interval."},400);

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

      const payload:any={
        patient_id:patientId,doctor_id:doctorId,clinic,service:serviceName,
        appointment_date:date,appointment_time:time,status:"Scheduled",
        priority:priority||null,reason:reason||null,
        created_by:existing?.created_by||actor.user_id,
        // A reappointment waits for the patient's answer; any other move settles it.
        ...(reappoint?{
          patient_response:"Awaiting",
          reappoint_from_date:existing.patient_response==="Awaiting"&&existing.reappoint_from_date?existing.reappoint_from_date:existing.appointment_date,
          reappoint_from_time:existing.patient_response==="Awaiting"&&existing.reappoint_from_time?existing.reappoint_from_time:existing.appointment_time,
          reappoint_reason:apology,reappointed_by:actor.user_id,reappointed_at:new Date().toISOString()
        }:{patient_response:existing?.patient_response?null:undefined})
      };
      if(payload.patient_response===undefined)delete payload.patient_response;

      let saved:any,error:any;
      if(action==="create"){
        ({data:saved,error}=await admin.from("appointments").insert(payload).select("*").single());
      }else{
        ({data:saved,error}=await admin.from("appointments").update(payload).eq("appointment_id",appointmentId).select("*").single());
      }
      if(error)return json({error:error.code==="23505"?"That time slot is already booked.":error.message},409);

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:action==="create"?"APPOINTMENT_CREATED":reappoint?"APPOINTMENT_REAPPOINTED":"APPOINTMENT_RESCHEDULED",
        entity_type:"appointments",entity_id:saved.appointment_id,
        details:{patient_id:patientId,doctor_id:doctorId,date,time,clinic,service:serviceName}
      });
      const account=await patientAccount(patientId);
      if(account)await admin.from("notifications").insert({
        user_id:account.user_id,
        title:action==="create"?"Appointment Confirmed":reappoint?"Appointment Will Not Push Through":"Appointment Rescheduled",
        message:reappoint
          ?`We apologize that your appointment on ${prettyDate(existing.appointment_date)}, ${prettyTime(existing.appointment_time)} will not push through. ${apology.replace(/[.\s]*$/,"")}. The clinic proposes ${visitLine(clinic,date,time)} instead. Please accept the new time or pick another time in CampusCare.`
          :`${visitLine(clinic,date,time)}. ${await bringLine(account.person_type,date)}`,
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
      // Patients may cancel their own booking. The clinic does not cancel: it returns the visit for
      // reappointment (action "reappoint") so the patient keeps a place.
      if(actor.role!=="Patient")return json({error:"The clinic does not cancel appointments. Propose a new time instead (return for reappointment)."},403);
      if(appt.patient_id!==await actorPatientId())return json({error:"You cannot cancel this appointment."},403);
      if(!OPEN.includes(appt.status))return json({error:`This appointment is already ${String(appt.status).toLowerCase()}.`},409);
      if(hasStarted(appt))return json({error:"This appointment time has passed. Record the outcome instead of cancelling it."},409);

      const reason=String(body.reason||"").trim().slice(0,500);
      const {error}=await admin.from("appointments").update({
        status:"Cancelled",cancelled_at:new Date().toISOString(),cancellation_reason:reason||null
      }).eq("appointment_id",id);
      if(error)throw error;
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"APPOINTMENT_CANCELLED",entity_type:"appointments",entity_id:id,details:{reason:reason||null}});

      const account=await patientAccount(appt.patient_id);
      if(account){
        await admin.from("notifications").insert({
          user_id:account.user_id,
          title:"Appointment Cancelled",
          message:`${visitLine(appt.clinic,appt.appointment_date,appt.appointment_time)} was cancelled.${reason?" Reason: "+reason:""}`,
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

    // Take back a cancellation made moments ago by the same person, if the slot is still free.
    if(action==="undo_cancel"){
      const id=Number(body.appointment_id||0);
      const appt=await loadAppointment(id);
      if(!appt)return json({error:"Appointment not found."},404);
      if(appt.status!=="Cancelled")return json({error:"This appointment is not cancelled."},409);
      const {data:log}=await admin.from("audit_logs").select("user_id")
        .eq("action","APPOINTMENT_CANCELLED").eq("entity_type","appointments").eq("entity_id",id)
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(Number(log?.user_id)!==Number(actor.user_id))return json({error:"Only the person who cancelled this appointment can undo it."},403);
      if(!appt.cancelled_at||Date.now()-new Date(appt.cancelled_at).getTime()>15*60*1000)
        return json({error:"This cancellation can no longer be undone. Book a new appointment instead."},409);
      if(hasStarted(appt))return json({error:"This appointment time has passed."},409);
      const {data:taken}=await admin.from("appointments").select("appointment_id")
        .eq("doctor_id",appt.doctor_id).eq("appointment_date",appt.appointment_date).eq("appointment_time",appt.appointment_time)
        .neq("status","Cancelled").neq("appointment_id",id).limit(1);
      if(taken?.length)return json({error:"Someone else has booked that time since, so the appointment can't be restored."},409);
      const {data:leave}=await admin.from("doctor_leaves").select("leave_id").eq("doctor_id",appt.doctor_id).eq("leave_date",appt.appointment_date).maybeSingle();
      if(leave)return json({error:"The doctor is now on leave that day, so the appointment can't be restored."},409);

      const {error}=await admin.from("appointments").update({status:"Scheduled",cancelled_at:null,cancellation_reason:null}).eq("appointment_id",id);
      if(error)throw error;
      // The patient's "cancelled" notice no longer applies.
      await admin.from("notifications").delete()
        .eq("reference_type","appointments").eq("reference_id",id).in("title",["Appointment Cancelled","Appointment cancelled"])
        .gte("created_at",new Date(new Date(appt.cancelled_at).getTime()-60000).toISOString());
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"APPOINTMENT_CANCEL_UNDONE",entity_type:"appointments",entity_id:id,details:{}});
      return json({ok:true});
    }

    // The patient answers a reappointment: accept the proposed time (picking another uses "reschedule").
    if(action==="accept_reappointment"){
      const id=Number(body.appointment_id||0);
      const appt=await loadAppointment(id);
      if(!appt)return json({error:"Appointment not found."},404);
      if(actor.role!=="Patient"||appt.patient_id!==await actorPatientId())return json({error:"You cannot answer for this appointment."},403);
      if(appt.patient_response!=="Awaiting"||!OPEN.includes(appt.status))return json({error:"There is no new time waiting for your answer."},409);
      const {error}=await admin.from("appointments").update({patient_response:"Accepted"}).eq("appointment_id",id);
      if(error)throw error;
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"APPOINTMENT_REAPPOINTMENT_ACCEPTED",entity_type:"appointments",entity_id:id,details:{}});
      if(appt.reappointed_by)await admin.from("notifications").insert({
        user_id:appt.reappointed_by,title:"New time accepted",
        message:`The patient accepted ${visitLine(appt.clinic,appt.appointment_date,appt.appointment_time)}.`,
        type:"Appointment",channel:"In-app",delivery_status:"Created",reference_type:"appointments",reference_id:id,action_page:"appointments"
      });
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

    // Reminder to the patient (in CampusCare and by email), at most once per appointment every 12 hours.
    // Sending reminders is the front desk's job: Staff only.
    if(action==="remind"){
      const id=Number(body.appointment_id||0);
      const appt=await loadAppointment(id);
      if(!appt)return json({error:"Appointment not found."},404);
      if(!canManageAll)return json({error:"Only clinic staff or an administrator can send appointment reminders."},403);
      if(!OPEN.includes(appt.status)||hasStarted(appt))return json({error:"Reminders can only be sent for upcoming scheduled appointments."},409);

      const patientUser=await patientAccount(appt.patient_id);
      if(!patientUser?.user_id)return json({error:"This patient has no CampusCare account to notify."},400);

      const since=new Date(Date.now()-12*60*60*1000).toISOString();
      const {count:recent,error:recentErr}=await admin.from("notifications")
        .select("notification_id",{count:"exact",head:true})
        .eq("user_id",patientUser.user_id)
        .eq("reference_type","appointments").eq("reference_id",id)
        .in("title",["Appointment Reminder","Appointment reminder"])
        .gte("created_at",since);
      if(recentErr)throw recentErr;
      if((recent||0)>0)return json({error:"A reminder for this appointment was already sent in the last 12 hours."},429);

      const {data:notice,error:notifyErr}=await admin.from("notifications").insert({
        user_id:patientUser.user_id,
        title:"Appointment Reminder",
        message:`${visitLine(appt.clinic,appt.appointment_date,appt.appointment_time)}. ${await bringLine(patientUser.person_type,appt.appointment_date)}`,
        type:"Appointment",
        channel:"In-app",
        delivery_status:"Created",
        reference_type:"appointments",
        reference_id:id,
        action_page:"my-appointments"
      }).select("notification_id").single();
      if(notifyErr)throw notifyErr;
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"APPOINTMENT_REMINDER_SENT",entity_type:"appointments",entity_id:id,details:{}});

      // The database queues the email; send the queue now instead of waiting for the 5-minute job.
      let email="none";
      const {data:queued}=await admin.from("email_outbox").select("email_id").eq("notification_id",notice.notification_id).maybeSingle();
      if(queued){
        email="queued";
        try{
          const {data:cfg}=await admin.from("email_dispatch_config").select("dispatch_key").eq("config_id",1).maybeSingle();
          if(cfg?.dispatch_key){
            const res=await fetch(`${url}/functions/v1/email-dispatch`,{method:"POST",headers:{"Content-Type":"application/json","X-Dispatch-Key":cfg.dispatch_key},body:JSON.stringify({action:"dispatch"}),signal:AbortSignal.timeout(8000)});
            const result=await res.json().catch(()=>({}));
            const {data:row}=await admin.from("email_outbox").select("status").eq("email_id",queued.email_id).maybeSingle();
            if(row?.status==="Sent")email="sent";
            else if(result?.configured===false)email="not_configured";
          }
        }catch{ /* The 5-minute job sends it if this attempt fails. */ }
      }
      return json({ok:true,email});
    }

    if(action==="manage_slots"){
      if(!canManageAll)return json({error:"Staff access required."},403);
      const doctorId=Number(body.doctor_id||0);
      const date=String(body.date||"");
      const slots=Array.isArray(body.slots)?body.slots:[];
      if(!doctorId||!date)return json({error:"Doctor and date are required."},400);

      await admin.from("appointment_slot_overrides").delete().eq("doctor_id",doctorId).eq("override_date",date);
      if(slots.length){
        const rows=slots.map((s:any)=>({
          doctor_id:doctorId,override_date:date,slot_time:time5(String(s.time||"")),
          is_available:!!s.is_available,reason:String(s.reason||"").slice(0,255)||null,modified_by:actor.user_id
        })).filter((r:any)=>/^\d{2}:\d{2}$/.test(r.slot_time));
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
