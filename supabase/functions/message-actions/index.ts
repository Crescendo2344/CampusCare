// Mobile attachment parsing is shared with regression tests; authorization stays in this handler.
import {parseMessageDataUrl as parseDataUrl} from '../_shared/message-attachment.js';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=4000)=>String(v??"").trim().slice(0,max);
const safeName=(name:string)=>name.replace(/[^A-Za-z0-9._-]+/g,"_").slice(0,120)||"attachment";

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed."},405);

  try{
    const admin=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {auth:{persistSession:false,autoRefreshToken:false}}
    );

    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer "))return json({error:"Authentication required."},401);

    const {data:{user},error:userErr}=await admin.auth.getUser(auth.slice(7));
    if(userErr||!user)return json({error:"Invalid session."},401);

    const {data:actor}=await admin.from("users")
      .select("user_id,role,status,first_name,last_name")
      .eq("auth_user_id",user.id).maybeSingle();

    if(!actor||actor.status!=="Active")
      return json({error:"Active CampusCare account required."},403);

    const body=await req.json();
    const action=String(body.action||"list").toLowerCase();

    const ensureRecipientAllowed=async(toUserId:number)=>{
      if(!toUserId||toUserId===actor.user_id)throw new Error("Choose another CampusCare user.");

      const {data:recipient}=await admin.from("users")
        .select("user_id,role,status,first_name,last_name")
        .eq("user_id",toUserId).maybeSingle();

      if(!recipient||recipient.status!=="Active")throw new Error("Recipient is unavailable.");

      if(actor.role==="Patient"){
        if(!["Doctor","Staff","Administrator"].includes(recipient.role))
          throw new Error("Patients can message active Doctors, clinic Staff, or Administrators.");
      }else if(actor.role==="Doctor"&&recipient.role==="Patient"){
        const {data:patient}=await admin.from("patients")
          .select("patient_id").eq("user_id",recipient.user_id).maybeSingle();
        if(!patient)throw new Error("Patient record not found.");

        const [{count:apptCount},{count:treatCount}]=await Promise.all([
          admin.from("appointments").select("appointment_id",{count:"exact",head:true})
            .eq("patient_id",patient.patient_id).eq("doctor_id",actor.user_id),
          admin.from("treatments").select("treatment_id",{count:"exact",head:true})
            .eq("patient_id",patient.patient_id).eq("doctor_id",actor.user_id)
        ]);

        if(Number(apptCount||0)+Number(treatCount||0)===0)
          throw new Error("Doctors can start secure chats only with patients linked to their care.");
      }

      return recipient;
    };

    const listAllowedContacts=async()=>{
      let users:any[]=[];

      if(actor.role==="Patient"){
        const {data,error}=await admin.from("users")
          .select("user_id,first_name,last_name,role,status,specialty,profile_image_url")
          .eq("status","Active")
          .in("role",["Doctor","Staff","Administrator"])
          .neq("user_id",actor.user_id)
          .order("role",{ascending:true})
          .order("first_name",{ascending:true});
        if(error)throw error;
        users=data||[];
      }else if(actor.role==="Doctor"){
        const {data:staffUsers,error:staffErr}=await admin.from("users")
          .select("user_id,first_name,last_name,role,status,specialty,profile_image_url")
          .eq("status","Active")
          .in("role",["Doctor","Staff","Administrator"])
          .neq("user_id",actor.user_id);
        if(staffErr)throw staffErr;

        const [{data:apptRows,error:apptErr},{data:treatRows,error:treatErr}]=await Promise.all([
          admin.from("appointments").select("patient_id").eq("doctor_id",actor.user_id),
          admin.from("treatments").select("patient_id").eq("doctor_id",actor.user_id)
        ]);
        if(apptErr)throw apptErr;
        if(treatErr)throw treatErr;

        const patientIds=[...new Set([
          ...(apptRows||[]).map((x:any)=>Number(x.patient_id)),
          ...(treatRows||[]).map((x:any)=>Number(x.patient_id))
        ].filter(Boolean))];

        let patientUsers:any[]=[];
        if(patientIds.length){
          const {data:patients,error:patientErr}=await admin.from("patients")
            .select("patient_id,user_id")
            .in("patient_id",patientIds)
            .is("archived_at",null);
          if(patientErr)throw patientErr;

          const patientUserIds=[...new Set((patients||[]).map((p:any)=>Number(p.user_id)).filter(Boolean))];
          if(patientUserIds.length){
            const {data,error}=await admin.from("users")
              .select("user_id,first_name,last_name,role,status,specialty,profile_image_url")
              .in("user_id",patientUserIds)
              .eq("status","Active")
              .eq("role","Patient");
            if(error)throw error;
            patientUsers=data||[];
          }
        }

        const byId=new Map<number,any>();
        for(const u of [...(staffUsers||[]),...patientUsers])byId.set(Number(u.user_id),u);
        users=[...byId.values()];
      }else{
        const {data,error}=await admin.from("users")
          .select("user_id,first_name,last_name,role,status,specialty,profile_image_url")
          .eq("status","Active")
          .neq("user_id",actor.user_id)
          .order("role",{ascending:true})
          .order("first_name",{ascending:true});
        if(error)throw error;
        users=data||[];
      }

      const contacts:any[]=[];
      for(const u of users){
        let profile_signed_url:string|null=null;
        if(u.profile_image_url){
          const {data:signed}=await admin.storage
            .from("campuscare-profiles")
            .createSignedUrl(u.profile_image_url,1800);
          profile_signed_url=signed?.signedUrl||null;
        }
        contacts.push({
          user_id:u.user_id,
          first_name:u.first_name,
          last_name:u.last_name,
          role:u.role,
          status:u.status,
          specialty:u.specialty,
          profile_signed_url
        });
      }
      return contacts;
    };

    if(action==="list"){
      const {data:hidden,error:hiddenErr}=await admin.from("message_hidden")
        .select("message_id").eq("user_id",actor.user_id);
      if(hiddenErr)throw hiddenErr;

      const hiddenIds=new Set((hidden||[]).map((x:any)=>Number(x.message_id)));

      const {data:rows,error}=await admin.from("messages")
        .select("message_id,from_user_id,to_user_id,subject,body,reply_to_id,is_read,created_at,attachment_path,attachment_name,attachment_type,attachment_mime,attachment_size,edited_at,deleted_for_everyone,deleted_at,forwarded_from_id")
        .or(`from_user_id.eq.${actor.user_id},to_user_id.eq.${actor.user_id}`)
        .order("created_at",{ascending:true})
        .limit(1000);

      if(error)throw error;

      const messages:any[]=[];
      for(const row of rows||[]){
        if(hiddenIds.has(Number(row.message_id)))continue;
        let attachment_url:string|null=null;

        if(row.attachment_path&&!row.deleted_for_everyone){
          const {data:signed}=await admin.storage
            .from("campuscare-message-files")
            .createSignedUrl(row.attachment_path,3600);
          attachment_url=signed?.signedUrl||null;
        }

        messages.push({...row,attachment_url});
      }

      const contacts=await listAllowedContacts();
      return json({ok:true,messages,contacts});
    }

    if(action==="send"){
      const toUserId=Number(body.to_user_id||0);
      const recipient=await ensureRecipientAllowed(toUserId);
      const messageBody=clean(body.body,4000);
      const subject=clean(body.subject,255);
      const replyToId=body.reply_to_id?Number(body.reply_to_id):null;
      const forwardedFromId=body.forwarded_from_id?Number(body.forwarded_from_id):null;

      let attachmentPath:string|null=null;
      let attachmentName:string|null=null;
      let attachmentType:string|null=null;
      let attachmentMime:string|null=null;
      let attachmentSize:number|null=null;

      const attachmentData=String(body.attachment_data_url||"");
      if(attachmentData){
        const parsed=parseDataUrl(attachmentData);
        const allowed=[
          "image/jpeg","image/png","image/webp","application/pdf","text/plain",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "audio/webm","audio/mpeg","audio/wav","audio/mp4"
        ];
        if(!allowed.includes(parsed.mime))return json({error:"This attachment type is not allowed."},400);
        if(parsed.bytes.byteLength>5*1024*1024)return json({error:"Attachment exceeds the 5 MB limit."},400);

        attachmentName=safeName(String(body.attachment_name||"attachment"));
        attachmentType=clean(body.attachment_type,40)||"file";
        attachmentMime=parsed.mime;
        attachmentSize=parsed.bytes.byteLength;
        attachmentPath=`${actor.user_id}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}-${attachmentName}`;

        const {error:uploadErr}=await admin.storage
          .from("campuscare-message-files")
          .upload(attachmentPath,parsed.bytes,{contentType:parsed.mime,upsert:false});
        if(uploadErr)throw uploadErr;
      }

      if(!messageBody&&!attachmentPath)return json({error:"Message cannot be empty."},400);

      if(replyToId){
        const {data:reply}=await admin.from("messages")
          .select("message_id,from_user_id,to_user_id")
          .eq("message_id",replyToId).maybeSingle();
        if(!reply||![reply.from_user_id,reply.to_user_id].includes(actor.user_id)||![reply.from_user_id,reply.to_user_id].includes(toUserId))
          return json({error:"Reply target is not part of this conversation."},400);
      }

      const {data:row,error}=await admin.from("messages").insert({
        from_user_id:actor.user_id,
        to_user_id:toUserId,
        subject:subject||null,
        body:messageBody,
        reply_to_id:replyToId,
        attachment_path:attachmentPath,
        attachment_name:attachmentName,
        attachment_type:attachmentType,
        attachment_mime:attachmentMime,
        attachment_size:attachmentSize,
        forwarded_from_id:forwardedFromId
      }).select("*").single();

      if(error)throw error;

      await admin.from("notifications").insert({
        user_id:toUserId,
        title:"New secure message",
        message:`${actor.role==="Doctor"?"Dr. ":""}${actor.first_name} ${actor.last_name} sent you a secure CampusCare message. Open CampusCare to view it.`,
        type:"Message",
        channel:"In-app",
        delivery_status:"Created",
        reference_type:"messages",
        reference_id:row.message_id,
        action_page:"messages"
      });

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"MESSAGE_SENT",
        entity_type:"messages",
        entity_id:row.message_id,
        details:{to_user_id:toUserId,has_attachment:Boolean(attachmentPath)}
      });

      return json({ok:true,message_id:row.message_id});
    }

    if(action==="read_conversation"){
      const partnerId=Number(body.partner_user_id||0);
      if(!partnerId)return json({error:"Conversation user is required."},400);

      const {error}=await admin.from("messages")
        .update({is_read:true})
        .eq("from_user_id",partnerId)
        .eq("to_user_id",actor.user_id)
        .eq("is_read",false);

      if(error)throw error;
      return json({ok:true});
    }

    if(action==="edit"){
      const messageId=Number(body.message_id||0);
      const nextBody=clean(body.body,4000);
      if(!messageId||!nextBody)return json({error:"Message text is required."},400);

      const {data:existing}=await admin.from("messages")
        .select("message_id,from_user_id,attachment_path,deleted_for_everyone")
        .eq("message_id",messageId).maybeSingle();

      if(!existing||existing.from_user_id!==actor.user_id)
        return json({error:"You can edit only your own messages."},403);
      if(existing.deleted_for_everyone)return json({error:"Deleted messages cannot be edited."},400);
      if(existing.attachment_path)return json({error:"Attachment messages cannot be edited."},400);

      const {error}=await admin.from("messages")
        .update({body:nextBody,edited_at:new Date().toISOString()})
        .eq("message_id",messageId);
      if(error)throw error;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"MESSAGE_EDITED",
        entity_type:"messages",entity_id:messageId,details:{}
      });

      return json({ok:true});
    }

    if(action==="hide"){
      const messageId=Number(body.message_id||0);
      if(!messageId)return json({error:"Message ID is required."},400);

      const {data:existing}=await admin.from("messages")
        .select("message_id,from_user_id,to_user_id")
        .eq("message_id",messageId).maybeSingle();

      if(!existing||![existing.from_user_id,existing.to_user_id].includes(actor.user_id))
        return json({error:"Message not found."},404);

      const {error}=await admin.from("message_hidden")
        .upsert({message_id:messageId,user_id:actor.user_id},{onConflict:"message_id,user_id"});
      if(error)throw error;

      return json({ok:true});
    }

    if(action==="delete_everyone"){
      const messageId=Number(body.message_id||0);
      const {data:existing}=await admin.from("messages")
        .select("message_id,from_user_id,attachment_path,deleted_for_everyone")
        .eq("message_id",messageId).maybeSingle();

      if(!existing||existing.from_user_id!==actor.user_id)
        return json({error:"You can delete for everyone only messages you sent."},403);

      if(existing.attachment_path){
        const {count}=await admin.from("messages")
          .select("message_id",{count:"exact",head:true})
          .eq("attachment_path",existing.attachment_path)
          .neq("message_id",messageId)
          .eq("deleted_for_everyone",false);

        if(Number(count||0)===0){
          await admin.storage.from("campuscare-message-files").remove([existing.attachment_path]);
        }
      }

      const {error}=await admin.from("messages").update({
        body:"",
        attachment_path:null,
        attachment_name:null,
        attachment_type:null,
        attachment_mime:null,
        attachment_size:null,
        deleted_for_everyone:true,
        deleted_at:new Date().toISOString()
      }).eq("message_id",messageId);
      if(error)throw error;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"MESSAGE_DELETED",
        entity_type:"messages",entity_id:messageId,details:{scope:"everyone"}
      });

      return json({ok:true});
    }

    if(action==="forward"){
      const messageId=Number(body.message_id||0);
      const toUserId=Number(body.to_user_id||0);
      await ensureRecipientAllowed(toUserId);

      const {data:existing}=await admin.from("messages")
        .select("*").eq("message_id",messageId).maybeSingle();

      if(!existing||![existing.from_user_id,existing.to_user_id].includes(actor.user_id)||existing.deleted_for_everyone)
        return json({error:"Message cannot be forwarded."},400);

      let nextPath:string|null=null;
      if(existing.attachment_path){
        const baseName=safeName(existing.attachment_name||"attachment");
        nextPath=`${actor.user_id}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}-${baseName}`;
        const {error:copyErr}=await admin.storage
          .from("campuscare-message-files")
          .copy(existing.attachment_path,nextPath);
        if(copyErr)throw copyErr;
      }

      const {data:row,error}=await admin.from("messages").insert({
        from_user_id:actor.user_id,
        to_user_id:toUserId,
        subject:existing.subject,
        body:existing.body||"",
        attachment_path:nextPath,
        attachment_name:existing.attachment_name,
        attachment_type:existing.attachment_type,
        attachment_mime:existing.attachment_mime,
        attachment_size:existing.attachment_size,
        forwarded_from_id:existing.message_id
      }).select("message_id").single();
      if(error)throw error;

      await admin.from("notifications").insert({
        user_id:toUserId,
        title:"New secure message",
        message:`${actor.role==="Doctor"?"Dr. ":""}${actor.first_name} ${actor.last_name} sent you a secure CampusCare message. Open CampusCare to view it.`,
        type:"Message",channel:"In-app",delivery_status:"Created",
        reference_type:"messages",reference_id:row.message_id,action_page:"messages"
      });

      return json({ok:true,message_id:row.message_id});
    }

    return json({error:"Unsupported messaging action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Messaging action failed."},500);
  }
});
