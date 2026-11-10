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
const iso=(d:Date)=>d.toISOString().slice(0,10);
const monthStart=(base:Date,offset:number)=>new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+offset,1));
const monthDays=(d:Date)=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
// A stock change can be undone by the person who recorded it for a short while afterwards.
const UNDO_WINDOW_MS=15*60*1000;

async function notifyLowStock(admin:any,item:any){
  if(Number(item.quantity)>Number(item.threshold))return;
  const {data:recipients}=await admin.from("users")
    .select("user_id").eq("role","Staff").eq("status","Active");

  const rows=(recipients||[]).map((u:any)=>({
    user_id:u.user_id,
    title:"Low Stock Alert",
    message:`${item.item_name} is at ${item.quantity} ${item.unit}, at or below its threshold of ${item.threshold}.`,
    type:"Inventory",
    channel:"In-app",
    delivery_status:"Created"
  }));

  if(rows.length)await admin.from("notifications").insert(rows);
}

async function regenerateForecasts(admin:any,itemIds:number[]|null=null){
  let itemQuery=admin.from("inventory_items")
    .select("item_id,item_name,category,quantity,threshold,unit")
    .eq("archived",false);

  if(itemIds?.length)itemQuery=itemQuery.in("item_id",itemIds);
  const {data:items,error:itemErr}=await itemQuery;
  if(itemErr)throw itemErr;

  const now=new Date();
  const start90=new Date(now.getTime()-90*86400000);
  const nextMonth=monthStart(now,1);
  const generated:any[]=[];

  for(const item of items||[]){
    const {data:tx,error:txErr}=await admin.from("inventory_transactions")
      .select("quantity,transaction_date")
      .eq("item_id",item.item_id)
      .eq("transaction_type","Disbursement")
      .gte("transaction_date",start90.toISOString())
      .order("transaction_date",{ascending:true});
    if(txErr)throw txErr;

    const windows=[0,0,0];
    for(const row of tx||[]){
      const daysAgo=Math.floor((now.getTime()-new Date(row.transaction_date).getTime())/86400000);
      if(daysAgo<30)windows[0]+=Number(row.quantity||0);
      else if(daysAgo<60)windows[1]+=Number(row.quantity||0);
      else if(daysAgo<90)windows[2]+=Number(row.quantity||0);
    }

    const total=windows.reduce((a,b)=>a+b,0);
    const weightedDaily=total>0
      ? Math.max(total/90*0.5,(windows[0]/30)*0.6+(windows[1]/30)*0.3+(windows[2]/30)*0.1)
      : 0;

    const stockoutDays=weightedDaily>0?Math.ceil(Number(item.quantity)/weightedDaily):null;
    const stockoutDate=stockoutDays!==null?iso(new Date(now.getTime()+stockoutDays*86400000)):null;

    await admin.from("inventory_forecasts")
      .delete()
      .eq("item_id",item.item_id)
      .gte("forecast_month",iso(nextMonth));

    let runningStock=Number(item.quantity);
    const rows:any[]=[];

    for(let m=1;m<=3;m++){
      const target=monthStart(now,m);
      const days=monthDays(target);
      const smoothing=1+0.02*(m-1);
      const predicted=Math.max(0,Math.round(weightedDaily*days*smoothing));
      runningStock-=predicted;

      const projectedRemaining=Math.round(runningStock);
      const recommended=Math.max(
        0,
        Math.ceil(Number(item.threshold)+predicted-Math.max(0,projectedRemaining))
      );

      rows.push({
        item_id:item.item_id,
        forecast_month:iso(target),
        predicted_usage:predicted,
        predicted_remaining_stock:projectedRemaining,
        predicted_stockout_date:stockoutDate,
        recommended_reorder_qty:recommended,
        generated_at:new Date().toISOString()
      });
    }

    const {error:forecastErr}=await admin.from("inventory_forecasts")
      .upsert(rows,{onConflict:"item_id,forecast_month"});
    if(forecastErr)throw forecastErr;
    generated.push(...rows);
  }

  return generated;
}

