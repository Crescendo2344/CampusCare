import {createClient} from "https://esm.sh/@supabase/supabase-js@2.117.3";
import nodemailer from "npm:nodemailer@6.9.16";
import {createMailer} from "../_shared/email-transport.js";

// Sends the email_outbox queue. Called every 5 minutes by the campuscare-email-dispatch job
// (X-Dispatch-Key), right after a reminder is pressed, and by administrators from Settings.
const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-dispatch-key",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const now=()=>new Date().toISOString();

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  try{
    const admin=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {auth:{persistSession:false,autoRefreshToken:false}}
    );

    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"dispatch").toLowerCase();

    let actor:any=null;
    let internal=false;

    const dispatchKey=req.headers.get("X-Dispatch-Key")||"";
    if(dispatchKey){
      const {data:config}=await admin.from("email_dispatch_config")
        .select("dispatch_key").eq("config_id",1).maybeSingle();
      internal=Boolean(config?.dispatch_key&&dispatchKey===config.dispatch_key);
    }

    if(!internal){
      const auth=req.headers.get("Authorization")||"";
      if(!auth.startsWith("Bearer "))return json({error:"Authentication required."},401);

      const {data:{user},error:userErr}=await admin.auth.getUser(auth.slice(7));
      if(userErr||!user)return json({error:"Invalid session."},401);

      const {data:profile}=await admin.from("users")
        .select("user_id,role,status,email,first_name,last_name")
        .eq("auth_user_id",user.id)
        .maybeSingle();

      if(!profile||profile.status!=="Active")return json({error:"Active CampusCare account required."},403);
      if(profile.role!=="Administrator")return json({error:"Administrator access required."},403);
      actor=profile;
    }

    const mailer=createMailer({env:(name:string)=>Deno.env.get(name),createTransport:nodemailer.createTransport});
    const {configured,provider,from:fromAddress}=mailer.settings;

    if(action==="status"||action==="list"){
      const {data:rows,error}=await admin.from("email_outbox")
        .select("email_id,user_id,notification_id,recipient_email,subject,template_key,status,attempt_count,last_error,provider_message_id,scheduled_at,sent_at,created_at,updated_at")
        .order("email_id",{ascending:false})
        .limit(100);
      if(error)throw error;

      const count=async(status:string)=>(await admin.from("email_outbox")
        .select("email_id",{count:"exact",head:true}).eq("status",status)).count||0;
      const [pending,failed,sent]=await Promise.all([count("Pending"),count("Failed"),count("Sent")]);

      return json({
        ok:true,
        configured,
        provider,
        from_address:configured?fromAddress:null,
        counts:{pending,failed,sent},
        emails:rows||[]
      });
    }

    if(action==="test"){
      if(!actor)return json({error:"Administrator authentication required."},401);
      const recipient=String(body.recipient_email||actor.email||"").trim();
      if(!recipient)return json({error:"Recipient email is required."},400);

      const subject="CampusCare Email Delivery Test";
      const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f7fb;padding:24px">
        <div style="max-width:620px;margin:auto;background:#fff;border-radius:14px;padding:26px;border:1px solid #e5e7eb">
          <h2 style="color:#0b6b3a;margin-top:0">CampusCare Email Delivery Test</h2>
          <p>This message confirms that the CampusCare operational email provider is configured correctly.</p>
          <p><strong>CTU Main Medical & Dental Clinic</strong><br>Ground Floor, Education Building, CTU Main Campus</p>
        </div></body></html>`;

      const {data:row,error}=await admin.from("email_outbox").insert({
        user_id:actor.user_id,
        recipient_email:recipient,
        subject,
        html_body:html,
        text_body:"CampusCare Email Delivery Test. CTU Main Medical & Dental Clinic, Ground Floor, Education Building, CTU Main Campus.",
        template_key:"test",
        status:"Pending",
        scheduled_at:now()
      }).select("email_id").single();
      if(error)throw error;

      if(!configured){
        return json({
          ok:true,
          configured:false,
          queued:true,
          email_id:row.email_id,
          message:"Test email queued. Add the SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and CAMPUSCARE_EMAIL_FROM secrets to enable delivery."
        });
      }
    }

    if(action==="retry"){
      if(!actor)return json({error:"Administrator authentication required."},401);
      const emailId=Number(body.email_id||0);
      if(!emailId)return json({error:"Email ID is required."},400);

      const {error}=await admin.from("email_outbox").update({
        status:"Pending",
        scheduled_at:now(),
        last_error:null,
        updated_at:now()
      }).eq("email_id",emailId);
      if(error)throw error;

      return json({ok:true});
    }

    if(action!=="dispatch"&&action!=="test")
      return json({error:"Unsupported email action."},400);

    const {data:queue,error:queueErr}=await admin.from("email_outbox")
      .select("email_id,user_id,recipient_email,subject,html_body,text_body,template_key,status,attempt_count")
      .eq("status","Pending")
      .lte("scheduled_at",now())
      .order("email_id",{ascending:true})
      .limit(20);

    if(queueErr)throw queueErr;

    if(!configured){
      return json({
        ok:true,
        configured:false,
        queued:(queue||[]).length,
        processed:0,
        message:"Email provider is not configured. Pending emails remain safely queued."
      });
    }

    let sent=0,failed=0,fallbacks=0;

    try{
      for(const mail of queue||[]){
        const attempt=Number(mail.attempt_count||0)+1;
        await admin.from("email_outbox").update({
          status:"Sending",
          attempt_count:attempt,
          updated_at:now()
        }).eq("email_id",mail.email_id);

        try{
          const result=await mailer.send({to:mail.recipient_email,subject:mail.subject,html:mail.html_body,text:mail.text_body});
          if(result.fallbackReason){fallbacks++;console.warn("SMTP unavailable, sent through Resend API:",result.fallbackReason);}

          // A new account's emailed password is not kept once it has been delivered.
          const secret=mail.template_key==="credentials";
          await admin.from("email_outbox").update({
            status:"Sent",
            sent_at:now(),
            provider_message_id:result.id,
            last_error:null,
            ...(secret?{html_body:"<p>Sign-in details were delivered. The password is not stored.</p>",text_body:"Sign-in details were delivered. The password is not stored."}:{}),
            updated_at:now()
          }).eq("email_id",mail.email_id);

          sent++;
        }catch(e){
          const message=e instanceof Error?e.message:String(e);
          const finalFailure=attempt>=3;

          await admin.from("email_outbox").update({
            status:finalFailure?"Failed":"Pending",
            scheduled_at:finalFailure?now():new Date(Date.now()+15*60*1000).toISOString(),
            last_error:message.slice(0,2000),
            updated_at:now()
          }).eq("email_id",mail.email_id);

          failed++;
        }
      }
    }finally{
      mailer.close();
    }

    if(actor&&sent+failed>0){
      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"EMAIL_QUEUE_DISPATCHED",
        entity_type:"email_outbox",
        entity_id:null,
        details:{sent,failed,provider,fallbacks}
      });
    }

    return json({ok:true,configured:true,provider,processed:(queue||[]).length,sent,failed,fallbacks});
  }catch(e){
    return json({error:e instanceof Error?e.message:"Email dispatch failed."},500);
  }
});
