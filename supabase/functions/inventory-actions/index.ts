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
    .select("user_id").in("role",["Staff","Administrator"]).eq("status","Active");

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
    const canManage=["Staff","Administrator"].includes(actor.role);

    if(action==="generate_forecasts"){
      if(!canManage)return json({error:"Staff or Administrator access required."},403);
      const forecasts=await regenerateForecasts(admin,null);
      return json({ok:true,forecast_count:forecasts.length});
    }

    if(!canManage)return json({error:"Staff or Administrator access required."},403);

    if(action==="create"||action==="update"){
      const itemId=Number(body.item_id||0);
      const itemName=clean(body.item_name,255);
      const category=clean(body.category,100);
      const quantity=Number(body.quantity);
      const threshold=Number(body.threshold);
      const unit=clean(body.unit,80);
      const expiryDate=body.expiry_date?String(body.expiry_date):null;
      const supplier=clean(body.supplier,255);
      const unitCost=body.unit_cost===""||body.unit_cost==null?null:Number(body.unit_cost);
      const targetDate=body.target_disbursement_date?String(body.target_disbursement_date):null;
      const photoData=clean(body.photo_data,350000);

      if(!itemName||!category||!unit||!Number.isInteger(quantity)||quantity<0||!Number.isInteger(threshold)||threshold<0)
        return json({error:"Name, category, quantity, threshold, and unit are required."},400);
      if(unitCost!==null&&(!Number.isFinite(unitCost)||unitCost<0))
        return json({error:"Unit cost must be zero or greater."},400);

      let saved:any=null;

      if(action==="create"){
        const {data,error}=await admin.from("inventory_items").insert({
          item_name:itemName,category,quantity,threshold,unit,
          expiry_date:expiryDate,supplier:supplier||null,unit_cost:unitCost,
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
          expiry_date:expiryDate,supplier:supplier||null,unit_cost:unitCost,
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

      if(!itemId||!Number.isInteger(newQuantity)||newQuantity<0)
        return json({error:"A valid non-negative quantity is required."},400);

      const {data:existing}=await admin.from("inventory_items")
        .select("*").eq("item_id",itemId).maybeSingle();
      if(!existing)return json({error:"Inventory item not found."},404);
      if(existing.archived)return json({error:"Restore this item before updating quantity."},400);

      const {data:saved,error}=await admin.from("inventory_items")
        .update({quantity:newQuantity,updated_at:new Date().toISOString()})
        .eq("item_id",itemId).select("*").single();
      if(error)throw error;

      let transactionId:number|null=null;
      if(Number(existing.quantity)!==newQuantity){
        const {data:tx}=await admin.from("inventory_transactions").insert({
          item_id:itemId,
          transaction_type:"Adjustment",
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
        details:{previous_quantity:existing.quantity,new_quantity:newQuantity,reason:reason||null}
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
      if(actor.role!=="Administrator")
        return json({error:"Administrator access required."},403);

      const itemId=Number(body.item_id||0);
      const archived=action==="archive";
      const {data:item,error}=await admin.from("inventory_items")
        .update({
          archived,
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
        details:{item_name:item.item_name}
      });

      return json({ok:true,item});
    }

    return json({error:"Unsupported inventory action."},400);
  }catch(e){
    return json({error:e instanceof Error?e.message:"Inventory action failed."},500);
  }
});
