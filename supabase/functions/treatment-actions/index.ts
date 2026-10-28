import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Clinical notes are written only by the treating doctor, under their own name.
// Only that doctor can archive or restore them; other roles cannot read or change visit notes.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=4000)=>String(v??"").trim().slice(0,max);
const manilaToday=()=>new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
const dentalPayload=(raw:any,treatmentId:number,patientId:number,dentistId:number,dentistName:string)=>({
  treatment_id:treatmentId,
  patient_id:patientId,
  dentist_user_id:dentistId,
  dentist_name_snapshot:clean(raw?.dentist_name_snapshot||dentistName,255)||dentistName,
  record_date:String(raw?.record_date||manilaToday()),
  course_major:clean(raw?.course_major,180)||null,
  year_section:clean(raw?.year_section,120)||null,
  messenger_account:clean(raw?.messenger_account,180)||null,
  cell_no:clean(raw?.cell_no,80)||null,
  odontogram:raw?.odontogram&&typeof raw.odontogram==="object"?raw.odontogram:{},
  oral_health:raw?.oral_health&&typeof raw.oral_health==="object"?raw.oral_health:{},
  accomplishment:Array.isArray(raw?.accomplishment)?raw.accomplishment.slice(0,80):[],
  work_status:["Completed","In Progress","No Dental Work Necessary"].includes(String(raw?.work_status||""))
    ? String(raw.work_status):null,
  recommendation:clean(raw?.recommendation,5000)||null,
  updated_at:new Date().toISOString()
});

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

    const body=await req.json();
    const action=String(body.action||"").toLowerCase();

    if(action==="create"){
      if(actor.role!=="Doctor")
        return json({error:"Only the treating doctor can record clinical notes."},403);

      const patientId=Number(body.patient_id||0);
      const appointmentId=body.appointment_id?Number(body.appointment_id):null;
      const treatmentDate=String(body.treatment_date||"");
      const findings=clean(body.examination_findings,5000);
      const diagnosis=clean(body.diagnosis,3000);
      const prescription=clean(body.prescription,4000);
      const notes=clean(body.clinical_notes,5000);
      const imagingNotes=clean(body.imaging_notes,2000);
      const followUpDate=body.follow_up_date?String(body.follow_up_date):null;
      const vitals=body.vitals&&typeof body.vitals==="object"?body.vitals:{};

      if(!patientId||!treatmentDate||!findings||!diagnosis)
        return json({error:"Patient, treatment date, findings, and diagnosis are required."},400);

      const today=manilaToday();
      if(treatmentDate>today)return json({error:"A treatment record cannot be dated in the future."},400);
      if(followUpDate&&followUpDate<=treatmentDate)
        return json({error:"The follow-up must be after the visit date."},400);

      const {data:patient}=await admin.from("patients")
        .select("patient_id,user_id")
        .eq("patient_id",patientId).maybeSingle();
      if(!patient)return json({error:"Patient record not found."},404);

      const doctorId=actor.user_id;

      let appointment:any=null;
      if(appointmentId){
        const {data:appt}=await admin.from("appointments")
          .select("appointment_id,patient_id,doctor_id,appointment_date,status,clinic,service")
          .eq("appointment_id",appointmentId).maybeSingle();
        if(!appt)return json({error:"Linked appointment not found."},404);
        if(appt.patient_id!==patientId)return json({error:"The appointment belongs to a different patient."},400);
        if(appt.doctor_id!==doctorId)return json({error:"The appointment belongs to a different doctor."},400);
        if(appt.appointment_date>today)return json({error:"Future appointments cannot be completed yet."},400);
        if(appt.status==="Cancelled"||appt.status==="No-show")
          return json({error:"Cancelled or no-show appointments cannot receive a treatment record."},400);

        const {data:existing}=await admin.from("treatments")
          .select("treatment_id")
          .eq("appointment_id",appointmentId).maybeSingle();
        if(existing)return json({error:"This appointment already has a treatment record."},409);
        appointment=appt;
      }

      const payload={
        patient_id:patientId,
        doctor_id:doctorId,
        appointment_id:appointmentId,
        examination_findings:findings,
        diagnosis,
        prescription:prescription||null,
        clinical_notes:notes||null,
        vitals,
        imaging_notes:imagingNotes||null,
        treatment_date:treatmentDate,
        follow_up_date:followUpDate||null,
        status:"Active"
      };

      const {data:treatment,error:insertErr}=await admin.from("treatments")
        .insert(payload).select("*").single();
      if(insertErr){
        if(insertErr.code==="23505")return json({error:"This appointment already has a treatment record."},409);
        throw insertErr;
      }

      const dentalRecord=body.dental_record&&typeof body.dental_record==="object"?body.dental_record:null;
      const dentalContext=String(body.clinic_type||appointment?.clinic||"");
      if(dentalRecord&&dentalContext==="Dental Clinic"){
        const dentistName=`Dr. ${actor.first_name||""} ${actor.last_name||""}`.trim();
        const record=dentalPayload(dentalRecord,treatment.treatment_id,patientId,doctorId,dentistName);
        const {error:dentalErr}=await admin.from("dental_records").insert(record);
        if(dentalErr)throw dentalErr;
      }

      if(appointmentId){
        const {error:apptErr}=await admin.from("appointments")
          .update({status:"Completed"})
          .eq("appointment_id",appointmentId);
        if(apptErr)throw apptErr;
      }

      const medicationName=clean(body.medication_name,255);
      const dosage=clean(body.dosage,255);
      const frequency=clean(body.frequency,255);
      const medicationEnd=body.medication_end_date?String(body.medication_end_date):null;

      if(medicationName&&medicationEnd){
        await admin.from("medication_reminders").insert({
          patient_id:patientId,
          medication:medicationName,
          dosage:dosage||null,
          frequency:frequency||null,
          times_of_day:Array.isArray(body.times_of_day)?body.times_of_day:["08:00","14:00","20:00"],
          start_date:treatmentDate,
          end_date:medicationEnd,
          active:true
        });
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"TREATMENT_CREATED",
        entity_type:"treatments",
        entity_id:treatment.treatment_id,
        details:{
          patient_id:patientId,
          doctor_id:doctorId,
          appointment_id:appointmentId,
          diagnosis
        }
      });

      await admin.from("notifications").insert({
        user_id:patient.user_id,
        title:"Treatment Record Added",
        message:appointmentId
          ?"Your clinician completed your appointment and added treatment notes to your CampusCare health record."
          :"A new treatment record was added to your CampusCare health record.",
        type:"Treatment",
        channel:"In-app",
        delivery_status:"Created"
      });

      if(appointmentId&&dentalContext==="Dental Clinic"){
        await admin.from("notifications").insert({
          user_id:patient.user_id,
          title:"Dental Clinic Survey Available",
          message:"Your dental visit is complete. You can now share feedback about the service you received.",
          type:"Survey",
          channel:"In-app",
          delivery_status:"Created",
          reference_type:"appointment",
          reference_id:appointmentId,
          action_page:"dental-survey",
          notification_key:`dental-survey-${appointmentId}`
        });
      }

      return json({ok:true,treatment,dental_record_created:Boolean(dentalRecord&&dentalContext==="Dental Clinic")});
    }

    if(action==="save_dental_record"){
      if(actor.role!=="Doctor")
        return json({error:"Only the treating dentist can save a dental record."},403);

      const treatmentId=Number(body.treatment_id||0);
      if(!treatmentId)return json({error:"Treatment ID is required."},400);

      const {data:treatment}=await admin.from("treatments")
        .select("treatment_id,patient_id,doctor_id,status")
        .eq("treatment_id",treatmentId)
        .maybeSingle();
      if(!treatment)return json({error:"Treatment record not found."},404);
      if(Number(treatment.doctor_id)!==Number(actor.user_id))
        return json({error:"This dental treatment belongs to a different clinician."},403);

      const dentistId=Number(treatment.doctor_id);
      const dentistName=`Dr. ${actor.first_name||""} ${actor.last_name||""}`.trim();
      const record=dentalPayload(body.dental_record||{},treatmentId,Number(treatment.patient_id),dentistId,dentistName);

      const {data:saved,error:saveErr}=await admin.from("dental_records")
        .upsert(record,{onConflict:"treatment_id"})
        .select("*")
        .single();
      if(saveErr)throw saveErr;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"DENTAL_RECORD_SAVED",
        entity_type:"dental_records",
        entity_id:saved.dental_record_id,
        details:{treatment_id:treatmentId,patient_id:treatment.patient_id}
      });

      return json({ok:true,dental_record:saved});
    }

    // Visit notes are clinical records: only the doctor who wrote one can archive or restore it.
    if(action==="archive"||action==="restore"){
      if(actor.role!=="Doctor")
        return json({error:"Only the treating doctor can archive or restore a treatment record."},403);

      const treatmentId=Number(body.treatment_id||0);
      if(!treatmentId)return json({error:"Treatment ID is required."},400);

      const {data:existing}=await admin.from("treatments")
        .select("treatment_id,status,doctor_id")
        .eq("treatment_id",treatmentId).maybeSingle();
      if(!existing)return json({error:"Treatment record not found."},404);
      if(Number(existing.doctor_id)!==Number(actor.user_id))
        return json({error:"Only the treating doctor can archive or restore a treatment record."},403);

      const patch=action==="archive"
        ? {status:"Archived",archived_at:new Date().toISOString(),archived_by:actor.user_id}
        : {status:"Active",archived_at:null,archived_by:null};

      const {error:updateErr}=await admin.from("treatments")
        .update(patch).eq("treatment_id",treatmentId);
      if(updateErr)throw updateErr;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:action==="archive"?"TREATMENT_ARCHIVED":"TREATMENT_RESTORED",
        entity_type:"treatments",
        entity_id:treatmentId,
        details:{previous_status:existing.status,new_status:patch.status}
      });

      return json({ok:true,status:patch.status});
    }

    return json({error:"Unsupported treatment action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Treatment action failed."},500);
  }
});
