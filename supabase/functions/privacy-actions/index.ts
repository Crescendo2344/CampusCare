import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Privacy notice acknowledgements and privacy/data requests (Data Privacy Act of 2012).
// Users acknowledge the current notice version and submit requests; administrators see who has
// acknowledged, review open requests and resolve them with a reply to the person.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=2000)=>String(v??"").trim().slice(0,max);
const REQUEST_TYPES=["Copy of my data","Correct my data","Delete my data","Withdraw consent","Other"];
const REQUEST="Withdrawal Request";

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

    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"status").toLowerCase();

    const {data:settings}=await admin.from("system_settings")
      .select("privacy_policy_version,privacy_policy_updated")
      .order("settings_id",{ascending:true}).limit(1).maybeSingle();

    const currentVersion=String(settings?.privacy_policy_version||"1.0");
    const policyUpdated=settings?.privacy_policy_updated||null;
    const clientInfo=()=>{
      const forwarded=req.headers.get("x-forwarded-for")||req.headers.get("cf-connecting-ip")||"";
      return {ip_address:forwarded.split(",")[0].trim()||null,user_agent:req.headers.get("user-agent")};
    };

    if(action==="status"){
      const {data:history,error}=await admin.from("privacy_consents")
        .select("consent_id,privacy_version,consented,event_type,request_type,notes,consented_at,created_at,resolved_at,resolution")
        .eq("user_id",actor.user_id)
        .order("consented_at",{ascending:false})
        .order("consent_id",{ascending:false})
        .limit(50);
      if(error)throw error;

      const latestAck=(history||[]).find(r=>r.consented===true)||null;
      const openRequest=(history||[]).find(r=>r.event_type===REQUEST&&!r.resolved_at)||null;
      const currentAcknowledged=Boolean(latestAck&&String(latestAck.privacy_version)===currentVersion);

      return json({
        ok:true,
        current_version:currentVersion,
        policy_updated:policyUpdated,
        current_acknowledged:currentAcknowledged,
        // Ask again after a new notice version, but never while the person's own request is open.
        needs_acknowledgement:!currentAcknowledged&&!openRequest,
        open_request:openRequest,
        latest:history?.[0]||null,
        history:history||[]
      });
    }

    if(action==="acknowledge"){
      const {data:latestAck}=await admin.from("privacy_consents")
        .select("consent_id,privacy_version,consented,event_type,consented_at")
        .eq("user_id",actor.user_id).eq("consented",true)
        .order("consented_at",{ascending:false})
        .order("consent_id",{ascending:false})
        .limit(1)
        .maybeSingle();

      if(latestAck&&String(latestAck.privacy_version)===currentVersion){
        return json({ok:true,already_acknowledged:true,consent:latestAck});
      }

      const {data:row,error}=await admin.from("privacy_consents").insert({
        user_id:actor.user_id,
        privacy_version:currentVersion,
        consented:true,
        event_type:"Acknowledgement",
        notes:null,
        ...clientInfo()
      }).select("*").single();
      if(error)throw error;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"PRIVACY_NOTICE_ACKNOWLEDGED",
        entity_type:"privacy_consents",
        entity_id:row.consent_id,
        details:{privacy_version:currentVersion}
      });

      return json({ok:true,consent:row});
    }

    if(action==="withdraw_request"){
      const notes=clean(body.notes,1200);
      const requestType=REQUEST_TYPES.includes(String(body.request_type))?String(body.request_type):"Other";
      if(!notes)return json({error:"Please briefly explain the privacy request so the clinic can review it."},400);

      const {data:row,error}=await admin.from("privacy_consents").insert({
        user_id:actor.user_id,
        privacy_version:currentVersion,
        consented:false,
        event_type:REQUEST,
        request_type:requestType,
        notes,
        ...clientInfo()
      }).select("*").single();
      if(error)throw error;

      const {data:admins}=await admin.from("users")
        .select("user_id").eq("role","Administrator").eq("status","Active");

      if(admins?.length){
        await admin.from("notifications").insert(admins.map((a:any)=>({
          user_id:a.user_id,
          title:"Privacy Request Submitted",
          message:`A CampusCare user submitted a privacy request (${requestType}) for review.`,
          type:"Account",
          channel:"In-app",
          delivery_status:"Created",
          reference_type:"privacy_consents",
          reference_id:row.consent_id,
          action_page:"settings"
        })));
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"PRIVACY_WITHDRAWAL_REQUESTED",
        entity_type:"privacy_consents",
        entity_id:row.consent_id,
        details:{privacy_version:currentVersion,request_type:requestType}
      });

      return json({ok:true,request:row});
    }

    if(actor.role!=="Administrator")return json({error:"Administrator access required."},403);

    if(action==="admin_summary"){
      const {data:rows,error}=await admin.from("privacy_consents")
        .select("consent_id,user_id,privacy_version,consented,event_type,resolved_at,consented_at")
        .order("consented_at",{ascending:false});
      if(error)throw error;

      const latestAck=new Map<number,any>();
      for(const row of rows||[]){
        if(row.consented===true&&!latestAck.has(Number(row.user_id)))latestAck.set(Number(row.user_id),row);
      }
      const acks=[...latestAck.values()];
      const {count:activeUsers}=await admin.from("users")
        .select("user_id",{count:"exact",head:true}).eq("status","Active");

      return json({
        ok:true,
        current_version:currentVersion,
        policy_updated:policyUpdated,
        active_users:activeUsers||0,
        total_users_with_history:new Set((rows||[]).map(r=>Number(r.user_id))).size,
        current_acknowledged:acks.filter(r=>String(r.privacy_version)===currentVersion).length,
        outdated:acks.filter(r=>String(r.privacy_version)!==currentVersion).length,
        withdrawal_requests:(rows||[]).filter(r=>r.event_type===REQUEST&&!r.resolved_at).length
      });
    }

    if(action==="list_requests"){
      const {data:rows,error}=await admin.from("privacy_consents")
        .select("consent_id,user_id,request_type,notes,consented_at,resolved_at,resolution,resolved_by")
        .eq("event_type",REQUEST)
        .order("consented_at",{ascending:false})
        .limit(100);
      if(error)throw error;
      const ids=[...new Set((rows||[]).flatMap(r=>[r.user_id,r.resolved_by]).filter(Boolean))];
      const {data:people}=ids.length
        ? await admin.from("users").select("user_id,first_name,last_name,email,role").in("user_id",ids)
        : {data:[]};
      const byId=new Map((people||[]).map((p:any)=>[Number(p.user_id),p]));
      const name=(id:number)=>{const p:any=byId.get(Number(id));return p?`${p.first_name||""} ${p.last_name||""}`.trim():"";};
      return json({ok:true,requests:(rows||[]).map(r=>({
        ...r,
        requester:name(r.user_id),
        requester_email:(byId.get(Number(r.user_id)) as any)?.email||"",
        requester_role:(byId.get(Number(r.user_id)) as any)?.role||"",
        resolved_by_name:r.resolved_by?name(r.resolved_by):""
      }))});
    }

    if(action==="resolve_request"){
      const consentId=Number(body.consent_id||0);
      const resolution=clean(body.resolution,1200);
      if(!consentId)return json({error:"Request is required."},400);
      if(resolution.length<5)return json({error:"Write a short reply to the person (at least 5 characters)."},400);
      const {data:row}=await admin.from("privacy_consents")
        .select("consent_id,user_id,event_type,request_type,resolved_at")
        .eq("consent_id",consentId).maybeSingle();
      if(!row||row.event_type!==REQUEST)return json({error:"Privacy request not found."},404);
      if(row.resolved_at)return json({error:"This request was already resolved."},409);
      const now=new Date().toISOString();
      const {error}=await admin.from("privacy_consents")
        .update({resolved_at:now,resolved_by:actor.user_id,resolution})
        .eq("consent_id",consentId).is("resolved_at",null);
      if(error)throw error;
      await admin.from("notifications").insert({
        user_id:row.user_id,
        title:"Privacy Request Resolved",
        message:`Your privacy request (${row.request_type||"Other"}) has been resolved: ${resolution}`,
        type:"Account",channel:"In-app",delivery_status:"Created",
        reference_type:"privacy_consents",reference_id:consentId,action_page:"my-account"
      });
      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"PRIVACY_REQUEST_RESOLVED",entity_type:"privacy_consents",
        entity_id:consentId,details:{request_type:row.request_type||"Other"}
      });
      return json({ok:true,resolved_at:now});
    }

    return json({error:"Unsupported privacy action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Privacy action failed."},500);
  }
});
