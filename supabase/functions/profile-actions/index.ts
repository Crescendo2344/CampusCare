import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import {normalizePhilippineMobile} from "../_shared/contact-validation.js";

// Signed-in people update their own contact number here. No extra code is asked: they are already
// signed in, and the number is contact information, not a sign-in method.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

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

    const {data:actor}=await admin.from("users").select("user_id,status,contact_number").eq("auth_user_id",user.id).maybeSingle();
    if(!actor||actor.status!=="Active")return json({error:"Active CampusCare account required."},403);

    const body=await req.json();
    const action=String(body.action||"").toLowerCase();

    if(action==="update_contact"){
      const raw=String(body.contact_number??"").trim();
      const contact=raw?normalizePhilippineMobile(raw):"";
      if(raw&&!contact)return json({error:"Use a Philippine mobile number starting with 09 or +639."},400);
      if(contact===(actor.contact_number||""))return json({ok:true,contact_number:contact});
      const {error}=await admin.from("users").update({contact_number:contact||null}).eq("user_id",actor.user_id);
      if(error)throw error;
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"USER_CONTACT_UPDATED",entity_type:"users",entity_id:actor.user_id,details:{previous_contact_number:actor.contact_number||null,new_contact_number:contact||null}});
      return json({ok:true,contact_number:contact});
    }

    return json({error:"Unsupported action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unable to update your profile."},500);
  }
});
