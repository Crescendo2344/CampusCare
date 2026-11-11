import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

// Username sign-in. The function signs the person in itself and returns only the session, so it never
// tells anyone which email belongs to a username. Five wrong passwords lock that username for 15 minutes.
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const INVALID="Invalid username/email or password.";
const MAX_FAILURES=5,WINDOW_MINUTES=15;
const publishableKey=()=>{
  const legacy=Deno.env.get("SUPABASE_ANON_KEY");
  if(legacy)return legacy;
  try{return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default||"";}catch{return "";}
};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);
  try{
    const body=await req.json().catch(()=>({}));
    const username=String(body.identifier||"").trim().toLowerCase();
    const password=String(body.password||"");
    // Same rules as registration; this also keeps % and _ out of the lookup below.
    if(!/^[a-z0-9][a-z0-9_.-]{2,18}[a-z0-9]$/.test(username)||!password)return json({error:INVALID},401);

    const url=Deno.env.get("SUPABASE_URL")!;
    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const since=new Date(Date.now()-WINDOW_MINUTES*60000).toISOString();
    const {count}=await admin.from("login_attempts").select("identifier",{count:"exact",head:true}).eq("identifier",username).gte("attempted_at",since);
    if((count||0)>=MAX_FAILURES)return json({error:`Too many wrong attempts. Try again in ${WINDOW_MINUTES} minutes or reset your password.`},429);
    const failed=async()=>{await admin.from("login_attempts").insert({identifier:username});return json({error:INVALID},401);};

    // Exact, case-insensitive match: _ is escaped so it cannot act as a wildcard.
    const {data:account}=await admin.from("users").select("email").ilike("username",username.replace(/_/g,"\\_")).limit(2);
    if(account?.length!==1||!account[0].email)return await failed();

    const res=await fetch(`${url}/auth/v1/token?grant_type=password`,{
      method:"POST",
      headers:{"Content-Type":"application/json",apikey:publishableKey()},
      body:JSON.stringify({email:account[0].email,password})
    });
    const result=await res.json().catch(()=>({}));
    if(!res.ok){
      if(result?.error_code==="email_not_confirmed")return json({error:"Verify your email before logging in.",code:"email_not_confirmed"},403);
      if(res.status===429)return json({error:"Too many sign-in attempts right now. Please wait a minute and try again."},429);
      return await failed();
    }
    await admin.from("login_attempts").delete().eq("identifier",username);
    return json({ok:true,session:{access_token:result.access_token,refresh_token:result.refresh_token}});
  }catch{
    return json({error:"Unable to process login."},500);
  }
});
