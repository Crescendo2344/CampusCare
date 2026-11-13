import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import {emailValidationError,normalizePhilippineMobile} from "../_shared/contact-validation.js";
import {renderCampusCareEmail} from "../_shared/email-layout.js";

// Signed-in people update their own contact number here. No extra code is asked: they are already
// signed in, and the number is contact information, not a sign-in method.
// The email is the sign-in address, so changing it needs a 6-digit code sent to the current address:
// only the account owner can move the sign-in email elsewhere.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

const CODE_MINUTES=10,MAX_TRIES=5,RESEND_SECONDS=60,MAX_SENDS_PER_HOUR=5;
const sixDigits=()=>{const b=new Uint32Array(1);do crypto.getRandomValues(b);while(b[0]>=4294000000);return String(b[0]%1000000).padStart(6,"0");};
const hashCode=async(userId:number,code:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${userId}:${code}`)))].map(x=>x.toString(16).padStart(2,"0")).join("");

// Queue an email and ask email-dispatch to send it now; the 5-minute job retries if this attempt fails.
const sendEmail=async(admin:any,url:string,mail:{userId:number,to:string,subject:string,html:string,text:string,template:string})=>{
  const {error}=await admin.from("email_outbox").insert({user_id:mail.userId,recipient_email:mail.to,subject:mail.subject,html_body:mail.html,text_body:mail.text,template_key:mail.template,status:"Pending",scheduled_at:new Date().toISOString()});
  if(error)throw error;
  try{
    const {data:cfg}=await admin.from("email_dispatch_config").select("dispatch_key").eq("config_id",1).maybeSingle();
    if(cfg?.dispatch_key)await fetch(`${url}/functions/v1/email-dispatch`,{method:"POST",headers:{"Content-Type":"application/json","X-Dispatch-Key":cfg.dispatch_key},body:JSON.stringify({action:"dispatch"}),signal:AbortSignal.timeout(8000)});
  }catch{ /* queued; the scheduled job sends it */ }
};

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

    const {data:actor}=await admin.from("users").select("user_id,status,contact_number,email,first_name").eq("auth_user_id",user.id).maybeSingle();
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
      if(actor.email){
        const masked=(v:string)=>v?v.slice(0,-4).replace(/\d/g,"•")+v.slice(-4):"none";
        const mail=renderCampusCareEmail({title:"Your mobile number was changed",label:"Account update",tone:"info",name:actor.first_name||"there",
          paragraphs:["The mobile number on your CampusCare account was updated. The clinic uses it to reach you about appointments."],
          rows:[["Previous number",masked(actor.contact_number||"")],["New number",masked(contact)]],button:null,
          note:"If you did not make this change, contact the clinic administrator right away."});
        await sendEmail(admin,url,{userId:actor.user_id,to:actor.email,template:"account",subject:"CampusCare · Your mobile number was changed",html:mail.html,text:mail.text}).catch(()=>{});
      }
      return json({ok:true,contact_number:contact});
    }

    // Step 1: send a 6-digit code to the current email. Nothing changes until the code is entered.
    if(action==="request_email_change"){
      const email=String(body.email||"").trim().toLowerCase();
      const invalid=email?emailValidationError(email):"Enter an email address.";
      if(invalid)return json({error:invalid},400);
      if(email===String(actor.email||"").toLowerCase())return json({error:"That is already your email."},400);
      if(!actor.email)return json({error:"Your account has no current email to send a code to. Ask the clinic administrator to update it."},409);
      const literal=email.replace(/[\\%_]/g,"\\$&");
      const {data:taken}=await admin.from("users").select("user_id").ilike("email",literal).neq("user_id",actor.user_id).limit(1);
      if(taken?.length)return json({error:"This email address is already registered."},409);
      const {data:pending}=await admin.from("contact_change_codes").select("sends,window_started_at,last_sent_at").eq("user_id",actor.user_id).eq("channel","email").maybeSingle();
      const nowMs=Date.now();
      if(pending){
        const wait=RESEND_SECONDS-Math.floor((nowMs-Date.parse(pending.last_sent_at))/1000);
        if(wait>0)return json({error:`Please wait ${wait} seconds before asking for another code.`,retry_after:wait},429);
      }
      const freshWindow=!pending||nowMs-Date.parse(pending.window_started_at)>3600*1000;
      const sends=freshWindow?1:Number(pending.sends)+1;
      if(sends>MAX_SENDS_PER_HOUR)return json({error:"Too many codes requested. Try again in an hour."},429);
      const code=sixDigits();
      const {error:saveErr}=await admin.from("contact_change_codes").upsert({
        user_id:actor.user_id,channel:"email",new_value:email,code_hash:await hashCode(actor.user_id,code),attempts:0,sends,
        window_started_at:freshWindow?new Date(nowMs).toISOString():pending.window_started_at,
        last_sent_at:new Date(nowMs).toISOString(),expires_at:new Date(nowMs+CODE_MINUTES*60000).toISOString()
      },{onConflict:"user_id,channel"});
      if(saveErr)throw saveErr;
      {const mail=renderCampusCareEmail({title:"Confirm your new sign-in email",label:"Security code",tone:"info",name:actor.first_name||"there",
        paragraphs:[`You asked to change your CampusCare sign-in email to ${email}. Enter this code in CampusCare to confirm.`],code,
        rows:[["New email",email],["Code expires",`In ${CODE_MINUTES} minutes`]],button:null,
        note:"If you did not ask for this, ignore this email and your sign-in email stays the same. Consider changing your password."});
      await sendEmail(admin,url,{userId:actor.user_id,to:actor.email,template:"verification",subject:"CampusCare · Code to change your sign-in email",html:mail.html,text:mail.text});}
      return json({ok:true,email,sent_to:actor.email,expires_in:CODE_MINUTES*60,resend_after:RESEND_SECONDS});
    }

    // Step 2: the code matches, so the new email becomes the sign-in address.
    if(action==="confirm_email_change"){
      const code=String(body.code||"").replace(/\D/g,"");
      if(code.length!==6)return json({error:"Enter the 6-digit code."},400);
      const {data:pending}=await admin.from("contact_change_codes").select("new_value,code_hash,attempts,expires_at").eq("user_id",actor.user_id).eq("channel","email").maybeSingle();
      if(!pending)return json({error:"Ask for a new code first."},409);
      if(Date.parse(pending.expires_at)<Date.now()){
        await admin.from("contact_change_codes").delete().eq("user_id",actor.user_id).eq("channel","email");
        return json({error:"This code has expired. Ask for a new one."},410);
      }
      if(await hashCode(actor.user_id,code)!==pending.code_hash){
        const attempts=Number(pending.attempts)+1;
        if(attempts>=MAX_TRIES){
          await admin.from("contact_change_codes").delete().eq("user_id",actor.user_id).eq("channel","email");
          return json({error:"Too many wrong codes. Ask for a new one."},429);
        }
        await admin.from("contact_change_codes").update({attempts}).eq("user_id",actor.user_id).eq("channel","email");
        return json({error:`That code is not right. ${MAX_TRIES-attempts} tr${MAX_TRIES-attempts===1?"y":"ies"} left.`},400);
      }
      const email=pending.new_value,previous=String(actor.email||"");
      const {data:taken}=await admin.from("users").select("user_id").eq("email",email).neq("user_id",actor.user_id).limit(1);
      if(taken?.length)return json({error:"This email address is already registered."},409);
      const {error:authErr}=await admin.auth.admin.updateUserById(user.id,{email,email_confirm:true});
      if(authErr)return json({error:authErr.message},400);
      const {error:profileErr}=await admin.from("users").update({email}).eq("user_id",actor.user_id);
      if(profileErr)throw profileErr;
      await admin.from("contact_change_codes").delete().eq("user_id",actor.user_id).eq("channel","email");
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"USER_EMAIL_CHANGED",entity_type:"users",entity_id:actor.user_id,details:{previous_email:previous||null,new_email:email,verified_by:"code_to_current_email"}});
      // The new address is welcomed, and the previous one is told, as other sites do for sign-in changes.
      {const welcome=renderCampusCareEmail({title:"This is now your sign-in email",label:"Account update",tone:"success",name:actor.first_name||"there",
        paragraphs:["Your CampusCare sign-in email was changed to this address. Sign in with it from now on."],
        rows:[["Previous email",previous],["New email",email]],button:{label:"Sign in to CampusCare"},
        note:"If you did not make this change, contact the clinic administrator right away."});
      await sendEmail(admin,url,{userId:actor.user_id,to:email,template:"account",subject:"CampusCare · This is now your sign-in email",html:welcome.html,text:welcome.text}).catch(()=>{});
      if(previous&&previous.toLowerCase()!==email.toLowerCase()){
        const notice=renderCampusCareEmail({title:"Your sign-in email was changed",label:"Security",tone:"warning",name:actor.first_name||"there",
          paragraphs:[`The sign-in email on your CampusCare account was changed to ${email}. CampusCare emails will go to the new address from now on.`],
          button:null,note:"If you did not make this change, contact the clinic administrator right away."});
        await sendEmail(admin,url,{userId:actor.user_id,to:previous,template:"account",subject:"CampusCare · Your sign-in email was changed",html:notice.html,text:notice.text}).catch(()=>{});
      }}
      return json({ok:true,email});
    }

    return json({error:"Unsupported action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unable to update your profile."},500);
  }
});
