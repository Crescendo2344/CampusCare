import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// AI insights for forecasts: a free-tier model (Google Gemini, or Groq as an alternative) reads the aggregated
// forecast (no patient details) and returns a structured briefing - headline, findings, risks, actions and
// caveats - plus an answer to an optional question.
// Secrets: GEMINI_API_KEY (preferred) or GROQ_API_KEY; optional GEMINI_MODEL / GROQ_MODEL to pick a model.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const HOURLY_LIMIT=40;
const MAX_CONTEXT_CHARS=60000;

const SYSTEM=`You are the planning analyst inside CampusCare, the health-services system of a Philippine state university clinic (Medical and Dental clinics serving students and personnel).
You receive a forecast that CampusCare already calculated, as JSON. Explain it for clinic administrators, staff and doctors who are not statisticians.

Rules:
- Use only the numbers in the data. Never invent figures, dates, items or causes; when you suggest a reason, present it as a possibility to check (for example exam weeks, enrollment, semester breaks, outbreaks).
- The forecast is a planning estimate from past averages, not a guarantee. Say so where it matters, especially when history is short or old.
- Be concrete: name items, periods and quantities from the data. Round sensibly.
- Recommended actions must be things a university clinic can do (reorder, move stock, adjust staffing or slots, review data, plan for a period).
- For inventory, items without usage history have no projection: comment only on their stock against the reorder level and on expiry dates.
- Do not give medical advice about individual patients.
- Write plain, friendly English. Keep each field short; no markdown.
- If a question is included, answer it in "answer" using the data; if the data cannot answer it, say what is missing. Otherwise set "answer" to an empty string.

Reply with one JSON object and nothing else, in exactly this shape:
{"headline": string (one sentence, the most important takeaway),
 "summary": string (two to four sentences),
 "highlights": [{"title": string, "detail": string}],
 "risks": [{"level": "high" | "medium" | "low", "title": string, "detail": string}],
 "actions": [{"priority": "now" | "soon" | "later", "action": string, "reason": string}],
 "caveats": [string],
 "answer": string}`;

const text=(v:unknown,max=600)=>String(v??"").trim().slice(0,max);
const list=(v:unknown)=>Array.isArray(v)?v.slice(0,8):[];
const oneOf=(v:unknown,allowed:string[],fallback:string)=>allowed.includes(String(v))?String(v):fallback;
// Free models follow the shape well but not perfectly; keep only well-formed fields.
function normalize(raw:any){
  return {
    headline:text(raw?.headline,300),
    summary:text(raw?.summary,1200),
    highlights:list(raw?.highlights).map((h:any)=>({title:text(h?.title,160),detail:text(h?.detail)})).filter(h=>h.title||h.detail),
    risks:list(raw?.risks).map((r:any)=>({level:oneOf(String(r?.level).toLowerCase(),["high","medium","low"],"medium"),title:text(r?.title,160),detail:text(r?.detail)})).filter(r=>r.title||r.detail),
    actions:list(raw?.actions).map((a:any)=>({priority:oneOf(String(a?.priority).toLowerCase(),["now","soon","later"],"soon"),action:text(a?.action,240),reason:text(a?.reason)})).filter(a=>a.action),
    caveats:list(raw?.caveats).map((c:any)=>text(c,300)).filter(Boolean),
    answer:text(raw?.answer,1500)
  };
}
// Model output sometimes arrives wrapped in a code fence.
const parseJson=(output:string)=>JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/,""));

class ProviderError extends Error{constructor(message:string,public status:number,public setup=false){super(message);}}

