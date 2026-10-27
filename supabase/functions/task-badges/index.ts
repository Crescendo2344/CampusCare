import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});

// Sidebar work counts: each page lists the items someone in this role still has to act on.
// A count drops only when the item is resolved, not when the page is opened.
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
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

    const {data:actor,error:actorErr}=await admin.from("users")
      .select("user_id,first_name,last_name,role,status")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(actorErr||!actor||actor.status!=="Active")
      return json({error:"Active CampusCare account required."},403);

    const counts:Record<string,number>={};
    const items:Record<string,string[]>={};
    const center:any[]=[];
    const today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);

    const addCenter=(page:string,count:number,label:string,description:string,severity="info")=>{
      if(count>0)center.push({page,count,label,description,severity});
    };

    const set=(page:string,rows:any[],token:(row:any)=>string)=>{
      const list=(rows||[]).map(token).filter(Boolean);
      counts[page]=list.length;
      items[page]=list;
    };

    if(["Administrator","Staff"].includes(actor.role)){
      const [approvalRes,inventoryRes,appointmentRes]=await Promise.all([
        admin.from("users")
          .select("user_id,created_at")
          .eq("role","Patient").eq("status","Pending")
          .order("created_at",{ascending:true}),
        admin.from("inventory_items")
          .select("item_id,item_name,quantity,threshold,updated_at")
          .eq("archived",false)
          .order("updated_at",{ascending:true}),
        // Past appointments still marked Scheduled have no recorded outcome yet.
        admin.from("appointments")
          .select("appointment_id,appointment_date")
          .in("status",["Scheduled","Confirmed"])
          .lt("appointment_date",today)
          .order("appointment_date",{ascending:true})
      ]);
      if(approvalRes.error)throw approvalRes.error;
      if(inventoryRes.error)throw inventoryRes.error;
      if(appointmentRes.error)throw appointmentRes.error;

      set("approvals",approvalRes.data||[],r=>`approval:${r.user_id}:${r.created_at||""}`);
      const low=(inventoryRes.data||[]).filter((r:any)=>Number(r.quantity)<=Number(r.threshold));
      set("inventory",low,r=>`inventory:${r.item_id}:${r.updated_at||r.quantity}`);
      set("appointments",appointmentRes.data||[],r=>`appointment:${r.appointment_id}:${r.appointment_date}`);

      addCenter("approvals",counts.approvals||0,"Registration approvals","Review newly registered patients and their verification documents.","warning");
      addCenter("inventory",counts.inventory||0,"Low-stock inventory","Restock or review items at or below their threshold.","danger");
      addCenter("appointments",counts.appointments||0,"Appointments awaiting an outcome","Past appointments are still marked Scheduled. Record a no-show or ask the doctor to complete the visit.","warning");
    }

    if(actor.role==="Doctor"){
      const [certRes,fitnessUnassignedRes,fitnessAssignedRes,appointmentRes]=await Promise.all([
        admin.from("medical_certificates")
          .select("certificate_id,updated_at")
          .eq("status","Awaiting Signature")
          .eq("doctor_id",actor.user_id)
          .order("updated_at",{ascending:true}),
        admin.from("fitness_assessments")
          .select("assessment_id,updated_at")
          .eq("status","Requested")
          .is("doctor_id",null)
          .order("updated_at",{ascending:true}),
        admin.from("fitness_assessments")
          .select("assessment_id,updated_at")
          .eq("status","In Assessment")
          .eq("doctor_id",actor.user_id)
          .order("updated_at",{ascending:true}),
        // Today's and earlier visits assigned to this doctor that still need notes.
        admin.from("appointments")
          .select("appointment_id,appointment_date")
          .eq("doctor_id",actor.user_id)
          .in("status",["Scheduled","Confirmed"])
          .lte("appointment_date",today)
          .order("appointment_date",{ascending:true})
      ]);
      if(certRes.error)throw certRes.error;
      if(fitnessUnassignedRes.error)throw fitnessUnassignedRes.error;
      if(fitnessAssignedRes.error)throw fitnessAssignedRes.error;
      if(appointmentRes.error)throw appointmentRes.error;

      set("cert-requests",certRes.data||[],r=>`certificate:${r.certificate_id}:${r.updated_at||""}`);
      set(
        "fitness",
        [...(fitnessUnassignedRes.data||[]),...(fitnessAssignedRes.data||[])],
        r=>`fitness:${r.assessment_id}:${r.updated_at||""}`
      );
      set("appointments",appointmentRes.data||[],r=>`appointment:${r.appointment_id}:${r.appointment_date}`);

      addCenter("cert-requests",counts["cert-requests"]||0,"Certificate drafts","Finish, sign and issue, or discard your certificate drafts.","warning");
      addCenter("fitness",counts.fitness||0,"Fitness assessments","Claim or continue fitness-to-compete assessments.","warning");
      addCenter("appointments",counts.appointments||0,"Appointments to document","Add visit notes for today's and earlier appointments to complete them.","warning");
    }

    if(actor.role==="Administrator"){
      const [issueRes,workflowRes]=await Promise.all([
        admin.from("issue_reports")
          .select("issue_id,updated_at")
          .in("status",["Open","In Review"])
          .order("updated_at",{ascending:true}),
        admin.from("workflow_requests")
          .select("request_id,request_type,updated_at")
          .eq("status","Pending")
          .order("updated_at",{ascending:true})
      ]);
      if(issueRes.error)throw issueRes.error;
      if(workflowRes.error)throw workflowRes.error;

      set("feedback-issues",issueRes.data||[],r=>`issue:${r.issue_id}:${r.updated_at||""}`);
      set("users",workflowRes.data||[],r=>`workflow:${r.request_id}:${r.updated_at||""}`);

      addCenter("feedback-issues",counts["feedback-issues"]||0,"Open feedback & issues","Review reports that are open or currently in review.","warning");
      addCenter("users",counts.users||0,"Workflow requests","Review pending name, schedule, and day-off requests.","warning");
    }

    // Recent activity combines in-app updates with audit history.
    const {data:notifs,error:notifErr}=await admin.from("notifications")
      .select("notification_id,title,message,type,is_read,action_page,created_at")
      .eq("user_id",actor.user_id)
      .order("created_at",{ascending:false})
      .limit(10);
    if(notifErr)throw notifErr;

    let auditQuery=admin.from("audit_logs")
      .select("audit_id,user_id,action,entity_type,entity_id,details,created_at")
      .order("created_at",{ascending:false})
      .limit(actor.role==="Administrator"?12:8);
    if(actor.role!=="Administrator")auditQuery=auditQuery.eq("user_id",actor.user_id);
    const {data:audits,error:auditErr}=await auditQuery;
    if(auditErr)throw auditErr;

    const userIds=[...new Set((audits||[]).map((a:any)=>Number(a.user_id)).filter(Boolean))];
    const {data:auditUsers}=userIds.length
      ? await admin.from("users").select("user_id,first_name,last_name,role").in("user_id",userIds)
      : {data:[]};
    const names=new Map((auditUsers||[]).map((u:any)=>[
      Number(u.user_id),
      `${u.first_name||""} ${u.last_name||""}`.trim()||u.role||"User"
    ]));

    const pageForEntity=(entity:string)=>{
      if(entity==="appointments")return actor.role==="Patient"?"my-appointments":"appointments";
      if(entity==="treatments"||entity==="dental_records")return actor.role==="Patient"?"my-records":"treatments";
      if(entity==="medical_certificates")return actor.role==="Patient"?"my-certificates":actor.role==="Doctor"?"cert-requests":"";
      if(entity==="fitness_assessments")return "fitness";
      if(entity==="inventory_items"||entity==="inventory_transactions")return "inventory";
      if(entity==="workflow_requests")return actor.role==="Administrator"?"users":actor.role==="Doctor"?"schedule":"my-account";
      return "";
    };

    const friendly=(action:string)=>String(action||"")
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map(x=>x.charAt(0).toUpperCase()+x.slice(1))
      .join(" ");

    const activity:any[]=[
      ...(notifs||[]).map((n:any)=>({
        kind:"notification",
        id:`n-${n.notification_id}`,
        title:n.title,
        detail:n.message,
        page:n.action_page||"",
        unread:!n.is_read,
        created_at:n.created_at
      })),
      ...(audits||[]).map((a:any)=>({
        kind:"audit",
        id:`a-${a.audit_id}`,
        title:friendly(a.action),
        detail:actor.role==="Administrator"&&a.user_id
          ? `${names.get(Number(a.user_id))||"User"} · ${a.entity_type||"CampusCare"}`
          : (a.entity_type||"CampusCare"),
        page:pageForEntity(a.entity_type||""),
        unread:false,
        created_at:a.created_at
      }))
    ]
      .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0,10);

    return json({
      ok:true,
      role:actor.role,
      counts,
      items,
      task_center:center,
      recent_activity:activity,
      refreshed_at:new Date().toISOString()
    });
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unexpected error."},500);
  }
});
