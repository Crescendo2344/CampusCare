import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Sets a new password from an emailed reset link. Only a session opened by that link is accepted.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

function decodeJwtPayload(token:string){
  try{
    const part=token.split(".")[1];
    if(!part)return null;
    const normalized=part.replace(/-/g,"+").replace(/_/g,"/");
    const padded=normalized+"=".repeat((4-normalized.length%4)%4);
    return JSON.parse(atob(padded));
  }catch{return null}
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({error:"Recovery session required."},401);

    const token=auth.slice(7);
    const {data:{user},error:userErr}=await admin.auth.getUser(token);
    if(userErr||!user)return json({error:"Recovery session is invalid or expired."},401);

    // getUser() above verifies the token. Only then inspect its verified claims.
    // Password recovery sessions contain amr.method = "recovery".
    const claims=decodeJwtPayload(token);
    const amr=Array.isArray(claims?.amr)?claims.amr:[];
    const isRecovery=amr.some((entry:any)=>entry?.method==="recovery");
    if(!isRecovery)return json({error:"This password-reset link has already been used or has expired. Request a new link and open the newest email."},403);

    const body=await req.json();
    const newPassword=String(body.new_password||"");

    const strong=
      newPassword.length>=8 &&
      /[A-Z]/.test(newPassword) &&
      /[a-z]/.test(newPassword) &&
      /[0-9]/.test(newPassword);
    if(!strong)return json({error:"New password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number."},400);

    const {data:profile,error:profileErr}=await admin.from("users")
      .select("user_id,status")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(profileErr||!profile)return json({error:"CampusCare profile not found."},404);
    if(profile.status!=="Active")return json({error:"Only active accounts can reset their password."},403);

    // The once-every-7-days rule covers voluntary changes only; a forgotten password is always resettable.
    const {error:updateErr}=await admin.auth.admin.updateUserById(user.id,{password:newPassword});
    if(updateErr)return json({error:updateErr.message},400);

    await admin.from("audit_logs").insert({
      user_id:profile.user_id,
      action:"PASSWORD_RESET_COMPLETED",
      entity_type:"users",
      entity_id:profile.user_id,
      details:{method:"email_recovery"}
    });
    // A password change is always confirmed by email (through the Account notice).
    await admin.from("notifications").insert({
      user_id:profile.user_id,title:"Your password was changed",
      message:`Your CampusCare password was reset on ${new Date().toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"})}. If you did not do this, contact the clinic administrator right away.`,
      type:"Account",channel:"In-app",delivery_status:"Created",action_page:"my-account"
    });

    return json({ok:true,password_changed_at:new Date().toISOString()});
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unable to reset password."},500);
  }
});
