import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// AI insights for forecasts: Claude reads the aggregated forecast (no patient details) and returns a
// structured briefing - headline, findings, risks, actions and caveats - plus an answer to an optional question.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const MODEL="claude-opus-5-5";
const HOURLY_LIMIT=40;
const MAX_CONTEXT_CHARS=60000;

const SYSTEM=`You are the planning analyst inside CampusCare, the health-services system of a Philippine state university clinic (Medical and Dental clinics serving students and personnel).
You receive a forecast that CampusCare already calculated, as JSON. Explain it for clinic administrators, staff and doctors who are not statisticians.

Rules:
- Use only the numbers in the data. Never invent figures, dates, items or causes; when you suggest a reason, present it as a possibility to check (for example exam weeks, enrollment, semester breaks, outbreaks).
- The forecast is a planning estimate from past averages, not a guarantee. Say so where it matters, especially when history is short or old.
- Be concrete: name items, periods and quantities from the data. Round sensibly.
- Recommended actions must be things a university clinic can do (reorder, move stock, adjust staffing or slots, review data, plan for a period).
- Do not give medical advice about individual patients.
- Write plain, friendly English. Keep each field short; no markdown.
- If a question is included, answer it in "answer" using the data; if the data cannot answer it, say what is missing. Otherwise set "answer" to an empty string.`;

const SCHEMA={
  type:"object",
  additionalProperties:false,
  required:["headline","summary","highlights","risks","actions","caveats","answer"],
  properties:{
    headline:{type:"string",description:"One sentence, the single most important takeaway."},
    summary:{type:"string",description:"Two to four sentences describing what the forecast shows."},
    highlights:{type:"array",items:{type:"object",additionalProperties:false,required:["title","detail"],properties:{title:{type:"string"},detail:{type:"string"}}}},
    risks:{type:"array",items:{type:"object",additionalProperties:false,required:["level","title","detail"],properties:{level:{type:"string",enum:["high","medium","low"]},title:{type:"string"},detail:{type:"string"}}}},
    actions:{type:"array",items:{type:"object",additionalProperties:false,required:["priority","action","reason"],properties:{priority:{type:"string",enum:["now","soon","later"]},action:{type:"string"},reason:{type:"string"}}}},
    caveats:{type:"array",items:{type:"string"}},
    answer:{type:"string"}
  }
};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  try{
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({error:"Authentication required."},401);
    const {data:{user},error:userErr}=await admin.auth.getUser(auth.slice(7));
    if(userErr||!user)return json({error:"Invalid session."},401);
    const {data:actor}=await admin.from("users").select("user_id,role,status").eq("auth_user_id",user.id).maybeSingle();
    if(!actor||actor.status!=="Active")return json({error:"Active CampusCare account required."},403);
    if(!["Administrator","Staff","Doctor"].includes(actor.role))return json({error:"AI insights are available to clinic staff only."},403);

    if(!Deno.env.get("ANTHROPIC_API_KEY"))
      return json({error:"AI insights are not set up yet. An administrator needs to add the ANTHROPIC_API_KEY secret to the CampusCare server.",setup_required:true},503);

    const body=await req.json().catch(()=>({}));
    const kind=body.kind==="inventory"?"inventory":"reports";
    const question=String(body.question||"").trim().slice(0,500);
    const context=JSON.stringify(body.context??null);
    if(!body.context||context.length>MAX_CONTEXT_CHARS)return json({error:"The forecast data is missing or too large to analyse."},400);

    const since=new Date(Date.now()-60*60*1000).toISOString();
    const {count}=await admin.from("audit_logs").select("audit_id",{count:"exact",head:true})
      .eq("user_id",actor.user_id).eq("action","AI_FORECAST_INSIGHTS").gte("created_at",since);
    if((count||0)>=HOURLY_LIMIT)return json({error:"You've reached the hourly limit for AI insights. Try again later."},429);

    const client=new Anthropic();
    const response=await client.beta.messages.create({
      model:MODEL,
      max_tokens:16000,
      betas:["server-side-fallback-2026-07-01"],
      fallbacks:"default",
      output_config:{effort:"medium",format:{type:"json_schema",schema:SCHEMA}},
      system:SYSTEM,
      messages:[{role:"user",content:`${kind==="inventory"?"Inventory stock projection":"Clinic demand forecast"} (JSON):\n${context}${question?`\n\nQuestion from the user: ${question}`:""}`}]
    } as any);

    if(response.stop_reason==="refusal")return json({error:"The AI could not analyse this forecast. Try again with different settings."},422);
    if(response.stop_reason==="max_tokens")return json({error:"The AI response was cut short. Try again."},502);
    const text=response.content.filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("");
    let insights:any;
    try{insights=JSON.parse(text);}catch(_){return json({error:"The AI returned an unreadable answer. Try again."},502);}

    await admin.from("audit_logs").insert({
      user_id:actor.user_id,action:"AI_FORECAST_INSIGHTS",entity_type:kind==="inventory"?"inventory_items":"reports",entity_id:null,
      details:{kind,question:question||null,model:response.model,input_tokens:response.usage?.input_tokens??null,output_tokens:response.usage?.output_tokens??null}
    });

    return json({ok:true,insights,model:response.model,generated_at:new Date().toISOString()});
  }catch(e){
    if(e instanceof Anthropic.RateLimitError)return json({error:"The AI service is busy. Try again in a minute."},429);
    if(e instanceof Anthropic.AuthenticationError)return json({error:"The AI key on the server is not valid. An administrator needs to update ANTHROPIC_API_KEY.",setup_required:true},503);
    if(e instanceof Anthropic.APIError)return json({error:`The AI service returned an error (${e.status}). Try again shortly.`},502);
    return json({error:e instanceof Error?e.message:"AI insights failed."},500);
  }
});
