// This endpoint returns campus student coverage only to active clinic administrators/staff.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import {buildStudentReport} from './student-report.js';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);
  try{
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if(!token)return json({error:'Authentication required.'},401);
    const {data:{user},error}=await client.auth.getUser(token);
    if(error||!user)return json({error:'Invalid session.'},401);
    const {data:actor,error:actorError}=await client.from('users').select('role,status').eq('auth_user_id',user.id).maybeSingle();
    if(actorError)throw actorError;
    if(actor?.status!=='Active'||!['Administrator','Staff'].includes(actor.role))return json({error:'Administrator or staff reports access required.'},403);
    const filters=await req.json();
    // Validate filters before any roster queries, then paginate to avoid the 1,000-row default.
    buildStudentReport({},filters);
    async function all(table:string,columns:string,key:string){
      const rows:any[]=[];
      for(let offset=0;offset<100000;offset+=1000){
        const {data,error}=await client.from(table).select(columns).order(key).range(offset,offset+999);
        if(error)throw error;
        rows.push(...data||[]);
        if(!data||data.length<1000)return rows;
      }
      throw new Error('Report exceeds the supported record limit. Contact the administrator.');
    }
    const [users,patients,appointments,treatments,dentalRecords]=await Promise.all([
      all('users','user_id,first_name,last_name,id_number,role,person_type,college,status,verified,created_at','user_id'),
      all('patients','patient_id,user_id,class_session,sex,birth_date,archived_at','patient_id'),
      all('appointments','appointment_id,patient_id,clinic,appointment_date,status','appointment_id'),
      all('treatments','treatment_id,patient_id,appointment_id,treatment_date,status,archived_at','treatment_id'),
      all('dental_records','dental_record_id,treatment_id,patient_id,record_date','dental_record_id')
    ]);
    return json({ok:true,report:buildStudentReport({users,patients,appointments,treatments,dentalRecords},filters)});
  }catch(error){return json({error:error instanceof Error?error.message:'Unable to generate student report.'},400);}
});
