import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=4000)=>String(v??"").trim().slice(0,max);
// An administrator can take back a decision or a cancelled day off for a short while afterwards.
const UNDO_WINDOW_MS=15*60*1000;
const withinUndoWindow=(at:string|null)=>!!at&&Date.now()-new Date(at).getTime()<=UNDO_WINDOW_MS;
const allowedDays=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const dayIndex:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
const time5=(v:unknown)=>String(v??"").slice(0,5);
const minutes=(v:unknown)=>{const [h,m]=time5(v).split(":").map(Number);return (h||0)*60+(m||0);};
const validTime=(v:unknown)=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time5(v));
const addDays=(iso:string,days:number)=>{const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};

// Supporting documents (medical certificate, court order, memo…) are kept in the private verification bucket.
const attachmentBucket="campuscare-verification";
const attachmentTypes:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"};
const maxAttachmentBytes=5*1024*1024;
const safeName=(v:string)=>v.replace(/[^\w.\- ]+/g,"_").replace(/\s+/g," ").trim().slice(0,120)||"attachment";
class RequestError extends Error{}
const readAttachment=(body:any)=>{
  const raw=String(body.attachment_data_url||"");
  if(!raw)return null;
  const m=raw.match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if(!m)throw new RequestError("The supporting file could not be read.");
  const mime=m[1].toLowerCase();
  if(!attachmentTypes[mime])throw new RequestError("Supporting files must be a JPG, PNG, WebP image or a PDF.");
  const bin=atob(m[2].replace(/\s+/g,""));
  if(bin.length>maxAttachmentBytes)throw new RequestError("Supporting file exceeds the 5 MB limit.");
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return {mime,bytes,name:safeName(String(body.attachment_name||"attachment."+attachmentTypes[mime]))};
};

const normalizeWeekly=(body:any,fallback:any)=>{
  const sharedStart=time5(body.start_time||fallback.start_time||"08:00");
  const sharedEnd=time5(body.end_time||fallback.end_time||"17:00");
  const sharedSlot=Math.max(15,Math.min(120,Number(body.slot_duration||fallback.slot_duration||60)));
  const sharedMax=Math.max(1,Math.min(100,Number(body.max_patients||fallback.max_patients||20)));
  const fallbackDays=Array.isArray(body.work_days)?body.work_days:
    (Array.isArray(fallback.work_days)?fallback.work_days:[]);
  const raw=Array.isArray(body.weekly_schedule)&&body.weekly_schedule.length
    ? body.weekly_schedule
    : allowedDays.map(day=>({
        day,is_working:fallbackDays.includes(day),
        start_time:sharedStart,end_time:sharedEnd,
        slot_duration:sharedSlot,max_patients:sharedMax
      }));

  const byDay=new Map<string,any>();
  for(const item of raw){
    const day=String(item?.day||item?.dayName||item?.weekday_name||"");
    if(!allowedDays.includes(day))continue;
    const working=item?.is_working===undefined?true:!!item.is_working;
    const start=time5(item?.start_time||item?.startTime||sharedStart);
    const end=time5(item?.end_time||item?.endTime||sharedEnd);
    const slot=Math.max(15,Math.min(120,Number(item?.slot_duration||item?.slotDuration||sharedSlot)));
    const maxPatients=Math.max(1,Math.min(100,Number(item?.max_patients||item?.maxPatients||sharedMax)));
    byDay.set(day,{day,weekday:dayIndex[day],isWorking:working,startTime:start,endTime:end,slotDuration:slot,maxPatients});
  }

  const rows=allowedDays.map(day=>byDay.get(day)||({
    day,weekday:dayIndex[day],isWorking:false,startTime:sharedStart,endTime:sharedEnd,
    slotDuration:sharedSlot,maxPatients:sharedMax
  }));

  if(!rows.some(r=>r.isWorking))throw new Error("Select at least one work day.");
  for(const r of rows){
    if(!r.isWorking)continue;
    if(!validTime(r.startTime)||!validTime(r.endTime)||r.startTime>=r.endTime)
      throw new Error(r.day+" needs valid working hours with start time before end time.");
    const possibleSlots=Math.floor((minutes(r.endTime)-minutes(r.startTime))/Math.max(15,Number(r.slotDuration||60)));
    if(possibleSlots<1)
      throw new Error(r.day+" working hours are too short for the selected appointment interval.");
    if(Number(r.maxPatients||1)>possibleSlots)
      throw new Error(r.day+" max patients cannot exceed the "+possibleSlots+" appointment slot(s) available within those hours.");
  }
  return rows;
};

const weeklySummary=(rows:any[])=>{
  const working=rows.filter(r=>r.isWorking);
  const starts=working.map(r=>r.startTime).sort();
  const ends=working.map(r=>r.endTime).sort();
  return {
    workDays:working.map(r=>r.day),
    startTime:starts[0]||"08:00",
    endTime:ends[ends.length-1]||"17:00",
    slotDuration:working[0]?.slotDuration||60,
    maxPatients:Math.max(...working.map(r=>r.maxPatients||1),1)
  };
};