async function askGemini(key:string,prompt:string){
  const models=[Deno.env.get("GEMINI_MODEL"),"gemini-flash-latest","gemini-2.5-flash"].filter(Boolean) as string[];
  let last:ProviderError|null=null;
  for(const model of [...new Set(models)]){
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:SYSTEM}]},
        contents:[{role:"user",parts:[{text:prompt}]}],
        generationConfig:{responseMimeType:"application/json",temperature:0.3,maxOutputTokens:8192}
      })
    });
    const body=await response.json().catch(()=>({}));
    if(response.ok){
      // Thinking models can return reasoning parts flagged as thoughts; only the answer text is used.
      const output=(body?.candidates?.[0]?.content?.parts||[]).filter((p:any)=>!p.thought).map((p:any)=>p.text||"").join("");
      if(!output)throw new ProviderError("The AI returned an empty answer. Try again.",502);
      return {output,model};
    }
    const message=String(body?.error?.message||response.statusText);
    console.error("forecast-insights: Gemini",model,response.status,message);
    if(response.status===400&&/api key/i.test(message))throw new ProviderError("The Gemini API key on the server is not valid. Update the GEMINI_API_KEY secret.",503,true);
    if(response.status===403)throw new ProviderError("The Gemini API key is not allowed to use this model. Check the key in Google AI Studio.",503,true);
    if(response.status===429)throw new ProviderError("The free AI quota is used up for now. Try again in a minute, or tomorrow if the daily limit was reached.",429);
    last=new ProviderError(`The AI service returned an error (${response.status}): ${message.slice(0,200)}`,502);
    if(response.status!==404)break;// a retired model name: try the next one
  }
  throw last||new ProviderError("The AI service is unavailable.",502);
}

async function askGroq(key:string,prompt:string){
  const model=Deno.env.get("GROQ_MODEL")||"llama-3.3-70b-versatile";
  const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
    body:JSON.stringify({model,temperature:0.3,max_tokens:4096,response_format:{type:"json_object"},messages:[{role:"system",content:SYSTEM},{role:"user",content:prompt}]})
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String(body?.error?.message||response.statusText);
    console.error("forecast-insights: Groq",model,response.status,message);
    if(response.status===401)throw new ProviderError("The Groq API key on the server is not valid. Update the GROQ_API_KEY secret.",503,true);
    if(response.status===429)throw new ProviderError("The free AI quota is used up for now. Try again in a minute.",429);
    throw new ProviderError(`The AI service returned an error (${response.status}): ${message.slice(0,200)}`,502);
  }
  const output=String(body?.choices?.[0]?.message?.content||"");
  if(!output)throw new ProviderError("The AI returned an empty answer. Try again.",502);
  return {output,model};
}

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

    const geminiKey=Deno.env.get("GEMINI_API_KEY"),groqKey=Deno.env.get("GROQ_API_KEY");
    if(!geminiKey&&!groqKey)
      return json({error:"AI insights are not set up yet. Add a free GEMINI_API_KEY (Google AI Studio) or GROQ_API_KEY secret to the CampusCare server.",setup_required:true},503);

    const body=await req.json().catch(()=>({}));
    const kind=body.kind==="inventory"?"inventory":"reports";
    const question=String(body.question||"").trim().slice(0,500);
    const context=JSON.stringify(body.context??null);
    if(!body.context||context.length>MAX_CONTEXT_CHARS)return json({error:"The forecast data is missing or too large to analyse."},400);

    const since=new Date(Date.now()-60*60*1000).toISOString();
    const {count}=await admin.from("audit_logs").select("audit_id",{count:"exact",head:true})
      .eq("user_id",actor.user_id).eq("action","AI_FORECAST_INSIGHTS").gte("created_at",since);
    if((count||0)>=HOURLY_LIMIT)return json({error:"You've reached the hourly limit for AI insights. Try again later."},429);

    const prompt=`${kind==="inventory"?"Inventory stock projection":"Clinic demand forecast"} (JSON):\n${context}${question?`\n\nQuestion from the user: ${question}`:""}`;
    const {output,model}=geminiKey?await askGemini(geminiKey,prompt):await askGroq(groqKey!,prompt);
    let insights:any;
    try{insights=normalize(parseJson(output));}catch(_){return json({error:"The AI returned an unreadable answer. Try again."},502);}
    if(!insights.headline&&!insights.summary&&!insights.answer)return json({error:"The AI returned an empty answer. Try again."},502);

    await admin.from("audit_logs").insert({
      user_id:actor.user_id,action:"AI_FORECAST_INSIGHTS",entity_type:kind==="inventory"?"inventory_items":"reports",entity_id:null,
      details:{kind,question:question||null,provider:geminiKey?"Gemini":"Groq",model}
    });

    return json({ok:true,insights,model,generated_at:new Date().toISOString()});
  }catch(e){
    if(e instanceof ProviderError)return json({error:e.message,setup_required:e.setup},e.status);
    console.error("forecast-insights:",e);
    return json({error:e instanceof Error?e.message:"AI insights failed."},500);
  }
});
