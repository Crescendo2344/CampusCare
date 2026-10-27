import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Fitness-to-compete assessments are created and recorded by doctors only.
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
      .select("user_id,role,status")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(actorErr||!actor||actor.status!=="Active")
      return json({error:"Active CampusCare account required."},403);

    const body=await req.json();
    const action=String(body.action||"").toLowerCase();

    const ownPatientId=async()=>{
      const {data}=await admin.from("patients")
        .select("patient_id")
        .eq("user_id",actor.user_id)
        .maybeSingle();
      return data?.patient_id||null;
    };

    if(action==="create"){
      // Fitness-to-compete is handled by doctors only; requests are no longer taken from other roles.
      if(actor.role!=="Doctor")
        return json({error:"Fitness assessments are handled by the clinic doctor."},403);
      const patientId=Number(body.patient_id||0);

      const sportEvent=clean(body.sport_event,255);
      const eventDate=body.event_date?String(body.event_date):null;
      const notes=clean(body.request_notes,1500);

      if(!patientId||!sportEvent)
        return json({error:"Patient and sport/event are required."},400);

      const {data:patient}=await admin.from("patients")
        .select("patient_id,user_id")
        .eq("patient_id",patientId)
        .maybeSingle();

      if(!patient)return json({error:"Patient record not found."},404);

      const {data:row,error}=await admin.from("fitness_assessments")
        .insert({
          patient_id:patientId,
          sport_event:sportEvent,
          event_date:eventDate,
          request_notes:notes||null,
          status:"Requested"
        })
        .select("*")
        .single();

      if(error)throw error;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"FITNESS_ASSESSMENT_REQUESTED",
        entity_type:"fitness_assessments",
        entity_id:row.assessment_id,
        details:{patient_id:patientId,sport_event:sportEvent,event_date:eventDate}
      });

      return json({ok:true,assessment:row});
    }

    if(action==="cancel"){
      if(actor.role!=="Patient")
        return json({error:"Only the patient can cancel their pending request."},403);

      const assessmentId=Number(body.assessment_id||0);
      const patientId=Number(await ownPatientId()||0);

      const {data:row}=await admin.from("fitness_assessments")
        .select("assessment_id,patient_id,status")
        .eq("assessment_id",assessmentId)
        .maybeSingle();

      if(!row||row.patient_id!==patientId)
        return json({error:"Fitness assessment request not found."},404);

      if(row.status!=="Requested")
        return json({error:"Only requested assessments can be cancelled."},400);

      const {error}=await admin.from("fitness_assessments")
        .update({status:"Cancelled",updated_at:new Date().toISOString()})
        .eq("assessment_id",assessmentId);

      if(error)throw error;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"FITNESS_ASSESSMENT_CANCELLED",
        entity_type:"fitness_assessments",
        entity_id:assessmentId,
        details:{}
      });

      return json({ok:true});
    }

    if(action==="assess"){
      if(actor.role!=="Doctor")
        return json({error:"Only the assessing doctor can record a fitness assessment."},403);

      const assessmentId=Number(body.assessment_id||0);
      const patientId=Number(body.patient_id||0);
      const sportEvent=clean(body.sport_event,255);
      const eventDate=body.event_date?String(body.event_date):null;
      const assessmentDate=body.assessment_date?String(body.assessment_date):null;
      const medicalHistory=clean(body.medical_history,5000);
      const cardio=clean(body.cardio_respiratory_findings,5000);
      const exam=clean(body.examination_findings,5000);
      const decision=clean(body.decision,100);
      const restrictions=clean(body.restrictions,3000);
      const requestNotes=clean(body.request_notes,1500);
      const vitals=body.vitals&&typeof body.vitals==="object"?body.vitals:{};

      if(!patientId||!sportEvent||!assessmentDate)
        return json({error:"Patient, sport/event, and assessment date are required."},400);

      if(assessmentDate>manilaToday())
        return json({error:"Assessment date cannot be in the future."},400);

      const allowedDecisions=["","Fit to Compete","Fit with Restrictions","Not Fit to Compete"];
      if(!allowedDecisions.includes(decision))
        return json({error:"Invalid fitness decision."},400);
      if(decision&&!exam)
        return json({error:"Record the examination findings before making a decision."},400);
      if((decision==="Fit with Restrictions"||decision==="Not Fit to Compete")&&!restrictions)
        return json({error:"Give the restrictions or the reason for the decision."},400);

      const {data:patient}=await admin.from("patients")
        .select("patient_id,user_id")
        .eq("patient_id",patientId)
        .maybeSingle();

      if(!patient)return json({error:"Patient record not found."},404);

      const doctorId=actor.user_id;
      const status=decision?"Completed":"In Assessment";
      const now=new Date().toISOString();

      let saved:any=null;

      if(assessmentId){
        const {data:existing}=await admin.from("fitness_assessments")
          .select("assessment_id,patient_id,doctor_id,status")
          .eq("assessment_id",assessmentId)
          .maybeSingle();

        if(!existing)return json({error:"Fitness assessment not found."},404);
        if(existing.patient_id!==patientId)
          return json({error:"The assessment belongs to a different patient."},400);
        if(existing.status==="Cancelled")
          return json({error:"Cancelled requests cannot be assessed."},400);
        if(existing.doctor_id&&existing.doctor_id!==actor.user_id)
          return json({error:"This assessment is assigned to another doctor."},403);

        const {data,error}=await admin.from("fitness_assessments")
          .update({
            doctor_id:doctorId,
            sport_event:sportEvent,
            event_date:eventDate,
            assessment_date:assessmentDate,
            vitals,
            medical_history:medicalHistory||null,
            cardio_respiratory_findings:cardio||null,
            examination_findings:exam||null,
            decision:decision||null,
            restrictions:restrictions||null,
            request_notes:requestNotes||null,
            status,
            completed_at:decision?now:null,
            updated_at:now
          })
          .eq("assessment_id",assessmentId)
          .select("*")
          .single();

        if(error)throw error;
        saved=data;
      }else{
        const {data,error}=await admin.from("fitness_assessments")
          .insert({
            patient_id:patientId,
            doctor_id:doctorId,
            sport_event:sportEvent,
            event_date:eventDate,
            assessment_date:assessmentDate,
            vitals,
            medical_history:medicalHistory||null,
            cardio_respiratory_findings:cardio||null,
            examination_findings:exam||null,
            decision:decision||null,
            restrictions:restrictions||null,
            request_notes:requestNotes||null,
            status,
            completed_at:decision?now:null,
            updated_at:now
          })
          .select("*")
          .single();

        if(error)throw error;
        saved=data;
      }

      if(decision){
        await admin.from("notifications").insert({
          user_id:patient.user_id,
          title:"Fitness-to-Compete Assessment Completed",
          message:`Your fitness assessment for ${sportEvent} is complete. Decision: ${decision}.`,
          type:"Fitness",
          channel:"In-app",
          delivery_status:"Created"
        });
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:decision?"FITNESS_ASSESSMENT_COMPLETED":"FITNESS_ASSESSMENT_UPDATED",
        entity_type:"fitness_assessments",
        entity_id:saved.assessment_id,
        details:{
          patient_id:patientId,
          doctor_id:doctorId,
          sport_event:sportEvent,
          decision:decision||null,
          status
        }
      });

      return json({ok:true,assessment:saved});
    }

    return json({error:"Unsupported fitness assessment action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Fitness assessment action failed."},500);
  }
});
