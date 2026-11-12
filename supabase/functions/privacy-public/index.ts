import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}
});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(!["GET","POST"].includes(req.method))return json({error:"Method not allowed."},405);

  try{
    const admin=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {auth:{persistSession:false,autoRefreshToken:false}}
    );

    const {data,error}=await admin.from("system_settings")
      .select("privacy_policy_version,privacy_policy_updated")
      .order("settings_id",{ascending:true})
      .limit(1)
      .maybeSingle();

    if(error)throw error;

    return json({
      ok:true,
      privacy_policy_version:String(data?.privacy_policy_version||"1.0"),
      privacy_policy_updated:data?.privacy_policy_updated||null
    });
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unable to load privacy notice information."},500);
  }
});
