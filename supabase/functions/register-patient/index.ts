import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.117.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
};
const json=(body:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store",...extra}});
// Signup confirmations return to the deployed login flow.
// Re-enable confirmation for future registrations by setting this server secret to true.
const REQUIRE_EMAIL_CONFIRMATION=Deno.env.get("CAMPUSCARE_REQUIRE_EMAIL_CONFIRMATION")==="true";
const APP_CONFIRM_URL="https://campuscare-brown-two.vercel.app/?auth=confirmed";

// Only the public site key is returned to browsers. A half-configured widget fails closed.
function captchaConfiguration(){
  const siteKey=(Deno.env.get("TURNSTILE_SITE_KEY")||"").trim();
  const secret=(Deno.env.get("TURNSTILE_SECRET_KEY")||"").trim();
  const enabled=Boolean(siteKey||secret);
  const configured=!enabled||Boolean(siteKey&&secret&&!/^[123]x0/.test(siteKey)&&!/^[123]x0/.test(secret));
  return {siteKey,secret,enabled,configured};
}

// Hosted Supabase supplies CF-Connecting-IP at ingress. Never trust client-supplied X-Forwarded-For.
// Missing ingress metadata uses one shared anonymous bucket rather than disabling the limiter.
function registrationIp(req:Request){
  const ip=(req.headers.get("cf-connecting-ip")||"").trim().toLowerCase();
  return ip.length<=64&&/^[0-9a-f:.]+$/.test(ip)?ip:"unknown";
}
async function rateHash(value:string,secret:string){
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(value)));
  return Array.from(digest,byte=>byte.toString(16).padStart(2,"0")).join("");
}
async function registrationLimit(client:any,scope:string,value:string,secret:string){
  try{
    const {data,error}=await client.rpc("consume_registration_limit",{p_scope:scope,p_subject_hash:await rateHash(scope+":"+value,secret)});
    // Backend failure must not silently bypass the abuse controls.
    if(error||typeof data?.allowed!=="boolean")throw new Error("Rate store unavailable");
    if(!data.allowed){const retry=Math.max(1,Math.ceil(Number(data.retry_after)||60));return json({error:`Too many registration attempts. Please wait ${Math.ceil(retry/60)} minute(s) before trying again.`,retry_after:retry},429,{"Retry-After":String(retry)});}
    return null;
  }catch{return json({error:"Registration security is temporarily unavailable. Please try again shortly."},503);}
}
// Enforce the byte ceiling for streamed bodies too; Content-Length alone is caller-controlled.
async function registrationForm(req:Request){
  const reader=req.body?.getReader();
  if(!reader)return json({error:"Registration form is missing."},400);
  const parts:Uint8Array[]=[];let total=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
      if(total>26*1024*1024){await reader.cancel().catch(()=>{});return json({error:"Registration files are too large. Please use smaller photos."},413);}
      parts.push(value);
    }
    return await new Response(new Blob(parts),{headers:{"Content-Type":req.headers.get("content-type")||""}}).formData();
  }catch{return json({error:"The registration form could not be read. Please try again."},400);}
  finally{reader.releaseLock();}
}

