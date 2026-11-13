import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const SEVEN_DAYS_MS=7*24*60*60*1000;

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({error:"Authentication required."},401);

    const token=auth.slice(7);
    const {data:{user},error:userErr}=await admin.auth.getUser(token);
    if(userErr||!user)return json({error:"Invalid session."},401);

    const body=await req.json();
    const currentPassword=String(body.current_password||"");
    const newPassword=String(body.new_password||"");

    if(!currentPassword||!newPassword)return json({error:"Current and new password are required."},400);
    if(currentPassword===newPassword)return json({error:"Your new password must be different from your current password."},400);

    const strong=
      newPassword.length>=8 &&
      /[A-Z]/.test(newPassword) &&
      /[a-z]/.test(newPassword) &&
      /[0-9]/.test(newPassword);
    if(!strong)return json({error:"New password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number."},400);

    const {data:profile,error:profileErr}=await admin.from("users")
      .select("user_id,email,status,password_changed_at")
      .eq("auth_user_id",user.id)
      .maybeSingle();
    if(profileErr||!profile)return json({error:"CampusCare profile not found."},404);
    if(profile.status!=="Active")return json({error:"Only active accounts can change passwords."},403);

    // A new doctor or staff account must replace its emailed password first; that change is never on cooldown.
    const firstChange=user.app_metadata?.must_change_password===true;
    if(profile.password_changed_at&&!firstChange){
      const last=new Date(profile.password_changed_at).getTime();
      const next=last+SEVEN_DAYS_MS;
      if(Date.now()<next){
        return json({
          error:"Password changes are limited to once every 7 days.",
          next_allowed_at:new Date(next).toISOString()
        },429);
      }
    }

    // Verify the current password using a separate short-lived auth client.
    const verifier=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {error:verifyErr}=await verifier.auth.signInWithPassword({
      email:profile.email,
      password:currentPassword
    });
    if(verifyErr)return json({error:"Current password is incorrect."},401);

    const {error:updateErr}=await admin.auth.admin.updateUserById(user.id,{
      password:newPassword,
      ...(firstChange?{app_metadata:{...(user.app_metadata||{}),must_change_password:false}}:{})
    });
    if(updateErr)return json({error:updateErr.message},400);

    // The auth.users password trigger updates password_changed_at.
    await admin.from("audit_logs").insert({
      user_id:profile.user_id,
      action:"PASSWORD_CHANGED",
      entity_type:"users",
      entity_id:profile.user_id,
      details:{method:firstChange?"first_sign_in":"account_settings",cooldown_days:7}
    });
    // Like other sites, a password change is always confirmed by email (through the Account notice).
    await admin.from("notifications").insert({
      user_id:profile.user_id,title:"Your password was changed",
      message:`Your CampusCare password was changed on ${new Date().toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"})}. If you did not do this, contact the clinic administrator right away.`,
      type:"Account",channel:"In-app",delivery_status:"Created",action_page:"my-account"
    });

    return json({ok:true,password_changed_at:new Date().toISOString()});
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unable to change password."},500);
  }
});
