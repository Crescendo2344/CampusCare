import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const clean=(v:unknown,max=10000)=>String(v??"").trim().slice(0,max);

function decodeImage(dataUrl:string){
  const m=dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!m)throw new Error("Article image must be JPG, PNG, or WebP.");
  const mime=m[1];
  const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));
  if(bytes.byteLength>5*1024*1024)throw new Error("Article image must be 5 MB or smaller.");
  const ext=mime==="image/png"?"png":mime==="image/webp"?"webp":"jpg";
  return {mime,bytes,ext};
}

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
      .select("user_id,role,status")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(!actor||actor.status!=="Active")return json({error:"Active CampusCare account required."},403);

    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"list").toLowerCase();
    const canEdit=["Staff","Administrator"].includes(actor.role);

    if(action==="list"){
      let q=admin.from("health_resources")
        .select("resource_id,title,category,content,teaser,source_name,source_url,icon,image_path,author_id,published_at,created_at,updated_at,archived_at,archived_by")
        .is("archived_at",null)
        .order("published_at",{ascending:false,nullsFirst:false})
        .order("created_at",{ascending:false});

      if(!canEdit)q=q.not("published_at","is",null);

      const {data:rows,error}=await q;
      if(error)throw error;

      // One batch call signs every article photo for 12 hours.
      const paths=(rows||[]).map(r=>r.image_path).filter(Boolean);
      const signed=new Map<string,string>();
      if(paths.length){
        const {data}=await admin.storage.from("campuscare-health-resources").createSignedUrls(paths,43200);
        for(const s of data||[])if(s.path&&s.signedUrl)signed.set(s.path,s.signedUrl);
      }
      const output=(rows||[]).map(row=>({...row,image_url:row.image_path?signed.get(row.image_path)||null:null,published:Boolean(row.published_at)}));

      return json({ok:true,resources:output});
    }

    if(!canEdit)return json({error:"Staff or Administrator access required."},403);

    if(action==="create"||action==="update"){
      const resourceId=Number(body.resource_id||0);
      const title=clean(body.title,255);
      const category=clean(body.category,120);
      const content=clean(body.content,20000);
      const teaser=clean(body.teaser,1200);
      const sourceName=clean(body.source_name,255);
      const sourceUrl=clean(body.source_url,1500);
      const icon=clean(body.icon,32)||"📰";
      const published=Boolean(body.published);
      const imageData=clean(body.image_data_url,8_000_000);
      const removeImage=Boolean(body.remove_image);

      if(!title||!category||!content)return json({error:"Title, category, and article content are required."},400);
      if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))return json({error:"Source URL must begin with http:// or https://."},400);

      let existing:any=null;
      if(action==="update"){
        const {data}=await admin.from("health_resources")
          .select("*").eq("resource_id",resourceId).maybeSingle();
        if(!data)return json({error:"Health resource not found."},404);
        existing=data;
      }

      const payload:any={
        title,category,content,
        teaser:teaser||null,
        source_name:sourceName||null,
        source_url:sourceUrl||null,
        icon,
        author_id:actor.user_id,
        published_at:published?(existing?.published_at||new Date().toISOString()):null,
        updated_at:new Date().toISOString()
      };

      let saved:any=null;
      if(action==="create"){
        const {data,error}=await admin.from("health_resources")
          .insert(payload).select("*").single();
        if(error)throw error;
        saved=data;
      }else{
        const {data,error}=await admin.from("health_resources")
          .update(payload).eq("resource_id",resourceId).select("*").single();
        if(error)throw error;
        saved=data;
      }

      let imagePath=existing?.image_path||null;

      if(removeImage&&imagePath){
        await admin.storage.from("campuscare-health-resources").remove([imagePath]);
        imagePath=null;
      }

      if(imageData){
        const img=decodeImage(imageData);
        if(imagePath)await admin.storage.from("campuscare-health-resources").remove([imagePath]);
        imagePath=`${saved.resource_id}/article-${Date.now()}.${img.ext}`;
        const {error:uploadErr}=await admin.storage
          .from("campuscare-health-resources")
          .upload(imagePath,img.bytes,{contentType:img.mime,upsert:true});
        if(uploadErr)throw uploadErr;
      }

      if(imagePath!==saved.image_path){
        const {data,error}=await admin.from("health_resources")
          .update({image_path:imagePath,updated_at:new Date().toISOString()})
          .eq("resource_id",saved.resource_id).select("*").single();
        if(error)throw error;
        saved=data;
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:action==="create"?"HEALTH_RESOURCE_CREATED":"HEALTH_RESOURCE_UPDATED",
        entity_type:"health_resources",
        entity_id:saved.resource_id,
        details:{title,category,published}
      });

      return json({ok:true,resource:saved});
    }

    if(action==="delete"){
      const resourceId=Number(body.resource_id||0);
      if(!resourceId)return json({error:"Resource ID is required."},400);
      const {data:row}=await admin.from("health_resources")
        .select("resource_id,title,image_path,published_at").eq("resource_id",resourceId).maybeSingle();
      if(!row)return json({error:"Health resource not found."},404);
      if(row.published_at)return json({error:"Only drafts can be deleted. Unpublish the article first."},409);

      const {error}=await admin.from("health_resources").delete().eq("resource_id",resourceId);
      if(error)throw error;
      if(row.image_path)await admin.storage.from("campuscare-health-resources").remove([row.image_path]);

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:"HEALTH_RESOURCE_DELETED",
        entity_type:"health_resources",
        entity_id:resourceId,
        details:{title:row.title}
      });

      return json({ok:true});
    }

    if(["publish","unpublish","archive","restore"].includes(action)){
      const resourceId=Number(body.resource_id||0);
      if(!resourceId)return json({error:"Resource ID is required."},400);

      const patch:any={updated_at:new Date().toISOString()};
      if(action==="publish")patch.published_at=new Date().toISOString();
      if(action==="unpublish")patch.published_at=null;
      if(action==="archive"){
        if(actor.role!=="Administrator")return json({error:"Administrator access required to archive resources."},403);
        patch.archived_at=new Date().toISOString();
        patch.archived_by=actor.user_id;
      }
      if(action==="restore"){
        if(actor.role!=="Administrator")return json({error:"Administrator access required to restore resources."},403);
        patch.archived_at=null;
        patch.archived_by=null;
      }

      const {data:saved,error}=await admin.from("health_resources")
        .update(patch).eq("resource_id",resourceId).select("*").single();
      if(error)throw error;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:`HEALTH_RESOURCE_${action.toUpperCase()}`,
        entity_type:"health_resources",
        entity_id:resourceId,
        details:{title:saved.title}
      });

      return json({ok:true,resource:saved});
    }

    return json({error:"Unsupported health resource action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Health resource action failed."},500);
  }
});