const loadWeeklyForDate=async(admin:any,doctorId:number,date:string,fallback:any)=>{
  const weekday=new Date(date+"T00:00:00Z").getUTCDay();
  const {data:rules,error}=await admin.from("doctor_schedule_rules")
    .select("rule_id,weekday,is_working,start_time,end_time,slot_duration,max_patients,effective_from,effective_to")
    .eq("doctor_id",doctorId)
    .eq("weekday",weekday)
    .lte("effective_from",date)
    .or("effective_to.is.null,effective_to.gte."+date)
    .order("effective_from",{ascending:false})
    .limit(1);
  if(error)throw error;
  const r=rules?.[0];
  if(r)return {
    day:allowedDays[(weekday+6)%7]||allowedDays[0],
    weekday,isWorking:!!r.is_working,
    startTime:time5(r.start_time||fallback.start_time||"08:00"),
    endTime:time5(r.end_time||fallback.end_time||"17:00"),
    slotDuration:Number(r.slot_duration||fallback.slot_duration||60),
    maxPatients:Number(r.max_patients||fallback.max_patients||20)
  };
  const day=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][weekday];
  const workDays=Array.isArray(fallback.work_days)?fallback.work_days:[];
  return {day,weekday,isWorking:workDays.includes(day),startTime:time5(fallback.start_time||"08:00"),endTime:time5(fallback.end_time||"17:00"),slotDuration:Number(fallback.slot_duration||60),maxPatients:Number(fallback.max_patients||20)};
};

const scheduleConflicts=async(admin:any,doctorId:number,from:string,to:string|null,weekly:any[])=>{
  let q=admin.from("appointments")
    .select("appointment_id,appointment_date,appointment_time,status,service")
    .eq("doctor_id",doctorId)
    .gte("appointment_date",from)
    .in("status",["Scheduled","Confirmed"])
    .order("appointment_date",{ascending:true})
    .order("appointment_time",{ascending:true});
  if(to)q=q.lte("appointment_date",to);
  const {data,error}=await q;
  if(error)throw error;
  const conflicts:any[]=[];
  const dayCounts=new Map<string,number>();
  for(const a of data||[]){
    const weekday=new Date(String(a.appointment_date)+"T00:00:00Z").getUTCDay();
    const cfg=weekly.find(r=>r.weekday===weekday);
    const t=minutes(a.appointment_time);
    const start=minutes(cfg?.startTime),end=minutes(cfg?.endTime);
    dayCounts.set(String(a.appointment_date),(dayCounts.get(String(a.appointment_date))||0)+1);
    let reason="";
    if(!cfg?.isWorking)reason="day would be unavailable";
    else if(t<start||t+Math.max(15,Number(cfg.slotDuration||60))>end)reason="appointment would fall outside the requested hours";
    else if((t-start)%Math.max(15,Number(cfg.slotDuration||60))!==0)reason="time does not align with the requested slot duration";
    if(reason)conflicts.push({appointment_id:a.appointment_id,date:a.appointment_date,time:time5(a.appointment_time),reason});
  }
  for(const [date,count] of dayCounts){
    const weekday=new Date(date+"T00:00:00Z").getUTCDay();
    const cfg=weekly.find(r=>r.weekday===weekday);
    if(cfg?.isWorking&&count>Number(cfg.maxPatients||100)){
      conflicts.push({appointment_id:null,date,time:null,reason:`existing bookings (${count}) exceed the requested max patients (${cfg.maxPatients})`});
    }
  }
  return conflicts.slice(0,25);
};

