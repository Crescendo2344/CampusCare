import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.117.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
// Signup confirmations return to the deployed login flow.
// Re-enable confirmation for future registrations by setting this server secret to true.
const REQUIRE_EMAIL_CONFIRMATION=Deno.env.get("CAMPUSCARE_REQUIRE_EMAIL_CONFIRMATION")==="true";
const APP_CONFIRM_URL="https://campuscare-brown-two.vercel.app/?auth=confirmed";

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);

  let cleanupId:string|null=null;
  let adminClient:any;
  let uploadedPaths:string[]=[];
  try{
    const form=await req.formData();
    const email=String(form.get("email")||"").trim().toLowerCase();
    const password=String(form.get("password")||"");
    const metadataRaw=String(form.get("metadata")||"{}");
    const selfie=form.get("selfie");
    const verification=form.get("verification");

    if(!email||!password||!(selfie instanceof File)||!(verification instanceof File))
      return json({error:"Email, password, selfie, and verification document are required."},400);
    if(form.get("selfie_capture_source")!=="camera")return json({error:"Take a live camera verification selfie while holding your document."},400);
    if(!selfie.size||!verification.size)return json({error:"Selfie and verification document must not be empty."},400);
    if(password.length<8) return json({error:"Password must contain at least 8 characters."},400);
    if(selfie.size>5*1024*1024) return json({error:"Verification selfie must be 5 MB or smaller."},400);
    if(verification.size>10*1024*1024) return json({error:"Verification document must be 10 MB or smaller."},400);
    if(!["image/jpeg","image/png","image/webp"].includes(selfie.type))
      return json({error:"Verification selfie must be JPG, PNG, or WebP."},400);
    if(!["image/jpeg","image/png","image/webp","application/pdf"].includes(verification.type))
      return json({error:"Verification document must be JPG, PNG, WebP, or PDF."},400);

    let metadata:Record<string,unknown>={};
    try{metadata=JSON.parse(metadataRaw)}catch{return json({error:"Invalid registration metadata."},400)}
    if(!metadata||typeof metadata!=="object"||Array.isArray(metadata))return json({error:"Invalid registration metadata."},400);

    // Public registration always creates a Pending Patient; client metadata cannot select a role or workflow.
    metadata.registration_context="public";
    metadata.role="Patient";
    if(metadata.privacy_consent!==true)return json({error:"Privacy consent is required."},400);
    if(!metadata.birth_date && metadata.date_of_birth) metadata.birth_date=metadata.date_of_birth;
    if(!metadata.contact_number && metadata.contact_no) metadata.contact_number=metadata.contact_no;

    const url=Deno.env.get("SUPABASE_URL")!;
    const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publicClient=createClient(url,anonKey,{auth:{persistSession:false}});
    adminClient=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const username=String(metadata.username||"").trim();
    const {data:existingEmail}=await adminClient.from("users").select("user_id").ilike("email",email).limit(1);
    if(existingEmail?.length) return json({error:"This email address is already registered."},409);
    if(username){
      const {data:existingUsername}=await adminClient.from("users").select("user_id").ilike("username",username).limit(1);
      if(existingUsername?.length) return json({error:"This username is already taken."},409);
    }

    // The temporary bypass sends no signup email. Clinic approval is still enforced by the profile status.
    const {data:signup,error:signupError}=REQUIRE_EMAIL_CONFIRMATION
      ? await publicClient.auth.signUp({email,password,options:{data:metadata,emailRedirectTo:APP_CONFIRM_URL}})
      : await adminClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:metadata,app_metadata:{email_verification_skipped:true}});
    if(signupError)return json({error:signupError.message},400);
    const uid=signup.user?.id;
    if(!uid)return json({error:"Registration account could not be created."},500);
    if(REQUIRE_EMAIL_CONFIRMATION&&signup.user?.identities?.length===0)return json({error:"This email address is already registered."},409);
    cleanupId=uid;

    const ext=(file:File)=>{
      const map:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"};
      return map[file.type]||"bin";
    };
    const selfiePath=`${uid}/selfie-verification.${ext(selfie)}`;
    const verificationPath=`${uid}/verification.${ext(verification)}`;

    const {error:selfieError}=await adminClient.storage.from("campuscare-verification").upload(selfiePath,selfie,{contentType:selfie.type,upsert:true});
    if(selfieError)throw new Error("Verification selfie could not be saved. Please try again.");
    uploadedPaths.push(selfiePath);

    const {error:verificationError}=await adminClient.storage.from("campuscare-verification").upload(verificationPath,verification,{contentType:verification.type,upsert:true});
    if(verificationError)throw new Error("Verification document could not be saved. Please try again.");
    uploadedPaths.push(verificationPath);

    const {data:profileRow,error:profileError}=await adminClient.from("users")
      .update({verification_selfie_url:selfiePath,id_file_url:verificationPath,profile_image_url:null,role:"Patient",status:"Pending",verified:false})
      .eq("auth_user_id",uid)
      .select("user_id")
      .maybeSingle();
    if(profileError||!profileRow)throw new Error("Registration files could not be linked. Please try again.");

    // Record the privacy acknowledgement separately from Auth metadata so
    // CampusCare has an auditable consent history for each privacy version.
    if(profileRow?.user_id && metadata.privacy_consent===true){
      const version=String(metadata.privacy_policy_version||"1.0").slice(0,40);
      const forwarded=req.headers.get("x-forwarded-for")||req.headers.get("cf-connecting-ip")||"";
      const ip=forwarded.split(",")[0].trim()||null;

      const {error:consentError}=await adminClient.from("privacy_consents").insert({
        user_id:profileRow.user_id,
        privacy_version:version,
        consented:true,
        event_type:"Registration Acknowledgement",
        notes:null,
        ip_address:ip,
        user_agent:req.headers.get("user-agent")
      });
      if(consentError)throw new Error("Privacy consent could not be saved. Please try again.");
    }

    cleanupId=null;
    return json({ok:true,user_id:uid,email_confirmation_required:REQUIRE_EMAIL_CONFIRMATION});
  }catch(e){
    // Do not leave an unusable account or private uploads after a partial registration failure.
    if(cleanupId&&adminClient){
      if(uploadedPaths.length)await adminClient.storage.from("campuscare-verification").remove(uploadedPaths);
      await adminClient.auth.admin.deleteUser(cleanupId);
    }
    return json({error:e instanceof Error?e.message:"Registration failed."},500);
  }
});