async function validateCaptcha(config:ReturnType<typeof captchaConfiguration>,token:FormDataEntryValue|null){
  if(!config.configured)return json({error:"Registration security is temporarily unavailable. Please try again shortly."},503);
  if(!config.enabled)return null;
  if(typeof token!=="string"||!token.trim()||token.length>2048)return json({error:"Complete the security check before submitting your registration."},403);
  try{
    // Cloudflare enforces a five-minute lifetime and one-time use; hostname and action bind the token to this form.
    const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
      method:"POST",body:new URLSearchParams({secret:config.secret,response:token}),signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)throw new Error("Captcha provider unavailable");
    const result=await response.json();
    const hosts=(Deno.env.get("TURNSTILE_HOSTNAMES")||"campuscare-brown-two.vercel.app").split(",").map(x=>x.trim()).filter(x=>x&&x!=="localhost"&&x!=="127.0.0.1");
    if(result["error-codes"]?.some((code:string)=>["missing-input-secret","invalid-input-secret","internal-error"].includes(code)))throw new Error("Captcha configuration unavailable");
    if(result.success!==true||result.action!=="campuscare_register"||!hosts.includes(result.hostname))return json({error:"The security check expired or was unsuccessful. Please complete it again."},403);
    return null;
  }catch{return json({error:"The security check could not be verified. Please try again shortly."},503);}
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  const captcha=captchaConfiguration();
  if(req.method==="GET")return captcha.configured?json({captcha_required:captcha.enabled,site_key:captcha.enabled?captcha.siteKey:null}):json({error:"Registration security is temporarily unavailable. Please try again shortly."},503);
  if(req.method!=="POST") return json({error:"Method not allowed"},405);

  let cleanupId:string|null=null;
  let adminClient:any;
  let uploadedPaths:string[]=[];
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    adminClient=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const limited=await registrationLimit(adminClient,"ip",registrationIp(req),serviceKey);if(limited)return limited;
    // Bound request size before parsing large photos. Individual file limits are checked below too.
    const size=Number(req.headers.get("content-length")||0);
    if(size>26*1024*1024)return json({error:"Registration files are too large. Please use smaller photos."},413);
    if(!req.headers.get("content-type")?.includes("multipart/form-data"))return json({error:"Submit registration using the registration form."},400);
    const form=await registrationForm(req);if(form instanceof Response)return form;
    const email=String(form.get("email")||"").trim().toLowerCase();
    const password=String(form.get("password")||"");
    const metadataRaw=String(form.get("metadata")||"{}");
    const selfie=form.get("selfie");
    const verification=form.get("verification");
    const verificationBack=form.get("verification_back");

    if(!email||!password||!(selfie instanceof File)||!(verification instanceof File)||!(verificationBack instanceof File))
      return json({error:"Email, password, selfie, and front and back ID photos are required."},400);
    if(form.get("selfie_capture_source")!=="camera")return json({error:"Take a live camera verification selfie while holding your document."},400);
    if(!selfie.size||!verification.size||!verificationBack.size)return json({error:"Selfie and verification document must not be empty."},400);
    if(password.length<8) return json({error:"Password must contain at least 8 characters."},400);
    if(selfie.size>5*1024*1024) return json({error:"Verification selfie must be 5 MB or smaller."},400);
    if(verification.size>10*1024*1024||verificationBack.size>10*1024*1024) return json({error:"Verification document must be 10 MB or smaller."},400);
    if(!["image/jpeg","image/png","image/webp"].includes(selfie.type))
      return json({error:"Verification selfie must be JPG, PNG, or WebP."},400);
    if(!["image/jpeg","image/png","image/webp"].includes(verification.type)||!["image/jpeg","image/png","image/webp"].includes(verificationBack.type))
      return json({error:"Front and back ID photos must be JPG, PNG, or WebP. COR and PDF files are not accepted."},400);

    if(metadataRaw.length>16384)return json({error:"Registration details are too large."},400);
    let metadata:Record<string,unknown>={};
    try{metadata=JSON.parse(metadataRaw)}catch{return json({error:"Invalid registration metadata."},400)}
    if(!metadata||typeof metadata!=="object"||Array.isArray(metadata))return json({error:"Invalid registration metadata."},400);

    // Public registration always creates a Pending Patient; client metadata cannot select a role or workflow.
    metadata.registration_context="public";
    metadata.role="Patient";
    if(metadata.privacy_consent!==true)return json({error:"Privacy consent is required."},400);
    if(metadata.verification_document_type&&!["Student ID","Employee ID"].includes(String(metadata.verification_document_type)))return json({error:"Use a Student or Employee ID. COR is not accepted."},400);
    metadata.verification_document_type=metadata.person_type==="Student"?"Student ID":"Employee ID";
    // The two sides must be distinct evidence, not the exact same uploaded image twice.
    const frontDigest=new Uint8Array(await crypto.subtle.digest("SHA-256",await verification.arrayBuffer()));
    const backDigest=new Uint8Array(await crypto.subtle.digest("SHA-256",await verificationBack.arrayBuffer()));
    if(frontDigest.every((byte,index)=>byte===backDigest[index]))return json({error:"Use different photos for the front and back of your ID."},400);
    if(!metadata.birth_date && metadata.date_of_birth) metadata.birth_date=metadata.date_of_birth;
    if(!metadata.contact_number && metadata.contact_no) metadata.contact_number=metadata.contact_no;

    // Apply independent email and ID limits even when callers rotate networks.
    const schoolId=String(metadata.id_number||"").trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>150||!/^\d{5}(?:\d{2})?$/.test(schoolId))return json({error:"Enter a valid email and Student or Employee ID number."},400);
    const captchaError=await validateCaptcha(captcha,form.get("captcha_token"));if(captchaError)return captchaError;
    for(const [scope,value] of [["email",email],["id",schoolId]]){const denied=await registrationLimit(adminClient,scope,value,serviceKey);if(denied)return denied;}
    const publicClient=createClient(url,anonKey,{auth:{persistSession:false}});

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
    const verificationPath=`${uid}/id-front.${ext(verification)}`;
    const verificationBackPath=`${uid}/id-back.${ext(verificationBack)}`;

    const {error:selfieError}=await adminClient.storage.from("campuscare-verification").upload(selfiePath,selfie,{contentType:selfie.type,upsert:true});
    if(selfieError)throw new Error("Verification selfie could not be saved. Please try again.");
    uploadedPaths.push(selfiePath);

    const {error:verificationError}=await adminClient.storage.from("campuscare-verification").upload(verificationPath,verification,{contentType:verification.type,upsert:true});
    if(verificationError)throw new Error("Verification document could not be saved. Please try again.");
    uploadedPaths.push(verificationPath);
    const {error:backError}=await adminClient.storage.from("campuscare-verification").upload(verificationBackPath,verificationBack,{contentType:verificationBack.type,upsert:true});
    if(backError)throw new Error("Back ID photo could not be saved. Please try again.");
    uploadedPaths.push(verificationBackPath);

    const {data:profileRow,error:profileError}=await adminClient.from("users")
      .update({verification_selfie_url:selfiePath,id_file_url:verificationPath,id_back_file_url:verificationBackPath,profile_image_url:null,role:"Patient",status:"Pending",verified:false})
      .eq("auth_user_id",uid)
      .select("user_id")
      .maybeSingle();
    if(profileError||!profileRow)throw new Error("Registration files could not be linked. Please try again.");

    // Record the privacy acknowledgement separately from Auth metadata so
    // CampusCare has an auditable consent history for each privacy version.
    if(profileRow?.user_id && metadata.privacy_consent===true){
      const version=String(metadata.privacy_policy_version||"1.0").slice(0,40);
      const ip=registrationIp(req)==="unknown"?null:registrationIp(req);

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