const insertScheduleRules=async(admin:any,doctorId:number,weekly:any[],effective:string,effectiveEnd:string|null,scope:string,requestId:number|null,createdBy:number)=>{
  const rows=weekly.map(r=>({
    doctor_id:doctorId,
    weekday:r.weekday,
    is_working:r.isWorking,
    start_time:r.isWorking?r.startTime:null,
    end_time:r.isWorking?r.endTime:null,
    slot_duration:r.slotDuration,
    max_patients:r.maxPatients,
    effective_from:effective,
    effective_to:effectiveEnd,
    schedule_scope:scope,
    source_request_id:requestId,
    created_by:createdBy,
    updated_at:new Date().toISOString()
  }));
  const {error}=await admin.from("doctor_schedule_rules").insert(rows);
  if(error)throw error;
};

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
      .select("user_id,auth_user_id,first_name,last_name,role,status,work_days,start_time,end_time,slot_duration,max_patients")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(!actor||actor.status!=="Active")return json({error:"Active CampusCare account required."},403);

    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"list").toLowerCase();
    const isAdmin=actor.role==="Administrator";
    const phToday=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);

    const notifyAdmins=async(title:string,message:string,requestId:number)=>{
      const {data:admins}=await admin.from("users")
        .select("user_id").eq("role","Administrator").eq("status","Active");
      if(admins?.length){
        await admin.from("notifications").insert(admins.map((a:any)=>({
          user_id:a.user_id,title,message,type:"Account",channel:"In-app",
          delivery_status:"Created",reference_type:"workflow_requests",
          reference_id:requestId,action_page:"users"
        })));
      }
    };

    // Validated before anything is written; uploaded once the request passes its own checks.
    let attachmentFile:ReturnType<typeof readAttachment>=null;
    if(action==="create"){
      try{attachmentFile=readAttachment(body);}
      catch(e){if(e instanceof RequestError)return json({error:e.message},400);throw e;}
    }
    const uploadAttachment=async()=>{
      if(!attachmentFile)return null;
      const path=`requests/${actor.user_id}/${Date.now()}-${crypto.randomUUID()}.${attachmentTypes[attachmentFile.mime]}`;
      const {error}=await admin.storage.from(attachmentBucket)
        .upload(path,attachmentFile.bytes,{contentType:attachmentFile.mime,upsert:false});
      if(error)throw error;
      return {path,name:attachmentFile.name,mime:attachmentFile.mime,size:attachmentFile.bytes.byteLength};
    };
    const discardAttachment=async(attachment:any)=>{
      if(attachment?.path)await admin.storage.from(attachmentBucket).remove([attachment.path]);
    };

    const listData=async()=>{
      let q=admin.from("workflow_requests")
        .select("request_id,request_type,requester_id,target_user_id,payload,reason,effective_date,status,admin_note,reviewed_by,reviewed_at,applied_at,created_at,updated_at")
        .order("created_at",{ascending:false});
      if(!isAdmin)q=q.eq("requester_id",actor.user_id);

      const {data:requests,error}=await q;
      if(error)throw error;

      const {data:leaves,error:leaveErr}=await admin.from("doctor_leaves")
        .select("leave_id,doctor_id,leave_date,reason,created_at")
        .order("leave_date",{ascending:true});
      if(leaveErr)throw leaveErr;

      // Only administrators and the requester ever receive these rows, so they may see the file.
      const withFiles=await Promise.all((requests||[]).map(async(r:any)=>{
        const path=r.payload?.attachment?.path;
        if(!path)return r;
        const {data}=await admin.storage.from(attachmentBucket).createSignedUrl(path,900);
        return {...r,attachment_url:data?.signedUrl||null};
      }));

      return {requests:withFiles,doctor_leaves:leaves||[]};
    };

    if(action==="list"){
      const data=await listData();
      return json({ok:true,...data});
    }

    if(action==="schedule_context"||action==="preview_schedule"){
      const targetId=isAdmin&&body.doctor_id?Number(body.doctor_id):Number(actor.user_id);
      const {data:doctor,error:docErr}=await admin.from("users")
        .select("user_id,first_name,last_name,role,status,work_days,start_time,end_time,slot_duration,max_patients")
        .eq("user_id",targetId)
        .maybeSingle();
      if(docErr)throw docErr;
      if(!doctor||doctor.role!=="Doctor"||doctor.status!=="Active")
        return json({error:"Active Doctor account not found."},404);
      if(!isAdmin&&Number(doctor.user_id)!==Number(actor.user_id))
        return json({error:"You can only review your own schedule."},403);

      const {data:settings}=await admin.from("system_settings")
        .select("schedule_change_notice_days")
        .order("settings_id",{ascending:true}).limit(1).maybeSingle();
      const noticeDays=Math.max(0,Math.min(30,Number(settings?.schedule_change_notice_days??3)));
      const earliest=isAdmin?phToday:addDays(phToday,noticeDays);
      const reference=clean(body.effective_date,10)||earliest;

      const currentWeekly:any[]=[];
      const refWeekday=new Date(reference+"T00:00:00Z").getUTCDay();
      for(const day of allowedDays){
        const probe=addDays(reference,(dayIndex[day]-refWeekday+7)%7);
        const cfg=await loadWeeklyForDate(admin,doctor.user_id,probe,doctor);
        currentWeekly.push({...cfg,day,weekday:dayIndex[day]});
      }

      if(action==="schedule_context"){
        const {data:pending}=await admin.from("workflow_requests")
          .select("request_id,status,effective_date,payload,reason,created_at")
          .eq("target_user_id",doctor.user_id)
          .eq("request_type","Schedule Change")
          .in("status",["Pending","Approved-Pending"])
          .order("created_at",{ascending:false})
          .limit(1);
        return json({
          ok:true,
          doctor_id:doctor.user_id,
          notice_days:noticeDays,
          earliest_effective_date:earliest,
          current_schedule:weeklySummary(currentWeekly),
          current_weekly:currentWeekly,
          active_request:pending?.[0]||null
        });
      }

      const effective=clean(body.effective_date,10);
      const scope=String(body.schedule_scope||"Permanent")==="Temporary"?"Temporary":"Permanent";
      const effectiveEnd=scope==="Temporary"?clean(body.effective_end,10):"";
      const weekly=normalizeWeekly(body,doctor);

      if(!/^\d{4}-\d{2}-\d{2}$/.test(effective)||effective<earliest)
        return json({error:`Earliest allowed effective date is ${earliest}.`},400);
      if(scope==="Temporary"){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveEnd)||effectiveEnd<effective)
          return json({error:"Temporary schedule changes need an end date on or after the effective date."},400);
        if(effectiveEnd>addDays(effective,366))
          return json({error:"Temporary schedule changes may cover at most one year."},400);
      }

      const conflicts=await scheduleConflicts(admin,doctor.user_id,effective,scope==="Temporary"?effectiveEnd:null,weekly);
      return json({
        ok:true,
        current_weekly:currentWeekly,
        requested_weekly:weekly,
        requested_summary:weeklySummary(weekly),
        conflicts,
        notice_days:noticeDays,
        earliest_effective_date:earliest
      });
    }

    if(action==="admin_schedule_update"){
      if(!isAdmin)return json({error:"Administrator access required."},403);

      const doctorId=Number(body.doctor_id||0);
      if(!doctorId)return json({error:"Doctor is required."},400);
      const {data:doctor,error:docErr}=await admin.from("users")
        .select("user_id,first_name,last_name,role,status,work_days,start_time,end_time,slot_duration,max_patients")
        .eq("user_id",doctorId)
        .maybeSingle();
      if(docErr)throw docErr;
      if(!doctor||doctor.role!=="Doctor"||doctor.status!=="Active")
        return json({error:"Active Doctor account not found."},404);

      const {data:activeRequests,error:activeReqErr}=await admin.from("workflow_requests")
        .select("request_id,status,request_type")
        .eq("target_user_id",doctorId)
        .eq("request_type","Schedule Change")
        .in("status",["Pending","Approved-Pending"])
        .limit(1);
      if(activeReqErr)throw activeReqErr;
      if(activeRequests?.length)
        return json({error:"This doctor already has an active schedule change request. Review or resolve that request before applying another schedule update."},409);

      const effective=clean(body.effective_date,10)||phToday;
      const scope=String(body.schedule_scope||"Permanent")==="Temporary"?"Temporary":"Permanent";
      const effectiveEnd=scope==="Temporary"?clean(body.effective_end,10):"";
      const reason=clean(body.reason,2000);
      if(effective<phToday)return json({error:"Effective date cannot be in the past."},400);
      if(!reason||reason.length<5)return json({error:"Add a short reason for the schedule change."},400);

      const weekly=normalizeWeekly(body,doctor);
      if(scope==="Temporary"){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveEnd)||effectiveEnd<effective)
          return json({error:"Temporary schedule changes need an end date on or after the effective date."},400);
        if(effectiveEnd>addDays(effective,366))
          return json({error:"Temporary schedule changes may cover at most one year."},400);
      }

      const currentWeekly:any[]=[];
      const refWeekday=new Date(effective+"T00:00:00Z").getUTCDay();
      for(const day of allowedDays){
        const probe=addDays(effective,(dayIndex[day]-refWeekday+7)%7);
        const cfg=await loadWeeklyForDate(admin,doctor.user_id,probe,doctor);
        currentWeekly.push({...cfg,day,weekday:dayIndex[day]});
      }

      const same=JSON.stringify(weekly.map(r=>[r.day,r.isWorking,r.startTime,r.endTime,r.slotDuration,r.maxPatients]))===
        JSON.stringify(currentWeekly.map(r=>[r.day,r.isWorking,r.startTime,r.endTime,r.slotDuration,r.maxPatients]));
      if(same)return json({error:"The proposed schedule matches the effective schedule for that date."},400);

      if(scope==="Temporary"){
        const {data:overlap,error:overlapErr}=await admin.from("doctor_schedule_rules")
          .select("rule_id,effective_from,effective_to")
          .eq("doctor_id",doctor.user_id)
          .eq("schedule_scope","Temporary")
          .lte("effective_from",effectiveEnd)
          .or("effective_to.is.null,effective_to.gte."+effective)
          .limit(1);
        if(overlapErr)throw overlapErr;
        if(overlap?.length)
          return json({error:"This temporary schedule overlaps another temporary schedule already on file. Adjust the effective dates first."},409);
      }

      const conflicts=await scheduleConflicts(admin,doctor.user_id,effective,scope==="Temporary"?effectiveEnd:null,weekly);
      if(conflicts.length){
        return json({
          error:"This schedule change conflicts with existing appointments. Resolve the affected bookings before applying it.",
          conflicts
        },409);
      }

      const requestedSummary=weeklySummary(weekly);
      const currentSummary=weeklySummary(currentWeekly);
      const becomesActive=effective<=phToday;

      const {data:row,error:reqErr}=await admin.from("workflow_requests").insert({
        request_type:"Schedule Change",
        requester_id:actor.user_id,
        target_user_id:doctor.user_id,
        payload:{
          current:{...currentSummary,weeklySchedule:currentWeekly},
          requested:{...requestedSummary,weeklySchedule:weekly,scheduleScope:scope,effectiveEnd:effectiveEnd||null},
          conflictPreview:[]
        },
        reason,
        effective_date:effective,
        status:becomesActive?"Applied":"Approved-Pending",
        admin_note:"Administrator schedule update",
        reviewed_by:actor.user_id,
        reviewed_at:new Date().toISOString(),
        applied_at:becomesActive?new Date().toISOString():null
      }).select("*").single();
      if(reqErr)throw reqErr;

      await insertScheduleRules(admin,doctor.user_id,weekly,effective,effectiveEnd||null,scope,row.request_id,actor.user_id);

      if(becomesActive&&scope==="Permanent"){
        const {error:updateErr}=await admin.from("users").update({
          work_days:requestedSummary.workDays,
          start_time:requestedSummary.startTime,
          end_time:requestedSummary.endTime,
          slot_duration:requestedSummary.slotDuration,
          max_patients:requestedSummary.maxPatients
        }).eq("user_id",doctor.user_id);
        if(updateErr)throw updateErr;
      }

      await admin.from("notifications").insert({
        user_id:doctor.user_id,
        title:"Work Schedule Updated",
        message:becomesActive
          ?"An administrator updated your weekly work schedule. The change is now active."
          :"An administrator scheduled a work-schedule update effective "+effective+".",
        type:"Account",channel:"In-app",delivery_status:"Created",
        reference_type:"workflow_requests",reference_id:row.request_id,
        action_page:"schedule"
      });

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"DOCTOR_SCHEDULE_UPDATED",
        entity_type:"workflow_requests",entity_id:row.request_id,
        details:{doctor_id:doctor.user_id,effective_date:effective,effective_end:effectiveEnd||null,scope,requested:row.payload?.requested||{}}
      });

      return json({ok:true,request:row,status:row.status});
    }

    if(action==="create"){
      const type=clean(body.request_type,60);
      const reason=clean(body.reason,2000);

      if(type==="Name Change"){
        if(isAdmin)return json({error:"Administrators can edit their own name through User Management."},400);

        const first=clean(body.requested_first_name,120);
        const last=clean(body.requested_last_name,120);
        if(!first||!last)return json({error:"Requested first and last names are required."},400);
        if(first===actor.first_name&&last===actor.last_name)
          return json({error:"The requested name matches your current name."},400);

        const {data:existing}=await admin.from("workflow_requests")
          .select("request_id").eq("requester_id",actor.user_id)
          .eq("request_type","Name Change").eq("status","Pending").maybeSingle();
        if(existing)return json({error:"You already have a pending name change request."},400);

        const attachment=await uploadAttachment();
        const {data:row,error}=await admin.from("workflow_requests").insert({
          request_type:"Name Change",
          requester_id:actor.user_id,
          target_user_id:actor.user_id,
          payload:{
            current:{firstName:actor.first_name,lastName:actor.last_name},
            requested:{firstName:first,lastName:last},
            ...(attachment?{attachment}:{})
          },
          reason:reason||null,
          status:"Pending"
        }).select("*").single();
        if(error){await discardAttachment(attachment);throw error;}

        await notifyAdmins(
          "Name Change Request",
          (actor.first_name+" "+actor.last_name+" requested a name change.").trim(),
          row.request_id
        );

        await admin.from("audit_logs").insert({
          user_id:actor.user_id,action:"NAME_CHANGE_REQUESTED",
          entity_type:"workflow_requests",entity_id:row.request_id,
          details:{requested_first_name:first,requested_last_name:last,has_attachment:!!attachment}
        });

        return json({ok:true,request:row});
      }

      if(type==="Schedule Change"){
        if(actor.role!=="Doctor")return json({error:"Only Doctor accounts can request schedule changes."},403);

        const effective=clean(body.effective_date,10);
        if(!reason||reason.length<5)
          return json({error:"Add a short reason for the schedule change."},400);
        const scope=String(body.schedule_scope||"Permanent")==="Temporary"?"Temporary":"Permanent";
        const effectiveEnd=scope==="Temporary"?clean(body.effective_end,10):"";
        const weekly=normalizeWeekly(body,actor);

        const {data:settings}=await admin.from("system_settings")
          .select("schedule_change_notice_days")
          .order("settings_id",{ascending:true}).limit(1).maybeSingle();
        const noticeDays=Math.max(0,Math.min(30,Number(settings?.schedule_change_notice_days??3)));
        const earliest=addDays(phToday,noticeDays);

        if(!/^\d{4}-\d{2}-\d{2}$/.test(effective)||effective<earliest)
          return json({error:`Schedule changes require at least ${noticeDays} day(s) notice. Earliest allowed date: ${earliest}.`},400);
        if(scope==="Temporary"){
          if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveEnd)||effectiveEnd<effective)
            return json({error:"Temporary schedule changes need an end date on or after the effective date."},400);
          if(effectiveEnd>addDays(effective,366))
            return json({error:"Temporary schedule changes may cover at most one year."},400);
        }

        const {data:existing}=await admin.from("workflow_requests")
          .select("request_id,status").eq("requester_id",actor.user_id)
          .eq("request_type","Schedule Change")
          .in("status",["Pending","Approved-Pending"])
          .limit(1);
        if(existing?.length)return json({error:"You already have an active schedule change request. Wait until it is resolved before submitting another."},409);

        const currentWeekly:any[]=[];
        for(const day of allowedDays){
          const probe=addDays(phToday,(dayIndex[day]-new Date(phToday+"T00:00:00Z").getUTCDay()+7)%7);
          const cfg=await loadWeeklyForDate(admin,actor.user_id,probe,actor);
          currentWeekly.push({...cfg,day,weekday:dayIndex[day]});
        }

        const requestedSummary=weeklySummary(weekly);
        const currentSummary=weeklySummary(currentWeekly);
        const same=JSON.stringify(weekly.map(r=>[r.day,r.isWorking,r.startTime,r.endTime,r.slotDuration,r.maxPatients]))===
          JSON.stringify(currentWeekly.map(r=>[r.day,r.isWorking,r.startTime,r.endTime,r.slotDuration,r.maxPatients]));
        if(same)return json({error:"The requested weekly schedule matches your current schedule."},400);

        if(scope==="Temporary"){
          const {data:overlap,error:overlapErr}=await admin.from("doctor_schedule_rules")
            .select("rule_id,effective_from,effective_to")
            .eq("doctor_id",actor.user_id)
            .eq("schedule_scope","Temporary")
            .lte("effective_from",effectiveEnd)
            .or("effective_to.is.null,effective_to.gte."+effective)
            .limit(1);
          if(overlapErr)throw overlapErr;
          if(overlap?.length)
            return json({error:"The requested temporary range overlaps another temporary schedule already on file."},409);
        }

        const conflicts=await scheduleConflicts(admin,actor.user_id,effective,scope==="Temporary"?effectiveEnd:null,weekly);

        const attachment=await uploadAttachment();
        const {data:row,error}=await admin.from("workflow_requests").insert({
          request_type:"Schedule Change",
          requester_id:actor.user_id,
          target_user_id:actor.user_id,
          payload:{
            current:{...currentSummary,weeklySchedule:currentWeekly},
            requested:{...requestedSummary,weeklySchedule:weekly,scheduleScope:scope,effectiveEnd:effectiveEnd||null},
            conflictPreview:conflicts,
            ...(attachment?{attachment}:{})
          },
          reason:reason||null,
          effective_date:effective,
          status:"Pending"
        }).select("*").single();
        if(error){await discardAttachment(attachment);throw error;}

        await notifyAdmins(
          "Schedule Change Request",
          ("Dr. "+actor.first_name+" "+actor.last_name+" requested a "+scope.toLowerCase()+" weekly schedule change effective "+effective+".").trim(),
          row.request_id
        );

        await admin.from("audit_logs").insert({
          user_id:actor.user_id,action:"SCHEDULE_CHANGE_REQUESTED",
          entity_type:"workflow_requests",entity_id:row.request_id,
          details:{effective_date:effective,effective_end:effectiveEnd||null,scope,conflict_count:conflicts.length,requested:row.payload?.requested||{},has_attachment:!!attachment}
        });

        return json({ok:true,request:row,conflicts,notice_days:noticeDays});
      }

      if(type==="Day Off"){
        if(actor.role!=="Doctor")return json({error:"Only Doctor accounts can request days off."},403);

        const date=clean(body.leave_date,10);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<phToday)
          return json({error:"Day-off date cannot be in the past."},400);

        const daySchedule=await loadWeeklyForDate(admin,actor.user_id,date,actor);
        if(!daySchedule.isWorking)
          return json({error:"You are already not scheduled to work on that date. A day-off request is not needed."},400);

        const {data:approved}=await admin.from("doctor_leaves")
          .select("leave_id").eq("doctor_id",actor.user_id).eq("leave_date",date).maybeSingle();
        if(approved)return json({error:"That date is already approved as a day off."},400);

        const {data:pending}=await admin.from("workflow_requests")
          .select("request_id").eq("requester_id",actor.user_id)
          .eq("request_type","Day Off").eq("status","Pending")
          .eq("effective_date",date).maybeSingle();
        if(pending)return json({error:"You already have a pending request for that date."},400);

        const attachment=await uploadAttachment();
        const {data:row,error}=await admin.from("workflow_requests").insert({
          request_type:"Day Off",
          requester_id:actor.user_id,
          target_user_id:actor.user_id,
          payload:{leaveDate:date,...(attachment?{attachment}:{})},
          reason:reason||null,
          effective_date:date,
          status:"Pending"
        }).select("*").single();
        if(error){await discardAttachment(attachment);throw error;}

        await notifyAdmins(
          "Day Off Request",
          ("Dr. "+actor.first_name+" "+actor.last_name+" requested "+date+" off.").trim(),
          row.request_id
        );

        await admin.from("audit_logs").insert({
          user_id:actor.user_id,action:"DAY_OFF_REQUESTED",
          entity_type:"workflow_requests",entity_id:row.request_id,
          details:{leave_date:date,has_attachment:!!attachment}
        });

        return json({ok:true,request:row});
      }

      return json({error:"Unsupported request type."},400);
    }

    if(action==="cancel_request"){
      const requestId=Number(body.request_id||0);
      if(!requestId)return json({error:"Request ID is required."},400);

      const {data:r,error:rErr}=await admin.from("workflow_requests")
        .select("*")
        .eq("request_id",requestId)
        .maybeSingle();
      if(rErr)throw rErr;
      if(!r)return json({error:"Request not found."},404);
      if(Number(r.requester_id)!==Number(actor.user_id)&&!isAdmin)
        return json({error:"You cannot cancel this request."},403);
      if(r.status!=="Pending")
        return json({error:"Only pending requests can be cancelled."},400);

      const {error:updateErr}=await admin.from("workflow_requests").update({
        status:"Cancelled",
        admin_note:clean(body.note,2000)||null,
        updated_at:new Date().toISOString()
      }).eq("request_id",requestId);
      if(updateErr)throw updateErr;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"WORKFLOW_REQUEST_CANCELLED",
        entity_type:"workflow_requests",
        entity_id:requestId,
        details:{request_type:r.request_type}
      });

      if(Number(r.requester_id)!==Number(actor.user_id)){
        await admin.from("notifications").insert({
          user_id:r.requester_id,
          title:r.request_type+" Cancelled",
          message:"Your "+String(r.request_type||"workflow").toLowerCase()+" request was cancelled by an administrator.",
          type:"Account",channel:"In-app",delivery_status:"Created",
          reference_type:"workflow_requests",reference_id:requestId,
          action_page:r.request_type==="Day Off"?"schedule":"my-account"
        });
      }

      const data=await listData();
      return json({ok:true,status:"Cancelled",...data});
    }

    if(action==="decision"){
      if(!isAdmin)return json({error:"Administrator access required."},403);

      const requestId=Number(body.request_id||0);
      const decision=String(body.decision||"");
      const note=clean(body.admin_note,2000);
      if(!requestId||!["Approve","Reject"].includes(decision))
        return json({error:"Valid request and decision are required."},400);

      const {data:r}=await admin.from("workflow_requests")
        .select("*").eq("request_id",requestId).maybeSingle();
      if(!r)return json({error:"Request not found."},404);
      if(r.status!=="Pending")return json({error:"This request has already been reviewed."},400);

      if(decision==="Reject"){
        const {error}=await admin.from("workflow_requests").update({
          status:"Rejected",admin_note:note||null,
          reviewed_by:actor.user_id,reviewed_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        }).eq("request_id",requestId);
        if(error)throw error;

        await admin.from("notifications").insert({
          user_id:r.requester_id,
          title:r.request_type+" Declined",
          message:"Your "+r.request_type.toLowerCase()+" request was declined by an administrator."+ (note?" Note: "+note:""),
          type:"Account",channel:"In-app",delivery_status:"Created",
          reference_type:"workflow_requests",reference_id:requestId,
          action_page:r.request_type==="Day Off"?"schedule":"my-account"
        });

        await admin.from("audit_logs").insert({
          user_id:actor.user_id,action:"WORKFLOW_REQUEST_REJECTED",
          entity_type:"workflow_requests",entity_id:requestId,
          details:{request_type:r.request_type,admin_note:note||null}
        });

        return json({ok:true,status:"Rejected"});
      }

      let previousProfile:any=null;
      if(r.request_type==="Name Change"){
        const first=clean(r.payload?.requested?.firstName,120);
        const last=clean(r.payload?.requested?.lastName,120);
        if(!first||!last)return json({error:"Requested name data is incomplete."},400);

        const {data:target,error:targetErr}=await admin.from("users")
          .select("auth_user_id").eq("user_id",r.target_user_id).single();
        if(targetErr)throw targetErr;

        const {error:updateErr}=await admin.from("users").update({
          first_name:first,last_name:last
        }).eq("user_id",r.target_user_id);
        if(updateErr)throw updateErr;

        if(target.auth_user_id){
          await admin.auth.admin.updateUserById(target.auth_user_id,{
            user_metadata:{first_name:first,last_name:last}
          });
        }

        await admin.from("workflow_requests").update({
          status:"Applied",admin_note:note||null,
          reviewed_by:actor.user_id,reviewed_at:new Date().toISOString(),
          applied_at:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq("request_id",requestId);

        await admin.from("notifications").insert({
          user_id:r.requester_id,
          title:"Name Change Approved",
          message:"Your name has been updated to \""+first+" "+last+"\".",
          type:"Account",channel:"In-app",delivery_status:"Created",
          reference_type:"workflow_requests",reference_id:requestId,
          action_page:"my-account"
        });
      }

      if(r.request_type==="Schedule Change"){
        const requested=r.payload?.requested||{};
        const weekly=normalizeWeekly({weekly_schedule:requested.weeklySchedule}, {
          work_days:requested.workDays||[],start_time:requested.startTime,end_time:requested.endTime,
          slot_duration:requested.slotDuration,max_patients:requested.maxPatients
        });
        const scope=requested.scheduleScope==="Temporary"?"Temporary":"Permanent";
        const effective=String(r.effective_date||"");
        const effectiveEnd=scope==="Temporary"?String(requested.effectiveEnd||""):"";

        const conflicts=await scheduleConflicts(
          admin,r.target_user_id,effective,
          scope==="Temporary"?(effectiveEnd||effective):null,
          weekly
        );
        if(conflicts.length){
          return json({
            error:"This schedule change conflicts with existing appointments. Reschedule or cancel the affected appointments before approval.",
            conflicts
          },409);
        }

        await insertScheduleRules(
          admin,r.target_user_id,weekly,effective,effectiveEnd||null,scope,requestId,actor.user_id
        );

        const summary=weeklySummary(weekly);
        const becomesActive=effective<=phToday;
        if(becomesActive&&scope==="Permanent"){
          const {data:before}=await admin.from("users")
            .select("work_days,start_time,end_time,slot_duration,max_patients")
            .eq("user_id",r.target_user_id).maybeSingle();
          previousProfile=before||null;
          const {error:updateErr}=await admin.from("users").update({
            work_days:summary.workDays,
            start_time:summary.startTime,
            end_time:summary.endTime,
            slot_duration:summary.slotDuration,
            max_patients:summary.maxPatients
          }).eq("user_id",r.target_user_id).eq("role","Doctor");
          if(updateErr)throw updateErr;
        }

        const nextStatus=becomesActive?"Applied":"Approved-Pending";
        await admin.from("workflow_requests").update({
          status:nextStatus,admin_note:note||null,
          reviewed_by:actor.user_id,reviewed_at:new Date().toISOString(),
          applied_at:becomesActive?new Date().toISOString():null,
          updated_at:new Date().toISOString()
        }).eq("request_id",requestId);

        await admin.from("notifications").insert({
          user_id:r.requester_id,
          title:"Schedule Change Approved",
          message:becomesActive
            ?"Your requested weekly schedule change is now in effect."
            :"Your requested weekly schedule change was approved and will take effect on "+effective+".",
          type:"Account",channel:"In-app",delivery_status:"Created",
          reference_type:"workflow_requests",reference_id:requestId,
          action_page:"schedule"
        });
      }

      if(r.request_type==="Day Off"){
        const date=String(r.effective_date||r.payload?.leaveDate||"");
        const {count}=await admin.from("appointments")
          .select("appointment_id",{count:"exact",head:true})
          .eq("doctor_id",r.target_user_id)
          .eq("appointment_date",date)
          .in("status",["Scheduled","Confirmed"]);

        if((count||0)>0){
          return json({
            error:"This doctor still has "+String(count)+" scheduled appointment(s) on "+date+". Reschedule or cancel them before approving the day off."
          },409);
        }

        const {error:leaveErr}=await admin.from("doctor_leaves").upsert({
          doctor_id:r.target_user_id,
          leave_date:date,
          reason:r.reason||null
        },{onConflict:"doctor_id,leave_date"});
        if(leaveErr)throw leaveErr;

        await admin.from("workflow_requests").update({
          status:"Applied",admin_note:note||null,
          reviewed_by:actor.user_id,reviewed_at:new Date().toISOString(),
          applied_at:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq("request_id",requestId);

        await admin.from("notifications").insert({
          user_id:r.requester_id,
          title:"Day Off Approved",
          message:"Your day off on "+date+" has been approved.",
          type:"Account",channel:"In-app",delivery_status:"Created",
          reference_type:"workflow_requests",reference_id:requestId,
          action_page:"schedule"
        });
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"WORKFLOW_REQUEST_APPROVED",
        entity_type:"workflow_requests",entity_id:requestId,
        details:{request_type:r.request_type,effective_date:r.effective_date,admin_note:note||null,previous_profile:previousProfile}
      });

      const data=await listData();
      return json({ok:true,...data});
    }

    if(action==="cancel_leave"){
      if(!isAdmin)return json({error:"Administrator access required."},403);

      const leaveId=Number(body.leave_id||0);
      if(!leaveId)return json({error:"Leave ID is required."},400);

      const {data:leave}=await admin.from("doctor_leaves")
        .select("*").eq("leave_id",leaveId).maybeSingle();
      if(!leave)return json({error:"Approved day off not found."},404);

      const {count}=await admin.from("appointments")
        .select("appointment_id",{count:"exact",head:true})
        .eq("doctor_id",leave.doctor_id)
        .eq("appointment_date",leave.leave_date)
        .in("status",["Scheduled","Confirmed"]);

      if((count||0)>0){
        return json({error:"This day off cannot be cancelled while scheduled appointments exist on that date."},409);
      }

      const {error}=await admin.from("doctor_leaves")
        .delete().eq("leave_id",leaveId);
      if(error)throw error;

      await admin.from("notifications").insert({
        user_id:leave.doctor_id,
        title:"Day Off Cancelled",
        message:"Your approved day off on "+String(leave.leave_date)+" was cancelled by an administrator.",
        type:"Account",channel:"In-app",delivery_status:"Created",
        reference_type:"doctor_leaves",reference_id:leaveId,
        action_page:"schedule"
      });

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"DOCTOR_LEAVE_CANCELLED",
        entity_type:"doctor_leaves",entity_id:leaveId,
        details:{doctor_id:leave.doctor_id,leave_date:leave.leave_date,leave}
      });

      const data=await listData();
      return json({ok:true,...data});
    }

    // Put back a request decision: the request returns to Pending and whatever the approval applied is removed.
    if(action==="undo_decision"){
      if(!isAdmin)return json({error:"Administrator access required."},403);
      const requestId=Number(body.request_id||0);
      const {data:r}=await admin.from("workflow_requests").select("*").eq("request_id",requestId).maybeSingle();
      if(!r)return json({error:"Request not found."},404);
      if(!["Rejected","Applied","Approved-Pending"].includes(r.status))return json({error:"This request has no decision to undo."},409);
      if(Number(r.reviewed_by)!==Number(actor.user_id))return json({error:"Only the administrator who reviewed this request can undo the decision."},403);
      if(!withinUndoWindow(r.reviewed_at))return json({error:"This decision can no longer be undone."},409);

      if(r.status!=="Rejected"){
        if(r.request_type==="Name Change"){
          const first=clean(r.payload?.current?.firstName,120),last=clean(r.payload?.current?.lastName,120);
          if(!first||!last)return json({error:"The previous name was not recorded, so this change can't be undone."},409);
          const {data:target}=await admin.from("users").select("auth_user_id").eq("user_id",r.target_user_id).single();
          const {error}=await admin.from("users").update({first_name:first,last_name:last}).eq("user_id",r.target_user_id);
          if(error)throw error;
          if(target?.auth_user_id)await admin.auth.admin.updateUserById(target.auth_user_id,{user_metadata:{first_name:first,last_name:last}});
        }
        if(r.request_type==="Schedule Change"){
          // Bookings made under the new hours would lose their slot.
          const {count}=await admin.from("appointments")
            .select("appointment_id",{count:"exact",head:true})
            .eq("doctor_id",r.target_user_id).gte("appointment_date",String(r.effective_date||phToday))
            .gte("created_at",r.reviewed_at).in("status",["Scheduled","Confirmed"]);
          if((count||0)>0)return json({error:"Patients have already booked under the new schedule, so it can't be undone."},409);
          const {error}=await admin.from("doctor_schedule_rules").delete().eq("source_request_id",requestId);
          if(error)throw error;
          const {data:approval}=await admin.from("audit_logs").select("details")
            .eq("action","WORKFLOW_REQUEST_APPROVED").eq("entity_type","workflow_requests").eq("entity_id",requestId)
            .order("created_at",{ascending:false}).limit(1).maybeSingle();
          const previous=approval?.details?.previous_profile;
          if(previous){
            const {error:profileErr}=await admin.from("users").update(previous).eq("user_id",r.target_user_id).eq("role","Doctor");
            if(profileErr)throw profileErr;
          }
        }
        if(r.request_type==="Day Off"){
          const date=String(r.effective_date||r.payload?.leaveDate||"");
          const {error}=await admin.from("doctor_leaves").delete().eq("doctor_id",r.target_user_id).eq("leave_date",date);
          if(error)throw error;
        }
      }

      const {error}=await admin.from("workflow_requests").update({
        status:"Pending",admin_note:null,reviewed_by:null,reviewed_at:null,applied_at:null,updated_at:new Date().toISOString()
      }).eq("request_id",requestId);
      if(error)throw error;
      // The requester's "approved" / "declined" notice no longer applies.
      await admin.from("notifications").delete()
        .eq("user_id",r.requester_id).eq("reference_type","workflow_requests").eq("reference_id",requestId)
        .gte("created_at",r.reviewed_at);
      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"WORKFLOW_DECISION_UNDONE",
        entity_type:"workflow_requests",entity_id:requestId,
        details:{request_type:r.request_type,undone_status:r.status}
      });

      const data=await listData();
      return json({ok:true,...data});
    }

    // Put back a day off that was just cancelled.
    if(action==="restore_leave"){
      if(!isAdmin)return json({error:"Administrator access required."},403);
      const leaveId=Number(body.leave_id||0);
      const {data:log}=await admin.from("audit_logs").select("details,created_at")
        .eq("action","DOCTOR_LEAVE_CANCELLED").eq("entity_type","doctor_leaves").eq("entity_id",leaveId).eq("user_id",actor.user_id)
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      const leave=log?.details?.leave;
      if(!leave)return json({error:"That cancelled day off was not found."},404);
      if(!withinUndoWindow(log.created_at))return json({error:"This cancellation can no longer be undone."},409);

      const {count}=await admin.from("appointments")
        .select("appointment_id",{count:"exact",head:true})
        .eq("doctor_id",leave.doctor_id).eq("appointment_date",leave.leave_date).in("status",["Scheduled","Confirmed"]);
      if((count||0)>0)return json({error:"Patients have already booked that day, so the day off can't be put back."},409);

      const {leave_id:_id,created_at:_created,...row}=leave;
      const {error}=await admin.from("doctor_leaves").upsert(row,{onConflict:"doctor_id,leave_date"});
      if(error)throw error;
      await admin.from("notifications").delete()
        .eq("user_id",leave.doctor_id).eq("reference_type","doctor_leaves").eq("reference_id",leaveId)
        .gte("created_at",new Date(new Date(log.created_at).getTime()-60000).toISOString());
      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"DOCTOR_LEAVE_RESTORED",
        entity_type:"doctor_leaves",entity_id:leaveId,
        details:{doctor_id:leave.doctor_id,leave_date:leave.leave_date}
      });

      const data=await listData();
      return json({ok:true,...data});
    }

    return json({error:"Unsupported workflow action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Workflow action failed."},500);
  }
});
