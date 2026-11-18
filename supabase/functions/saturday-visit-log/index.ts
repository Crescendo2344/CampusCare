// Saturday clinic visit log for active clinic administrators and staff. Staff see only their own clinic.
// It returns names, ages and contact numbers (as on the clinic's paper log) but never diagnoses or notes.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import {buildSaturdayVisitLog,saturdayLogFilterError} from './saturday-visit-log.js';
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
    const {data:actor,error:actorError}=await client.from('users').select('user_id,role,status,clinic').eq('auth_user_id',user.id).maybeSingle();
    if(actorError)throw actorError;
    if(actor?.status!=='Active'||!['Administrator','Staff'].includes(actor.role))return json({error:'Administrator or staff reports access required.'},403);
    const staffClinic=actor.role==='Staff'?(['Medical Clinic','Dental Clinic'].includes(actor.clinic)?actor.clinic:null):'';
    if(staffClinic===null)return json({error:'Your staff account has no clinic assigned. Ask the administrator.'},403);
    const body=await req.json().catch(()=>({}));
    const filters={from:String(body.from||''),to:String(body.to||''),clinic:staffClinic||String(body.clinic||''),
      college:String(body.college||'').slice(0,200),people:body.people==='everyone'?'everyone':'students'};
    const filterError=saturdayLogFilterError(filters,staffClinic);
    if(filterError)return json({error:filterError},400);
    // Only the selected dates are read; treatments are read in full so walk-ins and linked visits match.
    async function all(build:(offset:number)=>any){
      const rows:any[]=[];
      for(let offset=0;offset<100000;offset+=1000){
        const {data,error}=await build(offset).range(offset,offset+999);
        if(error)throw error;
        rows.push(...data||[]);
        if(!data||data.length<1000)return rows;
      }
      throw new Error('Report exceeds the supported record limit. Contact the administrator.');
    }
    const [appointments,treatments]=await Promise.all([
      all(()=>client.from('appointments').select('appointment_id,patient_id,clinic,service,appointment_date,appointment_time,status').gte('appointment_date',filters.from).lte('appointment_date',filters.to).order('appointment_id')),
      all(()=>client.from('treatments').select('treatment_id,patient_id,doctor_id,appointment_id,treatment_date,created_at,archived_at').order('treatment_id'))
    ]);
    // Treatments for appointments outside the range still need their appointment to be recognised.
    const known=new Set(appointments.map(a=>Number(a.appointment_id)));
    const outside=[...new Set(treatments.map(t=>t.appointment_id).filter(id=>id!=null&&!known.has(Number(id))))];
    const extra:any[]=[];
    for(let i=0;i<outside.length;i+=500){
      const {data,error}=await client.from('appointments').select('appointment_id,patient_id,clinic,service,appointment_date,appointment_time,status').in('appointment_id',outside.slice(i,i+500));
      if(error)throw error;
      extra.push(...data||[]);
    }
    const treatmentIds=treatments.filter(t=>t.treatment_date>=filters.from&&t.treatment_date<=filters.to||t.appointment_id!=null&&known.has(Number(t.appointment_id))).map(t=>t.treatment_id);
    const dentalRecords:any[]=[];
    for(let i=0;i<treatmentIds.length;i+=500){
      const {data,error}=await client.from('dental_records').select('treatment_id,course_major,year_section,accomplishment').in('treatment_id',treatmentIds.slice(i,i+500));
      if(error)throw error;
      dentalRecords.push(...data||[]);
    }
    const [patients,users]=await Promise.all([
      all(()=>client.from('patients').select('patient_id,user_id,birth_date,sex,course,major').order('patient_id')),
      all(()=>client.from('users').select('user_id,first_name,last_name,id_number,person_type,college,contact_number,role,specialty').order('user_id'))
    ]);
    const log=buildSaturdayVisitLog({users,patients,appointments:[...appointments,...extra],treatments,dentalRecords},filters);
    await client.from('audit_logs').insert({user_id:actor.user_id,action:'REPORT_SATURDAY_VISIT_LOG',entity_type:'reports',entity_id:null,
      details:{from:filters.from,to:filters.to,clinic:filters.clinic||'All',people:filters.people,visits:log.total}});
    return json({ok:true,log});
  }catch(error){
    console.error('Saturday visit log failed:',error instanceof Error?error.message:error);
    return json({error:'Unable to generate the Saturday visit log. Please try again.'},500);
  }
});
