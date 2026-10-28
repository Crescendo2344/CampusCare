import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// AI insights for forecasts: a free-tier model (Google Gemini, with Groq as the backup) reads the aggregated
// forecast (no patient details) and returns a structured briefing - headline, findings, risks, actions and
// caveats - plus an answer to an optional question.
// Secrets: GEMINI_API_KEY and/or GROQ_API_KEY (tried in that order); optional GEMINI_MODEL / GROQ_MODEL.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const HOURLY_LIMIT=40;
const MAX_CONTEXT_CHARS=60000;
// Edge functions stop at 150 s; each AI call gets at most 40 s and all of them together 125 s,
// so a slow provider hands over to the next one and the user always gets an answer or a clear error.
const CALL_TIMEOUT_MS=40000;
const TOTAL_BUDGET_MS=125000;

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
- Set "answer" to an empty string.

Reply with one JSON object and nothing else, in exactly this shape:
{"headline": string (one sentence, the most important takeaway),
 "summary": string (two to four sentences),
 "highlights": [{"title": string, "detail": string}],
 "risks": [{"level": "high" | "medium" | "low", "title": string, "detail": string}],
 "actions": [{"priority": "now" | "soon" | "later", "action": string, "reason": string}],
 "caveats": [string],
 "answer": string}`;

// Follow-up questions get a short answer only, which is much faster than a full briefing.
const ASK_SYSTEM=`You are the planning analyst inside CampusCare, the health-services system of a Philippine state university clinic.
You receive a forecast CampusCare already calculated, as JSON, and a question about it (sometimes with the earlier questions and answers).
Answer in plain, friendly English in at most five sentences, using only numbers from the data. Never invent figures or causes; offer possible reasons as things to check.
If the data cannot answer the question, say what is missing. Do not give medical advice about individual patients. No markdown.
Reply with one JSON object and nothing else: {"answer": string}`;

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

async function timedFetch(url:string,init:RequestInit,deadline:number){
  const remaining=Math.min(CALL_TIMEOUT_MS,deadline-Date.now());
  if(remaining<3000)throw new ProviderError("The AI took too long to answer. Try again.",504);
  try{return await fetch(url,{...init,signal:AbortSignal.timeout(remaining)});}
  catch(e){
    if(e instanceof DOMException&&(e.name==="TimeoutError"||e.name==="AbortError"))throw new ProviderError("The AI took too long to answer. Try again.",504);
    throw e;
  }
}

// Model names change often. Try the preferred ones, then ask the provider which models this key can
// use, so a retired name or a busy model never leaves the clinic without an answer.
const RETRY_NEXT=(status:number,message:string)=>status===404||status>=500||(status===400&&/model/i.test(message));

async function listGeminiModels(key:string,deadline:number){
  try{
    const response=await timedFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",{headers:{"x-goog-api-key":key}},deadline);
    const body=await response.json().catch(()=>({}));
    return (body?.models||[])
      .filter((m:any)=>(m.supportedGenerationMethods||[]).includes("generateContent")&&/flash/i.test(m.name)&&!/image|tts|audio|live|embed|preview/i.test(m.name))
      .map((m:any)=>String(m.name).replace(/^models\//,""))
      .sort((x:string,y:string)=>y.localeCompare(x,undefined,{numeric:true}));// newest version first
  }catch(_){return [];}
}

async function geminiOnce(key:string,model:string,system:string,prompt:string,maxTokens:number,deadline:number){
  // Thinking makes answers too slow for the server time limit: turn it off, or as low as the model allows.
  for(const thinkingConfig of [{thinkingBudget:0},{thinkingLevel:"minimal"},null]){
    const response=await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:system}]},
        contents:[{role:"user",parts:[{text:prompt}]}],
        generationConfig:{responseMimeType:"application/json",temperature:0.3,maxOutputTokens:maxTokens,...(thinkingConfig?{thinkingConfig}:{})}
      })
    },deadline);
    const body=await response.json().catch(()=>({}));
    const message=String(body?.error?.message||response.statusText);
    // A model that rejects this thinking setting may only say "invalid argument": try the next setting.
    if(response.status===400&&thinkingConfig&&!/api key/i.test(message))continue;
    return {response,body,message};
  }
  throw new ProviderError("The AI service rejected the request.",502);
}

async function askGemini(key:string,system:string,prompt:string,maxTokens:number,deadline:number){
  const preferred=[Deno.env.get("GEMINI_MODEL")||"","gemini-3.8-flash","gemini-flash-latest","gemini-flash-lite-latest"].filter(Boolean);
  const tried=new Set<string>();let last:ProviderError|null=null,discovered=false;
  const queue=[...preferred];
  while(queue.length){
    const model=queue.shift()!;if(tried.has(model))continue;tried.add(model);
    const {response,body,message}=await geminiOnce(key,model,system,prompt,maxTokens,deadline);
    if(response.ok){
      // Thinking models can return reasoning parts flagged as thoughts; only the answer text is used.
      const output=(body?.candidates?.[0]?.content?.parts||[]).filter((p:any)=>!p.thought).map((p:any)=>p.text||"").join("");
      if(output)return {output,model};
      last=new ProviderError("The AI returned an empty answer. Try again.",502);continue;
    }
    console.error("forecast-insights: Gemini",model,response.status,message);
    if(response.status===400&&/api key/i.test(message))throw new ProviderError("The Gemini API key on the server is not valid. Update the GEMINI_API_KEY secret.",503,true);
    if(response.status===403)throw new ProviderError("The Gemini API key is not allowed to use this model. Check the key in Google AI Studio.",503,true);
    last=response.status===429
      ?new ProviderError("The free AI quota is used up for now. Try again in a minute, or tomorrow if the daily limit was reached.",429)
      :new ProviderError(`The AI service returned an error (${response.status}): ${message.slice(0,200)}`,502);
    if(response.status!==429&&!RETRY_NEXT(response.status,message))break;
    if(!queue.length&&!discovered){discovered=true;queue.push(...(await listGeminiModels(key,deadline)).slice(0,3));}
  }
  throw last||new ProviderError("The AI service is unavailable.",502);
}

async function listOpenAiModels(url:string,key:string,deadline:number){
  try{
    const response=await timedFetch(url,{headers:{Authorization:`Bearer ${key}`}},deadline);
    const body=await response.json().catch(()=>({}));
    const ids=(body?.data||[]).filter((m:any)=>m.active!==false).map((m:any)=>String(m.id)).filter((id:string)=>!/whisper|guard|tts|orpheus|playai|compound|prompt|safeguard/i.test(id));
    const rank=(id:string)=>[/gpt-oss-120b/,/gpt-oss/,/llama/,/qwen/,/kimi/].findIndex(r=>r.test(id))+1||9;
    return ids.sort((x:string,y:string)=>rank(x)-rank(y));
  }catch(_){return [];}
}

// Groq speaks the OpenAI chat format.
async function askOpenAiCompatible(name:string,url:string,modelsUrl:string,key:string,preferred:string[],system:string,prompt:string,maxTokens:number,deadline:number){
  const tried=new Set<string>();let last:ProviderError|null=null,discovered=false;
  const queue=preferred.filter(Boolean);
  while(queue.length){
    const model=queue.shift()!;if(tried.has(model))continue;tried.add(model);
    // gpt-oss models reason before answering; keep that short so replies stay fast.
    let reasoning=/gpt-oss/.test(model),response:Response,body:any,message="";
    while(true){
      response=await timedFetch(url,{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},
        body:JSON.stringify({model,temperature:0.3,max_tokens:maxTokens,response_format:{type:"json_object"},...(reasoning?{reasoning_effort:"low"}:{}),messages:[{role:"system",content:system},{role:"user",content:prompt}]})
      },deadline);
      body=await response.json().catch(()=>({}));
      message=String(body?.error?.message||body?.error||response.statusText);
      if(reasoning&&response.status===400&&/reasoning/i.test(message)){reasoning=false;continue;}
      break;
    }
    if(response.ok){
      const output=String(body?.choices?.[0]?.message?.content||"");
      if(output)return {output,model};
      last=new ProviderError("The AI returned an empty answer. Try again.",502);continue;
    }
    console.error("forecast-insights:",name,model,response.status,message);
    if(response.status===401||response.status===403)throw new ProviderError(`The ${name} API key on the server is not valid.`,503,true);
    last=response.status===429
      ?new ProviderError("The free AI quota is used up for now. Try again in a minute.",429)
      :new ProviderError(`The AI service returned an error (${response.status}): ${message.slice(0,200)}`,502);
    if(response.status!==429&&!RETRY_NEXT(response.status,message))break;
    if(!queue.length&&!discovered){discovered=true;queue.push(...(await listOpenAiModels(modelsUrl,key,deadline)).slice(0,3));}
  }
  throw last||new ProviderError("The AI service is unavailable.",502);
}

const PROVIDERS=[
  {name:"Gemini",key:"GEMINI_API_KEY",ask:(key:string,system:string,prompt:string,max:number,deadline:number)=>askGemini(key,system,prompt,max,deadline)},
  {name:"Groq",key:"GROQ_API_KEY",ask:(key:string,system:string,prompt:string,max:number,deadline:number)=>
    askOpenAiCompatible("Groq","https://api.groq.com/openai/v1/chat/completions","https://api.groq.com/openai/v1/models",key,[Deno.env.get("GROQ_MODEL")||"","openai/gpt-oss-120b","openai/gpt-oss-20b"],system,prompt,max,deadline)}
];

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

    const available=PROVIDERS.map(p=>({...p,secret:Deno.env.get(p.key)||""})).filter(p=>p.secret);
    if(!available.length)
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

    const history=(Array.isArray(body.history)?body.history:[]).slice(-4)
      .map((h:any)=>`Q: ${text(h?.question,300)}\nA: ${text(h?.answer,800)}`).join("\n\n");
    const data=`${kind==="inventory"?"Inventory stock projection":"Clinic demand forecast"} (JSON):\n${context}`;
    const system=question?ASK_SYSTEM:SYSTEM,maxTokens=question?800:3072;
    const prompt=question?`${data}${history?`\n\nEarlier in this conversation:\n${history}`:""}\n\nQuestion: ${question}`:data;
    // Gemini first; if it is slow, failing or rate-limited, Groq answers instead.
    const deadline=Date.now()+TOTAL_BUDGET_MS;
    let provider="",reply:{output:string,model:string}|null=null,failure:ProviderError|null=null;
    for(const p of available){
      try{reply=await p.ask(p.secret,system,prompt,maxTokens,deadline);provider=p.name;break;}
      catch(e){
        if(!(e instanceof ProviderError))throw e;
        failure=e;
        if(deadline-Date.now()<3000)break;
      }
    }
    if(!reply)throw failure||new ProviderError("The AI service is unavailable.",502);
    const {output,model}=reply;
    let insights:any;
    try{insights=normalize(parseJson(output));}catch(_){return json({error:"The AI returned an unreadable answer. Try again."},502);}
    if(question?!insights.answer:!insights.headline&&!insights.summary)return json({error:"The AI returned an empty answer. Try again."},502);

    await admin.from("audit_logs").insert({
      user_id:actor.user_id,action:"AI_FORECAST_INSIGHTS",entity_type:kind==="inventory"?"inventory_items":"reports",entity_id:null,
      details:{kind,question:question||null,provider,model}
    });

    return json({ok:true,insights,model,generated_at:new Date().toISOString()});
  }catch(e){
    if(e instanceof ProviderError)return json({error:e.message,setup_required:e.setup},e.status);
    console.error("forecast-insights:",e);
    return json({error:e instanceof Error?e.message:"AI insights failed."},500);
  }
});
