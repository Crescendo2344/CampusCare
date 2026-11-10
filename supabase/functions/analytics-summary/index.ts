import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json"}
});
const iso=(d:Date)=>d.toISOString().slice(0,10);
const monthKey=(d:Date)=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
const monthLabel=(key:string)=>{
  const [y,m]=key.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,1)).toLocaleDateString("en-PH",{month:"short",year:"numeric",timeZone:"UTC"});
};
const addDays=(date:string,n:number)=>{
  const d=new Date(date+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return iso(d);
};
const daysBetween=(a:string,b:string)=>Math.max(1,Math.round((new Date(b+"T00:00:00Z").getTime()-new Date(a+"T00:00:00Z").getTime())/86400000)+1);
const nextMonthKeys=(base:Date,count:number)=>{
  const out:string[]=[];
  for(let i=1;i<=count;i++)out.push(monthKey(new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+i,1))));
  return out;
};
function linearForecast(values:number[],steps=3){
  const n=values.length;
  if(!n)return Array(steps).fill(0);
  const total=values.reduce((a,b)=>a+b,0);
  if(total<3){
    const avg=total/n;
    return Array.from({length:steps},()=>Math.max(0,Math.round(avg)));
  }
  const sx=(n-1)*n/2;
  const sy=total;
  const sxx=(n-1)*n*(2*n-1)/6;
  const sxy=values.reduce((s,y,x)=>s+x*y,0);
  const denom=n*sxx-sx*sx;
  const slope=denom===0?0:(n*sxy-sx*sy)/denom;
  const intercept=(sy-slope*sx)/n;
  return Array.from({length:steps},(_,i)=>Math.max(0,Math.round(intercept+slope*(n+i))));
}

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

    const {data:actor,error:actorErr}=await admin.from("users")
      .select("user_id,role,status")
      .eq("auth_user_id",user.id)
      .maybeSingle();

    if(actorErr||!actor||actor.status!=="Active")
      return json({error:"Active CampusCare account required."},403);
    if(!["Administrator","Staff","Doctor"].includes(actor.role))
      return json({error:"Reports access required."},403);

    const body=await req.json();
    const today=iso(new Date());
    const from=String(body.from||today.slice(0,7)+"-01");
    const to=String(body.to||today);
    const college=String(body.college||"").trim();

    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)
      return json({error:"Invalid report date range."},400);

    const span=daysBetween(from,to);
    const prevTo=addDays(from,-1);
    const prevFrom=addDays(prevTo,-(span-1));

    // Directory is used only to map patient -> college/person type.
    const {data:patientRows,error:patientErr}=await admin.from("patients")
      .select("patient_id,user_id,archived_at");
    if(patientErr)throw patientErr;

    const patientUserIds=(patientRows||[]).map((p:any)=>p.user_id).filter(Boolean);
    const {data:userRows,error:userMapErr}=patientUserIds.length
      ? await admin.from("users").select("user_id,college,person_type").in("user_id",patientUserIds)
      : {data:[],error:null};
    if(userMapErr)throw userMapErr;

    const userMap=new Map((userRows||[]).map((u:any)=>[Number(u.user_id),u]));
    const patientMap=new Map((patientRows||[]).map((p:any)=>[
      Number(p.patient_id),
      { ...p, ...(userMap.get(Number(p.user_id))||{}) }
    ]));

    const patientAllowed=(patientId:number)=>{
      const p:any=patientMap.get(Number(patientId));
      if(!p||p.archived_at)return false;
      return !college||String(p.college||"")===college;
    };

    let apptQuery=admin.from("appointments")
      .select("appointment_id,patient_id,doctor_id,clinic,service,appointment_date,status")
      .gte("appointment_date",prevFrom)
      .lte("appointment_date",to);
    if(actor.role==="Doctor")apptQuery=apptQuery.eq("doctor_id",actor.user_id);

    let treatmentQuery=admin.from("treatments")
      .select("treatment_id,patient_id,doctor_id,appointment_id,diagnosis,treatment_date,status")
      .gte("treatment_date",prevFrom)
      .lte("treatment_date",to)
      .neq("status","Archived");
    if(actor.role==="Doctor")treatmentQuery=treatmentQuery.eq("doctor_id",actor.user_id);

    const [apptRes,treatRes]=await Promise.all([apptQuery,treatmentQuery]);
    if(apptRes.error)throw apptRes.error;
    if(treatRes.error)throw treatRes.error;

    const appointments=(apptRes.data||[]).filter((a:any)=>patientAllowed(Number(a.patient_id)));
    const treatments=(treatRes.data||[]).filter((t:any)=>patientAllowed(Number(t.patient_id)));

    const currentAppts=appointments.filter((a:any)=>a.appointment_date>=from&&a.appointment_date<=to);
    const currentTreats=treatments.filter((t:any)=>t.treatment_date>=from&&t.treatment_date<=to);
    const prevTreats=treatments.filter((t:any)=>t.treatment_date>=prevFrom&&t.treatment_date<=prevTo);

    // Patients actually seen: a recorded treatment or a completed appointment. A booking, a no-show
    // or a cancellation alone does not make someone a patient seen in this range.
    const uniquePatients=new Set<number>();
    currentTreats.forEach((t:any)=>uniquePatients.add(Number(t.patient_id)));
    currentAppts.filter((a:any)=>a.status==="Completed").forEach((a:any)=>uniquePatients.add(Number(a.patient_id)));

    const diagnosisMap=new Map<string,number>();
    for(const t of currentTreats){
      const d=String(t.diagnosis||"Unspecified").trim()||"Unspecified";
      diagnosisMap.set(d,(diagnosisMap.get(d)||0)+1);
    }
    const diagnoses=[...diagnosisMap.entries()]
      .map(([name,count])=>({name,count}))
      .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name))
      .slice(0,10);

    const serviceMap=new Map<string,{name:string,clinic:string,count:number}>();
    for(const a of currentAppts.filter((x:any)=>x.status==="Completed")){
      const name=String(a.service||"Unspecified").trim()||"Unspecified";
      const clinic=String(a.clinic||"Clinic");
      const key=clinic+"|"+name;
      const row=serviceMap.get(key)||{name,clinic,count:0};
      row.count++;
      serviceMap.set(key,row);
    }
    const services=[...serviceMap.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,10);

    const collegeMap=new Map<string,number>();
    for(const t of currentTreats){
      const p:any=patientMap.get(Number(t.patient_id));
      const c=String(p?.college||"Unknown");
      collegeMap.set(c,(collegeMap.get(c)||0)+1);
    }
    const colleges=[...collegeMap.entries()]
      .map(([name,count])=>({name,count}))
      .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));

    const dailyMap=new Map<string,number>();
    for(const t of currentTreats){
      dailyMap.set(t.treatment_date,(dailyMap.get(t.treatment_date)||0)+1);
    }
    const dailyVisits=[...dailyMap.entries()]
      .map(([date,count])=>({date,count}))
      .sort((a,b)=>a.date.localeCompare(b.date));

    const visitGrowth=prevTreats.length===0
      ? (currentTreats.length?100:0)
      : Math.round(((currentTreats.length-prevTreats.length)/prevTreats.length)*100);

    const alerts:any[]=[];
    if(currentTreats.length>=2&&visitGrowth>=50){
      alerts.push({
        severity:visitGrowth>=100?"high":"medium",
        title:"Clinical visit trend increased",
        detail:`${currentTreats.length} clinical record${currentTreats.length===1?"":"s"} in the selected range (${visitGrowth>=0?"+":""}${visitGrowth}% vs the preceding ${span}-day range).`
      });
    }

    // 6-month historical treatment counts for 3-month forecasting.
    const toDate=new Date(to+"T00:00:00Z");
    const histStart=new Date(Date.UTC(toDate.getUTCFullYear(),toDate.getUTCMonth()-5,1));
    let histQuery=admin.from("treatments")
      .select("patient_id,doctor_id,treatment_date,status")
      .gte("treatment_date",iso(histStart))
      .lte("treatment_date",to)
      .neq("status","Archived");
    if(actor.role==="Doctor")histQuery=histQuery.eq("doctor_id",actor.user_id);

    const {data:histData,error:histErr}=await histQuery;
    if(histErr)throw histErr;

    const historyKeys=Array.from({length:6},(_,i)=>monthKey(new Date(Date.UTC(
      histStart.getUTCFullYear(),histStart.getUTCMonth()+i,1
    ))));
    const historyCounts=historyKeys.map(k=>(histData||[])
      .filter((t:any)=>patientAllowed(Number(t.patient_id))&&String(t.treatment_date).startsWith(k))
      .length);

    const forecastValues=linearForecast(historyCounts,3);
    const futureKeys=nextMonthKeys(toDate,3);
    const visitForecast=futureKeys.map((k,i)=>({
      month:k,
      label:monthLabel(k),
      predictedVisits:forecastValues[i]
    }));

    const totalHist=historyCounts.reduce((a,b)=>a+b,0);
    const forecastMeta={
      method:totalHist>=3?"linear trend over the last 6 months":"moving average fallback",
      confidence:totalHist>=12?"Moderate":totalHist>=3?"Limited":"Insufficient history",
      historicalVisits:totalHist
    };

    let medicineUsage:any[]=[];
    let medicineForecast:any[]=[];

    if(["Administrator","Staff"].includes(actor.role)){
      const {data:medicineItems,error:medItemErr}=await admin.from("inventory_items")
        .select("item_id,item_name,unit,category,archived")
        .ilike("category","Medicine")
        .eq("archived",false);
      if(medItemErr)throw medItemErr;

      const medMap=new Map((medicineItems||[]).map((i:any)=>[Number(i.item_id),i]));
      const medIds=[...medMap.keys()];

      if(medIds.length){
        const [{data:usageRows,error:usageErr},{data:forecastRows,error:forecastErr}]=await Promise.all([
          admin.from("inventory_transactions")
            .select("item_id,quantity,transaction_date")
            .in("item_id",medIds)
            .eq("transaction_type","Disbursement")
            .gte("transaction_date",from+"T00:00:00Z")
            .lte("transaction_date",to+"T23:59:59Z"),
          admin.from("inventory_forecasts")
            .select("item_id,forecast_month,predicted_usage,predicted_remaining_stock,recommended_reorder_qty")
            .in("item_id",medIds)
            .gte("forecast_month",futureKeys[0]+"-01")
            .lte("forecast_month",futureKeys[2]+"-28")
        ]);
        if(usageErr)throw usageErr;
        if(forecastErr)throw forecastErr;

        const useMap=new Map<number,number>();
        for(const row of usageRows||[]){
          useMap.set(Number(row.item_id),(useMap.get(Number(row.item_id))||0)+Number(row.quantity||0));
        }
        medicineUsage=[...useMap.entries()].map(([itemId,used])=>{
          const i:any=medMap.get(itemId);
          return {itemId,itemName:i?.item_name||"Medicine",unit:i?.unit||"",used};
        }).sort((a,b)=>b.used-a.used).slice(0,10);

        medicineForecast=(forecastRows||[]).map((f:any)=>{
          const i:any=medMap.get(Number(f.item_id));
          return {
            itemId:Number(f.item_id),
            itemName:i?.item_name||"Medicine",
            unit:i?.unit||"",
            month:String(f.forecast_month).slice(0,7),
            label:monthLabel(String(f.forecast_month).slice(0,7)),
            predictedUsage:Number(f.predicted_usage||0),
            predictedRemainingStock:f.predicted_remaining_stock==null?null:Number(f.predicted_remaining_stock),
            recommendedReorderQty:Number(f.recommended_reorder_qty||0)
          };
        }).sort((a,b)=>a.month.localeCompare(b.month)||a.itemName.localeCompare(b.itemName));
      }
    }

    return json({
      ok:true,
      scope:actor.role==="Doctor"?"doctor":"campus",
      range:{from,to,previousFrom:prevFrom,previousTo:prevTo,days:span,college:college||null},
      summary:{
        clinicalVisits:currentTreats.length,
        appointments:currentAppts.length,
        completedAppointments:currentAppts.filter((a:any)=>a.status==="Completed").length,
        cancelledAppointments:currentAppts.filter((a:any)=>a.status==="Cancelled").length,
        scheduledAppointments:currentAppts.filter((a:any)=>a.status==="Scheduled"||a.status==="Confirmed").length,
        uniquePatients:uniquePatients.size,
        visitGrowth,
        topDiagnosis:diagnoses[0]||null,
        topService:services[0]||null,
        topCollege:colleges[0]||null
      },
      dailyVisits,
      diagnoses,
      services,
      colleges,
      alerts,
      visitHistory:historyKeys.map((month,i)=>({month,label:monthLabel(month),count:historyCounts[i]})),
      visitForecast,
      forecastMeta,
      medicineUsage,
      medicineForecast
    });
  }catch(e){
    return json({error:e instanceof Error?e.message:"Unable to generate analytics."},500);
  }
});
