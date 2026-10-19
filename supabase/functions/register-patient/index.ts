import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.117.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
// Signup confirmations return to the deployed login flow.
const APP_CONFIRM_URL="https://campuscare-brown-two.vercel.app/?auth=confirmed";

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);

  try{
    const form=await req.formData();
    const email=String(form.get("email")||"").trim().toLowerCase();
    const password=String(form.get("password")||"");
    const metadataRaw=String(form.get("metadata")||"{}");
    const selfie=form.get("selfie");
    const verification=form.get("verification");

    if(!email||!password||!(selfie instanceof File)||!(verification instanceof File))
      return json({error:"Email, password, selfie, and verification document are required."},400);
    if(password.length<8) return json({error:"Password must contain at least 8 characters."},400);
    if(selfie.size>5*1024*1024) return json({error:"Profile photo must be 5 MB or smaller."},400);
    if(verification.size>10*1024*1024) return json({error:"Verification document must be 10 MB or smaller."},400);
    if(!["image/jpeg","image/png","image/webp"].includes(selfie.type))
      return json({error:"Profile photo must be JPG, PNG, or WebP."},400);
    if(!["image/jpeg","image/png","image/webp","application/pdf"].includes(verification.type))
      return json({error:"Verification document must be JPG, PNG, WebP, or PDF."},400);

    let metadata:Record<string,unknown>={};
    try{metadata=JSON.parse(metadataRaw)}catch{return json({error:"Invalid registration metadata."},400)}

    if(!metadata.birth_date && metadata.date_of_birth) metadata.birth_date=metadata.date_of_birth;
    if(!metadata.contact_number && metadata.contact_no) metadata.contact_number=metadata.contact_no;

    const url=Deno.env.get("SUPABASE_URL")!;
    const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publicClient=createClient(url,anonKey,{auth:{persistSession:false}});
    const adminClient=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const username=String(metadata.username||"").trim();
    const {data:existingEmail}=await adminClient.from("users").select("user_id").ilike("email",email).limit(1);
    if(existingEmail?.length) return json({error:"This email address is already registered."},409);
    if(username){
      const {data:existingUsername}=await adminClient.from("users").select("user_id").ilike("username",username).limit(1);
      if(existingUsername?.length) return json({error:"This username is already taken."},409);
    }

    const {data:signup,error:signupError}=await publicClient.auth.signUp({
      email,
      password,
      options:{data:metadata,emailRedirectTo:APP_CONFIRM_URL}
    });
    if(signupError) return json({error:signupError.message},400);
    const uid=signup.user?.id;
    if(!uid) return json({error:"Registration account could not be created."},500);

    const ext=(file:File)=>{
      const map:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"};
      return map[file.type]||"bin";
    };
    const selfiePath=`${uid}/profile.${ext(selfie)}`;
    const verificationPath=`${uid}/verification.${ext(verification)}`;

    const {error:selfieError}=await adminClient.storage.from("campuscare-profiles").upload(selfiePath,selfie,{contentType:selfie.type,upsert:true});
    if(selfieError) return json({error:`Account created, but profile photo upload failed: ${selfieError.message}`},500);

    const {error:verificationError}=await adminClient.storage.from("campuscare-verification").upload(verificationPath,verification,{contentType:verification.type,upsert:true});
    if(verificationError){
      await adminClient.storage.from("campuscare-profiles").remove([selfiePath]);
      return json({error:`Account created, but verification upload failed: ${verificationError.message}`},500);
    }

    const {data:profileRow,error:profileError}=await adminClient.from("users")
      .update({profile_image_url:selfiePath,id_file_url:verificationPath,status:"Pending",verified:false})
      .eq("auth_user_id",uid)
      .select("user_id")
      .maybeSingle();
    if(profileError) return json({error:`Files uploaded, but profile linking failed: ${profileError.message}`},500);

    // Record the privacy acknowledgement separately from Auth metadata so
    // CampusCare has an auditable consent history for each privacy version.
    if(profileRow?.user_id && metadata.privacy_consent===true){
      const version=String(metadata.privacy_policy_version||"1.0").slice(0,40);
      const forwarded=req.headers.get("x-forwarded-for")||req.headers.get("cf-connecting-ip")||"";
      const ip=forwarded.split(",")[0].trim()||null;

      await adminClient.from("privacy_consents").insert({
        user_id:profileRow.user_id,
        privacy_version:version,
        consented:true,
        event_type:"Registration Acknowledgement",
        notes:null,
        ip_address:ip,
        user_agent:req.headers.get("user-agent")
      });
    }

    return json({ok:true,user_id:uid,email_confirmation_required:!signup.session});
  }catch(e){
    return json({error:e instanceof Error?e.message:"Registration failed."},500);
  }
});
