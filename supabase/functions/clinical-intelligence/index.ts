import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=6000)=>String(v??"").trim().slice(0,max);
const isoDate=(v:unknown)=>clean(v,10);

function ageFromBirthDate(date:string|null){
  if(!date)return null;
  const dob=new Date(date+"T00:00:00Z");
  if(Number.isNaN(dob.getTime()))return null;
  const now=new Date();
  let age=now.getUTCFullYear()-dob.getUTCFullYear();
  const md=now.getUTCMonth()-dob.getUTCMonth();
  if(md<0||(md===0&&now.getUTCDate()<dob.getUTCDate()))age--;
  return age>=0?age:null;
}
function fhirId(prefix:string,id:number|string){return prefix+"-"+String(id);}
function fhirGender(v:unknown){
  const g=clean(v,30).toLowerCase();
  return ["male","female","other","unknown"].includes(g)?g:"unknown";
}
function statusToAppointment(status:string){
  const s=status.toLowerCase();
  if(s==="completed")return "fulfilled";
  if(s==="cancelled")return "cancelled";
  if(s==="no-show")return "noshow";
  return "booked";
}

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
      .select("user_id,role,status,first_name,last_name")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(!actor||actor.status!=="Active")return json({error:"Active CampusCare account required."},403);

    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"copilot").toLowerCase();
    const patientId=Number(body.patient_id||0);
    const mode=String(body.mode||"preview").toLowerCase();

    if(!patientId)return json({error:"Patient ID is required."},400);
    if(!["copilot","fhir"].includes(action))return json({error:"Unsupported clinical intelligence action."},400);

    // Both views contain diagnoses, prescriptions and clinical notes. Treatments are doctor-only, so only
    // the patient's own doctors may use them (checked below); administrators and staff may not.
    if(actor.role!=="Doctor")
      return json({error:"Only the patient's doctor can open the clinical summary or export the record."},403);

    const {data:patient,error:patientErr}=await admin.from("patients")
      .select("patient_id,user_id,birth_date,sex,address,height_cm,weight_kg,medical_history,allergies,archived_at")
      .eq("patient_id",patientId)
      .maybeSingle();
    if(patientErr||!patient)return json({error:"Patient record not found."},404);
    if(patient.archived_at)return json({error:"Archived patient records are not available for this feature."},400);

    const {data:patientUser,error:patientUserErr}=await admin.from("users")
      .select("user_id,first_name,last_name,email,contact_number,status,person_type,college,id_number")
      .eq("user_id",patient.user_id)
      .maybeSingle();
    if(patientUserErr||!patientUser)return json({error:"Patient account record not found."},404);

    if(actor.role==="Doctor"){
      const [{count:apptCount},{count:treatmentCount}]=await Promise.all([
        admin.from("appointments")
          .select("appointment_id",{count:"exact",head:true})
          .eq("patient_id",patientId).eq("doctor_id",actor.user_id),
        admin.from("treatments")
          .select("treatment_id",{count:"exact",head:true})
          .eq("patient_id",patientId).eq("doctor_id",actor.user_id)
      ]);
      if((apptCount||0)+(treatmentCount||0)===0)
        return json({error:"This patient is not linked to your appointment or treatment history."},403);
    }

    const [apptRes,treatRes,certRes]=await Promise.all([
      admin.from("appointments")
        .select("appointment_id,patient_id,doctor_id,service,clinic,appointment_date,appointment_time,status,priority,reason,notes,created_at")
        .eq("patient_id",patientId)
        .order("appointment_date",{ascending:false})
        .order("appointment_time",{ascending:false}),
      admin.from("treatments")
        .select("treatment_id,patient_id,doctor_id,appointment_id,examination_findings,diagnosis,prescription,clinical_notes,vitals,imaging_notes,treatment_date,follow_up_date,status,archived_at,created_at")
        .eq("patient_id",patientId)
        .is("archived_at",null)
        .order("treatment_date",{ascending:false})
        .order("treatment_id",{ascending:false}),
      admin.from("medical_certificates")
        .select("certificate_id,patient_id,doctor_id,treatment_id,purpose,status,requested_at,issued_at,certificate_no")
        .eq("patient_id",patientId)
        .order("requested_at",{ascending:false})
    ]);
    if(apptRes.error)throw apptRes.error;
    if(treatRes.error)throw treatRes.error;
    if(certRes.error)throw certRes.error;

    const appointments=apptRes.data||[];
    const treatments=treatRes.data||[];
    const certificates=certRes.data||[];

    const doctorIds=[...new Set([
      ...appointments.map((a:any)=>Number(a.doctor_id)),
      ...treatments.map((t:any)=>Number(t.doctor_id)),
      ...certificates.map((c:any)=>Number(c.doctor_id||0))
    ].filter(Boolean))];

    const {data:doctors,error:doctorErr}=doctorIds.length
      ? await admin.from("users")
          .select("user_id,first_name,last_name,specialty")
          .in("user_id",doctorIds)
      : {data:[],error:null};
    if(doctorErr)throw doctorErr;
    const doctorMap=new Map((doctors||[]).map((d:any)=>[Number(d.user_id),d]));

    if(action==="copilot"){
      const latest=treatments[0]||null;
      const counts=new Map<string,number>();
      for(const t of treatments){
        const d=clean(t.diagnosis||"Unspecified",1000)||"Unspecified";
        counts.set(d,(counts.get(d)||0)+1);
      }
      const repeated=[...counts.entries()]
        .filter(([,n])=>n>1)
        .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));

      const alerts:any[]=[];
      const allergy=clean(patient.allergies,2000);
      const history=clean(patient.medical_history,3000);
      if(allergy&&allergy.toLowerCase()!=="none"){
        alerts.push({type:"danger",title:"Recorded allergy",detail:allergy});
      }
      if(history&&history.toLowerCase()!=="none"){
        alerts.push({type:"info",title:"Recorded medical history",detail:history});
      }

      const today=new Date().toISOString().slice(0,10);
      if(latest?.follow_up_date&&String(latest.follow_up_date)<today){
        alerts.push({
          type:"warning",
          title:"Recorded follow-up date has passed",
          detail:"The latest treatment record lists a follow-up date of "+String(latest.follow_up_date)+"."
        });
      }
      if(repeated.length){
        alerts.push({
          type:"warning",
          title:"Repeated diagnosis label in prior records",
          detail:repeated.slice(0,5).map(([d,n])=>d+" ("+n+"×)").join(", ")
        });
      }

      const age=ageFromBirthDate(patient.birth_date);
      const latestAppointment=appointments[0]||null;
      const summary=[
        (patientUser.first_name+" "+patientUser.last_name)+
          (age!==null?", "+age+" years old":"")+
          (patient.sex?", "+patient.sex:"")+".",
        "College/person type: "+(patientUser.college||"not recorded")+" / "+(patientUser.person_type||"not recorded")+".",
        "Allergies: "+(allergy||"none recorded")+". Medical history: "+(history||"none recorded")+".",
        treatments.length
          ? String(treatments.length)+" treatment record"+(treatments.length===1?"":"s")+" on file. Latest recorded diagnosis: "+clean(latest?.diagnosis||"Unspecified",500)+" on "+String(latest?.treatment_date||"")+"."
          : "No treatment records on file.",
        appointments.length
          ? String(appointments.length)+" appointment record"+(appointments.length===1?"":"s")+"; most recent status: "+String(latestAppointment?.status||"")+"."
          : "No appointment records on file."
      ].join(" ");

      const recentHistory=treatments.slice(0,5).map((t:any)=>{
        const doc:any=doctorMap.get(Number(t.doctor_id));
        const docName=doc?("Dr. "+doc.first_name+" "+doc.last_name):"Doctor";
        return String(t.treatment_date)+" — "+clean(t.diagnosis||"No diagnosis",800)+
          (t.prescription?"; treatment/instructions: "+clean(t.prescription,1200):"")+
          "; "+docName;
      });

      const vitals:any=latest?.vitals||{};
      const soap=latest?[
        "S: "+clean(latest.clinical_notes||latest.examination_findings||"Review current symptoms and concerns with the patient.",2500),
        "O: "+clean(latest.examination_findings||"Enter current examination findings.",2500)+
          ((Object.keys(vitals).length)
            ?" Previous recorded vitals: "+
              ["BP "+(vitals.bp||"-"),"Temp "+(vitals.temp||"-"),"Pulse "+(vitals.pulse||"-"),"SpO₂ "+(vitals.spo2||"-"),"Weight "+(vitals.weight||"-")]
                .join(", ")+"."
            :""),
        "A: Previous recorded diagnosis: "+clean(latest.diagnosis||"not recorded",1000)+". Reassess before using.",
        "P: Previous treatment/instructions: "+clean(latest.prescription||"not recorded",1800)+
          ". Confirm or update the plan and follow-up."
      ].join("\n"):[
        "S: Enter current symptoms and patient concerns.",
        "O: Enter current examination findings and vitals.",
        "A: Enter clinician assessment.",
        "P: Enter treatment, instructions, and follow-up plan."
      ].join("\n");

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"CLINICAL_COPILOT_VIEWED",
        entity_type:"patients",
        entity_id:patientId,
        details:{treatment_count:treatments.length,appointment_count:appointments.length}
      });

      return json({
        ok:true,
        copilot:{
          patient:{
            patient_id:patientId,
            first_name:patientUser.first_name,
            last_name:patientUser.last_name,
            age,
            sex:patient.sex||null
          },
          summary,
          alerts,
          recent_history:recentHistory,
          draft_note:soap,
          record_counts:{
            treatments:treatments.length,
            appointments:appointments.length,
            certificates:certificates.length
          },
          generated_at:new Date().toISOString(),
          method:"Explainable rule-based summarization from existing CampusCare records"
        }
      });
    }

    const entries:any[]=[];
    const push=(resource:any)=>{
      if(resource)entries.push({fullUrl:"urn:uuid:"+resource.id,resource});
    };

    push({
      resourceType:"Patient",
      id:fhirId("patient",patientId),
      identifier:[{system:"urn:campuscare:university-id",value:patientUser.id_number||String(patientId)}],
      active:!patient.archived_at,
      name:[{use:"official",family:patientUser.last_name||"",given:[patientUser.first_name||""]}],
      telecom:[
        ...(patientUser.contact_number?[{system:"phone",value:patientUser.contact_number,use:"mobile"}]:[]),
        ...(patientUser.email?[{system:"email",value:patientUser.email}]:[])
      ],
      gender:fhirGender(patient.sex),
      birthDate:patient.birth_date||undefined,
      address:patient.address?[{text:patient.address}]:[],
      extension:[
        {url:"urn:campuscare:college",valueString:patientUser.college||""},
        {url:"urn:campuscare:person-type",valueString:patientUser.person_type||""}
      ]
    });

    for(const d of doctors||[]){
      push({
        resourceType:"Practitioner",
        id:fhirId("practitioner",d.user_id),
        active:true,
        name:[{use:"official",family:d.last_name||"",given:[d.first_name||""]}],
        qualification:d.specialty?[{code:{text:d.specialty}}]:[]
      });
    }

    for(const a of appointments){
      const start=String(a.appointment_date)+"T"+String(a.appointment_time).slice(0,8)+"+08:00";
      const doctor:any=doctorMap.get(Number(a.doctor_id));
      push({
        resourceType:"Appointment",
        id:fhirId("appointment",a.appointment_id),
        status:statusToAppointment(String(a.status||"")),
        serviceType:[{text:a.service||a.clinic||"Campus clinic service"}],
        description:a.reason||a.notes||"CampusCare appointment",
        start,
        participant:[
          {
            actor:{reference:"Patient/"+fhirId("patient",patientId),display:patientUser.first_name+" "+patientUser.last_name},
            status:"accepted"
          },
          {
            actor:{
              reference:"Practitioner/"+fhirId("practitioner",a.doctor_id),
              display:doctor?("Dr. "+doctor.first_name+" "+doctor.last_name):"Doctor"
            },
            status:"accepted"
          }
        ]
      });
    }

    for(const t of treatments){
      const encounterId=fhirId("encounter",t.treatment_id);
      push({
        resourceType:"Encounter",
        id:encounterId,
        status:"finished",
        class:{system:"http://terminology.hl7.org/CodeSystem/v3-ActCode",code:"AMB",display:"ambulatory"},
        subject:{reference:"Patient/"+fhirId("patient",patientId)},
        participant:[{individual:{reference:"Practitioner/"+fhirId("practitioner",t.doctor_id)}}],
        period:{
          start:String(t.treatment_date)+"T00:00:00+08:00",
          end:String(t.treatment_date)+"T23:59:59+08:00"
        }
      });

      push({
        resourceType:"Condition",
        id:fhirId("condition",t.treatment_id),
        clinicalStatus:{text:"recorded"},
        code:{text:t.diagnosis||"Unspecified"},
        subject:{reference:"Patient/"+fhirId("patient",patientId)},
        encounter:{reference:"Encounter/"+encounterId},
        recordedDate:String(t.treatment_date),
        note:[
          ...(t.examination_findings?[{text:String(t.examination_findings)}]:[]),
          ...(t.clinical_notes?[{text:String(t.clinical_notes)}]:[])
        ]
      });

      const vitals:any=t.vitals||{};
      const obs=[
        ["blood-pressure","Blood pressure",vitals.bp],
        ["body-temperature","Body temperature",vitals.temp],
        ["heart-rate","Pulse rate",vitals.pulse],
        ["oxygen-saturation","Oxygen saturation",vitals.spo2],
        ["body-weight","Body weight",vitals.weight],
        ["body-height","Body height",vitals.height]
      ];
      let idx=0;
      for(const [code,label,value] of obs){
        if(value==null||String(value).trim()===""||String(value)==="-")continue;
        idx++;
        push({
          resourceType:"Observation",
          id:fhirId("obs-"+t.treatment_id,idx),
          status:"final",
          code:{text:label},
          subject:{reference:"Patient/"+fhirId("patient",patientId)},
          encounter:{reference:"Encounter/"+encounterId},
          effectiveDateTime:String(t.treatment_date)+"T00:00:00+08:00",
          valueString:String(value),
          meta:{tag:[{system:"urn:campuscare:observation-code",code:String(code)}]}
        });
      }

      if(t.prescription){
        push({
          resourceType:"MedicationRequest",
          id:fhirId("medrequest",t.treatment_id),
          status:"active",
          intent:"order",
          medicationCodeableConcept:{text:String(t.prescription)},
          subject:{reference:"Patient/"+fhirId("patient",patientId)},
          encounter:{reference:"Encounter/"+encounterId},
          authoredOn:String(t.treatment_date),
          note:[{text:"Free-text treatment/medication instruction from CampusCare clinical record."}]
        });
      }
    }

    for(const c of certificates.filter((x:any)=>String(x.status).toLowerCase()==="issued")){
      push({
        resourceType:"DocumentReference",
        id:fhirId("document",c.certificate_id),
        status:"current",
        type:{text:"Medical Certificate"},
        subject:{reference:"Patient/"+fhirId("patient",patientId)},
        date:c.issued_at||c.requested_at,
        description:c.certificate_no
          ?"CampusCare Medical Certificate "+String(c.certificate_no)
          :"CampusCare Medical Certificate",
        content:[{attachment:{title:c.purpose||"Medical Certificate"}}]
      });
    }

    const bundle={
      resourceType:"Bundle",
      id:"campuscare-patient-"+patientId+"-"+new Date().toISOString().slice(0,10),
      type:"collection",
      timestamp:new Date().toISOString(),
      meta:{
        tag:[
          {
            system:"urn:campuscare:export",
            code:"fhir-r4-style",
            display:"CampusCare FHIR R4-style export"
          }
        ]
      },
      entry:entries
    };

    await admin.from("audit_logs").insert({
      user_id:actor.user_id,
      action:mode==="export"?"FHIR_RECORD_EXPORTED":"FHIR_RECORD_PREVIEWED",
      entity_type:"patients",
      entity_id:patientId,
      details:{resource_count:entries.length,mode}
    });

    return json({
      ok:true,
      bundle,
      validation_note:"FHIR R4-style mapping for interoperability preparation. Validate against the receiving implementation guide/server before exchange."
    });
  }catch(e){
    return json({error:e instanceof Error?e.message:"Clinical intelligence action failed."},500);
  }
});
