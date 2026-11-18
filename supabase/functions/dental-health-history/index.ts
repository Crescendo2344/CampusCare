// Dental Health History Form for dental appointments.
// - Patients answer it for their own appointment after booking, or confirm that nothing changed this semester.
// - Dental Clinic staff, at check-in, hand the patient a device to answer it (the form starts blank) or record
//   that the paper form was used. Staff and administrators only ever see whether it is done.
// - Dentists read the answers, with the items to check before treatment, and mark them reviewed.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import {cleanHealthHistory,dhhAlerts,healthHistoryStatus} from '../_shared/dental-health-history.js';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const OPEN=['Pending','Scheduled','Confirmed'];
const COLUMNS='history_id,patient_id,appointment_id,answers,details,height_cm,weight_kg,source,confirmed_unchanged,attested,reviewed_by,reviewed_at,created_at';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);
  try{
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if(!token)return json({error:'Authentication required.'},401);
    const {data:{user},error:userError}=await admin.auth.getUser(token);
    if(userError||!user)return json({error:'Invalid session.'},401);
    const {data:actor,error:actorError}=await admin.from('users').select('user_id,role,status,clinic,specialty').eq('auth_user_id',user.id).maybeSingle();
    if(actorError)throw actorError;
    if(!actor||actor.status!=='Active')return json({error:'Active CampusCare account required.'},403);
    const dentist=actor.role==='Doctor'&&actor.specialty==='Dental';
    const dentalStaff=actor.role==='Staff'&&actor.clinic==='Dental Clinic';
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||'');

    const {data:settings}=await admin.from('system_settings').select('semester_start,semester_end,semester2_start,semester2_end').order('settings_id').limit(1).maybeSingle();
    let ownPatientId:number|null=null;
    if(actor.role==='Patient'){
      const {data}=await admin.from('patients').select('patient_id').eq('user_id',actor.user_id).maybeSingle();
      ownPatientId=data?.patient_id??null;
    }
    const histories=async(patientId:number)=>{
      const {data,error}=await admin.from('dental_health_histories').select(COLUMNS).eq('patient_id',patientId).order('created_at',{ascending:false}).limit(50);
      if(error)throw error;
      return data||[];
    };
    const audit=(act:string,appointment:any,extra:Record<string,unknown>={})=>admin.from('audit_logs').insert({user_id:actor.user_id,action:act,entity_type:'appointments',entity_id:appointment.appointment_id,details:{patient_id:appointment.patient_id,...extra}});

    // Status for a list of appointments: everyone who can see the appointment can see whether it is done.
    if(action==='status'){
      const ids=(Array.isArray(body.appointment_ids)?body.appointment_ids:[]).map(Number).filter(Number.isFinite).slice(0,200);
      if(!ids.length)return json({ok:true,statuses:{}});
      const {data:appointments,error}=await admin.from('appointments').select('appointment_id,patient_id,clinic,appointment_date,status').in('appointment_id',ids);
      if(error)throw error;
      const visible=(appointments||[]).filter(a=>a.clinic==='Dental Clinic'&&(
        actor.role==='Administrator'||dentist||dentalStaff||(actor.role==='Patient'&&a.patient_id===ownPatientId)));
      const byPatient=new Map<number,any[]>();
      for(const patientId of new Set(visible.map(a=>a.patient_id)))byPatient.set(patientId,await histories(patientId));
      const statuses:Record<string,unknown>={};
      for(const a of visible){
        const list=byPatient.get(a.patient_id)||[];
        const own=list.find(h=>Number(h.appointment_id)===Number(a.appointment_id));
        statuses[a.appointment_id]={...healthHistoryStatus(a,list,settings||{}),reviewed:Boolean(own?.reviewed_at),
          ...(dentist&&own?{alerts:dhhAlerts(own.answers).length}:{})};
      }
      return json({ok:true,statuses});
    }

    const appointmentId=Number(body.appointment_id||0);
    if(!appointmentId)return json({error:'Choose an appointment.'},400);
    const {data:appointment,error:appointmentError}=await admin.from('appointments').select('appointment_id,patient_id,clinic,appointment_date,appointment_time,status').eq('appointment_id',appointmentId).maybeSingle();
    if(appointmentError)throw appointmentError;
    if(!appointment||appointment.clinic!=='Dental Clinic')return json({error:'The Dental Health History is for dental appointments.'},404);
    const ownAppointment=actor.role==='Patient'&&appointment.patient_id===ownPatientId;
    const {data:patient}=await admin.from('patients').select('patient_id,user_id,birth_date,sex,height_cm,weight_kg').eq('patient_id',appointment.patient_id).maybeSingle();
    const female=patient?.sex!=='Male';
    const list=await histories(appointment.patient_id);
    const current=list.find(h=>Number(h.appointment_id)===appointmentId)||null;
    const status=healthHistoryStatus(appointment,list,settings||{});

    // The form's header (name, age, birth date, height, weight) for whoever fills it in.
    const header=async()=>{
      const {data:u}=await admin.from('users').select('first_name,last_name').eq('user_id',patient?.user_id).maybeSingle();
      return {name:[u?.first_name,u?.last_name].filter(Boolean).join(' '),birth_date:patient?.birth_date||null,sex:patient?.sex||null,female,
        height_cm:patient?.height_cm??null,weight_kg:patient?.weight_kg??null};
    };

    if(action==='get'){
      // Only the patient and the dentists read answers.
      if(!ownAppointment&&!dentist)return json({error:'Only the patient and the dentist can open the Dental Health History.'},403);
      const previous=status.status==='confirm'?list.find(h=>h.source!=='paper'):null;
      const history=current||(dentist?list.find(h=>h.source!=='paper')||null:null);
      return json({ok:true,status,patient:await header(),history,previous,alerts:history?dhhAlerts(history.answers):[],
        appointment:{appointment_id:appointment.appointment_id,appointment_date:appointment.appointment_date,appointment_time:appointment.appointment_time,status:appointment.status}});
    }

    if(action==='form'){
      // At check-in the device is handed to the patient: the header only, never earlier answers.
      if(!dentalStaff&&!ownAppointment&&!dentist)return json({error:'Dental Clinic staff, the dentist or the patient can open this form.'},403);
      return json({ok:true,status,patient:await header()});
    }

    if(action==='submit'){
      const checkIn=body.mode==='check-in';
      if(checkIn?!(dentalStaff||dentist):!ownAppointment)return json({error:checkIn?'Only Dental Clinic staff can take the form at check-in.':'You can only answer the form for your own appointment.'},403);
      if(!OPEN.includes(appointment.status))return json({error:'This appointment is no longer open.'},409);
      if(body.attested!==true)return json({error:'Please confirm the declaration at the end of the form.'},400);
      const clean=cleanHealthHistory(body,{female});
      if(!Object.keys(clean.answers).length)return json({error:'Answer the questions before submitting.'},400);
      const row={patient_id:appointment.patient_id,appointment_id:appointmentId,...clean,source:checkIn?'check-in':'online',
        confirmed_unchanged:false,attested:true,submitted_by:actor.user_id,reviewed_by:null,reviewed_at:null,created_at:new Date().toISOString()};
      const {error}=current?await admin.from('dental_health_histories').update(row).eq('history_id',current.history_id)
        :await admin.from('dental_health_histories').insert(row);
      if(error)throw error;
      // Height and weight also keep the patient record current.
      const measures:Record<string,number>={};
      if(clean.height_cm!=null)measures.height_cm=clean.height_cm;
      if(clean.weight_kg!=null)measures.weight_kg=clean.weight_kg;
      if(Object.keys(measures).length)await admin.from('patients').update({...measures,updated_at:new Date().toISOString()}).eq('patient_id',appointment.patient_id);
      await audit(current?'DENTAL_HISTORY_UPDATED':'DENTAL_HISTORY_SUBMITTED',appointment,{source:row.source});
      return json({ok:true});
    }

    if(action==='confirm'){
      if(!ownAppointment)return json({error:'You can only confirm the form for your own appointment.'},403);
      if(!OPEN.includes(appointment.status))return json({error:'This appointment is no longer open.'},409);
      if(body.attested!==true)return json({error:'Please confirm the declaration.'},400);
      if(current)return json({ok:true});
      if(status.status!=='confirm')return json({error:'Please answer the full form for this visit.'},409);
      const latest=list.find(h=>h.source!=='paper');
      const {error}=await admin.from('dental_health_histories').insert({patient_id:appointment.patient_id,appointment_id:appointmentId,answers:latest.answers,details:latest.details,
        height_cm:latest.height_cm,weight_kg:latest.weight_kg,source:'online',confirmed_unchanged:true,attested:true,submitted_by:actor.user_id});
      if(error)throw error;
      await audit('DENTAL_HISTORY_CONFIRMED',appointment);
      return json({ok:true});
    }

    if(action==='paper'){
      if(!dentalStaff&&!dentist)return json({error:'Only Dental Clinic staff or the dentist can record the paper form.'},403);
      if(current)return json({error:'This visit already has a Dental Health History.'},409);
      const {error}=await admin.from('dental_health_histories').insert({patient_id:appointment.patient_id,appointment_id:appointmentId,source:'paper',attested:true,submitted_by:actor.user_id});
      if(error)throw error;
      await audit('DENTAL_HISTORY_PAPER',appointment);
      return json({ok:true});
    }

    if(action==='review'){
      if(!dentist)return json({error:'Only the dentist can mark the Dental Health History reviewed.'},403);
      if(!current)return json({error:'There is no Dental Health History for this visit yet.'},404);
      const {error}=await admin.from('dental_health_histories').update({reviewed_by:actor.user_id,reviewed_at:new Date().toISOString()}).eq('history_id',current.history_id);
      if(error)throw error;
      await audit('DENTAL_HISTORY_REVIEWED',appointment);
      return json({ok:true});
    }

    return json({error:'Unsupported action.'},400);
  }catch(error){
    console.error('Dental health history failed:',error instanceof Error?error.message:error);
    return json({error:'The Dental Health History could not be saved or loaded. Please try again.'},500);
  }
});