async function notifyUsers(admin:any,userIds:number[],title:string,message:string,page:string,refType:string,refId:number){
  const rows=[...new Set(userIds.filter(Boolean))].map(id=>({
    user_id:id,title,message,type:"Inventory",channel:"In-app",delivery_status:"Created",
    reference_type:refType,reference_id:refId,action_page:page
  }));
  if(rows.length)await admin.from("notifications").insert(rows);
}
async function roleUserIds(admin:any,role:string){
  const {data}=await admin.from("users").select("user_id").eq("role",role).eq("status","Active");
  return (data||[]).map((u:any)=>u.user_id);
}
async function applyTx(admin:any,actorId:number,itemId:number,txType:string,quantity:number,notes:string){
  const {data,error}=await admin.rpc("inventory_apply_transaction_at",{
    p_item_id:itemId,p_transaction_type:txType,p_quantity:quantity,p_notes:notes,
    p_created_by:actorId,p_transaction_date:new Date().toISOString()
  });
  if(error)throw new Error(error.message);
  const item=Array.isArray(data)?data[0]:data;
  const {data:tx}=await admin.from("inventory_transactions").select("transaction_id")
    .eq("item_id",itemId).eq("created_by",actorId).eq("transaction_type",txType)
    .order("transaction_id",{ascending:false}).limit(1).maybeSingle();
  return {item,transactionId:tx?.transaction_id||null};
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
      .eq("auth_user_id",user.id).maybeSingle();

    if(actorErr||!actor||actor.status!=="Active")
      return json({error:"Active CampusCare account required."},403);

    const body=await req.json();
    const action=String(body.action||"").toLowerCase();
    // Inventory is run by staff; administrators handle accounts only.
    const canManage=actor.role==="Staff";

    if(action==="generate_forecasts"){
      if(!canManage)return json({error:"Staff access required."},403);
      const forecasts=await regenerateForecasts(admin,null);
      return json({ok:true,forecast_count:forecasts.length});
    }

    // Medicine requests: a doctor asks the clinic's stock for medicine; staff release or decline it.
    if(action==="request_medicine"){
      if(actor.role!=="Doctor")return json({error:"Only doctors request medicine."},403);
      const itemId=Number(body.item_id||0),quantity=Number(body.quantity);
      const purpose=clean(body.purpose,500);
      const patientId=body.patient_id?Number(body.patient_id):null;
      if(!itemId||!Number.isInteger(quantity)||quantity<=0||quantity>10000)
        return json({error:"Choose a medicine and a quantity of at least 1."},400);
      if(purpose.length<3)return json({error:"Say what the medicine is for."},400);
      const {data:item}=await admin.from("inventory_items").select("item_id,item_name,unit,archived").eq("item_id",itemId).maybeSingle();
      if(!item||item.archived)return json({error:"That medicine is not in the clinic's stock list."},404);
      if(patientId){
        const {data:pt}=await admin.from("patients").select("patient_id").eq("patient_id",patientId).maybeSingle();
        if(!pt)return json({error:"Patient not found."},404);
      }
      const {data:req,error}=await admin.from("inventory_requests").insert({
        item_id:itemId,quantity,requested_by:actor.user_id,patient_id:patientId,purpose
      }).select("*").single();
      if(error)return json({error:error.message},400);
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"MEDICINE_REQUESTED",entity_type:"inventory_requests",entity_id:req.request_id,details:{item_id:itemId,quantity}});
      await notifyUsers(admin,await roleUserIds(admin,"Staff"),"Medicine request",
        `A doctor asked for ${quantity} ${item.unit||""} of ${item.item_name}. Release it or decline it in Inventory.`,"inventory","inventory_requests",req.request_id);
      return json({ok:true,request:req});
    }
    if(action==="withdraw_request"){
      const id=Number(body.request_id||0);
      const {data:r}=await admin.from("inventory_requests").select("*").eq("request_id",id).maybeSingle();
      if(!r)return json({error:"Request not found."},404);
      if(r.requested_by!==actor.user_id)return json({error:"Only the doctor who asked can withdraw this request."},403);
      if(r.status!=="Pending")return json({error:`This request was already ${r.status.toLowerCase()}.`},409);
      const {data:saved}=await admin.from("inventory_requests").update({status:"Withdrawn",decided_at:new Date().toISOString()}).eq("request_id",id).eq("status","Pending").select("*").maybeSingle();
      if(!saved)return json({error:"This request was just answered. Refresh to see it."},409);
      return json({ok:true,request:saved});
    }

    if(!canManage)return json({error:"Staff access required."},403);

    if(action==="release_request"||action==="decline_request"){
      const id=Number(body.request_id||0);
      const reason=clean(body.reason,500);
      const {data:r}=await admin.from("inventory_requests").select("*").eq("request_id",id).maybeSingle();
      if(!r)return json({error:"Request not found."},404);
      if(r.status!=="Pending")return json({error:`This request was already ${r.status.toLowerCase()}.`},409);
      const {data:item}=await admin.from("inventory_items").select("item_id,item_name,unit,quantity").eq("item_id",r.item_id).maybeSingle();
      if(action==="decline_request"){
        if(reason.length<3)return json({error:"Give a reason for declining."},400);
        const {data:saved}=await admin.from("inventory_requests").update({status:"Declined",decided_by:actor.user_id,decided_at:new Date().toISOString(),decline_reason:reason}).eq("request_id",id).eq("status","Pending").select("*").maybeSingle();
        if(!saved)return json({error:"This request was just answered. Refresh to see it."},409);
        await admin.from("audit_logs").insert({user_id:actor.user_id,action:"MEDICINE_REQUEST_DECLINED",entity_type:"inventory_requests",entity_id:id,details:{reason}});
        await notifyUsers(admin,[r.requested_by],"Medicine request declined",`Your request for ${r.quantity} ${item?.unit||""} of ${item?.item_name||"medicine"} was declined: ${reason}`,"medicine-requests","inventory_requests",id);
        return json({ok:true,request:saved});
      }
      if(!item||Number(item.quantity)<Number(r.quantity))
        return json({error:`Only ${item?.quantity??0} ${item?.unit||""} on hand. Decline the request or record new stock first.`},409);
      // Claim the request first so two staff cannot release it twice.
      const {data:claimed}=await admin.from("inventory_requests").update({status:"Released",decided_by:actor.user_id,decided_at:new Date().toISOString()}).eq("request_id",id).eq("status","Pending").select("*").maybeSingle();
      if(!claimed)return json({error:"This request was just answered. Refresh to see it."},409);
      let result;
      try{
        result=await applyTx(admin,actor.user_id,r.item_id,"Disbursement",r.quantity,`Released for medicine request #${id}${r.purpose?`: ${r.purpose}`:""}`.slice(0,800));
      }catch(e){
        await admin.from("inventory_requests").update({status:"Pending",decided_by:null,decided_at:null}).eq("request_id",id);
        return json({error:(e as Error).message},400);
      }
      const {data:saved}=await admin.from("inventory_requests").update({transaction_id:result.transactionId}).eq("request_id",id).select("*").single();
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"MEDICINE_REQUEST_RELEASED",entity_type:"inventory_requests",entity_id:id,details:{item_id:r.item_id,quantity:r.quantity,transaction_id:result.transactionId}});
      await notifyUsers(admin,[r.requested_by],"Medicine released",`${r.quantity} ${item.unit||""} of ${item.item_name} is ready at the clinic.`,"medicine-requests","inventory_requests",id);
      if(result.item)await notifyLowStock(admin,result.item);
      await regenerateForecasts(admin,[r.item_id]);
      return json({ok:true,request:saved,item:result.item});
    }

    if(action==="create_po"){
      const lines=(Array.isArray(body.items)?body.items:[]).map((l:any)=>({
        item_id:Number(l?.item_id||0),quantity:Number(l?.quantity)
      }));
      if(!lines.length||lines.length>50)return json({error:"Add at least one medicine to the order."},400);
      const ids=new Set<number>();
      for(const l of lines){
        if(!l.item_id||!Number.isInteger(l.quantity)||l.quantity<=0||l.quantity>100000)
          return json({error:"Each line needs a medicine and a quantity of at least 1."},400);
        if(ids.has(l.item_id))return json({error:"Each medicine can appear once per order."},400);
        ids.add(l.item_id);
      }
      const {data:items}=await admin.from("inventory_items").select("item_id,archived").in("item_id",[...ids]);
      if((items||[]).filter((i:any)=>!i.archived).length!==ids.size)return json({error:"An item on the order is not in the stock list."},400);
      const neededBy=body.needed_by?String(body.needed_by).slice(0,10):null;
      if(neededBy&&!/^\d{4}-\d{2}-\d{2}$/.test(neededBy))return json({error:"Needed-by date is not valid."},400);
      const {data:po,error}=await admin.from("purchase_orders").insert({
        supplier:clean(body.supplier,255)||null,notes:clean(body.notes,800)||null,needed_by:neededBy,created_by:actor.user_id
      }).select("*").single();
      if(error)return json({error:error.message},400);
      const year=new Date().getUTCFullYear();
      const poNo=`PO-${year}-${String(po.po_id).padStart(4,"0")}`;
      await admin.from("purchase_orders").update({po_no:poNo}).eq("po_id",po.po_id);
      const {error:lineErr}=await admin.from("purchase_order_items").insert(lines.map((l:any)=>({...l,po_id:po.po_id})));
      if(lineErr){await admin.from("purchase_orders").delete().eq("po_id",po.po_id);return json({error:lineErr.message},400);}
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"PURCHASE_ORDER_PREPARED",entity_type:"purchase_orders",entity_id:po.po_id,details:{po_no:poNo,lines:lines.length}});
      return json({ok:true,purchase_order:{...po,po_no:poNo}});
    }

    // Staff hand the printed order to whoever buys, then mark it sent; or cancel an order no longer needed.
    if(action==="send_po"||action==="cancel_po"){
      const id=Number(body.po_id||0);
      const reason=clean(body.reason,500);
      const {data:po}=await admin.from("purchase_orders").select("*").eq("po_id",id).maybeSingle();
      if(!po)return json({error:"Purchase order not found."},404);
      const from=action==="send_po"?["Prepared"]:["Prepared","Sent"];
      if(!from.includes(po.status))return json({error:`This order is already ${po.status.toLowerCase()}.`},409);
      if(action==="cancel_po"&&reason.length<3)return json({error:"Give a reason for cancelling the order."},400);
      const patch:any=action==="send_po"
        ?{status:"Sent",sent_by:actor.user_id,sent_at:new Date().toISOString()}
        :{status:"Cancelled",cancel_reason:reason,cancelled_at:new Date().toISOString()};
      const {data:saved,error}=await admin.from("purchase_orders").update(patch).eq("po_id",id).in("status",from).select("*").maybeSingle();
      if(error)return json({error:error.message},400);
      if(!saved)return json({error:"This order just changed. Refresh to see it."},409);
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:action==="send_po"?"PURCHASE_ORDER_SENT":"PURCHASE_ORDER_CANCELLED",entity_type:"purchase_orders",entity_id:id,details:{po_no:po.po_no,reason:reason||null}});
      return json({ok:true,purchase_order:saved});
    }

    if(action==="receive_po"){
      const id=Number(body.po_id||0);
      const {data:po}=await admin.from("purchase_orders").select("*").eq("po_id",id).maybeSingle();
      if(!po)return json({error:"Purchase order not found."},404);
      if(!["Prepared","Sent"].includes(po.status))return json({error:po.status==="Received"?"This order was already received.":"A cancelled order cannot be received."},409);
      // Only what arrived in good condition goes into stock; anything short or damaged needs a note.
      const {data:lines}=await admin.from("purchase_order_items").select("po_item_id,item_id,quantity").eq("po_id",id);
      const given=new Map((Array.isArray(body.received)?body.received:[]).map((r:any)=>[Number(r?.item_id),Number(r?.quantity)]));
      const counts=(lines||[]).map((l:any)=>({...l,received:given.has(Number(l.item_id))?given.get(Number(l.item_id)):Number(l.quantity)}));
      if(counts.some((l:any)=>!Number.isInteger(l.received)||l.received<0||l.received>Number(l.quantity)))
        return json({error:"Each received amount must be a whole number from 0 up to the amount ordered."},400);
      const short=counts.reduce((n:number,l:any)=>n+Number(l.quantity)-l.received,0);
      const note=clean(body.note,500);
      if(short>0&&note.length<3)return json({error:"Say what was short or damaged."},400);
      const {data:claimed}=await admin.from("purchase_orders").update({status:"Received",received_by:actor.user_id,received_at:new Date().toISOString(),receive_note:note||null}).eq("po_id",id).eq("status",po.status).select("*").maybeSingle();
      if(!claimed)return json({error:"This order was just received. Refresh to see it."},409);
      for(const l of counts){
        await admin.from("purchase_order_items").update({received_quantity:l.received}).eq("po_item_id",l.po_item_id);
        if(l.received>0)await applyTx(admin,actor.user_id,l.item_id,"Stock In",l.received,`Received on ${po.po_no}${l.received<Number(l.quantity)?` (${Number(l.quantity)-l.received} short or damaged)`:""}`);
      }
      await admin.from("audit_logs").insert({user_id:actor.user_id,action:"PURCHASE_ORDER_RECEIVED",entity_type:"purchase_orders",entity_id:id,details:{po_no:po.po_no,short,note:note||null}});
      await regenerateForecasts(admin,(lines||[]).map((l:any)=>l.item_id));
      return json({ok:true,purchase_order:claimed});
    }

    if(action==="create"||action==="update"){
      const itemId=Number(body.item_id||0);
      const itemName=clean(body.item_name,255);
      const category=clean(body.category,100);
      const quantity=Number(body.quantity);
      const threshold=Number(body.threshold);
      const unit=clean(body.unit,80);
      const expiryDate=body.expiry_date?String(body.expiry_date):null;
      const supplier=clean(body.supplier,255);
      const targetDate=body.target_disbursement_date?String(body.target_disbursement_date):null;
      const photoData=clean(body.photo_data,350000);

      if(!itemName||!category||!unit||!Number.isInteger(quantity)||quantity<0||!Number.isInteger(threshold)||threshold<0)
        return json({error:"Name, category, quantity, threshold, and unit are required."},400);

      let saved:any=null;

      if(action==="create"){
        const {data,error}=await admin.from("inventory_items").insert({
          item_name:itemName,category,quantity,threshold,unit,
          expiry_date:expiryDate,supplier:supplier||null,
          target_disbursement_date:targetDate,photo_data:photoData||null,
          archived:false
        }).select("*").single();
        if(error)throw error;
        saved=data;

        if(quantity>0){
          await admin.from("inventory_transactions").insert({
            item_id:saved.item_id,
            transaction_type:"Stock In",
            quantity,
            transaction_date:new Date().toISOString(),
            notes:"Initial inventory quantity",
            created_by:actor.user_id
          });
        }

        await admin.from("audit_logs").insert({
          user_id:actor.user_id,action:"INVENTORY_ITEM_CREATED",
          entity_type:"inventory_items",entity_id:saved.item_id,
          details:{item_name:itemName,quantity,threshold,unit}
        });
      }else{
        const {data:existing}=await admin.from("inventory_items")
          .select("*").eq("item_id",itemId).maybeSingle();
        if(!existing)return json({error:"Inventory item not found."},404);
        if(existing.archived)return json({error:"Restore this item before editing it."},400);

        const {data,error}=await admin.from("inventory_items").update({
          item_name:itemName,category,quantity,threshold,unit,
          expiry_date:expiryDate,supplier:supplier||null,
          target_disbursement_date:targetDate,photo_data:photoData||null,
          updated_at:new Date().toISOString()
        }).eq("item_id",itemId).select("*").single();
        if(error)throw error;
        saved=data;

        if(Number(existing.quantity)!==quantity){
          await admin.from("inventory_transactions").insert({
            item_id:itemId,
            transaction_type:"Adjustment",
            quantity:Math.abs(quantity-Number(existing.quantity)),
            transaction_date:new Date().toISOString(),
            notes:`Manual quantity adjustment: ${existing.quantity} → ${quantity}`,
            created_by:actor.user_id
          });
        }

        await admin.from("audit_logs").insert({
          user_id:actor.user_id,action:"INVENTORY_ITEM_UPDATED",
          entity_type:"inventory_items",entity_id:itemId,
          details:{item_name:itemName,quantity,threshold,unit}
        });
      }

      await notifyLowStock(admin,saved);
      await regenerateForecasts(admin,[saved.item_id]);
      return json({ok:true,item:saved});
    }

    if(action==="set_quantity"){
      const itemId=Number(body.item_id||0);
      const newQuantity=Number(body.quantity);
      const reason=clean(body.reason,500);
      // The reason decides how the change shows in stock movements: a delivery is Stock In, removed expired
      // stock is Expired, anything else (count correction, damage, return) is an Adjustment.
      const movement=["Stock In","Expired"].includes(String(body.movement))?String(body.movement):"Adjustment";

      if(!itemId||!Number.isInteger(newQuantity)||newQuantity<0)
        return json({error:"A valid non-negative quantity is required."},400);

      const {data:existing}=await admin.from("inventory_items")
        .select("*").eq("item_id",itemId).maybeSingle();
      if(!existing)return json({error:"Inventory item not found."},404);
      if(existing.archived)return json({error:"Restore this item before updating quantity."},400);
      if(movement==="Stock In"&&newQuantity<=Number(existing.quantity))return json({error:"New stock should raise the quantity. Enter the count after adding the delivery."},400);
      if(movement==="Expired"&&newQuantity>=Number(existing.quantity))return json({error:"Removing expired stock should lower the quantity."},400);

      const {data:saved,error}=await admin.from("inventory_items")
        .update({quantity:newQuantity,updated_at:new Date().toISOString()})
        .eq("item_id",itemId).select("*").single();
      if(error)throw error;

      let transactionId:number|null=null;
      if(Number(existing.quantity)!==newQuantity){
        const {data:tx}=await admin.from("inventory_transactions").insert({
          item_id:itemId,
          transaction_type:movement,
          quantity:Math.abs(newQuantity-Number(existing.quantity)),
          transaction_date:new Date().toISOString(),
          notes:`${reason||"Manual adjustment"}: ${existing.quantity} → ${newQuantity}`,
          created_by:actor.user_id
        }).select("transaction_id").single();
        transactionId=tx?.transaction_id||null;
      }

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"INVENTORY_QUANTITY_UPDATED",
        entity_type:"inventory_items",entity_id:itemId,
        details:{previous_quantity:existing.quantity,new_quantity:newQuantity,reason:reason||null,movement}
      });

      await notifyLowStock(admin,saved);
      await regenerateForecasts(admin,[itemId]);
      return json({ok:true,item:saved,transaction_id:transactionId});
    }

    if(action==="disburse"||action==="stock_in"||action==="expired"){
      const itemId=Number(body.item_id||0);
      const quantity=Number(body.quantity);
      const notes=clean(body.notes,800);
      const txDateRaw=body.transaction_date?String(body.transaction_date):new Date().toISOString();
      const txDate=new Date(txDateRaw.includes("T")?txDateRaw:txDateRaw+"T12:00:00+08:00");

      if(!itemId||!Number.isInteger(quantity)||quantity<=0)
        return json({error:"Quantity must be at least 1."},400);
      if(Number.isNaN(txDate.getTime())||txDate.getTime()>Date.now()+60000)
        return json({error:"Transaction date cannot be in the future."},400);

      const txType=action==="disburse"?"Disbursement":action==="stock_in"?"Stock In":"Expired";
      const {data:rpcData,error}=await admin.rpc("inventory_apply_transaction_at",{
        p_item_id:itemId,
        p_transaction_type:txType,
        p_quantity:quantity,
        p_notes:notes,
        p_created_by:actor.user_id,
        p_transaction_date:txDate.toISOString()
      });
      if(error)return json({error:error.message},400);

      const item=Array.isArray(rpcData)?rpcData[0]:rpcData;
      const {data:tx}=await admin.from("inventory_transactions")
        .select("transaction_id")
        .eq("item_id",itemId).eq("created_by",actor.user_id).eq("transaction_type",txType)
        .order("transaction_id",{ascending:false}).limit(1).maybeSingle();

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:action==="disburse"?"INVENTORY_DISBURSEMENT":action==="stock_in"?"INVENTORY_STOCK_IN":"INVENTORY_EXPIRED",
        entity_type:"inventory_items",entity_id:itemId,
        details:{quantity,transaction_date:txDate.toISOString(),notes:notes||null}
      });

      if(item)await notifyLowStock(admin,item);
      await regenerateForecasts(admin,[itemId]);
      return json({ok:true,item,transaction_id:tx?.transaction_id||null});
    }

    // Reverse a stock change just recorded by mistake: the quantity goes back and the entry is removed,
    // so usage history and forecasts no longer count it.
    if(action==="undo_transaction"){
      const txId=Number(body.transaction_id||0);
      const {data:tx}=await admin.from("inventory_transactions").select("*").eq("transaction_id",txId).maybeSingle();
      if(!tx)return json({error:"That stock change was not found."},404);
      if(Number(tx.created_by)!==Number(actor.user_id))return json({error:"Only the person who recorded this change can undo it."},403);
      if(!tx.created_at||Date.now()-new Date(tx.created_at).getTime()>UNDO_WINDOW_MS)
        return json({error:"This change can no longer be undone. Record a correcting adjustment instead."},409);

      const {data:item}=await admin.from("inventory_items").select("*").eq("item_id",tx.item_id).maybeSingle();
      if(!item)return json({error:"Inventory item not found."},404);
      if(item.archived)return json({error:"Restore this item before undoing its stock changes."},409);

      let delta=0;
      if(tx.transaction_type==="Stock In")delta=-Number(tx.quantity);
      else if(tx.transaction_type==="Disbursement"||tx.transaction_type==="Expired")delta=Number(tx.quantity);
      else{
        const m=String(tx.notes||"").match(/(\d+) → (\d+)$/);
        if(!m)return json({error:"This adjustment can't be undone automatically."},409);
        delta=Number(m[1])-Number(m[2]);
      }
      const next=Number(item.quantity)+delta;
      if(next<0)return json({error:"Some of this stock has already been used, so the change can't be undone."},409);

      // Only apply when nobody changed the quantity in the meantime.
      const {data:saved,error}=await admin.from("inventory_items")
        .update({quantity:next,updated_at:new Date().toISOString()})
        .eq("item_id",item.item_id).eq("quantity",item.quantity)
        .select("*").maybeSingle();
      if(error)throw error;
      if(!saved)return json({error:"The stock level changed in the meantime. Refresh and try again."},409);

      const {error:deleteErr}=await admin.from("inventory_transactions").delete().eq("transaction_id",txId);
      if(deleteErr)throw deleteErr;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,action:"INVENTORY_CHANGE_UNDONE",
        entity_type:"inventory_items",entity_id:item.item_id,
        details:{transaction_type:tx.transaction_type,quantity:tx.quantity,previous_quantity:item.quantity,new_quantity:next}
      });

      await regenerateForecasts(admin,[item.item_id]);
      return json({ok:true,item:saved});
    }

    if(action==="archive"||action==="restore"){
      if(actor.role!=="Staff")
        return json({error:"Staff access required."},403);

      const itemId=Number(body.item_id||0);
      const archived=action==="archive";
      const kind=String(body.reason||"");
      const note=clean(body.note,200);
      if(archived&&!["Discontinued","Expired","Inactive","Other"].includes(kind))return json({error:"Choose why the item is archived."},400);
      if(archived&&kind==="Other"&&note.length<3)return json({error:"Describe the reason for archiving."},400);
      const archiveReason=archived?(kind==="Other"?note:kind):null;
      const {data:item,error}=await admin.from("inventory_items")
        .update({
          archived,
          archive_reason:archiveReason,
          archived_at:archived?new Date().toISOString():null,
          archived_by:archived?actor.user_id:null,
          updated_at:new Date().toISOString()
        })
        .eq("item_id",itemId)
        .select("*")
        .single();
      if(error)throw error;

      await admin.from("audit_logs").insert({
        user_id:actor.user_id,
        action:archived?"INVENTORY_ITEM_ARCHIVED":"INVENTORY_ITEM_RESTORED",
        entity_type:"inventory_items",entity_id:itemId,
        details:{item_name:item.item_name,reason:archiveReason}
      });

      return json({ok:true,item});
    }

    return json({error:"Unsupported inventory action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Inventory action failed."},500);
  }
});
