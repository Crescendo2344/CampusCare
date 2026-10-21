import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {addBookingDays,buildDoctorAvailability,validBookingDate} from '../_shared/booking-availability.js';
// This authenticated endpoint reveals only available calendar days and anonymous slot states.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);
  try{
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const auth=req.headers.get('Authorization')||'';
    if(!auth.startsWith('Bearer '))return json({error:'Authentication required.'},401);
    const {data:{user},error:authError}=await admin.auth.getUser(auth.slice(7));
    if(authError||!user)return json({error:'Invalid session.'},401);
    const {data:actor,error:actorError}=await admin.from('users').select('user_id,role,status').eq('auth_user_id',user.id).maybeSingle();
    if(actorError||!actor||actor.status!=='Active')return json({error:'Active CampusCare account required.'},403);
    const body=await req.json(),doctorId=Number(body.doctor_id),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
    const from=String(body.from||today),to=String(body.to||addBookingDays(today,365));
    if(!Number.isSafeInteger(doctorId)||doctorId<=0||!validBookingDate(from)||!validBookingDate(to)||from<today||to<from||to>addBookingDays(today,365))return json({error:'Choose a valid doctor and a date range within the next year.'},400);
    const {data:doc,error:doctorError}=await admin.from('users').select('user_id,role,status,work_days,start_time,end_time,slot_duration,max_patients').eq('user_id',doctorId).maybeSingle();
    if(doctorError)throw doctorError;
    if(!doc||doc.role!=='Doctor'||doc.status!=='Active')return json({error:'This doctor is unavailable.'},404);
    // Only an authorized reschedule may ignore an existing reservation in the availability calculation.
    let exclude=0;
    if(body.appointment_id){
      const {data:appt,error}=await admin.from('appointments').select('appointment_id,patient_id').eq('appointment_id',Number(body.appointment_id)).maybeSingle();
      if(error)throw error;
      if(!appt)return json({error:'Appointment not found.'},404);
      if(!['Staff','Administrator'].includes(actor.role)){
        const {data:patient}=await admin.from('patients').select('user_id').eq('patient_id',appt.patient_id).maybeSingle();
        if(actor.role!=='Patient'||patient?.user_id!==actor.user_id)return json({error:'You may only reschedule your own appointment.'},403);
      }
      exclude=appt.appointment_id;
    }
    // Aggregate all reservations using a server-owned client, while returning no record IDs or personal data.
    // Paginate each calendar source: a busy doctor can exceed the Data API's 1,000-row default.
    const loadRows=async(makeQuery)=>{
      const rows=[];
      for(let offset=0;;offset+=1000){
        const result=await makeQuery().range(offset,offset+999);
        if(result.error)return {data:[],error:result.error};
        rows.push(...(result.data||[]));if((result.data||[]).length<1000)break;
      }
      return {data:rows,error:null};
    };
    const [rules,appointments,leaves,overrides,settings]=await Promise.all([
      loadRows(()=>admin.from('doctor_schedule_rules').select('weekday,is_working,start_time,end_time,slot_duration,max_patients,effective_from,effective_to').eq('doctor_id',doctorId).lte('effective_from',to).order('effective_from').order('rule_id')),
      loadRows(()=>admin.from('appointments').select('appointment_date,appointment_time,status').eq('doctor_id',doctorId).gte('appointment_date',from).lte('appointment_date',to).neq('status','Cancelled').neq('appointment_id',exclude||-1).order('appointment_id')),
      loadRows(()=>admin.from('doctor_leaves').select('leave_date').eq('doctor_id',doctorId).gte('leave_date',from).lte('leave_date',to).order('leave_date')),
      loadRows(()=>admin.from('appointment_slot_overrides').select('override_date,slot_time,is_available').eq('doctor_id',doctorId).gte('override_date',from).lte('override_date',to).order('override_date').order('slot_time')),
      admin.from('system_settings').select('lunch_start,lunch_end').order('settings_id').limit(1).maybeSingle()
    ]);
    for(const result of [rules,appointments,leaves,overrides,settings])if(result.error)throw result.error;
    const now=new Date(),nowMinutes=(now.getUTCHours()*60+now.getUTCMinutes()+480)%1440;
    const days=buildDoctorAvailability({from,to,today,nowMinutes,doctor:{workDays:Array.isArray(doc.work_days)?doc.work_days:['Mon','Tue','Wed','Thu','Fri'],startTime:doc.start_time,endTime:doc.end_time,slotDuration:doc.slot_duration,maxPatients:doc.max_patients},rules:rules.data||[],appointments:(appointments.data||[]).map(a=>({date:a.appointment_date,time:a.appointment_time,status:a.status})),leaves:(leaves.data||[]).map(l=>({date:l.leave_date})),overrides:(overrides.data||[]).map(o=>({date:o.override_date,time:o.slot_time,available:o.is_available})),settings:{lunchStart:settings.data?.lunch_start,lunchEnd:settings.data?.lunch_end}});
    return json({ok:true,doctor_id:doctorId,from,to,days});
  }catch(error){console.error('Booking availability:',error);return json({error:'Availability could not be loaded. Please retry.'},500);}
});
